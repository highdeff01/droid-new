import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionRecord, Annotation, AssistSettings, FamiliarElement, Frame, Habit, InputAction, LearnedPattern, LogEntry, SavedCard, ScreenSource, StepAction, SyncLevel, TrailPoint, WorkflowStep } from './types.js';
import { POINTER_ACTIONS } from './types.js';
import { SAMPLE_H, SAMPLE_W, boundingBox, boxDistance, diffCells, frameDistance, largestCluster, matchTemplate, syncLevelFor } from './drift.js';
import { AD_CYCLE, demoAd, demoDrag, demoPlayButton, drawDemoDesktop, initialDemoFile, type DemoFile } from './demo-desktop.js';
import { AI_PLAN_SOURCE, calculate, generateCard, patternLine, planFromGoal, planRemaining, relevantPatterns, relocateTarget, uid } from './planner.js';
import { AiCancelled, AiParseError, DEFAULT_AI_MODEL, DEFAULT_AI_URL, createAiSession, linkSignals, pingAi } from './ai.js';
import type { AiReply, AiStatus, AskFn, AskRequest } from './ai.js';
import { DEFAULT_STAGES, createStageControllers, stageOff, toggleMessage, type StageId } from './loop-control.js';
import { confirmTarget, decidePopup, decideStep, describeScreen, judgeStep, reflectOn, reflectStep, verifyGoal, type GoalCheck, type PopupDecision, type StepDecision, type StepResult, type TargetCheck, type Thought } from './assist-ai.js';
import { DEFAULT_MAX_ITERATIONS, autoContinue, type ContinueStop, type RunReport } from './auto-continue.js';
import { DEFAULT_CHANGE_CELLS, assessChange, changeText, detectChange, type ChangeAssessment, type ScreenChange } from './screen-change.js';
import { localProposal, proposalText, proposeStep, type Proposal, type ProposalContext } from './proposal.js';
import { addEntry, verdictText, type ThinkingEntry, type ThoughtKind } from './thinking-timeline.js';
import { BRIDGE_REQUIRED, captureDesktop, checkBridge, dragEnd } from './bridge.js';
import { dragEndError, runStep, type Grounding, type StepOutcome } from './run-step.js';
import { boxedFrames, patchAt, zoomFrame } from './grounding.js';
import { parseCommand } from './commands.js';
import { createPlanGuard } from './plan-guard.js';
import { createScreenCapture, monitorInterval, type CapturedImage, type ScreenCapture } from './capture.js';
import { DEFAULT_ABORT_HOTKEY, DEFAULT_ACTION_BUDGET, createBudget, matchesHotkey, spendAction, type ActionBudget } from './safety.js';
import { LOG_LIMIT, loadCards, loadFamiliar, loadHabits, loadLog, loadPatterns, loadSettings, loadWatcher, saveCards, saveFamiliar, saveHabits, saveLog, savePatterns, saveSettings, saveWatcher } from './storage.js';
import { addTest, mergeNotes, mergeProposals, observeScreen, patchProposal, proposalStep, reorderSteps, type Observation, type ProposalKind, type WatchProposal, type WatcherState } from './watcher.js';
import { forgetElement, listElements, rememberElement, type ScreenElement } from './elements.js';
import { gridRef } from './grid.js';
import { POINTER_LIMIT, detectDwell, dwellObservation, findFamiliar, learnCoordinate, learnedSeed, learnedTargets, type CoordObservation } from './coords.js';
import { decodeFrames, toStoredFrame } from './frame-codec.js';
import { loadStoredFrames, putStoredFrame } from './frame-store.js';
import { appendHistory, clearHistory, downloadText, historyToCsv, historyToJson, loadHistory } from './action-history.js';
import { failurePattern, flowCard, learnPatterns, mergePatterns, newPattern, runVerdict, upsertCard } from './flow-memory.js';
import { useErrorForwarding } from './use-error-forwarding.js';
import { buildElementMap } from './element-map.js';
import type { Calibration } from './calibration.js';
import { remapStep, useMeasure } from './use-measure.js';
import { anchoredHabit, habitLine, recordOutcome, relevantHabits, seedFromAnchor, strengthenHabit, togglePin } from './habits.js';
import type { StepVerdict } from './assist-ai.js';

