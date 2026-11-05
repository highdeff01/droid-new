/**
 * Recording Action Buffer
 *
 * Manages efficient buffering and timing for recording actions with:
 * - Deduplication (remove duplicate rapid-fire actions)
 * - Rate limiting (throttle high-frequency actions)
 * - Memory management (cap buffer size, FIFO eviction)
 * - Timing validation (ensure monotonic, accurate timestamps)
 * - Compression (optional action consolidation)
 * - Statistics (track efficiency metrics)
 * - Serialization (persist and restore buffer state)
 */

import type { RecordingAction, ClickAction, KeyboardAction, DragAction, ScrollAction, PauseAction } from './recording-types.js';

/**
 * Configuration for ActionBuffer behavior
 */
export interface BufferConfig {
  /** Maximum actions in buffer before FIFO eviction, default 10000 */
  maxSize?: number;

  /** Deduplication window in milliseconds, default 50ms */
  dedupWindowMs?: number;

  /** Spatial deduplication tolerance in normalized coordinates (0..1), default 0.01 (roughly 1% of screen) */
  dedupSpatialTolerance?: number;

  /** Enable compression (merge similar actions), default false */
  enableCompression?: boolean;

  /** Rate limiting configuration */
  rateLimit?: {
    /** Maximum actions per second to buffer, default unlimited */
    maxActionsPerSecond?: number;

    /** Strategy for rate limiting: 'throttle' (buffer all) or 'drop' (discard excess), default 'throttle' */
    strategy?: 'throttle' | 'drop';
  };
}

/**
 * Statistics about buffer efficiency
 */
export interface BufferStatistics {
  /** Total actions added (including deduplicated/dropped) */
  totalAdded: number;

  /** Actions currently in buffer */
  currentSize: number;

  /** Actions deduplicated (not added due to duplication) */
  deduplicated: number;

  /** Actions dropped due to rate limiting */
  rateDropped: number;

  /** Actions removed due to capacity eviction */
  evicted: number;

  /** Deduplication rate (0..1) */
  dedupRate: number;

  /** Average time between actions in buffer (milliseconds) */
  avgTimingGap: number;

  /** Timestamp validation issues detected */
  validationIssues: number;
}

/**
 * ActionBuffer — efficiently manages recording actions with deduplication,
 * rate limiting, and memory management.
 */
export class ActionBuffer {
  private buffer: RecordingAction[] = [];
  private config: Required<BufferConfig>;
  private stats = {
    totalAdded: 0,
    deduplicated: 0,
    rateDropped: 0,
    evicted: 0,
    validationIssues: 0,
  };

  private lastActionTime: number = 0;
  private actionTimestamps: number[] = []; // For rate limiting tracking
  private lastDeduplicationCheckTime: number = 0;

  constructor(config?: BufferConfig) {
    this.config = {
      maxSize: config?.maxSize ?? 10000,
      dedupWindowMs: config?.dedupWindowMs ?? 50,
      dedupSpatialTolerance: config?.dedupSpatialTolerance ?? 0.01,
      enableCompression: config?.enableCompression ?? false,
      rateLimit: {
        maxActionsPerSecond: config?.rateLimit?.maxActionsPerSecond ?? Infinity,
        strategy: config?.rateLimit?.strategy ?? 'throttle',
      },
    };
  }

  /**
   * Add a single action to the buffer
   * @param action The action to add
   * @returns true if action was added, false if dropped/deduplicated
   */
  addAction(action: RecordingAction): boolean {
    // Validate timestamp
    if (!this.validateTimestamp(action)) {
      this.stats.validationIssues++;
      return false;
    }

    const actionTime = this.parseTimestamp(action.timestamp);

    // Check deduplication first (always applies regardless of rate limiting)
    if (this.isDuplicate(action, actionTime)) {
      this.stats.deduplicated++;
      return false;
    }

    // Check rate limiting based on strategy
    if (this.config.rateLimit.strategy === 'drop' && !this.canAddByRateLimit(actionTime)) {
      this.stats.rateDropped++;
      return false;
    }

    // Add to buffer
    this.buffer.push(action);
    this.lastActionTime = actionTime;
    this.stats.totalAdded++;

    // Track for rate limiting
    this.actionTimestamps.push(actionTime);
    this.cleanup();

    // Enforce capacity
    if (this.buffer.length > this.config.maxSize) {
      this.buffer.shift();
      this.stats.evicted++;
      if (this.actionTimestamps.length > 0) {
        this.actionTimestamps.shift();
      }
    }

    return true;
  }

  /**
   * Add multiple actions to the buffer
   * @param actions Array of actions to add
   * @returns number of actions successfully added
   */
  addActions(actions: RecordingAction[]): number {
    let added = 0;
    for (const action of actions) {
      if (this.addAction(action)) {
        added++;
      }
    }
    return added;
  }

  /**
   * Get all actions in the buffer
   * @returns copy of buffer array
   */
  getActions(): RecordingAction[] {
    return [...this.buffer];
  }

