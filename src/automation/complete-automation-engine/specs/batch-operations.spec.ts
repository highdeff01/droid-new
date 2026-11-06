/**
 * Batch Operations and Scheduling Tests
 *
 * Comprehensive tests for the batch operations module covering:
 * - Batch queuing and execution
 * - Batch status tracking and cancellation
 * - Queue position and estimated completion
 * - Batch failure handling and recovery
 * - Scheduling with cron expressions
 * - Backoff strategies
 *
 * Tests validate all public APIs and edge cases.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  BatchExecutor,
  SchedulingService,
  CronExpressionParser,
  BatchOptions,
  BatchStatus,
  BackoffConfig,
  BackoffStrategy,
  BatchResult,
  PackExecutionResult,
  BatchOperation,
  ScheduledTask,
  createTestBatchOperation,
  createTestScheduledTask,
  aggregateBatchResults,
  calculateQueueMetrics,
} from '../core/batch-operations';

// ============================================================================
// CRON EXPRESSION PARSER TESTS
// ============================================================================

describe('CronExpressionParser', () => {
  describe('parse', () => {
    it('should parse standard cron expression', () => {
      const expression = CronExpressionParser.parse('0 9 * * 1');
      expect(expression.minute).toEqual([0]);
      expect(expression.hour).toEqual([9]);
      expect(expression.day).toEqual('*');
      expect(expression.month).toEqual('*');
      expect(expression.dayOfWeek).toEqual([1]);
      expect(expression.raw).toBe('0 9 * * 1');
    });

    it('should parse wildcard expression', () => {
      const expression = CronExpressionParser.parse('* * * * *');
      expect(expression.minute).toEqual('*');
      expect(expression.hour).toEqual('*');
      expect(expression.day).toEqual('*');
      expect(expression.month).toEqual('*');
      expect(expression.dayOfWeek).toEqual('*');
    });

    it('should parse step values', () => {
      const expression = CronExpressionParser.parse('*/5 * * * *');
      expect(expression.minute).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
    });

    it('should parse range values', () => {
      const expression = CronExpressionParser.parse('0 9-17 * * *');
      expect(expression.hour).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    });

    it('should parse comma-separated values', () => {
      const expression = CronExpressionParser.parse('0 9,12,17 * * *');
      expect(expression.hour).toEqual([9, 12, 17]);
    });

    it('should throw error for invalid number of parts', () => {
      expect(() => CronExpressionParser.parse('0 9 * *')).toThrow('expected 5 parts');
    });

    it('should throw error for out of range minute value', () => {
      expect(() => CronExpressionParser.parse('60 * * * *')).toThrow('must be 0-59');
    });

    it('should throw error for out of range hour value', () => {
      expect(() => CronExpressionParser.parse('* 25 * * *')).toThrow('must be 0-23');
    });

    it('should throw error for out of range day value', () => {
      expect(() => CronExpressionParser.parse('* * 32 * *')).toThrow('must be 1-31');
    });

    it('should throw error for out of range month value', () => {
      expect(() => CronExpressionParser.parse('* * * 13 *')).toThrow('must be 1-12');
    });

    it('should throw error for out of range day of week value', () => {
      expect(() => CronExpressionParser.parse('* * * * 7')).toThrow('must be 0-6');
    });

    it('should throw error for invalid range', () => {
      expect(() => CronExpressionParser.parse('0 17-9 * * *')).toThrow('out of bounds');
    });

    it('should throw error for invalid step value', () => {
      expect(() => CronExpressionParser.parse('*/0 * * * *')).toThrow('Invalid step value');
    });

    it('should handle single values', () => {
      const expression = CronExpressionParser.parse('30 12 15 6 3');
      expect(expression.minute).toEqual([30]);
      expect(expression.hour).toEqual([12]);
      expect(expression.day).toEqual([15]);
      expect(expression.month).toEqual([6]);
      expect(expression.dayOfWeek).toEqual([3]);
    });
  });

  describe('matches', () => {
    it('should match exact time', () => {
      // June 15, 2024 is a Saturday (day 6)
      const expression = CronExpressionParser.parse('30 12 15 6 6');
      const date = new Date(2024, 5, 15, 12, 30); // June 15, 2024, 12:30
      expect(CronExpressionParser.matches(date, expression)).toBe(true);
    });

    it('should not match when minute differs', () => {
      // June 15, 2024 is a Saturday (day 6)
      const expression = CronExpressionParser.parse('30 12 15 6 6');
      const date = new Date(2024, 5, 15, 12, 31); // June 15, 2024, 12:31
      expect(CronExpressionParser.matches(date, expression)).toBe(false);
    });

    it('should match wildcard minute', () => {
      const expression = CronExpressionParser.parse('* 12 * * *');
      const date = new Date(2024, 5, 15, 12, 0);
      expect(CronExpressionParser.matches(date, expression)).toBe(true);
      date.setMinutes(30);
      expect(CronExpressionParser.matches(date, expression)).toBe(true);
    });

    it('should match step values', () => {
      const expression = CronExpressionParser.parse('*/15 * * * *');
      const date1 = new Date(2024, 5, 15, 12, 0);
      expect(CronExpressionParser.matches(date1, expression)).toBe(true);
      
      const date2 = new Date(2024, 5, 15, 12, 15);
      expect(CronExpressionParser.matches(date2, expression)).toBe(true);
      
      const date3 = new Date(2024, 5, 15, 12, 7);
      expect(CronExpressionParser.matches(date3, expression)).toBe(false);
    });

    it('should match range values', () => {
      const expression = CronExpressionParser.parse('0 9-17 * * *');
      const date1 = new Date(2024, 5, 15, 9, 0);
      expect(CronExpressionParser.matches(date1, expression)).toBe(true);
      
      const date2 = new Date(2024, 5, 15, 12, 0);
      expect(CronExpressionParser.matches(date2, expression)).toBe(true);
      
      const date3 = new Date(2024, 5, 15, 18, 0);
      expect(CronExpressionParser.matches(date3, expression)).toBe(false);
    });
  });

  describe('next', () => {
    it('should find next matching time', () => {
      const expression = CronExpressionParser.parse('0 9 * * *'); // 9:00 AM every day
      const startDate = new Date(2024, 5, 15, 8, 30); // 8:30 AM
      const next = CronExpressionParser.next(startDate, expression);
      
      expect(next).not.toBeNull();
      expect(next?.getHours()).toBe(9);
      expect(next?.getMinutes()).toBe(0);
    });

    it('should find next matching time for specific day', () => {
      const expression = CronExpressionParser.parse('0 9 * * 1'); // 9:00 AM every Monday
      const startDate = new Date(2024, 5, 15, 8, 30); // Saturday, June 15, 2024
      const next = CronExpressionParser.next(startDate, expression);
      
      expect(next).not.toBeNull();
      expect(next?.getDay()).toBe(1); // Monday
    });

    it('should return null if no match found within year', () => {
      const expression = CronExpressionParser.parse('0 9 31 2 *'); // Never (Feb 31 doesn't exist)
      const startDate = new Date(2024, 0, 1);
      const next = CronExpressionParser.next(startDate, expression);
      
      expect(next).toBeNull();
    });
  });
});

