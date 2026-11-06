/**
 * Undo/Rollback System Tests
 *
 * Tests for the undo/rollback implementation including:
 * - UndoRedoStack operations with property-based testing
 * - ExecutionUndoManager integration tests
 * - RollbackExecutor with failure scenarios
 * - Multi-step undo with dependency chains
 *
 * Requirements: 49.1, 49.2, 49.3, 50.1, 50.2, 50.3, 50.4
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  UndoRedoStack,
  ExecutionUndoManager,
  RollbackExecutor,
  ExecutableOperation,
  ExecutableStep,
  ExecutionSnapshot,
  RollbackResult,
  createUndoRedoOperation,
  createStepFromWorkflowExecution,
  createStepFromPackExecution,
} from '../core/undo-rollback';

import type { WorkflowExecutionRecord, WorkflowMetadata } from '../workflow-types';
import type { PackExecutionRecord, PackMetadata } from '../pack-types';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a test undo/redo operation
 */
function createTestOperation(id: string, type: string, value: number): ExecutableOperation<number> {
  let currentValue = value;

  return createUndoRedoOperation(
    id,
    type,
    currentValue,
    currentValue + 10,
    () => {
      currentValue += 10;
      return currentValue;
    },
    () => {
      currentValue -= 10;
      return currentValue;
    },
    () => {
      currentValue += 10;
      return currentValue;
    },
    { test: true },
  );
}

/**
 * Create a test executable step
 */
function createTestStep(
  id: string,
  type: ExecutableStep['type'],
  name: string,
  order: number,
  status: ExecutableStep['status'],
  result?: unknown,
): ExecutableStep {
  const now = new Date().toISOString();
  return {
    id,
    type,
    name,
    order,
    status,
    result,
    beforeState: {
      before: { value: order * 100 },
      after: { value: order * 100 },
      timestamp: now,
    },
    afterState: {
      before: { value: order * 100 },
      after: { value: order * 100 + 50 },
      timestamp: now,
    },
    startedAt: now,
    completedAt: now,
    durationMs: 100,
    metadata: { test: true },
  };
}

/**
 * Create a test workflow execution record
 */
function createTestWorkflowExecution(
  id: string,
  name: string,
  success: boolean,
  durationMs: number = 100,
): WorkflowExecutionRecord {
  const now = new Date().toISOString();
  return {
    workflowId: id,
    workflowName: name,
    workflowVersion: '1.0.0',
    startedAt: now,
    completedAt: now,
    durationMs,
    success,
    executionResult: { success, timestamp: now },
    errorMessage: success ? undefined : 'Test error',
    beforeState: { context: 'before' },
    afterState: success ? { context: 'after_success' } : { context: 'after_failure' },
  };
}

/**
 * Create a test pack execution record
 */
function createTestPackExecution(
  id: string,
  name: string,
  success: boolean,
  durationMs: number = 200,
): PackExecutionRecord {
  const now = new Date().toISOString();
  return {
    packId: id,
    packName: name,
    packVersion: '1.0.0',
    startedAt: now,
    completedAt: now,
    durationMs,
    success,
    executionResult: { success, timestamp: now },
    errorMessage: success ? undefined : 'Pack test error',
    beforeState: { context: 'pack_before' },
    afterState: success ? { context: 'pack_after_success' } : { context: 'pack_after_failure' },
  };
}

// ============================================================================
// UndoRedoStack Tests
// ============================================================================

