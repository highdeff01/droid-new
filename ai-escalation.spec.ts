import { afterEach, describe, expect, it, vi } from 'vitest';
import { FALLBACK_QUESTION_PREFIX, chat, type AiConfig, type ChatMessage } from './ai.js';
import { OVERLAP_PREFIX } from './ai-overlap.js';
import { OVERLAP_FRESH_PROMPT, appContextSections, conversationPrompts, suggestedGoal, type EscalationEvent, type EscalationHooks } from './ai-escalation.js';

type Body = { messages: ChatMessage[]; think: boolean };
type Answer = { content: string; thinking?: string; delay?: number };

const THINK = 'The search box is probably in the top bar.';
const cfg: AiConfig = { url: 'http://ai', model: 'm', think: true };
const question: ChatMessage[] = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'Where is search?' }];
const lastUser = (b: Body) => [...b.messages].reverse().find((m) => m.role === 'user')!;

/** A fetch whose reply is chosen by `answer` (thinking only when it returns null); records bodies and signals. */
function stubFetch(answer: (b: Body, i: number) => Answer | null = () => null) {
  const bodies: Body[] = [];
  const signals: AbortSignal[] = [];
  const fn = vi.fn((_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as Body;
    const i = bodies.push(body) - 1;
    signals.push(init.signal!);
    const a = answer(body, i) ?? { content: '', thinking: `${THINK} (${i})` };
    const res = () => new Response(JSON.stringify({ message: { role: 'assistant', content: a.content, thinking: a.thinking ?? THINK } }), { status: 200 });
    if (!a.delay) return Promise.resolve(res());
    return new Promise<Response>((resolve, reject) => {
      const t = setTimeout(() => resolve(res()), a.delay);
      init.signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); });
    });
  });
  vi.stubGlobal('fetch', fn);
  return { bodies, signals };
}

/** Hooks that record every stage event; app context as given. */
function hooksWith(ctx: { sections: string[]; frame?: string | null } = { sections: ['Current goal: open search'], frame: 'data:image/jpeg;base64,FRESH' }) {
  const events: EscalationEvent[] = [];
  const hooks: EscalationHooks = { appContext: vi.fn(async () => ctx), onStage: (e) => events.push(e) };
  return { events, hooks };
}

const stagesOf = (events: EscalationEvent[]) => [...new Set(events.map((e) => e.stage))];

afterEach(() => vi.unstubAllGlobals());

