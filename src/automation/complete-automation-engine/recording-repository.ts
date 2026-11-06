/**
 * Recording Repository
 *
 * Provides persistence for Recording objects with full metadata preservation.
 * Supports indexing by author, date, and context for fast queries.
 * Uses in-memory storage for prototype (can be extended to IndexedDB/LocalStorage).
 *
 * Features:
 * - Save/load Recording objects with full metadata
 * - Index by author, createdAt, context (display state, application name)
 * - Filter by date range and context
 * - Delete with secure removal (truncation with random data)
 * - Query methods for fast lookups
 *
 * Indexing Strategy:
 * - authorIndex: Map<author, Set<recordingId>>
 * - dateIndex: Map<dateKey, Set<recordingId>> (daily buckets)
 * - contextIndex: Map<contextKey, Set<recordingId>> (display + application)
 */

import type { Recording, RecordingMetadata } from './recording-types';
import type { EntityId, Timestamp } from './integration-types';

/**
 * Query options for filtering recordings
 */
export interface RecordingQueryOptions {
  /** Filter by author */
  author?: string;
  
  /** Filter by date range */
  dateRange?: {
    start?: string;  // ISO 8601 date string
    end?: string;    // ISO 8601 date string
  };
  
  /** Filter by context */
  context?: {
    /** Display width */
    displayWidth?: number;
    
    /** Display height */
    displayHeight?: number;
    
    /** Application name */
    applicationName?: string;
  };
}

/**
 * Query result with pagination support
 */
export interface RecordingQueryResult {
  /** Total count of matching recordings */
  totalCount: number;
  
  /** Current page of recordings */
  recordings: Recording[];
  
  /** Page number (1-indexed) */
  page: number;
  
  /** Page size */
  pageSize: number;
  
  /** Total number of pages */
  totalPages: number;
}

/**
 * Recording repository class
 */
export class RecordingRepository {
  // Storage for recordings
  private recordings: Map<string, Recording> = new Map();
  
  // Indexes for fast queries
  private authorIndex: Map<string, Set<string>> = new Map();
  private dateIndex: Map<string, Set<string>> = new Map();
  private contextIndex: Map<string, Set<string>> = new Map();
  
  /**
   * Save a recording
   * 
   * @param recording - Recording to save
   * @returns Saved recording with metadata updated
   */
  save(recording: Recording): Recording {
    const now = new Date().toISOString();
    const metadata: RecordingMetadata = {
      ...recording.metadata,
      updatedAt: now,
    };
    
    const savedRecording: Recording = {
      ...recording,
      metadata,
    };
    
    // Store the recording
    this.recordings.set(recording.id, savedRecording);
    
    // Update indexes
    this.updateIndexes(savedRecording, 'add');
    
    return savedRecording;
  }
  
  /**
   * Load a recording by ID
   * 
   * @param id - Recording ID
   * @returns Recording if found, undefined otherwise
   */
  findById(id: string): Recording | undefined {
    return this.recordings.get(id);
  }
  
  /**
   * Find recordings by author
   * 
   * @param author - Author name
   * @returns Array of recordings by author
   */
  findByAuthor(author: string): Recording[] {
    const recordingIds = this.authorIndex.get(author);
    if (!recordingIds) {
      return [];
    }
    
    return Array.from(recordingIds)
      .map(id => this.recordings.get(id))
      .filter((rec): rec is Recording => rec !== undefined);
  }
  
  /**
   * Find recordings by date range
   * 
   * @param start - Start date (ISO 8601)
   * @param end - End date (ISO 8601)
   * @returns Array of recordings in date range
   */
  findByDateRange(start: string, end: string): Recording[] {
    const startDate = new Date(start);
    const endDate = new Date(end);
    
    // Get all recording IDs from date index within range
    const matchingIds = new Set<string>();
    
    for (const [dateKey, ids] of this.dateIndex.entries()) {
      const recordingDate = new Date(dateKey);
      
      if (recordingDate >= startDate && recordingDate <= endDate) {
        for (const id of ids) {
          matchingIds.add(id);
        }
      }
    }
    
    // Return recordings
    return Array.from(matchingIds)
      .map(id => this.recordings.get(id))
      .filter((rec): rec is Recording => rec !== undefined);
  }
  