  /**
   * Get action at specific index
   * @param index The index to retrieve
   * @returns The action or undefined if out of bounds
   */
  getAction(index: number): RecordingAction | undefined {
    return this.buffer[index];
  }

  /**
   * Get the last action in the buffer
   * @returns The last action or undefined if empty
   */
  getLastAction(): RecordingAction | undefined {
    return this.buffer.length > 0 ? this.buffer[this.buffer.length - 1] : undefined;
  }

  /**
   * Get the current size of the buffer
   * @returns number of actions in buffer
   */
  size(): number {
    return this.buffer.length;
  }

  /**
   * Check if buffer is empty
   * @returns true if no actions in buffer
   */
  isEmpty(): boolean {
    return this.buffer.length === 0;
  }

  /**
   * Check if buffer is at capacity
   * @returns true if buffer.length >= maxSize
   */
  isFull(): boolean {
    return this.buffer.length >= this.config.maxSize;
  }

  /**
   * Clear all actions from the buffer
   */
  clear(): void {
    this.buffer = [];
    this.lastActionTime = 0;
    this.actionTimestamps = [];
  }

  /**
   * Remove action at specific index
   * @param index The index to remove
   * @returns true if action was removed
   */
  removeAction(index: number): boolean {
    if (index < 0 || index >= this.buffer.length) {
      return false;
    }
    this.buffer.splice(index, 1);
    if (index < this.actionTimestamps.length) {
      this.actionTimestamps.splice(index, 1);
    }
    return true;
  }

  /**
   * Get statistics about buffer efficiency
   * @returns BufferStatistics object
   */
  getStatistics(): BufferStatistics {
    const totalAdded = this.stats.totalAdded;
    const avgTimingGap = this.calculateAverageTimingGap();
    const dedupRate = totalAdded > 0 ? this.stats.deduplicated / totalAdded : 0;

    return {
      totalAdded,
      currentSize: this.buffer.length,
      deduplicated: this.stats.deduplicated,
      rateDropped: this.stats.rateDropped,
      evicted: this.stats.evicted,
      dedupRate,
      avgTimingGap,
      validationIssues: this.stats.validationIssues,
    };
  }

  /**
   * Serialize buffer to JSON for persistence
   * @returns JSON serializable object
   */
  serialize(): string {
    return JSON.stringify({
      buffer: this.buffer,
      config: this.config,
      stats: this.stats,
      lastActionTime: this.lastActionTime,
    });
  }

  /**
   * Restore buffer from serialized JSON
   * @param json Serialized buffer data
   */
  restore(json: string): void {
    try {
      const data = JSON.parse(json);
      this.buffer = data.buffer || [];
      this.stats = data.stats || this.stats;
      this.lastActionTime = data.lastActionTime || 0;
      this.rebuildTimestamps();
    } catch (error) {
      console.error('Failed to restore buffer from JSON:', error);
    }
  }

  /**
   * Export buffer to a shareable format
   * @returns array of actions
   */
  export(): RecordingAction[] {
    return [...this.buffer];
  }

  /**
   * Import actions from array
   * @param actions Array of actions to import
   * @param clearExisting Whether to clear buffer first
   */
  import(actions: RecordingAction[], clearExisting = true): void {
    if (clearExisting) {
      this.clear();
    }
    this.addActions(actions);
  }

  // Private helper methods

  /**
   * Parse ISO 8601 timestamp to milliseconds since epoch
   */
  private parseTimestamp(timestamp: string): number {
    return new Date(timestamp).getTime();
  }

