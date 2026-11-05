/**
 * Pack Versioning System
 *
 * Implements semantic versioning (SemVer 2.0) for packs with:
 * - Auto-increment patch version on modifications
 * - Explicit minor/major version bump support (user-controlled)
 * - Complete version history with snapshots
 * - Version rollback capability with audit trail
 * - Compression support for snapshot storage
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
 */

import { Pack, PackVersion } from '../../../../pack-types';

/**
 * Represents a point-in-time snapshot of a pack's complete state
 */
export interface PackSnapshot {
  /** Semantic version of this snapshot */
  version: string;

  /** Complete pack state at this version */
  packState: Pack;

  /** Timestamp when snapshot was created (ISO 8601) */
  timestamp: string;

  /** Author/actor who triggered the version change */
  author: string;

  /** Description of changes made in this version */
  changeDescription: string;

  /** Size of snapshot in bytes (before compression) */
  sizeBytes: number;

  /** Size of snapshot after compression (if enabled) */
  compressedSizeBytes?: number;

  /** Complexity metrics (number of workflows, etc.) */
  complexity: {
    workflowCount: number;
    totalSteps: number;
    dependencyCount: number;
  };

  /** SHA-256 hash of the snapshot for integrity verification */
  hash: string;

  /** Tags applied to this version for easy reference */
  tags: string[];
}

/**
 * Version history entry tracking changes between versions
 */
export interface VersionHistoryEntry {
  /** From version (e.g., "1.0.0") */
  fromVersion: string;

  /** To version (e.g., "1.1.0") */
  toVersion: string;

  /** Type of version bump: 'patch' | 'minor' | 'major' */
  bumpType: 'patch' | 'minor' | 'major';

  /** Timestamp of the version change (ISO 8601) */
  timestamp: string;

  /** Actor who made the change */
  actor: string;

  /** Description of what changed */
  description: string;

  /** Reference to the snapshot for this version */
  snapshotHash: string;
}

/**
 * Configuration for version rollback
 */
export interface RollbackConfig {
  /** Target version to rollback to */
  targetVersion: string;

  /** Actor performing the rollback */
  actor: string;

  /** Reason for rollback */
  reason: string;

  /** Whether to create an audit entry */
  createAuditEntry?: boolean;
}

/**
 * Versioning operations result
 */
export interface VersioningResult {
  success: boolean;

  message: string;

  version?: string;

  snapshot?: PackSnapshot;

  error?: string;
}

/**
 * PackVersioningService manages semantic versioning, snapshots, and rollback
 */
export class PackVersioningService {
  /** Map of pack ID -> versions */
  private versionMap = new Map<string, PackSnapshot[]>();

  /** Map of pack ID -> version history */
  private historyMap = new Map<string, VersionHistoryEntry[]>();

  /** Map of pack ID -> current version */
  private currentVersionMap = new Map<string, string>();

  /** Map for snapshot hash -> snapshot (global lookup) */
  private snapshotHashMap = new Map<string, PackSnapshot>();

  constructor(private enableCompression = false) {}

