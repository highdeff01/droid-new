import type { ScreenSource } from './types.js';
import type { ScreenCapture } from './capture.js';

/**
 * The capture source as a pure frame provider: where replay and the drift monitor get their live
 * frames and where a step's final input is sent. Every source runs the same step pipeline
 * (locate + drift-correct on live frames, grounding, retry ladder, re-verify); only these two differ.
 */

/** Where live frames come from: the app's own captured frames (Electron, getDisplayMedia, main-app mirror), a bridge screenshot or the demo canvas. */
export type FrameProvider = 'captured' | 'bridge' | 'demo';
/** Where a step's real input goes: the desktop bridge, the main app (run_script) or the simulated demo desktop. */
export type InputRoute = 'desktop-bridge' | 'main-app' | 'demo';

interface Route {
  frames: FrameProvider;
  input: InputRoute;
}

/** A step run on the current source: its frame provider, input route and whether it needs the desktop bridge. */
export interface StepPlan extends Route {
  needsBridge: boolean;
}

const ROUTES: Record<ScreenSource, Route | null> = {
  none: null,
  demo: { frames: 'demo', input: 'demo' },
  screen: { frames: 'captured', input: 'desktop-bridge' },
  bridge: { frames: 'bridge', input: 'desktop-bridge' },
  'main-app': { frames: 'captured', input: 'main-app' },
};

/** The demo desktop armed with a bridge URL: real input goes to the PC and is verified on its screenshots. */
const DEMO_ON_BRIDGE: Route = { frames: 'bridge', input: 'desktop-bridge' };

/** Why steps cannot run without a source. */
export const NO_SOURCE = 'No capture source — share the screen, connect the bridge or pick the demo desktop; not executed';

/** The frame provider of a source; null for no source. */
export const frameProvider = (source: ScreenSource): FrameProvider | null => ROUTES[source]?.frames ?? null;

/**
 * How a step runs on `source`. A dry run on captured frames needs no bridge; real input on the
 * local screen goes to the desktop bridge; the main-app mirror sends run_script. Null for no source.
 */
export function stepPlan(source: ScreenSource, { dryRun, bridgeUrl }: { dryRun: boolean; bridgeUrl: string }): StepPlan | null {
  const route = source === 'demo' && !dryRun && bridgeUrl ? DEMO_ON_BRIDGE : ROUTES[source];
  if (!route) return null;
  return { ...route, needsBridge: route.frames === 'bridge' || (!dryRun && route.input === 'desktop-bridge') };
}

/** What the HUD shows about the active capture. */
export interface CaptureStatus {
  source: ScreenSource;
  /** The capture in words, e.g. "Electron screen capture". */
  label: string;
  /** Replay and drift can verify on this source right now. */
  armed: boolean;
  /** Frames and input route when armed, otherwise why not. */
  detail: string;
}

/** What the HUD needs to know about the engine's capture right now. */
export interface CaptureFacts {
  source: ScreenSource;
  /** The local capture's kind while sharing the screen. */
  kind?: ScreenCapture['kind'];
  /** A live frame has been captured from this source. */
  hasFrame: boolean;
  bridgeUrl: string;
  mainConnected: boolean;
}

const SOURCE_LABEL: Record<ScreenSource, string> = { none: 'No capture', demo: 'Demo desktop', screen: 'Screen capture', bridge: 'Desktop bridge', 'main-app': 'Main app mirror' };
const KIND_LABEL: Record<ScreenCapture['kind'], string> = { native: 'Electron screen capture', 'display-media': 'Browser screen share' };
const FRAMES_TEXT: Record<FrameProvider, string> = { captured: 'own captured frames', bridge: 'bridge screenshots', demo: 'demo canvas' };
const INPUT_TEXT: Record<InputRoute, string> = { 'desktop-bridge': 'desktop bridge', 'main-app': 'main app run_script', demo: 'demo desktop' };

/** The capture in words: the local capture's kind for a shared screen, else the source. */
export const captureLabel = (source: ScreenSource, kind?: ScreenCapture['kind']) => (source === 'screen' && kind ? KIND_LABEL[kind] : SOURCE_LABEL[source]);

/** Why replay/drift cannot verify on the source yet; null when they can. */
function notArmed(route: Route | null, { source, hasFrame, bridgeUrl, mainConnected }: CaptureFacts): string | null {
  if (!route) return 'no capture source';
  if (source === 'main-app' && !mainConnected) return 'main app not connected';
  if (route.frames === 'captured' && !hasFrame) return 'waiting for the first captured frame';
  if (route.frames === 'bridge' && !bridgeUrl) return 'no desktop bridge URL';
  return null;
}

/** The active capture, whether replay/drift are armed for it and on what. */
export function captureStatus(facts: CaptureFacts): CaptureStatus {
  const route = ROUTES[facts.source];
  const reason = notArmed(route, facts);
  const label = captureLabel(facts.source, facts.kind);
  if (reason || !route) return { source: facts.source, label, armed: false, detail: `Replay/drift not armed — ${reason}` };
  return { source: facts.source, label, armed: true, detail: `Replay/drift armed — frames: ${FRAMES_TEXT[route.frames]}, input: ${INPUT_TEXT[route.input]}` };
}
