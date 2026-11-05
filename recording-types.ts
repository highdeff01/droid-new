/**
 * Recording System Type Definitions
 *
 * Defines the complete type model for recording user actions, including normalized
 * coordinates, element context, and metadata tracking. This is the foundation for
 * the Recording System subsystem.
 *
 * Coordinates are normalized to [0, 1] range where (0, 0) is top-left and (1, 1)
 * is bottom-right, making recordings independent of display size and resolution.
 */

/**
 * Context information about the DOM element being targeted by an action.
 *
 * Provides multiple ways to identify and locate an element:
 * - selector: CSS selector for programmatic targeting
 * - domPath: DOM tree path for precise location (e.g., "html > body > div > button")
 * - accessibleName: aria-label, aria-labelledby, or semantic text for accessibility
 * - elementId: Unique identifier (data-id, aria-id, or generated)
 */
export interface ActionContext {
  /** CSS selector for targeting the element (e.g., ".button-primary", "#submit-btn") */
  selector?: string;

  /** DOM path from root to element (e.g., "html > body > main > div.container > button") */
  domPath?: string;

  /** Accessible name from aria-label, aria-labelledby, or semantic text */
  accessibleName?: string;

  /** Unique element identifier (data-id, aria-id, or UUID) */
  elementId?: string;
}

/**
 * Click action — mouse button press at normalized coordinates.
 *
 * Captures single, double, and triple clicks with button specification.
 * All coordinates are normalized to [0, 1] range.
 */
export interface ClickAction {
  /** Action type discriminator */
  type: 'click';

  /** ISO 8601 timestamp of the action */
  timestamp: string;

  /** Normalized X coordinate [0, 1] where 0 is left, 1 is right */
  x: number;

  /** Normalized Y coordinate [0, 1] where 0 is top, 1 is bottom */
  y: number;

  /** Mouse button pressed: 'left', 'right', or 'middle' */
  button: 'left' | 'right' | 'middle';

  /** Click count: 1 for single click, 2 for double click, 3 for triple click */
  clickCount: 1 | 2 | 3;

  /** Optional context about the element being clicked */
  context?: ActionContext;
}

/**
 * Keyboard action — key press or key combination.
 *
 * Supports both key combinations (e.g., ['Control', 'c']) and text input.
 * Keys follow the keyboard event API naming (e.g., 'Enter', 'Shift', 'ArrowUp').
 */
export interface KeyboardAction {
  /** Action type discriminator */
  type: 'keyboard';

  /** ISO 8601 timestamp of the action */
  timestamp: string;

  /** Array of key names in order pressed (e.g., ['Control', 'c'], ['Enter']) */
  keys: string[];

  /** Text input (alternative to keys, for character input like typing) */
  text?: string;

  /** Optional context about the element being typed into */
  context?: ActionContext;
}

/**
 * Drag action — mouse movement from start to end coordinates.
 *
 * Captures the dragging gesture with optional duration measurement.
 * All coordinates are normalized to [0, 1] range.
 */
export interface DragAction {
  /** Action type discriminator */
  type: 'drag';

  /** ISO 8601 timestamp of the action start */
  timestamp: string;

  /** Normalized X coordinate [0, 1] where drag starts */
  startX: number;

  /** Normalized Y coordinate [0, 1] where drag starts */
  startY: number;

  /** Normalized X coordinate [0, 1] where drag ends */
  endX: number;

  /** Normalized Y coordinate [0, 1] where drag ends */
  endY: number;

  /** Duration of drag in milliseconds (optional) */
  duration?: number;

  /** Optional context about the element being dragged */
  context?: ActionContext;
}

/**
 * Scroll action — mouse wheel or scroll gesture.
 *
 * Captures scrolling at a reference point with delta offsets.
 * All coordinates are normalized to [0, 1] range.
 */
export interface ScrollAction {
  /** Action type discriminator */
  type: 'scroll';

  /** ISO 8601 timestamp of the action */
  timestamp: string;

