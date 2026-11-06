/**
 * Conditional Workflows and Branching Support
 *
 * Provides capabilities for:
 * - If-else conditions
 * - Switch-case branching
 * - Nested workflow references
 * - Context-based decision making
 *
 * This extends the core workflow system with advanced conditional execution patterns
 * that allow workflows to adapt based on runtime context and data evaluation.
 */

import type { Workflow, WorkflowStep, StepCondition, ExecutionPolicy } from './workflow-types';

/**
 * Conditional step types supported by the workflow engine
 */
export type ConditionalStepType = 'if' | 'switch' | 'context' | 'nested-workflow';

/**
 * Context evaluation function type
 *
 * @param context - Execution context with variables and state
 * @returns Boolean result of the condition evaluation
 */
export type ContextEvaluator = (context: Record<string, unknown>) => boolean;

/**
 * Switch case definition
 */
export interface SwitchCase {
  /** Unique identifier for this case */
  id: string;
  
  /** Case value(s) that trigger this branch */
  value: unknown | unknown[];
  
  /** Steps to execute when case matches */
  steps: WorkflowStep[];
  
  /** Optional label for this case */
  label?: string;
}

/**
 * Conditional branching configuration
 */
export interface ConditionalBranch {
  /** Unique identifier for this branch */
  id: string;
  
  /** Branch type: 'if', 'switch', or 'context' */
  type: 'if' | 'switch' | 'context';
  
  /** Evaluation logic for the condition */
  condition: StepCondition | ContextEvaluator;
  
  /** Steps to execute if condition is true */
  trueSteps: WorkflowStep[];
  
  /** Optional steps to execute if condition is false */
  falseSteps?: WorkflowStep[];
  
  /** Optional label for this branch */
  label?: string;
  
  /** Optional description of what this branch does */
  description?: string;
}

/**
 * Context-based decision configuration
 */
export interface ContextDecision {
  /** Unique identifier for this decision */
  id: string;
  
  /** Context variables to evaluate */
  contextKeys: string[];
  
  /** Decision logic (returns branch ID to execute) */
  evaluator: ContextEvaluator;
  
  /** Map of branch IDs to their step sequences */
  branches: Record<string, WorkflowStep[]>;
  
  /** Default branch if no condition matches */
  defaultBranch?: WorkflowStep[];
  
  /** Optional label for this decision */
  label?: string;
  
  /** Optional description */
  description?: string;
}

/**
 * Nested workflow reference with conditional execution
 */
export interface NestedWorkflowReference {
  /** Unique identifier for this reference */
  id: string;
  
  /** ID of the nested workflow to execute */
  workflowId: string;
  
  /** Context mapping from parent to nested workflow */
  contextMapping?: Record<string, string>;
  
  /** Conditions that must be met before executing nested workflow */
  preConditions?: StepCondition[];
  
  /** Conditions that must be met after executing nested workflow */
  postConditions?: StepCondition[];
  
  /** Output mapping from nested workflow to parent context */
  outputMapping?: Record<string, string>;
  
  /** Optional label for this reference */
  label?: string;
  
  /** Optional description */
  description?: string;
}

/**
 * Conditional workflow configuration
 */
export interface ConditionalWorkflowConfig {
  /** Unique identifier for the workflow */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Conditional branches to evaluate */
  branches: ConditionalBranch[];
  
  /** Context-based decisions */
  decisions?: ContextDecision[];
  
  /** Nested workflow references */
  nestedWorkflows?: NestedWorkflowReference[];
  
  /** Default entry point (optional) */
  defaultBranchId?: string;
  
  /** Metadata about the conditional workflow */
  metadata?: {
    version?: string;
    author?: string;
    tags?: string[];
    description?: string;
  };
}

/**
 * Evaluates a StepCondition against execution context
 *
 * @param condition - Condition to evaluate
 * @param context - Execution context with variable values
 * @returns Boolean result of condition evaluation
 */
