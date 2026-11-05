/**
 * Screen Context Snapshot Collection
 *
 * This module captures and manages screen context snapshots that record the display state,
 * visible elements, accessibility information, and metadata at recording time for accurate
 * playback and coordinate adaptation across different display configurations.
 *
 * Key concepts:
 * - DisplayState: Screen resolution, DPI, and multi-display information
 * - ElementSnapshot: Individual element with selector, path, role, a11y info, normalized bbox
 * - ScreenContextSnapshot: Complete context at a point in time (display + elements + metadata)
 * - ContextCollector: Platform-specific interface for gathering context
 * - RecordingContextManager: Manages snapshot lifecycle with indexing and retrieval
 */

/**
 * Display state information captured at the time of recording.
 *
 * Stores screen resolution, DPI, and multi-display configuration details.
 * This allows coordinate translation and adaptation when replaying on different displays.
 */
export interface DisplayState {
  /** Screen width in pixels */
  width: number;

  /** Screen height in pixels */
  height: number;

  /** Dots per inch (DPI) of the display */
  dpi: number;

  /** Whether this is a multi-display setup */
  multiDisplay: boolean;

  /** Index of the display this snapshot was taken from (0-based) */
  displayIndex: number;

  /** Optional: physical width in millimeters for calculation purposes */
  physicalWidth?: number;

  /** Optional: physical height in millimeters for calculation purposes */
  physicalHeight?: number;
}

/**
 * Bounding box with normalized coordinates.
 *
 * All coordinates are normalized to [0, 1] range where:
 * - (0, 0) is top-left
 * - (1, 1) is bottom-right
 *
 * This normalization allows bounding boxes to be independent of display resolution.
 */
export interface NormalizedBoundingBox {
  /** Normalized left edge coordinate [0, 1] */
  x: number;

  /** Normalized top edge coordinate [0, 1] */
  y: number;

  /** Normalized width [0, 1] */
  width: number;

  /** Normalized height [0, 1] */
  height: number;
}

/**
 * Snapshot of a single DOM element captured at a point in time.
 *
 * Provides multiple ways to identify and reference an element:
 * - selector: CSS selector for programmatic targeting
 * - domPath: DOM hierarchy path for precise location
 * - role: ARIA role for semantic meaning
 * - accessibleName: a11y label from aria-label, aria-labelledby, or text content
 * - bounding box: normalized coordinates for visual reference
 *
 * This multi-faceted identification enables robust element matching during playback
 * even if the DOM structure changes slightly.
 */
export interface ElementSnapshot {
  /** Unique identifier for this element */
  id: string;

  /** CSS selector for the element (e.g., ".button-primary", "#submit-btn") */
  selector: string;

  /** DOM path from root to element (e.g., "html > body > main > div.container > button") */
  domPath: string[];

  /** ARIA role of the element (e.g., "button", "textbox", "navigation") */
  role: string;

  /** Accessible name from aria-label, aria-labelledby, or semantic text content */
  accessibleName: string;

  /** Normalized bounding box [0, 1] coordinates */
  boundingBox: NormalizedBoundingBox;

  /** Whether the element is currently visible in the viewport */
  visible: boolean;

  /** Whether the element is enabled/interactive */
  enabled: boolean;

  /** Optional: semantic tag name (e.g., "BUTTON", "INPUT", "DIV") */
  tagName?: string;

  /** Optional: element class names */
  className?: string;

  /** Optional: element data-* attributes for custom identification */
  dataAttributes?: Record<string, string>;

  /** Optional: element aria-* attributes for accessibility */
  ariaAttributes?: Record<string, string>;
}

/**
 * Complete screen context snapshot captured at a specific point in time.
 *
 * This is the primary data structure for recording screen state. It includes:
 * - Display information (resolution, DPI, multi-display state)
 * - List of visible elements with their positions and attributes
 * - Action index and timestamp for indexing and retrieval
 * - Context metadata for analysis and debugging
 *
 * Snapshots are typically captured at regular intervals during recording and indexed
 * by action number for easy retrieval during playback.
 */
export interface ScreenContextSnapshot {
  /** Index of the action this snapshot is associated with */
  actionIndex: number;

  /** ISO 8601 timestamp when snapshot was captured */
  timestamp: string;

  /** Display state at time of capture */
  displayState: DisplayState;

