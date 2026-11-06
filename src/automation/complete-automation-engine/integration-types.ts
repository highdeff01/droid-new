/**
 * Integration System Type Definitions
 *
 * Defines the complete type model for cross-system communication and coordination
 * between Recording, Workflow, Pack, and Habit systems. This module provides:
 *
 * - Event-driven messaging with discriminated unions for type safety
 * - ExecutionContext for state propagation through execution chains
 * - ContextPropagator for managing context flow
 * - FeedbackRecord for capturing user feedback
 * - LineageRecord for tracking parent-child relationships
 * - Support for event ordering, causality tracking, and async handling
 *
 * Architecture:
 * - All system changes emit events consumed by other systems
 * - Data flows through execution chains with context propagation
 * - User input drives learning and habit creation through feedback loops
 * - Complete history of all events and state changes for audit trail
 */

import type {
  Recording,
  RecordingAction,
  ActionContext,
} from './recording-types';
import type {
  Workflow,
  WorkflowStep,
} from './workflow-types';
import type {
  Pack,
} from './pack-types';
import type {
  Habit,
} from './habit-types';

/**
 * Unique identifier for events, executions, and messages.
 * Format: uuid v4 for global uniqueness and traceability.
 */
export type EntityId = string & { readonly __brand: 'EntityId' };

/**
 * ISO 8601 timestamp string (e.g., "2024-01-15T10:30:45.123Z")
 * All timestamps use UTC and include millisecond precision.
 */
export type Timestamp = string & { readonly __brand: 'Timestamp' };

/**
 * Helper functions for creating branded types
 */
export function createEntityId(value: string): EntityId {
  return value as EntityId;
}

export function createTimestamp(date: Date = new Date()): Timestamp {
  return date.toISOString() as Timestamp;
}

/**
 * Display state information for coordinate translation and adaptation.
 * Used during playback to denormalize coordinates from [0, 1] to actual screen positions.
 */
export interface DisplayState {
  /** Screen width in pixels */
  width: number;

  /** Screen height in pixels */
  height: number;

  /** Dots per inch (DPI) scaling factor, typically 1.0 or 1.5 for high-DPI */
  dpi?: number;

  /** Whether this is a multi-display setup */
  isMultiDisplay?: boolean;

  /** Index of display if multi-display (0 for primary) */
  displayIndex?: number;
}

/**
 * Snapshot of visible elements on screen at a point in time.
 * Used for context matching and element fallback during playback.
 */
export interface ElementSnapshot {
  /** CSS selector for the element */
  selector?: string;

  /** Accessible name from aria-label or semantic text */
  accessibleName?: string;

  /** Bounding box in normalized coordinates [0, 1] */
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  /** Whether element is visible on screen */
  isVisible: boolean;

  /** Optional element type or role */
  role?: string;
}

/**
 * Execution context carries state through the system, enabling:
 * - Coordinate adaptation across displays
 * - Context propagation through workflow chains
 * - State sharing between composed workflows
 * - Complete audit trail of execution path
 */
export interface ExecutionContext {
  /** Unique execution identifier for tracing */
  executionId: EntityId;

  /** Reference to recording if this execution originated from one */
  recordingId?: EntityId;

  /** Reference to workflow being executed */
  workflowId?: EntityId;

  /** Reference to pack containing the workflows */
  packId?: EntityId;

  /** Reference to habit being executed */
  habitId?: EntityId;

  /** Parent context if nested execution */
  parentContext?: ExecutionContext;

  /** Display state for coordinate adaptation */
  displayState: DisplayState;

  /** Snapshot of visible elements for fallback matching */
  visibleElements?: ElementSnapshot[];

  /** Current window title or application name */
  applicationName?: string;

  /** Current URL if web application */
  currentUrl?: string;

  /** Variables and data flowing through execution */
  variables: Record<string, any>;

  /** Execution path showing step IDs traversed */
  executionPath: string[];

  /** ISO 8601 timestamp when context was created */
  createdAt: Timestamp;

  /** Optional metadata about execution environment */
  metadata?: Record<string, any>;
}

/**
 * Result of executing a workflow or pack with complete details.
 * Returned after execution completes (success or failure).
 */
export interface ExecutionResult {
  /** Unique identifier for this execution */
  executionId: EntityId;

  /** Whether execution succeeded or failed */
  success: boolean;

  /** Total execution duration in milliseconds */
  durationMs: number;

  /** Output produced by execution */
  output?: any;

