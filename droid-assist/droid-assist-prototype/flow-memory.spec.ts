import { describe, expect, it, vi } from 'vitest';
import { failurePattern, flowCard, learnPatterns, mergePatterns, runVerdict, upsertCard } from './flow-memory.js';
import { AiError } from './ai.js';
import type { AskFn } from './ai.js';
import type { Frame, LearnedPattern, SavedCard, WorkflowStep } from './types.js';

const refFrame = { id: 3, url: 'data:image/jpeg;base64,QUJD' } as Frame;
const step = (id: string, status: WorkflowStep['status'], extra: Partial<WorkflowStep> = {}): WorkflowStep => ({ id, name: `Step ${id}`, action: 'click', x: 0.2, y: 0.3, status, ...extra });
const real = { dryRun: false, stopped: false };

describe('runVerdict', () => {
  it('is success only when every step of a real run executed (drift-corrected counts)', () => {
    expect(runVerdict([step('a', 'done'), step('b', 'drift')], real)).toBe('success');
    expect(runVerdict([step('a', 'done'), step('b', 'failed')], real)).toBe('failed');
    expect(runVerdict([step('a', 'done'), step('b', 'pending')], real)).toBe('failed');
  });

  it('ignores dry runs, stopped runs and empty runs', () => {
    expect(runVerdict([step('a', 'done')], { dryRun: true, stopped: false })).toBe('ignored');
    expect(runVerdict([step('a', 'failed')], { dryRun: false, stopped: true })).toBe('ignored');
    expect(runVerdict([], real)).toBe('ignored');
  });
});

describe('flowCard', () => {
  it('saves steps at their drift-corrected position with their screenshot, named from the goal', () => {
    const card = flowCard('Launch the calculator', [step('a', 'drift', { correctedX: 0.25, correctedY: 0.35, refFrame, driftPx: 4 })], 42);
    expect(card.name).toMatch(/calculator/i);
    expect(card.savedAt).toBe(42);
    expect(card.steps[0]).toMatchObject({ x: 0.25, y: 0.35, correctedX: 0.25, correctedY: 0.35, refFrame, status: 'pending' });
    expect(card.steps[0].driftPx).toBeUndefined();
  });
});

describe('upsertCard', () => {
  const existing: SavedCard = { id: 'old', name: 'Open calculator app', description: '', savedAt: 1, steps: [step('a', 'pending')] };
  const other: SavedCard = { id: 'mail', name: 'Send an email', description: '', savedAt: 2, steps: [step('m', 'pending')] };

  it('replaces a near-duplicate flow in place, keeping its id and the card count', () => {
    const fresh: SavedCard = { id: 'new', name: 'Open the calculator apps', description: '', savedAt: 9, steps: [step('b', 'pending')] };
    const { cards, replaced } = upsertCard([existing, other], fresh);
    expect(replaced).toBe(existing);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ id: 'old', savedAt: 9, steps: [{ id: 'b' }] });
  });

  it('treats plural and verb-form rewordings of a flow as the same flow', () => {
    for (const [a, b] of [['rename file', 'rename files'], ['open message', 'open messages'], ['save the image', 'save the images'], ['close popup', 'closes popups'], ['close tab', 'close tabs'], ['open maps', 'open map'], ['clear logs', 'clear log'], ['press keys', 'press key']]) {
      const first: SavedCard = { id: 'x', name: a, description: '', savedAt: 1, steps: [step('a', 'pending')] };
      const { cards } = upsertCard([first], { ...first, id: 'y', name: b });
      expect(cards, `${a} / ${b}`).toHaveLength(1);
    }
  });

  it('adds an unrelated flow beside the others', () => {
    const fresh: SavedCard = { id: 'new', name: 'Play the video', description: '', savedAt: 9, steps: [step('b', 'pending')] };
    const { cards, replaced } = upsertCard([existing, other], fresh);
    expect(replaced).toBeNull();
    expect(cards.map((c) => c.id)).toEqual(['new', 'old', 'mail']);
  });
});

describe('failurePattern', () => {
  it('records an avoid lesson naming the failed step, in the goal\'s context', () => {
    const p = failurePattern('open notepad', [step('a', 'done'), step('b', 'failed', { name: 'Click Start' })]);
    expect(p).toMatchObject({ kind: 'avoid', context: 'open notepad' });
    expect(p.pattern).toContain('Click Start');
    expect(p.pattern).not.toContain('Step a');
  });
});

describe('learnPatterns', () => {
  const ask = (text: string) => vi.fn<AskFn>(async () => text);

  it('keeps only well-formed avoid/add entries and tells the model the outcome', async () => {
    const fn = ask('{"patterns":[{"kind":"add","pattern":"wait for the window","context":"notepad"},{"kind":"maybe","pattern":"x"},{"kind":"avoid","pattern":"  "},{"kind":"avoid","pattern":"clicking the taskbar"}]}');
    const learned = await learnPatterns(fn, 'open notepad', [step('a', 'failed')], 'failed');
    expect(learned.map((p) => [p.kind, p.pattern, p.context])).toEqual([['add', 'wait for the window', 'notepad'], ['avoid', 'clicking the taskbar', 'open notepad']]);
    expect(fn.mock.calls[0][0].prompt).toMatch(/FAILED/);
  });

  it('rejects a non-JSON reply instead of inventing lessons', async () => {
    await expect(learnPatterns(ask('sure!'), 'g', [step('a', 'done')], 'success')).rejects.toBeInstanceOf(AiError);
  });
});

describe('mergePatterns', () => {
  it('puts new lessons first and keeps one entry per kind+pattern', () => {
    const p = (id: string, kind: LearnedPattern['kind'], pattern: string): LearnedPattern => ({ id, kind, pattern, context: '', time: 0 });
    const merged = mergePatterns([p('1', 'avoid', 'Close popup first'), p('2', 'add', 'wait')], [p('3', 'avoid', 'close popup first'), p('4', 'add', 'close popup first')]);
    expect(merged.map((x) => x.id)).toEqual(['3', '4', '2']);
  });
});
