/**
 * Batch Operations and Scheduling Module
 *
 * Provides comprehensive batch operation capabilities for the automation engine:
 * - Queue multiple packs for sequential deployment
 * - Display queue position and estimated completion
 * - Handle batch failure scenarios with recovery mechanisms
 * - Aggregate results from batch executions
 * - Support periodic workflow scheduling with cron expressions
 * - Implement backoff strategies for scheduled tasks
 *
 * Key concepts:
 * - BatchOperation: Represents a queued batch of packs for sequential execution
 * - BatchExecutor: Manages batch queuing, execution, and status tracking
 * - SchedulingService: Handles periodic workflow scheduling with cron expressions
 * - Backoff strategies: Linear, exponential, and custom backoff for retries
 */

import type {
  Pack,
} from '../pack-types';

// ============================================================================
// BATCH OPERATION TYPES
// ============================================================================

/**
 * Status of a batch operation.
 */
export type BatchStatus = 
  | 'pending'      // Batch is queued but not yet started
  | 'running'      // Batch execution is in progress
  | 'completed'    // All packs executed successfully
  | 'failed'       // Batch failed and stopped (stopOnError=true)
  | 'partial'      // Some packs succeeded, some failed (stopOnError=false)
  | 'cancelled';   // Batch was cancelled by user

/**
 * Options for batch creation and execution.
 */
export interface BatchOptions {
  /** Whether to continue execution after failures (default: false) */
  continueOnError?: boolean;

  /** Maximum concurrent packs for parallel execution (default: 1 for sequential) */
  maxConcurrency?: number;

  /** Custom context to pass to all packs in the batch */
  context?: Record<string, unknown>;

  /** Timeout for the entire batch in milliseconds */
  timeoutMs?: number;

  /** Auto-start the batch when created (default: false) */
  autoStart?: boolean;
}

/**
 * Results from executing a single pack in a batch.
 */
export interface PackExecutionResult {
  /** ID of the executed pack */
  packId: string;

  /** Pack name for display purposes */
  packName?: string;

  /** Execution status */
  status: 'success' | 'failed' | 'skipped';

  /** ISO 8601 timestamp when execution started */
  startedAt: string;

  /** ISO 8601 timestamp when execution completed */
  completedAt: string;

  /** Duration in milliseconds */
  durationMs: number;

  /** Number of workflows executed */
  workflowsExecuted: number;

  /** Number of workflows succeeded */
  workflowsSucceeded: number;

  /** Number of workflows failed */
  workflowsFailed: number;

  /** Error details if execution failed */
  error?: string;

  /** Stack trace for debugging */
  stackTrace?: string;

  /** Custom results from workflows */
  results?: Record<string, unknown>[];
}

/**
 * Results from executing an entire batch.
 */
export interface BatchResult {
  /** Batch operation ID */
  batchId: string;

  /** Batch status */
  status: BatchStatus;

  /** ISO 8601 timestamp when batch was created */
  createdAt: string;

  /** ISO 8601 timestamp when batch execution started */
  startedAt?: string;

  /** ISO 8601 timestamp when batch execution completed */
  completedAt?: string;

  /** Total duration in milliseconds */
  durationMs?: number;

  /** Array of pack execution results */
  packResults: PackExecutionResult[];

  /** Total number of packs in batch */
  totalPacks: number;

  /** Number of packs that succeeded */
  succeededPacks: number;

  /** Number of packs that failed */
  failedPacks: number;

  /** Number of packs that were skipped */
  skippedPacks: number;

  /** Overall success rate as percentage */
  successRate: number;

  /** Aggregate metrics for all workflows in batch */
  workflowMetrics: {
    total: number;
    succeeded: number;
    failed: number;
    averageDuration?: number;
  };

  /** Error details if batch failed */
  error?: string;

  /** Stack trace for debugging */
  stackTrace?: string;
}

/**
 * Queue statistics for monitoring batch operations.
 */
export interface QueueStats {
  /** Total number of batches in queue */
  totalBatches: number;

  /** Number of pending batches */
  pendingBatches: number;

  /** Number of running batches */
  runningBatches: number;

  /** Number of completed batches */
  completedBatches: number;

  /** Number of failed batches */
  failedBatches: number;

  /** Number of cancelled batches */
  cancelledBatches: number;

  /** Average wait time in milliseconds for completed batches */
  averageWaitTime?: number;

  /** Average execution time in milliseconds for completed batches */
  averageExecutionTime?: number;

  /** Success rate as percentage */
  successRate: number;
}

/**
 * Current batch operation record.
 */
export interface BatchOperation {
  /** Unique batch identifier */
  batchId: string;

  /** Array of pack IDs to execute */
  packIds: string[];

