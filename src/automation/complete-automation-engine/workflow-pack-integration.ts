/**
 * Workflow-Pack Integration Module
 *
 * Provides integration between Workflow and Pack systems:
 * - Validates workflow compatibility when adding to pack
 * - Emits PackModifiedEvent when workflows are added/removed
 * - Updates pack version and metadata
 * - Supports workflow reference integrity checks
 *
 * Integration Points:
 * - Uses EventDispatcher to emit PackModifiedEvent
 * - Validates workflow references against existing workflows
 * - Manages semantic versioning for pack updates
 * - Tracks workflow reference dependencies
 */

import type { Pack, WorkflowReference, PackManifest, PackVersion, PackMetadata } from './pack-types';
import type { Workflow } from './workflow-types';
import type { EventDispatcher } from './event-dispatcher';

/**
 * Workflow compatibility validation result.
 *
 * Indicates whether a workflow is compatible with a pack and why.
 */
export interface WorkflowCompatibilityResult {
  /** Whether the workflow is compatible */
  compatible: boolean;
  
  /** Validation errors if incompatible */
  errors: string[];
  
  /** Validation warnings (non-blocking) */
  warnings?: string[];
}

/**
 * Workflow reference integrity check result.
 *
 * Indicates whether all referenced workflows exist and are valid.
 */
export interface ReferenceIntegrityResult {
  /** Whether all references are valid */
  valid: boolean;
  
  /** Missing workflow IDs */
  missingWorkflows: string[];
  
  /** Invalid workflow references */
  invalidReferences: Array<{ ref: WorkflowReference; error: string }>;
}

/**
 * Pack modification result.
 *
 * Provides details about the modification that occurred.
 */
export interface PackModificationResult {
  /** The modified pack */
  pack: Pack;
  
  /** Type of modification */
  modificationType: 'workflow-added' | 'workflow-removed' | 'metadata-updated' | 'version-updated';
  
  /** IDs of affected workflows */
  affectedWorkflowIds: string[];
  
  /** Previous version */
  previousVersion: string;
  
  /** New version */
  newVersion: string;
}

/**
 * Validates that a workflow is compatible with a pack.
 *
 * Compatibility checks:
 * - Workflow ID uniqueness within pack
 * - Workflow version constraint compatibility
 *
 * @param workflow - Workflow to validate
 * @param pack - Pack to add workflow to
 * @param workflowRef - Workflow reference
 * @returns WorkflowCompatibilityResult with validation results
 */
