/**
 * Undo/Rollback System for Complete Automation Engine
 *
 * Implements undo/rollback capabilities for pack executions with:
 * - Stack-based undo/redo for pack execution steps
 * - State reversal in reverse order
 * - Retry from failure point or from start
 * - Immediate rollback on deployment errors
 *
 * Key Components:
 * - UndoRedoStack<T>: Generic stack for undo/redo operations
 * - ExecutionUndoManager: Manages undo/redo for pack executions
 * - RollbackExecutor: Executes rollback operations on steps
 *
 * Requirements: 49.1, 49.2, 49.3, 50.1, 50.2, 50.3, 50.4
 */

import type { ExecutionRecord } from '../execution-repository';
import type { PackExecutionRecord } from '../pack-types';
import type { WorkflowExecutionRecord } from '../workflow-types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Represents the state before and after an operation
 */
export interface StateSnapshot {
  /** State before the operation */
  before: unknown;
  /** State after the operation */
  after: unknown;
  /** Timestamp of the operation */
  timestamp: string;
  /** Optional metadata about the operation */
  metadata?: Record<string, unknown>;
}

/**
 * Represents an executable operation that can be undone
 */
export interface ExecutableOperation<T = unknown> {
  /** Unique identifier for the operation */
  id: string;
  /** Operation type (for categorization) */
  type: string;
  /** Function to execute the operation */
  execute: () => T;
  /** Function to undo the operation */
  undo: () => T;
  /** Function to redo the operation */
  redo: () => T;
  /** Whether the operation is idempotent */
  isIdempotent?: boolean;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Represents a step in an execution
 */
export interface ExecutableStep {
  /** Unique identifier for the step */
  id: string;
  /** Step type (recording, workflow, etc.) */
  type: 'recording' | 'workflow' | 'conditional' | 'pause';
  /** Step name */
  name: string;
  /** Step order/index in execution sequence */
  order: number;
  /** Current execution status */
  status: 'pending' | 'running' | 'completed' | 'failed';
  /** Execution result (if completed) */
  result?: unknown;
  /** Error (if failed) */
  error?: Error;
  /** State snapshot before execution */
  beforeState?: StateSnapshot;
  /** State snapshot after execution */
  afterState?: StateSnapshot;
  /** ISO 8601 timestamp when step started */
  startedAt?: string;
  /** ISO 8601 timestamp when step completed */
  completedAt?: string;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Metadata about the step */
  metadata?: Record<string, unknown>;
}

/**
 * Snapshot of an execution for undo/redo
 */
export interface ExecutionSnapshot {
  /** Unique identifier for the execution */
  executionId: string;
  /** Pack ID associated with this execution */
  packId: string;
  /** Execution timestamp */
  timestamp: string;
  /** Array of steps in the execution */
  steps: ExecutableStep[];
  /** Current execution status */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'undone';
  /** Current undo position (index) */
  undoPosition: number;
  /** Whether execution is currently undoing */
  isUndoing: boolean;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result of a rollback operation
 */
export interface RollbackResult {
  /** Whether rollback was successful */
  success: boolean;
  /** Array of steps that were rolled back */
  rolledBackSteps: ExecutableStep[];
  /** Array of errors encountered during rollback */
  errors: RollbackError[];
  /** Total rollback duration in milliseconds */
  durationMs: number;
  /** Whether rollback was partial */
  isPartial: boolean;
}

/**
 * Error that occurred during rollback
 */
export interface RollbackError {
  /** Step that caused the error */
  step: ExecutableStep;
  /** Error that occurred */
  error: Error;
  /** Whether to continue rollback after this error */
  shouldContinue: boolean;
}

/**
 * Decision about how to handle a failure during rollback
 */
export interface RollbackDecision {
  /** Decision type */
  type: 'continue' | 'stop' | 'retry' | 'skip';
  /** Optional retry count for retry decision */
  retryCount?: number;
  /** Optional delay before retry in milliseconds */
  retryDelayMs?: number;
  /** Optional message explaining the decision */
  message?: string;
}

// ============================================================================
// UndoRedoStack Class
// ============================================================================

/**
 * Generic undo/redo stack implementation.
 *
 * Supports standard stack operations:
 * - push: Add operation to stack
 * - undo: Reverse last operation
 * - redo: Reapply last undone operation
 * - canUndo/canRedo: Check availability
 * - clear: Clear all operations
 *
 * Thread-safe: Uses mutex lock for concurrent access
 */
export class UndoRedoStack<T> {
  private undoStack: ExecutableOperation<T>[] = [];
  private redoStack: ExecutableOperation<T>[] = [];
  private lock = false;
  private operationIdCounter = 0;

