import { describe, expect, it } from 'vitest';
import type { LogEntry } from './types.js';
import { DEFAULT_STAGES, STAGES, type StageMap } from './loop-control.js';
import {
  EMPTY_OPS, OPS_AGENTS, OPS_AGENT_IDS,
  addEvidence, addOpsReport, changeKey, dedupeLog, decideReapply, enabledOps, isOpsAgent, loopReport, mapDelta,
  monitorChange, needsForeground, opsAgent, opsFor, parseLoopCommand, parseOpsTarget, parsePlacement, patchOpsAgent,
  readOpsState, recheckVerdict, shouldReport, tagLog, testTarget, type MonitorChange, type NamedBox, type TestCandidate,
} from './operations.js';

const entry = (source: string, message: string, tone: LogEntry['tone'] = 'info', extra: Partial<LogEntry> = {}): LogEntry => ({
  id: `${source}-${message}`, time: 1, source, message, tone, ...extra,
});

/** A flat ImageData of `w`×`h` filled with luminance `v` (0..255), optionally painting whole grid cells bright. */
function gridFrame(w: number, h: number, bright: Array<[col: number, row: number]>, cw = 10, ch = 10): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  const isBright = (x: number, y: number) => bright.some(([col, row]) => x >= col * cw && x < (col + 1) * cw && y >= row * ch && y < (row + 1) * ch);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = isBright(x, y) ? 255 : 0;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data, colorSpace: 'srgb' } as ImageData;
}

/** A uniform ImageData, for recheckVerdict's before/after frames. */
const solidFrame = (w: number, h: number, v: number): ImageData => gridFrame(w, h, v ? [[0, 0]] : [], w, h);

describe('dedupeLog', () => {
  it('tags an entry with a trimmed, non-empty operation id', () => {
    expect(tagLog(entry('AI', 'did a thing'), ' goal-123 ').op).toBe('goal-123');
  });

  it('leaves the entry unchanged (same reference) for a null or blank operation', () => {
    const e = entry('AI', 'did a thing');
    expect(tagLog(e, null)).toBe(e);
    expect(tagLog(e, '   ')).toBe(e);
  });

  it('adds a new entry to the front when it differs from the newest one', () => {
    const log = [entry('AI', 'first')];
    const next = dedupeLog(log, entry('AI', 'second'), 10);
    expect(next.map((l) => l.message)).toEqual(['second', 'first']);
  });

  it('folds a repeat of the newest entry: time refreshed, repeat count raised, rest kept', () => {
    const first = entry('Watcher', 'popup seen', 'warn', { op: 'opA' });
    const folded = dedupeLog([first], entry('Watcher', 'popup seen', 'warn', { op: 'opA', time: 99 }), 10);
    expect(folded).toHaveLength(1);
    expect(folded[0]).toMatchObject({ message: 'popup seen', time: 99, repeat: 2 });
  });

  it('raises an existing repeat count further and keeps earlier screenshots when the new entry has none', () => {
    const first = entry('Watcher', 'popup seen', 'warn', { repeat: 3, shots: ['before.png'] });
    const folded = dedupeLog([first], entry('Watcher', 'popup seen', 'warn'), 10);
    expect(folded[0].repeat).toBe(4);
    expect(folded[0].shots).toEqual(['before.png']);
  });

  it('replaces the screenshots when the repeated entry brings its own', () => {
    const first = entry('Watcher', 'popup seen', 'warn', { shots: ['before.png'] });
    const folded = dedupeLog([first], entry('Watcher', 'popup seen', 'warn', { shots: ['after.png'] }), 10);
    expect(folded[0].shots).toEqual(['after.png']);
  });

  it('does not fold entries that differ by source, tone or operation tag', () => {
    const first = entry('Watcher', 'popup seen', 'warn', { op: 'opA' });
    expect(dedupeLog([first], entry('AI', 'popup seen', 'warn', { op: 'opA' }), 10)).toHaveLength(2);
    expect(dedupeLog([first], entry('Watcher', 'popup seen', 'error', { op: 'opA' }), 10)).toHaveLength(2);
    expect(dedupeLog([first], entry('Watcher', 'popup seen', 'warn', { op: 'opB' }), 10)).toHaveLength(2);
  });

  it('caps the log at the given limit', () => {
    const log = Array.from({ length: 5 }, (_, i) => entry('AI', `m${i}`));
    expect(dedupeLog(log, entry('AI', 'newest'), 3)).toHaveLength(3);
  });
});

