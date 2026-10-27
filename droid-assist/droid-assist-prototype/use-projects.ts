import { useCallback, useEffect, useRef, useState } from 'react';
import type { GoalCheck } from './assist-ai.js';
import type { LogEntry, WorkflowStep } from './types.js';
import type { RunOutcome } from './triggers.js';
import { applyDecision, createProject, injectInfo, isFinished, toPlanned, transition, type InjectionSource, type Project } from './project.js';
import { decide, dropProject, enqueue, pendingFor, type ApprovalState, type Decided, type Decision } from './approval-queue.js';
import { STOPPED_NOTE, runProjectTurn, type PlanRequest, type TurnDeps } from './project-turn.js';
import { loadApprovalQueue, loadProjects, saveApprovalQueue, saveProjects } from './storage.js';

/** How often the project scheduler looks for a project whose turn is due. */
export const PROJECT_TICK_MS = 2000;
/** How long a project on hold rests before the scheduler restores its context and continues. */
export const HOLD_RETRY_MS = 30_000;

/** What the project engine takes from the assistant: its guardrails, planner, runner, goal check and learning stores. */
export interface ProjectEngineDeps {
  log: (message: string, tone?: LogEntry['tone']) => void;
  /** A guardrail or loop-control reason no project may run (abort, disarmed, stage off); null = go on. */
  halt: () => string | null;
  /** Another run or AI call holds the executor. */
  busy: () => boolean;
  plan: (req: PlanRequest) => Promise<WorkflowStep[]>;
  run: (p: Project, dryRun: boolean) => Promise<RunOutcome | null>;
  check: (p: Project) => Promise<GoalCheck>;
  /** Asks another AI (the live-screen AI) a research question for the project; resolves its answer. */
  research: (p: Project, question: string) => Promise<string>;
  /** Feeds an approval decision into the habits and learned patterns. */
  learn: (decided: Decided) => void;
  maxRetries: () => number;
}

/** Whether the scheduler may give the project a turn now; a project held by ■ Stop or the budget waits for Resume. */
export function isReady(p: Project, pendingApprovals: number, now: number): boolean {
  if (isFinished(p)) return false;
  if (p.state === 'waiting-for-reply' && pendingApprovals > 0) return false;
  if (p.state !== 'on-hold') return true;
  return !(p.history[0]?.note ?? '').startsWith(STOPPED_NOTE) && now - p.updatedAt >= HOLD_RETRY_MS;
}

/** Round robin: the ready project after `cursor` (wrapping), or null when none is ready. */
export function nextReady(projects: Project[], cursor: string | null, pending: (p: Project) => number, now: number): Project | null {
  const ready = projects.filter((p) => isReady(p, pending(p), now));
  if (!ready.length) return null;
  return ready[(ready.findIndex((p) => p.id === cursor) + 1) % ready.length];
}

/** A turn's update of a project, keeping the injections added while the turn ran. */
export function mergeUpdate(stored: Project, next: Project): Project {
  const late = stored.injections.filter((i) => !next.injections.some((n) => n.id === i.id));
  return late.length ? { ...next, injections: [...late, ...next.injections] } : next;
}

const TONE: Partial<Record<Project['state'], LogEntry['tone']>> = { complete: 'ok', failed: 'error', 'on-hold': 'warn', 'waiting-for-reply': 'warn' };

/**
 * The per-project lifecycle engine: persisted projects and approval queue, a round-robin
 * scheduler giving one project a turn at a time on the shared executor, and the panel's actions.
 */
