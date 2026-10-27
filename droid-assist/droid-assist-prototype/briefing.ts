import type { Frame, SyncLevel, WorkflowStep } from './types.js';
import type { Box } from './assist-ai.js';
import type { Proposal } from './proposal.js';
import { boundingBox, diffCells, frameDistance, largestCluster, matchTemplate, syncLevelFor, type ChangedCell, type DriftThresholds } from './drift.js';
import { conflictsOf, crossReference, type CrossCheck, type Knowledge } from './cross-reference.js';
import { uid } from './planner.js';

type Point = { x: number; y: number };

/** One step of the plan as the objectives breakdown lists it. */
export interface SequenceItem {
  id: string;
  name: string;
  action: WorkflowStep['action'];
  target: string;
  status: WorkflowStep['status'];
  current: boolean;
}

/** The goal, the step sequence and, for the current step, what it does and why it serves the goal. */
export interface Objectives {
  goal: string;
  sequence: SequenceItem[];
  action: WorkflowStep['action'];
  target: string;
  x: number;
  y: number;
  what: string;
  why: string;
  /** Whether the what/why came from the model or was built locally (AI offline). */
  source: Proposal['source'];
  /** The Goal tracer's live progress on the goal, when it is tracing one. */
  progress?: string;
}

/** Where the expected screen for a step comes from and the point its target is matched at. */
export interface Reference {
  frame: Frame;
  label: string;
  anchor: Point;
}

/** The live frame against the reference frame: changed regions, target drift and a verdict. */
export interface FrameComparison {
  live: Frame | null;
  reference: Frame | null;
  referenceLabel: string;
  /** Changed regions (normalised boxes), largest first. */
  regions: Box[];
  changedCells: number;
  /** Whole-frame distance (0 = identical). */
  distance: number;
  /** Green = target unchanged, yellow = moved but found, red = not found, idle = nothing to compare. */
  level: SyncLevel;
  /** True only when the planned target is not found on the live frame (level red). */
  failed: boolean;
  verdict: string;
}

/** One review-and-update action taken before dispatch. */
export interface Revision {
  time: number;
  kind: 'recalibrate' | 'reground' | 'reroute' | 'replan';
  text: string;
  /** The fresh snip of the target region a reroute decided on, shown with the revision. */
  snip?: Frame;
}

/** How a briefing ended: nothing to fix, fixed, still conflicting, or skipped. */
export type BriefingOutcome = 'clear' | 'corrected' | 'unresolved';

/** The pre-action briefing of one step, recorded before it dispatches. */
export interface Briefing {
  id: string;
  time: number;
  stepId: string;
  stepName: string;
  objectives: Objectives;
  comparison: FrameComparison;
  crossRef: CrossCheck[];
  /** Plain statement that the AI endpoint is down, or null when it is online. */
  aiNote: string | null;
  revisions: Revision[];
  outcome: BriefingOutcome;
  /** Zoomed crops around the planned point on the live and reference frames, when rendered. */
  liveCrop?: Frame;
  referenceCrop?: Frame;
}

/** What a briefing is built from. */
export interface BriefingInput {
  goal: string;
  steps: WorkflowStep[];
  step: WorkflowStep;
  proposal: Proposal;
  live: Frame | null;
  knowledge: Knowledge;
  thresholds: DriftThresholds;
  online: boolean;
  /** The traced goal progress line; omitted or null when no goal is traced. */
  goalProgress?: string | null;
}

/** Most briefings kept (newest first, in memory). */
export const BRIEFING_LIMIT = 50;
/** Most changed regions boxed per comparison. */
export const MAX_REGIONS = 6;
/** Cells of the diff grid (16 × 9). */
const GRID_CELLS = 16 * 9;

/** The briefing's plain statement when the AI endpoint is down. */
export const AI_DOWN_NOTE = 'AI endpoint is down — no AI comparison, re-grounding or re-plan was made. The screenshot comparison and cross-reference below are local pixel and memory checks, not AI output.';

const targetOf = (step: WorkflowStep) => step.target ?? step.name;
const planned = (step: WorkflowStep): Point => ({ x: step.correctedX ?? step.x, y: step.correctedY ?? step.y });

/**
 * The expected screen for `step`: its own saved reference screenshot (matched at its recorded point),
 * else the after-frame of the latest earlier verified step (matched at the planned point); null with neither.
 */
export function referenceFor(steps: WorkflowStep[], step: WorkflowStep): Reference | null {
  if (step.refFrame) return { frame: step.refFrame, label: 'saved reference screenshot of this step', anchor: { x: step.x, y: step.y } };
  const index = steps.findIndex((s) => s.id === step.id);
  const earlier = (index < 0 ? steps : steps.slice(0, index)).filter((s) => s.id !== step.id && s.status === 'done' && s.afterFrame);
  const prev = earlier[earlier.length - 1];
  return prev?.afterFrame ? { frame: prev.afterFrame, label: `verified frame after "${prev.name}"`, anchor: planned(step) } : null;
}