describe('monitorChange', () => {
  it('returns null when fewer than minCells grid cells changed', () => {
    const prev = gridFrame(160, 90, []);
    const next = gridFrame(160, 90, []);
    expect(monitorChange(prev, next, [], 1)).toBeNull();
  });

  it('reports the changed cells, bounding box and overlapping mapped elements', () => {
    const prev = gridFrame(160, 90, []);
    const next = gridFrame(160, 90, [[5, 3], [6, 3], [5, 4], [6, 4]]);
    const map: NamedBox[] = [
      { name: 'Save button', box: { x: 5 / 16, y: 3 / 9, w: 1 / 16, h: 1 / 9 } },
      { name: 'Far corner', box: { x: 0.95, y: 0.95, w: 0.02, h: 0.02 } },
    ];
    const change = monitorChange(prev, next, map, 3);
    expect(change).not.toBeNull();
    expect(change!.cells).toBe(4);
    expect(change!.box).toEqual({ x: 5 / 16, y: 3 / 9, w: 2 / 16, h: 2 / 9 });
    expect(change!.elements).toEqual(['Save button']);
  });

  it('returns null when the change is just under minCells', () => {
    const prev = gridFrame(160, 90, []);
    const next = gridFrame(160, 90, [[5, 3], [6, 3], [5, 4], [6, 4]]);
    expect(monitorChange(prev, next, [], 5)).toBeNull();
  });

  it('mapDelta names added to and removed from the element map', () => {
    expect(mapDelta(['A', 'B'], ['B', 'C'])).toEqual({ added: ['C'], removed: ['A'] });
    expect(mapDelta([], [])).toEqual({ added: [], removed: [] });
  });

  const change = (elements: string[]): MonitorChange => ({ cells: 4, box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, elements });

  it('shouldReport is true with no prior report', () => {
    expect(shouldReport(null, change(['A']), 1000)).toBe(true);
  });

  it('shouldReport is false for the same change before MONITOR_REPORT_MS has passed', () => {
    const last = { key: changeKey(change(['A'])), time: 1000 };
    expect(shouldReport(last, change(['A']), 1000 + 2999)).toBe(false);
  });

  it('shouldReport is true for the same change once MONITOR_REPORT_MS has passed', () => {
    const last = { key: changeKey(change(['A'])), time: 1000 };
    expect(shouldReport(last, change(['A']), 1000 + 3000)).toBe(true);
  });

  it('shouldReport is true for a different change regardless of timing', () => {
    const last = { key: changeKey(change(['A'])), time: 1000 };
    expect(shouldReport(last, change(['B']), 1000)).toBe(true);
  });
});

