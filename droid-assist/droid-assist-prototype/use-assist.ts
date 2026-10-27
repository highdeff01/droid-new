import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionRecord, Annotation, AssistSettings, FamiliarElement, Frame, Habit, InputAction, LearnedPattern, LogEntry, SavedCard, ScreenSource, StepAction, SyncLevel, TrailPoint, WorkflowStep } from './types.js';
import { POINTER_ACTIONS } from './types.js';
import { MATCHED, SAMPLE_H, SAMPLE_W, SEARCH_RADIUS, STABLE, boundingBox, boxDistance, correctDrift, diffCells, frameDistance, largestCluster, matchTemplate, syncLevelFor, type DriftThresholds } from './drift.js';
import { AD_CYCLE, demoAd, demoDrag, demoFileAt, demoPlayButton, drawDemoDesktop, findIcon, initialDemoFile, initialDemoIcons, moveIcon, type DemoFile, type DemoIcon } from './demo-desktop.js';
import { AI_PLAN_SOURCE, calculate, generateCard, patternLine, planFromGoal, planRemaining, relevantPatterns, relocateTarget, replanDrag, replanStep, uid } from './planner.js';
import { checkMoved, sameElement, verifyArrangement, type Expectation, type MovedElement } from './rearrange.js';
import { AI_VIEWS, AiCancelled, AiParseError, DEFAULT_AI_MODEL, DEFAULT_AI_TIMEOUT_MS, DEFAULT_AI_URL, DEFAULT_AI_VIEW, createAiSession, linkSignals, pingAi } from './ai.js';
import type { AiReply, AiStatus, AskFn, AskRequest, HistoryChangeFn } from './ai.js';
import { historyChangeText } from './ai-history.js';
import { DEFAULT_STAGES, createStageControllers, stageOff, toggleMessage, type StageId } from './loop-control.js';
import { DEFAULT_AI_MAX_IN_FLIGHT, createAiQueue, type AiQueue, type AiQueueStats } from './ai-queue.js';
import { confirmTarget, decidePopup, describeScreen, judgeStep, reflectOn, verifyGoal, type GoalCheck, type PopupDecision, type StepResult, type TargetCheck, type Thought } from './assist-ai.js';
import { DEFAULT_GRID_OPACITY } from './grid-overlay.js';
import { MARKER_OF, createCursorAnimator, type CursorAnimator } from './cursor-path.js';
import { DEFAULT_MAX_ITERATIONS, autoContinue, judgeCheck, type ContinueStop, type RunReport } from './auto-continue.js';
import { DEFAULT_CHANGE_CELLS, assessChange, changeText, detectChange, type ChangeAssessment, type ScreenChange } from './screen-change.js';
import { localProposal, proposalText, proposeStep, type Proposal, type ProposalContext } from './proposal.js';
import { addEntry, verdictText, type ThinkingEntry, type ThoughtKind } from './thinking-timeline.js';
import { BRIDGE_REQUIRED, captureDesktop, checkBridge, dragEnd, selfTestBridge, type BridgeResult } from './bridge.js';
import { DRY_RUN, dragEndError, runStep, type Grounding, type StepOutcome } from './run-step.js';
import { DEFAULT_STEP_RETRIES, avoidPattern, describeAttempt, runLadder, type Attempt } from './retry-ladder.js';
import { boxedFrames, patchAt, renderView, zoomBox, zoomFrame } from './grounding.js';
import { parseCommand } from './commands.js';
import { createPlanGuard } from './plan-guard.js';
import { createScreenCapture, fullJpeg, monitorInterval, type CapturedImage, type ScreenCapture } from './capture.js';
import { DEFAULT_ABORT_HOTKEY, DEFAULT_ACTION_BUDGET, createBudget, dispatchState, matchesHotkey, spendAction, type ActionBudget, type HotkeyEvent } from './safety.js';
import { continuesScroll, keyCombo, keyStep, scrollStep, stepDelay } from './recorder.js';
import { LOG_LIMIT, loadCards, loadElementMap, loadFamiliar, loadHabits, loadLog, loadPatterns, loadRunSummaries, loadSettings, loadTriggers, loadWatcher, saveCards, saveElementMap, saveFamiliar, saveHabits, saveLog, savePatterns, saveRunSummaries, saveSettings, saveTriggers, saveWatcher } from './storage.js';
import { TRIGGER_LIMIT, TRIGGER_TICK_MS, afterFire, afterSkip, conditionText, createTrigger, fireGate, observeElement, outcomeText, resolveTarget, scheduleDue, type ElementSnapshot, type ElementTrigger, type RunOutcome, type ScheduleTrigger, type Trigger, type TriggerDraft } from './triggers.js';
import { appendSummary, runSummary, type RunSummary } from './run-stats.js';
import { addTest, mergeNotes, mergeProposals, observeScreen, patchProposal, proposalStep, reorderSteps, type Observation, type ProposalKind, type WatchProposal, type WatcherState } from './watcher.js';
import { forgetElement, listElements, rememberElement, type ScreenElement } from './elements.js';
import { gridRef } from './grid.js';
import { POINTER_LIMIT, detectDwell, dwellObservation, findFamiliar, learnCoordinate, learnedSeed, learnedTargets, type CoordObservation } from './coords.js';
import { boxCenter, mapContext, mapElement, toFamiliar, unmapElement, type MappedElement } from './element-map-studio.js';
import { cropFrame, identifyAndVerify, identifyRequest, noteChange, parseIdentification, recentlySent, type AgentCheck, type ChangeHit, type IdentifyInput, type IdentifyOutcome, type IdentifyReason, type Identification } from './identify.js';
import type { Box } from './assist-ai.js';
import { decodeFrames, toStoredFrame } from './frame-codec.js';
import { loadStoredFrames, putStoredFrame } from './frame-store.js';
import { appendHistory, clearHistory, downloadText, historyToCsv, historyToJson, loadHistory } from './action-history.js';
import { REVERSE_ACTOR, reverseOffer } from './reverse.js';
import { failurePattern, flowCard, learnPatterns, mergePatterns, newPattern, runVerdict, upsertCard } from './flow-memory.js';
import { SUPERVISOR_INTERVAL_MS, SUPERVISOR_TICK_MS, applyFixes, executorBusy as supervisorExecutorBusy, habitPatterns, isConfident, reviewRun, reviewText, staleFixes, type PendingFix, type SupervisorReview, type SupervisorState } from './supervisor.js';
import { BUS_AGENTS, elementLine, forward, markHandled, predefine, type BusAgentId, type BusMessage, type ForwardedElement } from './agent-bus.js';
import { isTestGoal, listSections, parseTestSpec, planSubagents, reportPatterns, runSubagents, summaryText, type SubagentOutcome, type SubagentReport, type SubagentTask, type TestRequest } from './subagents.js';
import { useErrorForwarding } from './use-error-forwarding.js';
import { buildElementMap } from './element-map.js';
import type { Calibration } from './calibration.js';
import { remapStep, useMeasure } from './use-measure.js';
import { anchoredHabit, habitLine, recordOutcome, relevantHabits, seedFromAnchor, strengthenHabit, togglePin } from './habits.js';
import type { StepVerdict } from './assist-ai.js';
import { addBriefing, briefingText, buildBriefing, type Briefing } from './briefing.js';
import { reviewBriefing, type ReviewDeps } from './briefing-review.js';
import type { Knowledge } from './cross-reference.js';
import { useResolution } from './use-resolution.js';
import { DISAGREEMENT_THRESHOLD } from './resolution-center.js';

const DEMO_W = 960;
const DEMO_H = 540;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** Log text of a failed model call: a user cancel says so, anything else is the endpoint failure after `what`. */
const aiFailure = (what: string, error: unknown) => (error instanceof AiCancelled ? `AI call cancelled by the user — ${what.replace(/^AI unavailable — /, '')}` : `${what}: ${errorText(error)}`);
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

/** Draws a source into a Frame: a 480×270 display JPEG, the full-resolution JPEG for the model and the 320×180 drift buffer. */
function toFrame(src: CanvasImageSource, srcW: number, srcH: number, id: number, source: Frame['source']): Frame {
  const small = document.createElement('canvas');
  small.width = SAMPLE_W;
  small.height = SAMPLE_H;
  const sctx = small.getContext('2d', { willReadFrequently: true })!;
  sctx.drawImage(src, 0, 0, SAMPLE_W, SAMPLE_H);
  const view = document.createElement('canvas');
  view.width = 480;
  view.height = 270;
  view.getContext('2d')!.drawImage(src, 0, 0, 480, 270);
  return { id, time: Date.now(), url: view.toDataURL('image/jpeg', 0.7), full: fullJpeg(src, srcW, srcH), data: sctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H), srcW, srcH, source };
}

/** A real desktop screenshot from the bridge as a Frame; throws with the bridge's reason. */
async function desktopFrame(bridgeUrl: string, token: string, id: number): Promise<Frame> {
  const shot = await captureDesktop(bridgeUrl, token);
  if (!shot.ok) throw new Error(shot.message);
  const img = new Image();
  img.src = shot.frame.image;
  await img.decode();
  return toFrame(img, shot.frame.width || img.naturalWidth, shot.frame.height || img.naturalHeight, id, 'desktop');
}

/** Workflow actions that are real mouse/keyboard input, as recorded in the action history. */
const INPUT_ACTIONS: Partial<Record<StepAction, InputAction>> = { click: 'click', double_click: 'double_click', move: 'move', drag: 'drag', scroll: 'scroll', type: 'type', key: 'key' };

/** Steps the browser itself answers on the demo desktop (no screen input). */
const LOCAL_ACTIONS: Partial<Record<StepAction, (step: WorkflowStep) => Promise<{ ok: boolean; message: string }>>> = {
  calc: async (s) => {
    const v = calculate(s.text ?? '');
    return v === null ? { ok: false, message: `"${s.text ?? ''}" is not a valid expression` } : { ok: true, message: `${s.text} = ${v}` };
  },
  search: async (s) => {
    window.open(`https://duckduckgo.com/?q=${encodeURIComponent(s.text ?? '')}`, '_blank', 'noopener');
    return { ok: true, message: `Opened a search for "${s.text ?? ''}"` };
  },
  wait: async () => {
    await sleep(800);
    return { ok: true, message: 'Waited' };
  },
};

/** One step's real result plus whether the run must stop (abort, disarm, budget) and, for a drag, what it grabbed and moved. */
type Performed = StepOutcome & { halt?: boolean; grabbed?: string; moved?: MovedElement; replanned?: boolean };

/** Auto Act's continuation state: the goal it verifies, checks in a row without progress, rounds made. */
type AutoLoop = { goal: string; stalls: number; iteration: number };

const refused = (step: WorkflowStep, message: string): Performed => ({ ok: false, executed: false, halt: true, message, target: { x: step.x, y: step.y } });

const at = (x: number, y: number) => `(${(x * 100).toFixed(1)}%, ${(y * 100).toFixed(1)}%)`;
/** Timeline text of a popup decision. */
const popupSummary = (d: PopupDecision) => (d.close ? `Close the popup at ${at(d.x, d.y)} — ${d.reason}` : `Leave it — ${d.reason}`);
/** The executor's verdict on a step before dispatch: run it as proposed, wait, or fail honestly. */
type Justified = { kind: 'go'; step: WorkflowStep; proposal: Proposal } | { kind: 'wait'; reason: string } | { kind: 'fail'; reason: string };
/** Describes the pending step for the screen-change responder. */
const describeNext = (s: WorkflowStep | undefined) => (s ? `"${s.name}" — ${s.action} "${s.target ?? s.name}" at ${at(s.correctedX ?? s.x, s.correctedY ?? s.y)}` : null);
/**
 * The step a proposal runs: a local proposal or a first proposal of a template-recorded step runs as
 * planned (the template locates the target); otherwise at the proposed point, dropping a stale template on a re-proposal.
 */
function adopt(step: WorkflowStep, p: Proposal, redo: boolean): WorkflowStep {
  if (p.source === 'local' || (step.refFrame && !redo)) return step;
  return { ...step, x: p.x, y: p.y, ...(redo ? { refFrame: undefined, correctedX: undefined, correctedY: undefined } : {}) };
}
/** Timeline text of a model plan; null for a reused saved flow (no model call). */
const planSummary = (r: { source: string; steps: WorkflowStep[] }) => (r.source.startsWith(AI_PLAN_SOURCE) ? `${r.steps.length} step(s): ${r.steps.map((s) => `${s.action} "${s.target ?? s.name}"`).join(' → ')}` : null);
/** Timeline text of a grounding check on a zoomed crop. */
const checkSummary = (step: WorkflowStep, p: { x: number; y: number }) => (c: TargetCheck) => `${c.visible ? 'Target confirmed' : 'Target not'} at ${at(p.x, p.y)} for "${step.target ?? step.name}" — ${c.reason}`;
/** Timeline and log text of an auto-continue goal check. */
const goalSummary = (c: GoalCheck) => `${c.complete ? 'Goal COMPLETE' : 'Goal not complete'}${c.complete ? '' : c.progress ? ' (progress made)' : ' (no progress)'} — ${c.reason}`;
/** One-line text of a plan's steps. */
const stepsText = (steps: WorkflowStep[]) => steps.map((s) => `${s.action} "${s.target ?? s.name}"`).join(' → ');
/** Log tone of each way an auto-continue loop ends. */
const STOP_TONE: Record<ContinueStop, LogEntry['tone']> = { complete: 'ok', aborted: 'warn', halted: 'error', cap: 'warn', 'no-progress': 'warn' };

/** Timeline text of a watcher observation. */
const observationSummary = (o: Observation) => `${o.notes.length} note(s), ${o.proposals.length} proposal(s)${o.notes.length ? `: ${o.notes.map((n) => n.text).join('; ')}` : ''}`;

/** Default settings. */
export const DEFAULT_SETTINGS: AssistSettings = {
  gallerySize: 10,
  checkpoints: 6,
  captureMs: 500,
  changeCells: DEFAULT_CHANGE_CELLS,
  driftStable: STABLE,
  driftMatched: MATCHED,
  driftRadius: SEARCH_RADIUS,
  monitorMode: 'app',
  displayId: null,
  watchMs: 5000,
  autoAct: false,
  aiHelp: true,
  showTrail: true,
  showGrid: true,
  gridLabels: false,
  gridOpacity: DEFAULT_GRID_OPACITY,
  bridgeUrl: '',
  bridgeToken: '',
  abortHotkey: DEFAULT_ABORT_HOTKEY,
  actionBudget: DEFAULT_ACTION_BUDGET,
  aiUrl: DEFAULT_AI_URL,
  aiModel: DEFAULT_AI_MODEL,
  aiView: DEFAULT_AI_VIEW,
  autoContinue: true,
  maxIterations: DEFAULT_MAX_ITERATIONS,
  stepRetries: DEFAULT_STEP_RETRIES,
  aiMaxInFlight: DEFAULT_AI_MAX_IN_FLIGHT,
  aiTimeoutMs: DEFAULT_AI_TIMEOUT_MS,
  stages: DEFAULT_STAGES,
  errorUrl: '',
  errorForwarding: false,
  errorToken: '',
};

/** A background agent the user can toggle; each also has an inbox on the inter-agent bus. */
export interface Agent {
  id: Exclude<BusAgentId, 'habits'> | 'identify';
  name: string;
  description: string;
  on: boolean;
}

/**
 * The assistant engine: screen capture (demo, screen share, desktop bridge), monitor modes,
 * visual error detection, recording, grounded real input, replay, Auto Act, AI plan/help,
 * slash commands, action history and saved workflows.
 */