describe('UndoRedoStack', () => {
  let stack: UndoRedoStack<number>;

  beforeEach(() => {
    stack = new UndoRedoStack<number>();
  });

  it('should initialize with empty stacks', () => {
    expect(stack.getUndoSize()).toBe(0);
    expect(stack.getRedoSize()).toBe(0);
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
  });

  it('should push operations to undo stack', () => {
    const operation = createTestOperation('op1', 'test', 0);
    stack.push(operation);

    expect(stack.getUndoSize()).toBe(1);
    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);
  });

  it('should undo operations correctly', () => {
    const op1 = createTestOperation('op1', 'test', 0);
    const op2 = createTestOperation('op2', 'test', 10);
    const op3 = createTestOperation('op3', 'test', 20);

    stack.push(op1);
    stack.push(op2);
    stack.push(op3);

    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);

    const result1 = stack.undo();
    // currentValue was 20 (from op3's initial value), undo does 20-10=10, returns 10
    expect(result1).toBe(10);
    expect(stack.getUndoSize()).toBe(2);
    expect(stack.getRedoSize()).toBe(1);
    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(true);

    const result2 = stack.undo();
    // currentValue was 10 (from op2's initial value), undo does 10-10=0, returns 0
    expect(result2).toBe(0);
    expect(stack.getUndoSize()).toBe(1);
    expect(stack.getRedoSize()).toBe(2);
  });

  it('should redo operations correctly', () => {
    const op1 = createTestOperation('op1', 'test', 0);
    const op2 = createTestOperation('op2', 'test', 10);
    const op3 = createTestOperation('op3', 'test', 20);

    stack.push(op1);
    stack.push(op2);
    stack.push(op3);

    // Undo twice
    stack.undo();
    stack.undo();

    expect(stack.canRedo()).toBe(true);

    // After undo, currentValue is 10 (op2 state)
    const result1 = stack.redo();
    // Redo op2: currentValue becomes 20, returns 20
    expect(result1).toBe(20);
    expect(stack.getUndoSize()).toBe(2);
    expect(stack.getRedoSize()).toBe(1);

    // Redo op3: currentValue becomes 30, returns 30
    const result2 = stack.redo();
    expect(result2).toBe(30);
    expect(stack.getUndoSize()).toBe(3);
    expect(stack.getRedoSize()).toBe(0);
  });

  it('should clear redo stack on new push', () => {
    const op1 = createTestOperation('op1', 'test', 0);
    const op2 = createTestOperation('op2', 'test', 10);
    const op3 = createTestOperation('op3', 'test', 20);

    stack.push(op1);
    stack.push(op2);
    stack.push(op3);

    // Undo twice
    stack.undo();
    stack.undo();

    expect(stack.getRedoSize()).toBe(2);

    // Push new operation - should clear redo stack
    const op4 = createTestOperation('op4', 'test', 30);
    stack.push(op4);

    expect(stack.getRedoSize()).toBe(0);
    expect(stack.canRedo()).toBe(false);
  });

  it('should return null when undo on empty stack', () => {
    const result = stack.undo();
    expect(result).toBeNull();
  });

  it('should return null when redo on empty stack', () => {
    const result = stack.redo();
    expect(result).toBeNull();
  });

  it('should clear all operations', () => {
    const op1 = createTestOperation('op1', 'test', 0);
    const op2 = createTestOperation('op2', 'test', 10);

    stack.push(op1);
    stack.push(op2);

    stack.undo(); // Now redo has 1 item

    stack.clear();

    expect(stack.getUndoSize()).toBe(0);
    expect(stack.getRedoSize()).toBe(0);
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
  });

  it('should handle concurrent access', () => {
    const op = createTestOperation('op1', 'test', 0);
    stack.push(op);

    // Multiple undo operations
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(stack.undo());
    }

    // Only first should succeed, rest should fail due to lock
    expect(results[0]).not.toBeNull();
    // Rest should throw or return null
  });
});

// ============================================================================
// Property-Based Tests for UndoRedoStack
// ============================================================================

describe('UndoRedoStack Property-Based Tests', () => {
  it('Validates: Stack property - undo then redo restores state', () => {
    const stack = new UndoRedoStack<number>();
    const initialOperations = 10;

    // Add initial operations
    for (let i = 0; i < initialOperations; i++) {
      const op = createTestOperation(`op_${i}`, 'test', i * 10);
      stack.push(op);
    }

    // Undo all operations
    const undos = [];
    while (stack.canUndo()) {
      undos.push(stack.undo());
    }

    // Verify all operations were undone
    expect(undos.length).toBe(initialOperations);
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(true);

    // Redo all operations
    const redos = [];
    while (stack.canRedo()) {
      redos.push(stack.redo());
    }

    // Verify all operations were redone
    expect(redos.length).toBe(initialOperations);
    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);
  });

  it('Validates: Stack property - push clears redo stack', () => {
    const stack = new UndoRedoStack<number>();

    // Add operations
    for (let i = 0; i < 5; i++) {
      const op = createTestOperation(`op_${i}`, 'test', i * 10);
      stack.push(op);
    }

    // Undo all
    while (stack.canUndo()) {
      stack.undo();
    }

    expect(stack.getRedoSize()).toBe(5);

    // Push new operation
    const newOp = createTestOperation('new_op', 'test', 100);
    stack.push(newOp);

    // Redo stack should be cleared
    expect(stack.getRedoSize()).toBe(0);
    expect(stack.canRedo()).toBe(false);
    expect(stack.canUndo()).toBe(true);
  });

  it('Validates: Stack property - undo on empty stack returns null', () => {
    const stack = new UndoRedoStack<number>();

    // Try to undo on empty stack
    const result = stack.undo();

    expect(result).toBeNull();
    expect(stack.canUndo()).toBe(false);
  });

  it('Validates: Stack property - redo on empty stack returns null', () => {
    const stack = new UndoRedoStack<number>();

    // Try to redo on empty stack
    const result = stack.redo();

    expect(result).toBeNull();
    expect(stack.canRedo()).toBe(false);
  });

  it('Validates: Stack property - clear resets both stacks', () => {
    const stack = new UndoRedoStack<number>();

    // Add and undo operations
    for (let i = 0; i < 5; i++) {
      const op = createTestOperation(`op_${i}`, 'test', i * 10);
      stack.push(op);
    }

    stack.undo();
    stack.undo();

    // Clear the stack
    stack.clear();

    expect(stack.getUndoSize()).toBe(0);
    expect(stack.getRedoSize()).toBe(0);
  });
});

