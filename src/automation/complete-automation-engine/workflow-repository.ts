/**
 * Workflow Repository
 *
 * Provides persistence for Workflow objects with execution history tracking.
 * Supports indexing by tags, creation date, and recordingId for fast queries.
 * Uses in-memory storage for prototype (can be extended to IndexedDB/LocalStorage).
 *
 * Features:
 * - Save/load Workflow objects with execution history
 * - Maintain foreign key to Recording (when applicable)
 * - Index by tags, creation date, and recordingId
 * - Efficient execution history updates
 * - Query methods for fast lookups
 *
 * Indexing Strategy:
 * - tagsIndex: Map<tag, Set<workflowId>>
 * - dateIndex: Map<dateKey, Set<workflowId>> (daily buckets)
 * - recordingIndex: Map<recordingId, Set<workflowId>> (foreign key to Recording)
 * - executionIndex: Map<executionId, Set<workflowId>> (for execution history)
 */

import type { Workflow, WorkflowMetadata } from './workflow-types';
import type { EntityId, Timestamp } from './integration-types';

/**
 * Execution record for tracking workflow executions
 */
export interface ExecutionRecord {
  /** Unique identifier for this execution */
  id: string;
  
  /** Workflow ID being executed */
  workflowId: string;
  
  /** ISO 8601 timestamp when execution started */
  startedAt: string;
  
  /** ISO 8601 timestamp when execution completed */
  completedAt?: string;
  
  /** Execution status */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  
  /** Execution result data */
  result?: unknown;
  
  /** Error information if execution failed */
  error?: string;
  
  /** Duration in milliseconds */
  durationMs?: number;
  
  /** Context used during execution */
  context?: Record<string, unknown>;
  
  /** Optional foreign key to Recording that triggered this execution */
  recordingId?: string;
  
  /** Execution metrics */
  metrics?: {
    stepsExecuted: number;
    stepsCompleted: number;
    stepsFailed: number;
  };
}

/**
 * Query options for filtering workflows
 */
export interface WorkflowQueryOptions {
  /** Filter by tags */
  tags?: string[];
  
  /** Filter by date range */
  dateRange?: {
    start?: string;  // ISO 8601 date string
    end?: string;    // ISO 8601 date string
  };
  
  /** Filter by recording ID (foreign key) */
  recordingId?: string;
  
  /** Filter by author */
  author?: string;
  
  /** Page number for pagination (1-indexed) */
  page?: number;
  
  /** Number of results per page */
  pageSize?: number;
}

/**
 * Query result with pagination support
 */
export interface WorkflowQueryResult {
  /** Total count of matching workflows */
  totalCount: number;
  
  /** Current page of workflows */
  workflows: Workflow[];
  
  /** Page number (1-indexed) */
  page: number;
  
  /** Page size */
  pageSize: number;
  
  /** Total number of pages */
  totalPages: number;
}

/**
 * Workflow repository class
 */
export class WorkflowRepository {
  // Storage for workflows
  private workflows: Map<string, Workflow> = new Map();
  
  // Storage for execution records
  private executionRecords: Map<string, ExecutionRecord> = new Map();
  
  // Indexes for fast queries
  private tagsIndex: Map<string, Set<string>> = new Map();
  private dateIndex: Map<string, Set<string>> = new Map();
  private recordingIndex: Map<string, Set<string>> = new Map();
  
  /**
   * Save a workflow
   * 
   * @param workflow - Workflow to save
   * @returns Saved workflow with metadata updated
   */
  save(workflow: Workflow): Workflow {
    const now = new Date().toISOString();
    const metadata: WorkflowMetadata = {
      ...workflow.metadata,
      updatedAt: now,
    };
    
    const savedWorkflow: Workflow = {
      ...workflow,
      metadata,
    };
    
    // Store the workflow
    this.workflows.set(workflow.id, savedWorkflow);
    
    // Update indexes
    this.updateIndexes(savedWorkflow, 'add');
    
    return savedWorkflow;
  }
  
  /**
   * Load a workflow by ID
   * 
   * @param id - Workflow ID
   * @returns Workflow if found, undefined otherwise
   */
  findById(id: string): Workflow | undefined {
    return this.workflows.get(id);
  }
  
