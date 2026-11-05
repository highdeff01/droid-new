/**
 * Pack Workflow Management Service
 *
 * Manages workflow operations within packs including:
 * - Adding workflows with validation and duplicate detection
 * - Removing workflows with integrity checks
 * - Reordering workflows within packs
 * - Resolving workflow references to full Workflow objects
 * - Batch operations for efficient processing
 * - Validation against deployment policies
 *
 * Key Features:
 * - Workflow compatibility validation
 * - Duplicate workflow ID prevention
 * - Audit trail for all modifications
 * - Version tracking and management
 * - Workflow reference caching for performance
 * - Graceful handling of missing workflows
 */

import {
  Pack,
  WorkflowReference,
  DeploymentPolicy,
  validateWorkflowReferences,
  validateDeploymentPolicy,
  createPackManifest,
} from '../../../../pack-types';
import { Workflow } from '../../../../workflow-types';
import { EntityId, Timestamp } from '../../../../integration-types';

/**
 * Options for workflow validation.
 */
export interface WorkflowValidationOptions {
  /** Validate workflow compatibility with deployment policy */
  validateCompatibility?: boolean;

  /** Check for duplicate workflow IDs */
  checkDuplicates?: boolean;

  /** Validate that workflows exist (if resolver is available) */
  validateExistence?: boolean;
}

/**
 * Audit entry for workflow operations.
 */
export interface WorkflowAuditEntry {
  /** Timestamp of the operation */
  timestamp: Timestamp;

  /** User or system performing the operation */
  actor: string;

  /** Type of operation */
  operation: 'add' | 'remove' | 'reorder' | 'resolve';

  /** Pack ID affected */
  packId: EntityId;

  /** Workflow IDs involved */
  workflowIds: string[];

  /** Previous version of the pack */
  previousVersion?: string;

  /** New version of the pack */
  newVersion?: string;

  /** Additional operation details */
  details: Record<string, any>;
}

/**
 * Result of a workflow resolution operation.
 */
export interface WorkflowResolutionResult {
  /** Resolved workflow */
  workflow: Workflow;

  /** Whether the workflow was retrieved from cache */
  cached: boolean;

  /** Any warnings encountered during resolution */
  warnings?: string[];
}

/**
 * Batch operation result.
 */
export interface BatchOperationResult {
  /** Number of successfully processed items */
  successful: number;

  /** Number of failed items */
  failed: number;

  /** Array of error messages for failed items */
  errors: string[];

  /** Updated pack if operation succeeded */
  pack?: Pack;
}

/**
 * Pack Workflow Manager Service
 *
 * Manages all workflow-related operations for packs including adding, removing,
 * reordering, and resolving workflows with full validation and audit trails.
 */
export class PackWorkflowManager {
  /** Storage of packs (provided by external manager) */
  private packs: Map<EntityId, Pack>;

  /** Workflow repository for reference resolution */
  private workflowRepository?: Map<string, Workflow>;

  /** Cache for resolved workflows */
  private workflowCache: Map<string, Workflow> = new Map();

  /** Audit trail for workflow operations */
  private auditLog: WorkflowAuditEntry[] = [];

  /**
   * Creates a new PackWorkflowManager instance.
   *
   * @param packsStorage - Map of packs (provided by PackManager)
   * @param workflowRepository - Optional workflow repository for resolution
   */
  constructor(
    packsStorage: Map<EntityId, Pack>,
    workflowRepository?: Map<string, Workflow>,
  ) {
    this.packs = packsStorage;
    this.workflowRepository = workflowRepository;
  }