  /** Batch status */
  status: BatchStatus;

  /** ISO 8601 timestamp when batch was created */
  createdAt: string;

  /** ISO 8601 timestamp when execution started */
  startedAt?: string;

  /** ISO 8601 timestamp when execution completed */
  completedAt?: string;

  /** Position in queue (1-based) */
  position: number;

  /** Options used for this batch */
  options: BatchOptions;

  /** Current progress (0..100) */
  progress: number;

  /** Estimated completion time (if known) */
  estimatedCompletion?: string;

  /** Pack execution results */
  results?: PackExecutionResult[];

  /** Error details if failed */
  error?: string;
}

// ============================================================================
// SCHEDULING TYPES
// ============================================================================

/**
 * Backoff strategy for scheduled task retries.
 */
export type BackoffStrategy = 'linear' | 'exponential' | 'constant';

/**
 * Backoff configuration for scheduled tasks.
 */
export interface BackoffConfig {
  /** Strategy to use for backoff */
  strategy: BackoffStrategy;

  /** Initial delay in milliseconds (default: 1000) */
  initialDelayMs?: number;

  /** Maximum delay in milliseconds (default: 60000) */
  maxDelayMs?: number;

  /** Multiplier for exponential backoff (default: 2) */
  multiplier?: number;

  /** Whether to add jitter to prevent thundering herd (default: false) */
  jitter?: boolean;
}

/**
 * Cron expression for scheduling.
 * 
 * Supports a subset of cron syntax:
 * - Minutes: 0-59
 * - Hours: 0-23
 * - Day of month: 1-31
 * - Month: 1-12
 * - Day of week: 0-6 (0=Sunday)
 * 
 * Special characters:
 * - asterisk : any value (every minute/hour/day)
 * - slash : step values (e.g., every 5 minutes)
 * - comma : list values (e.g., 1,5,10)
 * - dash : range values (e.g., 9-17)
 */
export interface CronExpression {
  /** Minutes (0-59) */
  minute: number[] | '*';

  /** Hours (0-23) */
  hour: number[] | '*';

  /** Day of month (1-31) */
  day: number[] | '*';

  /** Month (1-12) */
  month: number[] | '*';

  /** Day of week (0-6, 0=Sunday) */
  dayOfWeek: number[] | '*';

  /** Raw cron string for reference */
  raw: string;
}

/**
 * Options for scheduling a workflow.
 */
export interface ScheduleOptions {
  /** Backoff configuration for retries */
  backoff?: BackoffConfig;

  /** Maximum number of retries on failure (default: 3) */
  maxRetries?: number;

  /** Whether to stop scheduling after a failure (default: false) */
  stopOnError?: boolean;

  /** Custom context to pass to the workflow */
  context?: Record<string, unknown>;

  /** Whether to send notifications on failure (default: false) */
  notifyOnFailure?: boolean;

  /** Priority for scheduling (lower = higher priority) */
  priority?: number;
}

/**
 * Scheduled task record.
 */
export interface ScheduledTask {
  /** Unique schedule identifier */
  scheduleId: string;

  /** ID of the workflow to execute */
  workflowId: string;

  /** Human-readable workflow name */
  workflowName?: string;

  /** Cron expression for scheduling */
  cronExpression: CronExpression;

  /** ISO 8601 timestamp when schedule was created */
  createdAt: string;

  /** ISO 8601 timestamp when schedule was last run */
  lastRunAt?: string;

  /** ISO 8601 timestamp when schedule will next run */
  nextRunAt: string;

  /** Schedule status: active or paused */
  status: 'active' | 'paused';

  /** Execution statistics */
  executionStats: {
    /** Total number of executions */
    totalExecutions: number;

    /** Number of successful executions */
    successfulExecutions: number;

    /** Number of failed executions */
    failedExecutions: number;

    /** Last execution result (success/failure) */
    lastResult?: 'success' | 'failure';

    /** Last error message (if any) */
    lastError?: string;
  };

  /** Backoff configuration */
  backoff: BackoffConfig;

  /** Options used for this schedule */
  options: ScheduleOptions;

  /** Retry count for current execution cycle */
  retryCount: number;

  /** Number of consecutive failures */
  consecutiveFailures: number;
}

/**
 * Result of a scheduled task execution.
 */
export interface ScheduledExecution {
  /** Schedule ID that was executed */
  scheduleId: string;

  /** Workflow ID that was executed */
  workflowId: string;

  /** Execution timestamp */
  executedAt: string;

  /** Execution status */
  status: 'success' | 'failed';

  /** Duration in milliseconds */
  durationMs: number;

  /** Error details if failed */
  error?: string;

  /** Whether this was a retry */
  isRetry: boolean;

  /** Current retry count */
  retryCount: number;
}