  /** Error details if execution failed */
  errors?: {
    /** Index or ID of failed step */
    stepId: string;

    /** Error message */
    message: string;

    /** Whether error is recoverable (could retry) */
    recoverable: boolean;

    /** Stack trace if available */
    stackTrace?: string;
  }[];

  /** Execution context used */
  context: ExecutionContext;

  /** Lineage information for audit trail */
  lineage: LineageRecord;

  /** Metrics collected during execution */
  metrics?: ExecutionMetrics;
}

/**
 * Metrics collected during workflow or pack execution.
 * Provides visibility into performance and behavior.
 */
export interface ExecutionMetrics {
  /** Number of steps executed successfully */
  stepsCompleted: number;

  /** Number of steps that failed */
  stepsFailed: number;

  /** Number of elements that could not be found */
  elementsNotFound: number;

  /** Number of coordinate adaptations applied */
  coordinateAdaptations: number;

  /** Number of fallback element matches attempted */
  fallbackMatches: number;

  /** Average duration per step in milliseconds */
  avgStepDurationMs?: number;
}

/**
 * Feedback from user on automation execution or suggestion.
 * Used to update confidence scores and habit learning.
 */
export interface FeedbackRecord {
  /** Unique feedback identifier */
  id: EntityId;

  /** Type of feedback */
  type: 'approve' | 'reject' | 'modify' | 'dismiss';

  /** Which execution this feedback is for */
  executionId: EntityId;

  /** ISO 8601 timestamp of feedback */
  timestamp: Timestamp;

  /** User explanation for the feedback */
  reason?: string;

  /** Step-by-step corrections if type is 'modify' */
  corrections?: Record<number, string>;

  /** Confidence adjustment hint for learning system */
  confidenceAdjustment?: number;
}

/**
 * Lineage record tracks parent-child relationships and data origins.
 * Enables complete traceability from Recording through Workflow, Pack, to Habit.
 */
export interface LineageRecord {
  /** ID of source recording if originated from user recording */
  recordingId?: EntityId;

  /** ID of source workflow */
  workflowId?: EntityId;

  /** ID of pack containing this execution */
  packId?: EntityId;

  /** ID of habit if extracted from workflow */
  habitId?: EntityId;

  /** Origin type for context */
  originSource: 'user-recording' | 'ai-generated' | 'habit-suggestion' | 'workflow-composition';

  /** ISO 8601 timestamp when lineage was created */
  createdAt: Timestamp;

  /** Author/creator of the automation */
  author?: string;

  /** Optional path showing data transformation chain */
  transformationPath?: string[];
}

/**
 * Base structure for all system events.
 * All events follow this structure with specific types as discriminated union.
 */
export interface BaseEvent {
  /** Unique event identifier */
  id: EntityId;

  /** Event type discriminator */
  type: string;

  /** ISO 8601 timestamp when event occurred */
  timestamp: Timestamp;

  /** System that originated the event */
  source: 'recording' | 'workflow' | 'pack' | 'habit' | 'learning' | 'user';

  /** ID of entity that originated this event */
  sourceId: EntityId;

  /** Parent event for causality tracking (e.g., ExecutionStartedEvent ID) */
  parentEventId?: EntityId;

  /** Complete context at time of event */
  context?: Record<string, any>;

  /** Optional metadata about the event */
  metadata?: Record<string, any>;
}

/**
 * Emitted when user completes recording an action.
 * Fired for each individual action captured during recording.
 */
export interface RecordingCapturedEvent extends BaseEvent {
  type: 'RecordingCaptured';
  source: 'recording';

  /** ID of the recording in progress */
  recordingId: EntityId;

  /** The captured action */
  action: RecordingAction;

  /** Current count of actions in recording */
  actionCount: number;

  /** Current recording duration in milliseconds */
  durationMs: number;
}

/**
 * Emitted when recording is completed and converted to workflow.
 * Signals that workflow is ready for packing and reuse.
 */
export interface WorkflowCreatedEvent extends BaseEvent {
  type: 'WorkflowCreated';
  source: 'workflow';

  /** ID of the created workflow */
  workflowId: EntityId;

  /** ID of source recording if created from recording */
  recordingId?: EntityId;

  /** Total number of steps in workflow */
  stepCount: number;

  /** Total duration of workflow in milliseconds */
  durationMs: number;

  /** Whether workflow contains conditional branches */
  hasConditions: boolean;
}

/**
 * Emitted when workflow is executed (start).
 * Paired with ExecutionCompleteEvent to track execution lifecycle.
 */