describe('escalate pipeline', () => {
  it('walks conversation update, similar question, app context, overlap, then answers with the thinking', async () => {
    const { bodies } = stubFetch();
    const { events, hooks } = hooksWith();
    const r = await chat(cfg, question, false, 5000, undefined, hooks);
    expect(bodies).toHaveLength(8);
    expect(stagesOf(events)).toEqual(['conversation', 'similar', 'app-context', 'overlap', 'thinking-only']);
    expect(events.filter((e) => e.stage === 'conversation')).toHaveLength(3);
    expect(r).toMatchObject({ thinkingOnly: true, answeredBy: 'thinking-only' });
    expect(r.content).toContain(THINK);
    expect(events.at(-1)!.detail).toMatch(/never produced/);
    expect(bodies.every((b) => b.think === true)).toBe(true);
  });

  it('appends the thinking to the conversation and varies each of the 3 retries', async () => {
    const { bodies } = stubFetch();
    await chat(cfg, question, false, 5000, undefined, hooksWith().hooks);
    const retries = bodies.slice(1, 4);
    // Each retry carries the newest thinking so far: the first reply's, then each retry's own.
    retries.forEach((b, i) => expect(b.messages.some((m) => m.role === 'assistant' && m.content.includes(`${THINK} (${i})`))).toBe(true));
    expect(new Set(retries.map((b) => lastUser(b).content)).size).toBe(3);
    expect(retries.some((b) => /JSON/.test(lastUser(b).content))).toBe(false);
  });

  it('makes the third retry JSON-only when a structured reply is expected', async () => {
    const { bodies } = stubFetch();
    await chat(cfg, question, true, 5000, undefined, hooksWith().hooks);
    expect(lastUser(bodies[3]).content).toMatch(/JSON object/);
  });

  it('stops at the conversation retry that answers in content', async () => {
    const { bodies } = stubFetch((_, i) => (i === 2 ? { content: 'Top bar' } : null));
    const { events, hooks } = hooksWith();
    const r = await chat(cfg, question, false, 5000, undefined, hooks);
    expect(r).toMatchObject({ content: 'Top bar', answeredBy: 'conversation' });
    expect(r.thinkingOnly).toBeUndefined();
    expect(bodies).toHaveLength(3);
    expect(stagesOf(events)).toEqual(['conversation']);
  });

  it('substitutes the answer to a similar question and notes it', async () => {
    const { bodies } = stubFetch((b) => (lastUser(b).content.startsWith(FALLBACK_QUESTION_PREFIX) ? { content: 'Top right' } : null));
    const { events, hooks } = hooksWith();
    const r = await chat(cfg, question, false, 5000, undefined, hooks);
    expect(r).toMatchObject({ content: 'Top right', answeredBy: 'similar' });
    expect(bodies).toHaveLength(5);
    expect(lastUser(bodies[4]).content).toBe(`${FALLBACK_QUESTION_PREFIX}Where is search?`);
    expect(events.some((e) => e.stage === 'similar' && e.ok && /similar/i.test(e.detail) && /substitut/i.test(e.detail))).toBe(true);
    expect(hooks.appContext).not.toHaveBeenCalled();
  });

  it('re-asks with the fresh app context (sections + screenshot) and uses its answer', async () => {
    const sections = ['Current goal: open search', 'Mapped elements:\nSearch icon', 'Recent log (newest first):\n[AI] asked', 'Habit / position memory:\nSearch at top'];
    const { bodies } = stubFetch((b) => (lastUser(b).images ? { content: 'Click the search icon' } : null));
    const { events, hooks } = hooksWith({ sections, frame: 'data:image/jpeg;base64,FRESH' });
    const r = await chat(cfg, question, false, 5000, undefined, hooks);
    expect(r).toMatchObject({ content: 'Click the search icon', answeredBy: 'app-context' });
    const ask = lastUser(bodies[5]);
    for (const s of sections) expect(ask.content).toContain(s);
    expect(ask.content).toContain('Where is search?');
    expect(ask.images).toEqual(['FRESH']);
    expect(events.some((e) => e.stage === 'app-context' && e.ok)).toBe(true);
  });

  it('skips the app-context re-ask without throwing when the app has nothing to add', async () => {
    const { bodies } = stubFetch();
    const { events, hooks } = hooksWith({ sections: [], frame: null });
    const r = await chat(cfg, question, false, 5000, undefined, hooks);
    expect(bodies).toHaveLength(7);
    expect(events.find((e) => e.stage === 'app-context')!.detail).toMatch(/no app context/);
    expect(r.answeredBy).toBe('thinking-only');
  });

  it('does not escalate when thinking is off', async () => {
    const { bodies } = stubFetch();
    const { events, hooks } = hooksWith();
    const r = await chat({ ...cfg, think: false }, question, false, 5000, undefined, hooks);
    expect(events).toEqual([]);
    expect(hooks.appContext).not.toHaveBeenCalled();
    expect(r.answeredBy).toBeUndefined();
    expect(bodies.every((b) => b.think === false)).toBe(true);
  });
});

describe('overlap winner', () => {
  const isFresh = (b: Body) => lastUser(b).content === OVERLAP_FRESH_PROMPT;
  const isPrefixed = (b: Body) => lastUser(b).content.startsWith(OVERLAP_PREFIX);

  it('takes the first valid answer of the two concurrent calls and aborts the other', async () => {
    const { bodies, signals } = stubFetch((b) => (isFresh(b) ? { content: 'B', delay: 5 } : isPrefixed(b) ? { content: 'A', delay: 40 } : null));
    const r = await chat(cfg, question, false, 5000, undefined, hooksWith({ sections: [] }).hooks);
    expect(r).toMatchObject({ content: 'B', answeredBy: 'overlap' });
    const slow = bodies.findIndex(isPrefixed);
    expect(signals[slow].aborted).toBe(true);
  });

  it('skips a faster thinking-only contender and waits for real content', async () => {
    stubFetch((b) => (isFresh(b) ? { content: '', delay: 5 } : isPrefixed(b) ? { content: 'A', delay: 40 } : null));
    const r = await chat(cfg, question, false, 5000, undefined, hooksWith({ sections: [] }).hooks);
    expect(r).toMatchObject({ content: 'A', answeredBy: 'overlap' });
  });
});

describe('escalation helpers', () => {
  it('appContextSections includes the goal and leaves out empty lists', () => {
    const s = appContextSections({ goal: ' Open search ', steps: [], elements: ['Search icon'], log: [], habits: ['Search at top'] });
    expect(s).toEqual(['Current goal: Open search', 'Mapped elements:\nSearch icon', 'Habit / position memory:\nSearch at top']);
  });

  it('suggestedGoal builds on the goal with the last idea of the thinking', () => {
    expect(suggestedGoal('Search is in the top bar. Try clicking the search icon.', 'Find search')).toBe('Find search — next: Try clicking the search icon');
    expect(suggestedGoal('Open the menu', '')).toBe('Open the menu');
  });

  it('conversationPrompts gives three distinct prompts building on the thinking', () => {
    const p = conversationPrompts(false);
    expect(p).toHaveLength(3);
    expect(new Set(p).size).toBe(3);
    expect(p.every((x) => /thinking/.test(x))).toBe(true);
  });
});
