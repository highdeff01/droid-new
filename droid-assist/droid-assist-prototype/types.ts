import type { StageMap } from './loop-control.js';
import type { AiView } from './ai.js';
import type { OperationPolicy } from './approvals.js';
import type { TrainMode } from './element-training.js';
import type { SideTestMode } from './side-test.js';
import type { AutoApplyMap, SelfTestMode } from './initiative.js';
import type { AutoActMap } from './notifications.js';
import type { ExecutionMode } from './execution-mode.js';
import type { AutoApplyBounds } from './aggressive.js';
import type { PanelLayout } from './panel-layout.js';

/** What the stage shows: nothing yet, the explicit demo desktop, a shared screen, the PC via the bridge, or the main Droid app's preview. */
export type ScreenSource = 'none' | 'demo' | 'screen' | 'bridge' | 'main-app';

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
  /** Physical position of the captured display's top-left on the virtual desktop (multi-monitor); absent = 0,0. Input lands at origin + normalized × src size. */
  originX?: number;
  originY?: number;
  /** Where the frame came from: the demo canvas, a shared screen, a real desktop screenshot from the bridge, or the main Droid app's preview. */
  source: 'demo' | 'screen' | 'desktop' | 'main-app';
}

/** One point of the mouse trail, normalized to 0..1 of the screen. */
export interface TrailPoint {
  x: number;
  y: number;
  t: number;
  click?: boolean;
  /** A typing marker: the AI typed text at this point. */
  typed?: boolean;
}

/**
 * Actions a workflow step can perform. `move` hovers the cursor over its target without clicking;
 * `drag` presses at (x, y), travels to (endX, endY) and releases there; `measure` only measures
 * distances (no input).
 */
export type StepAction = 'click' | 'double_click' | 'move' | 'drag' | 'scroll' | 'type' | 'key' | 'open_app' | 'wait' | 'search' | 'calc' | 'media' | 'measure' | 'snip';

