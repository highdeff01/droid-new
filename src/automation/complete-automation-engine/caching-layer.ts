/**
 * Caching Layer for Complete Automation Engine
 *
 * Implements LRU (Least Recently Used) cache with eviction policy for:
 * - Recording objects
 * - Workflow objects
 * - Pack objects
 * - Habit objects
 * - Suggestion results (with TTL)
 * - Query results (with TTL)
 *
 * Features:
 * - LRU eviction when cache size exceeds limit
 * - TTL support for suggestion and query results
 * - Event-driven cache invalidation (pack deployed, habit updated, etc.)
 * - Type-safe specialized caches
 *
 * Architecture:
 * - CacheLayer: Main class managing all cache instances
 * - LRUCache: Generic LRU cache implementation
 * - TTLCache: TTL-enabled cache extension
 * - CacheInvalidator: Handles event-driven invalidation
 */

// ============================================================================
// LRU Cache Implementation
// ============================================================================

/**
 * Node in doubly linked list for LRU tracking
 */
interface CacheNode<T> {
  key: string;
  value: T;
  prev?: CacheNode<T>;
  next?: CacheNode<T>;
}

/**
 * Generic LRU Cache implementation
 *
 * Evicts least recently used items when capacity is exceeded.
 * Uses doubly linked list for O(1) move-to-front operations.
 */
class LRUCache<T> {
  private capacity: number;
  private map: Map<string, CacheNode<T>>;
  private head?: CacheNode<T>;
  private tail?: CacheNode<T>;
  private size: number = 0;

  constructor(capacity: number = 100) {
    this.capacity = capacity;
    this.map = new Map();
  }

  /**
   * Get value by key
   * Moves accessed node to front (most recently used)
   */
  get(key: string): T | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;

    this.moveToFront(node);
    return node.value;
  }

  /**
   * Set key-value pair
   * Adds new node or updates existing, moves to front
   * Evicts LRU node if capacity exceeded
   */
  set(key: string, value: T): void {
    let node = this.map.get(key);

    if (node) {
      // Update existing node
      node.value = value;
      this.moveToFront(node);
    } else {
      // Create new node
      node = { key, value };
      this.addNode(node);
      this.map.set(key, node);
      this.size++;

      // Evict if over capacity
      if (this.size > this.capacity) {
        this.evictLRU();
      }
    }
  }

  /**
   * Check if key exists
   */
  has(key: string): boolean {
    return this.map.has(key);
  }

  /**
   * Delete key
   */
  delete(key: string): boolean {
    const node = this.map.get(key);
    if (!node) return false;

    this.map.delete(key);
    this.removeNode(node);
    this.size--;
    return true;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.map.clear();
    this.head = undefined;
    this.tail = undefined;
    this.size = 0;
  }

  /**
   * Get current size
   */
  getSize(): number {
    return this.size;
  }

  /**
   * Get all keys
   */
  getKeys(): string[] {
    return Array.from(this.map.keys());
  }

  /**
   * Move node to front (most recently used)
   */
  private moveToFront(node: CacheNode<T>): void {
    if (this.head === node) return;

    this.removeNode(node);
    this.addNodeToFront(node);
  }

  /**
   * Add node to front of list
   */
  private addNodeToFront(node: CacheNode<T>): void {
    node.prev = undefined;
    node.next = this.head;

    if (this.head) {
      this.head.prev = node;
    }

    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  /**
   * Add new node to list
   */
  private addNode(node: CacheNode<T>): void {
    this.addNodeToFront(node);
  }

  /**
   * Remove node from list
   */
  private removeNode(node: CacheNode<T>): void {
    const { prev, next } = node;

    if (prev) {
      prev.next = next;
    }

    if (next) {
      next.prev = prev;
    }

    if (this.head === node) {
      this.head = next;
    }

    if (this.tail === node) {
      this.tail = prev;
    }

    node.prev = undefined;
    node.next = undefined;
  }

  /**
   * Evict least recently used node (tail)
   */
  private evictLRU(): void {
    if (!this.tail) return;

    this.map.delete(this.tail.key);

    if (this.tail.prev) {
      this.tail.prev.next = undefined;
    }

    this.tail = this.tail.prev;

    if (!this.tail) {
      this.head = undefined;
    }

    this.size--;
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; capacity: number; usage: number } {
    return {
      size: this.size,
      capacity: this.capacity,
      usage: this.capacity > 0 ? Math.round((this.size / this.capacity) * 100) : 0,
    };
  }
}

/**
 * LRU Cache with TTL support
 * Evicts expired entries on access
 */
class TTLCache<T> extends LRUCache<T> {
  private ttlMap: Map<string, number> = new Map();
  private defaultTTL: number;

  constructor(capacity: number = 100, defaultTTL: number = 60000) {
    super(capacity);
    this.defaultTTL = defaultTTL;
  }