/**
 * Workflow execution result for scheduled tasks.
 */
export interface WorkflowExecutionResult {
  /** Workflow ID */
  workflowId: string;

  /** Execution status */
  status: 'success' | 'failed';

  /** Duration in milliseconds */
  durationMs: number;

  /** Steps executed count */
  stepsExecuted: number;

  /** Steps succeeded count */
  stepsSucceeded: number;

  /** Steps failed count */
  stepsFailed: number;

  /** Error details if failed */
  error?: string;
}

// ============================================================================
// CRON EXPRESSION PARSER
// ============================================================================

/**
 * Parser for cron expressions.
 * 
 * Supports standard cron syntax with the following components:
 * minute(0-59) hour(0-23) day(1-31) month(1-12) dayOfWeek(0-6)
 */
export class CronExpressionParser {
  /**
   * Parse a cron expression string into a structured CronExpression object.
   * 
   * @param expression - Cron expression string (e.g., "0 9 * * 1" for 9am Mondays)
   * @returns Parsed CronExpression object
   * @throws Error if expression is invalid
   */
  static parse(expression: string): CronExpression {
    const parts = expression.trim().split(/\s+/);

    if (parts.length !== 5) {
      throw new Error(
        `Invalid cron expression: expected 5 parts, got ${parts.length}`
      );
    }

    return {
      minute: this.parseField(parts[0], 0, 59),
      hour: this.parseField(parts[1], 0, 23),
      day: this.parseField(parts[2], 1, 31),
      month: this.parseField(parts[3], 1, 12),
      dayOfWeek: this.parseField(parts[4], 0, 6),
      raw: expression,
    };
  }

  /**
   * Parse a single cron field (e.g., "0-5" or "step value").
   * 
   * @param field - Cron field string
   * @param min - Minimum valid value
   * @param max - Maximum valid value
   * @returns Array of valid values or '*' for any value
   */
  private static parseField(field: string, min: number, max: number): number[] | '*' {
    if (field === '*') {
      return '*';
    }

    const values = new Set<number>();

    // Handle step values (e.g., "*/5")
    if (field.startsWith('*/')) {
      const step = parseInt(field.slice(2), 10);
      if (isNaN(step) || step < 1) {
        throw new Error(`Invalid step value: ${field}`);
      }
      for (let i = min; i <= max; i += step) {
        values.add(i);
      }
      return [...values];
    }

    // Handle range values (e.g., "9-17")
    if (field.includes('-')) {
      const [startStr, endStr] = field.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);

      if (isNaN(start) || isNaN(end)) {
        throw new Error(`Invalid range: ${field}`);
      }

      if (start < min || end > max || start > end) {
        throw new Error(
          `Range ${field} out of bounds [${min}-${max}]`
        );
      }

      for (let i = start; i <= end; i++) {
        values.add(i);
      }
      return [...values];
    }

    // Handle comma-separated list (e.g., "1,5,10")
    if (field.includes(',')) {
      const parts = field.split(',');
      for (const part of parts) {
        const value = parseInt(part.trim(), 10);
        if (isNaN(value) || value < min || value > max) {
          throw new Error(
            `Invalid value ${value} in field ${field}, must be ${min}-${max}`
          );
        }
        values.add(value);
      }
      return [...values];
    }

    // Single value
    const value = parseInt(field, 10);
    if (isNaN(value) || value < min || value > max) {
      throw new Error(
        `Invalid value ${value} in field ${field}, must be ${min}-${max}`
      );
    }

    return [value];
  }

  /**
   * Check if a date matches the cron expression.
   * 
   * @param date - Date to check
   * @param expression - CronExpression object
   * @returns true if date matches expression, false otherwise
   */
  static matches(date: Date, expression: CronExpression): boolean {
    const minute = date.getMinutes();
    const hour = date.getHours();
    const day = date.getDate();
    const month = date.getMonth() + 1; // 0-indexed to 1-indexed
    const dayOfWeek = date.getDay(); // 0-6, 0=Sunday

    return (
      (expression.minute === '*' || expression.minute.includes(minute)) &&
      (expression.hour === '*' || expression.hour.includes(hour)) &&
      (expression.day === '*' || expression.day.includes(day)) &&
      (expression.month === '*' || expression.month.includes(month)) &&
      (expression.dayOfWeek === '*' || expression.dayOfWeek.includes(dayOfWeek))
    );
  }

  /**
   * Calculate the next execution time after a given date.
   * 
   * @param startDate - Date to start searching from
   * @param expression - CronExpression object
   * @returns Next execution date, or null if no match found within reasonable limit
   */
  static next(startDate: Date, expression: CronExpression): Date | null {
    // Start from the next minute
    let current = new Date(startDate);
    current.setSeconds(0);
    current.setMilliseconds(0);
    current.setMinutes(current.getMinutes() + 1);

    // Search up to 1 year ahead
    const maxSearchDate = new Date(startDate.getTime() + 365 * 24 * 60 * 60 * 1000);

    while (current < maxSearchDate) {
      if (this.matches(current, expression)) {
        return current;
      }
      current.setMinutes(current.getMinutes() + 1);
    }

    return null;
  }
}

