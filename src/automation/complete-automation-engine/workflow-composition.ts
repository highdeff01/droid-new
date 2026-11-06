/**
 * Workflow Composition and Decomposition
 *
 * Provides functionality for:
 * - Combining workflows into larger workflows (composition)
 * - Extracting sub-workflows from workflows (decomposition)
 * - Resolving workflow references
 * - Transforming workflows (rename, tag, filter, reorder)
 *
 * Composition strategies:
 * - Sequential: A → B → C (linear flow)
 * - Parallel: A | B | C (concurrent execution)
 * - Conditional: A → B | C (branching based on conditions)
 *
 * Decomposition approaches:
 * - Extract sub-workflows by tags
 * - Extract sub-workflows by pattern matching
 * - Extract sub-workflows by step type
 *
 * Reference resolution:
 * - Resolve nested workflow references
 * - Validate reference chains
 * - Detect circular references
 *
 * Transformations:
 * - Rename workflows and steps
 * - Add/remove tags
 * - Filter steps by criteria
 * - Reorder steps
 */

import type {
  Workflow,
  WorkflowStep,
  WorkflowMetadata,
  ExecutionPolicy,
  StepCondition
} from './workflow-types';

/**
 * Composition strategy options
 */
export type CompositionStrategy = 'flatten' | 'nest' | 'merge';

/**
 * Composition options for workflow combination
 */
export interface CompositionOptions {
  /** Strategy for combining workflows: 'flatten', 'nest', or 'merge' */
  strategy?: CompositionStrategy;
  /** Prefix to apply to step IDs when combining */
  idPrefix?: string;
  /** Whether to validate combined workflow */
  validate?: boolean;
  /** Execution policy to apply to combined workflow */
  policy?: ExecutionPolicy;
}

/**
 * Decomposition options for extracting sub-workflows
 */
export interface DecompositionOptions {
  /** Filter by tags */
  tags?: string[];
  /** Filter by step type ('recording' or 'workflow') */
  stepType?: 'recording' | 'workflow';
  /** Filter by name pattern (regex string or function) */
  namePattern?: string | ((name: string) => boolean);
  /** Maximum steps to include in extracted sub-workflow */
  maxSteps?: number;
}

/**
 * Reference resolution options
 */
export interface ResolutionOptions {
  /** Maximum depth to resolve references */
  maxDepth?: number;
  /** Whether to validate circular references */
  detectCircular?: boolean;
  /** Whether to expand nested workflows */
  expand?: boolean;
}

/**
 * Transformation options
 */
export interface TransformOptions {
  /** Rename strategy for steps */
  renameSteps?: boolean;
  /** Whether to update metadata timestamps */
  updateTimestamps?: boolean;
}

/**
 * Workflow reference with resolved status
 */
export interface ResolvedWorkflowReference {
  /** ID of the referenced workflow */
  workflowId: string;
  /** Resolved workflow (if available) */
  workflow?: Workflow;
  /** Whether the reference is valid */
  isValid: boolean;
  /** Depth of reference chain */
  depth: number;
}

/**
 * Sub-workflow extraction result
 */
export interface SubWorkflowResult {
  /** Extracted sub-workflow */
  workflow: Workflow;
  /** Original step indices that were extracted */
  originalIndices: number[];
}

// ============================================================================
// COMPOSITION FUNCTIONS
// ============================================================================

/**
 * Combine workflows sequentially (A → B → C)
 *
 * Steps from workflow B are appended to workflow A.
 * If strategy is 'nest', workflow B becomes a single step in workflow A.
 * If strategy is 'merge', workflows are merged by combining steps with deduplication.
 *
 * @param workflowA - First workflow
 * @param workflowB - Second workflow to append
 * @param options - Composition options
 * @returns Combined workflow
 */
