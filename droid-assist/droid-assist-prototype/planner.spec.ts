import { describe, expect, it, vi } from 'vitest';
import { planFromGoal } from './planner.js';
import { decidePopup, decideStep, describeScreen, reflectStep } from './assist-ai.js';
import { AiError } from './ai.js';
import type { AskFn } from './ai.js';
import type { Frame, SavedCard, WorkflowStep } from './types.js';

const frame = { id: 1, url: 'data:image/jpeg;base64,QUJD' } as Frame;
const askReturning = (text: string, thinking: string | null = null) => vi.fn<AskFn>(async () => ({ content: text, thinking }));
const card: SavedCard = {
  id: 'c1',
  name: 'Open calculator app',
  description: 'opens calculator',
  steps: [{ id: 's1', name: 'Open calculator', action: 'open_app', x: 0.1, y: 0.2, status: 'done' }],
  savedAt: 0,
};
const step: WorkflowStep = { id: 's', name: 'Press play', action: 'click', x: 0.5, y: 0.5, status: 'pending' };

describe('planFromGoal', () => {
  it('reuses a similar saved card without calling the model', async () => {
    const ask = askReturning('{}');
    const plan = await planFromGoal('open calculator app', [card], frame, ask);
    expect(ask).not.toHaveBeenCalled();
    expect(plan.source).toMatch(/Reused saved workflow/);
    expect(plan.steps[0]).toMatchObject({ action: 'open_app', status: 'pending' });
  });

  it('builds steps from the model reply, sending goal, frame and context', async () => {
    const ask = askReturning('{"steps":[{"name":"Hit search box","action":"click","x":0.4,"y":0.1},{"name":"Type","action":"type","x":240,"y":135,"text":"cats"}]}');
    const plan = await planFromGoal('find cats online', [card], frame, ask, ['[You] opened browser']);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0]).toMatchObject({ prompt: 'Goal: find cats online', frame, context: ['[You] opened browser'], json: true });
    expect(plan.source).toMatch(/^AI planned/);
    expect(plan.steps).toMatchObject([
      { name: 'Hit search box', action: 'click', x: 0.4, y: 0.1, refFrame: frame, status: 'pending' },
      { name: 'Type', action: 'type', x: 0.5, y: 0.5, text: 'cats' },
    ]);
  });

  it('fails on a non-JSON reply instead of inventing steps', async () => {
    await expect(planFromGoal('do things', [], frame, askReturning('hello'))).rejects.toBeInstanceOf(AiError);
  });

  it('fails on an unknown action or an empty plan', async () => {
    await expect(planFromGoal('x', [], frame, askReturning('{"steps":[{"action":"fly"}]}'))).rejects.toThrow(/unknown action/);
    await expect(planFromGoal('x', [], frame, askReturning('{"steps":[]}'))).rejects.toThrow(/no steps/);
  });

  it('propagates an unreachable model', async () => {
    const ask = vi.fn<AskFn>(async () => {
      throw new AiError('AI endpoint unreachable');
    });
    await expect(planFromGoal('x', [], frame, ask)).rejects.toThrow(/unreachable/);
  });
});

describe('decidePopup', () => {
  const box = { x: 0.3, y: 0.3, w: 0.4, h: 0.3 };
  it('closes where the model points', async () => {
    const ask = askReturning('{"close":true,"x":0.9,"y":0.1,"reason":"ad"}');
    await expect(decidePopup(ask, frame, box)).resolves.toEqual({ close: true, x: 0.9, y: 0.1, reason: 'ad', thinking: null });
    expect(ask.mock.calls[0][0].frame).toBe(frame);
  });
  it('leaves it when the model says so, carrying its thinking', async () => {
    await expect(decidePopup(askReturning('{"close":false,"reason":"content"}', 'it is page content'), frame, box)).resolves.toEqual({ close: false, reason: 'content', thinking: 'it is page content' });
  });
});