  /** Array of visible element snapshots */
  elements: ElementSnapshot[];

  /** Optional: active window title */
  windowTitle?: string;

  /** Optional: active application name */
  applicationName?: string;

  /** Optional: URL if recording a web application */
  url?: string;

  /** Optional: element lookup map for quick access by selector */
  elementsBySelector?: Map<string, ElementSnapshot>;

  /** Optional: element lookup map by DOM path string */
  elementsByPath?: Map<string, ElementSnapshot>;

  /** Optional: custom metadata for context-specific information */
  metadata?: Record<string, unknown>;
}

/**
 * Statistics about stored snapshots for memory management and debugging.
 *
 * Provides insights into memory usage and snapshot distribution over the recording.
 */
export interface SnapshotStatistics {
  /** Total number of snapshots stored */
  totalSnapshots: number;

  /** Number of active snapshots (not pruned) */
  activeSnapshots: number;

  /** Approximate memory used by snapshots in bytes */
  estimatedMemoryBytes: number;

  /** Time range from first to last snapshot */
  timeRange: {
    first: string;
    last: string;
  };

  /** Action index range */
  actionRange: {
    first: number;
    last: number;
  };

  /** Average elements per snapshot */
  avgElementsPerSnapshot: number;
}

/**
 * Interface for platform-specific context gathering.
 *
 * Implementations of this interface handle the platform-specific work of:
 * - Querying display information (resolution, DPI, multi-display)
 * - Enumerating visible DOM elements
 * - Extracting element positions and attributes
 * - Getting window and application information
 *
 * This abstraction allows ContextCollector to be implemented differently
 * for web browsers, Electron, mobile platforms, etc.
 */
export interface ContextCollector {
  /**
   * Collect the current display state.
   *
   * @returns Display state information
   */
  collectDisplayState(): DisplayState;

  /**
   * Collect all visible element snapshots from the current DOM.
   *
   * @returns Array of element snapshots
   */
  collectElements(): ElementSnapshot[];

  /**
   * Collect window and application context information.
   *
   * @returns Object with windowTitle, applicationName, url, etc.
   */
  collectWindowContext(): {
    windowTitle?: string;
    applicationName?: string;
    url?: string;
  };

  /**
   * Get a unique identifier for the current window/application context.
   *
   * This is useful for filtering snapshots to a specific application session.
   *
   * @returns Context identifier
   */
  getContextId(): string;
}

/**
 * Recording Context Manager
 *
 * Manages the lifecycle of screen context snapshots during recording and playback.
 * Provides:
 * - Snapshot capture and storage with action index association
 * - Efficient lookup by action index or timestamp
 * - Range queries for multi-step playback
 * - Pruning of old snapshots for memory management
 * - Statistics and debugging information
 *
 * The manager maintains snapshots in chronological order indexed by action,
 * allowing O(1) or O(log n) retrieval during playback.
 */
export class RecordingContextManager {
  /** Array of snapshots in action index order */
  private snapshots: ScreenContextSnapshot[] = [];

  /** Map from action index to snapshot for O(1) lookup */
  private indexMap: Map<number, ScreenContextSnapshot> = new Map();

  /** Map from timestamp to action index for time-based lookup */
  private timestampMap: Map<string, number> = new Map();

  /** Context collector for gathering platform-specific context */
  private collector: ContextCollector;

  /** Maximum number of snapshots to retain (for memory management) */
  private maxSnapshots: number;

  /** Current memory usage in bytes */
  private currentMemoryBytes: number = 0;

  /**
   * Create a new RecordingContextManager.
   *
   * @param collector - ContextCollector implementation for gathering context
   * @param maxSnapshots - Maximum snapshots to retain (default: 1000)
   */
  constructor(collector: ContextCollector, maxSnapshots: number = 1000) {
    if (maxSnapshots < 1) {
      throw new Error('maxSnapshots must be at least 1');
    }

    this.collector = collector;
    this.maxSnapshots = maxSnapshots;
  }

