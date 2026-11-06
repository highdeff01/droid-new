/**
 * Execution Repository and Archiving
 *
 * Implements CRUD operations for workflow and pack execution records with:
 * - Save/load of workflow and pack execution records
 * - Query execution history with filtering
 * - Execution statistics and reports generation
 * - Archiving and cleanup of old records
 *
 * Storage Strategy:
 * - In-memory storage for prototype (can be extended to IndexedDB/LocalStorage)
 * - Separate storage for active records and archived records
 * - Archive strategy: move records older than configurable threshold to archive
 *
 * Features:
 * - Filter by source (workflow/pack/habit), status, date range, success/failure
 * - Statistics aggregation for analytics and reports
 * - Archiving with configurable retention period
 * - Cleanup of archived records beyond retention
 */

import type {
  ExecutionRecord as WorkflowExecutionRecord,
  ExecutionMetrics,
  ExecutionFeedback,
  LineageRecord,
  ExecutionContext,
} from './workflow-types';

import type {
  PackExecutionRecord,
  ExecutionMetrics as PackExecutionMetrics,
} from './pack-types';

import type {
  ExecutionFeedbackRecord,
  ExecutionMetricsSummary,
} from './pack-execution-feedback';

import type {
  ExecutionResult,
  ExecutionMetrics as IntegrationExecutionMetrics,
  LineageRecord as IntegrationLineageRecord,
  ExecutionContext as IntegrationExecutionContext,
} from './integration-types';

import type { EntityId, Timestamp } from './integration-types';

/**
 * Execution status for filtering
 */
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Source type for execution records
 */
export type ExecutionSource = 'workflow' | 'pack' | 'habit';

/**
 * Archive status for execution records
 */
export type ArchiveStatus = 'active' | 'archived';

/**
 * Execution record with complete metadata
 */
export interface ExecutionRecord {
  /** Unique execution identifier */
  executionId: EntityId;

  /** Source of execution (workflow, pack, habit) */
  source: ExecutionSource;

  /** Source entity ID */
  sourceId: EntityId;

  /** Execution status */
  status: ExecutionStatus;

  /** ISO 8601 timestamp when execution started */
  startedAt: Timestamp;

  /** ISO 8601 timestamp when execution completed */
  completedAt?: Timestamp;

  /** Execution duration in milliseconds */
  durationMs: number;

  /** Whether execution succeeded */
  success: boolean;

  /** Execution metrics */
  metrics: ExecutionMetrics | PackExecutionMetrics | IntegrationExecutionMetrics;

  /** Execution feedback */
  feedback?: ExecutionFeedback;

  /** Lineage information */
  lineage: LineageRecord | IntegrationLineageRecord;

  /** Execution context */
  context: ExecutionContext | IntegrationExecutionContext;

  /** Archive status */
  archiveStatus: ArchiveStatus;

  /** ISO 8601 timestamp when record was archived */
  archivedAt?: Timestamp;

  /** Optional metadata for custom filtering */
  metadata?: Record<string, unknown>;

  /** ISO 8601 timestamp when record was created */
  createdAt: Timestamp;

  /** ISO 8601 timestamp when record was last updated */
  updatedAt: Timestamp;
}

/**
 * Query options for execution history
 */
export interface ExecutionQueryOptions {
  /** Filter by source type */
  source?: ExecutionSource;
  /** Filter by status */
  status?: ExecutionStatus;
  /** Filter by date range */
  dateRange?: {
    start?: Timestamp;
    end?: Timestamp;
  };
  /** Filter by success/failure */
  success?: boolean;
  /** Filter by archive status */
  archiveStatus?: ArchiveStatus;
  /** Search by source ID */
  sourceId?: EntityId;
  /** Maximum results to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Sort field */
  sortBy?: 'startedAt' | 'completedAt' | 'durationMs' | 'createdAt';
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Execution query result with pagination
 */
export interface ExecutionQueryResult {
  /** Matching execution records */
  items: ExecutionRecord[];
  /** Total count of matching records */
  total: number;
  /** Pagination info */
  pagination?: { limit: number; offset: number; page: number; totalPages: number };
}

/**
 * Execution statistics for reports
 */
export interface ExecutionStats {
  /** Total number of executions */
  totalCount: number;

  /** Number of successful executions */
  successCount: number;

