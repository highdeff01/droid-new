import { useCallback, useEffect, useRef, useState } from 'react';
import type { Annotation, AssistSettings, Frame, LogEntry, SavedCard, SyncLevel, TrailPoint, WorkflowStep } from './types.js';
import { SAMPLE_H, SAMPLE_W, boundingBox, boxDistance, diffCells, frameDistance, largestCluster, matchTemplate, syncLevelFor } from './drift.js';
import { AD_CYCLE, demoAd, demoPlayButton, drawDemoDesktop } from './demo-desktop.js';
import { generateCard, planFromGoal, uid } from './planner.js';
import { captureDesktop, checkBridge } from './bridge.js';
import { runStep, type StepOutcome } from './run-step.js';

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

/** A click on a flagged popup's close control, as a real step (no template: the popup is new). */
const closePopupStep = (popup: Annotation): WorkflowStep => ({ id: uid('close'), name: 'Close popup', action: 'click', x: popup.actX!, y: popup.actY!, status: 'pending' });

/** Default settings. */
export const DEFAULT_SETTINGS: AssistSettings = {
  gallerySize: 10,
  checkpoints: 6,
  captureMs: 500,
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

  settingsRef.current = settings;
  stepsRef.current = steps;

  const addLog = useCallback((source: string, message: string, tone: LogEntry['tone'] = 'info') => {
    setLog((l) => [{ id: uid('log'), time: Date.now(), source, message, tone }, ...l].slice(0, 200));
  }, []);

  const agentOn = useCallback((id: Agent['id']) => agents.find((a) => a.id === id)?.on ?? false, [agents]);
  const agentsRef = useRef(agentOn);
  agentsRef.current = agentOn;

  const adDismissed = () => Math.floor(tickRef.current / AD_CYCLE) === dismissedCycleRef.current;

  /** Captures the current source into a Frame (display JPEG + 320×180 pixel buffer). */
  const captureFrame = useCallback((): Frame | null => {
    const src: CanvasImageSource | null = source === 'screen' ? videoRef.current : demoCanvasRef.current;
    if (!src) return null;
    const srcW = source === 'screen' ? videoRef.current?.videoWidth ?? 0 : DEMO_W;
    const srcH = source === 'screen' ? videoRef.current?.videoHeight ?? 0 : DEMO_H;
    if (!srcW || !srcH) return null;
    return toFrame(src, srcW, srcH, ++frameId.current, source);
  }, [source]);

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

  /** A fresh real desktop screenshot from the bridge; throws with the bridge's reason. */
  const captureLive = useCallback(() => desktopFrame(settingsRef.current.bridgeUrl, ++frameId.current), []);

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

  // Capture loop: gallery, error detection, sync status, auto-actor.
  useEffect(() => {
    const id = setInterval(() => {
      const frame = captureFrame();
      if (!frame) return;
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
      void autoAct();
    }, settingsRef.current.captureMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureFrame, detectErrors, settings.captureMs]);

  /** Auto-Actor: when "Auto act" is on, closes popups and runs the next step as real input once it matches the screen. */
  const autoAct = async () => {
    if (!settingsRef.current.autoAct || autoBusyRef.current || replayingRef.current || recordingRef.current) return;
    if (Date.now() - lastStepAt.current < 1500) return;
    autoBusyRef.current = true;
    try {
      const popup = popupRef.current;
      const closePopup = popup && popup.actX !== undefined && agentsRef.current('popup');
      const idx = stepsRef.current.findIndex((s) => s.status === 'pending');
      if (!closePopup && idx < 0) return;
      const missing = await bridgeError();
      if (missing) {
        addLog('Auto-Actor', missing, 'error');
        setSettings((s) => ({ ...s, autoAct: false }));
        return;
      }
      if (closePopup) {
        const r = await perform(closePopupStep(popup), true, 'Auto-Actor');
        addLog('Auto-Actor', r.message, r.ok ? 'ok' : 'error');
        lastStepAt.current = Date.now();
        return;
      }
      const step = stepsRef.current[idx];
      updateStep(idx, { status: 'running' });
      const out = await perform(step, true, 'Auto-Actor');
      lastStepAt.current = Date.now();
      applyOutcome(idx, step, out);
      addLog('Auto-Actor', `${step.name}: ${out.message}`, out.ok ? 'ok' : 'error');
      if (out.executed && agentsRef.current('progress')) setProgress((p) => ({ ...p, done: p.done + 1 }));
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
   * Real replay with drift correction: for every step the target is verified on a live
   * desktop screenshot from the bridge, re-located by template matching when the UI moved,
   * executed as real mouse/keyboard input at the corrected position, and re-verified.
   * Fails loudly with "connect the bridge" when the bridge is missing or unreachable.
   * @param dryRun AI self-test: verifies and corrects every step on the live screen but sends no input.
   */
  const replay = async (dryRun = false) => {
    const label = dryRun ? 'Self-test' : 'Replay';
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
      await clearCoveringPopup(step, dryRun);
      const out = await perform(step, !dryRun, label);
      setCursor(out.target);
      const level = out.correction?.level ?? 'red';
      setSync({ level, detail: `"${step.name}": ${out.correction ? `drift ${out.correction.driftPx}px` : 'target not verified'}` });
      applyOutcome(i, step, out, dryRun);
      if (out.ok) ok++;
      if (out.shot) shots.push(out.shot);
      if (out.executed && agentsRef.current('progress')) setProgress((p) => ({ ...p, done: p.done + 1 }));
      addLog(label, `${step.name}: ${out.message}`, out.ok ? 'ok' : 'error');
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

  const shareScreen = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      stream.getVideoTracks()[0].addEventListener('ended', () => setSource('demo'));
      setSource('screen');
      framesRef.current = [];
      addLog('Screen', 'Sharing your screen — the AI now sees it', 'ok');
    } catch (error) {
      addLog('Screen', `Screen share cancelled: ${error instanceof Error ? error.message : String(error)}`, 'warn');
    }
  };

  const useDemo = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setSource('demo');
    framesRef.current = [];
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
    settings, setSettings, source, frames, pinned, setPinned, steps, setSteps, trail, setTrail, recording, replaying,
    activeIndex, sync, annotations, cursor, log, cards, draftCard, setDraftCard, goal, setGoal, progress, setProgress,
    agents, setAgents, plays, demoCanvasRef, videoRef, DEMO_W, DEMO_H,
    onStageMove, onStageClick, onStageType, toggleRecording, replay, stop, autoPlan, explainScreen,
    shareScreen, useDemo, saveCard, loadCard, addLog,
  };
}

/** The engine's public surface, for panels. */
export type AssistEngine = ReturnType<typeof useAssist>;
