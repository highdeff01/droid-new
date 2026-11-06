/**
 * Pack Repository with Version History Management
 *
 * Implements CRUD operations for Pack objects with full version tracking.
 * Each Pack version is stored as a snapshot with metadata, supporting rollback
 * and historical queries.
 *
 * Features:
 * - Save/load Pack objects with version history
 * - Version snapshots with full workflow capture
 * - Fuzzy search by name, tags, and metadata
 * - Execution history tracking
 * - Query by author, date range, and tags
 */

import type { Pack, PackMetadata, PackVersion, VersionRecord } from './pack-types';
import type { EntityId, Timestamp } from './integration-types';
import { globalEventDispatcher } from './event-dispatcher';

/**
 * Query options for Pack searches
 */
export interface PackQueryOptions {
  /** Filter by author */
  author?: string;
  /** Filter by tags (matches any of the provided tags) */
  tags?: string[];
  /** Search name with fuzzy matching */
  name?: string;
  /** Date range filter (ISO 8601 strings) */
  dateRange?: { start?: string; end?: string };
  /** Maximum results to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Result of a Pack query
 */
export interface PackQueryResult {
  /** Matching Packs */
  items: Pack[];
  /** Total count of matching Packs */
  total: number;
  /** Pagination info */
  pagination?: { limit: number; offset: number; page: number; totalPages: number };
}

/**
 * Pack repository class
 */
export class PackRepository {
  private packs: Map<string, Pack> = new Map();
  private versionIndex: Map<string, Map<string, Pack>> = new Map();
  private authorIndex: Map<string, Set<string>> = new Map();
  private tagIndex: Map<string, Set<string>> = new Map();
  private createdAtIndex: Map<string, Set<string>> = new Map();
  private updatedAtIndex: Map<string, Set<string>> = new Map();
  private nameIndex: Map<string, Set<string>> = new Map();

  /**
   * Save a Pack with version tracking
   * - Auto-increments version if not provided
   * - Creates snapshot in version history
   * - Updates all indexes
   */
  save(pack: Pack): Pack {
    const existing = this.packs.get(pack.id);
    const isNew = !existing;

    // Determine version
    const version = this.calculateNextVersion(existing?.metadata.version, pack.metadata.version);

    // Create version record for history
    const versionRecord: VersionRecord = {
      version,
      timestamp: new Date().toISOString() as Timestamp,
      author: pack.metadata.author,
      changes: this.generateVersionChanges(existing?.metadata, pack.metadata),
      workflowSnapshots: pack.workflowReferences.reduce((acc, ref) => {
        // Note: In a real implementation, we'd fetch the workflow from repository
        // For now, we store a reference to the workflow
        acc[ref.workflowId] = { ref };
        return acc;
      }, {} as Record<string, any>),
    };

    // Create updated pack with version info
    const updatedPack: Pack = {
      ...pack,
      metadata: {
        ...pack.metadata,
        version,
        updatedAt: new Date().toISOString() as Timestamp,
      },
      versioning: {
        major: this.parseVersion(version).major,
        minor: this.parseVersion(version).minor,
        patch: this.parseVersion(version).patch,
        history: [...(existing?.versioning.history || []), versionRecord],
      },
    };

    // Update main storage
    this.packs.set(pack.id, updatedPack);

    // Update version index
    if (!this.versionIndex.has(pack.id)) {
      this.versionIndex.set(pack.id, new Map());
    }
    this.versionIndex.get(pack.id)!.set(version, updatedPack);

    // Update indexes
    this.updateIndexes(updatedPack, isNew ? 'add' : 'update');

    // Emit event
    if (isNew) {
      globalEventDispatcher.emit({ type: 'PackCreated', pack: updatedPack });
    } else {
      globalEventDispatcher.emit({
        type: 'PackModified',
        packId: pack.id,
        changes: { type: 'metadata-updated' },
      });
    }

    return updatedPack;
  }

  /**
   * Find a Pack by ID
   */
  findById(id: string): Pack | undefined {
    return this.packs.get(id);
  }