  /** Normalized X coordinate [0, 1] of reference point for scroll */
  x: number;

  /** Normalized Y coordinate [0, 1] of reference point for scroll */
  y: number;

  /** Horizontal scroll delta (negative = left, positive = right) */
  deltaX?: number;

  /** Vertical scroll delta (negative = up, positive = down) */
  deltaY?: number;

  /** Optional context about the element being scrolled */
  context?: ActionContext;
}

/**
 * Pause action — recording pause or delay.
 *
 * Represents a period of inactivity between actions, useful for:
 * - Recording natural pauses in user interaction
 * - Replaying with realistic timing
 * - Marking "think time" or waiting periods
 */
export interface PauseAction {
  /** Action type discriminator */
  type: 'pause';

  /** ISO 8601 timestamp of the pause start */
  timestamp: string;

  /** Duration of pause in milliseconds */
  duration: number;
}

/**
 * Discriminated union of all possible recording action types.
 *
 * Each action has a 'type' field that serves as the discriminator,
 * allowing type-safe pattern matching on action.type.
 */
export type RecordingAction = ClickAction | KeyboardAction | DragAction | ScrollAction | PauseAction;

/**
 * Action count statistics for a recording.
 *
 * Tracks the number of each action type for quick analytics and UI display.
 */
export interface ActionCounts {
  /** Number of click actions */
  clicks: number;

  /** Number of keyboard actions */
  keyboard: number;

  /** Number of drag actions */
  drags: number;

  /** Number of scroll actions */
  scrolls: number;

  /** Number of pause actions */
  pauses: number;
}

/**
 * Metadata about a recording session.
 *
 * Tracks when the recording was made, its source, performance metrics,
 * and semantic tags for organization.
 */
export interface RecordingMetadata {
  /** ISO 8601 timestamp when recording was created */
  createdAt: string;

  /** ISO 8601 timestamp when recording was last updated */
  updatedAt: string;

  /** Total duration of recording in milliseconds (sum of all action timestamps + last pause) */
  duration: number;

  /** Count of each action type in the recording */
  actionCounts: ActionCounts;

  /** Number of unique element contexts referenced in the recording */
  elementContexts: number;

  /** Source of the recording: user capture, AI generation, or imported */
  source: 'user-capture' | 'ai-generation' | 'import';

  /** Optional tags for categorization and filtering */
  tags?: string[];

  /** Semantic version of the recording format (e.g., '1.0.0') */
  version: string;
}

/**
 * A Recording — ordered collection of actions with metadata.
 *
 * Represents a complete recorded session of user interactions. Recordings are:
 * - Ordered: actions maintain their sequence
 * - Complete: includes all metadata for playback and analysis
 * - Serializable: can be persisted and shared as JSON
 * - Normalized: uses [0, 1] coordinates independent of display resolution
 */
export interface Recording {
  /** Unique identifier for the recording (UUID or nanoid) */
  id: string;

  /** Human-readable name for the recording */
  name: string;

  /** Optional detailed description of what the recording captures */
  description?: string;

  /** Ordered array of recording actions */
  actions: RecordingAction[];

  /** Metadata about the recording session */
  metadata: RecordingMetadata;
}

/**
 * Helper function to create a new ActionContext.
 *
 * @param selector - CSS selector for the element
 * @param domPath - DOM tree path for the element
 * @param accessibleName - Accessible name (aria-label, etc.)
 * @param elementId - Unique identifier for the element
 * @returns ActionContext object
 */
export function createActionContext(
  selector?: string,
  domPath?: string,
  accessibleName?: string,
  elementId?: string,
): ActionContext {
  return { selector, domPath, accessibleName, elementId };
}

/**
 * Helper function to create a new ClickAction.
 *
 * @param timestamp - ISO 8601 timestamp
 * @param x - Normalized X coordinate [0, 1]
 * @param y - Normalized Y coordinate [0, 1]
 * @param button - Mouse button ('left', 'right', 'middle')
 * @param clickCount - Click count (1, 2, or 3)
 * @param context - Optional ActionContext
 * @returns ClickAction object
 */
