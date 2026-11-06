/**
 * Workflow Editing Capabilities
 *
 * Provides functions for editing workflows including:
 * - Step deletion with reindexing
 * - Pause step insertion
 * - Metadata editing (name, description, tags)
 * - Step metadata editing
 * - Step reordering
 * - Optional step marking
 * - Conditional breakpoint addition
 * - Undo/redo support
 *
 * All operations use immutable updates to avoid mutation issues.
 * Optional edit history tracking enables undo/redo capability.
 */

import type { Workflow, WorkflowStep, WorkflowMetadata, StepCondition, WorkflowEdit } from './workflow-types';
import { validateWorkflow } from './workflow-types';

/**
 * Edit options for workflow operations
 */
export interface EditOptions {
  /** Optional editor identifier (user ID, session ID, etc.) */
  editor?: string;

  /** Whether to track this edit in history */
  trackHistory?: boolean;
}

/**
 * Delete a step from a workflow by step ID
 *
 * @param workflow - Original workflow
 * @param stepId - ID of step to delete
 * @param options - Edit options
 * @returns New workflow with step removed
 * @throws Error if step not found or if workflow would be empty
 */
export function deleteStep(
  workflow: Workflow,
  stepId: string,
  options: EditOptions = {}
): Workflow {
  const { editor = 'system', trackHistory = true } = options;

  // Find step to delete
  const stepIndex = workflow.steps.findIndex(s => s.id === stepId);
  if (stepIndex === -1) {
    throw new Error(`Step with ID "${stepId}" not found in workflow "${workflow.id}"`);
  }

  // Validate minimum step count
  if (workflow.steps.length <= 1) {
    throw new Error('Workflow must contain at least one step');
  }

  // Create new steps array without the deleted step
  const newSteps = workflow.steps
    .filter(s => s.id !== stepId)
    .map((step, index) => ({
      ...step,
      order: index,  // Reindex steps starting from 0
      updatedAt: new Date().toISOString()
    }));

  // Build edit history entry
  const editEntry: WorkflowEdit = {
    id: `edit-${Date.now()}`,
    timestamp: new Date().toISOString(),
    editor,
    action: 'step-deleted',
    details: {
      stepId,
      stepName: workflow.steps[stepIndex].name,
      stepIndex,
      totalStepsBefore: workflow.steps.length,
      totalStepsAfter: newSteps.length
    }
  };

  // Update metadata
  const newMetadata: WorkflowMetadata = {
    ...workflow.metadata,
    updatedAt: new Date().toISOString(),
    version: bumpVersion(workflow.metadata.version, 'patch'),
    // Add to edit history if enabled
    ...(trackHistory && {
      editHistory: [...(workflow.metadata.editHistory || []), editEntry]
    })
  };

  // Create new workflow with immutable updates
  const newWorkflow: Workflow = {
    ...workflow,
    steps: newSteps,
    metadata: newMetadata
  };

  // Validate the updated workflow
  validateWorkflow(newWorkflow);

  return newWorkflow;
}

/**
 * Insert a pause step at a specified position in the workflow
 *
 * @param workflow - Original workflow
 * @param position - Position to insert (0-based, 0 = before first step)
 * @param options - Edit options including duration
 * @returns New workflow with pause step inserted
 * @throws Error if position is out of bounds
 */