const DEMO_W = 960;
const DEMO_H = 540;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
/** Log text of a failed model call: a user cancel says so, anything else is the endpoint failure after `what`. */
const aiFailure = (what: string, error: unknown) => (error instanceof AiCancelled ? `AI call cancelled by the user — ${what.replace(/^AI unavailable — /, '')}` : `${what}: ${errorText(error)}`);
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

/** Draws a source into a Frame: a 480×270 display JPEG plus the 320×180 drift buffer. */
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
  return { id, time: Date.now(), url: view.toDataURL('image/jpeg', 0.7), data: sctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H), srcW, srcH, source };
}

/** A real desktop screenshot from the bridge as a Frame; throws with the bridge's reason. */
async function desktopFrame(bridgeUrl: string, id: number): Promise<Frame> {
  const shot = await captureDesktop(bridgeUrl);
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

/** One step's real result plus whether the run must stop (abort, disarm, budget). */
type Performed = StepOutcome & { halt?: boolean };

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
  monitorMode: 'app',
  watchMs: 5000,
  autoAct: false,
  aiHelp: true,
  showTrail: true,
  showGrid: true,
  bridgeUrl: '',
  abortHotkey: DEFAULT_ABORT_HOTKEY,
  actionBudget: DEFAULT_ACTION_BUDGET,
  aiUrl: DEFAULT_AI_URL,
  aiModel: DEFAULT_AI_MODEL,
  autoContinue: false,
  maxIterations: DEFAULT_MAX_ITERATIONS,
  stages: DEFAULT_STAGES,
  errorUrl: '',
  errorForwarding: false,
  errorToken: '',
};

/** A background agent the user can toggle. */
export interface Agent {
  id: 'popup' | 'drift' | 'progress' | 'goal' | 'coords';
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
  const [log, setLog] = useState<LogEntry[]>(loadLog);
  const [cards, setCards] = useState<SavedCard[]>([]);
  /** Lessons learned from finished runs, fed into future planning. */
  const [patterns, setPatterns] = useState<LearnedPattern[]>(loadPatterns);
  const [familiar, setFamiliar] = useState<FamiliarElement[]>(loadFamiliar);
  /** Per-target, per-app habits learned from every executed step, applied to planning and grounding. */
  const [habits, setHabits] = useState<Habit[]>(() => loadHabits());
  /** The Screen watcher's notes, proposals and test results (persisted). */
  const [watcher, setWatcher] = useState<WatcherState>(loadWatcher);
  const [highlight, setHighlight] = useState<{ x: number; y: number; label: string } | null>(null);
  const [draftCard, setDraftCard] = useState<{ name: string; description: string } | null>(null);
  const [goal, setGoal] = useState('');
  const [progress, setProgress] = useState({ done: 0, manual: 0 });
  const [agents, setAgents] = useState<Agent[]>([
    { id: 'popup', name: 'Popup watcher', description: 'Flags ads & intrusive popups, auto-closes when Auto act is on', on: true },
    { id: 'drift', name: 'Drift monitor', description: 'Cross-checks every frame against the active step', on: true },
    { id: 'progress', name: 'Progress tracker', description: 'Counts verified steps toward the goal', on: true },
    { id: 'goal', name: 'Goal reviewer', description: 'Reviews the goal after each run and suggests what is next', on: true },
    { id: 'coords', name: 'Coordinate learner', description: 'Learns target coordinates from cursor dwell and verified actions; seeds grounding with them', on: true },
  ]);
  const [plays, setPlays] = useState(0);
  const [armed, setArmed] = useState(false);
  const [aborted, setAborted] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus>({ state: 'checking', detail: 'Connecting to the AI endpoint…' });
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  /** Model calls in flight (planning, reflecting, deciding, verifying). */
  const [aiCalls, setAiCalls] = useState(0);
  /** An auto-continue loop is running. */
  const [continuing, setContinuing] = useState(false);
  /** Per-step Qwen thinking timeline, newest first: thought, reflection and verdict of every AI call. */
  const [timeline, setTimeline] = useState<ThinkingEntry[]>([]);
  const [captureLost, setCaptureLost] = useState<string | null>(null);