/** Every step action, in the order the planner contract lists them. */
export const STEP_ACTIONS: readonly StepAction[] = ['click', 'double_click', 'move', 'drag', 'scroll', 'type', 'key', 'open_app', 'wait', 'search', 'calc', 'media', 'measure', 'snip'];

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
  /** Native screen pixels the pointer rested at before this action (the previously-focused point), when known. */
  prevX?: number;
  prevY?: number;
  /** Native size of the screen the action ran on, for converting its pixels back to normalized coordinates. */
  srcW?: number;
  srcH?: number;
  /** The field's content before a `type` action, when known; reversal retypes it. */
  priorText?: string;
  /** Who performed it: Replay, Auto-Actor, AI help, ... */
  source: string;
  /** Where it ran: the desktop bridge, the main Droid app, or the demo desktop. */
  via: 'bridge' | 'main-app' | 'demo';
  ok: boolean;
  message: string;
  /** The bridge accepted the input but the step's effect was not confirmed on screen. */
  dispatched?: boolean;
  /** Nothing was dispatched to the PC or the main app: a disarmed verification or a demo simulation, labeled "dry run — not dispatched". */
  dryRun?: boolean;
  /** A dry run whose effect was simulated on the demo desktop (reversible there only). */
  simulated?: boolean;
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
  /** A `type` step's field content before typing, when known (lets the action be reversed exactly). */
  priorText?: string;
  /** A `key` step's press count (default 1), e.g. one backspace per character to erase. */
  repeat?: number;
  /** The on-screen thing a pointer step acts on ("files icon"); its coordinates are confirmed against it before dispatch. */
  target?: string;
  /** Set when the planner gave no point for this pointer step's target (it ran at a default). */
  unlocated?: boolean;
  /** A drag's release point, normalized 0..1 like x/y. Required for a drag step. */
  endX?: number;
  endY?: number;
  /** The on-screen thing a drag drops onto ("Archive folder"). */
  endTarget?: string;
  /** "Auto-navigate to element E then perform F": the element-map id the step re-aims at (its current position and perform) every time it runs. */
  mappedId?: string;
  /** Recorded human pause before this step (ms since the previous recorded input); replay sends it to the bridge. */
  delayMs?: number;
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
  /** When the step's action was verified complete on the live frame (screenshot verdict success); cleared when it runs again. */
  verifiedAt?: number;
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
  /** Project (trimmed goal text) the entry was logged under; absent when no goal was set. */
  project?: string;
  /** The operation (goal) the entry belongs to, tagged by the Logging agent for recall. */
  op?: string;
  /** How many identical entries in a row the Logging agent folded into this one (absent = 1). */
  repeat?: number;
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
  /** Worker agents in the coordinated crew (5–50, default 25). */
  crewSize: number;
  /** Frames kept in the comparison gallery. */
  gallerySize: number;
  /** Drift checkpoints sampled per cursor move, start to finish. */
  checkpoints: number;
  /** Capture interval of the "app" monitor mode; background and advanced modes use fixed intervals. */
  captureMs: number;
  /** Size (cells of the 16x9 diff grid) the largest changed cluster must reach to count as a material screen change. */
  changeCells: number;
  /** Drift: distance at the recorded spot up to which a target counts as unchanged (green). */
  driftStable: number;
  /** Drift: best-match distance up to which a moved target counts as found (yellow). */
  driftMatched: number;
  /** Drift: template search radius, in sample pixels of the 320x180 drift buffer. */
  driftRadius: number;
  monitorMode: MonitorMode;
  /** How the assistant paces and grounds its work (separate from the capture monitor mode). */
  executionMode: ExecutionMode;
  /** The user's limits on what aggressive mode applies without asking. */
  autoApply: AutoApplyBounds;
  /** Electron display id native capture takes screenshots from; null = the primary display. */
  displayId: string | null;
  /** How often the Screen watcher observes the live frame, in ms. */
  watchMs: number;
  /** Wake timer: how long a wait lasts before the AI is woken to continue (the AI may ask for longer), in ms. */
  wakeMs: number;
  autoAct: boolean;
  aiHelp: boolean;
  showTrail: boolean;
  /** Draw the labeled spatial grid (A1..H12) over the live preview. */
  showGrid: boolean;
  /** Label every grid cell (A1..H12); off draws only the edge column numbers / row letters. */
  gridLabels: boolean;
  /** Alpha of the grid lines, kept low so the captured frame always shows through. */
  gridOpacity: number;
  /** Base URL of the Droid desktop bridge (pyautogui replay endpoint). */
  bridgeUrl: string;
  /** Shared secret the bridge requires on every call (Authorization: Bearer); masked in the UI, never logged. */
  bridgeToken: string;
  /** Main app bridge: start automatically and connect the main Droid app. */
  mainBridgeEnabled: boolean;
  /** Main app bridge: wait for the main app to connect (listen) or dial out to `mainBridgeUrl` (dial). */
  mainBridgeMode: 'listen' | 'dial';
  /** Main app bridge: interface the listener binds (listen mode). */
  mainBridgeHost: string;
  /** Main app bridge: port the listener binds (listen mode). */
  mainBridgePort: number;
  /** Main app bridge: base URL of the main app (dial mode). */
  mainBridgeUrl: string;
  /** Main app bridge: optional shared secret, same Bearer pattern as `bridgeToken`; never logged. */
  mainBridgeToken: string;
  /** Main app bridge: first reconnect delay, doubled per failure. */
  mainBridgeBackoffMinMs: number;
  /** Main app bridge: longest reconnect delay. */
  mainBridgeBackoffMaxMs: number;
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
  /** Ask the model to think before answering; off by default because small models can spend the whole reply thinking. */
  aiThink: boolean;
  /** After a replay, verify the goal on the live screen and keep planning/running until it is done. */
  autoContinue: boolean;
  /** Armed bridge drags run as live parallel drags: segment by segment, corrected by the coordinate-agent swarm. */
  liveDrag: boolean;
  /** Max auto-continue rounds (verify → re-plan → run) after the first run. */
  maxIterations: number;
  /** Retries of a failed step (re-verify, re-correct, retry) before the planner re-plans it once. */
  stepRetries: number;
  /** Lifetime of a blocking blacklist rule, hours (structured avoid entries expire on their own). */
  avoidTtlHours: number;
  /** Retries of a detected recent operation's best variant, each verified by screenshot comparison (0 = off). */
  operationRetries: number;
  /** How far back a playback of the main app's actions reaches, in seconds (30 s .. 10 min). */
  playbackWindowSec: number;
  /** Cap on model calls in flight at once; further calls wait in the shared priority queue. */
  aiMaxInFlight: number;
  /** Per-request AI timeout in ms; queued calls get it when they start. Cancelling still aborts at once. */
  aiTimeoutMs: number;
  /** Goal tracer: failed steps / no-progress checks in a row that count as a stalled goal. */
  goalStall: number;
  /** Master Prompt Override: a free-text directive injected into every AI prompt; empty = none. */
  masterPrompt: string;
  /** Overlap mode: each AI ask also fires a second, freshly worded call; the first valid answer wins. */
  aiOverlap: boolean;
  /** Loop control: on/off per automation stage and agent (guardrails are never in it). */
  stages: StageMap;
  /** Error forwarding: the error-fix app's HTTP endpoint captured errors are POSTed to. */
  errorUrl: string;
  /** Whether captured errors are forwarded automatically. */
  errorForwarding: boolean;
  /** Optional bearer token for the error endpoint; never written to the activity log. */
  errorToken: string;
  /** User-set conditions for AI operation: allowed hours, allowed operation classes, project scope. */
  operationPolicy: OperationPolicy;
  /** Auto-map every identifiable element on each captured frame into the element map. */
  autoScan: boolean;
  /** Element training runs exclusively in the foreground (Auto Act pauses) or on its own background task. */
  trainMode: TrainMode;
  /** Where side tests primarily run: background (bridge, main capture kept) or foreground (capture switched to the target). */
  sideTestMode: SideTestMode;
  /** AI initiative: seconds between the AI's own screen scans (it may ask to scan sooner). */
  scanSec: number;
  /** AI initiative: self-tests verify-only in the background, or highlighted (real when armed) in the foreground. */
  selfTestMode: SelfTestMode;
  /** AI initiative: cycles per input kind the heavy element tester runs. */
  stressCycles: number;
  /** AI initiative: per category, apply without asking (still inside arm, budget and loop control). */
  initiativeAutoApply: AutoApplyMap;
  /** Relaxation mode: slower cadence, no background agent tests, dimmed info notifications, break reminders. */
  relaxMode: boolean;
  /** Minutes between "take a break" reminders while relaxation mode is on. */
  breakMinutes: number;
  /** Seconds between automatic System panel refreshes. */
  systemRefreshSec: number;
  /** Auto-act on notifications, per category; every category defaults off. */
  notifyAutoAct: AutoActMap;
  /** Folders (native paths) the System panel reports file specs for. */
  systemFolders: string[];
  /** User arrangement of the workspace panels, per area; validated on load so no panel is ever lost. */
  panelLayout: PanelLayout;
}
