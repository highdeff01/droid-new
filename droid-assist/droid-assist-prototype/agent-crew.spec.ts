import { describe, expect, it, vi } from 'vitest';
import { CREW_AGENTS, createScreenLock, decideCrew, parseCrewDecision, reportNote, runCrew, type CrewAgent, type CrewCommand, type CrewDecision, type CrewDeps, type CrewReport } from './agent-crew.js';

const decision = (commands: CrewCommand[], done = false, summary = ''): CrewDecision => ({ done, summary, commands, ignored: [], thinking: null });
const report = (c: CrewCommand, found = `found ${c.task}`): CrewReport => ({ agent: c.agent, task: c.task, ok: true, found });

function deps(over: Partial<CrewDeps>): CrewDeps & { snapshots: CrewAgent[][]; reports: CrewReport[] } {
  const snapshots: CrewAgent[][] = [];
  const reports: CrewReport[] = [];
  return {
    agents: CREW_AGENTS,
    maxRounds: 5,
    decide: async () => decision([], true),
    work: async (c) => report(c),
    shouldStop: () => false,
    onAgents: (a) => snapshots.push(a),
    onReport: (r) => reports.push(r),
    snapshots,
    reports,
    ...over,
  };
}

describe('parseCrewDecision', () => {
  it('keeps one command per known agent and lists the rest as ignored', () => {
    const out = parseCrewDecision({ done: false, summary: 's', commands: [{ agent: 'agent-2', task: 'find Save' }, { agent: 'agent-9', task: 'x' }, { agent: 'agent-2', task: 'again' }, { agent: 'agent-1', task: '  ' }] }, CREW_AGENTS);
    expect(out.commands).toEqual([{ agent: 'agent-2', task: 'find Save' }]);
    expect(out.ignored).toEqual(['agent-9', 'agent-2']);
    expect(out.done).toBe(false);
  });

  it('reads a missing commands list as no work', () => {
    expect(parseCrewDecision({ done: true }, CREW_AGENTS)).toEqual({ done: true, summary: '', commands: [], ignored: [] });
  });
});

describe('decideCrew', () => {
  it('sends the goal, roster and last reports to the main AI and parses its commands', async () => {
    const ask = vi.fn(async () => ({ content: '{"done":false,"summary":"split","commands":[{"agent":"agent-1","task":"find the Files icon"}]}', thinking: 't' }));
    const agents: CrewAgent[] = [{ id: 'agent-1', status: 'waiting', task: null, lastReport: 'saw a menu' }];
    const out = await decideCrew(ask, null, 'open files', agents, [{ agent: 'agent-1', task: 'look', ok: true, found: 'saw a menu' }]);
    expect(out).toMatchObject({ done: false, commands: [{ agent: 'agent-1', task: 'find the Files icon' }], thinking: 't' });
    const prompt = (ask.mock.calls[0] as unknown as [{ prompt: string; json: boolean }])[0];
    expect(prompt.json).toBe(true);
    expect(prompt.prompt).toMatch(/Goal: open files/);
    expect(prompt.prompt).toMatch(/agent-1 \(ok\) on "look": saw a menu/);
  });
});

describe('runCrew command loop', () => {
  it('assign → agents work in parallel → report → wait → the AI decides next with those reports', async () => {
    const seen: CrewReport[][] = [];
    let inFlight = 0;
    let peak = 0;
    const d = deps({
      decide: async (reports, round) => {
        seen.push(reports);
        return round === 1 ? decision([{ agent: 'agent-1', task: 'find A' }, { agent: 'agent-2', task: 'find B' }]) : round === 2 ? decision([{ agent: 'agent-3', task: 'click A' }]) : decision([], true, 'all done');
      },
      work: async (c) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return report(c);
      },
    });
    const out = await runCrew(d);
    expect(out).toMatchObject({ stop: 'done', rounds: 3, summary: 'all done' });
    expect(peak).toBe(2);
    expect(seen[0]).toEqual([]);
    expect(seen[1].map((r) => r.agent)).toEqual(['agent-1', 'agent-2']);
    expect(seen[2].map((r) => r.found)).toEqual(['found click A']);
    expect(d.reports.map((r) => r.task)).toEqual(['find A', 'find B', 'click A']);
    const working = d.snapshots.find((s) => s.some((a) => a.status === 'working'))!;
    expect(working.filter((a) => a.status === 'working').map((a) => a.id)).toEqual(['agent-1', 'agent-2']);
    const final = d.snapshots[d.snapshots.length - 1];
    expect(final.every((a) => a.status === 'waiting')).toBe(true);
    expect(final.find((a) => a.id === 'agent-3')).toMatchObject({ task: 'click A', lastReport: 'found click A' });
  });

  it('a failing agent reports its error and the loop goes on', async () => {
    const d = deps({ decide: async (_r, round) => (round === 1 ? decision([{ agent: 'agent-1', task: 'x' }]) : decision([], true)), work: async () => { throw new Error('bridge down'); } });
    const out = await runCrew(d);
    expect(out.reports).toEqual([{ agent: 'agent-1', task: 'x', ok: false, found: 'bridge down' }]);
    expect(out.stop).toBe('done');
  });

  it('stops at the round cap and when the AI assigns nothing', async () => {
    const capped = await runCrew(deps({ maxRounds: 2, decide: async () => decision([{ agent: 'agent-1', task: 'look' }]) }));
    expect(capped).toMatchObject({ stop: 'cap', rounds: 2 });
    const stalled = await runCrew(deps({ decide: async () => decision([], false, 'nothing to do') }));
    expect(stalled).toMatchObject({ stop: 'stalled', rounds: 1, summary: 'nothing to do' });
  });

  it('stop plan mid-round parks every agent and asks the AI nothing more', async () => {
    let stop = false;
    const decide = vi.fn(async () => decision([{ agent: 'agent-1', task: 'find A' }, { agent: 'agent-4', task: 'find D' }]));
    const d = deps({
      decide,
      shouldStop: () => stop,
      work: async (c) => {
        stop = true;
        return report(c);
      },
    });
    const out = await runCrew(d);
    expect(out.stop).toBe('stopped');
    expect(decide).toHaveBeenCalledTimes(1);
    expect(d.snapshots[d.snapshots.length - 1].every((a) => a.status === 'parked')).toBe(true);
  });

  it('a cancelled decision after stop ends as stopped, not as an error', async () => {
    let stop = false;
    const out = await runCrew(deps({ shouldStop: () => stop, decide: async () => { stop = true; throw new Error('cancelled'); } }));
    expect(out).toMatchObject({ stop: 'stopped', rounds: 0 });
  });
});

describe('crew helpers', () => {
  it('the screen lock runs real input one agent at a time, even after a failure', async () => {
    const lock = createScreenLock();
    const order: string[] = [];
    const job = (name: string, fail = false) => lock(async () => {
      order.push(`${name}:start`);
      await new Promise((r) => setTimeout(r, 3));
      order.push(`${name}:end`);
      if (fail) throw new Error(name);
      return name;
    });
    const results = await Promise.allSettled([job('a', true), job('b'), job('c')]);
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled', 'fulfilled']);
  });

  it('a report becomes a watcher note', () => {
    expect(reportNote({ agent: 'agent-2', task: 'find Save', ok: true, found: 'Save at top right' })).toEqual({ kind: 'element', text: 'Crew agent-2 (ok) on "find Save": Save at top right' });
    expect(reportNote({ agent: 'agent-2', task: 'x', ok: false, found: 'no' }).kind).toBe('unusual');
  });
});
