import type { Frame, LogEntry, WorkflowStep } from './types.js';
import { stageOf, type StageId, type StageMap } from './loop-control.js';
import type { DriftCorrection } from './drift.js';
import type { Placement } from './window-placement.js';
import {
  changeLine, decideReapply, logSummary, loopReport, needsForeground, opsAgent, parseLoopCommand, parsePlacement, recheckVerdict, testTarget,
  type Evidence, type MonitorChange, type OpsAgentId, type TestCandidate,
} from './operations.js';

/** What an Operations agent reports after one command; `point` is where it acted, when it did. */
export interface OpsWorkResult {
  ok: boolean;
  found: string;
  point?: { x: number; y: number };
}

/** One dispatched step as the apply agent hands it on: the real outcome of the guarded pipeline. */
export interface AppliedOutcome {
  ok: boolean;
  executed: boolean;
  message: string;
  target: { x: number; y: number };
  shot?: Frame;
}

/** What the Operations agents need from the engine. */
export interface OpsDeps {
  /** The operation (goal) work is tagged with. */
  op: () => string;
  stageOn: (id: StageId) => boolean;
  /** Abort, Stop plan: why no further work may start; null when it may. */
  halted: () => string | null;
  /** A report made by an agent the apply chain invoked (placement, screenshots, recheck, reapply). */
  report: (agent: OpsAgentId, task: string, result: OpsWorkResult) => void;
  lastChange: () => MonitorChange | null;
  mapNames: () => string[];
  log: () => LogEntry[];
  candidates: () => TestCandidate[];
  /** The watcher's background-test machinery: one test click, dry run or real. */
  test: (step: WorkflowStep, proposalId: string, dryRun: boolean) => Promise<{ ok: boolean; message: string }>;
  armed: () => boolean;
  /** The steps a plain-words action plans to. */
  plan: (task: string) => Promise<WorkflowStep[]>;
  /** Dispatches one step through the real-input guarantee path (proposal, briefing, guardrails, bridge). */
  apply: (step: WorkflowStep) => Promise<AppliedOutcome>;
  capture: () => Promise<Frame | null>;
  /** Stores a frame in the frame store. */
  store: (frame: Frame) => void;
  /** Records evidence; returns its id. */
  addEvidence: (evidence: Omit<Evidence, 'id' | 'time' | 'verdict'>) => string;
  markEvidence: (id: string, verdict: Evidence['verdict']) => void;
  correct: (ref: Frame, live: Frame, point: { x: number; y: number }) => DriftCorrection;
  /** The main AI's re-plan of a step that could not be reapplied. */
  replan: (step: WorkflowStep, why: string) => Promise<WorkflowStep | null>;
  retries: () => number;
  stages: () => StageMap;
  running: () => StageId[];
  toggle: (id: StageId, on: boolean) => void;
  place: (command: ReturnType<typeof parsePlacement>) => Promise<Placement>;
  /** Holds the last applied action across re-creations of the workers (a React ref). */
  lastApplied: { current: Applied | null };
}

/** The last action the apply agent dispatched: what recheck and reapply work on. */
export interface Applied {
  step: WorkflowStep;
  out: AppliedOutcome;
  before: Frame | null;
  after: Frame | null;
  evidenceId: string | null;
  /** Recheck verdict: null before the recheck. */
  ok: boolean | null;
  attempts: number;
}

const ok = (found: string, point?: { x: number; y: number }): OpsWorkResult => ({ ok: true, found, ...(point ? { point } : {}) });
const fail = (found: string, point?: { x: number; y: number }): OpsWorkResult => ({ ok: false, found, ...(point ? { point } : {}) });

/**
 * The nine Operations agents as workers: each takes one command (plain words) and reports. The apply
 * agent chains placement → before shot → dispatch → after shot → recheck → reapply, each switched by
 * its own loop-control stage and reported as that agent's own report.
 */
