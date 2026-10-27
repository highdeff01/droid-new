import type { GoalCheck } from './assist-ai.js';
import type { RunOutcome } from './triggers.js';
import { ALT_METHOD_LIMIT, PROJECT_TURN_LIMIT, completionCheck, consumeInjections, injectInfo, recordCheck, transition, type PlannedStep, type Project, type ProjectState } from './project.js';

/** History notes replayed into planning so a resumed project restores its context. */
export const CONTEXT_NOTES = 4;

/** What the planner is asked for one project. */
export interface PlanRequest {
  goal: string;
  /** Injected info, earlier notes of the project and its latest goal check. */
  context: string[];
  /** Why a re-plan is needed (the failure, or the alternative method to try); null for a fresh plan. */
  why: string | null;
  steps: PlannedStep[];
}

/** What one project turn drives; the engine supplies each from its existing machinery. */
export interface TurnDeps {
  /** A guardrail or loop-control reason to stop (abort, disarmed, kill-switch, budget, stage off); null = go on. */
  halt: () => string | null;
  plan: (req: PlanRequest) => Promise<PlannedStep[]>;
  /** Queues the steps outside the pre-approved bounds. */
  gate: (p: Project, steps: PlannedStep[]) => void;
  /** Commands of the project still waiting for approval. */
  pending: (p: Project) => number;
  /** Runs the project's steps: a dry-run self-test, or real input through the retry ladder. */
  run: (p: Project, dryRun: boolean) => Promise<RunOutcome | null>;
  check: (p: Project) => Promise<GoalCheck>;
  /** Project-level retries before an alternative method is tried. */
  maxRetries: number;
  /** Every transition, as it happens. */
  update: (p: Project) => void;
}

type Step = { project: Project; end?: boolean };
type Handler = (p: Project, deps: TurnDeps) => Promise<Step>;

const move = (p: Project, to: ProjectState, note: string, deps: TurnDeps, patch: Partial<Project> = {}): Project => {
  const next = transition({ ...p, ...patch }, to, note);
  deps.update(next);
  return next;
};

const passed = (o: RunOutcome | null) => !!o && o.total > 0 && o.ok === o.total && !o.stopped;
const runText = (o: RunOutcome | null, label: string) => (o ? `${label}: ${o.ok}/${o.total} step(s) verified${o.stopped ? ' (stopped)' : ''}` : `${label} refused before any step ran`);
const lastNote = (p: Project) => p.history[0]?.note ?? '';
const altsThisTurn = (p: Project) => p.altMethods.filter((a) => a.turn === p.turn).length;

/** The planning context of a turn: injections, the project's recent notes (restored after a wait) and its latest goal check. */
function contextOf(p: Project, injected: Project['injections']): string[] {
  const check = p.record.checks[0];
  return [
    ...injected.map((i) => `[Injected by ${i.from} (${i.source})] ${i.text}`),
    ...p.history.slice(0, CONTEXT_NOTES).reverse().map((h) => `[Earlier, turn ${h.turn}: ${h.from} → ${h.to}] ${h.note}`),
    ...(check ? [`[Last goal check] ${check.complete ? 'complete' : 'not complete'} — ${check.reason}`] : []),
  ];
}

/** Plans (fresh or corrected), queues what needs approval and moves to waiting, testing (`next`) or `empty`. */
async function planAndGate(p: Project, deps: TurnDeps, why: string | null, next: ProjectState, empty: ProjectState): Promise<Step> {
  const { project, injected } = consumeInjections(p);
  const steps = await deps.plan({ goal: project.goal, context: contextOf(project, injected), why, steps: project.steps });
  if (!steps.length) return { project: move(project, empty, why ? 'The planner proposed no correction' : 'The planner proposed no steps — checking the goal', deps) };
  const planned = { ...project, steps };
  deps.gate(planned, steps);
  const waiting = deps.pending(planned);
  if (waiting) return { project: move(planned, 'waiting-for-reply', `${waiting} proposed command(s) wait for approval`, deps), end: true };
  return { project: move(planned, next, `Planned ${steps.length} step(s)`, deps) };
}

/** A dry-run self-test of the steps, then replying with its result. */
async function test(p: Project, deps: TurnDeps, label: string): Promise<Step> {
  const out = await deps.run(p, true);
  return { project: move(p, 'replying', runText(out, label), deps, { lastRun: out ? { ok: out.ok, total: out.total } : { ok: 0, total: p.steps.length } }) };
}