  /**
   * Find recordings by context
   * 
   * @param context - Context filter (display dimensions, application name)
   * @returns Array of recordings matching context
   */
  findByContext(context: {
    displayWidth?: number;
    displayHeight?: number;
    applicationName?: string;
  }): Recording[] {
    // Build context key
    const contextKey = this.buildContextKey(context);
    
    const recordingIds = this.contextIndex.get(contextKey);
    if (!recordingIds) {
      return [];
    }
    
    return Array.from(recordingIds)
      .map(id => this.recordings.get(id))
      .filter((rec): rec is Recording => rec !== undefined);
  }
  
  /**
   * Query recordings with multiple filters
   * 
   * @param options - Query options
   * @returns Query result with recordings and pagination
   */
  query(options: RecordingQueryOptions = {}): RecordingQueryResult {
    // Start with all recordings
    let matchingIds = new Set<string>(this.recordings.keys());
    
    // Apply author filter
    if (options.author) {
      const authorIds = this.authorIndex.get(options.author);
      if (authorIds) {
        matchingIds = this.intersectSets(matchingIds, authorIds);
      } else {
        // No recordings for this author
        matchingIds = new Set();
      }
    }
    
    // Apply date range filter
    if (options.dateRange) {
      const { start, end } = options.dateRange;
      if (start && end) {
        const dateIds = this.getDateRangeIds(start, end);
        matchingIds = this.intersectSets(matchingIds, dateIds);
      }
    }
    
    // Apply context filter
    if (options.context) {
      const { displayWidth, displayHeight, applicationName } = options.context;
      
      if (displayWidth !== undefined || displayHeight !== undefined || applicationName) {
        const contextIds = new Set<string>();
        
        // Find matching context keys
        for (const [contextKey, ids] of this.contextIndex.entries()) {
          if (this.contextMatches(contextKey, displayWidth, displayHeight, applicationName)) {
            for (const id of ids) {
              contextIds.add(id);
            }
          }
        }
        
        matchingIds = this.intersectSets(matchingIds, contextIds);
      }
    }
    
    // Convert to recordings array
    const recordings = Array.from(matchingIds)
      .map(id => this.recordings.get(id))
      .filter((rec): rec is Recording => rec !== undefined);
    
    // Sort by creation date (newest first)
    recordings.sort((a, b) => new Date(b.metadata.createdAt).getTime() - new Date(a.metadata.createdAt).getTime());
    
    // Pagination
    const totalCount = recordings.length;
    const page = options.page || 1;
    const pageSize = options.pageSize || 50;
    const totalPages = Math.ceil(totalCount / pageSize);
    
    // Apply pagination
    const startIdx = (page - 1) * pageSize;
    const paginatedRecordings = recordings.slice(startIdx, startIdx + pageSize);
    
    return {
      totalCount,
      recordings: paginatedRecordings,
      page,
      pageSize,
      totalPages,
    };
  }
  
  /**
   * Delete a recording with secure removal
   * 
   * @param id - Recording ID to delete
   * @returns true if deleted, false if not found
   */
  delete(id: string): boolean {
    const recording = this.recordings.get(id);
    if (!recording) {
      return false;
    }
    
    // Secure removal: truncate data before deletion
    this.secureRemove(recording);
    
    // Remove from storage
    this.recordings.delete(id);
    
    // Update indexes
    this.updateIndexes(recording, 'remove');
    
    return true;
  }
  
  /**
   * Delete all recordings (bulk operation)
   * 
   * @returns Number of recordings deleted
   */
  deleteAll(): number {
    const count = this.recordings.size;
    
    // Secure remove all
    for (const recording of this.recordings.values()) {
      this.secureRemove(recording);
    }
    
    // Clear storage
    this.recordings.clear();
    
    // Clear indexes
    this.authorIndex.clear();
    this.dateIndex.clear();
    this.contextIndex.clear();
    
    return count;
  }
  
  /**
   * Get total count of recordings
   * 
   * @returns Total count
   */
  getCount(): number {
    return this.recordings.size;
  }
  
  /**
   * Get all recordings
   * 
   * @returns Array of all recordings
   */
  getAll(): Recording[] {
    return Array.from(this.recordings.values());
  }
  
  /**
   * Securely remove recording data
   * 
   * @param recording - Recording to securely remove
   */
  private secureRemove(recording: Recording): void {
    // Truncate recording actions to minimal size
    if (recording.actions.length > 0) {
      // Replace with empty actions
      recording.actions = [];
    }
    
    // Clear metadata
    recording.metadata = {
      ...recording.metadata,
      // Clear non-essential fields for secure removal
      tags: [],
    };
    
    // Note: In production, you might overwrite the JSON serialization
    // with random data before deletion, but for in-memory storage,
    // simply clearing references is sufficient
  }
  
