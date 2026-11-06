/**
 * Tests for execution metrics collection system
 * Validates metrics tracking, aggregation, and statistics calculation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  StepMetricsBuilder,
  WorkflowMetricsBuilder,
  PackMetricsBuilder,
  MetricsCollector,
  generateExecutionId,
  generateStepId,
  type ExecutionId,
  type StepId,
  type PackId,
} from './execution-metrics.js';

describe('execution-metrics', () => {
  describe('StepMetricsBuilder', () => {
    it('builds valid step metrics', () => {
      const now = Date.now();
      const step = new StepMetricsBuilder()
        .setId(generateStepId())
        .setIndex(0)
        .setName('Click button')
        .setAction('click')
        .setStatus('completed')
        .setStartedAt(now)
        .setCompletedAt(now + 100)
        .setTarget('Submit Button', { x: 0.5, y: 0.5 })
        .setConfidence(0.95)
        .build();

      expect(step.name).toBe('Click button');
      expect(step.action).toBe('click');
      expect(step.status).toBe('completed');
      expect(step.durationMs).toBe(100);
      expect(step.confidence).toBe(0.95);
    });

    it('calculates duration from start and end times', () => {
      const now = Date.now();
      const step = new StepMetricsBuilder()
        .setId(generateStepId())
        .setIndex(0)
        .setName('Step 1')
        .setAction('click')
        .setStartedAt(now)
        .setCompletedAt(now + 500)
        .build();

      expect(step.durationMs).toBe(500);
    });

    it('tracks adaptation details', () => {
      const step = new StepMetricsBuilder()
        .setId(generateStepId())
        .setIndex(0)
        .setName('Adapted Click')
        .setAction('click')
        .setStartedAt(Date.now())
        .setAdapted(true, 'display-resolution-changed', 1.5, 0.02)
        .build();

      expect(step.adapted).toBe(true);
      expect(step.adaptationReason).toBe('display-resolution-changed');
      expect(step.adaptationScaleFactor).toBe(1.5);
      expect(step.coordinateAdaptationDist).toBe(0.02);
    });

    it('tracks errors and details', () => {
      const step = new StepMetricsBuilder()
        .setId(generateStepId())
        .setIndex(0)
        .setName('Failed Step')
        .setAction('click')
        .setStartedAt(Date.now())
        .setStatus('failed')
        .setError('element-not-found', 'Submit button not found at expected coordinates')
        .build();

      expect(step.error).toBe('element-not-found');
      expect(step.errorDetail).toContain('Submit button');
    });

    it('clamps confidence to [0, 1]', () => {
      const step1 = new StepMetricsBuilder()
        .setId(generateStepId())
        .setIndex(0)
        .setName('Step')
        .setAction('click')
        .setStartedAt(Date.now())
        .setConfidence(1.5)
        .build();

      const step2 = new StepMetricsBuilder()
        .setId(generateStepId())
        .setIndex(1)
        .setName('Step')
        .setAction('click')
        .setStartedAt(Date.now())
        .setConfidence(-0.5)
        .build();

      expect(step1.confidence).toBe(1);
      expect(step2.confidence).toBe(0);
    });

    it('requires essential fields', () => {
      expect(() => {
        new StepMetricsBuilder().build();
      }).toThrow('missing required fields');
    });
  });

  describe('WorkflowMetricsBuilder', () => {
    it('builds valid workflow metrics', () => {
      const now = Date.now();
      const workflow = new WorkflowMetricsBuilder()
        .setId(generateExecutionId())
        .setWorkflowId('wf-1')
        .setWorkflowName('Login Workflow')
        .setStatus('completed')
        .setStartedAt(now)
        .setCompletedAt(now + 5000)
        .build();

      expect(workflow.workflowName).toBe('Login Workflow');
      expect(workflow.status).toBe('completed');
      expect(workflow.durationMs).toBe(5000);
    });

    it('aggregates step metrics', () => {
      const workflow = new WorkflowMetricsBuilder()
        .setId(generateExecutionId())
        .setWorkflowId('wf-1')
        .setWorkflowName('Test Workflow')
        .setStatus('completed')
        .setStartedAt(Date.now());

      const step1 = new StepMetricsBuilder()
        .setId(generateStepId())
        .setIndex(0)
        .setName('Step 1')
        .setAction('click')
        .setStartedAt(Date.now())
        .setCompletedAt(Date.now() + 100)
        .setStatus('completed')
        .setConfidence(0.9)
        .build();

      const step2 = new StepMetricsBuilder()
        .setId(generateStepId())
        .setIndex(1)
        .setName('Step 2')
        .setAction('type')
        .setStartedAt(Date.now() + 100)
        .setCompletedAt(Date.now() + 200)
        .setStatus('completed')
        .setConfidence(0.85)
        .build();

      workflow.addStep(step1).addStep(step2);

      const built = workflow.setCompletedAt(Date.now() + 200).build();

      expect(built.totalSteps).toBe(2);
      expect(built.completedSteps).toBe(2);
      expect(built.failedSteps).toBe(0);
      expect(built.successRate).toBe(1.0);
      expect(built.averageConfidence).toBeCloseTo(0.875, 2);
    });

    it('calculates success rate correctly', () => {
      const workflow = new WorkflowMetricsBuilder()
        .setId(generateExecutionId())
        .setWorkflowId('wf-1')
        .setWorkflowName('Partial Success')
        .setStatus('partial')
        .setStartedAt(Date.now());

      // 2 completed, 1 failed, 1 skipped = 3/4 success
      for (let i = 0; i < 2; i++) {
        workflow.addStep(
          new StepMetricsBuilder()
            .setId(generateStepId())
            .setIndex(i)
            .setName(`Step ${i}`)
            .setAction('click')
            .setStartedAt(Date.now())
            .setStatus('completed')
            .build()
        );
      }

      workflow.addStep(
        new StepMetricsBuilder()
          .setId(generateStepId())
          .setIndex(2)
          .setName('Step 3')
          .setAction('click')
          .setStartedAt(Date.now())
          .setStatus('failed')
          .build()
      );

      workflow.addStep(
        new StepMetricsBuilder()
          .setId(generateStepId())
          .setIndex(3)
          .setName('Step 4')
          .setAction('click')
          .setStartedAt(Date.now())
          .setStatus('skipped')
          .build()
      );

      const built = workflow.build();

      expect(built.totalSteps).toBe(4);
      expect(built.completedSteps).toBe(2);
      expect(built.failedSteps).toBe(1);
      expect(built.skippedSteps).toBe(1);
      expect(built.successRate).toBeCloseTo(0.75, 2);
    });

    it('tracks display adaptation', () => {
      const workflow = new WorkflowMetricsBuilder()
        .setId(generateExecutionId())
        .setWorkflowId('wf-1')
        .setWorkflowName('Adapted Workflow')
        .setStatus('completed')
        .setStartedAt(Date.now())
        .setDisplays({ width: 1920, height: 1080 }, { width: 2560, height: 1440 });

      const built = workflow.build();

      expect(built.displayAdaptationRequired).toBe(true);
      expect(built.sourceDisplay?.width).toBe(1920);
      expect(built.targetDisplay?.width).toBe(2560);
    });
  });

  describe('PackMetricsBuilder', () => {
    it('builds valid pack metrics', () => {
      const now = Date.now();
      const pack = new PackMetricsBuilder()
        .setId(generateExecutionId())
        .setPackId('pack-1' as PackId)
        .setPackName('Login Pack')
        .setPackVersion('1.0.0')
        .setStatus('completed')
        .setStartedAt(now)
        .setCompletedAt(now + 10000)
        .setExecutionPolicy('sequential')
        .build();

      expect(pack.packName).toBe('Login Pack');
      expect(pack.packVersion).toBe('1.0.0');
      expect(pack.executionPolicy).toBe('sequential');
      expect(pack.durationMs).toBe(10000);
    });

    it('aggregates workflow metrics', () => {
      const pack = new PackMetricsBuilder()
        .setId(generateExecutionId())
        .setPackId('pack-1' as PackId)
        .setPackName('Test Pack')
        .setPackVersion('1.0.0')
        .setStatus('completed')
        .setStartedAt(Date.now());

      // Create 2 workflows
      const workflow1 = new WorkflowMetricsBuilder()
        .setId(generateExecutionId())
        .setWorkflowId('wf-1')
        .setWorkflowName('Workflow 1')
        .setStatus('completed')
        .setStartedAt(Date.now());

      const step1 = new StepMetricsBuilder()
        .setId(generateStepId())
        .setIndex(0)
        .setName('Step 1')
        .setAction('click')
        .setStartedAt(Date.now())
        .setCompletedAt(Date.now() + 100)
        .setStatus('completed')
        .build();

      workflow1.addStep(step1);
      pack.addWorkflow(workflow1.setCompletedAt(Date.now() + 100).build());

      const workflow2 = new WorkflowMetricsBuilder()
        .setId(generateExecutionId())
        .setWorkflowId('wf-2')
        .setWorkflowName('Workflow 2')
        .setStatus('completed')
        .setStartedAt(Date.now() + 100);

      const step2 = new StepMetricsBuilder()
        .setId(generateStepId())
        .setIndex(0)
        .setName('Step 1')
        .setAction('type')
        .setStartedAt(Date.now() + 100)
        .setCompletedAt(Date.now() + 200)
        .setStatus('completed')
        .build();

      workflow2.addStep(step2);
      pack.addWorkflow(workflow2.setCompletedAt(Date.now() + 200).build());

      const built = pack.setCompletedAt(Date.now() + 200).build();

      expect(built.totalWorkflows).toBe(2);
      expect(built.completedWorkflows).toBe(2);
      expect(built.totalSteps).toBe(2);
      expect(built.completedSteps).toBe(2);
    });

    it('tracks adaptation statistics', () => {
      const pack = new PackMetricsBuilder()
        .setId(generateExecutionId())
        .setPackId('pack-1' as PackId)
        .setPackName('Adapted Pack')
        .setPackVersion('1.0.0')
        .setStatus('completed')
        .setStartedAt(Date.now());

      const workflow = new WorkflowMetricsBuilder()
        .setId(generateExecutionId())
        .setWorkflowId('wf-1')
        .setWorkflowName('Workflow 1')
        .setStatus('completed')
        .setStartedAt(Date.now());

      const adaptedStep = new StepMetricsBuilder()
        .setId(generateStepId())
        .setIndex(0)
        .setName('Adapted Step')
        .setAction('click')
        .setStartedAt(Date.now())
        .setAdapted(true, 'display-resolution', 1.33, 0.01)
        .build();

      workflow.addStep(adaptedStep);
      pack.addWorkflow(workflow.build());

      const built = pack.build();

      expect(built.adaptationCount).toBe(1);
      expect(built.adaptedSteps).toBe(1);
      expect(built.averageAdaptationScaleFactor).toBeCloseTo(1.33, 2);
    });

    it('supports data mapping between workflows', () => {
      const pack = new PackMetricsBuilder()
        .setId(generateExecutionId())
        .setPackId('pack-1' as PackId)
        .setPackName('Test Pack')
        .setPackVersion('1.0.0')
        .setStatus('completed')
        .setStartedAt(Date.now())
        .setDataMapping({ username: 'user@example.com', password: 'secret' });

      const built = pack.build();

      expect(built.dataMapping?.username).toBe('user@example.com');
    });
  });

  describe('MetricsCollector', () => {
    let collector: MetricsCollector;

    beforeEach(() => {
      collector = new MetricsCollector();
    });

    it('records pack executions', () => {
      const now = Date.now();
      const pack = new PackMetricsBuilder()
        .setId(generateExecutionId())
        .setPackId('pack-1' as PackId)
        .setPackName('Test Pack')
        .setPackVersion('1.0.0')
        .setStatus('completed')
        .setStartedAt(now)
        .setCompletedAt(now + 1000)
        .build();

      collector.recordPackExecution(pack);

      const retrieved = collector.getExecution(pack.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.packName).toBe('Test Pack');
    });

    it('retrieves execution by ID', () => {
      const now = Date.now();
      const id = generateExecutionId();
      const pack = new PackMetricsBuilder()
        .setId(id)
        .setPackId('pack-1' as PackId)
        .setPackName('Test Pack')
        .setPackVersion('1.0.0')
        .setStatus('completed')
        .setStartedAt(now)
        .setCompletedAt(now + 1000)
        .build();

      collector.recordPackExecution(pack);

      const retrieved = collector.getExecution(id);
      expect(retrieved?.id).toBe(id);
    });

    it('returns null for non-existent execution', () => {
      const retrieved = collector.getExecution(generateExecutionId());
      expect(retrieved).toBeNull();
    });

    it('gets pack executions', () => {
      const packId = 'pack-1' as PackId;
      const now = Date.now();

      for (let i = 0; i < 3; i++) {
        const pack = new PackMetricsBuilder()
          .setId(generateExecutionId())
          .setPackId(packId)
          .setPackName('Test Pack')
          .setPackVersion('1.0.0')
          .setStatus(i < 2 ? 'completed' : 'failed')
          .setStartedAt(now + i * 1000)
          .setCompletedAt(now + (i + 1) * 1000)
          .build();

        collector.recordPackExecution(pack);
      }

      const executions = collector.getPackExecutions(packId);
      expect(executions).toHaveLength(3);
      expect(executions[2].status).toBe('failed');
    });

    it('gets workflow executions', () => {
      const workflowId = 'wf-1';
      const packId = 'pack-1' as PackId;
      const now = Date.now();

      const workflow1 = new WorkflowMetricsBuilder()
        .setId(generateExecutionId())
        .setWorkflowId(workflowId)
        .setWorkflowName('Workflow 1')
        .setStatus('completed')
        .setStartedAt(now)
        .setCompletedAt(now + 1000)
        .build();

      const workflow2 = new WorkflowMetricsBuilder()
        .setId(generateExecutionId())
        .setWorkflowId(workflowId)
        .setWorkflowName('Workflow 1')
        .setStatus('completed')
        .setStartedAt(now + 1000)
        .setCompletedAt(now + 2000)
        .build();

      const pack1 = new PackMetricsBuilder()
        .setId(generateExecutionId())
        .setPackId(packId)
        .setPackName('Pack 1')
        .setPackVersion('1.0.0')
        .setStatus('completed')
        .setStartedAt(now)
        .addWorkflow(workflow1)
        .setCompletedAt(now + 1000)
        .build();

      const pack2 = new PackMetricsBuilder()
        .setId(generateExecutionId())
        .setPackId(packId)
        .setPackName('Pack 1')
        .setPackVersion('1.0.0')
        .setStatus('completed')
        .setStartedAt(now + 1000)
        .addWorkflow(workflow2)
        .setCompletedAt(now + 2000)
        .build();

      collector.recordPackExecution(pack1);
      collector.recordPackExecution(pack2);

      const executions = collector.getWorkflowExecutions(workflowId);
      expect(executions).toHaveLength(2);
    });

    it('calculates pack statistics', () => {
      const packId = 'pack-1' as PackId;
      const now = Date.now();

      // Record 3 successful executions
      for (let i = 0; i < 3; i++) {
        const workflow = new WorkflowMetricsBuilder()
          .setId(generateExecutionId())
          .setWorkflowId('wf-1')
          .setWorkflowName('Workflow')
          .setStatus('completed')
          .setStartedAt(now)
          .setCompletedAt(now + 1000);

        const step = new StepMetricsBuilder()
          .setId(generateStepId())
          .setIndex(0)
          .setName('Step')
          .setAction('click')
          .setStartedAt(now)
          .setCompletedAt(now + 500)
          .setStatus('completed')
          .build();

        workflow.addStep(step);
        const builtWorkflow = workflow.build();

        const pack = new PackMetricsBuilder()
          .setId(generateExecutionId())
          .setPackId(packId)
          .setPackName('Test Pack')
          .setPackVersion('1.0.0')
          .setStatus('completed')
          .setStartedAt(now)
          .addWorkflow(builtWorkflow)
          .setCompletedAt(now + 1000)
          .build();

        collector.recordPackExecution(pack);
      }

      const stats = collector.getPackStatistics(packId);
      expect(stats).not.toBeNull();
      expect(stats!.totalExecutions).toBe(3);
      expect(stats!.successfulExecutions).toBe(3);
      expect(stats!.failedExecutions).toBe(0);
      expect(stats!.totalSteps).toBe(3);
    });

    it('tracks failure reasons in statistics', () => {
      const packId = 'pack-1' as PackId;
      const now = Date.now();

      const failedPack = new PackMetricsBuilder()
        .setId(generateExecutionId())
        .setPackId(packId)
        .setPackName('Failed Pack')
        .setPackVersion('1.0.0')
        .setStatus('failed')
        .setStartedAt(now)
        .setCompletedAt(now + 1000)
        .setError('element-not-found', 'Element not found')
        .build();

      collector.recordPackExecution(failedPack);

      const stats = collector.getPackStatistics(packId);
      expect(stats).not.toBeNull();
      expect(stats!.failureReasons['element-not-found']).toBe(1);
    });

    it('clears all metrics', () => {
      const pack = new PackMetricsBuilder()
        .setId(generateExecutionId())
        .setPackId('pack-1' as PackId)
        .setPackName('Test Pack')
        .setPackVersion('1.0.0')
        .setStatus('completed')
        .setStartedAt(Date.now())
        .setCompletedAt(Date.now() + 1000)
        .build();

      collector.recordPackExecution(pack);
      expect(collector.getExecution(pack.id)).not.toBeNull();

      collector.clear();
      expect(collector.getExecution(pack.id)).toBeNull();
    });
  });

  describe('ID generation', () => {
    it('generates unique execution IDs', () => {
      const id1 = generateExecutionId();
      const id2 = generateExecutionId();
      expect(id1).not.toBe(id2);
    });

    it('generates unique step IDs', () => {
      const id1 = generateStepId();
      const id2 = generateStepId();
      expect(id1).not.toBe(id2);
    });

    it('execution IDs contain timestamp', () => {
      const id = generateExecutionId();
      expect(id).toMatch(/exec-\d+/);
    });
  });

  describe('edge cases', () => {
    it('handles workflow with no steps', () => {
      const workflow = new WorkflowMetricsBuilder()
        .setId(generateExecutionId())
        .setWorkflowId('wf-1')
        .setWorkflowName('Empty Workflow')
        .setStatus('completed')
        .setStartedAt(Date.now())
        .setCompletedAt(Date.now() + 1000)
        .build();

      expect(workflow.totalSteps).toBe(0);
      expect(workflow.successRate).toBe(0);
    });

    it('handles pack with no workflows', () => {
      const pack = new PackMetricsBuilder()
        .setId(generateExecutionId())
        .setPackId('pack-1' as PackId)
        .setPackName('Empty Pack')
        .setPackVersion('1.0.0')
        .setStatus('completed')
        .setStartedAt(Date.now())
        .setCompletedAt(Date.now() + 1000)
        .build();

      expect(pack.totalWorkflows).toBe(0);
      expect(pack.successRate).toBe(0);
    });

    it('handles adaptation scale factor of zero', () => {
      const step = new StepMetricsBuilder()
        .setId(generateStepId())
        .setIndex(0)
        .setName('Step')
        .setAction('click')
        .setStartedAt(Date.now())
        .setAdapted(true, 'test', 0, 0)
        .build();

      expect(step.adaptationScaleFactor).toBe(0);
    });
  });
});
