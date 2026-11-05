import type { WorkflowStep } from './types.js';
import { boxCenter } from './element-map-studio.js';
import { findElement, type InventoryElement } from './screen-inventory.js';

/** One retested step's result, with the obstacle met on the way (null when none). */
export interface RetestStepResult {
  /** 0-based position in the flow. */
  index: number;
  stepId: string;
  name: string;
  target: string;
  ok: boolean;
  /** Whether the step actually dispatched (false for a refused / halted step). */
  executed: boolean;
  message: string;
  obstacle: string | null;
}

/** The final verdict of a retest. */
export interface RetestSummary {
  pass: boolean;
  passed: number;
  failed: number;
  /** Steps that ran (a halted retest runs fewer than it selected). */
  executed: number;
  selected: number;
}

/** What one step's run reported back to the retest. */
export interface RetestOutcome {
  ok: boolean;
  executed: boolean;
  message: string;
  /** The run must stop (abort, disarm, budget). */
  halt?: boolean;
  /** An obstacle the run itself met (popup cleared, fix script…). */
  obstacle?: string | null;
}

/** How a retest runs each step: refresh the step against the live screen, then run it. */
export interface RetestDeps {
  prepare: (step: WorkflowStep) => { step: WorkflowStep; obstacle: string | null };
  perform: (step: WorkflowStep, index: number) => Promise<RetestOutcome>;
}

/**
 * The flow positions a retest runs: the selected 0-based indices in flow order, duplicates and
 * out-of-range ones dropped; an empty selection (or one with nothing in range) is the whole flow.
 */
export function selectSteps(count: number, indices: number[] = []): number[] {
  const picked = [...new Set(indices)].filter((i) => Number.isInteger(i) && i >= 0 && i < count).sort((a, b) => a - b);
  return picked.length ? picked : Array.from({ length: count }, (_, i) => i);
}

/** Parses "2, 4-5" (1-based step numbers as the UI shows them) into 0-based indices; unreadable parts are ignored. */
export function parseSelection(text: string): number[] {
  return text.split(/[,\s]+/).filter(Boolean).flatMap((part) => {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) return [];
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    return Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i - 1);
  });
}

const targetOf = (s: WorkflowStep) => s.target ?? s.name;
const centre = (s: WorkflowStep) => ({ x: s.correctedX ?? s.x, y: s.correctedY ?? s.y });

/**
 * Brings a step up to date with the live screen: when its target sits elsewhere in the inventory
 * (moved, or reported in motion) it is re-pointed there and the move is the step's obstacle;
 * a target missing from a non-empty inventory is reported for grounding to find.
 */
export function refreshStep(step: WorkflowStep, inventory: InventoryElement[]): { step: WorkflowStep; obstacle: string | null } {
  if (!step.target || !inventory.length) return { step, obstacle: null };
  const e = findElement(inventory, step.target);
  if (!e) return { step, obstacle: `"${step.target}" not on screen — grounding will search for it` };
  const now = boxCenter(e.box);
  const was = centre(step);
  if (Math.hypot(now.x - was.x, now.y - was.y) <= 0.02 && e.state !== 'in-motion') return { step, obstacle: null };
  const moved = { ...step, x: now.x, y: now.y, correctedX: undefined, correctedY: undefined, refFrame: undefined };
  return { step: moved, obstacle: `"${step.target}" ${e.state === 'in-motion' ? 'is in motion' : 'moved'} — re-pointed to ${e.cell}` };
}

const joinObstacles = (a: string | null, b: string | null | undefined) => [a, b].filter(Boolean).join('; ') || null;

/** Re-runs the selected steps of a flow in order, refreshing each against the live screen; stops at a halt. */
export async function runRetest(steps: WorkflowStep[], indices: number[], deps: RetestDeps): Promise<RetestStepResult[]> {
  const out: RetestStepResult[] = [];
  for (const index of selectSteps(steps.length, indices)) {
    const { step, obstacle } = deps.prepare(steps[index]);
    const r = await deps.perform(step, index);
    out.push({ index, stepId: step.id, name: step.name, target: targetOf(step), ok: r.ok, executed: r.executed, message: r.message, obstacle: joinObstacles(obstacle, r.obstacle) });
    if (r.halt) break;
  }
  return out;
}

/** The retest verdict: pass only when at least one step ran and every executed step passed and none was refused. */
export function retestSummary(results: RetestStepResult[], selected = results.length): RetestSummary {
  const ran = results.filter((r) => r.executed);
  const passed = ran.filter((r) => r.ok).length;
  const failed = results.length - passed;
  return { pass: ran.length > 0 && failed === 0, passed, failed, executed: ran.length, selected };
}

/** The flow's steps after a retest: each retested step marked done or failed, the rest left as they were. */
export function retestedSteps(steps: WorkflowStep[], results: RetestStepResult[]): WorkflowStep[] {
  const byIndex = new Map(results.map((r) => [r.index, r]));
  return steps.map((s, i) => {
    const r = byIndex.get(i);
    return r ? { ...s, status: r.ok ? 'done' : 'failed' } : s;
  });
}

/** One-line text of a retest summary. */
export const retestText = (s: RetestSummary) => `${s.pass ? 'PASS' : 'FAIL'} — ${s.passed}/${s.selected} step(s) passed${s.executed < s.selected ? `, ${s.selected - s.executed} not run` : ''}`;
