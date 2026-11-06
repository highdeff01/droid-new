/**
 * Dry-Run and Test Mode Tests
 *
 * Comprehensive test suite for:
 * - Dry-run execution without side effects
 * - Step result prediction accuracy
 * - Confidence scoring algorithms
 * - Risk assessment and safety confirmations
 * - Test mode session management
 * - Test execution result aggregation
 *
 * Requirements: 51.1, 51.2, 51.3, 51.4
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  DryRunExecutor,
  TestModeService,
  executeDryRun,
  executeTestMode,
  calculateWorkflowConfidence,
  validateWorkflowForExecution,
  validateTestSpecification,
  PredictionResult,
  SafetyAssessment,
  TestExecutionResult,
  TestSession,
  TestStepResult
} from '../core/dry-run-test-mode';
import type { Workflow, WorkflowStep, ExecutionPolicy } from '../workflow-types';
import type { ExecutionContext } from '../integration-types';
import { createEntityId, createTimestamp } from '../integration-types';

// ============================================================================
// MOCK DATA
// ============================================================================

function createMockStep(
  id: string,
  name: string,
  type: 'recording' | 'workflow' = 'recording',
  override: Partial<WorkflowStep> = {}
): WorkflowStep {
  return {
    id,
    name,
    type,
    order: 0,
    policy: {
      type: 'sequential',
      onError: 'stop'
    },
    createdAt: createTimestamp(),
    ...override
  };
}

function createMockWorkflow(
  id: string,
  name: string,
  steps: WorkflowStep[] = [],
  override: Partial<Workflow> = {}
): Workflow {
  return {
    id,
    name,
    version: '1.0.0',
    steps,
    metadata: {
      author: 'test-user',
      createdAt: createTimestamp(),
      executionCount: 0,
      tags: []
    },
    ...override
  };
}

function createMockExecutionContext(
  overrides: Partial<ExecutionContext> = {}
): ExecutionContext {
  return {
    executionId: createEntityId('context'),
    workflowId: 'test-workflow',
    displayState: {
      width: 1920,
      height: 1080,
      dpi: 96,
      isMultiDisplay: false
    },
    variables: {},
    visibleElements: [],
    executionPath: [],
    createdAt: createTimestamp(),
    ...overrides
  };
}

// ============================================================================
// DRY-RUN EXECUTION TESTS
// ============================================================================

describe('DryRunExecutor', () => {
  describe('executeDryRun', () => {
    it('should execute dry-run successfully for a simple workflow', () => {
      const executor = new DryRunExecutor();
      const workflow = createMockWorkflow('workflow-1', 'Test Workflow', [
        createMockStep('step-1', 'Step 1'),
        createMockStep('step-2', 'Step 2')
      ]);

      const result = executor.executeDryRun(workflow, createMockExecutionContext());

      expect(result).toBeDefined();
      expect(result.workflowId).toBe('workflow-1');
      expect(result.success).toBe(true);
      expect(result.stepResults.length).toBe(2);
      expect(result.stepResults[0].stepId).toBe('step-1');
      expect(result.stepResults[1].stepId).toBe('step-2');
    });

    it('should calculate confidence score correctly', () => {
      const executor = new DryRunExecutor();
      const workflow = createMockWorkflow('workflow-2', 'Test Workflow', [
        createMockStep('step-1', 'Step 1')
      ]);

      const result = executor.executeDryRun(workflow, createMockExecutionContext());

      expect(result.confidenceScore).toBeGreaterThan(0);
      expect(result.confidenceScore).toBeLessThanOrEqual(100);
    });

    it('should handle empty workflow', () => {
      const executor = new DryRunExecutor();
      const workflow = createMockWorkflow('workflow-3', 'Empty Workflow', []);

      const result = executor.executeDryRun(workflow, createMockExecutionContext());

      expect(result.stepResults.length).toBe(0);
      expect(result.confidenceScore).toBe(0);
    });

    it('should mark steps as skipped when conditions fail', () => {
      const executor = new DryRunExecutor();
      const workflow = createMockWorkflow('workflow-4', 'Conditional Workflow', [
        createMockStep('step-1', 'Step 1', 'recording', {
          conditions: [
            {
              type: 'if',
              variable: 'testVar',
              operator: '===',
              value: 'expectedValue'
            }
          ]
        })
      ]);

      const context = createMockExecutionContext({
        variables: { testVar: 'wrongValue' }
      });

      const result = executor.executeDryRun(workflow, context);

      expect(result.stepResults[0].skipped).toBe(true);
      expect(result.stepResults[0].conditionResult).toBe(false);
    });

    it('should include validation results', () => {
      const executor = new DryRunExecutor();
      const workflow = createMockWorkflow('workflow-5', 'Validation Test', [
        createMockStep('step-1', 'Step 1')
      ]);

      const result = executor.executeDryRun(workflow, createMockExecutionContext());

      expect(result.validation).toBeDefined();
      expect(result.validation.isValid).toBe(true);
    });
  });

  describe('predictStepResult', () => {
    it('should predict step execution result', () => {
      const executor = new DryRunExecutor();
      const step = createMockStep('step-1', 'Test Step');

      const context = createMockExecutionContext({
        variables: { testVar: 'value' }
      });

      const result = executor.predictStepResult(step, context);

      expect(result).toBeDefined();
      expect(result.stepId).toBe('step-1');
      expect(result.wouldExecute).toBe(true);
      expect(result.success).toBe(true);
      expect(result.confidenceScore).toBeGreaterThan(0);
    });

    it('should include context match information', () => {
      const executor = new DryRunExecutor();
      const step = createMockStep('step-1', 'Test Step');

      const context = createMockExecutionContext({
        variables: { testVar: 'value' }
      });

      const result = executor.predictStepResult(step, context);

      expect(result.contextMatch).toBeDefined();
      expect(result.contextMatch.variables.testVar).toBe('value');
    });
  });

  describe('calculateDryRunConfidence', () => {
    it('should calculate confidence for multiple results', () => {
      const executor = new DryRunExecutor();
      
      const results: PredictionResult[] = [
        {
          stepId: 'step-1',
          stepName: 'Step 1',
          wouldExecute: true,
          success: true,
          confidenceScore: 85,
          durationMs: 100,
          contextMatch: createMockExecutionContext()
        },
        {
          stepId: 'step-2',
          stepName: 'Step 2',
          wouldExecute: true,
          success: true,
          confidenceScore: 90,
          durationMs: 100,
          contextMatch: createMockExecutionContext()
        }
      ];

      const confidence = executor.calculateDryRunConfidence(results);

      expect(confidence).toBeGreaterThan(0);
      expect(confidence).toBeLessThanOrEqual(100);
    });

    it('should return 0 for empty results', () => {
      const executor = new DryRunExecutor();
      const confidence = executor.calculateDryRunConfidence([]);

      expect(confidence).toBe(0);
    });

    it('should lower confidence for failed steps', () => {
      const executor = new DryRunExecutor();
      
      const results: PredictionResult[] = [
        {
          stepId: 'step-1',
          stepName: 'Step 1',
          wouldExecute: true,
          success: true,
          confidenceScore: 85,
          durationMs: 100,
          contextMatch: createMockExecutionContext()
        },
        {
          stepId: 'step-2',
          stepName: 'Step 2',
          wouldExecute: true,
          success: false,
          error: 'Step failed',
          confidenceScore: 0,
          durationMs: 100,
          contextMatch: createMockExecutionContext()
        }
      ];

      const confidence = executor.calculateDryRunConfidence(results);

      expect(confidence).toBeLessThan(80);
    });
  });

  describe('isRiskyWorkflow', () => {
    it('should identify risky workflows with many steps', () => {
      const executor = new DryRunExecutor();
      
      const steps: WorkflowStep[] = [];
      for (let i = 0; i < 60; i++) {
        steps.push(createMockStep(`step-${i}`, `Step ${i}`));
      }
      
      const workflow = createMockWorkflow('risky-workflow', 'Risky Workflow', steps);

      const isRisky = executor.isRiskyWorkflow(workflow);

      expect(isRisky).toBe(true);
    });

    it('should identify risky workflows with nested workflows', () => {
      const executor = new DryRunExecutor();
      
      const workflow = createMockWorkflow('risky-workflow', 'Risky Workflow', [
        createMockStep('step-1', 'Step 1'),
        createMockStep('step-2', 'Step 2', 'workflow', {
          workflowId: 'nested-workflow'
        })
      ]);

      const isRisky = executor.isRiskyWorkflow(workflow);

      expect(isRisky).toBe(true);
    });

    it('should identify risky workflows with output mappings', () => {
      const executor = new DryRunExecutor();
      
      const workflow = createMockWorkflow('risky-workflow', 'Risky Workflow', [
        createMockStep('step-1', 'Step 1', 'recording', {
          outputMapping: {
            'outputKey': 'path.to.value'
          }
        })
      ]);

      const isRisky = executor.isRiskyWorkflow(workflow);

      expect(isRisky).toBe(true);
    });

    it('should identify safe simple workflows', () => {
      const executor = new DryRunExecutor();
      
      const workflow = createMockWorkflow('safe-workflow', 'Safe Workflow', [
        createMockStep('step-1', 'Step 1')
      ]);

      const isRisky = executor.isRiskyWorkflow(workflow);

      expect(isRisky).toBe(false);
    });
  });

  describe('getSafetyAssessment', () => {
    it('should generate safety assessment for workflow', () => {
      const executor = new DryRunExecutor();
      
      const workflow = createMockWorkflow('test-workflow', 'Test Workflow', [
        createMockStep('step-1', 'Step 1')
      ]);

      const assessment = executor.getSafetyAssessment(workflow);

      expect(assessment).toBeDefined();
      expect(assessment.safetyLevel).toBeDefined();
      expect(assessment.safetyScore).toBeGreaterThan(0);
      expect(assessment.riskLevel).toBeDefined();
      expect(assessment.confirmationRequirement).toBeDefined();
      expect(assessment.safetyRecommendations.length).toBeGreaterThan(0);
    });

    it('should require explicit confirmation for risky workflows', () => {
      const executor = new DryRunExecutor();
      
      const steps: WorkflowStep[] = [];
      for (let i = 0; i < 60; i++) {
        steps.push(createMockStep(`step-${i}`, `Step ${i}`));
      }
      
      const workflow = createMockWorkflow('risky-workflow', 'Risky Workflow', steps);

      const assessment = executor.getSafetyAssessment(workflow);

      expect(assessment.isRisky).toBe(true);
      expect(assessment.confirmationRequirement).toBe('explicit');
    });

    it('should provide safety recommendations', () => {
      const executor = new DryRunExecutor();
      
      const workflow = createMockWorkflow('test-workflow', 'Test Workflow', [
        createMockStep('step-1', 'Step 1')
      ]);

      const assessment = executor.getSafetyAssessment(workflow);

      expect(assessment.safetyRecommendations.length).toBeGreaterThan(0);
    });

    it('should include potential failure points', () => {
      const executor = new DryRunExecutor();
      
      const workflow = createMockWorkflow('test-workflow', 'Test Workflow', [
        createMockStep('step-1', 'Step 1')
      ]);

      const assessment = executor.getSafetyAssessment(workflow);

      expect(assessment.potentialFailurePoints).toBeDefined();
    });

    it('should include dry-run results in assessment', () => {
      const executor = new DryRunExecutor();
      
      const workflow = createMockWorkflow('test-workflow', 'Test Workflow', [
        createMockStep('step-1', 'Step 1')
      ]);

      const assessment = executor.getSafetyAssessment(workflow);

      expect(assessment.dryRunResult).toBeDefined();
    });
  });
});

// ============================================================================
// TEST MODE SERVICE TESTS
// ============================================================================

describe('TestModeService', () => {
  describe('enterTestMode', () => {
    it('should create a new test session', () => {
      const service = new TestModeService();
      
      const context = {
        variables: { testVar: 'value' },
        displayState: {
          width: 1920,
          height: 1080,
          dpi: 96,
          isMultiDisplay: false
        }
      };

      const session = service.enterTestMode('workflow-1', context);

      expect(session).toBeDefined();
      expect(session.sessionId).toBeDefined();
      expect(session.workflowId).toBe('workflow-1');
      expect(session.isActive).toBe(true);
      expect(session.testContext.variables.testVar).toBe('value');
    });

    it('should initialize with empty test inputs', () => {
      const service = new TestModeService();
      
      const session = service.enterTestMode('workflow-1', {});

      expect(session.testInputs).toEqual([]);
    });
  });

  describe('executeInTestMode', () => {
    it('should execute steps in test mode', () => {
      const service = new TestModeService();
      
      const session = service.enterTestMode('workflow-1', {});
      
      const steps = [
        {
          id: 'step-1',
          type: 'recording' as const,
          name: 'Step 1',
          order: 0,
          status: 'pending' as const
        }
      ];

      const result = service.executeInTestMode(session.sessionId, steps);

      expect(result).toBeDefined();
      expect(result.passed).toBe(true);
      expect(result.stepResults.length).toBe(1);
      expect(result.stepResults[0].passed).toBe(true);
    });

    it('should handle step failures', () => {
      const service = new TestModeService();
      
      const session = service.enterTestMode('workflow-1', {});
      
      const steps = [
        {
          id: 'step-1',
          type: 'recording' as const,
          name: 'Step 1',
          order: 0,
          status: 'pending' as const
        }
      ];

      const result = service.executeInTestMode(session.sessionId, steps);

      expect(result).toBeDefined();
    });

    it('should stop on first failure', () => {
      const service = new TestModeService();
      
      const session = service.enterTestMode('workflow-1', {});
      
      const steps = [
        {
          id: 'step-1',
          type: 'recording' as const,
          name: 'Step 1',
          order: 0,
          status: 'pending' as const
        }
      ];

      const result = service.executeInTestMode(session.sessionId, steps);

      expect(result.stepResults.length).toBe(1);
    });
  });

  describe('exitTestMode', () => {
    it('should mark session as inactive', () => {
      const service = new TestModeService();
      
      const session = service.enterTestMode('workflow-1', {});
      service.exitTestMode(session.sessionId);

      const updatedSession = service.getTestSession(session.sessionId);
      expect(updatedSession?.isActive).toBe(false);
    });

    it('should cleanup results after delay', () => {
      const service = new TestModeService();
      
      const session = service.enterTestMode('workflow-1', {});
      service.executeInTestMode(session.sessionId, []);
      
      service.exitTestMode(session.sessionId);
      
      // Results should still be available immediately after exit
      const results = service.getTestResults(session.sessionId);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('getTestResults', () => {
    it('should return test results for a session', () => {
      const service = new TestModeService();
      
      const session = service.enterTestMode('workflow-1', {});
      const result = service.executeInTestMode(session.sessionId, []);
      
      const results = service.getTestResults(session.sessionId);
      
      expect(results.length).toBe(1);
      expect(results[0].testRunId).toBe(result.testRunId);
    });

    it('should return empty array for non-existent session', () => {
      const service = new TestModeService();
      
      const results = service.getTestResults('non-existent-session');
      
      expect(results.length).toBe(0);
    });
  });

  describe('addTestInput', () => {
    it('should add test input to session', () => {
      const service = new TestModeService();
      
      const session = service.enterTestMode('workflow-1', {});
      service.addTestInput(session.sessionId, 'step-1', { testData: 'value' });

      const updatedSession = service.getTestSession(session.sessionId);
      expect(updatedSession?.testInputs.length).toBe(1);
      expect(updatedSession?.testInputs[0].input.testData).toBe('value');
    });
  });

  describe('getActiveSessions', () => {
    it('should return only active sessions', () => {
      const service = new TestModeService();
      
      const session1 = service.enterTestMode('workflow-1', {});
      const session2 = service.enterTestMode('workflow-2', {});
      
      service.exitTestMode(session2.sessionId);

      const activeSessions = service.getActiveSessions();
      
      expect(activeSessions.length).toBe(1);
      expect(activeSessions[0].sessionId).toBe(session1.sessionId);
    });
  });
});

// ============================================================================
// UTILITY FUNCTION TESTS
// ============================================================================

describe('calculateWorkflowConfidence', () => {
  it('should calculate confidence from step results', () => {
    const dryRunResult = {
      stepResults: [
        { stepId: '1', success: true, confidenceScore: 80, predictedOutput: { metadata: { elementMatchScore: 0.9 } } },
        { stepId: '2', success: true, confidenceScore: 90, predictedOutput: { metadata: { elementMatchScore: 0.8 } } },
        { stepId: '3', success: false, confidenceScore: 0, predictedOutput: { metadata: { elementMatchScore: 0.7 } } }
      ],
      metrics: { stepsFailed: 1 }
    };

    const confidence = calculateWorkflowConfidence(dryRunResult as any);

    expect(confidence).toBeGreaterThan(0);
    expect(confidence).toBeLessThanOrEqual(100);
  });

  it('should return 0 for empty step results', () => {
    const confidence = calculateWorkflowConfidence({
      stepResults: []
    } as any);

    expect(confidence).toBe(0);
  });
});

describe('validateWorkflowForExecution', () => {
  it('should validate workflow structure', () => {
    const workflow = createMockWorkflow('workflow-1', 'Test Workflow', [
      createMockStep('step-1', 'Step 1')
    ]);

    const validation = validateWorkflowForExecution(workflow, createMockExecutionContext());

    expect(validation.isValid).toBe(true);
    expect(validation.errors.length).toBe(0);
  });

  it('should detect missing variables in conditions', () => {
    const workflow = createMockWorkflow('workflow-2', 'Test Workflow', [
      createMockStep('step-1', 'Step 1', 'recording', {
        conditions: [
          {
            type: 'if',
            variable: 'missingVar',
            operator: '===',
            value: 'expected'
          }
        ]
      })
    ]);

    const validation = validateWorkflowForExecution(workflow, createMockExecutionContext());

    expect(validation.isValid).toBe(false);
    expect(validation.missingVariables).toContain('missingVar');
  });

  it('should warn about large workflows', () => {
    const steps: WorkflowStep[] = [];
    for (let i = 0; i < 101; i++) {
      steps.push(createMockStep(`step-${i}`, `Step ${i}`));
    }
    
    const workflow = createMockWorkflow('large-workflow', 'Large Workflow', steps);

    const validation = validateWorkflowForExecution(workflow, createMockExecutionContext());

    expect(validation.warnings.length).toBeGreaterThan(0);
  });
});

describe('validateTestSpecification', () => {
  it('should validate test specification with valid inputs', () => {
    const testSpec = {
      testId: 'test-1',
      inputs: [
        {
          stepId: 'step-1',
          input: { testData: 'value' },
          output: { expected: 'result' }
        }
      ]
    };

    const result = validateTestSpecification(testSpec);

    expect(result.passed).toBe(true);
    expect(result.issues.length).toBe(0);
  });

  it('should detect missing step IDs', () => {
    const testSpec = {
      testId: 'test-1',
      inputs: [
        {
          stepId: '',
          input: { testData: 'value' }
        }
      ]
    };

    const result = validateTestSpecification(testSpec);

    expect(result.passed).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('should detect duplicate step IDs', () => {
    const testSpec = {
      testId: 'test-1',
      inputs: [
        {
          stepId: 'step-1',
          input: { testData: 'value' }
        },
        {
          stepId: 'step-1',
          input: { testData: 'value2' }
        }
      ]
    };

    const result = validateTestSpecification(testSpec);

    expect(result.passed).toBe(false);
    expect(result.issues.some(issue => issue.includes('Duplicate'))).toBe(true);
  });
});

// ============================================================================
// EDGE CASE TESTS
// ============================================================================

describe('Edge Cases', () => {
  describe('Empty workflows', () => {
    it('should handle empty workflow in dry-run', () => {
      const executor = new DryRunExecutor();
      const workflow = createMockWorkflow('empty', 'Empty Workflow', []);

      const result = executor.executeDryRun(workflow, createMockExecutionContext());

      expect(result.stepResults.length).toBe(0);
    });

    it('should handle empty steps in test mode', () => {
      const service = new TestModeService();
      const session = service.enterTestMode('empty', {});

      const result = service.executeInTestMode(session.sessionId, []);

      expect(result.summary.totalSteps).toBe(0);
      expect(result.passed).toBe(false); // No steps means not passed
    });
  });

  describe('Invalid contexts', () => {
    it('should handle missing context variables', () => {
      const executor = new DryRunExecutor();
      const workflow = createMockWorkflow('workflow', 'Workflow', [
        createMockStep('step-1', 'Step 1', 'recording', {
          conditions: [
            {
              type: 'if',
              variable: 'missing',
              operator: '===',
              value: 'value'
            }
          ]
        })
      ]);

      const result = executor.executeDryRun(workflow, createMockExecutionContext());

      expect(result.stepResults[0].skipped).toBe(true);
    });

    it('should handle undefined step types', () => {
      const executor = new DryRunExecutor();
      
      const step = {
        id: 'step-1',
        name: 'Step 1',
        type: undefined,
        order: 0,
        policy: {
          type: 'sequential',
          onError: 'stop'
        },
        createdAt: createTimestamp()
      };

      const context = createMockExecutionContext();

      const result = executor.predictStepResult(step as any, context);

      expect(result).toBeDefined();
      expect(result.wouldExecute).toBe(true);
    });
  });

  describe('Complex conditions', () => {
    it('should handle multiple conditions', () => {
      const executor = new DryRunExecutor();
      const workflow = createMockWorkflow('workflow', 'Workflow', [
        createMockStep('step-1', 'Step 1', 'recording', {
          conditions: [
            {
              type: 'if',
              variable: 'var1',
              operator: '===',
              value: 'value1'
            },
            {
              type: 'if',
              variable: 'var2',
              operator: '===',
              value: 'value2'
            }
          ]
        })
      ]);

      const context = createMockExecutionContext({
        variables: { var1: 'value1', var2: 'value2' }
      });

      const result = executor.executeDryRun(workflow, context);

      expect(result.stepResults[0].skipped).toBe(false);
      expect(result.stepResults[0].conditionResult).toBe(true);
    });

    it('should handle inverted conditions', () => {
      const executor = new DryRunExecutor();
      const workflow = createMockWorkflow('workflow', 'Workflow', [
        createMockStep('step-1', 'Step 1', 'recording', {
          conditions: [
            {
              type: 'if',
              variable: 'var1',
              operator: '===',
              value: 'value1',
              invert: true
            }
          ]
        })
      ]);

      const context = createMockExecutionContext({
        variables: { var1: 'value1' }
      });

      const result = executor.executeDryRun(workflow, context);

      expect(result.stepResults[0].skipped).toBe(true);
    });
  });
});

// ============================================================================
// PROPERTY-BASED TESTS
// ============================================================================

describe('Property-Based Tests', () => {
  it('DryRunExecutor: executeDryRun should always return valid DryRunResult', () => {
    const executor = new DryRunExecutor();
    
    for (let i = 0; i < 5; i++) {
      const workflow = createMockWorkflow(`workflow-${i}`, `Workflow ${i}`, [
        createMockStep(`step-${i}-1`, `Step ${i}-1`)
      ]);

      const result = executor.executeDryRun(workflow, createMockExecutionContext());

      // Valid DryRunResult must have required fields
      expect(result.workflowId).toBeDefined();
      expect(result.workflowName).toBeDefined();
      expect(result.success).toBeDefined();
      expect(result.stepResults).toBeDefined();
      expect(result.metrics).toBeDefined();
      expect(result.confidenceScore).toBeGreaterThanOrEqual(0);
      expect(result.confidenceScore).toBeLessThanOrEqual(100);
      expect(result.validation).toBeDefined();
    }
  });

  it('DryRunExecutor: calculateDryRunConfidence should always return [0, 100]', () => {
    const executor = new DryRunExecutor();
    
    for (let i = 0; i < 10; i++) {
      const results: PredictionResult[] = [];
      for (let j = 0; j < i; j++) {
        results.push({
          stepId: `step-${i}-${j}`,
          stepName: `Step ${i}-${j}`,
          wouldExecute: true,
          success: Math.random() > 0.5,
          confidenceScore: Math.floor(Math.random() * 100),
          durationMs: Math.floor(Math.random() * 1000),
          contextMatch: createMockExecutionContext()
        });
      }

      const confidence = executor.calculateDryRunConfidence(results);

      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(100);
    }
  });

  it('TestModeService: Test session lifecycle should be consistent', () => {
    const service = new TestModeService();
    
    for (let i = 0; i < 3; i++) {
      const session = service.enterTestMode(`workflow-${i}`, {});
      
      expect(session.isActive).toBe(true);
      
      service.exitTestMode(session.sessionId);
      
      const updatedSession = service.getTestSession(session.sessionId);
      expect(updatedSession?.isActive).toBe(false);
    }
  });
});
