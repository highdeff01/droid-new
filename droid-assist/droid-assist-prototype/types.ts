/** What the stage shows: nothing yet, the explicit demo desktop, a shared screen, or the PC via the bridge. */
export type ScreenSource = 'none' | 'demo' | 'screen' | 'bridge';

/** A captured screen frame: a display image plus a downsampled pixel buffer for drift math. */
export interface Frame {
  id: number;
  time: number;
  /** JPEG data URL for display. */
  url: string;
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

/** Actions a workflow step can perform. `move` hovers the cursor over its target without clicking. */
export type StepAction = 'click' | 'double_click' | 'move' | 'scroll' | 'type' | 'key' | 'open_app' | 'wait' | 'search' | 'calc' | 'media';

/** Every step action, in the order the planner contract lists them. */
export const STEP_ACTIONS: readonly StepAction[] = ['click', 'double_click', 'move', 'scroll', 'type', 'key', 'open_app', 'wait', 'search', 'calc', 'media'];

/** Step actions that point the mouse at an on-screen target, so their coordinates must be grounded. */
export const POINTER_ACTIONS: ReadonlySet<StepAction> = new Set<StepAction>(['click', 'double_click', 'move', 'scroll']);

/** Monitor modes, each with its own capture interval. */
export type MonitorMode = 'app' | 'background' | 'advanced';

/** Real mouse/keyboard actions recorded in the persistent action history. */
export type InputAction = 'move' | 'click' | 'double_click' | 'type' | 'key' | 'scroll';

/** One executed mouse or keyboard action, persisted for viewing and export. */
export interface ActionRecord {
  id: string;
  time: number;
  action: InputAction;
  /** Native screen pixels the action targeted. */
  x: number;
  y: number;
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
  monitorMode: MonitorMode;
  autoAct: boolean;
  aiHelp: boolean;
  showTrail: boolean;
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
  /** After a replay, verify the goal on the live screen and keep planning/running until it is done. */
  autoContinue: boolean;
  /** Max auto-continue rounds (verify → re-plan → run) after the first run. */
  maxIterations: number;
}