  /**
   * Push an operation onto the undo stack
   * @param operation - The operation to push
   */
  public push(operation: ExecutableOperation<T>): void {
    this.acquireLock(() => {
      this.undoStack.push(operation);
      // Clear redo stack when new operation is added
      this.redoStack = [];
    });
  }

  /**
   * Undo the last operation
   * @returns The result of the undo operation, or null if no operation to undo
   */
  public undo(): T | null {
    return this.acquireLock(() => {
      if (this.undoStack.length === 0) {
        return null;
      }

      const operation = this.undoStack.pop()!;
      // Execute undo
      const result = operation.undo();
      // Push to redo stack
      this.redoStack.push(operation);

      return result;
    });
  }

  /**
   * Redo the last undone operation
   * @returns The result of the redo operation, or null if no operation to redo
   */
  public redo(): T | null {
    return this.acquireLock(() => {
      if (this.redoStack.length === 0) {
        return null;
      }

      const operation = this.redoStack.pop()!;
      // Execute redo
      const result = operation.redo();
      // Push back to undo stack
      this.undoStack.push(operation);

      return result;
    });
  }

  /**
   * Check if undo is available
   * @returns true if there are operations to undo
   */
  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /**
   * Check if redo is available
   * @returns true if there are operations to redo
   */
  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Clear all operations from both stacks
   */
  public clear(): void {
    this.acquireLock(() => {
      this.undoStack = [];
      this.redoStack = [];
    });
  }

  /**
   * Get the current size of the undo stack
   * @returns Number of operations in the undo stack
   */
  public getUndoSize(): number {
    return this.undoStack.length;
  }

  /**
   * Get the current size of the redo stack
   * @returns Number of operations in the redo stack
   */
  public getRedoSize(): number {
    return this.redoStack.length;
  }

  /**
   * Execute an operation with thread-safety
   * @param fn - Function to execute
   * @returns Result of the function
   */
  private acquireLock<R>(fn: () => R): R {
    // Simple lock implementation (could be enhanced for production)
    // For prototype, we use a simple flag-based approach
    if (this.lock) {
      throw new Error('Cannot acquire lock: another operation is in progress');
    }

    this.lock = true;
    try {
      return fn();
    } finally {
      this.lock = false;
    }
  }

  /**
   * Generate a unique operation ID
   * @returns Unique operation ID
   */
  private generateOperationId(): string {
    return `op_${++this.operationIdCounter}_${Date.now().toString(36)}`;
  }
}

// ============================================================================
// ExecutionUndoManager Class
// ============================================================================

/**
 * Manages undo/redo for pack executions.
 *
 * Tracks execution snapshots and provides:
 * - Execution recording
 * - Undo execution
 * - Redo execution
 * - History management
 */
export class ExecutionUndoManager {
  private executionSnapshots: Map<string, ExecutionSnapshot[]> = new Map();
  private undoRedoStacks: Map<string, UndoRedoStack<unknown>> = new Map();
  private lastExecutionIndex: Map<string, number> = new Map();

