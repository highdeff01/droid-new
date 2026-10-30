import type { LogEntry, WorkflowStep } from './types.js';
import type { AgentVotePayload, InboundMessage, OutboundPayloads, OutboundType, ResultPayload, RunScriptPayload, TakeoverRequestPayload } from './main-bridge-protocol.js';

/**
 * Droid-main takeover protocol. Droid-new is the boss and both apps share admin status. When a run
 * starts, its first step has FIRST_STEP_MS to verify complete; if it does not, the step is handed to
 * droid-main over the bridge with its full context (goal, step, screenshots, what was tried, why it
 * failed) so droid-main continues rather than restarts. Droid-main may also detect an incomplete step
 * itself and claim it. Every handoff and result is logged and told to the AI. A step is complete only
 * when droid-new's verification passes AND droid-new's agents agree AND droid-main's agents agree.
 */

/** How long the first step of a run has to verify complete before it is handed to droid-main. */
export const FIRST_STEP_MS = 10_000;
/** Most screenshots sent with one handoff. */
export const HANDOFF_SHOTS = 4;
/** How long droid-new waits for droid-main's agents to vote on a step. */
export const VOTE_WAIT_MS = 5_000;

/** What droid-new knows about a step when it hands it over. */
export interface StepContext {
  /** JPEG data URLs of the step's latest screens, oldest first. */
  screenshots: string[];
  /** One line per attempt made on the step. */
  tried: string[];
}

/** The three verdicts a step needs; undefined while one is still awaited. */
export interface StepVotes {
  verified?: boolean;
  newAgents?: boolean;
  mainAgents?: boolean;
}

/** Whether a step is complete, pending or failed, and why. */
export interface Completion {
  state: 'complete' | 'pending' | 'failed';
  why: string;
}

/** What the controller needs from its host. */
export interface TakeoverDeps {
  /** Sends one command to droid-main over the bridge. */
  send: <K extends OutboundType>(type: K, payload: OutboundPayloads[K]) => Promise<ResultPayload>;
  /** Whether droid-main is connected right now. */
  connected: () => boolean;
  /** The context of step `index` at handoff time. */
  context: (index: number) => StepContext;
  /** Tells droid-new's AI (and its agents) what happened. */
  tellAi: (note: string) => void;
  log: (message: string, tone: LogEntry['tone']) => void;
  /** Called when a step's completion settles (complete or failed). */
  onSettled?: (index: number, completion: Completion) => void;
  firstStepMs?: number;
  voteWaitMs?: number;
}

/** A step as the run_script payload droid-main performs. */
export function wireStep(step: WorkflowStep): RunScriptPayload {
  const { name, action, x, y, endX, endY, text, target } = step;
  return { name, action, x: step.correctedX ?? x, y: step.correctedY ?? y, ...(endX !== undefined ? { endX } : {}), ...(endY !== undefined ? { endY } : {}), ...(text !== undefined ? { text } : {}), ...(target !== undefined ? { target } : {}) };
}

/** The full-context handoff of step `index`: droid-main resumes there with every remaining step. */
export function handoffPayload(runId: string, goal: string, steps: WorkflowStep[], index: number, reason: string, ctx: StepContext): TakeoverRequestPayload {
  const step = wireStep(steps[index]);
  const tried = ctx.tried.length ? ctx.tried : ['no attempt completed yet'];
  const note = `Droid-new hands step ${index + 1}/${steps.length} "${step.name}" of goal "${goal}" to droid-main — ${reason}. Tried: ${tried.join(' | ')}. Continue from this step; do not restart the run.`;
  return { runId, goal, stepIndex: index, step, remaining: steps.slice(index).map(wireStep), screenshots: ctx.screenshots.slice(-HANDOFF_SHOTS), tried, reason, note };
}

/**
 * A step's completion: droid-new's verification AND both sides' agents. With droid-main disconnected
 * its vote is unavailable and completion rests on droid-new's verification and agents (stated in `why`).
 */
export function stepCompletion(v: StepVotes, mainAvailable: boolean): Completion {
  const required: Array<[string, boolean | undefined]> = [['droid-new verification', v.verified], ['droid-new agents', v.newAgents]];
  if (mainAvailable) required.push(['droid-main agents', v.mainAgents]);
  const no = required.find(([, ok]) => ok === false);
  if (no) return { state: 'failed', why: `${no[0]} disagreed` };
  const waiting = required.filter(([, ok]) => ok === undefined).map(([who]) => who);
  if (waiting.length) return { state: 'pending', why: `waiting for ${waiting.join(', ')}` };
  return { state: 'complete', why: mainAvailable ? 'verified and both sides agree' : 'verified and droid-new agents agree (droid-main unavailable)' };
}

/** Whether a step started at `startedAt` and not yet verified has run past `limitMs` (droid-main's own detection uses the same rule). */
export const detectStalledStep = (startedAt: number, now: number, verified: boolean, limitMs: number = FIRST_STEP_MS) => !verified && now - startedAt >= limitMs;

let runSeq = 0;