export function validateWorkflowCompatibility(
  workflow: Workflow,
  pack: Pack,
  workflowRef: WorkflowReference
): WorkflowCompatibilityResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check if workflow ID already exists in pack
  const existingWorkflow = pack.manifest.workflows.find(
    ref => ref.workflowId === workflowRef.workflowId
  );
  
  if (existingWorkflow) {
    errors.push(
      `Workflow "${workflowRef.workflowId}" already exists in pack`
    );
  }

  // Check for duplicate workflow IDs in existing pack workflows
  const existingIds = pack.manifest.workflows.map(ref => ref.workflowId);
  const hasDuplicates = new Set(existingIds).size !== existingIds.length;
  
  if (hasDuplicates) {
    warnings.push(
      `Pack contains duplicate workflow IDs. Consider unique IDs for clarity.`
    );
  }

  // Check version constraint if specified
  if (workflowRef.version) {
    // Validate version constraint format
    const validPatterns = [
      /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/, // Exact: 1.0.0 or 1.0.0-beta
      /^\^/, // Caret: ^1.0.0
      /^~/, // Tilde: ~1.0.0
      /^>=/, // Greater than or equal: >=1.0.0
      /^<=/, // Less than or equal: <=1.0.0
      /^>/, // Greater than: >1.0.0
      /^</, // Less than: <1.0.0
      /^=/, // Equal: =1.0.0
      /^\d+\.\d+\.x$/, // Wildcard: 1.2.x
    ];

    if (!validPatterns.some(pattern => pattern.test(workflowRef.version))) {
      errors.push(
        `Invalid version constraint "${workflowRef.version}" for workflow "${workflowRef.workflowId}"`
      );
    }
  }

  return {
    compatible: errors.length === 0,
    errors,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Validates workflow reference integrity for a pack.
 *
 * Checks:
 * - All referenced workflow IDs exist in the workflows map
 * - Workflow references are properly formatted
 *
 * @param pack - Pack to validate
 * @param workflows - Map of available workflows by ID
 * @returns ReferenceIntegrityResult with validation results
 */
export function checkWorkflowReferenceIntegrity(
  pack: Pack,
  workflows: Map<string, Workflow>
): ReferenceIntegrityResult {
  const missingWorkflows: string[] = [];
  const invalidReferences: Array<{ ref: WorkflowReference; error: string }> = [];

  for (const workflowRef of pack.manifest.workflows) {
    // Check if workflow exists
    if (!workflows.has(workflowRef.workflowId)) {
      missingWorkflows.push(workflowRef.workflowId);
      continue;
    }

    // Check version constraint if specified
    if (workflowRef.version) {
      // Validate version constraint format
      const validPatterns = [
        /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/, // Exact: 1.0.0 or 1.0.0-beta
        /^\^/, // Caret: ^1.0.0
        /^~/, // Tilde: ~1.0.0
        /^>=/, // Greater than or equal: >=1.0.0
        /^<=/, // Less than or equal: <=1.0.0
        /^>/, // Greater than: >1.0.0
        /^</, // Less than: <1.0.0
        /^=/, // Equal: =1.0.0
        /^\d+\.\d+\.x$/, // Wildcard: 1.2.x
      ];

      if (!validPatterns.some(pattern => pattern.test(workflowRef.version))) {
        invalidReferences.push({
          ref: workflowRef,
          error: `Invalid version constraint: "${workflowRef.version}"`
        });
      }
    }
  }

  return {
    valid: missingWorkflows.length === 0 && invalidReferences.length === 0,
    missingWorkflows,
    invalidReferences,
  };
}

/**
 * Updates pack version based on modification type.
 *
 * Version bumping rules:
 * - Minor: New features (workflows added)
 * - Patch: Backward compatible (workflows removed, metadata updates)
 *
 * @param pack - Pack to update
 * @param modificationType - Type of modification that occurred
 * @returns Updated PackVersion
 */
export function updatePackVersion(
  pack: Pack,
  modificationType: 'workflow-added' | 'workflow-removed' | 'metadata-updated'
): PackVersion {
  const currentVersion = pack.version.version;
  
  // Parse version components
  const versionMatch = currentVersion.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!versionMatch) {
    throw new Error(`Invalid version format: "${currentVersion}"`);
  }

  const [, major, minor, patch] = versionMatch.map(Number);
  
  let newMajor = major;
  let newMinor = minor;
  let newPatch = patch;

  switch (modificationType) {
    case 'workflow-added':
      // New feature - increment minor version
      newMinor += 1;
      newPatch = 0;
      break;
      
    case 'workflow-removed':
    case 'metadata-updated':
      // Backward compatible changes - increment patch version
      newPatch += 1;
      break;
  }

  const newVersionString = `${newMajor}.${newMinor}.${newPatch}`;
  
  // Create new version record
  const newVersion: PackVersion = {
    version: newVersionString,
    releasedAt: new Date().toISOString(),
    changelog: `Version ${newMajor}.${newMinor}.${newPatch}: ${modificationType}`,
    compatibleWith: pack.version.compatibleWith,
    deprecated: pack.version.deprecated,
    prerelease: pack.version.prerelease,
  };

  return newVersion;
}

/**
 * Updates pack metadata with modification timestamp.
 *
 * @param pack - Pack to update
 * @param modificationType - Type of modification
 * @param affectedWorkflowIds - IDs of workflows affected by modification
 * @returns Updated PackMetadata
 */
export function updatePackMetadata(
  pack: Pack,
  modificationType: 'workflow-added' | 'workflow-removed' | 'metadata-updated',
  affectedWorkflowIds: string[]
): PackMetadata {
  return {
    ...pack.metadata,
    updatedAt: new Date().toISOString(),
    description: pack.metadata.description || `Pack containing ${pack.manifest.workflows.length} workflows`,
  };
}

/**
 * Adds a workflow to a pack.
 *
 * This function:
 * 1. Validates workflow compatibility
 * 2. Updates pack manifest with new workflow reference
 * 3. Updates pack version
 * 4. Updates pack metadata
 * 5. Emits PackModifiedEvent
 *
 * @param pack - Existing pack
 * @param workflow - Workflow to add
 * @param workflowRef - Optional workflow reference with version constraint
 * @param workflowDispatcher - Event dispatcher for emitting events
 * @returns PackModificationResult with modified pack and event details
 */
export function addWorkflowToPack(
  pack: Pack,
  workflow: Workflow,
  workflowRef?: WorkflowReference,
  workflowDispatcher?: EventDispatcher
): PackModificationResult {
  // Create workflow reference if not provided
  const ref = workflowRef || {
    workflowId: workflow.id,
  };

  // Validate compatibility
  const compatibilityResult = validateWorkflowCompatibility(workflow, pack, ref);
  
  if (!compatibilityResult.compatible) {
    throw new Error(
      `Workflow "${workflow.id}" cannot be added to pack "${pack.id}":\n` +
      compatibilityResult.errors.map(e => `  - ${e}`).join('\n')
    );
  }

  // Clone pack to avoid mutation
  const updatedPack = { ...pack };
  
  // Add workflow reference to manifest
  updatedPack.manifest = {
    ...pack.manifest,
    workflows: [...pack.manifest.workflows, ref],
  };

  // Update version and metadata
  updatedPack.version = updatePackVersion(updatedPack, 'workflow-added');
  updatedPack.metadata = updatePackMetadata(updatedPack, 'workflow-added', [workflow.id]);

  // Emit PackModifiedEvent
  if (workflowDispatcher) {
    workflowDispatcher.emit({
      type: 'PackModified',
      packId: pack.id,
      changes: {
        modification: 'workflow-added',
        previousVersion: pack.version.version,
        newVersion: updatedPack.version.version,
        affectedWorkflowIds: [workflow.id],
      },
    } as any);
  }

  return {
    pack: updatedPack,
    modificationType: 'workflow-added',
    affectedWorkflowIds: [workflow.id],
    previousVersion: pack.version.version,
    newVersion: updatedPack.version.version,
  };
}

