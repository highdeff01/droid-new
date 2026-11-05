import type { Recording, RecordingAction } from './recording-types.js';
import type { ExecutionContext, ExecutionMetrics } from './integration-types.js';
import { createEntityId, createTimestamp } from './integration-types.js';
import { CoordinateTranslator, type DisplayInfo } from './coordinate-translator.js';

export type PlaybackAction = 'click' | 'double_click' | 'keyboard' | 'key' | 'type' | 'drag' | 'scroll' | 'pause';

export interface PlaybackStep {
  id: string;
  order: number;
  action: PlaybackAction;
  optional: boolean;
  timestamp: string;
  x?: number;
  y?: number;
  endX?: number;
  endY?: number;
  displayIndex?: number;
  text?: string;
  metadata: Record<string, unknown>;
}

export interface PlaybackWorkflow {
  id: string;
  name: string;
  steps: PlaybackStep[];
  metadata: {
    name: string;
    description: string;
    version: string;
    createdAt: string;
    updatedAt: string;
    author: string;
    tags: string[];
    estimatedDuration: number;
  };
  contextRequirements: unknown[];
  executionHistory: unknown[];
}

/**
 * Execution status for tracking playback progress.
 */
export type ExecutionStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

/**
 * Step execution result with detailed information.
 */
export interface StepExecutionResult {
  stepId: string;
  stepIndex: number;
  action: string;
  success: boolean;
  duration: number;
  targetCoordinates?: { x: number; y: number };
  denormalizedCoordinates?: { x: number; y: number };
  error?: string;
  displayIndex?: number;
}

/**
 * Playback execution result summary.
 */
export interface PlaybackResult {
  workflowId: string;
  success: boolean;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  totalDuration: number;
  startTime: number;
  endTime: number;
  stepResults: StepExecutionResult[];
  errors: string[];
  metrics: ExecutionMetrics;
  executionContext: ExecutionContext;
}

/**
 * Playback engine configuration options.
 */
export interface PlaybackEngineOptions {
  displayInfo?: DisplayInfo[];
  skipOnError?: boolean;
  replaySpeed?: number; // 1.0 = normal, 2.0 = 2x faster, 0.5 = half speed
  dryRun?: boolean;
  pauseOnError?: boolean;
  elementMatchTolerance?: number; // 0..1 for fuzzy matching
  timeoutMs?: number; // Max time for a single step
  coordinateAdaptationMode?: 'strict' | 'adaptive' | 'fuzzy'; // How to handle coordinate mismatches
}

/**
 * Action dispatcher interface for executing input actions.
 */
export interface ActionDispatcher {
  click(x: number, y: number, button?: 'left' | 'right' | 'middle', count?: number): Promise<void>;
  keyboard(key: string, modifiers?: string[]): Promise<void>;
  typeText(text: string): Promise<void>;
  drag(startX: number, startY: number, endX: number, endY: number, duration?: number): Promise<void>;
  scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void>;
  pause(duration: number): Promise<void>;
}

/**
 * Mock action dispatcher for testing (no-op implementation).
 */
export class MockActionDispatcher implements ActionDispatcher {
  async click(_x: number, _y: number, _button?: 'left' | 'right' | 'middle', _count?: number): Promise<void> {
    // Mock: no-op
  }

  async keyboard(_key: string, _modifiers?: string[]): Promise<void> {
    // Mock: no-op
  }

  async typeText(_text: string): Promise<void> {
    // Mock: no-op
  }

  async drag(_startX: number, _startY: number, _endX: number, _endY: number, _duration?: number): Promise<void> {
    // Mock: no-op
  }

  async scroll(_x: number, _y: number, _deltaX: number, _deltaY: number): Promise<void> {
    // Mock: no-op
  }

  async pause(duration: number): Promise<void> {
    // Mock: actually wait
    await new Promise(resolve => setTimeout(resolve, duration));
  }
}

/**
 * PlaybackEngine executes workflow steps with coordinate denormalization,
 * multi-display support, and comprehensive error handling.
 *
 * Responsibilities:
 * - Denormalize coordinates from 0..1 to screen-specific pixel coordinates
 * - Handle multi-display scenarios with different resolutions and offsets
 * - Execute all action types: click, keyboard, drag, scroll, pause
 * - Track execution progress and timing
 * - Provide fallback mechanisms for element resolution failures
 * - Generate comprehensive execution reports
 */
