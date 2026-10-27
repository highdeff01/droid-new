import type { WorkflowStep } from './types.js';
import type { HabitOutcome } from './habits.js';

/** One simulated step: what the dry run reported. */
export interface SimStep {
  step: string;
  target: string;
  ok: boolean;
  message: string;
}

/** A finished simulation: every step's dry-run result and whether the whole flow would pass. */
export interface SimulationReport {
  app: string;
  steps: SimStep[];
  passed: boolean;
}

/** Runs one step as a dry run (no real input is ever dispatched). */
export type DryRunStep = (step: WorkflowStep) => Promise<{ ok: boolean; message: string }>;

/** The habits context simulated outcomes are learned under, kept apart from real runs in `app`. */
export const simulationContext = (app: string) => `simulation:${app.trim()}`;

/** Dry-runs `steps` in order through `dryRun`, stopping at the first failing step. */
export async function simulateFlow(app: string, steps: WorkflowStep[], dryRun: DryRunStep): Promise<SimulationReport> {
  const out: SimStep[] = [];
  for (const step of steps) {
    const r = await dryRun(step);
    out.push({ step: step.name, target: step.target ?? step.name, ok: r.ok, message: r.message });
    if (!r.ok) break;
  }
  return { app, steps: out, passed: out.length === steps.length && out.every((s) => s.ok) };
}

/** The report's steps as habit outcomes under the simulation context; a failure carries an avoid lesson. */
export function simulationOutcomes(report: SimulationReport): HabitOutcome[] {
  const context = simulationContext(report.app);
  return report.steps.map((s) => ({ target: s.target, context, success: s.ok, avoid: s.ok ? null : `dry run failed: ${s.message}` }));
}

/** One-line text of a simulation for the log. */
export function simulationText(r: SimulationReport): string {
  const ok = r.steps.filter((s) => s.ok).length;
  return `Simulation ${r.passed ? 'PASSED' : 'FAILED'} — ${ok}/${r.steps.length} step(s) passed as a dry run (no input sent)${r.passed ? '' : `: ${r.steps.find((s) => !s.ok)?.message ?? ''}`}`;
}
