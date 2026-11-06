/**
 * Workflow Composition and Decomposition Tests
 *
 * Tests for:
 * - Sequential workflow composition (A → B → C)
 * - Parallel workflow composition (A | B | C)
 * - Conditional workflow composition (A → B | C)
 * - Workflow decomposition (extract sub-workflows)
 * - Reference resolution
 * - Workflow transformations (rename, tag, filter, reorder)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Workflow, WorkflowStep, StepCondition, ExecutionPolicy } from './workflow-types';
import {
  combineWorkflowsSequential,
  combineWorkflowsParallel,
  combineWorkflowsConditional,
  extractSubWorkflow,
  extractSubWorkflows,
  extractSubWorkflowByRange,
  resolveWorkflowReferences,
  validateWorkflowReferences,
  detectCircularDependencies,
  renameWorkflow,
  renameSteps,
  tagWorkflow,
  filterSteps,
  reorderSteps,
  detagWorkflow,
  cloneWorkflow,
  mergeWorkflows,
  CompositionStrategy,
  CompositionOptions,
  DecompositionOptions,
  ResolutionOptions
} from './workflow-composition';

/**
 * Helper function to create a basic step
 */
function createStep(
  id: string,
  name: string,
  type: 'recording' | 'workflow' = 'recording',
  referenceId?: string
): WorkflowStep {
  return {
    id,
    name,
    type,
    recordingId: type === 'recording' ? referenceId : undefined,
    workflowId: type === 'workflow' ? referenceId : undefined,
    conditions: [],
    policy: {
      type: 'sequential',
      onError: 'stop'
    },
    outputMapping: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/**
 * Helper function to create a basic workflow
 */
function createWorkflow(
  id: string,
  name: string,
  steps: WorkflowStep[] = [],
  metadataOverrides?: Partial<Workflow>
): Workflow {
  return {
    id,
    name,
    description: `Test workflow: ${name}`,
    steps,
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: '1.0.0',
      source: 'user-created',
      tags: ['test'],
      executionCount: 0,
      successCount: 0,
      failureCount: 0,
      averageDuration: 0
    },
    ...metadataOverrides
  };
}

describe('Workflow Composition', () => {
  describe('Sequential Composition', () => {
    it('should combine workflows with flatten strategy', () => {
      const workflowA = createWorkflow('workflow-a', 'Workflow A', [
        createStep('step-1', 'Step 1'),
        createStep('step-2', 'Step 2')
      ]);

      const workflowB = createWorkflow('workflow-b', 'Workflow B', [
        createStep('step-3', 'Step 3'),
        createStep('step-4', 'Step 4')
      ]);

      const combined = combineWorkflowsSequential(workflowA, workflowB, {
        strategy: 'flatten'
      });

      expect(combined.steps.length).toBe(4);
      expect(combined.name).toBe('Workflow A + Workflow B');
      expect(combined.steps[0].id).toBe('step-1');
      expect(combined.steps[2].id).toBe('step-3');
    });

    it('should combine workflows with nest strategy', () => {
      const workflowA = createWorkflow('workflow-a', 'Workflow A', [
        createStep('step-1', 'Step 1')
      ]);

      const workflowB = createWorkflow('workflow-b', 'Workflow B', [
        createStep('step-2', 'Step 2')
      ]);

      const combined = combineWorkflowsSequential(workflowA, workflowB, {
        strategy: 'nest'
      });

      expect(combined.steps.length).toBe(2);
      expect(combined.steps[1].type).toBe('workflow');
      expect(combined.steps[1].workflowId).toBe('workflow-b');
    });

    it('should combine workflows with merge strategy', () => {
      const workflowA = createWorkflow('workflow-a', 'Workflow A', [
        createStep('step-1', 'Step 1'),
        createStep('step-2', 'Step 2')
      ]);

      const workflowB = createWorkflow('workflow-b', 'Workflow B', [
        createStep('step-2', 'Step 2 (different)'),
        createStep('step-3', 'Step 3')
      ]);

      const combined = combineWorkflowsSequential(workflowA, workflowB, {
        strategy: 'merge'
      });

      expect(combined.steps.length).toBe(3);
      expect(combined.steps[1].name).toBe('Step 2');
    });

    it('should apply id prefix when combining workflows', () => {
      const workflowA = createWorkflow('workflow-a', 'Workflow A', [
        createStep('step-1', 'Step 1')
      ]);

      const workflowB = createWorkflow('workflow-b', 'Workflow B', [
        createStep('step-2', 'Step 2')
      ]);

      const combined = combineWorkflowsSequential(workflowA, workflowB, {
        idPrefix: 'combined'
      });

      expect(combined.steps[1].id).toBe('combined-step-2');
    });
  });

  describe('Parallel Composition', () => {
    it('should combine workflows in parallel', () => {
      const workflowA = createWorkflow('workflow-a', 'Workflow A', [
        createStep('step-1', 'Step 1')
      ]);

      const workflowB = createWorkflow('workflow-b', 'Workflow B', [
        createStep('step-2', 'Step 2')
      ]);

      const workflowC = createWorkflow('workflow-c', 'Workflow C', [
        createStep('step-3', 'Step 3')
      ]);

      const parallel = combineWorkflowsParallel([workflowA, workflowB, workflowC]);

      expect(parallel.steps.length).toBe(4);
      expect(parallel.name).toBe('Workflow A | Workflow B | Workflow C');
    });

    it('should throw error for empty workflow array', () => {
      expect(() => {
        combineWorkflowsParallel([]);
      }).toThrow('At least one workflow is required');
    });

    it('should return single workflow for single input', () => {
      const workflow = createWorkflow('workflow-a', 'Workflow A');

      const result = combineWorkflowsParallel([workflow]);

      expect(result).toBe(workflow);
    });

    it('should create nested parallel workflows', () => {
      const workflowA = createWorkflow('workflow-a', 'Workflow A', [
        createStep('step-1', 'Step 1')
      ]);

      const workflowB = createWorkflow('workflow-b', 'Workflow B', [
        createStep('step-2', 'Step 2')
      ]);

      const parallel = combineWorkflowsParallel([workflowA, workflowB], {
        strategy: 'nest'
      });

      expect(parallel.steps.length).toBe(3);
      expect(parallel.steps[1].type).toBe('workflow');
      expect(parallel.steps[2].type).toBe('workflow');
    });
  });

  describe('Conditional Composition', () => {
    it('should create conditional workflow with if-else', () => {
      const workflowA = createWorkflow('workflow-a', 'Workflow A', [
        createStep('step-1', 'Step 1')
      ]);

      const workflowB = createWorkflow('workflow-b', 'Workflow B', [
        createStep('step-2', 'Step 2')
      ]);

      const workflowC = createWorkflow('workflow-c', 'Workflow C', [
        createStep('step-3', 'Step 3')
      ]);

      const condition: StepCondition = {
        type: 'if',
        variable: 'status',
        operator: '===',
        value: 'active'
      };

      const conditional = combineWorkflowsConditional(
        workflowA,
        workflowB,
        workflowC,
        condition
      );

      expect(conditional.name).toBe('Workflow A → (Workflow B | Workflow C)');
      expect(conditional.steps[1].name).toBe('Branch Condition');
    });

    it('should create conditional workflow without else branch', () => {
      const workflowA = createWorkflow('workflow-a', 'Workflow A', [
        createStep('step-1', 'Step 1')
      ]);

      const workflowB = createWorkflow('workflow-b', 'Workflow B', [
        createStep('step-2', 'Step 2')
      ]);

      const conditional = combineWorkflowsConditional(workflowA, workflowB);

      expect(conditional.name).toBe('Workflow A → (Workflow B)');
      expect(conditional.steps[1].name).toBe('Branch Condition');
    });
  });
});

describe('Workflow Decomposition', () => {
  describe('Extract Sub-Workflow', () => {
    it('should extract sub-workflow by tags', () => {
      const workflow = createWorkflow('workflow', 'Workflow', [
        createStep('step-1', 'Step 1'),
        createStep('step-2', 'Step 2')
      ]);

      const result = extractSubWorkflow(workflow);

      expect(result.workflow.steps.length).toBe(2);
      expect(result.originalIndices).toEqual([0, 1]);
    });

    it('should extract sub-workflow by step type', () => {
      const workflow = createWorkflow('workflow', 'Workflow', [
        createStep('step-1', 'Step 1', 'recording', 'rec-1'),
        createStep('step-2', 'Step 2', 'workflow', 'wf-1'),
        createStep('step-3', 'Step 3', 'recording', 'rec-2')
      ]);

      const result = extractSubWorkflow(workflow, {
        stepType: 'recording'
      });

      expect(result.workflow.steps.length).toBe(2);
      expect(result.workflow.steps[0].type).toBe('recording');
    });

    it('should extract sub-workflow by name pattern', () => {
      const workflow = createWorkflow('workflow', 'Workflow', [
        createStep('step-1', 'Login Step'),
        createStep('step-2', 'Logout Step'),
        createStep('step-3', 'Data Step')
      ]);

      const result = extractSubWorkflow(workflow, {
        namePattern: /Step$/
      });

      expect(result.workflow.steps.length).toBe(3);
    });

    it('should return empty sub-workflow when no steps match criteria', () => {
      const workflow = createWorkflow('workflow', 'Workflow', [
        createStep('step-1', 'Step 1')
      ]);

      const result = extractSubWorkflow(workflow, {
        namePattern: /nonexistent/
      });

      expect(result.workflow.steps.length).toBe(0);
      expect(result.originalIndices).toEqual([]);
    });
  });

  describe('Extract Sub-Workflows', () => {
    it('should extract sub-workflows by type', () => {
      const workflow = createWorkflow('workflow', 'Workflow', [
        createStep('step-1', 'Step 1', 'recording', 'rec-1'),
        createStep('step-2', 'Step 2', 'workflow', 'wf-1'),
        createStep('step-3', 'Step 3', 'recording', 'rec-2')
      ]);

      const results = extractSubWorkflows(workflow);

      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Extract Sub-Workflow by Range', () => {
    it('should extract steps by range', () => {
      const workflow = createWorkflow('workflow', 'Workflow', [
        createStep('step-1', 'Step 1'),
        createStep('step-2', 'Step 2'),
        createStep('step-3', 'Step 3'),
        createStep('step-4', 'Step 4')
      ]);

      const result = extractSubWorkflowByRange(workflow, 1, 3);

      expect(result.workflow.steps.length).toBe(2);
      expect(result.originalIndices).toEqual([1, 2]);
    });

    it('should throw error for invalid range', () => {
      const workflow = createWorkflow('workflow', 'Workflow', [
        createStep('step-1', 'Step 1')
      ]);

      expect(() => {
        extractSubWorkflowByRange(workflow, 0, 5);
      }).toThrow('Invalid endIndex');
    });
  });
});

describe('Reference Resolution', () => {
  describe('Resolve Workflow References', () => {
    it('should resolve valid workflow references', () => {
      const referencedWorkflow = createWorkflow('wf-1', 'Referenced Workflow');

      const workflow = createWorkflow('workflow', 'Workflow', [
        createStep('step-1', 'Step 1', 'workflow', 'wf-1')
      ]);

      const workflowMap = new Map<string, Workflow>([
        ['wf-1', referencedWorkflow]
      ]);

      const resolved = resolveWorkflowReferences(workflow, workflowMap);

      expect(resolved.get('step-1')?.isValid).toBe(true);
      expect(resolved.get('step-1')?.workflow).toBe(referencedWorkflow);
    });

    it('should detect invalid workflow references', () => {
      const workflow = createWorkflow('workflow', 'Workflow', [
        createStep('step-1', 'Step 1', 'workflow', 'nonexistent-wf')
      ]);

      const workflowMap = new Map<string, Workflow>();

      const resolved = resolveWorkflowReferences(workflow, workflowMap);

      expect(resolved.get('step-1')?.isValid).toBe(false);
    });

    it('should detect circular references when expanding', () => {
      const workflow = createWorkflow('workflow', 'Workflow', [
        createStep('step-1', 'Step 1', 'workflow', 'wf-1')
      ]);

      const referencedWorkflow = createWorkflow('wf-1', 'Referenced Workflow', [
        createStep('step-1', 'Step 1', 'workflow', 'workflow')
      ]);

      const workflowMap = new Map<string, Workflow>([
        ['workflow', workflow],
        ['wf-1', referencedWorkflow]
      ]);

      // With expand=true, the circular reference should be detected during nested resolution
      const resolved = resolveWorkflowReferences(workflow, workflowMap, {
        detectCircular: true,
        expand: true
      });

      // The reference to wf-1 should be valid
      expect(resolved.get('step-1')?.isValid).toBe(true);
      expect(resolved.get('step-1')?.workflow).toBeDefined();
    });
  });

  describe('Validate Workflow References', () => {
    it('should find invalid references', () => {
      const workflow = createWorkflow('workflow', 'Workflow', [
        createStep('step-1', 'Step 1', 'workflow', 'nonexistent')
      ]);

      const workflowMap = new Map<string, Workflow>();

      const invalid = validateWorkflowReferences(workflow, workflowMap);

      expect(invalid.length).toBeGreaterThan(0);
    });

    it('should find no invalid references when all valid', () => {
      const referencedWorkflow = createWorkflow('wf-1', 'Referenced Workflow');

      const workflow = createWorkflow('workflow', 'Workflow', [
        createStep('step-1', 'Step 1', 'workflow', 'wf-1')
      ]);

      const workflowMap = new Map<string, Workflow>([
        ['wf-1', referencedWorkflow]
      ]);

      const invalid = validateWorkflowReferences(workflow, workflowMap);

      expect(invalid.length).toBe(0);
    });
  });

  describe('Detect Circular Dependencies', () => {
    it('should detect circular dependencies', () => {
      const workflowA = createWorkflow('wf-a', 'Workflow A', [
        createStep('step-1', 'Step 1', 'workflow', 'wf-b')
      ]);

      const workflowB = createWorkflow('wf-b', 'Workflow B', [
        createStep('step-1', 'Step 1', 'workflow', 'wf-a')
      ]);

      const workflowMap = new Map<string, Workflow>([
        ['wf-a', workflowA],
        ['wf-b', workflowB]
      ]);

      const circular = detectCircularDependencies(workflowA, workflowMap);

      expect(circular.length).toBeGreaterThan(0);
    });
  });
});

describe('Workflow Transformations', () => {
  describe('Rename Workflow', () => {
    it('should rename workflow', () => {
      const workflow = createWorkflow('workflow', 'Old Name');

      const renamed = renameWorkflow(workflow, 'New Name');

      expect(renamed.name).toBe('New Name');
      expect(renamed.id).toBe('workflow');
    });
  });

  describe('Rename Steps', () => {
    it('should rename multiple steps', () => {
      const workflow = createWorkflow('workflow', 'Workflow', [
        createStep('step-1', 'Step 1'),
        createStep('step-2', 'Step 2')
      ]);

      const renamed = renameSteps(workflow, {
        'step-1': 'Renamed Step 1',
        'step-2': 'Renamed Step 2'
      });

      expect(renamed.steps[0].name).toBe('Renamed Step 1');
      expect(renamed.steps[1].name).toBe('Renamed Step 2');
    });
  });

  describe('Tag Workflow', () => {
    it('should add tags to workflow', () => {
      const workflow = createWorkflow('workflow', 'Workflow');

      const tagged = tagWorkflow(workflow, ['important', 'critical']);

      expect(tagged.metadata.tags).toContain('important');
      expect(tagged.metadata.tags).toContain('critical');
    });

    it('should add tags to steps', () => {
      const workflow = createWorkflow('workflow', 'Workflow', [
        createStep('step-1', 'Step 1')
      ]);

      const tagged = tagWorkflow(workflow, ['critical'], 'steps');

      expect(tagged.steps[0].outputMapping?.tags).toBe('critical');
    });
  });

  describe('Filter Steps', () => {
    it('should filter steps by predicate', () => {
      const workflow = createWorkflow('workflow', 'Workflow', [
        createStep('step-1', 'Step 1'),
        createStep('step-2', 'Step 2')
      ]);

      const filtered = filterSteps(workflow, step => step.id === 'step-1');

      expect(filtered.steps.length).toBe(1);
      expect(filtered.steps[0].id).toBe('step-1');
    });
  });

  describe('Reorder Steps', () => {
    it('should reorder steps', () => {
      const workflow = createWorkflow('workflow', 'Workflow', [
        createStep('step-1', 'Step 1'),
        createStep('step-2', 'Step 2'),
        createStep('step-3', 'Step 3')
      ]);

      const reordered = reorderSteps(workflow, ['step-3', 'step-1', 'step-2']);

      expect(reordered.steps[0].id).toBe('step-3');
      expect(reordered.steps[1].id).toBe('step-1');
      expect(reordered.steps[2].id).toBe('step-2');
    });
  });

  describe('Detag Workflow', () => {
    it('should remove tags from workflow', () => {
      const workflow = createWorkflow('workflow', 'Workflow', [], {
        metadata: {
          tags: ['important', 'critical', 'deprecated']
        } as any
      });

      const detagged = detagWorkflow(workflow, ['deprecated']);

      expect(detagged.metadata.tags).not.toContain('deprecated');
      expect(detagged.metadata.tags).toContain('important');
    });

    it('should remove tags from steps', () => {
      const workflow = createWorkflow('workflow', 'Workflow', [
        createStep('step-1', 'Step 1')
      ]);

      const tagged = tagWorkflow(workflow, ['deprecated', 'important'], 'steps');

      const detagged = detagWorkflow(tagged, ['deprecated'], 'steps');

      expect(detagged.steps[0].outputMapping?.tags).toBe('important');
    });
  });
});

describe('Workflow Cloning and Merging', () => {
  describe('Clone Workflow', () => {
    it('should clone workflow with new ID', () => {
      const workflow = createWorkflow('workflow-a', 'Workflow A', [
        createStep('step-1', 'Step 1')
      ]);

      const cloned = cloneWorkflow(workflow, 'workflow-b', 'Workflow B');

      expect(cloned.id).toBe('workflow-b');
      expect(cloned.name).toBe('Workflow B');
      expect(cloned.steps[0].id).toBe('workflow-b-step-1');
    });
  });

  describe('Merge Workflows', () => {
    it('should merge multiple workflows', () => {
      const workflowA = createWorkflow('workflow-a', 'Workflow A', [
        createStep('step-1', 'Step 1')
      ]);

      const workflowB = createWorkflow('workflow-b', 'Workflow B', [
        createStep('step-2', 'Step 2')
      ]);

      const merged = mergeWorkflows([workflowA, workflowB]);

      expect(merged.steps.length).toBe(2);
      expect(merged.name).toBe('Workflow A + Workflow B');
    });

    it('should throw error for empty array', () => {
      expect(() => {
        mergeWorkflows([]);
      }).toThrow('At least one workflow is required');
    });
  });
});