  /**
   * Record an execution for potential undo operations
   * @param packId - Pack ID associated with this execution
   * @param steps - Array of executable steps
   * @returns The created execution snapshot
   */
  public recordExecution(packId: string, steps: ExecutableStep[]): ExecutionSnapshot {
    const executionId = this.generateExecutionId();
    const timestamp = new Date().toISOString();

    const snapshot: ExecutionSnapshot = {
      executionId,
      packId,
      timestamp,
      steps: [...steps],
      status: 'pending',
      undoPosition: steps.length,
      isUndoing: false,
    };

    // Initialize undo/redo stack for this pack
    if (!this.undoRedoStacks.has(packId)) {
      this.undoRedoStacks.set(packId, new UndoRedoStack<unknown>());
    }

    // Get existing snapshots for this pack
    const existingSnapshots = this.executionSnapshots.get(packId) || [];
    existingSnapshots.push(snapshot);
    this.executionSnapshots.set(packId, existingSnapshots);

    // Update last execution index
    this.lastExecutionIndex.set(packId, existingSnapshots.length - 1);

    return snapshot;
  }

  /**
   * Undo the last execution for a pack
   * @param packId - Pack ID to undo
   * @returns true if undo was successful, false otherwise
   */
  public undoExecution(packId: string): boolean {
    const snapshots = this.executionSnapshots.get(packId);
    if (!snapshots || snapshots.length === 0) {
      return false;
    }

    const lastSnapshotIndex = this.lastExecutionIndex.get(packId);
    if (lastSnapshotIndex === undefined || lastSnapshotIndex < 0) {
      return false;
    }

    const snapshot = snapshots[lastSnapshotIndex];
    if (snapshot.status !== 'completed' && snapshot.status !== 'failed') {
      return false;
    }

    // Mark as undoing
    snapshot.isUndoing = true;
    snapshot.status = 'undone';

    // Get undo/redo stack for this pack
    const stack = this.undoRedoStacks.get(packId);
    if (!stack) {
      return false;
    }

    // Reverse steps and execute undo operations
    const stepsToUndo = [...snapshot.steps].reverse();
    const errors: RollbackError[] = [];

    for (const step of stepsToUndo) {
      try {
        if (step.beforeState) {
          // Create an undo operation for this step
          const undoOperation: ExecutableOperation = {
            id: step.id,
            type: 'undo',
            execute: () => step.beforeState!.before,
            undo: () => step.afterState?.after ?? step.beforeState.before,
            redo: () => step.afterState?.after ?? step.beforeState.before,
            metadata: { stepId: step.id, stepName: step.name },
          };

          stack.push(undoOperation);
        }
      } catch (error) {
        errors.push({
          step,
          error: error instanceof Error ? error : new Error(String(error)),
          shouldContinue: true,
        });
      }
    }

    // Execute undo operations
    let undoSuccess = true;
    while (stack.canUndo()) {
      const result = stack.undo();
      if (result === null) {
        undoSuccess = false;
        break;
      }
    }

    // Update snapshot status
    if (undoSuccess && errors.length === 0) {
      snapshot.status = 'undone';
    } else {
      snapshot.status = 'partially_undone';
    }

    snapshot.isUndoing = false;

    // Return success
    return undoSuccess && errors.length === 0;
  }

  /**
   * Redo the last undone execution for a pack
   * @param packId - Pack ID to redo
   * @returns true if redo was successful, false otherwise
   */
  public redoExecution(packId: string): boolean {
    const snapshots = this.executionSnapshots.get(packId);
    if (!snapshots || snapshots.length === 0) {
      return false;
    }

    const lastSnapshotIndex = this.lastExecutionIndex.get(packId);
    if (lastSnapshotIndex === undefined || lastSnapshotIndex < 0) {
      return false;
    }

    const snapshot = snapshots[lastSnapshotIndex];
    if (snapshot.status !== 'undone' && snapshot.status !== 'partially_undone') {
      return false;
    }

    // Get undo/redo stack for this pack
    const stack = this.undoRedoStacks.get(packId);
    if (!stack) {
      return false;
    }

    // Execute redo operations
    let redoSuccess = true;
    while (stack.canRedo()) {
      const result = stack.redo();
      if (result === null) {
        redoSuccess = false;
        break;
      }
    }

    // Update snapshot status
    if (redoSuccess) {
      snapshot.status = 'completed';
    } else {
      snapshot.status = 'partially_redone';
    }

    return redoSuccess;
  }