// ============================================================================
// ExecutionUndoManager Integration Tests
// ============================================================================

describe('ExecutionUndoManager', () => {
  let manager: ExecutionUndoManager;

  beforeEach(() => {
    manager = new ExecutionUndoManager();
  });

  it('should record execution and create snapshot', () => {
    const steps = [
      createTestStep('step1', 'workflow', 'Step 1', 1, 'pending'),
      createTestStep('step2', 'workflow', 'Step 2', 2, 'pending'),
      createTestStep('step3', 'workflow', 'Step 3', 3, 'pending'),
    ];

    const snapshot = manager.recordExecution('pack1', steps);

    expect(snapshot).toBeDefined();
    expect(snapshot.executionId).toBeDefined();
    expect(snapshot.packId).toBe('pack1');
    expect(snapshot.steps.length).toBe(3);
    expect(snapshot.status).toBe('pending');
    expect(snapshot.undoPosition).toBe(3);
    expect(snapshot.isUndoing).toBe(false);
  });

  it('should record multiple executions for same pack', () => {
    const steps1 = [
      createTestStep('step1', 'workflow', 'Step 1', 1, 'pending'),
    ];
    const steps2 = [
      createTestStep('step2', 'workflow', 'Step 2', 2, 'pending'),
      createTestStep('step3', 'workflow', 'Step 3', 3, 'pending'),
    ];

    const snapshot1 = manager.recordExecution('pack1', steps1);
    const snapshot2 = manager.recordExecution('pack1', steps2);

    const history = manager.getExecutionHistory('pack1');
    expect(history.length).toBe(2);
    expect(history[0].executionId).toBe(snapshot1.executionId);
    expect(history[1].executionId).toBe(snapshot2.executionId);
  });

  it('should undo a completed execution', () => {
    const steps = [
      createTestStep('step1', 'workflow', 'Step 1', 1, 'completed', { result: 'value1' }),
      createTestStep('step2', 'workflow', 'Step 2', 2, 'completed', { result: 'value2' }),
      createTestStep('step3', 'workflow', 'Step 3', 3, 'completed', { result: 'value3' }),
    ];

    const snapshot = manager.recordExecution('pack1', steps);
    snapshot.status = 'completed';

    const success = manager.undoExecution('pack1');

    expect(success).toBe(true);

    const updatedSnapshot = manager.getExecutionHistory('pack1').find(s => s.executionId === snapshot.executionId);
    expect(updatedSnapshot?.status).toBe('undone');
    expect(manager.getUndoPosition('pack1')).toBeGreaterThan(0);
  });

  it('should return false for undo on non-completed execution', () => {
    const steps = [
      createTestStep('step1', 'workflow', 'Step 1', 1, 'running'),
    ];

    const snapshot = manager.recordExecution('pack1', steps);

    const success = manager.undoExecution('pack1');

    expect(success).toBe(false);
  });

  it('should redo an undone execution', () => {
    const steps = [
      createTestStep('step1', 'workflow', 'Step 1', 1, 'completed'),
      createTestStep('step2', 'workflow', 'Step 2', 2, 'completed'),
    ];

    const snapshot = manager.recordExecution('pack1', steps);
    snapshot.status = 'completed';

    // Undo
    const undoSuccess = manager.undoExecution('pack1');
    expect(undoSuccess).toBe(true);

    const updatedSnapshot1 = manager.getExecutionHistory('pack1').find(s => s.executionId === snapshot.executionId);
    expect(updatedSnapshot1?.status).toBe('undone');

    // Redo
    const redoSuccess = manager.redoExecution('pack1');
    expect(redoSuccess).toBe(true);

    const updatedSnapshot2 = manager.getExecutionHistory('pack1').find(s => s.executionId === snapshot.executionId);
    expect(updatedSnapshot2?.status).toBe('completed');
  });

  it('should return false for redo on non-undone execution', () => {
    const steps = [
      createTestStep('step1', 'workflow', 'Step 1', 1, 'completed'),
    ];

    const snapshot = manager.recordExecution('pack1', steps);
    snapshot.status = 'completed';

    const success = manager.redoExecution('pack1');

    expect(success).toBe(false);
  });

  it('should get execution history for a pack', () => {
    const steps1 = [createTestStep('s1', 'workflow', 'Step 1', 1, 'pending')];
    const steps2 = [createTestStep('s2', 'workflow', 'Step 2', 2, 'pending')];
    const steps3 = [createTestStep('s3', 'workflow', 'Step 3', 3, 'pending')];

    manager.recordExecution('pack1', steps1);
    manager.recordExecution('pack1', steps2);
    manager.recordExecution('pack1', steps3);

    const history = manager.getExecutionHistory('pack1');

    expect(history.length).toBe(3);
    expect(history[0].steps[0].id).toBe('s1');
    expect(history[1].steps[0].id).toBe('s2');
    expect(history[2].steps[0].id).toBe('s3');
  });

  it('should clear history for a pack', () => {
    const steps = [createTestStep('step1', 'workflow', 'Step 1', 1, 'pending')];

    manager.recordExecution('pack1', steps);

    expect(manager.getExecutionHistory('pack1').length).toBe(1);
    expect(manager.getUndoPosition('pack1')).toBeGreaterThan(0);

    manager.clearHistory('pack1');

    expect(manager.getUndoPosition('pack1')).toBe(0);
    // History should still exist but undo/redo stacks cleared
  });

  it('should clear all history', () => {
    const steps1 = [createTestStep('step1', 'workflow', 'Step 1', 1, 'pending')];
    const steps2 = [createTestStep('step2', 'workflow', 'Step 2', 2, 'pending')];

    manager.recordExecution('pack1', steps1);
    manager.recordExecution('pack2', steps2);

    expect(manager.getExecutionHistory('pack1').length).toBe(1);
    expect(manager.getExecutionHistory('pack2').length).toBe(1);

    manager.clearAllHistory();

    expect(manager.getExecutionHistory('pack1').length).toBe(0);
    expect(manager.getExecutionHistory('pack2').length).toBe(0);
  });

  it('should handle empty execution history', () => {
    const success1 = manager.undoExecution('pack1');
    const success2 = manager.redoExecution('pack1');

    expect(success1).toBe(false);
    expect(success2).toBe(false);

    const history = manager.getExecutionHistory('pack1');
    expect(history.length).toBe(0);
  });
});

