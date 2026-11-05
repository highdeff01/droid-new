/**
 * Integration Types Test Suite
 *
 * Comprehensive tests for all integration types including:
 * - Event creation and discriminated union type safety
 * - ExecutionContext creation and propagation
 * - Event ordering by timestamp
 * - Causality tracking with parent event IDs
 * - Lineage tracking
 * - FeedbackRecord validation
 * - JSON serialization/deserialization
 * - Helper function correctness
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  // Types
  type SystemEvent,
  type ExecutionContext,
  type FeedbackRecord,
  type LineageRecord,
  type EntityId,
  type Timestamp,
  type DisplayState,
  type ExecutionResult,
  // Interfaces
  RecordingCapturedEvent,
  WorkflowCreatedEvent,
  PackDeploymentCompleteEvent,
  HabitSuggestedEvent,
  ErrorOccurredEvent,
  // Helper functions
  createEntityId,
  createTimestamp,
  createExecutionContext,
  createFeedbackRecord,
  createLineageRecord,
  createWorkflowCreatedEvent,
  createPackDeploymentCompleteEvent,
  createHabitSuggestedEvent,
  createErrorOccurredEvent,
  createExecutionResult,
  isEventType,
} from './integration-types';

describe('integration-types', () => {
  describe('EntityId and Timestamp', () => {
    it('should create valid entity IDs', () => {
      const id = createEntityId('550e8400-e29b-41d4-a716-446655440000');
      expect(id).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('should create valid timestamps in ISO 8601 format', () => {
      const ts = createTimestamp(new Date('2024-01-15T10:30:45.123Z'));
      expect(ts).toBe('2024-01-15T10:30:45.123Z');
      // Validate ISO 8601 format
      expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should create current timestamp when no date provided', () => {
      const before = new Date();
      const ts = createTimestamp();
      const after = new Date();

      const tsDate = new Date(ts);
      expect(tsDate.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(tsDate.getTime()).toBeLessThanOrEqual(after.getTime());
    });
  });

  describe('DisplayState', () => {
    it('should create valid display state', () => {
      const displayState: DisplayState = {
        width: 1920,
        height: 1080,
        dpi: 1.0,
        isMultiDisplay: false,
        displayIndex: 0,
      };

      expect(displayState.width).toBe(1920);
      expect(displayState.height).toBe(1080);
      expect(displayState.dpi).toBe(1.0);
    });

    it('should handle multi-display states', () => {
      const displayState: DisplayState = {
        width: 2560,
        height: 1440,
        isMultiDisplay: true,
        displayIndex: 1,
      };

      expect(displayState.isMultiDisplay).toBe(true);
      expect(displayState.displayIndex).toBe(1);
    });
  });

  describe('ExecutionContext creation', () => {
    it('should create valid execution context', () => {
      const executionId = createEntityId('exec-001');
      const displayState: DisplayState = { width: 1920, height: 1080 };

      const context = createExecutionContext(executionId, displayState);

      expect(context.executionId).toBe(executionId);
      expect(context.displayState).toEqual(displayState);
      expect(context.variables).toEqual({});
      expect(context.executionPath).toEqual([]);
      expect(context.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should include variables in context', () => {
      const executionId = createEntityId('exec-001');
      const displayState: DisplayState = { width: 1920, height: 1080 };
      const variables = { stepCount: 5, userInput: 'test' };

      const context = createExecutionContext(executionId, displayState, variables);

      expect(context.variables).toEqual(variables);
    });

    it('should allow setting additional properties', () => {
      const executionId = createEntityId('exec-001');
      const displayState: DisplayState = { width: 1920, height: 1080 };

      const context: ExecutionContext = {
        executionId,
        displayState,
        variables: {},
        executionPath: ['step-1', 'step-2'],
        createdAt: createTimestamp(),
        recordingId: createEntityId('rec-001'),
        workflowId: createEntityId('wf-001'),
        applicationName: 'Chrome',
      };

      expect(context.recordingId).toBe('rec-001');
      expect(context.workflowId).toBe('wf-001');
      expect(context.executionPath).toHaveLength(2);
    });
  });

  describe('FeedbackRecord creation', () => {
    it('should create feedback record for approval', () => {
      const feedbackId = createEntityId('fb-001');
      const executionId = createEntityId('exec-001');

      const feedback = createFeedbackRecord(
        feedbackId,
        'approve',
        executionId,
        'Works as expected'
      );

      expect(feedback.id).toBe(feedbackId);
      expect(feedback.type).toBe('approve');
      expect(feedback.executionId).toBe(executionId);
      expect(feedback.reason).toBe('Works as expected');
      expect(feedback.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should create feedback record for rejection with reason', () => {
      const feedbackId = createEntityId('fb-002');
      const executionId = createEntityId('exec-002');

      const feedback = createFeedbackRecord(
        feedbackId,
        'reject',
        executionId,
        'Clicked wrong button'
      );

      expect(feedback.type).toBe('reject');
      expect(feedback.reason).toBe('Clicked wrong button');
    });

    it('should create feedback record with corrections', () => {
      const feedbackId = createEntityId('fb-003');
      const executionId = createEntityId('exec-003');
      const corrections = { 1: 'clicked OK instead', 3: 'typed password' };

      const feedback = createFeedbackRecord(
        feedbackId,
        'modify',
        executionId,
        'Corrected steps',
        corrections
      );

      expect(feedback.type).toBe('modify');
      expect(feedback.corrections).toEqual(corrections);
    });

    it('should create feedback record with confidence adjustment', () => {
      const feedbackId = createEntityId('fb-004');
      const executionId = createEntityId('exec-004');

      const feedback = createFeedbackRecord(
        feedbackId,
        'approve',
        executionId,
        'Good suggestion',
        undefined,
        5
      );

      expect(feedback.confidenceAdjustment).toBe(5);
    });
  });

  describe('LineageRecord creation', () => {
    it('should create lineage from user recording', () => {
      const recordingId = createEntityId('rec-001');
      const workflowId = createEntityId('wf-001');

      const lineage = createLineageRecord(
        'user-recording',
        recordingId,
        workflowId,
        undefined,
        undefined,
        'alice@example.com'
      );

      expect(lineage.originSource).toBe('user-recording');
      expect(lineage.recordingId).toBe(recordingId);
      expect(lineage.workflowId).toBe(workflowId);
      expect(lineage.author).toBe('alice@example.com');
      expect(lineage.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should create lineage from habit suggestion', () => {
      const habitId = createEntityId('habit-001');
      const workflowId = createEntityId('wf-001');
      const packId = createEntityId('pack-001');

      const lineage = createLineageRecord(
        'habit-suggestion',
        undefined,
        workflowId,
        packId,
        habitId
      );

      expect(lineage.originSource).toBe('habit-suggestion');
      expect(lineage.habitId).toBe(habitId);
      expect(lineage.packId).toBe(packId);
    });

    it('should track transformation path', () => {
      const path = ['normalize-coordinates', 'adapt-for-display', 'execute'];

      const lineage = createLineageRecord(
        'workflow-composition',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        path
      );

      expect(lineage.transformationPath).toEqual(path);
    });
  });

  describe('SystemEvent discriminated union', () => {
    it('should create WorkflowCreatedEvent', () => {
      const workflowId = createEntityId('wf-001');
      const event = createWorkflowCreatedEvent(workflowId, 5, 1000);

      expect(event.type).toBe('WorkflowCreated');
      expect(event.source).toBe('workflow');
      expect(event.workflowId).toBe(workflowId);
      expect(event.stepCount).toBe(5);
      expect(event.durationMs).toBe(1000);
    });

    it('should create WorkflowCreatedEvent with recording ID', () => {
      const workflowId = createEntityId('wf-001');
      const recordingId = createEntityId('rec-001');
      const event = createWorkflowCreatedEvent(
        workflowId,
        5,
        1000,
        recordingId,
        false
      );

      expect(event.recordingId).toBe(recordingId);
      expect(event.hasConditions).toBe(false);
    });

    it('should create PackDeploymentCompleteEvent', () => {
      const packId = createEntityId('pack-001');
      const deploymentId = createEntityId('deploy-001');
      const workflowResults = [
        {
          workflowId: createEntityId('wf-001'),
          success: true,
          durationMs: 500,
        },
        {
          workflowId: createEntityId('wf-002'),
          success: true,
          durationMs: 600,
        },
      ];

      const event = createPackDeploymentCompleteEvent(
        packId,
        deploymentId,
        true,
        workflowResults,
        1100
      );

      expect(event.type).toBe('PackDeploymentComplete');
      expect(event.success).toBe(true);
      expect(event.workflowResults).toHaveLength(2);
      expect(event.totalDurationMs).toBe(1100);
    });

    it('should create HabitSuggestedEvent', () => {
      const habitId = createEntityId('habit-001');
      const event = createHabitSuggestedEvent(
        habitId,
        85,
        ['button-visible', 'time-of-day-match'],
        'execute',
        'High confidence based on recent patterns'
      );

      expect(event.type).toBe('HabitSuggested');
      expect(event.habitId).toBe(habitId);
      expect(event.confidenceScore).toBe(85);
      expect(event.matchedConditions).toHaveLength(2);
      expect(event.suggestedAction).toBe('execute');
    });

    it('should create ErrorOccurredEvent', () => {
      const sourceId = createEntityId('wf-001');
      const event = createErrorOccurredEvent(
        sourceId,
        'workflow',
        'Element not found at coordinates',
        'error',
        'playback-engine',
        true,
        'Try fallback matching'
      );

      expect(event.type).toBe('ErrorOccurred');
      expect(event.source).toBe('workflow');
      expect(event.severity).toBe('error');
      expect(event.recoverable).toBe(true);
    });
  });

  describe('Event type guards', () => {
    it('should correctly identify WorkflowCreatedEvent', () => {
      const event = createWorkflowCreatedEvent(createEntityId('wf-001'), 5, 1000);
      expect(isEventType(event, 'WorkflowCreated')).toBe(true);
      expect(isEventType(event, 'PackDeploymentComplete')).toBe(false);
    });

    it('should correctly identify HabitSuggestedEvent', () => {
      const event = createHabitSuggestedEvent(
        createEntityId('habit-001'),
        75,
        [],
        'prompt-user'
      );
      expect(isEventType(event, 'HabitSuggested')).toBe(true);
      expect(isEventType(event, 'WorkflowCreated')).toBe(false);
    });

    it('should narrow event type in conditional', () => {
      const event: SystemEvent = createErrorOccurredEvent(
        createEntityId('wf-001'),
        'workflow',
        'Test error',
        'error'
      );

      if (isEventType(event, 'ErrorOccurred')) {
        expect(event.severity).toBe('error');
        expect(event.message).toBe('Test error');
      }
    });
  });

  describe('Event ordering and causality', () => {
    it('should maintain event timestamps in chronological order', () => {
      const event1 = createWorkflowCreatedEvent(createEntityId('wf-001'), 5, 1000);
      const event2 = createHabitSuggestedEvent(
        createEntityId('habit-001'),
        75,
        [],
        'execute'
      );

      const ts1 = new Date(event1.timestamp).getTime();
      const ts2 = new Date(event2.timestamp).getTime();

      // Events should be created in order
      expect(ts1 <= ts2).toBe(true);
    });

    it('should support parent event ID for causality tracking', () => {
      const parentEventId = createEntityId('evt-001');
      const event: WorkflowCreatedEvent = {
        id: createEntityId('evt-002'),
        type: 'WorkflowCreated',
        source: 'workflow',
        timestamp: createTimestamp(),
        sourceId: createEntityId('wf-001'),
        parentEventId,
        workflowId: createEntityId('wf-001'),
        stepCount: 5,
        durationMs: 1000,
        hasConditions: false,
      };

      expect(event.parentEventId).toBe(parentEventId);
    });

    it('should track event chain: Recording -> Workflow -> Pack -> Habit', () => {
      const recordingId = createEntityId('rec-001');
      const workflowId = createEntityId('wf-001');
      const packId = createEntityId('pack-001');
      const habitId = createEntityId('habit-001');

      // Event 1: WorkflowCreatedEvent from recording
      const workflowEvent = createWorkflowCreatedEvent(
        workflowId,
        5,
        1000,
        recordingId
      );
      expect(workflowEvent.recordingId).toBe(recordingId);

      // Event 2: PackDeploymentCompleteEvent
      const deploymentEvent = createPackDeploymentCompleteEvent(
        packId,
        createEntityId('deploy-001'),
        true,
        [{ workflowId, success: true, durationMs: 1000 }],
        1000,
        [habitId]
      );
      expect(deploymentEvent.packId).toBe(packId);
      expect(deploymentEvent.habitsToExtract).toContain(habitId);
    });
  });

  describe('ExecutionResult', () => {
    it('should create valid execution result for success', () => {
      const executionId = createEntityId('exec-001');
      const displayState: DisplayState = { width: 1920, height: 1080 };
      const context = createExecutionContext(executionId, displayState);
      const lineage = createLineageRecord('user-recording');

      const result = createExecutionResult(
        executionId,
        true,
        1500,
        context,
        lineage,
        { result: 'success' }
      );

      expect(result.executionId).toBe(executionId);
      expect(result.success).toBe(true);
      expect(result.durationMs).toBe(1500);
      expect(result.output).toEqual({ result: 'success' });
      expect(result.errors).toBeUndefined();
    });

    it('should create valid execution result for failure with errors', () => {
      const executionId = createEntityId('exec-001');
      const displayState: DisplayState = { width: 1920, height: 1080 };
      const context = createExecutionContext(executionId, displayState);
      const lineage = createLineageRecord('user-recording');
      const errors = [
        {
          stepId: 'step-3',
          message: 'Element not found',
          recoverable: true,
        },
      ];

      const result = createExecutionResult(
        executionId,
        false,
        800,
        context,
        lineage,
        undefined,
        errors
      );

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0].message).toBe('Element not found');
      expect(result.errors![0].recoverable).toBe(true);
    });

    it('should include metrics in execution result', () => {
      const executionId = createEntityId('exec-001');
      const displayState: DisplayState = { width: 1920, height: 1080 };
      const context = createExecutionContext(executionId, displayState);
      const lineage = createLineageRecord('user-recording');
      const metrics = {
        stepsCompleted: 10,
        stepsFailed: 0,
        elementsNotFound: 0,
        coordinateAdaptations: 2,
        fallbackMatches: 0,
      };

      const result = createExecutionResult(
        executionId,
        true,
        2000,
        context,
        lineage,
        undefined,
        undefined,
        metrics
      );

      expect(result.metrics).toEqual(metrics);
    });
  });

  describe('JSON serialization', () => {
    it('should serialize ExecutionContext to JSON', () => {
      const context = createExecutionContext(
        createEntityId('exec-001'),
        { width: 1920, height: 1080 }
      );

      const json = JSON.stringify(context);
      const parsed = JSON.parse(json);

      expect(parsed.executionId).toBe('exec-001');
      expect(parsed.displayState.width).toBe(1920);
      expect(parsed.variables).toEqual({});
    });

    it('should serialize events to JSON', () => {
      const event = createWorkflowCreatedEvent(
        createEntityId('wf-001'),
        5,
        1000
      );

      const json = JSON.stringify(event);
      const parsed = JSON.parse(json);

      expect(parsed.type).toBe('WorkflowCreated');
      expect(parsed.workflowId).toBe('wf-001');
      expect(parsed.stepCount).toBe(5);
    });

    it('should serialize complex event with lineage', () => {
      const lineage = createLineageRecord(
        'workflow-composition',
        createEntityId('rec-001'),
        createEntityId('wf-001'),
        createEntityId('pack-001'),
        createEntityId('habit-001'),
        'alice@example.com',
        ['normalize', 'adapt', 'execute']
      );

      const json = JSON.stringify(lineage);
      const parsed = JSON.parse(json);

      expect(parsed.originSource).toBe('workflow-composition');
      expect(parsed.recordingId).toBe('rec-001');
      expect(parsed.transformationPath).toHaveLength(3);
    });
  });

  describe('Event immutability and isolation', () => {
    it('should not leak context state between contexts', () => {
      const context1 = createExecutionContext(
        createEntityId('exec-001'),
        { width: 1920, height: 1080 },
        { step: 1 }
      );

      const context2 = createExecutionContext(
        createEntityId('exec-002'),
        { width: 2560, height: 1440 },
        { step: 2 }
      );

      // Modify context1
      context1.variables.step = 10;

      // context2 should not be affected
      expect(context2.variables.step).toBe(2);
    });

    it('should maintain immutability through event creation', () => {
      const originalId = createEntityId('wf-001');
      const event1 = createWorkflowCreatedEvent(originalId, 5, 1000);
      const event2 = createWorkflowCreatedEvent(originalId, 10, 2000);

      // Events should be independent
      expect(event1.stepCount).toBe(5);
      expect(event2.stepCount).toBe(10);
      expect(event1.id).not.toBe(event2.id);
    });
  });

  describe('Edge cases and validation', () => {
    it('should handle empty display state', () => {
      const context = createExecutionContext(
        createEntityId('exec-001'),
        { width: 0, height: 0 }
      );

      expect(context.displayState.width).toBe(0);
      expect(context.displayState.height).toBe(0);
    });

    it('should handle missing optional fields in ExecutionResult', () => {
      const result = createExecutionResult(
        createEntityId('exec-001'),
        true,
        0,
        createExecutionContext(createEntityId('exec-001'), { width: 1920, height: 1080 }),
        createLineageRecord('user-recording')
      );

      expect(result.output).toBeUndefined();
      expect(result.errors).toBeUndefined();
      expect(result.metrics).toBeUndefined();
    });

    it('should handle zero duration execution', () => {
      const result = createExecutionResult(
        createEntityId('exec-001'),
        true,
        0,
        createExecutionContext(createEntityId('exec-001'), { width: 1920, height: 1080 }),
        createLineageRecord('user-recording')
      );

      expect(result.durationMs).toBe(0);
    });

    it('should handle high confidence scores', () => {
      const event = createHabitSuggestedEvent(
        createEntityId('habit-001'),
        100,
        ['all-conditions-match'],
        'execute'
      );

      expect(event.confidenceScore).toBe(100);
    });

    it('should handle low confidence scores', () => {
      const event = createHabitSuggestedEvent(
        createEntityId('habit-001'),
        0,
        [],
        'display-hint'
      );

      expect(event.confidenceScore).toBe(0);
    });
  });

  describe('Event property completeness', () => {
    it('should have all required properties in BaseEvent', () => {
      const event = createErrorOccurredEvent(
        createEntityId('wf-001'),
        'workflow',
        'Test error',
        'error'
      );

      expect(event.id).toBeDefined();
      expect(event.type).toBeDefined();
      expect(event.timestamp).toBeDefined();
      expect(event.source).toBeDefined();
      expect(event.sourceId).toBeDefined();
    });

    it('WorkflowCreatedEvent should have all required properties', () => {
      const event = createWorkflowCreatedEvent(
        createEntityId('wf-001'),
        5,
        1000
      );

      expect(event.type).toBe('WorkflowCreated');
      expect(event.workflowId).toBeDefined();
      expect(event.stepCount).toBeDefined();
      expect(event.durationMs).toBeDefined();
      expect(event.hasConditions).toBeDefined();
    });

    it('PackDeploymentCompleteEvent should have all required properties', () => {
      const event = createPackDeploymentCompleteEvent(
        createEntityId('pack-001'),
        createEntityId('deploy-001'),
        true,
        [],
        0
      );

      expect(event.type).toBe('PackDeploymentComplete');
      expect(event.packId).toBeDefined();
      expect(event.deploymentId).toBeDefined();
      expect(event.success).toBeDefined();
      expect(event.workflowResults).toBeDefined();
      expect(event.totalDurationMs).toBeDefined();
    });
  });

  describe('Timestamp consistency', () => {
    it('should produce consistent timestamp format across calls', () => {
      const ts1 = createTimestamp();
      const ts2 = createTimestamp();

      expect(ts1).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(ts2).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should parse timestamps correctly', () => {
      const ts = createTimestamp(new Date('2024-01-15T10:30:45.123Z'));
      const parsed = new Date(ts);

      expect(parsed.getFullYear()).toBe(2024);
      expect(parsed.getMonth()).toBe(0); // January
      expect(parsed.getDate()).toBe(15);
    });
  });
});
