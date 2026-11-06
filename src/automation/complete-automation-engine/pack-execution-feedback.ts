/**
 * Pack Execution Feedback Loop
 *
 * Implements the execution feedback loop for pack deployments:
 * - Consumes PackDeploymentCompleteEvent from pack deployments
 * - Records execution metrics and results
 * - Identifies workflows to extract habits from
 * - Emits ExecutionCompleteEvent with habit extraction list
 *
 * Integration Points:
 * - Uses EventDispatcher to consume PackDeploymentCompleteEvent
 * - Emits ExecutionCompleteEvent with habit extraction list
 * - Integrates with Learning & Habits system for habit extraction
 * - Updates execution history and metrics
 *
 * Architecture:
 * - Event-driven feedback collection from pack deployments
 * - Metrics recording with detailed execution statistics
 * - Habit extraction identification from successful workflows
 * - Context propagation for coordinate adaptation and lineage tracking
 */

import type { EventDispatcher } from './event-dispatcher';
import type { PackDeploymentCompleteEvent, PackExecutionRecord, PackDeploymentStartedEvent } from './integration-types';
import type { ExecutionMetrics, ExecutionResult, ExecutionContext, LineageRecord } from './integration-types';
import type { Habit } from './habit-types';
import type { EntityId, Timestamp } from './integration-types';

/**
 * Execution status for pack deployments.
 */
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Execution feedback record with complete metrics and results.
 * Stores execution data for analytics, learning, and history.
 */
export interface ExecutionFeedbackRecord {
  /** Unique execution identifier */
  executionId: EntityId;

  /** Source of execution (workflow, pack, habit) */
  source: 'workflow' | 'pack' | 'habit';

  /** Source entity ID */
  sourceId: EntityId;

  /** Execution status */
  status: ExecutionStatus;

  /** ISO 8601 timestamp when execution started */
  startedAt: Timestamp;

  /** ISO 8601 timestamp when execution completed */
  completedAt?: Timestamp;

  /** Execution duration in milliseconds */
  durationMs: number;

  /** Whether execution succeeded */
  success: boolean;

  /** Metrics collected during execution */
  metrics: ExecutionMetrics;

  /** Results for each step/workflow */
  stepResults: Array<{
    stepId: string;
    success: boolean;
    durationMs: number;
    output?: any;
    error?: string;
  }>;

  /** Errors encountered during execution */
  errors: Array<{
    stepId: string;
    message: string;
    recoverable: boolean;
  }>;

  /** Habits extracted from this execution */
  habitsExtracted?: EntityId[];

  /** Lineage information for audit trail */
  lineage: LineageRecord;

  /** Context used for execution */
  context: ExecutionContext;
}

/**
 * Metrics aggregation for execution feedback.
 * Tracks summary statistics across multiple executions.
 */
export interface ExecutionMetricsSummary {
  /** Total number of executions */
  totalCount: number;

  /** Number of successful executions */
  successCount: number;

  /** Number of failed executions */
  failureCount: number;

  /** Average duration in milliseconds */
  avgDurationMs: number;

  /** Minimum duration in milliseconds */
  minDurationMs: number;

  /** Maximum duration in milliseconds */
  maxDurationMs: number;

  /** Average steps completed */
  avgStepsCompleted: number;

  /** Average steps failed */
  avgStepsFailed: number;

  /** Timestamp of most recent execution */
  lastExecutionAt?: Timestamp;
}

/**
 * Habit extraction configuration.
 * Controls which workflows are selected for habit extraction.
 */
export interface HabitExtractionConfig {
  /** Minimum success rate to trigger habit extraction (0..1) */
  minSuccessRate: number;

  /** Minimum number of steps for extraction */
  minStepCount: number;

  /** Maximum number of habits to extract per execution */
  maxHabitsPerExecution: number;

  /** Whether to extract from failed workflows */
  extractFromFailures: boolean;

  /** Context requirements for extraction */
  contextRequirements?: {
    minContextConfidence: number;
    requiredTags?: string[];
  };
}

/**
 * Pack execution feedback processor.
 * Consumes deployment events, records metrics, and manages habit extraction.
 */
