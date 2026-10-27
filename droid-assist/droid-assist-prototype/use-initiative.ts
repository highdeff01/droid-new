import { useEffect, useRef, useState } from 'react';
import type { AssistSettings, Frame, LogEntry, SavedCard, WorkflowStep } from './types.js';
import { POINTER_ACTIONS } from './types.js';
import type { AskFn } from './ai.js';
import type { Thought } from './assist-ai.js';
import { stageOff, type StageId } from './loop-control.js';
import { createBudget, type ActionBudget } from './safety.js';
import type { StepOutcome } from './run-step.js';
import { loadInitiative, saveInitiative } from './storage.js';
import { CATEGORY_NAME, CATEGORY_STAGE, STRESS_LIMIT, addEntry, addProposal, applyEdits, disposition, editsText, nextScanDelay, setStatus, storableStep, type InitiativeCategory, type InitiativeProposal, type InitiativeState, type WorkflowPack } from './initiative.js';
import { findingProposal, scanScreen, scanSummary } from './initiative-scan.js';
import { askWorkaround, localWorkaround, type KnownPoint, type Workaround } from './workarounds.js';
import { nextSelfTest, selfTestStep, stressReport, stressSteps, stressText, type StressResult, type TestTarget } from './self-test.js';
import { packCard, packProposal, verifyPack, workflowCandidate } from './workflow-proposal.js';

/** Log source of every initiative line. */
export const INITIATIVE_SOURCE = 'AI initiative';

/** Steps the workflow verifier checks on the screen; local steps (calc, search, wait, ...) have no target to verify. */
const SCREEN_ACTIONS = new Set<WorkflowStep['action']>([...POINTER_ACTIONS, 'type', 'key']);

/** What the initiative layer needs from the engine: guardrails, the AI, the one execution path and memory. */
export interface InitiativeDeps {
  settings: () => AssistSettings;
  stageOn: (id: StageId) => boolean;
  askFor: (stage: StageId) => AskFn;
  thought: <T extends Thought>(step: string, call: () => Promise<T>, summary: (r: T) => string | null) => Promise<T>;
  addLog: (source: string, message: string, tone: LogEntry['tone']) => void;
  aiOnline: () => boolean;
  /** A live capture to scan, and the page is not paused while hidden. */
  screenReady: () => boolean;
  executorBusy: () => boolean;
  aborted: () => boolean;
  armed: () => boolean;
  frame: () => Frame | null;
  steps: () => WorkflowStep[];
  setSteps: (steps: WorkflowStep[]) => void;
  goal: () => string;
  /** The engine's gated execution path (abort, executor stage, arm, budget). */
  performStep: (step: WorkflowStep, actor: string, budget: ActionBudget, dryRun: boolean) => Promise<StepOutcome & { halt?: boolean }>;
  highlight: (p: { x: number; y: number; label: string }) => void;
  testTargets: () => TestTarget[];
  known: () => KnownPoint[];
  cards: () => SavedCard[];
  saveCard: (card: SavedCard) => void;
  /** One real outcome on a target, into its habit. */
  recordHabit: (target: string, success: boolean) => void;
  /** Appends a run summary to the run stats. */
  recordRun: (goal: string, steps: WorkflowStep[], opts: { dryRun: boolean; stopped: boolean }, startedAt: number) => void;
}

type Draft = Omit<InitiativeProposal, 'id' | 'time' | 'status'>;
type Applied = { ok: boolean; message: string };
/** A learned workflow waiting for verification, with each step's reference screenshot from the run (never stored in the pack). */
type Candidate = { pack: Omit<WorkflowPack, 'checks'>; frames: Record<string, Frame> };

/** Each step's template: its recorded reference, else the screenshot taken just before it ran. */
const templates = (steps: WorkflowStep[]): Record<string, Frame> =>
  Object.fromEntries(steps.flatMap((s) => {
    const f = s.refFrame ?? s.beforeFrame;
    return f ? [[s.id, f]] : [];
  }));

/**
 * AI initiative: periodic (and AI-requested) screen scans, self-tests of mapped and familiar
 * elements, workarounds after a failed run, agent-verified workflow packs from successful runs,
 * and the heavy element tester. Every initiative passes the guardrails (abort, its loop-control
 * stage, arm and the initiative budget for input) and is a proposal unless its category auto-applies.
 */