/**
 * Removes a workflow from a pack.
 *
 * This function:
 * 1. Validates workflow exists in pack
 * 2. Removes workflow reference from pack manifest
 * 3. Updates pack version
 * 4. Updates pack metadata
 * 5. Emits PackModifiedEvent
 *
 * @param pack - Existing pack
 * @param workflowId - ID of workflow to remove
 * @param workflowDispatcher - Event dispatcher for emitting events
 * @returns PackModificationResult with modified pack and event details
 */
export function removeWorkflowFromPack(
  pack: Pack,
  workflowId: string,
  workflowDispatcher?: EventDispatcher
): PackModificationResult {
  // Find workflow reference to remove
  const workflowIndex = pack.manifest.workflows.findIndex(
    ref => ref.workflowId === workflowId
  );

  if (workflowIndex === -1) {
    throw new Error(
      `Workflow "${workflowId}" not found in pack "${pack.id}"`
    );
  }

  // Clone pack to avoid mutation
  const updatedPack = { ...pack };
  
  // Remove workflow reference
  const remainingWorkflows = pack.manifest.workflows.filter(ref => ref.workflowId !== workflowId);

  updatedPack.manifest = {
    ...pack.manifest,
    workflows: remainingWorkflows,
  };

  // Update version and metadata
  updatedPack.version = updatePackVersion(updatedPack, 'workflow-removed');
  updatedPack.metadata = updatePackMetadata(updatedPack, 'workflow-removed', [workflowId]);

  // Emit PackModifiedEvent
  if (workflowDispatcher) {
    workflowDispatcher.emit({
      type: 'PackModified',
      packId: pack.id,
      changes: {
        modification: 'workflow-removed',
        previousVersion: pack.version.version,
        newVersion: updatedPack.version.version,
        affectedWorkflowIds: [workflowId],
      },
    } as any);
  }

  return {
    pack: updatedPack,
    modificationType: 'workflow-removed',
    affectedWorkflowIds: [workflowId],
    previousVersion: pack.version.version,
    newVersion: updatedPack.version.version,
  };
}

/**
 * Creates a new pack with a single workflow.
 *
 * @param id - Unique pack identifier
 * @param name - Human-readable pack name
 * @param workflow - Workflow to include in pack
 * @param metadata - Pack metadata
 * @returns Created Pack object
 */
export function createPackWithWorkflow(
  id: string,
  name: string,
  workflow: Workflow,
  metadata: PackMetadata = {
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    author: 'anonymous',
    description: `Pack containing workflow "${workflow.name}"`,
    tags: [],
  }
): Pack {
  const workflowRef: WorkflowReference = {
    workflowId: workflow.id,
  };

  return {
    id,
    name,
    manifest: {
      workflows: [workflowRef],
      policy: {
        mode: 'sequential',
      },
    },
    version: {
      version: '1.0.0',
      releasedAt: new Date().toISOString(),
      changelog: 'Initial version',
    },
    metadata,
  };
}

/**
 * Updates pack metadata without modifying workflows.
 *
 * @param pack - Pack to update
 * @param updates - Metadata updates to apply
 * @param workflowDispatcher - Event dispatcher for emitting events
 * @returns PackModificationResult with modified pack and event details
 */
export function updatePackMetadataOnly(
  pack: Pack,
  updates: Partial<PackMetadata>,
  workflowDispatcher?: EventDispatcher
): PackModificationResult {
  // Clone pack to avoid mutation
  const updatedPack = { ...pack };
  
  // Update metadata
  updatedPack.metadata = {
    ...pack.metadata,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  // Update version (patch bump for metadata updates)
  updatedPack.version = updatePackVersion(updatedPack, 'metadata-updated');

  // Emit PackModifiedEvent
  if (workflowDispatcher) {
    workflowDispatcher.emit({
      type: 'PackModified',
      packId: pack.id,
      changes: {
        modification: 'metadata-updated',
        previousVersion: pack.version.version,
        newVersion: updatedPack.version.version,
        affectedWorkflowIds: [],
      },
    } as any);
  }

  return {
    pack: updatedPack,
    modificationType: 'metadata-updated',
    affectedWorkflowIds: [],
    previousVersion: pack.version.version,
    newVersion: updatedPack.version.version,
  };
}
