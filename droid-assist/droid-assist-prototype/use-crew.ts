import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionRecord, LogEntry, WorkflowStep } from './types.js';
import type { ForwardedElement } from './agent-bus.js';
import type { ActionBudget } from './safety.js';
import type { StepOutcome } from './run-step.js';
import type { Knowledge } from './cross-reference.js';
import {
  buildCrew, checkPath, command, locate, makeNotice, observe, offPositionText, pushNotice, reportBack, routeIntercept, resumeCrew,
  type CrewAgent, type CrewNotice, type CrewRole, type Intercept, type InterceptProposal, type NoticeKind,
} from './crew.js';
import { backtrackSteps, detectTestRequest, groundSuggestion, runCrewTest, safetyVote, testReport, type CrewTestResult, type PassResult, type TestRequest } from './crew-ops.js';

/** What the crew needs from the engine. */
export interface CrewDeps {
  crewSize: number;
  goal: string;
  steps: WorkflowStep[];
  history: ActionRecord[];
  addLog: (from: string, message: string, tone?: LogEntry['tone']) => void;
  performStep: (step: WorkflowStep, actor: string, budget: ActionBudget, dryRun: boolean) => Promise<StepOutcome>;
  newBudget: () => ActionBudget;
  isArmed: () => boolean;
  hasFrames: () => boolean;
  knowledge: () => Knowledge;
  stopRun: () => void;
}

/** The last intercept and what the crew proposed for it. */
export interface InterceptRecord {
  intercept: Intercept;
  proposal: InterceptProposal;
  time: number;
}

/** Most backtrack steps in one operation. */
export const BACKTRACK_MAX = 10;

type Target = { name: string; x: number; y: number };

const harmlessMove = (t: Target, id: string): WorkflowStep => ({ id, name: `Crew test: hover "${t.name}"`, action: 'move', x: t.x, y: t.y, target: t.name, status: 'pending' });

/**
 * The coordinated crew: a pooled roster of role-assigned workers the main AI commands. Each task
 * is assigned to one agent, which reports back and waits; every notice goes to the HUD and the log.
 */