  /**
   * Find a Pack by ID and specific version
   */
  findByVersion(id: string, version: string): Pack | undefined {
    return this.versionIndex.get(id)?.get(version);
  }

  /**
   * Find all versions of a Pack
   */
  findVersions(id: string): Pack[] {
    const versions = this.versionIndex.get(id);
    if (!versions) return [];
    return [...versions.values()];
  }

  /**
   * Find Packs by author
   */
  findByAuthor(author: string): Pack[] {
    const ids = this.authorIndex.get(author);
    if (!ids) return [];
    return [...ids].map(id => this.packs.get(id)!).filter((p): p is Pack => p !== undefined);
  }

  /**
   * Find Packs by tags (matches any tag)
   */
  findByTags(tags: string[]): Pack[] {
    const resultIds = new Set<string>();
    
    for (const tag of tags) {
      const ids = this.tagIndex.get(tag);
      if (ids) {
        for (const id of ids) {
          resultIds.add(id);
        }
      }
    }
    
    return [...resultIds].map(id => this.packs.get(id)!).filter((p): p is Pack => p !== undefined);
  }

  /**
   * Find Packs created in date range
   */
  findByDateRange(start: string, end: string): Pack[] {
    const startIds = this.getDateRangeIds(start, end, this.createdAtIndex);
    const endIds = this.getDateRangeIds(start, end, this.updatedAtIndex);
    
    const resultIds = new Set([...startIds, ...endIds]);
    return [...resultIds].map(id => this.packs.get(id)!).filter((p): p is Pack => p !== undefined);
  }

  /**
   * Search Packs with fuzzy name matching
   */
  search(options: PackQueryOptions = {}): PackQueryResult {
    let results: Pack[] = [...this.packs.values()];

    // Filter by author
    if (options.author) {
      results = results.filter(p => p.metadata.author === options.author);
    }

    // Filter by tags (AND logic - must match all tags)
    if (options.tags && options.tags.length > 0) {
      results = results.filter(p => 
        options.tags!.every(tag => p.metadata.tags.includes(tag))
      );
    }

    // Fuzzy name search
    if (options.name) {
      const searchLower = options.name.toLowerCase();
      results = results.filter(p => 
        p.metadata.name.toLowerCase().includes(searchLower)
      );
    }

    // Date range filter
    if (options.dateRange) {
      if (options.dateRange.start) {
        results = results.filter(p => p.metadata.createdAt >= options.dateRange!.start!);
      }
      if (options.dateRange.end) {
        results = results.filter(p => p.metadata.createdAt <= options.dateRange!.end!);
      }
    }

    const total = results.length;

    // Pagination
    const limit = options.limit ?? total;
    const offset = options.offset ?? 0;
    const page = Math.floor(offset / limit) + 1;
    const totalPages = Math.ceil(total / limit);

    const paginatedResults = results.slice(offset, offset + limit);

    return {
      items: paginatedResults,
      total,
      pagination: {
        limit,
        offset,
        page,
        totalPages,
      },
    };
  }

  /**
   * Update execution history for a Pack
   */
  updateExecutionHistory(packId: string, executionRecord: any): any {
    const pack = this.packs.get(packId);
    if (!pack) {
      throw new Error(`Pack not found: ${packId}`);
    }

    const updatedPack = {
      ...pack,
      executionHistory: [...pack.executionHistory, executionRecord],
    };

    this.packs.set(packId, updatedPack);
    return updatedPack;
  }

  /**
   * Get execution history for a Pack
   */
  getExecutionHistory(packId: string): any[] {
    const pack = this.packs.get(packId);
    return pack?.executionHistory ?? [];
  }

  /**
   * Get execution statistics for a Pack
   */
  getExecutionStats(packId: string): { successRate: number; executionCount: number } {
    const history = this.getExecutionHistory(packId);
    if (history.length === 0) {
      return { successRate: 0, executionCount: 0 };
    }

    const successCount = history.filter(e => e.success).length;
    return {
      successRate: (successCount / history.length) * 100,
      executionCount: history.length,
    };
  }

