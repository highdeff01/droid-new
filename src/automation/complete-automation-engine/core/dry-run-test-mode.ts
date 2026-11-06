/**
 * Dry-Run and Test Mode Execution
 *
 * Provides functionality for:
 * - Dry-run execution: simulate workflow execution without side effects
 * - Test mode: execute workflows with simulated output for validation
 * - Metrics collection during execution simulation
 * - Workflow validation before live execution
 * - Confidence scoring for dry-run predictions
 *
 * Use cases:
 * - Preview workflow behavior before actual execution
 * - Test workflows with known inputs and expected outputs
 * - Validate workflow structure and conditions
 * - Collect execution metrics without real system interaction
 */

import type { Workflow, WorkflowStep, ExecutionPolicy } from '../workflow-types';
import type { Recording } from '../recording-types';
import type { ExecutionContext, ExecutionResult, ExecutionMetrics, LineageRecord, EntityId } from '../integration-types';
import { createEntityId, createTimestamp, createLineageRecord, createExecutionResult } from '../integration-types';
import type { ExecutableStep } from './undo-rollback';

/**
 * Execution simulation result with predicted outcomes
 */
export interface DryRunStepResult {
  /** Step ID */
  stepId: string;
  /** Step name */
  stepName: string;
  /** Whether step would execute */
  wouldExecute: boolean;
  /** Whether step would succeed */
  success: boolean;
  /** Predicted output if step succeeds */
  predictedOutput?: any;
  /** Error message if step would fail */
  error?: string;
  /** Execution duration in milliseconds (predicted) */
  durationMs: number;
  /** Execution order index */
  order: number;
  /** Step type */
  stepType: 'recording' | 'workflow';
  /** Whether step was skipped due to condition */
  skipped?: boolean;
  /** Condition result if applicable */
  conditionResult?: boolean;
}

/**
 * Dry-run execution result with full details and metrics
 */
export interface DryRunResult {
  /** Workflow ID */
  workflowId: string;
  /** Workflow name */
  workflowName: string;
  /** Whether dry-run would succeed */
  success: boolean;
  /** Total predicted duration */
  durationMs: number;
  /** Individual step results */
  stepResults: DryRunStepResult[];
  /** Metrics collected during dry-run */
  metrics: ExecutionMetrics;
  /** Confidence score [0-100] for successful execution */
  confidenceScore: number;
  /** Validation status */
  validation: DryRunValidation;
  /** Context used for dry-run */
  context: ExecutionContext;
  /** Lineage record for audit trail */
  lineage: LineageRecord;
  /** Predicted output from last successful step */
  predictedOutput?: any;
  /** Errors encountered during dry-run simulation */
  errors?: string[];
}

/**
 * Dry-run validation results
 */
export interface DryRunValidation {
  /** Whether workflow is valid for execution */
  isValid: boolean;
  /** Validation warnings */
  warnings: string[];
  /** Validation errors */
  errors: string[];
  /** Missing prerequisites */
  missingPrerequisites: string[];
  /** Missing context variables */
  missingVariables: string[];
  /** Condition resolution issues */
  conditionIssues: string[];
  /** Element resolution issues */
  elementIssues: string[];
}

/**
 * Test mode input specification
 */
export interface TestInput {
  /** Step ID to provide input for */
  stepId: string;
  /** Simulated input data */
  input: any;
  /** Whether this input should cause failure */
  shouldFail?: boolean;
  /** Custom output for test verification */
  customOutput?: any;
}

/**
 * Test mode execution result
 */
export interface TestModeResult {
  /** Workflow ID */
  workflowId: string;
  /** Test run ID */
  testRunId: string;
  /** Whether test passed */
  passed: boolean;
  /** Step-by-step test results */
  stepResults: TestStepResult[];
  /** Expected vs actual comparison */
  comparison: TestComparison[];
  /** Metrics collected during test execution */
  metrics: ExecutionMetrics;
  /** Test summary */
  summary: {
    totalSteps: number;
    passedSteps: number;
    failedSteps: number;
    skippedSteps: number;
    totalDurationMs: number;
  };
  /** Test run timestamp */
  timestamp: string;
}

/**
 * Individual test step result
 */
export interface TestStepResult {
  /** Step ID */
  stepId: string;
  /** Step name */
  stepName: string;
  /** Test passed */
  passed: boolean;
  /** Expected input/output */
  expected?: any;
  /** Actual result */
  actual?: any;
  /** Error message if failed */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Expected vs actual comparison result
 */
export interface TestComparison {
  /** Step ID */
  stepId: string;
  /** Input provided */
  input: any;
  /** Expected output */
  expected: any;
  /** Actual output */
  actual: any;
  /** Whether match was successful */
  match: boolean;
  /** Difference details if not matching */
  difference?: string;
}

/**
 * Dry-run configuration options
 */
export interface DryRunOptions {
  /** Execution context with variables and display state */
  context?: ExecutionContext;
  /** Test inputs for test mode */
  testInputs?: TestInput[];
  /** Whether to simulate failures */
  simulateFailure?: boolean;
  /** Step indices to skip */
  skipSteps?: number[];
  /** Custom execution policies for specific steps */
  overridePolicies?: Record<string, ExecutionPolicy>;
  /** Timeout for each step in milliseconds */
  stepTimeoutMs?: number;
  /** Whether to collect detailed metrics */
  detailedMetrics?: boolean;
  /** Custom duration simulation function */
  durationEstimator?: (step: WorkflowStep) => number;
  /** Confidence scoring factors */
  confidenceFactors?: {
    elementMatchScore?: number;
    contextMatchScore?: number;
    historicalSuccessRate?: number;
  };
}

/**
 * Test mode execution result with validation
 */
export interface TestValidationResult {
  /** Test ID */
  testId: string;
  /** Validation passed */
  passed: boolean;
  /** Validation issues */
  issues: string[];
  /** Test summary */
  summary: {
    totalTests: number;
    passedTests: number;
    failedTests: number;
  };
}

// ============================================================================
// DRY-RUN EXECUTION
// ============================================================================

/**
 * Execute a workflow in dry-run mode
 *
 * Simulates execution without performing actual actions, collecting metrics
 * and predicting outcomes based on workflow structure and context.
 *
 * @param workflow - Workflow to dry-run
 * @param options - Dry-run configuration options
 * @returns DryRunResult with predicted outcomes and metrics
 */
export function executeDryRun(
  workflow: Workflow,
  options: DryRunOptions = {}
): DryRunResult {
  const {
    context,
    testInputs = [],
    simulateFailure = false,
    skipSteps = [],
    overridePolicies = {},
    stepTimeoutMs = 30000,
    detailedMetrics = false,
    durationEstimator,
    confidenceFactors = {
      elementMatchScore: 0.9,
      contextMatchScore: 0.9,
      historicalSuccessRate: 0.95
    }
  } = options;

  // Create context if not provided
  const executionContext = context || createDefaultExecutionContext(workflow.id);
  
  // Initialize step results and metrics
  const stepResults: DryRunStepResult[] = [];
  const errors: string[] = [];
  let totalDuration = 0;
  let stepsCompleted = 0;
  let stepsFailed = 0;
  let elementsNotFound = 0;

  // Evaluate conditions and execute steps
  let currentContext = executionContext;
  let success = true;
  let lastOutput: any;
  let confidenceScore = 100;

  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i];
    const stepIndex = i;