export interface WorkflowExecutionStartedEvent extends BaseEvent {
  type: 'WorkflowExecutionStarted';
  source: 'workflow';

  /** ID of the workflow being executed */
  workflowId: EntityId;

  /** Unique ID for this execution */
  executionId: EntityId;

  /** Execution context with variables and state */
  context: ExecutionContext;
}

/**
 * Emitted when workflow execution completes.
 * Provides execution result and triggers learning updates.
 */
export interface WorkflowExecutionCompleteEvent extends BaseEvent {
  type: 'WorkflowExecutionComplete';
  source: 'workflow';

  /** ID of the workflow executed */
  workflowId: EntityId;

  /** Unique ID for this execution */
  executionId: EntityId;

  /** Whether execution succeeded */
  success: boolean;

  /** Execution result with metrics and errors */
  result: ExecutionResult;
}

/**
 * Emitted when pack is modified (workflows added/removed/metadata changed).
 * Triggers version bumping and notification of consumers.
 */
export interface PackModifiedEvent extends BaseEvent {
  type: 'PackModified';
  source: 'pack';

  /** ID of the modified pack */
  packId: EntityId;

  /** Type of modification */
  modification: 'workflow-added' | 'workflow-removed' | 'metadata-updated' | 'version-updated';

  /** Previous version before modification */
  previousVersion: string;

  /** New version after modification */
  newVersion: string;

  /** IDs of workflows affected */
  affectedWorkflows?: EntityId[];
}

/**
 * Emitted when pack deployment starts.
 * Marks the beginning of pack execution.
 */
export interface PackDeploymentStartedEvent extends BaseEvent {
  type: 'PackDeploymentStarted';
  source: 'pack';

  /** ID of the pack being deployed */
  packId: EntityId;

  /** Unique ID for this deployment */
  deploymentId: EntityId;

  /** Pack version being deployed */
  version: string;

  /** Execution context for the deployment */
  context: ExecutionContext;

  /** Number of workflows in pack */
  workflowCount: number;
}

/**
 * Emitted when pack deployment completes.
 * Provides overall results and triggers habit extraction.
 */
export interface PackDeploymentCompleteEvent extends BaseEvent {
  type: 'PackDeploymentComplete';
  source: 'pack';

  /** ID of the deployed pack */
  packId: EntityId;

  /** Unique ID for this deployment */
  deploymentId: EntityId;

  /** Whether all workflows succeeded */
  success: boolean;

  /** Results for each workflow in order */
  workflowResults: Array<{
    workflowId: EntityId;
    success: boolean;
    durationMs: number;
    output?: any;
    error?: string;
  }>;

  /** Total deployment duration */
  totalDurationMs: number;

  /** IDs of workflows from which to extract habits */
  habitsToExtract?: EntityId[];
}

/**
 * Emitted when habits are extracted from successful workflows.
 * Triggers habit learning and confidence initialization.
 */
export interface HabitsExtractedEvent extends BaseEvent {
  type: 'HabitsExtracted';
  source: 'learning';

  /** IDs of extracted habits */
  habitIds: EntityId[];

  /** Execution that produced these habits */
  sourceExecutionId: EntityId;

  /** Confidence scores for each extracted habit */
  confidenceScores: number[];

  /** Number of workflows analyzed */
  workflowsAnalyzed: number;
}

/**
 * Emitted when habit matches current context and is suggested to user.
 * Triggers UI notification and feedback collection.
 */
export interface HabitSuggestedEvent extends BaseEvent {
  type: 'HabitSuggested';
  source: 'habit';

  /** ID of the suggested habit */
  habitId: EntityId;

  /** Confidence score [0, 100] */
  confidenceScore: number;

  /** Which context conditions matched */
  matchedConditions: string[];

  /** Recommended action: execute, prompt, or hint */
  suggestedAction: 'execute' | 'prompt-user' | 'display-hint';

  /** Optional explanation for user */
  explanation?: string;
}

/**
 * Emitted when user responds to habit suggestion.
 * Provides feedback for confidence updates.
 */
export interface HabitActedUponEvent extends BaseEvent {
  type: 'HabitActedUpon';
  source: 'user';

  /** ID of the habit */
  habitId: EntityId;

  /** User action on the suggestion */
  action: 'accepted' | 'dismissed' | 'executed' | 'corrected';

  /** Whether execution was successful if 'executed' */
  success?: boolean;