export function evaluateCondition(
  condition: StepCondition,
  context: Record<string, unknown>
): boolean {
  let result = false;

  switch (condition.type) {
    case 'if': {
      if (!condition.variable || condition.operator === undefined || condition.value === undefined) {
        return false;
      }

      const variableValue = context[condition.variable];
      if (variableValue === undefined) {
        return false;
      }

      switch (condition.operator) {
        case '===':
          result = variableValue === condition.value;
          break;
        case '!==':
          result = variableValue !== condition.value;
          break;
        case '>':
          result = Number(variableValue) > Number(condition.value);
          break;
        case '<':
          result = Number(variableValue) < Number(condition.value);
          break;
        case '>=':
          result = Number(variableValue) >= Number(condition.value);
          break;
        case '<=':
          result = Number(variableValue) <= Number(condition.value);
          break;
        case 'in':
          result = Array.isArray(condition.value) 
            ? condition.value.includes(variableValue)
            : false;
          break;
        case 'not-in':
          result = Array.isArray(condition.value)
            ? !condition.value.includes(variableValue)
            : false;
          break;
        default:
          return false;
      }
      break;
    }

    case 'environment': {
      if (condition.os) {
        const currentOS = (context.os as string) || 'unknown';
        result = currentOS.toLowerCase() === condition.os.toLowerCase();
      }
      
      if (condition.browser) {
        const currentBrowser = (context.browser as string) || '';
        result = result && currentBrowser.toLowerCase().includes(condition.browser.toLowerCase());
      }
      
      break;
    }

    case 'data-validation': {
      if (!condition.schema) {
        return false;
      }
      
      // Simple JSON schema validation
      try {
        const data = context['data'] as Record<string, unknown>;
        if (!data) {
          return false;
        }
        
        // Basic schema validation (property existence check)
        if (condition.schema.properties) {
          const properties = condition.schema.properties as Record<string, unknown>;
          result = Object.keys(properties).every(
            key => key in data && data[key] !== undefined
          );
        }
      } catch {
        return false;
      }
      break;
    }

    default:
      return false;
  }

  // Apply inversion if specified
  return condition.invert ? !result : result;
}

/**
 * Evaluates a context evaluator function
 *
 * @param evaluator - Context evaluator function
 * @param context - Execution context
 * @returns Boolean result
 */
export function evaluateContextEvaluator(
  evaluator: ContextEvaluator,
  context: Record<string, unknown>
): boolean {
  return evaluator(context);
}

/**
 * Creates a simple if-else condition helper
 *
 * @param variable - Variable name to check
 * @param operator - Comparison operator
 * @param value - Value to compare against
 * @param trueSteps - Steps to execute if condition is true
 * @param falseSteps - Optional steps to execute if condition is false
 * @param options - Optional configuration
 * @returns ConditionalBranch object
 */
export function createIfBranch(
  variable: string,
  operator: '===' | '!==' | '>' | '<' | '>=' | '<=' | 'in' | 'not-in',
  value: unknown,
  trueSteps: WorkflowStep[],
  falseSteps?: WorkflowStep[],
  options?: { id?: string; label?: string; description?: string }
): ConditionalBranch {
  return {
    id: options?.id ?? `if-branch-${Date.now()}`,
    type: 'if',
    condition: {
      type: 'if',
      variable,
      operator,
      value
    },
    trueSteps,
    falseSteps,
    label: options?.label,
    description: options?.description
  };
}

/**
 * Creates a switch-case condition helper
 *
 * @param variable - Variable to evaluate
 * @param cases - Array of switch cases
 * @param defaultSteps - Optional default steps if no case matches
 * @param options - Optional configuration
 * @returns ConditionalBranch object with switch type
 */
export function createSwitchBranch(
  variable: string,
  cases: { value: unknown; steps: WorkflowStep[]; id?: string; label?: string }[],
  defaultSteps?: WorkflowStep[],
  options?: { id?: string; label?: string; description?: string }
): ConditionalBranch {
  // Create a switch evaluator function
  const switchEvaluator: ContextEvaluator = (context: Record<string, unknown>) => {
    const variableValue = context[variable];
    if (variableValue === undefined) {
      return false;
    }

    const matchedCase = cases.find(
      c => Array.isArray(c.value) ? c.value.includes(variableValue) : c.value === variableValue
    );

    return matchedCase !== undefined;
  };

  return {
    id: options?.id ?? `switch-branch-${Date.now()}`,
    type: 'switch',
    condition: switchEvaluator,
    trueSteps: cases.flatMap(c => c.steps),
    falseSteps: defaultSteps,
    label: options?.label,
    description: options?.description
  };
}

/**
 * Creates a context-based decision helper
 *
 * @param id - Decision identifier
 * @param contextKeys - Context variables to evaluate
 * @param evaluator - Function that returns branch ID
 * @param branches - Map of branch IDs to step sequences
 * @param options - Optional configuration
 * @returns ContextDecision object
 */
