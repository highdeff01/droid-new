import { useCallback, useEffect, useRef, useState } from 'react';
import type { Annotation, AssistSettings, Frame, LogEntry, SavedCard, SyncLevel, TrailPoint, WorkflowStep } from './types.js';
import { SAMPLE_H, SAMPLE_W, boundingBox, boxDistance, diffCells, frameDistance, largestCluster, matchTemplate, syncLevelFor } from './drift.js';
import { AD_CYCLE, demoAd, demoPlayButton, drawDemoDesktop } from './demo-desktop.js';
import { calculate, generateCard, planFromGoal, uid } from './planner.js';
import { DEFAULT_AI_MODEL, DEFAULT_AI_URL, createAiSession, pingAi } from './ai.js';
import type { AiStatus, AskRequest } from './ai.js';
import { describeScreen, decidePopup, decideStep } from './assist-ai.js';
import { sendToBridge } from './bridge.js';

const DEMO_W = 960;
const DEMO_H = 540;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Default settings. */
export const DEFAULT_SETTINGS: AssistSettings = {
  gallerySize: 10,
  checkpoints: 6,
  captureMs: 500,
  autoAct: false,
  aiHelp: true,
  showTrail: true,
  bridgeUrl: '',
  aiUrl: DEFAULT_AI_URL,
  aiModel: DEFAULT_AI_MODEL,
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
  const [aiStatus, setAiStatus] = useState<AiStatus>({ state: 'checking', detail: 'Connecting to the AI endpoint…' });
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiBusy, setAiBusy] = useState(false);

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
  const aiSessionRef = useRef(createAiSession(typeof sessionStorage === 'undefined' ? null : sessionStorage));
  const aiStatusRef = useRef(aiStatus);
  const logRef = useRef<LogEntry[]>([]);
  /** The goal as of the last render, for the capture-loop closures. */
  const goalRef = useRef('');
  /** The popup annotation the model has already ruled on, so it is asked once per popup. */
  const popupDecidedRef = useRef<string | null>(null);

  settingsRef.current = settings;
  aiStatusRef.current = aiStatus;
  logRef.current = log;
  goalRef.current = goal;
  stepsRef.current = steps;

  const addLog = useCallback((source: string, message: string, tone: LogEntry['tone'] = 'info') => {
    setLog((l) => [{ id: uid('log'), time: Date.now(), source, message, tone }, ...l].slice(0, 200));
  }, []);

  // Startup ping, and again whenever the endpoint or model changes.
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
  const askAi = useCallback(async (req: AskRequest): Promise<string> => {
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
    const small = document.createElement('canvas');
    small.width = SAMPLE_W;
    small.height = SAMPLE_H;
    const sctx = small.getContext('2d', { willReadFrequently: true })!;
    sctx.drawImage(src, 0, 0, SAMPLE_W, SAMPLE_H);
    const view = document.createElement('canvas');
    view.width = 480;
    view.height = 270;
    view.getContext('2d')!.drawImage(src, 0, 0, 480, 270);
    return { id: ++frameId.current, time: Date.now(), url: view.toDataURL('image/jpeg', 0.7), data: sctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H), srcW, srcH, source };
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

  /** Executes a step: demo desktop or native PC via the bridge, plus utility actions. */
  const execute = useCallback(async (step: WorkflowStep, frame: Frame | null): Promise<{ ok: boolean; message: string }> => {
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
  }, [demoClick, source]);

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
      void autoAct(frame);
    }, settingsRef.current.captureMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureFrame, detectErrors, settings.captureMs]);

  /** Auto-Actor popup handling: the model rules once per flagged region on whether and where to close it. */
  const autoClosePopup = async (frame: Frame, popup: Annotation) => {
    popupDecidedRef.current = popup.id;
    const d = await decidePopup(askAi, frame, popup);
    if (!d.close) {
      addLog('Auto-Actor', `AI left the new content alone: ${d.reason}`, 'info');
      return;
    }
    const r = await execute({ id: 'auto', name: 'Close popup', action: 'click', x: d.x, y: d.y, status: 'pending' }, frame);
    addLog('Auto-Actor', `AI closed popup at (${(d.x * 100).toFixed(1)}%, ${(d.y * 100).toFixed(1)}%) — ${d.reason}: ${r.message}`, r.ok ? 'ok' : 'warn');
  };

  /** Auto-Actor step execution: the model decides whether the next step runs now and where its target is. */
  const autoRunStep = async (frame: Frame, idx: number) => {
    const next = stepsRef.current[idx];
    const d = await decideStep(askAi, frame, next, goalRef.current);
    if (!d.run) {
      setSync({ level: 'yellow', detail: `AI is waiting on "${next.name}": ${d.reason}` });
      return;
    }
    const corrected = { ...next, correctedX: d.x, correctedY: d.y };
    const drift = next.refFrame ? matchTemplate(next.refFrame.data, frame.data, next.x, next.y).matchDistance : undefined;
    const out = await execute(corrected, frame);
    updateStep(idx, { status: out.ok ? 'done' : 'failed', correctedX: d.x, correctedY: d.y, drift });
    addLog('Auto-Actor', `${next.name}: ${out.message} (AI: ${d.reason})`, out.ok ? 'ok' : 'error');
    if (out.ok && agentsRef.current('progress')) setProgress((p) => ({ ...p, done: p.done + 1 }));
  };

  /** Auto-Actor: when "Auto act" is on and the AI is online, the model handles popups and runs the next step. */
  const autoAct = async (frame: Frame) => {
    if (!settingsRef.current.autoAct || autoBusyRef.current || replayingRef.current || recordingRef.current) return;
    if (!aiOnline() || Date.now() - lastStepAt.current < 1500) return;
    autoBusyRef.current = true;
    try {
      const popup = popupRef.current;
      const idx = stepsRef.current.findIndex((s) => s.status === 'pending');
      if (popup && popupDecidedRef.current !== popup.id && agentsRef.current('popup')) await autoClosePopup(frame, popup);
      else if (idx >= 0) await autoRunStep(frame, idx);
    } catch (error) {
      addLog('Auto-Actor', `AI unavailable — nothing executed: ${errorText(error)}`, 'error');
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
   * to close the popup covering `step`. Resolves true once it has been cleared.
   */
  const clearCoveringPopup = async (popup: Annotation, step: WorkflowStep, dryRun: boolean): Promise<boolean> => {
    const live = framesRef.current[0];
    if (!live) return false;
    try {
      const d = await decidePopup(askAi, live, popup);
      if (!d.close) {
        addLog('AI help', `AI says the region over "${step.name}" is not a popup to close: ${d.reason}`, 'warn');
        return false;
      }
      addLog('AI help', `Popup covers "${step.name}" — AI closes it at (${(d.x * 100).toFixed(1)}%, ${(d.y * 100).toFixed(1)}%): ${d.reason}`, 'warn');
      setCursor({ x: d.x, y: d.y });
      if (dryRun) {
        popupRef.current = null;
        setAnnotations((a) => a.filter((x) => x.tone !== 'error'));
        return true;
      }
      const r = await execute({ id: 'ai', name: 'Close popup', action: 'click', x: d.x, y: d.y, status: 'pending' }, live);
      addLog('AI help', r.message, r.ok ? 'ok' : 'warn');
      await sleep(settingsRef.current.captureMs * 2 + 200);
      return r.ok;
    } catch (error) {
      addLog('AI help', `AI unavailable — popup not cleared: ${errorText(error)}`, 'error');
      return false;
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
      if (popup && covered && !(settingsRef.current.aiHelp && (await clearCoveringPopup(popup, step, dryRun)))) {
        updateStep(i, { status: 'drift', drift: best });
        addLog('Replay', `"${step.name}" is covered by a popup${settingsRef.current.aiHelp ? ' the AI did not clear' : ' (enable AI help to clear it)'}`, 'error');
        continue;
      }
      if (covered) {
        const live = framesRef.current[0];
        if (step.refFrame && live) {
          const r = matchTemplate(step.refFrame.data, live.data, step.x, step.y);
          if (syncLevelFor(r) !== 'red') target = { x: step.x + r.dx, y: step.y + r.dy };
        }
        setCursor(target);
      }
      const drifted = Math.hypot(target.x - step.x, target.y - step.y) > 0.005;
      const corrected = { ...step, correctedX: target.x, correctedY: target.y };
      const out = dryRun ? { ok: true, message: 'verified (not dispatched)' } : await execute(corrected, framesRef.current[0]);
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

  /** AI plan: reuse a similar saved workflow, otherwise the model plans from the goal + live frame. */
  const autoPlan = async () => {
    if (!goal.trim()) {
      addLog('Planner', 'Type a goal first', 'warn');
      return;
    }
    setAiBusy(true);
    try {
      const context = logRef.current.slice(0, 8).map((l) => `[${l.source}] ${l.message}`);
      const { steps: planned, source: why } = await planFromGoal(goal, cards, framesRef.current[0] ?? null, askAi, context);
      setSteps(planned);
      setDraftCard(generateCard(planned, goal));
      addLog('Planner', `${why}: ${planned.length} step(s) — ${planned.map((s) => s.name).join(' → ')}`, 'ok');
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

  /** Point out: the model's default AI-help question. */
  const explainScreen = () => askScreen();

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
    agents, setAgents, plays, demoCanvasRef, videoRef, DEMO_W, DEMO_H, aiStatus, aiAnswer, aiBusy, askScreen,
    onStageMove, onStageClick, onStageType, toggleRecording, replay, stop, autoPlan, explainScreen,
    shareScreen, useDemo, saveCard, loadCard, addLog,
  };
}

/** The engine's public surface, for panels. */
export type AssistEngine = ReturnType<typeof useAssist>;