// ============================================================================
// BATCH EXECUTOR
// ============================================================================

/**
 * Manages batch operations for sequential pack deployment.
 * 
 * This class provides:
 * - Queue management for batch operations
 * - Batch execution with progress tracking
 * - Failure handling with configurable strategies
 * - Result aggregation and statistics
 * - Queue position and estimated completion calculation
 */
export class BatchExecutor {
  /** Storage for batch operations */
  private batches: Map<string, BatchOperation> = new Map();

  /** Storage for pack results */
  private packResults: Map<string, PackExecutionResult[]> = new Map();

  /** Batch execution queue */
  private queue: string[] = [];

  /** Current execution position */
  private executionPosition: number = 0;

  /**
   * Queue a batch of packs for sequential deployment.
   * 
   * @param packIds - Array of pack IDs to execute
   * @param options - Batch options (policy, context, etc.)
   * @returns Created batch operation
   */
  public queueBatch(
    packIds: string[],
    options: BatchOptions = {}
  ): BatchOperation {
    if (packIds.length === 0) {
      throw new Error('Batch must contain at least one pack');
    }

    const batchId = this.generateBatchId();
    const position = this.queue.length + 1;

    const batch: BatchOperation = {
      batchId,
      packIds: [...packIds],
      status: 'pending',
      createdAt: new Date().toISOString(),
      position,
      options: {
        continueOnError: false,
        maxConcurrency: 1,
        ...options,
      },
      progress: 0,
    };

    this.batches.set(batchId, batch);

    // Add to queue if auto-start is disabled
    if (!options.autoStart) {
      this.queue.push(batchId);
    } else {
      // Start execution immediately
      this.executeBatch(batchId);
    }

    return batch;
  }

  /**
   * Execute a queued batch operation.
   * 
   * @param batchId - ID of the batch to execute
   * @returns Batch execution result
   */
  public executeBatch(batchId: string): BatchResult {
    const batch = this.batches.get(batchId);
    if (!batch) {
      throw new Error(`Batch not found: ${batchId}`);
    }

    if (batch.status !== 'pending') {
      throw new Error(
        `Cannot execute batch with status: ${batch.status}`
      );
    }

    // Update batch status
    batch.status = 'running';
    batch.startedAt = new Date().toISOString();
    batch.progress = 0;

    const results: PackExecutionResult[] = [];
    let started = false;
    let failed = false;
    let partial = false;
    const startTime = Date.now();

    // Execute each pack sequentially
    for (let i = 0; i < batch.packIds.length; i++) {
      const packId = batch.packIds[i];

      // Check if batch was cancelled
      if (batch.status === 'cancelled') {
        if (!started) {
          // Batch cancelled before starting
          const result = {
            packId,
            packName: `Pack ${packId}`,
            status: 'skipped',
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: 0,
            workflowsExecuted: 0,
            workflowsSucceeded: 0,
            workflowsFailed: 0,
          };
          results.push(result);
        } else {
          // Batch cancelled mid-execution
          batch.status = 'partial';
          partial = true;
        }
        break;
      }

      const packResult = this.executePack(packId, batch.options);

      // Update progress
      batch.progress = Math.round(((i + 1) / batch.packIds.length) * 100);

      // Record result
      results.push(packResult);
      started = true;

      // Check for failure
      if (packResult.status === 'failed') {
        if (!batch.options.continueOnError) {
          // Stop on first failure
          failed = true;
          break;
        } else {
          // Continue but mark as partial
          partial = true;
        }
      }
    }

    // Calculate completion time
    const endTime = Date.now();
    const durationMs = endTime - startTime;

    // Update batch status
    if (batch.status !== 'cancelled') {
      if (failed) {
        batch.status = 'failed';
        batch.error = results.find(r => r.status === 'failed')?.error;
      } else if (partial) {
        batch.status = 'partial';
      } else {
        batch.status = 'completed';
      }
    }

    batch.completedAt = new Date().toISOString();
    batch.results = results;

    // Update queue
    this.queue = this.queue.filter(id => id !== batchId);

    // Calculate final stats
    const succeededPacks = results.filter(r => r.status === 'success').length;
    const failedPacks = results.filter(r => r.status === 'failed').length;
    const skippedPacks = results.filter(r => r.status === 'skipped').length;

    const workflowMetrics = {
      total: results.reduce((sum, r) => sum + r.workflowsExecuted, 0),
      succeeded: results.reduce((sum, r) => sum + r.workflowsSucceeded, 0),
      failed: results.reduce((sum, r) => sum + r.workflowsFailed, 0),
    };

    if (workflowMetrics.total > 0) {
      workflowMetrics.averageDuration = results.reduce(
        (sum, r) => sum + r.durationMs,
        0
      ) / results.length;
    }

    const result: BatchResult = {
      batchId,
      status: batch.status,
      createdAt: batch.createdAt,
      startedAt: batch.startedAt,
      completedAt: batch.completedAt,
      durationMs,
      packResults: results,
      totalPacks: batch.packIds.length,
      succeededPacks,
      failedPacks,
      skippedPacks,
      successRate:
        batch.packIds.length > 0
          ? (succeededPacks / batch.packIds.length) * 100
          : 0,
      workflowMetrics,
      error: batch.error,
    };

    return result;
  }