export function createContextDecision(
  id: string,
  contextKeys: string[],
  evaluator: ContextEvaluator,
  branches: Record<string, WorkflowStep[]>,
  options?: { defaultBranch?: WorkflowStep[]; label?: string; description?: string }
): ContextDecision {
  return {
    id,
    contextKeys,
    evaluator,
    branches,
    defaultBranch: options?.defaultBranch,
    label: options?.label,
    description: options?.description
  };
}

/**
 * Creates a nested workflow reference with conditions
 *
 * @param id - Reference identifier
 * @param workflowId - ID of nested workflow
 * @param options - Optional configuration
 * @returns NestedWorkflowReference object
 */
export function createNestedWorkflowReference(
  id: string,
  workflowId: string,
  options?: {
    contextMapping?: Record<string, string>;
    preConditions?: StepCondition[];
    postConditions?: StepCondition[];
    outputMapping?: Record<string, string>;
    label?: string;
    description?: string;
  }
): NestedWorkflowReference {
  return {
    id,
    workflowId,
    contextMapping: options?.contextMapping,
    preConditions: options?.preConditions,
    postConditions: options?.postConditions,
    outputMapping: options?.outputMapping,
    label: options?.label,
    description: options?.description
  };
}

/**
 * Creates a conditional workflow configuration
 *
 * @param config - Conditional workflow configuration
 * @returns ConditionalWorkflowConfig object
 */
export function createConditionalWorkflowConfig(
  config: Omit<ConditionalWorkflowConfig, 'metadata'>
): ConditionalWorkflowConfig {
  return {
    ...config,
    metadata: {
      version: config.metadata?.version ?? '1.0.0',
      author: config.metadata?.author ?? 'system',
      tags: config.metadata?.tags ?? [],
      description: config.metadata?.description ?? 'Conditional workflow'
    }
  };
}

/**
 * Validates a ConditionalBranch
 *
 * @param branch - Branch to validate
 * @throws Error if branch is invalid
 */
export function validateConditionalBranch(branch: ConditionalBranch): void {
  if (!branch.id) {
    throw new Error('ConditionalBranch must have an id');
  }

  if (!branch.type || !['if', 'switch', 'context'].includes(branch.type)) {
    throw new Error(`Invalid branch type: ${branch.type}`);
  }

  if (!branch.condition) {
    throw new Error('ConditionalBranch must have a condition');
  }

  if (!branch.trueSteps || branch.trueSteps.length === 0) {
    throw new Error('ConditionalBranch must have at least one step in trueSteps');
  }
}

/**
 * Validates a ContextDecision
 *
 * @param decision - Decision to validate
 * @throws Error if decision is invalid
 */
export function validateContextDecision(decision: ContextDecision): void {
  if (!decision.id) {
    throw new Error('ContextDecision must have an id');
  }

  if (!decision.contextKeys || decision.contextKeys.length === 0) {
    throw new Error('ContextDecision must have at least one context key');
  }

  if (!decision.evaluator) {
    throw new Error('ContextDecision must have an evaluator function');
  }

  const branchIds = Object.keys(decision.branches);
  if (branchIds.length === 0) {
    throw new Error('ContextDecision must have at least one branch');
  }

  for (const branchId of branchIds) {
    if (!decision.branches[branchId] || decision.branches[branchId].length === 0) {
      throw new Error(`Branch "${branchId}" must have at least one step`);
    }
  }
}

/**
 * Validates a NestedWorkflowReference
 *
 * @param reference - Reference to validate
 * @throws Error if reference is invalid
 */
export function validateNestedWorkflowReference(reference: NestedWorkflowReference): void {
  if (!reference.id) {
    throw new Error('NestedWorkflowReference must have an id');
  }

  if (!reference.workflowId) {
    throw new Error('NestedWorkflowReference must have a workflowId');
  }
}

/**
 * Validates a complete ConditionalWorkflowConfig
 *
 * @param config - Configuration to validate
 * @throws Error if configuration is invalid
 */
export function validateConditionalWorkflowConfig(config: ConditionalWorkflowConfig): void {
  if (!config.id) {
    throw new Error('ConditionalWorkflowConfig must have an id');
  }

  if (!config.name) {
    throw new Error('ConditionalWorkflowConfig must have a name');
  }

  if (!config.branches || config.branches.length === 0) {
    throw new Error('ConditionalWorkflowConfig must have at least one branch');
  }

  // Validate all branches
  for (const branch of config.branches) {
    validateConditionalBranch(branch);
  }

  // Validate decisions if present
  if (config.decisions) {
    for (const decision of config.decisions) {
      validateContextDecision(decision);
    }
  }

  // Validate nested workflows if present
  if (config.nestedWorkflows) {
    for (const reference of config.nestedWorkflows) {
      validateNestedWorkflowReference(reference);
    }
  }
}