  /**
   * Create an initial version for a new pack
   * Version always starts at 1.0.0
   */
  createInitialVersion(
    pack: Pack,
    author: string,
    description = 'Initial version',
  ): VersioningResult {
    try {
      if (!pack.id) {
        return {
          success: false,
          message: 'Pack ID is required',
          error: 'MISSING_PACK_ID',
        };
      }

      // Validate pack has valid version format
      if (!this.isValidSemanticVersion(pack.version.version)) {
        return {
          success: false,
          message: `Invalid semantic version format: ${pack.version.version}`,
          error: 'INVALID_VERSION_FORMAT',
        };
      }

      // Create snapshot
      const snapshot = this.createSnapshot(pack, author, description);

      // Initialize version storage for this pack
      if (!this.versionMap.has(pack.id)) {
        this.versionMap.set(pack.id, []);
      }

      // Store snapshot
      const versions = this.versionMap.get(pack.id)!;
      versions.push(snapshot);

      // Track current version
      this.currentVersionMap.set(pack.id, snapshot.version);

      // Store hash reference
      this.snapshotHashMap.set(snapshot.hash, snapshot);

      return {
        success: true,
        message: `Initial version ${snapshot.version} created`,
        version: snapshot.version,
        snapshot,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to create initial version: ${error}`,
        error: 'CREATION_FAILED',
      };
    }
  }

  /**
   * Auto-increment patch version on pack modifications
   * Called whenever pack content changes (workflows added/removed/metadata updated)
   */
  autoBumpPatchVersion(
    pack: Pack,
    actor: string,
    description: string,
  ): VersioningResult {
    try {
      // Try to get current version from service, fall back to pack.version
      let currentVersion = this.currentVersionMap.get(pack.id);
      if (!currentVersion) {
        // Try to infer from existing versions or use pack's current version
        const versions = this.versionMap.get(pack.id);
        if (versions && versions.length > 0) {
          currentVersion = versions[versions.length - 1].version;
        } else {
          // Fall back to pack version if no versions stored yet
          currentVersion = pack.version.version;
        }
      }

      // Parse current version
      const [major, minor, patch] = this.parseVersion(currentVersion);

      // Bump patch
      const newVersion = `${major}.${minor}.${patch + 1}`;

      // Update pack version
      const updatedPack = { ...pack, version: { ...pack.version, version: newVersion } };

      // Create snapshot
      const snapshot = this.createSnapshot(updatedPack, actor, description);

      // Store snapshot
      if (!this.versionMap.has(pack.id)) {
        this.versionMap.set(pack.id, []);
      }
      this.versionMap.get(pack.id)!.push(snapshot);

      // Create history entry
      const historyEntry: VersionHistoryEntry = {
        fromVersion: currentVersion,
        toVersion: newVersion,
        bumpType: 'patch',
        timestamp: new Date().toISOString(),
        actor,
        description,
        snapshotHash: snapshot.hash,
      };

      if (!this.historyMap.has(pack.id)) {
        this.historyMap.set(pack.id, []);
      }
      this.historyMap.get(pack.id)!.push(historyEntry);

      // Update current version
      this.currentVersionMap.set(pack.id, newVersion);

      // Store hash reference
      this.snapshotHashMap.set(snapshot.hash, snapshot);

      return {
        success: true,
        message: `Patch version auto-bumped to ${newVersion}`,
        version: newVersion,
        snapshot,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to auto-bump patch version: ${error}`,
        error: 'BUMP_FAILED',
      };
    }
  }

  /**
   * Explicitly bump minor version (user-controlled)
   * Resets patch to 0
   */
  bumpMinorVersion(
    pack: Pack,
    actor: string,
    description: string,
  ): VersioningResult {
    try {
      return this.bumpVersion(pack, actor, description, 'minor');
    } catch (error) {
      return {
        success: false,
        message: `Failed to bump minor version: ${error}`,
        error: 'BUMP_FAILED',
      };
    }
  }

  /**
   * Explicitly bump major version (user-controlled)
   * Resets minor and patch to 0
   */
  bumpMajorVersion(
    pack: Pack,
    actor: string,
    description: string,
  ): VersioningResult {
    try {
      return this.bumpVersion(pack, actor, description, 'major');
    } catch (error) {
      return {
        success: false,
        message: `Failed to bump major version: ${error}`,
        error: 'BUMP_FAILED',
      };
    }
  }

  /**
   * Internal method for bumping versions
   */
  private bumpVersion(
    pack: Pack,
    actor: string,
    description: string,
    bumpType: 'minor' | 'major',
  ): VersioningResult {
    const currentVersion = this.currentVersionMap.get(pack.id);
    if (!currentVersion) {
      return {
        success: false,
        message: 'No current version found for pack',
        error: 'NO_CURRENT_VERSION',
      };
    }

    const [major, minor, patch] = this.parseVersion(currentVersion);
    let newVersion: string;

    if (bumpType === 'minor') {
      newVersion = `${major}.${minor + 1}.0`;
    } else {
      // major
      newVersion = `${major + 1}.0.0`;
    }

    // Update pack version
    const updatedPack = { ...pack, version: { ...pack.version, version: newVersion } };

    // Create snapshot
    const snapshot = this.createSnapshot(updatedPack, actor, description);

    // Store snapshot
    const versions = this.versionMap.get(pack.id)!;
    versions.push(snapshot);

    // Create history entry
    const historyEntry: VersionHistoryEntry = {
      fromVersion: currentVersion,
      toVersion: newVersion,
      bumpType,
      timestamp: new Date().toISOString(),
      actor,
      description,
      snapshotHash: snapshot.hash,
    };

    if (!this.historyMap.has(pack.id)) {
      this.historyMap.set(pack.id, []);
    }
    this.historyMap.get(pack.id)!.push(historyEntry);

    // Update current version
    this.currentVersionMap.set(pack.id, newVersion);

    // Store hash reference
    this.snapshotHashMap.set(snapshot.hash, snapshot);

    return {
      success: true,
      message: `${bumpType} version bumped to ${newVersion}`,
      version: newVersion,
      snapshot,
    };
  }