  /**
   * Find workflows by recording ID (foreign key)
   * 
   * @param recordingId - Recording ID
   * @returns Array of workflows that reference this recording
   */
  findByRecordingId(recordingId: string): Workflow[] {
    const workflowIds = this.recordingIndex.get(recordingId);
    if (!workflowIds) {
      return [];
    }
    
    return Array.from(workflowIds)
      .map(id => this.workflows.get(id))
      .filter((wf): wf is Workflow => wf !== undefined);
  }
  
  /**
   * Find workflows by tags
   * 
   * @param tags - Array of tags to match
   * @returns Array of workflows with any of the specified tags
   */
  findByTags(tags: string[]): Workflow[] {
    // Start with all workflow IDs that have the first tag
    let matchingIds: Set<string> | undefined;
    
    for (const tag of tags) {
      const tagIds = this.tagsIndex.get(tag);
      if (tagIds) {
        if (!matchingIds) {
          matchingIds = new Set(tagIds);
        } else {
          // Union: add IDs from this tag
          for (const id of tagIds) {
            matchingIds.add(id);
          }
        }
      }
    }
    
    if (!matchingIds) {
      return [];
    }
    
    return Array.from(matchingIds)
      .map(id => this.workflows.get(id))
      .filter((wf): wf is Workflow => wf !== undefined);
  }
  
  /**
   * Find workflows created in a date range
   * 
   * @param start - Start date (ISO 8601)
   * @param end - End date (ISO 8601)
   * @returns Array of workflows created in date range
   */
  findByDateRange(start: string, end: string): Workflow[] {
    const startDate = new Date(start);
    const endDate = new Date(end);
    
    // Get all workflow IDs from date index within range
    const matchingIds = new Set<string>();
    
    for (const [dateKey, ids] of this.dateIndex.entries()) {
      const workflowDate = new Date(dateKey);
      
      if (workflowDate >= startDate && workflowDate <= endDate) {
        for (const id of ids) {
          matchingIds.add(id);
        }
      }
    }
    
    // Return workflows
    return Array.from(matchingIds)
      .map(id => this.workflows.get(id))
      .filter((wf): wf is Workflow => wf !== undefined);
  }
  
  /**
   * Update execution history for a workflow
   * 
   * @param executionRecord - Execution record to add/update
   * @returns Saved execution record
   */
  updateExecutionHistory(executionRecord: ExecutionRecord): ExecutionRecord {
    const now = new Date().toISOString();
    
    // Calculate duration if not provided and execution is completed
    if (!executionRecord.durationMs && executionRecord.completedAt && executionRecord.startedAt) {
      const duration = new Date(executionRecord.completedAt).getTime() - new Date(executionRecord.startedAt).getTime();
      executionRecord.durationMs = duration;
    }
    
    // If execution is completed, update workflow metadata
    if (executionRecord.status === 'completed' || executionRecord.status === 'failed') {
      const workflow = this.workflows.get(executionRecord.workflowId);
      if (workflow) {
        const metadata: WorkflowMetadata = {
          ...workflow.metadata,
          updatedAt: now,
          executionCount: workflow.metadata.executionCount + 1,
        };
        
        if (executionRecord.status === 'completed') {
          metadata.successCount = workflow.metadata.successCount + 1;
          if (workflow.metadata.averageDuration !== undefined) {
            // Update running average
            const prevTotal = workflow.metadata.averageDuration * (metadata.executionCount - 1);
            metadata.averageDuration = (prevTotal + (executionRecord.durationMs || 0)) / metadata.executionCount;
          } else {
            metadata.averageDuration = executionRecord.durationMs || 0;
          }
        } else {
          metadata.failureCount = workflow.metadata.failureCount + 1;
        }
        
        const updatedWorkflow: Workflow = {
          ...workflow,
          metadata,
        };
        
        this.workflows.set(workflow.id, updatedWorkflow);
      }
    }
    
    // Store execution record
    this.executionRecords.set(executionRecord.id, executionRecord);
    
    // Update execution index
    const workflowIds = this.tagsIndex.get(`_execution_${executionRecord.workflowId}`);
    if (workflowIds) {
      workflowIds.add(executionRecord.id);
    }
    
    return executionRecord;
  }
  
