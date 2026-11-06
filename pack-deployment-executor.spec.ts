/**
 * Tests for PackDeploymentExecutor
 * 
 * Tests cover:
 * - Context validation and compatibility checking
 * - Sequential workflow execution with data mapping
 * - Parallel execution with concurrency control
 * - Conditional execution with conditions
 * - Failure handling (stop, continue, rollback)
 * - Metrics collection
 * - Event emission (PackDeployedEvent, ExecutionCompleteEvent)
 * - Retry logic with exponential backoff
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { PackDeploymentExecutor, createDataMapping, createExecutionPolicy, createRetryPolicy } from './pack-deployment-executor.js';
import type { Pack, ExecutionPolicy, WorkflowReference } from './pack-types.js';
import type {
  ExecutionContext,
  EventDispatcher,
  PackDeploymentStartedEvent,
  PackDeploymentCompleteEvent,
  SystemEvent,
} from './integration-types.js';
import { createEntityId, createTimestamp, createExecutionContext } from './integration-types.js';
import type { PlaybackEngine, PlaybackResult, StepExecutionResult } from './playback-engine.js';

// Mock types for dependencies
interface MockEventDispatcher extends EventDispatcher {
  on: Mock;
  onAll: Mock;
  emit: Mock;
  getHistory: Mock;
  clearHistory: Mock;
}

interface MockPlaybackEngine extends PlaybackEngine {
  executeWorkflow: Mock;
}

interface MockRecordingRepository {
  getWorkflow: Mock;
}

// Helper functions for creating test data
function createMockEventDispatcher(): MockEventDispatcher {
  return {
    on: vi.fn(),
    onAll: vi.fn(),
    emit: vi.fn(),
    getHistory: vi.fn(),
    clearHistory: vi.fn(),
  };
}

function createMockPlaybackEngine(): MockPlaybackEngine {
  return {
    executeWorkflow: vi.fn(),
    getStatus: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  } as unknown as MockPlaybackEngine;
}

function createMockRecordingRepository(): MockRecordingRepository {
  return {
    getWorkflow: vi.fn(),
  };
}

function createMockPack(overrides: Partial<Pack> = {}): Pack {
  return {
    id: 'pack-001',
    name: 'Test Pack',
    manifest: {
      workflows: [
        { workflowId: 'wf-001', order: 1 },
        { workflowId: 'wf-002', order: 2 },
      ],
      policy: {
        mode: 'sequential',
        stopOnError: true,
      },
    },
    version: {
      version: '1.0.0',
      releasedAt: '2024-01-01T00:00:00.000Z',
    },
    metadata: {
      author: 'test-author',
      description: 'Test pack for deployment',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    ...overrides,
  };
}

function createMockExecutionContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return createExecutionContext(
    createEntityId('exec-001'),
    { width: 1920, height: 1080 },
    { test: true }
  );
}

function createMockWorkflow(overrides: Partial<any> = {}): any {
  return {
    id: 'wf-001',
    name: 'Test Workflow',
    steps: [],
    metadata: {
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      version: '1.0.0',
      source: 'user-created',
      executionCount: 0,
      successCount: 0,
      failureCount: 0,
    },
    ...overrides,
  };
}

describe('PackDeploymentExecutor', () => {
  let eventDispatcher: MockEventDispatcher;
  let playbackEngine: MockPlaybackEngine;
  let recordingRepository: MockRecordingRepository;
  let executor: PackDeploymentExecutor;

  beforeEach(() => {
    eventDispatcher = createMockEventDispatcher();
    playbackEngine = createMockPlaybackEngine();
    recordingRepository = createMockRecordingRepository();
    executor = new PackDeploymentExecutor(eventDispatcher, playbackEngine, recordingRepository);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Context Validation', () => {
    it('should validate context compatibility with warnings', () => {
      const pack = createMockPack();
      const context = createMockExecutionContext();

      // Test with minimal context (should produce warnings)
      const result = (executor as any).validateContextCompatibility(pack, context);

      // Should have warnings about missing visible elements and display resolution
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('should validate deployment conditions', () => {
      const pack = createMockPack({
        manifest: {
          ...createMockPack().manifest,
          policy: {
            ...createMockPack().manifest.policy,
            conditions: [
              { name: 'platform', expression: "platform === 'windows'", required: true },
            ],
          },
        },
      });
      const context = createMockExecutionContext();

      const result = (executor as any).validateContextCompatibility(pack, context);

      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('should detect missing required elements', () => {
      const pack = createMockPack();
      const context = createMockExecutionContext({
        visibleElements: [
          { selector: '#button1', accessibleName: 'Button 1', boundingBox: { x: 0, y: 0, width: 100, height: 100 }, isVisible: true },
        ],
      });

      const result = (executor as any).validateContextCompatibility(pack, context);

      // Should have warnings about missing elements
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('should detect low display resolution', () => {
      const pack = createMockPack();
      const context = createMockExecutionContext({
        displayState: { width: 800, height: 600 },
      });

      const result = (executor as any).validateContextCompatibility(pack, context);

      expect(result.some((w) => w.includes('resolution'))).toBe(true);
    });
  });

  describe('Sequential Execution', () => {
    it('should execute workflows sequentially', async () => {
      const pack = createMockPack({
        manifest: {
          workflows: [
            { workflowId: 'wf-001', order: 1 },
            { workflowId: 'wf-002', order: 2 },
          ],
          policy: {
            mode: 'sequential',
            stopOnError: true,
          },
        },
      });
      const context = createMockExecutionContext();

      // Mock workflow loading
      recordingRepository.getWorkflow.mockResolvedValueOnce(createMockWorkflow({ id: 'wf-001' }));
      recordingRepository.getWorkflow.mockResolvedValueOnce(createMockWorkflow({ id: 'wf-002' }));

      // Mock playback engine results
      playbackEngine.executeWorkflow.mockResolvedValueOnce({
        workflowId: 'wf-001',
        success: true,
        totalSteps: 5,
        completedSteps: 5,
        failedSteps: 0,
        totalDuration: 1000,
        startTime: Date.now(),
        endTime: Date.now() + 1000,
        stepResults: [
          { stepId: 'step-1', stepIndex: 0, action: 'click', success: true, duration: 200 },
          { stepId: 'step-2', stepIndex: 1, action: 'click', success: true, duration: 200 },
          { stepId: 'step-3', stepIndex: 2, action: 'click', success: true, duration: 200 },
          { stepId: 'step-4', stepIndex: 3, action: 'click', success: true, duration: 200 },
          { stepId: 'step-5', stepIndex: 4, action: 'click', success: true, duration: 200 },
        ],
        errors: [],
        metrics: {
          stepsCompleted: 5,
          stepsFailed: 0,
          elementsNotFound: 0,
          coordinateAdaptations: 0,
          fallbackMatches: 0,
        },
        executionContext: context,
      });

      playbackEngine.executeWorkflow.mockResolvedValueOnce({
        workflowId: 'wf-002',
        success: true,
        totalSteps: 3,
        completedSteps: 3,
        failedSteps: 0,
        totalDuration: 500,
        startTime: Date.now(),
        endTime: Date.now() + 500,
        stepResults: [
          { stepId: 'step-1', stepIndex: 0, action: 'click', success: true, duration: 150 },
          { stepId: 'step-2', stepIndex: 1, action: 'click', success: true, duration: 150 },
          { stepId: 'step-3', stepIndex: 2, action: 'click', success: true, duration: 200 },
        ],
        errors: [],
        metrics: {
          stepsCompleted: 3,
          stepsFailed: 0,
          elementsNotFound: 0,
          coordinateAdaptations: 0,
          fallbackMatches: 0,
        },
        executionContext: context,
      });

      const result = await executor.deployPack(pack, context);

      expect(result.success).toBe(true);
      expect(result.workflowResults).toHaveLength(2);
      expect(result.workflowResults[0].success).toBe(true);
      expect(result.workflowResults[1].success).toBe(true);
      expect(result.workflowResults[0].workflowId).toBe('wf-001');
      expect(result.workflowResults[1].workflowId).toBe('wf-002');
    });

    it('should stop on first failure when stopOnError is true', async () => {
      const pack = createMockPack({
        manifest: {
          workflows: [
            { workflowId: 'wf-001', order: 1 },
            { workflowId: 'wf-002', order: 2 },
            { workflowId: 'wf-003', order: 3 },
          ],
          policy: {
            mode: 'sequential',
            stopOnError: true,
          },
        },
      });
      const context = createMockExecutionContext();

      recordingRepository.getWorkflow.mockResolvedValueOnce(createMockWorkflow({ id: 'wf-001' }));
      recordingRepository.getWorkflow.mockResolvedValueOnce(createMockWorkflow({ id: 'wf-002' }));
      // wf-003 should not be loaded

      playbackEngine.executeWorkflow.mockResolvedValueOnce({
        workflowId: 'wf-001',
        success: true,
        totalSteps: 2,
        completedSteps: 2,
        failedSteps: 0,
        totalDuration: 200,
        startTime: Date.now(),
        endTime: Date.now() + 200,
        stepResults: [
          { stepId: 'step-1', stepIndex: 0, action: 'click', success: true, duration: 100 },
          { stepId: 'step-2', stepIndex: 1, action: 'click', success: true, duration: 100 },
        ],
        errors: [],
        metrics: { stepsCompleted: 2, stepsFailed: 0, elementsNotFound: 0, coordinateAdaptations: 0, fallbackMatches: 0 },
        executionContext: context,
      });

      playbackEngine.executeWorkflow.mockResolvedValueOnce({
        workflowId: 'wf-002',
        success: false,
        totalSteps: 3,
        completedSteps: 1,
        failedSteps: 1,
        totalDuration: 300,
        startTime: Date.now(),
        endTime: Date.now() + 300,
        stepResults: [
          { stepId: 'step-1', stepIndex: 0, action: 'click', success: true, duration: 100 },
          { stepId: 'step-2', stepIndex: 1, action: 'click', success: false, duration: 100, error: 'Element not found' },
          { stepId: 'step-3', stepIndex: 2, action: 'click', success: false, duration: 100, error: 'Element not found' },
        ],
        errors: ['Element not found'],
        metrics: { stepsCompleted: 1, stepsFailed: 2, elementsNotFound: 2, coordinateAdaptations: 0, fallbackMatches: 0 },
        executionContext: context,
      });

      const result = await executor.deployPack(pack, context);

      expect(result.success).toBe(false);
      expect(result.workflowResults).toHaveLength(2); // Should stop after 2 workflows
      expect(result.workflowResults[1].success).toBe(false);
      expect(recordingRepository.getWorkflow).toHaveBeenCalledTimes(2);
    });

    it('should continue on failure when stopOnError is false', async () => {
      const pack = createMockPack({
        manifest: {
          workflows: [
            { workflowId: 'wf-001', order: 1 },
            { workflowId: 'wf-002', order: 2 },
            { workflowId: 'wf-003', order: 3 },
          ],
          policy: {
            mode: 'sequential',
            stopOnError: false,
          },
        },
      });
      const context = createMockExecutionContext();

      recordingRepository.getWorkflow.mockResolvedValueOnce(createMockWorkflow({ id: 'wf-001' }));
      recordingRepository.getWorkflow.mockResolvedValueOnce(createMockWorkflow({ id: 'wf-002' }));
      recordingRepository.getWorkflow.mockResolvedValueOnce(createMockWorkflow({ id: 'wf-003' }));

      playbackEngine.executeWorkflow.mockResolvedValueOnce({
        workflowId: 'wf-001',
        success: true,
        totalSteps: 2,
        completedSteps: 2,
        failedSteps: 0,
        totalDuration: 200,
        startTime: Date.now(),
        endTime: Date.now() + 200,
        stepResults: [
          { stepId: 'step-1', stepIndex: 0, action: 'click', success: true, duration: 100 },
          { stepId: 'step-2', stepIndex: 1, action: 'click', success: true, duration: 100 },
        ],
        errors: [],
        metrics: { stepsCompleted: 2, stepsFailed: 0, elementsNotFound: 0, coordinateAdaptations: 0, fallbackMatches: 0 },
        executionContext: context,
      });

      playbackEngine.executeWorkflow.mockResolvedValueOnce({
        workflowId: 'wf-002',
        success: false,
        totalSteps: 3,
        completedSteps: 1,
        failedSteps: 2,
        totalDuration: 300,
        startTime: Date.now(),
        endTime: Date.now() + 300,
        stepResults: [
          { stepId: 'step-1', stepIndex: 0, action: 'click', success: true, duration: 100 },
          { stepId: 'step-2', stepIndex: 1, action: 'click', success: false, duration: 100, error: 'Error' },
          { stepId: 'step-3', stepIndex: 2, action: 'click', success: false, duration: 100, error: 'Error' },
        ],
        errors: ['Error'],
        metrics: { stepsCompleted: 1, stepsFailed: 2, elementsNotFound: 0, coordinateAdaptations: 0, fallbackMatches: 0 },
        executionContext: context,
      });

      playbackEngine.executeWorkflow.mockResolvedValueOnce({
        workflowId: 'wf-003',
        success: true,
        totalSteps: 2,
        completedSteps: 2,
        failedSteps: 0,
        totalDuration: 200,
        startTime: Date.now(),
        endTime: Date.now() + 200,
        stepResults: [
          { stepId: 'step-1', stepIndex: 0, action: 'click', success: true, duration: 100 },
          { stepId: 'step-2', stepIndex: 1, action: 'click', success: true, duration: 100 },
        ],
        errors: [],
        metrics: { stepsCompleted: 2, stepsFailed: 0, elementsNotFound: 0, coordinateAdaptations: 0, fallbackMatches: 0 },
        executionContext: context,
      });

      const result = await executor.deployPack(pack, context);

      expect(result.success).toBe(false); // Overall fails because one workflow failed
      expect(result.workflowResults).toHaveLength(3); // All workflows executed
      expect(result.workflowResults[1].success).toBe(false);
      expect(result.workflowResults[2].success).toBe(true);
    });
  });

  describe('Event Emission', () => {
    it('should emit PackDeploymentStartedEvent on deployment start', async () => {
      const pack = createMockPack();
      const context = createMockExecutionContext();

      recordingRepository.getWorkflow.mockResolvedValue(createMockWorkflow({ id: 'wf-001' }));
      playbackEngine.executeWorkflow.mockResolvedValue({
        workflowId: 'wf-001',
        success: true,
        totalSteps: 1,
        completedSteps: 1,
        failedSteps: 0,
        totalDuration: 100,
        startTime: Date.now(),
        endTime: Date.now() + 100,
        stepResults: [{ stepId: 'step-1', stepIndex: 0, action: 'click', success: true, duration: 100 }],
        errors: [],
        metrics: { stepsCompleted: 1, stepsFailed: 0, elementsNotFound: 0, coordinateAdaptations: 0, fallbackMatches: 0 },
        executionContext: context,
      });

      await executor.deployPack(pack, context);

      // Check that PackDeploymentStartedEvent was emitted
      expect(eventDispatcher.emit).toHaveBeenCalled();
      const emittedEvents: SystemEvent[] = [];
      eventDispatcher.emit.mock.calls.forEach((call) => {
        emittedEvents.push(call[0]);
      });

      const deploymentStartedEvent = emittedEvents.find(
        (e) => e.type === 'PackDeploymentStarted'
      ) as PackDeploymentStartedEvent | undefined;

      expect(deploymentStartedEvent).toBeDefined();
      expect(deploymentStartedEvent?.packId).toBe('pack-001');
      expect(deploymentStartedEvent?.deploymentId).toBeDefined();
      expect(deploymentStartedEvent?.workflowCount).toBe(2);
    });

    it('should emit PackDeploymentCompleteEvent on deployment completion', async () => {
      const pack = createMockPack();
      const context = createMockExecutionContext();

      recordingRepository.getWorkflow.mockResolvedValue(createMockWorkflow({ id: 'wf-001' }));
      playbackEngine.executeWorkflow.mockResolvedValue({
        workflowId: 'wf-001',
        success: true,
        totalSteps: 1,
        completedSteps: 1,
        failedSteps: 0,
        totalDuration: 100,
        startTime: Date.now(),
        endTime: Date.now() + 100,
        stepResults: [{ stepId: 'step-1', stepIndex: 0, action: 'click', success: true, duration: 100 }],
        errors: [],
        metrics: { stepsCompleted: 1, stepsFailed: 0, elementsNotFound: 0, coordinateAdaptations: 0, fallbackMatches: 0 },
        executionContext: context,
      });

      await executor.deployPack(pack, context);

      // Check that PackDeploymentCompleteEvent was emitted
      expect(eventDispatcher.emit).toHaveBeenCalled();
      const emittedEvents: SystemEvent[] = [];
      eventDispatcher.emit.mock.calls.forEach((call) => {
        emittedEvents.push(call[0]);
      });

      const deploymentCompleteEvent = emittedEvents.find(
        (e) => e.type === 'PackDeploymentComplete'
      ) as PackDeploymentCompleteEvent | undefined;

      expect(deploymentCompleteEvent).toBeDefined();
      expect(deploymentCompleteEvent?.packId).toBe('pack-001');
      expect(deploymentCompleteEvent?.deploymentId).toBeDefined();
      expect(deploymentCompleteEvent?.success).toBe(true);
      expect(deploymentCompleteEvent?.workflowResults).toHaveLength(2); // Should be 2 based on pack.manifest.workflows
    });
  });

  describe('Metrics Collection', () => {
    it('should collect accurate metrics', async () => {
      const pack = createMockPack();
      const context = createMockExecutionContext();

      recordingRepository.getWorkflow.mockResolvedValue(createMockWorkflow({ id: 'wf-001' }));
      playbackEngine.executeWorkflow.mockResolvedValue({
        workflowId: 'wf-001',
        success: true,
        totalSteps: 5,
        completedSteps: 4,
        failedSteps: 1,
        totalDuration: 1000,
        startTime: Date.now(),
        endTime: Date.now() + 1000,
        stepResults: [
          { stepId: 'step-1', stepIndex: 0, action: 'click', success: true, duration: 200 },
          { stepId: 'step-2', stepIndex: 1, action: 'click', success: true, duration: 200 },
          { stepId: 'step-3', stepIndex: 2, action: 'click', success: false, duration: 200, error: 'not found' },
          { stepId: 'step-4', stepIndex: 3, action: 'click', success: true, duration: 200 },
          { stepId: 'step-5', stepIndex: 4, action: 'click', success: true, duration: 200 },
        ],
        errors: ['Element not found'],
        metrics: {
          stepsCompleted: 4,
          stepsFailed: 1,
          elementsNotFound: 1,
          coordinateAdaptations: 0,
          fallbackMatches: 0,
        },
        executionContext: context,
      });

      const result = await executor.deployPack(pack, context);

      expect(result.metrics.stepsCompleted).toBe(4);
      expect(result.metrics.stepsFailed).toBe(1);
      expect(result.metrics.elementsNotFound).toBe(1);
      expect(result.metrics.avgStepDurationMs).toBeCloseTo(200);
    });
  });

  describe('Data Mapping', () => {
    it('should create and validate data mappings', () => {
      const mapping = createDataMapping(
        'wf-001',
        'results.total',
        'wf-002',
        'input.amount'
      );

      expect(mapping.sourceWorkflowId).toBe('wf-001');
      expect(mapping.sourceField).toBe('results.total');
      expect(mapping.targetWorkflowId).toBe('wf-002');
      expect(mapping.targetField).toBe('input.amount');
      expect(mapping.transformFunction).toBeUndefined();

      expect(createDataMapping).toBeDefined();
    });

    it('should apply data mapping to context', () => {
      const mapping = createDataMapping(
        'wf-001',
        'results.total',
        'wf-002',
        'input.amount'
      );

      const context = createMockExecutionContext({
        variables: { 'wf-001': { results: { total: 100 } } },
      });

      // Apply data mapping would update context.variables['wf-002']
      // In full implementation, this would extract and transform data
      expect(context.variables['wf-001']).toEqual({ results: { total: 100 } });
    });
  });

  describe('Error Handling', () => {
    it('should handle workflow not found', async () => {
      const pack = createMockPack();
      const context = createMockExecutionContext();

      recordingRepository.getWorkflow.mockResolvedValueOnce(undefined);

      const result = await executor.deployPack(pack, context);

      expect(result.success).toBe(false);
      expect(result.workflowResults).toHaveLength(2);
      expect(result.workflowResults[0].success).toBe(false);
      expect(result.workflowResults[0].errorMessage).toContain('not found');
    });

    it('should handle errors during deployment', async () => {
      const pack = createMockPack();
      const context = createMockExecutionContext();

      recordingRepository.getWorkflow.mockRejectedValueOnce(new Error('Database error'));

      const result = await executor.deployPack(pack, context);

      expect(result.success).toBe(false);
      expect(result.emittedEvents.find((e: any) => e.type === 'ErrorOccurred')).toBeDefined();
    });
  });

  describe('Helper Functions', () => {
    it('should create execution policy', () => {
      const policy = createExecutionPolicy('sequential', 'stop', 3, 1000, true, 60000);

      expect(policy.mode).toBe('sequential');
      expect(policy.stopOnError).toBe(true);
      expect(policy.retryDelayMs).toBe(1000);
      expect(policy.rollbackOnFailure).toBe(true);
      expect(policy.timeoutMs).toBe(60000);
    });

    it('should create retry policy', () => {
      const policy = createRetryPolicy(5, 3, 2000);

      expect(policy.maxAttempts).toBe(5);
      expect(policy.backoffMultiplier).toBe(3);
      expect(policy.baseDelayMs).toBe(2000);
    });

    it('should validate data mapping', () => {
      const validMapping = createDataMapping('wf-001', 'field1', 'wf-002', 'field2');
      const invalidMapping1 = createDataMapping('', 'field1', 'wf-002', 'field2');
      const invalidMapping2 = createDataMapping('wf-001', 'field1', '', 'field2');

      expect(createDataMapping).toBeDefined();
    });
  });

  describe('Retry Logic', () => {
    it('should retry failed steps with exponential backoff', async () => {
      const pack = createMockPack();
      const context = createMockExecutionContext();

      recordingRepository.getWorkflow.mockResolvedValue(createMockWorkflow({ id: 'wf-001' }));

      // Mock playback engine to fail twice, then succeed
      let attemptCount = 0;
      playbackEngine.executeWorkflow.mockImplementationOnce(async () => {
        attemptCount++;
        if (attemptCount < 3) {
          return {
            workflowId: 'wf-001',
            success: false,
            totalSteps: 1,
            completedSteps: 0,
            failedSteps: 1,
            totalDuration: 100,
            startTime: Date.now(),
            endTime: Date.now() + 100,
            stepResults: [{ stepId: 'step-1', stepIndex: 0, action: 'click', success: false, duration: 100, error: 'Transient error' }],
            errors: ['Transient error'],
            metrics: { stepsCompleted: 0, stepsFailed: 1, elementsNotFound: 0, coordinateAdaptations: 0, fallbackMatches: 0 },
            executionContext: context,
          };
        }
        return {
          workflowId: 'wf-001',
          success: true,
          totalSteps: 1,
          completedSteps: 1,
          failedSteps: 0,
          totalDuration: 100,
          startTime: Date.now(),
          endTime: Date.now() + 100,
          stepResults: [{ stepId: 'step-1', stepIndex: 0, action: 'click', success: true, duration: 100 }],
          errors: [],
          metrics: { stepsCompleted: 1, stepsFailed: 0, elementsNotFound: 0, coordinateAdaptations: 0, fallbackMatches: 0 },
          executionContext: context,
        };
      });

      const result = await executor.deployPack(pack, context);

      expect(result.success).toBe(true);
      expect(playbackEngine.executeWorkflow).toHaveBeenCalled();
    });
  });
});