/**
 * Recording Capture Engine
 *
 * Captures user interactions into Recording objects by hooking into the InputDispatcher.
 * The engine:
 * - Intercepts actions from the InputDispatcher
 * - Normalizes pixel coordinates to [0, 1] based on display state
 * - Captures element context (selector, DOM path, accessible name, elementId)
 * - Maintains recording metadata (creation time, duration, action counts, source)
 * - Manages recording lifecycle (start → capture → pause/resume → stop)
 * - Validates coordinates and timestamps
 * - Emits events for recording lifecycle
 */

import type { InputDispatcher, Performed } from './input-dispatcher.js';
import type { DisplayInfo } from './coordinate-translator.js';
import { CoordinateTranslator } from './coordinate-translator.js';
import type { WorkflowStep } from './types.js';
import {
  type Recording,
  type RecordingAction,
  type ActionContext,
  createClickAction,
  createKeyboardAction,
  createDragAction,
  createScrollAction,
  createPauseAction,
  validateNormalizedCoordinate,
  validateTimestamp,
  validateAction,
  calculateDuration,
  countActions,
  countElementContexts,
  createRecordingMetadata,
} from './recording-types.js';

/**
 * Configuration for starting a recording session.
 */
export interface RecordingConfig {
  /** Recording name/title */
  name: string;

  /** Optional description of what is being recorded */
  description?: string;

  /** Source of the recording: 'user-capture', 'ai-generation', 'import' */
  source?: 'user-capture' | 'ai-generation' | 'import';

  /** Optional tags for categorization */
  tags?: string[];

  /** Whether to capture element context for each action */
  captureElementContext?: boolean;

  /** Whether to capture screenshots for each action */
  captureScreenshots?: boolean;
}

/**
 * State of the recording engine.
 */
export type RecordingState = 'idle' | 'recording' | 'paused' | 'stopped';

/**
 * Events emitted by the RecordingCaptureEngine.
 */
export interface RecordingEvent {
  type: 'recordingStarted' | 'recordingStopped' | 'actionCaptured' | 'paused' | 'resumed';
  timestamp: string;
  data?: Record<string, unknown>;
}

/**
 * Callback for recording events.
 */
export type RecordingEventListener = (event: RecordingEvent) => void;

/**
 * Element context capturing interface.
 * Abstracts away how element context is obtained (DOM, accessibility tree, etc.).
 */
export interface ElementContextProvider {
  /**
   * Get context for element at the given normalized coordinates.
   */
  getElementContext(x: number, y: number): Promise<ActionContext | undefined>;
}

/**
 * Main Recording Capture Engine.
 *
 * Manages the lifecycle of recording user interactions, validates data,
 * and maintains recording metadata.
 */
export class RecordingCaptureEngine {
  private state: RecordingState = 'idle';
  private currentRecording: {
    id: string;
    name: string;
    description?: string;
    actions: RecordingAction[];
    startTime: number;
    pauseStart?: number;
    totalPausedTime: number;
    source: 'user-capture' | 'ai-generation' | 'import';
    tags?: string[];
    captureElementContext: boolean;
    captureScreenshots: boolean;
  } | null = null;

  private coordinateTranslator: CoordinateTranslator;
  private eventListeners: Set<RecordingEventListener> = new Set();
  private actionSequenceNumber = 0;

  constructor(
    private inputDispatcher?: InputDispatcher,
    private elementContextProvider?: ElementContextProvider
  ) {
    this.coordinateTranslator = new CoordinateTranslator();
  }

  /**
   * Start a new recording session.
   *
   * @param id Unique identifier for the recording
   * @param config Configuration for the recording
   * @throws Error if already recording or if config is invalid
   */
  startRecording(id: string, config: RecordingConfig): void {
    if (this.state !== 'idle') {
      throw new Error(`Cannot start recording: already in state '${this.state}'`);
    }

    if (!config.name) {
      throw new Error('Recording name is required');
    }

    this.actionSequenceNumber = 0;
    this.currentRecording = {
      id,
      name: config.name,
      description: config.description,
      actions: [],
      startTime: Date.now(),
      totalPausedTime: 0,
      source: config.source || 'user-capture',
      tags: config.tags,
      captureElementContext: config.captureElementContext !== false,
      captureScreenshots: config.captureScreenshots === true,
    };

    this.state = 'recording';

    this.emitEvent({
      type: 'recordingStarted',
      timestamp: this.getCurrentTimestamp(),
      data: {
        recordingId: id,
        name: config.name,
        source: config.source || 'user-capture',
      },
    });
  }