export function useProjects(deps: ProjectEngineDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const [projects, setProjects] = useState<Project[]>(loadProjects);
  const [approvals, setApprovals] = useState<ApprovalState>(loadApprovalQueue);
  const [running, setRunning] = useState<string | null>(null);
  const projectsRef = useRef(projects);
  const approvalsRef = useRef(approvals);
  const runningRef = useRef<string | null>(null);
  const cursorRef = useRef<string | null>(null);
  useEffect(() => saveProjects(projects), [projects]);
  useEffect(() => saveApprovalQueue(approvals), [approvals]);

  const commitProjects = useCallback((next: Project[]) => {
    projectsRef.current = next;
    setProjects(next);
  }, []);
  const commitApprovals = useCallback((next: ApprovalState) => {
    approvalsRef.current = next;
    setApprovals(next);
  }, []);
  const patch = useCallback((id: string, fn: (p: Project) => Project) => commitProjects(projectsRef.current.map((p) => (p.id === id ? fn(p) : p))), [commitProjects]);
  const pending = (p: Project) => pendingFor(approvalsRef.current, p.id).length;
  const find = (id: string) => projectsRef.current.find((p) => p.id === id);

  /** Queues the steps outside the pre-approved bounds. */
  const gate = (p: Project, steps: Project['steps']) => {
    const { state, queued } = enqueue(approvalsRef.current, p.id, steps);
    if (!queued.length) return;
    commitApprovals(state);
    depsRef.current.log(`"${p.name}": ${queued.length} proposed command(s) wait for your approval`, 'warn');
  };

  const turnDeps = (): TurnDeps => {
    const d = depsRef.current;
    return {
      halt: d.halt,
      plan: async (req) => (await d.plan(req)).map(toPlanned),
      gate,
      pending,
      run: d.run,
      check: d.check,
      maxRetries: d.maxRetries(),
      update: (p) => patch(p.id, (stored) => mergeUpdate(stored, p)),
      refresh: (p) => mergeUpdate(find(p.id) ?? p, p),
    };
  };

  /** One scheduler round: the next ready project gets one turn, unless a guardrail or another run holds the executor. */
  const tick = async () => {
    const d = depsRef.current;
    if (runningRef.current || d.busy() || d.halt()) return;
    const p = nextReady(projectsRef.current, cursorRef.current, pending, Date.now());
    if (!p) return;
    cursorRef.current = p.id;
    runningRef.current = p.id;
    setRunning(p.id);
    try {
      const done = await runProjectTurn(p, turnDeps());
      d.log(`"${done.name}" → ${done.state}: ${done.history[0]?.note ?? ''}`, TONE[done.state] ?? 'info');
    } finally {
      runningRef.current = null;
      setRunning(null);
    }
  };
  const tickRef = useRef(tick);
  tickRef.current = tick;

  // Scheduler loop while any project is unfinished.
  const anyOpen = projects.some((p) => !isFinished(p));
  useEffect(() => {
    if (!anyOpen) return undefined;
    const id = setInterval(() => void tickRef.current(), PROJECT_TICK_MS);
    return () => clearInterval(id);
  }, [anyOpen]);

  const add = (name: string, goal: string) => {
    if (!goal.trim()) {
      depsRef.current.log('A project needs a goal', 'warn');
      return;
    }
    const p = createProject(name, goal);
    commitProjects([p, ...projectsRef.current]);
    depsRef.current.log(`Started project "${p.name}": ${p.goal}`, 'ok');
  };

  const remove = (id: string) => {
    commitProjects(projectsRef.current.filter((p) => p.id !== id));
    commitApprovals(dropProject(approvalsRef.current, id));
  };

  /** Logs info into the project; its next turn plans with it. */
  const inject = (id: string, source: InjectionSource, from: string, text: string) => {
    const p = find(id);
    if (!p || !text.trim()) return;
    patch(id, (x) => injectInfo(x, { source, from, text }));
    depsRef.current.log(`"${p.name}": ${from} (${source}) added info — ${text.trim()}`, 'info');
  };

  /** Info for the project whose turn is running right now (agents report mid-turn); ignored between turns. */
  const injectRunning = (source: InjectionSource, from: string, text: string) => {
    if (runningRef.current) inject(runningRef.current, source, from, text);
  };

  /** Asks the live-screen AI the question and injects its answer into the project as other-AI info. */
  const research = async (id: string, question: string) => {
    const p = find(id);
    if (!p || !question.trim()) return;
    try {
      inject(id, 'other-ai', 'screen AI', `${question.trim()} → ${await depsRef.current.research(p, question.trim())}`);
    } catch (error) {
      depsRef.current.log(`"${p.name}": research failed — ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  /** Applies approve/edit/reject to a queued command, updates its project's plan and learns from it. */
  const decideApproval = (requestId: string, decision: Decision) => {
    const request = approvalsRef.current.queue.find((r) => r.id === requestId);
    const out = request ? decide(approvalsRef.current, requestId, decision, find(request.projectId)?.goal ?? '') : null;
    if (!out) return;
    commitApprovals(out.state);
    patch(out.request.projectId, (p) => applyDecision(p, out.request.step.id, out.step));
    depsRef.current.learn(out);
    depsRef.current.log(out.pattern.pattern, out.step ? 'ok' : 'warn');
  };

  /** Restarts a failed or on-hold project from working, retries reset. */
  const resume = (id: string) => {
    const p = find(id);
    if (!p || (p.state !== 'failed' && p.state !== 'on-hold')) return;
    patch(id, (x) => transition({ ...x, retries: 0 }, 'working', 'Resumed by you'));
  };

  return { projects, approvals, running, add, remove, inject, injectRunning, research, decideApproval, resume };
}

/** The project engine's public surface, for the Projects panel. */
export type ProjectEngine = ReturnType<typeof useProjects>;
