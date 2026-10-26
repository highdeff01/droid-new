import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionRecord, Annotation, AssistSettings, Frame, InputAction, LogEntry, SavedCard, ScreenSource, StepAction, SyncLevel, TrailPoint, WorkflowStep } from './types.js';
import { SAMPLE_H, SAMPLE_W, boundingBox, boxDistance, diffCells, frameDistance, largestCluster, matchTemplate, syncLevelFor } from './drift.js';
import { AD_CYCLE, demoAd, demoPlayButton, drawDemoDesktop } from './demo-desktop.js';
import { AI_PLAN_SOURCE, calculate, generateCard, planFromGoal, uid } from './planner.js';
import { BRIDGE_REQUIRED, captureDesktop, checkBridge, sendToBridge } from './bridge.js';
import { runStep, type StepOutcome } from './run-step.js';
import { createScreenCapture, monitorInterval, type CapturedImage, type ScreenCapture } from './capture.js';
import { DEFAULT_ABORT_HOTKEY, DEFAULT_ACTION_BUDGET, createBudget, matchesHotkey, spendAction, type ActionBudget } from './safety.js';
import { LOG_LIMIT, loadCards, loadLog, loadSettings, saveCards, saveLog, saveSettings } from './storage.js';
import { decodeFrames, toStoredFrame } from './frame-codec.js';
import { loadStoredFrames, putStoredFrame } from './frame-store.js';
import { DEFAULT_AI_MODEL, DEFAULT_AI_URL, createAiSession, pingAi, type AiReply, type AiStatus, type AskRequest } from './ai.js';
import { describeScreen, decidePopup, decideStep, reflectStep, type PopupDecision, type StepDecision, type StepResult, type Thought } from './assist-ai.js';
import { addEntry, verdictText, type ThinkingEntry } from './thinking-timeline.js';
import { appendHistory, clearHistory, downloadText, historyToCsv, historyToJson, loadHistory } from './action-history.js';
import { parseCommand } from './commands.js';

const DEMO_W = 960;
const DEMO_H = 540;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Outcome of executing a step; `halt` means the run must stop (abort, disarm or budget). */
interface ExecResult {
  ok: boolean;
  message: string;
  halt?: boolean;
}

/** What a dry run reports instead of dispatching. */
const DRY_RUN_RESULT: ExecResult = { ok: true, message: 'verified (dry run — not dispatched)' };

/** Workflow actions that are real mouse/keyboard input, as recorded in the action history. */
const INPUT_ACTIONS: Partial<Record<StepAction, InputAction>> = { click: 'click', double_click: 'double_click', scroll: 'scroll', type: 'type', key: 'key' };

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

/** A normalized point as native pixels of `frame` (0,0 when there is no frame to map onto). */
const toPixels = (p: { x: number; y: number }, frame: Frame | undefined) => ({ x: frame ? Math.round(p.x * frame.srcW) : 0, y: frame ? Math.round(p.y * frame.srcH) : 0 });

/** A click on a popup's close control, as a step (no template: the popup is new). */
const closePopupStep = (x: number, y: number): WorkflowStep => ({ id: uid('close'), name: 'Close popup', action: 'click', x, y, status: 'pending' });

/** True when the step's target lies inside the annotation's box. */
const covers = (a: Annotation, step: WorkflowStep) => step.x >= a.x && step.x <= a.x + a.w && step.y >= a.y && step.y <= a.y + a.h;

const at = (x: number, y: number) => `(${(x * 100).toFixed(1)}%, ${(y * 100).toFixed(1)}%)`;
/** Timeline text of a popup decision. */
const popupSummary = (d: PopupDecision) => (d.close ? `Close the popup at ${at(d.x, d.y)} — ${d.reason}` : `Leave it — ${d.reason}`);
/** Timeline text of a step decision. */
const stepSummary = (d: StepDecision) => (d.run ? `Run now at ${at(d.x, d.y)} — ${d.reason}` : `Wait — ${d.reason}`);

/** Default settings. */
export const DEFAULT_SETTINGS: AssistSettings = {
  gallerySize: 10,
  checkpoints: 6,
  captureMs: 500,
  monitorMode: 'app',
  autoAct: false,
  aiHelp: true,
  showTrail: true,
  bridgeUrl: '',
  abortHotkey: DEFAULT_ABORT_HOTKEY,
  actionBudget: DEFAULT_ACTION_BUDGET,
  aiUrl: DEFAULT_AI_URL,
  aiModel: DEFAULT_AI_MODEL,
};

