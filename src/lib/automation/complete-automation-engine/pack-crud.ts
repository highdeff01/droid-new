/**
 * Pack CRUD Operations Service
 *
 * Provides Create, Read, Update, Delete operations for managing Packs.
 * Implements version control, metadata management, and workflow reference handling.
 *
 * Key Features:
 * - Create packs with automatic version initialization (1.0.0)
 * - Read packs by ID with full metadata and workflow references
 * - Update pack metadata and workflow lists
 * - Delete with soft (archive) and hard delete options
 * - Batch operations for efficient bulk retrieval
 * - Audit trail and history maintenance
 */

import {
  Pack,
  PackMetadata,
  PackVersion,
  WorkflowReference,
  DeploymentPolicy,
  PackManifest,
  createPackMetadata,
  createPackVersion,
  createPackManifest,
  createSequentialPolicy,
  validatePack,
  createPack,
} from '../../../../pack-types';
import { Workflow } from '../../../../workflow-types';
import { EntityId, Timestamp } from '../../../../integration-types';

/**
 * Represents a deleted pack in the archive.
 * Maintains history for recovery and audit purposes.
 */
export interface ArchivedPack {
  /** The deleted pack data */
  pack: Pack;

  /** Timestamp when the pack was deleted */
  deletedAt: Timestamp;

  /** User or system that initiated the deletion */
  deletedBy: string;

  /** Reason for deletion (optional) */
  reason?: string;

  /** Whether this is a soft delete (archived) or hard delete (permanent) */
  soft: boolean;
}

/**
 * Audit entry tracking changes to a pack.
 */
export interface AuditEntry {
  /** Timestamp of the change */
  timestamp: Timestamp;

  /** User or system that made the change */
  actor: string;

  /** Type of operation */
  operation: 'create' | 'update' | 'delete' | 'restore' | 'metadata_change' | 'workflow_change';

  /** Pack ID affected */
  packId: EntityId;

  /** Previous version before change */
  previousVersion?: string;

  /** New version after change */
  newVersion?: string;

  /** Change details */
  details: Record<string, any>;
}

/**
 * Pack CRUD Manager
 *
 * Manages all create, read, update, delete operations for packs with full audit trail,
 * version control, and history maintenance.
 */
export class PackManager {
  /** In-memory storage of packs by ID */
  private packs: Map<EntityId, Pack> = new Map();

  /** Archive of deleted packs */
  private archive: Map<EntityId, ArchivedPack> = new Map();

  /** Audit trail of all operations */
  private auditLog: AuditEntry[] = [];

  /** Version history for each pack */
  private versionHistory: Map<EntityId, PackVersion[]> = new Map();

  constructor() {
    // Initialize empty storage
  }

