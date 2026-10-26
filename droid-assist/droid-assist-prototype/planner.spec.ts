import { describe, expect, it, vi } from 'vitest';
import { PLAN_SYSTEM, findSimilar, planFromGoal, relevantPatterns, relocateTarget, similarity } from './planner.js';
import { decidePopup, decideStep, describeScreen, reflectStep } from './assist-ai.js';
import { AiError } from './ai.js';
import type { AskFn } from './ai.js';
import type { Frame, LearnedPattern, SavedCard, WorkflowStep } from './types.js';

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

  it('plans "move mouse to the files icon" as a move step on its named target', async () => {
    const ask = askReturning('{"steps":[{"name":"Move to Files icon","action":"move","target":"Files icon","x":0.42,"y":0.97}]}');
    const plan = await planFromGoal('move mouse to the files icon', [], frame, ask);
    expect(plan.steps).toMatchObject([{ action: 'move', target: 'Files icon', x: 0.42, y: 0.97, refFrame: frame }]);
  });

  it('accepts double_click and scroll, naming the step as the target when none is given', async () => {
    const ask = askReturning('{"steps":[{"name":"Open readme","action":"double_click","x":0.2,"y":0.3},{"name":"Page","action":"scroll","x":0.5,"y":0.5,"text":"up"}]}');
    const plan = await planFromGoal('open the readme file and scroll up', [], frame, ask);
    expect(plan.steps).toMatchObject([
      { action: 'double_click', target: 'Open readme' },
      { action: 'scroll', target: 'Page', text: 'up' },
    ]);
  });

  it('gives no target to non-pointer steps', async () => {
    const plan = await planFromGoal('type hi', [], frame, askReturning('{"steps":[{"name":"Type","action":"type","target":"box","text":"hi"}]}'));
    expect(plan.steps[0].target).toBeUndefined();
  });

  it('tells the model about every action and the target field', () => {
    for (const word of ['"move"', '"double_click"', '"scroll"', '"target"']) expect(PLAN_SYSTEM).toContain(word);
  });

  it('includes the grid definition and asks for a cell plus in-cell position', () => {
    for (const word of ['"A1"', '"H12"', '0.000..0.083', '"cell"', '"cx"', '"cy"']) expect(PLAN_SYSTEM).toContain(word);
  });

  it('resolves a grid cell + in-cell fraction to exact coordinates', async () => {
    const ask = askReturning('{"steps":[{"name":"Open Docs","action":"click","target":"Docs in sidebar","cell":"C1","cx":0.5,"cy":0.25}]}');
    const plan = await planFromGoal('open docs folder', [], frame, ask);
    expect(plan.steps[0].x).toBeCloseTo(0.5 / 12);
    expect(plan.steps[0].y).toBeCloseTo(2.25 / 8);
  });
});

describe('grid in grounding prompts', () => {
  it('relocateTarget sends the grid, states the rejected cell and resolves the new cell', async () => {
    const ask = askReturning('{"steps":[{"action":"move","target":"Files icon","cell":"H6","cx":0,"cy":1}]}');
    const move: WorkflowStep = { id: 'm', name: 'Move', action: 'move', target: 'Files icon', x: 0.06, y: 0.35, status: 'pending' };
    const p = await relocateTarget(ask, frame, move, 'wrong');
    expect(p?.x).toBeCloseTo(5 / 12);
    expect(p?.y).toBeCloseTo(1);
    expect(ask.mock.calls[0][0].system).toContain('"A1"');
    expect(ask.mock.calls[0][0].prompt).toContain('C1 (');
  });

  it('popup, executor and screen-help prompts carry the grid definition', async () => {
    const popupAsk = askReturning('{"close":true,"cell":"A12","cx":0.5,"cy":0.5,"reason":"ad"}');
    const d = await decidePopup(popupAsk, frame, { x: 0.3, y: 0.3, w: 0.4, h: 0.3 });
    expect(d).toMatchObject({ close: true });
    if (d.close) {
      expect(d.x).toBeCloseTo(23 / 24);
      expect(d.y).toBeCloseTo(1 / 16);
    }
    const stepAsk = askReturning('{"run":true,"x":0.6,"y":0.7,"reason":"ok"}');
    await decideStep(stepAsk, frame, step, 'play');
    const helpAsk = askReturning('{"answer":"ok","items":[]}');
    await describeScreen(helpAsk, frame, 'q', '');
    for (const ask of [popupAsk, stepAsk, helpAsk]) {
      expect(ask.mock.calls[0][0].system).toContain('"A1"');
      expect(ask.mock.calls[0][0].system).toContain('0.000..0.083');
    }
  });
});