export function useCrew(deps: CrewDeps) {
  const depsRef = useRef(deps);
  useEffect(() => {
    depsRef.current = deps;
  });
  const [crew, setCrewState] = useState<CrewAgent[]>(() => buildCrew(deps.crewSize));
  const crewRef = useRef(crew);
  const [notices, setNotices] = useState<CrewNotice[]>([]);
  const [lastIntercept, setLastIntercept] = useState<InterceptRecord | null>(null);
  const [pendingTests, setPendingTests] = useState<TestRequest[]>([]);
  const [testing, setTesting] = useState(false);
  const lastPathRef = useRef('');

  const setCrew = useCallback((next: CrewAgent[]) => {
    crewRef.current = next;
    setCrewState(next);
  }, []);

  useEffect(() => setCrew(buildCrew(deps.crewSize, crewRef.current)), [deps.crewSize, setCrew]);

  /** One info notification: shown in the HUD strip and written to the log, never silent. */
  const notify = useCallback((agentId: string, kind: NoticeKind, text: string, tone: LogEntry['tone'] = 'info') => {
    setNotices((list) => pushNotice(list, makeNotice(agentId, kind, text)));
    depsRef.current.addLog(`Crew · ${agentId}`, text, tone);
  }, []);

  /** The main AI commands `role`; the agent runs `work`, reports back and waits for the next command. */
  const runTask = useCallback(async (role: CrewRole, task: string, work: (agent: CrewAgent) => Promise<string> | string): Promise<string | null> => {
    const { crew: next, agent } = command(crewRef.current, role, task);
    if (!agent) return null;
    setCrew(next);
    try {
      const report = await work(agent);
      setCrew(reportBack(crewRef.current, agent.id, report));
      return report;
    } catch (error) {
      const report = `failed: ${error instanceof Error ? error.message : String(error)}`;
      setCrew(reportBack(crewRef.current, agent.id, report));
      return report;
    }
  }, [setCrew]);

  /** A forwarded or discovered element: its sentinel records it; a move is reported by a monitor. */
  const observeElement = useCallback((element: ForwardedElement) => {
    const { crew: next, sentinel, moved } = observe(crewRef.current, element);
    setCrew(next);
    if (!sentinel || !moved) return;
    notify(sentinel.id, 'off-position', offPositionText(element, moved));
    void runTask('monitor', `watch "${element.name}"`, (agent) => {
      const effect = `"${element.name}" moved — plans that target it use the new position`;
      notify(agent.id, 'change', effect);
      return effect;
    });
  }, [notify, runTask, setCrew]);

  /** Instant position query answered by the owning sentinel. */
  const locateElement = useCallback((name: string) => {
    const hit = locate(crewRef.current, name);
    if (!hit) notify('crew', 'off-position', `No sentinel holds "${name}" yet`);
    else notify(hit.agent.id, 'off-position', `"${hit.element.name}" last seen at ${(hit.element.x * 100).toFixed(1)}%, ${(hit.element.y * 100).toFixed(1)}%`);
    return hit?.element ?? null;
  }, [notify]);

  /** Queues a test request when `text` asks for one. */
  const detectTest = useCallback((from: string, text: string): TestRequest | null => {
    const req = detectTestRequest(from, text);
    if (!req) return null;
    setPendingTests((list) => [req, ...list].slice(0, 20));
    notify(from, 'test', `Test requested (${req.reason}): ${text}`);
    return req;
  }, [notify]);

  /** Path checkers compare progress with the plotted route whenever the steps change. */
  useEffect(() => {
    if (!deps.steps.length) return;
    const res = checkPath(deps.steps, deps.goal);
    if (res.onPath || res.reason === lastPathRef.current) {
      if (res.onPath) lastPathRef.current = '';
      return;
    }
    lastPathRef.current = res.reason;
    void runTask('pathChecker', 'check path', (agent) => {
      const text = `Off path: ${res.reason} (recommend ${res.advice})`;
      notify(agent.id, 'off-path', text);
      detectTest(agent.id, text);
      return text;
    });
  }, [deps.steps, deps.goal, runTask, notify, detectTest]);

  /** The point a test targets: the sentinel's last-known position, else the off-path step. */
  const testTarget = (req: TestRequest): Target | null => {
    const named = /"([^"]+)"/.exec(req.text)?.[1] ?? req.text.replace(/^test\s+/i, '').trim();
    const hit = named ? locate(crewRef.current, named) : null;
    if (hit) return hit.element;
    const { steps, goal } = depsRef.current;
    const i = checkPath(steps, goal).stepIndex;
    const s = steps[i >= 0 ? i : 0];
    return s ? { name: s.target ?? s.name, x: s.correctedX ?? s.x, y: s.correctedY ?? s.y } : null;
  };

  /** Main-screen pass: the adjusted point is cleared by a multi-agent safety vote, then hovered (dry run unless armed). */
  const mainPass = async (step: WorkflowStep, actor: string): Promise<PassResult> => {
    const d = depsRef.current;
    const vote = safetyVote(step, d.history, crewRef.current.filter((a) => a.role === 'sentinel'));
    if (!vote.ok) return { ok: false, detail: `vetoed — ${vote.votes.filter((v) => !v.ok).map((v) => `${v.agentId}: ${v.reason}`).join('; ')}` };
    const out = await d.performStep(step, actor, d.newBudget(), !d.isArmed());
    return { ok: out.ok, detail: out.message };
  };

  /** Runs one test request: background (dry run on the captured frame) first, then the main screen; the result goes back to the requester. */
  const runTest = useCallback(async (req: TestRequest): Promise<CrewTestResult | null> => {
    const target = testTarget(req);
    if (!target) {
      notify('crew', 'test', `Cannot test "${req.text}" — no target position known`, 'warn');
      return null;
    }
    setPendingTests((list) => list.filter((r) => r !== req));
    setTesting(true);
    let result: CrewTestResult | null = null;
    try {
      await runTask('tester', `test "${target.name}" for ${req.from}`, async (agent) => {
        const actor = `Crew test ${agent.id}`;
        let adjusted = harmlessMove(target, `crew-test-${agent.id}`);
        const background = async (): Promise<PassResult> => {
          const d = depsRef.current;
          if (!d.hasFrames()) return { ok: false, detail: 'no captured frames to test against' };
          const out = await d.performStep(adjusted, actor, d.newBudget(), true);
          adjusted = { ...adjusted, x: out.target.x, y: out.target.y };
          return { ok: out.ok, detail: out.message };
        };
        result = await runCrewTest(background, () => mainPass(adjusted, actor));
        const grounding = groundSuggestion(target.name, adjusted, depsRef.current.knowledge());
        const report = `${testReport(req, result)} · history: ${grounding.text}${result.passed ? '' : ' · follow-up: main AI re-plans this step'}`;
        notify(agent.id, 'test', report, result.passed ? 'ok' : 'warn');
        if (crewRef.current.some((a) => a.id === req.from)) setCrew(crewRef.current.map((a) => (a.id === req.from ? { ...a, report } : a)));
        return report;
      });
    } finally {
      setTesting(false);
    }
    return result;
  }, [notify, runTask, setCrew]);

  /** An intercept from the bridge, an agent, another app or the main AI: working agents pause, factor it in and propose. */
  const intercept = useCallback((i: Intercept): InterceptProposal => {
    const { crew: paused, proposal, paused: count } = routeIntercept(crewRef.current, i);
    setCrew(paused);
    setLastIntercept({ intercept: i, proposal, time: Date.now() });
    const where = typeof i.x === 'number' && typeof i.y === 'number' ? ` (to ${(i.x * 100).toFixed(1)}%, ${(i.y * 100).toFixed(1)}%)` : '';
    notify('crew', 'intercept', `Intercept from ${i.source}: "${i.text}" — ${count} agent(s) paused; proposal: ${proposal}${where}`, proposal === 'stop' ? 'warn' : 'info');
    detectTest(i.source, i.text);
    if (proposal === 'stop') {
      depsRef.current.stopRun();
      setCrew(crewRef.current.map((a) => (a.status === 'paused' ? { ...a, status: 'waiting', task: undefined, report: 'stopped by intercept' } : a)));
    } else setCrew(resumeCrew(crewRef.current));
    return proposal;
  }, [detectTest, notify, setCrew]);

  /** Moves the cursor back along the recent path (last N actions, newest first); each step is cleared by the crew first. */
  const backtrack = useCallback(async (n: number) => {
    const d = depsRef.current;
    const plan = backtrackSteps(d.history, Math.min(BACKTRACK_MAX, n));
    if (!plan.length) return notify('crew', 'backtrack', 'Nothing to backtrack — no recent actions with a known screen size', 'warn');
    await runTask('adjuster', `backtrack ${plan.length} step(s)`, async (agent) => {
      const budget = d.newBudget();
      const voters = crewRef.current.filter((a) => a.role === 'sentinel');
      let done = 0;
      for (const step of plan) {
        const vote = safetyVote(step, d.history, voters);
        if (!vote.ok) {
          notify(agent.id, 'safety', `Backtrack halted at ${step.name}: ${vote.votes.filter((v) => !v.ok).map((v) => v.reason).join('; ')}`, 'warn');
          break;
        }
        const out = await d.performStep(step, `Crew backtrack ${agent.id}`, budget, !d.isArmed());
        if (!out.ok) {
          notify(agent.id, 'backtrack', `Backtrack stopped at ${step.name}: ${out.message}`, 'warn');
          break;
        }
        done++;
      }
      const text = `Backtracked ${done}/${plan.length} step(s)${d.isArmed() ? '' : ' (dry run)'}`;
      notify(agent.id, 'backtrack', text, done === plan.length ? 'ok' : 'warn');
      return text;
    });
  }, [notify, runTask]);

  return { crew, notices, lastIntercept, pendingTests, testing, observeElement, locateElement, detectTest, runTest, intercept, backtrack };
}