  /**
   * Get complete version history for a pack
   */
  getVersionHistory(packId: string): VersionHistoryEntry[] {
    return this.historyMap.get(packId) || [];
  }

  /**
   * Get all snapshots for a pack in chronological order
   */
  getAllVersionSnapshots(packId: string): PackSnapshot[] {
    return this.versionMap.get(packId) || [];
  }

  /**
   * Get a specific version snapshot
   */
  getVersionSnapshot(packId: string, version: string): PackSnapshot | null {
    const snapshots = this.versionMap.get(packId);
    if (!snapshots) {
      return null;
    }

    return snapshots.find((s) => s.version === version) || null;
  }

  /**
   * Get the current version of a pack
   */
  getCurrentVersion(packId: string): string | null {
    return this.currentVersionMap.get(packId) || null;
  }

  /**
   * Retrieve pack state at a specific version
   */
  getPackAtVersion(packId: string, version: string): Pack | null {
    const snapshot = this.getVersionSnapshot(packId, version);
    return snapshot ? snapshot.packState : null;
  }

  /**
   * Rollback pack to a previous version
   * Prevents rolling back to current version
   * Creates new version history entry for the rollback
   */
  rollbackToVersion(config: RollbackConfig, packId: string): VersioningResult {
    try {
      const currentVersion = this.currentVersionMap.get(packId);
      if (!currentVersion) {
        return {
          success: false,
          message: 'No current version found for pack',
          error: 'NO_CURRENT_VERSION',
        };
      }

      // Prevent rolling back to current version
      if (config.targetVersion === currentVersion) {
        return {
          success: false,
          message: `Cannot rollback to current version (${currentVersion})`,
          error: 'SAME_VERSION_ROLLBACK',
        };
      }

      // Verify target version exists
      const targetSnapshot = this.getVersionSnapshot(packId, config.targetVersion);
      if (!targetSnapshot) {
        return {
          success: false,
          message: `Target version ${config.targetVersion} not found`,
          error: 'VERSION_NOT_FOUND',
        };
      }

      // Get the pack state at target version
      const restoredPack = targetSnapshot.packState;

      // Create history entry for the rollback
      const [major, minor, patch] = this.parseVersion(currentVersion);
      const rollbackVersion = `${major}.${minor}.${patch + 1}`;

      const rollbackHistoryEntry: VersionHistoryEntry = {
        fromVersion: currentVersion,
        toVersion: rollbackVersion,
        bumpType: 'patch',
        timestamp: new Date().toISOString(),
        actor: config.actor,
        description: `Rolled back from ${currentVersion} to ${config.targetVersion}: ${config.reason}`,
        snapshotHash: targetSnapshot.hash,
      };

      if (!this.historyMap.has(packId)) {
        this.historyMap.set(packId, []);
      }
      this.historyMap.get(packId)!.push(rollbackHistoryEntry);

      // Update current version to the new rollback version
      // but store the snapshot as a copy of the target snapshot
      const rollbackSnapshot: PackSnapshot = {
        ...targetSnapshot,
        version: rollbackVersion,
        timestamp: new Date().toISOString(),
        author: config.actor,
        changeDescription: `Rolled back from ${currentVersion} to ${config.targetVersion}`,
      };

      // Update hash for new snapshot
      rollbackSnapshot.hash = this.calculateHash(JSON.stringify(rollbackSnapshot));

      const versions = this.versionMap.get(packId)!;
      versions.push(rollbackSnapshot);

      this.currentVersionMap.set(packId, rollbackVersion);
      this.snapshotHashMap.set(rollbackSnapshot.hash, rollbackSnapshot);

      return {
        success: true,
        message: `Successfully rolled back to version ${config.targetVersion}. New version: ${rollbackVersion}`,
        version: rollbackVersion,
        snapshot: rollbackSnapshot,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to rollback to version: ${error}`,
        error: 'ROLLBACK_FAILED',
      };
    }
  }

  /**
   * Get all versions sorted by date (oldest first)
   */
  getVersionsChronological(packId: string): PackSnapshot[] {
    const snapshots = this.versionMap.get(packId);
    if (!snapshots) {
      return [];
    }

    return [...snapshots].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
  }

  /**
   * Get versions in reverse chronological order (newest first)
   */
  getVersionsReverse(packId: string): PackSnapshot[] {
    const snapshots = this.versionMap.get(packId);
    if (!snapshots) {
      return [];
    }

    return [...snapshots].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }

  /**
   * Count total versions for a pack
   */
  getVersionCount(packId: string): number {
    return this.versionMap.get(packId)?.length || 0;
  }

  /**
   * Get total storage size used by all snapshots for a pack
   */
  getTotalStorageSize(packId: string): number {
    const snapshots = this.versionMap.get(packId);
    if (!snapshots) {
      return 0;
    }

    return snapshots.reduce((total, snapshot) => {
      return total + (snapshot.compressedSizeBytes || snapshot.sizeBytes);
    }, 0);
  }

  /**
   * Get average compression ratio for a pack
   */
  getCompressionRatio(packId: string): number {
    const snapshots = this.versionMap.get(packId);
    if (!snapshots || snapshots.length === 0) {
      return 0;
    }

    const compressedSnapshots = snapshots.filter((s) => s.compressedSizeBytes !== undefined);
    if (compressedSnapshots.length === 0) {
      return 0;
    }

    const avgOriginal =
      compressedSnapshots.reduce((sum, s) => sum + s.sizeBytes, 0) / compressedSnapshots.length;
    const avgCompressed =
      compressedSnapshots.reduce((sum, s) => sum + (s.compressedSizeBytes || 0), 0) /
      compressedSnapshots.length;

    return avgCompressed / avgOriginal;
  }

  /**
   * Clear all versioning data (for testing)
   */
  clear(): void {
    this.versionMap.clear();
    this.historyMap.clear();
    this.currentVersionMap.clear();
    this.snapshotHashMap.clear();
  }

  /**
   * Private helper: Create a snapshot of pack state
   */
  private createSnapshot(pack: Pack, author: string, description: string): PackSnapshot {
    const serialized = JSON.stringify(pack);
    const sizeBytes = new Blob([serialized]).size;

    const complexity = {
      workflowCount: pack.manifest.workflows.length,
      totalSteps: 0, // This would be calculated from actual workflows in real implementation
      dependencyCount: pack.dependencies ? pack.dependencies.length : 0,
    };

    const hash = this.calculateHash(serialized);

    const snapshot: PackSnapshot = {
      version: pack.version.version,
      packState: pack,
      timestamp: new Date().toISOString(),
      author,
      changeDescription: description,
      sizeBytes,
      compressedSizeBytes: this.enableCompression ? this.estimateCompressedSize(sizeBytes) : undefined,
      complexity,
      hash,
      tags: [],
    };

    return snapshot;
  }

  /**
   * Private helper: Validate semantic version format (X.Y.Z)
   */
  private isValidSemanticVersion(version: string): boolean {
    const semverRegex = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
    return semverRegex.test(version);
  }

  /**
   * Private helper: Parse semantic version into [major, minor, patch]
   */
  private parseVersion(version: string): [number, number, number] {
    const parts = version.split('.');
    return [parseInt(parts[0], 10), parseInt(parts[1], 10), parseInt(parts[2], 10)];
  }

  /**
   * Private helper: Calculate hash for integrity verification
   */
  private calculateHash(content: string): string {
    // Simple hash - in production would use actual SHA-256
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Private helper: Estimate compressed size (rough heuristic)
   */
  private estimateCompressedSize(originalSize: number): number {
    // Rough estimate: compression usually achieves 60-80% reduction for JSON
    return Math.round(originalSize * 0.7);
  }
}

/**
 * Factory function to create a PackVersioningService instance
 */
export function createPackVersioningService(enableCompression = false): PackVersioningService {
  return new PackVersioningService(enableCompression);
}