  /**
   * Capture an action from a workflow step into the current recording.
   *
   * Converts pixel coordinates to normalized coordinates, validates them,
   * captures element context if enabled, and adds the action to the recording.
   *
   * @param step Workflow step to capture (contains pixel coordinates)
   * @throws Error if not recording or if coordinates are invalid
   */
  async captureAction(step: WorkflowStep): Promise<void> {
    if (this.state !== 'recording') {
      throw new Error(`Cannot capture action: recording is in state '${this.state}'`);
    }

    if (!this.currentRecording) {
      throw new Error('No active recording session');
    }

    const timestamp = this.getCurrentTimestamp();

    // Normalize coordinates from pixel to [0, 1]
    const display = this.coordinateTranslator.getPrimaryDisplay();
    const normalizedX = step.correctedX !== undefined ? step.correctedX / display.width : step.x;
    const normalizedY = step.correctedY !== undefined ? step.correctedY / display.height : step.y;

    // Validate normalized coordinates
    try {
      validateNormalizedCoordinate(normalizedX, 'normalized X coordinate');
      validateNormalizedCoordinate(normalizedY, 'normalized Y coordinate');
    } catch (error) {
      throw new Error(
        `Invalid normalized coordinates for action ${step.action}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Capture element context if enabled
    let context: ActionContext | undefined;
    if (this.currentRecording.captureElementContext && this.elementContextProvider) {
      try {
        context = await this.elementContextProvider.getElementContext(normalizedX, normalizedY);
      } catch (error) {
        // Log but don't fail if context capture fails
        console.warn('Failed to capture element context:', error);
      }
    }

    // Create action based on type
    let action: RecordingAction;

    switch (step.action) {
      case 'click':
        action = createClickAction(
          timestamp,
          normalizedX,
          normalizedY,
          'left',
          1,
          context
        );
        break;

      case 'double_click':
        action = createClickAction(timestamp, normalizedX, normalizedY, 'left', 2, context);
        break;

      case 'drag':
        if (step.endX === undefined || step.endY === undefined) {
          throw new Error('Drag action requires endX and endY');
        }

        const normalizedEndX = step.endX / display.width;
        const normalizedEndY = step.endY / display.height;

        validateNormalizedCoordinate(normalizedEndX, 'normalized end X coordinate');
        validateNormalizedCoordinate(normalizedEndY, 'normalized end Y coordinate');

        action = createDragAction(
          timestamp,
          normalizedX,
          normalizedY,
          normalizedEndX,
          normalizedEndY,
          step.delayMs,
          context
        );
        break;

      case 'scroll':
        const deltaY = step.deltaY ?? -3;
        const deltaX = step.deltaX ?? 0;

        action = createScrollAction(
          timestamp,
          normalizedX,
          normalizedY,
          deltaX || undefined,
          deltaY || undefined,
          context
        );
        break;

      case 'type':
        if (!step.text) {
          throw new Error('Type action requires text');
        }

        action = createKeyboardAction(timestamp, [], step.text, context);
        break;

      case 'key':
        if (!step.text) {
          throw new Error('Key action requires key combination in text field');
        }

        // Parse key combination (e.g., "ctrl+c" → ["Control", "c"])
        const keys = this.parseKeyCombo(step.text);
        action = createKeyboardAction(timestamp, keys, undefined, context);
        break;

      default:
        throw new Error(`Unsupported action type: ${step.action}`);
    }

    // Validate the action
    try {
      validateAction(action);
    } catch (error) {
      throw new Error(
        `Validation failed for action: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Add action to recording
    this.currentRecording.actions.push(action);
    this.actionSequenceNumber++;

    this.emitEvent({
      type: 'actionCaptured',
      timestamp,
      data: {
        recordingId: this.currentRecording.id,
        actionType: step.action,
        sequenceNumber: this.actionSequenceNumber,
        totalActions: this.currentRecording.actions.length,
      },
    });
  }

  /**
   * Capture a pause action.
   *
   * Records a pause/delay between actions, useful for:
   * - Recording natural pauses in user interaction
   * - Replaying with realistic timing
   * - Marking "think time" or waiting periods
   *
   * @param durationMs Duration of the pause in milliseconds
   * @throws Error if not recording or if duration is invalid
   */
  captureProgressivePause(durationMs: number): void {
    if (this.state !== 'recording') {
      throw new Error(`Cannot capture pause: recording is in state '${this.state}'`);
    }

    if (!this.currentRecording) {
      throw new Error('No active recording session');
    }

    if (durationMs < 0 || !Number.isFinite(durationMs)) {
      throw new Error(`Invalid pause duration: ${durationMs}`);
    }

    const timestamp = this.getCurrentTimestamp();
    const action = createPauseAction(timestamp, durationMs);

    this.currentRecording.actions.push(action);
    this.actionSequenceNumber++;

    this.emitEvent({
      type: 'actionCaptured',
      timestamp,
      data: {
        recordingId: this.currentRecording.id,
        actionType: 'pause',
        duration: durationMs,
        sequenceNumber: this.actionSequenceNumber,
      },
    });
  }

  /**
   * Pause the current recording.
   *
   * Pauses action capture without ending the recording session.
   * Resume can be called to continue capturing actions.
   *
   * @throws Error if not recording
   */
  pauseRecording(): void {
    if (this.state !== 'recording') {
      throw new Error(`Cannot pause: recording is in state '${this.state}'`);
    }

    if (!this.currentRecording) {
      throw new Error('No active recording session');
    }

    this.state = 'paused';
    this.currentRecording.pauseStart = Date.now();

    this.emitEvent({
      type: 'paused',
      timestamp: this.getCurrentTimestamp(),
      data: {
        recordingId: this.currentRecording.id,
      },
    });
  }

  /**
   * Resume a paused recording.
   *
   * Continues action capture after a pause.
   *
   * @throws Error if not paused
   */
  resumeRecording(): void {
    if (this.state !== 'paused') {
      throw new Error(`Cannot resume: recording is in state '${this.state}'`);
    }

    if (!this.currentRecording || !this.currentRecording.pauseStart) {
      throw new Error('Invalid pause state');
    }

    // Accumulate paused time
    const pausedDuration = Date.now() - this.currentRecording.pauseStart;
    this.currentRecording.totalPausedTime += pausedDuration;
    this.currentRecording.pauseStart = undefined;

    this.state = 'recording';

    this.emitEvent({
      type: 'resumed',
      timestamp: this.getCurrentTimestamp(),
      data: {
        recordingId: this.currentRecording.id,
        pausedDuration,
      },
    });
  }

  /**
   * Stop the current recording and return the completed Recording object.
   *
   * Finalizes the recording, calculates metadata, and validates all data.
   * After this, the engine returns to idle state and a new recording can be started.
   *
   * @returns Complete Recording object with all metadata
   * @throws Error if not recording (or paused), or if metadata calculation fails
   */
  stopRecording(): Recording {
    if (this.state !== 'recording' && this.state !== 'paused') {
      throw new Error(`Cannot stop: recording is in state '${this.state}'`);
    }

    if (!this.currentRecording) {
      throw new Error('No active recording session');
    }

    const stopTime = Date.now();
    const recording: Recording = {
      id: this.currentRecording.id,
      name: this.currentRecording.name,
      description: this.currentRecording.description,
      actions: this.currentRecording.actions,
      metadata: createRecordingMetadata(
        this.currentRecording.actions,
        this.currentRecording.source,
        this.currentRecording.tags
      ),
    };

    // Update metadata with actual recording timing
    recording.metadata.updatedAt = this.getCurrentTimestamp();

    // Calculate actual duration including paused time
    const elapsedMs = stopTime - this.currentRecording.startTime;
    recording.metadata.duration = elapsedMs - this.currentRecording.totalPausedTime;

    // Validate the final recording
    if (recording.actions.length === 0) {
      throw new Error('Cannot stop recording with no actions');
    }

    // Validate timestamps are monotonic
    let lastTime = 0;
    for (let i = 0; i < recording.actions.length; i++) {
      const action = recording.actions[i];
      const currentTime = new Date(action.timestamp).getTime();

      if (currentTime < lastTime) {
        throw new Error(
          `Timestamps not monotonic at action ${i}: ${action.timestamp} < previous timestamp`
        );
      }

      lastTime = currentTime;
    }

    const stopEvent: RecordingEvent = {
      type: 'recordingStopped',
      timestamp: this.getCurrentTimestamp(),
      data: {
        recordingId: recording.id,
        name: recording.name,
        actionCount: recording.actions.length,
        duration: recording.metadata.duration,
        durationSeconds: Math.round(recording.metadata.duration / 1000),
      },
    };

    this.emitEvent(stopEvent);

    // Reset state
    this.currentRecording = null;
    this.state = 'idle';
    this.actionSequenceNumber = 0;

    return recording;
  }

  /**
   * Cancel the current recording without saving.
   *
   * Discards the in-progress recording and returns to idle state.
   *
   * @throws Error if not recording
   */
  cancelRecording(): void {
    if (this.state === 'idle') {
      throw new Error('No recording in progress to cancel');
    }

    const recordingId = this.currentRecording?.id || 'unknown';
    this.currentRecording = null;
    this.state = 'idle';
    this.actionSequenceNumber = 0;

    this.emitEvent({
      type: 'recordingStopped',
      timestamp: this.getCurrentTimestamp(),
      data: {
        recordingId,
        cancelled: true,
      },
    });
  }

  /**
   * Get the current recording state.
   */
  getState(): RecordingState {
    return this.state;
  }

  /**
   * Get current recording metadata (while recording).
   *
   * @returns Object with current recording info, or null if not recording
   */
  getCurrentRecordingInfo(): {
    id: string;
    name: string;
    actionCount: number;
    elapsedMs: number;
    state: RecordingState;
  } | null {
    if (!this.currentRecording) {
      return null;
    }

    const now = Date.now();
    const totalElapsed = now - this.currentRecording.startTime;
    const elapsedMs = this.state === 'paused'
      ? totalElapsed - this.currentRecording.totalPausedTime - (now - (this.currentRecording.pauseStart || now))
      : totalElapsed - this.currentRecording.totalPausedTime;

    return {
      id: this.currentRecording.id,
      name: this.currentRecording.name,
      actionCount: this.currentRecording.actions.length,
      elapsedMs: Math.max(0, elapsedMs),
      state: this.state,
    };
  }

  /**
   * Register an event listener for recording lifecycle events.
   *
   * @param listener Callback function to invoke on events
   */
  addEventListener(listener: RecordingEventListener): void {
    this.eventListeners.add(listener);
  }

  /**
   * Unregister an event listener.
   *
   * @param listener Callback function to remove
   */
  removeEventListener(listener: RecordingEventListener): void {
    this.eventListeners.delete(listener);
  }

  /**
   * Check if exactly one recording is active at a time.
   *
   * @returns true if this engine has an active recording
   */
  hasActiveRecording(): boolean {
    return this.state !== 'idle';
  }

  /**
   * Emit an event to all registered listeners.
   */
  private emitEvent(event: RecordingEvent): void {
    Array.from(this.eventListeners).forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('Error in recording event listener:', error);
      }
    });
  }

  /**
   * Get current timestamp in ISO 8601 format.
   */
  private getCurrentTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Parse a key combination string into individual key names.
   *
   * Examples:
   * - "ctrl+c" → ["Control", "c"]
   * - "shift+alt+f4" → ["Shift", "Alt", "F4"]
   * - "cmd+v" → ["Meta", "v"]
   *
   * @param combo Key combination string (e.g., "ctrl+c")
   * @returns Array of key names
   */
  private parseKeyCombo(combo: string): string[] {
    const parts = combo.split('+').map(p => p.trim().toLowerCase());
    const keys: string[] = [];

    for (const part of parts) {
      switch (part) {
        case 'ctrl':
        case 'control':
          keys.push('Control');
          break;
        case 'shift':
          keys.push('Shift');
          break;
        case 'alt':
        case 'option':
          keys.push('Alt');
          break;
        case 'cmd':
        case 'command':
        case 'meta':
          keys.push('Meta');
          break;
        case 'enter':
        case 'return':
          keys.push('Enter');
          break;
        case 'space':
          keys.push(' ');
          break;
        case 'tab':
          keys.push('Tab');
          break;
        case 'escape':
        case 'esc':
          keys.push('Escape');
          break;
        case 'backspace':
          keys.push('Backspace');
          break;
        case 'delete':
        case 'del':
          keys.push('Delete');
          break;
        case 'arrowup':
        case 'up':
          keys.push('ArrowUp');
          break;
        case 'arrowdown':
        case 'down':
          keys.push('ArrowDown');
          break;
        case 'arrowleft':
        case 'left':
          keys.push('ArrowLeft');
          break;
        case 'arrowright':
        case 'right':
          keys.push('ArrowRight');
          break;
        default:
          // Handle function keys (f1-f12)
          if (/^f\d+$/.test(part)) {
            keys.push(`F${part.substring(1)}`);
          } else {
            // Single character key
            keys.push(part.length === 1 ? part : part);
          }
      }
    }

    return keys;
  }
}