  /**
   * Execute a single pack and return results.
   * 
   * @param packId - ID of the pack to execute
   * @param options - Batch options
   * @returns Pack execution result
   */
  private executePack(packId: string, options: BatchOptions): PackExecutionResult {
    const now = new Date().toISOString();
    const startTime = Date.now();

    try {
      // Simulate pack execution (in real implementation, this would
      // invoke the actual pack execution system)
      
      const result: PackExecutionResult = {
        packId,
        packName: `Pack ${packId}`,
        status: 'success',
        startedAt: now,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
        workflowsExecuted: 1,
        workflowsSucceeded: 1,
        workflowsFailed: 0,
      };

      return result;
    } catch (error) {
      const endTime = new Date().toISOString();
      
      return {
        packId,
        packName: `Pack ${packId}`,
        status: 'failed',
        startedAt: now,
        completedAt: endTime,
        durationMs: Date.now() - startTime,
        workflowsExecuted: 0,
        workflowsSucceeded: 0,
        workflowsFailed: 1,
        error: error instanceof Error ? error.message : String(error),
        stackTrace: error instanceof Error ? error.stack : undefined,
      };
    }
  }

  /**
   * Get the current status of a batch operation.
   * 
   * @param batchId - ID of the batch
   * @returns Current batch status
   */
  public getBatchStatus(batchId: string): BatchStatus {
    const batch = this.batches.get(batchId);
    return batch ? batch.status : 'pending';
  }

  /**
   * Cancel a batch operation.
   * 
   * @param batchId - ID of the batch to cancel
   * @returns true if batch was cancelled, false if not found or already completed
   */
  public cancelBatch(batchId: string): boolean {
    const batch = this.batches.get(batchId);
    if (!batch) {
      return false;
    }

    // Can only cancel pending, running, or partial batches
    if (batch.status === 'completed' || batch.status === 'failed' || batch.status === 'cancelled') {
      return false;
    }

    batch.status = 'cancelled';
    return true;
  }

  /**
   * Get statistics about the batch queue.
   * 
   * @returns Queue statistics object
   */
  public getQueueStats(): QueueStats {
    const batches = [...this.batches.values()];

    const pending = batches.filter(b => b.status === 'pending').length;
    const running = batches.filter(b => b.status === 'running').length;
    const completed = batches.filter(b => b.status === 'completed').length;
    const failed = batches.filter(b => b.status === 'failed').length;
    const cancelled = batches.filter(b => b.status === 'cancelled').length;
    const partial = batches.filter(b => b.status === 'partial').length;

    const total = pending + running + completed + failed + cancelled + partial;
    const successCount = completed + partial;

    // Calculate average times for completed batches
    const completedBatches = batches.filter(
      b => b.status === 'completed' || b.status === 'failed' || b.status === 'partial'
    );

    let averageWaitTime: number | undefined;
    let averageExecutionTime: number | undefined;

    if (completedBatches.length > 0) {
      const waitTimes: number[] = [];
      const executionTimes: number[] = [];

      for (const batch of completedBatches) {
        if (batch.startedAt && batch.createdAt) {
          const waitTime = new Date(batch.startedAt).getTime() -
            new Date(batch.createdAt).getTime();
          waitTimes.push(waitTime);
        }

        if (batch.startedAt && batch.completedAt) {
          const execTime = new Date(batch.completedAt).getTime() -
            new Date(batch.startedAt).getTime();
          executionTimes.push(execTime);
        }
      }

      if (waitTimes.length > 0) {
        averageWaitTime = waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length;
      }

      if (executionTimes.length > 0) {
        averageExecutionTime = executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length;
      }
    }

    return {
      totalBatches: total,
      pendingBatches: pending,
      runningBatches: running,
      completedBatches: completed,
      failedBatches: failed,
      cancelledBatches: cancelled,
      averageWaitTime,
      averageExecutionTime,
      successRate: total > 0 ? (successCount / total) * 100 : 0,
    };
  }