describe('decideReapply', () => {
  it('recheckVerdict passes a no-effect action (move) without checking for visible change', () => {
    const before = solidFrame(100, 100, 0);
    const after = solidFrame(100, 100, 0);
    const v = recheckVerdict(before, after, { action: 'move', x: 0.5, y: 0.5 });
    expect(v.ok).toBe(true);
    expect(v.detail).toContain('no visible effect expected for move');
  });

  it('recheckVerdict fails an effect action (click) when the frame did not change', () => {
    const before = solidFrame(100, 100, 0);
    const after = solidFrame(100, 100, 0);
    const v = recheckVerdict(before, after, { action: 'click', x: 0.5, y: 0.5 });
    expect(v.ok).toBe(false);
    expect(v.detail).toContain('no visible effect after click');
  });

  it('recheckVerdict passes an effect action (click) when the frame visibly changed', () => {
    const before = solidFrame(100, 100, 0);
    const after = solidFrame(100, 100, 255);
    const v = recheckVerdict(before, after, { action: 'click', x: 0.5, y: 0.5 });
    expect(v.ok).toBe(true);
    expect(v.detail).toContain('intended effect seen');
  });

  const planned = { x: 0.4, y: 0.6 };

  it('escalates once the attempt exceeds the limit, regardless of correction', () => {
    expect(decideReapply(3, 2, null, planned)).toEqual({ kind: 'escalate', why: 'reapply limit (2) reached' });
  });

  it('retries at the planned point when there is no reference frame to correct against', () => {
    expect(decideReapply(1, 2, null, planned)).toEqual({ kind: 'retry', at: planned, why: 'no reference frame — retrying at the planned point' });
  });

  it('escalates when the target was not found on the live frame', () => {
    const d = decideReapply(1, 2, { level: 'red', x: 0.1, y: 0.1, driftPx: 0 }, planned);
    expect(d).toEqual({ kind: 'escalate', why: 'target not found on the live frame' });
  });

  it('retries at the corrected point when the target is in place (green)', () => {
    const d = decideReapply(1, 2, { level: 'green', x: 0.41, y: 0.61, driftPx: 0 }, planned);
    expect(d.kind).toBe('retry');
    expect(d).toMatchObject({ at: { x: 0.41, y: 0.61 } });
    expect((d as { why: string }).why).toContain('in place');
  });

  it('retries at the corrected point when the target moved (yellow)', () => {
    const d = decideReapply(1, 2, { level: 'yellow', x: 0.5, y: 0.5, driftPx: 12 }, planned);
    expect(d.kind).toBe('retry');
    expect((d as { why: string }).why).toContain('moved 12px');
  });
});

describe('loopReport', () => {
  it('parses "disable <stage>" and "enable the <stage>" (case-insensitive, with filler words)', () => {
    expect(parseLoopCommand('disable Reflect')).toEqual({ kind: 'toggle', id: 'reflect', on: false });
    expect(parseLoopCommand('enable the screen watcher')).toEqual({ kind: 'toggle', id: 'screenWatcher', on: true });
    expect(parseLoopCommand('turn off grounding')).toEqual({ kind: 'toggle', id: 'grounding', on: false });
  });

  it('reports an unknown stage name instead of toggling', () => {
    expect(parseLoopCommand('disable teleportation')).toEqual({ kind: 'unknown', name: 'teleportation' });
  });

  it('treats anything without a toggle verb as a report request', () => {
    expect(parseLoopCommand("what's running?")).toEqual({ kind: 'report' });
  });

  it('lists stages as running, idle or disabled against the live running set', () => {
    const stages: StageMap = { ...DEFAULT_STAGES, opsApply: false };
    const report = loopReport(stages, ['opsMonitor']);
    expect(report.running).toContain('Monitor agent');
    expect(report.idle).toContain('Logging agent');
    expect(report.disabled).toEqual(['Apply agent']);
    expect(report.text).toContain('Running: Monitor agent');
    expect(report.text).toContain('Disabled: Apply agent');
    expect(report.text).toMatch(/\d+ stage\(s\) on and idle/);
  });

  it('reports "none" for running and disabled when every stage is on and idle', () => {
    const report = loopReport(DEFAULT_STAGES, []);
    expect(report.running).toEqual([]);
    expect(report.disabled).toEqual([]);
    expect(report.text).toContain('Running: none');
    expect(report.text).toContain('Disabled: none');
  });
});