describe('relocateTarget', () => {
  const move: WorkflowStep = { id: 'm', name: 'Move to Files icon', action: 'move', target: 'Files icon', x: 0.1, y: 0.1, status: 'pending' };

  it('re-asks with the rejection feedback and returns the new point', async () => {
    const ask = askReturning('{"steps":[{"action":"move","target":"Files icon","x":0.6,"y":0.95}]}');
    expect(await relocateTarget(ask, frame, move, 'crop shows an empty desktop')).toEqual({ x: 0.6, y: 0.95, thinking: null });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0].prompt).toContain('crop shows an empty desktop');
    expect(ask.mock.calls[0][0].prompt).toContain('Files icon');
    expect(ask.mock.calls[0][0].frame).toBe(frame);
  });

  it('returns null when the model cannot see the target', async () => {
    expect(await relocateTarget(askReturning('{"steps":[]}'), frame, move, 'nope')).toBeNull();
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

describe('flow reuse', () => {
  const flow: SavedCard = {
    id: 'f1', name: 'Close ad and play video', description: '2 step(s): click', savedAt: 1,
    steps: [
      { id: 'a', name: 'Close ad', action: 'click', x: 0.8, y: 0.2, correctedX: 0.83, correctedY: 0.22, status: 'pending' },
      { id: 'b', name: 'Press play', action: 'click', x: 0.5, y: 0.5, status: 'pending' },
    ],
  };

  it('matches reworded goals: synonyms, plurals and verb forms', () => {
    expect(similarity('dismiss the ads and play the videos', 'Close ad and play video')).toBe(1);
    expect(similarity('launching calculators', 'open calculator')).toBe(1);
    expect(findSimilar('dismiss popup then play videos', [flow])).toBe(flow);
    expect(findSimilar('book a flight', [flow])).toBeNull();
  });

  it('reuses a saved flow from its drift-corrected coordinates without asking the model', async () => {
    const ask = askReturning('{}');
    const plan = await planFromGoal('dismiss the ads and play the video', [flow], frame, ask);
    expect(ask).not.toHaveBeenCalled();
    expect(plan.source).toMatch(/Reused saved workflow "Close ad and play video".*corrected/);
    expect(plan.steps.map((s) => [s.x, s.y, s.correctedX, s.status])).toEqual([[0.83, 0.22, undefined, 'pending'], [0.5, 0.5, undefined, 'pending']]);
    expect(plan.steps[0].id).not.toBe('a');
  });
});

describe('learned patterns in planning', () => {
  const pat = (pattern: string, context: string, kind: LearnedPattern['kind'] = 'avoid'): LearnedPattern => ({ id: pattern, kind, pattern, context, time: 0 });
  const notepad = pat('close popup first', 'open notepad');
  const unrelated = pat('scroll the spreadsheet', 'edit budget sheet', 'add');
  const general = pat('wait for the window to load', '', 'add');

  it('selects patterns related to the goal plus general ones', () => {
    expect(relevantPatterns('launch Notepad', [notepad, unrelated, general])).toEqual([notepad, general]);
  });

  it('sends relevant patterns as planning context to the model', async () => {
    const ask = askReturning('{"steps":[{"name":"Open","action":"open_app","x":0.1,"y":0.1,"text":"notepad"}]}');
    const plan = await planFromGoal('open notepad', [], frame, ask, ['[You] hi'], [notepad, unrelated]);
    const context = ask.mock.calls[0][0].context!;
    expect(context.some((l) => l.includes('close popup first') && l.includes('avoid'))).toBe(true);
    expect(context.some((l) => l.includes('spreadsheet'))).toBe(false);
    expect(context).toContain('[You] hi');
    expect(plan.source).toMatch(/1 learned pattern/);
  });
});
