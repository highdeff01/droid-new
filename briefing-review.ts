import type { WorkflowStep } from './types.js';
import { POINTER_ACTIONS } from './types.js';
import { whatText, type Proposal } from './proposal.js';
import { briefingIssues, type Briefing, type Revision } from './briefing.js';
import { POINT_SOURCES } from './cross-reference.js';
import type { RerouteDecision } from './reroute.js';

type Point = { x: number; y: number };

/** The step and proposal a briefing ends with, and the briefing showing them. */
export interface Reviewed {
  briefing: Briefing;
  step: WorkflowStep;
  proposal: Proposal;
}

/** What the review routes through: the ruler, the grounding agent and the executor, plus the briefing builder. */
export interface ReviewDeps {
  online: boolean;
  /** The Grounding loop-control stage is checked. */
  groundingOn: boolean;
  /** A ruler baseline exists, so re-measuring is possible. */
  hasBaseline: boolean;
  /** Re-measures via the ruler for `step`; on drift `step` is the step rescaled into the live layout. Null when it could not measure. */
  recalibrate: (reason: string, step: WorkflowStep) => { drift: boolean; detail: string; step: WorkflowStep } | null;
  /** The grounding agent re-locates the target on a zoomed crop; null when it says it is not visible. */
  reground: (step: WorkflowStep, feedback: string) => Promise<Point | null>;
  /** Snips the target region fresh, re-identifies it, else takes an alternate access path (no re-plan: that is the next attempt). */
  reroute: (step: WorkflowStep, why: string) => Promise<RerouteDecision>;
  /** The executor re-plans the step; null when it cannot justify it. */
  replan: (step: WorkflowStep, reason: string) => Promise<{ step: WorkflowStep; proposal: Proposal } | null>;
  /** A fresh briefing of `step` with `proposal` (comparison and cross-reference re-run). */
  rebuild: (step: WorkflowStep, proposal: Proposal) => Briefing;
  /** Shows the updated briefing before anything dispatches. */
  publish: (b: Briefing) => Promise<void> | void;
}

const planned = (step: WorkflowStep): Point => ({ x: step.correctedX ?? step.x, y: step.correctedY ?? step.y });
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** The proposal moved to `p`, its what-sentence updated. */
const movedTo = (proposal: Proposal, step: WorkflowStep, p: Point): Proposal => ({ ...proposal, x: p.x, y: p.y, what: whatText(step.action, proposal.target, p.x, p.y, step.text) });

/** The step re-pointed at `p`; its stale template and drift correction are dropped. */
const pointedAt = (step: WorkflowStep, p: Point): WorkflowStep => ({ ...step, x: p.x, y: p.y, refFrame: undefined, correctedX: undefined, correctedY: undefined });

/** Whether re-measuring can explain the issues: the comparison failed or a remembered point disagrees. */
const measurable = (b: Briefing) => b.comparison.failed || b.crossRef.some((c) => c.status === 'conflicting' && POINT_SOURCES.has(c.source));

/** One review attempt: null when it does not apply, else the revised step/proposal and what it did. */
type Attempt = (r: Reviewed, issues: string[], deps: ReviewDeps) => Promise<{ step: WorkflowStep; proposal: Proposal; text: string; snip?: Revision['snip'] } | null>;

const recalibrate: Attempt = async (r, issues, deps) => {
  if (!deps.hasBaseline || !measurable(r.briefing)) return null;
  const cal = deps.recalibrate(`pre-action briefing: ${issues[0]}`, r.step);
  if (!cal) return { step: r.step, proposal: r.proposal, text: 'Re-measured with the ruler — recalibration was not possible' };
  if (!cal.drift) return { step: r.step, proposal: r.proposal, text: `Re-measured with the ruler — no drift (${cal.detail})` };
  const p = planned(cal.step);
  return { step: cal.step, proposal: movedTo(r.proposal, cal.step, p), text: `Re-measured with the ruler — drift rescaled the plan to (${pct(p.x)}, ${pct(p.y)}): ${cal.detail}` };
};

const reground: Attempt = async (r, issues, deps) => {
  if (!deps.online || !deps.groundingOn || !POINTER_ACTIONS.has(r.step.action)) return null;
  const p = await deps.reground(r.step, issues.join('; '));
  if (!p) return { step: r.step, proposal: r.proposal, text: `Re-grounded on a zoomed crop — "${r.proposal.target}" is not visible` };
  return { step: pointedAt(r.step, p), proposal: movedTo(r.proposal, r.step, p), text: `Re-grounded on a zoomed crop — target at (${pct(p.x)}, ${pct(p.y)})` };
};

const reroute: Attempt = async (r, issues, deps) => {
  if (!POINTER_ACTIONS.has(r.step.action)) return null;
  const d = await deps.reroute(r.step, `the pre-action briefing found ${issues.join('; ')}`);
  if (d.kind === 'none') return null;
  return { step: d.step, proposal: movedTo(r.proposal, d.step, planned(d.step)), text: `Rerouted mid-run — ${d.text}`, ...(d.snip ? { snip: d.snip } : {}) };
};

const replan: Attempt = async (r, issues, deps) => {
  if (!deps.online) return null;
  const next = await deps.replan(r.step, `the pre-action briefing found ${issues.join('; ')}`);
  if (!next) return { step: r.step, proposal: r.proposal, text: 'Re-planned the step — it could not be justified on the current screen' };
  return { ...next, text: `Re-planned the step — ${next.proposal.what}` };
};

/** Review order: re-measure, re-ground on a zoomed crop, reroute on a fresh snip or an alternate access path, then re-plan. */
const ATTEMPTS: ReadonlyArray<[Revision['kind'], Attempt]> = [['recalibrate', recalibrate], ['reground', reground], ['reroute', reroute], ['replan', replan]];

/**
 * Review-and-update before applying: while the briefing shows a failed comparison or conflicts,
 * recalibrates, re-grounds, reroutes, then re-plans, rebuilding and publishing the briefing after each.
 * Stops at the first clear briefing ('corrected'); 'unresolved' when every applicable attempt left issues.
 */
export async function reviewBriefing(start: Reviewed, deps: ReviewDeps): Promise<Reviewed> {
  if (!briefingIssues(start.briefing).length) return { ...start, briefing: { ...start.briefing, outcome: 'clear' } };
  let cur = start;
  for (const [kind, attempt] of ATTEMPTS) {
    const issues = briefingIssues(cur.briefing);
    const done = await attempt(cur, issues, deps);
    if (!done) continue;
    const revisions: Revision[] = [...cur.briefing.revisions, { time: Date.now(), kind, text: done.text, ...(done.snip ? { snip: done.snip } : {}) }];
    const fresh = deps.rebuild(done.step, done.proposal);
    const clear = !briefingIssues(fresh).length;
    const briefing: Briefing = { ...fresh, id: start.briefing.id, time: start.briefing.time, aiNote: start.briefing.aiNote, revisions, outcome: clear ? 'corrected' : 'unresolved' };
    cur = { briefing, step: done.step, proposal: done.proposal };
    await deps.publish(briefing);
    if (clear) return cur;
  }
  return { ...cur, briefing: { ...cur.briefing, outcome: 'unresolved' } };
}