/** A background agent the user can toggle. */
export interface Agent {
  id: 'popup' | 'drift' | 'progress' | 'goal';
  name: string;
  description: string;
  on: boolean;
}

/**
 * The assistant engine: screen capture, comparison gallery, visual error detection,
 * recording, drift-aware replay, auto-actor, planner, agents and saved workflows.
 */
export function useAssist() {
  const [settings, setSettings] = useState<AssistSettings>(() => loadSettings(DEFAULT_SETTINGS));
  const [source, setSource] = useState<ScreenSource>('demo');
  /** The app/window the assistant is attached to via /use. */
  const [target, setTarget] = useState<string | null>(null);
  const [history, setHistory] = useState<ActionRecord[]>(() => loadHistory());
  /** Screenshots analysed this session. */
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
  const [draftCard, setDraftCard] = useState<{ name: string; description: string } | null>(null);
  const [goal, setGoal] = useState('');
  const [progress, setProgress] = useState({ done: 0, manual: 0 });
  const [agents, setAgents] = useState<Agent[]>([
    { id: 'popup', name: 'Popup watcher', description: 'Flags ads & intrusive popups, auto-closes when Auto act is on', on: true },
    { id: 'drift', name: 'Drift monitor', description: 'Cross-checks every frame against the active step', on: true },
    { id: 'progress', name: 'Progress tracker', description: 'Counts verified steps toward the goal', on: true },
    { id: 'goal', name: 'Goal reviewer', description: 'Reviews the goal after each run and suggests what is next', on: true },
  ]);
  const [plays, setPlays] = useState(0);
  /** Real input is only sent while armed; always starts disarmed. */
  const [armed, setArmed] = useState(false);
  /** Sticky emergency-stop latch: halts all automation until cleared. */
  const [aborted, setAborted] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus>({ state: 'checking', detail: 'Connecting to the AI endpoint…' });
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  /** Per-step Qwen thinking timeline, newest first: thought, reflection and verdict of every AI call. */
  const [timeline, setTimeline] = useState<ThinkingEntry[]>([]);
  /** Why the screen capture stopped on its own; null while healthy. */
  const [captureLost, setCaptureLost] = useState<string | null>(null);

  const demoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /** The running real-screen capture, null when on the demo/bridge or after a loss. */
  const captureRef = useRef<ScreenCapture | null>(null);
  const tickRef = useRef(0);
  const dismissedCycleRef = useRef(-1);
  const framesRef = useRef<Frame[]>([]);
  const stepsRef = useRef<WorkflowStep[]>([]);
  const settingsRef = useRef(settings);
  const sourceRef = useRef<ScreenSource>(source);
  const popupRef = useRef<Annotation | null>(null);
  const abortRef = useRef(false);
  /** The clean frame captured just before the flagged popup appeared. */
  const popupBaseRef = useRef<Frame | null>(null);
  /** The frame in which the flagged popup was first seen. */
  const popupFrameRef = useRef<Frame | null>(null);
  /** The popup annotation the model has already ruled on, so it is asked once per popup. */
  const popupDecidedRef = useRef<string | null>(null);
  const autoBusyRef = useRef(false);
  /** Seeded from the clock so new captures never reuse the ids of frames stored by an earlier session. */
  const frameId = useRef(Date.now());
  /** Frames restored from storage: shown in the gallery, never compared against for popups. */
  const restoredIdsRef = useRef(new Set<number>());
  /** Cards are written back only after the stored ones have been loaded. */
  const cardsHydratedRef = useRef(false);
  /** Set when the user explicitly picks the demo desktop; the bridge then no longer takes over. */
  const demoChosenRef = useRef(false);
  const lastCaptureErrorAt = useRef(0);
  const lastStepAt = useRef(0);
  const armedRef = useRef(armed);
  const abortedRef = useRef(aborted);
  /** Budget of the current Auto Act run (from switch-on to switch-off). */
  const autoBudgetRef = useRef<ActionBudget>(createBudget(settings.actionBudget));
  const aiSessionRef = useRef(createAiSession(typeof sessionStorage === 'undefined' ? null : sessionStorage));
  const aiStatusRef = useRef(aiStatus);
  const logRef = useRef<LogEntry[]>([]);
  /** The goal as of the last render, for the capture-loop closures. */
  const goalRef = useRef('');
  const replayingRef = useRef(false);
  const recordingRef = useRef(false);

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

  const intervalMs = monitorInterval(settings.monitorMode, settings.captureMs);

  // Persistence: settings, log and cards to localStorage.
  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => saveLog(log), [log]);
  useEffect(() => {
    if (cardsHydratedRef.current) saveCards(cards);
  }, [cards]);

  // Hydrate the async stores: saved cards (screenshots decoded) and the recent frame gallery.
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
    });
    return () => {
      live = false;
    };
  }, []);

  const addLog = useCallback((source: string, message: string, tone: LogEntry['tone'] = 'info') => {
    setLog((l) => [{ id: uid('log'), time: Date.now(), source, message, tone }, ...l].slice(0, LOG_LIMIT));
  }, []);

  // AI startup ping, and again whenever the endpoint or model changes.
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

  /**
   * Every model call: the configured URL/model, the session history and the recent log as
   * context. A failure marks the AI offline and is rethrown — never replaced by a canned answer.
   */
  const askAi = useCallback(async (req: AskRequest): Promise<AiReply> => {
    const { aiUrl, aiModel } = settingsRef.current;
    const context = logRef.current.slice(0, 8).map((l) => `[${l.source}] ${l.message}`);
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

  /** Emergency stop: latches ABORTED, sets abortRef and switches Auto Act off. */
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

  /** Last check before real input: refuses when aborted, disarmed or out of budget. */
  const gateRealInput = useCallback((budget: ActionBudget): ExecResult | null => {
    if (abortedRef.current) return { ok: false, halt: true, message: 'Aborted — real input not sent' };
    if (!armedRef.current) return { ok: false, halt: true, message: 'Real input disarmed — not sent' };
    if (spendAction(budget)) return null;
    addLog('Safety', `Action budget reached: ${budget.limit} real input action(s) this run — stopping`, 'error');
    return { ok: false, halt: true, message: `Action budget of ${budget.limit} exceeded — not sent` };
  }, [addLog]);

  /** A halting result switches Auto Act off. */
  const haltAutoAct = (out: ExecResult) => {
    if (out.halt) setSettings((s) => ({ ...s, autoAct: false }));
  };

  const agentOn = useCallback((id: Agent['id']) => agents.find((a) => a.id === id)?.on ?? false, [agents]);
  const agentsRef = useRef(agentOn);
  agentsRef.current = agentOn;

  const adDismissed = () => Math.floor(tickRef.current / AD_CYCLE) === dismissedCycleRef.current;

  /** Captures the demo desktop canvas into a Frame. */
  const captureDemoFrame = useCallback((): Frame | null => {
    const src = demoCanvasRef.current;
    return src ? toFrame(src, DEMO_W, DEMO_H, ++frameId.current, 'demo') : null;
  }, []);

  /** A fresh real desktop screenshot from the bridge; throws with the bridge's reason. */
  const captureLive = useCallback(() => desktopFrame(settingsRef.current.bridgeUrl, ++frameId.current), []);

  /** Appends one executed mouse/keyboard action to the persistent history and the log. */
  const recordAction = useCallback((rec: Omit<ActionRecord, 'id' | 'time'>) => {
    const full: ActionRecord = { id: uid('act'), time: Date.now(), ...rec };
    setHistory((h) => appendHistory(h, full));
    const where = `(${rec.x}, ${rec.y})${rec.text ? ` "${rec.text}"` : ''}`;
    addLog(rec.source, `${rec.action} ${where} via ${rec.via}: ${rec.message}`, rec.ok ? 'ok' : 'error');
  }, [addLog]);

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

  /** Applies a step to the demo desktop and records its input as a demo action. */
  const executeOnDemo = useCallback((step: WorkflowStep, actor: string): ExecResult => {
    const point = { x: step.correctedX ?? step.x, y: step.correctedY ?? step.y };
    const kind = INPUT_ACTIONS[step.action];
    const msg = kind === 'click' || kind === 'double_click' ? demoClick(point.x, point.y) : `${step.action} simulated on the demo desktop`;
    const out = { ok: !/blocked|nothing/.test(msg), message: msg };
    if (kind) recordAction({ action: kind, x: Math.round(point.x * DEMO_W), y: Math.round(point.y * DEMO_H), text: step.text, source: actor, via: 'demo', ok: out.ok, message: out.message });
    return out;
  }, [demoClick, recordAction]);

  /**
   * Executes a step: utility actions locally, the demo desktop when it is the source, otherwise
   * real input on the PC through the bridge — gated (abort, arm, `budget`) first and recorded.
   */
  const execute = useCallback(async (step: WorkflowStep, frame: Frame | null, budget: ActionBudget, actor: string): Promise<ExecResult> => {
    if (step.action === 'calc') {
      const v = calculate(step.text ?? '');
      return v === null ? { ok: false, message: 'Not a valid expression' } : { ok: true, message: `${step.text} = ${v}` };
    }
    if (step.action === 'search') {
      window.open(`https://duckduckgo.com/?q=${encodeURIComponent(step.text ?? '')}`, '_blank', 'noopener');
      return { ok: true, message: `Opened a search for "${step.text}"` };
    }
    if (step.action === 'wait') {
      await sleep(800);
      return { ok: true, message: 'Waited' };
    }
    if (sourceRef.current === 'demo') return executeOnDemo(step, actor);
    const { bridgeUrl } = settingsRef.current;
    if (!bridgeUrl) return { ok: false, message: BRIDGE_REQUIRED };
    if (!frame) return { ok: false, message: 'No live screenshot to map the action onto the screen' };
    const refused = gateRealInput(budget);
    if (refused) return refused;
    const r = await sendToBridge(bridgeUrl, step, frame.srcW, frame.srcH);
    const kind = INPUT_ACTIONS[step.action];
    if (kind) recordAction({ action: kind, ...toPixels({ x: step.correctedX ?? step.x, y: step.correctedY ?? step.y }, frame), text: step.text, source: actor, via: 'bridge', ok: r.ok, message: r.message });
    return r;
  }, [executeOnDemo, gateRealInput, recordAction]);

  /**
   * Runs one step as real input on the PC: verify on a live desktop frame, correct drift,
   * execute through the bridge, re-verify. There is no simulated path.
   */
  const perform = useCallback((step: WorkflowStep, dispatch: boolean, logSource: string): Promise<StepOutcome> => {
    const s = settingsRef.current;
    return runStep(step, {
      bridgeUrl: s.bridgeUrl,
      capture: captureLive,
      attempts: s.checkpoints,
      retryMs: Math.max(120, s.captureMs / 2),
      dispatch,
      log: (message, tone) => addLog(logSource, message, tone),
    });
  }, [addLog, captureLive]);

  /** The "connect the bridge" error when the bridge is not configured or not reachable, else null. */
  const bridgeError = useCallback(async (): Promise<string | null> => {
    const r = await checkBridge(settingsRef.current.bridgeUrl);
    return r.ok ? null : r.message;
  }, []);

  /** Visual error detection: frame-to-frame cluster of changed cells → highlighted popup/mismatch. */
  const detectErrors = useCallback((prev: Frame, cur: Frame) => {
    // A flagged popup is gone once its area matches the frame captured before it appeared,
    // or once the area no longer looks like the popup did (content behind it may have moved).
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
      return null;
    }
    const cells = largestCluster(diffCells(prev.data, cur.data));
    const box = cells.length >= 6 ? boundingBox(cells) : null;
    if (!box) return null;
    popupBaseRef.current = prev;
    popupFrameRef.current = cur;
    const ann: Annotation = { id: uid('ann'), ...box, label: 'New popup / UI mismatch', tone: 'error' };
    popupRef.current = ann;
    setAnnotations((a) => [ann, ...a.filter((x) => x.tone !== 'error')].slice(0, 6));
    if (agentsRef.current('popup')) addLog('Popup watcher', `New content appeared at (${(box.x * 100).toFixed(0)}%, ${(box.y * 100).toFixed(0)}%) — the AI decides whether it is a popup to close`, 'warn');
    return ann;
  }, [addLog]);

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

  const updateStep = (index: number, patch: Partial<WorkflowStep>) => {
    setSteps((s) => s.map((st, i) => (i === index ? { ...st, ...patch } : st)));
    stepsRef.current = stepsRef.current.map((st, i) => (i === index ? { ...st, ...patch } : st));
  };

  /** Auto-Actor popup handling: the model rules once per flagged region on whether and where to close it. */
  const autoClosePopup = async (frame: Frame, popup: Annotation, dry: boolean) => {
    popupDecidedRef.current = popup.id;
    const d = await thought('Popup', () => decidePopup(askAi, frame, popup), popupSummary);
    if (!d.close) {
      addLog('Auto-Actor', `AI left the new content alone: ${d.reason}`, 'info');
      return;
    }
    const where = at(d.x, d.y);
    if (dry) {
      addLog('Auto-Actor', `Dry run (real input disarmed): AI would close the popup at ${where} — ${d.reason}; not dispatched`, 'warn');
      return;
    }
    const close = closePopupStep(d.x, d.y);
    const r = await execute(close, frame, autoBudgetRef.current, 'Auto-Actor');
    haltAutoAct(r);
    addLog('Auto-Actor', `AI closed popup at ${where} — ${d.reason}: ${r.message}`, r.ok ? 'ok' : 'warn');
    if (!r.halt) await reflectAfter(close, framesRef.current[0] ?? frame, r, 'Auto-Actor');
  };

  /** Auto-Actor step execution: the model decides whether the next step runs now and where its target is. */
  const autoRunStep = async (frame: Frame, idx: number, dry: boolean) => {
    const next = stepsRef.current[idx];
    const d = await thought(next.name, () => decideStep(askAi, frame, next, goalRef.current), stepSummary);
    if (!d.run) {
      setSync({ level: 'yellow', detail: `AI is waiting on "${next.name}": ${d.reason}` });
      return;
    }
    const corrected = { ...next, correctedX: d.x, correctedY: d.y };
    const drift = next.refFrame ? matchTemplate(next.refFrame.data, frame.data, next.x, next.y).matchDistance : undefined;
    const out = dry ? DRY_RUN_RESULT : await execute(corrected, frame, autoBudgetRef.current, 'Auto-Actor');
    haltAutoAct(out);
    if (out.halt) {
      addLog('Auto-Actor', `${next.name}: ${out.message} — Auto Act stopped`, 'error');
      return;
    }
    if (!dry) await sleep(300);
    updateStep(idx, { status: out.ok ? 'done' : 'failed', correctedX: d.x, correctedY: d.y, drift, beforeFrame: frame, afterFrame: dry ? undefined : framesRef.current[0] });
    addLog(dry ? 'Auto-Actor (dry run)' : 'Auto-Actor', `${next.name}: ${out.message} (AI: ${d.reason})`, out.ok ? 'ok' : 'error');
    if (out.ok && !dry && agentsRef.current('progress')) setProgress((p) => ({ ...p, done: p.done + 1 }));
    await reflectAfter(corrected, framesRef.current[0] ?? frame, out, 'Auto-Actor');
  };

  /**
   * Auto-Actor: when "Auto act" is on and the AI is online, the model handles popups and runs the next step.
   * Disarmed, it runs as a dry run (nothing is dispatched). Halted entirely while ABORTED.
   */
  const autoAct = async (frame: Frame) => {
    if (!settingsRef.current.autoAct || abortedRef.current || autoBusyRef.current || replayingRef.current || recordingRef.current) return;
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

  /** Monitor analysis of one frame: gallery, persistence, error detection, sync status, auto-actor. */
  const processFrame = (frame: Frame) => {
    const prev = framesRef.current[0];
    framesRef.current = [frame, ...framesRef.current].slice(0, settingsRef.current.gallerySize);
    setFrames(framesRef.current);
    setShotCount((n) => n + 1);
    void putStoredFrame(toStoredFrame(frame), settingsRef.current.gallerySize);
    if (prev && !restoredIdsRef.current.has(prev.id)) detectErrors(prev, frame);
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

  /** Only the background monitor keeps polling while the page is hidden. */
  const pollPaused = () => typeof document !== 'undefined' && document.hidden && settingsRef.current.monitorMode !== 'background';

  // Demo capture loop at the monitor interval. Real-screen frames are pushed by the ScreenCapture instead.
  useEffect(() => {
    if (source !== 'demo') return undefined;
    const id = setInterval(() => {
      if (pollPaused()) return;
      const frame = captureDemoFrame();
      if (frame) processRef.current(frame);
    }, intervalMs);
    return () => clearInterval(id);
  }, [captureDemoFrame, intervalMs, source]);

  // Bridge monitor loop: real desktop screenshots at the monitor interval; failures are logged, never faked.
  useEffect(() => {
    if (source !== 'bridge') return undefined;
    let busy = false;
    const id = setInterval(async () => {
      if (busy || pollPaused()) return;
      busy = true;
      try {
        processRef.current(await captureLive());
      } catch (error) {
        if (Date.now() - lastCaptureErrorAt.current > 5000) {
          lastCaptureErrorAt.current = Date.now();
          addLog('Monitor', `Desktop screenshot failed: ${errorText(error)}`, 'warn');
        }
      } finally {
        busy = false;
      }
    }, intervalMs);
    return () => clearInterval(id);
  }, [addLog, captureLive, intervalMs, source]);

  // The running screen capture follows the monitor interval live.
  useEffect(() => {
    captureRef.current?.setInterval(intervalMs);
  }, [intervalMs]);

  // Stop capturing when the engine unmounts.
  useEffect(() => () => captureRef.current?.stop(), []);

  /** Writes a real outcome onto its step: done only when executed, failed otherwise; screenshot and trail follow. */
  const applyOutcome = (index: number, step: WorkflowStep, out: StepOutcome, dryRun = false) => {
    const c = out.correction;
    const measured = { correctedX: out.target.x, correctedY: out.target.y, drift: c?.matchDistance, driftPx: c?.driftPx };
    if (dryRun && out.ok) {
      updateStep(index, { status: 'pending', ...measured });
      return;
    }
    updateStep(index, { status: out.executed ? 'done' : 'failed', ...measured, shot: out.shot ?? step.shot, afterFrame: out.shot });
    if (out.executed) setTrail((t) => [...t, { x: out.target.x, y: out.target.y, t: Date.now(), click: true }].slice(-1500));
  };

  /** Records an executed replay step's input in the action history. */
  const recordOutcome = (step: WorkflowStep, out: StepOutcome, actor: string) => {
    const kind = INPUT_ACTIONS[step.action];
    if (!kind || !out.executed) return;
    recordAction({ action: kind, ...toPixels(out.target, out.shot ?? framesRef.current[0]), text: step.text, source: actor, via: 'bridge', ok: true, message: out.message });
  };

  /** Stage pointer input: trail while recording, and clicks become steps (and act on the demo). */
  const onStageMove = useCallback((x: number, y: number) => {
    if (recordingRef.current) setTrail((t) => [...t, { x, y, t: Date.now() }].slice(-1500));
  }, []);

  const onStageClick = useCallback((x: number, y: number) => {
    const frame = framesRef.current[0] ?? null;
    if (recordingRef.current) {
      setTrail((t) => [...t, { x, y, t: Date.now(), click: true }]);
      const step: WorkflowStep = { id: uid('step'), name: `Click ${stepsRef.current.length + 1}`, action: 'click', x, y, refFrame: frame ?? undefined, status: 'pending' };
      setSteps((s) => [...s, step]);
      addLog('Recorder', `Captured click at (${(x * 100).toFixed(0)}%, ${(y * 100).toFixed(0)}%) with screenshot`, 'info');
    }
    if (source === 'demo') {
      const msg = demoClick(x, y);
      if (!recordingRef.current) addLog('You', msg);
    }
  }, [addLog, demoClick, source]);

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
    } else {
      setTrail([]);
      setRecording(true);
      addLog('Recorder', 'Live recording started — move and click on the screen');
    }
  };

  /**
   * AI help during replay: the model looks at the live frame and decides whether and where
   * to close the popup covering `step`. Resolves false when the step stays covered.
   */
  const clearCoveringPopup = async (step: WorkflowStep, dryRun: boolean, budget: ActionBudget): Promise<boolean> => {
    const popup = popupRef.current;
    const live = framesRef.current[0];
    if (!popup || !covers(popup, step)) return true;
    if (!settingsRef.current.aiHelp || !live) {
      addLog('AI help', `Popup covers "${step.name}" (enable AI help to clear it)`, 'warn');
      return false;
    }
    try {
      const d = await thought(step.name, () => decidePopup(askAi, live, popup), popupSummary);
      if (!d.close) {
        addLog('AI help', `AI says the region over "${step.name}" is not a popup to close: ${d.reason}`, 'warn');
        return false;
      }
      addLog('AI help', `Popup covers "${step.name}" — AI closes it at ${at(d.x, d.y)}: ${d.reason}`, 'warn');
      setCursor({ x: d.x, y: d.y });
      if (dryRun) {
        popupRef.current = null;
        setAnnotations((a) => a.filter((x) => x.tone !== 'error'));
        return true;
      }
      const close = closePopupStep(d.x, d.y);
      const r = await execute(close, live, budget, 'AI help');
      addLog('AI help', r.message, r.ok ? 'ok' : 'warn');
      await sleep(settingsRef.current.captureMs * 2 + 200);
      if (!r.halt) await reflectAfter(close, framesRef.current[0] ?? live, r, 'AI help');
      return r.ok;
    } catch (error) {
      addLog('AI help', `AI unavailable — popup not cleared: ${errorText(error)}`, 'error');
      return false;
    }
  };

  /** Runs one replay step: popup clearance, safety gate, then the real-input pipeline. Null when the run must stop. */
  const replayStep = async (i: number, label: string, dryRun: boolean, budget: ActionBudget): Promise<StepOutcome | null | 'skipped'> => {
    const step = stepsRef.current[i];
    setActiveIndex(i);
    updateStep(i, { status: 'running' });
    if (!(await clearCoveringPopup(step, dryRun, budget))) {
      updateStep(i, { status: 'drift' });
      addLog(label, `"${step.name}" is covered by a popup the AI did not clear`, 'error');
      return 'skipped';
    }
    const refused = dryRun ? null : gateRealInput(budget);
    if (refused) {
      updateStep(i, { status: 'failed' });
      addLog(label, `${step.name}: ${refused.message} — replay stopped`, 'error');
      return null;
    }
    const out = await perform(step, !dryRun, label);
    recordOutcome(step, out, label);
    setCursor(out.target);
    setSync({ level: out.correction?.level ?? 'red', detail: `"${step.name}": ${out.correction ? `drift ${out.correction.driftPx}px` : 'target not verified'}` });
    applyOutcome(i, step, out, dryRun);
    if (out.executed && agentsRef.current('progress')) setProgress((p) => ({ ...p, done: p.done + 1 }));
    addLog(label, `${step.name}: ${out.message}`, out.ok ? 'ok' : 'error');
    if (aiOnline()) await reflectAfter(step, out.shot ?? framesRef.current[0] ?? null, out, label);
    return out;
  };

  /**
   * Real replay with drift correction: for every step the target is verified on a live
   * desktop screenshot from the bridge, re-located when the UI moved, executed as real
   * input at the corrected position, and re-verified. Refused while ABORTED; while real
   * input is disarmed it runs as a dry run, like the self-test.
   * @param selfTest AI self-test: verifies and corrects every step on the live screen but sends no input.
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
    const missing = await bridgeError();
    if (missing) {
      setSteps((s) => s.map((st) => ({ ...st, status: 'failed' as const })));
      stepsRef.current = stepsRef.current.map((st) => ({ ...st, status: 'failed' as const }));
      addLog(label, `${missing} — no step was executed`, 'error');
      return;
    }
    const dryRun = selfTest || !armedRef.current;
    if (dryRun && !selfTest) addLog('Safety', 'Real input disarmed — replay runs as a dry run (nothing is sent to the PC)', 'warn');
    const budget = createBudget(settingsRef.current.actionBudget);
    abortRef.current = false;
    setReplaying(true);
    setSteps((s) => s.map((st) => ({ ...st, status: 'pending' as const })));
    stepsRef.current = stepsRef.current.map((st) => ({ ...st, status: 'pending' as const }));
    const shots: Frame[] = [];
    let ok = 0;
    addLog(label, dryRun ? `Self-test of ${stepsRef.current.length} step(s): verifying on the live desktop, no input is sent` : `Replaying ${stepsRef.current.length} step(s) as real input on the PC`);
    for (let i = 0; i < stepsRef.current.length && !abortRef.current; i++) {
      const out = await replayStep(i, label, dryRun, budget);
      if (out === null) break;
      if (out === 'skipped') continue;
      if (out.ok) ok++;
      if (out.shot) shots.push(out.shot);
    }
    setActiveIndex(null);
    setReplaying(false);
    // AI picks the most informative post-step screenshots for the user.
    const picks = shots
      .map((f, i) => ({ f, score: i === 0 ? 1 : frameDistance(shots[i - 1].data, f.data) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((p) => p.f);
    if (picks.length) setPinned(picks);
    if (agentsRef.current('goal')) {
      const total = stepsRef.current.length;
      const what = dryRun ? 'verified on screen (not dispatched)' : 'executed on the PC';
      addLog('Goal reviewer', ok === total ? `All ${total} steps ${what}${goal ? ` for "${goal}"` : ''}` : `${ok}/${total} ${what} — re-plan the failed steps or let AI help clear blockers`, ok === total ? 'ok' : 'warn');
    }
  };

  const stop = () => {
    abortRef.current = true;
    addLog('Replay', 'Stopped by user', 'warn');
  };

  /** AI plan: reuse a similar saved workflow, otherwise the model plans from the goal + live frame. */
  const autoPlan = async () => {
    if (!goal.trim()) {
      addLog('Planner', 'Type a goal first', 'warn');
      return;
    }
    setAiBusy(true);
    try {
      const context = logRef.current.slice(0, 8).map((l) => `[${l.source}] ${l.message}`);
      const plan = await thought(`Plan: ${goal}`, () => planFromGoal(goal, cards, framesRef.current[0] ?? null, askAi, context), (r) => (r.source === AI_PLAN_SOURCE ? `${r.steps.length} step(s): ${r.steps.map((s) => s.name).join(' → ')}` : null));
      const { steps: planned, source: why } = plan;
      setSteps(planned);
      setDraftCard(generateCard(planned, goal));
      addLog('Planner', `${why}: ${planned.length} step(s) — ${planned.map((s) => s.name).join(' → ')}${armedRef.current ? '' : ' — real input disarmed, Auto Act / replay will run it as a dry run'}`, 'ok');
    } catch (error) {
      addLog('Planner', `AI plan failed — no steps created: ${errorText(error)}`, 'error');
    } finally {
      setAiBusy(false);
    }
  };

  /** AI help: the model answers a question about the live screen and points out what it means. */
  const askScreen = async (question = 'What on this screen needs my attention, and what should I do next?') => {
    const f = framesRef.current[0];
    if (!f) {
      addLog('AI help', 'No captured frame yet', 'warn');
      return;
    }
    setAiBusy(true);
    try {
      const { answer, annotations: items } = await thought(`Ask: ${question}`, () => describeScreen(askAi, f, question, goal), (r) => r.answer);
      setAiAnswer(answer);
      setAnnotations(items);
      addLog('AI help', answer, 'info');
    } catch (error) {
      setAiAnswer('');
      addLog('AI help', `AI unavailable — no answer: ${errorText(error)}`, 'error');
    } finally {
      setAiBusy(false);
    }
  };

  /** Point out: the model's default AI-help question. */
  const explainScreen = () => askScreen();

  /** Turns a captured screen image into a Frame and runs the monitor on it. */
  const onScreenImage = (image: CapturedImage) => {
    processRef.current({ id: ++frameId.current, ...image, source: 'screen' });
  };

  /**
   * The capture ended or failed by itself: stop any replay, keep the screen source (no
   * silent switch to the demo desktop) and raise a visible error until the user acts.
   */
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

  /** Shows the PC's real screen through the desktop bridge once its health check passes. */
  const connectBridge = async (): Promise<boolean> => {
    const missing = await bridgeError();
    if (missing) {
      addLog('Bridge', missing, 'error');
      return false;
    }
    attachSource('bridge');
    addLog('Bridge', 'Desktop bridge online — screenshots now come from the real screen', 'ok');
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

  /** Launches/focuses `name` on the PC as real input (gated like every other dispatch). */
  const launchTarget = async (name: string) => {
    let live: Frame;
    try {
      live = await captureLive();
    } catch (error) {
      addLog('/use', `Could not screenshot the PC to launch "${name}": ${errorText(error)}`, 'error');
      return;
    }
    const open: WorkflowStep = { id: uid('use'), name: `Open ${name}`, action: 'open_app', text: name, x: 0.5, y: 0.5, status: 'pending' };
    const r = await execute(open, live, createBudget(1), '/use');
    addLog('/use', r.ok ? `Launched "${name}": ${r.message}` : `Could not launch "${name}": ${r.message}`, r.ok ? 'ok' : 'error');
  };

  /** "/use <target>": attach to the PC via the bridge and launch the target, or attach to its window via screen capture. */
  const attachTarget = async (name: string) => {
    const { bridgeUrl } = settingsRef.current;
    if (bridgeUrl && (await checkBridge(bridgeUrl)).ok) {
      attachSource('bridge');
      setTarget(name);
      addLog('/use', `Using "${name}" — capturing the real screen via the bridge`, 'ok');
      await launchTarget(name);
      return;
    }
    addLog('/use', `No desktop bridge online — pick the "${name}" window to attach to`, 'info');
    if (await shareScreen()) {
      setTarget(name);
      addLog('/use', `Attached to "${name}"; acting on it needs the desktop bridge`, 'ok');
    }
  };

  /** Submits the assist input: slash commands run, anything else is planned as a goal. */
  const submitInput = async () => {
    const command = parseCommand(goal);
    if (!command) {
      await autoPlan();
      return;
    }
    if (command.kind === 'error') {
      addLog('Command', command.message, 'warn');
      return;
    }
    setGoal('');
    await attachTarget(command.target);
  };

  /** Explicit demo mode: the only way demo frames are used once a real source exists. */
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
    settings, setSettings, source, frames, pinned, setPinned, steps, setSteps, trail, setTrail, recording, replaying,
    activeIndex, sync, annotations, cursor, log, cards, draftCard, setDraftCard, goal, setGoal, progress, setProgress,
    agents, setAgents, plays, demoCanvasRef, captureLost, DEMO_W, DEMO_H, intervalMs, shotCount, target, history,
    armed, aborted, aiStatus, aiAnswer, aiBusy, timeline,
    onStageMove, onStageClick, onStageType, toggleRecording, replay, stop, autoPlan, submitInput, askScreen, explainScreen,
    shareScreen, useDemo, connectBridge, saveCard, loadCard, addLog, toggleArmed, triggerAbort, clearAbort, exportHistory, resetHistory,
  };
}

/** The engine's public surface, for panels. */
export type AssistEngine = ReturnType<typeof useAssist>;