  /**
   * Get execution history for a pack
   * @param packId - Pack ID to get history for
   * @returns Array of execution snapshots
   */
  public getExecutionHistory(packId: string): ExecutionSnapshot[] {
    return this.executionSnapshots.get(packId) || [];
  }

  /**
   * Get the current undo position for a pack
   * @param packId - Pack ID to get position for
   * @returns Number of operations that can be undone
   */
  public getUndoPosition(packId: string): number {
    const stack = this.undoRedoStacks.get(packId);
    return stack ? stack.getUndoSize() : 0;
  }

  /**
   * Get the current redo position for a pack
   * @param packId - Pack ID to get position for
   * @returns Number of operations that can be redone
   */
  public getRedoPosition(packId: string): number {
    const stack = this.undoRedoStacks.get(packId);
    return stack ? stack.getRedoSize() : 0;
  }

  /**
   * Clear undo/redo history for a pack
   * @param packId - Pack ID to clear history for
   */
  public clearHistory(packId: string): void {
    this.undoRedoStacks.delete(packId);
    this.lastExecutionIndex.delete(packId);
    // Note: We keep the snapshots in executionSnapshots map for history tracking
  }

  /**
   * Clear all undo/redo history
   */
  public clearAllHistory(): void {
    this.undoRedoStacks.clear();
    this.lastExecutionIndex.clear();
    this.executionSnapshots.clear();
  }

  /**
   * Generate a unique execution ID
   * @returns Unique execution ID
   */
  private generateExecutionId(): string {
    return `exec_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 15)}`;
  }
}

// ============================================================================
// RollbackExecutor Class
// ============================================================================

/**
 * Executes rollback operations on execution steps.
 *
 * Provides functionality to:
 * - Execute rollback on a series of steps
 * - Reverse individual steps
 * - Handle failures during rollback
 * - Make decisions about failure handling
 */
export class RollbackExecutor {
  private rollbackStartTimestamp: number = 0;

  /**
   * Execute rollback on a series of steps
   * @param steps - Array of steps to rollback
   * @param startIndex - Index to start rollback from (default: last step)
   * @returns Rollback result with details
   */
  public executeRollback(
    steps: ExecutableStep[],
    startIndex: number = steps.length - 1,
  ): RollbackResult {
    this.rollbackStartTimestamp = Date.now();

    const rolledBackSteps: ExecutableStep[] = [];
    const errors: RollbackError[] = [];
    let currentIndex = startIndex;

    // Rollback in reverse order
    while (currentIndex >= 0) {
      const step = steps[currentIndex];
      if (!step) {
        currentIndex--;
        continue;
      }

      try {
        // Execute rollback for this step
        const reversedStep = this.reverseStep(step);

        // Update step status
        step.status = 'undone';

        // Record rollback
        rolledBackSteps.push(step);
      } catch (error) {
        const rollbackError = error instanceof Error ? error : new Error(String(error));
        const errorRecord: RollbackError = {
          step,
          error: rollbackError,
          shouldContinue: true, // Default to continue on error
        };

        // Make a decision about handling this error
        const decision = this.handleFailure(step, rollbackError);

        if (decision.type === 'stop') {
          errorRecord.shouldContinue = false;
          errors.push(errorRecord);
          break;
        } else if (decision.type === 'retry') {
          // Implement retry logic here if needed
          // For now, we'll just continue
          errorRecord.shouldContinue = true;
          errors.push(errorRecord);
        } else {
          // Continue or skip
          errorRecord.shouldContinue = decision.type === 'continue';
          errors.push(errorRecord);
        }
      }

      currentIndex--;
    }

    const rollbackDuration = Date.now() - this.rollbackStartTimestamp;

    return {
      success: errors.length === 0,
      rolledBackSteps,
      errors,
      durationMs: rollbackDuration,
      isPartial: currentIndex >= 0,
    };
  }

