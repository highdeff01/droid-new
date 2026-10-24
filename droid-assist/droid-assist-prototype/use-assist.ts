import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionRecord, Annotation, AssistSettings, Frame, InputAction, LogEntry, SavedCard, ScreenSource, StepAction, SyncLevel, TrailPoint, WorkflowStep } from './types.js';
import { boundingBox, boxDistance, diffCells, frameDistance, largestCluster, matchTemplate, syncLevelFor } from './drift.js';
import { AD_CYCLE, demoAd, demoPlayButton, drawDemoDesktop } from './demo-desktop.js';
import { calculate, generateCard, planFromGoal, uid } from './planner.js';
import { sendToBridge } from './bridge.js';
import { createScreenCapture, type CapturedImage, type ScreenCapture } from './capture.js';

const DEMO_W = 960;
const DEMO_H = 540;

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

/** Workflow actions that are real mouse/keyboard input. */
const INPUT_ACTIONS: Partial<Record<StepAction, InputAction>> = { click: 'click', double_click: 'double_click', scroll: 'scroll', type: 'type', key: 'key' };
/** Input actions that first move the pointer to their target. */
const POINTER_ACTIONS = new Set<InputAction>(['click', 'double_click', 'scroll']);

type ExecResult = { ok: boolean; message: string };