export class PlaybackEngine {
  private status: ExecutionStatus = 'idle';
  private coordinateTranslator: CoordinateTranslator;
  private currentContext?: ExecutionContext;
  private stepResults: StepExecutionResult[] = [];
  private errors: string[] = [];
  private startTime: number = 0;
  private pauseTime: number = 0;
  private cachedDisplayInfo: DisplayInfo[] | undefined;

  constructor(
    private actionDispatcher: ActionDispatcher = new MockActionDispatcher(),
    private options: PlaybackEngineOptions = {}
  ) {
    this.coordinateTranslator = new CoordinateTranslator();
    // Cache display info if provided
    this.cachedDisplayInfo = options.displayInfo;
  }

  /**
   * Get current execution status.
   */
  getStatus(): ExecutionStatus {
    return this.status;
  }

  /**
   * Pause playback execution.
   */
  pause(): void {
    if (this.status === 'running') {
      this.status = 'paused';
      this.pauseTime = Date.now();
    }
  }

  /**
   * Resume paused playback execution.
   */
  resume(): void {
    if (this.status === 'paused') {
      this.status = 'running';
      // Adjust timing for pause duration
      if (this.pauseTime) {
        this.startTime += Date.now() - this.pauseTime;
        this.pauseTime = 0;
      }
    }
  }

  /**
   * Execute a complete workflow.
   * Denormalizes coordinates, executes all steps in order, and returns comprehensive result.
   *
   * @param workflow Workflow to execute
   * @param executionContext Context for execution (including display info)
   * @returns PlaybackResult with detailed execution information
   */
  async executeWorkflow(
    workflow: PlaybackWorkflow,
    executionContext?: ExecutionContext
  ): Promise<PlaybackResult> {
    this.status = 'running';
    this.startTime = Date.now();
    this.currentContext = executionContext;
    this.stepResults = [];
    this.errors = [];

    // Use cached display info from options if available, otherwise build from context
    let displayInfo = this.cachedDisplayInfo;
    if (!displayInfo && executionContext?.displayState) {
      displayInfo = [
        {
          index: executionContext.displayState.displayIndex ?? 0,
          name: 'Primary',
          width: executionContext.displayState.width,
          height: executionContext.displayState.height,
          offsetX: 0,
          offsetY: 0,
          isPrimary: true,
        },
      ];
    }
    // Fallback to default single display
    if (!displayInfo) {
      displayInfo = [
        {
          index: 0,
          name: 'Primary',
          width: 1920,
          height: 1080,
          offsetX: 0,
          offsetY: 0,
          isPrimary: true,
        },
      ];
    }

    try {
      for (let i = 0; i < workflow.steps.length; i++) {
        if (this.getStatus() === 'paused') {
          await this.waitForResume();
        }

        if (this.getStatus() === 'failed') {
          break;
        }

        const step = workflow.steps[i];
        try {
          const result = await this.executeStep(step, i, displayInfo);
          this.stepResults.push(result);

          // Handle timing from previous step (replay fidelity)
          if (i < workflow.steps.length - 1) {
            const nextStep = workflow.steps[i + 1];
            const timeDiff = this.getTimingDifference(step, nextStep);
            if (timeDiff > 0) {
              await this.actionDispatcher.pause(timeDiff / (this.options.replaySpeed ?? 1.0));
            }
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          this.errors.push(`Step ${i} failed: ${errorMsg}`);
          this.stepResults.push({
            stepId: step.id,
            stepIndex: i,
            action: step.action,
            success: false,
            duration: 0,
            error: errorMsg,
          });

          if (!this.options.skipOnError) {
            this.status = 'failed';
            if (this.options.pauseOnError) {
              this.pause();
            }
            break;
          }
        }
      }

      const completedSteps = this.stepResults.filter(r => r.success).length;
      const failedSteps = this.stepResults.filter(r => !r.success).length;
      const endTime = Date.now();
      const totalDuration = endTime - this.startTime;

      const result: PlaybackResult = {
        workflowId: workflow.id,
        success: this.status !== 'failed' && failedSteps === 0,
        totalSteps: workflow.steps.length,
        completedSteps,
        failedSteps,
        totalDuration,
        startTime: this.startTime,
        endTime,
        stepResults: this.stepResults,
        errors: this.errors,
        metrics: {
          stepsCompleted: completedSteps,
          stepsFailed: failedSteps,
          elementsNotFound: this.countElementNotFound(),
          coordinateAdaptations: this.countCoordinateAdaptations(),
          fallbackMatches: 0,
          avgStepDurationMs: this.stepResults.length ? totalDuration / this.stepResults.length : 0,
        },
        executionContext: executionContext || this.currentContext || this.createDefaultContext(),
      };

      this.status = result.success ? 'completed' : 'failed';
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.errors.push(`Workflow execution failed: ${errorMsg}`);
      this.status = 'failed';

      const endTime = Date.now();
      return {
        workflowId: workflow.id,
        success: false,
        totalSteps: workflow.steps.length,
        completedSteps: this.stepResults.filter(r => r.success).length,
        failedSteps: this.stepResults.filter(r => !r.success).length,
        totalDuration: endTime - this.startTime,
        startTime: this.startTime,
        endTime,
        stepResults: this.stepResults,
        errors: this.errors,
        metrics: {
          stepsCompleted: this.stepResults.filter(r => r.success).length,
          stepsFailed: this.stepResults.filter(r => !r.success).length,
          elementsNotFound: this.countElementNotFound(),
          coordinateAdaptations: this.countCoordinateAdaptations(),
          fallbackMatches: 0,
          avgStepDurationMs: this.stepResults.length ? (endTime - this.startTime) / this.stepResults.length : 0,
        },
        executionContext: executionContext || this.currentContext || this.createDefaultContext(),
      };
    }
  }

  /**
   * Execute a single workflow step with denormalization and error handling.
   *
   * @param step Step to execute
   * @param stepIndex Index in workflow
   * @param displayInfo Display configuration for coordinate translation
   * @returns StepExecutionResult
   */
  private async executeStep(
    step: PlaybackStep,
    stepIndex: number,
    displayInfo?: DisplayInfo[]
  ): Promise<StepExecutionResult> {
    const stepStartTime = Date.now();
    const timeout = this.options.timeoutMs || 30000;

    try {
      const result: StepExecutionResult = {
        stepId: step.id,
        stepIndex,
        action: step.action,
        success: false,
        duration: 0,
      };

      // Handle different action types
      switch (step.action) {
        case 'click':
          await this.executeClickAction(step, displayInfo, result);
          break;

        case 'double_click':
          await this.executeDoubleClickAction(step, displayInfo, result);
          break;

        case 'keyboard':
        case 'key':
          await this.executeKeyboardAction(step, result);
          break;

        case 'type':
          await this.executeTypeAction(step, result);
          break;

        case 'drag':
          await this.executeDragAction(step, displayInfo, result);
          break;

        case 'scroll':
          await this.executeScrollAction(step, displayInfo, result);
          break;

        case 'pause':
          await this.executePauseAction(step, result);
          break;

        default:
          throw new Error(`Unsupported action type: ${step.action}`);
      }

      result.duration = Date.now() - stepStartTime;
      result.success = true;
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        stepId: step.id,
        stepIndex,
        action: step.action,
        success: false,
        duration: Date.now() - stepStartTime,
        error: errorMsg,
      };
    }
  }