export class PackExecutionFeedbackProcessor {
  private readonly eventDispatcher: EventDispatcher;
  private readonly executionRecords: Map<EntityId, ExecutionFeedbackRecord> = new Map();
  private readonly metricsSummary: Map<EntityId, ExecutionMetricsSummary> = new Map();
  private readonly habitExtractionConfig: HabitExtractionConfig;

  /**
   * Creates a new pack execution feedback processor.
   *
   * @param eventDispatcher - Event dispatcher for consuming/emit events
   * @param config - Habit extraction configuration
   */
  constructor(
    eventDispatcher: EventDispatcher,
    config?: Partial<HabitExtractionConfig>
  ) {
    this.eventDispatcher = eventDispatcher;
    this.habitExtractionConfig = {
      minSuccessRate: 0.8,
      minStepCount: 3,
      maxHabitsPerExecution: 10,
      extractFromFailures: false,
      contextRequirements: {
        minContextConfidence: 0.7,
        requiredTags: [],
      },
      ...config,
    };

    // Subscribe to PackDeploymentCompleteEvent
    this.eventDispatcher.subscribe<PackDeploymentCompleteEvent>(
      this.handlePackDeploymentComplete.bind(this),
      { eventType: 'PackDeploymentComplete' }
    );
  }

  /**
   * Handles PackDeploymentCompleteEvent from pack deployments.
   *
   * This is the main entry point for the feedback loop:
   * 1. Records execution metrics and results
   * 2. Identifies workflows to extract habits from
   * 3. Updates execution history
   * 4. Emits ExecutionCompleteEvent with habit extraction list
   *
   * @param event - PackDeploymentCompleteEvent from deployment
   */
  private handlePackDeploymentComplete(event: PackDeploymentCompleteEvent): void {
    // Record execution metrics
    const executionRecord = this.recordExecutionMetrics(event);

    // Identify habits to extract
    const habitsToExtract = this.identifyHabitsToExtract(event, executionRecord);

    // Update execution history
    this.executionRecords.set(executionRecord.executionId, executionRecord);

    // Emit ExecutionCompleteEvent with habit extraction list
    this.emitExecutionCompleteEvent(event, executionRecord, habitsToExtract);

    // Update metrics summary
    this.updateMetricsSummary(executionRecord);
  }

  /**
   * Records execution metrics and results from deployment event.
   *
   * @param event - PackDeploymentCompleteEvent
   * @returns ExecutionFeedbackRecord with complete metrics
   */
  private recordExecutionMetrics(event: PackDeploymentCompleteEvent): ExecutionFeedbackRecord {
    const startTime = new Date(event.timestamp).getTime();
    const endTime = Date.now();
    const durationMs = endTime - startTime;

    // Calculate metrics from workflow results
    const stepsCompleted = event.workflowResults.filter(r => r.success).length;
    const stepsFailed = event.workflowResults.filter(r => !r.success).length;
    const elementsNotFound = 0; // Would be calculated from workflow execution logs
    const coordinateAdaptations = 0; // Would be tracked during deployment

    const metrics: ExecutionMetrics = {
      stepsCompleted,
      stepsFailed,
      elementsNotFound,
      coordinateAdaptations,
      fallbackMatches: 0,
      avgStepDurationMs: durationMs / event.workflowResults.length,
    };

    // Build step results
    const stepResults = event.workflowResults.map((result, index) => ({
      stepId: result.workflowId,
      success: result.success,
      durationMs: result.durationMs,
      output: result.output,
      error: result.error,
    }));

    // Build error records
    const errors = event.workflowResults
      .filter(r => !r.success)
      .map(result => ({
        stepId: result.workflowId,
        message: result.error || 'Unknown error',
        recoverable: false, // Would be determined by error analysis
      }));

    // Create lineage record
    const lineage: LineageRecord = {
      recordingId: undefined, // Would be populated from pack metadata
      workflowId: undefined, // Would be populated from pack metadata
      packId: event.packId,
      habitId: undefined,
      originSource: 'user-recording',
      createdAt: event.timestamp as Timestamp,
      author: 'system',
    };

    // Create context (partial - would have full context from deployment)
    const context: ExecutionContext = {
      executionId: event.deploymentId,
      packId: event.packId,
      displayState: {
        width: 1920,
        height: 1080,
      },
      variables: {},
      executionPath: event.workflowResults.map(r => r.workflowId),
      createdAt: event.timestamp as Timestamp,
    };

    const executionRecord: ExecutionFeedbackRecord = {
      executionId: event.deploymentId,
      source: 'pack',
      sourceId: event.packId,
      status: event.success ? 'completed' : 'failed',
      startedAt: event.timestamp as Timestamp,
      completedAt: new Date().toISOString() as Timestamp,
      durationMs,
      success: event.success,
      metrics,
      stepResults,
      errors,
      lineage,
      context,
    };

    return executionRecord;
  }