export function createClickAction(
  timestamp: string,
  x: number,
  y: number,
  button: 'left' | 'right' | 'middle' = 'left',
  clickCount: 1 | 2 | 3 = 1,
  context?: ActionContext,
): ClickAction {
  return { type: 'click', timestamp, x, y, button, clickCount, context };
}

/**
 * Helper function to create a new KeyboardAction.
 *
 * @param timestamp - ISO 8601 timestamp
 * @param keys - Array of key names
 * @param text - Optional text input
 * @param context - Optional ActionContext
 * @returns KeyboardAction object
 */
export function createKeyboardAction(
  timestamp: string,
  keys: string[],
  text?: string,
  context?: ActionContext,
): KeyboardAction {
  return { type: 'keyboard', timestamp, keys, text, context };
}

/**
 * Helper function to create a new DragAction.
 *
 * @param timestamp - ISO 8601 timestamp
 * @param startX - Normalized start X coordinate [0, 1]
 * @param startY - Normalized start Y coordinate [0, 1]
 * @param endX - Normalized end X coordinate [0, 1]
 * @param endY - Normalized end Y coordinate [0, 1]
 * @param duration - Optional duration in milliseconds
 * @param context - Optional ActionContext
 * @returns DragAction object
 */
export function createDragAction(
  timestamp: string,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  duration?: number,
  context?: ActionContext,
): DragAction {
  return { type: 'drag', timestamp, startX, startY, endX, endY, duration, context };
}

/**
 * Helper function to create a new ScrollAction.
 *
 * @param timestamp - ISO 8601 timestamp
 * @param x - Normalized X coordinate [0, 1] of scroll reference point
 * @param y - Normalized Y coordinate [0, 1] of scroll reference point
 * @param deltaX - Optional horizontal scroll delta
 * @param deltaY - Optional vertical scroll delta
 * @param context - Optional ActionContext
 * @returns ScrollAction object
 */
export function createScrollAction(
  timestamp: string,
  x: number,
  y: number,
  deltaX?: number,
  deltaY?: number,
  context?: ActionContext,
): ScrollAction {
  return { type: 'scroll', timestamp, x, y, deltaX, deltaY, context };
}

/**
 * Helper function to create a new PauseAction.
 *
 * @param timestamp - ISO 8601 timestamp
 * @param duration - Duration in milliseconds
 * @returns PauseAction object
 */
export function createPauseAction(timestamp: string, duration: number): PauseAction {
  return { type: 'pause', timestamp, duration };
}

/**
 * Validates that a coordinate is within the normalized range [0, 1].
 *
 * @param value - Coordinate value to validate
 * @param name - Name of the coordinate for error messages
 * @throws Error if coordinate is outside [0, 1] range or is NaN/Infinity
 */