  /**
   * Delete a Pack by ID
   * Returns true if deleted, false if not found
   */
  delete(id: string): boolean {
    const pack = this.packs.get(id);
    if (!pack) return false;

    this.packs.delete(id);
    this.versionIndex.delete(id);
    this.updateIndexes(pack, 'remove');

    globalEventDispatcher.emit({
      type: 'PackModified',
      packId: id,
      changes: { type: 'pack-deleted' },
    });

    return true;
  }

  /**
   * Delete all Packs
   * Returns count of deleted Packs
   */
  deleteAll(): number {
    const count = this.packs.size;
    
    // Get all Packs for event emission
    const deletedPacks = [...this.packs.values()];
    
    this.packs.clear();
    this.versionIndex.clear();
    
    // Clear all indexes
    this.authorIndex.clear();
    this.tagIndex.clear();
    this.createdAtIndex.clear();
    this.updatedAtIndex.clear();
    this.nameIndex.clear();

    deletedPacks.forEach(pack => {
      globalEventDispatcher.emit({
        type: 'PackModified',
        packId: pack.id,
        changes: { type: 'pack-deleted' },
      });
    });

    return count;
  }

  /**
   * Get count of all Packs
   */
  getCount(): number {
    return this.packs.size;
  }

  /**
   * Get all Packs
   */
  getAll(): Pack[] {
    return [...this.packs.values()];
  }

  /**
   * Get all authors
   */
  getAuthors(): string[] {
    return [...this.authorIndex.keys()];
  }

  /**
   * Get all tags used across Packs
   */
  getAllTags(): string[] {
    return [...this.tagIndex.keys()];
  }

  /**
   * Get date range of Pack creation/modification
   */
  getDateRange(): { earliest: string; latest: string } | undefined {
    const allPacks = this.getAll();
    if (allPacks.length === 0) return undefined;

    const dates = allPacks.flatMap(p => [
      p.metadata.createdAt,
      p.metadata.updatedAt,
    ]);

    return {
      earliest: dates.reduce((earliest, date) => date < earliest ? date : earliest),
      latest: dates.reduce((latest, date) => date > latest ? date : latest),
    };
  }

  /**
   * Get workflow IDs referenced in a Pack
   */
  getWorkflowIds(packId: string): string[] {
    const pack = this.packs.get(packId);
    return pack?.workflowReferences.map(ref => ref.workflowId) ?? [];
  }

  /**
   * Get version history for a Pack
   */
  getVersionHistory(packId: string): VersionRecord[] {
    const pack = this.packs.get(packId);
    return pack?.versioning.history ?? [];
  }

  /**
   * Rollback Pack to a specific version
   */
  rollback(packId: string, version: string): Pack | undefined {
    const packByVersion = this.versionIndex.get(packId);
    const pack = packByVersion?.get(version);
    
    if (!pack) return undefined;

    // Update the current version to match the rolled back version
    // but keep the version history
    this.packs.set(packId, pack);
    return pack;
  }

  /**
   * Check if a Pack exists
   */
  exists(id: string): boolean {
    return this.packs.has(id);
  }

  /**
   * Check if a version exists for a Pack
   */
  versionExists(packId: string, version: string): boolean {
    return this.versionIndex.get(packId)?.has(version) ?? false;
  }

  /**
   * Generate human-readable version string from version components
   */
  private calculateNextVersion(existingVersion?: string, requestedVersion?: string): string {
    if (requestedVersion) {
      // Validate and use requested version
      this.validateVersion(requestedVersion);
      return requestedVersion;
    }

    if (!existingVersion) {
      return '1.0.0';
    }

    const { major, minor, patch } = this.parseVersion(existingVersion);
    
    // Auto-increment patch by default
    return `${major}.${minor}.${patch + 1}`;
  }

  /**
   * Parse semantic version string
   */
  private parseVersion(version: string): { major: number; minor: number; patch: number } {
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!match) {
      throw new Error(`Invalid semantic version: ${version}`);
    }
    
    return {
      major: parseInt(match[1], 10),
      minor: parseInt(match[2], 10),
      patch: parseInt(match[3], 10),
    };
  }

