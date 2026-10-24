import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionRecord, Annotation, AssistSettings, Frame, InputAction, LogEntry, SavedCard, ScreenSource, StepAction, SyncLevel, TrailPoint, WorkflowStep } from './types.js';
import { boundingBox, boxDistance, diffCells, frameDistance, largestCluster, matchTemplate, syncLevelFor } from './drift.js';
import { AD_CYCLE, demoAd, demoPlayButton, drawDemoDesktop } from './demo-desktop.js';
import { calculate, generateCard, planFromGoal, uid } from './planner.js';
import { captureBridgeScreen, checkBridge, launchOnBridge, moveOnBridge, sendToBridge, stepPixels } from './bridge.js';
import { grabFrame, monitorInterval, realScreenSource } from './capture.js';
import { appendHistory, clearHistory, downloadText, historyToCsv, historyToJson, loadHistory } from './action-history.js';
import { parseCommand } from './commands.js';

const DEMO_W = 960;
const DEMO_H = 540;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Workflow actions that are real mouse/keyboard input. */
const INPUT_ACTIONS: Partial<Record<StepAction, InputAction>> = { click: 'click', double_click: 'double_click', scroll: 'scroll', type: 'type', key: 'key' };
/** Input actions that first move the pointer to their target. */
const POINTER_ACTIONS = new Set<InputAction>(['click', 'double_click', 'scroll']);

type ExecResult = { ok: boolean; message: string };

/**
 * Looks for a popup's close control: the centroid of the brightest pixels in the
 * popup's top-right corner. Falls back to the corner itself.
 */