/** The takeover controller of droid-new: one run at a time. */
export function createTakeover(deps: TakeoverDeps) {
  let run: { id: string; goal: string; steps: WorkflowStep[] } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const handed = new Set<number>();
  const votes = new Map<number, StepVotes>();
  const settled = new Set<number>();
  /** The step droid-main accepted: it continues the run from there, so droid-new stops acting. */
  let accepted: number | null = null;
  const completed = (index: number) => stepCompletion(votes.get(index) ?? {}, deps.connected()).state === 'complete';
  /** Callers awaiting a step's settled completion. */
  const waiters = new Map<number, (c: Completion) => void>();

  const disarm = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const note = (message: string, tone: LogEntry['tone']) => {
    deps.log(message, tone);
    deps.tellAi(message);
  };

  /** Records one verdict and settles the step once its completion is no longer pending. */
  const vote = (index: number, change: StepVotes) => {
    const next = { ...votes.get(index), ...change };
    votes.set(index, next);
    const c = stepCompletion(next, deps.connected());
    if (c.state === 'pending' || settled.has(index)) return c;
    settled.add(index);
    note(`Step ${index + 1} ${c.state} — ${c.why}`, c.state === 'complete' ? 'ok' : 'warn');
    deps.onSettled?.(index, c);
    waiters.get(index)?.(c);
    waiters.delete(index);
    return c;
  };

  /** Resolves once step `index` settles; droid-main's agents get VOTE_WAIT_MS to vote, after which their silence counts as disagreement. */
  const awaitCompletion = (index: number): Promise<Completion> => {
    const now = stepCompletion(votes.get(index) ?? {}, deps.connected());
    if (now.state !== 'pending') return Promise.resolve(now);
    return new Promise((resolve) => {
      const limit = deps.voteWaitMs ?? VOTE_WAIT_MS;
      const t = setTimeout(() => {
        deps.log(`Droid-main's agents did not vote on step ${index + 1} within ${limit / 1000} s`, 'warn');
        vote(index, { mainAgents: false });
      }, limit);
      waiters.set(index, (c) => {
        clearTimeout(t);
        resolve(c);
      });
    });
  };

  /** Hands step `index` to droid-main with its full context; at most once per step, never for a completed step. */
  const handoff = async (index: number, reason: string): Promise<boolean> => {
    if (!run || handed.has(index) || completed(index) || index >= run.steps.length) return false;
    handed.add(index);
    if (index === 0) disarm();
    const payload = handoffPayload(run.id, run.goal, run.steps, index, reason, deps.context(index));
    note(payload.note, 'warn');
    if (!deps.connected()) {
      deps.log(`Handoff of step ${index + 1} not delivered — droid-main is not connected; droid-new keeps the step`, 'error');
      return false;
    }
    const reply = await deps.send('takeover_request', payload).catch((error: unknown) => ({ ok: false, message: error instanceof Error ? error.message : String(error) }));
    deps.log(`Droid-main ${reply.ok ? 'accepted' : 'refused'} step ${index + 1}: ${reply.message}`, reply.ok ? 'info' : 'error');
    if (reply.ok && accepted === null) accepted = index;
    return reply.ok;
  };

  /** Starts a run: arms the first step's FIRST_STEP_MS timer. */
  const startRun = (goal: string, steps: WorkflowStep[]): string => {
    disarm();
    handed.clear();
    votes.clear();
    settled.clear();
    accepted = null;
    run = { id: `run-${Date.now().toString(36)}-${++runSeq}`, goal, steps };
    if (steps.length) timer = setTimeout(() => void handoff(0, `step 1 not verified complete within ${(deps.firstStepMs ?? FIRST_STEP_MS) / 1000} s`), deps.firstStepMs ?? FIRST_STEP_MS);
    return run.id;
  };

  /** Droid-new's verification of step `index`: reported to droid-main; a verified first step cancels its timer. */
  const stepVerified = (index: number, verified: boolean, message: string) => {
    if (!run) return null;
    if (index === 0 && verified) disarm();
    if (deps.connected()) void deps.send('step_report', { runId: run.id, stepIndex: index, name: run.steps[index]?.name ?? '', verified, message }).catch(() => undefined);
    return vote(index, { verified });
  };

  /** Droid-new's agents' verdict on step `index`: shared with droid-main (agent-to-agent, per step). */
  const newAgentsVote = (index: number, agree: boolean, agents: string[], why: string) => {
    if (!run) return null;
    const payload: AgentVotePayload = { runId: run.id, stepIndex: index, side: 'droid-new', agree, agents, note: why };
    if (deps.connected()) void deps.send('agent_vote', payload).catch(() => undefined);
    return vote(index, { newAgents: agree });
  };

  /** Droid-main's takeover messages for the current run; anything for another run is ignored. */
  const onInbound = (m: InboundMessage): boolean => {
    if (m.type !== 'takeover_claim' && m.type !== 'takeover_result' && m.type !== 'agent_vote') return false;
    if (!run || m.payload.runId !== run.id) return false;
    if (m.type === 'takeover_claim') void handoff(m.payload.stepIndex, `droid-main detected the step incomplete: ${m.payload.reason}`);
    else if (m.type === 'agent_vote') vote(m.payload.stepIndex, { mainAgents: m.payload.agree });
    else note(`Droid-main ${m.payload.ok ? 'completed' : 'failed'} handed-over step ${m.payload.stepIndex + 1}: ${m.payload.message}`, m.payload.ok ? 'ok' : 'error');
    return true;
  };

  return {
    startRun,
    stepVerified,
    newAgentsVote,
    onInbound,
    handoff,
    awaitCompletion,
    /** Ends the run: the first-step timer is cancelled. */
    stop: () => {
      disarm();
      run = null;
    },
    completion: (index: number) => stepCompletion(votes.get(index) ?? {}, deps.connected()),
    handedOver: (index: number) => handed.has(index),
    /** The step droid-main accepted and continues from; null while droid-new keeps the run. */
    takenOver: () => accepted,
    runId: () => run?.id ?? null,
  };
}

export type Takeover = ReturnType<typeof createTakeover>;