/** A click on a flagged popup's close control, as a real step (no template: the popup is new). */
const closePopupStep = (popup: Annotation): WorkflowStep => ({ id: uid('close'), name: 'Close popup', action: 'click', x: popup.actX!, y: popup.actY!, status: 'pending' });

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
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

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
  const [source, setSource] = useState<'demo' | 'screen'>('demo');
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

  const demoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /** The running real-screen capture, null when on the demo or after a loss. */
  const captureRef = useRef<ScreenCapture | null>(null);
  /** Why the screen capture stopped on its own; null while healthy. */
  const [captureLost, setCaptureLost] = useState<string | null>(null);
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
  /** Seeded from the clock so new captures never reuse the ids of frames stored by an earlier session. */
  const frameId = useRef(Date.now());
  /** Frames restored from storage: shown in the gallery, never compared against for popups. */
  const restoredIdsRef = useRef(new Set<number>());
  /** Cards are written back only after the stored ones have been loaded. */
  const cardsHydratedRef = useRef(false);
  const lastStepAt = useRef(0);
  const armedRef = useRef(armed);
  const abortedRef = useRef(aborted);
  /** Budget of the current Auto Act run (from switch-on to switch-off). */
  const autoBudgetRef = useRef<ActionBudget>(createBudget(settings.actionBudget));
  /** The popup a disarmed Auto Act already reported, so the dry run is logged once. */
  const dryPopupRef = useRef<string | null>(null);

  settingsRef.current = settings;
  aiStatusRef.current = aiStatus;
  logRef.current = log;
  goalRef.current = goal;
  stepsRef.current = steps;
  armedRef.current = armed;
  abortedRef.current = aborted;

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

  const agentOn = useCallback((id: Agent['id']) => agents.find((a) => a.id === id)?.on ?? false, [agents]);
  const agentsRef = useRef(agentOn);
  agentsRef.current = agentOn;

  const adDismissed = () => Math.floor(tickRef.current / AD_CYCLE) === dismissedCycleRef.current;

  /** Captures the demo desktop canvas into a Frame (display JPEG + 320×180 pixel buffer). */
  const captureDemoFrame = useCallback((): Frame | null => {
    const src = demoCanvasRef.current;
    if (!src) return null;
    const small = document.createElement('canvas');
    small.width = SAMPLE_W;
    small.height = SAMPLE_H;
    const sctx = small.getContext('2d', { willReadFrequently: true })!;
    sctx.drawImage(src, 0, 0, SAMPLE_W, SAMPLE_H);
    const view = document.createElement('canvas');
    view.width = 480;
    view.height = 270;
    view.getContext('2d')!.drawImage(src, 0, 0, 480, 270);
    return { id: ++frameId.current, time: Date.now(), url: view.toDataURL('image/jpeg', 0.7), data: sctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H), srcW: DEMO_W, srcH: DEMO_H, source: 'demo' };
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

  /**
   * Executes a step: demo desktop or native PC via the bridge, plus utility actions.
   * Every bridge dispatch is real input and is gated (abort, arm, `budget`) first.
   */
  const execute = useCallback(async (step: WorkflowStep, frame: Frame | null, budget: ActionBudget): Promise<ExecResult> => {
    const x = step.correctedX ?? step.x;
    const y = step.correctedY ?? step.y;
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
    const { bridgeUrl } = settingsRef.current;
    if (bridgeUrl && frame) {
      const refused = gateRealInput(budget);
      if (refused) return refused;
      const r = await sendToBridge(bridgeUrl, step, frame.srcW, frame.srcH);
      if (!r.ok || source === 'screen') return r;
    } else if (source === 'screen') {
      return { ok: false, message: 'No desktop bridge configured — set the bridge URL in Settings to act on the PC' };
    }
    if (step.action === 'click') {
      const result = demoClick(x, y);
      return { ok: !/blocked|nothing/.test(result), message: result };
    }
    return { ok: true, message: `${step.action} simulated on the demo desktop` };
  }, [demoClick, gateRealInput, source]);

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

  /** Monitor analysis of one frame: gallery, error detection, sync status, auto-actor. */
  const processFrame = (frame: Frame) => {
    const prev = framesRef.current[0];
    framesRef.current = [frame, ...framesRef.current].slice(0, settingsRef.current.gallerySize);
    setFrames(framesRef.current);
    if (prev) {
      const popup = detectErrors(prev, frame);
      if (!popup && popupRef.current && frameDistance(prev.data, frame.data) < 0.005) {
        // still showing — keep
      }
    }
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

  // Demo capture loop. Real-screen frames are pushed by the ScreenCapture instead.
  useEffect(() => {
    if (source !== 'demo') return undefined;
    const id = setInterval(() => {
      const frame = captureDemoFrame();
      if (frame) processRef.current(frame);
    }, settings.captureMs);
    return () => clearInterval(id);
  }, [captureDemoFrame, settings.captureMs, source]);

  // The running screen capture follows the capture-rate setting live.
  useEffect(() => {
    captureRef.current?.setInterval(settings.captureMs);
  }, [settings.captureMs]);

  // Stop capturing when the engine unmounts.
  useEffect(() => () => captureRef.current?.stop(), []);

  /**
   * Auto-Actor: when "Auto act" is on, closes popups and runs the next step once it matches the screen.
   * Disarmed, it runs as a dry run: steps are verified against the screen but nothing is dispatched.
   * Halted entirely while ABORTED.
   */
  const autoAct = async (frame: Frame) => {
    if (!settingsRef.current.autoAct || abortedRef.current || autoBusyRef.current || replayingRef.current || recordingRef.current) return;
    autoBusyRef.current = true;
    try {
      const dry = !armedRef.current;
      const popup = popupRef.current;
      const closable = popup?.actX !== undefined && popup.actY !== undefined && agentsRef.current('popup') ? popup : null;
      if (closable && dry && dryPopupRef.current !== closable.id) {
        dryPopupRef.current = closable.id;
        addLog('Auto-Actor', 'Dry run (real input disarmed): would close the popup — not dispatched', 'warn');
      }
      if (closable?.actX !== undefined && closable.actY !== undefined && !dry) {
        if (Date.now() - lastStepAt.current < 1500) return;
        const r = await execute({ id: 'auto', name: 'Close popup', action: 'click', x: closable.actX, y: closable.actY, status: 'pending' }, frame, autoBudgetRef.current);
        addLog('Auto-Actor', r.message, r.ok ? 'ok' : 'warn');
        lastStepAt.current = Date.now();
        haltAutoAct(r);
        return;
      }
      const idx = stepsRef.current.findIndex((s) => s.status === 'pending');
      const next = stepsRef.current[idx];
      if (!next || Date.now() - lastStepAt.current < 1500) return;
      // Steps without a screenshot (calc, search, typing) have nothing to match: run them as-is.
      const r = next.refFrame ? matchTemplate(next.refFrame.data, frame.data, next.x, next.y) : { regionDistance: 0, matchDistance: 0, dx: 0, dy: 0 };
      if (syncLevelFor(r) === 'red') return;
      const corrected = { ...next, correctedX: next.x + r.dx, correctedY: next.y + r.dy };
      const out = dry ? DRY_RUN_RESULT : await execute(corrected, frame, autoBudgetRef.current);
      lastStepAt.current = Date.now();
      haltAutoAct(out);
      if (out.halt) {
        addLog('Auto-Actor', `${next.name}: ${out.message} — Auto Act stopped`, 'error');
        return;
      }
      updateStep(idx, { status: out.ok ? 'done' : 'failed', correctedX: corrected.correctedX, correctedY: corrected.correctedY, drift: r.matchDistance });
      addLog(dry ? 'Auto-Actor (dry run)' : 'Auto-Actor', `${next.name}: ${out.message}`, out.ok ? 'ok' : 'error');
      if (out.ok && !dry && agentsRef.current('progress')) setProgress((p) => ({ ...p, done: p.done + 1 }));
    } finally {
      lastStepAt.current = Date.now();
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

  /** Writes a real outcome onto its step: done only when executed, failed otherwise; screenshot and trail follow. */
  const applyOutcome = (index: number, step: WorkflowStep, out: StepOutcome, dryRun = false) => {
    const c = out.correction;
    const measured = { correctedX: out.target.x, correctedY: out.target.y, drift: c?.matchDistance, driftPx: c?.driftPx };
    if (dryRun && out.ok) {
      updateStep(index, { status: 'pending', ...measured });
      return;
    }
    updateStep(index, { status: out.executed ? 'done' : 'failed', ...measured, shot: out.shot ?? step.shot });
    if (out.executed) setTrail((t) => [...t, { x: out.target.x, y: out.target.y, t: Date.now(), click: true }].slice(-1500));
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

  /** AI help: a flagged popup over the step's target is closed first, as real input. */
  const clearCoveringPopup = async (step: WorkflowStep, dryRun: boolean) => {
    const popup = popupRef.current;
    const covered = popup && step.x >= popup.x && step.x <= popup.x + popup.w && step.y >= popup.y && step.y <= popup.y + popup.h;
    if (!covered || popup.actX === undefined) return;
    if (dryRun || !settingsRef.current.aiHelp) {
      addLog('AI help', `Popup covers "${step.name}"${dryRun ? ' — self-test does not close it' : ' (enable AI help to clear it)'}`, 'warn');
      return;
    }
    addLog('AI help', `Popup covers "${step.name}" — closing it first`, 'warn');
    const r = await perform(closePopupStep(popup), true, 'AI help');
    addLog('AI help', r.message, r.ok ? 'ok' : 'error');
  };

  /**
   * Forward replay with background drift cross-referencing: each move is split into
   * `checkpoints` sub-moves; at every checkpoint the live frame is re-matched against the
   * step's screenshot and the target corrected before the click. A popup over the target
   * is cleared first when AI help is on. On success the step screenshot is refreshed.
   * @param selfTest AI self-test: verifies every step but dispatches nothing.
   * While real input is disarmed every replay runs the same dry-run path.
   */
  const replay = async (selfTest = false) => {
    if (!stepsRef.current.length) {
      addLog(label, 'Nothing to replay — record or plan a workflow first', 'warn');
      return;
    }
    const missing = await bridgeError();
    if (missing) {
      setSteps((s) => s.map((st) => ({ ...st, status: 'failed' as const })));
      stepsRef.current = stepsRef.current.map((st) => ({ ...st, status: 'failed' as const }));
      addLog(label, `${missing} — no step was executed`, 'error');
      return;
    }
    if (abortedRef.current) {
      addLog('Safety', 'Replay refused — ABORTED is active; clear the abort first', 'error');
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
          const r = await execute({ id: 'ai', name: 'Close popup', action: 'click', x: popup.actX, y: popup.actY!, status: 'pending' }, framesRef.current[0], budget);
          addLog('AI help', r.message, r.ok ? 'ok' : 'warn');
          if (r.halt) {
            updateStep(i, { status: 'failed', drift: best });
            break;
          }
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
      const out = dryRun ? DRY_RUN_RESULT : await execute(corrected, framesRef.current[0], budget);
      if (out.halt) {
        updateStep(i, { status: 'failed', drift: best });
        addLog('Replay', `${step.name}: ${out.message} — replay stopped`, 'error');
        break;
      }
      setTrail((t) => [...t, { x: target.x, y: target.y, t: Date.now(), click: true }]);
      await sleep(settingsRef.current.captureMs + 100);
      const after = framesRef.current[0];
      if (out.ok) {
        ok++;
        if (after) verified.push(after);
        // Replace the step screenshot with the fresh one so the next run matches today's UI.
        updateStep(i, { status: drifted ? 'drift' : 'done', correctedX: target.x, correctedY: target.y, drift: best, x: target.x, y: target.y, refFrame: !dryRun && drifted && framesRef.current[1] ? framesRef.current[1] : step.refFrame });
        if (!dryRun && agentsRef.current('progress')) setProgress((p) => ({ ...p, done: p.done + 1 }));
      } else {
        updateStep(i, { status: 'failed', drift: best });
      }
      addLog(dryRun ? 'Self-test' : 'Replay', `${step.name}: ${out.message}${drifted ? ` (drift corrected ${((target.x - step.x) * 100).toFixed(1)}%, ${((target.y - step.y) * 100).toFixed(1)}%)` : ''}`, out.ok ? 'ok' : 'error');
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
    const { steps: planned, source: why } = planFromGoal(goal, cards, framesRef.current[0] ?? null, popupRef.current);
    setSteps(planned);
    setDraftCard(generateCard(planned, goal));
    addLog('Planner', `${why}: ${planned.length} step(s)${armedRef.current ? '' : ' — real input disarmed, Auto Act / replay will run it as a dry run'}`, 'ok');
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
      const { answer, annotations: items } = await describeScreen(askAi, f, question, goal);
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

  const shareScreen = async () => {
    captureRef.current?.stop();
    const capture = createScreenCapture();
    try {
      await capture.start(settingsRef.current.captureMs, { onImage: onScreenImage, onLost: onCaptureLost });
    } catch (error) {
      capture.stop();
      addLog('Screen', `Screen capture failed to start: ${error instanceof Error ? error.message : String(error)}`, 'error');
      return;
    }
    captureRef.current = capture;
    framesRef.current = [];
    setCaptureLost(null);
    setSource('screen');
    addLog('Screen', capture.kind === 'native' ? 'Capturing your screen natively — monitoring continues while minimized' : 'Sharing your screen — the AI now sees it', 'ok');
  };

  /** Explicit demo mode: the only way demo frames are used once a real source exists. */
  const useDemo = () => {
    captureRef.current?.stop();
    captureRef.current = null;
    setCaptureLost(null);
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
    agents, setAgents, plays, demoCanvasRef, captureLost, DEMO_W, DEMO_H,
    onStageMove, onStageClick, onStageType, toggleRecording, replay, stop, autoPlan, explainScreen,
    shareScreen, useDemo, saveCard, loadCard, addLog, toggleArmed, triggerAbort, clearAbort,
  };
}

/** The engine's public surface, for panels. */
export type AssistEngine = ReturnType<typeof useAssist>;
