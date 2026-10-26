import type { StageMap } from './loop-control.js';
import type { AiView } from './ai.js';

/** What the stage shows: nothing yet, the explicit demo desktop, a shared screen, or the PC via the bridge. */
export type ScreenSource = 'none' | 'demo' | 'screen' | 'bridge';

/** A captured screen frame: a display image plus a downsampled pixel buffer for drift math. */
export interface Frame {
  id: number;
  time: number;
  /** JPEG data URL for display, 480x270: the sample space the UI, bridge and drift math use. */
  url: string;
  /** The highest-resolution JPEG data URL of the capture, drawn into the AI view and zoomed crops; absent means `url` is the best there is. Never persisted. */
  full?: string;
  /** 320x180 pixel buffer used for Euclidean comparisons. */
  data: ImageData;
  /** Source resolution of the captured screen (for converting to native coordinates). */
  srcW: number;
  srcH: number;
  /** Where the frame came from: the demo canvas, a shared screen, or a real desktop screenshot from the bridge. */
  source: 'demo' | 'screen' | 'desktop';
}

/** One point of the mouse trail, normalized to 0..1 of the screen. */
export interface TrailPoint {
  x: number;
  y: number;
  t: number;
  click?: boolean;
}

/**
 * Actions a workflow step can perform. `move` hovers the cursor over its target without clicking;
 * `drag` presses at (x, y), travels to (endX, endY) and releases there; `measure` only measures
 * distances (no input).
 */
export type StepAction = 'click' | 'double_click' | 'move' | 'drag' | 'scroll' | 'type' | 'key' | 'open_app' | 'wait' | 'search' | 'calc' | 'media' | 'measure';

/** Every step action, in the order the planner contract lists them. */
export const STEP_ACTIONS: readonly StepAction[] = ['click', 'double_click', 'move', 'drag', 'scroll', 'type', 'key', 'open_app', 'wait', 'search', 'calc', 'media', 'measure'];

/** Step actions that point the mouse at an on-screen target, so their coordinates must be grounded. */
export const POINTER_ACTIONS: ReadonlySet<StepAction> = new Set<StepAction>(['click', 'double_click', 'move', 'drag', 'scroll']);

/** Monitor modes, each with its own capture interval. */
export type MonitorMode = 'app' | 'background' | 'advanced';

/** Real mouse/keyboard actions recorded in the persistent action history. */
export type InputAction = 'move' | 'click' | 'double_click' | 'drag' | 'type' | 'key' | 'scroll';

/** One executed mouse or keyboard action, persisted for viewing and export. */
export interface ActionRecord {
  id: string;
  time: number;
  action: InputAction;
  /** Native screen pixels the action targeted (a drag's start). */
  x: number;
  y: number;
  /** A drag's release point, in native screen pixels. */
  endX?: number;
  endY?: number;
  text?: string;
  /** Who performed it: Replay, Auto-Actor, AI help, ... */
  source: string;
  /** Where it was dispatched: the desktop bridge or the demo desktop. */
  via: 'bridge' | 'demo';
  ok: boolean;
  message: string;
}

/** A lesson learned from a run: something to avoid or to add when planning similar goals. */
export interface LearnedPattern {
  id: string;
  kind: 'avoid' | 'add';
  pattern: string;
  /** The goal or situation the lesson applies to. */
  context: string;
  time: number;
}

/** An on-screen element the assistant has verified or used, remembered across sessions. */
export interface FamiliarElement {
  id: string;
  name: string;
  /** Normalized 0..1 center of the element. */
  x: number;
  y: number;
  /** Small JPEG data URL of the screen around the element. */
  patch?: string;
  /** When it was last verified or used (ms since epoch). */
  lastSeen: number;
  /** Times the coordinate learner observed it (dwell or verified action). */
  timesSeen?: number;
  /** Id of the frame it was last seen on. */
  frameId?: number;
  /** Row-major luminance patch (ANCHOR_PATCH²) of the drift buffer around the point, for re-locating it. */
  anchor?: number[];
}

/** A lesson attached to one habit: something to avoid or add when acting on that target. */
export interface HabitLesson {
  kind: LearnedPattern['kind'];
  text: string;
  time: number;
}

/** Where a habit's target was last confirmed: the point and a luminance patch of the drift buffer around it. */
export interface HabitAnchor {
  x: number;
  y: number;
  /** Row-major luminance values (0..255) of a square patch centred on the point. */
  patch: number[];
  size: number;
  time: number;
}

