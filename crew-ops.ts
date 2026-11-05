import type { ActionRecord, WorkflowStep } from './types.js';
import { REVERSE_ACTOR, reverseOffer } from './reverse.js';
import { conflictsOf, crossReference, type CrossCheck, type Knowledge } from './cross-reference.js';
import type { CrewAgent } from './crew.js';

/** Why a test was requested. */
export type TestReason = 'obstacles' | 'off-path' | 'requested';

/** A test request picked up from an agent's or the main AI's message. */
export interface TestRequest {
  from: string;
  reason: TestReason;
  text: string;
}

/** Wording that asks the crew for a test, checked in order. */
const TEST_TRIGGERS: ReadonlyArray<[RegExp, TestReason]> = [
  [/\b(too many|several|multiple|repeated)\s+(obstacles?|blockers?|popups?|failures?)\b|\bblocked\b/i, 'obstacles'],
  [/\boff[\s-]?(path|route|track)\b|\bwrong path\b/i, 'off-path'],
  [/\b(run|do|needs?|request)\s+(a\s+)?tests?\b|\btest (it|this|that)\b/i, 'requested'],
];

/** The test request in `text` from `from`, or null when it asks for none. */
export function detectTestRequest(from: string, text: string): TestRequest | null {
  const hit = TEST_TRIGGERS.find(([re]) => re.test(text));
  return hit ? { from, reason: hit[1], text } : null;
}

/** Outcome of one test pass. */
export interface PassResult {
  ok: boolean;
  detail: string;
}

/** Background pass (dry run against captured frames) and, only when it passed, the main-screen pass. */
export interface CrewTestResult {
  background: PassResult;
  main: PassResult | null;
  passed: boolean;
}

/** Runs the background pass first; the main-screen pass runs only when the background pass succeeded. */
export async function runCrewTest(background: () => Promise<PassResult>, main: () => Promise<PassResult>): Promise<CrewTestResult> {
  const bg = await background();
  if (!bg.ok) return { background: bg, main: null, passed: false };
  const live = await main();
  return { background: bg, main: live, passed: live.ok };
}

/** The test result as the one-line report sent back to the requester. */
export const testReport = (req: TestRequest, r: CrewTestResult) =>
  `Test for ${req.from} (${req.reason}): background ${r.background.ok ? 'passed' : 'failed'} — ${r.background.detail}`
  + (r.main ? `; main screen ${r.main.ok ? 'passed' : 'failed'} — ${r.main.detail}` : '; main-screen test skipped');

/** One agent's verdict on a step about to be dispatched. */
export interface SafetyVote {
  agentId: string;
  check: string;
  ok: boolean;
  reason: string;
}

/** The crew's decision on a step: dispatched only when every vote passes. */
export interface SafetyDecision {
  ok: boolean;
  votes: SafetyVote[];
}

type SafetyCheck = { name: string; test: (step: WorkflowStep, history: readonly ActionRecord[]) => string | null };

const UNDO_COMBOS = /^(ctrl|cmd|command|meta)\+(shift\+)?(z|y)$/;
const inUnit = (v: number | undefined) => v === undefined || (Number.isFinite(v) && v >= 0 && v <= 1);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** Whether `step` repeats one of the inverse steps the reversal offer would run. */
function repeatsReversal(step: WorkflowStep, history: readonly ActionRecord[]): boolean {
  const offer = reverseOffer(history);
  if (!offer?.reversal.ok) return false;
  return offer.reversal.steps.some((r) => r.action === step.action && near(r.x, step.x) && near(r.y, step.y) && (r.text ?? '') === (step.text ?? ''));
}

/** The independent coordinate checks, each run by a different agent. */
export const SAFETY_CHECKS: readonly SafetyCheck[] = [
  { name: 'undo-combo', test: (s) => (s.action === 'key' && UNDO_COMBOS.test((s.text ?? '').trim().toLowerCase()) ? `"${s.text}" is an undo/redo combo` : null) },
  { name: 'reversal-repeat', test: (s, h) => (repeatsReversal(s, h) ? 'it repeats the reversal of the last action' : null) },
  { name: 'in-bounds', test: (s) => (inUnit(s.x) && inUnit(s.y) && inUnit(s.endX) && inUnit(s.endY) ? null : 'its coordinates are off screen') },
];

/**
 * The checks for a backtrack step: a backtrack is the deliberate move back along the path, so it
 * may retrace the newest pointer move's reversal; undo/redo combos and off-screen points still veto it.
 */
export const BACKTRACK_CHECKS: readonly SafetyCheck[] = SAFETY_CHECKS.filter((c) => c.name !== 'reversal-repeat');

/** Multi-agent check of a risky step: each check goes to the next agent in `voters` (round robin). */
export function safetyVote(step: WorkflowStep, history: readonly ActionRecord[], voters: readonly CrewAgent[], checks: readonly SafetyCheck[] = SAFETY_CHECKS): SafetyDecision {
  const votes = checks.map((c, i): SafetyVote => {
    const reason = c.test(step, history);
    return { agentId: voters.length ? voters[i % voters.length].id : 'crew', check: c.name, ok: !reason, reason: reason ?? 'clear' };
  });
  return { ok: votes.every((v) => v.ok), votes };
}

/** Backtrack: one cursor move per recent real action (newest first) to where the pointer was before it. */
export function backtrackSteps(history: readonly ActionRecord[], n: number): WorkflowStep[] {
  const recent = history.filter((r) => r.ok && !(r.dryRun && !r.simulated) && r.source !== REVERSE_ACTOR && r.srcW && r.srcH).slice(0, Math.max(0, Math.floor(n)));
  return recent.map((r, i) => {
    const px = typeof r.prevX === 'number' && typeof r.prevY === 'number' ? { x: r.prevX, y: r.prevY } : { x: r.x, y: r.y };
    return { id: `back-${r.id}-${i}`, name: `Backtrack ${i + 1}: before ${r.action}`, action: 'move', x: px.x / (r.srcW as number), y: px.y / (r.srcH as number), status: 'pending' };
  });
}

/** An adjustment suggestion cross-referenced with habits, patterns and position memory. */
export interface GroundedSuggestion {
  checks: CrossCheck[];
  grounded: boolean;
  text: string;
}

/** Cross-references `target` at `p` against what is known; grounded when nothing conflicts. */
export function groundSuggestion(target: string, p: { x: number; y: number }, k: Knowledge): GroundedSuggestion {
  const checks = crossReference(target, p, k);
  const conflicts = conflictsOf(checks);
  const text = !checks.length
    ? `no history for "${target}" — unconfirmed`
    : conflicts.length
      ? `conflicts with history: ${conflicts.map((c) => c.text).join('; ')}`
      : `consistent with ${checks.length} history entr${checks.length === 1 ? 'y' : 'ies'}`;
  return { checks, grounded: checks.length > 0 && !conflicts.length, text };
}