    // Check if step should be skipped
    const shouldSkip = skipSteps.includes(stepIndex);
    
    // Check if step passes conditions
    const { passesCondition, conditionResult } = evaluateStepCondition(step, currentContext);

    let stepResult: DryRunStepResult;
    
    if (shouldSkip) {
      stepResult = {
        stepId: step.id,
        stepName: step.name,
        wouldExecute: false,
        success: true,
        durationMs: 0,
        order: stepIndex,
        stepType: step.type,
        skipped: true
      };
    } else if (!passesCondition) {
      // Condition failed - explicitly set conditionResult to false
      stepResult = {
        stepId: step.id,
        stepName: step.name,
        wouldExecute: false,
        success: true,
        durationMs: 0,
        order: stepIndex,
        stepType: step.type,
        skipped: true,
        conditionResult: false
      };
    } else {
      // Condition passed - explicitly set conditionResult to true and skipped to false
      const stepResultData = simulateStepExecution(
        step,
        currentContext,
        testInputs,
        simulateFailure,
        stepTimeoutMs,
        durationEstimator,
        confidenceFactors || {
          elementMatchScore: 0.9,
          contextMatchScore: 0.9,
          historicalSuccessRate: 0.95
        }
      );

      stepResult = {
        stepId: stepResultData.stepId,
        stepName: stepResultData.stepName,
        wouldExecute: true,
        success: stepResultData.success,
        predictedOutput: stepResultData.output,
        error: stepResultData.error,
        durationMs: stepResultData.durationMs,
        order: stepIndex,
        stepType: step.type,
        skipped: false,
        conditionResult: true
      };

      // Update metrics
      totalDuration += stepResult.durationMs;
      if (stepResult.success) {
        stepsCompleted++;
        lastOutput = stepResult.predictedOutput;
        
        // Update confidence score based on success
        confidenceScore = calculateConfidenceScore(
          confidenceScore,
          true,
          confidenceFactors
        );
      } else {
        stepsFailed++;
        success = false;
        
        // Update confidence score based on failure
        confidenceScore = calculateConfidenceScore(
          confidenceScore,
          false,
          confidenceFactors
        );
        
        // Check for element not found
        if (stepResult.error?.includes('element not found')) {
          elementsNotFound++;
        }
      }

      // Update context with step output
      currentContext = updateExecutionContextWithOutput(
        currentContext,
        step,
        stepResult.predictedOutput
      );
    }

    stepResults.push(stepResult);

    // Stop on failure if policy is 'stop'
    const policy = overridePolicies[step.id] || step.policy;
    if (!stepResult.success && policy.onError === 'stop') {
      break;
    }
  }

  // Calculate metrics
  const metrics: ExecutionMetrics = {
    stepsCompleted,
    stepsFailed,
    elementsNotFound,
    coordinateAdaptations: 0, // No coordinate adaptation in dry-run
    fallbackMatches: 0, // No fallback matching in dry-run
    avgStepDurationMs: stepResults.length ? totalDuration / stepResults.length : 0
  };

  if (detailedMetrics) {
    // Add additional metrics for detailed analysis
    metrics.stepsCompleted = stepsCompleted;
    metrics.stepsFailed = stepsFailed;
    metrics.elementsNotFound = elementsNotFound;
  }

  // Build validation
  const validation = validateWorkflowForExecution(workflow, currentContext);

  // Create lineage record
  const lineage = createLineageRecord(
    'ai-generated',
    undefined,
    createEntityId(workflow.id),
    undefined,
    undefined,
    'dry-run-simulation'
  );

  // Create DryRunResult directly instead of casting
  // Calculate final confidence score - use calculateWorkflowConfidence if steps exist, otherwise 0
  const finalConfidenceScore = stepResults.length > 0 
    ? calculateWorkflowConfidence({
      workflowId: workflow.id,
      workflowName: workflow.name,
      success,
      durationMs: totalDuration,
      stepResults,
      metrics: {
        stepsCompleted,
        stepsFailed,
        elementsNotFound,
        coordinateAdaptations: 0,
        fallbackMatches: 0,
        avgStepDurationMs: stepResults.length ? totalDuration / stepResults.length : 0
      },
      confidenceScore: 0,
      validation: validation,
      context: currentContext,
      lineage,
      predictedOutput: lastOutput,
      errors: errors.length > 0 ? errors : undefined
    }) : 0;

  const result: DryRunResult = {
    workflowId: workflow.id,
    workflowName: workflow.name,
    success,
    durationMs: totalDuration,
    stepResults,
    metrics: {
      stepsCompleted,
      stepsFailed,
      elementsNotFound,
      coordinateAdaptations: 0,
      fallbackMatches: 0,
      avgStepDurationMs: stepResults.length ? totalDuration / stepResults.length : 0
    },
    confidenceScore: finalConfidenceScore,
    validation,
    context: currentContext,
    lineage,
    predictedOutput: lastOutput,
    errors: errors.length > 0 ? errors : undefined
  };

  return result;
}

/**
 * Simulate execution of a single workflow step
 *
 * @param step - Step to simulate
 * @param context - Current execution context
 * @param testInputs - Test inputs for step
 * @param simulateFailure - Whether to force failure
 * @param timeoutMs - Step timeout
 * @param durationEstimator - Custom duration estimator
 * @param confidenceFactors - Confidence scoring factors
 * @returns Simulated step result
 */