  /**
   * Identifies workflows to extract habits from.
   *
   * Applies the habit extraction configuration:
   * - Minimum success rate threshold
   * - Minimum step count requirements
   * - Maximum habits per execution
   *
   * @param event - PackDeploymentCompleteEvent
   * @param executionRecord - Recorded execution feedback
   * @returns Array of workflow IDs to extract habits from
   */
  private identifyHabitsToExtract(
    event: PackDeploymentCompleteEvent,
    executionRecord: ExecutionFeedbackRecord
  ): EntityId[] {
    const habitsToExtract: EntityId[] = [];

    // Check if overall execution meets minimum success rate
    const successRate = executionRecord.metrics.stepsCompleted /
      (executionRecord.metrics.stepsCompleted + executionRecord.metrics.stepsFailed);

    if (successRate < this.habitExtractionConfig.minSuccessRate && !this.habitExtractionConfig.extractFromFailures) {
      // Overall success rate too low, skip habit extraction
      return [];
    }

    // Process each workflow result
    let extractedCount = 0;
    for (const workflowResult of event.workflowResults) {
      if (extractedCount >= this.habitExtractionConfig.maxHabitsPerExecution) {
        break;
      }

      // Skip failed workflows unless configured to extract from failures
      if (!workflowResult.success && !this.habitExtractionConfig.extractFromFailures) {
        continue;
      }

      // Check minimum step count
      // Note: In practice, would track step count per workflow during execution
      // For now, assume workflows with output are worth extracting
      if (workflowResult.success && workflowResult.output !== undefined) {
        habitsToExtract.push(workflowResult.workflowId);
        extractedCount++;
      }
    }

    return habitsToExtract;
  }

  /**
   * Emits ExecutionCompleteEvent with habit extraction list.
   *
   * This event triggers the Learning & Habits system to extract
   * patterns and create new habits from successful workflows.
   *
   * @param event - Original PackDeploymentCompleteEvent
   * @param executionRecord - Recorded execution feedback
   * @param habitsToExtract - Array of workflow IDs to extract habits from
   */
  private emitExecutionCompleteEvent(
    event: PackDeploymentCompleteEvent,
    executionRecord: ExecutionFeedbackRecord,
    habitsToExtract: EntityId[]
  ): void {
    // Create ExecutionCompleteEvent
    const executionCompleteEvent: PackDeploymentCompleteEvent = {
      id: this.generateId(),
      type: 'ExecutionComplete',
      timestamp: new Date().toISOString() as Timestamp,
      source: 'pack',
      sourceId: event.packId,
      packId: event.packId,
      deploymentId: event.deploymentId,
      success: event.success,
      workflowResults: event.workflowResults,
      totalDurationMs: executionRecord.durationMs,
      habitsToExtract: habitsToExtract.length > 0 ? habitsToExtract : undefined,
    };

    // Emit event to trigger learning
    this.eventDispatcher.emit(executionCompleteEvent as any);
  }

