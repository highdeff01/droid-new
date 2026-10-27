import { describe, expect, it, vi } from 'vitest';
import { mapContext } from './element-map-studio.js';
import { PLAN_SYSTEM, findSimilar, parseExpectations, planFromGoal, relevantPatterns, relocateTarget, replanDrag, replanStep, similarity } from './planner.js';
import { decidePopup, decideStep, describeScreen, reflectStep } from './assist-ai.js';
import { AiError, SAMPLE_VIEW, systemText } from './ai.js';
import type { AskFn } from './ai.js';
import { resolveCell } from './grid.js';
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

describe('planFromGoal capabilities', () => {
  const list = 'backup.export() — Export a backup now\nrelax.mode(on:boolean) — Relaxation mode';

  it('adds the compact capability list to the plan prompt only when given', async () => {
    const ask = askReturning('{"steps":[{"name":"Click","action":"click","x":0.1,"y":0.1}]}');
    await planFromGoal('press the thing', [], frame, ask, [], [], list);
    await planFromGoal('press the thing', [], frame, ask);
    const [withList, without] = ask.mock.calls.map((c) => systemText(c[0].system, SAMPLE_VIEW));
    expect(withList).toContain('"capabilities":[{"id":string');
    expect(withList).toContain('relax.mode(on:boolean) — Relaxation mode');
    expect(without).not.toContain('capabilities');
  });

  it('accepts a plan with only capability requests and no steps', async () => {
    const ask = askReturning('{"steps":[],"capabilities":[{"id":"backup.export"},{"id":"relax.mode","params":{"on":true}}]}');
    const plan = await planFromGoal('export a backup now and relax', [], frame, ask, [], [], list);
    expect(plan.steps).toEqual([]);
    expect(plan.capabilities).toEqual([{ id: 'backup.export', params: {} }, { id: 'relax.mode', params: { on: true } }]);
  });

  it('returns steps and capability requests together', async () => {
    const ask = askReturning('{"steps":[{"name":"Click","action":"click","x":0.1,"y":0.1}],"capabilities":[{"id":"workflow.save","params":{"name":"Run"}}]}');
    const plan = await planFromGoal('click it then save as a workflow', [], frame, ask, [], [], list);
    expect(plan.steps).toHaveLength(1);
    expect(plan.capabilities).toEqual([{ id: 'workflow.save', params: { name: 'Run' } }]);
  });

  it('still fails an empty plan without capability requests, and a malformed request', async () => {
    await expect(planFromGoal('x', [], frame, askReturning('{"steps":[],"capabilities":[]}'), [], [], list)).rejects.toThrow(/no steps/);
    await expect(planFromGoal('x', [], frame, askReturning('{"steps":[],"capabilities":[{"params":{}}]}'), [], [], list)).rejects.toThrow(/unusable capability/);
    await expect(planFromGoal('x', [], frame, askReturning('{"steps":[],"capabilities":"backup"}'), [], [], list)).rejects.toThrow(/not a list/);
  });
});

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
    expect(systemText(ask.mock.calls[0][0].system, SAMPLE_VIEW)).toContain('"A1"');
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
      expect(systemText(ask.mock.calls[0][0].system, SAMPLE_VIEW)).toContain('"A1"');
      expect(systemText(ask.mock.calls[0][0].system, SAMPLE_VIEW)).toContain('0.000..0.083');
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

