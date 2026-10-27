import { describe, expect, it } from 'vitest';
import {
  buildCrew,
  checkPath,
  clampCrewSize,
  command,
  CREW_ROLE_IDS,
  type CrewAgent,
  type CrewNotice,
  locate,
  makeNotice,
  NOTICE_LIMIT,
  observe,
  OFF_POSITION,
  offPositionText,
  parseIntercept,
  proposeIntercept,
  pushNotice,
  reassign,
  reportBack,
  roleCounts,
  routeIntercept,
  resumeCrew,
} from './crew.js';
import type { ForwardedElement } from './agent-bus.js';
import type { WorkflowStep } from './types.js';

const files: ForwardedElement = { name: 'Files icon', x: 0.1, y: 0.9 };

const makeStep = (over: Partial<WorkflowStep> = {}): WorkflowStep => ({
  id: 's1', name: 'Step', action: 'click', x: 0.5, y: 0.5, status: 'pending', ...over,
});

describe('clampCrewSize', () => {
  it('defaults to 25 when given NaN', () => {
    expect(clampCrewSize(NaN)).toBe(25);
  });

  it('defaults to 25 when given a non-number', () => {
    expect(clampCrewSize('25' as unknown)).toBe(25);
    expect(clampCrewSize(undefined)).toBe(25);
  });

  it('clamps below the minimum up to 5', () => {
    expect(clampCrewSize(1)).toBe(5);
  });

  it('clamps above the maximum down to 50', () => {
    expect(clampCrewSize(200)).toBe(50);
  });

  it('rounds non-integer values', () => {
    expect(clampCrewSize(24.6)).toBe(25);
  });
});

describe('roleCounts', () => {
  it('sums to size and every role has at least 1 seat', () => {
    const counts = roleCounts(17);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(17);
    CREW_ROLE_IDS.forEach((r) => expect(counts[r]).toBeGreaterThanOrEqual(1));
  });

  it('gives one seat per role at size 5', () => {
    const counts = roleCounts(5);
    CREW_ROLE_IDS.forEach((r) => expect(counts[r]).toBe(1));
  });

  it('sums correctly at size 25, with sentinel holding the most seats', () => {
    const counts = roleCounts(25);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(25);
    const max = Math.max(...Object.values(counts));
    expect(counts.sentinel).toBe(max);
  });

  it('sums correctly at size 50, with sentinel holding the most seats', () => {
    const counts = roleCounts(50);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(50);
    const max = Math.max(...Object.values(counts));
    expect(counts.sentinel).toBe(max);
  });
});

describe('buildCrew', () => {
  it('builds one agent per seat, waiting with no elements', () => {
    const crew = buildCrew(5);
    expect(crew).toHaveLength(5);
    expect(crew.every((a) => a.status === 'waiting' && a.elements.length === 0)).toBe(true);
    expect(crew.map((a) => a.id)).toEqual(['sentinel-1', 'pathChecker-1', 'adjuster-1', 'tester-1', 'monitor-1']);
  });

  it('keeps the prior state of an agent with a matching id', () => {
    const prev: CrewAgent[] = [{ id: 'sentinel-1', role: 'sentinel', status: 'working', task: 'patrol', elements: [files] }];
    const crew = buildCrew(5, prev);
    expect(crew.find((a) => a.id === 'sentinel-1')).toEqual(prev[0]);
    expect(crew.find((a) => a.id === 'tester-1')).toMatchObject({ status: 'waiting', elements: [] });
  });
});

describe('command', () => {
  it('picks a waiting agent of the role and sets it working with the task', () => {
    const crew = buildCrew(25);
    const { crew: next, agent } = command(crew, 'tester', 'run test');
    expect(agent).toMatchObject({ role: 'tester', status: 'working', task: 'run test' });
    expect(next.find((a) => a.id === agent?.id)).toEqual(agent);
  });

  it('returns null without changing the crew when the role has no seats', () => {
    const crew = buildCrew(5).filter((a) => a.role !== 'tester');
    const { crew: next, agent } = command(crew, 'tester', 'run test');
    expect(agent).toBeNull();
    expect(next).toEqual(crew);
  });

  it('reportBack returns the agent to waiting with the report and no task', () => {
    const crew = buildCrew(25);
    const { crew: working, agent } = command(crew, 'tester', 'run test');
    const next = reportBack(working, agent!.id, 'done');
    const reported = next.find((a) => a.id === agent!.id);
    expect(reported).toMatchObject({ status: 'waiting', report: 'done' });
    expect(reported?.task).toBeUndefined();
  });

  it('reassign changes the role and clears elements when leaving sentinel', () => {
    const crew = buildCrew(5);
    const { crew: withElement } = observe(crew, files);
    const next = reassign(withElement, 'sentinel-1', 'tester');
    const reassigned = next.find((a) => a.id === 'sentinel-1');
    expect(reassigned).toMatchObject({ role: 'tester', elements: [] });
  });
});

describe('observe', () => {
  it('stores the element in the owning sentinel with no moved result for a new sighting', () => {
    const crew = buildCrew(5);
    const { crew: next, sentinel, moved } = observe(crew, files);
    expect(moved).toBeNull();
    expect(sentinel?.elements[0]).toEqual(files);
    expect(next.find((a) => a.id === sentinel?.id)?.elements[0]).toEqual(files);
  });

  it('does not report moved when the new sighting is within OFF_POSITION', () => {
    const crew = buildCrew(5);
    const { crew: seen } = observe(crew, files);
    const { moved } = observe(seen, { ...files, x: files.x + OFF_POSITION / 2 });
    expect(moved).toBeNull();
  });

  it('reports the previous position as moved when it shifted more than OFF_POSITION', () => {
    const crew = buildCrew(5);
    const { crew: seen } = observe(crew, files);
    const { moved } = observe(seen, { ...files, x: files.x + OFF_POSITION * 2 });
    expect(moved).toEqual(files);
  });

  it('locate returns the sentinel and its last-known element', () => {
    const crew = buildCrew(5);
    const { crew: seen } = observe(crew, files);
    const found = locate(seen, files.name);
    expect(found?.element).toEqual(files);
    expect(found?.agent.role).toBe('sentinel');
  });

  it('locate returns null for an unknown name', () => {
    const crew = buildCrew(5);
    expect(locate(crew, 'Nothing here')).toBeNull();
  });
});