  /**
   * Adds a workflow to a pack with validation.
   *
   * Operations:
   * - Validates workflow reference
   * - Checks for duplicate workflow IDs
   * - Validates compatibility with deployment policy
   * - Appends workflow to manifest
   * - Bumps version number
   * - Records audit entry
   *
   * @param packId - Pack ID to update
   * @param workflow - Workflow reference to add
   * @param actor - User or system adding the workflow
   * @param options - Validation options
   * @returns Updated Pack object
   * @throws Error if validation fails or pack not found
   */
  addWorkflow(
    packId: EntityId,
    workflow: WorkflowReference,
    actor: string,
    options: WorkflowValidationOptions = {},
  ): Pack {
    const pack = this.getPack(packId);
    const now = new Date().toISOString() as Timestamp;
    const previousVersion = pack.version.version;

    // Validate workflow reference
    this.validateWorkflowReference(workflow);

    // Check for duplicates
    if (options.checkDuplicates !== false) {
      this.checkForDuplicateWorkflow(pack, workflow.workflowId);
    }

    // Validate compatibility with deployment policy
    if (options.validateCompatibility !== false) {
      this.validateWorkflowCompatibility(workflow, pack.manifest.policy);
    }

    // Add workflow to manifest
    const updatedWorkflows = [...pack.manifest.workflows, workflow];
    pack.manifest.workflows = updatedWorkflows;

    // Update modification timestamp
    pack.metadata.updatedAt = now;

    // Bump patch version
    pack.version.version = this.bumpPatchVersion(pack.version.version);
    pack.version.releasedAt = now;

    // Store updated pack
    this.packs.set(packId, pack);

    // Record audit entry
    this.addAuditEntry({
      timestamp: now,
      actor,
      operation: 'add',
      packId,
      workflowIds: [workflow.workflowId],
      previousVersion,
      newVersion: pack.version.version,
      details: {
        workflowId: workflow.workflowId,
        version: workflow.version,
        optional: workflow.optional,
        position: updatedWorkflows.length - 1,
        totalWorkflows: updatedWorkflows.length,
      },
    });

    return pack;
  }

  /**
   * Removes a workflow from a pack.
   *
   * Operations:
   * - Validates workflow exists in pack
   * - Prevents removal of last workflow
   * - Updates manifest
   * - Bumps version number
   * - Records audit entry
   *
   * @param packId - Pack ID to update
   * @param workflowId - ID of workflow to remove
   * @param actor - User or system removing the workflow
   * @returns Updated Pack object
   * @throws Error if workflow not found, pack not found, or would leave pack empty
   */
  removeWorkflow(packId: EntityId, workflowId: string, actor: string): Pack {
    const pack = this.getPack(packId);
    const now = new Date().toISOString() as Timestamp;
    const previousVersion = pack.version.version;

    // Check if workflow exists in pack
    const workflowIndex = pack.manifest.workflows.findIndex(
      (w) => w.workflowId === workflowId,
    );

    if (workflowIndex === -1) {
      throw new Error(
        `Workflow not found in pack: ${workflowId}`,
      );
    }

    // Prevent removing last workflow
    if (pack.manifest.workflows.length <= 1) {
      throw new Error(
        'Cannot remove last workflow from pack. A pack must contain at least one workflow.',
      );
    }

    // Remove workflow from manifest
    const updatedWorkflows = pack.manifest.workflows.filter(
      (w) => w.workflowId !== workflowId,
    );
    pack.manifest.workflows = updatedWorkflows;

    // Update modification timestamp
    pack.metadata.updatedAt = now;

    // Bump patch version
    pack.version.version = this.bumpPatchVersion(pack.version.version);
    pack.version.releasedAt = now;

    // Store updated pack
    this.packs.set(packId, pack);

    // Record audit entry
    this.addAuditEntry({
      timestamp: now,
      actor,
      operation: 'remove',
      packId,
      workflowIds: [workflowId],
      previousVersion,
      newVersion: pack.version.version,
      details: {
        workflowId,
        removedIndex: workflowIndex,
        remainingWorkflows: updatedWorkflows.length,
      },
    });

    return pack;
  }