  /**
   * Get all batches in the system.
   * 
   * @returns Array of all batch operations
   */
  public getAllBatches(): BatchOperation[] {
    return [...this.batches.values()];
  }

  /**
   * Get a specific batch operation.
   * 
   * @param batchId - ID of the batch
   * @returns Batch operation or undefined if not found
   */
  public getBatch(batchId: string): BatchOperation | undefined {
    return this.batches.get(batchId);
  }

  /**
   * Calculate estimated completion time for a batch.
   * 
   * @param batchId - ID of the batch
   * @returns Estimated completion timestamp or undefined if not available
   */
  public getEstimatedCompletion(batchId: string): string | undefined {
    const batch = this.batches.get(batchId);
    if (!batch) {
      return undefined;
    }

    if (batch.status === 'pending') {
      // Estimate based on queue position
      const queueStats = this.getQueueStats();
      if (queueStats.averageExecutionTime) {
        const position = batch.position;
        const estimatedDelay = position * queueStats.averageExecutionTime;
        const completionTime = new Date(Date.now() + estimatedDelay);
        return completionTime.toISOString();
      }
    } else if (batch.status === 'running' && batch.startedAt) {
      // Estimate based on current progress
      if (batch.progress > 0 && batch.progress < 100) {
        const elapsed = Date.now() - new Date(batch.startedAt).getTime();
        const remainingTime = (elapsed / batch.progress) * (100 - batch.progress);
        const completionTime = new Date(Date.now() + remainingTime);
        return completionTime.toISOString();
      }
    }

    return undefined;
  }

  /**
   * Generate a unique batch ID.
   * 
   * @returns Unique batch ID string
   */
  private generateBatchId(): string {
    return `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ============================================================================
// SCHEDULING SERVICE
// ============================================================================

/**
 * Manages periodic workflow scheduling with cron expressions.
 * 
 * This service provides:
 * - Cron expression parsing and matching
 * - Scheduled task creation and management
 * - Backoff strategies for retry handling
 * - Task execution and result tracking
 */
export class SchedulingService {
  /** Storage for scheduled tasks */
  private schedules: Map<string, ScheduledTask> = new Map();

  /** Storage for execution results */
  private executions: Map<string, ScheduledExecution[]> = new Map();

  /** Batch executor reference for actual workflow execution */
  private batchExecutor: BatchExecutor;

  /**
   * Create a new scheduling service.
   * 
   * @param batchExecutor - Reference to batch executor for workflow execution
   */
  constructor(batchExecutor?: BatchExecutor) {
    this.batchExecutor = batchExecutor || new BatchExecutor();
  }

  /**
   * Schedule a workflow for periodic execution.
   * 
   * @param workflowId - ID of the workflow to schedule
   * @param cronExpression - Cron expression for scheduling
   * @param options - Schedule options (backoff, retry settings, etc.)
   * @returns Created scheduled task
   */
  public scheduleWorkflow(
    workflowId: string,
    cronExpression: string,
    options: ScheduleOptions = {}
  ): ScheduledTask {
    let expression: CronExpression;
    try {
      expression = CronExpressionParser.parse(cronExpression);
    } catch (error) {
      throw new Error(`Invalid cron expression: ${error instanceof Error ? error.message : String(error)}`);
    }

    const scheduleId = `schedule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date();
    const nextRun = CronExpressionParser.next(now, expression) || new Date(now.getTime() + 60 * 60 * 1000);

    const task: ScheduledTask = {
      scheduleId,
      workflowId,
      cronExpression: expression,
      createdAt: now.toISOString(),
      nextRunAt: nextRun.toISOString(),
      status: 'active',
      executionStats: {
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
      },
      backoff: {
        strategy: 'exponential',
        initialDelayMs: 1000,
        maxDelayMs: 60000,
        multiplier: 2,
        jitter: false,
        ...options.backoff,
      },
      options: {
        maxRetries: 3,
        stopOnError: false,
        notifyOnFailure: false,
        priority: 0,
        ...options,
      },
      retryCount: 0,
      consecutiveFailures: 0,
    };

    this.schedules.set(scheduleId, task);
    return task;
  }

  /**
   * Cancel a scheduled task.
   * 
   * @param scheduleId - ID of the schedule to cancel
   * @returns true if schedule was cancelled, false if not found
   */
  public cancelSchedule(scheduleId: string): boolean {
    return this.schedules.delete(scheduleId);
  }