  /**
   * Create a reverse operation for a step
   * @param step - Step to reverse
   * @returns Reversed step
   */
  public reverseStep(step: ExecutableStep): ExecutableStep {
    const reversedStep: ExecutableStep = {
      ...step,
      id: `${step.id}_reversed`,
      status: 'undone',
      beforeState: step.afterState,
      afterState: step.beforeState,
      reversed: true,
    };

    // If there's no before state, we need to create one
    if (!reversedStep.beforeState && step.status === 'completed' && step.result !== undefined) {
      reversedStep.beforeState = {
        before: undefined,
        after: step.result,
        timestamp: new Date().toISOString(),
      };
    }

    return reversedStep;
  }

  /**
   * Handle a failure during rollback
   * @param step - Step that failed
   * @param error - Error that occurred
   * @returns Rollback decision
   */
  public handleFailure(step: ExecutableStep, error: Error): RollbackDecision {
    // Log the error for debugging
    console.error(`Rollback failed for step "${step.name}" (${step.id}):`, error);

    // Default decision: continue with rollback
    return {
      type: 'continue',
      message: `Continuing rollback after failure in step "${step.name}": ${error.message}`,
    };
  }

  /**
   * Generate a rollback decision from error context
   * @param step - Step that failed
   * @param error - Error that occurred
   * @param retryCount - Current retry count
   * @param maxRetries - Maximum number of retries allowed
   * @returns Rollback decision
   */
  public generateDecisionFromError(
    step: ExecutableStep,
    error: Error,
    retryCount: number = 0,
    maxRetries: number = 3,
  ): RollbackDecision {
    // Check if this is a retriable error
    if (retryCount < maxRetries && this.isRetriableError(error)) {
      return {
        type: 'retry',
        retryCount: retryCount + 1,
        retryDelayMs: 1000 * (retryCount + 1), // Exponential backoff
        message: `Retrying rollback for step "${step.name}" (attempt ${retryCount + 1}/${maxRetries})`,
      };
    }

    // Determine if error is critical
    if (this.isCriticalError(error)) {
      return {
        type: 'stop',
        message: `Stopping rollback due to critical error in step "${step.name}": ${error.message}`,
      };
    }

    // Default: skip the step and continue
    return {
      type: 'skip',
      message: `Skipping step "${step.name}" due to error: ${error.message}`,
    };
  }

  /**
   * Check if an error is retriable
   * @param error - Error to check
   * @returns true if the error is retriable
   */
  private isRetriableError(error: Error): boolean {
    const retriableMessages = [
      'timeout',
      'network',
      'connection',
      'resource temporarily unavailable',
    ];

    return retriableMessages.some((msg) =>
      error.message.toLowerCase().includes(msg),
    );
  }

  /**
   * Check if an error is critical
   * @param error - Error to check
   * @returns true if the error is critical
   */
  private isCriticalError(error: Error): boolean {
    const criticalMessages = [
      'corruption',
      'inconsistent state',
      'data loss',
      'security',
      'authentication',
    ];

    return criticalMessages.some((msg) =>
      error.message.toLowerCase().includes(msg),
    );
  }

  /**
   * Reset the rollback timer
   */
  public resetTimer(): void {
    this.rollbackStartTimestamp = Date.now();
  }