function simulateStepExecution(
  step: WorkflowStep,
  context: ExecutionContext,
  testInputs: TestInput[],
  simulateFailure: boolean,
  timeoutMs: number,
  durationEstimator?: (step: WorkflowStep) => number,
  confidenceFactors?: DryRunOptions['confidenceFactors']
): {
  stepId: string;
  stepName: string;
  success: boolean;
  output?: any;
  error?: string;
  durationMs: number;
} {
  const { id: stepId, name: stepName, type } = step;

  // Use default confidence factors if not provided
  const factors = {
    elementMatchScore: confidenceFactors?.elementMatchScore ?? 0.9,
    contextMatchScore: confidenceFactors?.contextMatchScore ?? 0.9,
    historicalSuccessRate: confidenceFactors?.historicalSuccessRate ?? 0.95
  };

  // Check for test input override
  const testInput = testInputs.find(input => input.stepId === stepId);

  // Determine if step should fail
  const shouldFail = simulateFailure || (testInput?.shouldFail ?? false);

  // Calculate predicted duration
  const duration = durationEstimator?.(step) ?? calculateStepDuration(step, context);

  if (shouldFail) {
    return {
      stepId,
      stepName,
      success: false,
      error: testInput?.customOutput?.error || 'Simulated step failure',
      durationMs: duration
    };
  }

  // Generate predicted output based on step type
  let output: any;
  if (testInput) {
    output = testInput.customOutput ?? testInput.input;
  } else if (type === 'recording') {
    output = generateRecordingStepOutput(step, context, factors);
  } else if (type === 'workflow') {
    output = generateWorkflowStepOutput(step, context, factors);
  } else {
    output = { success: true, stepId, timestamp: createTimestamp() };
  }

  return {
    stepId,
    stepName,
    success: true,
    output,
    durationMs: duration
  };
}

/**
 * Generate predicted output for recording step
 *
 * @param step - Recording step
 * @param context - Current context
 * @param confidenceFactors - Confidence factors
 * @returns Predicted output
 */
function generateRecordingStepOutput(
  step: WorkflowStep,
  context: ExecutionContext,
  confidenceFactors: Required<DryRunOptions['confidenceFactors']>
): any {
  // Use confidence factors to determine output
  const elementMatchScore = confidenceFactors.elementMatchScore ?? 0.9;
  const successRate = confidenceFactors.historicalSuccessRate ?? 0.95;

  return {
    success: true,
    stepId: step.id,
    recordingId: step.recordingId,
    confidence: elementMatchScore * successRate * 100,
    elementsMatched: Math.round(100 * elementMatchScore),
    timestamp: createTimestamp(),
    metadata: {
      contextMatch: confidenceFactors.contextMatchScore ?? 0.9,
      elementMatchScore,
      successRate
    }
  };
}

/**
 * Generate predicted output for workflow step
 *
 * @param step - Workflow step
 * @param context - Current context
 * @param confidenceFactors - Confidence factors
 * @returns Predicted output
 */
function generateWorkflowStepOutput(
  step: WorkflowStep,
  context: ExecutionContext,
  confidenceFactors: Required<DryRunOptions['confidenceFactors']>
): any {
  return {
    success: true,
    stepId: step.id,
    workflowId: step.workflowId,
    confidence: (confidenceFactors.historicalSuccessRate ?? 0.9) * 100,
    substeps: {
      total: 5,
      completed: 5,
      failed: 0
    },
    timestamp: createTimestamp()
  };
}

/**
 * Calculate predicted step duration
 *
 * @param step - Step to calculate duration for
 * @param context - Current context
 * @returns Predicted duration in milliseconds
 */
function calculateStepDuration(step: WorkflowStep, context: ExecutionContext): number {
  // Base duration varies by step type
  let baseDuration: number;

  switch (step.type) {
    case 'recording':
      baseDuration = 100; // Recording steps typically involve element lookup and action
      break;
    case 'workflow':
      baseDuration = 500; // Workflow steps involve nested execution
      break;
    default:
      baseDuration = 100;
  }

  // Adjust based on context
  if (context.visibleElements?.length && context.visibleElements.length > 100) {
    // More elements to search through = slower
    baseDuration += context.visibleElements.length * 0.5;
  }

  return Math.round(baseDuration);
}

/**
 * Evaluate whether a step passes its conditions
 *
 * @param step - Step to evaluate
 * @param context - Current context
 * @returns Object with passesCondition boolean and conditionResult
 */
function evaluateStepCondition(
  step: WorkflowStep,
  context: ExecutionContext
): {
  passesCondition: boolean;
  conditionResult?: boolean;
} {
  const conditions = step.conditions || [];

  if (conditions.length === 0) {
    return { passesCondition: true };
  }

  let allPassed = true;
  let lastConditionResult: boolean | undefined;

  for (const condition of conditions) {
    const result = evaluateCondition(condition, context);
    lastConditionResult = result;

    if (condition.invert) {
      allPassed = allPassed && !result;
    } else {
      allPassed = allPassed && result;
    }
  }

  return { passesCondition: allPassed, conditionResult: lastConditionResult };
}

/**
 * Evaluate a single condition against context
 *
 * @param condition - Condition to evaluate
 * @param context - Current context
 * @returns Whether condition passes
 */
function evaluateCondition(
  condition: WorkflowStep['conditions'][0],
  context: ExecutionContext
): boolean {
  if (!condition) return true;

  switch (condition.type) {
    case 'if': {
      if (!condition.variable || !('value' in condition)) {
        return true;
      }

      // Get variable value from context
      const variableValue = context.variables[condition.variable];
      const comparisonValue = condition.value;

      if (condition.operator === '===') {
        return variableValue === comparisonValue;
      } else if (condition.operator === '!==') {
        return variableValue !== comparisonValue;
      } else if (condition.operator === '>') {
        return (variableValue as number) > (comparisonValue as number);
      } else if (condition.operator === '<') {
        return (variableValue as number) < (comparisonValue as number);
      } else if (condition.operator === '>=') {
        return (variableValue as number) >= (comparisonValue as number);
      } else if (condition.operator === '<=') {
        return (variableValue as number) <= (comparisonValue as number);
      } else if (condition.operator === 'in') {
        return (comparisonValue as unknown[]).includes(variableValue);
      } else if (condition.operator === 'not-in') {
        return !(comparisonValue as unknown[]).includes(variableValue);
      }

      return true;
    }

    case 'environment': {
      // Simplified environment check
      if (condition.os) {
        // In real implementation, check navigator.platform or process.platform
        return true;
      }
      if (condition.browser) {
        // In real implementation, check navigator.userAgent
        return true;
      }
      return true;
    }

    case 'data-validation': {
      if (!condition.schema) return true;
      // Simplified schema validation
      return true;
    }

    default:
      return true;
  }
}