/** Learned outcomes of acting on one target in one app/window context. */
export interface Habit {
  id: string;
  /** The target/element name as the steps name it. */
  target: string;
  /** The app/window the assistant was attached to (empty when none). */
  context: string;
  attempts: number;
  successes: number;
  /** Last-known-good coordinates, when a verification confirmed them. */
  anchor?: HabitAnchor;
  lastUsed: number;
  lessons: HabitLesson[];
  /** Pinned habits are never pruned. */
  pinned: boolean;
}

/** Status of a step during replay. */
export type StepStatus = 'pending' | 'running' | 'done' | 'drift' | 'failed';

/** One recorded or generated workflow step. Coordinates are normalized 0..1. */
export interface WorkflowStep {
  id: string;
  name: string;
  action: StepAction;
  x: number;
  y: number;
  text?: string;
  /** The on-screen thing a pointer step acts on ("files icon"); its coordinates are confirmed against it before dispatch. */
  target?: string;
  /** Set when the planner gave no point for this pointer step's target (it ran at a default). */
  unlocated?: boolean;
  /** A drag's release point, normalized 0..1 like x/y. Required for a drag step. */
  endX?: number;
  endY?: number;
  /** The on-screen thing a drag drops onto ("Archive folder"). */
  endTarget?: string;
  /** Screenshot captured when the step was recorded — the template for drift matching. */
  refFrame?: Frame;
  status: StepStatus;
  /** Drift-corrected position from the last replay. */
  correctedX?: number;
  correctedY?: number;
  /** Last measured drift distance (0..1). */
  drift?: number;
  /** Last measured drift in native screen pixels. */
  driftPx?: number;
  /** Screenshot of the real desktop taken right after this step was executed. */
  shot?: Frame;
  /** Visual evidence from the last execution: screenshots just before and just after the action. */
  beforeFrame?: Frame;
  afterFrame?: Frame;
}

/** Alignment between the live screen and the active step. */
export type SyncLevel = 'green' | 'yellow' | 'red' | 'idle';

/** A box the AI draws on the screen to point something out. Normalized 0..1. */
export interface Annotation {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  tone: 'info' | 'warn' | 'error';
  /** Suggested click point inside the box, when the AI has one. */
  actX?: number;
  actY?: number;
}

/** A line in the activity log. */
export interface LogEntry {
  id: string;
  time: number;
  source: string;
  message: string;
  tone: 'info' | 'ok' | 'warn' | 'error';
  /** Screenshot evidence (data URLs), e.g. a moved element before and after; never persisted. */
  shots?: string[];
}

/** A saved, named workflow card for later comparison and selection. */
export interface SavedCard {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  savedAt: number;
}

/** User-tunable settings for capture, drift and automation. */
export interface AssistSettings {
  /** Frames kept in the comparison gallery. */
  gallerySize: number;
  /** Drift checkpoints sampled per cursor move, start to finish. */
  checkpoints: number;
  /** Capture interval of the "app" monitor mode; background and advanced modes use fixed intervals. */
  captureMs: number;
  /** Size (cells of the 16x9 diff grid) the largest changed cluster must reach to count as a material screen change. */
  changeCells: number;
  monitorMode: MonitorMode;
  /** How often the Screen watcher observes the live frame, in ms. */
  watchMs: number;
  autoAct: boolean;
  aiHelp: boolean;
  showTrail: boolean;
  /** Draw the labeled spatial grid (A1..H12) over the live preview. */
  showGrid: boolean;
  /** Base URL of the Droid desktop bridge (pyautogui replay endpoint). */
  bridgeUrl: string;
  /** Emergency-stop key combo, e.g. "Shift+Escape". */
  abortHotkey: string;
  /** Max real (bridge-dispatched) input actions per Auto Act / replay run. */
  actionBudget: number;
  /** Ollama-compatible /api/chat URL every AI feature calls. */
  aiUrl: string;
  /** Model name sent with every AI request. */
  aiModel: string;
  /** Pixel size every screenshot is rendered at for the model (the sample space stays 480x270). */
  aiView: AiView;
  /** After a replay, verify the goal on the live screen and keep planning/running until it is done. */
  autoContinue: boolean;
  /** Max auto-continue rounds (verify → re-plan → run) after the first run. */
  maxIterations: number;
  /** Loop control: on/off per automation stage and agent (guardrails are never in it). */
  stages: StageMap;
  /** Error forwarding: the error-fix app's HTTP endpoint captured errors are POSTed to. */
  errorUrl: string;
  /** Whether captured errors are forwarded automatically. */
  errorForwarding: boolean;
  /** Optional bearer token for the error endpoint; never written to the activity log. */
  errorToken: string;
}