export function createOpsWorkers(deps: OpsDeps) {
  const held = deps.lastApplied;
  const frameNow = () => deps.capture().catch(() => null);

  /** Brings the target app in front for a foreground action (placement stage on). */
  const placeFor = async (step: WorkflowStep) => {
    if (!needsForeground(step.action) || !deps.stageOn('opsPlacement')) return;
    const p = await deps.place('aside');
    deps.report('placement', `bring the target app to front for "${step.name}"`, { ok: p.ok, found: p.message });
  };

  /** Records the before/after frames of one dispatched step as evidence (screenshots stage on). */
  const recordEvidence = (step: WorkflowStep, out: AppliedOutcome, before: Frame | null, after: Frame | null): string | null => {
    if (!deps.stageOn('opsScreenshots')) return null;
    [before, after].forEach((f) => f && deps.store(f));
    const id = deps.addEvidence({ op: deps.op(), step: step.name, action: step.action, x: out.target.x, y: out.target.y, beforeId: before?.id ?? null, afterId: after?.id ?? null, before: before?.url ?? null, after: after?.url ?? null });
    deps.report('screenshots', `before/after of "${step.name}"`, ok(`captured ${before ? 'before' : 'no before'} and ${after ? 'after' : 'no after'} frame of "${step.name}"`, out.target));
    return id;
  };

  /** One dispatch with its evidence; becomes the action recheck and reapply work on. */
  const applyOnce = async (step: WorkflowStep, attempts: number): Promise<Applied> => {
    await placeFor(step);
    const before = await frameNow();
    const out = await deps.apply(step);
    const after = out.executed ? out.shot ?? await frameNow() : null;
    held.current = { step, out, before, after, evidenceId: recordEvidence(step, out, before, after), ok: null, attempts };
    return held.current;
  };

  /** Re-verifies the last applied action by comparing its before and after frames. */
  const recheck = async (): Promise<OpsWorkResult> => {
    const last = held.current;
    if (!last) return fail('nothing applied yet to recheck');
    if (!last.out.executed) return fail(`"${last.step.name}" was not executed (${last.out.message}) — nothing to recheck`, last.out.target);
    const after = last.after ?? await frameNow();
    if (!last.before || !after) return fail(`no ${last.before ? 'after' : 'before'} frame of "${last.step.name}" to compare`, last.out.target);
    const v = recheckVerdict(last.before.data, after.data, { action: last.step.action, ...last.out.target });
    held.current = { ...last, after, ok: v.ok };
    if (last.evidenceId) deps.markEvidence(last.evidenceId, v.ok ? 'effect' : 'no-effect');
    return { ok: v.ok, found: `"${last.step.name}": ${v.detail}`, point: last.out.target };
  };

  /** Escalation: the main AI re-plans the step once; the re-plan is applied and rechecked without further reapply. */
  const escalate = async (step: WorkflowStep, why: string): Promise<OpsWorkResult> => {
    const next = await deps.replan(step, why);
    if (!next) return fail(`"${step.name}": ${why} — escalated to the main AI, no re-plan`);
    await applyOnce(next, 0);
    const r = await recheck();
    return { ...r, found: `"${step.name}": ${why} — escalated to the main AI, re-planned as ${next.action} "${next.target ?? next.name}": ${r.found}` };
  };

  /** Reapplies the last action that failed its recheck at corrected coordinates, up to the retry limit, then escalates. */
  const reapply = async (): Promise<OpsWorkResult> => {
    const failed = held.current;
    if (!failed || failed.ok !== false) return fail('no applied action failed its recheck — nothing to reapply');
    const { step, before, out: first } = failed;
    const tried = [first.target];
    for (let attempt = failed.attempts + 1; ; attempt++) {
      const why = deps.halted() ?? (deps.stageOn('opsReapply') ? null : 'reapply stage unchecked');
      if (why) return fail(`"${step.name}": ${why} — reapply stopped`);
      const live = await frameNow();
      const correction = before && live ? deps.correct(before, live, first.target) : null;
      const d = decideReapply(attempt, deps.retries(), correction, tried);
      if (d.kind === 'escalate') return escalate(step, d.why);
      tried.push(d.at);
      const applied = await applyOnce({ ...step, x: d.at.x, y: d.at.y, correctedX: undefined, correctedY: undefined }, attempt);
      if (!applied.out.ok) return fail(`"${step.name}" reapply ${attempt}: ${applied.out.message}`, applied.out.target);
      const r = await recheck();
      if (r.ok) return ok(`"${step.name}" reapplied (attempt ${attempt}, ${d.why}): ${r.found}`, r.point);
    }
  };

  /** Recheck (and reapply on failure) after a step really ran, each when its stage is on. */
  const verifyApplied = async (step: WorkflowStep, out: AppliedOutcome): Promise<OpsWorkResult> => {
    if (!deps.stageOn('opsRecheck')) return ok(`"${step.name}": ${out.message} (recheck disabled)`, out.target);
    const r = await recheck();
    deps.report('recheck', `recheck "${step.name}"`, r);
    if (r.ok || !deps.stageOn('opsReapply')) return r;
    const again = await reapply();
    deps.report('reapply', `reapply "${step.name}"`, again);
    return again;
  };

  /** One planned step through the whole chain. */
  const applyStep = async (step: WorkflowStep): Promise<OpsWorkResult> => {
    const { out } = await applyOnce(step, 0);
    if (!out.ok) return fail(`"${step.name}": ${out.message}`, out.target);
    if (!out.executed) return ok(`"${step.name}": ${out.message}`, out.target);
    return verifyApplied(step, out);
  };

  const apply = async (task: string): Promise<OpsWorkResult> => {
    const steps = await deps.plan(task);
    if (!steps.length) return ok('nothing to apply — the task needs no input');
    const done: OpsWorkResult[] = [];
    for (const step of steps) {
      const why = deps.halted() ?? (deps.stageOn('opsApply') ? null : 'apply stage unchecked');
      if (why) return fail(`${why} — "${step.name}" not applied`);
      const r = await applyStep(step);
      if (!r.ok) return r;
      done.push(r);
    }
    return ok(done.map((r) => r.found).join('; '), done[done.length - 1]?.point);
  };

  const testing = async (task: string): Promise<OpsWorkResult> => {
    const hit = testTarget(task, deps.candidates());
    if (!hit) return fail(`no known element or proposal matches "${task}"`);
    const point = { x: hit.step.x, y: hit.step.y };
    const bg = await deps.test(hit.step, hit.proposalId, true);
    if (!bg.ok) return fail(`background test of "${hit.step.target}" failed: ${bg.message}`, point);
    if (/\bbackground-only\b/i.test(task)) return ok(`background test of "${hit.step.target}" passed: ${bg.message} (background-only; no input dispatched)`, point);
    if (!deps.armed()) return ok(`background test of "${hit.step.target}" passed: ${bg.message} (real input disarmed — no foreground test)`, point);
    const fg = await deps.test({ ...hit.step, id: `${hit.step.id}-fg` }, hit.proposalId, false);
    return { ok: fg.ok, found: `background test passed; foreground test of "${hit.step.target}" ${fg.ok ? 'passed' : 'failed'}: ${fg.message}`, point };
  };

  const loopControl = async (task: string): Promise<OpsWorkResult> => {
    const c = parseLoopCommand(task);
    if (c.kind === 'unknown') return fail(`no loop-control stage named "${c.name}"`);
    if (c.kind === 'toggle') deps.toggle(c.id, c.on);
    const done = c.kind === 'toggle' ? `${stageOf(c.id).name} ${c.on ? 'enabled' : 'disabled'}. ` : '';
    return ok(`${done}${loopReport(deps.stages(), deps.running()).text}`);
  };

  const workers: Record<OpsAgentId, (task: string) => Promise<OpsWorkResult>> = {
    monitor: async () => {
      const c = deps.lastChange();
      return ok(`${c ? `last change: ${changeLine(c)}` : 'no change seen yet'}; element map holds ${deps.mapNames().length} element(s)`);
    },
    logging: async () => ok(logSummary(deps.log(), deps.op())),
    testing,
    apply,
    recheck,
    reapply,
    loopControl,
    placement: async (task) => {
      const p = await deps.place(parsePlacement(task));
      return { ok: p.ok, found: p.message };
    },
    screenshots: async () => {
      const f = await frameNow();
      if (!f) return fail('no live frame to capture');
      deps.store(f);
      return ok(`captured frame #${f.id} into the frame store`);
    },
  };

  /** One command to one agent: refused when its stage is unchecked or the run is halted; a thrown error is a failed report. */
  return async (agent: OpsAgentId, task: string): Promise<OpsWorkResult> => {
    const { stage, name } = opsAgent(agent);
    if (!deps.stageOn(stage)) return fail(`${name} is unchecked in Loop control — not run`);
    const why = deps.halted();
    if (why) return fail(`${why} — not run`);
    try {
      return await workers[agent](task);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  };
}