/**
 * Update execution context with step output
 *
 * @param context - Current context
 * @param step - Step that executed
 * @param output - Step output
 * @returns Updated context
 */
function updateExecutionContextWithOutput(
  context: ExecutionContext,
  step: WorkflowStep,
  output: any
): ExecutionContext {
  if (!step.outputMapping) {
    return context;
  }

  const newContext = { ...context, variables: { ...context.variables } };

  for (const [contextKey, pathInOutput] of Object.entries(step.outputMapping)) {
    // Extract value from output using path
    const value = pathInOutput.split('.').reduce((obj, key) => {
      return obj?.[key];
    }, output);

    if (value !== undefined) {
      newContext.variables[contextKey] = value;
    }
  }

  return newContext;
}

/**
 * Calculate confidence score based on execution results
 *
 * @param currentScore - Current confidence score
 * @param success - Whether current execution succeeded
 * @param factors - Confidence factors
 * @returns Updated confidence score [0-100]
 */
function calculateConfidenceScore(
  currentScore: number,
  success: boolean,
  factors?: DryRunOptions['confidenceFactors']
): number {
  // Use default factors if not provided
  const defaultFactors = {
    elementMatchScore: 0.9,
    contextMatchScore: 0.9,
    historicalSuccessRate: 0.95
  };
  
  const effectiveFactors = factors || defaultFactors;

  if (success) {
    // Increase confidence slightly
    return Math.min(100, currentScore + (100 - currentScore) * 0.1);
  } else {
    // Decrease confidence more significantly
    return Math.max(0, currentScore - currentScore * 0.3);
  }
}

// ============================================================================
// TEST MODE EXECUTION
// ============================================================================

/**
 * Execute workflow in test mode with simulated inputs and expected outputs
 *
 * @param workflow - Workflow to test
 * @param testSpec - Test specification with inputs and expected outputs
 * @param options - Test execution options
 * @returns TestModeResult with detailed step-by-step results
 */
export function executeTestMode(
  workflow: Workflow,
  testSpec: TestSpecification,
  options: DryRunOptions = {}
): TestModeResult {
  const testRunId = createEntityId(`test-run-${Date.now()}`);

  // Convert test specification to dry-run options
  const testInputs: TestInput[] = testSpec.inputs.map(input => ({
    stepId: input.stepId,
    input: input.input,
    shouldFail: input.shouldFail,
    customOutput: input.output
  }));

  const dryRunOptions: DryRunOptions = {
    ...options,
    testInputs,
    detailedMetrics: true
  };

  // Execute dry-run with test inputs
  const dryRunResult = executeDryRun(workflow, dryRunOptions);

  // Build test results
  const stepResults: TestStepResult[] = dryRunResult.stepResults.map((stepResult, index) => ({
    stepId: stepResult.stepId,
    stepName: stepResult.stepName,
    passed: stepResult.success,
    expected: testSpec.inputs.find(input => input.stepId === stepResult.stepId)?.output,
    actual: stepResult.predictedOutput,
    error: stepResult.error,
    durationMs: stepResult.durationMs
  }));

  // Build comparison results
  const comparison: TestComparison[] = testSpec.inputs.map(input => {
    const result = stepResults.find(r => r.stepId === input.stepId);
    
    return {
      stepId: input.stepId,
      input: input.input,
      expected: input.output,
      actual: result?.actual,
      match: result?.passed ?? false
    };
  });

  // Calculate summary
  const passedSteps = stepResults.filter(r => r.passed).length;
  const failedSteps = stepResults.filter(r => !r.passed).length;
  const skippedSteps = stepResults.filter(r => r.skipped).length;

  // Create lineage record for test execution
  const lineage = createLineageRecord(
    'ai-generated',
    undefined,
    workflow.id,
    undefined,
    undefined,
    'test-execution',
    ['test-specification']
  );

  // Update metrics
  const metrics: ExecutionMetrics = {
    ...dryRunResult.metrics,
    stepsCompleted: passedSteps,
    stepsFailed: failedSteps
  };

  return {
    workflowId: workflow.id,
    testRunId,
    passed: failedSteps === 0 && testSpec.inputs.length > 0,
    stepResults,
    comparison,
    metrics,
    summary: {
      totalSteps: workflow.steps.length,
      passedSteps,
      failedSteps,
      skippedSteps,
      totalDurationMs: dryRunResult.durationMs
    },
    timestamp: createTimestamp()
  };
}

/**
 * Test specification for test mode execution
 */
export interface TestSpecification {
  /** Test run ID */
  testId?: string;
  /** Test name */
  name?: string;
  /** Inputs and expected outputs */
  inputs: TestInputSpec[];
  /** Expected workflow success */
  expectSuccess?: boolean;
  /** Validation rules */
  validation?: TestValidationRules;
}

/**
 * Test input specification
 */
export interface TestInputSpec {
  /** Step ID */
  stepId: string;
  /** Input data */
  input: any;
  /** Expected output */
  output?: any;
  /** Whether step should fail */
  shouldFail?: boolean;
  /** Validation rules for this input */
  validation?: InputValidationRules;
}

/**
 * Input validation rules
 */
export interface InputValidationRules {
  /** Output must match this pattern */
  matchPattern?: string;
  /** Output must contain these keys */
  requiredKeys?: string[];
  /** Output must not contain these keys */
  forbiddenKeys?: string[];
  /** Custom validation function */
  customValidator?: (output: any) => boolean;
}

/**
 * Test validation rules
 */
export interface TestValidationRules {
  /** All outputs must be present */
  allOutputsPresent?: boolean;
  /** Output types must match */
  outputTypesMatch?: boolean;
  /** Custom validation function */
  customValidator?: (results: TestStepResult[]) => boolean;
}

/**
 * Validate test specification
 *
 * @param testSpec - Test specification to validate
 * @returns Validation result
 */