function findCloseButton(frame: Frame, box: { x: number; y: number; w: number; h: number }) {
  const { data, width, height } = frame.data;
  const x0 = Math.floor((box.x + box.w * 0.6) * width);
  const x1 = Math.min(width - 1, Math.ceil((box.x + box.w) * width));
  const y0 = Math.floor(box.y * height);
  const y1 = Math.min(height - 1, Math.ceil((box.y + box.h * 0.35) * height));
  const bright: Array<[number, number]> = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * width + x) * 4;
      if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) bright.push([x, y]);
    }
  }
  if (bright.length >= 3) {
    // Anchor on the bright pixel closest to the top-right corner, then average its
    // neighbourhood — so nearby text doesn't pull the click off the × button.
    const anchor = bright.reduce((a, p) => (p[0] - p[1] > a[0] - a[1] ? p : a));
    const near = bright.filter((p) => Math.abs(p[0] - anchor[0]) <= 8 && Math.abs(p[1] - anchor[1]) <= 8);
    const cx = near.reduce((s, p) => s + p[0], 0) / near.length;
    const cy = near.reduce((s, p) => s + p[1], 0) / near.length;
    return { x: cx / width, y: cy / height, found: true };
  }
  return { x: box.x + box.w * 0.93, y: box.y + box.h * 0.09, found: false };
}

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
  const [settings, setSettings] = useState<AssistSettings>(DEFAULT_SETTINGS);
  const [source, setSource] = useState<ScreenSource>('demo');
  /** The app/window the assistant is attached to via /use. */
  const [target, setTarget] = useState<string | null>(null);
  const [history, setHistory] = useState<ActionRecord[]>(() => loadHistory());
  /** Screenshots taken this session (monitor ticks + per-step evidence). */
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
  const [log, setLog] = useState<LogEntry[]>([]);
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

  const demoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef(0);
  const dismissedCycleRef = useRef(-1);
  const framesRef = useRef<Frame[]>([]);
  const stepsRef = useRef<WorkflowStep[]>([]);
  const settingsRef = useRef(settings);
  const popupRef = useRef<Annotation | null>(null);
  const abortRef = useRef(false);
  /** The clean frame captured just before the flagged popup appeared. */
  const popupBaseRef = useRef<Frame | null>(null);
  /** The frame in which the flagged popup was first seen. */
  const popupFrameRef = useRef<Frame | null>(null);
  const autoBusyRef = useRef(false);
  const frameId = useRef(0);
  const lastStepAt = useRef(0);
  const sourceRef = useRef<ScreenSource>(source);
  /** Set when the user explicitly picks the demo desktop; the bridge then no longer takes over. */
  const demoChosenRef = useRef(false);
  const captureBusyRef = useRef(false);
  const lastCaptureErrorAt = useRef(0);

  settingsRef.current = settings;
  stepsRef.current = steps;
  sourceRef.current = source;

  const addLog = useCallback((source: string, message: string, tone: LogEntry['tone'] = 'info') => {
    setLog((l) => [{ id: uid('log'), time: Date.now(), source, message, tone }, ...l].slice(0, 200));
  }, []);

  const agentOn = useCallback((id: Agent['id']) => agents.find((a) => a.id === id)?.on ?? false, [agents]);
  const agentsRef = useRef(agentOn);
  agentsRef.current = agentOn;

  const adDismissed = () => Math.floor(tickRef.current / AD_CYCLE) === dismissedCycleRef.current;

  /** Captures the current source into a Frame and counts it; a failed real capture is logged, never replaced by demo frames. */
  const snapshot = useCallback(async (): Promise<Frame | null> => {
    const deps = { demoCanvas: demoCanvasRef.current, video: videoRef.current, bridgeUrl: settingsRef.current.bridgeUrl };
    try {
      const frame = await grabFrame(sourceRef.current, deps, frameId.current + 1);
      if (!frame) return null;
      frameId.current = frame.id;
      setShotCount((n) => n + 1);
      return frame;
    } catch (error) {
      if (Date.now() - lastCaptureErrorAt.current > 5000) {
        lastCaptureErrorAt.current = Date.now();
        addLog('Monitor', `Screenshot failed (${sourceRef.current}): ${errorText(error)}`, 'warn');
      }
      return null;
    }
  }, [addLog]);

  /** Pushes a frame to the front of the comparison gallery. */
  const pushFrame = useCallback((frame: Frame) => {
    framesRef.current = [frame, ...framesRef.current].slice(0, settingsRef.current.gallerySize);
    setFrames(framesRef.current);
  }, []);

  /** Takes a fresh screenshot for step evidence and shows it in the gallery. */
  const evidence = useCallback(async (): Promise<Frame | undefined> => {
    const frame = await snapshot();
    if (frame) pushFrame(frame);
    return frame ?? undefined;
  }, [pushFrame, snapshot]);

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

  /** Dispatches a mouse/keyboard step to the PC through the bridge (pointer moved first) and records it. */
  const executeOnBridge = useCallback(async (step: WorkflowStep, kind: InputAction, frame: Frame, actor: string): Promise<ExecResult> => {
    const { bridgeUrl } = settingsRef.current;
    const { x, y } = stepPixels(step, frame.srcW, frame.srcH);
    if (POINTER_ACTIONS.has(kind)) {
      const moved = await moveOnBridge(bridgeUrl, x, y);
      recordAction({ action: 'move', x, y, source: actor, via: 'bridge', ok: moved.ok, message: moved.message });
    }
    const r = await sendToBridge(bridgeUrl, step, frame.srcW, frame.srcH);
    recordAction({ action: kind, x, y, text: step.text, source: actor, via: 'bridge', ok: r.ok, message: r.message });
    return r;
  }, [recordAction]);

  /** Applies a mouse/keyboard step to the demo desktop and records it as a demo action. */
  const executeOnDemo = useCallback((step: WorkflowStep, kind: InputAction, actor: string): ExecResult => {
    const nx = step.correctedX ?? step.x;
    const ny = step.correctedY ?? step.y;
    const msg = kind === 'click' || kind === 'double_click' ? demoClick(nx, ny) : `${kind} simulated on the demo desktop`;
    const out = { ok: !/blocked|nothing/.test(msg), message: msg };
    recordAction({ action: kind, x: Math.round(nx * DEMO_W), y: Math.round(ny * DEMO_H), text: step.text, source: actor, via: 'demo', ok: out.ok, message: out.message });
    return out;
  }, [demoClick, recordAction]);

  /** Executes a step: utility actions locally, input on the PC via the bridge, or on the demo desktop. */
  const execute = useCallback(async (step: WorkflowStep, frame: Frame | null, actor = 'Replay'): Promise<ExecResult> => {
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
    if (step.action === 'open_app' && settingsRef.current.bridgeUrl) return launchOnBridge(settingsRef.current.bridgeUrl, step.text ?? step.name);
    const kind = INPUT_ACTIONS[step.action];
    if (!kind) return { ok: false, message: `"${step.action}" cannot be performed here` };
    if (sourceRef.current === 'demo') return executeOnDemo(step, kind, actor);
    if (!settingsRef.current.bridgeUrl) return { ok: false, message: 'No desktop bridge configured — set the bridge URL in Settings to act on the PC' };
    if (!frame) return { ok: false, message: 'No live screenshot to map the action onto the screen' };
    return executeOnBridge(step, kind, frame, actor);
  }, [executeOnBridge, executeOnDemo]);

  /** Visual error detection: frame-to-frame cluster of changed cells → highlighted popup/mismatch. */
  const detectErrors = useCallback((prev: Frame, cur: Frame) => {
    // A flagged popup is gone once its area matches the frame captured before it appeared.
    // Or once the area no longer looks like the popup did (content behind it may have moved).
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
    const close = findCloseButton(cur, box);
    popupBaseRef.current = prev;
    popupFrameRef.current = cur;
    const ann: Annotation = { id: uid('ann'), ...box, label: 'New popup / UI mismatch', tone: 'error', actX: close.x, actY: close.y };
    popupRef.current = ann;
    setAnnotations((a) => [ann, ...a.filter((x) => x.tone !== 'error')].slice(0, 6));
    if (agentsRef.current('popup')) addLog('Popup watcher', `Intrusive content appeared — close button ${close.found ? 'found' : 'guessed'} at (${(close.x * 100).toFixed(1)}%, ${(close.y * 100).toFixed(1)}%)`, 'warn');
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

  // Bridge takeover: when a bridge answers its health check, frames come from the real desktop
  // unless the user explicitly chose the demo desktop.
  useEffect(() => {
    const url = settings.bridgeUrl;
    if (!url) return undefined;
    let cancelled = false;
    void checkBridge(url).then((r) => {
      if (cancelled || !r.ok || demoChosenRef.current || sourceRef.current === 'bridge') return;
      framesRef.current = [];
      setSource('bridge');
      addLog('Monitor', 'Desktop bridge online — screenshots now come from the real screen', 'ok');
    });
    return () => {
      cancelled = true;
    };
  }, [settings.bridgeUrl, addLog]);

  const intervalMs = monitorInterval(settings.monitorMode, settings.captureMs);

  // Monitor loop at the mode's interval: gallery, error detection, sync status, auto-actor.
  useEffect(() => {
    const tick = async () => {
      // Only background mode keeps watching and controlling while the page is hidden.
      if (document.hidden && settingsRef.current.monitorMode !== 'background') return;
      if (captureBusyRef.current) return;
      captureBusyRef.current = true;
      try {
        const frame = await snapshot();
        if (frame) onFrame(frame);
      } finally {
        captureBusyRef.current = false;
      }
    };
    const id = setInterval(() => void tick(), intervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, detectErrors, intervalMs, source]);

  /** Handles one monitor frame. */
  const onFrame = (frame: Frame) => {
    const prev = framesRef.current[0];
    pushFrame(frame);
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

  /** Auto-Actor: when "Auto act" is on, closes popups and runs the next step once it matches the screen. */
  const autoAct = async (frame: Frame) => {
    if (!settingsRef.current.autoAct || autoBusyRef.current || replayingRef.current || recordingRef.current) return;
    autoBusyRef.current = true;
    try {
      const popup = popupRef.current;
      if (popup && popup.actX !== undefined && agentsRef.current('popup')) {
        if (Date.now() - lastStepAt.current < 1500) return;
        const r = await execute({ id: 'auto', name: 'Close popup', action: 'click', x: popup.actX, y: popup.actY!, status: 'pending' }, frame, 'Auto-Actor');
        addLog('Auto-Actor', r.message, r.ok ? 'ok' : 'warn');
        lastStepAt.current = Date.now();
        return;
      }
      const idx = stepsRef.current.findIndex((s) => s.status === 'pending');
      const next = stepsRef.current[idx];
      if (!next || Date.now() - lastStepAt.current < 1500) return;
      // Steps without a screenshot (calc, search, typing) have nothing to match: run them as-is.
      const r = next.refFrame ? matchTemplate(next.refFrame.data, frame.data, next.x, next.y) : { regionDistance: 0, matchDistance: 0, dx: 0, dy: 0 };
      if (syncLevelFor(r) === 'red') return;
      const corrected = { ...next, correctedX: next.x + r.dx, correctedY: next.y + r.dy };
      const beforeFrame = await evidence();
      const out = await execute(corrected, beforeFrame ?? frame, 'Auto-Actor');
      await sleep(300);
      const afterFrame = await evidence();
      lastStepAt.current = Date.now();
      updateStep(idx, { status: out.ok ? 'done' : 'failed', correctedX: corrected.correctedX, correctedY: corrected.correctedY, drift: r.matchDistance, beforeFrame, afterFrame });
      addLog('Auto-Actor', `${next.name}: ${out.message}`, out.ok ? 'ok' : 'error');
      if (out.ok && agentsRef.current('progress')) setProgress((p) => ({ ...p, done: p.done + 1 }));
    } finally {
      autoBusyRef.current = false;
    }
  };

  const replayingRef = useRef(false);
  const recordingRef = useRef(false);
  replayingRef.current = replaying;
  recordingRef.current = recording;

  const updateStep = (index: number, patch: Partial<WorkflowStep>) => {
    setSteps((s) => s.map((st, i) => (i === index ? { ...st, ...patch } : st)));
    stepsRef.current = stepsRef.current.map((st, i) => (i === index ? { ...st, ...patch } : st));
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
   * Forward replay with background drift cross-referencing: each move is split into
   * `checkpoints` sub-moves; at every checkpoint the live frame is re-matched against the
   * step's screenshot and the target corrected before the click. A popup over the target
   * is cleared first when AI help is on. On success the step screenshot is refreshed.
   * @param dryRun AI self-test: verifies every step but dispatches nothing.
   */
  const replay = async (dryRun = false) => {
    if (!stepsRef.current.length) {
      addLog('Replay', 'Nothing to replay — record or plan a workflow first', 'warn');
      return;
    }
    abortRef.current = false;
    setReplaying(true);
    setSteps((s) => s.map((st) => ({ ...st, status: 'pending' as const })));
    stepsRef.current = stepsRef.current.map((st) => ({ ...st, status: 'pending' as const }));
    const verified: Frame[] = [];
    let pos = cursor ?? { x: 0.5, y: 0.9 };
    let ok = 0;
    addLog(dryRun ? 'Self-test' : 'Replay', `Starting ${dryRun ? 'dry run' : 'replay'} of ${stepsRef.current.length} step(s)`);
    for (let i = 0; i < stepsRef.current.length; i++) {
      if (abortRef.current) break;
      const step = stepsRef.current[i];
      setActiveIndex(i);
      updateStep(i, { status: 'running' });
      let target = { x: step.x, y: step.y };
      let best = 0;
      const n = Math.max(1, settingsRef.current.checkpoints);
      for (let k = 1; k <= n; k++) {
        if (abortRef.current) break;
        await sleep(Math.max(120, settingsRef.current.captureMs / 2));
        const live = framesRef.current[0];
        if (step.refFrame && live) {
          const r = matchTemplate(step.refFrame.data, live.data, step.x, step.y);
          best = r.matchDistance;
          if (syncLevelFor(r) !== 'red') target = { x: step.x + r.dx, y: step.y + r.dy };
          setSync({ level: syncLevelFor(r), detail: `Checkpoint ${k}/${n} of "${step.name}": best ${r.matchDistance.toFixed(3)}` });
        }
        pos = { x: pos.x + (target.x - pos.x) * (k / n), y: pos.y + (target.y - pos.y) * (k / n) };
        setCursor(pos);
        setTrail((t) => [...t, { x: pos.x, y: pos.y, t: Date.now() }].slice(-1500));
      }
      // AI help: a popup covering the target is closed first.
      const popup = popupRef.current;
      const covered = popup && target.x >= popup.x && target.x <= popup.x + popup.w && target.y >= popup.y && target.y <= popup.y + popup.h;
      if (covered && settingsRef.current.aiHelp && popup?.actX !== undefined) {
        addLog('AI help', `Popup covers "${step.name}" — closing it first`, 'warn');
        setCursor({ x: popup.actX, y: popup.actY! });
        if (!dryRun) {
          const r = await execute({ id: 'ai', name: 'Close popup', action: 'click', x: popup.actX, y: popup.actY!, status: 'pending' }, framesRef.current[0] ?? null, 'AI help');
          addLog('AI help', r.message, r.ok ? 'ok' : 'warn');
        } else {
          popupRef.current = null;
          setAnnotations((a) => a.filter((x) => x.tone !== 'error'));
        }
        await sleep(settingsRef.current.captureMs * 2 + 200);
        const live = framesRef.current[0];
        if (step.refFrame && live) {
          const r = matchTemplate(step.refFrame.data, live.data, step.x, step.y);
          if (syncLevelFor(r) !== 'red') target = { x: step.x + r.dx, y: step.y + r.dy };
        }
        setCursor(target);
      } else if (covered) {
        updateStep(i, { status: 'drift', drift: best });
        addLog('Replay', `"${step.name}" is covered by a popup (enable AI help to clear it)`, 'error');
        continue;
      }
      const drifted = Math.hypot(target.x - step.x, target.y - step.y) > 0.005;
      const corrected = { ...step, correctedX: target.x, correctedY: target.y };
      const beforeFrame = await evidence();
      const out = dryRun ? { ok: true, message: 'verified (not dispatched)' } : await execute(corrected, beforeFrame ?? framesRef.current[0] ?? null);
      setTrail((t) => [...t, { x: target.x, y: target.y, t: Date.now(), click: true }]);
      await sleep(settingsRef.current.captureMs + 100);
      const afterFrame = await evidence();
      const after = afterFrame ?? framesRef.current[0];
      if (out.ok) {
        ok++;
        if (after) verified.push(after);
        // Replace the step screenshot with the fresh one so the next run matches today's UI.
        updateStep(i, { status: drifted ? 'drift' : 'done', correctedX: target.x, correctedY: target.y, drift: best, x: target.x, y: target.y, refFrame: !dryRun && drifted && beforeFrame ? beforeFrame : step.refFrame, beforeFrame, afterFrame });
        if (!dryRun && agentsRef.current('progress')) setProgress((p) => ({ ...p, done: p.done + 1 }));
      } else {
        updateStep(i, { status: 'failed', drift: best, beforeFrame, afterFrame });
      }
      addLog(dryRun ? 'Self-test' : 'Replay', `${step.name}: ${out.message}${drifted ? ` (drift corrected ${((target.x - step.x) * 100).toFixed(1)}%, ${((target.y - step.y) * 100).toFixed(1)}%)` : ''}`, out.ok ? 'ok' : 'error');
    }
    setActiveIndex(null);
    setReplaying(false);
    // AI picks the most informative screenshots for the user.
    const picks = verified
      .map((f, i) => ({ f, score: i === 0 ? 1 : frameDistance(verified[i - 1].data, f.data) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((p) => p.f);
    if (picks.length) setPinned(picks);
    if (agentsRef.current('goal')) {
      const total = stepsRef.current.length;
      addLog('Goal reviewer', ok === total ? `All ${total} steps verified${goal ? ` for "${goal}"` : ''} — ready to save or schedule a repeat` : `${ok}/${total} verified — re-plan the failed steps or let AI help clear blockers`, ok === total ? 'ok' : 'warn');
    }
  };

  const stop = () => {
    abortRef.current = true;
    addLog('Replay', 'Stopped by user', 'warn');
  };

  /** AI plan: reuse a similar saved workflow or assemble steps from the goal + live screen. */
  const autoPlan = () => {
    if (!goal.trim()) {
      addLog('Planner', 'Type a goal first', 'warn');
      return;
    }
    const { steps: planned, source: why } = planFromGoal(goal, cards, framesRef.current[0] ?? null, popupRef.current);
    setSteps(planned);
    setDraftCard(generateCard(planned, goal));
    addLog('Planner', `${why}: ${planned.length} step(s)`, 'ok');
  };

  /** Switches to a real source, resetting the gallery; the demo is no longer the explicit choice. */
  const attachSource = (next: ScreenSource) => {
    demoChosenRef.current = false;
    framesRef.current = [];
    setSource(next);
  };

  /**
   * Attaches to a real screen: native capture under Electron, otherwise the browser screen/window picker.
   * Returns whether a source is attached.
   */
  const shareScreen = async (): Promise<boolean> => {
    if (realScreenSource() === 'native') {
      attachSource('native');
      addLog('Screen', 'Using the Electron native screen capture — the AI now sees your screen', 'ok');
      return true;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      stream.getVideoTracks()[0].addEventListener('ended', () => setSource('demo'));
      attachSource('screen');
      addLog('Screen', 'Sharing your screen — the AI now sees it', 'ok');
      return true;
    } catch (error) {
      addLog('Screen', `Screen share cancelled: ${errorText(error)}`, 'warn');
      return false;
    }
  };

  /** "/use <target>": launch/focus the target on the PC via the bridge, or attach to its window via screen share. */
  const attachTarget = async (name: string) => {
    const { bridgeUrl } = settingsRef.current;
    if (bridgeUrl && (await checkBridge(bridgeUrl)).ok) {
      const r = await launchOnBridge(bridgeUrl, name);
      addLog('/use', r.ok ? `${r.message}; capturing the real screen via the bridge` : `Could not launch "${name}": ${r.message}`, r.ok ? 'ok' : 'error');
      if (!r.ok) return;
      attachSource('bridge');
      setTarget(name);
      return;
    }
    addLog('/use', `No desktop bridge online — pick the "${name}" window to attach to`, 'info');
    if (await shareScreen()) {
      setTarget(name);
      addLog('/use', `Attached to "${name}" (${realScreenSource() === 'native' ? 'native capture' : 'screen share'}); acting on it needs the desktop bridge`, 'ok');
    }
  };

  /** Submits the assist input: slash commands run, anything else is planned as a goal. */
  const submitInput = async () => {
    const command = parseCommand(goal);
    if (!command) {
      autoPlan();
      return;
    }
    if (command.kind === 'error') {
      addLog('Command', command.message, 'warn');
      return;
    }
    setGoal('');
    await attachTarget(command.target);
  };

  /** AI points out what matters on screen now. */
  const explainScreen = () => {
    const f = framesRef.current[0];
    if (!f) return;
    const next: Annotation[] = [];
    if (popupRef.current) next.push(popupRef.current);
    const step = stepsRef.current.find((s) => s.status === 'pending');
    if (step) next.push({ id: uid('ann'), x: (step.correctedX ?? step.x) - 0.06, y: (step.correctedY ?? step.y) - 0.05, w: 0.12, h: 0.1, label: `Next: ${step.name}`, tone: 'info' });
    setAnnotations(next);
    if (step) setCursor({ x: step.correctedX ?? step.x, y: step.correctedY ?? step.y });
    addLog('AI', next.length ? `Pointed out ${next.length} item(s) on screen and refocused the cursor` : 'Nothing needs attention right now', 'info');
  };

  /** Explicit demo mode: the only way demo frames are used once a real source exists. */
  const useDemo = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    demoChosenRef.current = true;
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
    settings, setSettings, source, frames, pinned, setPinned, steps, setSteps, trail, setTrail, recording, replaying,
    activeIndex, sync, annotations, cursor, log, cards, draftCard, setDraftCard, goal, setGoal, progress, setProgress,
    agents, setAgents, plays, demoCanvasRef, videoRef, DEMO_W, DEMO_H,
    target, history, shotCount, intervalMs,
    onStageMove, onStageClick, onStageType, toggleRecording, replay, stop, autoPlan, submitInput, explainScreen,
    shareScreen, useDemo, saveCard, loadCard, addLog, exportHistory, resetHistory,
  };
}

/** The engine's public surface, for panels. */
export type AssistEngine = ReturnType<typeof useAssist>;