  const demoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureRef = useRef<ScreenCapture | null>(null);
  const tickRef = useRef(0);
  /** The demo desktop's draggable Report file. */
  const demoFileRef = useRef<DemoFile>(initialDemoFile());
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
  const aiSessionRef = useRef(createAiSession(typeof sessionStorage === 'undefined' ? null : sessionStorage));
  /** Cancels every in-flight model call when aborted; replaced by a fresh one after each cancel. */
  const aiCtrlRef = useRef(new AbortController());
  /** Loop control: one controller per stage, so unchecking a stage cancels only its in-flight calls. */
  const stageCtrlsRef = useRef(createStageControllers());
  const aiStatusRef = useRef(aiStatus);
  const logRef = useRef(log);
  const goalRef = useRef(goal);
  const replayingRef = useRef(false);
  const recordingRef = useRef(false);
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
  const watcherRef = useRef(watcher);
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
  useEffect(() => saveLog(log), [log]);
  useEffect(() => savePatterns(patterns), [patterns]);
  useEffect(() => saveFamiliar(familiar), [familiar]);
  useEffect(() => saveHabits(habits), [habits]);
  useEffect(() => saveWatcher(watcher), [watcher]);
  useEffect(() => {
    if (cardsHydratedRef.current) saveCards(cards);
  }, [cards]);

