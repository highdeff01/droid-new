import type { WorkflowStep } from './types.js';

/** The stages of an end-to-end self-test, in order. */
export type SelfTestStage = 'plan' | 'ground' | 'execute' | 'verify';

/** How one stage ended. */
export interface SelfTestStageResult {
  stage: SelfTestStage;
  ok: boolean;
  detail: string;
}

/** The report of one end-to-end self-test. */
export interface SelfTestReport {
  goal: string;
  time: number;
  /** True when its input ran as a dry run (disarmed). */
  dryRun: boolean;
  stages: SelfTestStageResult[];
  /** Every stage ran and passed. */
  pass: boolean;
}

/** One stage's answer. */
export interface StageAnswer {
  ok: boolean;
  detail: string;
}

/** What the self-test runs each stage with: the live planner, grounding, executor and goal verification. */
export interface SelfTestDeps {
  goal: string;
  dryRun: boolean;
  plan: (goal: string) => Promise<{ steps: WorkflowStep[]; detail: string }>;
  /** Grounds one step on the live frame; the returned step carries the grounded point. */
  ground: (step: WorkflowStep) => Promise<StageAnswer & { step: WorkflowStep }>;
  execute: (step: WorkflowStep) => Promise<StageAnswer>;
  verify: (goal: string, ran: WorkflowStep[]) => Promise<StageAnswer>;
  /** Why the test must stop now (abort, stage unchecked), or null. */
  stopped: () => string | null;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Thrown to end the test at a failed stage. */
class StageFailed extends Error {}

/** Collects the stage results; a failed stage ends the test. */
class Run {
  readonly stages: SelfTestStageResult[] = [];

  constructor(private readonly deps: SelfTestDeps) {}

  /** Runs `call` as `stage`: a stop reason, a throw or a not-ok answer fails it. */
  async stage<T extends StageAnswer>(stage: SelfTestStage, call: () => Promise<T>): Promise<T> {
    const stop = this.deps.stopped();
    const answer: StageAnswer = stop ? { ok: false, detail: stop } : await call().catch((error: unknown) => ({ ok: false, detail: errorText(error) }));
    this.stages.push({ stage, ok: answer.ok, detail: answer.detail });
    if (!answer.ok) throw new StageFailed(answer.detail);
    return answer as T;
  }

  async run() {
    const { deps } = this;
    const planned = await this.stage('plan', async () => {
      const p = await deps.plan(deps.goal);
      return { ok: p.steps.length > 0, detail: p.steps.length ? `${p.steps.length} step(s) — ${p.detail}` : `no step planned — ${p.detail}`, steps: p.steps };
    });
    const grounded = await this.stage('ground', async () => {
      const each = [];
      for (const s of planned.steps) {
        const g = await deps.ground(s);
        if (!g.ok) return { ok: false, detail: `"${s.name}": ${g.detail}`, steps: [] };
        each.push(g);
      }
      return { ok: true, detail: each.map((g) => g.detail).join('; '), steps: each.map((g) => g.step) };
    });
    await this.stage('execute', async () => {
      const lines = [];
      for (const s of grounded.steps) {
        const e = await deps.execute(s);
        lines.push(`"${s.name}": ${e.detail}`);
        if (!e.ok) return { ok: false, detail: lines.join('; ') };
      }
      return { ok: true, detail: lines.join('; ') };
    });
    await this.stage('verify', () => deps.verify(deps.goal, grounded.steps));
  }
}

/**
 * The end-to-end self-test: plan the goal → ground every step on the live frame → execute them
 * through the gated executor → verify the goal on the live frame. Stops at the first failed stage;
 * the report lists each stage that ran and passes only when all four did.
 */
export async function runSelfTest(deps: SelfTestDeps, now = Date.now()): Promise<SelfTestReport> {
  const run = new Run(deps);
  try {
    await run.run();
  } catch (error) {
    if (!(error instanceof StageFailed)) throw error;
  }
  const pass = run.stages.length === 4 && run.stages.every((s) => s.ok);
  return { goal: deps.goal, time: now, dryRun: deps.dryRun, stages: run.stages, pass };
}

/** One-line text of a self-test report. */
export const selfTestText = (r: SelfTestReport) =>
  `Self-test ${r.pass ? 'PASSED' : 'FAILED'} for "${r.goal}"${r.dryRun ? ' (dry run)' : ''}: ${r.stages.map((s) => `${s.stage} ${s.ok ? 'ok' : 'failed'}`).join(' → ')}${r.pass ? '' : ` — ${r.stages[r.stages.length - 1]?.detail ?? ''}`}`;