describe('checkPath', () => {
  it('recommends adjust when a step drifted', () => {
    const steps = [makeStep({ status: 'done' }), makeStep({ id: 's2', status: 'drift' })];
    const r = checkPath(steps);
    expect(r).toMatchObject({ onPath: false, advice: 'adjust', stepIndex: 1 });
  });

  it('recommends retry on one failed click', () => {
    const steps = [makeStep({ action: 'click', status: 'failed' })];
    const r = checkPath(steps);
    expect(r).toMatchObject({ onPath: false, advice: 'retry' });
  });

  it('recommends alt when two steps failed and the first is not skippable', () => {
    const steps = [makeStep({ id: 's1', action: 'click', status: 'failed' }), makeStep({ id: 's2', action: 'type', status: 'failed' })];
    const r = checkPath(steps);
    expect(r).toMatchObject({ onPath: false, advice: 'alt' });
  });

  it('recommends skip when a failed move/wait/scroll step is not needed', () => {
    for (const action of ['move', 'wait', 'scroll'] as const) {
      const r = checkPath([makeStep({ action, status: 'failed' })]);
      expect(r).toMatchObject({ onPath: false, advice: 'skip' });
    }
  });

  it('recommends retry when a pending step was passed over before a done step', () => {
    const steps = [makeStep({ id: 's1', status: 'pending' }), makeStep({ id: 's2', status: 'done' })];
    const r = checkPath(steps);
    expect(r).toMatchObject({ onPath: false, advice: 'retry', stepIndex: 0 });
  });

  it('is on path and recommends continue when everything is in order', () => {
    const steps = [makeStep({ id: 's1', status: 'done' }), makeStep({ id: 's2', status: 'pending' })];
    const r = checkPath(steps);
    expect(r).toMatchObject({ onPath: true, advice: 'continue' });
  });
});

describe('pushNotice', () => {
  it('makeNotice fills in a new notice', () => {
    const n = makeNotice('sentinel-1', 'off-position', 'moved', 123);
    expect(n).toMatchObject({ agentId: 'sentinel-1', kind: 'off-position', text: 'moved', time: 123 });
    expect(n.id).toBeTruthy();
  });

  it('keeps the newest notices first, capped at NOTICE_LIMIT', () => {
    let list: CrewNotice[] = [];
    for (let i = 0; i < NOTICE_LIMIT + 10; i++) list = pushNotice(list, makeNotice('a', 'change', `n${i}`, i));
    expect(list).toHaveLength(NOTICE_LIMIT);
    expect(list[0].text).toBe(`n${NOTICE_LIMIT + 9}`);
  });

  it('offPositionText mentions the element name', () => {
    const text = offPositionText({ ...files, x: 0.2, y: 0.3 }, files);
    expect(text).toContain(files.name);
  });
});

describe('routeIntercept', () => {
  it('proposes stop for stop/abort/cancel wording', () => {
    for (const text of ['please stop', 'abort now', 'cancel it']) {
      expect(proposeIntercept({ source: 'ai', text })).toBe('stop');
    }
  });

  it('proposes skip for skip wording', () => {
    expect(proposeIntercept({ source: 'ai', text: 'just skip it' })).toBe('skip');
  });

  it('proposes alt for alternate wording', () => {
    for (const text of ['try an alternative', 'instead do this', 'try another way']) {
      expect(proposeIntercept({ source: 'ai', text })).toBe('alt');
    }
  });

  it('proposes reroute for a carried point', () => {
    expect(proposeIntercept({ source: 'bridge', text: 'moved here', x: 0.4, y: 0.5 })).toBe('reroute');
  });

  it('proposes apply for anything else', () => {
    expect(proposeIntercept({ source: 'ai', text: 'go ahead' })).toBe('apply');
  });

  it('pauses only working agents and reports the paused count', () => {
    const crew = buildCrew(5);
    const { crew: working } = command(crew, 'tester', 'run test');
    const { crew: paused, paused: count } = routeIntercept(working, { source: 'ai', text: 'hold on' });
    expect(count).toBe(1);
    expect(paused.filter((a) => a.status === 'paused')).toHaveLength(1);
    expect(paused.filter((a) => a.status === 'waiting')).toHaveLength(4);
  });

  it('resumeCrew returns paused agents to working', () => {
    const crew = buildCrew(5);
    const { crew: working } = command(crew, 'tester', 'run test');
    const { crew: paused } = routeIntercept(working, { source: 'ai', text: 'hold on' });
    const resumed = resumeCrew(paused);
    expect(resumed.find((a) => a.role === 'tester')).toMatchObject({ status: 'working' });
  });
});

describe('parseIntercept', () => {
  it('parses a sourced intercept with a percentage point', () => {
    expect(parseIntercept('bridge: popup appeared at 40%,50%')).toEqual({ source: 'bridge', text: 'popup appeared', x: 0.4, y: 0.5 });
  });

  it('defaults to source ai for plain text with no point', () => {
    expect(parseIntercept('need confirmation')).toEqual({ source: 'ai', text: 'need confirmation' });
  });
});