  /**
   * Reorders workflows within a pack.
   *
   * Operations:
   * - Validates all workflows are present and accounted for
   * - Updates workflow ordering in manifest
   * - Bumps version number
   * - Records audit entry
   *
   * @param packId - Pack ID to update
   * @param workflowIds - Ordered list of workflow IDs
   * @param actor - User or system reordering workflows
   * @returns Updated Pack object
   * @throws Error if workflow IDs don't match pack contents
   */
  reorderWorkflows(
    packId: EntityId,
    workflowIds: string[],
    actor: string,
  ): Pack {
    const pack = this.getPack(packId);
    const now = new Date().toISOString() as Timestamp;
    const previousVersion = pack.version.version;

    // Validate workflow count
    if (workflowIds.length !== pack.manifest.workflows.length) {
      throw new Error(
        `Workflow count mismatch: provided ${workflowIds.length}, pack contains ${pack.manifest.workflows.length}`,
      );
    }

    // Validate all workflow IDs are present
    const currentIds = new Set(pack.manifest.workflows.map((w) => w.workflowId));
    const newIds = new Set(workflowIds);

    if (currentIds.size !== newIds.size || ![...currentIds].every((id) => newIds.has(id))) {
      throw new Error('Workflow ID mismatch: provided IDs do not match pack workflows');
    }

    // Create reordered workflow list
    const workflowMap = new Map(
      pack.manifest.workflows.map((w) => [w.workflowId, w]),
    );

    const reorderedWorkflows: WorkflowReference[] = [];
    for (const id of workflowIds) {
      const workflow = workflowMap.get(id);
      if (!workflow) {
        throw new Error(`Workflow not found in pack: ${id}`);
      }
      reorderedWorkflows.push(workflow);
    }

    // Update manifest with reordered workflows
    pack.manifest.workflows = reorderedWorkflows;

    // Update modification timestamp
    pack.metadata.updatedAt = now;

    // Bump patch version
    pack.version.version = this.bumpPatchVersion(pack.version.version);
    pack.version.releasedAt = now;

    // Store updated pack
    this.packs.set(packId, pack);

    // Record audit entry
    this.addAuditEntry({
      timestamp: now,
      actor,
      operation: 'reorder',
      packId,
      workflowIds,
      previousVersion,
      newVersion: pack.version.version,
      details: {
        newOrder: workflowIds,
        totalWorkflows: workflowIds.length,
      },
    });

    return pack;
  }