  /**
   * Execute a click action with coordinate denormalization.
   */
  private async executeClickAction(
    step: PlaybackStep,
    displayInfo?: DisplayInfo[],
    result?: StepExecutionResult
  ): Promise<void> {
    if (step.x === undefined || step.y === undefined) {
      throw new Error('Click action requires x and y coordinates');
    }

    const { px, py, displayIndex } = this.denormalizeCoordinates(
      step.x,
      step.y,
      displayInfo,
      step.displayIndex
    );

    if (result) {
      result.targetCoordinates = { x: step.x, y: step.y };
      result.denormalizedCoordinates = { x: px, y: py };
      result.displayIndex = displayIndex;
    }

    const button = (step.metadata?.button as 'left' | 'right' | 'middle') || 'left';
    const count = (step.metadata?.clickCount as number) || 1;

    if (!this.options.dryRun) {
      await this.actionDispatcher.click(px, py, button, count);
    }
  }

  /**
   * Execute a double-click action.
   */
  private async executeDoubleClickAction(
    step: PlaybackStep,
    displayInfo?: DisplayInfo[],
    result?: StepExecutionResult
  ): Promise<void> {
    if (step.x === undefined || step.y === undefined) {
      throw new Error('Double-click action requires x and y coordinates');
    }

    const { px, py, displayIndex } = this.denormalizeCoordinates(
      step.x,
      step.y,
      displayInfo,
      step.displayIndex
    );

    if (result) {
      result.targetCoordinates = { x: step.x, y: step.y };
      result.denormalizedCoordinates = { x: px, y: py };
      result.displayIndex = displayIndex;
    }

    if (!this.options.dryRun) {
      await this.actionDispatcher.click(px, py, 'left', 2);
    }
  }

