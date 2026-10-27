import type { ActionRecord, WorkflowStep } from './types.js';
import type { NoteDraft } from './watcher.js';
import type { ForwardedElement } from './agent-bus.js';
import { reverseAction } from './reverse.js';
import { spendAction, type ActionBudget } from './safety.js';
import { uid } from './planner.js';

/** Where side tests primarily run: background keeps the main capture and acts via the bridge; foreground switches the capture to the side target. */
export type SideTestMode = 'background' | 'foreground';
export const SIDE_TEST_MODES: readonly SideTestMode[] = ['background', 'foreground'];
export const DEFAULT_SIDE_TEST_MODE: SideTestMode = 'background';

/** The lifecycle phases of a side test, in order. */
export type SideTestPhase = 'switch' | 'research' | 'experiment' | 'capture' | 'backtrack' | 'return' | 'main';

/** How a side test ended. */
export type SideTestStatus = 'passed' | 'failed' | 'aborted' | 'halted' | 'skipped';

/** What one side test does: where it goes, what it researches, the experiment to try and undo, and the wanted main action. */
export interface SideTestPlan {
  name: string;
  /** The other program/window or URL the test goes to; empty stays on the main app. */
  target: string;
  mode: SideTestMode;
  /** A query or URL to research (browser fetch, reference image/video frame). */
  research?: string;
  /** The experimental action, undone (backtracked) after its result is captured. */
  experiment?: WorkflowStep;
  /** The wanted action run after the backtrack. */
  main?: WorkflowStep;
}

/** A named element position the sentinels watch. */
export interface WatchedPosition {
  name: string;
  x: number;
  y: number;
}

/** Something a sentinel noticed while the test ran; urgent alerts can trigger auto-acting. */
export interface SentinelAlert {
  kind: 'moved' | 'missing' | 'notification';
  text: string;
  urgent: boolean;
}

/** One finished phase. */
export interface PhaseResult {
  phase: SideTestPhase;
  ok: boolean;
  message: string;
}

/** The outcome of a side test. */
export interface SideTestResult {
  id: string;
  name: string;
  mode: SideTestMode;
  status: SideTestStatus;
  /** True when its input ran as a dry run (disarmed). */
  dryRun: boolean;
  phases: PhaseResult[];
  findings: string[];
  alerts: SentinelAlert[];
  /** Where it acted (the main or experiment point), normalized; for the bus. */
  at: { x: number; y: number };
}

/** The live guardrails, read before every action. */
export interface GuardState {
  aborted: boolean;
  armed: boolean;
  /** The side-tests loop-control stage is on. */
  stageOn: boolean;
}

/** A guardrail verdict: go (for real or as a dry run), or stop with a status. */
export type GuardVerdict = { go: true; dryRun: boolean } | { go: false; status: Extract<SideTestStatus, 'aborted' | 'halted' | 'skipped'>; reason: string };

/** Everything the lifecycle touches outside itself. */
export interface SideTestDeps {
  guard: () => GuardState;
  budget: ActionBudget;
  /** Switches the capture/focus to `target` (foreground) — or back to the main app when `target` is empty. */
  switchTo: (target: string) => Promise<{ ok: boolean; message: string }>;
  /** Performs one step; the record is the real action performed (absent in a dry run). */
  act: (step: WorkflowStep, dryRun: boolean) => Promise<{ ok: boolean; message: string; record?: ActionRecord }>;
  /** Captures and describes the screen after the experiment. */
  capture: () => Promise<string>;
  /** Fetches research findings for a query/URL. */
  research: (query: string) => Promise<string[]>;
  /** The sentinels' scan of the other elements and notifications. */
  sentinels: () => Promise<SentinelAlert[]>;
  /** Called with each urgent alert so auto-acting can trigger. */
  onAlert: (alert: SentinelAlert) => void;
  log: (message: string, tone: 'info' | 'ok' | 'warn' | 'error') => void;
}

/**
 * The guardrail check before one action: aborted (kill switch) stops, the stage off skips, an exhausted
 * budget halts; disarmed goes on as a dry run without spending budget.
 */
export function guardCheck(g: GuardState, budget: ActionBudget): GuardVerdict {
  if (g.aborted) return { go: false, status: 'aborted', reason: 'kill switch — aborted' };
  if (!g.stageOn) return { go: false, status: 'skipped', reason: 'side-tests stage is off in loop control' };
  if (!g.armed) return { go: true, dryRun: true };
  if (!spendAction(budget)) return { go: false, status: 'halted', reason: `action budget of ${budget.limit} spent` };
  return { go: true, dryRun: false };
}

/** Sentinel scan: watched elements that moved more than `tolerance` or disappeared, and every new notification (urgent). */
export function sentinelScan(before: WatchedPosition[], after: WatchedPosition[], notifications: string[], tolerance = 0.02): SentinelAlert[] {
  const now = new Map(after.map((p) => [p.name.trim().toLowerCase(), p]));
  const moves = before.flatMap((b): SentinelAlert[] => {
    const a = now.get(b.name.trim().toLowerCase());
    if (!a) return [{ kind: 'missing', text: `"${b.name}" disappeared — possible effect of the side test`, urgent: true }];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    return d > tolerance ? [{ kind: 'moved', text: `"${b.name}" moved ${(d * 100).toFixed(1)}% of the screen — cross-check its position`, urgent: false }] : [];
  });
  return [...moves, ...notifications.filter((n) => n.trim()).map((n): SentinelAlert => ({ kind: 'notification', text: `Notification: ${n.trim()}`, urgent: true }))];
}