export function insertPauseStep(
  workflow: Workflow,
  position: number,
  options: { duration?: number; editor?: string; trackHistory?: boolean } = {}
): Workflow {
  const { duration = 1000, editor = 'system', trackHistory = true } = options;

  // Validate position
  if (position < 0 || position > workflow.steps.length) {
    throw new Error(`Invalid position ${position}: must be between 0 and ${workflow.steps.length}`);
  }

  // Create pause step
  const pauseStep: WorkflowStep = {
    id: `step-pause-${Date.now()}`,
    name: `Pause ${position + 1}`,
    description: `Automatic pause step - duration: ${duration}ms`,
    type: 'recording',
    recordingId: `pause-${duration}`,  // Reference to internal pause recording
    conditions: [],
    policy: {
      type: 'sequential',
      onError: 'stop',
      maxRetries: 0,
      maxConcurrency: 1
    },
    outputMapping: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  // Insert at position
  const newSteps = [
    ...workflow.steps.slice(0, position),
    pauseStep,
    ...workflow.steps.slice(position)
  ]
    .map((step, index) => ({
      ...step,
      order: index,  // Reindex all steps
      updatedAt: step.id === pauseStep.id ? new Date().toISOString() : step.updatedAt
    }));

  // Build edit history entry
  const editEntry: WorkflowEdit = {
    id: `edit-${Date.now()}`,
    timestamp: new Date().toISOString(),
    editor,
    action: 'step-inserted',
    details: {
      stepId: pauseStep.id,
      stepName: pauseStep.name,
      position,
      totalStepsAfter: newSteps.length,
      duration
    }
  };

  // Update metadata
  const newMetadata: WorkflowMetadata = {
    ...workflow.metadata,
    updatedAt: new Date().toISOString(),
    version: bumpVersion(workflow.metadata.version, 'patch'),
    // Add to edit history if enabled
    ...(trackHistory && {
      editHistory: [...(workflow.metadata.editHistory || []), editEntry]
    })
  };

  // Create new workflow with immutable updates
  const newWorkflow: Workflow = {
    ...workflow,
    steps: newSteps,
    metadata: newMetadata
  };

  // Validate the updated workflow
  validateWorkflow(newWorkflow);

  return newWorkflow;
}

/**
 * Update workflow metadata (name, description, tags)
 *
 * @param workflow - Original workflow
 * @param updates - Partial metadata to update
 * @param options - Edit options
 * @returns New workflow with updated metadata
 */
export function updateWorkflowMetadata(
  workflow: Workflow,
  updates: Partial<WorkflowMetadata>,
  options: EditOptions = {}
): Workflow {
  const { editor = 'system', trackHistory = true } = options;

  // Build edit history entry
  const editEntry: WorkflowEdit = {
    id: `edit-${Date.now()}`,
    timestamp: new Date().toISOString(),
    editor,
    action: 'metadata-updated',
    details: {
      updatedFields: Object.keys(updates),
      previousVersion: workflow.metadata.version
    }
  };

  // Update metadata with version bump
  const newMetadata: WorkflowMetadata = {
    ...workflow.metadata,
    name: updates.name ?? workflow.metadata.name,
    description: updates.description ?? workflow.metadata.description,
    tags: updates.tags ?? workflow.metadata.tags,
    updatedAt: new Date().toISOString(),
    version: bumpVersion(workflow.metadata.version, 'patch'),
    // Add to edit history if enabled
    ...(trackHistory && {
      editHistory: [...(workflow.metadata.editHistory || []), editEntry]
    })
  };

  // Create new workflow with immutable updates
  const newWorkflow: Workflow = {
    ...workflow,
    metadata: newMetadata
  };

  // Validate the updated workflow
  validateWorkflow(newWorkflow);

  return newWorkflow;
}

/**
 * Update a specific step's metadata (name, description, conditions)
 *
 * @param workflow - Original workflow
 * @param stepId - ID of step to update
 * @param updates - Partial step properties to update
 * @param options - Edit options
 * @returns New workflow with updated step
 * @throws Error if step not found
 */
export function updateStepMetadata(
  workflow: Workflow,
  stepId: string,
  updates: Partial<Pick<WorkflowStep, 'name' | 'description' | 'conditions'>>,
  options: EditOptions = {}
): Workflow {
  const { editor = 'system', trackHistory = true } = options;

  // Find step to update
  const stepIndex = workflow.steps.findIndex(s => s.id === stepId);
  if (stepIndex === -1) {
    throw new Error(`Step with ID "${stepId}" not found in workflow "${workflow.id}"`);
  }

  const oldStep = workflow.steps[stepIndex];

  // Build edit history entry
  const editEntry: WorkflowEdit = {
    id: `edit-${Date.now()}`,
    timestamp: new Date().toISOString(),
    editor,
    action: 'step-updated',
    details: {
      stepId,
      updatedFields: Object.keys(updates),
      previousStepName: oldStep.name
    }
  };

  // Create updated step
  const newStep: WorkflowStep = {
    ...oldStep,
    name: updates.name ?? oldStep.name,
    description: updates.description ?? oldStep.description,
    conditions: updates.conditions ?? oldStep.conditions,
    updatedAt: new Date().toISOString()
  };

  // Replace step in array
  const newSteps = [
    ...workflow.steps.slice(0, stepIndex),
    newStep,
    ...workflow.steps.slice(stepIndex + 1)
  ];

  // Update metadata
  const newMetadata: WorkflowMetadata = {
    ...workflow.metadata,
    updatedAt: new Date().toISOString(),
    version: bumpVersion(workflow.metadata.version, 'patch'),
    // Add to edit history if enabled
    ...(trackHistory && {
      editHistory: [...(workflow.metadata.editHistory || []), editEntry]
    })
  };

  // Create new workflow with immutable updates
  const newWorkflow: Workflow = {
    ...workflow,
    steps: newSteps,
    metadata: newMetadata
  };

  // Validate the updated workflow
  validateWorkflow(newWorkflow);

  return newWorkflow;
}

/**
 * Reorder steps in a workflow
 *
 * @param workflow - Original workflow
 * @param fromIndex - Current index of step to move
 * @param toIndex - Target index for step
 * @param options - Edit options
 * @returns New workflow with reordered steps
 */
export function reorderSteps(
  workflow: Workflow,
  fromIndex: number,
  toIndex: number,
  options: EditOptions = {}
): Workflow {
  const { editor = 'system', trackHistory = true } = options;

  // Validate indices
  if (fromIndex < 0 || fromIndex >= workflow.steps.length) {
    throw new Error(`Invalid fromIndex ${fromIndex}: must be between 0 and ${workflow.steps.length - 1}`);
  }

  if (toIndex < 0 || toIndex >= workflow.steps.length) {
    throw new Error(`Invalid toIndex ${toIndex}: must be between 0 and ${workflow.steps.length - 1}`);
  }

  if (fromIndex === toIndex) {
    return workflow;  // No change needed
  }

  // Create new steps array with reordered step
  const newSteps = [...workflow.steps];
  const [movedStep] = newSteps.splice(fromIndex, 1);
  newSteps.splice(toIndex, 0, movedStep);

  // Reindex all steps with new order
  const reindexedSteps = newSteps.map((step, index) => ({
    ...step,
    order: index,
    updatedAt: new Date().toISOString()
  }));

  // Build edit history entry
  const editEntry: WorkflowEdit = {
    id: `edit-${Date.now()}`,
    timestamp: new Date().toISOString(),
    editor,
    action: 'step-reordered',
    details: {
      fromIndex,
      toIndex,
      stepId: movedStep.id,
      stepName: movedStep.name,
      totalSteps: newSteps.length
    }
  };

  // Update metadata
  const newMetadata: WorkflowMetadata = {
    ...workflow.metadata,
    updatedAt: new Date().toISOString(),
    version: bumpVersion(workflow.metadata.version, 'patch'),
    // Add to edit history if enabled
    ...(trackHistory && {
      editHistory: [...(workflow.metadata.editHistory || []), editEntry]
    })
  };

  // Create new workflow with immutable updates
  const newWorkflow: Workflow = {
    ...workflow,
    steps: reindexedSteps,
    metadata: newMetadata
  };

  // Validate the updated workflow
  validateWorkflow(newWorkflow);

  return newWorkflow;
}

/**
 * Mark a step as optional
 *
 * @param workflow - Original workflow
 * @param stepId - ID of step to mark as optional
 * @param isOptional - Whether to mark as optional
 * @param options - Edit options
 * @returns New workflow with updated step
 */
export function markStepAsOptional(
  workflow: Workflow,
  stepId: string,
  isOptional: boolean,
  options: EditOptions = {}
): Workflow {
  const { editor = 'system', trackHistory = true } = options;

  // Find step to update
  const stepIndex = workflow.steps.findIndex(s => s.id === stepId);
  if (stepIndex === -1) {
    throw new Error(`Step with ID "${stepId}" not found in workflow "${workflow.id}"`);
  }

  const oldStep = workflow.steps[stepIndex];

  // Build edit history entry
  const editEntry: WorkflowEdit = {
    id: `edit-${Date.now()}`,
    timestamp: new Date().toISOString(),
    editor,
    action: 'step-optional-toggled',
    details: {
      stepId,
      stepName: oldStep.name,
      isOptional
    }
  };

  // Create updated step with output mapping for optional execution tracking
  const newStep: WorkflowStep = {
    ...oldStep,
    conditions: [
      ...(oldStep.conditions || []),
      {
        type: 'data-validation',
        schema: {
          type: 'object',
          properties: {
            optional: {
              type: 'boolean',
              const: isOptional
            }
          }
        }
      }
    ],
    outputMapping: {
      ...(oldStep.outputMapping || {}),
      optional: isOptional ? 'true' : 'false',
      executionStatus: isOptional ? 'optional' : 'required'
    },
    updatedAt: new Date().toISOString()
  };

  // Replace step in array
  const newSteps = [
    ...workflow.steps.slice(0, stepIndex),
    newStep,
    ...workflow.steps.slice(stepIndex + 1)
  ];

  // Update metadata
  const newMetadata: WorkflowMetadata = {
    ...workflow.metadata,
    updatedAt: new Date().toISOString(),
    version: bumpVersion(workflow.metadata.version, 'patch'),
    // Add to edit history if enabled
    ...(trackHistory && {
      editHistory: [...(workflow.metadata.editHistory || []), editEntry]
    })
  };

  // Create new workflow with immutable updates
  const newWorkflow: Workflow = {
    ...workflow,
    steps: newSteps,
    metadata: newMetadata
  };

  // Validate the updated workflow
  validateWorkflow(newWorkflow);

  return newWorkflow;
}

/**
 * Add conditional breakpoint to a step
 *
 * @param workflow - Original workflow
 * @param stepId - ID of step to add breakpoint to
 * @param condition - Condition type: 'always', 'on-failure', 'on-success', 'custom'
 * @param customCondition - Optional custom condition object
 * @param options - Edit options
 * @returns New workflow with breakpoint condition
 */
export function addConditionalBreakpoint(
  workflow: Workflow,
  stepId: string,
  condition: 'always' | 'on-failure' | 'on-success' | 'custom',
  customCondition?: any,
  options: EditOptions = {}
): Workflow {
  const { editor = 'system', trackHistory = true } = options;

  // Find step to update
  const stepIndex = workflow.steps.findIndex(s => s.id === stepId);
  if (stepIndex === -1) {
    throw new Error(`Step with ID "${stepId}" not found in workflow "${workflow.id}"`);
  }

  const oldStep = workflow.steps[stepIndex];

  // Build edit history entry
  const editEntry: WorkflowEdit = {
    id: `edit-${Date.now()}`,
    timestamp: new Date().toISOString(),
    editor,
    action: 'conditional-breakpoint-added',
    details: {
      stepId,
      stepName: oldStep.name,
      condition
    }
  };

  // Create condition based on breakpoint type
  const breakpointCondition: StepCondition = {
    type: 'if',
    variable: 'executionStatus',
    operator: condition === 'always' ? '===' :
              condition === 'on-failure' ? '===' :
              condition === 'on-success' ? '===' : 'custom',
    value: condition === 'always' ? 'pending' :
           condition === 'on-failure' ? 'failed' :
           condition === 'on-success' ? 'completed' : customCondition,
    invert: false
  };

  // Add condition to step
  const newStep: WorkflowStep = {
    ...oldStep,
    conditions: [
      ...(oldStep.conditions || []),
      breakpointCondition
    ],
    updatedAt: new Date().toISOString()
  };

  // Replace step in array
  const newSteps = [
    ...workflow.steps.slice(0, stepIndex),
    newStep,
    ...workflow.steps.slice(stepIndex + 1)
  ];

  // Update metadata
  const newMetadata: WorkflowMetadata = {
    ...workflow.metadata,
    updatedAt: new Date().toISOString(),
    version: bumpVersion(workflow.metadata.version, 'patch'),
    // Add to edit history if enabled
    ...(trackHistory && {
      editHistory: [...(workflow.metadata.editHistory || []), editEntry]
    })
  };

  // Create new workflow with immutable updates
  const newWorkflow: Workflow = {
    ...workflow,
    steps: newSteps,
    metadata: newMetadata
  };

  // Validate the updated workflow
  validateWorkflow(newWorkflow);

  return newWorkflow;
}

/**
 * Undo last edit to workflow (basic implementation)
 *
 * @param workflow - Current workflow
 * @returns { workflow: Workflow, lastEdit: WorkflowEdit | undefined }
 */
export function undoLastEdit(workflow: Workflow): { workflow: Workflow; lastEdit: WorkflowEdit | undefined } {
  const editHistory = workflow.metadata.editHistory || [];
  if (editHistory.length === 0) {
    return { workflow, lastEdit: undefined };
  }

  // In a full implementation, this would revert the edit
  // For now, just return the workflow and the last edit for the caller to handle
  const lastEdit = editHistory[editHistory.length - 1];

  // Create workflow without the last edit in history
  const newMetadata: WorkflowMetadata = {
    ...workflow.metadata,
    editHistory: editHistory.slice(0, -1)
  };

  const newWorkflow: Workflow = {
    ...workflow,
    metadata: newMetadata
  };

  return { workflow: newWorkflow, lastEdit };
}

/**
 * Redo edit (basic implementation - just adds edit back to history)
 *
 * @param workflow - Current workflow
 * @param edit - Edit to redo
 * @returns New workflow with edit re-added to history
 */
export function redoEdit(workflow: Workflow, edit: WorkflowEdit): Workflow {
  const newMetadata: WorkflowMetadata = {
    ...workflow.metadata,
    editHistory: [...(workflow.metadata.editHistory || []), edit]
  };

  const newWorkflow: Workflow = {
    ...workflow,
    metadata: newMetadata
  };

  // Note: This doesn't actually re-apply the edit action
  // A full undo/redo system would need to store the previous state
  return newWorkflow;
}

/**
 * Bump semantic version
 *
 * @param version - Current version (e.g., "1.2.3")
 * @param level - Level to bump: 'major', 'minor', or 'patch'
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