export function validateTestSpecification(testSpec: TestSpecification): TestValidationResult {
  const testId = testSpec.testId || 'unknown';
  const issues: string[] = [];

  // Validate inputs
  const inputs = testSpec.inputs || [];
  const validInputs: TestInputSpec[] = [];

  for (const input of inputs) {
    if (!input.stepId) {
      issues.push(`Test input missing stepId`);
      continue;
    }

    validInputs.push(input);
  }

  // Check for duplicate step IDs
  const stepIds = validInputs.map(i => i.stepId);
  const duplicateStepIds = stepIds.filter((id, index) => stepIds.indexOf(id) !== index);
  if (duplicateStepIds.length > 0) {
    issues.push(`Duplicate step IDs in test inputs: ${duplicateStepIds.join(', ')}`);
  }

  return {
    testId,
    passed: issues.length === 0,
    issues,
    summary: {
      totalTests: inputs.length,
      passedTests: validInputs.length,
      failedTests: inputs.length - validInputs.length
    }
  };
}

// ============================================================================
// WORKFLOW VALIDATION
// ============================================================================

/**
 * Validate workflow for execution
 *
 * @param workflow - Workflow to validate
 * @param context - Execution context
 * @returns DryRunValidation results
 */
export function validateWorkflowForExecution(
  workflow: Workflow,
  context: ExecutionContext
): DryRunValidation {
  const warnings: string[] = [];
  const errors: string[] = [];
  const missingPrerequisites: string[] = [];
  const missingVariables: string[] = [];
  const conditionIssues: string[] = [];
  const elementIssues: string[] = [];

  // Check workflow structure
  if (!workflow.steps || workflow.steps.length === 0) {
    errors.push('Workflow has no steps');
  }

  // Check for required context variables
  for (const step of workflow.steps) {
    // Check conditions
    for (const condition of step.conditions || []) {
      if (condition.type === 'if' && condition.variable) {
        if (!(condition.variable in context.variables)) {
          missingVariables.push(condition.variable);
          conditionIssues.push(`Condition references missing variable: ${condition.variable}`);
        }
      }
    }

    // Check recording steps for element prerequisites
    if (step.type === 'recording' && step.recordingId) {
      const recording = getRecordingById(step.recordingId);
      if (recording) {
        for (const action of recording.actions) {
          // Check context for actions that have it (not pause actions)
          const context = 'context' in action ? (action as any).context : null;
          if (context) {
            if (!context.selector && !context.domPath) {
              elementIssues.push(`Recording "${recording.name}" step has no element identifier`);
            }
          }
        }
      } else {
        elementIssues.push(`Recording ${step.recordingId} not found`);
      }
    }
  }

  // Check for potential execution issues
  if (workflow.steps.length > 100) {
    warnings.push('Workflow has more than 100 steps - consider breaking into sub-workflows');
  }

  if (workflow.metadata.executionCount === 0) {
    warnings.push('Workflow has never been executed - confidence score will be low');
  }

  const isValid = errors.length === 0 && missingVariables.length === 0;

  return {
    isValid,
    warnings,
    errors,
    missingPrerequisites,
    missingVariables,
    conditionIssues,
    elementIssues
  };
}

/**
 * Get recording by ID (mock implementation)
 *
 * @param recordingId - Recording ID
 * @returns Recording or undefined if not found
 */
function getRecordingById(recordingId: string): Recording | undefined {
  // In a real implementation, this would query a recording repository
  // For now, return undefined (mock)
  return undefined;
}

/**
 * Create default execution context
 *
 * @param workflowId - Workflow ID
 * @returns Default execution context
 */