describe('decideStep', () => {
  it('runs at the model target or waits', async () => {
    await expect(decideStep(askReturning('{"run":true,"x":0.6,"y":0.7,"reason":"visible"}', 'button is visible'), frame, step, 'play')).resolves.toEqual({ run: true, x: 0.6, y: 0.7, reason: 'visible', thinking: 'button is visible' });
    await expect(decideStep(askReturning('{"run":false,"reason":"not ready"}'), frame, step, 'play')).resolves.toEqual({ run: false, reason: 'not ready', thinking: null });
  });
});

describe('describeScreen', () => {
  it('returns the model answer and its boxes', async () => {
    const r = await describeScreen(askReturning('{"answer":"ZZZ-42","items":[{"label":"Play","x":0.4,"y":0.6,"w":0.2,"h":0.1,"tone":"warn"}]}'), frame, 'what now?', '');
    expect(r.answer).toBe('ZZZ-42');
    expect(r.annotations[0]).toMatchObject({ label: 'Play', x: 0.4, y: 0.6, tone: 'warn' });
  });
  it('rejects a reply without an answer', async () => {
    await expect(describeScreen(askReturning('{"items":[]}'), frame, 'q', '')).rejects.toBeInstanceOf(AiError);
  });
  it('returns the model thinking with the answer', async () => {
    const r = await describeScreen(askReturning('{"answer":"Search","items":[]}', 'the box at top'), frame, 'where?', '');
    expect(r.thinking).toBe('the box at top');
  });
});

describe('planFromGoal thinking', () => {
  it('returns the model thinking with a planned result and null for a reused card', async () => {
    const planned = await planFromGoal('find dogs', [], frame, askReturning('{"steps":[{"name":"Search","action":"search","text":"dogs"}]}', 'need a search'));
    expect(planned.thinking).toBe('need a search');
    expect((await planFromGoal('open calculator app', [card], frame, askReturning('{}', 'unused'))).thinking).toBeNull();
  });
});

describe('reflectStep', () => {
  const outcome = { ok: true, message: 'Dispatched to PC at (10, 20)' };
  const askSequence = (...replies: Array<{ content: string; thinking: string | null }>) => vi.fn<AskFn>(async () => replies.shift()!);

  it('asks for a free-text reflection, then a JSON verdict, returning both with their thinking', async () => {
    const ask = askSequence({ content: 'The dialog closed.', thinking: 'compare screens' }, { content: '{"success":true,"pattern_avoid":null,"pattern_add":"close dialogs first"}', thinking: 'it worked' });
    const r = await reflectStep(ask, frame, step, outcome, 'play');
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask.mock.calls[0][0].json).toBeFalsy();
    expect(ask.mock.calls[0][0].prompt).toContain('Press play');
    expect(ask.mock.calls[1][0]).toMatchObject({ json: true, frame });
    expect(ask.mock.calls[1][0].prompt).toContain('The dialog closed.');
    expect(r).toEqual({
      reflection: { text: 'The dialog closed.', thinking: 'compare screens' },
      verdict: { success: true, pattern_avoid: null, pattern_add: 'close dialogs first', thinking: 'it worked' },
    });
  });

  it('keeps a failure verdict and its pattern to avoid', async () => {
    const ask = askSequence({ content: 'Missed.', thinking: null }, { content: '{"success":false,"pattern_avoid":"clicking the banner","pattern_add":""}', thinking: null });
    expect((await reflectStep(ask, null, step, { ok: false, message: 'no change' }, '')).verdict).toEqual({ success: false, pattern_avoid: 'clicking the banner', pattern_add: null, thinking: null });
  });

  it('rejects a verdict whose success is not a boolean', async () => {
    const ask = askSequence({ content: 'ok', thinking: null }, { content: '{"success":"yes"}', thinking: null });
    await expect(reflectStep(ask, frame, step, outcome, '')).rejects.toBeInstanceOf(AiError);
  });
});