  /**
   * Get execution history for a workflow
   * 
   * @param workflowId - Workflow ID
   * @returns Array of execution records
   */
  getExecutionHistory(workflowId: string): ExecutionRecord[] {
    const history: ExecutionRecord[] = [];
    
    for (const record of this.executionRecords.values()) {
      if (record.workflowId === workflowId) {
        history.push(record);
      }
    }
    
    // Sort by startedAt (newest first)
    history.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    
    return history;
  }
  
  /**
   * Find execution records by various criteria
   * 
   * @param options - Query options
   * @returns Array of execution records
   */
  findExecutions(options: {
    workflowId?: string;
    recordingId?: string;
    status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    dateRange?: { start?: string; end?: string };
  } = {}): ExecutionRecord[] {
    let history = Array.from(this.executionRecords.values());
    
    // Filter by workflow ID
    if (options.workflowId) {
      history = history.filter(r => r.workflowId === options.workflowId);
    }
    
    // Filter by recording ID
    if (options.recordingId) {
      history = history.filter(r => r.recordingId === options.recordingId);
    }
    
    // Filter by status
    if (options.status) {
      history = history.filter(r => r.status === options.status);
    }
    
    // Filter by date range
    if (options.dateRange && options.dateRange.start && options.dateRange.end) {
      const startDate = new Date(options.dateRange.start);
      const endDate = new Date(options.dateRange.end);
      
      history = history.filter(record => {
        const startedAt = new Date(record.startedAt);
        return startedAt >= startDate && startedAt <= endDate;
      });
    }
    
    // Sort by startedAt (newest first)
    history.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    
    return history;
  }
  
  /**
   * Query workflows with multiple filters
   * 
   * @param options - Query options
   * @returns Query result with workflows and pagination
   */
  query(options: WorkflowQueryOptions = {}): WorkflowQueryResult {
    // Start with all workflow IDs
    let matchingIds = new Set<string>(this.workflows.keys());
    
    // Apply tags filter
    if (options.tags && options.tags.length > 0) {
      const tagIds = new Set<string>();
      
      for (const tag of options.tags) {
        const tagIdsSet = this.tagsIndex.get(tag);
        if (tagIdsSet) {
          for (const id of tagIdsSet) {
            tagIds.add(id);
          }
        }
      }
      
      // Intersect with existing matches
      matchingIds = this.intersectSets(matchingIds, tagIds);
    }
    
    // Apply date range filter
    if (options.dateRange) {
      const { start, end } = options.dateRange;
      if (start && end) {
        const dateIds = this.getDateRangeIds(start, end);
        matchingIds = this.intersectSets(matchingIds, dateIds);
      }
    }
    
    // Apply recording ID filter
    if (options.recordingId) {
      const recordingIds = this.recordingIndex.get(options.recordingId);
      if (recordingIds) {
        matchingIds = this.intersectSets(matchingIds, recordingIds);
      } else {
        // No workflows for this recording
        matchingIds = new Set();
      }
    }
    
    // Apply author filter
    if (options.author) {
      const authorIds = new Set<string>();
      
      for (const [id, workflow] of this.workflows.entries()) {
        if (workflow.metadata.source === options.author || 
            (workflow.metadata.tags && workflow.metadata.tags.includes(options.author))) {
          authorIds.add(id);
        }
      }
      
      matchingIds = this.intersectSets(matchingIds, authorIds);
    }
    
    // Convert to workflows array
    const workflows = Array.from(matchingIds)
      .map(id => this.workflows.get(id))
      .filter((wf): wf is Workflow => wf !== undefined);
    
    // Sort by creation date (newest first)
    workflows.sort((a, b) => new Date(b.metadata.createdAt).getTime() - new Date(a.metadata.createdAt).getTime());
    
    // Pagination
    const totalCount = workflows.length;
    const page = options.page || 1;
    const pageSize = options.pageSize || 50;
    const totalPages = Math.ceil(totalCount / pageSize);
    
    // Apply pagination
    const startIdx = (page - 1) * pageSize;
    const paginatedWorkflows = workflows.slice(startIdx, startIdx + pageSize);
    
    return {
      totalCount,
      workflows: paginatedWorkflows,
      page,
      pageSize,
      totalPages,
    };
  }
  
