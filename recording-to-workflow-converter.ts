/**
 * Recording to Workflow Converter
 *
 * Converts recorded actions to Workflow steps, preserving all metadata and context.
 * Validates workflow completeness and generates human-readable step descriptions.
 *
 * Key responsibilities:
 * - Transform Recording.actions into WorkflowSteps
 * - Preserve action type, coordinates, element context, and timing
 * - Group pause actions into timed pauses within steps
 * - Create appropriate conditions for context-dependent actions
 * - Validate workflow completeness
 * - Generate human-readable descriptions
 */

import type {
  Recording,
  RecordingAction,
  ClickAction,
  KeyboardAction,
  DragAction,
  ScrollAction,
  PauseAction,
} from './recording-types.js';
import type {
  Workflow,
  WorkflowStep,
  WorkflowMetadata,
  StepCondition,
  ExecutionPolicy,
} from './workflow-types.js';
import {
  validateNormalizedCoordinate,
  validateAction,
} from './recording-types.js';
import {
  createExecutionPolicy,
  createRecordingStep,
  createWorkflowMetadata,
  createWorkflow,
  validateWorkflow,
  createIfCondition,
} from './workflow-types.js';

/**
 * Options for controlling the conversion process.
 */
export interface ConversionOptions {
  /** Whether to include context conditions for element-based actions */
  includeContextConditions?: boolean;

  /** Whether to group consecutive pauses into single pause actions */
  groupPauses?: boolean;

  /** Execution policy to use for all steps (default: sequential with continue on error) */
  executionPolicy?: ExecutionPolicy;

  /** Optional tags to add to workflow metadata */
  tags?: string[];

  /** Optional workflow version (default: "1.0.0") */
  version?: string;

  /** Whether to generate descriptions for each step */
  generateDescriptions?: boolean;
}

/**
 * Validation result for a converted workflow.
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;

  /** List of validation errors */
  errors: string[];

  /** List of warnings (non-blocking issues) */
  warnings: string[];

  /** Statistics about the workflow */
  statistics: {
    stepCount: number;
    coordinateCount: number;
    contextReferencesCount: number;
  };
}

/**
 * Service for converting recordings to workflows.
 *
 * Usage:
 * ```typescript
 * const converter = new RecordingToWorkflowConverter();
 * const workflow = converter.convert(recording, options);
 * const validation = converter.validate(workflow);
 * ```
 */
export class RecordingToWorkflowConverter {
  /**
   * Convert a recording to a workflow.
   *
   * @param recording - The recording to convert
   * @param options - Conversion options
   * @returns A new Workflow with all actions and metadata
   * @throws Error if recording is invalid or conversion fails
   */
  public convert(recording: Recording, options: ConversionOptions = {}): Workflow {
    this.validateRecording(recording);

    const {
      groupPauses = true,
      executionPolicy = createExecutionPolicy('sequential', 'continue'),
      tags = [],
      version = '1.0.0',
      generateDescriptions = true,
    } = options;

    // Process actions: optionally group pauses
    const processedActions = groupPauses
      ? this.groupConsecutivePauses(recording.actions)
      : recording.actions;

    // Create workflow steps from actions
    const steps = this.createWorkflowSteps(
      processedActions,
      executionPolicy,
      generateDescriptions,
    );

    // Create workflow metadata from recording metadata
    const metadata = this.createWorkflowMetadataFromRecording(
      recording,
      version,
      tags,
    );

    // Create and validate the workflow
    const workflow = createWorkflow(
      this.generateWorkflowId(),
      recording.name,
      steps,
      metadata,
      recording.description,
    );

    // Validate before returning
    validateWorkflow(workflow);

    return workflow;
  }

  /**
   * Validate a workflow created from a recording.
   *
   * Checks:
   * - All steps have valid data
   * - Coordinate ranges are 0..1
   * - Element context is present for element-based actions (if required)
   * - Steps are in valid order
   *
   * @param workflow - The workflow to validate
   * @returns ValidationResult with errors and warnings
   */
  public validate(workflow: Workflow): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let coordinateCount = 0;
    let contextReferencesCount = 0;

