import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionRecord, Annotation, AssistSettings, Frame, InputAction, LogEntry, SavedCard, ScreenSource, StepAction, SyncLevel, TrailPoint, WorkflowStep } from './types.js';
import { monitorInterval } from './types.js';
import { SAMPLE_H, SAMPLE_W, boundingBox, boxDistance, diffCells, frameDistance, largestCluster, matchTemplate, syncLevelFor } from './drift.js';
import { AD_CYCLE, demoAd, demoPlayButton, drawDemoDesktop } from './demo-desktop.js';
import { calculate, generateCard, planFromGoal, relocateTarget, uid } from './planner.js';
import { DEFAULT_AI_MODEL, DEFAULT_AI_URL, createAiSession, pingAi } from './ai.js';
import type { AiStatus, AskRequest } from './ai.js';
import { confirmTarget, decidePopup, decideStep, describeScreen } from './assist-ai.js';
import { BRIDGE_REQUIRED, captureDesktop, checkBridge } from './bridge.js';
import { runStep, type Grounding, type StepOutcome } from './run-step.js';
import { zoomFrame } from './grounding.js';
import { parseCommand } from './commands.js';
import { createScreenCapture, type CapturedImage, type ScreenCapture } from './capture.js';
import { DEFAULT_ABORT_HOTKEY, DEFAULT_ACTION_BUDGET, createBudget, matchesHotkey, spendAction, type ActionBudget } from './safety.js';
import { LOG_LIMIT, loadCards, loadLog, loadSettings, saveCards, saveLog, saveSettings } from './storage.js';
import { decodeFrames, toStoredFrame } from './frame-codec.js';
import { loadStoredFrames, putStoredFrame } from './frame-store.js';
import { appendHistory, clearHistory, downloadText, historyToCsv, historyToJson, loadHistory } from './action-history.js';

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
  const [armed, setArmed] = useState(false);
  const [aborted, setAborted] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiStatus>({ state: 'checking', detail: 'Connecting to the AI endpoint…' });
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [captureLost, setCaptureLost] = useState<string | null>(null);

  const demoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureRef = useRef<ScreenCapture | null>(null);
  const tickRef = useRef(0);
  const dismissedCycleRef = useRef(-1);
  const framesRef = useRef<Frame[]>([]);
  const stepsRef = useRef<WorkflowStep[]>([]);
  const settingsRef = useRef(settings);
  const sourceRef = useRef(source);
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

  // Persistence: settings, log and cards.
  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => saveLog(log), [log]);
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
  const askAi = useCallback(async (req: AskRequest): Promise<string> => {
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

  /** The AI grounding pass run-step uses: confirm on a zoomed crop, re-ask the planner once. */
  const grounding: Grounding = {
    confirm: async (live, step, p) => confirmTarget(askAi, await zoomFrame(live, p), step),
    relocate: (live, step, feedback) => relocateTarget(askAi, live, step, feedback),
  };

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
  const perform = async (step: WorkflowStep, actor: string, budget: ActionBudget, dryRun: boolean): Promise<Performed> => {
    if (abortedRef.current) return refused(step, 'Aborted — real input not sent');
    if (sourceRef.current === 'demo') {
      const out = await performOnDemo(step, dryRun);
      if (out.executed) recordAction(step, out, actor, 'demo', DEMO_W, DEMO_H);
      return out;
    }
    const { bridgeUrl, checkpoints } = settingsRef.current;
    if (!bridgeUrl) return refused(step, BRIDGE_REQUIRED);
    if (!dryRun && !spendAction(budget)) {
      addLog('Safety', `Action budget reached: ${budget.limit} real input action(s) this run — stopping`, 'error');
      return refused(step, `Action budget of ${budget.limit} exceeded — not sent`);
    }
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

  const updateStep = (index: number, patch: Partial<WorkflowStep>) => {
    stepsRef.current = stepsRef.current.map((st, i) => (i === index ? { ...st, ...patch } : st));
    setSteps(stepsRef.current);
  };

  /** Writes a real outcome onto its step: done only when executed, failed otherwise. */
  const applyOutcome = (index: number, out: Performed, dryRun: boolean) => {
    const c = out.correction;
    const measured = { correctedX: out.target.x, correctedY: out.target.y, drift: c?.matchDistance, driftPx: c?.driftPx };
    if (dryRun && out.ok) {
      updateStep(index, { status: 'pending', ...measured });
      return;
    }
    updateStep(index, { status: out.executed ? 'done' : 'failed', ...measured, ...(out.shot ? { shot: out.shot } : {}) });
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
    const d = await decidePopup(askAi, frame, popup);
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
    const d = await decideStep(askAi, frame, next, goalRef.current);
    if (!d.run) {
      setSync({ level: 'yellow', detail: `AI is waiting on "${next.name}": ${d.reason}` });
      return;
    }
    // A recorded template locates the target itself; otherwise the model's current point is used.
    const step = next.refFrame ? next : { ...next, x: d.x, y: d.y };
    updateStep(idx, { status: 'running' });
    const out = await perform(step, 'Auto-Actor', autoBudgetRef.current, dry);
    applyOutcome(idx, out, dry);
    addLog(dry ? 'Auto-Actor (dry run)' : 'Auto-Actor', `${next.name}: ${out.message}`, out.ok ? 'ok' : 'error');
    if (out.halt) {
      setSettings((s) => ({ ...s, autoAct: false }));
      addLog('Auto-Actor', 'Auto Act stopped', 'error');
    }
  };

  /** Auto Act: with the AI online, the model handles popups and runs the next pending step. Disarmed = dry run. */
  const autoAct = async (frame: Frame) => {
    const { autoAct: on } = settingsRef.current;
    if (!on || abortedRef.current || autoBusyRef.current || replayingRef.current || recordingRef.current) return;
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
      const d = await decidePopup(askAi, live, popup);
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
    const out = await perform(step, label, budget, dryRun);
    applyOutcome(i, out, dryRun);
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

  /** AI plan: reuse a similar saved workflow, otherwise the model plans from the goal + live frame. */
  const autoPlan = async (text = goal) => {
    if (!text.trim()) {
      addLog('Planner', 'Type a goal first', 'warn');
      return;
    }
    await withAi(async () => {
      try {
        const { steps: planned, source: why } = await planFromGoal(text, cards, framesRef.current[0] ?? null, askAi);
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
        const { steps: planned } = await planFromGoal(`Move the mouse cursor onto the ${name} (hover, do not click)`, [], framesRef.current[0] ?? null, askAi);
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
        const { answer, annotations: items } = await describeScreen(askAi, f, question, goal);
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

  const shareScreen = async (): Promise<boolean> => {
    captureRef.current?.stop();
    const capture = createScreenCapture();
    try {
      await capture.start(monitorInterval(settingsRef.current.monitorMode, settingsRef.current.captureMs), { onImage: onScreenImage, onLost: onCaptureLost });
    } catch (error) {
      capture.stop();
      addLog('Screen', `Screen capture failed to start: ${errorText(error)}`, 'error');
      return false;
    }
    captureRef.current = capture;
    framesRef.current = [];
    setCaptureLost(null);
    setSource('screen');
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
    captureRef.current?.stop();
    captureRef.current = null;
    framesRef.current = [];
    setCaptureLost(null);
    setSource('bridge');
    addLog('Bridge', `${health.message} — screenshots now come from the real desktop`, 'ok');
    return true;
  };

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
    captureRef.current?.stop();
    captureRef.current = null;
    setCaptureLost(null);
    setTarget(null);
    setSource('demo');
    framesRef.current = [];
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
    settings, setSettings, source, target, frames, pinned, setPinned, steps, setSteps, trail, setTrail, recording, replaying,
    activeIndex, sync, annotations, cursor, log, cards, draftCard, setDraftCard, goal, setGoal, progress, setProgress,
    agents, setAgents, plays, demoCanvasRef, captureLost, DEMO_W, DEMO_H, intervalMs, shotCount, history,
    armed, aborted, aiStatus, aiAnswer, aiBusy,
    onStageMove, onStageClick, onStageType, toggleRecording, replay, stop, autoPlan, submitInput, askScreen, explainScreen,
    shareScreen, connectBridge, useDemo, saveCard, loadCard, addLog, toggleArmed, triggerAbort, clearAbort, exportHistory, resetHistory,
  };
}

/** The engine's public surface, for panels. */
export type AssistEngine = ReturnType<typeof useAssist>;