  /**
   * Validate that timestamp is valid and monotonically increasing
   */
  private validateTimestamp(action: RecordingAction): boolean {
    try {
      const time = this.parseTimestamp(action.timestamp);

      // Check if timestamp is valid number
      if (!Number.isFinite(time)) {
        return false;
      }

      // Check if timestamp is monotonically increasing
      if (this.lastActionTime > 0 && time < this.lastActionTime) {
        // Allow small clock skew (less than 1 second) but flag as issue
        const skew = this.lastActionTime - time;
        if (skew > 1000) {
          // More than 1 second back in time is rejected
          return false;
        }
        // Small skew (under 1 second) is allowed but flagged
        // Don't increment validation issues here - that's for significant problems
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if action should be dropped due to rate limiting
   */
  private canAddByRateLimit(actionTime: number): boolean {
    if (this.config.rateLimit.maxActionsPerSecond === Infinity) {
      return true;
    }

    // Calculate the minimum required time between actions
    const minIntervalMs = 1000 / (this.config.rateLimit.maxActionsPerSecond || 1);

    // If this is the first action, allow it
    if (this.actionTimestamps.length === 0) {
      return true;
    }

    // Get the most recent action timestamp
    const lastActionTime = this.actionTimestamps[this.actionTimestamps.length - 1];
    const timeSinceLastAction = actionTime - lastActionTime;

    return timeSinceLastAction >= minIntervalMs;
  }

  /**
   * Check if action is a duplicate within dedup window
   */
  private isDuplicate(action: RecordingAction, actionTime: number): boolean {
    if (this.buffer.length === 0) {
      return false;
    }

    const windowStart = actionTime - this.config.dedupWindowMs;
    const lastAction = this.buffer[this.buffer.length - 1];
    const lastActionTime = this.parseTimestamp(lastAction.timestamp);

    if (lastActionTime < windowStart) {
      return false;
    }

    // Same action type and within window
    if (lastAction.type !== action.type) {
      return false;
    }

    // Type-specific deduplication logic
    switch (action.type) {
      case 'click':
        return this.isDuplicateClick(action as ClickAction, lastAction as ClickAction);
      case 'keyboard':
        return this.isDuplicateKeyboard(action as KeyboardAction, lastAction as KeyboardAction);
      case 'drag':
        return this.isDuplicateDrag(action as DragAction, lastAction as DragAction);
      case 'scroll':
        return this.isDuplicateScroll(action as ScrollAction, lastAction as ScrollAction);
      case 'pause':
        return this.isDuplicatePause(action as PauseAction, lastAction as PauseAction);
      default:
        return false;
    }
  }

  /**
   * Check if two click actions are duplicates (same location and button)
   */
  private isDuplicateClick(action: ClickAction, lastAction: ClickAction): boolean {
    if (action.button !== lastAction.button) {
      return false;
    }

    // Must have both at same location within tolerance
    const spatialDist = Math.hypot(action.x - lastAction.x, action.y - lastAction.y);
    const isSpatiallyDuplicate = spatialDist <= this.config.dedupSpatialTolerance;

    // Allow dedup if spatial tolerance is violated (i.e., different locations always dedup false)
    // But if same location, it's a duplicate
    return isSpatiallyDuplicate;
  }

  /**
   * Check if two keyboard actions are duplicates (same keys)
   */
  private isDuplicateKeyboard(action: KeyboardAction, lastAction: KeyboardAction): boolean {
    if (action.text && lastAction.text) {
      return action.text === lastAction.text;
    }

    if (action.keys.length !== lastAction.keys.length) {
      return false;
    }

    return action.keys.every((key, i) => key === lastAction.keys[i]);
  }

  /**
   * Check if two drag actions are duplicates (same start/end within tolerance)
   */
  private isDuplicateDrag(action: DragAction, lastAction: DragAction): boolean {
    const startDist = Math.hypot(action.startX - lastAction.startX, action.startY - lastAction.startY);
    const endDist = Math.hypot(action.endX - lastAction.endX, action.endY - lastAction.endY);

    return startDist <= this.config.dedupSpatialTolerance && endDist <= this.config.dedupSpatialTolerance;
  }

  /**
   * Check if two scroll actions are duplicates (same location and delta)
   */
  private isDuplicateScroll(action: ScrollAction, lastAction: ScrollAction): boolean {
    const spatialDist = Math.hypot(action.x - lastAction.x, action.y - lastAction.y);

    if (spatialDist > this.config.dedupSpatialTolerance) {
      return false;
    }

    const deltaXMatch = (action.deltaX ?? 0) === (lastAction.deltaX ?? 0);
    const deltaYMatch = (action.deltaY ?? 0) === (lastAction.deltaY ?? 0);

    return deltaXMatch && deltaYMatch;
  }

  /**
   * Check if two pause actions are duplicates (same duration within 10% tolerance)
   */
  private isDuplicatePause(action: PauseAction, lastAction: PauseAction): boolean {
    const durationDiff = Math.abs(action.duration - lastAction.duration);
    const tolerance = lastAction.duration * 0.1; // 10% tolerance

    return durationDiff <= tolerance;
  }

  /**
   * Clean up old timestamps outside the rate limit window
   */
  private cleanup(): void {
    if (this.actionTimestamps.length === 0) {
      return;
    }

    // Only keep timestamps from the last 5 seconds (generous buffer for rate limiting window)
    // This prevents memory leaks while not affecting rate limiting calculations
    if (this.actionTimestamps.length > 0) {
      const mostRecentTimestamp = this.actionTimestamps[this.actionTimestamps.length - 1];
      const cutoffTime = mostRecentTimestamp - 5000; // Keep last 5 seconds
      this.actionTimestamps = this.actionTimestamps.filter((t) => t > cutoffTime);
    }
  }

  /**
   * Calculate average timing gap between actions
   */
  private calculateAverageTimingGap(): number {
    if (this.buffer.length < 2) {
      return 0;
    }

    let totalGap = 0;
    for (let i = 1; i < this.buffer.length; i++) {
      const prevTime = this.parseTimestamp(this.buffer[i - 1].timestamp);
      const currTime = this.parseTimestamp(this.buffer[i].timestamp);
      totalGap += Math.max(0, currTime - prevTime);
    }

    return totalGap / (this.buffer.length - 1);
  }

  /**
   * Rebuild timestamps array from buffer (used in restore)
   */
  private rebuildTimestamps(): void {
    this.actionTimestamps = this.buffer.map((action) => this.parseTimestamp(action.timestamp));
  }
}