/** The changed cells grouped into connected regions, largest first, at most MAX_REGIONS. */
export function changedRegions(cells: ChangedCell[]): Box[] {
  const out: Box[] = [];
  let rest = cells;
  while (rest.length && out.length < MAX_REGIONS) {
    const group = new Set(largestCluster(rest));
    out.push(boundingBox([...group])!);
    rest = rest.filter((c) => !group.has(c));
  }
  return out;
}

const LEVEL_TEXT: Record<SyncLevel, string> = {
  green: 'target unchanged at the planned point',
  yellow: 'target moved but found nearby',
  red: 'target NOT found near the planned point',
  idle: 'nothing to compare',
};

/** An empty comparison that cannot fail: no live frame or no reference. */
const noComparison = (live: Frame | null, verdict: string): FrameComparison => ({ live, reference: null, referenceLabel: 'none', regions: [], changedCells: 0, distance: 0, level: 'idle', failed: false, verdict });

/** Compares the live frame with the reference: boxes the changed regions and matches the target template. */
export function compareFrames(live: Frame | null, ref: Reference | null, t: DriftThresholds): FrameComparison {
  if (!live) return noComparison(null, 'No live frame captured yet — nothing to compare');
  if (!ref) return noComparison(live, 'No reference frame for this step (no saved screenshot and no earlier verified step) — comparison not made');
  const cells = diffCells(ref.frame.data, live.data);
  const regions = changedRegions(cells);
  const distance = frameDistance(ref.frame.data, live.data);
  const level = syncLevelFor(matchTemplate(ref.frame.data, live.data, ref.anchor.x, ref.anchor.y, { radius: t.radius }), t);
  const verdict = `${level.toUpperCase()} — ${LEVEL_TEXT[level]}; ${cells.length}/${GRID_CELLS} cells changed in ${regions.length} region(s); whole-frame Δ ${distance.toFixed(3)}`;
  return { live, reference: ref.frame, referenceLabel: ref.label, regions, changedCells: cells.length, distance, level, failed: level === 'red', verdict };
}

/** The objectives breakdown: goal, sequence, and the current step's what/why from its proposal. */
export function objectivesOf(goal: string, steps: WorkflowStep[], step: WorkflowStep, p: Proposal): Objectives {
  const sequence = steps.map((s) => ({ id: s.id, name: s.name, action: s.action, target: targetOf(s), status: s.status, current: s.id === step.id }));
  return { goal, sequence, action: p.action, target: p.target, x: p.x, y: p.y, what: p.what, why: p.why, source: p.source };
}

/** Builds the briefing of `input.step` before it dispatches. */
export function buildBriefing(input: BriefingInput): Briefing {
  const { step, proposal } = input;
  return {
    id: uid('brief'),
    time: Date.now(),
    stepId: step.id,
    stepName: step.name,
    objectives: { ...objectivesOf(input.goal, input.steps, step, proposal), ...(input.goalProgress ? { progress: input.goalProgress } : {}) },
    comparison: compareFrames(input.live, referenceFor(input.steps, step), input.thresholds),
    crossRef: crossReference(targetOf(step), { x: proposal.x, y: proposal.y }, input.knowledge),
    aiNote: input.online ? null : AI_DOWN_NOTE,
    revisions: [],
    outcome: 'clear',
  };
}

/** Why the briefing must be reviewed before applying: a failed comparison and each conflict; empty when clear. */
export function briefingIssues(b: Briefing): string[] {
  const conflicts = conflictsOf(b.crossRef).map((c) => `conflict: ${c.text}`);
  return b.comparison.failed ? [`comparison failed: ${b.comparison.verdict}`, ...conflicts] : conflicts;
}

/** Adds a briefing newest first, replacing an earlier record with the same id, keeping BRIEFING_LIMIT. */
export const addBriefing = (list: Briefing[], b: Briefing) => [b, ...list.filter((x) => x.id !== b.id)].slice(0, BRIEFING_LIMIT);

/** One-line text of a briefing for the activity log. */
export function briefingText(b: Briefing): string {
  const conflicts = conflictsOf(b.crossRef).length;
  const fixes = b.revisions.length ? `; ${b.revisions.map((r) => r.kind).join(' → ')}` : '';
  return `${b.outcome.toUpperCase()} — ${b.objectives.what}; ${b.comparison.verdict}; ${b.crossRef.length - conflicts} consistent, ${conflicts} conflicting${fixes}${b.aiNote ? ' (AI down)' : ''}`;
}