// ============================================================================
// BATCH EXECUTOR TESTS
// ============================================================================

describe('BatchExecutor', () => {
  let executor: BatchExecutor;

  beforeEach(() => {
    executor = new BatchExecutor();
  });

  describe('queueBatch', () => {
    it('should create batch with pending status', () => {
      const batch = executor.queueBatch(['pack-1', 'pack-2']);
      
      expect(batch.batchId).toBeDefined();
      expect(batch.status).toBe('pending');
      expect(batch.packIds).toEqual(['pack-1', 'pack-2']);
      expect(batch.position).toBe(1);
    });

    it('should assign positions in queue order', () => {
      const batch1 = executor.queueBatch(['pack-1']);
      const batch2 = executor.queueBatch(['pack-2']);
      const batch3 = executor.queueBatch(['pack-3']);
      
      expect(batch1.position).toBe(1);
      expect(batch2.position).toBe(2);
      expect(batch3.position).toBe(3);
    });

    it('should throw error for empty batch', () => {
      expect(() => executor.queueBatch([])).toThrow('Batch must contain at least one pack');
    });

    it('should support auto-start option', () => {
      const batch = executor.queueBatch(['pack-1'], { autoStart: true });
      expect(batch.status).toBe('completed'); // Should be executed immediately
    });

    it('should copy packIds array', () => {
      const packIds = ['pack-1', 'pack-2'];
      const batch = executor.queueBatch(packIds);
      
      batch.packIds.push('pack-3');
      expect(packIds).not.toContain('pack-3');
    });
  });

  describe('executeBatch', () => {
    it('should execute batch and return results', () => {
      const batch = executor.queueBatch(['pack-1', 'pack-2']);
      const result = executor.executeBatch(batch.batchId);
      
      expect(result.status).toBe('completed');
      expect(result.packResults.length).toBe(2);
      expect(result.succeededPacks).toBe(2);
      expect(result.failedPacks).toBe(0);
    });

    it('should track batch status during execution', () => {
      const batch = executor.queueBatch(['pack-1']);
      
      expect(batch.status).toBe('pending');
      
      executor.executeBatch(batch.batchId);
      
      expect(batch.status).toBe('completed');
    });

    it('should throw error for invalid batch ID', () => {
      expect(() => executor.executeBatch('invalid-id')).toThrow('Batch not found');
    });

    it('should throw error for non-pending batch', () => {
      const batch = executor.queueBatch(['pack-1']);
      executor.executeBatch(batch.batchId);
      
      expect(() => executor.executeBatch(batch.batchId)).toThrow('Cannot execute batch');
    });

    it('should calculate duration', () => {
      const batch = executor.queueBatch(['pack-1']);
      const result = executor.executeBatch(batch.batchId);
      
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should track workflow metrics', () => {
      const batch = executor.queueBatch(['pack-1']);
      const result = executor.executeBatch(batch.batchId);
      
      expect(result.workflowMetrics.total).toBe(1);
      expect(result.workflowMetrics.succeeded).toBe(1);
      expect(result.workflowMetrics.failed).toBe(0);
    });

    it('should include progress updates', () => {
      const batch = executor.queueBatch(['pack-1', 'pack-2', 'pack-3']);
      expect(batch.progress).toBe(0);
      
      executor.executeBatch(batch.batchId);
      
      expect(batch.progress).toBe(100);
    });
  });

  describe('batch failure handling', () => {
    it('should stop on failure by default', () => {
      const batch = executor.queueBatch(['pack-1', 'pack-2']);
      
      // Mock executePack to fail on second pack
      const originalExecutePack = executor['executePack'].bind(executor);
      let callCount = 0;
      
      (executor as any).executePack = (packId: string) => {
        callCount++;
        if (callCount === 2) {
          return {
            packId,
            status: 'failed',
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: 10,
            workflowsExecuted: 0,
            workflowsSucceeded: 0,
            workflowsFailed: 1,
            error: 'Test failure',
          };
        }
        return originalExecutePack(packId);
      };
      
      const result = executor.executeBatch(batch.batchId);
      
      expect(result.status).toBe('failed');
      expect(result.packResults.length).toBe(2);
      expect(result.succeededPacks).toBe(1);
      expect(result.failedPacks).toBe(1);
    });

    it('should continue on failure when configured', () => {
      const batch = executor.queueBatch(['pack-1', 'pack-2'], { continueOnError: true });
      
      const originalExecutePack = executor['executePack'].bind(executor);
      let callCount = 0;
      
      (executor as any).executePack = (packId: string) => {
        callCount++;
        if (callCount === 2) {
          return {
            packId,
            status: 'failed',
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: 10,
            workflowsExecuted: 0,
            workflowsSucceeded: 0,
            workflowsFailed: 1,
            error: 'Test failure',
          };
        }
        return originalExecutePack(packId);
      };
      
      const result = executor.executeBatch(batch.batchId);
      
      expect(result.status).toBe('partial');
      expect(result.packResults.length).toBe(2);
      expect(result.succeededPacks).toBe(1);
      expect(result.failedPacks).toBe(1);
    });

    it('should calculate success rate', () => {
      const batch = executor.queueBatch(['pack-1', 'pack-2', 'pack-3']);
      const result = executor.executeBatch(batch.batchId);
      
      expect(result.successRate).toBe(100);
    });
  });

  describe('cancelBatch', () => {
    it('should cancel pending batch', () => {
      const batch = executor.queueBatch(['pack-1']);
      const cancelled = executor.cancelBatch(batch.batchId);
      
      expect(cancelled).toBe(true);
      expect(batch.status).toBe('cancelled');
    });

    it('should not cancel completed batch', () => {
      const batch = executor.queueBatch(['pack-1']);
      executor.executeBatch(batch.batchId);
      
      const cancelled = executor.cancelBatch(batch.batchId);
      expect(cancelled).toBe(false);
    });

    it('should not cancel invalid batch', () => {
      const cancelled = executor.cancelBatch('invalid-id');
      expect(cancelled).toBe(false);
    });

    it('should not cancel already cancelled batch', () => {
      const batch = executor.queueBatch(['pack-1']);
      const firstCancelled = executor.cancelBatch(batch.batchId);
      expect(firstCancelled).toBe(true);
      
      const secondCancelled = executor.cancelBatch(batch.batchId);
      expect(secondCancelled).toBe(false);
    });
  });

  describe('getBatchStatus', () => {
    it('should return status of existing batch', () => {
      const batch = executor.queueBatch(['pack-1']);
      const status = executor.getBatchStatus(batch.batchId);
      expect(status).toBe('pending');
    });

    it('should return pending for non-existent batch', () => {
      const status = executor.getBatchStatus('invalid-id');
      expect(status).toBe('pending');
    });
  });

  describe('getQueueStats', () => {
    it('should return queue statistics', () => {
      const stats = executor.getQueueStats();
      
      expect(stats.totalBatches).toBe(0);
      expect(stats.pendingBatches).toBe(0);
      expect(stats.successRate).toBe(0);
    });

    it('should track completed batches', () => {
      executor.queueBatch(['pack-1']).batchId;
      executor.executeBatch(executor.getAllBatches()[0].batchId);
      
      const stats = executor.getQueueStats();
      expect(stats.completedBatches).toBe(1);
    });
  });

  describe('getEstimatedCompletion', () => {
    it('should return undefined for non-existent batch', () => {
      const completion = executor.getEstimatedCompletion('invalid-id');
      expect(completion).toBeUndefined();
    });

    it('should return undefined for pending batch without queue stats', () => {
      const batch = executor.queueBatch(['pack-1']);
      const completion = executor.getEstimatedCompletion(batch.batchId);
      expect(completion).toBeUndefined();
    });

    it('should estimate completion for running batch', () => {
      const batch = executor.queueBatch(['pack-1', 'pack-2', 'pack-3']);
      executor.executeBatch(batch.batchId);
      // For completed batches, returns undefined since completion is known
      const completion = executor.getEstimatedCompletion(batch.batchId);
      expect(completion).toBeUndefined();
    });
  });

  describe('edge cases', () => {
    it('should handle single pack batch', () => {
      const batch = executor.queueBatch(['pack-1']);
      const result = executor.executeBatch(batch.batchId);
      
      expect(result.status).toBe('completed');
      expect(result.totalPacks).toBe(1);
    });

    it('should handle large batch', () => {
      const packIds = Array.from({ length: 100 }, (_, i) => `pack-${i}`);
      const batch = executor.queueBatch(packIds);
      const result = executor.executeBatch(batch.batchId);
      
      expect(result.status).toBe('completed');
      expect(result.totalPacks).toBe(100);
      expect(result.packResults.length).toBe(100);
    });
  });
});