  /**
   * Delete a workflow
   * 
   * @param id - Workflow ID to delete
   * @returns true if deleted, false if not found
   */
  delete(id: string): boolean {
    const workflow = this.workflows.get(id);
    if (!workflow) {
      return false;
    }
    
    // Remove from storage
    this.workflows.delete(id);
    
    // Update indexes
    this.updateIndexes(workflow, 'remove');
    
    return true;
  }
  
  /**
   * Delete all workflows (bulk operation)
   * 
   * @returns Number of workflows deleted
   */
  deleteAll(): number {
    const count = this.workflows.size;
    
    // Clear storage
    this.workflows.clear();
    
    // Clear indexes
    this.tagsIndex.clear();
    this.dateIndex.clear();
    this.recordingIndex.clear();
    
    return count;
  }
  
  /**
   * Get total count of workflows
   * 
   * @returns Total count
   */
  getCount(): number {
    return this.workflows.size;
  }
  
  /**
   * Get all workflows
   * 
   * @returns Array of all workflows
   */
  getAll(): Workflow[] {
    return Array.from(this.workflows.values());
  }
  
  /**
   * Get all execution records
   * 
   * @returns Array of all execution records
   */
  getAllExecutionRecords(): ExecutionRecord[] {
    return Array.from(this.executionRecords.values());
  }
  
  /**
   * Get execution count for a workflow
   * 
   * @param workflowId - Workflow ID
   * @returns Number of executions
   */
  getExecutionCount(workflowId: string): number {
    let count = 0;
    
    for (const record of this.executionRecords.values()) {
      if (record.workflowId === workflowId) {
        count++;
      }
    }
    
    return count;
  }
  
  /**
   * Get the most recent execution for a workflow
   * 
   * @param workflowId - Workflow ID
   * @returns Most recent execution record or undefined
   */
  getLatestExecution(workflowId: string): ExecutionRecord | undefined {
    let latest: ExecutionRecord | undefined;
    
    for (const record of this.executionRecords.values()) {
      if (record.workflowId === workflowId) {
        if (!latest || new Date(record.startedAt) > new Date(latest.startedAt)) {
          latest = record;
        }
      }
    }
    
    return latest;
  }
  
  /**
   * Get workflow execution statistics
   * 
   * @param workflowId - Workflow ID
   * @returns Execution statistics or undefined if workflow doesn't exist
   */
  getExecutionStats(workflowId: string): {
    total: number;
    success: number;
    failed: number;
    cancelled: number;
    averageDuration?: number;
  } | undefined {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      return undefined;
    }
    