export function useInitiative(d: InitiativeDeps) {
  const [initiative, setInitiative] = useState<InitiativeState>(loadInitiative);
  const stateRef = useRef(initiative);
  const busyRef = useRef(false);
  const budgetRef = useRef<ActionBudget>(createBudget(d.settings().actionBudget));
  const testedRef = useRef<Record<string, number>>({});
  /** Workflows learned from successful runs, waiting for the agent to verify them. */
  const candidatesRef = useRef<Candidate[]>([]);
  const tickRef = useRef<() => Promise<number | undefined>>(async () => undefined);
  const renewRef = useRef(() => {});
  useEffect(() => saveInitiative(initiative), [initiative]);

  const update = (fn: (s: InitiativeState) => InitiativeState) => {
    stateRef.current = fn(stateRef.current);
    setInitiative(stateRef.current);
  };

  /** One line in the initiative log and the activity log. */
  const record = (category: InitiativeCategory, text: string, ok: boolean, tone: LogEntry['tone'] = ok ? 'ok' : 'warn') => {
    update((s) => ({ ...s, log: addEntry(s.log, { category, text, ok }) }));
    d.addLog(INITIATIVE_SOURCE, `${CATEGORY_NAME[category]}: ${text}`, tone);
  };

  /** Input runs dry unless armed; a self-test in the background never sends input. */
  const dryRunFor = (category: InitiativeCategory) => !d.armed() || (category === 'selfTest' && d.settings().selfTestMode === 'background');

  /** A step through the gated pipeline, highlighted in the foreground; a real outcome feeds the target's habit. */
  const runStep = async (category: InitiativeCategory, step: WorkflowStep): Promise<Applied> => {
    const dryRun = dryRunFor(category);
    if (!(category === 'selfTest' && d.settings().selfTestMode === 'background')) d.highlight({ x: step.x, y: step.y, label: step.target ?? step.name });
    const out = await d.performStep(step, `${INITIATIVE_SOURCE} (${CATEGORY_NAME[category]}${dryRun ? ', dry run' : ''})`, budgetRef.current, dryRun);
    if (!dryRun && !out.halt && step.target) d.recordHabit(step.target, out.ok);
    if (category === 'selfTest' && step.target) testedRef.current[step.target] = Date.now();
    return { ok: out.ok, message: out.message };
  };

  /** How an accepted or auto-applied proposal of each category is carried out. */
  const APPLY: Record<InitiativeCategory, (p: InitiativeProposal) => Promise<Applied>> = {
    scan: async (p) => (p.step ? runStep('scan', p.step) : { ok: true, message: 'noted (no action needed)' }),
    selfTest: async (p) => (p.step ? runStep('selfTest', p.step) : { ok: false, message: 'no element to test' }),
    workaround: async (p) => {
      const next = p.edits ? applyEdits(d.steps(), p.edits) : null;
      if (!next) return { ok: false, message: 'it no longer fits the current steps' };
      d.setSteps(next);
      return { ok: true, message: `workflow edited: ${editsText(p.edits!)}` };
    },
    workflow: async (p) => {
      if (!p.pack) return { ok: false, message: 'no workflow pack' };
      d.saveCard(packCard(p.pack));
      return { ok: true, message: `saved "${p.pack.name}" to the Library` };
    },
  };

  const apply = async (p: InitiativeProposal, how: string) => {
    const r = await APPLY[p.category](p);
    if (r.ok) update((s) => ({ ...s, proposals: setStatus(s.proposals, p.id, 'applied') }));
    record(p.category, `${how} "${p.text}" — ${r.message}`, r.ok);
  };

  const budgetLeft = () => budgetRef.current.limit - budgetRef.current.used;

  /** The guardrail verdict for one initiative of `category`. */
  const judge = (category: InitiativeCategory, needsInput: boolean) => disposition(category, {
    aborted: d.aborted(),
    stageOn: d.stageOn(CATEGORY_STAGE[category]),
    stageOffText: stageOff(CATEGORY_STAGE[category]),
    autoApply: d.settings().initiativeAutoApply[category],
    armed: d.armed(),
    budgetLeft: budgetLeft(),
    needsInput,
  });

  /** Offers one initiative: blocked by a guardrail, logged as a proposal, or auto-applied. */
  const offer = async (draft: Draft, needsInput: boolean) => {
    const verdict = judge(draft.category, needsInput);
    if (verdict.kind === 'blocked') {
      d.addLog(INITIATIVE_SOURCE, `${CATEGORY_NAME[draft.category]} "${draft.text}" not started — ${verdict.reason}`, 'warn');
      return;
    }
    const { proposals, added } = addProposal(stateRef.current.proposals, draft);
    if (!added) return;
    update((s) => ({ ...s, proposals }));
    if (verdict.kind === 'propose') record(draft.category, `proposed "${draft.text}" (${verdict.reason})`, true, 'info');
    else await apply(added, 'auto-applied');
  };

  /** Whether a scan step or self-test would send input when applied. */
  const sendsInput = (category: InitiativeCategory, step?: WorkflowStep) => !!step && !dryRunFor(category);

  /** One scan of the live frame; resolves the seconds the AI asked to wait, when it did. */
  const scan = async (): Promise<number | undefined> => {
    const frame = d.frame();
    if (!frame || !d.aiOnline() || !d.screenReady() || !d.stageOn('initiativeScan')) return undefined;
    try {
      const recent = stateRef.current.proposals.filter((p) => p.category === 'scan').map((p) => p.text);
      const r = await d.thought('Initiative scan', () => scanScreen(d.askFor('initiativeScan'), frame, d.steps(), d.goal(), recent), scanSummary);
      for (const f of r.findings) await offer(findingProposal(f), !!f.step);
      return r.nextScanSec;
    } catch (error) {
      d.addLog(INITIATIVE_SOURCE, `Screen scan: AI unavailable — no findings this round: ${error instanceof Error ? error.message : String(error)}`, 'warn');
      return undefined;
    }
  };

  /** Sets up the next self-test: the mapped or familiar element tested longest ago. */
  const selfTest = async () => {
    if (!d.stageOn('selfTest')) return;
    const target = nextSelfTest(d.testTargets(), testedRef.current);
    if (!target) return;
    testedRef.current[target.name] = Date.now();
    const step = selfTestStep(target);
    await offer({ category: 'selfTest', text: `Test that "${target.name}" still clicks correctly`, step }, sendsInput('selfTest', step));
  };

  /** One initiative round (never while busy, aborted or the executor runs): scan, verify learned workflows, then one self-test. */
  const tick = async (): Promise<number | undefined> => {
    if (busyRef.current || d.executorBusy() || d.aborted()) return undefined;
    busyRef.current = true;
    try {
      const ai = await scan();
      if (!d.executorBusy() && !d.aborted()) await verifyCandidates();
      if (!d.executorBusy() && !d.aborted()) await selfTest();
      return ai;
    } finally {
      busyRef.current = false;
    }
  };
  tickRef.current = tick;
  renewRef.current = () => {
    budgetRef.current = createBudget(d.settings().actionBudget);
  };

  // The scan loop at the user's interval (sooner when the AI asks), while either initiative stage is on;
  // each switch-on renews the initiative budget.
  const { scanSec } = d.settings();
  const loopOn = d.stageOn('initiativeScan') || d.stageOn('selfTest');
  useEffect(() => {
    if (!loopOn) return undefined;
    renewRef.current();
    let timer: ReturnType<typeof setTimeout>;
    let live = true;
    const schedule = (ms: number) => {
      timer = setTimeout(async () => {
        const ai = await tickRef.current();
        if (live) schedule(nextScanDelay(scanSec, ai));
      }, ms);
    };
    schedule(nextScanDelay(scanSec));
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [loopOn, scanSec]);

  /** A workaround for the first failed step: the AI's when it is online and answers, else the local one. */
  const workaroundFor = async (steps: WorkflowStep[], failed: number): Promise<Workaround | null> => {
    if (d.aiOnline()) {
      try {
        const { workaround } = await d.thought('Workaround', () => askWorkaround(d.askFor('workarounds'), d.frame(), steps, failed, `"${steps[failed - 1].name}" failed`, d.goal()), ({ workaround: w }) => (w ? `${editsText(w.edits)} — ${w.reason}` : 'No AI workaround'));
        if (workaround) return workaround;
      } catch {
        // The local workaround below still applies.
      }
    }
    return localWorkaround(steps, failed, d.known());
  };

  /**
   * Verifies the queued workflow candidates step by step with a dry-run agent and proposes only
   * the verified ones. Runs on the initiative loop, never inside the run that produced them.
   */
  const verifyCandidates = async () => {
    const queued = candidatesRef.current.splice(0);
    if (!d.stageOn('workflowCreation')) return;
    for (const candidate of queued) await verifyAndPropose(candidate);
  };

  const verifyAndPropose = async ({ pack: candidate, frames }: Candidate) => {
    const verifier = createBudget(d.settings().actionBudget);
    const { verified, pack } = await verifyPack(candidate, async (step) => {
      if (!SCREEN_ACTIONS.has(step.action)) return { ok: true, message: 'no screen target — nothing to verify' };
      const refFrame = frames[step.id];
      if (!refFrame) return { ok: false, message: 'no reference screenshot from the run — the target cannot be confirmed' };
      // The step's screenshot from the run is the template: the dry run fails when the target is no longer there.
      const out = await d.performStep({ ...step, refFrame, status: 'pending' }, `${INITIATIVE_SOURCE} (workflow verifier, dry run)`, verifier, true);
      return { ok: out.ok, message: out.message };
    });
    if (!verified) {
      record('workflow', `"${pack.name}" not proposed — agent verification failed: ${pack.checks[pack.checks.length - 1]}`, false);
      return;
    }
    await offer(packProposal(pack), false);
  };

  /**
   * After a finished run: a failed step gets a workaround; a run whose every step succeeded (as
   * a dry run or for real) becomes a candidate workflow. Stopped runs are ignored.
   */
  const afterRun = async (goal: string, steps: WorkflowStep[], { dryRun, stopped }: { dryRun: boolean; stopped: boolean }) => {
    if (stopped || !steps.length || d.aborted()) return;
    const failed = steps.findIndex((s) => s.status === 'failed') + 1;
    if (failed && d.stageOn('workarounds')) {
      const w = await workaroundFor(steps, failed);
      if (w) await offer({ category: 'workaround', text: `After "${steps[failed - 1].name}" failed: ${editsText(w.edits)} (${w.reason})`, edits: w.edits }, false);
      return;
    }
    const succeeded = steps.every((s) => (dryRun ? s.status !== 'failed' : s.status === 'done' || s.status === 'drift'));
    if (failed || !succeeded || !d.stageOn('workflowCreation')) return;
    const candidate = workflowCandidate(goal, steps.map(storableStep), d.cards(), stateRef.current.proposals);
    if (!candidate || candidatesRef.current.some((c) => c.pack.name === candidate.name)) return;
    candidatesRef.current.push({ pack: candidate, frames: templates(steps) });
    record('workflow', `learned candidate "${candidate.name}" (${candidate.steps.length} step(s)) — an agent verifies it before it is proposed`, true, 'info');
  };

  const findPending = (id: string) => stateRef.current.proposals.find((p) => p.id === id && p.status === 'pending');

  /** Accept: the guardrails still apply (abort, stage); input runs dry unless armed. */
  const acceptInitiative = async (id: string) => {
    const p = findPending(id);
    if (!p) return;
    const stage = CATEGORY_STAGE[p.category];
    if (d.aborted() || !d.stageOn(stage)) {
      d.addLog(INITIATIVE_SOURCE, `"${p.text}" not applied — ${d.aborted() ? 'ABORTED is active' : stageOff(stage)}`, 'warn');
      return;
    }
    await apply(p, 'accepted');
  };

  const dismissInitiative = (id: string) => {
    const p = findPending(id);
    if (!p) return;
    update((s) => ({ ...s, proposals: setStatus(s.proposals, id, 'dismissed') }));
    record(p.category, `dismissed "${p.text}"`, true, 'info');
  };

  /** Scan now (the button, or the AI's own request), outside the timer. */
  const scanNow = () => tick();

  /**
   * The heavy element tester: click/type/drag cycles on one element through the gated pipeline,
   * each screenshotted by the pipeline; the reliability report goes to the panel, real cycles to
   * the element's habit, and the run to the run stats.
   */
  const stressTest = async (target: TestTarget) => {
    if (d.aborted() || !d.stageOn('selfTest')) {
      d.addLog(INITIATIVE_SOURCE, `Stress test of "${target.name}" not started — ${d.aborted() ? 'ABORTED is active' : stageOff('selfTest')}`, 'warn');
      return;
    }
    if (busyRef.current || d.executorBusy()) {
      d.addLog(INITIATIVE_SOURCE, `Busy — stress test of "${target.name}" not started`, 'warn');
      return;
    }
    busyRef.current = true;
    const startedAt = Date.now();
    const dryRun = !d.armed();
    const budget = createBudget(d.settings().actionBudget);
    const results: StressResult[] = [];
    const ran: WorkflowStep[] = [];
    let stopped = false;
    let refusal = '';
    try {
      d.highlight({ x: target.x, y: target.y, label: target.name });
      for (const step of stressSteps(target, d.settings().stressCycles)) {
        if (d.aborted()) {
          stopped = true;
          break;
        }
        const out = await d.performStep(step, `${INITIATIVE_SOURCE} (stress test${dryRun ? ', dry run' : ''})`, budget, dryRun);
        if (out.halt) {
          // A guardrail refusal says nothing about the element: stop without counting it.
          refusal = out.message;
          stopped = true;
          break;
        }
        results.push({ action: step.action, ok: out.ok });
        ran.push({ ...step, status: out.ok ? 'done' : 'failed' });
        if (!dryRun) d.recordHabit(target.name, out.ok);
      }
    } finally {
      busyRef.current = false;
    }
    if (refusal) d.addLog(INITIATIVE_SOURCE, `Stress test of "${target.name}" stopped — ${refusal}`, 'warn');
    if (!results.length) return undefined;
    const report = stressReport(target.name, results, dryRun);
    update((s) => ({ ...s, stress: [report, ...s.stress].slice(0, STRESS_LIMIT) }));
    d.recordRun(`Stress test "${target.name}"`, ran, { dryRun, stopped }, startedAt);
    record('selfTest', `stress test ${stressText(report)}`, report.reliability >= 0.5);
    return report;
  };

  return { initiative, acceptInitiative, dismissInitiative, scanNow, stressTest, afterRun };
}