  /**
   * Get the elapsed time since rollback started
   * @returns Elapsed time in milliseconds
   */
  public getElapsedTime(): number {
    return Date.now() - this.rollbackStartTimestamp;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create an undo/redo operation for a state change
 * @param id - Operation ID
 * @param type - Operation type
 * @param currentState - Current state before change
 * @param newState - New state after change
 * @param executeFn - Function to execute the operation
 * @param undoFn - Function to undo the operation
 * @param redoFn - Function to redo the operation
 * @param metadata - Optional metadata
 * @returns ExecutableOperation
 */
export function createUndoRedoOperation<T>(
  id: string,
  type: string,
  currentState: T,
  newState: T,
  executeFn: () => T,
  undoFn: () => T,
  redoFn: () => T,
  metadata?: Record<string, unknown>,
): ExecutableOperation<T> {
  return {
    id,
    type,
    execute: executeFn,
    undo: undoFn,
    redo: redoFn,
    metadata,
  };
}

/**
 * Create an undo operation from a state snapshot
 * @param step - Step to create undo operation for
 * @returns ExecutableOperation
 */
export function createUndoOperationFromSnapshot(
  step: ExecutableStep,
): ExecutableOperation<unknown> | null {
  if (!step.beforeState || !step.afterState) {
    return null;
  }

  const operationId = `${step.id}_undo`;

  return {
    id: operationId,
    type: 'undo',
    execute: () => step.beforeState!.before,
    undo: () => step.afterState.after,
    redo: () => step.afterState.after,
    metadata: {
      stepId: step.id,
      stepName: step.name,
      timestamp: step.beforeState.timestamp,
    },
  };
}

/**
 * Create an execution step from workflow execution data
 * @param executionId - Execution ID
 * @param workflowExecution - Workflow execution record
 * @param order - Step order in sequence
 * @returns ExecutableStep
 */
export function createStepFromWorkflowExecution(
  executionId: string,
  workflowExecution: WorkflowExecutionRecord,
  order: number,
): ExecutableStep {
  const now = new Date().toISOString();

  const step: ExecutableStep = {
    id: executionId,
    type: 'workflow',
    name: workflowExecution.workflowName || `Workflow #${order}`,
    order,
    status: workflowExecution.success ? 'completed' : 'failed',
    result: workflowExecution.executionResult,
    error: workflowExecution.success ? undefined : new Error(workflowExecution.errorMessage || 'Unknown error'),
    beforeState: {
      before: workflowExecution.beforeState,
      after: workflowExecution.beforeState,
      timestamp: workflowExecution.startedAt || now,
    },
    afterState: {
      before: workflowExecution.beforeState,
      after: workflowExecution.afterState,
      timestamp: workflowExecution.completedAt || now,
    },
    startedAt: workflowExecution.startedAt,
    completedAt: workflowExecution.completedAt,
    durationMs: workflowExecution.durationMs,
    metadata: {
      workflowId: workflowExecution.workflowId,
      workflowVersion: workflowExecution.workflowVersion,
    },
  };

  return step;
}

/**
 * Create an execution step from pack execution data
 * @param executionId - Execution ID
 * @param packExecution - Pack execution record
 * @param workflowExecutions - Array of workflow execution records within the pack
 * @param order - Step order in sequence
 * @returns ExecutableStep
 */
export function createStepFromPackExecution(
  executionId: string,
  packExecution: PackExecutionRecord,
  workflowExecutions: WorkflowExecutionRecord[],
  order: number,
): ExecutableStep {
  const now = new Date().toISOString();

  // Create sub-steps for each workflow execution
  const subSteps: ExecutableStep[] = workflowExecutions.map((we, idx) =>
    createStepFromWorkflowExecution(executionId, we, idx),
  );

  const step: ExecutableStep = {
    id: executionId,
    type: 'pack',
    name: packExecution.packName || `Pack #${order}`,
    order,
    status: packExecution.success ? 'completed' : 'failed',
    result: packExecution.executionResult,
    error: packExecution.success ? undefined : new Error(packExecution.errorMessage || 'Unknown error'),
    beforeState: {
      before: packExecution.beforeState,
      after: packExecution.beforeState,
      timestamp: packExecution.startedAt || now,
    },
    afterState: {
      before: packExecution.beforeState,
      after: packExecution.afterState,
      timestamp: packExecution.completedAt || now,
    },
    startedAt: packExecution.startedAt,
    completedAt: packExecution.completedAt,
    durationMs: packExecution.durationMs,
    metadata: {
      packId: packExecution.packId,
      packVersion: packExecution.packVersion,
      workflowCount: workflowExecutions.length,
    },
    subSteps,
  };

  return step;
}