  /**
   * Set with expiration time
   */
  set(key: string, value: T, ttl?: number): void {
    super.set(key, value);
    this.ttlMap.set(key, Date.now() + (ttl ?? this.defaultTTL));
  }

  /**
   * Get with expiration check
   */
  get(key: string): T | undefined {
    if (!super.has(key)) return undefined;

    const expiresAt = this.ttlMap.get(key);
    if (expiresAt && Date.now() > expiresAt) {
      this.delete(key);
      return undefined;
    }

    return super.get(key);
  }

  /**
   * Check if key exists (includes TTL check)
   */
  has(key: string): boolean {
    if (!super.has(key)) return false;

    const expiresAt = this.ttlMap.get(key);
    if (expiresAt && Date.now() > expiresAt) {
      this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Clear expired entries
   */
  clearExpired(): number {
    let cleared = 0;
    const now = Date.now();

    for (const [key, expiresAt] of this.ttlMap.entries()) {
      if (now > expiresAt) {
        if (super.delete(key)) {
          this.ttlMap.delete(key);
          cleared++;
        }
      }
    }

    return cleared;
  }

  /**
   * Get count of expired entries
   */
  countExpired(): number {
    const now = Date.now();
    let expired = 0;

    for (const [key, expiresAt] of this.ttlMap.entries()) {
      if (now > expiresAt && super.has(key)) {
        expired++;
      }
    }

    return expired;
  }

  /**
   * Clear all entries including TTL tracking
   */
  clear(): void {
    super.clear();
    this.ttlMap.clear();
  }

  /**
   * Get cache statistics with TTL info
   */
  getStats(): { size: number; capacity: number; usage: number; expired: number } {
    return {
      size: this.size,
      capacity: this.capacity,
      usage: this.capacity > 0 ? Math.round((this.size / this.capacity) * 100) : 0,
      expired: this.countExpired(),
    };
  }
}

// ============================================================================
// Specialized Caches
// ============================================================================

/**
 * Cache entry for recordings
 */
interface RecordingCacheEntry {
  recording: any;
  timestamp: string;
  accessCount: number;
}

/**
 * Cache entry for workflows
 */
interface WorkflowCacheEntry {
  workflow: any;
  timestamp: string;
  accessCount: number;
}

/**
 * Cache entry for packs
 */
interface PackCacheEntry {
  pack: any;
  timestamp: string;
  accessCount: number;
}

/**
 * Cache entry for habits
 */
interface HabitCacheEntry {
  habit: any;
  timestamp: string;
  accessCount: number;
}

/**
 * Cache entry for suggestion results
 */
interface SuggestionCacheEntry {
  results: any[];
  timestamp: string;
  expiresAt: number;
}

/**
 * Cache entry for query results
 */
interface QueryCacheEntry {
  results: any[];
  timestamp: string;
  queryHash: string;
  expiresAt?: number;
}

// ============================================================================
// CacheLayer Class
// ============================================================================

/**
 * Main caching layer managing all specialized caches
 */
export class CacheLayer {
  // LRU caches for different entity types
  private recordingCache: LRUCache<RecordingCacheEntry>;
  private workflowCache: LRUCache<WorkflowCacheEntry>;
  private packCache: LRUCache<PackCacheEntry>;
  private habitCache: LRUCache<HabitCacheEntry>;

  // TTL caches for suggestions and queries
  private suggestionCache: TTLCache<SuggestionCacheEntry>;
  private queryCache: TTLCache<QueryCacheEntry>;

  constructor(options?: {
    recordingCapacity?: number;
    workflowCapacity?: number;
    packCapacity?: number;
    habitCapacity?: number;
    suggestionTTL?: number;
    queryTTL?: number;
  }) {
    const {
      recordingCapacity = 100,
      workflowCapacity = 100,
      packCapacity = 50,
      habitCapacity = 100,
      suggestionTTL = 300000, // 5 minutes
      queryTTL = 60000, // 1 minute
    } = options ?? {};

    // Initialize LRU caches
    this.recordingCache = new LRUCache(recordingCapacity);
    this.workflowCache = new LRUCache(workflowCapacity);
    this.packCache = new LRUCache(packCapacity);
    this.habitCache = new LRUCache(habitCapacity);

    // Initialize TTL caches
    this.suggestionCache = new TTLCache(200, suggestionTTL);
    this.queryCache = new TTLCache(500, queryTTL);
  }

  // --------------------------------------------------------------------------
  // Recording Cache
  // --------------------------------------------------------------------------

  /**
   * Get recording from cache
   */
  getRecording(id: string): any | undefined {
    const entry = this.recordingCache.get(id);
    return entry?.recording;
  }

  /**
   * Set recording in cache
   */
  setRecording(id: string, recording: any): void {
    this.recordingCache.set(id, {
      recording,
      timestamp: new Date().toISOString(),
      accessCount: 1,
    });
  }

  /**
   * Check if recording is cached
   */
  hasRecording(id: string): boolean {
    return this.recordingCache.has(id);
  }

  /**
   * Delete recording from cache
   */
  deleteRecording(id: string): boolean {
    return this.recordingCache.delete(id);
  }

  /**
   * Get recording cache statistics
   */
  getRecordingCacheStats(): { size: number; capacity: number; usage: number } {
    return this.recordingCache.getStats();
  }

  // --------------------------------------------------------------------------
  // Workflow Cache
  // --------------------------------------------------------------------------

  /**
   * Get workflow from cache
   */
  getWorkflow(id: string): any | undefined {
    const entry = this.workflowCache.get(id);
    return entry?.workflow;
  }

  /**
   * Set workflow in cache
   */
  setWorkflow(id: string, workflow: any): void {
    this.workflowCache.set(id, {
      workflow,
      timestamp: new Date().toISOString(),
      accessCount: 1,
    });
  }

  /**
   * Check if workflow is cached
   */
  hasWorkflow(id: string): boolean {
    return this.workflowCache.has(id);
  }

  /**
   * Delete workflow from cache
   */
  deleteWorkflow(id: string): boolean {
    return this.workflowCache.delete(id);
  }

  /**
   * Get workflow cache statistics
   */
  getWorkflowCacheStats(): { size: number; capacity: number; usage: number } {
    return this.workflowCache.getStats();
  }

  // --------------------------------------------------------------------------
  // Pack Cache
  // --------------------------------------------------------------------------

  /**
   * Get pack from cache
   */
  getPack(id: string): any | undefined {
    const entry = this.packCache.get(id);
    return entry?.pack;
  }

  /**
   * Set pack in cache
   */
  setPack(id: string, pack: any): void {
    this.packCache.set(id, {
      pack,
      timestamp: new Date().toISOString(),
      accessCount: 1,
    });
  }

  /**
   * Check if pack is cached
   */
  hasPack(id: string): boolean {
    return this.packCache.has(id);
  }

  /**
   * Delete pack from cache
   */
  deletePack(id: string): boolean {
    return this.packCache.delete(id);
  }

  /**
   * Get pack cache statistics
   */
  getPackCacheStats(): { size: number; capacity: number; usage: number } {
    return this.packCache.getStats();
  }

  // --------------------------------------------------------------------------
  // Habit Cache
  // --------------------------------------------------------------------------

  /**
   * Get habit from cache
   */
  getHabit(id: string): any | undefined {
    const entry = this.habitCache.get(id);
    return entry?.habit;
  }

  /**
   * Set habit in cache
   */
  setHabit(id: string, habit: any): void {
    this.habitCache.set(id, {
      habit,
      timestamp: new Date().toISOString(),
      accessCount: 1,
    });
  }

  /**
   * Check if habit is cached
   */
  hasHabit(id: string): boolean {
    return this.habitCache.has(id);
  }

  /**
   * Delete habit from cache
   */
  deleteHabit(id: string): boolean {
    return this.habitCache.delete(id);
  }

  /**
   * Get habit cache statistics
   */
  getHabitCacheStats(): { size: number; capacity: number; usage: number } {
    return this.habitCache.getStats();
  }

  // --------------------------------------------------------------------------
  // Suggestion Cache (TTL)
  // --------------------------------------------------------------------------

  /**
   * Get suggestion results from cache
   */
  getSuggestion(queryHash: string): any[] | undefined {
    const entry = this.suggestionCache.get(queryHash);
    return entry?.results;
  }

  /**
   * Set suggestion results in cache
   */
  setSuggestion(queryHash: string, results: any[], ttl?: number): void {
    this.suggestionCache.set(queryHash, {
      results,
      timestamp: new Date().toISOString(),
      expiresAt: Date.now() + (ttl ?? 300000),
    }, ttl);
  }

  /**
   * Check if suggestion results are cached
   */
  hasSuggestion(queryHash: string): boolean {
    return this.suggestionCache.has(queryHash);
  }

  /**
   * Delete suggestion results from cache
   */
  deleteSuggestion(queryHash: string): boolean {
    return this.suggestionCache.delete(queryHash);
  }

  /**
   * Get suggestion cache statistics
   */
  getSuggestionCacheStats(): { size: number; capacity: number; usage: number; expired: number } {
    return this.suggestionCache.getStats();
  }

  // --------------------------------------------------------------------------
  // Query Cache (TTL)
  // --------------------------------------------------------------------------

  /**
   * Get query results from cache
   */
  getQuery(queryHash: string): any[] | undefined {
    const entry = this.queryCache.get(queryHash);
    return entry?.results;
  }

  /**
   * Set query results in cache
   */
  setQuery(queryHash: string, results: any[], ttl?: number): void {
    this.queryCache.set(queryHash, {
      results,
      timestamp: new Date().toISOString(),
      queryHash,
      expiresAt: ttl ? Date.now() + ttl : undefined,
    }, ttl);
  }

  /**
   * Check if query results are cached
   */
  hasQuery(queryHash: string): boolean {
    return this.queryCache.has(queryHash);
  }

  /**
   * Delete query results from cache
   */
  deleteQuery(queryHash: string): boolean {
    return this.queryCache.delete(queryHash);
  }

  /**
   * Clear all query results
   */
  clearQueryCache(): void {
    this.queryCache.clear();
  }

  /**
   * Get query cache statistics
   */
  getQueryCacheStats(): { size: number; capacity: number; usage: number; expired: number } {
    return this.queryCache.getStats();
  }

  // --------------------------------------------------------------------------
  // Cache Invalidation Triggers
  // --------------------------------------------------------------------------

  /**
   * Invalidate all caches on pack deployment
   * Pack changes may affect workflow and habit suggestions
   */
  invalidateOnPackDeployed(packId: string): void {
    // Clear pack cache for this pack
    this.packCache.delete(packId);

    // Clear workflow cache (workflows may have been updated)
    this.workflowCache.clear();

    // Clear habit cache (habits may be affected by pack changes)
    this.habitCache.clear();

    // Clear suggestion cache (pack changes may affect suggestions)
    this.suggestionCache.clearExpired();
  }

  /**
   * Invalidate caches when habit is updated
   * Habit changes affect habit cache and suggestions
   */
  invalidateOnHabitUpdated(habitId: string): void {
    // Clear habit cache for this habit
    this.habitCache.delete(habitId);

    // Clear suggestion cache (habits affect suggestions)
    this.suggestionCache.clearExpired();

    // Clear query cache (habits may be search results)
    this.queryCache.clearExpired();
  }

  /**
   * Clear caches when workflow is executed
   * Workflow execution may update workflows and habits
   */
  clearOnWorkflowExecuted(workflowId: string): void {
    // Update workflow access count (warm cache)
    const entry = this.workflowCache.map.get(workflowId);
    if (entry) {
      const cachedEntry = entry.value as WorkflowCacheEntry;
      cachedEntry.accessCount += 1;
    }

    // Clear suggestion cache after execution
    this.suggestionCache.clearExpired();

    // Clear query cache after execution
    this.queryCache.clearExpired();
  }

  /**
   * Clear caches when recording is captured
   * New recordings may affect search results
   */
  clearOnRecordingCaptured(recordingId: string): void {
    // Clear query cache (search results may be stale)
    this.queryCache.clearExpired();

    // Clear suggestion cache (expired entries only)
    this.suggestionCache.clearExpired();
  }

  /**
   * Batch invalidation for major changes
   */
  clearAll(): void {
    this.recordingCache.clear();
    this.workflowCache.clear();
    this.packCache.clear();
    this.habitCache.clear();
    this.suggestionCache.clear();
    this.queryCache.clear();
  }

  // --------------------------------------------------------------------------
  // Utility Methods
  // --------------------------------------------------------------------------

  /**
   * Get overall cache statistics
   */
  getOverallStats(): {
    recording: { size: number; capacity: number; usage: number };
    workflow: { size: number; capacity: number; usage: number };
    pack: { size: number; capacity: number; usage: number };
    habit: { size: number; capacity: number; usage: number };
    suggestion: { size: number; capacity: number; usage: number; expired: number };
    query: { size: number; capacity: number; usage: number; expired: number };
  } {
    return {
      recording: this.getRecordingCacheStats(),
      workflow: this.getWorkflowCacheStats(),
      pack: this.getPackCacheStats(),
      habit: this.getHabitCacheStats(),
      suggestion: this.getSuggestionCacheStats(),
      query: this.getQueryCacheStats(),
    };
  }

  /**
   * Clear expired TTL entries
   */
  cleanupExpired(): number {
    const suggestionCleared = this.suggestionCache.clearExpired();
    const queryCleared = this.queryCache.clearExpired();
    return suggestionCleared + queryCleared;
  }
}

// ============================================================================
// Export Classes for Testing
// ============================================================================

// Re-export internal classes for testing
export { LRUCache, TTLCache };

/**
 * Global cache layer instance
 * Create with default configuration or custom options
 */
export const cacheLayer = new CacheLayer();

/**
 * Create cache layer with custom configuration
 */
export function createCacheLayer(options?: {
  recordingCapacity?: number;
  workflowCapacity?: number;
  packCapacity?: number;
  habitCapacity?: number;
  suggestionTTL?: number;
  queryTTL?: number;
}): CacheLayer {
  return new CacheLayer(options);
}