  /** Step corrections if action is 'corrected' */
  corrections?: Record<number, string>;

  /** User feedback on the suggestion */
  feedback?: FeedbackRecord;
}

/**
 * Emitted when error occurs during execution.
 * Captured for debugging and error recovery.
 */
export interface ErrorOccurredEvent extends BaseEvent {
  type: 'ErrorOccurred';
  source: 'recording' | 'workflow' | 'pack' | 'habit' | 'learning';

  /** Step or component that failed */
  failedComponent?: string;

  /** Error message */
  message: string;

  /** Error severity: info, warning, error, critical */
  severity: 'info' | 'warning' | 'error' | 'critical';

  /** Whether error is recoverable */
  recoverable: boolean;

  /** Suggested recovery action */
  suggestedRecovery?: string;

  /** Stack trace if available */
  stackTrace?: string;
}

/**
 * Emitted when context is propagated from one system to another.
 * Tracks data flow through execution chains.
 */
export interface ContextPropagatedEvent extends BaseEvent {
  type: 'ContextPropagated';
  source: 'workflow' | 'pack' | 'habit';

  /** Entity ID sending context */
  fromId: EntityId;

  /** Entity ID receiving context */
  toId: EntityId;

  /** Type of sending entity */
  fromType: 'workflow' | 'pack' | 'habit' | 'execution';

  /** Type of receiving entity */
  toType: 'workflow' | 'pack' | 'habit' | 'execution';

  /** Partial context being propagated */
  propagatedContext: Partial<ExecutionContext>;

  /** What was transformed during propagation */
  transformations?: string[];
}

/**
 * Discriminated union of all system events.
 * Use type guards to narrow to specific event type.
 */
export type SystemEvent =
  | RecordingCapturedEvent
  | WorkflowCreatedEvent
  | WorkflowExecutionStartedEvent
  | WorkflowExecutionCompleteEvent
  | PackModifiedEvent
  | PackDeploymentStartedEvent
  | PackDeploymentCompleteEvent
  | HabitsExtractedEvent
  | HabitSuggestedEvent
  | HabitActedUponEvent
  | ErrorOccurredEvent
  | ContextPropagatedEvent;

/**
 * Type guard to check if event is a specific type.
 * Usage: if (isEventType(event, 'WorkflowCreated')) { ... }
 */
export function isEventType<T extends SystemEvent['type']>(
  event: SystemEvent,
  type: T
): event is SystemEvent & { type: T } {
  return event.type === type;
}

/**
 * Manages context propagation through execution chains.
 * Handles context flow, variable passing, and coordinate adaptation.
 */
export interface ContextPropagator {
  /** Create new execution context */
  createContext(
    executionId: EntityId,
    displayState: DisplayState,
    variables?: Record<string, any>
  ): ExecutionContext;

  /** Extend context with parent context */
  extendContext(
    baseContext: ExecutionContext,
    parentContext?: ExecutionContext
  ): ExecutionContext;

  /** Add variable to context */
  setVariable(context: ExecutionContext, key: string, value: any): ExecutionContext;

  /** Get variable from context */
  getVariable(context: ExecutionContext, key: string): any;

  /** Propagate context to child workflow */
  propagateToChild(
    parentContext: ExecutionContext,
    childExecutionId: EntityId
  ): ExecutionContext;

  /** Adapt context for different display state */
  adaptForDisplay(
    context: ExecutionContext,
    newDisplayState: DisplayState
  ): ExecutionContext;

  /** Get complete execution path */
  getExecutionPath(context: ExecutionContext): string[];

  /** Clone context immutably */
  clone(context: ExecutionContext): ExecutionContext;
}

/**
 * Event dispatcher manages pub/sub for system events.
 * Enables loose coupling between systems through event messaging.
 */
export interface EventDispatcher {
  /** Subscribe to specific event type */
  on<T extends SystemEvent['type']>(
    eventType: T,
    handler: (event: SystemEvent & { type: T }) => void | Promise<void>
  ): () => void; // Returns unsubscribe function

  /** Subscribe to all events */
  onAll(handler: (event: SystemEvent) => void | Promise<void>): () => void;

  /** Emit event to all subscribers */
  emit(event: SystemEvent): Promise<void>;

  /** Get event history */
  getHistory(filter?: { type?: string; sourceId?: EntityId }): SystemEvent[];

  /** Clear old events from history */
  clearHistory(olderThan?: Timestamp): void;
}

/**
 * Helper function to create execution context.
 * Validates display state and initializes empty variables.
 */