  /**
   * Capture the current screen context and store it with the given action index.
   *
   * @param actionIndex - Index of the action this snapshot is associated with
   * @returns The created snapshot
   */
  captureSnapshot(actionIndex: number): ScreenContextSnapshot {
    // Validate action index
    if (!Number.isInteger(actionIndex) || actionIndex < 0) {
      throw new Error(`Invalid actionIndex: must be a non-negative integer, got ${actionIndex}`);
    }

    // Don't allow duplicate action indices
    if (this.indexMap.has(actionIndex)) {
      throw new Error(`Snapshot already exists for action index ${actionIndex}`);
    }

    const timestamp = new Date().toISOString();

    // Collect context from the platform-specific collector
    const displayState = this.collector.collectDisplayState();
    const elements = this.collector.collectElements();
    const windowContext = this.collector.collectWindowContext();

    // Create element lookup maps
    const elementsBySelector = new Map<string, ElementSnapshot>();
    const elementsByPath = new Map<string, ElementSnapshot>();

    for (const element of elements) {
      elementsBySelector.set(element.selector, element);
      elementsByPath.set(element.domPath.join(' > '), element);
    }

    const snapshot: ScreenContextSnapshot = {
      actionIndex,
      timestamp,
      displayState,
      elements,
      windowTitle: windowContext.windowTitle,
      applicationName: windowContext.applicationName,
      url: windowContext.url,
      elementsBySelector,
      elementsByPath,
    };

    // Store snapshot
    this.snapshots.push(snapshot);
    this.indexMap.set(actionIndex, snapshot);
    this.timestampMap.set(timestamp, actionIndex);

    // Update memory estimate
    this.currentMemoryBytes += this.estimateSnapshotMemory(snapshot);

    // Prune if necessary
    if (this.snapshots.length > this.maxSnapshots) {
      this.pruneOldestSnapshot();
    }

    return snapshot;
  }

  /**
   * Retrieve a snapshot by action index.
   *
   * @param actionIndex - Action index to retrieve
   * @returns The snapshot or undefined if not found
   */
  getSnapshotByIndex(actionIndex: number): ScreenContextSnapshot | undefined {
    return this.indexMap.get(actionIndex);
  }

  /**
   * Retrieve a snapshot by timestamp.
   *
   * @param timestamp - ISO 8601 timestamp
   * @returns The snapshot or undefined if not found
   */
  getSnapshotByTimestamp(timestamp: string): ScreenContextSnapshot | undefined {
    const actionIndex = this.timestampMap.get(timestamp);
    return actionIndex !== undefined ? this.indexMap.get(actionIndex) : undefined;
  }

  /**
   * Retrieve the closest snapshot to a given action index.
   *
   * @param actionIndex - Action index to find closest to
   * @returns The closest snapshot or undefined if no snapshots exist
   */
  getClosestSnapshot(actionIndex: number): ScreenContextSnapshot | undefined {
    if (this.snapshots.length === 0) {
      return undefined;
    }

    if (this.indexMap.has(actionIndex)) {
      return this.indexMap.get(actionIndex);
    }

    // Find closest by binary search on snapshots array
    let closest = this.snapshots[0];
    let minDelta = Math.abs(closest.actionIndex - actionIndex);

    for (const snapshot of this.snapshots) {
      const delta = Math.abs(snapshot.actionIndex - actionIndex);
      if (delta < minDelta) {
        minDelta = delta;
        closest = snapshot;
      }
    }

    return closest;
  }

  /**
   * Get all snapshots within a range of action indices.
   *
   * @param startIndex - Start action index (inclusive)
   * @param endIndex - End action index (inclusive)
   * @returns Array of snapshots in the range
   */
  getSnapshotsInRange(startIndex: number, endIndex: number): ScreenContextSnapshot[] {
    if (startIndex > endIndex) {
      throw new Error(`startIndex (${startIndex}) must not be greater than endIndex (${endIndex})`);
    }

    return this.snapshots.filter(
      (s) => s.actionIndex >= startIndex && s.actionIndex <= endIndex,
    );
  }

  /**
   * Get all snapshots within a time range.
   *
   * @param startTime - Start ISO 8601 timestamp (inclusive)
   * @param endTime - End ISO 8601 timestamp (inclusive)
   * @returns Array of snapshots in the range
   */
  getSnapshotsByTimeRange(startTime: string, endTime: string): ScreenContextSnapshot[] {
    const startMs = new Date(startTime).getTime();
    const endMs = new Date(endTime).getTime();

    if (startMs > endMs) {
      throw new Error(`startTime must not be after endTime`);
    }

    return this.snapshots.filter((s) => {
      const snapshotMs = new Date(s.timestamp).getTime();
      return snapshotMs >= startMs && snapshotMs <= endMs;
    });
  }