  /**
   * Get all scheduled tasks.
   * 
   * @returns Array of all scheduled tasks
   */
  public getScheduledTasks(): ScheduledTask[] {
    return [...this.schedules.values()];
  }

  /**
   * Process schedules that are due for execution.
   * 
   * @returns Array of scheduled executions
   */
  public processDueSchedules(): ScheduledExecution[] {
    const now = new Date();
    const executions: ScheduledExecution[] = [];

    for (const [scheduleId, task] of this.schedules.entries()) {
      if (task.status !== 'active') {
        continue;
      }

      const nextRun = new Date(task.nextRunAt);
      if (nextRun <= now) {
        const execution = this.executeScheduledTask(task);
        executions.push(execution);

        // Update task with execution results
        task.lastRunAt = now.toISOString();
        task.executionStats.totalExecutions++;
        
        if (execution.status === 'success') {
          task.executionStats.successfulExecutions++;
          task.executionStats.lastResult = 'success';
          task.consecutiveFailures = 0;
        } else {
          task.executionStats.failedExecutions++;
          task.executionStats.lastResult = 'failure';
          task.executionStats.lastError = execution.error;
          task.consecutiveFailures++;

          // Handle retries with backoff
          if (task.consecutiveFailures <= task.options.maxRetries!) {
            const delay = this.calculateBackoffDelay(task);
            task.nextRunAt = new Date(now.getTime() + delay).toISOString();
            task.retryCount++;
          } else if (task.options.stopOnError) {
            // Stop scheduling after max retries
            task.status = 'paused';
          } else {
            // Try again at next scheduled time
            task.nextRunAt = CronExpressionParser.next(now, task.cronExpression)?.toISOString() || task.nextRunAt;
            task.retryCount = 0;
          }
        }

        this.schedules.set(scheduleId, task);
      }
    }

    return executions;
  }

  /**
   * Execute a scheduled task and return the result.
   * 
   * @param task - Scheduled task to execute
   * @returns Execution result
   */
  private executeScheduledTask(task: ScheduledTask): ScheduledExecution {
    const startTime = Date.now();

    try {
      // Execute the workflow using batch executor
      const batch = this.batchExecutor.queueBatch([task.workflowId], {
        autoStart: true,
        continueOnError: true,
        maxConcurrency: 1,
      });

      const result = this.batchExecutor.executeBatch(batch.batchId);

      const durationMs = Date.now() - startTime;
      const execution: ScheduledExecution = {
        scheduleId: task.scheduleId,
        workflowId: task.workflowId,
        executedAt: new Date().toISOString(),
        status: result.status === 'completed' || result.status === 'partial' ? 'success' : 'failed',
        durationMs,
        isRetry: task.retryCount > 0,
        retryCount: task.retryCount,
      };

      return execution;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      
      return {
        scheduleId: task.scheduleId,
        workflowId: task.workflowId,
        executedAt: new Date().toISOString(),
        status: 'failed',
        durationMs,
        error: error instanceof Error ? error.message : String(error),
        isRetry: task.retryCount > 0,
        retryCount: task.retryCount,
      };
    }
  }

  /**
   * Calculate backoff delay for retry.
   * 
   * @param task - Scheduled task
   * @returns Delay in milliseconds
   */
  private calculateBackoffDelay(task: ScheduledTask): number {
    const config = task.backoff;
    const baseDelay = config.initialDelayMs !== undefined ? config.initialDelayMs : 1000;
    const maxDelay = config.maxDelayMs !== undefined ? config.maxDelayMs : 60000;
    const multiplier = config.multiplier !== undefined ? config.multiplier : 2;

    let delay: number;

    switch (config.strategy) {
      case 'linear':
        delay = baseDelay * (task.retryCount + 1);
        break;
      case 'exponential':
        delay = baseDelay * Math.pow(multiplier, task.retryCount);
        break;
      case 'constant':
      default:
        delay = baseDelay;
        break;
    }

    // Apply jitter if enabled
    if (config.jitter) {
      delay = delay + (Math.random() * delay * 0.1); // Add up to 10% jitter
    }

    // Cap at max delay
    return Math.min(delay, maxDelay);
  }

  /**
   * Get execution history for a scheduled task.
   * 
   * @param scheduleId - ID of the schedule
   * @returns Array of execution results
   */
  public getExecutionHistory(scheduleId: string): ScheduledExecution[] {
    return this.executions.get(scheduleId) || [];
  }

  /**
   * Get the next scheduled run time for a cron expression.
   * 
   * @param cronExpression - Cron expression
   * @param startDate - Date to start searching from
   * @returns Next run date or null if not found
   */
  public getNextRunTime(cronExpression: string, startDate: Date = new Date()): Date | null {
    try {
      const expression = CronExpressionParser.parse(cronExpression);
      return CronExpressionParser.next(startDate, expression);
    } catch {
      return null;
    }
  }

