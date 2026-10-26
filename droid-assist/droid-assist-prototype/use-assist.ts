import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionRecord, Annotation, AssistSettings, FamiliarElement, Frame, InputAction, LearnedPattern, LogEntry, SavedCard, ScreenSource, StepAction, SyncLevel, TrailPoint, WorkflowStep } from './types.js';
import { POINTER_ACTIONS } from './types.js';
import { SAMPLE_H, SAMPLE_W, boundingBox, boxDistance, diffCells, frameDistance, largestCluster, matchTemplate, syncLevelFor } from './drift.js';
import { AD_CYCLE, demoAd, demoPlayButton, drawDemoDesktop } from './demo-desktop.js';
import { AI_PLAN_SOURCE, calculate, generateCard, planFromGoal, relocateTarget, uid } from './planner.js';
import { DEFAULT_AI_MODEL, DEFAULT_AI_URL, createAiSession, pingAi } from './ai.js';
import type { AiReply, AiStatus, AskRequest } from './ai.js';
import { confirmTarget, decidePopup, decideStep, describeScreen, reflectStep, type PopupDecision, type StepDecision, type StepResult, type TargetCheck, type Thought } from './assist-ai.js';
import { addEntry, verdictText, type ThinkingEntry } from './thinking-timeline.js';
import { BRIDGE_REQUIRED, captureDesktop, checkBridge } from './bridge.js';
import { runStep, type Grounding, type StepOutcome } from './run-step.js';
import { patchAt, zoomFrame } from './grounding.js';
import { parseCommand } from './commands.js';
import { createScreenCapture, monitorInterval, type CapturedImage, type ScreenCapture } from './capture.js';
import { DEFAULT_ABORT_HOTKEY, DEFAULT_ACTION_BUDGET, createBudget, matchesHotkey, spendAction, type ActionBudget } from './safety.js';
import { LOG_LIMIT, loadCards, loadFamiliar, loadLog, loadPatterns, loadSettings, loadWatcher, saveCards, saveFamiliar, saveLog, savePatterns, saveSettings, saveWatcher } from './storage.js';
import { addTest, mergeNotes, mergeProposals, observeScreen, patchProposal, proposalStep, reorderSteps, type Observation, type ProposalKind, type WatchProposal, type WatcherState } from './watcher.js';
import { forgetElement, listElements, rememberElement, type ScreenElement } from './elements.js';
import { gridRef } from './grid.js';
import { decodeFrames, toStoredFrame } from './frame-codec.js';
import { loadStoredFrames, putStoredFrame } from './frame-store.js';
import { appendHistory, clearHistory, downloadText, historyToCsv, historyToJson, loadHistory } from './action-history.js';
import { failurePattern, flowCard, learnPatterns, mergePatterns, newPattern, runVerdict, upsertCard } from './flow-memory.js';

const DEMO_W = 960;
const DEMO_H = 540;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
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
const INPUT_ACTIONS: Partial<Record<StepAction, InputAction>> = { click: 'click', double_click: 'double_click', move: 'move', scroll: 'scroll', type: 'type', key: 'key' };

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
/** Timeline text of a step decision. */
const stepSummary = (d: StepDecision) => (d.run ? `Run now at ${at(d.x, d.y)} — ${d.reason}` : `Wait — ${d.reason}`);
/** Timeline text of a model plan; null for a reused saved flow (no model call). */
const planSummary = (r: { source: string; steps: WorkflowStep[] }) => (r.source.startsWith(AI_PLAN_SOURCE) ? `${r.steps.length} step(s): ${r.steps.map((s) => `${s.action} "${s.target ?? s.name}"`).join(' → ')}` : null);
/** Timeline text of a grounding check on a zoomed crop. */
const checkSummary = (step: WorkflowStep, p: { x: number; y: number }) => (c: TargetCheck) => `${c.visible ? 'Target confirmed' : 'Target not'} at ${at(p.x, p.y)} for "${step.target ?? step.name}" — ${c.reason}`;

