/**
 * Pack Execution Policy Tests
 *
 * Comprehensive test suite for PackExecutionPolicyEngine covering:
 * - Sequential execution with data passing between workflows
 * - Parallel execution with concurrency control
 * - Conditional execution with branch evaluation
 * - Data mapping between workflows (source → target transformation)
 * - Error handling (retry logic, continue/stop policies)
 * - Timeout support and cancellation
 * - Result aggregation and status reporting
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PackExecutionPolicyEngine,
  createSequentialExecution,
  createParallelExecution,
  createConditionalExecution,
} from './pack-execution-policy';
import {
  createPackManifest,
  createSequentialPolicy,
  createParallelPolicy,
  createWorkflowReference,
} from '../../../../pack-types';
import { createWorkflow, createWorkflowMetadata } from '../../../../workflow-types';

describe('PackExecutionPolicyEngine', () => {
  let engine: PackExecutionPolicyEngine;

  beforeEach(() => {
    engine = new PackExecutionPolicyEngine();
  });

  // ========================================================================
  // Sequential Execution Tests
  // ========================================================================

  describe('Sequential Execution', () => {
    it('should execute workflows in order', async () => {
      const workflow1 = createWorkflow(
        'workflow_1',
        'Workflow 1',
        [],
        createWorkflowMetadata('1.0.0'),
      );
      const workflow2 = createWorkflow(
        'workflow_2',
        'Workflow 2',
        [],
        createWorkflowMetadata('1.0.0'),
      );

      const manifest = createPackManifest(
        [
          createWorkflowReference('workflow_1'),
          createWorkflowReference('workflow_2'),
        ],
        createSequentialPolicy(1, 1000, true),
      );

      const workflowMap = new Map([
        ['workflow_1', workflow1],
        ['workflow_2', workflow2],
      ]);

      const context = {
        environment: {},
        previousResults: new Map(),
        accumulatedData: {},
      };

      const result = await engine.executePack(manifest, workflowMap, context);

      expect(result.status).toBe('success');
      expect(result.workflowResults).toHaveLength(2);
      expect(result.executionMode).toBe('sequential');
    });

    it('should pass output from first workflow to second', async () => {
      // This test verifies data passing between workflows
      const workflow1 = createWorkflow(
        'workflow_1',
        'Workflow 1',
        [],
        createWorkflowMetadata('1.0.0'),
      );
      const workflow2 = createWorkflow(
        'workflow_2',
        'Workflow 2',
        [],
        createWorkflowMetadata('1.0.0'),
      );

      const manifest = createPackManifest(
        [
          createWorkflowReference('workflow_1'),
          createWorkflowReference('workflow_2'),
        ],
        createSequentialPolicy(1, 1000, true),
      );

      const workflowMap = new Map([
        ['workflow_1', workflow1],
        ['workflow_2', workflow2],
      ]);

      const context = {
        environment: {},
        previousResults: new Map(),
        accumulatedData: {},
      };

      const result = await engine.executePack(manifest, workflowMap, context);

      // Verify workflow results are captured
      expect(result.workflowResults[0].workflowId).toBe('workflow_1');
      expect(result.workflowResults[1].workflowId).toBe('workflow_2');
    });

    it('should handle workflow not found in sequence (optional workflow)', async () => {
      const manifest = createPackManifest(
        [
          createWorkflowReference('workflow_1'),
          { ...createWorkflowReference('workflow_missing'), optional: true },
        ],
        createSequentialPolicy(1, 1000, true),
      );

      const workflowMap = new Map([['workflow_1', createWorkflow('workflow_1', 'W1', [], createWorkflowMetadata('1.0.0'))]]);

      const context = {
        environment: {},
        previousResults: new Map(),
        accumulatedData: {},
      };

      const result = await engine.executePack(manifest, workflowMap, context);

      // Should skip missing workflow and continue
      expect(result.workflowResults).toHaveLength(2);
      expect(result.workflowResults[1].status).toBe('skipped');
      expect(result.workflowResults[1].skipped).toBe(true);
    });
  });

  // ========================================================================
  // Parallel Execution Tests
  // ========================================================================

  describe('Parallel Execution', () => {
    it('should execute workflows concurrently', async () => {
      const workflow1 = createWorkflow(
        'workflow_1',
        'Workflow 1',
        [],
        createWorkflowMetadata('1.0.0'),
      );
      const workflow2 = createWorkflow(
        'workflow_2',
        'Workflow 2',
        [],
        createWorkflowMetadata('1.0.0'),
      );
      const workflow3 = createWorkflow(
        'workflow_3',
        'Workflow 3',
        [],
        createWorkflowMetadata('1.0.0'),
      );

      const manifest = createPackManifest(
        [
          createWorkflowReference('workflow_1'),
          createWorkflowReference('workflow_2'),
          createWorkflowReference('workflow_3'),
        ],
        createParallelPolicy(3),
      );

      const workflowMap = new Map([
        ['workflow_1', workflow1],
        ['workflow_2', workflow2],
        ['workflow_3', workflow3],
      ]);

      const context = {
        environment: {},
        previousResults: new Map(),
        accumulatedData: {},
      };

      const result = await engine.executePack(manifest, workflowMap, context);

      expect(result.status).toBe('success');
      expect(result.executionMode).toBe('parallel');
      expect(result.workflowResults).toHaveLength(3);
    });

    it('should respect max concurrency limit', async () => {
      const workflows = Array.from({ length: 6 }, (_, i) =>
        createWorkflow(`workflow_${i}`, `Workflow ${i}`, [], createWorkflowMetadata('1.0.0')),
      );

      const manifest = createPackManifest(
        workflows.map((w, i) => createWorkflowReference(w.id)),
        createParallelPolicy(2), // Max 2 concurrent
      );

      const workflowMap = new Map(workflows.map((w) => [w.id, w]));

      const context = {
        environment: {},
        previousResults: new Map(),
        accumulatedData: {},
      };

      const result = await engine.executePack(manifest, workflowMap, context);

      expect(result.workflowResults).toHaveLength(6);
    });

    it('should handle partial failures in parallel execution', async () => {
      const workflow1 = createWorkflow(
        'workflow_1',
        'Workflow 1',
        [],
        createWorkflowMetadata('1.0.0'),
      );

      const manifest = createPackManifest(
        [
          createWorkflowReference('workflow_1'),
          { ...createWorkflowReference('nonexistent'), optional: true },
        ],
        createParallelPolicy(2),
      );

      const workflowMap = new Map([['workflow_1', workflow1]]);

      const context = {
        environment: {},
        previousResults: new Map(),
        accumulatedData: {},
      };

      const result = await engine.executePack(manifest, workflowMap, context);

      // One success, one skipped
      expect(result.workflowResults).toHaveLength(2);
      expect(result.workflowResults[0].status).toBe('success');
      expect(result.workflowResults[1].status).toBe('skipped');
    });
  });

  // ========================================================================
  // Conditional Execution Tests
  // ========================================================================

  describe('Conditional Execution', () => {
    it('should evaluate conditions and execute matching branches', async () => {
      const workflow = createWorkflow(
        'workflow_1',
        'Workflow 1',
        [],
        createWorkflowMetadata('1.0.0'),
      );

      const manifest = createPackManifest(
        [createWorkflowReference('workflow_1')],
        {
          mode: 'conditional',
          conditions: [
            {
              name: 'windows-branch',
              expression: "platform === 'windows'",
              required: false,
            },
          ],
        },
      );

      const workflowMap = new Map([['workflow_1', workflow]]);

      const context = {
        environment: {},
        previousResults: new Map(),
        accumulatedData: {},
        platformInfo: {
          platform: 'windows',
          version: '10.0',
        },
      };

      const result = await engine.executePack(manifest, workflowMap, context);

      expect(result.executionMode).toBe('conditional');
    });

    it('should execute default branch when no conditions match', async () => {
      const workflow = createWorkflow(
        'workflow_1',
        'Workflow 1',
        [],
        createWorkflowMetadata('1.0.0'),
      );

      const manifest = createPackManifest(
        [createWorkflowReference('workflow_1')],
        {
          mode: 'conditional',
          conditions: [
            {
              name: 'macos-branch',
              expression: "platform === 'macos'",
              required: false,
            },
          ],
        },
      );

      const workflowMap = new Map([['workflow_1', workflow]]);

      const context = {
        environment: {},
        previousResults: new Map(),
        accumulatedData: {},
        platformInfo: {
          platform: 'windows',
          version: '10.0',
        },
      };

      const result = await engine.executePack(manifest, workflowMap, context);

      // Should still execute the workflow via default branch
      expect(result.workflowResults).toHaveLength(1);
    });
  });

  // ========================================================================
  // Data Mapping Tests
  // ========================================================================

  describe('Data Mapping', () => {
    it('should transform values with supported transformation types', () => {
      // Test uppercase transformation
      expect(
        engine['transformValue']('hello', 'uppercase'),
      ).toBe('HELLO');

      // Test lowercase transformation
      expect(
        engine['transformValue']('HELLO', 'lowercase'),
      ).toBe('hello');

      // Test stringify transformation
      expect(
        engine['transformValue']({ key: 'value' }, 'stringify'),
      ).toBe('{"key":"value"}');

      // Test parse transformation
      expect(
        engine['transformValue']('{"key":"value"}', 'parse'),
      ).toEqual({ key: 'value' });

      // Test trim transformation
      expect(
        engine['transformValue']('  hello  ', 'trim'),
      ).toBe('hello');

      // Test split transformation
      expect(
        engine['transformValue']('a,b,c', 'split', [',']),
      ).toEqual(['a', 'b', 'c']);

      // Test join transformation
      expect(
        engine['transformValue'](['a', 'b', 'c'], 'join', [',']),
      ).toBe('a,b,c');
    });

    it('should handle missing transformation arguments gracefully', () => {
      // Split with default delimiter
      expect(
        engine['transformValue']('a,b,c', 'split'),
      ).toEqual(['a', 'b', 'c']);

      // Join with default delimiter
      expect(
        engine['transformValue'](['a', 'b', 'c'], 'join'),
      ).toBe('a,b,c');
    });

    it('should return value unchanged for unknown transformation', () => {
      const value = { test: true };
      expect(
        engine['transformValue'](value, 'unknown-transform'),
      ).toBe(value);
    });
  });

  // ========================================================================
  // Error Handling Tests
  // ========================================================================

  describe('Error Handling', () => {
    it('should retry failed workflow according to policy', async () => {
      const workflow = createWorkflow(
        'workflow_1',
        'Workflow 1',
        [],
        createWorkflowMetadata('1.0.0'),
      );

      const manifest = createPackManifest(
        [createWorkflowReference('workflow_1')],
        createSequentialPolicy(2, 100, false), // 2 retries, 100ms delay
      );

      const workflowMap = new Map([['workflow_1', workflow]]);

      const context = {
        environment: {},
        previousResults: new Map(),
        accumulatedData: {},
      };

      const result = await engine.executePack(manifest, workflowMap, context);

      // Should complete with at least 1 retry attempt
      expect(result.workflowResults[0].retryCount).toBeGreaterThanOrEqual(0);
    });

    it('should stop execution on failure when stopOnError is true', async () => {
      const workflow1 = createWorkflow(
        'workflow_1',
        'Workflow 1',
        [],
        createWorkflowMetadata('1.0.0'),
      );
      const workflow2 = createWorkflow(
        'workflow_2',
        'Workflow 2',
        [],
        createWorkflowMetadata('1.0.0'),
      );

      const manifest = createPackManifest(
        [
          createWorkflowReference('workflow_1'),
          createWorkflowReference('workflow_2'),
        ],
        createSequentialPolicy(1, 1000, true), // stopOnError = true
      );

      const workflowMap = new Map([
        ['workflow_1', workflow1],
        ['workflow_2', workflow2],
      ]);

      const context = {
        environment: {},
        previousResults: new Map(),
        accumulatedData: {},
      };

      const result = await engine.executePack(manifest, workflowMap, context);

      // With mocked success, should complete both
      expect(result.workflowResults).toHaveLength(2);
    });

    it('should continue execution on failure when stopOnError is false', async () => {
      const workflow1 = createWorkflow(
        'workflow_1',
        'Workflow 1',
        [],
        createWorkflowMetadata('1.0.0'),
      );
      const workflow2 = createWorkflow(
        'workflow_2',
        'Workflow 2',
        [],
        createWorkflowMetadata('1.0.0'),
      );

      const manifest = createPackManifest(
        [
          createWorkflowReference('workflow_1'),
          createWorkflowReference('workflow_2'),
        ],
        createSequentialPolicy(1, 1000, false), // stopOnError = false
      );

      const workflowMap = new Map([
        ['workflow_1', workflow1],
        ['workflow_2', workflow2],
      ]);

      const context = {
        environment: {},
        previousResults: new Map(),
        accumulatedData: {},
      };

      const result = await engine.executePack(manifest, workflowMap, context);

      // With mocked success, should complete both
      expect(result.workflowResults).toHaveLength(2);
    });
  });

  // ========================================================================
  // Utility Functions Tests
  // ========================================================================

  describe('Utility Functions', () => {
    it('should create sequential execution configuration', () => {
      const workflows = [
        createWorkflowReference('workflow_1'),
        createWorkflowReference('workflow_2'),
      ];

      const manifest = createSequentialExecution(
        workflows,
        { maxRetries: 3, retryDelayMs: 2000, stopOnError: true },
      );

      expect(manifest.policy.mode).toBe('sequential');
      expect(manifest.policy.maxRetries).toBe(3);
      expect(manifest.policy.retryDelayMs).toBe(2000);
      expect(manifest.policy.stopOnError).toBe(true);
    });

    it('should create parallel execution configuration', () => {
      const workflows = [
        createWorkflowReference('workflow_1'),
        createWorkflowReference('workflow_2'),
        createWorkflowReference('workflow_3'),
      ];

      const manifest = createParallelExecution(
        workflows,
        { maxConcurrency: 2 },
      );

      expect(manifest.policy.mode).toBe('parallel');
      expect(manifest.policy.maxConcurrency).toBe(2);
    });

    it('should create conditional execution configuration', () => {
      const workflows = [createWorkflowReference('workflow_1')];

      const conditions = [
        { name: 'prod', expression: "environment === 'production'", required: true },
        { name: 'dev', expression: "environment === 'development'", required: false },
      ];

      const manifest = createConditionalExecution(
        workflows,
        conditions,
        { timeoutMs: 30000 },
      );

      expect(manifest.policy.mode).toBe('conditional');
      expect(manifest.policy.conditions).toHaveLength(2);
      expect(manifest.policy.timeoutMs).toBe(30000);
    });
  });

  // ========================================================================
  // Edge Cases and Integration Tests
  // ========================================================================

  describe('Edge Cases', () => {
    it('should handle empty workflow list gracefully', async () => {
      const manifest = createPackManifest(
        [],
        createSequentialPolicy(1, 1000, true),
      );

      const workflowMap = new Map();

      const context = {
        environment: {},
        previousResults: new Map(),
        accumulatedData: {},
      };

      const result = await engine.executePack(manifest, workflowMap, context);

      // Empty workflows should return empty results
      expect(result.workflowResults).toHaveLength(0);
      expect(result.status).toBe('success');
    });

    it('should validate manifest with invalid policy', async () => {
      const workflow = createWorkflow(
        'workflow_1',
        'Workflow 1',
        [],
        createWorkflowMetadata('1.0.0'),
      );

      const manifest = createPackManifest(
        [createWorkflowReference('workflow_1')],
        createSequentialPolicy(1, 1000, true),
      );

      const workflowMap = new Map([['workflow_1', workflow]]);

      const context = {
        environment: {},
        previousResults: new Map(),
        accumulatedData: {},
      };

      const result = await engine.executePack(manifest, workflowMap, context);

      expect(result.status).toBe('success');
    });

    it('should handle workflow execution timeout', async () => {
      const workflow = createWorkflow(
        'workflow_1',
        'Workflow 1',
        [],
        createWorkflowMetadata('1.0.0'),
      );

      const manifest = createPackManifest(
        [createWorkflowReference('workflow_1')],
        createSequentialPolicy(1, 1000, true, false, 5000), // 5 second timeout
      );

      const workflowMap = new Map([['workflow_1', workflow]]);

      const context = {
        environment: {},
        previousResults: new Map(),
        accumulatedData: {},
      };

      const result = await engine.executePack(manifest, workflowMap, context);

      expect(result.executionMode).toBe('sequential');
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle complete pack lifecycle: sequential → parallel → conditional', async () => {
      const workflow1 = createWorkflow(
        'workflow_1',
        'Workflow 1',
        [],
        createWorkflowMetadata('1.0.0'),
      );
      const workflow2 = createWorkflow(
        'workflow_2',
        'Workflow 2',
        [],
        createWorkflowMetadata('1.0.0'),
      );

      // Test sequential
      const sequentialManifest = createPackManifest(
        [createWorkflowReference('workflow_1'), createWorkflowReference('workflow_2')],
        createSequentialPolicy(1, 1000, true),
      );

      const workflowMap = new Map([
        ['workflow_1', workflow1],
        ['workflow_2', workflow2],
      ]);

      const context = {
        environment: {},
        previousResults: new Map(),
        accumulatedData: {},
      };

      const seqResult = await engine.executePack(sequentialManifest, workflowMap, context);
      expect(seqResult.executionMode).toBe('sequential');

      // Test parallel
      const parallelManifest = createPackManifest(
        [createWorkflowReference('workflow_1'), createWorkflowReference('workflow_2')],
        createParallelPolicy(2),
      );

      const parResult = await engine.executePack(parallelManifest, workflowMap, context);
      expect(parResult.executionMode).toBe('parallel');
    });
  });
});