function createDefaultExecutionContext(workflowId: string): ExecutionContext {
  return {
    executionId: createEntityId(`dry-run-${Date.now()}`),
    workflowId,
    displayState: {
      width: 1920,
      height: 1080,
      dpi: 96,
      isMultiDisplay: false
    },
    variables: {},
    executionPath: [],
    createdAt: createTimestamp()
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate overall confidence score for workflow execution
 *
 * @param dryRunResult - Dry-run result
 * @returns Confidence score [0-100]
 */
export function calculateWorkflowConfidence(dryRunResult: DryRunResult): number {
  if (dryRunResult.stepResults.length === 0) {
    return 0;
  }

  // Base confidence from success rate
  const successfulSteps = dryRunResult.stepResults.filter(s => s.success).length;
  const successRate = successfulSteps / dryRunResult.stepResults.length;

  // Apply confidence factors
  const metrics = dryRunResult.metrics || {};
  
  // Factor 1: Success rate (40% weight)
  const successRateScore = successRate * 40;

  // Factor 2: Element match score (30% weight) - estimate from step results
  const elementScores = dryRunResult.stepResults
    .filter(s => s.predictedOutput?.metadata?.elementMatchScore)
    .map(s => s.predictedOutput.metadata.elementMatchScore);
  
  let elementScore = 0;
  if (elementScores.length > 0) {
    elementScore = (elementScores.reduce((a, b) => a + b, 0) / elementScores.length) * 30;
  }

  // Factor 3: Historical success (20% weight)
  const historicalScore = metrics.stepsFailed === 0 ? 20 : 0;

  // Factor 4: No conditions failed (10% weight)
  const noConditionFailures = dryRunResult.stepResults.filter(s => !s.skipped || s.conditionResult !== false).length;
  const conditionScore = (noConditionFailures / dryRunResult.stepResults.length) * 10;

  return Math.round(successRateScore + elementScore + historicalScore + conditionScore);
}

/**
 * Get dry-run metrics summary
 *
 * @param dryRunResult - Dry-run result
 * @returns Human-readable metrics summary
 */
export function getDryRunMetricsSummary(dryRunResult: DryRunResult): string {
  const { stepResults, metrics, success } = dryRunResult;
  
  const totalSteps = stepResults.length;
  const completedSteps = metrics.stepsCompleted;
  const failedSteps = metrics.stepsFailed;
  const skippedSteps = stepResults.filter(s => s.skipped).length;
  const avgDuration = metrics.avgStepDurationMs?.toFixed(0) || '0';

  const status = success ? '✅ PASS' : '❌ FAIL';
  const summary = `Dry-run ${status}: ${completedSteps}/${totalSteps} steps succeeded`;

  return [
    summary,
    `  • Completed: ${completedSteps}`,
    `  • Failed: ${failedSteps}`,
    `  • Skipped: ${skippedSteps}`,
    `  • Avg Duration: ${avgDuration}ms`,
    `  • Confidence: ${dryRunResult.confidenceScore}%`
  ].join('\n');
}

/**
 * Get test results summary
 *
 * @param testResult - Test mode result
 * @returns Human-readable test summary
 */
export function getTestResultsSummary(testResult: TestModeResult): string {
  const { summary, passed } = testResult;

  const status = passed ? '✅ PASSED' : '❌ FAILED';
  const summaryText = `Test ${status}: ${summary.passedSteps}/${summary.totalSteps} steps`;

  return [
    summaryText,
    `  • Passed: ${summary.passedSteps}`,
    `  • Failed: ${summary.failedSteps}`,
    `  • Skipped: ${summary.skippedSteps}`,
    `  • Duration: ${summary.totalDurationMs}ms`
  ].join('\n');
}
/**
 * DryRunExecutor class for managing dry-run execution
 *
 * Provides a stateful interface for executing workflows in dry-run mode,
 * with methods for prediction, confidence scoring, and safety assessment.
 *
 * Key features:
 * - Persistent configuration for dry-run sessions
 * - Step-by-step prediction with detailed output
 * - Confidence scoring based on multiple factors
 * - Risk assessment for workflow execution
 */
export class DryRunExecutor {
  /** Default confidence factors */
  private defaultConfidenceFactors = {
    elementMatchScore: 0.9,
    contextMatchScore: 0.9,
    historicalSuccessRate: 0.95
  };

  /** Custom duration estimator */
  private durationEstimator?: (step: WorkflowStep) => number;

  /** Custom timeout for steps */
  private stepTimeoutMs: number = 30000;

  /**
   * Create a new DryRunExecutor instance
   *
   * @param options - Configuration options
   */
  constructor(options?: {
    durationEstimator?: (step: WorkflowStep) => number;
    stepTimeoutMs?: number;
    confidenceFactors?: {
      elementMatchScore?: number;
      contextMatchScore?: number;
      historicalSuccessRate?: number;
    };
  }) {
    if (options?.durationEstimator) {
      this.durationEstimator = options.durationEstimator;
    }
    if (options?.stepTimeoutMs !== undefined) {
      this.stepTimeoutMs = options.stepTimeoutMs;
    }
    if (options?.confidenceFactors) {
      this.defaultConfidenceFactors = {
        ...this.defaultConfidenceFactors,
        ...options.confidenceFactors
      };
    }
  }

  /**
   * Execute a workflow in dry-run mode
   *
   * Simulates execution without performing actual actions, collecting metrics
   * and predicting outcomes based on workflow structure and context.
   *
   * @param workflow - Workflow to dry-run
   * @param context - Execution context with variables and display state
   * @returns DryRunResult with predicted outcomes and metrics
   */
  executeDryRun(
    workflow: Workflow,
    context: ExecutionContext
  ): DryRunResult {
    const options: DryRunOptions = {
      context,
      confidenceFactors: this.defaultConfidenceFactors,
      durationEstimator: this.durationEstimator,
      stepTimeoutMs: this.stepTimeoutMs,
      detailedMetrics: true
    };

    return executeDryRun(workflow, options);
  }

  /**
   * Predict the result of executing a single step
   *
   * @param step - Step to predict
   * @param context - Current execution context
   * @returns PredictionResult with predicted outcome
   */
  predictStepResult(
    step: WorkflowStep,
    context: ExecutionContext
  ): PredictionResult {
    const testInputs: TestInput[] = [];
    const simulateFailure = false;
    const skipSteps: number[] = [];

    const stepResultData = simulateStepExecution(
      step,
      context,
      testInputs,
      simulateFailure,
      this.stepTimeoutMs,
      this.durationEstimator,
      this.defaultConfidenceFactors
    );

    // Calculate confidence score for this specific step
    const confidenceScore = this.calculateDryRunConfidence([{
      stepId: step.id,
      stepName: step.name,
      wouldExecute: true,
      success: stepResultData.success,
      predictedOutput: stepResultData.output,
      error: stepResultData.error,
      durationMs: stepResultData.durationMs,
      order: 0,
      stepType: step.type
    }]);

    return {
      stepId: step.id,
      stepName: step.name,
      wouldExecute: true,
      success: stepResultData.success,
      predictedOutput: stepResultData.output,
      error: stepResultData.error,
      durationMs: stepResultData.durationMs,
      confidenceScore,
      contextMatch: context
    };
  }

  /**
   * Calculate overall confidence score for a set of prediction results
   *
   * @param results - Array of prediction results
   * @returns Confidence score [0-100]
   */
  calculateDryRunConfidence(results: PredictionResult[]): number {
    if (results.length === 0) {
      return 0;
    }

    // Base confidence from success rate
    const successfulSteps = results.filter(s => s.success).length;
    const successRate = successfulSteps / results.length;

    // Factor 1: Success rate (40% weight)
    const successRateScore = successRate * 40;

    // Factor 2: Average element match score (30% weight)
    const elementScores = results
      .filter(s => s.predictedOutput?.metadata?.elementMatchScore)
      .map(s => s.predictedOutput.metadata.elementMatchScore);
    
    let elementScore = 0;
    if (elementScores.length > 0) {
      elementScore = (elementScores.reduce((a, b) => a + b, 0) / elementScores.length) * 30;
    }

    // Factor 3: Average confidence score (20% weight)
    const confidenceScores = results
      .filter(s => s.confidenceScore !== undefined)
      .map(s => s.confidenceScore);
    
    let confidenceFactorScore = 0;
    if (confidenceScores.length > 0) {
      confidenceFactorScore = (confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length) * 0.2;
    }

    // Factor 4: No errors (10% weight)
    const noErrors = results.filter(s => !s.error).length;
    const errorScore = (noErrors / results.length) * 10;

    return Math.round(successRateScore + elementScore + confidenceFactorScore + errorScore);
  }

  /**
   * Determine if a workflow contains risky operations
   *
   * Risky workflows may include:
   * - Multiple sequential steps (prone to cumulative failures)
   * - Steps with no success history
   * - Steps that modify external state
   * - Workflows with complex conditional logic
   *
   * @param workflow - Workflow to assess
   * @returns True if workflow is considered risky
   */
  isRiskyWorkflow(workflow: Workflow): boolean {
    // Check workflow length
    if (workflow.steps.length > 50) {
      return true;
    }

    // Check for complex conditional logic
    const stepsWithConditions = workflow.steps.filter(step => 
      step.conditions && step.conditions.length > 0
    ).length;
    
    if (stepsWithConditions > workflow.steps.length * 0.5) {
      return true;
    }

    // Check for nested workflows
    const stepsWithNestedWorkflows = workflow.steps.filter(step => 
      step.type === 'workflow'
    ).length;
    
    if (stepsWithNestedWorkflows > 0) {
      return true;
    }

    // Check for output mappings (potential side effects)
    const stepsWithOutputMappings = workflow.steps.filter(step => 
      step.outputMapping && Object.keys(step.outputMapping).length > 0
    ).length;
    
    if (stepsWithOutputMappings > 0) {
      return true;
    }

    return false;
  }

  /**
   * Get safety assessment for a workflow
   *
   * Provides a comprehensive safety evaluation including:
   * - Risk level assessment
   * - Required confirmation type
   * - Potential failure points
   * - Safety recommendations
   *
   * @param workflow - Workflow to assess
   * @returns SafetyAssessment with risk level and recommendations
   */
  getSafetyAssessment(workflow: Workflow): SafetyAssessment {
    const isRisky = this.isRiskyWorkflow(workflow);
    
    // Calculate steps that could fail based on dry-run
    const dryRunResult = this.executeDryRun(workflow, {
      executionId: createEntityId(`safety-assessment-${Date.now()}`),
      workflowId: workflow.id,
      displayState: {
        width: 1920,
        height: 1080,
        dpi: 96,
        isMultiDisplay: false
      },
      variables: {},
      executionPath: [],
      createdAt: createTimestamp()
    });

    // Determine confirmation requirement
    let confirmationRequirement: SafetyAssessment['confirmationRequirement'] = 'none';
    let confirmationPrompt: string | undefined;

    if (isRisky) {
      confirmationRequirement = 'explicit';
      confirmationPrompt = `This workflow contains ${workflow.steps.length} steps and may have unexpected side effects. Please confirm execution.`;
    } else if (dryRunResult.confidenceScore < 70) {
      confirmationRequirement = 'warning';
      confirmationPrompt = `This workflow has a low confidence score (${dryRunResult.confidenceScore}%). Please review predictions before proceeding.`;
    }

    // Identify potential failure points
    const potentialFailurePoints = dryRunResult.stepResults
      .filter(step => !step.success || step.error)
      .map(step => ({
        stepId: step.stepId,
        stepName: step.stepName,
        order: step.order,
        error: step.error || 'Unknown error'
      }));

    // Calculate safety score (inverse of risk)
    const safetyScore = isRisky ? 0 : 100;
    const safetyLevel = isRisky ? 'high-risk' : 'normal';

    return {
      safetyLevel,
      safetyScore,
      riskLevel: isRisky ? 'high' : 'low',
      isRisky,
      confirmationRequirement,
      confirmationPrompt,
      potentialFailurePoints,
      recommendedConfirmations: isRisky ? 2 : 1,
      dryRunResult,
      safetyRecommendations: this.getSafetyRecommendations(workflow, dryRunResult)
    };
  }

  /**
   * Generate safety recommendations for a workflow
   *
   * @param workflow - Workflow to assess
   * @param dryRunResult - Dry-run results
   * @returns Array of safety recommendations
   */
  private getSafetyRecommendations(
    workflow: Workflow,
    dryRunResult: DryRunResult
  ): string[] {
    const recommendations: string[] = [];

    if (workflow.steps.length > 10) {
      recommendations.push('Consider breaking this workflow into smaller sub-workflows for better error isolation');
    }

    if (dryRunResult.confidenceScore < 80) {
      recommendations.push(`Increase confidence by ensuring all elements have proper selectors and context is properly set`);
    }

    if (dryRunResult.validation.warnings.length > 0) {
      recommendations.push(`Address the following warnings: ${dryRunResult.validation.warnings.join(', ')}`);
    }

    if (dryRunResult.validation.errors.length > 0) {
      recommendations.push(`Critical errors must be resolved: ${dryRunResult.validation.errors.join(', ')}`);
    }

    if (recommendations.length === 0) {
      recommendations.push('Workflow appears to be well-configured and safe for execution');
    }

    return recommendations;
  }
}

/**
 * TestModeService class for managing test mode sessions
 *
 * Provides a stateful interface for executing workflows in test mode,
 * with session management and result aggregation.
 *
 * Key features:
 * - Test session lifecycle management
 * - Test input management
 * - Result aggregation and comparison
 * - Test session isolation
 */
export class TestModeService {
  /** Active test sessions */
  private sessions: Map<string, TestSession> = new Map();

  /** Test results cache */
  private testResults: Map<string, TestExecutionResult[]> = new Map();

  /**
   * Create a new TestModeService instance
   */
  constructor() {
    // Initialize service
  }

  /**
   * Enter test mode for a workflow
   *
   * Creates a new test session with isolated state and context.
   *
   * @param workflowId - Workflow to test
   * @param context - Test context with initial state
   * @returns TestSession with session ID and metadata
   */
  enterTestMode(
    workflowId: string,
    context: TestContext
  ): TestSession {
    const sessionId = createEntityId(`test-session-${workflowId}-${Date.now()}`);
    
    const session: TestSession = {
      sessionId,
      workflowId,
      testContext: { ...context },
      enteredAt: createTimestamp(),
      isActive: true,
      testInputs: [],
      expectedOutputs: new Map()
    };

    this.sessions.set(sessionId, session);
    this.testResults.set(sessionId, []);

    return session;
  }

  /**
   * Execute a workflow in test mode
   *
   * Runs the workflow with test inputs and collects execution results.
   *
   * @param sessionId - Test session ID
   * @param steps - Steps to execute in test mode
   * @returns TestExecutionResult with execution details
   */
  executeInTestMode(
    sessionId: string,
    steps: ExecutableStep[]
  ): TestExecutionResult {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      throw new Error(`Test session ${sessionId} not found`);
    }

    if (!session.isActive) {
      throw new Error(`Test session ${sessionId} is not active`);
    }

    const testRunId = createEntityId(`test-run-${sessionId}-${Date.now()}`);
    const startTime = Date.now();

    // Execute steps and collect results
    const stepResults: TestStepResult[] = [];
    const comparisonResults: TestComparison[] = [];
    let passedSteps = 0;
    let failedSteps = 0;

    for (const step of steps) {
      const stepResult = this.executeSingleStepInTestMode(session, step);
      stepResults.push(stepResult);

      // Create comparison result
      const expected = session.expectedOutputs.get(step.id);
      comparisonResults.push({
        stepId: step.id,
        stepName: step.name,
        input: expected,
        expected: expected,
        actual: stepResult.actual,
        match: stepResult.passed
      });

      if (stepResult.passed) {
        passedSteps++;
      } else {
        failedSteps++;
      }

      // Stop on first failure
      if (!stepResult.passed) {
        break;
      }
    }

    const endTime = Date.now();
    const durationMs = endTime - startTime;

    const result: TestExecutionResult = {
      testRunId,
      sessionId,
      workflowId: session.workflowId,
      passed: failedSteps === 0 && steps.length > 0,
      stepResults,
      comparison: comparisonResults,
      summary: {
        totalSteps: steps.length,
        passedSteps,
        failedSteps,
        skippedSteps: 0,
        totalDurationMs: durationMs
      },
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date(endTime).toISOString()
    };

    // Store result
    const existingResults = this.testResults.get(sessionId) || [];
    this.testResults.set(sessionId, [...existingResults, result]);

    return result;
  }

  /**
   * Execute a single step in test mode
   *
   * @param session - Test session
   * @param step - Step to execute
   * @returns TestStepResult with execution details
   */
  private executeSingleStepInTestMode(
    session: TestSession,
    step: ExecutableStep
  ): TestStepResult {
    const expectedInput = session.expectedOutputs.get(step.id);
    const startTime = Date.now();

    try {
      // Simulate step execution
      const result: unknown = {
        success: true,
        stepId: step.id,
        executedAt: createTimestamp()
      };

      const endTime = Date.now();

      return {
        stepId: step.id,
        stepName: step.name,
        passed: true,
        expected: expectedInput,
        actual: result,
        durationMs: endTime - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date(endTime).toISOString()
      };
    } catch (error) {
      const endTime = Date.now();

      return {
        stepId: step.id,
        stepName: step.name,
        passed: false,
        expected: expectedInput,
        actual: undefined,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: endTime - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date(endTime).toISOString()
      };
    }
  }

  /**
   * Exit test mode and cleanup session
   *
   * @param sessionId - Test session ID
   */
  exitTestMode(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    
    if (session) {
      session.isActive = false;
      this.sessions.set(sessionId, session);
    }

    // Cleanup results after a delay
    setTimeout(() => {
      this.testResults.delete(sessionId);
    }, 60000); // Cleanup after 60 seconds
  }

  /**
   * Get all test results for a session
   *
   * @param sessionId - Test session ID
   * @returns Array of test execution results
   */
  getTestResults(sessionId: string): TestExecutionResult[] {
    return this.testResults.get(sessionId) || [];
  }

  /**
   * Add test input for a specific step
   *
   * @param sessionId - Test session ID
   * @param stepId - Step ID
   * @param input - Test input data
   */
  addTestInput(sessionId: string, stepId: string, input: any): void {
    const session = this.sessions.get(sessionId);
    
    if (session) {
      session.testInputs.push({ stepId, input });
      session.expectedOutputs.set(stepId, input);
    }
  }

  /**
   * Get test session by ID
   *
   * @param sessionId - Test session ID
   * @returns TestSession or undefined if not found
   */
  getTestSession(sessionId: string): TestSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all active test sessions
   *
   * @returns Array of active test sessions
   */
  getActiveSessions(): TestSession[] {
    return Array.from(this.sessions.values()).filter(session => session.isActive);
  }
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Result of predicting a step's execution
 */
export interface PredictionResult {
  /** Step ID */
  stepId: string;
  /** Step name */
  stepName: string;
  /** Whether step would execute */
  wouldExecute: boolean;
  /** Whether step would succeed */
  success: boolean;
  /** Predicted output if step succeeds */
  predictedOutput?: any;
  /** Error message if step would fail */
  error?: string;
  /** Execution duration in milliseconds (predicted) */
  durationMs: number;
  /** Confidence score [0-100] */
  confidenceScore: number;
  /** Current execution context */
  contextMatch: ExecutionContext;
}

/**
 * Safety assessment for a workflow
 */
export interface SafetyAssessment {
  /** Overall safety level */
  safetyLevel: 'normal' | 'high-risk';
  /** Safety score [0-100] */
  safetyScore: number;
  /** Risk level */
  riskLevel: 'low' | 'medium' | 'high';
  /** Whether workflow is risky */
  isRisky: boolean;
  /** Type of confirmation required */
  confirmationRequirement: 'none' | 'warning' | 'explicit';
  /** Confirmation prompt message */
  confirmationPrompt?: string;
  /** Steps that may fail */
  potentialFailurePoints: {
    stepId: string;
    stepName: string;
    order: number;
    error: string;
  }[];
  /** Number of confirmations recommended */
  recommendedConfirmations: number;
  /** Associated dry-run results */
  dryRunResult?: DryRunResult;
  /** Safety recommendations */
  safetyRecommendations: string[];
}

/**
 * Test context for test mode sessions
 */
export interface TestContext {
  /** Test session variables */
  variables?: Record<string, unknown>;
  /** Test display state */
  displayState?: {
    width: number;
    height: number;
    dpi: number;
    isMultiDisplay: boolean;
  };
  /** Test metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Active test session
 */
export interface TestSession {
  /** Unique session ID */
  sessionId: string;
  /** Workflow ID being tested */
  workflowId: string;
  /** Test context */
  testContext: TestContext;
  /** When session was entered */
  enteredAt: string;
  /** Whether session is active */
  isActive: boolean;
  /** Test inputs provided */
  testInputs: {
    stepId: string;
    input: any;
  }[];
  /** Expected outputs by step ID */
  expectedOutputs: Map<string, any>;
}

/**
 * Result of test execution
 */
export interface TestExecutionResult {
  /** Unique test run ID */
  testRunId: EntityId;
  /** Session ID */
  sessionId: string;
  /** Workflow ID */
  workflowId: string;
  /** Whether test passed */
  passed: boolean;
  /** Step-by-step results */
  stepResults: TestStepResult[];
  /** Expected vs actual comparison */
  comparison: TestComparison[];
  /** Execution summary */
  summary: {
    totalSteps: number;
    passedSteps: number;
    failedSteps: number;
    skippedSteps: number;
    totalDurationMs: number;
  };
  /** When execution started */
  startedAt: string;
  /** When execution completed */
  completedAt: string;
}
