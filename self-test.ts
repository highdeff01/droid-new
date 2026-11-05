import type { FamiliarElement, Frame, StepAction, WorkflowStep } from './types.js';
import { boxCenter, type MappedElement } from './element-map-studio.js';
import { uid } from './planner.js';
import type { StressReport } from './initiative.js';

/** An element the AI can test on its own: a mapped element or a familiar target. */
export interface TestTarget {
  name: string;
  x: number;
  y: number;
  /** The screenshot the element was mapped on: the template its position is checked against. */
  frame?: Frame;
}

/** Mapped elements first (with the frame they were mapped on), then familiar targets not already mapped by name. */
export function testTargets(mapped: MappedElement[], familiar: FamiliarElement[]): TestTarget[] {
  const fromMap = mapped.map((m) => ({ name: m.name, ...boxCenter(m.box), ...(m.frame ? { frame: m.frame } : {}) }));
  const names = new Set(fromMap.map((t) => t.name.toLowerCase()));
  return [...fromMap, ...familiar.filter((f) => !names.has(f.name.toLowerCase())).map((f) => ({ name: f.name, x: f.x, y: f.y }))];
}

/** The target tested longest ago (never tested first); null when there is none. */
export function nextSelfTest(targets: TestTarget[], lastTested: Record<string, number>): TestTarget | null {
  return targets.reduce<TestTarget | null>((best, t) => (!best || (lastTested[t.name] ?? 0) < (lastTested[best.name] ?? 0) ? t : best), null);
}

/** The click a self-test sends at a target, checked against the frame it was mapped on when there is one. */
export const selfTestStep = (t: TestTarget): WorkflowStep => ({ id: uid('selftest'), name: `Self-test: click "${t.name}"`, action: 'click', target: t.name, x: t.x, y: t.y, status: 'pending', ...(t.frame ? { refFrame: t.frame } : {}) });

/** Text the heavy element tester types into a target. */
export const STRESS_TEXT = 'droid';
/** How far (normalized) a stress drag moves before it drops. */
const DRAG_DELTA = 0.02;
/** The input kinds one stress cycle runs, in order. */
export const STRESS_ACTIONS: readonly StepAction[] = ['click', 'type', 'drag'];

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** One stress input of kind `action` on the target. */
function stressStep(t: TestTarget, action: StepAction, cycle: number): WorkflowStep {
  const base = { id: uid('stress'), name: `Stress ${cycle}: ${action} "${t.name}"`, action, target: t.name, x: t.x, y: t.y, status: 'pending' as const };
  if (action === 'type') return { ...base, text: STRESS_TEXT };
  if (action === 'drag') return { ...base, endX: clamp(t.x + DRAG_DELTA), endY: clamp(t.y + DRAG_DELTA), endTarget: t.name };
  return base;
}

/** `cycles` rounds of click → type → drag on the target. */
export function stressSteps(t: TestTarget, cycles: number): WorkflowStep[] {
  return Array.from({ length: Math.max(1, Math.floor(cycles)) }, (_, i) => STRESS_ACTIONS.map((a) => stressStep(t, a, i + 1))).flat();
}

/** One stress input's result. */
export interface StressResult {
  action: StepAction;
  ok: boolean;
}

/** The reliability report of a stress run on `target`. */
export function stressReport(target: string, results: StressResult[], dryRun: boolean, time = Date.now()): StressReport {
  const byAction: StressReport['byAction'] = {};
  for (const r of results) {
    const a = (byAction[r.action] ??= { ok: 0, total: 0 });
    a.total += 1;
    if (r.ok) a.ok += 1;
  }
  const succeeded = results.filter((r) => r.ok).length;
  return { id: uid('stress'), time, target, attempts: results.length, succeeded, reliability: results.length ? succeeded / results.length : 0, byAction, dryRun };
}

/** One-line text of a stress report. */
export const stressText = (r: StressReport) => `"${r.target}" ${(r.reliability * 100).toFixed(0)}% reliable (${r.succeeded}/${r.attempts}${r.dryRun ? ', dry run' : ''}) — ${Object.entries(r.byAction).map(([a, v]) => `${a} ${v!.ok}/${v!.total}`).join(', ')}`;