describe('parseOpsTarget', () => {
  it('parsePlacement reads "bring to front"/"minimize" style tasks as aside', () => {
    expect(parsePlacement('bring Notepad to front')).toBe('aside');
    expect(parsePlacement('minimize the assist window')).toBe('aside');
    expect(parsePlacement('focus the target app')).toBe('aside');
  });

  it('parsePlacement reads "restore"/"bring it back" style tasks as back', () => {
    expect(parsePlacement('restore the assist window')).toBe('back');
    expect(parsePlacement('bring it back')).toBe('back');
    expect(parsePlacement('show assist')).toBe('back');
  });

  it('parsePlacement rejects junk, defaulting to a state report', () => {
    expect(parsePlacement('what is the window state?')).toBe('state');
    expect(parsePlacement('asdf qwer')).toBe('state');
    expect(parsePlacement('')).toBe('state');
  });

  it('parseOpsTarget reads "<agent>: <task>" (any case) as a direct command', () => {
    expect(parseOpsTarget('monitor: watch the login button')).toEqual({ agent: 'monitor', task: 'watch the login button' });
    expect(parseOpsTarget('APPLY: do the thing')).toEqual({ agent: 'apply', task: 'do the thing' });
  });

  it('parseOpsTarget treats an unknown agent prefix or a plain sentence as a goal', () => {
    expect(parseOpsTarget('foo: bar')).toEqual({ goal: 'foo: bar' });
    expect(parseOpsTarget('check the login flow')).toEqual({ goal: 'check the login flow' });
  });

  it('testTarget matches a candidate by exact name first', () => {
    const candidates: TestCandidate[] = [{ name: 'Send button', x: 0.5, y: 0.6, proposalId: 'p1' }];
    const hit = testTarget('Send Button', candidates);
    expect(hit).not.toBeNull();
    expect(hit!.step).toMatchObject({ action: 'click', target: 'Send button', x: 0.5, y: 0.6, status: 'pending' });
    expect(hit!.step.name).toContain('Send button');
    expect(hit!.proposalId).toBe('p1');
  });

  it('testTarget falls back to the first candidate the task text mentions', () => {
    const candidates: TestCandidate[] = [{ name: 'Save', x: 0.1, y: 0.1 }];
    const hit = testTarget('please click save now', candidates);
    expect(hit).not.toBeNull();
    expect(hit!.proposalId).toBe('');
  });

  it('testTarget is null when nothing matches', () => {
    expect(testTarget('do the thing', [{ name: 'Save', x: 0.1, y: 0.1 }])).toBeNull();
  });
});