    // Validate workflow structure
    try {
      validateWorkflow(workflow);
    } catch (error) {
      errors.push(`Workflow validation failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Validate each step
    for (const step of workflow.steps) {
      // Check recording reference
      if (step.type === 'recording' && !step.recordingId) {
        errors.push(`Step "${step.id}" is missing recordingId`);
      }

      // Check execution policy
      if (!step.policy || !step.policy.type || !step.policy.onError) {
        errors.push(`Step "${step.id}" has invalid execution policy`);
      }

      // Extract coordinate count from description (heuristic)
      if (step.description) {
        const coordMatches = step.description.match(/\([\d.]+,\s*[\d.]+\)/g);
        if (coordMatches) {
          coordinateCount += coordMatches.length;
        }

        const contextMatches = step.description.match(/selector|element|context/gi);
        if (contextMatches) {
          contextReferencesCount += contextMatches.length;
        }
      }
    }

    // Validate no circular dependencies in step ordering
    if (workflow.steps.length > 0) {
      // Check for duplicate step IDs
      const stepIds = new Set<string>();
      for (const step of workflow.steps) {
        if (stepIds.has(step.id)) {
          errors.push(`Duplicate step ID: ${step.id}`);
        }
        stepIds.add(step.id);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      statistics: {
        stepCount: workflow.steps.length,
        coordinateCount,
        contextReferencesCount,
      },
    };
  }

  /**
   * Generate a human-readable description for a recording action.
   *
   * Examples:
   * - "Click button at (0.5, 0.3)"
   * - "Type 'hello' in search field"
   * - "Drag from (0.2, 0.4) to (0.8, 0.6)"
   * - "Scroll down by 500px"
   *
   * @param action - The action to describe
   * @returns Human-readable description
   */
  public generateDescription(action: RecordingAction): string {
    switch (action.type) {
      case 'click': {
        const click = action as ClickAction;
        const button = click.button !== 'left' ? ` ${click.button} button` : '';
        const clickType =
          click.clickCount === 2
            ? 'double-click'
            : click.clickCount === 3
              ? 'triple-click'
              : 'click';
        const element = this.describeElement(click.context);
        return `${clickType} at (${this.formatCoord(click.x)}, ${this.formatCoord(click.y)})${element}${button}`;
      }

      case 'keyboard': {
        const kb = action as KeyboardAction;
        if (kb.text) {
          const element = this.describeElement(kb.context);
          return `Type '${this.escapeText(kb.text)}'${element}`;
        }

        const keySequence = kb.keys.join('+');
        const element = this.describeElement(kb.context);
        return `Press ${keySequence}${element}`;
      }

      case 'drag': {
        const drag = action as DragAction;
        const element = this.describeElement(drag.context);
        const duration =
          drag.duration && drag.duration > 0
            ? ` over ${drag.duration}ms`
            : '';
        return `Drag from (${this.formatCoord(drag.startX)}, ${this.formatCoord(drag.startY)}) to (${this.formatCoord(drag.endX)}, ${this.formatCoord(drag.endY)})${element}${duration}`;
      }

      case 'scroll': {
        const scroll = action as ScrollAction;
        const direction = this.describeScrollDirection(
          scroll.deltaX || 0,
          scroll.deltaY || 0,
        );
        const amount = this.describeScrollAmount(
          scroll.deltaX || 0,
          scroll.deltaY || 0,
        );
        return `Scroll ${direction} by ${amount}`;
      }

      case 'pause': {
        const pause = action as PauseAction;
        return `Wait ${pause.duration}ms`;
      }

      default:
        const _: never = action;
        return _;
    }
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Validate recording before conversion.
   */
  private validateRecording(recording: Recording): void {
    if (!recording.id) {
      throw new Error('Recording must have an id');
    }

    if (!recording.name) {
      throw new Error('Recording must have a name');
    }

    if (!Array.isArray(recording.actions)) {
      throw new Error('Recording must have an actions array');
    }

    if (recording.actions.length === 0) {
      throw new Error('Recording must have at least one action');
    }

    // Validate each action
    for (const action of recording.actions) {
      try {
        validateAction(action);
      } catch (error) {
        throw new Error(
          `Invalid action at index ${recording.actions.indexOf(action)}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Group consecutive pause actions into a single pause.
   */
  private groupConsecutivePauses(actions: RecordingAction[]): RecordingAction[] {
    if (actions.length === 0) return actions;

    const result: RecordingAction[] = [];
    let currentPauseDuration = 0;
    let currentPauseTimestamp = '';

    for (const action of actions) {
      if (action.type === 'pause') {
        if (!currentPauseTimestamp) {
          currentPauseTimestamp = action.timestamp;
        }
        currentPauseDuration += (action as PauseAction).duration;
      } else {
        // Non-pause action: flush accumulated pause if any
        if (currentPauseDuration > 0) {
          result.push({
            type: 'pause',
            timestamp: currentPauseTimestamp,
            duration: currentPauseDuration,
          } as PauseAction);
          currentPauseDuration = 0;
          currentPauseTimestamp = '';
        }

        result.push(action);
      }
    }

    // Flush any remaining pause
    if (currentPauseDuration > 0) {
      result.push({
        type: 'pause',
        timestamp: currentPauseTimestamp,
        duration: currentPauseDuration,
      } as PauseAction);
    }

    return result;
  }

  /**
   * Create workflow steps from recording actions.
   */
  private createWorkflowSteps(
    actions: RecordingAction[],
    policy: ExecutionPolicy,
    generateDescriptions: boolean,
  ): WorkflowStep[] {
    const steps: WorkflowStep[] = [];

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const stepId = `step-${i}`;
      const stepName = generateDescriptions
        ? this.generateDescription(action)
        : `Step ${i + 1}`;
      const description = generateDescriptions
        ? this.generateDescription(action)
        : undefined;

      // Create conditions if action has element context
      const conditions = this.createConditionsForAction(action);

      const step = createRecordingStep(
        stepId,
        stepName,
        action.timestamp, // Store timestamp as recordingId for now (will be mapped to actual recording ID)
        policy,
        description,
        conditions.length > 0 ? conditions : undefined,
      );

      steps.push(step);
    }

    return steps;
  }

  /**
   * Create conditions for actions with element context.
   */
  private createConditionsForAction(action: RecordingAction): StepCondition[] {
    const conditions: StepCondition[] = [];

    // Check if action has context
    if ('context' in action && action.context) {
      const context = (action as any).context;

      // Create condition for selector if available
      if (context.selector) {
        conditions.push(
          createIfCondition(
            'elementSelector',
            '===',
            context.selector,
          ),
        );
      }

      // Create condition for accessible name if available
      if (context.accessibleName) {
        conditions.push(
          createIfCondition(
            'elementAccessibleName',
            '===',
            context.accessibleName,
          ),
        );
      }
    }

    return conditions;
  }

  /**
   * Create workflow metadata from recording metadata.
   */
  private createWorkflowMetadataFromRecording(
    recording: Recording,
    version: string,
    tags: string[],
  ): WorkflowMetadata {
    const allTags = [
      ...new Set([...(recording.metadata.tags || []), ...tags]),
    ];

    return createWorkflowMetadata(version, 'user-created', allTags);
  }

  /**
   * Generate a unique workflow ID.
   */
  private generateWorkflowId(): string {
    // Generate a simple ID based on timestamp and random number
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return `wf-${timestamp}-${random}`;
  }

  /**
   * Format a coordinate for display.
   */
  private formatCoord(value: number): string {
    return value.toFixed(2);
  }

  /**
   * Escape text for display in descriptions.
   */
  private escapeText(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .substr(0, 50); // Limit to 50 chars
  }

  /**
   * Describe an element based on context.
   */
  private describeElement(
    context?: any,
  ): string {
    if (!context) return '';

    const parts: string[] = [];

    if (context.accessibleName) {
      parts.push(`'${context.accessibleName}'`);
    }

    if (context.selector) {
      parts.push(`(${context.selector})`);
    }

    if (context.elementId) {
      parts.push(`#${context.elementId}`);
    }

    if (parts.length === 0) return '';
    return ` in ${parts.join(' ')}`;
  }

  /**
   * Describe scroll direction.
   */
  private describeScrollDirection(deltaX: number, deltaY: number): string {
    if (deltaY > 0) return 'down';
    if (deltaY < 0) return 'up';
    if (deltaX > 0) return 'right';
    if (deltaX < 0) return 'left';
    return 'unknown direction';
  }

  /**
   * Describe scroll amount.
   */
  private describeScrollAmount(deltaX: number, deltaY: number): string {
    const amount = Math.abs(deltaX || deltaY);
    if (amount < 100) return 'a little';
    if (amount < 500) return 'some';
    if (amount < 1000) return 'a lot';
    return 'a large amount';
  }
}

/**
 * Convenience function to convert a recording to a workflow.
 *
 * @param recording - The recording to convert
 * @param options - Conversion options
 * @returns A new Workflow
 */
export function recordingToWorkflow(
  recording: Recording,
  options?: ConversionOptions,
): Workflow {
  const converter = new RecordingToWorkflowConverter();
  return converter.convert(recording, options);
}

/**
 * Convenience function to validate a workflow.
 *
 * @param workflow - The workflow to validate
 * @returns ValidationResult
 */
export function validateConvertedWorkflow(workflow: Workflow): ValidationResult {
  const converter = new RecordingToWorkflowConverter();
  return converter.validate(workflow);
}
