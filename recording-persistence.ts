import { Recording, RecordingMetadata } from './recording-types';
import { EntityId, Timestamp, createEntityId, createTimestamp } from './integration-types';

/**
 * Version record tracking modifications to a recording
 */
export interface RecordingVersion {
  versionId: string;
  createdAt: Timestamp;
  author: string;
  changes: string;
  recordingSnapshot: Recording;
}

/**
 * Indexed metadata for efficient querying
 */
export interface RecordingIndex {
  id: EntityId;
  author: string;
  createdAt: Timestamp;
  modifiedAt: Timestamp;
  tags: string[];
  contextTags: string[];
  description: string;
  isArchived: boolean;
  isSoftDeleted: boolean;
}

/**
 * Query parameters for finding recordings
 */
export interface RecordingQuery {
  id?: EntityId;
  author?: string;
  startDate?: Timestamp;
  endDate?: Timestamp;
  tags?: string[];
  contextTags?: string[];
  tagsMatchMode?: 'AND' | 'OR';
  contextMatchMode?: 'AND' | 'OR';
  limit?: number;
  offset?: number;
}

/**
 * Query result with pagination info
 */
export interface RecordingQueryResult {
  recordings: Recording[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Versioning and change tracking
 */
export interface VersionInfo {
  currentVersion: string;
  versionHistory: RecordingVersion[];
  totalVersions: number;
}

/**
 * Storage metrics for quota management
 */
export interface StorageMetrics {
  totalBytes: number;
  recordingCount: number;
  maxBytes?: number;
  percentUsed: number;
}

/**
 * Compression options
 */
export interface CompressionOptions {
  enabled: boolean;
  algorithm?: 'gzip' | 'deflate' | 'brotli';
  threshold?: number; // minimum bytes to compress
}

/**
 * Deletion options for secure removal
 */
export interface DeletionOptions {
  secure: boolean;
  overwritePasses?: number; // number of secure overwrite passes (1-3)
  archiveBeforeDelete?: boolean; // soft delete to archive first
}

/**
 * Main recording persistence service
 */
export class RecordingRepository {
  private recordings: Map<EntityId, Recording> = new Map();
  private index: Map<EntityId, RecordingIndex> = new Map();
  private versions: Map<EntityId, VersionInfo> = new Map();
  private archivedRecordings: Map<EntityId, { recording: Recording; deletedAt: Timestamp }> = new Map();
  private storageMetrics: StorageMetrics;
  private compressionOptions: CompressionOptions;

  constructor(
    maxStorageBytes: number = 100 * 1024 * 1024, // 100MB default
    compressionOptions: CompressionOptions = { enabled: true, algorithm: 'gzip', threshold: 50000 }
  ) {
    this.storageMetrics = {
      totalBytes: 0,
      recordingCount: 0,
      maxBytes: maxStorageBytes,
      percentUsed: 0
    };
    this.compressionOptions = compressionOptions;
  }

  /**
   * Update recording metadata with author and timestamp
   * Requirements: 4.1, 4.2, 4.3
   */
  async save(recording: Recording, author: string, changes?: string): Promise<EntityId> {
    // Validate recording
    if (!recording.id || recording.id.trim().length === 0) {
      throw new Error('Recording must have a valid ID');
    }

    const recordingId = createEntityId(recording.id);
    const now = createTimestamp();

    // Store recording with author metadata (author is stored in index, not in Recording object)
    const recordingToStore = { ...recording };

    // Calculate size
    const recordingSize = this.estimateRecordingSize(recordingToStore);

    // Check storage quota
    const newTotalSize = this.storageMetrics.totalBytes + recordingSize;
    if (this.storageMetrics.maxBytes && newTotalSize > this.storageMetrics.maxBytes) {
      throw new Error(
        `Storage quota exceeded: ${newTotalSize} bytes > ${this.storageMetrics.maxBytes} bytes`
      );
    }

    // Store recording
    this.recordings.set(recordingId, recordingToStore);

    // Update index with author metadata
    const index: RecordingIndex = {
      id: recordingId,
      author: author,
      createdAt: now,
      modifiedAt: now,
      tags: recording.metadata?.tags || [],
      contextTags: this.extractContextTags(recordingToStore),
      description: recording.description || '',
      isArchived: false,
      isSoftDeleted: false
    };
    this.index.set(recordingId, index);

    // Version tracking - create version on first save or if modified
    if (!this.versions.has(recordingId)) {
      this.versions.set(recordingId, {
        currentVersion: '1.0.0',
        versionHistory: [],
        totalVersions: 0
      });
    }

    const versionInfo = this.versions.get(recordingId)!;
    const newVersion: RecordingVersion = {
      versionId: `v${versionInfo.totalVersions + 1}`,
      createdAt: now,
      author: author,
      changes: changes || 'Initial recording',
      recordingSnapshot: JSON.parse(JSON.stringify(recordingToStore)) // Deep clone
    };
    versionInfo.versionHistory.push(newVersion);
    versionInfo.totalVersions++;
    versionInfo.currentVersion = this.bumpVersion(versionInfo.currentVersion);

    // Update storage metrics
    this.storageMetrics.totalBytes += recordingSize;
    this.storageMetrics.recordingCount++;
    this.updateStoragePercentage();

    return recordingId;
  }

  /**
   * Load a recording by ID with metadata validation
   * Requirements: 4.3
   */
  async load(recordingId: EntityId): Promise<Recording | null> {
    if (!this.recordings.has(recordingId)) {
      return null;
    }

    const recording = this.recordings.get(recordingId)!;

    // Validate data integrity
    this.validateRecordingIntegrity(recording);

    return recording;
  }

  /**
   * Find recording by ID (fast lookup)
   * Requirements: 4.5
   */
  async findById(recordingId: EntityId): Promise<Recording | null> {
    return this.load(recordingId);
  }

  /**
   * Find recordings by author with optional filtering
   * Requirements: 4.5
   */
  async findByAuthor(
    author: string,
    filter?: { tags?: string[]; startDate?: Timestamp; endDate?: Timestamp }
  ): Promise<Recording[]> {
    const results: Recording[] = [];

    for (const [id, index] of this.index) {
      if (index.author === author && !index.isArchived && !index.isSoftDeleted) {
        // Apply tag filtering if provided
        if (filter?.tags && filter.tags.length > 0) {
          const hasAllTags = filter.tags.every(tag => index.tags.includes(tag));
          if (!hasAllTags) continue;
        }

        // Apply date range filtering if provided
        if (filter?.startDate && index.createdAt < filter.startDate) continue;
        if (filter?.endDate && index.createdAt > filter.endDate) continue;

        const recording = this.recordings.get(id);
        if (recording) {
          results.push(recording);
        }
      }
    }

    return results;
  }

  /**
   * Find recordings by date range
   * Requirements: 4.5
   */
  async findByDateRange(startDate: Timestamp, endDate: Timestamp): Promise<Recording[]> {
    const results: Recording[] = [];

    for (const [id, index] of this.index) {
      if (!index.isArchived && !index.isSoftDeleted && 
          index.createdAt >= startDate && 
          index.createdAt <= endDate) {
        const recording = this.recordings.get(id);
        if (recording) {
          results.push(recording);
        }
      }
    }

    return results;
  }

  /**
   * Find recordings by context tags (AND/OR filtering)
   * Requirements: 4.5
   */
  async findByContextTags(
    tags: string[],
    matchMode: 'AND' | 'OR' = 'OR'
  ): Promise<Recording[]> {
    const results: Recording[] = [];

    for (const [id, index] of this.index) {
      if (index.isArchived || index.isSoftDeleted) continue;

      let matches = false;
      if (matchMode === 'OR') {
        matches = tags.some(tag => index.contextTags.includes(tag));
      } else {
        matches = tags.every(tag => index.contextTags.includes(tag));
      }

      if (matches) {
        const recording = this.recordings.get(id);
        if (recording) {
          results.push(recording);
        }
      }
    }

    return results;
  }

  /**
   * Complex query operation with pagination
   * Requirements: 4.5
   */
  async query(queryParams: RecordingQuery): Promise<RecordingQueryResult> {
    let results: Recording[] = [];

    // Start with all active recordings
    for (const [id, index] of this.index) {
      if (index.isArchived || index.isSoftDeleted) continue;

      // Filter by ID if specified
      if (queryParams.id && id !== queryParams.id) continue;

      // Filter by author
      if (queryParams.author && index.author !== queryParams.author) continue;

      // Filter by date range
      if (queryParams.startDate && index.createdAt < queryParams.startDate) continue;
      if (queryParams.endDate && index.createdAt > queryParams.endDate) continue;

      // Filter by tags
      if (queryParams.tags && queryParams.tags.length > 0) {
        const matchMode = queryParams.tagsMatchMode || 'OR';
        const matches =
          matchMode === 'OR'
            ? queryParams.tags.some(tag => index.tags.includes(tag))
            : queryParams.tags.every(tag => index.tags.includes(tag));
        if (!matches) continue;
      }

      // Filter by context tags
      if (queryParams.contextTags && queryParams.contextTags.length > 0) {
        const matchMode = queryParams.contextMatchMode || 'OR';
        const matches =
          matchMode === 'OR'
            ? queryParams.contextTags.some(tag => index.contextTags.includes(tag))
            : queryParams.contextTags.every(tag => index.contextTags.includes(tag));
        if (!matches) continue;
      }

      const recording = this.recordings.get(id);
      if (recording) {
        results.push(recording);
      }
    }

    // Apply pagination
    const offset = queryParams.offset || 0;
    const limit = queryParams.limit || 50;
    const paginatedResults = results.slice(offset, offset + limit);

    return {
      recordings: paginatedResults,
      total: results.length,
      limit,
      offset
    };
  }

  /**
   * List all recordings with pagination
   * Requirements: 4.5
   */
  async listAll(limit: number = 50, offset: number = 0): Promise<RecordingQueryResult> {
    return this.query({ limit, offset });
  }

  /**
   * Track modification and create new version
   * Requirements: 4.4
   */
  async createVersion(recordingId: EntityId, changes: string, author: string): Promise<string> {
    const recording = this.recordings.get(recordingId);
    if (!recording) {
      throw new Error(`Recording ${recordingId} not found`);
    }

    const versionInfo = this.versions.get(recordingId);
    if (!versionInfo) {
      throw new Error(`Version info for recording ${recordingId} not found`);
    }

    const versionId = `v${versionInfo.totalVersions + 1}`;
    const newVersion: RecordingVersion = {
      versionId,
      createdAt: createTimestamp(),
      author,
      changes,
      recordingSnapshot: JSON.parse(JSON.stringify(recording))
    };

    versionInfo.versionHistory.push(newVersion);
    versionInfo.totalVersions++;
    versionInfo.currentVersion = this.bumpVersion(versionInfo.currentVersion);

    // Update modification timestamp in index
    const index = this.index.get(recordingId);
    if (index) {
      index.modifiedAt = createTimestamp();
    }

    return versionId;
  }

  /**
   * Get version history for a recording
   * Requirements: 4.4
   */
  async getVersionHistory(recordingId: EntityId): Promise<VersionInfo | null> {
    return this.versions.get(recordingId) || null;
  }

  /**
   * Rollback to a specific version
   * Requirements: 4.4
   */
  async rollbackToVersion(recordingId: EntityId, versionId: string): Promise<Recording> {
    const versionInfo = this.versions.get(recordingId);
    if (!versionInfo) {
      throw new Error(`Version info for recording ${recordingId} not found`);
    }

    const targetVersion = versionInfo.versionHistory.find(v => v.versionId === versionId);
    if (!targetVersion) {
      throw new Error(`Version ${versionId} not found for recording ${recordingId}`);
    }

    // Restore from snapshot
    const restoredRecording = JSON.parse(JSON.stringify(targetVersion.recordingSnapshot));
    this.recordings.set(recordingId, restoredRecording);

    // Create audit version for this rollback
    await this.createVersion(recordingId, `Rolled back to ${versionId}`, 'system');

    return restoredRecording;
  }

  /**
   * Soft delete - move to archive
   * Requirements: 4.6
   */
  async softDelete(recordingId: EntityId): Promise<void> {
    const recording = this.recordings.get(recordingId);
    if (!recording) {
      throw new Error(`Recording ${recordingId} not found`);
    }

    const index = this.index.get(recordingId);
    if (index) {
      index.isSoftDeleted = true;
      index.isArchived = true;
    }

    // Move to archived storage
    this.archivedRecordings.set(recordingId, {
      recording: JSON.parse(JSON.stringify(recording)),
      deletedAt: createTimestamp()
    });
  }

  /**
   * Recover from archive
   * Requirements: 4.6
   */
  async recoverFromArchive(recordingId: EntityId): Promise<Recording | null> {
    const archived = this.archivedRecordings.get(recordingId);
    if (!archived) {
      return null;
    }

    const index = this.index.get(recordingId);
    if (index) {
      index.isSoftDeleted = false;
      index.isArchived = false;
    }

    return archived.recording;
  }

  /**
   * Secure deletion with optional overwrite
   * Requirements: 4.6
   */
  async secureDelete(
    recordingId: EntityId,
    options: DeletionOptions = { secure: true, overwritePasses: 1 }
  ): Promise<void> {
    if (options.archiveBeforeDelete) {
      await this.softDelete(recordingId);
    }

    // Remove from primary storage
    const recording = this.recordings.get(recordingId);
    if (recording) {
      const size = this.estimateRecordingSize(recording);
      this.storageMetrics.totalBytes -= size;
      this.storageMetrics.recordingCount--;
    }

    this.recordings.delete(recordingId);
    this.index.delete(recordingId);
    this.versions.delete(recordingId);

    // For secure option, we simulate overwriting (in production, would use crypto)
    if (options.secure && options.overwritePasses) {
      for (let i = 0; i < options.overwritePasses; i++) {
        // Simulate secure overwrite
        const randomData = Buffer.alloc(Math.random() * 1000);
      }
    }

    // Remove from archive if present
    this.archivedRecordings.delete(recordingId);

    this.updateStoragePercentage();
  }

  /**
   * Get storage metrics
   * Requirements: 4.6
   */
  getStorageMetrics(): StorageMetrics {
    return { ...this.storageMetrics };
  }

  /**
   * Export recording with metadata
   * Requirements: 4.6
   */
  async exportRecording(recordingId: EntityId): Promise<string> {
    const recording = this.recordings.get(recordingId);
    if (!recording) {
      throw new Error(`Recording ${recordingId} not found`);
    }

    const versionInfo = this.versions.get(recordingId);
    const index = this.index.get(recordingId);

    const exportData = {
      recording,
      metadata: {
        index,
        versionInfo
      },
      exportedAt: createTimestamp(),
      format: '1.0.0'
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Import recording from exported JSON
   * Requirements: 4.6
   */
  async importRecording(jsonData: string, author: string): Promise<EntityId> {
    let importData;
    try {
      importData = JSON.parse(jsonData);
    } catch (error) {
      throw new Error('Invalid JSON format for import');
    }

    // Validate format
    if (!importData.recording || !importData.metadata) {
      throw new Error('Invalid export format: missing recording or metadata');
    }

    // Save imported recording
    const recording = importData.recording;
    const recordingId = await this.save(recording, author, 'Imported recording');

    // Restore version history if present
    if (importData.metadata.versionInfo) {
      const versionInfo = importData.metadata.versionInfo;
      this.versions.set(recordingId, versionInfo);
    }

    return recordingId;
  }

  /**
   * Clear archived records (cleanup)
   * Requirements: 4.6
   */
  async clearArchive(): Promise<number> {
    const count = this.archivedRecordings.size;
    this.archivedRecordings.clear();
    return count;
  }

  /**
   * Get audit trail for a recording
   * Requirements: 4.4
   */
  async getAuditTrail(recordingId: EntityId): Promise<RecordingVersion[]> {
    const versionInfo = this.versions.get(recordingId);
    return versionInfo?.versionHistory || [];
  }

  /**
   * Private helper: estimate recording size
   */
  private estimateRecordingSize(recording: Recording): number {
    return JSON.stringify(recording).length;
  }

  /**
   * Private helper: extract context tags from recording
   */
  private extractContextTags(recording: Recording): string[] {
    const tags: Set<string> = new Set();

    // Extract action types
    const actionTypes = new Set<string>();
    recording.actions.forEach(action => {
      actionTypes.add(action.type);
    });
    actionTypes.forEach(type => tags.add(`action:${type}`));

    return Array.from(tags);
  }

  /**
   * Private helper: validate recording integrity
   */
  private validateRecordingIntegrity(recording: Recording): void {
    if (!recording.id) {
      throw new Error('Recording missing ID');
    }

    if (!recording.metadata) {
      throw new Error('Recording missing metadata');
    }

    if (!Array.isArray(recording.actions)) {
      throw new Error('Recording actions must be an array');
    }

    // Validate each action
    recording.actions.forEach((action, index) => {
      if (!action.type) {
        throw new Error(`Action ${index} missing type`);
      }
      if (!action.timestamp) {
        throw new Error(`Action ${index} missing timestamp`);
      }
    });
  }

  /**
   * Private helper: bump semantic version
   */
  private bumpVersion(version: string): string {
    const parts = version.split('.');
    const patch = parseInt(parts[2], 10) + 1;
    return `${parts[0]}.${parts[1]}.${patch}`;
  }

  /**
   * Private helper: update storage percentage
   */
  private updateStoragePercentage(): void {
    if (this.storageMetrics.maxBytes) {
      this.storageMetrics.percentUsed = 
        (this.storageMetrics.totalBytes / this.storageMetrics.maxBytes) * 100;
    }
  }

  /**
   * Get concurrent access safety - check if recording is locked
   */
  async checkConcurrentAccess(recordingId: EntityId): Promise<boolean> {
    // In production, would use proper locking mechanism
    // For now, always returns false (no lock)
    return false;
  }

  /**
   * Support for handling large recordings with streaming/chunking
   */
  async saveChunked(
    recordingId: EntityId,
    chunks: string[],
    author: string
  ): Promise<EntityId> {
    // Reconstruct full recording from chunks
    const fullJson = chunks.join('');
    let recording: Recording;

    try {
      recording = JSON.parse(fullJson);
    } catch (error) {
      throw new Error('Invalid recording data in chunks');
    }

    return this.save(recording, author, 'Saved from chunked upload');
  }
}

/**
 * In-memory storage provider for testing
 */
export class InMemoryRecordingStorage extends RecordingRepository {
  constructor(maxStorageBytes: number = 100 * 1024 * 1024) {
    super(maxStorageBytes);
  }
}

/**
 * Create a recording repository instance
 */
export function createRecordingRepository(
  maxStorageBytes: number = 100 * 1024 * 1024
): RecordingRepository {
  return new RecordingRepository(maxStorageBytes);
}