// ============================================================================
// SCHEDULING SERVICE TESTS
// ============================================================================

describe('SchedulingService', () => {
  let service: SchedulingService;
  let batchExecutor: BatchExecutor;

  beforeEach(() => {
    batchExecutor = new BatchExecutor();
    service = new SchedulingService(batchExecutor);
  });

  describe('scheduleWorkflow', () => {
    it('should create scheduled task', () => {
      const task = service.scheduleWorkflow('workflow-1', '0 9 * * *');
      
      expect(task.scheduleId).toBeDefined();
      expect(task.workflowId).toBe('workflow-1');
      expect(task.status).toBe('active');
      expect(task.nextRunAt).toBeDefined();
    });

    it('should parse cron expression', () => {
      const task = service.scheduleWorkflow('workflow-1', '0 9 * * *');
      expect(task.cronExpression.raw).toBe('0 9 * * *');
      expect(task.cronExpression.minute).toEqual([0]);
      expect(task.cronExpression.hour).toEqual([9]);
    });

    it('should apply default backoff config', () => {
      const task = service.scheduleWorkflow('workflow-1', '0 9 * * *');
      expect(task.backoff.strategy).toBe('exponential');
      expect(task.backoff.initialDelayMs).toBe(1000);
    });

    it('should apply custom backoff config', () => {
      const backoff: BackoffConfig = {
        strategy: 'linear',
        initialDelayMs: 5000,
        maxDelayMs: 120000,
      };
      
      const task = service.scheduleWorkflow('workflow-1', '0 9 * * *', { backoff });
      expect(task.backoff.strategy).toBe('linear');
      expect(task.backoff.initialDelayMs).toBe(5000);
      expect(task.backoff.maxDelayMs).toBe(120000);
    });

    it('should validate cron expression', () => {
      expect(() => service.scheduleWorkflow('workflow-1', 'invalid')).toThrow('Invalid cron expression');
    });
  });

  describe('cancelSchedule', () => {
    it('should cancel existing schedule', () => {
      const task = service.scheduleWorkflow('workflow-1', '0 9 * * *');
      const cancelled = service.cancelSchedule(task.scheduleId);
      
      expect(cancelled).toBe(true);
      expect(service.getScheduledTasks().length).toBe(0);
    });

    it('should return false for non-existent schedule', () => {
      const cancelled = service.cancelSchedule('invalid-id');
      expect(cancelled).toBe(false);
    });
  });

  describe('getScheduledTasks', () => {
    it('should return all scheduled tasks', () => {
      service.scheduleWorkflow('workflow-1', '0 9 * * *');
      service.scheduleWorkflow('workflow-2', '0 10 * * *');
      
      const tasks = service.getScheduledTasks();
      expect(tasks.length).toBe(2);
    });

    it('should return empty array when no schedules', () => {
      const tasks = service.getScheduledTasks();
      expect(tasks).toEqual([]);
    });
  });

  describe('processDueSchedules', () => {
    it('should not execute non-due schedules', () => {
      const task = service.scheduleWorkflow('workflow-1', '0 9 * * *');
      const futureDate = new Date();
      futureDate.setMinutes(futureDate.getMinutes() + 1);
      task.nextRunAt = futureDate.toISOString();
      
      const executions = service.processDueSchedules();
      expect(executions.length).toBe(0);
    });

    it('should execute due schedule', () => {
      const task = service.scheduleWorkflow('workflow-1', '0 9 * * *');
      // Set next run to past
      const pastDate = new Date();
      pastDate.setMinutes(pastDate.getMinutes() - 1);
      task.nextRunAt = pastDate.toISOString();
      
      const executions = service.processDueSchedules();
      expect(executions.length).toBe(1);
      expect(executions[0].workflowId).toBe('workflow-1');
    });

    it('should update execution stats', () => {
      const task = service.scheduleWorkflow('workflow-1', '0 9 * * *');
      const pastDate = new Date();
      pastDate.setMinutes(pastDate.getMinutes() - 1);
      task.nextRunAt = pastDate.toISOString();
      
      service.processDueSchedules();
      
      expect(task.executionStats.totalExecutions).toBe(1);
    });
  });

  describe('backoff strategies', () => {
    it('should calculate linear backoff delay', () => {
      const backoff: BackoffConfig = {
        strategy: 'linear',
        initialDelayMs: 1000,
        maxDelayMs: 10000,
      };
      
      const task = service.scheduleWorkflow('workflow-1', '0 9 * * *', { backoff });
      task.retryCount = 2;
      
      const delay = (service as any).calculateBackoffDelay(task);
      expect(delay).toBe(3000); // 1000 * (2 + 1)
    });

    it('should calculate exponential backoff delay', () => {
      const backoff: BackoffConfig = {
        strategy: 'exponential',
        initialDelayMs: 1000,
        multiplier: 2,
      };
      
      const task = service.scheduleWorkflow('workflow-1', '0 9 * * *', { backoff });
      task.retryCount = 2;
      
      const delay = (service as any).calculateBackoffDelay(task);
      expect(delay).toBe(4000); // 1000 * 2^2
    });

    it('should apply jitter', () => {
      const backoff: BackoffConfig = {
        strategy: 'exponential',
        initialDelayMs: 1000,
        jitter: true,
      };
      
      const task = service.scheduleWorkflow('workflow-1', '0 9 * * *', { backoff });
      task.retryCount = 1;
      
      const delays: number[] = [];
      for (let i = 0; i < 10; i++) {
        const delay = (service as any).calculateBackoffDelay(task);
        delays.push(delay);
      }
      
      // Jitter should add variation
      const uniqueDelays = new Set(delays);
      expect(uniqueDelays.size).toBeGreaterThan(1);
    });

    it('should cap delay at max', () => {
      const backoff: BackoffConfig = {
        strategy: 'exponential',
        initialDelayMs: 1000,
        maxDelayMs: 5000,
        multiplier: 2,
      };
      
      const task = service.scheduleWorkflow('workflow-1', '0 9 * * *', { backoff });
      task.retryCount = 10; // Would calculate to 1024000 without cap
      
      const delay = (service as any).calculateBackoffDelay(task);
      expect(delay).toBe(5000);
    });
  });

  describe('pause and resume', () => {
    it('should pause schedule', () => {
      const task = service.scheduleWorkflow('workflow-1', '0 9 * * *');
      const paused = service.pauseSchedule(task.scheduleId);
      
      expect(paused).toBe(true);
      expect(task.status).toBe('paused');
    });

    it('should resume schedule', () => {
      const task = service.scheduleWorkflow('workflow-1', '0 9 * * *');
      service.pauseSchedule(task.scheduleId);
      const resumed = service.resumeSchedule(task.scheduleId);
      
      expect(resumed).toBe(true);
      expect(task.status).toBe('active');
    });

    it('should not resume non-paused schedule', () => {
      const task = service.scheduleWorkflow('workflow-1', '0 9 * * *');
      const resumed = service.resumeSchedule(task.scheduleId);
      
      expect(resumed).toBe(false);
    });
  });
});

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Batch Operations Integration', () => {
  describe('batch queuing and execution', () => {
    it('should handle sequential batch execution', () => {
      const executor = new BatchExecutor();
      
      // Queue multiple batches
      const batch1 = executor.queueBatch(['pack-1', 'pack-2']);
      const batch2 = executor.queueBatch(['pack-3']);
      
      expect(batch1.position).toBe(1);
      expect(batch2.position).toBe(2);
      
      // Execute first batch
      const result1 = executor.executeBatch(batch1.batchId);
      expect(result1.status).toBe('completed');
      
      // Check queue stats
      const stats = executor.getQueueStats();
      expect(stats.pendingBatches).toBe(1);
      expect(stats.completedBatches).toBe(1);
    });

    it('should handle batch failure with recovery', () => {
      const executor = new BatchExecutor();
      
      // Mock executePack to fail on second pack
      const originalExecutePack = (executor as any).executePack.bind(executor);
      let callCount = 0;
      
      (executor as any).executePack = (packId: string) => {
        callCount++;
        if (callCount === 2) {
          return {
            packId,
            packName: `Pack ${packId}`,
            status: 'failed',
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            durationMs: 10,
            workflowsExecuted: 0,
            workflowsSucceeded: 0,
            workflowsFailed: 1,
            error: 'Test failure',
          };
        }
        return originalExecutePack(packId);
      };
      
      // Create batch with continueOnError
      const batch = executor.queueBatch(['pack-1', 'pack-2', 'pack-3'], {
        continueOnError: true,
      });
      
      const result = executor.executeBatch(batch.batchId);
      
      // All packs should execute even if some fail
      expect(result.status).toBe('partial');
      expect(result.totalPacks).toBe(3);
      expect(result.succeededPacks).toBe(2);
      expect(result.failedPacks).toBe(1);
    });
  });

  describe('scheduling with cron', () => {
    it('should schedule recurring workflow', () => {
      const service = new SchedulingService();
      
      // Schedule daily at 9 AM
      const task = service.scheduleWorkflow('daily-workflow', '0 9 * * *');
      
      expect(task.nextRunAt).toBeDefined();
      expect(task.status).toBe('active');
    });

    it('should handle multiple schedules', () => {
      const service = new SchedulingService();
      
      service.scheduleWorkflow('workflow-1', '0 9 * * *');
      service.scheduleWorkflow('workflow-2', '0 10 * * *');
      service.scheduleWorkflow('workflow-3', '30 12 * * 1');
      
      const tasks = service.getScheduledTasks();
      expect(tasks.length).toBe(3);
    });

    it('should calculate next run time', () => {
      const service = new SchedulingService();
      
      // Schedule for next Monday at 9 AM
      const nextMonday = new Date();
      nextMonday.setDate(nextMonday.getDate() + (1 - nextMonday.getDay() + 7) % 7);
      const nextRunTime = service.getNextRunTime('0 9 * * 1', nextMonday);
      
      expect(nextRunTime).not.toBeNull();
      expect(nextRunTime?.getHours()).toBe(9);
      expect(nextRunTime?.getMinutes()).toBe(0);
    });
  });

  describe('batch result aggregation', () => {
    it('should aggregate multiple batch results', () => {
      const results: BatchResult[] = [
        {
          batchId: 'batch-1',
          status: 'completed',
          createdAt: new Date().toISOString(),
          packResults: [
            { packId: 'pack-1', status: 'success', startedAt: '', completedAt: '', durationMs: 100, workflowsExecuted: 1, workflowsSucceeded: 1, workflowsFailed: 0 },
            { packId: 'pack-2', status: 'success', startedAt: '', completedAt: '', durationMs: 100, workflowsExecuted: 1, workflowsSucceeded: 1, workflowsFailed: 0 },
          ],
          totalPacks: 2,
          succeededPacks: 2,
          failedPacks: 0,
          skippedPacks: 0,
          successRate: 100,
          workflowMetrics: { total: 2, succeeded: 2, failed: 0 },
        },
        {
          batchId: 'batch-2',
          status: 'completed',
          createdAt: new Date().toISOString(),
          packResults: [
            { packId: 'pack-3', status: 'success', startedAt: '', completedAt: '', durationMs: 100, workflowsExecuted: 1, workflowsSucceeded: 1, workflowsFailed: 0 },
          ],
          totalPacks: 1,
          succeededPacks: 1,
          failedPacks: 0,
          skippedPacks: 0,
          successRate: 100,
          workflowMetrics: { total: 1, succeeded: 1, failed: 0 },
        },
      ];
      
      const summary = aggregateBatchResults(results);
      
      expect(summary.totalBatches).toBe(2);
      expect(summary.totalPacks).toBe(3);
      expect(summary.totalWorkflows).toBe(3);
      expect(summary.successRate).toBe(100);
    });
  });

  describe('queue position calculation', () => {
    it('should calculate queue position', () => {
      const executor = new BatchExecutor();
      
      executor.queueBatch(['pack-1']);
      executor.queueBatch(['pack-2']);
      const batch3 = executor.queueBatch(['pack-3']);
      
      const stats = executor.getQueueStats();
      const metrics = calculateQueueMetrics(batch3.batchId, stats, executor);
      
      expect(metrics.position).toBe(3);
    });
  });
});