  /** Number of failed executions */
  failureCount: number;

  /** Success rate as percentage */
  successRate: number;

  /** Average duration in milliseconds */
  avgDurationMs: number;

  /** Minimum duration in milliseconds */
  minDurationMs: number;

  /** Maximum duration in milliseconds */
  maxDurationMs: number;

  /** Duration statistics by source */
  bySource?: {
    workflow?: ExecutionMetricSummary;
    pack?: ExecutionMetricSummary;
    habit?: ExecutionMetricSummary;
  };

  /** Duration statistics by status */
  byStatus?: {
    pending?: ExecutionMetricSummary;
    running?: ExecutionMetricSummary;
    completed?: ExecutionMetricSummary;
    failed?: ExecutionMetricSummary;
    cancelled?: ExecutionMetricSummary;
  };

  /** Timestamp of most recent execution */
  lastExecutionAt?: Timestamp;

  /** Timestamp of oldest execution */
  firstExecutionAt?: Timestamp;
}

/**
 * Summary of execution metrics
 */
export interface ExecutionMetricSummary {
  /** Total count */
  count: number;

  /** Average duration in milliseconds */
  avgDurationMs: number;

  /** Minimum duration in milliseconds */
  minDurationMs: number;

  /** Maximum duration in milliseconds */
  maxDurationMs: number;

  /** Success count */
  successCount: number;

  /** Failure count */
  failureCount: number;

  /** Success rate as percentage */
  successRate: number;
}

/**
 * Archive configuration
 */
export interface ArchiveConfig {
  /** Number of days before moving to archive */
  archiveAfterDays: number;

  /** Number of days before deleting from archive */
  deleteFromArchiveAfterDays: number;

  /** Default archive status */
  defaultArchiveStatus: ArchiveStatus;
}

/**
 * Execution repository class
 */
export class ExecutionRepository {
  private activeExecutions: Map<string, ExecutionRecord> = new Map();
  private archivedExecutions: Map<string, ExecutionRecord> = new Map();
  private archiveConfig: ArchiveConfig = {
    archiveAfterDays: 90,
    deleteFromArchiveAfterDays: 365,
    defaultArchiveStatus: 'active',
  };

  /**
   * Creates a new execution repository
   * @param config - Archive configuration options
   */
  constructor(config?: Partial<ArchiveConfig>) {
    if (config) {
      this.archiveConfig = { ...this.archiveConfig, ...config };
    }
  }