/** Timeline text of a watcher observation. */
const observationSummary = (o: Observation) => `${o.notes.length} note(s), ${o.proposals.length} proposal(s)${o.notes.length ? `: ${o.notes.map((n) => n.text).join('; ')}` : ''}`;

/** Default settings. */
export const DEFAULT_SETTINGS: AssistSettings = {
  gallerySize: 10,
  checkpoints: 6,
  captureMs: 500,
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
};

/** A background agent the user can toggle. */
export interface Agent {
  id: 'popup' | 'drift' | 'progress' | 'goal' | 'watcher';
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
    { id: 'watcher', name: 'Screen watcher', description: 'Watches the live screen, takes notes, proposes changes and tests them in the background (dry run unless armed)', on: false },
  ]);
  const [plays, setPlays] = useState(0);
  const [armed, setArmed] = useState(false);
  const [aborted, setAborted] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus>({ state: 'checking', detail: 'Connecting to the AI endpoint…' });
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  /** Per-step Qwen thinking timeline, newest first: thought, reflection and verdict of every AI call. */
  const [timeline, setTimeline] = useState<ThinkingEntry[]>([]);
  const [captureLost, setCaptureLost] = useState<string | null>(null);

  const demoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureRef = useRef<ScreenCapture | null>(null);
  const tickRef = useRef(0);
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
  const aiStatusRef = useRef(aiStatus);
  const logRef = useRef(log);
  const goalRef = useRef(goal);
  const replayingRef = useRef(false);
  const recordingRef = useRef(false);
  const cardsRef = useRef<SavedCard[]>([]);
  const patternsRef = useRef<LearnedPattern[]>(patterns);
  /** Whether any step of the current Auto Act run was only a dry run (such a run is never saved). */
  const autoDryRef = useRef(false);
  const watcherRef = useRef(watcher);
  const aiBusyRef = useRef(aiBusy);
  aiBusyRef.current = aiBusy;
  /** A watcher observation or test is in flight; ticks never overlap and Auto Act waits for it. */
  const watchBusyRef = useRef(false);
  /** Real-input budget of the watcher's armed tests, renewed each time the watcher is switched on. */
  const watchBudgetRef = useRef<ActionBudget>(createBudget(settings.actionBudget));

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

  const intervalMs = monitorInterval(settings.monitorMode, settings.captureMs);

  // Persistence: settings, log and cards.
  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => saveLog(log), [log]);
  useEffect(() => savePatterns(patterns), [patterns]);
  useEffect(() => saveFamiliar(familiar), [familiar]);
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

  // AI endpoint health: at startup and whenever the endpoint or model changes.
  useEffect(() => {
    let live = true;
    setAiStatus({ state: 'checking', detail: `Connecting to ${settings.aiUrl}…` });
    void pingAi({ url: settings.aiUrl, model: settings.aiModel }).then((status) => {
      if (!live) return;
      setAiStatus(status);
      addLog('AI', status.detail, status.state === 'online' ? 'ok' : 'error');
    });
    return () => {
      live = false;
    };
  }, [settings.aiUrl, settings.aiModel, addLog]);

  /** Every model call, with session history and the recent log; a failure marks the AI offline and is rethrown. */
  const askAi = useCallback(async (req: AskRequest): Promise<AiReply> => {
    const { aiUrl, aiModel } = settingsRef.current;
    const context = req.context ?? logRef.current.slice(0, 8).map((l) => `[${l.source}] ${l.message}`);
    try {
      const reply = await aiSessionRef.current.ask({ url: aiUrl, model: aiModel }, { ...req, context });
      if (aiStatusRef.current.state !== 'online') setAiStatus({ state: 'online', detail: `Connected · ${aiModel}` });
      return reply;
    } catch (error) {
      setAiStatus({ state: 'offline', detail: `AI unavailable — ${errorText(error)}` });
      throw error;
    }
  }, []);

  const aiOnline = () => aiStatusRef.current.state === 'online';

  const note = useCallback((entry: Omit<ThinkingEntry, 'id' | 'time'>) => setTimeline((t) => addEntry(t, entry)), []);

  /**
   * Runs one AI decision and records its initial thinking on the timeline, or the failure
   * when the call fails (rethrown). `summary` returning null means no model call was made.
   */
  const thought = useCallback(async <T extends Thought>(step: string, call: () => Promise<T>, summary: (r: T) => string | null): Promise<T> => {
    try {
      const r = await call();
      const text = summary(r);
      if (text !== null) note({ step, kind: 'thought', text, thinking: r.thinking });
      return r;
    } catch (error) {
      note({ step, kind: 'thought', text: '', thinking: null, error: errorText(error) });
      throw error;
    }
  }, [note]);

  /**
   * Reflect-after-step: the model's reflection and final verdict on an executed step go on the
   * timeline and the verdict into the activity log. A failure is logged as such — never invented.
   */
  const reflectAfter = useCallback(async (step: WorkflowStep, frame: Frame | null, result: StepResult, logSource: string) => {
    try {
      const { reflection, verdict } = await reflectStep(askAi, frame, step, result, goalRef.current);
      const text = verdictText(verdict);
      note({ step: step.name, kind: 'reflection', text: reflection.text, thinking: reflection.thinking });
      note({ step: step.name, kind: 'verdict', text, thinking: verdict.thinking });
      addLog(logSource, `Verdict on "${step.name}": ${text}`, verdict.success ? 'ok' : 'warn');
    } catch (error) {
      note({ step: step.name, kind: 'verdict', text: '', thinking: null, error: errorText(error) });
      addLog(logSource, `No verdict for "${step.name}" — AI reflection failed: ${errorText(error)}`, 'error');
    }
  }, [addLog, askAi, note]);

  /**
   * The AI grounding pass run-step uses: confirm on a zoomed crop, re-ask the planner once.
   * Each check and the re-ask record their thinking on the step's timeline.
   */
  const grounding: Grounding = {
    confirm: async (live, step, p) => {
      const crop = await zoomFrame(live, p);
      return thought(step.name, () => confirmTarget(askAi, crop, step), checkSummary(step, p));
    },
    relocate: async (live, step, feedback) => {
      const { point } = await thought(step.name, async () => {
        const next = await relocateTarget(askAi, live, step, feedback);
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
    if (verdict === 'ignored') return;
    const runGoal = goalRef.current.trim();
    if (verdict === 'success') autoSaveFlow(runGoal, runSteps);
    else {
      const lesson = failurePattern(runGoal, runSteps);
      addPatterns([lesson]);
      addLog('Patterns', `Run failed — not saved as a flow. Learned: avoid ${lesson.pattern}`, 'warn');
    }
    try {
      const learned = await learnPatterns(askAi, runGoal, runSteps, verdict);
      if (learned.length) addPatterns(learned);
      addLog('Patterns', learned.length ? `AI learned ${learned.length} pattern(s): ${learned.map((p) => `${p.kind} "${p.pattern}"`).join('; ')}` : 'AI found no new pattern in this run', 'info');
    } catch (error) {
      addLog('Patterns', `AI unavailable — no patterns learned from this run: ${errorText(error)}`, 'warn');
    }
  }, [addLog, addPatterns, askAi, autoSaveFlow]);

  const triggerAbort = useCallback((reason: string) => {
    abortRef.current = true;
    abortedRef.current = true;
    setAborted(true);
    setSettings((s) => ({ ...s, autoAct: false }));
    addLog('Safety', `ABORTED (${reason}) — Auto Act, replay and monitor automation halted`, 'error');
  }, [addLog]);

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

  const agentOn = useCallback((id: Agent['id']) => agents.find((a) => a.id === id)?.on ?? false, [agents]);
  const agentsRef = useRef(agentOn);
  agentsRef.current = agentOn;

  const adDismissed = () => Math.floor(tickRef.current / AD_CYCLE) === dismissedCycleRef.current;

  /** Appends one performed mouse/keyboard action to the persistent history. */
  const recordAction = useCallback((step: WorkflowStep, out: StepOutcome, actor: string, via: ActionRecord['via'], srcW: number, srcH: number) => {
    const kind = INPUT_ACTIONS[step.action];
    if (!kind) return;
    const rec: ActionRecord = { id: uid('act'), time: Date.now(), action: kind, x: Math.round(out.target.x * srcW), y: Math.round(out.target.y * srcH), text: step.text, source: actor, via, ok: out.ok, message: out.message };
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

  /** Performs a step on the demo desktop: template-checked against the latest frame, then simulated. */
  const performOnDemo = async (step: WorkflowStep, dryRun: boolean): Promise<Performed> => {
    const local = LOCAL_ACTIONS[step.action];
    if (local) return { ...(await local(step)), executed: true, target: { x: step.x, y: step.y } };
    const live = framesRef.current[0];
    let p = { x: step.x, y: step.y };
    if (step.refFrame && live) {
      const r = matchTemplate(step.refFrame.data, live.data, step.x, step.y);
      if (syncLevelFor(r) === 'red') return { ok: false, executed: false, message: `Target of "${step.name}" not found on the demo screen (best match ${r.matchDistance.toFixed(3)}) — not executed`, target: p };
      p = { x: step.x + r.dx, y: step.y + r.dy };
    }
    if (dryRun) return { ok: true, executed: false, message: 'verified on the demo screen — dry run, not dispatched', target: p };
    setCursor(p);
    const clicks = step.action === 'click' || step.action === 'double_click';
    const message = clicks ? demoClick(p.x, p.y) : step.action === 'move' ? `Moved the cursor to (${pct(p.x)}, ${pct(p.y)})` : `${step.action} simulated on the demo desktop`;
    const ok = !/blocked|nothing/.test(message);
    return { ok, executed: ok, message, target: p };
  };

  /**
   * The one execution path every feature uses. Demo: simulated on the demo canvas. Otherwise
   * real input via run-step (live desktop frame, drift correction, AI grounding of named
   * targets, bridge dispatch, re-verify), gated by abort, arm and the run's budget.
   */
  const performStep = async (step: WorkflowStep, actor: string, budget: ActionBudget, dryRun: boolean): Promise<Performed> => {
    if (abortedRef.current) return refused(step, 'Aborted — real input not sent');
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
      grounding: aiOnline() ? grounding : undefined,
    });
    if (out.executed) recordAction(step, out, actor, 'bridge', size.w, size.h);
    return out;
  };

  /**
   * Familiar-elements memory: a pointer step whose target was verified or used is remembered
   * by name with its point, a small patch of the screen around it and the time.
   */
  const rememberTarget = async (step: WorkflowStep, out: Performed) => {
    if (!out.ok || !POINTER_ACTIONS.has(step.action)) return;
    const frame = out.shot ?? framesRef.current[0];
    const patch = frame ? await patchAt(frame, out.target).catch(() => undefined) : undefined;
    setFamiliar((list) => rememberElement(list, { id: uid('el'), name: step.target ?? step.name, x: out.target.x, y: out.target.y, patch, lastSeen: Date.now() }));
  };

  const forgetFamiliar = (id: string) => setFamiliar((list) => forgetElement(list, id));

  /** performStep, then reflect-after-step: every step the pipeline ran gets the model's reflection and verdict. */
  const perform = async (step: WorkflowStep, actor: string, budget: ActionBudget, dryRun: boolean): Promise<Performed> => {
    const out = await performStep(step, actor, budget, dryRun);
    void rememberTarget(step, out);
    if (!out.halt && aiOnline()) await reflectAfter(step, out.shot ?? framesRef.current[0] ?? null, out, actor);
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
    const step: WorkflowStep = { id: uid('test'), name: `Test click "${el.name}"`, action: 'click', x: el.x, y: el.y, status: 'pending' };
    const out = await performStep(step, 'Test click', createBudget(settingsRef.current.actionBudget), false);
    if (out.executed) void rememberTarget({ ...step, target: el.name }, out);
    addLog('Test click', `"${el.name}" at ${where}: ${out.message}`, out.ok ? 'ok' : 'error');
  };

  const elements = listElements(steps, annotations, familiar);

  const updateStep = (index: number, patch: Partial<WorkflowStep>) => {
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
    if (agentsRef.current('progress')) setProgress((p) => ({ ...p, done: p.done + 1 }));
  };

  /** Visual error detection: frame-to-frame cluster of changed cells → highlighted popup/mismatch. */
  const detectErrors = useCallback((prev: Frame, cur: Frame) => {
    if (popupRef.current && popupBaseRef.current && popupFrameRef.current) {
      const backToClean = boxDistance(popupBaseRef.current.data, cur.data, popupRef.current) < 0.06;
      const popupChanged = boxDistance(popupFrameRef.current.data, cur.data, popupRef.current) > 0.15;
      if (backToClean || popupChanged) {
        popupRef.current = null;
        popupBaseRef.current = null;
        popupFrameRef.current = null;
        setAnnotations((a) => a.filter((x) => x.tone !== 'error'));
        if (agentsRef.current('popup')) addLog('Popup watcher', 'Popup gone — area matches the clean screen again', 'ok');
      }
      return;
    }
    const cells = largestCluster(diffCells(prev.data, cur.data));
    const box = cells.length >= 6 ? boundingBox(cells) : null;
    if (!box) return;
    popupBaseRef.current = prev;
    popupFrameRef.current = cur;
    const ann: Annotation = { id: uid('ann'), ...box, label: 'New popup / UI mismatch', tone: 'error' };
    popupRef.current = ann;
    setAnnotations((a) => [ann, ...a.filter((x) => x.tone !== 'error')].slice(0, 6));
    if (agentsRef.current('popup')) addLog('Popup watcher', `New content appeared at (${pct(box.x)}, ${pct(box.y)}) — the AI decides whether it is a popup to close`, 'warn');
  }, [addLog]);

  /** Auto-Actor popup handling: the model rules once per flagged region; a close is a grounded click. */
  const autoClosePopup = async (frame: Frame, popup: Annotation, dry: boolean) => {
    popupDecidedRef.current = popup.id;
    const d = await thought('Popup', () => decidePopup(askAi, frame, popup), popupSummary);
    if (!d.close) {
      addLog('Auto-Actor', `AI left the new content alone: ${d.reason}`, 'info');
      return;
    }
    const close: WorkflowStep = { id: uid('close'), name: 'Close popup', action: 'click', target: 'close (X) button of the popup', x: d.x, y: d.y, status: 'pending' };
    const out = await perform(close, 'Auto-Actor', autoBudgetRef.current, dry);
    addLog('Auto-Actor', `Close popup (${d.reason}): ${out.message}`, out.ok ? 'ok' : 'error');
    if (out.halt) setSettings((s) => ({ ...s, autoAct: false }));
  };

  /** Auto-Actor step execution: the model decides whether the next step can run now, then it runs grounded. */
  const autoRunStep = async (frame: Frame, idx: number, dry: boolean) => {
    const next = stepsRef.current[idx];
    const d = await thought(next.name, () => decideStep(askAi, frame, next, goalRef.current), stepSummary);
    if (!d.run) {
      setSync({ level: 'yellow', detail: `AI is waiting on "${next.name}": ${d.reason}` });
      return;
    }
    // A recorded template locates the target itself; otherwise the model's current point is used.
    const step = next.refFrame ? next : { ...next, x: d.x, y: d.y };
    updateStep(idx, { status: 'running' });
    const out = await perform(step, 'Auto-Actor', autoBudgetRef.current, dry);
    applyOutcome(idx, out, dry, frame);
    addLog(dry ? 'Auto-Actor (dry run)' : 'Auto-Actor', `${next.name}: ${out.message}`, out.ok ? 'ok' : 'error');
    if (dry) autoDryRef.current = true;
    if (!stepsRef.current.some((s) => s.status === 'pending')) {
      const dryRun = autoDryRef.current;
      autoDryRef.current = false;
      void learnFromRun(stepsRef.current, { dryRun, stopped: false });
    }
    if (out.halt) {
      setSettings((s) => ({ ...s, autoAct: false }));
      addLog('Auto-Actor', 'Auto Act stopped', 'error');
    }
  };

  /** Auto Act: with the AI online, the model handles popups and runs the next pending step. Disarmed = dry run. */
  const autoAct = async (frame: Frame) => {
    const { autoAct: on } = settingsRef.current;
    if (!on || abortedRef.current || autoBusyRef.current || watchBusyRef.current || replayingRef.current || recordingRef.current) return;
    if (!aiOnline() || Date.now() - lastStepAt.current < 1500) return;
    autoBusyRef.current = true;
    try {
      const dry = !armedRef.current;
      const popup = popupRef.current;
      const idx = stepsRef.current.findIndex((s) => s.status === 'pending');
      if (popup && popupDecidedRef.current !== popup.id && agentsRef.current('popup')) await autoClosePopup(frame, popup, dry);
      else if (idx >= 0) await autoRunStep(frame, idx, dry);
    } catch (error) {
      addLog('Auto-Actor', `AI unavailable — nothing executed: ${errorText(error)}`, 'error');
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
    if (prev) detectErrors(prev, frame);
    const next = stepsRef.current.find((s) => s.status === 'pending' || s.status === 'running');
    if (next?.refFrame && agentsRef.current('drift')) {
      const r = matchTemplate(next.refFrame.data, frame.data, next.x, next.y);
      const level = syncLevelFor(r);
      setSync({ level, detail: `"${next.name}": region ${r.regionDistance.toFixed(3)}, best ${r.matchDistance.toFixed(3)}${level === 'yellow' ? `, drift (${(r.dx * 100).toFixed(1)}%, ${(r.dy * 100).toFixed(1)}%)` : ''}` });
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
      if (c) drawDemoDesktop(c.getContext('2d')!, DEMO_W, DEMO_H, tickRef.current, adDismissed());
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
        })
        .finally(() => {
          pollBusyRef.current = false;
        });
    }, intervalMs);
    return () => clearInterval(id);
  }, [addLog, intervalMs, source]);

  // The running screen capture follows the monitor mode's interval live.
  useEffect(() => {
    captureRef.current?.setInterval(intervalMs);
  }, [intervalMs]);

  useEffect(() => () => captureRef.current?.stop(), []);

  /** Stage pointer input: trail while recording. */
  const onStageMove = useCallback((x: number, y: number) => {
    if (recordingRef.current) setTrail((t) => [...t, { x, y, t: Date.now() }].slice(-1500));
  }, []);

  /** Stage click: while recording becomes a step (Alt+click records a hover/move); on the demo it acts. */
  const onStageClick = useCallback((x: number, y: number, hover = false) => {
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
  }, [addLog, demoClick]);

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
    addLog('Recorder', 'Live recording started — click to record clicks, Alt+click to record a mouse move');
  };

  /** AI help during replay: the model rules on the popup covering `step` and closes it as a grounded click. */
  const clearCoveringPopup = async (popup: Annotation, step: WorkflowStep, budget: ActionBudget, dryRun: boolean): Promise<boolean> => {
    const live = framesRef.current[0];
    if (!live) return false;
    try {
      const d = await thought(step.name, () => decidePopup(askAi, live, popup), popupSummary);
      if (!d.close) {
        addLog('AI help', `AI says the region over "${step.name}" is not a popup to close: ${d.reason}`, 'warn');
        return false;
      }
      const close: WorkflowStep = { id: uid('close'), name: 'Close popup', action: 'click', target: 'close (X) button of the popup', x: d.x, y: d.y, status: 'pending' };
      const out = await perform(close, 'AI help', budget, dryRun);
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

  /** Runs one replay step, clearing a covering popup first when AI help is on. */
  const replayStep = async (i: number, budget: ActionBudget, dryRun: boolean, label: string): Promise<Performed> => {
    const step = stepsRef.current[i];
    setActiveIndex(i);
    updateStep(i, { status: 'running' });
    setCursor({ x: step.x, y: step.y });
    const popup = popupRef.current;
    if (coveredBy(popup, step) && !(settingsRef.current.aiHelp && aiOnline() && (await clearCoveringPopup(popup, step, budget, dryRun)))) {
      const out: Performed = { ok: false, executed: false, message: `"${step.name}" is covered by a popup${settingsRef.current.aiHelp ? ' the AI did not clear' : ' (enable AI help to clear it)'} — not executed`, target: { x: step.x, y: step.y } };
      updateStep(i, { status: 'drift' });
      addLog(label, out.message, 'error');
      return out;
    }
    const before = framesRef.current[0] ?? null;
    const out = await perform(step, label, budget, dryRun);
    applyOutcome(i, out, dryRun, before);
    addLog(label, `${step.name}: ${out.message}`, out.ok ? 'ok' : 'error');
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
        return;
      }
    }
    const dryRun = selfTest || !armedRef.current;
    if (dryRun && !selfTest) addLog('Safety', 'Real input disarmed — replay runs as a dry run (nothing is sent)', 'warn');
    const budget = createBudget(settingsRef.current.actionBudget);
    abortRef.current = false;
    setReplaying(true);
    stepsRef.current = stepsRef.current.map((st) => ({ ...st, status: 'pending' as const }));
    setSteps(stepsRef.current);
    const shots: Frame[] = [];
    let ok = 0;
    addLog(label, dryRun ? `Verifying ${stepsRef.current.length} step(s) on the live screen — no input is sent` : `Performing ${stepsRef.current.length} step(s) as real input`);
    for (let i = 0; i < stepsRef.current.length && !abortRef.current; i++) {
      const out = await replayStep(i, budget, dryRun, label);
      if (out.ok) ok++;
      if (out.shot) shots.push(out.shot);
      if (out.halt) break;
    }
    setActiveIndex(null);
    setReplaying(false);
    const picks = shots.map((f, i) => ({ f, score: i === 0 ? 1 : frameDistance(shots[i - 1].data, f.data) })).sort((a, b) => b.score - a.score).slice(0, 3).map((p) => p.f);
    if (picks.length) setPinned(picks);
    if (agentsRef.current('goal')) {
      const total = stepsRef.current.length;
      const what = dryRun ? 'verified on screen (not dispatched)' : 'executed';
      addLog('Goal reviewer', ok === total ? `All ${total} steps ${what}${goal ? ` for "${goal}"` : ''}` : `${ok}/${total} ${what} — re-plan the failed steps or let AI help clear blockers`, ok === total ? 'ok' : 'warn');
    }
    await learnFromRun(stepsRef.current, { dryRun, stopped: abortRef.current });
  };

  const stop = () => {
    abortRef.current = true;
    addLog('Replay', 'Stopped by user', 'warn');
  };

  /** Runs `fn` with the AI busy flag set. */
  const withAi = async (fn: () => Promise<void>) => {
    setAiBusy(true);
    try {
      await fn();
    } finally {
      setAiBusy(false);
    }
  };

  /**
   * AI plan: reuse a similar saved flow (drift-corrected), otherwise the model plans from the
   * goal + live frame with the learned patterns relevant to this goal as context.
   */
  const autoPlan = async (text = goal) => {
    if (!text.trim()) {
      addLog('Planner', 'Type a goal first', 'warn');
      return;
    }
    await withAi(async () => {
      try {
        const plan = await thought(`Plan: ${text}`, () => planFromGoal(text, cardsRef.current, framesRef.current[0] ?? null, askAi, [], patternsRef.current), planSummary);
        const { steps: planned, source: why } = plan;
        stepsRef.current = planned;
        setSteps(planned);
        setDraftCard(generateCard(planned, text));
        addLog('Planner', `${why}: ${planned.length} step(s) — ${planned.map((s) => `${s.action} "${s.target ?? s.name}"`).join(' → ')}${armedRef.current ? '' : ' (real input disarmed: replay / Auto Act run it as a dry run)'}`, 'ok');
      } catch (error) {
        addLog('Planner', `AI plan failed — no steps created: ${errorText(error)}`, 'error');
      }
    });
  };

  /** "/move <target>": the model plans one move onto the target, which runs at once through the grounded pipeline. */
  const moveTo = async (name: string) => {
    await withAi(async () => {
      try {
        const { steps: planned } = await thought(`/move ${name}`, () => planFromGoal(`Move the mouse cursor onto the ${name} (hover, do not click)`, [], framesRef.current[0] ?? null, askAi), planSummary);
        const move = planned.find((s) => s.action === 'move');
        if (!move) {
          addLog('/move', `AI did not plan a mouse move to "${name}" (it proposed ${planned.map((s) => s.action).join(', ')}) — nothing executed`, 'error');
          return;
        }
        const step = { ...move, target: move.target ?? name };
        stepsRef.current = [step];
        setSteps(stepsRef.current);
        const out = await perform(step, '/move', createBudget(settingsRef.current.actionBudget), !armedRef.current);
        applyOutcome(0, out, !armedRef.current);
        addLog('/move', `${step.name}: ${out.message}`, out.ok ? 'ok' : 'error');
      } catch (error) {
        addLog('/move', `AI unavailable — nothing executed: ${errorText(error)}`, 'error');
      }
    });
  };

  /** AI help: the model answers a question about the live screen and points out what it means. */
  const askScreen = async (question = 'What on this screen needs my attention, and what should I do next?') => {
    const f = framesRef.current[0];
    if (!f) {
      addLog('AI help', 'No captured frame yet — share the screen or connect the bridge first', 'warn');
      return;
    }
    await withAi(async () => {
      try {
        const { answer, annotations: items } = await thought(`Ask: ${question}`, () => describeScreen(askAi, f, question, goal), (r) => r.answer);
        setAiAnswer(answer);
        setAnnotations(items);
        addLog('AI help', answer, 'info');
      } catch (error) {
        setAiAnswer('');
        addLog('AI help', `AI unavailable — no answer: ${errorText(error)}`, 'error');
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
      const out = await perform(open, '/use', createBudget(settingsRef.current.actionBudget), !armedRef.current);
      addLog('/use', out.ok ? `${out.message}; attached to "${name}"` : `Could not open "${name}": ${out.message}`, out.ok ? 'ok' : 'error');
      if (out.ok) setTarget(name);
      return;
    }
    addLog('/use', `No desktop bridge online — pick the "${name}" window to attach to (acting on it needs the bridge)`, 'info');
    if (await shareScreen()) setTarget(name);
  };

  /** Submits the assist input: /use and /move run, anything else is planned as a goal. */
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
    if (command.kind === 'use') await attachTarget(command.target);
    else await moveTo(command.target);
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

  /** The executor is running a step (Auto Act, replay, or an AI command); the watcher must not compete with it. */
  const executorBusy = () => autoBusyRef.current || replayingRef.current || aiBusyRef.current;

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
    if (!agentsRef.current('watcher') || watchBusyRef.current || executorBusy() || abortedRef.current || !captureLive() || pausedWhileHidden() || !aiOnline()) return;
    const frame = framesRef.current[0];
    if (!frame) return;
    watchBusyRef.current = true;
    try {
      recordObservation(await thought('Screen watcher', () => observeScreen(askAi, frame, watcherRef.current.notes, stepsRef.current, goalRef.current), observationSummary));
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
  const watcherOn = agentOn('watcher');
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
    addLog('Library', `Loaded "${card.name}"`);
  };

  return {
    settings, setSettings, source, target, frames, pinned, setPinned, steps, setSteps, trail, setTrail, recording, replaying,
    activeIndex, sync, annotations, cursor, log, cards, draftCard, setDraftCard, goal, setGoal, progress, setProgress,
    agents, setAgents, plays, demoCanvasRef, captureLost, DEMO_W, DEMO_H, intervalMs, shotCount, history,
    armed, aborted, aiStatus, aiAnswer, aiBusy, timeline, patterns, deletePattern,
    familiar, forgetFamiliar, elements, highlight, testClick,
    watcher, acceptProposal, dismissProposal, testProposal,
    onStageMove, onStageClick, onStageType, toggleRecording, replay, stop, autoPlan, submitInput, askScreen, explainScreen,
    shareScreen, connectBridge, useDemo, saveCard, loadCard, addLog, toggleArmed, triggerAbort, clearAbort, exportHistory, resetHistory,
  };
}

/** The engine's public surface, for panels. */
export type AssistEngine = ReturnType<typeof useAssist>;