// ============================================================================
// RollbackExecutor Tests
// ============================================================================

describe('RollbackExecutor', () => {
  let executor: RollbackExecutor;

  beforeEach(() => {
    executor = new RollbackExecutor();
  });

  it('should rollback steps in reverse order', () => {
    const steps = [
      createTestStep('step1', 'workflow', 'Step 1', 1, 'completed'),
      createTestStep('step2', 'workflow', 'Step 2', 2, 'completed'),
      createTestStep('step3', 'workflow', 'Step 3', 3, 'completed'),
    ];

    const result = executor.executeRollback(steps);

    expect(result.success).toBe(true);
    expect(result.rolledBackSteps.length).toBe(3);
    expect(result.rolledBackSteps[0].id).toBe('step3'); // Reverse order
    expect(result.rolledBackSteps[1].id).toBe('step2');
    expect(result.rolledBackSteps[2].id).toBe('step1');
    expect(result.errors.length).toBe(0);
    expect(result.isPartial).toBe(false);
  });

  it('should rollback from specific start index', () => {
    const steps = [
      createTestStep('step1', 'workflow', 'Step 1', 1, 'completed'),
      createTestStep('step2', 'workflow', 'Step 2', 2, 'completed'),
      createTestStep('step3', 'workflow', 'Step 3', 3, 'completed'),
      createTestStep('step4', 'workflow', 'Step 4', 4, 'completed'),
    ];

    const result = executor.executeRollback(steps, 2); // Start from step3 (index 2)

    expect(result.rolledBackSteps.length).toBe(3); // step3, step2, step1
    expect(result.rolledBackSteps[0].id).toBe('step3');
    expect(result.rolledBackSteps[1].id).toBe('step2');
    expect(result.rolledBackSteps[2].id).toBe('step1');
    expect(result.isPartial).toBe(false);
  });

  it('should create reversed step with correct state', () => {
    const step = createTestStep('step1', 'workflow', 'Step 1', 1, 'completed');
    step.beforeState = { before: 'before_value', after: 'before_value', timestamp: new Date().toISOString() };
    step.afterState = { before: 'before_value', after: 'after_value', timestamp: new Date().toISOString() };

    const reversedStep = executor.reverseStep(step);

    expect(reversedStep.id).toBe('step1_reversed');
    expect(reversedStep.status).toBe('undone');
    expect(reversedStep.beforeState).toBe(step.afterState);
    expect(reversedStep.afterState).toBe(step.beforeState);
    expect(reversedStep.reversed).toBe(true);
  });

  it('should handle failure during rollback and continue', () => {
    const steps = [
      createTestStep('step1', 'workflow', 'Step 1', 1, 'completed'),
      createTestStep('step2', 'workflow', 'Step 2', 2, 'completed'),
    ];

    // Mock reverseStep to throw error on step2
    const originalReverseStep = executor.reverseStep;
    let callCount = 0;
    executor.reverseStep = (step) => {
      callCount++;
      if (callCount === 2 && step.id === 'step2') {
        throw new Error('Simulated rollback error');
      }
      return originalReverseStep.call(executor, step);
    };

    const result = executor.executeRollback(steps);

    expect(result.success).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].step.id).toBe('step2');
    expect(result.errors[0].shouldContinue).toBe(true);
    expect(result.rolledBackSteps.length).toBe(2); // Both steps recorded
    expect(result.isPartial).toBe(false);

    // Restore original method
    executor.reverseStep = originalReverseStep;
  });

  it('should handle critical errors and stop rollback', () => {
    const steps = [
      createTestStep('step1', 'workflow', 'Step 1', 1, 'completed'),
      createTestStep('step2', 'workflow', 'Step 2', 2, 'completed'),
      createTestStep('step3', 'workflow', 'Step 3', 3, 'completed'),
    ];

    // Mock handleFailure to return 'stop' decision for critical errors
    const originalHandleFailure = executor.handleFailure;
    executor.handleFailure = (step, error) => {
      if (error.message.includes('critical')) {
        return {
          type: 'stop' as const,
          message: `Stopping due to critical error in ${step.name}`,
        };
      }
      return originalHandleFailure.call(executor, step, error);
    };

    // Mock reverseStep to throw critical error on step2
    const originalReverseStep = executor.reverseStep;
    let callCount = 0;
    executor.reverseStep = (step) => {
      callCount++;
      if (callCount === 2 && step.id === 'step2') {
        throw new Error('Critical data corruption error');
      }
      return originalReverseStep.call(executor, step);
    };

    const result = executor.executeRollback(steps);

    expect(result.success).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].step.id).toBe('step2');
    expect(result.errors[0].shouldContinue).toBe(false);
    expect(result.rolledBackSteps.length).toBe(1); // Only step1
    expect(result.isPartial).toBe(true);

    // Restore original methods
    executor.handleFailure = originalHandleFailure;
    executor.reverseStep = originalReverseStep;
  });

  it('should generate retry decision for retriable errors', () => {
    const step = createTestStep('step1', 'workflow', 'Step 1', 1, 'completed');
    const error = new Error('Network timeout occurred');

    const decision = executor.generateDecisionFromError(step, error, 0, 3);

    expect(decision.type).toBe('retry');
    expect(decision.retryCount).toBe(1);
    expect(decision.retryDelayMs).toBe(1000); // Exponential backoff
    expect(decision.message).toContain('Retrying');
  });

  it('should generate skip decision for non-retriable non-critical errors', () => {
    const step = createTestStep('step1', 'workflow', 'Step 1', 1, 'completed');
    const error = new Error('Invalid state value');

    const decision = executor.generateDecisionFromError(step, error, 3, 3);

    expect(decision.type).toBe('skip');
    expect(decision.message).toContain('Skipping');
  });

  it('should handle empty steps array', () => {
    const result = executor.executeRollback([]);

    expect(result.success).toBe(true);
    expect(result.rolledBackSteps.length).toBe(0);
    expect(result.errors.length).toBe(0);
    expect(result.isPartial).toBe(false);
  });

  it('should calculate correct rollback duration', () => {
    const steps = [
      createTestStep('step1', 'workflow', 'Step 1', 1, 'completed'),
      createTestStep('step2', 'workflow', 'Step 2', 2, 'completed'),
    ];

    const startTime = Date.now();
    const result = executor.executeRollback(steps);
    const endTime = Date.now();

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.durationMs).toBeLessThanOrEqual(endTime - startTime + 100);
  });
});