export function useAssist() {
  const [settings, setSettings] = useState<AssistSettings>(() => loadSettings(DEFAULT_SETTINGS));
  const [source, setSource] = useState<ScreenSource>('demo');
  /** The app the assistant is attached to via /use. */
  const [target, setTarget] = useState<string | null>(null);
  const [history, setHistory] = useState<ActionRecord[]>(() => loadHistory());
  /** Normalized point the last executed pointer action left the cursor at: the previously-focused point of the next action. */
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const [reversing, setReversing] = useState(false);
  const [shotCount, setShotCount] = useState(0);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [pinned, setPinned] = useState<Frame[]>([]);
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [trail, setTrail] = useState<TrailPoint[]>([]);
  const [recording, setRecording] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [sync, setSync] = useState<{ level: SyncLevel; detail: string }>({ level: 'idle', detail: 'No active step' });
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const animatorRef = useRef<CursorAnimator | null>(null);
  /** The AI cursor animator: every frame of a movement moves the cursor and extends the trail. */
  const animator = () => (animatorRef.current ??= createCursorAnimator({
    frame: (p) => {
      setCursor(p);
      setTrail((t) => [...t, { x: p.x, y: p.y, t: Date.now() }].slice(-1500));
    },
    mark: (p) => setTrail((t) => [...t, p].slice(-1500)),
  }));
  /** Shows one attempt at `p` as a humanized AI cursor movement. */
  const aim = (p: { x: number; y: number }) => animator().aim(p);
  const [log, setLog] = useState<LogEntry[]>(loadLog);
  const [cards, setCards] = useState<SavedCard[]>([]);
  /** Lessons learned from finished runs, fed into future planning. */
  const [patterns, setPatterns] = useState<LearnedPattern[]>(loadPatterns);
  const [familiar, setFamiliar] = useState<FamiliarElement[]>(loadFamiliar);
  const [elementMap, setElementMap] = useState<MappedElement[]>([]);
  const [mapMode, setMapMode] = useState(false);
  const [mapDraft, setMapDraft] = useState<Box | null>(null);
  /** Per-target, per-app habits learned from every executed step, applied to planning and grounding. */
  const [habits, setHabits] = useState<Habit[]>(() => loadHabits());
  /** One summary per finished run (newest first), for the Stats panel. */
  const [runs, setRuns] = useState<RunSummary[]>(loadRunSummaries);
  /** The Screen watcher's notes, proposals and test results (persisted). */
  const [watcher, setWatcher] = useState<WatcherState>(loadWatcher);
  const [triggers, setTriggers] = useState<Trigger[]>(loadTriggers);
  const [highlight, setHighlight] = useState<{ x: number; y: number; label: string } | null>(null);
  const [draftCard, setDraftCard] = useState<{ name: string; description: string } | null>(null);
  const [goal, setGoal] = useState('');
  const [progress, setProgress] = useState({ done: 0, manual: 0 });
  const [agents, setAgents] = useState<Agent[]>([
    { id: 'popup', name: 'Popup watcher', description: 'Flags ads & intrusive popups, auto-closes when Auto act is on', on: true },
    { id: 'drift', name: 'Drift monitor', description: 'Cross-checks every frame against the active step', on: true },
    { id: 'progress', name: 'Progress tracker', description: 'Counts verified steps toward the goal', on: true },
    { id: 'goal', name: 'Goal reviewer', description: 'Reviews the goal after each run and suggests what is next', on: true },
    { id: 'identify', name: 'Element identifier', description: 'Sends missed, unproposed, new or changing elements to the AI and agent-tests the answer (3 tries / 30 s)', on: true },
    { id: 'screen', name: BUS_AGENTS.screen, description: 'Observes forwarded elements on the live screen', on: true },
    { id: 'coords', name: 'Coordinate learner', description: 'Learns target coordinates from cursor dwell and verified actions; seeds grounding with them', on: true },
    { id: 'supervisor', name: 'Supervisor', description: 'Reviews all agents, screenshots and thinking; applies confident fixes, performs them if the executor does not, and splits link/route tests into subagents', on: true },
  ]);
  /** The inter-agent message bus: every forwarded element in each recipient's inbox, newest first. */
  const [bus, setBus] = useState<BusMessage[]>([]);
  /** Elements the coordinate learner predefined from forwards, newest first. */
  const [knownElements, setKnownElements] = useState<ForwardedElement[]>([]);
  /** The latest link/route subagent test report; null before the first. */
  const [subReport, setSubReport] = useState<SubagentReport | null>(null);
  const [subRunning, setSubRunning] = useState(false);
  const [plays, setPlays] = useState(0);
  const [armed, setArmed] = useState(false);
  /** The last health check or bridge call reached the PC (and the PC did not fail it). */
  const [bridgeOnline, setBridgeOnline] = useState(false);
  const [aborted, setAborted] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus>({ state: 'checking', detail: 'Connecting to the AI endpoint…' });
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  /** Model calls in flight (planning, reflecting, deciding, verifying). */
  const [aiCalls, setAiCalls] = useState(0);
  /** Shared AI queue: calls waiting for a slot and calls running against the endpoint. */
  const [aiQueue, setAiQueue] = useState<AiQueueStats>({ queued: 0, inFlight: 0 });
  /** An auto-continue loop is running. */
  const [continuing, setContinuing] = useState(false);
  /** Per-step Qwen thinking timeline, newest first: thought, reflection and verdict of every AI call. */
  const [timeline, setTimeline] = useState<ThinkingEntry[]>([]);
  /** Pre-action briefings, newest first (in memory, BRIEFING_LIMIT), one per dispatched step. */
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [captureLost, setCaptureLost] = useState<string | null>(null);
  const [supervisor, setSupervisor] = useState<SupervisorState>({ status: 'idle', detail: 'No review yet', review: null, applied: false });

  const demoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureRef = useRef<ScreenCapture | null>(null);
  const tickRef = useRef(0);
  /** The demo desktop's draggable Report file. */
  const demoFileRef = useRef<DemoFile>(initialDemoFile());
  /** The demo desktop's rearrangeable sidebar icons. */
  const demoIconsRef = useRef<DemoIcon[]>(initialDemoIcons());
  /** The arrangement the current plan asks for (from the planner's "expect"). */
  const expectRef = useRef<Expectation[]>([]);
  const dismissedCycleRef = useRef(-1);
  const framesRef = useRef<Frame[]>([]);
  const stepsRef = useRef<WorkflowStep[]>([]);
  const settingsRef = useRef(settings);
  const sourceRef = useRef(source);
  /** Set when the user explicitly picks the demo desktop; the bridge then no longer takes over. */
  const demoChosenRef = useRef(false);
  const popupRef = useRef<Annotation | null>(null);
  const popupBaseRef = useRef<Frame | null>(null);
  const popupFrameRef = useRef<Frame | null>(null);
  /** The popup the model already ruled on, so it is asked once per popup. */
  const popupDecidedRef = useRef<string | null>(null);
  const abortRef = useRef(false);
  const autoBusyRef = useRef(false);
  const pollBusyRef = useRef(false);
  const lastPollErrorAt = useRef(0);
  const frameId = useRef(Date.now());
  const restoredIdsRef = useRef(new Set<number>());
  const cardsHydratedRef = useRef(false);
  const lastStepAt = useRef(0);
  const armedRef = useRef(armed);
  const abortedRef = useRef(aborted);
  const autoBudgetRef = useRef<ActionBudget>(createBudget(settings.actionBudget));
  /** Trims and resets of the AI history land here (wired to the log once addLog exists). */
  const historyChangeRef = useRef<HistoryChangeFn>(() => undefined);
  const aiSessionRef = useRef(createAiSession(typeof sessionStorage === 'undefined' ? null : sessionStorage, renderView, (c) => historyChangeRef.current(c)));
  const [aiHistory, setAiHistory] = useState(() => aiSessionRef.current.history());
  /** Cancels every in-flight model call when aborted; replaced by a fresh one after each cancel. */
  const aiCtrlRef = useRef(new AbortController());
  /** Loop control: one controller per stage, so unchecking a stage cancels only its in-flight calls. */
  const stageCtrlsRef = useRef(createStageControllers());
  /** Shared model-call queue: executor/grounding first, pipeline next, agents last; at most aiMaxInFlight running. */
  const [aiQueueApi] = useState(() => createAiQueue(settings.aiMaxInFlight, setAiQueue, settings.aiTimeoutMs));
  const aiQueueRef = useRef<AiQueue>(aiQueueApi);
  const aiStatusRef = useRef(aiStatus);
  const logRef = useRef(log);
  const goalRef = useRef(goal);
  const replayingRef = useRef(false);
  const recordingRef = useRef(false);
  /** Time of the last recorded input (or of recording start), for each recorded step's measured human pause. */
  const lastInputRef = useRef(0);
  const cardsRef = useRef<SavedCard[]>([]);
  const patternsRef = useRef<LearnedPattern[]>(patterns);
  /** Re-plan loop guard for autoPlan, the plan in flight, and step status changes made by execution. */
  const planGuardRef = useRef(createPlanGuard());
  const planningRef = useRef(false);
  const statusChangesRef = useRef(0);
  const habitsRef = useRef<Habit[]>(habits);
  const familiarRef = useRef<FamiliarElement[]>(familiar);
  /** Live cursor positions over the stage, for the coordinate learner's dwell detection. */
  const pointerRef = useRef<TrailPoint[]>([]);
  /** Start time of the last dwell the coordinate learner handled, so each rest is observed once. */
  const dwellSeenRef = useRef(-1);
  const targetRef = useRef(target);
  /** Whether any step of the current Auto Act run was only a dry run (such a run is never saved). */
  const autoDryRef = useRef(false);
  /** This app session (one page load), stamped on every run summary. */
  const sessionRef = useRef(uid('session'));
  /** When the current run started; null between runs. */
  const runStartRef = useRef<number | null>(null);
  /** The saved flow (card id) the current steps came from or were saved as; null for a fresh plan. */
  const flowRef = useRef<string | null>(null);
  /** Auto Act's verify → plan → continue loop while it is running; null between loops. */
  const autoLoopRef = useRef<AutoLoop | null>(null);
  const timelineRef = useRef(timeline);
  const syncRef = useRef(sync);
  const progressRef = useRef(progress);
  /** Corrections the supervisor applied that the executor has not carried out yet. */
  const pendingFixesRef = useRef<PendingFix[]>([]);
  const supervisorBusyRef = useRef(false);
  /** Set while the supervisor itself moves the pointer; Auto Act waits for it. */
  const supervisorMovingRef = useRef(false);
  const lastReviewAt = useRef(Date.now());
  const supervisorRef = useRef(supervisor);
  const busRef = useRef<BusMessage[]>([]);
  const knownRef = useRef<ForwardedElement[]>([]);
  /** True while link/route subagents hold the screen; Auto Act pauses meanwhile. */
  const subRunningRef = useRef(false);
  const elementMapRef = useRef<MappedElement[]>([]);
  const mapHydratedRef = useRef(false);
  const changeHitsRef = useRef<ChangeHit[]>([]);
  const identifySentRef = useRef<Array<{ box: Box; time: number }>>([]);
  const identifyBusyRef = useRef(false);
  const watcherRef = useRef(watcher);
  const triggersRef = useRef(triggers);
  /** A triggered run is in flight; no other trigger fires until it finishes. */
  const triggerBusyRef = useRef(false);
  /** The frame id element triggers last evaluated, and each watched element's state on it. */
  const triggerFrameRef = useRef<number | null>(null);
  const elementSnapsRef = useRef(new Map<string, ElementSnapshot>());
  const aiBusyRef = useRef(aiBusy);
  aiBusyRef.current = aiBusy;
  /** A watcher observation or test is in flight; ticks never overlap and Auto Act waits for it. */
  const watchBusyRef = useRef(false);
  /** Real-input budget of the watcher's armed tests, renewed each time the watcher is switched on. */
  const watchBudgetRef = useRef<ActionBudget>(createBudget(settings.actionBudget));
  /** The frame the next material screen change is measured against. */
  const changeBaseRef = useRef<Frame | null>(null);
  /** The in-flight change assessment; the executor waits for it before proposing. */
  const changeBusyRef = useRef<Promise<void> | null>(null);
  /** The latest change assessment and when it was made. */
  const lastChangeRef = useRef<{ at: number; assessment: ChangeAssessment } | null>(null);
  /** When the current plan was made (planned, loaded or recorded). */
  const planAtRef = useRef(0);
  /** A stale-plan assessment already answered by a re-proposal. */
  const staleHandledRef = useRef<ChangeAssessment | null>(null);
  /** Steps that already used their one re-proposal. */
  const reproposedRef = useRef(new Set<string>());

  supervisorRef.current = supervisor;
  timelineRef.current = timeline;
  syncRef.current = sync;
  progressRef.current = progress;
  settingsRef.current = settings;
  sourceRef.current = source;
  aiStatusRef.current = aiStatus;
  logRef.current = log;
  goalRef.current = goal;
  stepsRef.current = steps;
  armedRef.current = armed;
  abortedRef.current = aborted;
  replayingRef.current = replaying;
  recordingRef.current = recording;
  cardsRef.current = cards;
  patternsRef.current = patterns;
  habitsRef.current = habits;
  familiarRef.current = familiar;
  targetRef.current = target;

  const intervalMs = monitorInterval(settings.monitorMode, settings.captureMs);

  // Persistence: settings, log and cards.
  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => aiQueueRef.current.setLimit(settings.aiMaxInFlight), [settings.aiMaxInFlight]);
  useEffect(() => aiQueueRef.current.setTimeoutMs(settings.aiTimeoutMs), [settings.aiTimeoutMs]);
  useEffect(() => saveLog(log), [log]);
  useEffect(() => savePatterns(patterns), [patterns]);
  useEffect(() => saveFamiliar(familiar), [familiar]);
  useEffect(() => saveHabits(habits), [habits]);
  useEffect(() => saveRunSummaries(runs), [runs]);
  useEffect(() => saveWatcher(watcher), [watcher]);
  useEffect(() => saveTriggers(triggers), [triggers]);
  useEffect(() => {
    if (cardsHydratedRef.current) saveCards(cards);
  }, [cards]);
  useEffect(() => {
    if (mapHydratedRef.current) saveElementMap(elementMap);
  }, [elementMap]);

  // Hydrate saved cards, the element map and the recent frame gallery.
  useEffect(() => {
    let live = true;
    void loadElementMap().then((stored) => {
      if (!live) return;
      mapHydratedRef.current = true;
      elementMapRef.current = [...elementMapRef.current, ...stored.filter((s) => !elementMapRef.current.some((x) => x.id === s.id))];
      setElementMap(elementMapRef.current);
    });
    void loadCards().then((stored) => {
      if (!live) return;
      cardsHydratedRef.current = true;
      setCards((c) => [...c, ...stored.filter((s) => !c.some((x) => x.id === s.id))]);
    });
    const { gallerySize } = settingsRef.current;
    void loadStoredFrames(gallerySize).then(decodeFrames).then((restored) => {
      if (!live || !restored.length) return;
      restored.forEach((f) => restoredIdsRef.current.add(f.id));
      framesRef.current = [...framesRef.current, ...restored].slice(0, gallerySize);
      setFrames(framesRef.current);
    }).catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const addLog = useCallback((from: string, message: string, tone: LogEntry['tone'] = 'info', shots?: string[]) => {
    setLog((l) => [{ id: uid('log'), time: Date.now(), source: from, message, tone, ...(shots?.length ? { shots } : {}) }, ...l].slice(0, LOG_LIMIT));
  }, []);

  /** Every trim or reset of the AI conversation history is logged and shown. */
  historyChangeRef.current = (change) => {
    setAiHistory(aiSessionRef.current.history());
    addLog('AI history', historyChangeText(change), change.reason === 'manual' ? 'info' : 'warn');
  };

  /** Keeps only the newest `keep` messages of the AI conversation. */
  const trimAiHistory = useCallback((keep: number) => aiSessionRef.current.trim(keep), []);

  /** Cancels in-flight model calls and clears the AI conversation entirely. */
  const resetAiSession = useCallback(() => {
    aiCtrlRef.current.abort();
    aiCtrlRef.current = new AbortController();
    aiSessionRef.current.reset();
  }, []);

  /** Error forwarding: reports carry the recent log and the current frame. */
  const errorForwarding = useErrorForwarding(settings, addLog, () => ({ log: logRef.current, frame: framesRef.current[0] ?? null }));
  const captureError = errorForwarding.capture;

  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  /** The element map the ruler and the measure action resolve names against. */
  const measureMap = useCallback(() => buildElementMap(annotationsRef.current, stepsRef.current, cardsRef.current), []);

  /** Recalibration drift: workflow steps and saved flows move into the live layout. */
  const rescaleStored = useCallback((cal: Calibration) => {
    stepsRef.current = stepsRef.current.map((s) => remapStep(cal, s));
    setSteps(stepsRef.current);
    cardsRef.current = cardsRef.current.map((c) => ({ ...c, steps: c.steps.map((s) => remapStep(cal, s)) }));
    setCards(cardsRef.current);
  }, []);

  const ruler = useMeasure({ frames, framesRef, elementMap: measureMap, addLog, rescale: rescaleStored });

  // AI endpoint health: at startup and whenever the endpoint or model changes.
  useEffect(() => {
    let live = true;
    setAiStatus({ state: 'checking', detail: `Connecting to ${settings.aiUrl}…` });
    void pingAi({ url: settings.aiUrl, model: settings.aiModel }).then((status) => {
      if (!live) return;
      setAiStatus(status);
      addLog('AI', status.detail, status.state === 'online' ? 'ok' : 'error');
      if (status.state !== 'online') captureError({ kind: 'ai', message: status.detail });
    });
    return () => {
      live = false;
    };
  }, [settings.aiUrl, settings.aiModel, addLog, captureError]);

  /** Whether a loop-control stage is checked; read live so a toggle applies mid-run. */
  const stageOn = (id: StageId) => settingsRef.current.stages[id];

  /** The drift thresholds and search radius from Settings; read live so a change applies mid-run. */
  const driftThresholds = (): DriftThresholds => {
    const { driftStable, driftMatched, driftRadius } = settingsRef.current;
    return { stable: driftStable, matched: driftMatched, radius: driftRadius };
  };
  /** The step's template matched on `live` at its recorded point with the Settings radius, and its sync level. */
  const driftCheck = (step: WorkflowStep, live: Frame) => {
    const t = driftThresholds();
    const r = matchTemplate(step.refFrame!.data, live.data, step.x, step.y, { radius: t.radius });
    return { r, level: syncLevelFor(r, t) };
  };

  /**
   * Every model call, made on behalf of a loop-control `stage`: with session history and the recent
   * log, cancellable through aiCtrlRef (abort) and the stage's own controller (unchecking it).
   * An unchecked stage is refused as a cancel. A failure marks the AI offline and is rethrown; a cancel is rethrown as is.
   */
  const askAi = useCallback(async (req: AskRequest, stage: StageId): Promise<AiReply> => {
    if (!settingsRef.current.stages[stage]) throw new AiCancelled(stageOff(stage));
    const context = req.context ?? logRef.current.slice(0, 8).map((l) => `[${l.source}] ${l.message}`);
    const signal = linkSignals(aiCtrlRef.current.signal, stageCtrlsRef.current.signal(stage), req.signal);
    setAiCalls((n) => n + 1);
    try {
      const reply = await aiQueueRef.current.run(stage, (timeoutMs) => {
        const { aiUrl, aiModel, aiView } = settingsRef.current;
        return aiSessionRef.current.ask({ url: aiUrl, model: aiModel, view: AI_VIEWS[aiView], timeoutMs }, { ...req, context, signal });
      }, signal);
      setAiHistory(aiSessionRef.current.history());
      const { aiModel } = settingsRef.current;
      if (aiStatusRef.current.state !== 'online') setAiStatus({ state: 'online', detail: `Connected · ${aiModel}` });
      return reply;
    } catch (error) {
      if (!(error instanceof AiCancelled)) {
        setAiStatus({ state: 'offline', detail: `AI unavailable — ${errorText(error)}` });
        captureError({ kind: 'ai', message: `AI unavailable — ${errorText(error)}`, goal: goalRef.current });
      }
      throw error;
    } finally {
      setAiCalls((n) => n - 1);
    }
  }, [captureError]);

  /** The AskFn of one loop-control stage. */
  const askFor = useCallback((stage: StageId): AskFn => (req) => askAi(req, stage), [askAi]);

  /** Cancels the in-flight model calls at once; later calls get a fresh controller. */
  const cancelAi = useCallback(() => {
    aiCtrlRef.current.abort();
    aiCtrlRef.current = new AbortController();
    aiSessionRef.current.cancel();
  }, []);

  const aiOnline = () => aiStatusRef.current.state === 'online';

  const note = useCallback((entry: Omit<ThinkingEntry, 'id' | 'time'>) => setTimeline((t) => addEntry(t, entry)), []);

  /**
   * A reply that held no JSON is logged as an AI parse failure with its truncated raw text — never shown as an answer —
   * and counts toward the session's stale-context guard.
   */
  const reportParseFailure = useCallback((step: string, error: unknown) => {
    if (!(error instanceof AiParseError)) return;
    addLog('AI parse', `Unparseable reply for "${step}" (raw, truncated): ${error.raw}`, 'error');
    aiSessionRef.current.noteParse(false);
  }, [addLog]);

  /**
   * Runs one AI decision and records its initial thinking on the timeline, or the failure
   * when the call fails (rethrown). `summary` returning null means no model call was made.
   */
  const thought = useCallback(async <T extends Thought>(step: string, call: () => Promise<T>, summary: (r: T) => string | null, kind: ThoughtKind = 'thought'): Promise<T> => {
    try {
      const r = await call();
      const text = summary(r);
      if (text !== null) {
        note({ step, kind, text, thinking: r.thinking });
        aiSessionRef.current.noteParse(true);
      }
      return r;
    } catch (error) {
      note({ step, kind, text: '', thinking: null, error: errorText(error) });
      reportParseFailure(step, error);
      throw error;
    }
  }, [note, reportParseFailure]);

  /**
   * Reflect-after-step: the model's reflection and final verdict on an executed step go on the
   * timeline and the verdict into the activity log. A failure is logged as such — never invented.
   * Resolves the verdict, or null when the reflection failed.
   */
  const reflectAfter = useCallback(async (step: WorkflowStep, frame: Frame | null, result: StepResult, logSource: string): Promise<StepVerdict | null> => {
    if (!settingsRef.current.stages.reflect) return null;
    try {
      const reflection = await reflectOn(askFor('reflect'), frame, step, result, goalRef.current);
      note({ step: step.name, kind: 'reflection', text: reflection.text, thinking: reflection.thinking });
      if (!settingsRef.current.stages.verdict) return null;
      const verdict = await judgeStep(askFor('verdict'), frame, step, result, goalRef.current, reflection.raw);
      const text = verdictText(verdict);
      note({ step: step.name, kind: 'verdict', text, thinking: verdict.thinking });
      addLog(logSource, `Verdict on "${step.name}": ${text}`, verdict.success ? 'ok' : 'warn');
      return verdict;
    } catch (error) {
      note({ step: step.name, kind: 'verdict', text: '', thinking: null, error: errorText(error) });
      reportParseFailure(step.name, error);
      addLog(logSource, aiFailure(`No verdict for "${step.name}" — AI reflection failed`, error), 'error');
      return null;
    }
  }, [addLog, askFor, note, reportParseFailure]);

  /** Replaces the habits (persisted by the effect above). */
  const commitHabits = useCallback((next: Habit[]) => {
    habitsRef.current = next;
    setHabits(next);
  }, []);

  /** The app/window the habits of this moment belong to. */
  const habitContext = () => targetRef.current ?? '';
  const habitTarget = (step: WorkflowStep) => step.target ?? step.name;

  /** A step's reflect verdict updates its habit: attempt, success and the verdict's lessons. */
  const learnHabit = (step: WorkflowStep, verdict: StepVerdict) => {
    if (!stageOn('coords')) return;
    commitHabits(recordOutcome(habitsRef.current, { target: habitTarget(step), context: habitContext(), success: verdict.success, avoid: verdict.pattern_avoid, add: verdict.pattern_add }));
  };

  /** A verified target point strengthens its habit's remembered coordinates. */
  const strengthen = (live: Frame, step: WorkflowStep, p: { x: number; y: number }) => {
    if (!stageOn('coords')) return;
    commitHabits(strengthenHabit(habitsRef.current, habitTarget(step), habitContext(), live.data, p));
  };

  /** A reliable habit's remembered position of the step's target, found on `live` by template match. */
  const habitSeed = (live: Frame, step: WorkflowStep) => {
    if (!stageOn('coords')) return null;
    const habit = anchoredHabit(habitsRef.current, habitTarget(step), habitContext());
    return habit?.anchor ? seedFromAnchor(habit.anchor, live.data) : null;
  };

  const deleteHabit = (id: string) => commitHabits(habitsRef.current.filter((h) => h.id !== id));
  const pinHabit = (id: string) => commitHabits(togglePin(habitsRef.current, id));

  /**
   * The AI grounding pass run-step uses: confirm on a zoomed crop, re-ask the planner once.
   * Each check and the re-ask record their thinking on the step's timeline.
   */
  const grounding: Grounding = {
    confirm: async (live, step, p) => {
      const crop = await zoomFrame(live, p);
      const check = await thought(step.name, () => confirmTarget(askFor('grounding'), live, crop, step), checkSummary(step, p));
      if (check.visible) forwardElement('drift', { name: step.target ?? step.name, x: p.x, y: p.y });
      return check;
    },
    relocate: async (live, step, feedback) => {
      const { point } = await thought(step.name, async () => {
        const crop = await zoomFrame(live, step).catch(() => undefined);
        const next = await relocateTarget(askFor('grounding'), live, step, feedback, mapContext(elementMapRef.current), crop);
        return { point: next, thinking: next?.thinking ?? null };
      }, (r) => (r.point ? `Re-planned "${step.target ?? step.name}" at ${at(r.point.x, r.point.y)}` : `Re-planned: "${step.target ?? step.name}" is not visible`));
      return point;
    },
  };

  /** Adds learned patterns (newest first, deduplicated) to the persisted store. */
  const addPatterns = useCallback((added: LearnedPattern[]) => {
    patternsRef.current = mergePatterns(patternsRef.current, added);
    setPatterns(patternsRef.current);
  }, []);

  const deletePattern = (id: string) => {
    patternsRef.current = patternsRef.current.filter((p) => p.id !== id);
    setPatterns(patternsRef.current);
  };

  /** Saves a successful run as a card, replacing a near-duplicate of the same flow. */
  const autoSaveFlow = useCallback((runGoal: string, runSteps: WorkflowStep[]) => {
    const { cards: next, replaced } = upsertCard(cardsRef.current, flowCard(runGoal, runSteps));
    cardsRef.current = next;
    flowRef.current = next[0].id;
    setCards(next);
    addLog('Library', `Flow saved: "${next[0].name}" (${runSteps.length} step(s), drift-corrected)${replaced ? ` — updated the existing "${replaced.name}"` : ''}`, 'ok');
  }, [addLog]);

  /** Appends the finished run's summary (goal, steps, duration, outcome, flow) to the persisted run records. */
  const recordRun = useCallback((runGoal: string, runSteps: WorkflowStep[], opts: { dryRun: boolean; stopped: boolean }) => {
    const startedAt = runStartRef.current ?? Date.now();
    runStartRef.current = null;
    const summary = runSummary({ goal: runGoal, steps: runSteps, startedAt, ...opts, session: sessionRef.current, flowId: flowRef.current });
    setRuns((r) => appendSummary(r, summary));
  }, []);

  /**
   * Run memory: a successful real run is saved as a flow; a failed one records its failure
   * pattern instead. Either way the model is asked for lessons; its failure never blocks saving.
   * Every finished run, remembered or not, leaves a run summary.
   */
  const learnFromRun = useCallback(async (runSteps: WorkflowStep[], opts: { dryRun: boolean; stopped: boolean }) => {
    const verdict = runVerdict(runSteps, opts);
    const runGoal = goalRef.current.trim();
    if (verdict === 'success' && stageOn('supervisor')) autoSaveFlow(runGoal, runSteps);
    recordRun(runGoal, runSteps, opts);
    if (verdict === 'ignored' || !stageOn('supervisor')) return;
    if (verdict === 'failed') {
      const lesson = failurePattern(runGoal, runSteps);
      addPatterns([lesson]);
      addLog('Patterns', `Run failed — not saved as a flow. Learned: avoid ${lesson.pattern}`, 'warn');
    }
    try {
      const learned = await learnPatterns(askFor('supervisor'), runGoal, runSteps, verdict);
      if (learned.length) addPatterns(learned);
      addLog('Patterns', learned.length ? `AI learned ${learned.length} pattern(s): ${learned.map((p) => `${p.kind} "${p.pattern}"`).join('; ')}` : 'AI found no new pattern in this run', 'info');
    } catch (error) {
      addLog('Patterns', `AI unavailable — no patterns learned from this run: ${errorText(error)}`, 'warn');
    }
  }, [addLog, addPatterns, askFor, autoSaveFlow, recordRun]);

  const triggerAbort = useCallback((reason: string) => {
    abortRef.current = true;
    abortedRef.current = true;
    cancelAi();
    setAborted(true);
    setSettings((s) => ({ ...s, autoAct: false }));
    addLog('Safety', `ABORTED (${reason}) — Auto Act, replay, auto-continue, monitor automation and in-flight AI calls halted`, 'error');
  }, [addLog, cancelAi]);

  const clearAbort = () => {
    abortedRef.current = false;
    setAborted(false);
    addLog('Safety', 'Abort cleared — automation may run again', 'warn');
  };

  const toggleArmed = () => {
    const next = !armedRef.current;
    armedRef.current = next;
    setArmed(next);
    addLog('Safety', next ? 'Real input ARMED — runs will dispatch to the PC' : 'Real input DISARMED — runs execute as dry runs', next ? 'warn' : 'ok');
  };

  // Emergency-stop hotkey, captured at window level so it fires even inside inputs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!matchesHotkey(e, settings.abortHotkey)) return;
      e.preventDefault();
      triggerAbort(`hotkey ${settings.abortHotkey}`);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [settings.abortHotkey, triggerAbort]);

  // Each switch-on of Auto Act starts a new run with a fresh budget.
  useEffect(() => {
    if (settings.autoAct) autoBudgetRef.current = createBudget(settingsRef.current.actionBudget);
  }, [settings.autoAct]);

  /**
   * Checked before every real dispatch: refuses (and halts the run) when aborted, when real
   * input was disarmed mid-run, or when the run's action budget is spent.
   */
  const gateRealInput = useCallback((budget: ActionBudget): string | null => {
    if (abortedRef.current) return 'Aborted — real input not sent';
    if (!armedRef.current) return 'Real input disarmed — not sent';
    if (spendAction(budget)) return null;
    addLog('Safety', `Action budget reached: ${budget.limit} real input action(s) this run — stopping`, 'error');
    return `Action budget of ${budget.limit} exceeded — not sent`;
  }, [addLog]);

  /**
   * Loop control: checks or unchecks one stage. Unchecking cancels that stage's in-flight model
   * calls at once. Every toggle is logged with its time. Guardrails are not stages and stay on.
   */
  const toggleStage = (id: StageId, on: boolean) => {
    settingsRef.current = { ...settingsRef.current, stages: { ...settingsRef.current.stages, [id]: on } };
    setSettings((s) => ({ ...s, stages: { ...s.stages, [id]: on } }));
    if (!on) {
      aiQueueRef.current.drain(id);
      stageCtrlsRef.current.cancel(id);
    }
    addLog('Loop control', toggleMessage(id, on), on ? 'ok' : 'warn');
  };

  /** Coordinate learner: records one observation in the familiar memory and logs a target that moved. */
  const learnCoords = (obs: CoordObservation) => {
    const { list, moved } = learnCoordinate(familiarRef.current, obs);
    familiarRef.current = list;
    setFamiliar((latest) => learnCoordinate(latest, obs).list);
    if (moved) addLog('Coordinate learner', `"${moved.name}" moved (${pct(moved.from.x)}, ${pct(moved.from.y)}) → (${pct(moved.to.x)}, ${pct(moved.to.y)}) — coordinates updated`, 'info');
  };

  /** The learned position of the step's target on `live` (learner on, anchor matched), or null. */
  const learnedPoint = (live: Frame, step: WorkflowStep) => {
    if (!stageOn('coords')) return null;
    const el = findFamiliar(familiarRef.current, step.target ?? step.name);
    return el ? learnedSeed(el, live.data) : null;
  };

  /** The executor is running (Auto Act, replay, a running step, or an AI command): the learner pauses. */
  const executorBusy = () => autoBusyRef.current || replayingRef.current || aiBusyRef.current || stepsRef.current.some((s) => s.status === 'running');

  /** Dwell learning on a new frame: the cursor resting over a learned target re-observes it there. */
  const learnFromDwell = (frame: Frame) => {
    if (!stageOn('coords') || executorBusy()) return;
    const now = Date.now();
    const dwell = detectDwell(pointerRef.current, now);
    if (!dwell || dwell.since === dwellSeenRef.current) return;
    dwellSeenRef.current = dwell.since;
    const obs = dwellObservation(familiarRef.current, dwell, frame, now);
    if (obs) learnCoords(obs);
  };

  /** Outcome learning: an executed pointer action teaches its target's coordinates, on the frame it was aimed on. */
  const learnFromOutcome = (step: WorkflowStep, out: Performed, frame: Frame | null) => {
    if (!stageOn('coords') || !out.executed || !out.ok || !POINTER_ACTIONS.has(step.action)) return;
    learnCoords({ name: step.target ?? step.name, x: out.target.x, y: out.target.y, frame, time: Date.now() });
  };

  const agentOn = useCallback((id: Agent['id']) => agents.find((a) => a.id === id)?.on ?? false, [agents]);
  const agentsRef = useRef(agentOn);
  agentsRef.current = agentOn;

  /** What each recipient does with a forwarded element; the returned note is shown on its inbox message. */
  const busHandlers: Record<BusAgentId, (e: ForwardedElement, from: BusAgentId) => string> = {
    coords: (e) => {
      knownRef.current = predefine(knownRef.current, e);
      setKnownElements(knownRef.current);
      return `Predefined "${e.name}" at ${at(e.x, e.y)} — fed into planning`;
    },
    habits: (e, from) => {
      addPatterns([newPattern('add', `"${e.name}" is at ${at(e.x, e.y)} (found by ${BUS_AGENTS[from]})`, goalRef.current)]);
      return `Recorded "${e.name}" as a habit`;
    },
    screen: (e) => {
      const box: Annotation = { id: uid('ann'), x: Math.max(0, e.x - (e.w ?? 0.04) / 2), y: Math.max(0, e.y - (e.h ?? 0.04) / 2), w: e.w ?? 0.04, h: e.h ?? 0.04, label: `Watching: ${e.name}`, tone: 'info', actX: e.x, actY: e.y };
      setAnnotations((a) => [box, ...a.filter((x) => x.label !== box.label)].slice(0, 6));
      return `Observing "${e.name}" on the live screen`;
    },
    popup: (e) => `Noted "${e.name}" — not a popup to flag`,
    drift: (e) => `Will cross-check "${e.name}" at ${at(e.x, e.y)}`,
    progress: (e) => `Noted "${e.name}" as reachable`,
    goal: (e) => `Noted "${e.name}" for goal review`,
    supervisor: (e) => `Noted "${e.name}" for link/route tests`,
  };

  /**
   * Forwards a discovered element from one agent into the inboxes of the others (all of them by
   * default) for forward testing and predefining. Each recipient that is on handles it at once;
   * an off agent keeps it queued.
   */
  const forwardElement = useCallback((from: BusAgentId, element: ForwardedElement, to?: BusAgentId[]) => {
    const { bus: next, queued } = forward(busRef.current, from, element, to);
    let updated = next;
    queued.forEach((m) => {
      if (m.to !== 'habits' && !agentsRef.current(m.to)) return;
      updated = markHandled(updated, m.id, busHandlers[m.to](element, from));
    });
    busRef.current = updated;
    setBus(updated);
    addLog('Agent bus', `${BUS_AGENTS[from]} forwarded "${element.name}" at ${at(element.x, element.y)} to ${queued.length} agent(s)`, 'info');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addLog]);

  const adDismissed = () => Math.floor(tickRef.current / AD_CYCLE) === dismissedCycleRef.current;

  /** Appends one performed mouse/keyboard action to the persistent history, with the pointer's prior point, screen size and prior text for reversal. */
  const recordAction = useCallback((step: WorkflowStep, out: StepOutcome, actor: string, via: ActionRecord['via'], srcW: number, srcH: number) => {
    const kind = INPUT_ACTIONS[step.action];
    if (!kind) return;
    const end = kind === 'drag' ? dragEnd(step, srcW, srcH) : null;
    const px = (p: { x: number; y: number }) => ({ x: Math.round(p.x * srcW), y: Math.round(p.y * srcH) });
    const prev = lastPointerRef.current ? px(lastPointerRef.current) : null;
    const rec: ActionRecord = { id: uid('act'), time: Date.now(), action: kind, ...px(out.target), ...(end ? { endX: end.x, endY: end.y } : {}), ...(prev ? { prevX: prev.x, prevY: prev.y } : {}), srcW, srcH, text: step.text, ...(step.priorText !== undefined ? { priorText: step.priorText } : {}), source: actor, via, ok: out.ok, message: out.message };
    if (POINTER_ACTIONS.has(step.action)) lastPointerRef.current = out.end ?? out.target;
    setHistory((h) => appendHistory(h, rec));
  }, []);

  /** Applies a click to the demo desktop (dismiss the ad, press Play). */
  const demoClick = useCallback((x: number, y: number): string => {
    const t = tickRef.current;
    const ad = demoAd(t);
    if (ad.visible && !adDismissed()) {
      if (Math.abs(x - ad.closeX) < 0.03 && Math.abs(y - ad.closeY) < 0.05) {
        dismissedCycleRef.current = Math.floor(t / AD_CYCLE);
        return 'Closed the ad popup';
      }
      if (x >= ad.x && x <= ad.x + ad.w && y >= ad.y && y <= ad.y + ad.h) return 'Click landed on the ad (blocked target)';
    }
    const play = demoPlayButton(t);
    if (Math.abs(x - play.x) < 0.08 && Math.abs(y - play.y) < 0.045) {
      setPlays((p) => p + 1);
      return 'Pressed PLAY';
    }
    return 'Click hit nothing interactive';
  }, []);

  /** Applies a drag to the demo desktop: grabbing a sidebar icon moves it; grabbing the Report file moves (or archives) it. Names what it grabbed. */
  const applyDemoDrag = useCallback((from: { x: number; y: number }, to: { x: number; y: number }): { message: string; grabbed: string | null } => {
    const icon = moveIcon(demoIconsRef.current, from, to);
    if (icon.moved) {
      demoIconsRef.current = icon.icons;
      return { message: `Dragged "${icon.moved.label}" to (${pct(icon.moved.x)}, ${pct(icon.moved.y)})`, grabbed: icon.moved.label };
    }
    const r = demoDrag(demoFileRef.current, from, to);
    demoFileRef.current = r.file;
    return { message: r.message, grabbed: r.moved ? 'Report' : null };
  }, []);

  /** A fresh frame of the demo desktop as it is right now; null when there is no canvas to draw on. */
  const demoSnapshot = (): Frame | null => {
    const c = demoCanvasRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return null;
    drawDemoDesktop(ctx, DEMO_W, DEMO_H, tickRef.current, adDismissed(), demoFileRef.current, demoIconsRef.current);
    return toFrame(c, DEMO_W, DEMO_H, ++frameId.current, 'demo');
  };

  /** The simulated effect of a pointer step on the demo desktop at `p`. */
  const demoEffect = (step: WorkflowStep, p: { x: number; y: number }): string => {
    if (step.action === 'click' || step.action === 'double_click') return demoClick(p.x, p.y);
    if (step.action === 'move') return `Moved the cursor to (${pct(p.x)}, ${pct(p.y)})`;
    if (step.action === 'drag') return applyDemoDrag(p, { x: step.endX ?? p.x, y: step.endY ?? p.y }).message;
    return `${step.action} simulated on the demo desktop`;
  };

  /** A drag on the demo desktop, with the frames around it and the element it grabbed. */
  const demoDragStep = (step: WorkflowStep, p: { x: number; y: number }, live: Frame | undefined): Performed => {
    const pre = demoSnapshot() ?? live;
    const end = { x: step.endX!, y: step.endY! };
    const { message, grabbed } = applyDemoDrag(p, end);
    return { ok: !!grabbed, executed: !!grabbed, message, target: p, end, live: pre, shot: demoSnapshot() ?? undefined, grabbed: grabbed ?? undefined };
  };

  /** Performs a step on the demo desktop: template-checked against the latest frame, then simulated. */
  const performOnDemo = async (step: WorkflowStep, dryRun: boolean): Promise<Performed> => {
    const local = LOCAL_ACTIONS[step.action];
    if (local) return { ...(await local(step)), executed: true, target: { x: step.x, y: step.y } };
    const badEnd = dragEndError(step);
    if (badEnd) return { ok: false, executed: false, message: badEnd, target: { x: step.x, y: step.y } };
    const live = framesRef.current[0];
    let p = { x: step.x, y: step.y };
    const seeded = live && POINTER_ACTIONS.has(step.action) ? learnedPoint(live, step) ?? habitSeed(live, step) : null;
    if (seeded) p = seeded;
    else if (step.refFrame && live) {
      const { r, level } = driftCheck(step, live);
      if (level === 'red') return { ok: false, executed: false, message: `Target of "${step.name}" not found on the demo screen (best match ${r.matchDistance.toFixed(3)}) — not executed`, target: p };
      p = { x: step.x + r.dx, y: step.y + r.dy };
    }
    if (POINTER_ACTIONS.has(step.action)) {
      aim({ x: step.x, y: step.y });
      aim(p);
      await animator().idle();
    }
    if (dryRun) return { ok: true, executed: false, message: `verified on the demo screen — ${DRY_RUN}`, target: p, ...(step.action === 'drag' ? { end: { x: step.endX!, y: step.endY! } } : {}) };
    if (step.action === 'drag') return demoDragStep(step, p, live);
    const message = demoEffect(step, p);
    const ok = !/blocked|nothing/.test(message);
    if (ok && live && POINTER_ACTIONS.has(step.action)) strengthen(live, step, p);
    return { ok, executed: ok, message, target: p };
  };

  /**
   * The one execution path every feature uses. Demo: simulated on the demo canvas. Otherwise
   * real input via run-step (live desktop frame, drift correction, AI grounding of named
   * targets, bridge dispatch, re-verify), gated by abort, arm and the run's budget.
   */
  const performStep = async (step: WorkflowStep, actor: string, budget: ActionBudget, dryRun: boolean): Promise<Performed> => {
    if (abortedRef.current) return refused(step, 'Aborted — real input not sent');
    if (!stageOn('executor')) return refused(step, `${stageOff('executor')} — not executed`);
    if (step.action === 'measure') return measureStep(step, actor);
    const out = await performInput(step, actor, budget, dryRun);
    ruler.noteGrounding(out);
    if (out.ok) markOutcome(step, out);
    await animator().idle();
    return out;
  };

  /**
   * The marker an attempt that succeeded (executed or dry run alike) leaves on the trail: a drag
   * travels start → end with a click dot at each, a click/double-click gets a click dot at its
   * target, typing gets a typing marker where the cursor is; other actions leave only their path.
   */
  const markOutcome = (step: WorkflowStep, out: Performed) => {
    const a = animator();
    if (step.action === 'drag' && out.end) {
      aim(out.target);
      a.mark('click');
      aim(out.end);
      a.mark('click');
      return;
    }
    const kind = MARKER_OF[step.action];
    if (!kind) return;
    if (kind === 'click') aim(out.target);
    a.mark(kind);
  };

  /** The measure action: no input is sent and no budget spent; the result (or the loud error) goes to the log and the model. */
  const measureStep = (step: WorkflowStep, actor: string): Performed => {
    const target = { x: step.x, y: step.y };
    try {
      return { ok: true, executed: true, message: ruler.measureQuery(step.text ?? step.target ?? step.name, actor), target };
    } catch (error) {
      return { ok: false, executed: false, message: `Measurement failed — ${errorText(error)}`, target };
    }
  };

  /**
   * A real-input step on the demo desktop or through the bridge. Armed with a bridge URL, every
   * step goes to the bridge whatever the screen source; the demo simulates only dry runs or when
   * no bridge is configured. A bridge failure fails the step loudly, never a simulated success.
   */
  const performInput = async (step: WorkflowStep, actor: string, budget: ActionBudget, dryRun: boolean): Promise<Performed> => {
    const { bridgeUrl, bridgeToken, checkpoints } = settingsRef.current;
    if (sourceRef.current === 'demo' && (dryRun || !bridgeUrl)) {
      const out = await performOnDemo(step, dryRun);
      if (out.executed) recordAction(step, out, actor, 'demo', DEMO_W, DEMO_H);
      return out;
    }
    if (!bridgeUrl) return refused(step, BRIDGE_REQUIRED);
    const gate = dryRun ? null : gateRealInput(budget);
    if (gate) return refused(step, gate);
    let size = { w: 1920, h: 1080 };
    const out = await runStep(step, {
      bridgeUrl,
      bridgeToken,
      capture: async () => {
        // Native multi-monitor capture: verify on the chosen display's own frames, which carry
        // its desktop origin so input lands on that display; otherwise the bridge's screenshot.
        const native = sourceRef.current === 'screen' && captureRef.current?.kind === 'native' ? framesRef.current[0] : undefined;
        const f = native ?? await desktopFrame(bridgeUrl, bridgeToken, ++frameId.current);
        size = { w: f.srcW, h: f.srcH };
        return f;
      },
      attempts: Math.max(1, checkpoints),
      retryMs: 400,
      drift: driftThresholds(),
      dispatch: !dryRun,
      log: (m, tone) => addLog(actor, m, tone),
      grounding: aiOnline() && stageOn('grounding') ? grounding : undefined,
      seed: habitSeed,
      learned: learnedPoint,
      onVerified: strengthen,
      aim,
      gateRetry: dryRun ? undefined : () => gateRealInput(budget),
    });
    if (out.executed) recordAction(step, out, actor, 'bridge', size.w, size.h);
    noteBridge(step, out, actor);
    return out;
  };

  /** Tracks the bridge's reachability from a bridge step; a bridge failure is logged and forwarded as a bridge error. */
  const noteBridge = (step: WorkflowStep, out: Performed, actor: string) => {
    if (out.executed) setBridgeOnline(true);
    if (!out.bridgeFailed) return;
    setBridgeOnline(false);
    addLog(actor, `Bridge error — "${step.name}" FAILED, nothing was simulated: ${out.message}`, 'error');
    captureError({ kind: 'bridge', message: out.message, goal: goalRef.current, step: step.name });
  };

  /** Remembers the element `name` at `p` in the familiar-elements memory, with a patch of `frame` around it. */
  const rememberAt = async (name: string, p: { x: number; y: number }, frame: Frame | null | undefined) => {
    const patch = frame ? await patchAt(frame, p).catch(() => undefined) : undefined;
    familiarRef.current = rememberElement(familiarRef.current, { id: uid('el'), name, x: p.x, y: p.y, patch, lastSeen: Date.now() });
    setFamiliar(familiarRef.current);
  };

  /**
   * Familiar-elements memory: a pointer step whose target was verified or used is remembered
   * by name with its point, a small patch of the screen around it and the time. A drag is
   * remembered at its drop point, and only once the move was verified (see performDrag).
   */
  const rememberTarget = async (step: WorkflowStep, out: Performed) => {
    if (!out.ok || !POINTER_ACTIONS.has(step.action) || step.action === 'drag' || !stageOn('elementMap')) return;
    await rememberAt(step.target ?? step.name, out.target, out.shot ?? framesRef.current[0]);
  };

  const forgetFamiliar = (id: string) => setFamiliar((list) => forgetElement(list, id));

  /**
   * performStep (with element identification on a miss), then reflect-after-step: every step the
   * pipeline ran gets the model's reflection and verdict, and the verdict of a step that really
   * ran (not a dry run) updates its habit. No step is dispatched without a recorded proposal for
   * it (intent before action). The verdict is returned so subagents can judge their own steps.
   */
  const perform = async (step: WorkflowStep, actor: string, budget: ActionBudget, dryRun: boolean, proposal: Proposal | null, ladder = true): Promise<Performed & { verdict?: StepVerdict | null }> => {
    if (!proposal?.ready) return refused(step, `No recorded proposal for "${step.name}" — not executed`);
    const before = framesRef.current[0] ?? null;
    const out = ladder ? await performWithRetries(step, actor, budget, dryRun) : await performIdentified(step, actor, budget, dryRun);
    learnFromOutcome(step, out, before);
    void rememberTarget(step, out);
    if (!out.ok && !out.bridgeFailed) captureError({ kind: actor === 'Self-test' ? 'watcher' : 'step', message: out.message, goal: goalRef.current, step: step.name });
    if (out.halt || !aiOnline()) return out;
    const verdict = await reflectAfter(step, out.shot ?? framesRef.current[0] ?? null, out, actor);
    if (verdict && !dryRun) learnHabit(step, verdict);
    return { ...out, verdict };
  };

  /** Why the retry ladder may not climb another rung (abort, kill-switch, executor unchecked); null when it may. */
  const ladderStopped = (): string | null => {
    if (abortedRef.current) return 'Aborted — no further attempts';
    if (abortRef.current) return 'Run stopped — no further attempts';
    return stageOn('executor') ? null : `${stageOff('executor')} — no further attempts`;
  };

  /** The planner's one re-plan of a step that failed after its retries, with its thinking on the step's timeline. */
  const replanFailed = async (step: WorkflowStep, why: string): Promise<WorkflowStep | null> => {
    if (!aiOnline() || !stageOn('planner')) {
      addLog('Planner', `No re-plan for "${step.name}" — ${aiOnline() ? stageOff('planner') : 'AI offline'}`, 'warn');
      return null;
    }
    const frame = await liveFrame().catch(() => framesRef.current[0] ?? null);
    const { next } = await thought(step.name, async () => {
      const r = await replanStep(askFor('planner'), frame, step, why, patternsRef.current);
      return { next: r?.step ?? null, thinking: r?.thinking ?? null };
    }, (r) => (r.next ? `Re-planned "${step.name}": ${r.next.action} "${r.next.target ?? r.next.name}" at ${at(r.next.x, r.next.y)}` : `Re-plan: "${step.target ?? step.name}" is not visible`));
    return next;
  };

  /**
   * One attempt of the ladder: logged with its verify result and corrected coordinates, and shown
   * on the step's timeline once the ladder is climbed (a first-try success is not a retry story).
   */
  const noteAttempt = (actor: string, step: WorkflowStep, a: Attempt) => {
    const text = describeAttempt(a, settingsRef.current.stepRetries);
    addLog(actor, `"${step.name}": ${text}`, a.ok ? 'ok' : 'warn');
    if (a.n > 1 || !a.ok) note({ step: step.name, kind: 'attempt', text, thinking: null });
  };

  /** A step that failed after its retries and re-plan teaches its habit an avoid lesson. */
  const learnFailure = (step: WorkflowStep, attempts: Attempt[]) => {
    if (!stageOn('coords')) return;
    commitHabits(recordOutcome(habitsRef.current, { target: habitTarget(step), context: habitContext(), success: false, avoid: avoidPattern(step, attempts) }));
  };

  /**
   * performIdentified through the per-step retry ladder: on failure the target is re-verified on
   * a fresh live frame and re-corrected (drift, grounding) by the same pipeline and retried
   * (Settings: retries per failed step), then the planner re-plans it once. Every attempt goes
   * through the run's guardrails and spends budget like any action.
   */
  const performWithRetries = async (step: WorkflowStep, actor: string, budget: ActionBudget, dryRun: boolean): Promise<Performed> => {
    const { out, attempts, exhausted } = await runLadder(step, {
      retries: settingsRef.current.stepRetries ?? DEFAULT_STEP_RETRIES,
      run: (s) => performIdentified(s, actor, budget, dryRun),
      stopped: ladderStopped,
      replan: replanFailed,
      onAttempt: (s, a) => noteAttempt(actor, s, a),
      log: (m, tone) => addLog(actor, m, tone),
    });
    const replanned = attempts.some((a) => a.kind === 'replan');
    if (!exhausted) return { ...out, replanned };
    addLog(actor, `"${step.name}": failed after ${attempts.length} attempt(s) — marked failed, avoid pattern recorded`, 'error');
    learnFailure(step, attempts);
    return { ...out, replanned, message: `${out.message} (failed after ${attempts.length} attempt(s))` };
  };

  /** Whether the element identifier may send a request now. */
  const identifierReady = () => stageOn('identify') && aiOnline() && !abortedRef.current;

  /** A live frame to verify against: a fresh desktop screenshot via the bridge, else the latest monitor frame. */
  const liveFrame = async (): Promise<Frame | null> => {
    const { bridgeUrl, bridgeToken } = settingsRef.current;
    if (sourceRef.current === 'bridge' && bridgeUrl) return desktopFrame(bridgeUrl, bridgeToken, ++frameId.current);
    return framesRef.current[0] ?? null;
  };

  /**
   * The agent test of a proposal: a dry-run move to the proposed point, verified against the
   * live frame by drift/template matching (template = the frame the AI saw). With the bridge it
   * runs through the gated pipeline (real move only when `dryRun` is false: armed, not aborted,
   * within budget); otherwise it is verify-only against the latest captured frame.
   */
  const agentTest = async (input: IdentifyInput, id: Extract<Identification, { found: true }>, budget: ActionBudget, dryRun: boolean): Promise<AgentCheck & { live?: Frame }> => {
    const move: WorkflowStep = { id: uid('agent'), name: `Agent test "${id.name}"`, action: 'move', target: id.name, x: id.x, y: id.y, refFrame: input.frame, status: 'pending' };
    if (sourceRef.current === 'demo' || (sourceRef.current === 'bridge' && settingsRef.current.bridgeUrl)) {
      const out = await performStep(move, 'Element identifier', budget, dryRun);
      if (!out.ok) return { ok: false, message: out.message };
      return { ok: true, x: out.target.x, y: out.target.y, message: `${dryRun ? 'dry-run move' : 'move'} verified at ${gridRef(out.target)} — ${out.message}`, live: out.shot ?? framesRef.current[0] };
    }
    const live = await liveFrame();
    if (!live) return { ok: false, message: 'no live frame to verify against' };
    const c = correctDrift(input.frame.data, live.data, id.x, id.y, live.srcW, live.srcH);
    aim(id);
    aim(c);
    if (c.level === 'red') return { ok: false, message: `no template match on the live frame (best ${c.matchDistance.toFixed(3)})` };
    await animator().idle();
    return { ok: true, x: c.x, y: c.y, message: `dry-run move verified on the live frame at ${gridRef(c)} (drift ${c.driftPx}px, match ${c.matchDistance.toFixed(3)})`, live };
  };

  /**
   * Sends the AI an identification request for `box` (crop, size, colour stats, text, boundary,
   * distances to mapped elements and grid cells) and agent-tests each proposal: at most 3 tries
   * within 30 s. A verified element is remembered as familiar; a miss is logged plainly.
   */
  const identifyElement = async (reason: IdentifyReason, box: Box, text: string | undefined, budget: ActionBudget, dryRun: boolean): Promise<(IdentifyOutcome & { live?: Frame }) | null> => {
    const frame = framesRef.current[0];
    if (!frame) return null;
    const label = text ?? `region at ${gridRef(boxCenter(box))}`;
    const input: IdentifyInput = { reason, box, frame, crop: await cropFrame(frame, box).catch(() => frame), text, mapped: elementMapRef.current };
    const log = (m: string, tone: LogEntry['tone']) => addLog('Element identifier', `"${label}": ${m}`, tone);
    log(`sending an identification request to the AI (${reason.replace('_', ' ')})`, 'info');
    let live: Frame | undefined;
    const outcome = await identifyAndVerify({
      identify: (feedback) => thought(`Identify: ${label}`, async () => parseIdentification(await askFor('identify')(identifyRequest(input, feedback)), label), (r) => (r.found ? `Identified "${r.name}" at ${gridRef(r)} — ${r.reason}` : `Not identified — ${r.reason}`)),
      verify: async (id) => {
        const check = await agentTest(input, id, budget, dryRun);
        live = check.live;
        return check;
      },
      aborted: () => abortedRef.current,
      log,
    });
    if (outcome.verified) setFamiliar((list) => rememberElement(list, { id: uid('el'), name: outcome.name, x: outcome.x, y: outcome.y, lastSeen: Date.now() }));
    return { ...outcome, live };
  };

  /** The box to describe for a step's target: the mapped element under its point, else a small square around it. */
  const stepBox = (step: WorkflowStep): Box => {
    const p = { x: step.x, y: step.y };
    const mapped = elementMapRef.current.find((e) => p.x >= e.box.x && p.x <= e.box.x + e.box.w && p.y >= e.box.y && p.y <= e.box.y + e.box.h);
    const f = framesRef.current[0];
    return mapped?.box ?? zoomBox(p, f ? f.srcW / f.srcH : 16 / 9, 0.08);
  };

  /**
   * performStep with identification: a pointer step the planner gave no point for is identified
   * first; a pointer step that was not clicked / not accepted is identified and, once verified,
   * re-run at the corrected coordinates. A miss returns the original outcome (the plan continues).
   */
  const performIdentified = async (step: WorkflowStep, actor: string, budget: ActionBudget, dryRun: boolean): Promise<Performed> => {
    let run = step;
    if (step.unlocated && POINTER_ACTIONS.has(step.action) && identifierReady()) {
      const found = await identifyElement('not_proposed', stepBox(step), step.target ?? step.name, budget, true);
      if (found?.verified) run = { ...step, x: found.x, y: found.y, unlocated: false, refFrame: found.live ?? step.refFrame };
    }
    const out = await performStep(run, actor, budget, dryRun);
    if (out.ok || out.halt || !POINTER_ACTIONS.has(step.action) || !identifierReady()) return out;
    const reason: IdentifyReason = /not located|not be verified|not found/.test(out.message) ? 'not_accepted' : 'not_clicked';
    const found = await identifyElement(reason, stepBox(run), step.target ?? step.name, budget, true);
    if (!found?.verified) return out;
    addLog(actor, `"${step.name}": continuing at the verified point ${gridRef(found)} (${pct(found.x)}, ${pct(found.y)})`, 'ok');
    return performStep({ ...run, x: found.x, y: found.y, correctedX: undefined, correctedY: undefined, refFrame: found.live ?? run.refFrame }, actor, budget, dryRun);
  };

  /**
   * New or constantly-changing content (same frame-diff clusters as the popup watcher): sent
   * for identification once per region per 30 s. The agent test only moves the real mouse while
   * Auto Act runs armed; otherwise it is a dry run.
   */
  const watchChanges = (prev: Frame, cur: Frame) => {
    const cells = largestCluster(diffCells(prev.data, cur.data));
    const box = cells.length >= 6 ? boundingBox(cells) : null;
    if (!box) return;
    const now = Date.now();
    const noted = noteChange(changeHitsRef.current, box, now);
    changeHitsRef.current = noted.hits;
    if (noted.kind === 'repeat' || identifyBusyRef.current || !identifierReady() || recentlySent(identifySentRef.current, box, now)) return;
    identifySentRef.current = [{ box, time: now }, ...identifySentRef.current].slice(0, 20);
    identifyBusyRef.current = true;
    const dry = !(armedRef.current && settingsRef.current.autoAct);
    void identifyElement(noted.kind === 'new' ? 'new_element' : 'changing_element', box, undefined, autoBudgetRef.current, dry).finally(() => {
      identifyBusyRef.current = false;
    });
  };

  /** Element map: the user's drawn boxes, persisted and fed into the familiar-elements memory. */
  const setMap = (next: MappedElement[]) => {
    elementMapRef.current = next;
    setElementMap(next);
  };

  const toggleMapMode = () => {
    setMapMode((m) => !m);
    setMapDraft(null);
  };

  /** Names the drawn box and maps it on the current frame; also remembered as a familiar element. */
  const saveMapped = async (name: string) => {
    if (!mapDraft || !name.trim()) return;
    const frame = framesRef.current[0];
    const el: MappedElement = { id: uid('map'), name: name.trim(), box: mapDraft, mappedAt: Date.now(), ...(frame ? { frame } : {}) };
    setMap(mapElement(elementMapRef.current, el));
    setMapDraft(null);
    const patch = frame ? await patchAt(frame, boxCenter(el.box)).catch(() => undefined) : undefined;
    setFamiliar((list) => rememberElement(list, toFamiliar(el, Date.now(), patch)));
    addLog('Element map', `Mapped "${el.name}" at ${gridRef(boxCenter(el.box))} (${pct(el.box.w)} x ${pct(el.box.h)} of the screen)`, 'ok');
  };

  const deleteMapped = (id: string) => setMap(unmapElement(elementMapRef.current, id));

  /**
   * Where the element map puts `name`: the live layout on the demo desktop (sidebar icons, the
   * Report file), else a familiar element seen at or after `since` (an older entry predates the drag being checked).
   */
  const mapAt = (name: string, since = 0): { x: number; y: number } | null => {
    if (sourceRef.current === 'demo') {
      const icon = findIcon(demoIconsRef.current, name);
      if (icon) return { x: icon.x, y: icon.y };
      if (/\breport\b/i.test(name)) return demoFileAt(demoFileRef.current);
    }
    const el = familiarRef.current.find((f) => sameElement(f.name, name) && (f.lastSeen ?? 0) >= since);
    return el ? { x: el.x, y: el.y } : null;
  };

  /** The element a performed drag was meant to move: grabbed at its start, intended at its drop point. */
  const movedBy = (step: WorkflowStep, out: Performed): MovedElement => ({ name: step.target ?? out.grabbed ?? step.name, from: out.target, to: out.end ?? { x: step.endX ?? out.target.x, y: step.endY ?? out.target.y }, before: out.live ?? null });

  /** The move check after a drag, on the post-drag frame plus the element map; recorded as a 'check' entry. */
  const checkDrag = (step: WorkflowStep, moved: MovedElement, out: Performed, since: number) => {
    const r = checkMoved(moved, out.shot ?? null, mapAt(moved.name, since));
    note({ step: step.name, kind: 'check', text: `${r.moved ? 'PASS' : 'FAIL'} — "${moved.name}" ${r.moved ? 'is at' : 'is not at'} the drop point ${at(moved.to.x, moved.to.y)}: ${r.detail}`, thinking: null });
    return r;
  };

  /**
   * The one retry of a drag that missed: re-planned by the AI on the post-drag frame, or, with the
   * AI offline, the same drop regrabbing the element where it was sighted. Null: the AI no longer sees it.
   */
  const retryDrag = async (step: WorkflowStep, feedback: string, frame: Frame | null, sighted: { x: number; y: number } | null): Promise<WorkflowStep | null> => {
    if (!aiOnline()) return sighted ? { ...step, x: sighted.x, y: sighted.y, refFrame: undefined } : step;
    const { next } = await thought(step.name, async () => {
      const r = await replanDrag(askFor('planner'), frame, step, feedback);
      return { next: r?.step ?? null, thinking: r?.thinking ?? null };
    }, (r) => (r.next ? `Re-planned the drag: ${at(r.next.x, r.next.y)} → ${at(r.next.endX ?? r.next.x, r.next.endY ?? r.next.y)}` : `Re-plan: "${step.target ?? step.name}" is not visible`));
    return next;
  };

  /** A drag that did not land after its retry: failed, with why. */
  const missed = (out: Performed, moved: MovedElement, why: string): Performed => ({ ...out, ok: false, executed: false, moved, message: `${out.message} — but "${moved.name}" did not land at ${at(moved.to.x, moved.to.y)}: ${why}` });

  /**
   * A drag through the gated pipeline, then the move check on the live frame. A miss is
   * re-planned (or retried) once through the same pipeline, spending budget; a second miss fails.
   * The retry ladder runs only on the first attempt and its one re-plan is the step's only one:
   * a drag the ladder already re-planned is not re-planned again.
   */
  const performDrag = async (step: WorkflowStep, actor: string, budget: ActionBudget, dryRun: boolean, proposal: Proposal | null): Promise<Performed & { verdict?: StepVerdict | null }> => {
    let current = step;
    for (let attempt = 1; ; attempt++) {
      const since = Date.now();
      const out = await perform(current, actor, budget, dryRun, proposal, attempt === 1);
      if (!out.executed) return out;
      const moved = movedBy(current, out);
      const check = checkDrag(current, moved, out, since);
      if (check.moved) {
        void rememberAt(moved.name, check.at ?? moved.to, out.shot);
        return { ...out, moved };
      }
      if (out.replanned) return missed(out, moved, `${check.detail} (already re-planned once by the retry ladder)`);
      if (attempt === 2 || abortRef.current) return missed(out, moved, `${check.detail}${attempt === 2 ? ' (failed after one retry)' : ' (stopped, no retry)'}`);
      addLog(actor, `"${moved.name}" did not land at its drop point (${check.detail}) — retrying once`, 'warn');
      try {
        const next = await retryDrag(current, check.detail, out.shot ?? framesRef.current[0] ?? null, check.at);
        if (!next) return missed(out, moved, 'the re-plan no longer sees the element');
        current = next;
      } catch (error) {
        return missed(out, moved, `re-plan failed (AI unavailable: ${errorText(error)})`);
      }
    }
  };

  /** Runs a step: a drag with its move check and retry, anything else as is. */
  const execute = (step: WorkflowStep, actor: string, budget: ActionBudget, dryRun: boolean, proposal: Proposal | null): Promise<Performed & { verdict?: StepVerdict | null }> => (step.action === 'drag' ? performDrag : perform)(step, actor, budget, dryRun, proposal);

  /** A fresh frame for the final verification pass: the demo canvas, or a bridge screenshot (null with the reason logged). */
  const finalFrame = async (label: string): Promise<Frame | null> => {
    if (sourceRef.current === 'demo') return demoSnapshot();
    try {
      return await desktopFrame(settingsRef.current.bridgeUrl, settingsRef.current.bridgeToken, ++frameId.current);
    } catch (error) {
      addLog(label, `Verification has no final screenshot: ${errorText(error)}`, 'error');
      return null;
    }
  };

  /**
   * The verification pass after a rearrangement: every moved element is re-detected on a fresh
   * frame and the requested arrangement checked, one PASS/FAIL log entry (before/after screenshots)
   * and one 'check' entry per element.
   */
  /** The verification pass; resolves whether every element passed. */
  const verifyRearrangement = async (moved: MovedElement[], label: string): Promise<boolean> => {
    const final = await finalFrame(label);
    const verdicts = verifyArrangement(moved, expectRef.current, final, (name) => mapAt(name));
    for (const v of verdicts) {
      const text = `${v.pass ? 'PASS' : 'FAIL'} "${v.element}" — ${v.detail}`;
      addLog('Verify', text, v.pass ? 'ok' : 'error', [v.before?.url, final?.url].filter((u): u is string => !!u));
      note({ step: `Verify "${v.element}"`, kind: 'check', text, thinking: null });
    }
    const passed = verdicts.filter((v) => v.pass).length;
    const confirmed = passed === verdicts.length;
    addLog('Verify', `Arrangement ${confirmed ? 'confirmed' : 'NOT confirmed'}: ${passed}/${verdicts.length} element(s) pass`, confirmed ? 'ok' : 'error');
    return confirmed;
  };

  /**
   * Test click: highlights the element on the preview; while armed, clicks its exact point
   * through the same gated pipeline (abort, arm, a fresh one-click budget). Disarmed is a dry run.
   */
  const testClick = async (el: ScreenElement) => {
    setHighlight({ x: el.x, y: el.y, label: el.name });
    setTimeout(() => setHighlight((h) => (h && h.x === el.x && h.y === el.y ? null : h)), 3000);
    const where = `${gridRef(el)} (${pct(el.x)}, ${pct(el.y)})`;
    if (!armedRef.current) {
      addLog('Test click', `"${el.name}" highlighted at ${where} — real input disarmed, ${DRY_RUN}`, 'info');
      return;
    }
    // Guardrails first: an aborted engine reports the abort from performStep, never the stage.
    if (!abortedRef.current && !stageOn('subagents')) {
      addLog('Test click', `"${el.name}" highlighted at ${where} — ${stageOff('subagents')}, nothing sent`, 'warn');
      return;
    }
    const step: WorkflowStep = { id: uid('test'), name: `Test click "${el.name}"`, action: 'click', x: el.x, y: el.y, status: 'pending' };
    const before = framesRef.current[0] ?? null;
    const out = await performStep(step, 'Test click', createBudget(settingsRef.current.actionBudget), false);
    learnFromOutcome({ ...step, target: el.name }, out, before);
    if (out.executed) void rememberTarget({ ...step, target: el.name }, out);
    addLog('Test click', `"${el.name}" at ${where}: ${out.message}`, out.ok ? 'ok' : 'error');
  };

  const elements = listElements(steps, annotations, familiar);
  /** The newest real action and how it reverses; null when there is none or the newest is itself a reversal. */
  const reverse = reverseOffer(history);

  /**
   * Reverses the most recent real action: its inverse steps run through performStep (abort,
   * executor stage, arm and a fresh budget), as a dry run unless armed. Before and after
   * screenshots go into the log; a non-invertible action is reported as "cannot reverse".
   */
  const reverseLast = async () => {
    const offer = reverseOffer(history);
    if (!offer) return addLog(REVERSE_ACTOR, 'Nothing to reverse — no real action since the last reversal', 'warn');
    const { record, reversal } = offer;
    if (!reversal.ok) return addLog(REVERSE_ACTOR, `Cannot reverse ${record.action} at (${record.x}, ${record.y})px — ${reversal.reason}`, 'warn');
    if ((record.via === 'demo') !== (sourceRef.current === 'demo')) return addLog(REVERSE_ACTOR, `Cannot reverse — the ${record.action} ran on the ${record.via === 'demo' ? 'demo desktop' : 'desktop bridge'}, which is not the current screen source`, 'error');
    const dryRun = !armedRef.current;
    setReversing(true);
    try {
      const before = await finalFrame(REVERSE_ACTOR);
      const budget = createBudget(settingsRef.current.actionBudget);
      const results: string[] = [];
      let ok = true;
      for (const step of reversal.steps) {
        const out = await performStep(step, REVERSE_ACTOR, budget, dryRun);
        results.push(out.message);
        ok = out.ok;
        if (!out.ok) break;
      }
      const after = await finalFrame(REVERSE_ACTOR);
      const mode = dryRun ? 'dry run (real input disarmed), nothing sent' : ok ? 'reversed' : 'reversal failed';
      const shots = [before?.url, after?.url].filter((u): u is string => !!u);
      addLog(REVERSE_ACTOR, `${mode}: ${record.action} at (${record.x}, ${record.y})px — ${reversal.summary} — ${results.join('; ')}`, ok ? (dryRun ? 'info' : 'ok') : 'error', shots);
    } finally {
      setReversing(false);
    }
  };
  /** Targets the coordinate learner has observed, newest first. */
  const learned = learnedTargets(familiar);

  const updateStep = (index: number, patch: Partial<WorkflowStep>) => {
    if (patch.status && patch.status !== stepsRef.current[index]?.status) statusChangesRef.current++;
    stepsRef.current = stepsRef.current.map((st, i) => (i === index ? { ...st, ...patch } : st));
    setSteps(stepsRef.current);
  };

  /** Writes a real outcome onto its step: done only when executed, failed otherwise. */
  const applyOutcome = (index: number, out: Performed, dryRun: boolean, before: Frame | null = null) => {
    const c = out.correction;
    const measured = { correctedX: out.target.x, correctedY: out.target.y, drift: c?.matchDistance, driftPx: c?.driftPx };
    if (dryRun && out.ok) {
      updateStep(index, { status: 'pending', ...measured });
      return;
    }
    const evidence = out.executed ? { beforeFrame: before ?? undefined, afterFrame: out.shot ?? framesRef.current[0] } : {};
    updateStep(index, { status: out.executed ? 'done' : 'failed', ...measured, ...(out.shot ? { shot: out.shot } : {}), ...evidence });
    if (!out.executed) return;
    if (stageOn('progress')) setProgress((p) => ({ ...p, done: p.done + 1 }));
  };

  /** Shows the supervisor's state in its panel and logs it. */
  const superviseReport = (state: SupervisorState, tone: LogEntry['tone']) => {
    supervisorRef.current = state;
    setSupervisor(state);
    addLog('Supervisor', state.detail, tone);
  };

  /** Applies a confident review: step fixes onto the plan (awaiting the executor) and habits into the pattern store. */
  const applyReview = (review: SupervisorReview) => {
    stepsRef.current = applyFixes(stepsRef.current, review.stepFixes);
    setSteps(stepsRef.current);
    const now = Date.now();
    const fixed = new Set(review.stepFixes.map((f) => f.stepId));
    pendingFixesRef.current = [...pendingFixesRef.current.filter((p) => !fixed.has(p.stepId)), ...[...fixed].map((stepId) => ({ stepId, appliedAt: now }))];
    if (review.habits.length) addPatterns(habitPatterns(review.habits, goalRef.current, now));
  };

  /**
   * The supervisor's review: consolidates every agent's output, the gallery screenshots and the
   * thinking timeline into one structured AI question. With the AI down it says so and does nothing.
   */
  const superviseRun = async () => {
    if (!agentsRef.current('supervisor') || supervisorBusyRef.current || abortedRef.current) return;
    lastReviewAt.current = Date.now();
    if (aiStatusRef.current.state === 'offline') {
      superviseReport({ status: 'offline', detail: `AI endpoint is down — no supervisor review was made, nothing applied (${aiStatusRef.current.detail})`, review: null, applied: false }, 'error');
      return;
    }
    supervisorBusyRef.current = true;
    setSupervisor((s) => ({ ...s, status: 'reviewing', detail: 'Reviewing agents, screenshots and thinking…' }));
    try {
      const input = { goal: goalRef.current, steps: stepsRef.current, log: logRef.current, timeline: timelineRef.current, frames: framesRef.current, sync: syncRef.current, progress: progressRef.current };
      const review = await reviewRun(askFor('supervisor'), input);
      const applied = isConfident(review);
      if (applied) applyReview(review);
      const text = reviewText(review, applied);
      note({ step: 'Supervisor', kind: 'review', text, thinking: review.thinking });
      superviseReport({ status: 'done', detail: text, review, applied }, review.planOk ? 'ok' : 'warn');
    } catch (error) {
      note({ step: 'Supervisor', kind: 'review', text: '', thinking: null, error: errorText(error) });
      superviseReport({ status: aiOnline() ? 'error' : 'offline', detail: `AI unavailable — no supervisor review, nothing applied: ${errorText(error)}`, review: null, applied: false }, 'error');
    } finally {
      supervisorBusyRef.current = false;
    }
  };

  /** Performs one correction the executor left unapplied; dry run unless armed, inside the run budget. */
  const superviseMove = async (fix: PendingFix, budget: ActionBudget): Promise<boolean> => {
    pendingFixesRef.current = pendingFixesRef.current.filter((p) => p.stepId !== fix.stepId);
    const idx = stepsRef.current.findIndex((s) => s.id === fix.stepId);
    const step = stepsRef.current[idx];
    const dry = !armedRef.current;
    updateStep(idx, { status: 'running' });
    const out = await perform(step, 'Supervisor', budget, dry, recordLocal('Supervisor', step, `the executor left "${step.name}" unapplied, so the supervisor performs it`));
    applyOutcome(idx, out, dry);
    const message = `Executor left "${step.name}" unapplied — supervisor ${dry ? 'dry run' : 'performed it'} at ${at(out.target.x, out.target.y)}: ${out.message}`;
    note({ step: step.name, kind: 'movement', text: message, thinking: null });
    addLog(dry ? 'Supervisor (dry run)' : 'Supervisor', message, out.ok ? 'ok' : 'error');
    return !out.halt;
  };

  /** Carries out corrections the executor has not applied within the window; pauses while it is mid-step. */
  const superviseMovement = async () => {
    pendingFixesRef.current = pendingFixesRef.current.filter((p) => stepsRef.current.some((s) => s.id === p.stepId && s.status !== 'done'));
    const stale = staleFixes(pendingFixesRef.current, stepsRef.current, Date.now());
    if (!stale.length || supervisorMovingRef.current || abortedRef.current) return;
    if (supervisorExecutorBusy({ autoBusy: autoBusyRef.current, replaying: replayingRef.current, recording: recordingRef.current, steps: stepsRef.current })) return;
    supervisorMovingRef.current = true;
    const budget = createBudget(settingsRef.current.actionBudget);
    try {
      for (const fix of stale) {
        if (abortedRef.current || !(await superviseMove(fix, budget))) break;
      }
    } finally {
      supervisorMovingRef.current = false;
    }
  };

  /** One supervisor tick: movement for unapplied corrections, then a periodic review when due. */
  const superviseTick = () => {
    if (!agentsRef.current('supervisor')) return;
    void superviseMovement();
    if (stepsRef.current.length && Date.now() - lastReviewAt.current >= SUPERVISOR_INTERVAL_MS) void superviseRun();
  };
  const superviseTickRef = useRef(superviseTick);
  superviseTickRef.current = superviseTick;

  useEffect(() => {
    const id = setInterval(() => superviseTickRef.current(), SUPERVISOR_TICK_MS);
    return () => clearInterval(id);
  }, []);

  /** Flags `box` as a popup: the popup watcher's special case, which the AI then rules on (decidePopup). */
  const flagPopup = useCallback((prev: Frame, cur: Frame, box: ScreenChange['box']) => {
    popupBaseRef.current = prev;
    popupFrameRef.current = cur;
    const ann: Annotation = { id: uid('ann'), ...box, label: 'New popup / UI mismatch', tone: 'error' };
    popupRef.current = ann;
    setAnnotations((a) => [ann, ...a.filter((x) => x.tone !== 'error')].slice(0, 6));
    if (stageOn('popup')) addLog('Popup watcher', `New content appeared at (${pct(box.x)}, ${pct(box.y)}) — the AI decides whether it is a popup to close`, 'warn');
  }, [addLog]);

  /** True (and clears the flag) once a flagged popup is gone or replaced; false while it is still there. */
  const popupStillShown = useCallback((cur: Frame): boolean => {
    const popup = popupRef.current;
    if (!popup || !popupBaseRef.current || !popupFrameRef.current) return false;
    const backToClean = boxDistance(popupBaseRef.current.data, cur.data, popup) < 0.06;
    const popupChanged = boxDistance(popupFrameRef.current.data, cur.data, popup) > 0.15;
    if (!backToClean && !popupChanged) return true;
    popupRef.current = null;
    popupBaseRef.current = null;
    popupFrameRef.current = null;
    setAnnotations((a) => a.filter((x) => x.tone !== 'error'));
    if (stageOn('popup')) addLog('Popup watcher', 'Popup gone — area matches the clean screen again', 'ok');
    return false;
  }, [addLog]);

  /** The latest change assessment made after the current plan, or null when the screen has not changed since. */
  const currentChange = (): ChangeAssessment | null => {
    const last = lastChangeRef.current;
    return last && last.at >= planAtRef.current ? last.assessment : null;
  };

  /**
   * Screen-change responder: the AI is shown the full frame with the changed region boxed plus a
   * zoomed crop, and says what changed and whether it affects the plan. A popup becomes the popup
   * watcher's special case; any other change is recorded and boxed. A failed assessment falls back to the popup flag.
   */
  const respondToChange = async (prev: Frame, cur: Frame, change: ScreenChange) => {
    const next = describeNext(stepsRef.current.find((s) => s.status === 'pending' || s.status === 'running'));
    const where = `(${pct(change.box.x)}, ${pct(change.box.y)}) ${pct(change.box.w)}×${pct(change.box.h)}`;
    try {
      const a = await thought('Screen change', async () => {
        const { full, crop } = await boxedFrames(cur, change.box);
        return assessChange(askFor('screenResponder'), full, crop, change, { goal: goalRef.current, next });
      }, changeText, 'change');
      lastChangeRef.current = { at: Date.now(), assessment: a };
      addLog('Screen-change responder', `Change at ${where}: ${changeText(a)}`, a.stale ? 'warn' : 'info');
      if (a.kind === 'popup') flagPopup(prev, cur, change.box);
      else setAnnotations((list) => [{ id: uid('ann'), ...change.box, label: `Changed: ${a.summary}`, tone: 'warn' as const }, ...list.filter((x) => x.tone === 'error')].slice(0, 6));
    } catch (error) {
      addLog('Screen-change responder', `Change at ${where} not assessed — AI unavailable: ${errorText(error)}`, 'error');
      flagPopup(prev, cur, change.box);
    }
  };

  /**
   * Visual change detection: each frame is compared with the frame the last change was measured at
   * (the last assessed change, or the previous frame when nothing changed); a cluster of changed cells
   * at least the Settings threshold in size is a material change. Frames arriving during an assessment
   * are compared after it, so a second change is not lost. With the responder on and the AI online the
   * change is assessed; otherwise it is flagged as a popup for the AI to rule on, as before.
   */
  const watchScreen = (prev: Frame, cur: Frame) => {
    if (popupStillShown(cur) || changeBusyRef.current) return;
    const base = changeBaseRef.current ?? prev;
    changeBaseRef.current = cur;
    const change = detectChange(base.data, cur.data, settingsRef.current.changeCells);
    if (!change) return;
    if (!stageOn('screenResponder') || !aiOnline()) {
      flagPopup(base, cur, change.box);
      return;
    }
    changeBusyRef.current = respondToChange(base, cur, change).finally(() => {
      changeBusyRef.current = null;
    });
  };

  /** The planning context a proposal is justified against; `redo` marks a re-proposal. */
  const proposalContext = (redo?: string): ProposalContext => ({
    goal: goalRef.current,
    change: currentChange(),
    patterns: relevantPatterns(goalRef.current, patternsRef.current).map(patternLine),
    redo,
  });

  /** Writes a proposal to the activity log (the timeline entry is recorded where the proposal is made). */
  const logProposal = (actor: string, step: WorkflowStep, p: Proposal, redo: boolean) =>
    addLog(actor, `${redo ? 'Re-proposal' : 'Proposal'} for "${step.name}": ${proposalText(p)}`, p.ready ? 'info' : 'warn');

  /** Records a proposal made without a separate model call (AI offline, a popup ruling, a /use request). */
  const recordLocal = (actor: string, step: WorkflowStep, why: string): Proposal => {
    const p = localProposal(step, why, currentChange());
    note({ step: step.name, kind: 'proposal', text: proposalText(p), thinking: null });
    logProposal(actor, step, p, false);
    return p;
  };

  /** The model's what/why for `step` on the live screen, recorded on the timeline and in the log. */
  const proposeNow = async (actor: string, step: WorkflowStep, redo?: string): Promise<Proposal> => {
    const frame = framesRef.current[0] ?? null;
    const p = await thought(step.name, () => proposeStep(askFor('executor'), frame, step, proposalContext(redo)), proposalText, 'proposal');
    logProposal(actor, step, p, !!redo);
    return p;
  };

  /** Why the pending step must be re-proposed (drift monitor red, or the responder says the plan is stale), or null. */
  const redoReason = (step: WorkflowStep): string | null => {
    const live = framesRef.current[0];
    if (step.refFrame && live && stageOn('drift') && driftCheck(step, live).level === 'red') {
      return 'the drift monitor reports RED — the recorded target is no longer where the plan put it';
    }
    const change = currentChange();
    if (change?.stale && staleHandledRef.current !== change) return `the screen-change responder says the plan is stale: ${change.summary}`;
    return null;
  };

  /** The one re-proposal a step gets; a second need, or a re-proposal that is still not ready, fails honestly. */
  const repropose = async (actor: string, step: WorkflowStep, reason: string): Promise<Justified> => {
    if (reproposedRef.current.has(step.id)) return { kind: 'fail', reason: `"${step.name}" already had its one re-proposal and ${reason} — not executed` };
    reproposedRef.current.add(step.id);
    const change = currentChange();
    if (change?.stale) staleHandledRef.current = change;
    if (!aiOnline()) return { kind: 'fail', reason: `"${step.name}" must be re-proposed (${reason}) but the AI is offline — not executed` };
    const p = await proposeNow(actor, step, reason);
    if (!p.ready) return { kind: 'fail', reason: `"${step.name}" could not be justified after re-proposal: ${p.why} — not executed` };
    return { kind: 'go', step: adopt(step, p, true), proposal: p };
  };

  /**
   * Intent before action: waits for an in-flight change assessment, then records a what/why proposal
   * for `step`. Drift red or a stale plan goes straight to the one re-proposal; a not-ready first
   * proposal waits when `canWait` (Auto Act), otherwise gets the re-proposal. Offline, a local proposal is recorded.
   */
  const justifyProposal = async (actor: string, step: WorkflowStep, canWait: boolean): Promise<Justified> => {
    await changeBusyRef.current;
    const reason = redoReason(step);
    if (reason) return repropose(actor, step, reason);
    if (!aiOnline()) {
      const why = `AI offline — running the planned step as recorded${goalRef.current ? ` toward "${goalRef.current}"` : ''}; drift correction still checks the target`;
      return { kind: 'go', step, proposal: recordLocal(actor, step, why) };
    }
    const p = await proposeNow(actor, step);
    if (p.ready) return { kind: 'go', step: adopt(step, p, false), proposal: p };
    return canWait ? { kind: 'wait', reason: p.why } : repropose(actor, step, `the first proposal was not ready: ${p.why}`);
  };

  /** What the briefing cross-references the plan against. */
  const knowledge = (): Knowledge => ({ map: elementMapRef.current, familiar: familiarRef.current, habits: habitsRef.current, patterns: patternsRef.current, context: habitContext() });

  /** A fresh briefing of `step` with `proposal` on the live frame. */
  const buildBriefingFor = (step: WorkflowStep, proposal: Proposal) => buildBriefing({
    goal: goalRef.current, steps: stepsRef.current, step, proposal, live: framesRef.current[0] ?? null,
    knowledge: knowledge(), thresholds: driftThresholds(), online: aiOnline(),
  });

  /** Records a briefing (newest first) with zoomed crops of the planned point on the live and reference frames. */
  const publishBriefing = async (b: Briefing) => {
    setBriefings((list) => addBriefing(list, b));
    const p = { x: b.objectives.x, y: b.objectives.y };
    const { live, reference } = b.comparison;
    const [liveCrop, referenceCrop] = await Promise.all([live, reference].map((f) => (f ? zoomFrame(f, p).catch(() => undefined) : undefined)));
    setBriefings((list) => list.map((x) => (x.id === b.id && x.revisions.length === b.revisions.length ? { ...x, liveCrop, referenceCrop } : x)));
  };

  /** The routes the review takes: the ruler, the grounding agent on a zoomed crop, and the executor's re-plan. */
  const reviewDeps = (actor: string): ReviewDeps => ({
    online: aiOnline(),
    groundingOn: stageOn('grounding'),
    hasBaseline: ruler.baseline !== null,
    recalibrate: (reason, step) => {
      const cal = ruler.recalibrateNow(reason);
      return cal && { drift: cal.drift, detail: cal.detail, step: cal.drift ? remapStep(cal, step) : step };
    },
    reground: async (step, feedback) => {
      const live = framesRef.current[0];
      return live ? grounding.relocate(live, step, `pre-action briefing: ${feedback}`) : null;
    },
    replan: async (step, reason) => {
      const p = await proposeNow(actor, step, reason);
      return p.ready ? { step: adopt(step, p, true), proposal: p } : null;
    },
    rebuild: buildBriefingFor,
    publish: publishBriefing,
  });

  /**
   * Pre-action briefing of a step that is about to run: objectives, screenshot comparison and
   * cross-reference are recorded, then reviewed and updated (recalibrate → re-ground → re-plan)
   * before it dispatches. Skipped when the Briefing stage is unchecked; a failed review runs the plan as it stood.
   */
  const brief = async (actor: string, go: Extract<Justified, { kind: 'go' }>): Promise<Justified> => {
    if (!stageOn('briefing')) return go;
    const first = buildBriefingFor(go.step, go.proposal);
    await publishBriefing(first);
    try {
      const r = await reviewBriefing({ briefing: first, step: go.step, proposal: go.proposal }, reviewDeps(actor));
      if (r.briefing.outcome !== 'clear') await publishBriefing(r.briefing);
      addLog(actor, `Briefing for "${go.step.name}": ${briefingText(r.briefing)}`, r.briefing.outcome === 'unresolved' ? 'warn' : 'info');
      return { kind: 'go', step: r.step, proposal: r.proposal };
    } catch (error) {
      addLog(actor, aiFailure(`Briefing review for "${go.step.name}" failed — running the plan as briefed`, error), 'error');
      return go;
    }
  };

  /** Intent before action, then the pre-action briefing of a step that will run. */
  const justify = async (actor: string, step: WorkflowStep, canWait: boolean): Promise<Justified> => {
    const j = await justifyProposal(actor, step, canWait);
    return j.kind === 'go' ? brief(actor, j) : j;
  };

  /** Starts a new plan: a fresh baseline for "changed since the plan" and fresh re-proposal allowances. */
  const markPlan = () => {
    autoLoopRef.current = null;
    flowRef.current = null;
    planAtRef.current = Date.now();
    reproposedRef.current = new Set();
    staleHandledRef.current = null;
  };

  /** Auto-Actor popup handling: the model rules once per flagged region; a close is a grounded click. */
  const autoClosePopup = async (frame: Frame, popup: Annotation, dry: boolean) => {
    popupDecidedRef.current = popup.id;
    const d = await thought('Popup', () => decidePopup(askFor('popup'), frame, popup), popupSummary);
    if (!d.close) {
      addLog('Auto-Actor', `AI left the new content alone: ${d.reason}`, 'info');
      return;
    }
    const close: WorkflowStep = { id: uid('close'), name: 'Close popup', action: 'click', target: 'close (X) button of the popup', x: d.x, y: d.y, status: 'pending' };
    forwardElement('popup', { name: close.target!, x: d.x, y: d.y });
    const proposal = recordLocal('Auto-Actor', close, `the popup blocks the goal, so it is closed first — ${d.reason}`);
    const out = await perform(close, 'Auto-Actor', autoBudgetRef.current, dry, proposal);
    addLog('Auto-Actor', `Close popup (${d.reason}): ${out.message}`, out.ok ? 'ok' : 'error');
    if (out.halt) setSettings((s) => ({ ...s, autoAct: false }));
  };

  /** Marks a step that could not be justified as failed, with the reason in the log. */
  const failUnjustified = (idx: number, actor: string, reason: string): Performed => {
    const step = stepsRef.current[idx];
    updateStep(idx, { status: 'failed' });
    addLog(actor, reason, 'error');
    return { ok: false, executed: false, message: reason, target: { x: step.x, y: step.y } };
  };

  /** Ends Auto Act's continuation loop with why; false, so the finished run is reviewed. */
  const endAutoLoop = (loop: AutoLoop, stop: ContinueStop, detail: string): boolean => {
    autoLoopRef.current = null;
    addLog('Auto-continue', `Auto Act stopped after ${loop.iteration} continuation(s): ${detail}`, STOP_TONE[stop]);
    return false;
  };

  /**
   * Auto Act's continuation once no step is pending: verify the goal, and while it is not complete
   * plan the remaining steps for the next frames to run. Stops for the same reasons as replay's
   * loop (judgeCheck), on abort and when Auto Act was turned off (budget halt). True when it planned more.
   */
  const continueAutoAct = async (): Promise<boolean> => {
    if (!continueEnabled() || !settingsRef.current.autoAct || abortedRef.current) return false;
    const loop = autoLoopRef.current ?? { goal: runGoalOf(), stalls: 0, iteration: 0 };
    autoLoopRef.current = loop;
    const ran = stepsRef.current;
    setContinuing(true);
    try {
      const check = await checkGoal(loop.goal, ran, loop.iteration);
      if (abortedRef.current || !settingsRef.current.autoAct) return endAutoLoop(loop, 'aborted', 'Stopped by abort or Auto Act was turned off');
      const verdict = judgeCheck(check, loop.stalls, loop.iteration, settingsRef.current.maxIterations);
      if (verdict.stop) return endAutoLoop(loop, verdict.stop, verdict.detail);
      loop.stalls = verdict.stalls;
      loop.iteration += 1;
      await planNext(loop.goal, ran, check, loop.iteration);
      if (!stepsRef.current.length) return endAutoLoop(loop, 'no-progress', 'the re-plan found no remaining steps');
      return true;
    } catch (error) {
      autoLoopRef.current = null;
      addLog('Auto-continue', aiFailure('AI unavailable — Auto Act continuation stopped', error), 'error');
      return false;
    } finally {
      setContinuing(false);
    }
  };

  /** Auto-Actor step execution: a recorded what/why proposal for the next step, then it runs grounded. */
  const autoRunStep = async (frame: Frame, idx: number, dry: boolean) => {
    const next = stepsRef.current[idx];
    const j = await justify('Auto-Actor', next, true);
    if (!settingsRef.current.autoAct) {
      addLog('Auto-Actor', `Auto Act was stopped while proposing "${next.name}" — not executed`, 'warn');
      return;
    }
    if (j.kind === 'wait') {
      setSync({ level: 'yellow', detail: `AI is waiting on "${next.name}": ${j.reason}` });
      return;
    }
    if (j.kind === 'fail') failUnjustified(idx, 'Auto-Actor', j.reason);
    else {
      runStartRef.current ??= Date.now();
      updateStep(idx, { status: 'running' });
      const out = await perform(j.step, 'Auto-Actor', autoBudgetRef.current, dry, j.proposal);
      applyOutcome(idx, out, dry, frame);
      addLog(dry ? 'Auto-Actor (dry run)' : 'Auto-Actor', `${next.name}: ${out.message}`, out.ok ? 'ok' : 'error');
      if (out.halt) {
        setSettings((s) => ({ ...s, autoAct: false }));
        addLog('Auto-Actor', 'Auto Act stopped', 'error');
      }
    }
    if (dry) autoDryRef.current = true;
    if (!stepsRef.current.some((s) => s.status === 'pending')) {
      if (await continueAutoAct()) return;
      const dryRun = autoDryRef.current;
      autoDryRef.current = false;
      void learnFromRun(stepsRef.current, { dryRun, stopped: false });
      void superviseRun();
    }
  };

  /** Auto Act: with the AI online, the model handles popups and runs the next pending step. Disarmed = dry run. */
  const autoAct = async (frame: Frame) => {
    const { autoAct: on } = settingsRef.current;
    if (!on || abortedRef.current || autoBusyRef.current || watchBusyRef.current || replayingRef.current || recordingRef.current || supervisorMovingRef.current || subRunningRef.current || !stageOn('screenResponder')) return;
    if (!aiOnline() || Date.now() - lastStepAt.current < 1500) return;
    autoBusyRef.current = true;
    try {
      const dry = !armedRef.current;
      const popup = popupRef.current;
      const idx = stepsRef.current.findIndex((s) => s.status === 'pending');
      if (popup && popupDecidedRef.current !== popup.id && stageOn('popup')) await autoClosePopup(frame, popup, dry);
      else if (idx >= 0) await autoRunStep(frame, idx, dry);
    } catch (error) {
      addLog('Auto-Actor', aiFailure('AI unavailable — nothing executed', error), 'error');
    } finally {
      lastStepAt.current = Date.now();
      autoBusyRef.current = false;
    }
  };

  /** Monitor analysis of one frame: count, gallery, store, error detection, sync status, Auto Act. */
  const processFrame = (frame: Frame) => {
    const prev = framesRef.current.find((f) => !restoredIdsRef.current.has(f.id));
    framesRef.current = [frame, ...framesRef.current].slice(0, settingsRef.current.gallerySize);
    setFrames(framesRef.current);
    setShotCount((n) => n + 1);
    void putStoredFrame(toStoredFrame(frame), settingsRef.current.gallerySize).catch(() => undefined);
    if (prev) {
      watchChanges(prev, frame);
      watchScreen(prev, frame);
    }
    learnFromDwell(frame);
    const next = stepsRef.current.find((s) => s.status === 'pending' || s.status === 'running');
    if (next?.refFrame && stageOn('drift')) {
      const { r, level } = driftCheck(next, frame);
      setSync({ level, detail: `"${next.name}": region ${r.regionDistance.toFixed(3)}, best ${r.matchDistance.toFixed(3)}${level === 'yellow' ? `, drift (${(r.dx * 100).toFixed(1)}%, ${(r.dy * 100).toFixed(1)}%)` : ''}` });
      if (level === 'red') captureError({ kind: 'drift', message: `Drift red: target of "${next.name}" not found on the live screen`, goal: goalRef.current, step: next.name });
    } else if (!next) {
      setSync({ level: 'idle', detail: 'No active step' });
    }
    void autoAct(frame);
  };
  const processRef = useRef(processFrame);
  processRef.current = processFrame;

  /** Only background mode keeps watching and controlling while the page is hidden. */
  const pausedWhileHidden = () => typeof document !== 'undefined' && document.hidden && settingsRef.current.monitorMode !== 'background';

  // Demo desktop render loop.
  useEffect(() => {
    if (source !== 'demo') return undefined;
    const id = setInterval(() => {
      tickRef.current += 1;
      const c = demoCanvasRef.current;
      if (c) drawDemoDesktop(c.getContext('2d')!, DEMO_W, DEMO_H, tickRef.current, adDismissed(), demoFileRef.current, demoIconsRef.current);
    }, 400);
    return () => clearInterval(id);
  }, [source]);

  // Demo monitor at the mode's interval.
  useEffect(() => {
    if (source !== 'demo') return undefined;
    const id = setInterval(() => {
      const c = demoCanvasRef.current;
      if (c && !pausedWhileHidden()) processRef.current(toFrame(c, DEMO_W, DEMO_H, ++frameId.current, 'demo'));
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, source]);

  // Bridge monitor: a real desktop screenshot at the mode's interval; failures are logged, never faked.
  useEffect(() => {
    if (source !== 'bridge') return undefined;
    const id = setInterval(() => {
      if (pollBusyRef.current || pausedWhileHidden()) return;
      pollBusyRef.current = true;
      desktopFrame(settingsRef.current.bridgeUrl, settingsRef.current.bridgeToken, ++frameId.current)
        .then((f) => processRef.current(f))
        .catch((error) => {
          if (Date.now() - lastPollErrorAt.current < 5000) return;
          lastPollErrorAt.current = Date.now();
          addLog('Monitor', `Desktop screenshot failed: ${errorText(error)}`, 'error');
          captureError({ kind: 'bridge', message: `Desktop screenshot failed: ${errorText(error)}` });
        })
        .finally(() => {
          pollBusyRef.current = false;
        });
    }, intervalMs);
    return () => clearInterval(id);
  }, [addLog, captureError, intervalMs, source]);

  // The running screen capture follows the monitor mode's interval live.
  useEffect(() => {
    captureRef.current?.setInterval(intervalMs);
  }, [intervalMs]);

  // The running native capture follows the chosen display live (Settings or the HUD quick-switch).
  useEffect(() => {
    captureRef.current?.selectDisplay(settings.displayId);
  }, [settings.displayId]);

  useEffect(() => () => captureRef.current?.stop(), []);

  /**
   * Appends a recorded step carrying its measured human pause (ms since the previous recorded
   * input, or since recording started), so replay reproduces the original timing.
   */
  const appendRecorded = useCallback((step: WorkflowStep) => {
    const now = Date.now();
    stepsRef.current = [...stepsRef.current, { ...step, delayMs: stepDelay(now, lastInputRef.current) }];
    lastInputRef.current = now;
    setSteps(stepsRef.current);
  }, []);

  /** Stage pointer input: trail while recording. */
  const onStageMove = useCallback((x: number, y: number) => {
    pointerRef.current = [...pointerRef.current, { x, y, t: Date.now() }].slice(-POINTER_LIMIT);
    if (recordingRef.current) setTrail((t) => [...t, { x, y, t: Date.now() }].slice(-1500));
  }, []);

  /** Stage click: in Ruler mode adds a ruler point; while recording becomes a step (Alt+click records a hover/move); on the demo it acts. */
  const onStageClick = (x: number, y: number, hover = false) => {
    if (ruler.on) {
      ruler.addPoint({ x, y });
      return;
    }
    const frame = framesRef.current[0];
    if (recordingRef.current) {
      const n = stepsRef.current.length + 1;
      setTrail((t) => [...t, { x, y, t: Date.now(), click: !hover }]);
      appendRecorded({ id: uid('step'), name: hover ? `Move ${n}` : `Click ${n}`, action: hover ? 'move' : 'click', x, y, refFrame: frame, status: 'pending' });
      addLog('Recorder', `Captured ${hover ? 'mouse move' : 'click'} at (${pct(x)}, ${pct(y)}) with screenshot`, 'info');
      return;
    }
    if (sourceRef.current === 'demo' && !hover) addLog('You', demoClick(x, y));
  };

  /** Recorded key press (with modifiers) on the focused stage: becomes a key step. The abort hotkey is never recorded. */
  const onStageKey = useCallback((e: HotkeyEvent) => {
    if (!recordingRef.current || matchesHotkey(e, settingsRef.current.abortHotkey)) return;
    const combo = keyCombo(e);
    if (!combo) return;
    appendRecorded(keyStep(uid('step'), combo));
    addLog('Recorder', `Captured key ${combo}`, 'info');
  }, [addLog, appendRecorded]);

  /** Recorded mouse wheel at (x, y): one scroll step per gesture (same-direction wheel events in a burst merge). */
  const onStageScroll = useCallback((x: number, y: number, deltaY: number) => {
    if (!recordingRef.current || deltaY === 0) return;
    const now = Date.now();
    const last = stepsRef.current[stepsRef.current.length - 1];
    if (continuesScroll(last, deltaY, now - lastInputRef.current)) {
      lastInputRef.current = now;
      return;
    }
    const step = scrollStep(uid('step'), x, y, deltaY);
    appendRecorded({ ...step, refFrame: framesRef.current[0] });
    addLog('Recorder', `Captured scroll ${step.text} at (${pct(x)}, ${pct(y)})`, 'info');
  }, [addLog, appendRecorded]);

  /**
   * Stage drag (mousedown → move → mouseup): while recording becomes a drag step with both
   * endpoints and the latest screenshot as the template of its start region; on the demo it acts.
   */
  const onStageDrag = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
    if (recordingRef.current) {
      const n = stepsRef.current.length + 1;
      setTrail((t) => [...t, { x: from.x, y: from.y, t: Date.now(), click: true }, { x: to.x, y: to.y, t: Date.now(), click: true }].slice(-1500));
      const step: WorkflowStep = { id: uid('step'), name: `Drag ${n}`, action: 'drag', x: from.x, y: from.y, endX: to.x, endY: to.y, refFrame: framesRef.current[0], status: 'pending' };
      appendRecorded(step);
      addLog('Recorder', `Captured drag from (${pct(from.x)}, ${pct(from.y)}) to (${pct(to.x)}, ${pct(to.y)}) with screenshot`, 'info');
      return;
    }
    if (sourceRef.current === 'demo') addLog('You', applyDemoDrag(from, to).message);
  }, [addLog, applyDemoDrag, appendRecorded]);

  /** Live-write while recording: typed text becomes a "type" step. */
  const onStageType = useCallback((text: string) => {
    if (!recordingRef.current || !text) return;
    appendRecorded({ id: uid('step'), name: `Type "${text}"`, action: 'type', x: 0.5, y: 0.5, text, status: 'pending' });
    addLog('Recorder', `Captured typing: "${text}"`);
  }, [addLog, appendRecorded]);

  const toggleRecording = () => {
    if (recording) {
      setRecording(false);
      addLog('Recorder', `Stopped — ${steps.length} step(s), ${trail.length} trail points`, 'ok');
      setDraftCard(generateCard(steps, goal));
      return;
    }
    setTrail([]);
    lastInputRef.current = Date.now();
    setRecording(true);
    markPlan();
    addLog('Recorder', 'Live recording started — click to record clicks, Alt+click to record a mouse move, keys and the mouse wheel on the focused stage record key and scroll steps');
  };

  /** AI help during replay: the model rules on the popup covering `step` and closes it as a grounded click. */
  const clearCoveringPopup = async (popup: Annotation, step: WorkflowStep, budget: ActionBudget, dryRun: boolean): Promise<boolean> => {
    const live = framesRef.current[0];
    if (!live) return false;
    try {
      const d = await thought(step.name, () => decidePopup(askFor('popup'), live, popup), popupSummary);
      if (!d.close) {
        addLog('AI help', `AI says the region over "${step.name}" is not a popup to close: ${d.reason}`, 'warn');
        return false;
      }
      const close: WorkflowStep = { id: uid('close'), name: 'Close popup', action: 'click', target: 'close (X) button of the popup', x: d.x, y: d.y, status: 'pending' };
      const proposal = recordLocal('AI help', close, `the popup covers "${step.name}", so it is closed before that step — ${d.reason}`);
      const out = await perform(close, 'AI help', budget, dryRun, proposal);
      addLog('AI help', `Popup covers "${step.name}" — ${out.message}`, out.ok ? 'ok' : 'error');
      await sleep(settingsRef.current.captureMs * 2 + 200);
      return out.ok;
    } catch (error) {
      addLog('AI help', `AI unavailable — popup not cleared: ${errorText(error)}`, 'error');
      return false;
    }
  };

  /** True when the flagged popup covers the step's point. */
  const coveredBy = (popup: Annotation | null, s: WorkflowStep): popup is Annotation =>
    !!popup && s.x >= popup.x && s.x <= popup.x + popup.w && s.y >= popup.y && s.y <= popup.y + popup.h;

  /** Runs one replay step, clearing a covering popup first when AI help is on, after a recorded what/why proposal. */
  const replayStep = async (i: number, budget: ActionBudget, dryRun: boolean, label: string): Promise<Performed> => {
    const planned = stepsRef.current[i];
    setActiveIndex(i);
    updateStep(i, { status: 'running' });
    const popup = popupRef.current;
    if (coveredBy(popup, planned) && !(settingsRef.current.aiHelp && stageOn('popup') && aiOnline() && (await clearCoveringPopup(popup, planned, budget, dryRun)))) {
      const out: Performed = { ok: false, executed: false, message: `"${planned.name}" is covered by a popup${settingsRef.current.aiHelp ? ' the AI did not clear' : ' (enable AI help to clear it)'} — not executed`, target: { x: planned.x, y: planned.y } };
      updateStep(i, { status: 'drift' });
      addLog(label, out.message, 'error');
      captureError({ kind: 'drift', message: out.message, goal: goalRef.current, step: planned.name });
      return out;
    }
    let j: Justified;
    try {
      j = await justify(label, planned, false);
    } catch (error) {
      return failUnjustified(i, label, `No proposal for "${planned.name}" — AI unavailable: ${errorText(error)} — not executed`);
    }
    if (j.kind !== 'go') return failUnjustified(i, label, j.reason);
    if (abortRef.current) {
      updateStep(i, { status: 'pending' });
      return { ok: false, executed: false, halt: true, message: `Stopped before "${planned.name}" — not executed`, target: { x: planned.x, y: planned.y } };
    }
    const before = framesRef.current[0] ?? null;
    const out = await execute(j.step, label, budget, dryRun, j.proposal);
    applyOutcome(i, out, dryRun, before);
    addLog(label, `${planned.name}: ${out.message}`, out.ok ? 'ok' : 'error');
    return out;
  };

  /**
   * Replay: every step through the grounded pipeline (template drift check, AI target check,
   * dispatch, re-verify). Self-test, or any run while disarmed, verifies but sends nothing.
   */
  const replay = async (selfTest = false) => {
    await runReplay(selfTest, { label: selfTest ? 'Self-test' : 'Replay', goal: runGoalOf() });
  };

  /**
   * The replay pipeline shared by the Replay buttons and triggered runs. `label` names the run in the
   * log and `goal` is what auto-continue verifies. Resolves the steps verified or executed, or null
   * when the run was refused before any step (nothing to run, ABORTED, bridge down).
   */
  const runReplay = async (selfTest: boolean, { label, goal: runGoal }: { label: string; goal: string }): Promise<RunOutcome | null> => {
    if (!stepsRef.current.length) {
      addLog(label, 'Nothing to replay — record or plan a workflow first', 'warn');
      return null;
    }
    if (abortedRef.current) {
      addLog('Safety', `${label} refused — ABORTED is active; clear the abort first`, 'error');
      return null;
    }
    const viaBridge = sourceRef.current !== 'demo' || (!selfTest && armedRef.current && !!settingsRef.current.bridgeUrl);
    if (viaBridge) {
      const health = await checkBridge(settingsRef.current.bridgeUrl, settingsRef.current.bridgeToken);
      setBridgeOnline(health.ok);
      if (!health.ok) {
        addLog(label, `${health.message} — no step was executed`, 'error');
        captureError({ kind: 'bridge', message: health.message, goal: goalRef.current });
        return null;
      }
    }
    const dryRun = selfTest || !armedRef.current;
    if (dryRun && !selfTest) addLog('Safety', `Real input disarmed — ${label} runs as a ${DRY_RUN}`, 'warn');
    const budget = createBudget(settingsRef.current.actionBudget);
    abortRef.current = false;
    runStartRef.current = Date.now();
    reproposedRef.current = new Set();
    replayingRef.current = true;
    setReplaying(true);
    const shots: Frame[] = [];
    const looping = continueEnabled() && !selfTest;
    const { ran, ok } = looping ? await continueToGoal(runGoal, budget, dryRun, label, shots) : await runSteps(budget, dryRun, label, shots);
    setActiveIndex(null);
    replayingRef.current = false;
    setReplaying(false);
    const picks = shots.map((f, i) => ({ f, score: i === 0 ? 1 : frameDistance(shots[i - 1].data, f.data) })).sort((a, b) => b.score - a.score).slice(0, 3).map((p) => p.f);
    if (picks.length) setPinned(picks);
    if (stageOn('goal')) {
      const total = ran.length;
      const what = dryRun ? 'verified on screen (not dispatched)' : 'executed';
      addLog('Goal reviewer', ok === total ? `All ${total} steps ${what}${goal ? ` for "${goal}"` : ''}` : `${ok}/${total} ${what} — re-plan the failed steps or let AI help clear blockers`, ok === total ? 'ok' : 'warn');
    }
    await learnFromRun(ran, { dryRun, stopped: abortRef.current });
    await superviseRun();
    return { ok, total: ran.length, dryRun, stopped: abortRef.current };
  };

  /** One pass over the current steps in order, checking abortRef between steps. */
  const runSteps = async (budget: ActionBudget, dryRun: boolean, label: string, shots: Frame[]): Promise<RunReport & { ok: number }> => {
    stepsRef.current = stepsRef.current.map((st) => ({ ...st, status: 'pending' as const }));
    setSteps(stepsRef.current);
    const moved: MovedElement[] = [];
    let ok = 0;
    addLog(label, dryRun ? `Verifying ${stepsRef.current.length} step(s) on the live screen — no input is sent` : `Performing ${stepsRef.current.length} step(s) as real input`);
    for (let i = 0; i < stepsRef.current.length && !abortRef.current; i++) {
      const out = await replayStep(i, budget, dryRun, label);
      if (out.ok) ok++;
      if (out.shot) shots.push(out.shot);
      if (out.moved) moved.push(out.moved);
      if (out.halt) return { ran: stepsRef.current, halt: out.message, ok };
    }
    // An arrangement the verification pass did not confirm is a failed run: never saved as a reusable flow.
    const arranged = moved.length ? await verifyRearrangement(moved, label) : true;
    if (!arranged) stepsRef.current = stepsRef.current.map((s) => (s.action === 'drag' ? { ...s, status: 'failed' as const } : s));
    return { ran: stepsRef.current, halt: null, ok };
  };

  /** Whether runs continue until the goal is verified: the setting, its loop stage, and the AI to verify with. */
  const continueEnabled = () => settingsRef.current.autoContinue && stageOn('autoContinue') && aiOnline();

  /** The goal a run verifies: the goal text, else the draft card's description or name, else the plan's steps. */
  const runGoalOf = () => goalRef.current.trim() || draftCard?.description.trim() || draftCard?.name.trim() || `Complete the plan: ${stepsText(stepsRef.current)}`;

  /** Auto-continue check: the model verifies the goal on the live frame; timeline + log. */
  const checkGoal = async (runGoal: string, ran: WorkflowStep[], n: number): Promise<GoalCheck> => {
    const check = await thought(`Verify goal #${n + 1}: ${runGoal}`, () => verifyGoal(askFor('autoContinue'), framesRef.current[0] ?? null, runGoal, ran), goalSummary);
    addLog('Auto-continue', `Iteration ${n + 1} check: ${goalSummary(check)}`, check.complete ? 'ok' : 'info');
    return check;
  };

  /** Auto-continue re-plan: the model plans the remaining steps, which become the next run; timeline + log. */
  const planNext = async (runGoal: string, ran: WorkflowStep[], check: GoalCheck, n: number) => {
    const plan = await thought(`Continue #${n}: ${runGoal}`, () => planRemaining(askFor('planner'), runGoal, framesRef.current[0] ?? null, ran, check.reason, patternsRef.current), (r) => `${r.steps.length} step(s): ${stepsText(r.steps)}`);
    stepsRef.current = plan.steps;
    setSteps(plan.steps);
    addLog('Auto-continue', `Iteration ${n} plan: ${plan.steps.length} step(s) — ${stepsText(plan.steps)}`, 'info');
  };

  /**
   * Replay with auto-continue: run, verify the goal, re-plan the rest and run again until the goal
   * is verified, the budget or abort stops it, two checks show no progress, or the cap is reached.
   * Resolves every step run across the iterations.
   */
  const continueToGoal = async (runGoal: string, budget: ActionBudget, dryRun: boolean, label: string, shots: Frame[]) => {
    const all: WorkflowStep[] = [];
    let ok = 0;
    setContinuing(true);
    try {
      const result = await autoContinue({
        maxIterations: settingsRef.current.maxIterations,
        aborted: () => abortRef.current,
        run: async () => {
          const r = await runSteps(budget, dryRun, label, shots);
          all.push(...r.ran);
          ok += r.ok;
          return r;
        },
        verify: (ran, n) => checkGoal(runGoal, ran, n),
        plan: (ran, check, n) => planNext(runGoal, ran, check, n),
      });
      addLog('Auto-continue', `Stopped after ${result.iterations} continuation(s): ${result.detail}`, STOP_TONE[result.stop]);
    } catch (error) {
      addLog('Auto-continue', aiFailure('AI unavailable — auto-continue stopped', error), 'error');
    } finally {
      setContinuing(false);
    }
    return { ran: all, ok };
  };

  /** Replay's ■ Stop: ends the run between steps and cancels the in-flight AI call. */
  const stop = () => {
    abortRef.current = true;
    cancelAi();
    addLog(subRunningRef.current ? 'Supervisor' : 'Replay', subRunningRef.current ? 'Stopped by user — the running subagent ends and the rest are aborted' : 'Stopped by user', 'warn');
  };

  /** AI Stop: the emergency-stop path, which also cancels the in-flight model call. */
  const stopAi = () => triggerAbort('AI stop button');

  /** Runs `fn` with the AI busy flag set. */
  const withAi = async (fn: () => Promise<void>) => {
    setAiBusy(true);
    try {
      await fn();
    } finally {
      setAiBusy(false);
    }
  };

  /** What the re-plan guard compares: the newest frame and how many step statuses execution changed. */
  const screenState = () => `${framesRef.current[0]?.id ?? 'none'}:${statusChangesRef.current}`;

  /** Applies a plan's steps as the current workflow and logs them (with the arrangement, when the goal asked for one). */
  const applyPlan = (text: string, planned: WorkflowStep[], why: string, arrangement = '') => {
    stepsRef.current = planned;
    setSteps(planned);
    markPlan();
    setDraftCard(generateCard(planned, text));
    addLog('Planner', `${why}: ${planned.length} step(s) — ${planned.map((s) => `${s.action} "${s.target ?? s.name}"`).join(' → ')}${arrangement}${armedRef.current ? '' : ' (real input disarmed: replay / Auto Act run it as a dry run)'}`, 'ok');
  };

  /**
   * AI plan: reuse a similar saved flow (drift-corrected), otherwise the model plans from the
   * goal + live frame with the reliable habits and learned patterns relevant to this goal as context.
   * The re-plan guard skips a plan already in flight, a goal whose re-plan came back identical,
   * and re-plans past the cap while the screen is unchanged.
   */
  const autoPlan = async (text = goal): Promise<boolean> => {
    if (!text.trim()) {
      addLog('Planner', 'Type a goal first', 'warn');
      return false;
    }
    if (!stageOn('planner')) {
      addLog('Planner', `${stageOff('planner')} — no plan made`, 'warn');
      return false;
    }
    if (planningRef.current) {
      addLog('Planner', `Re-plan guard: a plan for "${text.trim()}" is still being thought out — not starting another`, 'warn');
      return false;
    }
    const gate = planGuardRef.current.before(text, screenState());
    if (!gate.run) {
      if (gate.log) addLog('Planner', `Re-plan guard: ${gate.log}`, 'warn');
      return false;
    }
    const applied = relevantHabits(text, habitContext(), habitsRef.current);
    if (applied.length) addLog('Habits', `Applying ${applied.length} habit(s) to planning: ${applied.map(habitLine).join(' | ')}`, 'info');
    let planned = false;
    planningRef.current = true;
    await withAi(async () => {
      try {
        const plan = await thought(`Plan: ${text}`, () => planFromGoal(text, cardsRef.current, framesRef.current[0] ?? null, askFor('planner'), [...knownRef.current.map(elementLine), ...mapContext(elementMapRef.current), ...applied.map(habitLine)], patternsRef.current), planSummary);
        if (planGuardRef.current.after(plan.steps) === 'duplicate') {
          addLog('Planner', `Re-plan guard: the plan for "${text.trim()}" is identical to the previous one — kept the current steps and will not ask the model again until the screen or a step changes`, 'warn');
          return;
        }
        const { steps: next, source: why, expect } = plan;
        expectRef.current = expect;
        const arrangement = expect.length ? `; arrangement: ${expect.map((e) => `"${e.element}" ${e.relation.replace('_', ' ')} "${e.anchor}"`).join(', ')}` : '';
        applyPlan(text, next, why, arrangement);
        planned = next.length > 0;
      } catch (error) {
        addLog('Planner', aiFailure('AI plan failed — no steps created', error), 'error');
      } finally {
        planningRef.current = false;
      }
    });
    return planned;
  };

  /**
   * "/arrange <goal>": the model plans the rearrangement as drags with the arrangement it asks for
   * (a saved drag flow is never reused: it carries no relations to verify), then it replays at once
   * with the move checks and the final verification pass.
   */
  const arrange = async (text: string) => {
    if (await autoPlan(text)) await replay();
  };

  /** "/move <target>": the model plans one move onto the target, which runs at once through the grounded pipeline. */
  const moveTo = async (name: string) => {
    if (!stageOn('planner')) {
      addLog('/move', `${stageOff('planner')} — nothing executed`, 'warn');
      return;
    }
    await withAi(async () => {
      try {
        const { steps: planned } = await thought(`/move ${name}`, () => planFromGoal(`Move the mouse cursor onto the ${name} (hover, do not click)`, [], framesRef.current[0] ?? null, askFor('planner'), mapContext(elementMapRef.current)), planSummary);
        const move = planned.find((s) => s.action === 'move');
        if (!move) {
          addLog('/move', `AI did not plan a mouse move to "${name}" (it proposed ${planned.map((s) => s.action).join(', ')}) — nothing executed`, 'error');
          return;
        }
        const step = { ...move, target: move.target ?? name };
        stepsRef.current = [step];
        setSteps(stepsRef.current);
        markPlan();
        const j = await justify('/move', step, false);
        if (j.kind !== 'go') {
          failUnjustified(0, '/move', j.reason);
          return;
        }
        const out = await perform(j.step, '/move', createBudget(settingsRef.current.actionBudget), !armedRef.current, j.proposal);
        applyOutcome(0, out, !armedRef.current);
        addLog('/move', `${step.name}: ${out.message}`, out.ok ? 'ok' : 'error');
      } catch (error) {
        addLog('/move', aiFailure('AI unavailable — nothing executed', error), 'error');
      }
    });
  };

  /**
   * One subagent: its slice goes through the same pipeline as every run — plan from the slice's
   * goal on the live frame, grounded execution under its own budget slice and the guardrails,
   * reflect and verdict. It passes only when every step ran ok and every verdict says success.
   */
  const runSubagent = async (task: SubagentTask, dryRun: boolean): Promise<SubagentOutcome> => {
    const label = `Subagent ${task.index + 1}`;
    const base = { dry: dryRun, shots: [] as Frame[], thinking: [] as string[] };
    const stopped = () => abortRef.current || abortedRef.current;
    const plan = await thought(`${label}: ${task.label}`, () => planFromGoal(task.goal, [], framesRef.current[0] ?? null, askFor('planner'), knownRef.current.map(elementLine), patternsRef.current), planSummary);
    if (plan.thinking) base.thinking.push(plan.thinking);
    const budget = createBudget(task.budget);
    let last: { x: number; y: number } | undefined;
    let verdict: StepVerdict | null | undefined;
    for (const step of plan.steps) {
      if (stopped()) return { ...base, status: 'aborted', message: `Stopped before "${step.name}" — nothing more sent` };
      const local = recordLocal(label, step, `link/route test "${task.goal}", so "${step.name}" is run to verify it`);
      const briefed = await brief(label, { kind: 'go', step, proposal: local });
      if (briefed.kind !== 'go') return { ...base, status: 'fail', message: `${step.name}: not justified by the pre-action briefing` };
      const out = await execute(briefed.step, label, budget, dryRun, briefed.proposal);
      if (out.shot) base.shots.push(out.shot);
      verdict = out.verdict;
      if (verdict?.thinking) base.thinking.push(verdict.thinking);
      if (!out.ok) return { ...base, status: stopped() ? 'aborted' : 'fail', message: `${step.name}: ${out.message}`, avoid: verdict?.pattern_avoid, add: verdict?.pattern_add };
      last = out.target;
      if (!verdict) return { ...base, status: 'fail', message: `${step.name}: no AI verdict — not counted as a pass`, point: last };
      if (!verdict.success) return { ...base, status: 'fail', message: `${step.name}: AI verdict FAILED`, avoid: verdict.pattern_avoid, add: verdict.pattern_add, point: last };
    }
    return { ...base, status: 'pass', message: `${plan.steps.length} step(s) ${dryRun ? `verified (${DRY_RUN})` : 'executed'} and verified`, avoid: verdict?.pattern_avoid, add: verdict?.pattern_add, point: last };
  };

  /** The links or route stops of a request: as given, or listed by the model on the live frame. */
  const sectionsOf = async (req: TestRequest): Promise<string[]> => {
    if (req.items.length) return req.items;
    const { items } = await thought(`Supervisor: ${req.goal}`, () => listSections(askFor('supervisor'), framesRef.current[0] ?? null, req), (r) => `${r.items.length} ${req.kind === 'link' ? 'link(s)' : 'route stop(s)'}: ${r.items.join(', ')}`);
    return items;
  };

  /**
   * Thorough link/route testing: the supervisor subsections the work into one subagent per link
   * or route segment, each with its slice of the action budget, run one at a time (Auto Act
   * pauses) and stoppable by Stop or the emergency abort. Results aggregate into a pass/fail
   * report; its lessons go to the habit system and passed elements to the agent bus.
   */
  const testRoutes = async (req: TestRequest) => {
    if (abortedRef.current) return addLog('Supervisor', 'Link/route test refused — ABORTED is active; clear the abort first', 'error');
    if (subRunningRef.current) return addLog('Supervisor', 'A link/route test is already running', 'warn');
    if (!agentsRef.current('supervisor')) return addLog('Supervisor', 'Supervisor agent is off — enable it to run link/route tests', 'warn');
    const dryRun = !armedRef.current;
    abortRef.current = false;
    subRunningRef.current = true;
    setSubRunning(true);
    const report = (results: SubagentReport['results'], finished: boolean): SubagentReport => ({ goal: req.goal, kind: req.kind, time: Date.now(), finished, results });
    try {
      await withAi(async () => {
        const items = await sectionsOf(req);
        const tasks = planSubagents(req.kind, items, settingsRef.current.actionBudget);
        addLog('Supervisor', `${tasks.length} subagent(s) for "${req.goal}" — budget slices ${tasks.map((t) => t.budget).join('/')}${dryRun ? ' (real input disarmed: dry run)' : ''}`, 'info');
        setSubReport(report([], false));
        const results = await runSubagents(tasks, (t) => runSubagent(t, dryRun), () => abortRef.current || abortedRef.current, (r) => setSubReport(report(r, false)));
        setSubReport(report(results, true));
        addPatterns(reportPatterns(results, req.goal));
        results.forEach((r) => {
          if (r.status === 'pass' && r.point) forwardElement('supervisor', { name: r.target, x: r.point.x, y: r.point.y });
        });
        addLog('Supervisor', `Link/route test "${req.goal}": ${summaryText(results)}`, results.every((r) => r.status === 'pass') ? 'ok' : 'warn');
      });
    } catch (error) {
      addLog('Supervisor', `AI unavailable — no subagents run: ${errorText(error)}`, 'error');
    } finally {
      subRunningRef.current = false;
      setSubRunning(false);
    }
  };

  /** AI help: the model answers a question about the live screen and points out what it means. */
  const askScreen = async (question = 'What on this screen needs my attention, and what should I do next?') => {
    const f = framesRef.current[0];
    if (!stageOn('screenWatcher')) {
      addLog('AI help', `${stageOff('screenWatcher')} — not asked`, 'warn');
      return;
    }
    if (!f) {
      addLog('AI help', 'No captured frame yet — share the screen or connect the bridge first', 'warn');
      return;
    }
    await withAi(async () => {
      try {
        const { answer, annotations: items } = await thought(`Ask: ${question}`, () => describeScreen(askFor('screenWatcher'), f, question, goal), (r) => r.answer);
        setAiAnswer(answer);
        setAnnotations(items);
        addLog('AI help', answer, 'info');
        items.filter((a) => a.actX !== undefined && a.actY !== undefined).forEach((a) => forwardElement('screen', { name: a.label, x: a.actX!, y: a.actY!, w: a.w, h: a.h }));
      } catch (error) {
        setAiAnswer('');
        addLog('AI help', aiFailure('AI unavailable — no answer', error), 'error');
      }
    });
  };

  /** Point out: the default AI-help question. */
  const explainScreen = () => askScreen();

  /** Turns a captured screen image into a Frame and runs the monitor on it. */
  const onScreenImage = (image: CapturedImage) => {
    processRef.current({ id: ++frameId.current, ...image, source: 'screen' });
  };

  /** The capture ended by itself: stop any replay, keep the source and raise a visible error. */
  const onCaptureLost = (reason: string) => {
    captureRef.current = null;
    abortRef.current = true;
    setCaptureLost(reason);
    addLog('Screen', `CAPTURE LOST: ${reason} — monitoring halted. Restart capture or switch to the demo desktop.`, 'error');
  };

  /** Switches to a source: stops any running capture and resets the gallery. */
  const attachSource = (next: ScreenSource) => {
    captureRef.current?.stop();
    captureRef.current = null;
    demoChosenRef.current = next === 'demo';
    framesRef.current = [];
    setFrames([]);
    setCaptureLost(null);
    sourceRef.current = next;
    setSource(next);
  };

  /** Captures the real screen: Electron native capture, else the browser picker. Resolves whether it started. */
  const shareScreen = async (): Promise<boolean> => {
    const capture = createScreenCapture();
    capture.selectDisplay(settingsRef.current.displayId);
    try {
      await capture.start(monitorInterval(settingsRef.current.monitorMode, settingsRef.current.captureMs), { onImage: onScreenImage, onLost: onCaptureLost });
    } catch (error) {
      capture.stop();
      addLog('Screen', `Screen capture failed to start: ${errorText(error)}`, 'error');
      return false;
    }
    attachSource('screen');
    captureRef.current = capture;
    addLog('Screen', capture.kind === 'native' ? 'Capturing your screen natively — monitoring continues while minimized' : 'Sharing your screen — the AI now sees it', 'ok');
    return true;
  };

  /**
   * Switches the monitor to real desktop screenshots from the bridge, after a health check.
   * `target` connects to a bridge just verified by the wizard, before its settings re-render.
   */
  const connectBridge = async (target?: { url: string; token: string }): Promise<boolean> => {
    const { url, token } = target ?? { url: settingsRef.current.bridgeUrl, token: settingsRef.current.bridgeToken };
    const health = await checkBridge(url, token);
    if (!health.ok) {
      addLog('Bridge', health.message, 'error');
      captureError({ kind: 'bridge', message: health.message });
      return false;
    }
    attachSource('bridge');
    addLog('Bridge', `${health.message} — screenshots now come from the real desktop`, 'ok');
    return true;
  };

  /**
   * Verify real input: one harmless cursor move to the screen centre through the bridge, gated
   * like every real action (abort, arm, executor stage, a one-action budget). Disarmed it is a
   * dry run and sends nothing. Reports and returns the bridge's confirmation or its error.
   */
  const verifyRealInput = async (): Promise<BridgeResult> => {
    const report = (r: BridgeResult, tone: LogEntry['tone'] = r.ok ? 'ok' : 'error') => {
      addLog('Verify real input', r.message, tone);
      return r;
    };
    if (abortedRef.current) return report({ ok: false, message: 'Aborted — real input not sent' });
    if (!armedRef.current) return report({ ok: false, message: `Real input disarmed — ${DRY_RUN}` }, 'warn');
    if (!stageOn('executor')) return report({ ok: false, message: `${stageOff('executor')} — not sent` });
    const gate = gateRealInput(createBudget(1));
    if (gate) return report({ ok: false, message: gate });
    const { bridgeUrl, bridgeToken } = settingsRef.current;
    const shot = await captureDesktop(bridgeUrl, bridgeToken);
    const out = shot.ok ? await selfTestBridge(bridgeUrl, bridgeToken, shot.frame.width || 1920, shot.frame.height || 1080) : { ok: false, message: `Real input NOT verified — ${shot.message}` };
    setBridgeOnline(out.ok);
    if (!out.ok) captureError({ kind: 'bridge', message: out.message });
    return report(out);
  };

  /** Element recovery: one re-location of a named element on the live frame (learned anchor first, then the AI). */
  const locateElement = async (name: string): Promise<{ x: number; y: number } | null> => {
    const live = framesRef.current[0];
    if (!live) return null;
    const step: WorkflowStep = { id: uid('step'), name: `Find ${name}`, action: 'move', target: name, x: 0.5, y: 0.5, status: 'pending' };
    const seed = learnedPoint(live, step) ?? habitSeed(live, step);
    if (seed) return { x: seed.x, y: seed.y };
    if (!aiOnline()) return null;
    return grounding.relocate(live, step, `"${name}" was lost; find it on the current screen`).catch(() => null);
  };

  /**
   * Settles a disputed position: an off-screen point fails; with the AI online the target is
   * confirmed on a zoomed crop of the live frame, otherwise the coordinate learner's memory of it
   * must lie within the disagreement threshold of the point.
   */
  const confirmAt = async (name: string, p: { x: number; y: number }): Promise<boolean> => {
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return false;
    const live = framesRef.current[0];
    const step: WorkflowStep = { id: uid('step'), name: `Test ${name}`, action: 'move', target: name, x: p.x, y: p.y, status: 'pending' };
    if (live && aiOnline()) return grounding.confirm(live, step, p).then((c) => c.visible, () => false);
    const known = findFamiliar(familiarRef.current, name);
    return !!known && Math.hypot(known.x - p.x, known.y - p.y) <= DISAGREEMENT_THRESHOLD;
  };

  /** A replay (or self-test) as a recovery result. */
  const replayOutcome = async (selfTest: boolean, label: string) => {
    const out = await runReplay(selfTest, { label, goal: runGoalOf() });
    return out ? { ok: out.ok === out.total && !out.stopped, message: `${out.ok}/${out.total} step(s) ${out.dryRun ? 'verified (dry run)' : 'executed'}` } : { ok: false, message: `${label} refused — see the log` };
  };

  /** The AI resolution center and recovery operations, on the engine's gated pipeline and memories. */
  const resolution = useResolution({
    steps,
    bus,
    context: habitContext,
    goal: () => goalRef.current,
    addLog,
    ask: askFor('supervisor'),
    aiOnline,
    frame: () => framesRef.current[0] ?? null,
    currentSteps: () => stepsRef.current,
    setPlan: (next) => {
      stepsRef.current = next;
      setSteps(next);
    },
    newBudget: () => createBudget(settingsRef.current.actionBudget),
    perform: async (step, actor, why, budget) => {
      const out = await perform(step, actor, budget, !armedRef.current, recordLocal(actor, step, why), false);
      return { ok: out.ok, message: out.message };
    },
    confirm: confirmAt,
    locate: locateElement,
    forwardElement,
    addPatterns,
    recordHabit: (o) => {
      if (stageOn('coords')) commitHabits(recordOutcome(habitsRef.current, o));
    },
    retry: () => replayOutcome(false, 'Main retry'),
    selfTest: () => replayOutcome(true, 'Main test'),
    fix: async () => {
      await superviseRun();
      return { ok: supervisorRef.current.status === 'done', message: supervisorRef.current.detail };
    },
    connect: () => connectBridge(),
  });

  // Bridge takeover: when a configured bridge answers, frames come from the real desktop unless the user chose the demo.
  useEffect(() => {
    const url = settings.bridgeUrl;
    setBridgeOnline(false);
    if (!url) return undefined;
    let cancelled = false;
    void checkBridge(url, settings.bridgeToken).then((r) => {
      if (cancelled) return;
      setBridgeOnline(r.ok);
      if (!r.ok || demoChosenRef.current || sourceRef.current !== 'demo') return;
      attachSource('bridge');
      addLog('Monitor', 'Desktop bridge online — screenshots now come from the real screen', 'ok');
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.bridgeUrl, settings.bridgeToken, addLog]);

  /** "/use <target>": launch/focus the app on the PC via the bridge, or attach to its window via screen share. */
  const attachTarget = async (name: string) => {
    if (settingsRef.current.bridgeUrl && (await connectBridge())) {
      const open: WorkflowStep = { id: uid('step'), name: `Open ${name}`, action: 'open_app', text: name, x: 0.5, y: 0.5, status: 'pending' };
      const proposal = recordLocal('/use', open, `you asked to use "${name}", so it is opened or focused on the PC before anything else`);
      const out = await perform(open, '/use', createBudget(settingsRef.current.actionBudget), !armedRef.current, proposal);
      addLog('/use', out.ok ? `${out.message}; attached to "${name}"` : `Could not open "${name}": ${out.message}`, out.ok ? 'ok' : 'error');
      if (out.ok) setTarget(name);
      return;
    }
    addLog('/use', `No desktop bridge online — pick the "${name}" window to attach to (acting on it needs the bridge)`, 'info');
    if (await shareScreen()) setTarget(name);
  };

  /** "/measure A to B [to C…]": measured on the live frame, drawn, kept and logged; an unknown element is a loud error. */
  const measureCommand = async (query: string) => {
    try {
      ruler.measureQuery(query, '/measure');
    } catch (error) {
      addLog('/measure', `Measurement failed — ${errorText(error)}`, 'error');
    }
  };

  /** Each slash command's runner. */
  const COMMAND_RUNNERS: Record<'use' | 'move' | 'measure' | 'arrange', (target: string) => Promise<void>> = { use: attachTarget, move: moveTo, measure: measureCommand, arrange };

  /** Submits the assist input: /use, /move, /measure and /arrange run, anything else is planned as a goal. */
  const submitInput = async () => {
    const command = parseCommand(goal);
    if (!command) {
      if (isTestGoal(goal)) await testRoutes(parseTestSpec(goal));
      else await autoPlan(goal);
      return;
    }
    if (command.kind === 'error') {
      addLog('Command', command.message, 'warn');
      return;
    }
    setGoal('');
    if (command.kind === 'test') await testRoutes(parseTestSpec(command.target));
    else await COMMAND_RUNNERS[command.kind](command.target);
  };

  /** Explicit demo mode. */
  const useDemo = () => {
    attachSource('demo');
    setTarget(null);
    addLog('Screen', 'Demo desktop selected');
  };

  /** Downloads the action history as JSON or CSV. */
  const exportHistory = (format: 'json' | 'csv') => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (format === 'json') downloadText(`droid-actions-${stamp}.json`, historyToJson(history), 'application/json');
    else downloadText(`droid-actions-${stamp}.csv`, historyToCsv(history), 'text/csv');
    addLog('History', `Exported ${history.length} action(s) as ${format.toUpperCase()}`, 'ok');
  };

  const resetHistory = () => setHistory(clearHistory());

  const updateWatcher = (fn: (w: WatcherState) => WatcherState) => {
    watcherRef.current = fn(watcherRef.current);
    setWatcher(watcherRef.current);
  };

  /** A capture source is live: the demo, the bridge, or a running (not lost) screen capture. */
  const captureLive = () => sourceRef.current === 'demo' || sourceRef.current === 'bridge' || (sourceRef.current === 'screen' && !!captureRef.current);

  /**
   * Tests a proposal's on-screen target as a click through the shared pipeline: a dry run unless
   * armed (abort latch and the watcher's budget gate real input). The result goes to the panel and
   * the log; a failed test is learned as an "avoid" pattern.
   */
  const runWatchTest = async (p: WatchProposal) => {
    const step = proposalStep(p);
    if (!step) {
      addLog('Screen watcher', `"${p.text}" has no on-screen target to test`, 'warn');
      return;
    }
    const dryRun = !armedRef.current;
    const tried = `${dryRun ? 'Dry-run' : 'Real'} click on "${step.target}" at ${gridRef(step)}`;
    const actor = dryRun ? 'Screen watcher (dry run)' : 'Screen watcher';
    // performStep, not perform: a test must not remember its target as familiar — only Accept does.
    const out = await performStep(step, actor, watchBudgetRef.current, dryRun);
    if (!out.halt && aiOnline()) await reflectAfter(step, out.shot ?? framesRef.current[0] ?? null, out, actor);
    const verdict = out.ok ? 'passed' : 'failed';
    updateWatcher((w) => ({ ...w, tests: addTest(w.tests, { proposalId: p.id, tried, happened: out.message, verdict, dryRun }), proposals: patchProposal(w.proposals, p.id, { tested: true }) }));
    addLog('Screen watcher', `Test ${verdict}: ${tried} — ${out.message}`, out.ok ? 'ok' : 'warn');
    if (out.ok) return;
    addPatterns([newPattern('avoid', `${tried} failed — ${out.message}`, p.text)]);
    addLog('Patterns', `Watcher test failed — learned: avoid ${tried}`, 'warn');
  };

  /** Stores an observation: deduplicated notes and proposals, each new proposal logged. */
  const recordObservation = (obs: Observation) => {
    const time = Date.now();
    const notes = mergeNotes(watcherRef.current.notes, obs.notes, time);
    const proposals = mergeProposals(watcherRef.current.proposals, obs.proposals, time);
    updateWatcher((w) => ({ ...w, notes: notes.notes, proposals: proposals.proposals }));
    if (notes.added.length) addLog('Screen watcher', `${notes.added.length} new note(s): ${notes.added.map((n) => n.text).join('; ')}`, 'info');
    proposals.added.forEach((p) => addLog('Screen watcher', `Proposal: ${p.text}`, 'info'));
  };

  /** One watcher round: observe the live frame, record notes/proposals, then background-test one untested proposal. */
  const watchTick = async () => {
    if (!stageOn('screenWatcher') || watchBusyRef.current || executorBusy() || abortedRef.current || !captureLive() || pausedWhileHidden() || !aiOnline()) return;
    const frame = framesRef.current[0];
    if (!frame) return;
    watchBusyRef.current = true;
    try {
      recordObservation(await thought('Screen watcher', () => observeScreen(askFor('screenWatcher'), frame, watcherRef.current.notes, stepsRef.current, goalRef.current), observationSummary));
      const untested = watcherRef.current.proposals.find((p) => p.status === 'pending' && !p.tested && proposalStep(p));
      if (untested && !executorBusy() && !abortedRef.current) await runWatchTest(untested);
    } catch (error) {
      addLog('Screen watcher', `AI unavailable — no notes this round: ${errorText(error)}`, 'warn');
    } finally {
      watchBusyRef.current = false;
    }
  };
  const watchTickRef = useRef(watchTick);
  watchTickRef.current = watchTick;

  // Screen watcher loop at its own interval while the agent is on; each switch-on renews its budget.
  const watcherOn = settings.stages.screenWatcher;
  useEffect(() => {
    if (!watcherOn) return undefined;
    watchBudgetRef.current = createBudget(settingsRef.current.actionBudget);
    const id = setInterval(() => void watchTickRef.current(), settings.watchMs);
    return () => clearInterval(id);
  }, [watcherOn, settings.watchMs]);

  /** Applies an accepted proposal through the existing mechanisms; null when it does not apply now. */
  const applyProposal: Record<ProposalKind, (p: WatchProposal) => string | null> = {
    close_popup: (p) => {
      addPatterns([newPattern('add', `Close the returning popup with its ${p.target ?? 'close control'}`, p.text)]);
      return 'added to the close list (learned pattern)';
    },
    familiar: (p) => {
      if (!p.target || p.x === undefined || p.y === undefined) return null;
      setFamiliar((list) => rememberElement(list, { id: uid('el'), name: p.target!, x: p.x!, y: p.y!, lastSeen: Date.now() }));
      return `saved "${p.target}" as a familiar element`;
    },
    pattern: (p) => {
      const kind = /^avoid\b/i.test(p.text) ? 'avoid' : 'add';
      addPatterns([newPattern(kind, p.text.replace(/^(avoid|add)\b\s*:?\s*/i, '') || p.text, p.target ?? '')]);
      return `saved as an "${kind}" pattern`;
    },
    reorder: (p) => {
      const next = p.from && p.to ? reorderSteps(stepsRef.current, p.from, p.to) : null;
      if (!next) return null;
      stepsRef.current = next;
      setSteps(next);
      return `moved step ${p.from} to position ${p.to}`;
    },
  };

  const acceptProposal = (id: string) => {
    const p = watcherRef.current.proposals.find((x) => x.id === id && x.status === 'pending');
    if (!p) return;
    const done = applyProposal[p.kind](p);
    if (done === null) {
      addLog('Screen watcher', `Cannot apply "${p.text}" — it does not match the current screen or steps`, 'warn');
      return;
    }
    updateWatcher((w) => ({ ...w, proposals: patchProposal(w.proposals, id, { status: 'accepted' }) }));
    addLog('Screen watcher', `Accepted "${p.text}": ${done}`, 'ok');
  };

  const dismissProposal = (id: string) => {
    const p = watcherRef.current.proposals.find((x) => x.id === id && x.status === 'pending');
    if (!p) return;
    updateWatcher((w) => ({ ...w, proposals: patchProposal(w.proposals, id, { status: 'dismissed' }) }));
    addLog('Screen watcher', `Dismissed "${p.text}"`, 'info');
  };

  /** The Test button: a background test of one proposal, refused while the executor or watcher is busy. */
  const testProposal = async (id: string) => {
    const p = watcherRef.current.proposals.find((x) => x.id === id);
    if (!p) return;
    if (watchBusyRef.current || executorBusy()) {
      addLog('Screen watcher', `Busy running a step — test of "${p.text}" not started`, 'warn');
      return;
    }
    watchBusyRef.current = true;
    try {
      await runWatchTest(p);
    } finally {
      watchBusyRef.current = false;
    }
  };

  const saveCard = () => {
    if (!draftCard) return;
    const id = uid('card');
    flowRef.current = id;
    setCards((c) => [{ id, ...draftCard, steps: stepsRef.current, savedAt: Date.now() }, ...c]);
    addLog('Library', `Saved "${draftCard.name}"`, 'ok');
    setDraftCard(null);
  };

  const loadCard = (card: SavedCard) => {
    expectRef.current = [];
    stepsRef.current = card.steps.map((s) => ({ ...s, status: 'pending' as const }));
    setSteps(stepsRef.current);
    markPlan();
    flowRef.current = card.id;
    addLog('Library', `Loaded "${card.name}"`);
  };

  const setTriggerList = (next: Trigger[]) => {
    triggersRef.current = next;
    setTriggers(next);
  };
  const patchTrigger = (id: string, fn: (t: Trigger) => Trigger) => setTriggerList(triggersRef.current.map((t) => (t.id === id ? fn(t) : t)));
  const targetLabel = (t: Trigger) => (t.target.kind === 'draft' ? 'the draft card' : `flow "${cardsRef.current.find((c) => c.id === (t.target as { cardId: string }).cardId)?.name ?? 'deleted flow'}"`);

  /** Creates a trigger from the Triggers panel; appear/disappear need an element mapped with its template frame. */
  const addTrigger = (draft: TriggerDraft) => {
    if (!draft.name.trim()) return addLog('Triggers', 'Name the trigger first', 'warn');
    if (draft.kind === 'schedule' && !(Number.isFinite(draft.at) && draft.at >= 0)) return addLog('Triggers', `"${draft.name.trim()}" not created — set a valid run time`, 'warn');
    if (draft.kind === 'element') {
      const el = elementMapRef.current.find((e) => e.id === draft.elementId);
      if (!el) return addLog('Triggers', `"${draft.name.trim()}" not created — pick a mapped element`, 'warn');
      if (draft.event !== 'change' && !el.frame) return addLog('Triggers', `"${draft.name.trim()}" not created — "${el.name}" was mapped without a live frame, so its presence cannot be judged; re-map it on the live screen`, 'warn');
    }
    const t = createTrigger(draft, uid('trigger'));
    setTriggerList([t, ...triggersRef.current].slice(0, TRIGGER_LIMIT));
    addLog('Triggers', `Created "${t.name}": run ${targetLabel(t)} ${conditionText(t, elementMapRef.current)} (cooldown ${t.cooldownSec} s, ${t.maxRuns ? `at most ${t.maxRuns} run(s)` : 'no run limit'})`, 'ok');
  };

  const toggleTrigger = (id: string) => {
    const t = triggersRef.current.find((x) => x.id === id);
    if (!t) return;
    // Re-enabling a trigger that hit its run limit starts a fresh count.
    patchTrigger(id, (x) => (x.enabled ? { ...x, enabled: false } : { ...x, enabled: true, runs: x.maxRuns && x.runs >= x.maxRuns ? 0 : x.runs }));
    addLog('Triggers', `"${t.name}" ${t.enabled ? 'disabled' : 'enabled'}`, t.enabled ? 'info' : 'ok');
  };

  const deleteTrigger = (id: string) => {
    const t = triggersRef.current.find((x) => x.id === id);
    if (!t) return;
    setTriggerList(triggersRef.current.filter((x) => x.id !== id));
    addLog('Triggers', `Deleted "${t.name}"`, 'info');
  };

  /** The goal a triggered run verifies: the flow's description or name, else the draft card's goal. */
  const triggeredGoal = (card?: SavedCard) => (card ? card.description.trim() || card.name : runGoalOf());

  /**
   * Fires trigger `id` through the same replay pipeline as the Replay button (grounding, execution,
   * reflect, verdict, auto-continue, retry ladder, arm/disarm, budget, abort, loop-control stages).
   * A cooldown, run limit, ABORTED or a missing target skips it (logged; a schedule moves on).
   */
  const fireTrigger = async (id: string, why: string) => {
    const t = triggersRef.current.find((x) => x.id === id);
    if (!t) return;
    if (triggerBusyRef.current || executorBusy()) {
      addLog('Triggers', `"${t.name}" skipped (${why}) — a run is in progress`, 'warn');
      return;
    }
    const now = Date.now();
    const skip = fireGate(t, now);
    const target = resolveTarget(t.target, cardsRef.current, draftCard);
    const refusal = skip ? skip.detail : abortedRef.current ? 'ABORTED is active; clear the abort first' : 'error' in target ? `cannot run — ${target.error}` : null;
    if (refusal !== null || 'error' in target) {
      addLog(!skip && abortedRef.current ? 'Safety' : 'Triggers', `"${t.name}" skipped (${why}): ${refusal}`, skip?.reason === 'cooldown' ? 'info' : 'warn');
      patchTrigger(id, (x) => afterSkip(x, now));
      return;
    }
    const fired = afterFire(t, now);
    patchTrigger(id, () => fired);
    addLog('Triggers', `Fired "${t.name}" (${why}) — running ${target.name}, run ${fired.runs}${fired.maxRuns ? ` of ${fired.maxRuns}` : ''}`, 'info');
    if (!fired.enabled && t.enabled) addLog('Triggers', `"${t.name}" ${fired.kind === 'schedule' && fired.everySec === 0 ? 'was a one-time schedule' : `reached its run limit (${fired.maxRuns})`} — disabled`, 'info');
    if (target.card) loadCard(target.card);
    triggerBusyRef.current = true;
    try {
      const result = outcomeText(await runReplay(false, { label: `Trigger "${t.name}"`, goal: triggeredGoal(target.card) }));
      addLog('Triggers', `"${t.name}" result: ${result.text}`, result.tone);
    } finally {
      triggerBusyRef.current = false;
    }
  };

  /** The element triggers whose event the newest frame shows; each frame is evaluated once, the first as a baseline. */
  const elementEvents = (): Array<{ id: string; why: string }> => {
    const frame = framesRef.current[0];
    if (!frame || frame.id === triggerFrameRef.current) return [];
    triggerFrameRef.current = frame.id;
    const watching = triggersRef.current.filter((t): t is ElementTrigger => t.kind === 'element' && t.enabled);
    const snaps = elementSnapsRef.current;
    [...snaps.keys()].filter((id) => !watching.some((t) => t.elementId === id)).forEach((id) => snaps.delete(id));
    const out: Array<{ id: string; why: string }> = [];
    for (const el of elementMapRef.current.filter((e) => watching.some((t) => t.elementId === e.id))) {
      const { snapshot, events } = observeElement(el, snaps.get(el.id), frame);
      snaps.set(el.id, snapshot);
      watching.filter((t) => t.elementId === el.id && events.includes(t.event)).forEach((t) => out.push({ id: t.id, why: `"${el.name}" ${t.event === 'change' ? 'changed' : `${t.event}ed`} on screen` }));
    }
    return out;
  };

  /**
   * One trigger round: element triggers against the live frame (only while the Screen watcher stage
   * is on and a capture is live), then due schedules. During a run, element events are logged as
   * skipped and due schedules wait until the executor is free.
   */
  const triggerTick = async () => {
    const events = stageOn('screenWatcher') && captureLive() && !pausedWhileHidden() ? elementEvents() : [];
    if (triggerBusyRef.current || executorBusy()) {
      events.forEach((e) => addLog('Triggers', `"${triggersRef.current.find((t) => t.id === e.id)?.name}" skipped (${e.why}) — a run is in progress`, 'warn'));
      return;
    }
    const now = Date.now();
    const due = triggersRef.current.filter((t): t is ScheduleTrigger => t.kind === 'schedule' && scheduleDue(t, now)).map((t) => ({ id: t.id, why: `scheduled for ${new Date(t.at).toLocaleTimeString()}` }));
    for (const d of [...events, ...due]) await fireTrigger(d.id, d.why);
  };
  const triggerTickRef = useRef(triggerTick);
  triggerTickRef.current = triggerTick;

  // Trigger loop while any trigger is enabled.
  const anyTriggerOn = triggers.some((t) => t.enabled);
  useEffect(() => {
    if (!anyTriggerOn) return undefined;
    const id = setInterval(() => void triggerTickRef.current(), TRIGGER_TICK_MS);
    return () => clearInterval(id);
  }, [anyTriggerOn]);

  return {
    settings, setSettings, source, target, frames, pinned, setPinned, steps, setSteps, trail, setTrail, recording, replaying,
    activeIndex, sync, annotations, cursor, log, cards, draftCard, setDraftCard, goal, setGoal, progress, setProgress,
    agents, setAgents, toggleStage, plays, demoCanvasRef, captureLost, DEMO_W, DEMO_H, intervalMs, shotCount, history,
    armed, aborted, aiStatus, aiAnswer, aiBusy, timeline, patterns, deletePattern, supervisor, superviseRun,
    ruler, continuing, habits, deleteHabit, pinHabit, runs,
    familiar, forgetFamiliar, elements, learned, highlight, testClick,
    elementMap, mapMode, toggleMapMode, mapDraft, setMapDraft, saveMapped, deleteMapped,
    watcher, acceptProposal, dismissProposal, testProposal,
    triggers, addTrigger, toggleTrigger, deleteTrigger, fireTrigger,
    bus, knownElements, forwardElement, subReport, subRunning, testRoutes, aiQueue,
    aiHistory, trimAiHistory, resetAiSession,
    /** The AI is planning, reflecting, deciding or verifying right now. */
    aiWorking: aiBusy || aiCalls > 0,
    onStageMove, onStageClick, onStageDrag, onStageType, onStageKey, onStageScroll, toggleRecording, replay, stop, stopAi, autoPlan, submitInput, askScreen, explainScreen,
    shareScreen, connectBridge, useDemo, saveCard, loadCard, addLog, toggleArmed, triggerAbort, clearAbort, exportHistory, resetHistory,
    bridgeOnline, verifyRealInput,
    /** Whether input really reaches the PC right now (armed + bridge connected + executor stage on, not aborted). */
    dispatch: dispatchState({ armed, bridgeOnline, executorOn: settings.stages.executor, aborted }),
    reverse, reverseLast, reversing, briefings,
    /** The AI resolution center: disagreements, resolutions, recovery operations and the approval queue. */
    resolution,
    errors: errorForwarding.errors, errorEndpoint: errorForwarding.endpoint, sendErrorNow: errorForwarding.sendNow, sendTestError: errorForwarding.sendTest,
  };
}

/** The engine's public surface, for panels. */
export type AssistEngine = ReturnType<typeof useAssist>;