describe('readOpsState', () => {
  it('every Operations agent has its own distinct loop-control stage', () => {
    expect(OPS_AGENTS).toHaveLength(9);
    const stageIds = OPS_AGENTS.map((a) => a.stage);
    expect(new Set(stageIds).size).toBe(9);
    for (const a of OPS_AGENTS) {
      const stage = STAGES.find((s) => s.id === a.stage);
      expect(stage?.group).toBe('operations');
    }
    expect(isOpsAgent('monitor')).toBe(true);
    expect(isOpsAgent('nonsense')).toBe(false);
    expect(opsAgent('apply').name).toBe('Apply agent');
    expect(enabledOps({ ...DEFAULT_STAGES, opsApply: false })).not.toContain('apply');
  });

  it('patchOpsAgent changes one agent and leaves the others untouched', () => {
    const next = patchOpsAgent(EMPTY_OPS, 'monitor', { status: 'working', task: 'watch the dialog' });
    expect(next.agents.find((a) => a.id === 'monitor')).toMatchObject({ status: 'working', task: 'watch the dialog' });
    expect(next.agents.find((a) => a.id === 'logging')).toEqual(EMPTY_OPS.agents.find((a) => a.id === 'logging'));
  });

  it('addOpsReport records the report newest-first and updates the agent\'s last report', () => {
    const next = addOpsReport(EMPTY_OPS, { agent: 'logging', task: 'summarize', ok: true, found: '3 entries', op: 'opA' }, 500);
    expect(next.reports).toHaveLength(1);
    expect(next.reports[0]).toMatchObject({ time: 500, agent: 'logging', found: '3 entries', op: 'opA' });
    expect(next.reports[0].id.startsWith('ops_')).toBe(true);
    expect(next.agents.find((a) => a.id === 'logging')?.lastReport).toBe('3 entries');
  });

  it('addEvidence records a frame pair newest-first with no verdict yet', () => {
    const next = addEvidence(EMPTY_OPS, { op: 'opA', step: 's1', action: 'click', x: 0.5, y: 0.5, beforeId: 1, afterId: 2, before: 'b', after: 'a' }, 700);
    expect(next.evidence).toHaveLength(1);
    expect(next.evidence[0]).toMatchObject({ time: 700, op: 'opA', verdict: null });
    expect(next.evidence[0].id.startsWith('ev_')).toBe(true);
  });

  it('opsFor cross-references an operation\'s reports, evidence and tagged log entries', () => {
    const withReport = addOpsReport(EMPTY_OPS, { agent: 'logging', task: 'x', ok: true, found: 'f', op: 'send the invoice email' });
    const withEvidence = addEvidence(withReport, { op: 'send invoice email now', step: 's', action: 'click', x: 0, y: 0, beforeId: null, afterId: null, before: null, after: null });
    const log = [entry('AI', 'did it', 'ok', { op: 'send the invoice' }), entry('AI', 'unrelated', 'info', { op: 'play a video' })];
    const result = opsFor('send the invoice email', withEvidence, log);
    expect(result.reports).toHaveLength(1);
    expect(result.evidence).toHaveLength(1);
    expect(result.log.map((l) => l.message)).toEqual(['did it']);
  });

  it('readOpsState returns the empty state for anything that is not an object', () => {
    expect(readOpsState(null)).toEqual(EMPTY_OPS);
    expect(readOpsState(undefined)).toEqual(EMPTY_OPS);
    expect(readOpsState('garbage')).toEqual(EMPTY_OPS);
    expect(readOpsState([1, 2, 3])).toEqual(EMPTY_OPS);
  });

  it('readOpsState drops malformed agents, reports and evidence but keeps the valid ones', () => {
    const raw = {
      agents: [{ id: 'monitor', status: 'bogus', task: 123, lastReport: null }, 'garbage', { id: 'logging', status: 'working', task: 'keep this', lastReport: 'ok' }],
      reports: [{ id: 'r1' }, { id: 'r2', time: 1, agent: 'monitor', task: 't', ok: true, found: 'f', op: 'o' }],
      evidence: [{ id: 'e1' }, { id: 'e2', time: 1, op: 'o', step: 's', action: 'click', x: 0, y: 0, beforeId: null, afterId: null, before: null, after: null, verdict: 'effect' }],
    };
    const state = readOpsState(raw);
    expect(state.agents.find((a) => a.id === 'monitor')).toEqual({ id: 'monitor', status: 'waiting', task: null, lastReport: null });
    expect(state.agents.find((a) => a.id === 'logging')).toEqual({ id: 'logging', status: 'waiting', task: 'keep this', lastReport: 'ok' });
    expect(state.reports).toEqual([raw.reports[1]]);
    expect(state.evidence).toEqual([raw.evidence[1]]);
  });

  it('round-trips a populated state through JSON, reverting an in-flight agent to waiting', () => {
    let state = patchOpsAgent(EMPTY_OPS, 'apply', { status: 'working', task: 'apply the click' });
    state = addOpsReport(state, { agent: 'recheck', task: 'compare frames', ok: true, found: 'effect seen', op: 'send the invoice' });
    state = addEvidence(state, { op: 'send the invoice', step: 's1', action: 'click', x: 0.2, y: 0.3, beforeId: 1, afterId: 2, before: 'b', after: 'a' });
    const roundTripped = readOpsState(JSON.parse(JSON.stringify(state)));
    expect(roundTripped.agents.find((a) => a.id === 'apply')).toEqual({ id: 'apply', status: 'waiting', task: 'apply the click', lastReport: null });
    expect(roundTripped.reports).toEqual(state.reports);
    expect(roundTripped.evidence).toEqual(state.evidence);
  });
});

describe('needsForeground', () => {
  it('is true for input actions with a visible effect and for move', () => {
    expect(needsForeground('click')).toBe(true);
    expect(needsForeground('move')).toBe(true);
  });

  it('is false for actions with no on-screen input', () => {
    expect(needsForeground('wait')).toBe(false);
  });
});