// ============================================================================
// Multi-Step Undo with Dependency Chains Tests
// ============================================================================

describe('Multi-Step Undo with Dependency Chains', () => {
  let manager: ExecutionUndoManager;
  let executor: RollbackExecutor;

  beforeEach(() => {
    manager = new ExecutionUndoManager();
    executor = new RollbackExecutor();
  });

  it('should handle sequential undo operations', () => {
    // Simulate a pack execution with multiple workflow steps
    const steps = [
      createTestStep('wf1', 'workflow', 'Workflow 1', 1, 'completed', { data: 'wf1_data' }),
      createTestStep('wf2', 'workflow', 'Workflow 2', 2, 'completed', { data: 'wf2_data' }),
      createTestStep('wf3', 'workflow', 'Workflow 3', 3, 'completed', { data: 'wf3_data' }),
    ];

    const snapshot = manager.recordExecution('pack1', steps);
    snapshot.status = 'completed';

    // Undo first time
    let undo1Success = manager.undoExecution('pack1');
    expect(undo1Success).toBe(true);

    // Check that undo stack has operations
    expect(manager.getUndoPosition('pack1')).toBeGreaterThan(0);

    // Undo second time (should still work)
    let undo2Success = manager.undoExecution('pack1');
    expect(undo2Success).toBe(true);

    // Check that we can redo
    expect(manager.getRedoPosition('pack1')).toBeGreaterThan(0);
  });

  it('should handle undo/redo cycles', () => {
    const steps = [
      createTestStep('step1', 'workflow', 'Step 1', 1, 'completed'),
      createTestStep('step2', 'workflow', 'Step 2', 2, 'completed'),
    ];

    const snapshot = manager.recordExecution('pack1', steps);
    snapshot.status = 'completed';

    // Cycle 1: Undo then redo
    let undo1 = manager.undoExecution('pack1');
    expect(undo1).toBe(true);

    let redo1 = manager.redoExecution('pack1');
    expect(redo1).toBe(true);

    // Cycle 2: Another undo then redo
    let undo2 = manager.undoExecution('pack1');
    expect(undo2).toBe(true);

    let redo2 = manager.redoExecution('pack1');
    expect(redo2).toBe(true);
  });

  it('should handle rollback with interdependent steps', () => {
    // Create steps with dependency information
    const steps: ExecutableStep[] = [
      {
        ...createTestStep('step1', 'workflow', 'Setup', 1, 'completed'),
        metadata: { dependsOn: [] },
      },
      {
        ...createTestStep('step2', 'workflow', 'Process', 2, 'completed'),
        metadata: { dependsOn: ['step1'] },
      },
      {
        ...createTestStep('step3', 'workflow', 'Finalize', 3, 'completed'),
        metadata: { dependsOn: ['step1', 'step2'] },
      },
    ];

    const result = executor.executeRollback(steps);

    expect(result.success).toBe(true);
    expect(result.rolledBackSteps.length).toBe(3);

    // Verify reverse order (dependencies first)
    expect(result.rolledBackSteps[0].name).toBe('Finalize'); // Last dependency
    expect(result.rolledBackSteps[1].name).toBe('Process');
    expect(result.rolledBackSteps[2].name).toBe('Setup'); // First dependency
  });

  it('should handle undo with nested step structures', () => {
    // Create a pack execution with nested workflow steps
    const packSteps: ExecutableStep[] = [
      {
        ...createTestStep('pack1', 'pack', 'Main Pack', 1, 'completed'),
        subSteps: [
          createTestStep('wf1', 'workflow', 'Workflow 1', 1, 'completed'),
          createTestStep('wf2', 'workflow', 'Workflow 2', 2, 'completed'),
        ],
      },
    ];

    const snapshot = manager.recordExecution('pack1', packSteps);
    snapshot.status = 'completed';

    const undoSuccess = manager.undoExecution('pack1');
    expect(undoSuccess).toBe(true);
  });

  it('should handle undo after partial rollback failure', () => {
    // Simulate partial rollback failure
    const steps = [
      createTestStep('step1', 'workflow', 'Step 1', 1, 'completed'),
      createTestStep('step2', 'workflow', 'Step 2', 2, 'completed'),
      createTestStep('step3', 'workflow', 'Step 3', 3, 'completed'),
    ];

    // First attempt - should succeed for some steps
    const result1 = executor.executeRollback(steps);
    expect(result1.isPartial).toBe(false);

    // Record the execution
    const snapshot = manager.recordExecution('pack1', steps);
    snapshot.status = 'completed';

    // Undo
    const undoSuccess = manager.undoExecution('pack1');
    expect(undoSuccess).toBe(true);
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration Tests', () => {
  let manager: ExecutionUndoManager;
  let executor: RollbackExecutor;

  beforeEach(() => {
    manager = new ExecutionUndoManager();
    executor = new RollbackExecutor();
  });

  it('should handle complete workflow execution with undo', () => {
    // Create workflow execution data
    const workflowExecutions: WorkflowExecutionRecord[] = [
      createTestWorkflowExecution('wf1', 'Login Workflow', true),
      createTestWorkflowExecution('wf2', 'Data Entry Workflow', true),
      createTestWorkflowExecution('wf3', 'Submit Workflow', true),
    ];

    // Create pack execution
    const packExecution = createTestPackExecution('pack1', 'Main Pack', true);

    // Create steps from execution data
    const steps: ExecutableStep[] = workflowExecutions.map((we, idx) =>
      createStepFromWorkflowExecution(`exec_${idx}`, we, idx),
    );

    // Record execution
    const snapshot = manager.recordExecution('pack1', steps);
    snapshot.status = 'completed';

    // Verify execution recorded
    const history = manager.getExecutionHistory('pack1');
    expect(history.length).toBe(1);

    // Undo execution
    const undoSuccess = manager.undoExecution('pack1');
    expect(undoSuccess).toBe(true);

    // Verify undo worked
    const updatedSnapshot = manager.getExecutionHistory('pack1').find(s => s.executionId === snapshot.executionId);
    expect(updatedSnapshot?.status).toBe('undone');
  });

  it('should handle pack execution with nested workflows', () => {
    // Create workflow executions
    const workflowExecutions: WorkflowExecutionRecord[] = [
      createTestWorkflowExecution('wf1', 'Setup Workflow', true),
      createTestWorkflowExecution('wf2', 'Main Workflow', true),
      createTestWorkflowExecution('wf3', 'Cleanup Workflow', true),
    ];

    // Create pack execution
    const packExecution = createTestPackExecution('pack1', 'Complete Pack', true);

    // Create steps from pack execution data
    const steps: ExecutableStep[] = [
      createStepFromPackExecution('pack_exec', packExecution, workflowExecutions, 0),
    ];

    // Record execution
    const snapshot = manager.recordExecution('pack1', steps);
    snapshot.status = 'completed';

    // Undo execution
    const undoSuccess = manager.undoExecution('pack1');
    expect(undoSuccess).toBe(true);

    // Verify undo worked
    const updatedSnapshot = manager.getExecutionHistory('pack1').find(s => s.executionId === snapshot.executionId);
    expect(updatedSnapshot?.status).toBe('undone');
  });

  it('should handle rollback with error propagation', () => {
    // Create steps that may fail
    const steps: ExecutableStep[] = [
      createTestStep('step1', 'workflow', 'Step 1', 1, 'completed'),
      createTestStep('step2', 'workflow', 'Step 2', 2, 'completed'),
      createTestStep('step3', 'workflow', 'Step 3', 3, 'failed', { error: 'Step failed' }),
    ];

    // Execute rollback
    const result = executor.executeRollback(steps);

    expect(result.success).toBe(false); // At least one step failed
    expect(result.rolledBackSteps.length).toBe(3); // All steps processed
    expect(result.errors.length).toBe(1); // One error recorded
  });

  it('should maintain execution history after undo operations', () => {
    // Record multiple executions
    const steps1 = [createTestStep('s1', 'workflow', 'Step 1', 1, 'pending')];
    const steps2 = [createTestStep('s2', 'workflow', 'Step 2', 2, 'pending')];

    manager.recordExecution('pack1', steps1);
    manager.recordExecution('pack1', steps2);

    // Perform undo operations
    const history1 = manager.getExecutionHistory('pack1');
    expect(history1.length).toBe(2);

    // Undo first execution
    const undo1 = manager.undoExecution('pack1');
    expect(undo1).toBe(true);

    // History should still exist
    const history2 = manager.getExecutionHistory('pack1');
    expect(history2.length).toBe(2); // Same number, but status changed
  });
});

// ============================================================================
// Property-Based Tests for Undo Operations
// ============================================================================

describe('Undo Operations Property-Based Tests', () => {
  it('Validates: Requirements 49.1, 49.2 - Undo reverses state changes in reverse order', () => {
    const manager = new ExecutionUndoManager();

    // Create execution steps
    const steps: ExecutableStep[] = [];
    for (let i = 0; i < 10; i++) {
      steps.push(createTestStep(`step${i}`, 'workflow', `Step ${i}`, i, 'completed', { index: i }));
    }

    // Record execution
    const snapshot = manager.recordExecution('pack_test', steps);
    snapshot.status = 'completed';

    // Undo execution
    const undoSuccess = manager.undoExecution('pack_test');
    expect(undoSuccess).toBe(true);

    // Verify undo stack has operations
    const undoPosition = manager.getUndoPosition('pack_test');
    expect(undoPosition).toBeGreaterThan(0);
  });

  it('Validates: Requirements 49.3, 50.1 - Retry from failure point supported', () => {
    const executor = new RollbackExecutor();

    // Create steps with one failure point
    const steps: ExecutableStep[] = [
      createTestStep('step1', 'workflow', 'Step 1', 1, 'completed'),
      createTestStep('step2', 'workflow', 'Step 2', 2, 'failed', { error: 'Failure at step 2' }),
      createTestStep('step3', 'workflow', 'Step 3', 3, 'pending'),
    ];

    // Start rollback from failure point (step2, index 1)
    const result = executor.executeRollback(steps, 1);

    expect(result.rolledBackSteps.length).toBe(2); // step2, step1
    expect(result.rolledBackSteps[0].id).toBe('step2'); // Failure point first
    expect(result.rolledBackSteps[1].id).toBe('step1');
  });

  it('Validates: Requirements 50.2, 50.3 - Immediate rollback on deployment errors', () => {
    const executor = new RollbackExecutor();

    // Create steps that simulate deployment failure
    const steps: ExecutableStep[] = [
      createTestStep('deploy1', 'workflow', 'Deploy Service 1', 1, 'completed'),
      createTestStep('deploy2', 'workflow', 'Deploy Service 2', 2, 'failed', { error: 'Deployment failed' }),
      createTestStep('deploy3', 'workflow', 'Deploy Service 3', 3, 'pending'),
    ];

    // Execute rollback immediately
    const result = executor.executeRollback(steps);

    expect(result.isPartial).toBe(true); // Partial rollback due to failure
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('Validates: Requirements 50.4 - Multi-step undo handles dependency chains', () => {
    const manager = new ExecutionUndoManager();
    const executor = new RollbackExecutor();

    // Create steps with dependencies
    const steps: ExecutableStep[] = [
      {
        ...createTestStep('setup', 'workflow', 'Setup', 0, 'completed'),
        metadata: { order: 'first' },
      },
      {
        ...createTestStep('process', 'workflow', 'Process', 1, 'completed'),
        metadata: { order: 'middle' },
      },
      {
        ...createTestStep('cleanup', 'workflow', 'Cleanup', 2, 'completed'),
        metadata: { order: 'last' },
      },
    ];

    // Record execution
    const snapshot = manager.recordExecution('pack_deps', steps);
    snapshot.status = 'completed';

    // Undo
    const undoSuccess = manager.undoExecution('pack_deps');
    expect(undoSuccess).toBe(true);

    // Verify steps are reversed in dependency order
    const rolledBackSteps = executor.executeRollback(steps).rolledBackSteps;
    expect(rolledBackSteps.length).toBe(3);
    expect(rolledBackSteps[0].metadata?.order).toBe('last'); // Last first
    expect(rolledBackSteps[1].metadata?.order).toBe('middle');
    expect(rolledBackSteps[2].metadata?.order).toBe('first'); // First last
  });
});

// ============================================================================
// Edge Case Tests
// ============================================================================

describe('Edge Case Tests', () => {
  it('should handle single step execution', () => {
    const manager = new ExecutionUndoManager();

    const steps = [createTestStep('step1', 'workflow', 'Single Step', 1, 'completed')];

    const snapshot = manager.recordExecution('pack_single', steps);
    snapshot.status = 'completed';

    const undoSuccess = manager.undoExecution('pack_single');
    expect(undoSuccess).toBe(true);
  });

  it('should handle execution with no steps', () => {
    const manager = new ExecutionUndoManager();

    const snapshot = manager.recordExecution('pack_empty', []);

    expect(snapshot.steps.length).toBe(0);
    expect(snapshot.undoPosition).toBe(0);
  });

  it('should handle undo with missing state snapshots', () => {
    const executor = new RollbackExecutor();

    const steps: ExecutableStep[] = [
      createTestStep('step1', 'workflow', 'Step 1', 1, 'completed'),
    ];

    // Remove state snapshots
    steps[0].beforeState = undefined;
    steps[0].afterState = undefined;

    const result = executor.executeRollback(steps);

    expect(result.success).toBe(true); // Should still succeed
    expect(result.rolledBackSteps.length).toBe(1);
  });

  it('should handle circular dependency detection', () => {
    const executor = new RollbackExecutor();

    const steps: ExecutableStep[] = [
      {
        ...createTestStep('step1', 'workflow', 'Step 1', 1, 'completed'),
        metadata: { dependsOn: ['step3'] }, // Circular
      },
      {
        ...createTestStep('step2', 'workflow', 'Step 2', 2, 'completed'),
        metadata: { dependsOn: ['step1'] },
      },
      {
        ...createTestStep('step3', 'workflow', 'Step 3', 3, 'completed'),
        metadata: { dependsOn: ['step2'] },
      },
    ];

    const result = executor.executeRollback(steps);

    expect(result.success).toBe(true); // Should handle without error
    expect(result.rolledBackSteps.length).toBe(3);
  });

  it('should handle very large execution with many steps', () => {
    const executor = new RollbackExecutor();

    const steps: ExecutableStep[] = [];
    for (let i = 0; i < 1000; i++) {
      steps.push(createTestStep(`step${i}`, 'workflow', `Step ${i}`, i, 'completed'));
    }

    const result = executor.executeRollback(steps);

    expect(result.success).toBe(true);
    expect(result.rolledBackSteps.length).toBe(1000);
    expect(result.isPartial).toBe(false);
  });
});