  /**
   * Find an element by selector across all snapshots.
   *
   * Useful for locating where an element appeared during recording.
   *
   * @param selector - CSS selector to search for
   * @returns Array of {snapshot, element} pairs where element was found
   */
  findElementBySelector(
    selector: string,
  ): Array<{ snapshot: ScreenContextSnapshot; element: ElementSnapshot }> {
    const results: Array<{ snapshot: ScreenContextSnapshot; element: ElementSnapshot }> = [];

    for (const snapshot of this.snapshots) {
      const element = snapshot.elementsBySelector?.get(selector);
      if (element) {
        results.push({ snapshot, element });
      }
    }

    return results;
  }

  /**
   * Find elements by accessible name across all snapshots.
   *
   * @param accessibleName - Accessible name to search for
   * @returns Array of {snapshot, element} pairs where element was found
   */
  findElementByAccessibleName(
    accessibleName: string,
  ): Array<{ snapshot: ScreenContextSnapshot; element: ElementSnapshot }> {
    const results: Array<{ snapshot: ScreenContextSnapshot; element: ElementSnapshot }> = [];

    for (const snapshot of this.snapshots) {
      const element = snapshot.elements.find((e) => e.accessibleName === accessibleName);
      if (element) {
        results.push({ snapshot, element });
      }
    }

    return results;
  }

  /**
   * Remove all snapshots from the manager.
   *
   * Useful for clearing old recordings or starting fresh.
   */
  clear(): void {
    this.snapshots = [];
    this.indexMap.clear();
    this.timestampMap.clear();
    this.currentMemoryBytes = 0;
  }

  /**
   * Prune snapshots older than the given action index.
   *
   * This is useful for implementing a retention window during long recordings.
   *
   * @param beforeActionIndex - Remove all snapshots with action index < this value
   */
  pruneSnapshotsBefore(beforeActionIndex: number): number {
    let prunedCount = 0;

    for (let i = 0; i < this.snapshots.length; i++) {
      const snapshot = this.snapshots[i];
      if (snapshot.actionIndex < beforeActionIndex) {
        this.indexMap.delete(snapshot.actionIndex);
        this.timestampMap.delete(snapshot.timestamp);
        this.currentMemoryBytes -= this.estimateSnapshotMemory(snapshot);
        prunedCount++;
      }
    }

    if (prunedCount > 0) {
      // Remove pruned items
      this.snapshots = this.snapshots.filter(
        (s) => s.actionIndex >= beforeActionIndex,
      );
    }

    return prunedCount;
  }

  /**
   * Get statistics about the snapshots currently stored.
   *
   * @returns Snapshot statistics
   */
  getStatistics(): SnapshotStatistics {
    const totalSnapshots = this.snapshots.length;
    const avgElements = totalSnapshots > 0
      ? this.snapshots.reduce((sum, s) => sum + s.elements.length, 0) / totalSnapshots
      : 0;

    return {
      totalSnapshots,
      activeSnapshots: totalSnapshots,
      estimatedMemoryBytes: this.currentMemoryBytes,
      timeRange:
        totalSnapshots > 0
          ? {
            first: this.snapshots[0].timestamp,
            last: this.snapshots[totalSnapshots - 1].timestamp,
          }
          : { first: '', last: '' },
      actionRange:
        totalSnapshots > 0
          ? {
            first: this.snapshots[0].actionIndex,
            last: this.snapshots[totalSnapshots - 1].actionIndex,
          }
          : { first: -1, last: -1 },
      avgElementsPerSnapshot: Math.round(avgElements * 100) / 100,
    };
  }

  /**
   * Get all snapshots for debugging or export.
   *
   * @returns Array of all snapshots
   */
  getAllSnapshots(): ScreenContextSnapshot[] {
    return [...this.snapshots];
  }

  /**
   * Prune the oldest snapshot to make room for new ones.
   *
   * Called automatically when maxSnapshots is exceeded.
   * @private
   */
  private pruneOldestSnapshot(): void {
    if (this.snapshots.length === 0) return;

    const oldest = this.snapshots.shift();
    if (oldest) {
      this.indexMap.delete(oldest.actionIndex);
      this.timestampMap.delete(oldest.timestamp);
      this.currentMemoryBytes -= this.estimateSnapshotMemory(oldest);
    }
  }