describe('rearrangement planning', () => {
  const REARRANGE_REPLY = '{"steps":[' +
    '{"name":"Drag Files below Game","action":"drag","target":"Files icon","cell":"B1","cx":0.5,"cy":0.5,"endTarget":"empty space below Game","endCell":"G1","endCx":0.5,"endCy":0.3},' +
    '{"name":"Drag Notes below Files","action":"drag","target":"Notes icon","x":0.3,"y":0.4,"endTarget":"empty space below Files","endX":0.3,"endY":0.55}' +
    '],"expect":[{"element":"Files","relation":"below","anchor":"Game"},{"element":"Notes","relation":"below","anchor":"Files"}]}';
  /** A stub ask returning a fixed two-drag rearrangement reply (plus its "expect"). */
  const rearrangeAsk = askReturning(REARRANGE_REPLY);
  const dragStep: WorkflowStep = { id: 'd1', name: 'Drag Files', action: 'drag', x: 0.1, y: 0.1, endX: 0.5, endY: 0.5, target: 'Files icon', endTarget: 'empty spot', status: 'pending' };

  describe('parseExpectations', () => {
    it('returns [] when the reply has no expect', () => {
      expect(parseExpectations('{"steps":[]}')).toEqual([]);
    });

    it('parses a relation entry', () => {
      expect(parseExpectations('{"steps":[],"expect":[{"element":"Files","relation":"below","anchor":"Game"}]}')).toEqual([{ element: 'Files', relation: 'below', anchor: 'Game' }]);
    });

    it('throws AiError for an unknown relation', () => {
      expect(() => parseExpectations('{"steps":[],"expect":[{"element":"Files","relation":"beside","anchor":"Game"}]}')).toThrow(AiError);
    });

    it('throws AiError for a missing anchor', () => {
      expect(() => parseExpectations('{"steps":[],"expect":[{"element":"Files","relation":"below"}]}')).toThrow(AiError);
    });
  });

  describe('planFromGoal with a rearrangement reply', () => {
    it('yields expect relations and drag end points from endCell/endCx/endCy and explicit endX/endY', async () => {
      const plan = await planFromGoal('rearrange the sidebar to Calc, Game, Notes, Files', [], frame, rearrangeAsk);
      expect(plan.expect).toEqual([
        { element: 'Files', relation: 'below', anchor: 'Game' },
        { element: 'Notes', relation: 'below', anchor: 'Files' },
      ]);
      const cellEnd = resolveCell('G1', 0.5, 0.3)!;
      expect(plan.steps[0]).toMatchObject({ action: 'drag', target: 'Files icon', endTarget: 'empty space below Game', endX: cellEnd.x, endY: cellEnd.y });
      expect(plan.steps[1]).toMatchObject({ action: 'drag', target: 'Notes icon', endTarget: 'empty space below Files', endX: 0.3, endY: 0.55 });
    });
  });

  describe('replanDrag', () => {
    it('returns the corrected drag keeping the original id and name', async () => {
      const ask = askReturning('{"steps":[{"name":"Drag Files again","action":"drag","target":"Files icon","cell":"B1","cx":0.5,"cy":0.5,"endCell":"G1","endCx":0.5,"endCy":0.3}]}');
      const result = await replanDrag(ask, frame, dragStep, 'landed at the wrong spot');
      expect(result?.step.id).toBe('d1');
      expect(result?.step.name).toBe('Drag Files');
      expect(result?.step.action).toBe('drag');
      const start = resolveCell('B1', 0.5, 0.5)!;
      const end = resolveCell('G1', 0.5, 0.3)!;
      expect(result?.step.x).toBeCloseTo(start.x);
      expect(result?.step.y).toBeCloseTo(start.y);
      expect(result?.step.endX).toBeCloseTo(end.x);
      expect(result?.step.endY).toBeCloseTo(end.y);
    });

    it('returns null for {"steps":[]}', async () => {
      expect(await replanDrag(askReturning('{"steps":[]}'), frame, dragStep, 'landed at the wrong spot')).toBeNull();
    });

    it('throws AiError when the model returns a non-drag action', async () => {
      const ask = askReturning('{"steps":[{"name":"Click somewhere","action":"click","x":0.5,"y":0.5}]}');
      await expect(replanDrag(ask, frame, dragStep, 'landed at the wrong spot')).rejects.toBeInstanceOf(AiError);
    });

    it('sends the feedback text in the prompt', async () => {
      const ask = askReturning('{"steps":[{"name":"Drag Files again","action":"drag","target":"Files icon","x":0.2,"y":0.2,"endX":0.5,"endY":0.6}]}');
      await replanDrag(ask, frame, dragStep, 'ended up above Game instead of below it');
      expect(ask.mock.calls[0][0].prompt).toContain('ended up above Game instead of below it');
    });
  });

  describe('replanStep', () => {
    it('returns a step keeping the original id and name with the new action/coords and the reply\'s thinking', async () => {
      const ask = askReturning('{"steps":[{"name":"Press play again","action":"click","x":0.6,"y":0.7}]}', 'found it lower');
      const result = await replanStep(ask, frame, step, 'the button moved');
      expect(result?.step.id).toBe('s');
      expect(result?.step.name).toBe('Press play');
      expect(result?.step.action).toBe('click');
      expect(result?.step.x).toBeCloseTo(0.6);
      expect(result?.step.y).toBeCloseTo(0.7);
      expect(result?.thinking).toBe('found it lower');
    });

    it('resolves null for {"steps":[]}', async () => {
      expect(await replanStep(askReturning('{"steps":[]}'), frame, step, 'not visible anymore')).toBeNull();
    });

    it('mentions the failure feedback and the step name in the prompt', async () => {
      const ask = askReturning('{"steps":[]}');
      await replanStep(ask, frame, step, 'the button moved off-screen');
      expect(ask.mock.calls[0][0].prompt).toContain('the button moved off-screen');
      expect(ask.mock.calls[0][0].prompt).toContain('Press play');
    });

    it('replanDrag still throws when the model answers a non-drag step', async () => {
      const ask = askReturning('{"steps":[{"name":"Click somewhere","action":"click","x":0.5,"y":0.5}]}');
      await expect(replanDrag(ask, frame, dragStep, 'landed at the wrong spot')).rejects.toBeInstanceOf(AiError);
    });
  });
});

describe('user-mapped elements in planning', () => {
  it('sends mapped boundaries as planning context and flags steps with no point', async () => {
    const ask = askReturning('{"steps":[{"name":"Press OK","action":"click","target":"OK button"},{"name":"Go","action":"click","cell":"B2"}]}');
    const lines = mapContext([{ id: 'm', name: 'OK button', box: { x: 0.4, y: 0.5, w: 0.2, h: 0.1 }, mappedAt: 0 }]);
    const plan = await planFromGoal('press ok', [], null, ask, lines);
    const ctx = ask.mock.calls[0][0].context!.join('\n');
    expect(ctx).toContain('"OK button" boundary x=40.0%..60.0%, y=50.0%..60.0%');
    expect(plan.steps[0].unlocated).toBe(true);
    expect(plan.steps[1].unlocated).toBeUndefined();
  });

  it('relocateTarget passes mapped context', async () => {
    const ask = askReturning('{"steps":[]}');
    await relocateTarget(ask, { url: 'data:image/jpeg;base64,QQ==' } as Frame, { id: 's', name: 'n', action: 'click', x: 0.5, y: 0.5, status: 'pending' }, 'missed', ['[Mapped element] "X"']);
    expect(ask.mock.calls[0][0].context).toEqual(['[Mapped element] "X"']);
  });
});