/** Real input through the retry ladder: follow-up when every step verified, else retrying. */
async function act(p: Project, deps: TurnDeps): Promise<Step> {
  const out = await deps.run(p, false);
  const lastRun = out ? { ok: out.ok, total: out.total } : { ok: 0, total: p.steps.length };
  return { project: move(p, passed(out) ? 'follow-up' : 'retrying', runText(out, 'Run'), deps, { lastRun }) };
}

/** Retry within the budget, then an alternative method, then terminal failure. */
async function retry(p: Project, deps: TurnDeps): Promise<Step> {
  const why = lastNote(p);
  if (p.retries < deps.maxRetries) return { project: move(p, 'correcting', `Retry ${p.retries + 1}/${deps.maxRetries} — ${why}`, deps, { retries: p.retries + 1 }) };
  const alts = altsThisTurn(p);
  if (alts >= ALT_METHOD_LIMIT) return { project: move(p, 'failed', `Retries (${deps.maxRetries}) and alternative methods (${ALT_METHOD_LIMIT}) exhausted — ${why}`, deps), end: true };
  const method = `Alternative method ${alts + 1}: the previous approach failed (${why}); use a different approach to reach the goal`;
  return { project: move(p, 'correcting', method, deps, { retries: 0, altMethods: [{ method, turn: p.turn, time: Date.now() }, ...p.altMethods] }) };
}

/** The goal check after a run: complete when nothing is left to do, else the next turn (or failure at the turn cap). */
async function followUp(p: Project, deps: TurnDeps): Promise<Step> {
  const check = await deps.check(p);
  const checked = recordCheck({ ...p, turn: p.turn + 1 }, check);
  const done = completionCheck(checked, check, deps.pending(checked));
  if (done.done) return { project: move(checked, 'complete', done.reason, deps), end: true };
  const fed = check.complete ? checked : injectInfo(checked, { source: 'main-ai', from: 'goal check', text: check.reason });
  if (fed.turn >= PROJECT_TURN_LIMIT) return { project: move(fed, 'failed', `${PROJECT_TURN_LIMIT} turns without completing — ${done.reason}`, deps), end: true };
  return { project: move(fed, 'working', done.reason, deps, { retries: 0 }), end: true };
}

/** What each active state does in a turn. */
const HANDLERS: Partial<Record<ProjectState, Handler>> = {
  'on-hold': async (p, deps) => ({ project: move(p, 'working', `Context restored — ${lastNote(p)}`, deps) }),
  working: (p, deps) => planAndGate(p, deps, null, 'testing', 'follow-up'),
  'waiting-for-reply': async (p, deps) => {
    if (deps.pending(p)) return { project: p, end: true };
    return { project: move(p, p.steps.length ? 'testing' : 'working', p.steps.length ? 'Approvals decided' : 'Every proposed command was rejected', deps) };
  },
  testing: (p, deps) => test(p, deps, 'Self-test'),
  retesting: (p, deps) => test(p, deps, 'Re-test'),
  replying: async (p, deps) => {
    const ok = !!p.lastRun && p.lastRun.total > 0 && p.lastRun.ok === p.lastRun.total;
    return { project: move(p, ok ? 'verifying' : 'retrying', ok ? 'Test passed' : `Test failed — ${lastNote(p)}`, deps) };
  },
  retrying: retry,
  correcting: (p, deps) => planAndGate(p, deps, lastNote(p), 'retesting', 'retrying'),
  verifying: async (p, deps) => ({ project: move(p, 'acting', 'Guardrails clear', deps) }),
  acting: act,
  'follow-up': followUp,
};

/**
 * One turn of a project's lifecycle: from its current state through plan → approval → test →
 * reply → retry/correct/retest → verify → act → follow-up, until the goal check (complete, next
 * turn or failure), a wait for approval, or a guardrail stop (on hold, never failed). A failing
 * dependency puts the project on hold with the error.
 */
export async function runProjectTurn(project: Project, deps: TurnDeps): Promise<Project> {
  let p = project;
  for (;;) {
    const handler = HANDLERS[p.state];
    if (!handler) return p;
    const stop = deps.halt();
    if (stop) return p.state === 'on-hold' ? p : move(p, 'on-hold', stop, deps);
    try {
      const next = await handler(p, deps);
      p = next.project;
      if (next.end) return p;
    } catch (error) {
      return move(p, 'on-hold', `Stopped: ${error instanceof Error ? error.message : String(error)}`, deps);
    }
  }
}