    return {
      total: workflow.metadata.executionCount,
      success: workflow.metadata.successCount,
      failed: workflow.metadata.failureCount,
      cancelled: 0, // Not tracked in metadata, would need to count from execution records
      averageDuration: workflow.metadata.averageDuration,
    };
  }
  
  /**
   * Get recording IDs referenced by workflows
   * 
   * @returns Set of recording IDs
   */
  getRecordingIds(): Set<string> {
    const recordingIds = new Set<string>();
    
    for (const workflow of this.workflows.values()) {
      for (const step of workflow.steps) {
        if (step.type === 'recording' && step.recordingId) {
          recordingIds.add(step.recordingId);
        }
      }
    }
    
    return recordingIds;
  }
  
  /**
   * Get workflow IDs that reference a specific recording
   * 
   * @param recordingId - Recording ID
   * @returns Array of workflow IDs
   */
  getWorkflowsByRecordingId(recordingId: string): string[] {
    const workflowIds = this.recordingIndex.get(recordingId);
    if (!workflowIds) {
      return [];
    }
    
    return Array.from(workflowIds);
  }
  
  /**
   * Get unique tags across all workflows
   * 
   * @returns Array of unique tags
   */
  getAllTags(): string[] {
    const tags = new Set<string>();
    
    for (const workflow of this.workflows.values()) {
      if (workflow.metadata.tags) {
        for (const tag of workflow.metadata.tags) {
          tags.add(tag);
        }
      }
    }
    
    return Array.from(tags);
  }
  
  /**
   * Get date range of workflows
   * 
   * @returns Object with earliest and latest creation dates or undefined
   */
  getDateRange(): { earliest: string; latest: string } | undefined {
    if (this.workflows.size === 0) {
      return undefined;
    }
    
    let earliest: string | undefined;
    let latest: string | undefined;
    
    for (const workflow of this.workflows.values()) {
      const createdAt = workflow.metadata.createdAt;
      
      if (!earliest || createdAt < earliest) {
        earliest = createdAt;
      }
      if (!latest || createdAt > latest) {
        latest = createdAt;
      }
    }
    
    if (earliest && latest) {
      return { earliest, latest };
    }
    
    return undefined;
  }
  
  /**
   * Intersect two sets
   * 
   * @param setA - First set
   * @param setB - Second set
   * @returns Intersection of sets
   */
  private intersectSets(setA: Set<string>, setB: Set<string>): Set<string> {
    const result = new Set<string>();
    
    for (const item of setA) {
      if (setB.has(item)) {
        result.add(item);
      }
    }
    
    return result;
  }
  
  /**
   * Get workflow IDs within date range
   * 
   * @param start - Start date
   * @param end - End date
   * @returns Set of workflow IDs
   */
  private getDateRangeIds(start: string, end: string): Set<string> {
    const startDate = new Date(start);
    const endDate = new Date(end);
    
    const result = new Set<string>();
    
    for (const [dateKey, ids] of this.dateIndex.entries()) {
      const workflowDate = new Date(dateKey);
      
      if (workflowDate >= startDate && workflowDate <= endDate) {
        for (const id of ids) {
          result.add(id);
        }
      }
    }
    
    return result;
  }
  
  /**
   * Update indexes for a workflow
   * 
   * @param workflow - Workflow to update indexes for
   * @param operation - 'add' or 'remove'
   */
  private updateIndexes(workflow: Workflow, operation: 'add' | 'remove'): void {
    // Update tags index
    if (workflow.metadata.tags) {
      for (const tag of workflow.metadata.tags) {
        this.updateIndexMap(this.tagsIndex, tag, workflow.id, operation);
      }
    }
    
    // Update date index
    const dateKey = workflow.metadata.createdAt.split('T')[0]; // YYYY-MM-DD
    this.updateIndexMap(this.dateIndex, dateKey, workflow.id, operation);
    
    // Update recording index (foreign key to Recording)
    const recordingIds = this.extractRecordingIds(workflow);
    for (const recordingId of recordingIds) {
      this.updateIndexMap(this.recordingIndex, recordingId, workflow.id, operation);
    }
  }
  
  /**
   * Update a single index map
   * 
   * @param indexMap - Index map to update
   * @param key - Index key
   * @param workflowId - Workflow ID
   * @param operation - 'add' or 'remove'
   */
  private updateIndexMap(
    indexMap: Map<string, Set<string>>,
    key: string,
    workflowId: string,
    operation: 'add' | 'remove'
  ): void {
    let ids = indexMap.get(key);
    
    if (operation === 'add') {
      if (!ids) {
        ids = new Set();
        indexMap.set(key, ids);
      }
      ids.add(workflowId);
    } else {
      if (ids) {
        ids.delete(workflowId);
        if (ids.size === 0) {
          indexMap.delete(key);
        }
      }
    }
  }
  
  /**
   * Extract recording IDs from workflow steps
   * 
   * @param workflow - Workflow to extract from
   * @returns Array of recording IDs
   */
  private extractRecordingIds(workflow: Workflow): string[] {
    const recordingIds: string[] = [];
    
    for (const step of workflow.steps) {
      if (step.type === 'recording' && step.recordingId) {
        recordingIds.push(step.recordingId);
      }
    }
    
    return recordingIds;
  }
}

/**
 * Create a new workflow repository
 * 
 * @returns WorkflowRepository instance
 */
export function createWorkflowRepository(): WorkflowRepository {
  return new WorkflowRepository();
}