/**
 * Evaluates all conditions in a conditional workflow
 *
 * @param config - Conditional workflow configuration
 * @param context - Execution context
 * @returns Map of branch IDs to their evaluation results
 */
export function evaluateWorkflowConditions(
  config: ConditionalWorkflowConfig,
  context: Record<string, unknown>
): Record<string, boolean> {
  const results: Record<string, boolean> = {};

  for (const branch of config.branches) {
    let isTrue = false;

    if (typeof branch.condition === 'function') {
      isTrue = evaluateContextEvaluator(branch.condition, context);
    } else {
      isTrue = evaluateCondition(branch.condition, context);
    }

    results[branch.id] = isTrue;
  }

  return results;
}

/**
 * Finds the matching branch for a given context
 *
 * @param branches - Array of branches to evaluate
 * @param context - Execution context
 * @returns ID of the first matching branch, or undefined if no match
 */
export function findMatchingBranch(
  branches: ConditionalBranch[],
  context: Record<string, unknown>
): string | undefined {
  for (const branch of branches) {
    let isTrue = false;

    if (typeof branch.condition === 'function') {
      isTrue = evaluateContextEvaluator(branch.condition, context);
    } else {
      isTrue = evaluateCondition(branch.condition, context);
    }

    if (isTrue) {
      return branch.id;
    }
  }

  return undefined;
}

/**
 * Creates a step with conditional execution policy
 *
 * @param id - Step identifier
 * @param name - Step name
 * @param type - Step type (recording or workflow)
 * @param referenceId - Recording ID or nested workflow ID
 * @param condition - Condition for execution
 * @param policy - Execution policy
 * @param options - Optional configuration
 * @returns WorkflowStep with conditions
 */