export function validateNormalizedCoordinate(value: number, name: string = 'coordinate'): void {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Invalid ${name}: must be a number in [0, 1], got ${value}`);
  }
}

/**
 * Validates that all coordinates in an action are normalized to [0, 1].
 *
 * @param action - Recording action to validate
 * @throws Error if any coordinates are out of bounds
 */
export function validateAction(action: RecordingAction): void {
  switch (action.type) {
    case 'click':
      validateNormalizedCoordinate(action.x, 'ClickAction.x');
      validateNormalizedCoordinate(action.y, 'ClickAction.y');
      break;

    case 'drag':
      validateNormalizedCoordinate(action.startX, 'DragAction.startX');
      validateNormalizedCoordinate(action.startY, 'DragAction.startY');
      validateNormalizedCoordinate(action.endX, 'DragAction.endX');
      validateNormalizedCoordinate(action.endY, 'DragAction.endY');
      break;

    case 'scroll':
      validateNormalizedCoordinate(action.x, 'ScrollAction.x');
      validateNormalizedCoordinate(action.y, 'ScrollAction.y');
      break;

    case 'keyboard':
    case 'pause':
      // No coordinate validation needed
      break;

    default:
      // Exhaustive check
      const _: never = action;
      return _;
  }
}

/**
 * Validates that timestamps are in ISO 8601 format.
 *
 * @param timestamp - Timestamp string to validate
 * @throws Error if timestamp is not valid ISO 8601
 */
export function validateTimestamp(timestamp: string): void {
  // ISO 8601 format check: YYYY-MM-DDTHH:mm:ss.sssZ or similar
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z?$/.test(timestamp)) {
    throw new Error(`Invalid timestamp: "${timestamp}" must be ISO 8601 format`);
  }
}

/**
 * Calculates total duration from a set of actions.
 *
 * Duration is calculated from the first action's timestamp to the last action's timestamp.
 * For pause actions, adds their duration to the total.
 *
 * @param actions - Array of recording actions
 * @returns Total duration in milliseconds
 */
export function calculateDuration(actions: RecordingAction[]): number {
  if (actions.length === 0) return 0;

  const timestamps = actions.map((a) => new Date(a.timestamp).getTime());
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);

  // Base duration from first to last action
  let totalDuration = maxTime - minTime;

  // Add pause durations
  for (const action of actions) {
    if (action.type === 'pause') {
      totalDuration += action.duration;
    }
  }

  return Math.round(totalDuration);
}

/**
 * Counts actions by type in a recording.
 *
 * @param actions - Array of recording actions
 * @returns ActionCounts object with counts of each type
 */
export function countActions(actions: RecordingAction[]): ActionCounts {
  const counts: ActionCounts = {
    clicks: 0,
    keyboard: 0,
    drags: 0,
    scrolls: 0,
    pauses: 0,
  };

  for (const action of actions) {
    switch (action.type) {
      case 'click':
        counts.clicks++;
        break;
      case 'keyboard':
        counts.keyboard++;
        break;
      case 'drag':
        counts.drags++;
        break;
      case 'scroll':
        counts.scrolls++;
        break;
      case 'pause':
        counts.pauses++;
        break;
    }
  }

  return counts;
}

/**
 * Counts unique element contexts in a recording.
 *
 * @param actions - Array of recording actions
 * @returns Number of unique element contexts
 */
export function countElementContexts(actions: RecordingAction[]): number {
  const contexts = new Set<string>();

  for (const action of actions) {
    if ('context' in action && action.context) {
      // Create a unique key for each context
      const key = JSON.stringify(action.context);
      contexts.add(key);
    }
  }

  return contexts.size;
}

/**
 * Helper function to create complete Recording metadata.
 *
 * @param actions - Array of recording actions
 * @param source - Source of the recording
 * @param tags - Optional tags for categorization
 * @param version - Recording format version (default: "1.0.0")
 * @returns RecordingMetadata object
 */
export function createRecordingMetadata(
  actions: RecordingAction[],
  source: 'user-capture' | 'ai-generation' | 'import' = 'user-capture',
  tags?: string[],
  version: string = '1.0.0',
): RecordingMetadata {
  const now = new Date().toISOString();

  return {
    createdAt: now,
    updatedAt: now,
    duration: calculateDuration(actions),
    actionCounts: countActions(actions),
    elementContexts: countElementContexts(actions),
    source,
    tags,
    version,
  };
}

/**
 * Helper function to create a complete Recording object.
 *
 * @param id - Unique identifier for the recording
 * @param name - Human-readable name
 * @param actions - Ordered array of actions
 * @param source - Source of the recording
 * @param description - Optional description
 * @param tags - Optional tags
 * @returns Recording object
 */
export function createRecording(
  id: string,
  name: string,
  actions: RecordingAction[],
  source: 'user-capture' | 'ai-generation' | 'import' = 'user-capture',
  description?: string,
  tags?: string[],
): Recording {
  return {
    id,
    name,
    description,
    actions,
    metadata: createRecordingMetadata(actions, source, tags),
  };
}