  /**
   * Save a workflow execution record
   * @param record - Workflow execution record to save
   */
  saveWorkflowExecution(record: WorkflowExecutionRecord): void {
    this.saveExecution({
      ...record,
      source: 'workflow',
      archiveStatus: this.archiveConfig.defaultArchiveStatus,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Save a pack execution record
   * @param record - Pack execution record to save
   */
  savePackExecution(record: PackExecutionRecord): void {
    this.saveExecution({
      ...record,
      source: 'pack',
      archiveStatus: this.archiveConfig.defaultArchiveStatus,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Save an execution record (internal method)
   * @param record - Execution record to save
   */
  private saveExecution(record: ExecutionRecord): void {
    const now = new Date().toISOString();

    // Validate record
    if (!record.executionId) {
      throw new Error('Execution record must have an executionId');
    }

    // Update timestamps
    record.updatedAt = now;

    // Determine if this is an update or new record
    const existing = this.activeExecutions.get(record.executionId) ||
      this.archivedExecutions.get(record.executionId);

    if (existing) {
      // Move from archived to active if status changed from archived
      if (existing.archiveStatus === 'archived' && record.archiveStatus !== 'archived') {
        this.archivedExecutions.delete(record.executionId);
        this.activeExecutions.set(record.executionId, record);
      } else {
        // Update existing record
        if (record.archiveStatus === 'archived') {
          this.archivedExecutions.set(record.executionId, record);
        } else {
          this.activeExecutions.set(record.executionId, record);
        }
      }
    } else {
      // Add new record
      if (record.archiveStatus === 'archived') {
        this.archivedExecutions.set(record.executionId, record);
      } else {
        this.activeExecutions.set(record.executionId, record);
      }
    }
  }

  /**
   * Load an execution record by ID
   * @param executionId - Execution identifier
   * @returns Execution record or undefined if not found
   */
  loadExecution(executionId: string): ExecutionRecord | undefined {
    return this.activeExecutions.get(executionId) ||
      this.archivedExecutions.get(executionId);
  }

  /**
   * Find execution history with filtering
   * @param options - Query options for filtering
   * @returns Query result with pagination
   */
  findExecutionHistory(options: ExecutionQueryOptions = {}): ExecutionQueryResult {
    let results: ExecutionRecord[] = this.getAllExecutions();

    // Filter by source
    if (options.source) {
      results = results.filter(r => r.source === options.source);
    }

    // Filter by status
    if (options.status) {
      results = results.filter(r => r.status === options.status);
    }

    // Filter by date range
    if (options.dateRange) {
      const { start, end } = options.dateRange;
      if (start) {
        results = results.filter(r => r.startedAt >= start);
      }
      if (end) {
        results = results.filter(r => r.completedAt ? r.completedAt <= end : true);
      }
    }

    // Filter by success/failure
    if (options.success !== undefined) {
      results = results.filter(r => r.success === options.success);
    }

    // Filter by archive status
    if (options.archiveStatus) {
      results = results.filter(r => r.archiveStatus === options.archiveStatus);
    }

    // Filter by source ID
    if (options.sourceId) {
      results = results.filter(r => r.sourceId === options.sourceId);
    }

    // Sort results
    if (options.sortBy) {
      results.sort((a, b) => {
        let comparison = 0;
        const aVal = a[options.sortBy!];
        const bVal = b[options.sortBy!];

        if (aVal < bVal) comparison = -1;
        if (aVal > bVal) comparison = 1;

        return options.sortOrder === 'desc' ? -comparison : comparison;
      });
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
   * Query execution statistics and generate reports
   * @param filters - Filter options for statistics
   * @returns Execution statistics summary
   */
  queryExecutionStats(filters: {
    source?: ExecutionSource;
    status?: ExecutionStatus;
    dateRange?: { start?: Timestamp; end?: Timestamp };
  } = {}): ExecutionStats {
    const allExecutions = this.getAllExecutions();
    let filteredExecutions = allExecutions;

    // Apply filters
    if (filters.source) {
      filteredExecutions = filteredExecutions.filter(e => e.source === filters.source);
    }

    if (filters.status) {
      filteredExecutions = filteredExecutions.filter(e => e.status === filters.status);
    }

    if (filters.dateRange) {
      const { start, end } = filters.dateRange;
      if (start) {
        filteredExecutions = filteredExecutions.filter(e => e.startedAt >= start);
      }
      if (end) {
        filteredExecutions = filteredExecutions.filter(e => e.completedAt ? e.completedAt <= end : true);
      }
    }

    const totalCount = filteredExecutions.length;
    const successCount = filteredExecutions.filter(e => e.success).length;
    const failureCount = totalCount - successCount;
    const successRate = totalCount > 0 ? (successCount / totalCount) * 100 : 0;

    // Calculate duration statistics
    const durations = filteredExecutions.map(e => e.durationMs);
    const avgDurationMs = durations.length > 0
      ? durations.reduce((sum, d) => sum + d, 0) / durations.length
      : 0;
    const minDurationMs = durations.length > 0 ? Math.min(...durations) : 0;
    const maxDurationMs = durations.length > 0 ? Math.max(...durations) : 0;

    // Calculate statistics by source
    const bySource: ExecutionStats['bySource'] = {};
    const sources: ExecutionSource[] = ['workflow', 'pack', 'habit'];
    for (const source of sources) {
      const sourceExecutions = filteredExecutions.filter(e => e.source === source);
      if (sourceExecutions.length > 0) {
        const sourceDurations = sourceExecutions.map(e => e.durationMs);
        bySource[source] = {
          count: sourceExecutions.length,
          avgDurationMs: sourceDurations.reduce((sum, d) => sum + d, 0) / sourceDurations.length,
          minDurationMs: Math.min(...sourceDurations),
          maxDurationMs: Math.max(...sourceDurations),
          successCount: sourceExecutions.filter(e => e.success).length,
          failureCount: sourceExecutions.length - sourceExecutions.filter(e => e.success).length,
          successRate: (sourceExecutions.filter(e => e.success).length / sourceExecutions.length) * 100,
        };
      }
    }

    // Calculate statistics by status
    const byStatus: ExecutionStats['byStatus'] = {};
    const statuses: ExecutionStatus[] = ['pending', 'running', 'completed', 'failed', 'cancelled'];
    for (const status of statuses) {
      const statusExecutions = filteredExecutions.filter(e => e.status === status);
      if (statusExecutions.length > 0) {
        const statusDurations = statusExecutions.map(e => e.durationMs);
        byStatus[status] = {
          count: statusExecutions.length,
          avgDurationMs: statusDurations.reduce((sum, d) => sum + d, 0) / statusDurations.length,
          minDurationMs: Math.min(...statusDurations),
          maxDurationMs: Math.max(...statusDurations),
          successCount: statusExecutions.filter(e => e.success).length,
          failureCount: statusExecutions.length - statusExecutions.filter(e => e.success).length,
          successRate: (statusExecutions.filter(e => e.success).length / statusExecutions.length) * 100,
        };
      }
    }

    // Find first and last execution timestamps
    const timestamps = filteredExecutions
      .map(e => e.startedAt)
      .filter((t): t is string => !!t)
      .sort();

    return {
      totalCount,
      successCount,
      failureCount,
      successRate,
      avgDurationMs,
      minDurationMs,
      maxDurationMs,
      bySource,
      byStatus,
      lastExecutionAt: timestamps.length > 0 ? timestamps[timestamps.length - 1] : undefined,
      firstExecutionAt: timestamps.length > 0 ? timestamps[0] : undefined,
    };
  }

  /**
   * Archive old execution records based on configuration
   * @param referenceDate - Date to use as reference for age calculation (default: now)
   * @returns Number of records archived
   */
  archiveOldRecords(referenceDate: Date = new Date()): number {
    const archivedCount = this.activeExecutions.size;
    const recordsToArchive: string[] = [];

    // Find records to archive
    for (const [executionId, record] of this.activeExecutions.entries()) {
      const recordDate = new Date(record.startedAt);
      const daysDiff = this.daysDifference(recordDate, referenceDate);

      if (daysDiff >= this.archiveConfig.archiveAfterDays) {
        recordsToArchive.push(executionId);
      }
    }

    // Move records to archive
    for (const executionId of recordsToArchive) {
      const record = this.activeExecutions.get(executionId);
      if (record) {
        record.archiveStatus = 'archived';
        record.archivedAt = referenceDate.toISOString();
        record.updatedAt = referenceDate.toISOString();

        this.activeExecutions.delete(executionId);
        this.archivedExecutions.set(executionId, record);
      }
    }

    return recordsToArchive.length;
  }

  /**
   * Cleanup old archived records beyond retention period
   * @param referenceDate - Date to use as reference for age calculation (default: now)
   * @returns Number of records deleted
   */
  cleanup(referenceDate: Date = new Date()): number {
    const deletedCount = this.archivedExecutions.size;
    const recordsToDelete: string[] = [];

    // Find records to delete
    for (const [executionId, record] of this.archivedExecutions.entries()) {
      const recordDate = new Date(record.archivedAt || record.startedAt);
      const daysDiff = this.daysDifference(recordDate, referenceDate);

      if (daysDiff >= this.archiveConfig.deleteFromArchiveAfterDays) {
        recordsToDelete.push(executionId);
      }
    }

    // Delete records
    for (const executionId of recordsToDelete) {
      this.archivedExecutions.delete(executionId);
    }

    return deletedCount - this.archivedExecutions.size;
  }

  /**
   * Get all execution records (both active and archived)
   * @returns Array of all execution records
   */
  getAllExecutions(): ExecutionRecord[] {
    return [
      ...this.activeExecutions.values(),
      ...this.archivedExecutions.values(),
    ];
  }

  /**
   * Get count of all execution records
   * @returns Total count of execution records
   */
  getCount(): number {
    return this.activeExecutions.size + this.archivedExecutions.size;
  }

  /**
   * Get count of active execution records
   * @returns Count of active execution records
   */
  getActiveCount(): number {
    return this.activeExecutions.size;
  }

  /**
   * Get count of archived execution records
   * @returns Count of archived execution records
   */
  getArchivedCount(): number {
    return this.archivedExecutions.size;
  }

  /**
   * Get active executions by source
   * @param source - Source type to filter by
   * @returns Array of active execution records for source
   */
  getActiveExecutionsBySource(source: ExecutionSource): ExecutionRecord[] {
    return [...this.activeExecutions.values()].filter(r => r.source === source);
  }

  /**
   * Get archived executions by source
   * @param source - Source type to filter by
   * @returns Array of archived execution records for source
   */
  getArchivedExecutionsBySource(source: ExecutionSource): ExecutionRecord[] {
    return [...this.archivedExecutions.values()].filter(r => r.source === source);
  }

  /**
   * Export execution records to JSON
   * @param options - Export options (source, date range, etc.)
   * @returns JSON string of execution records
   */
  exportExecutions(options: ExecutionQueryOptions = {}): string {
    const result = this.findExecutionHistory(options);
    return JSON.stringify(result.items, null, 2);
  }

  /**
   * Import execution records from JSON
   * @param json - JSON string of execution records
   */
  importExecutions(json: string): void {
    try {
      const records = JSON.parse(json) as ExecutionRecord[];
      for (const record of records) {
        this.saveExecution(record);
      }
    } catch (error) {
      throw new Error(`Failed to import execution records: ${error instanceof Error ? error.message : 'Invalid JSON'}`);
    }
  }

  /**
   * Clear all execution records
   * @param archiveInstead - If true, archive instead of delete
   * @returns Number of records cleared
   */
  clear(archiveInstead: boolean = false): number {
    const count = this.activeExecutions.size + this.archivedExecutions.size;

    if (archiveInstead) {
      // Archive all active records
      for (const [executionId, record] of this.activeExecutions.entries()) {
        record.archiveStatus = 'archived';
        record.archivedAt = new Date().toISOString();
        record.updatedAt = new Date().toISOString();

        this.activeExecutions.delete(executionId);
        this.archivedExecutions.set(executionId, record);
      }
    } else {
      // Clear all records
      this.activeExecutions.clear();
      this.archivedExecutions.clear();
    }

    return count;
  }

  /**
   * Update archive configuration
   * @param config - New archive configuration
   */
  updateArchiveConfig(config: Partial<ArchiveConfig>): void {
    this.archiveConfig = { ...this.archiveConfig, ...config };
  }

  /**
   * Get archive configuration
   * @returns Current archive configuration
   */
  getArchiveConfig(): ArchiveConfig {
    return { ...this.archiveConfig };
  }

  /**
   * Calculate the difference in days between two dates
   * @param date1 - First date
   * @param date2 - Second date
   * @returns Difference in days
   */
  private daysDifference(date1: Date, date2: Date): number {
    const oneDay = 24 * 60 * 60 * 1000;
    const diff = date2.getTime() - date1.getTime();
    return Math.round(diff / oneDay);
  }

  /**
   * Create a new execution record from execution result
   * @param executionId - Execution identifier
   * @param source - Source type (workflow/pack/habit)
   * @param sourceId - Source entity ID
   * @param success - Whether execution succeeded
   * @param durationMs - Execution duration in milliseconds
   * @param metrics - Execution metrics
   * @param context - Execution context
   * @param lineage - Execution lineage
   * @returns ExecutionRecord
   */
  createExecutionRecord(
    executionId: EntityId,
    source: ExecutionSource,
    sourceId: EntityId,
    success: boolean,
    durationMs: number,
    metrics: ExecutionMetrics | PackExecutionMetrics | IntegrationExecutionMetrics,
    context: ExecutionContext | IntegrationExecutionContext,
    lineage: LineageRecord | IntegrationLineageRecord,
    status: ExecutionStatus = 'completed'
  ): ExecutionRecord {
    const now = new Date().toISOString();

    return {
      executionId,
      source,
      sourceId,
      status,
      startedAt: now,
      completedAt: now,
      durationMs,
      success,
      metrics,
      lineage,
      context,
      archiveStatus: this.archiveConfig.defaultArchiveStatus,
      createdAt: now,
      updatedAt: now,
    };
  }
}

/**
 * Create a new execution repository
 * @param config - Archive configuration options
 * @returns ExecutionRepository instance
 */
export function createExecutionRepository(config?: Partial<ArchiveConfig>): ExecutionRepository {
  return new ExecutionRepository(config);
}

// Export types
export type {
  ExecutionRecord,
  ExecutionQueryOptions,
  ExecutionQueryResult,
  ExecutionStats,
  ExecutionMetricSummary,
  ArchiveConfig,
};