  /**
   * Execute a keyboard action.
   */
  private async executeKeyboardAction(step: PlaybackStep, result?: StepExecutionResult): Promise<void> {
    if (!step.text) {
      throw new Error('Keyboard action requires text field');
    }

    const modifiers = (step.metadata?.modifiers as string[]) || [];

    if (!this.options.dryRun) {
      await this.actionDispatcher.keyboard(step.text, modifiers);
    }
  }

  /**
   * Execute a type action.
   */
  private async executeTypeAction(step: PlaybackStep, result?: StepExecutionResult): Promise<void> {
    if (!step.text) {
      throw new Error('Type action requires text field');
    }

    if (!this.options.dryRun) {
      await this.actionDispatcher.typeText(step.text);
    }
  }

  /**
   * Execute a drag action with coordinate denormalization.
   */
  private async executeDragAction(
    step: PlaybackStep,
    displayInfo?: DisplayInfo[],
    result?: StepExecutionResult
  ): Promise<void> {
    if (step.x === undefined || step.y === undefined || step.endX === undefined || step.endY === undefined) {
      throw new Error('Drag action requires x, y, endX, endY coordinates');
    }

    const startCoords = this.denormalizeCoordinates(step.x, step.y, displayInfo, step.displayIndex);
    const endCoords = this.denormalizeCoordinates(step.endX, step.endY, displayInfo, step.displayIndex);

    const duration = (step.metadata?.duration as number) || 500;

    if (result) {
      result.targetCoordinates = { x: step.x, y: step.y };
      result.denormalizedCoordinates = { x: startCoords.px, y: startCoords.py };
      result.displayIndex = startCoords.displayIndex;
    }

    if (!this.options.dryRun) {
      await this.actionDispatcher.drag(startCoords.px, startCoords.py, endCoords.px, endCoords.py, duration);
    }
  }

  /**
   * Execute a scroll action with coordinate denormalization.
   */
  private async executeScrollAction(
    step: PlaybackStep,
    displayInfo?: DisplayInfo[],
    result?: StepExecutionResult
  ): Promise<void> {
    if (step.x === undefined || step.y === undefined) {
      throw new Error('Scroll action requires x and y coordinates');
    }

    const { px, py, displayIndex } = this.denormalizeCoordinates(
      step.x,
      step.y,
      displayInfo,
      step.displayIndex
    );

    const deltaX = (step.metadata?.deltaX as number) || 0;
    const deltaY = (step.metadata?.deltaY as number) || 0;

    if (result) {
      result.targetCoordinates = { x: step.x, y: step.y };
      result.denormalizedCoordinates = { x: px, y: py };
      result.displayIndex = displayIndex;
    }

    if (!this.options.dryRun) {
      await this.actionDispatcher.scroll(px, py, deltaX, deltaY);
    }
  }

  /**
   * Execute a pause action.
   */
  private async executePauseAction(step: PlaybackStep, result?: StepExecutionResult): Promise<void> {
    const duration = (step.metadata?.duration as number) || 1000;

    if (!this.options.dryRun) {
      await this.actionDispatcher.pause(duration / (this.options.replaySpeed ?? 1.0));
    }
  }

  /**
   * Denormalize coordinates from 0..1 range to screen pixel coordinates.
   * Handles multi-display scenarios with different resolutions.
   *
   * @param normalizedX Normalized X coordinate (0..1)
   * @param normalizedY Normalized Y coordinate (0..1)
   * @param displayInfo Display configuration
   * @param displayIndex Specific display to target
   * @returns Denormalized pixel coordinates and display index
   */
  private denormalizeCoordinates(
    normalizedX: number,
    normalizedY: number,
    displayInfo?: DisplayInfo[],
    displayIndex?: number
  ): { px: number; py: number; displayIndex: number } {
    // Use provided display info or get from translator
    const displays = displayInfo || this.coordinateTranslator.getDisplayInfo();
    const targetDisplayIndex = displayIndex ?? 0;
    const display = displays.find((candidate) => candidate.index === targetDisplayIndex)
      ?? displays.find((candidate) => candidate.isPrimary)
      ?? displays[0];
    if (!display) throw new Error('No displays are available for coordinate translation');
    const { px, py } = this.coordinateTranslator.normalizedToPixels(normalizedX, normalizedY, display.index, displays);
    return { px, py, displayIndex: display.index };
  }