  /**
   * Resolves a single workflow reference to a full Workflow object.
   *
   * Features:
   * - Returns cached workflows when available
   * - Queries workflow repository if available
   * - Handles missing workflows gracefully with warnings
   * - Updates cache with newly resolved workflows
   *
   * @param workflowRef - Workflow reference to resolve
   * @returns Resolution result with workflow and cache status
   * @throws Error if workflow cannot be resolved
   */
  resolveWorkflowReference(workflowRef: WorkflowReference): WorkflowResolutionResult {
    const warnings: string[] = [];

    // Check cache first
    const cached = this.workflowCache.get(workflowRef.workflowId);
    if (cached) {
      return {
        workflow: cached,
        cached: true,
        warnings,
      };
    }

    // Try to resolve from repository
    if (!this.workflowRepository) {
      const warning = `No workflow repository available. Cannot resolve workflow ${workflowRef.workflowId}`;
      warnings.push(warning);

      if (workflowRef.optional) {
        return {
          workflow: this.createPlaceholderWorkflow(workflowRef.workflowId),
          cached: false,
          warnings,
        };
      }

      throw new Error(`Workflow not found: ${workflowRef.workflowId}`);
    }

    const workflow = this.workflowRepository.get(workflowRef.workflowId);
    if (!workflow) {
      const warning = `Workflow not found in repository: ${workflowRef.workflowId}`;
      warnings.push(warning);

      if (workflowRef.optional) {
        return {
          workflow: this.createPlaceholderWorkflow(workflowRef.workflowId),
          cached: false,
          warnings,
        };
      }

      throw new Error(`Workflow not found: ${workflowRef.workflowId}`);
    }

    // Validate version if specified
    if (workflowRef.version && !this.versionSatisfies(workflow.metadata.version, workflowRef.version)) {
      const warning = `Workflow version mismatch: ${workflow.metadata.version} does not satisfy constraint ${workflowRef.version}`;
      warnings.push(warning);

      if (!workflowRef.optional) {
        throw new Error(warning);
      }
    }

    // Cache the resolved workflow
    this.workflowCache.set(workflowRef.workflowId, workflow);

    return {
      workflow,
      cached: false,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Resolves multiple workflow references in batch.
   *
   * Features:
   * - Resolves all workflows in a single operation
   * - Handles partial failures gracefully
   * - Returns successful resolutions and errors
   * - Updates cache for all resolved workflows
   *
   * @param workflowRefs - Array of workflow references to resolve
   * @returns Batch operation result with resolved workflows
   */
  resolveWorkflowsBatch(workflowRefs: WorkflowReference[]): BatchOperationResult & {
    resolved: WorkflowResolutionResult[];
  } {
    const resolved: WorkflowResolutionResult[] = [];
    const errors: string[] = [];
    let successful = 0;
    let failed = 0;

    for (const ref of workflowRefs) {
      try {
        const result = this.resolveWorkflowReference(ref);
        resolved.push(result);
        successful++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${ref.workflowId}: ${message}`);
        failed++;
      }
    }

    return {
      successful,
      failed,
      errors,
      resolved,
    };
  }

  /**
   * Gets all workflows in a pack with full resolution.
   *
   * @param packId - Pack ID to get workflows for
   * @returns Array of resolved workflows
   * @throws Error if pack not found
   */
  getPackWorkflows(packId: EntityId): Workflow[] {
    const pack = this.getPack(packId);

    return pack.manifest.workflows.map((ref) => {
      try {
        const result = this.resolveWorkflowReference(ref);
        return result.workflow;
      } catch (error) {
        // Return placeholder for unresolvable workflows
        return this.createPlaceholderWorkflow(ref.workflowId);
      }
    });
  }

  /**
   * Gets workflow references for a pack without resolution.
   *
   * @param packId - Pack ID to get references for
   * @returns Array of workflow references
   * @throws Error if pack not found
   */
  getPackWorkflowReferences(packId: EntityId): WorkflowReference[] {
    const pack = this.getPack(packId);
    return pack.manifest.workflows;
  }

  /**
   * Validates that a workflow is compatible with a deployment policy.
   *
   * @param workflow - Workflow reference to validate
   * @param policy - Deployment policy
   * @throws Error if workflow is incompatible
   */
  validateWorkflowCompatibility(
    workflow: WorkflowReference,
    policy: DeploymentPolicy,
  ): void {
    // Validate deployment policy itself
    validateDeploymentPolicy(policy);

    // Check optional workflows with stop-on-error policies
    if (workflow.optional && policy.mode === 'sequential' && policy.stopOnError === true) {
      throw new Error(
        'Optional workflows are incompatible with sequential deployment policy that stops on error',
      );
    }
  }

  /**
   * Gets the audit trail for workflow operations.
   *
   * @param packId - Optional pack ID to filter by
   * @returns Array of audit entries
   */
  getWorkflowAuditLog(packId?: EntityId): WorkflowAuditEntry[] {
    if (packId) {
      return this.auditLog.filter((entry) => entry.packId === packId);
    }
    return this.auditLog;
  }

  /**
   * Clears the workflow cache.
   */
  clearWorkflowCache(): void {
    this.workflowCache.clear();
  }

  /**
   * Gets cache statistics.
   *
   * @returns Cache statistics
   */
  getCacheStats(): {
    cachedWorkflows: number;
    cacheKeys: string[];
  } {
    return {
      cachedWorkflows: this.workflowCache.size,
      cacheKeys: Array.from(this.workflowCache.keys()),
    };
  }

  // ========================================================================
  // Private Helper Methods
  // ========================================================================

  /**
   * Gets a pack from storage, with error handling.
   *
   * @param packId - Pack ID to retrieve
   * @returns Pack object
   * @throws Error if pack not found
   * @private
   */
  private getPack(packId: EntityId): Pack {
    const pack = this.packs.get(packId);
    if (!pack) {
      throw new Error(`Pack not found: ${packId}`);
    }
    return pack;
  }

  /**
   * Validates a workflow reference.
   *
   * @param workflow - Workflow reference to validate
   * @throws Error if validation fails
   * @private
   */
  private validateWorkflowReference(workflow: WorkflowReference): void {
    validateWorkflowReferences([workflow]);
  }

  /**
   * Checks for duplicate workflow IDs in a pack.
   *
   * @param pack - Pack to check
   * @param workflowId - Workflow ID to check for
   * @throws Error if duplicate found
   * @private
   */
  private checkForDuplicateWorkflow(pack: Pack, workflowId: string): void {
    const exists = pack.manifest.workflows.some((w) => w.workflowId === workflowId);
    if (exists) {
      throw new Error(
        `Duplicate workflow ID: workflow "${workflowId}" is already in pack`,
      );
    }
  }

  /**
   * Bumps the patch version by 1.
   *
   * @param version - Current version (e.g., "1.0.0")
   * @returns New version (e.g., "1.0.1")
   * @private
   */
  private bumpPatchVersion(version: string): string {
    const parts = version.split('.');
    if (parts.length !== 3) {
      throw new Error(`Invalid version format: ${version}`);
    }

    const patch = parseInt(parts[2], 10);
    parts[2] = String(patch + 1);

    return parts.join('.');
  }

  /**
   * Adds an audit entry to the audit log.
   *
   * @param entry - Audit entry to add
   * @private
   */
  private addAuditEntry(entry: WorkflowAuditEntry): void {
    this.auditLog.push(entry);
  }

  /**
   * Creates a placeholder workflow for unresolvable references.
   *
   * @param workflowId - Workflow ID for placeholder
   * @returns Placeholder Workflow object
   * @private
   */
  private createPlaceholderWorkflow(workflowId: string): Workflow {
    const now = new Date().toISOString();
    return {
      id: workflowId,
      name: `Placeholder: ${workflowId}`,
      description: 'Placeholder workflow for unresolved reference',
      steps: [],
      metadata: {
        createdAt: now,
        updatedAt: now,
        version: '0.0.0',
        source: 'ai-generated',
        executionCount: 0,
        successCount: 0,
        failureCount: 0,
      },
    };
  }

  /**
   * Checks if a version string satisfies a version range constraint.
   *
   * @param version - Semantic version to check (e.g., "1.2.3")
   * @param range - Version range constraint (e.g., "^1.0.0")
   * @returns true if version satisfies the range, false otherwise
   * @private
   */
  private versionSatisfies(version: string, range: string): boolean {
    // Parse version into components
    const versionMatch = version.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!versionMatch) {
      return false;
    }

    const [, major, minor, patch] = versionMatch.map(Number);

    // Handle exact version match
    if (/^\d+\.\d+\.\d+/.test(range)) {
      const rangeMatch = range.match(/^(\d+)\.(\d+)\.(\d+)/);
      if (rangeMatch) {
        const [, rmajor, rminor, rpatch] = rangeMatch.map(Number);
        return major === rmajor && minor === rminor && patch === rpatch;
      }
    }

    // Handle caret range (^1.0.0)
    if (range.startsWith('^')) {
      const rangeMatch = range.slice(1).match(/^(\d+)\.(\d+)\.(\d+)/);
      if (rangeMatch) {
        const [, rmajor, rminor] = rangeMatch.map(Number);
        if (rmajor === 0) {
          // ^0.1.0 means >=0.1.0 and <0.2.0
          return (
            major === 0 &&
            minor === rminor &&
            patch >= parseInt(rangeMatch[3], 10)
          );
        }
        // ^1.0.0 means >=1.0.0 and <2.0.0
        return (
          major === rmajor &&
          (minor > rminor ||
            (minor === rminor && patch >= parseInt(rangeMatch[3], 10)))
        );
      }
    }

    // Handle tilde range (~1.2.0)
    if (range.startsWith('~')) {
      const rangeMatch = range.slice(1).match(/^(\d+)\.(\d+)\.(\d+)/);
      if (rangeMatch) {
        const [, rmajor, rminor, rpatch] = rangeMatch.map(Number);
        // ~1.2.0 means >=1.2.0 and <1.3.0
        return major === rmajor && minor === rminor && patch >= rpatch;
      }
    }

    // Handle wildcard range (1.2.x)
    if (range.includes('.x')) {
      const rangeMatch = range.match(/^(\d+)\.(\d+)\.x$/);
      if (rangeMatch) {
        const [, rmajor, rminor] = rangeMatch.map(Number);
        return major === rmajor && minor === rminor;
      }
    }

    return false;
  }
}

/**
 * Creates a new PackWorkflowManager instance.
 *
 * @param packsStorage - Map of packs (provided by PackManager)
 * @param workflowRepository - Optional workflow repository for resolution
 * @returns New PackWorkflowManager instance
 */
export function createPackWorkflowManager(
  packsStorage: Map<EntityId, Pack>,
  workflowRepository?: Map<string, Workflow>,
): PackWorkflowManager {
  return new PackWorkflowManager(packsStorage, workflowRepository);
}