  // Hydrate saved cards and the recent frame gallery.
  useEffect(() => {
    let live = true;
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

  const addLog = useCallback((from: string, message: string, tone: LogEntry['tone'] = 'info') => {
    setLog((l) => [{ id: uid('log'), time: Date.now(), source: from, message, tone }, ...l].slice(0, LOG_LIMIT));
  }, []);

  /** Error forwarding: reports carry the recent log and the current frame. */
  const errorForwarding = useErrorForwarding(settings, addLog, () => ({ log: logRef.current, frame: framesRef.current[0] ?? null }));
  const captureError = errorForwarding.capture;

  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  /** The element map the ruler and the measure action resolve names against. */
  const elementMap = useCallback(() => buildElementMap(annotationsRef.current, stepsRef.current, cardsRef.current), []);

  /** Recalibration drift: workflow steps and saved flows move into the live layout. */
  const rescaleStored = useCallback((cal: Calibration) => {
    stepsRef.current = stepsRef.current.map((s) => remapStep(cal, s));
    setSteps(stepsRef.current);
    cardsRef.current = cardsRef.current.map((c) => ({ ...c, steps: c.steps.map((s) => remapStep(cal, s)) }));
    setCards(cardsRef.current);
  }, []);

  const ruler = useMeasure({ frames, framesRef, elementMap, addLog, rescale: rescaleStored });

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

  /**
   * Every model call, made on behalf of a loop-control `stage`: with session history and the recent
   * log, cancellable through aiCtrlRef (abort) and the stage's own controller (unchecking it).
   * An unchecked stage is refused as a cancel. A failure marks the AI offline and is rethrown; a cancel is rethrown as is.
   */
  const askAi = useCallback(async (req: AskRequest, stage: StageId): Promise<AiReply> => {
    if (!settingsRef.current.stages[stage]) throw new AiCancelled(stageOff(stage));
    const { aiUrl, aiModel } = settingsRef.current;
    const context = req.context ?? logRef.current.slice(0, 8).map((l) => `[${l.source}] ${l.message}`);
    const signal = linkSignals(aiCtrlRef.current.signal, stageCtrlsRef.current.signal(stage));
    setAiCalls((n) => n + 1);
    try {
      const reply = await aiSessionRef.current.ask({ url: aiUrl, model: aiModel }, { ...req, context, signal });
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

  /** A reply that held no JSON is logged as an AI parse failure with its truncated raw text — never shown as an answer. */
  const reportParseFailure = useCallback((step: string, error: unknown) => {
    if (error instanceof AiParseError) addLog('AI parse', `Unparseable reply for "${step}" (raw, truncated): ${error.raw}`, 'error');
  }, [addLog]);

  /**
   * Runs one AI decision and records its initial thinking on the timeline, or the failure
   * when the call fails (rethrown). `summary` returning null means no model call was made.
   */
  const thought = useCallback(async <T extends Thought>(step: string, call: () => Promise<T>, summary: (r: T) => string | null, kind: ThoughtKind = 'thought'): Promise<T> => {
    try {
      const r = await call();
      const text = summary(r);
      if (text !== null) note({ step, kind, text, thinking: r.thinking });
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
      return thought(step.name, () => confirmTarget(askFor('grounding'), crop, step), checkSummary(step, p));
    },
    relocate: async (live, step, feedback) => {
      const { point } = await thought(step.name, async () => {
        const next = await relocateTarget(askFor('grounding'), live, step, feedback);
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
    setCards(next);
    addLog('Library', `Flow saved: "${next[0].name}" (${runSteps.length} step(s), drift-corrected)${replaced ? ` — updated the existing "${replaced.name}"` : ''}`, 'ok');
  }, [addLog]);

  /**
   * Run memory: a successful real run is saved as a flow; a failed one records its failure
   * pattern instead. Either way the model is asked for lessons; its failure never blocks saving.
   */
  const learnFromRun = useCallback(async (runSteps: WorkflowStep[], opts: { dryRun: boolean; stopped: boolean }) => {
    const verdict = runVerdict(runSteps, opts);
    if (verdict === 'ignored' || !stageOn('supervisor')) return;
    const runGoal = goalRef.current.trim();
    if (verdict === 'success') autoSaveFlow(runGoal, runSteps);
    else {
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
  }, [addLog, addPatterns, askFor, autoSaveFlow]);

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
    if (!on) stageCtrlsRef.current.cancel(id);
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

  const adDismissed = () => Math.floor(tickRef.current / AD_CYCLE) === dismissedCycleRef.current;

  /** Appends one performed mouse/keyboard action to the persistent history. */
  const recordAction = useCallback((step: WorkflowStep, out: StepOutcome, actor: string, via: ActionRecord['via'], srcW: number, srcH: number) => {
    const kind = INPUT_ACTIONS[step.action];
    if (!kind) return;
    const end = kind === 'drag' ? dragEnd(step, srcW, srcH) : null;
    const rec: ActionRecord = { id: uid('act'), time: Date.now(), action: kind, x: Math.round(out.target.x * srcW), y: Math.round(out.target.y * srcH), ...(end ? { endX: end.x, endY: end.y } : {}), text: step.text, source: actor, via, ok: out.ok, message: out.message };
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

  /** Applies a drag to the demo desktop: grabbing the Report file moves (or archives) it. */
  const applyDemoDrag = useCallback((from: { x: number; y: number }, to: { x: number; y: number }): string => {
    const r = demoDrag(demoFileRef.current, from, to);
    demoFileRef.current = r.file;
    return r.message;
  }, []);

  /** The simulated effect of a pointer step on the demo desktop at `p`. */
  const demoEffect = (step: WorkflowStep, p: { x: number; y: number }): string => {
    if (step.action === 'click' || step.action === 'double_click') return demoClick(p.x, p.y);
    if (step.action === 'move') return `Moved the cursor to (${pct(p.x)}, ${pct(p.y)})`;
    if (step.action === 'drag') return applyDemoDrag(p, { x: step.endX ?? p.x, y: step.endY ?? p.y });
    return `${step.action} simulated on the demo desktop`;
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
      const r = matchTemplate(step.refFrame.data, live.data, step.x, step.y);
      if (syncLevelFor(r) === 'red') return { ok: false, executed: false, message: `Target of "${step.name}" not found on the demo screen (best match ${r.matchDistance.toFixed(3)}) — not executed`, target: p };
      p = { x: step.x + r.dx, y: step.y + r.dy };
    }
    if (dryRun) return { ok: true, executed: false, message: 'verified on the demo screen — dry run, not dispatched', target: p };
    setCursor(p);
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
    return out;
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

  /** A real-input step on the demo desktop or through the bridge. */
  const performInput = async (step: WorkflowStep, actor: string, budget: ActionBudget, dryRun: boolean): Promise<Performed> => {
    if (sourceRef.current === 'demo') {
      const out = await performOnDemo(step, dryRun);
      if (out.executed) recordAction(step, out, actor, 'demo', DEMO_W, DEMO_H);
      return out;
    }
    const { bridgeUrl, checkpoints } = settingsRef.current;
    if (!bridgeUrl) return refused(step, BRIDGE_REQUIRED);
    const gate = dryRun ? null : gateRealInput(budget);
    if (gate) return refused(step, gate);
    let size = { w: 1920, h: 1080 };
    const out = await runStep(step, {
      bridgeUrl,
      capture: async () => {
        const f = await desktopFrame(bridgeUrl, ++frameId.current);
        size = { w: f.srcW, h: f.srcH };
        return f;
      },
      attempts: Math.max(1, checkpoints),
      retryMs: 400,
      dispatch: !dryRun,
      log: (m, tone) => addLog(actor, m, tone),
      grounding: aiOnline() && stageOn('grounding') ? grounding : undefined,
      seed: habitSeed,
      learned: learnedPoint,
      onVerified: strengthen,
      gateRetry: dryRun ? undefined : () => gateRealInput(budget),
    });
    if (out.executed) recordAction(step, out, actor, 'bridge', size.w, size.h);
    return out;
  };

  /**
   * Familiar-elements memory: a pointer step whose target was verified or used is remembered
   * by name with its point, a small patch of the screen around it and the time.
   */
  const rememberTarget = async (step: WorkflowStep, out: Performed) => {
    if (!out.ok || !POINTER_ACTIONS.has(step.action) || !stageOn('elementMap')) return;
    const frame = out.shot ?? framesRef.current[0];
    const patch = frame ? await patchAt(frame, out.target).catch(() => undefined) : undefined;
    setFamiliar((list) => rememberElement(list, { id: uid('el'), name: step.target ?? step.name, x: out.target.x, y: out.target.y, patch, lastSeen: Date.now() }));
  };

  const forgetFamiliar = (id: string) => setFamiliar((list) => forgetElement(list, id));

  /**
   * performStep, then reflect-after-step: every step the pipeline ran gets the model's reflection
   * and verdict, and the verdict of a step that really ran (not a dry run) updates its habit.
   * No step is dispatched without a recorded proposal for it (intent before action).
   */
  const perform = async (step: WorkflowStep, actor: string, budget: ActionBudget, dryRun: boolean, proposal: Proposal | null): Promise<Performed> => {
    if (!proposal?.ready) return refused(step, `No recorded proposal for "${step.name}" — not executed`);
    const before = framesRef.current[0] ?? null;
    const out = await performStep(step, actor, budget, dryRun);
    learnFromOutcome(step, out, before);
    void rememberTarget(step, out);
    if (!out.ok) captureError({ kind: actor === 'Self-test' ? 'watcher' : 'step', message: out.message, goal: goalRef.current, step: step.name });
    if (out.halt || !aiOnline()) return out;
    const verdict = await reflectAfter(step, out.shot ?? framesRef.current[0] ?? null, out, actor);
    if (verdict && !dryRun) learnHabit(step, verdict);
    return out;
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
      addLog('Test click', `"${el.name}" highlighted at ${where} — real input disarmed, dry run (nothing sent)`, 'info');
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
    setCursor(out.target);
    setTrail((t) => [...t, { x: out.target.x, y: out.target.y, t: Date.now(), click: stepsRef.current[index]?.action !== 'move' }].slice(-1500));
    if (stageOn('progress')) setProgress((p) => ({ ...p, done: p.done + 1 }));
  };

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
    if (step.refFrame && live && stageOn('drift') && syncLevelFor(matchTemplate(step.refFrame.data, live.data, step.x, step.y)) === 'red') {
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
  const justify = async (actor: string, step: WorkflowStep, canWait: boolean): Promise<Justified> => {
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

  /** Starts a new plan: a fresh baseline for "changed since the plan" and fresh re-proposal allowances. */
  const markPlan = () => {
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
      const dryRun = autoDryRef.current;
      autoDryRef.current = false;
      void learnFromRun(stepsRef.current, { dryRun, stopped: false });
    }
  };

  /** Auto Act: with the AI online, the model handles popups and runs the next pending step. Disarmed = dry run. */
  const autoAct = async (frame: Frame) => {
    const { autoAct: on } = settingsRef.current;
    if (!on || abortedRef.current || autoBusyRef.current || watchBusyRef.current || replayingRef.current || recordingRef.current || !stageOn('screenResponder')) return;
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
    if (prev) watchScreen(prev, frame);
    learnFromDwell(frame);
    const next = stepsRef.current.find((s) => s.status === 'pending' || s.status === 'running');
    if (next?.refFrame && stageOn('drift')) {
      const r = matchTemplate(next.refFrame.data, frame.data, next.x, next.y);
      const level = syncLevelFor(r);
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
      if (c) drawDemoDesktop(c.getContext('2d')!, DEMO_W, DEMO_H, tickRef.current, adDismissed(), demoFileRef.current);
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
      desktopFrame(settingsRef.current.bridgeUrl, ++frameId.current)
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

  useEffect(() => () => captureRef.current?.stop(), []);

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
      const step: WorkflowStep = { id: uid('step'), name: hover ? `Move ${n}` : `Click ${n}`, action: hover ? 'move' : 'click', x, y, refFrame: frame, status: 'pending' };
      setSteps((s) => [...s, step]);
      addLog('Recorder', `Captured ${hover ? 'mouse move' : 'click'} at (${pct(x)}, ${pct(y)}) with screenshot`, 'info');
      return;
    }
    if (sourceRef.current === 'demo' && !hover) addLog('You', demoClick(x, y));
  };

  /**
   * Stage drag (mousedown → move → mouseup): while recording becomes a drag step with both
   * endpoints and the latest screenshot as the template of its start region; on the demo it acts.
   */
  const onStageDrag = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
    if (recordingRef.current) {
      const n = stepsRef.current.length + 1;
      setTrail((t) => [...t, { x: from.x, y: from.y, t: Date.now(), click: true }, { x: to.x, y: to.y, t: Date.now(), click: true }].slice(-1500));
      const step: WorkflowStep = { id: uid('step'), name: `Drag ${n}`, action: 'drag', x: from.x, y: from.y, endX: to.x, endY: to.y, refFrame: framesRef.current[0], status: 'pending' };
      stepsRef.current = [...stepsRef.current, step];
      setSteps(stepsRef.current);
      addLog('Recorder', `Captured drag from (${pct(from.x)}, ${pct(from.y)}) to (${pct(to.x)}, ${pct(to.y)}) with screenshot`, 'info');
      return;
    }
    if (sourceRef.current === 'demo') addLog('You', applyDemoDrag(from, to));
  }, [addLog, applyDemoDrag]);

  /** Live-write while recording: typed text becomes a "type" step. */
  const onStageType = useCallback((text: string) => {
    if (!recordingRef.current || !text) return;
    setSteps((s) => [...s, { id: uid('step'), name: `Type "${text}"`, action: 'type', x: 0.5, y: 0.5, text, status: 'pending' }]);
    addLog('Recorder', `Captured typing: "${text}"`);
  }, [addLog]);

  const toggleRecording = () => {
    if (recording) {
      setRecording(false);
      addLog('Recorder', `Stopped — ${steps.length} step(s), ${trail.length} trail points`, 'ok');
      setDraftCard(generateCard(steps, goal));
      return;
    }
    setTrail([]);
    setRecording(true);
    markPlan();
    addLog('Recorder', 'Live recording started — click to record clicks, Alt+click to record a mouse move');
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
    setCursor({ x: planned.x, y: planned.y });
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
    const out = await perform(j.step, label, budget, dryRun, j.proposal);
    applyOutcome(i, out, dryRun, before);
    addLog(label, `${planned.name}: ${out.message}`, out.ok ? 'ok' : 'error');
    return out;
  };

  /**
   * Replay: every step through the grounded pipeline (template drift check, AI target check,
   * dispatch, re-verify). Self-test, or any run while disarmed, verifies but sends nothing.
   */
  const replay = async (selfTest = false) => {
    const label = selfTest ? 'Self-test' : 'Replay';
    if (!stepsRef.current.length) {
      addLog(label, 'Nothing to replay — record or plan a workflow first', 'warn');
      return;
    }
    if (abortedRef.current) {
      addLog('Safety', 'Replay refused — ABORTED is active; clear the abort first', 'error');
      return;
    }
    if (sourceRef.current !== 'demo') {
      const health = await checkBridge(settingsRef.current.bridgeUrl);
      if (!health.ok) {
        addLog(label, `${health.message} — no step was executed`, 'error');
        captureError({ kind: 'bridge', message: health.message, goal: goalRef.current });
        return;
      }
    }
    const dryRun = selfTest || !armedRef.current;
    if (dryRun && !selfTest) addLog('Safety', 'Real input disarmed — replay runs as a dry run (nothing is sent)', 'warn');
    const budget = createBudget(settingsRef.current.actionBudget);
    abortRef.current = false;
    reproposedRef.current = new Set();
    setReplaying(true);
    const shots: Frame[] = [];
    const runGoal = goalRef.current.trim();
    const looping = settingsRef.current.autoContinue && stageOn('autoContinue') && !selfTest && !!runGoal;
    const { ran, ok } = looping ? await continueToGoal(runGoal, budget, dryRun, label, shots) : await runSteps(budget, dryRun, label, shots);
    setActiveIndex(null);
    setReplaying(false);
    const picks = shots.map((f, i) => ({ f, score: i === 0 ? 1 : frameDistance(shots[i - 1].data, f.data) })).sort((a, b) => b.score - a.score).slice(0, 3).map((p) => p.f);
    if (picks.length) setPinned(picks);
    if (stageOn('goal')) {
      const total = ran.length;
      const what = dryRun ? 'verified on screen (not dispatched)' : 'executed';
      addLog('Goal reviewer', ok === total ? `All ${total} steps ${what}${goal ? ` for "${goal}"` : ''}` : `${ok}/${total} ${what} — re-plan the failed steps or let AI help clear blockers`, ok === total ? 'ok' : 'warn');
    }
    await learnFromRun(ran, { dryRun, stopped: abortRef.current });
  };

  /** One pass over the current steps in order, checking abortRef between steps. */
  const runSteps = async (budget: ActionBudget, dryRun: boolean, label: string, shots: Frame[]): Promise<RunReport & { ok: number }> => {
    stepsRef.current = stepsRef.current.map((st) => ({ ...st, status: 'pending' as const }));
    setSteps(stepsRef.current);
    let ok = 0;
    addLog(label, dryRun ? `Verifying ${stepsRef.current.length} step(s) on the live screen — no input is sent` : `Performing ${stepsRef.current.length} step(s) as real input`);
    for (let i = 0; i < stepsRef.current.length && !abortRef.current; i++) {
      const out = await replayStep(i, budget, dryRun, label);
      if (out.ok) ok++;
      if (out.shot) shots.push(out.shot);
      if (out.halt) return { ran: stepsRef.current, halt: out.message, ok };
    }
    return { ran: stepsRef.current, halt: null, ok };
  };

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
    addLog('Replay', 'Stopped by user', 'warn');
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

  /** Applies a plan's steps as the current workflow and logs them. */
  const applyPlan = (text: string, planned: WorkflowStep[], why: string) => {
    stepsRef.current = planned;
    setSteps(planned);
    markPlan();
    setDraftCard(generateCard(planned, text));
    addLog('Planner', `${why}: ${planned.length} step(s) — ${planned.map((s) => `${s.action} "${s.target ?? s.name}"`).join(' → ')}${armedRef.current ? '' : ' (real input disarmed: replay / Auto Act run it as a dry run)'}`, 'ok');
  };

  /**
   * AI plan: reuse a similar saved flow (drift-corrected), otherwise the model plans from the
   * goal + live frame with the reliable habits and learned patterns relevant to this goal as context.
   * The re-plan guard skips a plan already in flight, a goal whose re-plan came back identical,
   * and re-plans past the cap while the screen is unchanged.
   */
  const autoPlan = async (text = goal) => {
    if (!text.trim()) {
      addLog('Planner', 'Type a goal first', 'warn');
      return;
    }
    if (!stageOn('planner')) {
      addLog('Planner', `${stageOff('planner')} — no plan made`, 'warn');
      return;
    }
    if (planningRef.current) {
      addLog('Planner', `Re-plan guard: a plan for "${text.trim()}" is still being thought out — not starting another`, 'warn');
      return;
    }
    const gate = planGuardRef.current.before(text, screenState());
    if (!gate.run) {
      if (gate.log) addLog('Planner', `Re-plan guard: ${gate.log}`, 'warn');
      return;
    }
    const applied = relevantHabits(text, habitContext(), habitsRef.current);
    if (applied.length) addLog('Habits', `Applying ${applied.length} habit(s) to planning: ${applied.map(habitLine).join(' | ')}`, 'info');
    planningRef.current = true;
    await withAi(async () => {
      try {
        const plan = await thought(`Plan: ${text}`, () => planFromGoal(text, cardsRef.current, framesRef.current[0] ?? null, askFor('planner'), applied.map(habitLine), patternsRef.current), planSummary);
        if (planGuardRef.current.after(plan.steps) === 'duplicate') {
          addLog('Planner', `Re-plan guard: the plan for "${text.trim()}" is identical to the previous one — kept the current steps and will not ask the model again until the screen or a step changes`, 'warn');
          return;
        }
        applyPlan(text, plan.steps, plan.source);
      } catch (error) {
        addLog('Planner', aiFailure('AI plan failed — no steps created', error), 'error');
      } finally {
        planningRef.current = false;
      }
    });
  };

  /** "/move <target>": the model plans one move onto the target, which runs at once through the grounded pipeline. */
  const moveTo = async (name: string) => {
    if (!stageOn('planner')) {
      addLog('/move', `${stageOff('planner')} — nothing executed`, 'warn');
      return;
    }
    await withAi(async () => {
      try {
        const { steps: planned } = await thought(`/move ${name}`, () => planFromGoal(`Move the mouse cursor onto the ${name} (hover, do not click)`, [], framesRef.current[0] ?? null, askFor('planner')), planSummary);
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

  /** Switches the monitor to real desktop screenshots from the bridge, after a health check. */
  const connectBridge = async (): Promise<boolean> => {
    const health = await checkBridge(settingsRef.current.bridgeUrl);
    if (!health.ok) {
      addLog('Bridge', health.message, 'error');
      captureError({ kind: 'bridge', message: health.message });
      return false;
    }
    attachSource('bridge');
    addLog('Bridge', `${health.message} — screenshots now come from the real desktop`, 'ok');
    return true;
  };

  // Bridge takeover: when a configured bridge answers, frames come from the real desktop unless the user chose the demo.
  useEffect(() => {
    const url = settings.bridgeUrl;
    if (!url) return undefined;
    let cancelled = false;
    void checkBridge(url).then((r) => {
      if (cancelled || !r.ok || demoChosenRef.current || sourceRef.current !== 'demo') return;
      attachSource('bridge');
      addLog('Monitor', 'Desktop bridge online — screenshots now come from the real screen', 'ok');
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.bridgeUrl, addLog]);

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
  const COMMAND_RUNNERS: Record<'use' | 'move' | 'measure', (target: string) => Promise<void>> = { use: attachTarget, move: moveTo, measure: measureCommand };

  /** Submits the assist input: /use, /move and /measure run, anything else is planned as a goal. */
  const submitInput = async () => {
    const command = parseCommand(goal);
    if (!command) {
      await autoPlan(goal);
      return;
    }
    if (command.kind === 'error') {
      addLog('Command', command.message, 'warn');
      return;
    }
    setGoal('');
    await COMMAND_RUNNERS[command.kind](command.target);
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
    setCards((c) => [{ id: uid('card'), ...draftCard, steps: stepsRef.current, savedAt: Date.now() }, ...c]);
    addLog('Library', `Saved "${draftCard.name}"`, 'ok');
    setDraftCard(null);
  };

  const loadCard = (card: SavedCard) => {
    setSteps(card.steps.map((s) => ({ ...s, status: 'pending' as const })));
    markPlan();
    addLog('Library', `Loaded "${card.name}"`);
  };

  return {
    settings, setSettings, source, target, frames, pinned, setPinned, steps, setSteps, trail, setTrail, recording, replaying,
    activeIndex, sync, annotations, cursor, log, cards, draftCard, setDraftCard, goal, setGoal, progress, setProgress,
    agents, setAgents, toggleStage, plays, demoCanvasRef, captureLost, DEMO_W, DEMO_H, intervalMs, shotCount, history,
    armed, aborted, aiStatus, aiAnswer, aiBusy, timeline, patterns, deletePattern, ruler, continuing, habits, deleteHabit, pinHabit,
    familiar, forgetFamiliar, elements, learned, highlight, testClick,
    watcher, acceptProposal, dismissProposal, testProposal,
    /** The AI is planning, reflecting, deciding or verifying right now. */
    aiWorking: aiBusy || aiCalls > 0,
    onStageMove, onStageClick, onStageDrag, onStageType, toggleRecording, replay, stop, stopAi, autoPlan, submitInput, askScreen, explainScreen,
    shareScreen, connectBridge, useDemo, saveCard, loadCard, addLog, toggleArmed, triggerAbort, clearAbort, exportHistory, resetHistory,
    errors: errorForwarding.errors, errorEndpoint: errorForwarding.endpoint, sendErrorNow: errorForwarding.sendNow, sendTestError: errorForwarding.sendTest,
  };
}

/** The engine's public surface, for panels. */
export type AssistEngine = ReturnType<typeof useAssist>;