  /**
   * Creates a new pack with the provided metadata and workflows.
   *
   * Operations:
   * - Generates unique pack ID
   * - Initializes version to 1.0.0
   * - Records creation timestamp and author
   * - Creates audit entry
   * - Validates pack structure
   *
   * @param name - Pack name
   * @param description - Pack description
   * @param author - Author identifier
   * @param workflows - Initial workflow references
   * @param deploymentPolicy - Optional deployment policy (defaults to sequential)
   * @param tags - Optional tags for discovery
   * @returns Created Pack object
   * @throws Error if validation fails
   */
  createPack(
    name: string,
    description: string,
    author: string,
    workflows: WorkflowReference[],
    deploymentPolicy?: DeploymentPolicy,
    tags?: string[],
  ): Pack {
    // Generate unique pack ID
    const packId: EntityId = this.generatePackId();
    const now = new Date().toISOString() as Timestamp;

    // Create metadata
    const metadata = createPackMetadata(author, description, undefined, tags);

    // Create initial version
    const version = createPackVersion(
      '1.0.0',
      now,
      'Initial release',
      undefined,
      false,
      false,
    );

    // Create manifest with workflows and policy
    const policy = deploymentPolicy || createSequentialPolicy(3, 1000, false, false, 60000);
    const manifest = createPackManifest(workflows, policy);

    // Create the pack
    const pack = createPack(packId, name, manifest, version, metadata);

    // Validate pack
    try {
      validatePack(pack, this.packs);
    } catch (error) {
      throw new Error(`Failed to create pack: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Store pack
    this.packs.set(packId, pack);

    // Initialize version history
    this.versionHistory.set(packId, [{ ...version }]);

    // Create audit entry
    this.addAuditEntry({
      timestamp: now,
      actor: author,
      operation: 'create',
      packId,
      newVersion: '1.0.0',
      details: {
        name,
        description,
        workflowCount: workflows.length,
        tags,
      },
    });

    return pack;
  }

  /**
   * Retrieves a pack by ID with all metadata and workflow references.
   *
   * @param packId - Pack ID to retrieve
   * @returns Pack object with all metadata and workflow references
   * @throws Error if pack not found
   */
  readPack(packId: EntityId): Pack {
    const pack = this.packs.get(packId);

    if (!pack) {
      throw new Error(`Pack not found: ${packId}`);
    }

    return pack;
  }

  /**
   * Retrieves multiple packs by an array of IDs.
   *
   * Returns only packs that exist; non-existent IDs are silently skipped.
   *
   * @param packIds - Array of pack IDs to retrieve
   * @returns Array of Pack objects
   */
  readPacksBatch(packIds: EntityId[]): Pack[] {
    return packIds
      .map((id) => this.packs.get(id))
      .filter((pack) => pack !== undefined) as Pack[];
  }

  /**
   * Retrieves all packs currently in storage.
   *
   * @returns Array of all Pack objects
   */
  readAllPacks(): Pack[] {
    return Array.from(this.packs.values());
  }

  /**
   * Searches packs by various criteria.
   *
   * @param criteria - Search criteria
   * @returns Array of matching Pack objects
   */
  searchPacks(criteria: {
    name?: string;
    author?: string;
    tags?: string[];
    minRating?: number;
  }): Pack[] {
    return this.readAllPacks().filter((pack) => {
      // Name search (case-insensitive substring)
      if (criteria.name && !pack.name.toLowerCase().includes(criteria.name.toLowerCase())) {
        return false;
      }

      // Author search
      if (criteria.author && pack.metadata.author !== criteria.author) {
        return false;
      }

      // Tags search (any tag match)
      if (criteria.tags && criteria.tags.length > 0) {
        if (!pack.metadata.tags || !criteria.tags.some((tag) => pack.metadata.tags?.includes(tag))) {
          return false;
        }
      }

      // Rating filter
      if (criteria.minRating !== undefined && criteria.minRating > 0) {
        if (!pack.metadata.rating || pack.metadata.rating < criteria.minRating) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Updates pack metadata (name, description, tags).
   *
   * Operations:
   * - Updates specified metadata fields
   * - Increments patch version
   * - Records modification timestamp
   * - Creates audit entry
   *
   * @param packId - Pack ID to update
   * @param updates - Metadata updates
   * @param actor - User or system making the update
   * @returns Updated Pack object
   * @throws Error if pack not found or validation fails
   */
  updatePackMetadata(
    packId: EntityId,
    updates: {
      name?: string;
      description?: string;
      tags?: string[];
      rating?: number;
    },
    actor: string,
  ): Pack {
    const pack = this.readPack(packId);
    const now = new Date().toISOString() as Timestamp;
    const previousVersion = pack.version.version;

    // Update metadata
    if (updates.name !== undefined) {
      pack.name = updates.name;
    }
    if (updates.description !== undefined) {
      pack.metadata.description = updates.description;
    }
    if (updates.tags !== undefined) {
      pack.metadata.tags = updates.tags;
    }
    if (updates.rating !== undefined) {
      pack.metadata.rating = updates.rating;
    }

    // Update modification timestamp
    pack.metadata.updatedAt = now;

    // Bump patch version
    const newVersion = this.bumpPatchVersion(pack.version.version);
    pack.version.version = newVersion;
    pack.version.releasedAt = now;

    // Validate updated pack
    try {
      validatePack(pack, this.packs);
    } catch (error) {
      throw new Error(`Failed to update pack metadata: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Store updated pack
    this.packs.set(packId, pack);

    // Add to version history
    const versions = this.versionHistory.get(packId) || [];
    versions.push({ ...pack.version });
    this.versionHistory.set(packId, versions);

    // Create audit entry
    this.addAuditEntry({
      timestamp: now,
      actor,
      operation: 'metadata_change',
      packId,
      previousVersion,
      newVersion,
      details: updates,
    });

    return pack;
  }

  /**
   * Updates the workflow list in a pack (add/remove workflows).
   *
   * Operations:
   * - Validates workflow compatibility
   * - Updates workflow references
   * - Increments patch version
   * - Creates audit entry
   *
   * @param packId - Pack ID to update
   * @param workflows - New workflow reference list
   * @param actor - User or system making the change
   * @returns Updated Pack object
   * @throws Error if pack not found or workflows invalid
   */
  updatePackWorkflows(
    packId: EntityId,
    workflows: WorkflowReference[],
    actor: string,
  ): Pack {
    const pack = this.readPack(packId);
    const now = new Date().toISOString() as Timestamp;
    const previousVersion = pack.version.version;
    const previousWorkflowCount = pack.manifest.workflows.length;

    // Update workflows
    pack.manifest.workflows = workflows;

    // Update modification timestamp
    pack.metadata.updatedAt = now;

    // Bump patch version
    const newVersion = this.bumpPatchVersion(pack.version.version);
    pack.version.version = newVersion;
    pack.version.releasedAt = now;

    // Validate updated pack
    try {
      validatePack(pack, this.packs);
    } catch (error) {
      throw new Error(`Failed to update pack workflows: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Store updated pack
    this.packs.set(packId, pack);

    // Add to version history
    const versions = this.versionHistory.get(packId) || [];
    versions.push({ ...pack.version });
    this.versionHistory.set(packId, versions);

    // Create audit entry
    this.addAuditEntry({
      timestamp: now,
      actor,
      operation: 'workflow_change',
      packId,
      previousVersion,
      newVersion,
      details: {
        previousWorkflowCount,
        newWorkflowCount: workflows.length,
        workflowIds: workflows.map((w) => w.workflowId),
      },
    });

    return pack;
  }

  /**
   * Adds a single workflow to a pack.
   *
   * @param packId - Pack ID to update
   * @param workflow - Workflow reference to add
   * @param actor - User or system making the change
   * @returns Updated Pack object
   * @throws Error if pack not found or workflow invalid
   */
  addWorkflowToPack(packId: EntityId, workflow: WorkflowReference, actor: string): Pack {
    const pack = this.readPack(packId);
    const updatedWorkflows = [...pack.manifest.workflows, workflow];
    return this.updatePackWorkflows(packId, updatedWorkflows, actor);
  }

  /**
   * Removes a workflow from a pack by workflow ID.
   *
   * @param packId - Pack ID to update
   * @param workflowId - Workflow ID to remove
   * @param actor - User or system making the change
   * @returns Updated Pack object
   * @throws Error if pack not found or workflow not in pack
   */
  removeWorkflowFromPack(packId: EntityId, workflowId: string, actor: string): Pack {
    const pack = this.readPack(packId);

    if (pack.manifest.workflows.length <= 1) {
      throw new Error('Cannot remove last workflow from pack');
    }

    const updatedWorkflows = pack.manifest.workflows.filter((w) => w.workflowId !== workflowId);

    if (updatedWorkflows.length === pack.manifest.workflows.length) {
      throw new Error(`Workflow not found in pack: ${workflowId}`);
    }

    return this.updatePackWorkflows(packId, updatedWorkflows, actor);
  }

  /**
   * Reorders workflows in a pack.
   *
   * @param packId - Pack ID to update
   * @param workflowIds - Ordered list of workflow IDs
   * @param actor - User or system making the change
   * @returns Updated Pack object
   * @throws Error if pack not found or workflow IDs don't match
   */
  reorderWorkflows(packId: EntityId, workflowIds: string[], actor: string): Pack {
    const pack = this.readPack(packId);

    if (workflowIds.length !== pack.manifest.workflows.length) {
      throw new Error('Workflow count mismatch in reorder operation');
    }

    const workflowMap = new Map(pack.manifest.workflows.map((w) => [w.workflowId, w]));

    const reorderedWorkflows: WorkflowReference[] = [];
    for (const id of workflowIds) {
      const workflow = workflowMap.get(id);
      if (!workflow) {
        throw new Error(`Workflow not found in pack: ${id}`);
      }
      reorderedWorkflows.push(workflow);
    }

    return this.updatePackWorkflows(packId, reorderedWorkflows, actor);
  }

  /**
   * Updates the deployment policy for a pack.
   *
   * @param packId - Pack ID to update
   * @param policy - New deployment policy
   * @param actor - User or system making the change
   * @returns Updated Pack object
   * @throws Error if pack not found or policy invalid
   */
  updateDeploymentPolicy(
    packId: EntityId,
    policy: DeploymentPolicy,
    actor: string,
  ): Pack {
    const pack = this.readPack(packId);
    const now = new Date().toISOString() as Timestamp;
    const previousVersion = pack.version.version;

    // Update policy
    pack.manifest.policy = policy;

    // Update modification timestamp
    pack.metadata.updatedAt = now;

    // Bump patch version
    const newVersion = this.bumpPatchVersion(pack.version.version);
    pack.version.version = newVersion;
    pack.version.releasedAt = now;

    // Validate updated pack
    try {
      validatePack(pack, this.packs);
    } catch (error) {
      throw new Error(`Failed to update deployment policy: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Store updated pack
    this.packs.set(packId, pack);

    // Add to version history
    const versions = this.versionHistory.get(packId) || [];
    versions.push({ ...pack.version });
    this.versionHistory.set(packId, versions);

    // Create audit entry
    this.addAuditEntry({
      timestamp: now,
      actor,
      operation: 'update',
      packId,
      previousVersion,
      newVersion,
      details: {
        policyMode: policy.mode,
        maxRetries: policy.maxRetries,
        rollbackOnFailure: policy.rollbackOnFailure,
      },
    });

    return pack;
  }

  /**
   * Soft deletes a pack (archives it for potential recovery).
   *
   * Operations:
   * - Moves pack to archive
   * - Records deletion metadata
   * - Maintains full history and audit trail
   * - Allows recovery
   *
   * @param packId - Pack ID to delete
   * @param actor - User or system initiating deletion
   * @param reason - Optional reason for deletion
   * @throws Error if pack not found
   */
  softDeletePack(packId: EntityId, actor: string, reason?: string): void {
    const pack = this.readPack(packId);
    const now = new Date().toISOString() as Timestamp;

    // Archive the pack
    this.archive.set(packId, {
      pack,
      deletedAt: now,
      deletedBy: actor,
      reason,
      soft: true,
    });

    // Remove from active storage
    this.packs.delete(packId);

    // Create audit entry
    this.addAuditEntry({
      timestamp: now,
      actor,
      operation: 'delete',
      packId,
      previousVersion: pack.version.version,
      details: {
        reason,
        archived: true,
        recoverable: true,
      },
    });
  }

  /**
   * Hard deletes a pack (permanent removal).
   *
   * Operations:
   * - Permanently removes pack from storage
   * - Maintains audit trail but removes pack data
   * - Cannot be recovered
   *
   * @param packId - Pack ID to delete
   * @param actor - User or system initiating deletion
   * @param reason - Optional reason for deletion
   * @throws Error if pack not found
   */
  hardDeletePack(packId: EntityId, actor: string, reason?: string): void {
    const pack = this.readPack(packId);
    const now = new Date().toISOString() as Timestamp;

    // Permanently archive the pack (for audit only)
    this.archive.set(packId, {
      pack,
      deletedAt: now,
      deletedBy: actor,
      reason,
      soft: false,
    });

    // Remove from active storage
    this.packs.delete(packId);

    // Remove version history
    this.versionHistory.delete(packId);

    // Create audit entry
    this.addAuditEntry({
      timestamp: now,
      actor,
      operation: 'delete',
      packId,
      previousVersion: pack.version.version,
      details: {
        reason,
        archived: false,
        recoverable: false,
        hardDelete: true,
      },
    });
  }

  /**
   * Restores a soft-deleted pack from the archive.
   *
   * @param packId - Pack ID to restore
   * @param actor - User or system initiating restore
   * @returns Restored Pack object
   * @throws Error if pack not found in archive or was hard-deleted
   */
  restorePack(packId: EntityId, actor: string): Pack {
    const archived = this.archive.get(packId);

    if (!archived) {
      throw new Error(`Pack not found in archive: ${packId}`);
    }

    if (!archived.soft) {
      throw new Error(`Cannot restore hard-deleted pack: ${packId}`);
    }

    const now = new Date().toISOString() as Timestamp;
    const pack = archived.pack;

    // Restore to active storage
    this.packs.set(packId, pack);

    // Create audit entry
    this.addAuditEntry({
      timestamp: now,
      actor,
      operation: 'restore',
      packId,
      newVersion: pack.version.version,
      details: {
        restoredFrom: archived.deletedAt,
      },
    });

    return pack;
  }

  /**
   * Retrieves version history for a pack.
   *
   * @param packId - Pack ID to get history for
   * @returns Array of PackVersion objects in chronological order
   * @throws Error if pack not found
   */
  getVersionHistory(packId: EntityId): PackVersion[] {
    // Verify pack exists (or existed)
    if (!this.packs.has(packId) && !this.archive.has(packId)) {
      throw new Error(`Pack not found: ${packId}`);
    }

    return this.versionHistory.get(packId) || [];
  }

  /**
   * Retrieves a specific version of a pack.
   *
   * @param packId - Pack ID
   * @param version - Version string (e.g., "1.0.0")
   * @returns PackVersion object
   * @throws Error if pack or version not found
   */
  getPackVersion(packId: EntityId, version: string): PackVersion {
    const history = this.getVersionHistory(packId);
    const found = history.find((v) => v.version === version);

    if (!found) {
      throw new Error(`Version not found: ${version} for pack ${packId}`);
    }

    return found;
  }

  /**
   * Retrieves the audit trail for a pack.
   *
   * @param packId - Optional pack ID to filter by
   * @returns Array of AuditEntry objects
   */
  getAuditLog(packId?: EntityId): AuditEntry[] {
    if (packId) {
      return this.auditLog.filter((entry) => entry.packId === packId);
    }
    return this.auditLog;
  }

  /**
   * Gets total count of packs currently in storage.
   *
   * @returns Number of active packs
   */
  getPackCount(): number {
    return this.packs.size;
  }

  /**
   * Gets total count of archived packs.
   *
   * @returns Number of archived packs
   */
  getArchivedPackCount(): number {
    return this.archive.size;
  }

  /**
   * Lists all archived packs.
   *
   * @returns Array of ArchivedPack objects
   */
  listArchivedPacks(): ArchivedPack[] {
    return Array.from(this.archive.values());
  }

  /**
   * Clears all data from the manager (for testing/reset).
   *
   * @internal
   */
  clear(): void {
    this.packs.clear();
    this.archive.clear();
    this.auditLog = [];
    this.versionHistory.clear();
  }

  // ========================================================================
  // Private Helper Methods
  // ========================================================================

  /**
   * Generates a unique pack ID.
   *
   * @returns Unique pack ID
   * @private
   */
  private generatePackId(): EntityId {
    return `pack_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` as EntityId;
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
  private addAuditEntry(entry: AuditEntry): void {
    this.auditLog.push(entry);
  }
}

/**
 * Creates and returns a singleton instance of PackManager.
 *
 * @returns Singleton PackManager instance
 */
export function createPackManager(): PackManager {
  return new PackManager();
}