  /**
   * Updates execution metrics summary for analytics.
   *
   * @param executionRecord - Execution feedback record
   */
  private updateMetricsSummary(executionRecord: ExecutionFeedbackRecord): void {
    const summaryKey = executionRecord.sourceId;
    let summary = this.metricsSummary.get(summaryKey);

    if (!summary) {
      summary = {
        totalCount: 0,
        successCount: 0,
        failureCount: 0,
        avgDurationMs: 0,
        minDurationMs: Infinity,
        maxDurationMs: -Infinity,
        avgStepsCompleted: 0,
        avgStepsFailed: 0,
      };
    }

    // Update counts
    summary.totalCount++;
    if (executionRecord.success) {
      summary.successCount++;
    } else {
      summary.failureCount++;
    }

    // Update duration statistics (running average and min/max)
    summary.minDurationMs = Math.min(summary.minDurationMs, executionRecord.durationMs);
    summary.maxDurationMs = Math.max(summary.maxDurationMs, executionRecord.durationMs);
    summary.avgDurationMs =
      (summary.avgDurationMs * (summary.totalCount - 1) + executionRecord.durationMs) / summary.totalCount;

    // Update step statistics
    summary.avgStepsCompleted =
      (summary.avgStepsCompleted * (summary.totalCount - 1) + executionRecord.metrics.stepsCompleted) / summary.totalCount;
    summary.avgStepsFailed =
      (summary.avgStepsFailed * (summary.totalCount - 1) + executionRecord.metrics.stepsFailed) / summary.totalCount;

    summary.lastExecutionAt = executionRecord.completedAt || executionRecord.startedAt;

    this.metricsSummary.set(summaryKey, summary);
  }

  /**
   * Gets execution feedback record for a specific execution.
   *
   * @param executionId - Execution identifier
   * @returns ExecutionFeedbackRecord or undefined if not found
   */
  getExecutionRecord(executionId: EntityId): ExecutionFeedbackRecord | undefined {
    return this.executionRecords.get(executionId);
  }

  /**
   * Gets metrics summary for a pack.
   *
   * @param packId - Pack identifier
   * @returns ExecutionMetricsSummary or undefined if not found
   */
  getMetricsSummary(packId: EntityId): ExecutionMetricsSummary | undefined {
    return this.metricsSummary.get(packId);
  }

  /**
   * Gets all execution feedback records.
   *
   * @returns Array of all execution feedback records
   */
  getAllExecutionRecords(): ExecutionFeedbackRecord[] {
    return Array.from(this.executionRecords.values());
  }

  /**
   * Gets all metrics summaries.
   *
   * @returns Array of all metrics summaries
   */
  getAllMetricsSummaries(): ExecutionMetricsSummary[] {
    return Array.from(this.metricsSummary.values());
  }

  /**
   * Generates a unique execution ID.
   *
   * @returns Unique execution identifier
   */
  private generateId(): string {
    return 'exec_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
  }
}

/**
 * Creates a new pack execution feedback processor.
 *
 * @param eventDispatcher - Event dispatcher for consuming/emit events
 * @param config - Habit extraction configuration
 * @returns PackExecutionFeedbackProcessor instance
 */
export function createPackExecutionFeedbackProcessor(
  eventDispatcher: EventDispatcher,
  config?: Partial<HabitExtractionConfig>
): PackExecutionFeedbackProcessor {
  return new PackExecutionFeedbackProcessor(eventDispatcher, config);
}

/**
 * Calculates execution success rate from metrics.
 *
 * @param metrics - ExecutionMetrics
 * @returns Success rate as number between 0 and 1
 */
export function calculateSuccessRate(metrics: ExecutionMetrics): number {
  const totalSteps = metrics.stepsCompleted + metrics.stepsFailed;
  if (totalSteps === 0) {
    return 0;
  }
  return metrics.stepsCompleted / totalSteps;
}

/**
 * Calculates execution efficiency from metrics.
 *
 * Efficiency is a combined metric considering:
 * - Success rate (weight: 0.5)
 * - Average step duration (weight: 0.3)
 * - Step count (weight: 0.2)
 *
 * @param metrics - ExecutionMetrics
 * @returns Efficiency score between 0 and 100
 */
export function calculateEfficiencyScore(metrics: ExecutionMetrics): number {
  // Success rate component (50%)
  const successRate = calculateSuccessRate(metrics);
  const successComponent = successRate * 50;

  // Speed component (30%) - faster is better, capped at 100ms per step
  const avgStepDuration = metrics.avgStepDurationMs || 0;
  const speedComponent = Math.max(0, 30 * (1 - avgStepDuration / 100));

  // Step count component (20%) - more steps is better (up to 100)
  const stepCountComponent = Math.min(20, (metrics.stepsCompleted + metrics.stepsFailed) / 5);

  return Math.round(Math.max(0, Math.min(100, successComponent + speedComponent + stepCountComponent)));
}