  /**
   * Get timing difference between two steps for replay fidelity.
   */
  private getTimingDifference(step: PlaybackStep, nextStep: PlaybackStep): number {
    const currentTime = step.timestamp ? this.parseTimestamp(step.timestamp) : 0;
    const nextTime = nextStep.timestamp ? this.parseTimestamp(nextStep.timestamp) : 0;
    return Math.max(0, nextTime - currentTime);
  }

  /**
   * Parse timestamp string to milliseconds.
   */
  private parseTimestamp(timestamp: string): number {
    const date = new Date(timestamp);
    return date.getTime();
  }

  /**
   * Wait for resume when paused.
   */
  private async waitForResume(): Promise<void> {
    return new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (this.status !== 'paused') {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
  }

  /**
   * Count elements not found errors in step results.
   */
  private countElementNotFound(): number {
    return this.stepResults.filter(r => r.error?.includes('not found')).length;
  }

  /**
   * Count coordinate adaptation attempts in step results.
   */
  private countCoordinateAdaptations(): number {
    return this.stepResults.filter(r => r.denormalizedCoordinates !== undefined).length;
  }

  /**
   * Create default execution context.
   */
  private createDefaultContext(): ExecutionContext {
    return {
      executionId: createEntityId(`playback-${Date.now()}`),
      displayState: {
        displayIndex: 0,
        width: 1920,
        height: 1080,
        dpi: 96,
        isMultiDisplay: false,
      },
      applicationName: 'Unknown',
      variables: {},
      executionPath: [],
      createdAt: createTimestamp(),
    };
  }

  /**
   * Execute a recording (for convenience).
   */
  async executeRecording(recording: Recording, executionContext?: ExecutionContext): Promise<PlaybackResult> {
    // Convert recording to workflow-like structure for execution
    // This is a simplified version - full conversion would use RecordingToWorkflowConverter

    const mockWorkflow: PlaybackWorkflow = {
      id: recording.id,
      name: recording.name,
      steps: recording.actions.map((action, index) => this.recordingActionToStep(action, index)),
      metadata: {
        name: recording.name,
        description: recording.description ?? '',
        version: '1.0.0',
        createdAt: recording.metadata.createdAt,
        updatedAt: new Date().toISOString(),
        author: 'unknown',
        tags: recording.metadata?.tags || [],
        estimatedDuration: recording.metadata?.duration || 0,
      },
      contextRequirements: [],
      executionHistory: [],
    };

    return this.executeWorkflow(mockWorkflow, executionContext);
  }

  private recordingActionToStep(action: RecordingAction, index: number): PlaybackStep {
    const metadata: Record<string, unknown> = {};
    let actionType: PlaybackAction;
    let x: number | undefined;
    let y: number | undefined;
    let endX: number | undefined;
    let endY: number | undefined;
    let text: string | undefined;

    switch (action.type) {
      case 'click':
        actionType = 'click';
        x = action.x;
        y = action.y;
        metadata.button = action.button;
        metadata.clickCount = action.clickCount;
        break;
      case 'keyboard':
        actionType = action.text ? 'type' : 'keyboard';
        text = action.text ?? action.keys.at(-1) ?? '';
        metadata.modifiers = action.text ? [] : action.keys.slice(0, -1);
        break;
      case 'drag':
        actionType = 'drag';
        x = action.startX;
        y = action.startY;
        endX = action.endX;
        endY = action.endY;
        if (action.duration !== undefined) metadata.duration = action.duration;
        break;
      case 'scroll':
        actionType = 'scroll';
        x = action.x;
        y = action.y;
        metadata.deltaX = action.deltaX ?? 0;
        metadata.deltaY = action.deltaY ?? 0;
        break;
      case 'pause':
        actionType = 'pause';
        metadata.duration = action.duration;
        break;
    }

    return {
      id: `step-${index}`,
      order: index,
      action: actionType,
      optional: false,
      timestamp: action.timestamp,
      x,
      y,
      endX,
      endY,
      text,
      metadata,
      displayIndex: 0,
    };
  }
}