export function createExecutionContext(
  executionId: EntityId,
  displayState: DisplayState,
  variables?: Record<string, any>
): ExecutionContext {
  return {
    executionId,
    displayState,
    variables: variables || {},
    executionPath: [],
    createdAt: createTimestamp(),
  };
}

/**
 * Helper function to create ExecutionResult.
 * Builds complete result with context and lineage.
 */
export function createExecutionResult(
  executionId: EntityId,
  success: boolean,
  durationMs: number,
  context: ExecutionContext,
  lineage: LineageRecord,
  output?: any,
  errors?: ExecutionResult['errors'],
  metrics?: ExecutionMetrics
): ExecutionResult {
  return {
    executionId,
    success,
    durationMs,
    output,
    errors,
    context,
    lineage,
    metrics,
  };
}

/**
 * Helper function to create FeedbackRecord.
 */
export function createFeedbackRecord(
  id: EntityId,
  type: FeedbackRecord['type'],
  executionId: EntityId,
  reason?: string,
  corrections?: Record<number, string>,
  confidenceAdjustment?: number
): FeedbackRecord {
  return {
    id,
    type,
    executionId,
    timestamp: createTimestamp(),
    reason,
    corrections,
    confidenceAdjustment,
  };
}

/**
 * Helper function to create LineageRecord.
 */
export function createLineageRecord(
  originSource: LineageRecord['originSource'],
  recordingId?: EntityId,
  workflowId?: EntityId,
  packId?: EntityId,
  habitId?: EntityId,
  author?: string,
  transformationPath?: string[]
): LineageRecord {
  return {
    recordingId,
    workflowId,
    packId,
    habitId,
    originSource,
    createdAt: createTimestamp(),
    author,
    transformationPath,
  };
}

/**
 * Helper function to create WorkflowCreatedEvent.
 */
export function createWorkflowCreatedEvent(
  workflowId: EntityId,
  stepCount: number,
  durationMs: number,
  recordingId?: EntityId,
  hasConditions?: boolean
): WorkflowCreatedEvent {
  return {
    id: createEntityId(Math.random().toString(36).slice(2)),
    type: 'WorkflowCreated',
    source: 'workflow',
    timestamp: createTimestamp(),
    sourceId: workflowId,
    workflowId,
    recordingId,
    stepCount,
    durationMs,
    hasConditions: hasConditions || false,
  };
}

/**
 * Helper function to create PackDeploymentCompleteEvent.
 */
export function createPackDeploymentCompleteEvent(
  packId: EntityId,
  deploymentId: EntityId,
  success: boolean,
  workflowResults: PackDeploymentCompleteEvent['workflowResults'],
  totalDurationMs: number,
  habitsToExtract?: EntityId[]
): PackDeploymentCompleteEvent {
  return {
    id: createEntityId(Math.random().toString(36).slice(2)),
    type: 'PackDeploymentComplete',
    source: 'pack',
    timestamp: createTimestamp(),
    sourceId: packId,
    packId,
    deploymentId,
    success,
    workflowResults,
    totalDurationMs,
    habitsToExtract,
  };
}

/**
 * Helper function to create HabitSuggestedEvent.
 */
export function createHabitSuggestedEvent(
  habitId: EntityId,
  confidenceScore: number,
  matchedConditions: string[],
  suggestedAction: HabitSuggestedEvent['suggestedAction'],
  explanation?: string
): HabitSuggestedEvent {
  return {
    id: createEntityId(Math.random().toString(36).slice(2)),
    type: 'HabitSuggested',
    source: 'habit',
    timestamp: createTimestamp(),
    sourceId: habitId,
    habitId,
    confidenceScore,
    matchedConditions,
    suggestedAction,
    explanation,
  };
}

/**
 * Helper function to create ErrorOccurredEvent.
 */
export function createErrorOccurredEvent(
  sourceId: EntityId,
  source: ErrorOccurredEvent['source'],
  message: string,
  severity: ErrorOccurredEvent['severity'],
  failedComponent?: string,
  recoverable?: boolean,
  suggestedRecovery?: string,
  stackTrace?: string
): ErrorOccurredEvent {
  return {
    id: createEntityId(Math.random().toString(36).slice(2)),
    type: 'ErrorOccurred',
    source,
    timestamp: createTimestamp(),
    sourceId,
    message,
    severity,
    failedComponent,
    recoverable: recoverable !== false,
    suggestedRecovery,
    stackTrace,
  };
}