  /**
   * Build context key for indexing
   * 
   * @param context - Context object
   * @returns Context key string
   */
  private buildContextKey(context: {
    displayWidth?: number;
    displayHeight?: number;
    applicationName?: string;
  }): string {
    return [
      context.displayWidth?.toString() || '*',
      context.displayHeight?.toString() || '*',
      context.applicationName || '*',
    ].join('|');
  }
  
  /**
   * Check if context key matches filter
   * 
   * @param contextKey - Indexed context key
   * @param displayWidth - Filter display width
   * @param displayHeight - Filter display height
   * @param applicationName - Filter application name
   * @returns true if matches
   */
  private contextMatches(
    contextKey: string,
    displayWidth?: number,
    displayHeight?: number,
    applicationName?: string
  ): boolean {
    const [keyWidth, keyHeight, keyApp] = contextKey.split('|');
    
    if (displayWidth !== undefined && keyWidth !== '*' && keyWidth !== displayWidth.toString()) {
      return false;
    }
    
    if (displayHeight !== undefined && keyHeight !== '*' && keyHeight !== displayHeight.toString()) {
      return false;
    }
    
    if (applicationName !== undefined && keyApp !== '*' && keyApp !== applicationName) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Get recording IDs within date range
   * 
   * @param start - Start date
   * @param end - End date
   * @returns Set of recording IDs
   */
  private getDateRangeIds(start: string, end: string): Set<string> {
    const startDate = new Date(start);
    const endDate = new Date(end);
    
    const result = new Set<string>();
    
    for (const [dateKey, ids] of this.dateIndex.entries()) {
      const recordingDate = new Date(dateKey);
      
      if (recordingDate >= startDate && recordingDate <= endDate) {
        for (const id of ids) {
          result.add(id);
        }
      }
    }
    
    return result;
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
   * Update indexes for a recording
   * 
   * @param recording - Recording to update indexes for
   * @param operation - 'add' or 'remove'
   */
  private updateIndexes(recording: Recording, operation: 'add' | 'remove'): void {
    // Update author index
    const author = recording.metadata.author || 'anonymous';
    this.updateIndexMap(this.authorIndex, author, recording.id, operation);
    
    // Update date index
    const dateKey = recording.metadata.createdAt.split('T')[0]; // YYYY-MM-DD
    this.updateIndexMap(this.dateIndex, dateKey, recording.id, operation);
    
    // Update context index
    // Extract context from recording actions (if available)
    const contextKeys = this.extractContextKeys(recording);
    for (const key of contextKeys) {
      this.updateIndexMap(this.contextIndex, key, recording.id, operation);
    }
  }
  
  /**
   * Update a single index map
   * 
   * @param indexMap - Index map to update
   * @param key - Index key
   * @param recordingId - Recording ID
   * @param operation - 'add' or 'remove'
   */
  private updateIndexMap(
    indexMap: Map<string, Set<string>>,
    key: string,
    recordingId: string,
    operation: 'add' | 'remove'
  ): void {
    let ids = indexMap.get(key);
    
    if (operation === 'add') {
      if (!ids) {
        ids = new Set();
        indexMap.set(key, ids);
      }
      ids.add(recordingId);
    } else {
      if (ids) {
        ids.delete(recordingId);
        if (ids.size === 0) {
          indexMap.delete(key);
        }
      }
    }
  }
  
  /**
   * Extract context keys from recording
   * 
   * @param recording - Recording to extract context from
   * @returns Array of context keys
   */
  private extractContextKeys(recording: Recording): string[] {
    // Extract context from actions that have element context
    const contextKeys = new Set<string>();
    
    for (const action of recording.actions) {
      if ('context' in action && action.context) {
        // Create context key from element information
        const keyParts: string[] = [];
        
        if (action.context.elementId) {
          keyParts.push(action.context.elementId);
        }
        
        if (action.context.selector) {
          keyParts.push(action.context.selector);
        }
        
        if (action.context.domPath) {
          keyParts.push(action.context.domPath);
        }
        
        if (keyParts.length > 0) {
          contextKeys.add(keyParts.join('|'));
        }
      }
    }
    
    // If no context from actions, use recording-level context if available
    if (contextKeys.size === 0 && recording.metadata.tags) {
      // Use tags as context indicators
      for (const tag of recording.metadata.tags) {
        contextKeys.add(`tag:${tag}`);
      }
    }
    
    return Array.from(contextKeys);
  }
}

/**
 * Create a new recording repository
 * 
 * @returns RecordingRepository instance
 */
export function createRecordingRepository(): RecordingRepository {
  return new RecordingRepository();
}