  /**
   * Estimate the memory usage of a snapshot.
   *
   * @private
   */
  private estimateSnapshotMemory(snapshot: ScreenContextSnapshot): number {
    // Rough estimate:
    // - Base object: ~200 bytes
    // - Each element: ~300 bytes (selector, domPath, attributes, etc.)
    // - Maps overhead: ~100 bytes each

    let bytes = 200;
    bytes += snapshot.elements.length * 300;
    bytes += 200; // Maps overhead

    if (snapshot.windowTitle) bytes += snapshot.windowTitle.length;
    if (snapshot.applicationName) bytes += snapshot.applicationName.length;
    if (snapshot.url) bytes += snapshot.url.length;

    return bytes;
  }
}

/**
 * Helper function to create a normalized bounding box from screen coordinates.
 *
 * @param screenX - Screen pixel X coordinate
 * @param screenY - Screen pixel Y coordinate
 * @param screenWidth - Screen pixel width
 * @param screenHeight - Screen pixel height
 * @param displayWidth - Display width in pixels
 * @param displayHeight - Display height in pixels
 * @returns Normalized bounding box
 */
export function createNormalizedBoundingBox(
  screenX: number,
  screenY: number,
  screenWidth: number,
  screenHeight: number,
  displayWidth: number,
  displayHeight: number,
): NormalizedBoundingBox {
  if (displayWidth <= 0 || displayHeight <= 0) {
    throw new Error('Display dimensions must be positive');
  }

  return {
    x: Math.max(0, Math.min(1, screenX / displayWidth)),
    y: Math.max(0, Math.min(1, screenY / displayHeight)),
    width: Math.max(0, Math.min(1, screenWidth / displayWidth)),
    height: Math.max(0, Math.min(1, screenHeight / displayHeight)),
  };
}

/**
 * Helper function to denormalize a bounding box to screen coordinates.
 *
 * @param bbox - Normalized bounding box
 * @param displayWidth - Display width in pixels
 * @param displayHeight - Display height in pixels
 * @returns Denormalized coordinates
 */
export function denormalizeBoundingBox(
  bbox: NormalizedBoundingBox,
  displayWidth: number,
  displayHeight: number,
): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  if (displayWidth <= 0 || displayHeight <= 0) {
    throw new Error('Display dimensions must be positive');
  }

  return {
    x: Math.round(bbox.x * displayWidth),
    y: Math.round(bbox.y * displayHeight),
    width: Math.round(bbox.width * displayWidth),
    height: Math.round(bbox.height * displayHeight),
  };
}

/**
 * Helper function to create a DisplayState.
 *
 * @param width - Screen width
 * @param height - Screen height
 * @param dpi - Dots per inch
 * @param multiDisplay - Multi-display flag
 * @param displayIndex - Display index
 * @returns DisplayState
 */
export function createDisplayState(
  width: number,
  height: number,
  dpi: number = 96,
  multiDisplay: boolean = false,
  displayIndex: number = 0,
): DisplayState {
  if (width <= 0 || height <= 0) {
    throw new Error('Display width and height must be positive');
  }

  if (dpi <= 0) {
    throw new Error('DPI must be positive');
  }

  return {
    width,
    height,
    dpi,
    multiDisplay,
    displayIndex,
  };
}

/**
 * Helper function to create an ElementSnapshot.
 *
 * @param id - Element ID
 * @param selector - CSS selector
 * @param domPath - DOM path array
 * @param role - ARIA role
 * @param accessibleName - Accessible name
 * @param boundingBox - Normalized bounding box
 * @param visible - Visibility flag
 * @param enabled - Enabled flag
 * @returns ElementSnapshot
 */
export function createElementSnapshot(
  id: string,
  selector: string,
  domPath: string[],
  role: string,
  accessibleName: string,
  boundingBox: NormalizedBoundingBox,
  visible: boolean = true,
  enabled: boolean = true,
): ElementSnapshot {
  return {
    id,
    selector,
    domPath,
    role,
    accessibleName,
    boundingBox,
    visible,
    enabled,
  };
}