export function createConditionalStep(
  id: string,
  name: string,
  type: 'recording' | 'workflow',
  referenceId: string,
  condition: StepCondition,
  policy: ExecutionPolicy = {
    type: 'sequential',
    onError: 'stop'
  },
  options?: {
    description?: string;
    outputMapping?: Record<string, string>;
  }
): WorkflowStep {
  return {
    id,
    name,
    description: options?.description,
    type,
    [type === 'recording' ? 'recordingId' : 'workflowId']: referenceId,
    conditions: [condition],
    policy,
    outputMapping: options?.outputMapping,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/**
 * Creates an if-else workflow step
 *
 * @param id - Step identifier
 * @param name - Step name
 * @param condition - Condition to evaluate
 * @param trueStep - Step to execute if condition is true
 * @param falseStep - Optional step to execute if condition is false
 * @param policy - Execution policy
 * @returns Workflow with conditional step
 */
export function createIfElseWorkflow(
  id: string,
  name: string,
  condition: StepCondition,
  trueStep: WorkflowStep,
  falseStep?: WorkflowStep,
  policy: ExecutionPolicy = {
    type: 'conditional',
    onError: 'skip-step'
  }
): Workflow {
  const now = new Date().toISOString();

  const steps: WorkflowStep[] = [trueStep];
  
  if (falseStep) {
    steps.push({
      ...falseStep,
      id: falseStep.id,
      name: falseStep.name,
      conditions: [
        ...(falseStep.conditions || []),
        {
          type: 'if',
          variable: '__condition_inverted',
          operator: '===',
          value: true
        }
      ],
      policy: {
        ...policy,
        type: 'sequential'
      }
    });
  }

  return {
    id,
    name,
    steps,
    metadata: {
      createdAt: now,
      updatedAt: now,
      version: '1.0.0',
      source: 'user-created',
      executionCount: 0,
      successCount: 0,
      failureCount: 0
    }
  };
}

/**
 * Creates a switch-case workflow
 *
 * @param id - Workflow identifier
 * @param name - Workflow name
 * @param variable - Variable to evaluate
 * @param cases - Switch cases
 * @param defaultStep - Optional default step
 * @param policy - Execution policy
 * @returns Workflow with switch-case structure
 */
export function createSwitchCaseWorkflow(
  id: string,
  name: string,
  variable: string,
  cases: { value: unknown; step: WorkflowStep }[],
  defaultStep?: WorkflowStep,
  policy: ExecutionPolicy = {
    type: 'conditional',
    onError: 'skip-step'
  }
): Workflow {
  const now = new Date().toISOString();

  const steps: WorkflowStep[] = cases.map((c, index) => ({
    ...c.step,
    id: c.step.id || `case-${index}-${Date.now()}`,
    conditions: [
      ...(c.step.conditions || []),
      {
        type: 'if',
        variable,
        operator: '===',
        value: c.value
      }
    ],
    policy: {
      ...policy,
      type: 'sequential'
    }
  }));

  if (defaultStep) {
    steps.push({
      ...defaultStep,
      conditions: [
        ...(defaultStep.conditions || []),
        {
          type: 'if',
          variable,
          operator: 'not-in',
          value: cases.map(c => c.value)
        }
      ],
      policy: {
        ...policy,
        type: 'sequential'
      }
    });
  }

  return {
    id,
    name,
    steps,
    metadata: {
      createdAt: now,
      updatedAt: now,
      version: '1.0.0',
      source: 'user-created',
      executionCount: 0,
      successCount: 0,
      failureCount: 0
    }
  };
}

/**
 * Helper to create a context-based routing workflow
 *
 * @param id - Workflow identifier
 * @param name - Workflow name
 * @param contextKeys - Keys to check in context
 * @param routeEvaluator - Function that takes context and returns route ID
 * @param routes - Map of route IDs to step sequences
 * @param defaultRoute - Optional default route
 * @returns Workflow with context-based routing
 */
export function createContextRoutingWorkflow(
  id: string,
  name: string,
  contextKeys: string[],
  routeEvaluator: (context: Record<string, unknown>) => string,
  routes: Record<string, WorkflowStep[]>,
  defaultRoute?: WorkflowStep[]
): Workflow {
  const now = new Date().toISOString();

  // Create a routing step for each route
  const steps: WorkflowStep[] = Object.entries(routes).map(([routeId, routeSteps]) => {
    const routeEvaluatorForStep: ContextEvaluator = (context) => {
      const routeIdFromEvaluator = routeEvaluator(context);
      return routeIdFromEvaluator === routeId;
    };

    return {
      id: `route-${routeId}`,
      name: `Route: ${routeId}`,
      type: 'workflow',
      workflowId: routeId,
      conditions: [],
      policy: {
        type: 'conditional',
        onError: 'skip-step'
      },
      createdAt: now,
      updatedAt: now
    };
  });

  // Create default route step if provided
  if (defaultRoute) {
    steps.push({
      id: 'route-default',
      name: 'Default Route',
      type: 'workflow',
      workflowId: 'default',
      conditions: [],
      policy: {
        type: 'conditional',
        onError: 'skip-step'
      },
      createdAt: now,
      updatedAt: now
    });
  }

  return {
    id,
    name,
    steps,
    metadata: {
      createdAt: now,
      updatedAt: now,
      version: '1.0.0',
      source: 'user-created',
      executionCount: 0,
      successCount: 0,
      failureCount: 0
    }
  };
}

/**
 * Merges conditional branches into a single workflow
 *
 * @param config - Conditional workflow configuration
 * @returns Workflow with all branches as steps
 */
export function mergeConditionalBranchesToWorkflow(
  config: ConditionalWorkflowConfig
): Workflow {
  const now = new Date().toISOString();

  // Flatten all branches into a single workflow
  const steps: WorkflowStep[] = [];

  for (const branch of config.branches) {
    // Create a branch indicator context variable
    const branchCondition: StepCondition = {
      type: 'if',
      variable: `branch_${branch.id}`,
      operator: '===',
      value: true
    };

    for (const step of branch.trueSteps) {
      steps.push({
        ...step,
        conditions: [
          ...(step.conditions || []),
          branchCondition
        ]
      });
    }

    if (branch.falseSteps) {
      const invertedCondition: StepCondition = {
        ...branchCondition,
        invert: true
      };

      for (const step of branch.falseSteps) {
        steps.push({
          ...step,
          conditions: [
            ...(step.conditions || []),
            invertedCondition
          ]
        });
      }
    }
  }

  return {
    id: config.id,
    name: config.name,
    steps,
    metadata: {
      createdAt: now,
      updatedAt: now,
      version: config.metadata?.version ?? '1.0.0',
      source: 'user-created',
      tags: config.metadata?.tags,
      executionCount: 0,
      successCount: 0,
      failureCount: 0
    }
  };
}