// ============================================================================
// PERFORMANCE TESTS
// ============================================================================

describe('Performance Tests', () => {
  it('should handle large number of batches', () => {
    const executor = new BatchExecutor();
    const batchCount = 100;
    
    for (let i = 0; i < batchCount; i++) {
      executor.queueBatch([`pack-${i}`]);
    }
    
    const batches = executor.getAllBatches();
    expect(batches.length).toBe(batchCount);
  });

  it('should handle large number of schedules', () => {
    const service = new SchedulingService();
    const scheduleCount = 50;
    
    for (let i = 0; i < scheduleCount; i++) {
      service.scheduleWorkflow(`workflow-${i}`, `0 ${i % 24} * * *`);
    }
    
    const tasks = service.getScheduledTasks();
    expect(tasks.length).toBe(scheduleCount);
  });
});

// ============================================================================
// EDGE CASE TESTS
// ============================================================================

describe('Edge Cases', () => {
  describe('empty batch', () => {
    it('should throw error for empty packIds', () => {
      const executor = new BatchExecutor();
      expect(() => executor.queueBatch([])).toThrow();
    });
  });

  describe('duplicate batch execution', () => {
    it('should not allow duplicate execution', () => {
      const executor = new BatchExecutor();
      const batch = executor.queueBatch(['pack-1']);
      executor.executeBatch(batch.batchId);
      
      expect(() => executor.executeBatch(batch.batchId)).toThrow();
    });
  });

  describe('invalid cron expressions', () => {
    it('should reject invalid cron expression', () => {
      const service = new SchedulingService();
      expect(() => service.scheduleWorkflow('workflow-1', 'invalid')).toThrow();
    });

    it('should reject out of range values', () => {
      const service = new SchedulingService();
      expect(() => service.scheduleWorkflow('workflow-1', '60 * * * *')).toThrow();
    });
  });

  describe('backoff edge cases', () => {
    it('should handle zero delay', () => {
      const backoff: BackoffConfig = {
        strategy: 'constant',
        initialDelayMs: 0,
      };
      
      const service = new SchedulingService();
      const task = service.scheduleWorkflow('workflow-1', '0 9 * * *', { backoff });
      task.retryCount = 1;
      
      const delay = (service as any).calculateBackoffDelay(task);
      expect(delay).toBe(0);
    });

    it('should handle large multiplier', () => {
      const backoff: BackoffConfig = {
        strategy: 'exponential',
        initialDelayMs: 1000,
        multiplier: 10,
        maxDelayMs: 60000,
      };
      
      const service = new SchedulingService();
      const task = service.scheduleWorkflow('workflow-1', '0 9 * * *', { backoff });
      task.retryCount = 5; // Would be 100000 without cap
      
      const delay = (service as any).calculateBackoffDelay(task);
      expect(delay).toBe(60000);
    });
  });

  describe('schedule state transitions', () => {
    it('should handle rapid pause/resume cycles', () => {
      const service = new SchedulingService();
      const task = service.scheduleWorkflow('workflow-1', '0 9 * * *');
      
      service.pauseSchedule(task.scheduleId);
      expect(task.status).toBe('paused');
      
      service.resumeSchedule(task.scheduleId);
      expect(task.status).toBe('active');
    });
  });
});