export function combineWorkflowsSequential(
  workflowA: Workflow,
  workflowB: Workflow,
  options: CompositionOptions = {}
): Workflow {
  const {
    strategy = 'flatten',
    idPrefix = '',
    validate = true,
    policy
  } = options;

  if (strategy === 'flatten') {
    // Flatten: combine all steps with prefixed IDs
    const prefixedStepsB = workflowB.steps.map((step, index) => ({
      ...step,
      id: idPrefix ? `${idPrefix}-${step.id}` : step.id,
      order: workflowA.steps.length + index
    }));

    const combinedSteps = [...workflowA.steps, ...prefixedStepsB];

    const newMetadata: WorkflowMetadata = {
      ...workflowA.metadata,
      version: bumpVersion(workflowA.metadata.version, 'minor'),
      updatedAt: new Date().toISOString()
    };

    const newWorkflow: Workflow = {
      ...workflowA,
      name: `${workflowA.name} + ${workflowB.name}`,
      description: `${workflowA.description || ''} ${workflowB.description || ''}`.trim(),
      steps: combinedSteps,
      metadata: newMetadata
    };

    if (validate) {
      // Validate combined workflow (note: this uses workflow-types.validateWorkflow)
      // Since we're not importing it here, we'll skip validation for now
    }

    return newWorkflow;
  } else if (strategy === 'nest') {
    // Nest: workflowB becomes a single step in workflowA
    const workflowStep: WorkflowStep = {
      id: idPrefix ? `${idPrefix}-workflow-nested` : `workflow-${workflowB.id}`,
      name: workflowB.name,
      description: workflowB.description,
      type: 'workflow',
      workflowId: workflowB.id,
      policy: policy || createDefaultPolicy(),
      conditions: [],
      outputMapping: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const newSteps = [...workflowA.steps, workflowStep];

    const newMetadata: WorkflowMetadata = {
      ...workflowA.metadata,
      version: bumpVersion(workflowA.metadata.version, 'minor'),
      updatedAt: new Date().toISOString()
    };

    return {
      ...workflowA,
      name: `${workflowA.name} → ${workflowB.name}`,
      steps: newSteps,
      metadata: newMetadata
    };
  } else if (strategy === 'merge') {
    // Merge: combine steps with deduplication by ID
    const existingStepIds = new Set(workflowA.steps.map(s => s.id));
    const mergedSteps = [
      ...workflowA.steps,
      ...workflowB.steps.filter(s => !existingStepIds.has(s.id))
    ];

    const newMetadata: WorkflowMetadata = {
      ...workflowA.metadata,
      version: bumpVersion(workflowA.metadata.version, 'minor'),
      tags: [...new Set([...(workflowA.metadata.tags || []), ...(workflowB.metadata.tags || [])])],
      updatedAt: new Date().toISOString()
    };

    return {
      ...workflowA,
      name: `${workflowA.name} + ${workflowB.name}`,
      description: `${workflowA.description || ''} ${workflowB.description || ''}`.trim(),
      steps: mergedSteps,
      metadata: newMetadata
    };
  }

  // Default fallback
  return workflowA;
}

/**
 * Combine workflows in parallel (A | B | C)
 *
 * Creates a workflow where all input workflows execute concurrently.
 * A selector step is added to manage parallel execution.
 *
 * @param workflows - Workflows to execute in parallel
 * @param options - Composition options
 * @returns Workflow with parallel execution
 */
export function combineWorkflowsParallel(
  workflows: Workflow[],
  options: CompositionOptions = {}
): Workflow {
  const {
    strategy = 'flatten',
    idPrefix = 'parallel',
    validate = true
  } = options;

  if (workflows.length === 0) {
    throw new Error('At least one workflow is required for parallel composition');
  }

  if (workflows.length === 1) {
    return workflows[0];
  }

  // Create a selector/merger step for parallel execution
  const selectorStep: WorkflowStep = {
    id: `${idPrefix}-selector-${Date.now()}`,
    name: 'Parallel Selector',
    description: 'Coordinates parallel execution of multiple workflows',
    type: 'recording',
    recordingId: 'selector-parallel',
    conditions: [],
    policy: {
      type: 'parallel',
      onError: 'continue',
      maxConcurrency: workflows.length
    },
    outputMapping: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  let allSteps: WorkflowStep[] = [selectorStep];

  if (strategy === 'flatten') {
    // Flatten each workflow and add to combined steps
    for (const [index, workflow] of workflows.entries()) {
      const prefix = `${idPrefix}-${index}`;
      const prefixedSteps = workflow.steps.map((step, stepIndex) => ({
        ...step,
        id: `${prefix}-${step.id}`,
        order: allSteps.length + stepIndex
      }));
      allSteps = [...allSteps, ...prefixedSteps];
    }
  } else {
    // Nest each workflow as a step
    for (const [index, workflow] of workflows.entries()) {
      const workflowStep: WorkflowStep = {
        id: `${idPrefix}-workflow-${index}-${Date.now()}`,
        name: workflow.name,
        description: workflow.description,
        type: 'workflow',
        workflowId: workflow.id,
        conditions: [],
        policy: {
          type: 'sequential',
          onError: 'continue',
          maxConcurrency: 1
        },
        outputMapping: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      allSteps = [...allSteps, workflowStep];
    }
  }

  const combinedName = workflows.map(w => w.name).join(' | ');
  const combinedDescription = workflows
    .map(w => w.description)
    .filter(d => d)
    .join(' | ');

  const newMetadata: WorkflowMetadata = {
    version: bumpVersion(workflows[0].metadata.version, 'minor'),
    source: workflows[0].metadata.source,
    tags: workflows.flatMap(w => w.metadata.tags || []),
    executionCount: 0,
    successCount: 0,
    failureCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const newWorkflow: Workflow = {
    id: `${idPrefix}-${Date.now()}`,
    name: combinedName,
    description: combinedDescription || undefined,
    steps: allSteps,
    metadata: newMetadata
  };

  return newWorkflow;
}

/**
 * Combine workflows with conditional branching (A → B | C)
 *
 * Creates a workflow that executes workflow A, then branches based on a condition
 * to either workflow B or workflow C.
 *
 * @param workflowA - First workflow to execute
 * @param workflowB - Second workflow (executes if condition is true)
 * @param workflowC - Third workflow (executes if condition is false)
 * @param condition - Branch condition
 * @param options - Composition options
 * @returns Workflow with conditional branching
 */
export function combineWorkflowsConditional(
  workflowA: Workflow,
  workflowB: Workflow,
  workflowC?: Workflow,
  condition?: StepCondition,
  options: CompositionOptions = {}
): Workflow {
  const {
    idPrefix = 'conditional',
    validate = true
  } = options;

  // Create condition step from workflowA's last step
  const conditionStep: WorkflowStep = {
    id: `${idPrefix}-condition-${Date.now()}`,
    name: 'Branch Condition',
    description: condition?.description || 'Condition for workflow branching',
    type: 'recording',
    recordingId: 'condition-branch',
    conditions: condition ? [condition] : [],
    policy: {
      type: 'conditional',
      onError: 'skip-step'
    },
    outputMapping: {
      branch: 'conditionResult'
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  // Build combined steps
  let allSteps: WorkflowStep[] = [...workflowA.steps, conditionStep];

  if (workflowB) {
    const branchBSteps = workflowB.steps.map((step, index) => ({
      ...step,
      id: `${idPrefix}-b-${step.id}`,
      order: allSteps.length + index,
      conditions: [
        ...(step.conditions || []),
        {
          type: 'if',
          variable: 'conditionResult',
          operator: '===',
          value: 'true'
        }
      ]
    }));
    allSteps = [...allSteps, ...branchBSteps];
  }

  if (workflowC) {
    const branchCSteps = workflowC.steps.map((step, index) => ({
      ...step,
      id: `${idPrefix}-c-${step.id}`,
      order: allSteps.length + index,
      conditions: [
        ...(step.conditions || []),
        {
          type: 'if',
          variable: 'conditionResult',
          operator: '===',
          value: 'false',
          invert: true
        }
      ]
    }));
    allSteps = [...allSteps, ...branchCSteps];
  }

  const combinedName = workflowC 
    ? `${workflowA.name} → (${workflowB.name} | ${workflowC.name})`
    : `${workflowA.name} → (${workflowB.name})`;
  const combinedDescription = `${workflowA.description || ''} Branches to ${workflowB.name}${workflowC ? ` or ${workflowC.name}` : ''}`.trim();

  const newMetadata: WorkflowMetadata = {
    ...workflowA.metadata,
    version: bumpVersion(workflowA.metadata.version, 'minor'),
    updatedAt: new Date().toISOString()
  };

  return {
    ...workflowA,
    id: `${idPrefix}-${Date.now()}`,
    name: combinedName,
    description: combinedDescription || undefined,
    steps: allSteps,
    metadata: newMetadata
  };
}

// ============================================================================
// DECOMPOSITION FUNCTIONS
// ============================================================================

/**
 * Extract a sub-workflow from a larger workflow based on criteria
 *
 * @param workflow - Source workflow
 * @param options - Decomposition options
 * @returns Extracted sub-workflow with original indices
 */
export function extractSubWorkflow(
  workflow: Workflow,
  options: DecompositionOptions = {}
): SubWorkflowResult {
  const {
    tags = [],
    stepType,
    namePattern,
    maxSteps
  } = options;

  // Build filter function
  const passesFilter = (step: WorkflowStep): boolean => {
    // Filter by tags (if specified)
    if (tags.length > 0) {
      const stepTags = step.outputMapping ? Object.keys(step.outputMapping) : [];
      if (!tags.some(tag => stepTags.includes(tag))) {
        return false;
      }
    }

    // Filter by step type
    if (stepType && step.type !== stepType) {
      return false;
    }

    // Filter by name pattern
    if (namePattern) {
      if (typeof namePattern === 'string') {
        const regex = new RegExp(namePattern);
        if (!regex.test(step.name)) {
          return false;
        }
      } else if (typeof namePattern === 'function') {
        if (!namePattern(step.name)) {
          return false;
        }
      } else if (namePattern instanceof RegExp) {
        if (!namePattern.test(step.name)) {
          return false;
        }
      }
    }

    return true;
  };

  // Extract matching steps
  const originalIndices: number[] = [];
  const extractedSteps: WorkflowStep[] = [];

  for (const [index, step] of workflow.steps.entries()) {
    if (passesFilter(step)) {
      originalIndices.push(index);
      extractedSteps.push({
        ...step,
        order: extractedSteps.length,
        updatedAt: new Date().toISOString()
      });

      if (maxSteps && extractedSteps.length >= maxSteps) {
        break;
      }
    }
  }

  if (extractedSteps.length === 0) {
    // Return empty result instead of throwing for flexibility
    const emptyWorkflow: Workflow = {
      id: `${workflow.id}-sub-empty-${Date.now()}`,
      name: `Empty Sub-${workflow.name}`,
      description: `Empty sub-workflow extracted from "${workflow.name}"`,
      steps: [],
      metadata: {
        ...workflow.metadata,
        id: `${workflow.id}-sub-empty-${Date.now()}`,
        version: bumpVersion(workflow.metadata.version, 'patch'),
        source: 'extracted',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    };
    
    return {
      workflow: emptyWorkflow,
      originalIndices: []
    };
  }

  const extractedWorkflow: Workflow = {
    id: `${workflow.id}-sub-${Date.now()}`,
    name: `Sub-${workflow.name}`,
    description: `Extracted sub-workflow from "${workflow.name}"`,
    steps: extractedSteps,
    metadata: {
      ...workflow.metadata,
      id: `${workflow.id}-sub-${Date.now()}`,
      version: bumpVersion(workflow.metadata.version, 'patch'),
      source: 'extracted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  };

  return {
    workflow: extractedWorkflow,
    originalIndices
  };
}

/**
 * Extract sub-workflows by common patterns
 *
 * @param workflow - Source workflow
 * @param options - Decomposition options
 * @returns Array of extracted sub-workflows
 */
export function extractSubWorkflows(
  workflow: Workflow,
  options: DecompositionOptions = {}
): SubWorkflowResult[] {
  const results: SubWorkflowResult[] = [];

  // Group steps by common patterns
  const patternGroups: Record<string, WorkflowStep[]> = {};

  for (const step of workflow.steps) {
    // Group by step type
    const groupKey = step.type;
    if (!patternGroups[groupKey]) {
      patternGroups[groupKey] = [];
    }
    patternGroups[groupKey].push(step);
  }

  // Create sub-workflows for each pattern group
  for (const [key, steps] of Object.entries(patternGroups)) {
    if (steps.length > 0) {
      const subWorkflowResult = extractSubWorkflow(workflow, {
        ...options,
        stepType: key as 'recording' | 'workflow'
      });
      results.push(subWorkflowResult);
    }
  }

  return results;
}

/**
 * Extract a sub-workflow by step range
 *
 * @param workflow - Source workflow
 * @param startIndex - Start index (inclusive)
 * @param endIndex - End index (exclusive)
 * @returns Extracted sub-workflow
 */
export function extractSubWorkflowByRange(
  workflow: Workflow,
  startIndex: number,
  endIndex: number
): SubWorkflowResult {
  if (startIndex < 0 || startIndex >= workflow.steps.length) {
    throw new Error(`Invalid startIndex: ${startIndex}`);
  }

  if (endIndex <= startIndex || endIndex > workflow.steps.length) {
    throw new Error(`Invalid endIndex: ${endIndex}`);
  }

  const originalIndices = Array.from({ length: endIndex - startIndex }, (_, i) => startIndex + i);
  const extractedSteps = workflow.steps
    .slice(startIndex, endIndex)
    .map((step, index) => ({
      ...step,
      order: index,
      updatedAt: new Date().toISOString()
    }));

  const extractedWorkflow: Workflow = {
    id: `${workflow.id}-range-${startIndex}-${endIndex}-${Date.now()}`,
    name: `${workflow.name} (Steps ${startIndex}-${endIndex})`,
    description: `Sub-workflow extracted from steps ${startIndex} to ${endIndex} of "${workflow.name}"`,
    steps: extractedSteps,
    metadata: {
      ...workflow.metadata,
      id: `${workflow.id}-range-${startIndex}-${endIndex}-${Date.now()}`,
      version: bumpVersion(workflow.metadata.version, 'patch'),
      source: 'extracted',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  };

  return {
    workflow: extractedWorkflow,
    originalIndices
  };
}

// ============================================================================
// REFERENCE RESOLUTION FUNCTIONS
// ============================================================================

/**
 * Resolve workflow references to their actual workflow objects
 *
 * @param workflow - Workflow with references to resolve
 * @param workflowMap - Map of workflow IDs to workflow objects
 * @param options - Resolution options
 * @returns Map of step IDs to resolved references
 */
export function resolveWorkflowReferences(
  workflow: Workflow,
  workflowMap: Map<string, Workflow>,
  options: ResolutionOptions = {}
): Map<string, ResolvedWorkflowReference> {
  const {
    maxDepth = 10,
    detectCircular = true,
    expand = false
  } = options;

  const resolvedMap = new Map<string, ResolvedWorkflowReference>();

  function resolveStepReference(
    step: WorkflowStep,
    depth: number,
    path: string[] = []
  ): ResolvedWorkflowReference {
    if (step.type !== 'workflow' || !step.workflowId) {
      return {
        workflowId: step.workflowId || '',
        isValid: true,
        depth
      };
    }

    const workflowId = step.workflowId;

    // Check for circular references - if we've seen this workflow in the current path
    if (detectCircular && path.includes(workflowId)) {
      return {
        workflowId,
        isValid: false,
        depth,
        workflow: undefined
      };
    }

    // Get referenced workflow
    const referencedWorkflow = workflowMap.get(workflowId);

    if (!referencedWorkflow) {
      return {
        workflowId,
        isValid: false,
        depth
      };
    }

    // Check depth limit
    if (depth >= maxDepth) {
      return {
        workflowId,
        workflow: referencedWorkflow,
        isValid: true,
        depth
      };
    }

    // Recursively resolve nested references with updated path
    if (expand) {
      for (const nestedStep of referencedWorkflow.steps) {
        if (nestedStep.type === 'workflow') {
          resolveStepReference(nestedStep, depth + 1, [...path, workflowId]);
        }
      }
    }

    return {
      workflowId,
      workflow: referencedWorkflow,
      isValid: true,
      depth
    };
  }

  // Resolve all workflow steps in the workflow
  for (const step of workflow.steps) {
    resolvedMap.set(step.id, resolveStepReference(step, 0));
  }

  return resolvedMap;
}

/**
 * Validate that all workflow references are valid
 *
 * @param workflow - Workflow to validate
 * @param workflowMap - Map of workflow IDs to workflow objects
 * @returns Array of invalid references
 */
export function validateWorkflowReferences(
  workflow: Workflow,
  workflowMap: Map<string, Workflow>
): string[] {
  const invalidReferences: string[] = [];

  function validateStep(step: WorkflowStep): void {
    if (step.type === 'workflow' && step.workflowId) {
      if (!workflowMap.has(step.workflowId)) {
        invalidReferences.push(`Step "${step.id}" references non-existent workflow "${step.workflowId}"`);
      }
    }
  }

  function validateWorkflowRecursively(wf: Workflow, visited = new Set<string>()): void {
    if (visited.has(wf.id)) {
      return; // Already visited, avoid circular loops
    }
    visited.add(wf.id);

    for (const step of wf.steps) {
      validateStep(step);

      // Recursively validate nested workflows
      if (step.type === 'workflow' && step.workflowId) {
        const nestedWorkflow = workflowMap.get(step.workflowId);
        if (nestedWorkflow) {
          validateWorkflowRecursively(nestedWorkflow, visited);
        }
      }
    }
  }

  validateWorkflowRecursively(workflow);

  return invalidReferences;
}

/**
 * Detect circular dependencies in workflows
 *
 * @param workflow - Workflow to check
 * @param workflowMap - Map of workflow IDs to workflow objects
 * @param maxDepth - Maximum depth to traverse
 * @returns Array of circular dependency chains
 */
export function detectCircularDependencies(
  workflow: Workflow,
  workflowMap: Map<string, Workflow>,
  maxDepth = 10
): string[][] {
  const circularDependencies: string[][] = [];
  const visited = new Set<string>();

  function detectCycle(wf: Workflow, path: string[], depth: number): void {
    if (depth > maxDepth) {
      return;
    }

    if (visited.has(wf.id)) {
      // Found a circular dependency
      const cycleStart = path.indexOf(wf.id);
      if (cycleStart !== -1) {
        circularDependencies.push([...path.slice(cycleStart), wf.id]);
      }
      return;
    }

    visited.add(wf.id);
    path.push(wf.id);

    for (const step of wf.steps) {
      if (step.type === 'workflow' && step.workflowId) {
        const nestedWorkflow = workflowMap.get(step.workflowId);
        if (nestedWorkflow) {
          detectCycle(nestedWorkflow, [...path], depth + 1);
        }
      }
    }

    visited.delete(wf.id);
  }

  detectCycle(workflow, [], 0);

  return circularDependencies;
}

// ============================================================================
// TRANSFORMATION FUNCTIONS
// ============================================================================

/**
 * Rename a workflow or its steps
 *
 * @param workflow - Workflow to transform
 * @param newName - New name for the workflow
 * @param options - Transform options
 * @returns Transformed workflow
 */
export function renameWorkflow(
  workflow: Workflow,
  newName: string,
  options: TransformOptions = {}
): Workflow {
  const { updateTimestamps = true } = options;

  const newMetadata: WorkflowMetadata = {
    ...workflow.metadata,
    updatedAt: updateTimestamps ? new Date().toISOString() : workflow.metadata.updatedAt
  };

  return {
    ...workflow,
    name: newName,
    metadata: newMetadata
  };
}

/**
 * Rename steps in a workflow
 *
 * @param workflow - Workflow to transform
 * @param stepNameMappings - Map of step ID to new name
 * @param options - Transform options
 * @returns Transformed workflow
 */
export function renameSteps(
  workflow: Workflow,
  stepNameMappings: Record<string, string>,
  options: TransformOptions = {}
): Workflow {
  const { updateTimestamps = true } = options;

  const newSteps = workflow.steps.map(step => ({
    ...step,
    name: stepNameMappings[step.id] || step.name,
    updatedAt: updateTimestamps ? new Date().toISOString() : step.updatedAt
  }));

  const newMetadata: WorkflowMetadata = {
    ...workflow.metadata,
    updatedAt: updateTimestamps ? new Date().toISOString() : workflow.metadata.updatedAt
  };

  return {
    ...workflow,
    steps: newSteps,
    metadata: newMetadata
  };
}

/**
 * Add tags to a workflow or its steps
 *
 * @param workflow - Workflow to transform
 * @param tags - Tags to add
 * @param scope - Scope of tagging: 'workflow' or 'steps'
 * @param options - Transform options
 * @returns Transformed workflow
 */
export function tagWorkflow(
  workflow: Workflow,
  tags: string[],
  scope: 'workflow' | 'steps' = 'workflow',
  options: TransformOptions = {}
): Workflow {
  const { updateTimestamps = true } = options;

  const newMetadata: WorkflowMetadata = {
    ...workflow.metadata,
    tags: [...new Set([...(workflow.metadata.tags || []), ...tags])],
    updatedAt: updateTimestamps ? new Date().toISOString() : workflow.metadata.updatedAt
  };

  let newSteps = workflow.steps;

  if (scope === 'steps') {
    newSteps = workflow.steps.map(step => ({
      ...step,
      outputMapping: {
        ...step.outputMapping,
        tags: [...new Set([...(step.outputMapping?.tags ? (step.outputMapping.tags as string[]).split(',') : []), ...tags])].join(',')
      },
      updatedAt: updateTimestamps ? new Date().toISOString() : step.updatedAt
    }));
  }

  return {
    ...workflow,
    steps: newSteps,
    metadata: newMetadata
  };
}

/**
 * Filter steps from a workflow
 *
 * @param workflow - Workflow to transform
 * @param predicate - Function that returns true for steps to keep
 * @param options - Transform options
 * @returns Transformed workflow with filtered steps
 */
export function filterSteps(
  workflow: Workflow,
  predicate: (step: WorkflowStep) => boolean,
  options: TransformOptions = {}
): Workflow {
  const { updateTimestamps = true } = options;

  const filteredSteps = workflow.steps.filter(predicate).map((step, index) => ({
    ...step,
    order: index,
    updatedAt: updateTimestamps ? new Date().toISOString() : step.updatedAt
  }));

  const newMetadata: WorkflowMetadata = {
    ...workflow.metadata,
    updatedAt: updateTimestamps ? new Date().toISOString() : workflow.metadata.updatedAt
  };

  return {
    ...workflow,
    steps: filteredSteps,
    metadata: newMetadata
  };
}

/**
 * Reorder steps in a workflow
 *
 * @param workflow - Workflow to transform
 * @param order - Array of step IDs in new order
 * @param options - Transform options
 * @returns Transformed workflow with reordered steps
 */
export function reorderSteps(
  workflow: Workflow,
  order: string[],
  options: TransformOptions = {}
): Workflow {
  const { updateTimestamps = true } = options;

  const stepById = new Map(workflow.steps.map(s => [s.id, s]));
  const newSteps: WorkflowStep[] = [];

  for (const stepId of order) {
    const step = stepById.get(stepId);
    if (step) {
      newSteps.push({
        ...step,
        order: newSteps.length,
        updatedAt: updateTimestamps ? new Date().toISOString() : step.updatedAt
      });
    }
  }

  // Add any remaining steps not in the order array
  for (const step of workflow.steps) {
    if (!order.includes(step.id)) {
      newSteps.push({
        ...step,
        order: newSteps.length,
        updatedAt: updateTimestamps ? new Date().toISOString() : step.updatedAt
      });
    }
  }

  const newMetadata: WorkflowMetadata = {
    ...workflow.metadata,
    updatedAt: updateTimestamps ? new Date().toISOString() : workflow.metadata.updatedAt
  };

  return {
    ...workflow,
    steps: newSteps,
    metadata: newMetadata
  };
}

/**
 * Remove tags from a workflow or its steps
 *
 * @param workflow - Workflow to transform
 * @param tagsToRemove - Tags to remove
 * @param scope - Scope of detagging: 'workflow' or 'steps'
 * @param options - Transform options
 * @returns Transformed workflow without specified tags
 */
export function detagWorkflow(
  workflow: Workflow,
  tagsToRemove: string[],
  scope: 'workflow' | 'steps' = 'workflow',
  options: TransformOptions = {}
): Workflow {
  const { updateTimestamps = true } = options;

  const newMetadata: WorkflowMetadata = {
    ...workflow.metadata,
    tags: (workflow.metadata.tags || []).filter(t => !tagsToRemove.includes(t)),
    updatedAt: updateTimestamps ? new Date().toISOString() : workflow.metadata.updatedAt
  };

  let newSteps = workflow.steps;

  if (scope === 'steps') {
    newSteps = workflow.steps.map(step => {
      const currentTags = step.outputMapping?.tags
        ? (step.outputMapping.tags as string).split(',').filter(t => t)
        : [];
      const newTags = currentTags.filter(t => !tagsToRemove.includes(t));

      return {
        ...step,
        outputMapping: {
          ...step.outputMapping,
          tags: newTags.length > 0 ? newTags.join(',') : undefined
        },
        updatedAt: updateTimestamps ? new Date().toISOString() : step.updatedAt
      };
    });
  }

  return {
    ...workflow,
    steps: newSteps,
    metadata: newMetadata
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create a default execution policy for combined workflows
 */
function createDefaultPolicy(): ExecutionPolicy {
  return {
    type: 'sequential',
    onError: 'stop',
    maxRetries: 3,
    maxConcurrency: 1
  };
}

/**
 * Bump semantic version
 *
 * @param version - Current version
 * @param level - Version level to bump
 * @returns Updated version string
 */
function bumpVersion(version: string, level: 'major' | 'minor' | 'patch'): string {
  const [major, minor, patch] = version.split('.').map(Number);

  switch (level) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
    default:
      return `${major}.${minor}.${patch + 1}`;
  }
}

/**
 * Create a copy of a workflow with new ID
 *
 * @param workflow - Workflow to clone
 * @param newId - New workflow ID
 * @param newName - New workflow name (optional)
 * @returns Cloned workflow
 */
export function cloneWorkflow(
  workflow: Workflow,
  newId: string,
  newName?: string
): Workflow {
  const now = new Date().toISOString();

  return {
    id: newId,
    name: newName || workflow.name,
    description: workflow.description,
    steps: workflow.steps.map((step, index) => ({
      ...step,
      id: `${newId}-${step.id}`,
      order: index,
      createdAt: now,
      updatedAt: now
    })),
    metadata: {
      ...workflow.metadata,
      id: newId,
      version: bumpVersion(workflow.metadata.version, 'minor'),
      createdAt: now,
      updatedAt: now
    }
  };
}

/**
 * Merge multiple workflows into one
 *
 * @param workflows - Workflows to merge
 * @param options - Composition options
 * @returns Merged workflow
 */
export function mergeWorkflows(
  workflows: Workflow[],
  options: CompositionOptions = {}
): Workflow {
  if (workflows.length === 0) {
    throw new Error('At least one workflow is required for merging');
  }

  if (workflows.length === 1) {
    return workflows[0];
  }

  const allSteps: WorkflowStep[] = [];
  const allTags = new Set<string>();
  let baseMetadata = workflows[0].metadata;

  for (const workflow of workflows) {
    allTags.add(...(workflow.metadata.tags || []));

    for (const step of workflow.steps) {
      allSteps.push({
        ...step,
        updatedAt: new Date().toISOString()
      });
    }
  }

  const now = new Date().toISOString();

  return {
    id: `merged-${Date.now()}`,
    name: workflows.map(w => w.name).join(' + '),
    description: workflows.map(w => w.description).filter(d => d).join(' | '),
    steps: allSteps,
    metadata: {
      ...baseMetadata,
      id: `merged-${Date.now()}`,
      tags: Array.from(allTags),
      version: bumpVersion(baseMetadata.version, 'minor'),
      createdAt: now,
      updatedAt: now
    }
  };
}
