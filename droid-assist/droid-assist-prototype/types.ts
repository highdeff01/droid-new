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

/** Actions a workflow step can perform. */
export type StepAction = 'click' | 'type' | 'key' | 'open_app' | 'wait' | 'search' | 'calc' | 'media';

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
  captureMs: number;
  autoAct: boolean;
  aiHelp: boolean;
  showTrail: boolean;
  /** Base URL of the Droid desktop bridge (pyautogui replay endpoint). */
  bridgeUrl: string;
}