  /**
   * Pause a scheduled task.
   * 
   * @param scheduleId - ID of the schedule to pause
   * @returns true if schedule was paused, false if not found
   */
  public pauseSchedule(scheduleId: string): boolean {
    const task = this.schedules.get(scheduleId);
    if (!task) {
      return false;
    }

    task.status = 'paused';
    return true;
  }

  /**
   * Resume a paused scheduled task.
   * 
   * @param scheduleId - ID of the schedule to resume
   * @returns true if schedule was resumed, false if not found
   */
  public resumeSchedule(scheduleId: string): boolean {
    const task = this.schedules.get(scheduleId);
    if (!task) {
      return false;
    }

    if (task.status !== 'paused') {
      return false;
    }

    task.status = 'active';
    return true;
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate queue position and estimated completion for a batch.
 * 
 * @param batchId - ID of the batch
 * @param queueStats - Current queue statistics
 * @param batchExecutor - Batch executor instance
 * @returns Object with position and estimated completion
 */
export function calculateQueueMetrics(
  batchId: string,
  queueStats: QueueStats,
  batchExecutor: BatchExecutor
): { position: number; estimatedCompletion: string | null } {
  const batch = batchExecutor.getBatch(batchId);
  if (!batch) {
    return { position: 0, estimatedCompletion: null };
  }

  // Find position in queue
  const queue = batchExecutor.getAllBatches()
    .filter(b => b.status === 'pending')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const position = queue.findIndex(b => b.batchId === batchId) + 1;

  // Calculate estimated completion
  let estimatedCompletion: string | null = null;

  if (queueStats.averageExecutionTime) {
    const estimatedDelay = position * queueStats.averageExecutionTime;
    estimatedCompletion = new Date(Date.now() + estimatedDelay).toISOString();
  }

  return { position, estimatedCompletion };
}

/**
 * Aggregate batch results for summary display.
 * 
 * @param results - Array of batch results
 * @returns Aggregated summary
 */
export function aggregateBatchResults(results: BatchResult[]): {
  totalBatches: number;
  totalPacks: number;
  totalWorkflows: number;
  successRate: number;
  totalDurationMs: number;
  averageDurationMs: number;
} {
  const totalBatches = results.length;
  const totalPacks = results.reduce((sum, r) => sum + r.totalPacks, 0);
  const totalWorkflows = results.reduce(
    (sum, r) => sum + r.workflowMetrics.total,
    0
  );
  const totalDurationMs = results.reduce((sum, r) => sum + (r.durationMs || 0), 0);

  const totalSucceeded = results.reduce(
    (sum, r) => sum + r.succeededPacks,
    0
  );
  const totalFailed = results.reduce((sum, r) => sum + r.failedPacks, 0);
  const successRate = totalPacks > 0 ? (totalSucceeded / totalPacks) * 100 : 0;

  return {
    totalBatches,
    totalPacks,
    totalWorkflows,
    successRate,
    totalDurationMs,
    averageDurationMs: totalBatches > 0 ? totalDurationMs / totalBatches : 0,
  };
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a test batch operation for testing purposes.
 * 
 * @param batchId - Batch ID
 * @param packIds - Array of pack IDs
 * @param status - Batch status
 * @returns Test batch operation
 */
export function createTestBatchOperation(
  batchId: string,
  packIds: string[],
  status: BatchStatus = 'pending'
): BatchOperation {
  return {
    batchId,
    packIds,
    status,
    createdAt: new Date().toISOString(),
    position: 1,
    options: {
      continueOnError: false,
      maxConcurrency: 1,
    },
    progress: 0,
  };
}

/**
 * Create a test scheduled task for testing purposes.
 * 
 * @param scheduleId - Schedule ID
 * @param workflowId - Workflow ID
 * @param cronExpression - Cron expression
 * @returns Test scheduled task
 */
export function createTestScheduledTask(
  scheduleId: string,
  workflowId: string,
  cronExpression: string = '* * * * *'
): ScheduledTask {
  const expression = CronExpressionParser.parse(cronExpression);
  const now = new Date();
  const nextRun = CronExpressionParser.next(now, expression) || new Date(now.getTime() + 60000);

  return {
    scheduleId,
    workflowId,
    cronExpression: expression,
    createdAt: now.toISOString(),
    nextRunAt: nextRun.toISOString(),
    status: 'active',
    executionStats: {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
    },
    backoff: {
      strategy: 'exponential',
      initialDelayMs: 1000,
      maxDelayMs: 60000,
      multiplier: 2,
      jitter: false,
    },
    options: {},
    retryCount: 0,
    consecutiveFailures: 0,
  };
}