/** Thrown inside the lifecycle to stop it with a status. */
class Stop extends Error {
  constructor(readonly status: SideTestStatus, reason: string) {
    super(reason);
  }
}

/** Runs the side test's lifecycle; each phase appends its result. */
class Lifecycle {
  readonly phases: PhaseResult[] = [];
  readonly findings: string[] = [];
  readonly alerts: SentinelAlert[] = [];
  dryRun = false;

  constructor(private readonly plan: SideTestPlan, private readonly deps: SideTestDeps) {}

  private record(phase: SideTestPhase, ok: boolean, message: string) {
    this.phases.push({ phase, ok, message });
    this.deps.log(`Side test "${this.plan.name}" ${phase}: ${message}`, ok ? 'info' : 'warn');
  }

  private check() {
    const v = guardCheck(this.deps.guard(), this.deps.budget);
    if (!v.go) throw new Stop(v.status, v.reason);
    this.dryRun ||= v.dryRun;
    return v.dryRun;
  }

  private async watch() {
    const alerts = await this.deps.sentinels();
    this.alerts.push(...alerts);
    for (const alert of alerts) if (alert.urgent) this.deps.onAlert(alert);
  }

  /** One guarded action plus a sentinel scan; a failed action fails the test. */
  private async act(phase: SideTestPhase, step: WorkflowStep): Promise<ActionRecord | undefined> {
    const r = await this.deps.act(step, this.check());
    this.record(phase, r.ok, r.message);
    await this.watch();
    if (!r.ok) throw new Stop('failed', r.message);
    return r.record;
  }

  private async switchTo(phase: SideTestPhase, target: string) {
    this.check();
    const r = await this.deps.switchTo(target);
    this.record(phase, r.ok, r.message);
    if (!r.ok) throw new Stop('failed', r.message);
  }

  private async backtrack(record: ActionRecord | undefined) {
    if (!record) return this.record('backtrack', true, 'nothing real to undo (dry run)');
    const reversal = reverseAction(record);
    if (!reversal.ok) throw new Stop('failed', `cannot backtrack: ${reversal.reason}`);
    for (const step of reversal.steps) await this.act('backtrack', step);
  }

  async run(): Promise<SideTestStatus> {
    const { plan, deps } = this;
    const away = plan.mode === 'foreground' && !!plan.target.trim();
    if (away) await this.switchTo('switch', plan.target);
    if (plan.research?.trim()) {
      this.check();
      const found = await deps.research(plan.research);
      this.findings.push(...found);
      this.record('research', true, `${found.length} finding(s) for "${plan.research}"`);
    }
    if (plan.experiment) {
      const done = await this.act('experiment', plan.experiment);
      const seen = await deps.capture();
      this.findings.push(`After "${plan.experiment.name}": ${seen}`);
      this.record('capture', true, seen);
      await this.backtrack(done);
    }
    if (away) await this.switchTo('return', '');
    if (plan.main) await this.act('main', plan.main);
    return 'passed';
  }
}

/**
 * Runs a side test inside the guardrails: (switch to the side target in foreground mode) → research →
 * experiment → capture → backtrack → (return) → main action, checking abort/stage/arm/budget before each
 * action and running the sentinels after each. Never throws for a guardrail; the status says how it ended.
 */
export async function runSideTest(plan: SideTestPlan, deps: SideTestDeps): Promise<SideTestResult> {
  const life = new Lifecycle(plan, deps);
  let status: SideTestStatus;
  try {
    status = await life.run();
  } catch (error) {
    if (!(error instanceof Stop)) throw error;
    status = error.status;
    deps.log(`Side test "${plan.name}" ${status}: ${error.message}`, status === 'aborted' || status === 'halted' ? 'warn' : 'error');
  }
  const point = plan.main ?? plan.experiment;
  return { id: uid('side'), name: plan.name, mode: plan.mode, status, dryRun: life.dryRun, phases: life.phases, findings: life.findings, alerts: life.alerts, at: { x: point?.x ?? 0.5, y: point?.y ?? 0.5 } };
}

/** The result's findings and sentinel alerts as watcher notes: findings are opportunities, alerts unusual. */
export function findingsToNotes(r: SideTestResult): NoteDraft[] {
  return [
    ...r.findings.map((f): NoteDraft => ({ kind: 'opportunity', text: `[Side test "${r.name}"] ${f}` })),
    ...r.alerts.map((a): NoteDraft => ({ kind: 'unusual', text: `[Side test "${r.name}" sentinel] ${a.text}` })),
  ];
}

/** One feedback line for the main AI: how the test ended and what it learned. */
export function feedbackLine(r: SideTestResult): string {
  const last = r.phases[r.phases.length - 1];
  return `[Side test] "${r.name}" (${r.mode}${r.dryRun ? ', dry run' : ''}) ${r.status}: ${r.phases.map((p) => `${p.phase} ${p.ok ? 'ok' : 'failed'}`).join(' → ') || 'no phase ran'}${last ? ` — ${last.message}` : ''}; ${r.findings.length} finding(s), ${r.alerts.length} sentinel alert(s)`;
}

/** The result as an element forwarded on the agent bus, so every agent and the main AI get the feedback. */
export const busFeedback = (r: SideTestResult): ForwardedElement => ({ name: feedbackLine(r), x: r.at.x, y: r.at.y });