  /**
   * Validate semantic version format
   */
  private validateVersion(version: string): void {
    if (!version.match(/^\d+\.\d+\.\d+$/)) {
      throw new Error(`Invalid semantic version: ${version}`);
    }
  }

  /**
   * Generate version change description
   */
  private generateVersionChanges(
    previousMetadata?: PackMetadata,
    currentMetadata?: PackMetadata
  ): string {
    if (!previousMetadata) return 'Initial version';

    const changes: string[] = [];

    if (previousMetadata.name !== currentMetadata?.name) {
      changes.push(`Name changed from "${previousMetadata.name}" to "${currentMetadata.name}"`);
    }
    if (previousMetadata.description !== currentMetadata?.description) {
      changes.push('Description updated');
    }
    if (previousMetadata.author !== currentMetadata?.author) {
      changes.push(`Author changed from "${previousMetadata.author}" to "${currentMetadata.author}"`);
    }
    if (previousMetadata.tags.length !== currentMetadata?.tags.length) {
      changes.push(`Tags changed (${previousMetadata.tags.length} → ${currentMetadata?.tags.length})`);
    }
    if (currentMetadata?.version && currentMetadata.version !== previousMetadata.version) {
      changes.push(`Version updated to ${currentMetadata.version}`);
    }

    return changes.length > 0 ? changes.join('; ') : 'No significant changes';
  }

  /**
   * Get IDs in date range for an index
   */
  private getDateRangeIds(
    start: string,
    end: string,
    index: Map<string, Set<string>>
  ): Set<string> {
    const result = new Set<string>();

    for (const [date, ids] of index.entries()) {
      if (date >= start && date <= end) {
        for (const id of ids) {
          result.add(id);
        }
      }
    }

    return result;
  }

  /**
   * Update all indexes for a Pack
   */
  private updateIndexes(pack: Pack, operation: 'add' | 'update' | 'remove'): void {
    const { id, metadata } = pack;
    const { author, tags, createdAt, updatedAt, name } = metadata;

    // Author index
    if (operation === 'add' || operation === 'update') {
      if (!this.authorIndex.has(author)) {
        this.authorIndex.set(author, new Set());
      }
      this.authorIndex.get(author)!.add(id);
    } else if (operation === 'remove') {
      const authorSet = this.authorIndex.get(author);
      authorSet?.delete(id);
    }

    // Tags index (add all tags)
    if (operation === 'add' || operation === 'update') {
      for (const tag of tags) {
        if (!this.tagIndex.has(tag)) {
          this.tagIndex.set(tag, new Set());
        }
        this.tagIndex.get(tag)!.add(id);
      }
    } else if (operation === 'remove') {
      for (const tag of tags) {
        const tagSet = this.tagIndex.get(tag);
        tagSet?.delete(id);
      }
    }

    // Date indexes
    this.updateIndexMap(this.createdAtIndex, createdAt, id, operation);
    this.updateIndexMap(this.updatedAtIndex, updatedAt, id, operation);

    // Name index
    if (operation === 'add' || operation === 'update') {
      const nameKey = name.toLowerCase();
      if (!this.nameIndex.has(nameKey)) {
        this.nameIndex.set(nameKey, new Set());
      }
      this.nameIndex.get(nameKey)!.add(id);
    } else if (operation === 'remove') {
      const nameKey = name.toLowerCase();
      const nameSet = this.nameIndex.get(nameKey);
      nameSet?.delete(id);
    }
  }

  /**
   * Update a date-based index map
   */
  private updateIndexMap(
    index: Map<string, Set<string>>,
    date: string,
    id: string,
    operation: 'add' | 'update' | 'remove'
  ): void {
    if (operation === 'add' || operation === 'update') {
      if (!index.has(date)) {
        index.set(date, new Set());
      }
      index.get(date)!.add(id);
    } else if (operation === 'remove') {
      const dateSet = index.get(date);
      dateSet?.delete(id);
    }
  }
}

/**
 * Create a new PackRepository instance
 */
export function createPackRepository(): PackRepository {
  return new PackRepository();
}

// Export types
export type { PackQueryOptions, PackQueryResult };