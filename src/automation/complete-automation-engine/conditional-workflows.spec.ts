/**
 * Conditional Workflows and Branching Tests
 *
 * Tests for:
 * - If-else condition support
 * - Switch-case branching
 * - Nested workflow references
 * - Context-based decision making
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Workflow, WorkflowStep, StepCondition } from './workflow-types';
import {
  evaluateCondition,
  evaluateContextEvaluator,
  createIfBranch,
  createSwitchBranch,
  createContextDecision,
  createNestedWorkflowReference,
  createConditionalWorkflowConfig,
  validateConditionalBranch,
  validateContextDecision,
  validateNestedWorkflowReference,
  validateConditionalWorkflowConfig,
  evaluateWorkflowConditions,
  findMatchingBranch,
  createConditionalStep,
  createIfElseWorkflow,
  createSwitchCaseWorkflow,
  createContextRoutingWorkflow,
  mergeConditionalBranchesToWorkflow
} from './conditional-workflows';

/**
 * Helper function to create a basic recording step
 */
function createTestRecordingStep(id: string, name: string, recordingId: string): WorkflowStep {
  return {
    id,
    name,
    type: 'recording',
    recordingId,
    policy: {
      type: 'sequential',
      onError: 'stop'
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/**
 * Helper function to create a basic workflow step
 */
function createTestWorkflowStep(id: string, name: string, workflowId: string): WorkflowStep {
  return {
    id,
    name,
    type: 'workflow',
    workflowId,
    policy: {
      type: 'sequential',
      onError: 'stop'
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

describe('Conditional Workflows', () => {
  describe('evaluateCondition', () => {
    it('should evaluate if condition with === operator', () => {
      const condition: StepCondition = {
        type: 'if',
        variable: 'status',
        operator: '===',
        value: 'active'
      };

      const context = { status: 'active' };
      expect(evaluateCondition(condition, context)).toBe(true);
    });

    it('should evaluate if condition with !== operator', () => {
      const condition: StepCondition = {
        type: 'if',
        variable: 'status',
        operator: '!==',
        value: 'inactive'
      };

      const context = { status: 'active' };
      expect(evaluateCondition(condition, context)).toBe(true);
    });

    it('should evaluate if condition with > operator', () => {
      const condition: StepCondition = {
        type: 'if',
        variable: 'count',
        operator: '>',
        value: 5
      };

      const context = { count: 10 };
      expect(evaluateCondition(condition, context)).toBe(true);
    });

    it('should evaluate if condition with < operator', () => {
      const condition: StepCondition = {
        type: 'if',
        variable: 'count',
        operator: '<',
        value: 10
      };

      const context = { count: 5 };
      expect(evaluateCondition(condition, context)).toBe(true);
    });

    it('should evaluate if condition with >= operator', () => {
      const condition: StepCondition = {
        type: 'if',
        variable: 'count',
        operator: '>=',
        value: 5
      };

      const context = { count: 5 };
      expect(evaluateCondition(condition, context)).toBe(true);
    });

    it('should evaluate if condition with <= operator', () => {
      const condition: StepCondition = {
        type: 'if',
        variable: 'count',
        operator: '<=',
        value: 5
      };

      const context = { count: 5 };
      expect(evaluateCondition(condition, context)).toBe(true);
    });

    it('should evaluate if condition with in operator', () => {
      const condition: StepCondition = {
        type: 'if',
        variable: 'status',
        operator: 'in',
        value: ['active', 'pending', 'running']
      };

      const context = { status: 'active' };
      expect(evaluateCondition(condition, context)).toBe(true);
    });

    it('should evaluate if condition with not-in operator', () => {
      const condition: StepCondition = {
        type: 'if',
        variable: 'status',
        operator: 'not-in',
        value: ['inactive', 'cancelled']
      };

      const context = { status: 'active' };
      expect(evaluateCondition(condition, context)).toBe(true);
    });

    it('should handle inverted conditions', () => {
      const condition: StepCondition = {
        type: 'if',
        variable: 'status',
        operator: '===',
        value: 'active',
        invert: true
      };

      const context = { status: 'inactive' };
      expect(evaluateCondition(condition, context)).toBe(true);
    });

    it('should handle environment conditions', () => {
      const condition: StepCondition = {
        type: 'environment',
        os: 'windows'
      };

      const context = { os: 'windows' };
      expect(evaluateCondition(condition, context)).toBe(true);
    });

    it('should handle data-validation conditions', () => {
      const condition: StepCondition = {
        type: 'data-validation',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'number' }
          }
        }
      };

      const context = { data: { name: 'John', age: 30 } };
      expect(evaluateCondition(condition, context)).toBe(true);
    });
  });

  describe('evaluateContextEvaluator', () => {
    it('should evaluate custom evaluator function', () => {
      const evaluator: ContextEvaluator = (context) => {
        return (context.score as number) > 50;
      };

      const context = { score: 75 };
      expect(evaluateContextEvaluator(evaluator, context)).toBe(true);
    });
  });

  describe('createIfBranch', () => {
    it('should create an if-else branch', () => {
      const trueSteps = [
        createTestRecordingStep('step1', 'True Step', 'recording-1')
      ];
      const falseSteps = [
        createTestRecordingStep('step2', 'False Step', 'recording-2')
      ];

      const branch = createIfBranch(
        'status',
        '===',
        'active',
        trueSteps,
        falseSteps,
        {
          id: 'branch-1',
          label: 'Active Status Branch',
          description: 'Executes when status is active'
        }
      );

      expect(branch.id).toBe('branch-1');
      expect(branch.type).toBe('if');
      expect(branch.trueSteps.length).toBe(1);
      expect(branch.falseSteps?.length).toBe(1);
      expect(branch.label).toBe('Active Status Branch');
    });
  });

  describe('createSwitchBranch', () => {
    it('should create a switch-case branch', () => {
      const case1Steps = [
        createTestRecordingStep('step1', 'Case 1', 'recording-1')
      ];
      const case2Steps = [
        createTestRecordingStep('step2', 'Case 2', 'recording-2')
      ];
      const defaultSteps = [
        createTestRecordingStep('step3', 'Default', 'recording-3')
      ];

      const branch = createSwitchBranch(
        'status',
        [
          { value: 'active', steps: case1Steps, id: 'case-1', label: 'Active' },
          { value: 'pending', steps: case2Steps, id: 'case-2', label: 'Pending' }
        ],
        defaultSteps,
        { id: 'switch-1' }
      );

      expect(branch.id).toBe('switch-1');
      expect(branch.type).toBe('switch');
      
      // Test evaluator
      const context1 = { status: 'active' };
      expect(evaluateContextEvaluator(branch.condition, context1)).toBe(true);
      
      const context2 = { status: 'unknown' };
      expect(evaluateContextEvaluator(branch.condition, context2)).toBe(false);
    });
  });

  describe('createContextDecision', () => {
    it('should create a context-based decision', () => {
      const evaluator: ContextEvaluator = (context) => {
        const score = context.score as number;
        if (score >= 90) return 'excellent';
        if (score >= 70) return 'good';
        return 'needs-improvement';
      };

      const branches = {
        excellent: [
          createTestRecordingStep('step-excellent', 'Excellent', 'recording-excellent')
        ],
        good: [
          createTestRecordingStep('step-good', 'Good', 'recording-good')
        ],
        'needs-improvement': [
          createTestRecordingStep('step-improvement', 'Needs Improvement', 'recording-improvement')
        ]
      };

      const decision = createContextDecision(
        'decision-1',
        ['score'],
        evaluator,
        branches,
        { label: 'Score Decision' }
      );

      expect(decision.id).toBe('decision-1');
      expect(decision.contextKeys).toEqual(['score']);
      expect(decision.branches.excellent).toBeDefined();
      
      // Test evaluator
      expect(decision.evaluator({ score: 95 })).toBe('excellent');
      expect(decision.evaluator({ score: 75 })).toBe('good');
      expect(decision.evaluator({ score: 50 })).toBe('needs-improvement');
    });
  });

  describe('createNestedWorkflowReference', () => {
    it('should create a nested workflow reference', () => {
      const reference = createNestedWorkflowReference(
        'nested-1',
        'workflow-subprocess',
        {
          contextMapping: { input: 'data.input' },
          preConditions: [
            { type: 'if', variable: 'isValid', operator: '===', value: true }
          ],
          postConditions: [
            { type: 'if', variable: 'success', operator: '===', value: true }
          ],
          outputMapping: { result: 'output.result' },
          label: 'Subprocess',
          description: 'Executes subprocess workflow'
        }
      );

      expect(reference.id).toBe('nested-1');
      expect(reference.workflowId).toBe('workflow-subprocess');
      expect(reference.preConditions?.length).toBe(1);
      expect(reference.outputMapping?.result).toBe('output.result');
    });
  });

  describe('createConditionalWorkflowConfig', () => {
    it('should create a conditional workflow configuration', () => {
      const config = createConditionalWorkflowConfig({
        id: 'conditional-workflow',
        name: 'Conditional Workflow',
        branches: [],
        decisions: [],
        nestedWorkflows: []
      });

      expect(config.id).toBe('conditional-workflow');
      expect(config.name).toBe('Conditional Workflow');
      expect(config.metadata?.version).toBe('1.0.0');
    });
  });

  describe('Validation Functions', () => {
    describe('validateConditionalBranch', () => {
      it('should throw error if branch has no id', () => {
        const branch = {
          type: 'if',
          condition: { type: 'if', variable: 'x', operator: '===', value: 1 },
          trueSteps: []
        };

        expect(() => validateConditionalBranch(branch as any)).toThrow();
      });

      it('should throw error if branch has no trueSteps', () => {
        const branch = {
          id: 'branch-1',
          type: 'if',
          condition: { type: 'if', variable: 'x', operator: '===', value: 1 },
          trueSteps: []
        };

        expect(() => validateConditionalBranch(branch as any)).toThrow();
      });
    });

    describe('validateContextDecision', () => {
      it('should throw error if decision has no contextKeys', () => {
        const decision = {
          id: 'decision-1',
          evaluator: () => true,
          branches: {}
        };

        expect(() => validateContextDecision(decision as any)).toThrow();
      });
    });

    describe('validateNestedWorkflowReference', () => {
      it('should throw error if reference has no workflowId', () => {
        const reference = {
          id: 'ref-1',
          workflowId: undefined
        };

        expect(() => validateNestedWorkflowReference(reference as any)).toThrow();
      });
    });

    describe('validateConditionalWorkflowConfig', () => {
      it('should throw error if config has no branches', () => {
        const config = {
          id: 'workflow',
          name: 'Workflow',
          branches: []
        };

        expect(() => validateConditionalWorkflowConfig(config as any)).toThrow();
      });
    });
  });

  describe('evaluateWorkflowConditions', () => {
    it('should evaluate all conditions and return results', () => {
      const config = createConditionalWorkflowConfig({
        id: 'workflow',
        name: 'Workflow',
        branches: [
          createIfBranch('status', '===', 'active', [
            createTestRecordingStep('step1', 'Step 1', 'recording-1')
          ], [], { id: 'branch-1' })
        ]
      });

      const context = { status: 'active' };
      const results = evaluateWorkflowConditions(config, context);

      expect(results['branch-1']).toBe(true);
    });
  });

  describe('findMatchingBranch', () => {
    it('should find the first matching branch', () => {
      const branches = [
        createIfBranch('status', '===', 'inactive', [
          createTestRecordingStep('step1', 'Step 1', 'recording-1')
        ], [], { id: 'branch-1' }),
        createIfBranch('status', '===', 'active', [
          createTestRecordingStep('step2', 'Step 2', 'recording-2')
        ], [], { id: 'branch-2' })
      ];

      const context = { status: 'active' };
      const matchingId = findMatchingBranch(branches, context);

      expect(matchingId).toBe('branch-2');
    });

    it('should return undefined if no branch matches', () => {
      const branches = [
        createIfBranch('status', '===', 'active', [
          createTestRecordingStep('step1', 'Step 1', 'recording-1')
        ], [], { id: 'branch-1' })
      ];

      const context = { status: 'pending' };
      const matchingId = findMatchingBranch(branches, context);

      expect(matchingId).toBeUndefined();
    });
  });

  describe('createConditionalStep', () => {
    it('should create a step with conditional execution', () => {
      const condition: StepCondition = {
        type: 'if',
        variable: 'isValid',
        operator: '===',
        value: true
      };

      const step = createConditionalStep(
        'step-1',
        'Conditional Step',
        'recording',
        'recording-1',
        condition
      );

      expect(step.conditions?.length).toBe(1);
      expect(step.conditions?.[0].type).toBe('if');
    });
  });

  describe('createIfElseWorkflow', () => {
    it('should create an if-else workflow', () => {
      const condition: StepCondition = {
        type: 'if',
        variable: 'isValid',
        operator: '===',
        value: true
      };

      const trueStep = createTestRecordingStep('step-true', 'True Step', 'recording-true');
      const falseStep = createTestRecordingStep('step-false', 'False Step', 'recording-false');

      const workflow = createIfElseWorkflow(
        'if-else-workflow',
        'If-Else Workflow',
        condition,
        trueStep,
        falseStep
      );

      expect(workflow.id).toBe('if-else-workflow');
      expect(workflow.steps.length).toBe(2);
      expect(workflow.steps[0].name).toBe('True Step');
      expect(workflow.steps[1].name).toBe('False Step');
    });
  });

  describe('createSwitchCaseWorkflow', () => {
    it('should create a switch-case workflow', () => {
      const case1Step = createTestRecordingStep('step-active', 'Active Step', 'recording-active');
      const case2Step = createTestRecordingStep('step-pending', 'Pending Step', 'recording-pending');
      const defaultStep = createTestRecordingStep('step-default', 'Default Step', 'recording-default');

      const workflow = createSwitchCaseWorkflow(
        'switch-workflow',
        'Switch Workflow',
        'status',
        [
          { value: 'active', step: case1Step },
          { value: 'pending', step: case2Step }
        ],
        defaultStep
      );

      expect(workflow.id).toBe('switch-workflow');
      expect(workflow.steps.length).toBe(3);
    });
  });

  describe('createContextRoutingWorkflow', () => {
    it('should create a context-based routing workflow', () => {
      const routes = {
        high: [createTestRecordingStep('step-high', 'High Priority', 'recording-high')],
        low: [createTestRecordingStep('step-low', 'Low Priority', 'recording-low')]
      };

      const evaluator = (context: Record<string, unknown>) => {
        return (context.priority as number) > 5 ? 'high' : 'low';
      };

      const workflow = createContextRoutingWorkflow(
        'routing-workflow',
        'Routing Workflow',
        ['priority'],
        evaluator,
        routes
      );

      expect(workflow.id).toBe('routing-workflow');
      expect(workflow.steps.length).toBe(2);
    });
  });

  describe('mergeConditionalBranchesToWorkflow', () => {
    it('should merge conditional branches into a single workflow', () => {
      const branch1Steps = [
        createTestRecordingStep('step-branch1', 'Branch 1 Step', 'recording-branch1')
      ];
      const branch2Steps = [
        createTestRecordingStep('step-branch2', 'Branch 2 Step', 'recording-branch2')
      ];

      const config = createConditionalWorkflowConfig({
        id: 'merged-workflow',
        name: 'Merged Workflow',
        branches: [
          createIfBranch('status', '===', 'active', branch1Steps, [], { id: 'branch-1' }),
          createIfBranch('status', '===', 'pending', branch2Steps, [], { id: 'branch-2' })
        ]
      });

      const workflow = mergeConditionalBranchesToWorkflow(config);

      expect(workflow.id).toBe('merged-workflow');
      expect(workflow.steps.length).toBe(2);
      expect(workflow.steps[0].name).toBe('Branch 1 Step');
      expect(workflow.steps[0].conditions?.length).toBeGreaterThan(0);
    });
  });
});
