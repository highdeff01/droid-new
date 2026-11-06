/**
 * Playback Performance Optimization Layer for Complete Automation Engine
 *
 * Implements performance optimizations for workflow playback:
 * - Batch coordinate translations to reduce overhead for multi-step workflows
 * - Optimized element selector matching with caching
 * - Pre-warmed element lookup tables for faster element lookup
 * - Playback speed adjustment (1x, 2x, 4x) for faster testing and review
 *
 * Architecture:
 * - PlaybackPerformanceOptimizer: Main class managing performance optimizations
 * - CoordinateTranslationBatcher: Batches coordinate translations across steps
 * - OptimizedElementMatcher: Caches and optimizes element selector matching
 * - LookupTableWarmer: Pre-warms element lookup tables during idle time
 * - PlaybackSpeedController: Controls playback speed multiplier (1x, 2x, 4x)
 *
 * Performance Characteristics:
 * - Coordinate batching: O(n) batch processing instead of O(n) individual calls
 * - Element matching: O(1) cached lookups with LRU eviction
 * - Lookup pre-warming: Background initialization with performance tracking
 * - Speed adjustment: Dynamic timing scaling with configurable multiplier
 */

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Configuration options for playback performance optimization
 */
export interface PlaybackPerformanceOptions {
  /** Enable batch coordinate translation (default: true) */
  enableBatchTranslation?: boolean;
  
  /** Enable element matching optimization (default: true) */
  enableElementOptimization?: boolean;
  
  /** Enable lookup table pre-warming (default: true) */
  enableLookupPreWarming?: boolean;
  
  /** Batch size for coordinate translation (default: 10) */
  batchTranslationSize?: number;
  
  /** Cache capacity for element matching (default: 50) */
  elementCacheCapacity?: number;
  
  /** Pre-warming batch size (default: 5) */
  preWarmingBatchSize?: number;
  
  /** Initial playback speed multiplier (default: 1) */
  initialSpeedMultiplier?: number;
}

/**
 * Coordinate translation batch entry
 */
export interface CoordinateTranslationEntry {
  /** Normalized X coordinate [0, 1] */
  normalizedX: number;
  
  /** Normalized Y coordinate [0, 1] */
  normalizedY: number;
  
  /** Screen width in pixels */
  screenWidth: number;
  
  /** Screen height in pixels */
  screenHeight: number;
  
  /** Display DPI scaling factor */
  dpiScale: number;
  
  /** Original action index for result mapping */
  actionIndex: number;
}

/**
 * Batched coordinate translation result
 */
export interface CoordinateTranslationResult {
  /** Array of translated pixel X coordinates */
  pixelX: number[];
  
  /** Array of translated pixel Y coordinates */
  pixelY: number[];
  
  /** Total batch processing time in milliseconds */
  processingTimeMs: number;
}

/**
 * Element selector match entry
 */
export interface ElementMatchEntry {
  /** CSS selector string */
  selector: string;
  
  /** DOM path string (alternative selector) */
  domPath?: string;
  
  /** Accessible name (fallback selector) */
  accessibleName?: string;
  
  /** Context requirements */
  context?: {
    windowTitle?: string;
    applicationName?: string;
  };
}

/**
 * Element match result
 */
export interface ElementMatchResult {
  /** Element found */
  found: boolean;
  
  /** DOM element reference (if found) */
  element?: HTMLElement;
  
  /** Selector used for matching */
  selector: string;
  
  /** Match time in milliseconds */
  matchTimeMs: number;
}

/**
 * Element lookup table entry
 */
export interface ElementLookupEntry {
  /** CSS selector */
  selector: string;
  
  /** DOM path */
  domPath?: string;
  
  /** Accessible name */
  accessibleName?: string;
  
  /** Priority score for matching order */
  priority: number;
  
  /** Last lookup timestamp */
  lastUsed: number;
}

/**
 * Pre-warmed lookup table
 */
export interface PreWarmedLookupTable {
  /** Element entries indexed by selector */
  entries: Map<string, ElementLookupEntry>;
  
  /** Total entries count */
  count: number;
  
  /** Warm-up completion timestamp */
  warmUpCompleted: number;
}

/**
 * Playback speed configuration
 */
export interface PlaybackSpeedConfig {
  /** Speed multiplier: 1 (normal), 2 (2x faster), 4 (4x faster) */
  multiplier: number;
  
  /** Base delay between steps in milliseconds */
  baseDelayMs: number;
  
  /** Minimum delay to maintain responsiveness */
  minDelayMs: number;
}

/**
 * Performance metrics for playback optimizations
 */
export interface PerformanceMetrics {
  /** Total batch translation time in milliseconds */
  totalBatchTranslationTimeMs: number;
  
  /** Number of batch translation operations */
  batchTranslationCount: number;
  
  /** Total element matching time in milliseconds */
  totalElementMatchingTimeMs: number;
  
  /** Number of element match operations */
  elementMatchCount: number;
  
  /** Element cache hit count */
  elementCacheHits: number;
  
  /** Element cache miss count */
  elementCacheMisses: number;
  
  /** Pre-warming completion time in milliseconds */
  preWarmingTimeMs: number;
  
  /** Total playback steps executed */
  totalSteps: number;
  
  /** Actual playback duration in milliseconds */
  actualDurationMs: number;
}

// ============================================================================
// Coordinate Translation Batcher
// ============================================================================

/**
 * Batches coordinate translations for efficient multi-step processing
 */
class CoordinateTranslationBatcher {
  private entries: CoordinateTranslationEntry[] = [];
  private batchSize: number;
  
  constructor(batchSize: number = 10) {
    this.batchSize = batchSize;
  }
  
  /**
   * Add a coordinate translation entry to the batch
   */
  addEntry(entry: CoordinateTranslationEntry): void {
    this.entries.push(entry);
  }
  
  /**
   * Add a normalized coordinate for translation
   */
  addCoordinate(
    normalizedX: number,
    normalizedY: number,
    screenWidth: number,
    screenHeight: number,
    dpiScale: number,
    actionIndex: number
  ): void {
    this.addEntry({
      normalizedX,
      normalizedY,
      screenWidth,
      screenHeight,
      dpiScale,
      actionIndex,
    });
  }
  
  /**
   * Process batch and return translated coordinates
   */
  processBatch(): CoordinateTranslationResult {
    const startTime = Date.now();
    
    const pixelX: number[] = new Array(this.entries.length);
    const pixelY: number[] = new Array(this.entries.length);
    
    // Process all entries in batch
    for (const entry of this.entries) {
      const pixelXValue = entry.normalizedX * entry.screenWidth * entry.dpiScale;
      const pixelYValue = entry.normalizedY * entry.screenHeight * entry.dpiScale;
      
      pixelX[entry.actionIndex] = Math.round(pixelXValue);
      pixelY[entry.actionIndex] = Math.round(pixelYValue);
    }
    
    const processingTimeMs = Date.now() - startTime;
    
    return {
      pixelX,
      pixelY,
      processingTimeMs,
    };
  }
  
  /**
   * Clear the batch
   */
  clear(): void {
    this.entries = [];
  }
  
  /**
   * Get current batch size
   */
  getBatchSize(): number {
    return this.entries.length;
  }
}

// ============================================================================
// Optimized Element Matcher
// ============================================================================

/**
 * Optimized element selector matching with caching
 */
class OptimizedElementMatcher {
  private cache: Map<string, ElementMatchResult> = new Map();
  private capacity: number;
  private accessOrder: string[] = [];
  
  constructor(capacity: number = 50) {
    this.capacity = capacity;
  }
  
  /**
   * Get cached result or perform new match
   */
  matchElement(entry: ElementMatchEntry): ElementMatchResult {
    const cacheKey = this.getCacheKey(entry);
    const cachedResult = this.cache.get(cacheKey);
    
    if (cachedResult) {
      this.updateAccessOrder(cacheKey);
      return {
        ...cachedResult,
        matchTimeMs: 0, // Cached match has zero time
      };
    }
    
    // Perform element matching
    const matchStartTime = Date.now();
    const result = this.performElementMatching(entry);
    const matchTimeMs = Date.now() - matchStartTime;
    
    // Update cache
    this.updateCache(cacheKey, { ...result, matchTimeMs });
    
    return result;
  }
  
  /**
   * Perform element matching with multiple fallback strategies
   */
  private performElementMatching(entry: ElementMatchEntry): ElementMatchResult {
    // Try CSS selector first
    if (entry.selector) {
      const element = document.querySelector(entry.selector) as HTMLElement | null;
      if (element) {
        return {
          found: true,
          element,
          selector: entry.selector,
          matchTimeMs: 0,
        };
      }
    }
    
    // Try DOM path as fallback
    if (entry.domPath) {
      const element = this.findElementByDomPath(entry.domPath);
      if (element) {
        return {
          found: true,
          element,
          selector: entry.domPath,
          matchTimeMs: 0,
        };
      }
    }
    
    // Try accessible name as last resort
    if (entry.accessibleName) {
      const element = this.findElementByAccessibleName(entry.accessibleName);
      if (element) {
        return {
          found: true,
          element,
          selector: entry.accessibleName,
          matchTimeMs: 0,
        };
      }
    }
    
    return {
      found: false,
      selector: entry.selector || entry.domPath || entry.accessibleName || 'unknown',
      matchTimeMs: 0,
    };
  }
  
  /**
   * Find element by DOM path
   */
  private findElementByDomPath(domPath: string): HTMLElement | null {
    // DOM path format: "html > body > div.container > button.submit"
    const selectors = domPath.split(' > ').filter(s => s.trim());
    
    if (selectors.length === 0) {
      return null;
    }
    
    // Start with document
    let current: HTMLElement | null = document.documentElement;
    
    // Traverse path
    for (const selector of selectors) {
      if (!current) {
        return null;
      }
      
      const child = current.querySelector(selector.trim());
      if (child && child instanceof HTMLElement) {
        current = child;
      } else {
        return null;
      }
    }
    
    return current;
  }
  
  /**
   * Find element by accessible name
   */
  private findElementByAccessibleName(accessibleName: string): HTMLElement | null {
    // Find elements with matching aria-label or accessible text
    const allElements = document.querySelectorAll('*');
    
    for (const element of allElements) {
      const elementAsHtml = element as HTMLElement;
      const ariaLabel = elementAsHtml.getAttribute('aria-label');
      const ariaLabelledBy = elementAsHtml.getAttribute('aria-labelledby');
      
      if (ariaLabel === accessibleName) {
        return elementAsHtml;
      }
      
      if (ariaLabelledBy) {
        const labelElement = document.getElementById(ariaLabelledBy);
        if (labelElement && labelElement.textContent?.trim() === accessibleName) {
          return elementAsHtml;
        }
      }
      
      // Check visible text content (simplified)
      if (elementAsHtml.textContent?.trim() === accessibleName) {
        return elementAsHtml;
      }
    }
    
    return null;
  }
  
  /**
   * Get cache key from entry
   */
  private getCacheKey(entry: ElementMatchEntry): string {
    return JSON.stringify({
      selector: entry.selector || '',
      domPath: entry.domPath || '',
      accessibleName: entry.accessibleName || '',
      context: entry.context,
    });
  }
  
  /**
   * Update cache with LRU eviction
   */
  private updateCache(key: string, result: ElementMatchResult): void {
    // Evict oldest entries if at capacity
    while (this.cache.size >= this.capacity) {
      const oldestKey = this.accessOrder.shift();
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
    
    this.cache.set(key, result);
    this.accessOrder.push(key);
  }
  
  /**
   * Update access order for LRU
   */
  private updateAccessOrder(key: string): void {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(key);
  }
  
  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    this.accessOrder = [];
  }
  
  /**
   * Get cache statistics
   */
  getStats(): { size: number; capacity: number; usage: number } {
    return {
      size: this.cache.size,
      capacity: this.capacity,
      usage: this.capacity > 0 ? Math.round((this.cache.size / this.capacity) * 100) : 0,
    };
  }
}

// ============================================================================
// Lookup Table Warmer
// ============================================================================

/**
 * Pre-warms element lookup tables during idle time
 */
class LookupTableWarmer {
  private lookupTables: Map<string, PreWarmedLookupTable> = new Map();
  private batchSize: number;
  private warmUpQueue: ElementMatchEntry[] = [];
  
  constructor(batchSize: number = 5) {
    this.batchSize = batchSize;
  }
  
  /**
   * Add entries to warm-up queue
   */
  addToQueue(entries: ElementMatchEntry[]): void {
    this.warmUpQueue.push(...entries);
  }
  
  /**
   * Pre-warm lookup tables during idle time
   */
  preWarm(): void {
    const startTime = Date.now();
    
    // Process batch
    const batch = this.warmUpQueue.slice(0, this.batchSize);
    
    // Remove processed entries from queue
    this.warmUpQueue.splice(0, batch.length);
    
    // Build lookup table from batch
    const entriesMap = new Map<string, ElementLookupEntry>();
    
    for (const entry of batch) {
      const priority = this.calculatePriority(entry);
      const lookupEntry: ElementLookupEntry = {
        selector: entry.selector || '',
        domPath: entry.domPath,
        accessibleName: entry.accessibleName,
        priority,
        lastUsed: startTime,
      };
      
      if (entry.selector) {
        entriesMap.set(entry.selector, lookupEntry);
      }
      if (entry.domPath) {
        entriesMap.set(entry.domPath, lookupEntry);
      }
      if (entry.accessibleName) {
        entriesMap.set(entry.accessibleName, lookupEntry);
      }
    }
    
    // Store lookup table
    const tableId = `warmup-${startTime}`;
    this.lookupTables.set(tableId, {
      entries: entriesMap,
      count: entriesMap.size,
      warmUpCompleted: Date.now(),
    });
  }
  
  /**
   * Calculate priority for element lookup
   */
  private calculatePriority(entry: ElementMatchEntry): number {
    let priority = 0;
    
    // CSS selectors have highest priority
    if (entry.selector) {
      priority += 3;
    }
    
    // DOM paths have medium priority
    if (entry.domPath) {
      priority += 2;
    }
    
    // Accessible names have lower priority
    if (entry.accessibleName) {
      priority += 1;
    }
    
    return priority;
  }
  
  /**
   * Get pre-warmed lookup table
   */
  getLookupTable(tableId: string): PreWarmedLookupTable | undefined {
    return this.lookupTables.get(tableId);
  }
  
  /**
   * Find element using pre-warmed lookup table
   */
  findWithLookupTable(selector: string, tableId: string): ElementMatchResult | null {
    const table = this.lookupTables.get(tableId);
    if (!table) {
      return null;
    }
    
    const entry = table.entries.get(selector);
    if (!entry) {
      return null;
    }
    
    // Update last used timestamp
    entry.lastUsed = Date.now();
    
    // Perform element matching
    const element = this.findElementBySelector(selector);
    
    return {
      found: !!element,
      element,
      selector,
      matchTimeMs: 0,
    };
  }
  
  /**
   * Find element by selector
   */
  private findElementBySelector(selector: string): HTMLElement | null {
    return document.querySelector(selector) as HTMLElement | null;
  }
  
  /**
   * Check if warm-up is complete
   */
  isWarmUpComplete(): boolean {
    return this.warmUpQueue.length === 0;
  }
  
  /**
   * Get warm-up progress
   */
  getWarmUpProgress(): { queued: number; tables: number } {
    return {
      queued: this.warmUpQueue.length,
      tables: this.lookupTables.size,
    };
  }
  
  /**
   * Clear all lookup tables
   */
  clear(): void {
    this.lookupTables.clear();
    this.warmUpQueue = [];
  }
}

// ============================================================================
// Playback Speed Controller
// ============================================================================

/**
 * Controls playback speed multiplier
 */
class PlaybackSpeedController {
  private multiplier: number;
  private baseDelayMs: number;
  private minDelayMs: number;
  
  constructor(options: {
    initialMultiplier?: number;
    baseDelayMs?: number;
    minDelayMs?: number;
  }) {
    const {
      initialMultiplier = 1,
      baseDelayMs = 1000,
      minDelayMs = 100,
    } = options;
    
    this.multiplier = initialMultiplier;
    this.baseDelayMs = baseDelayMs;
    this.minDelayMs = minDelayMs;
  }
  
  /**
   * Get delay with speed multiplier applied
   */
  getDelay(): number {
    const calculatedDelay = this.baseDelayMs / this.multiplier;
    return Math.max(calculatedDelay, this.minDelayMs);
  }
  
  /**
   * Get delay for specific step
   */
  getStepDelay(stepIndex: number): number {
    // Apply slight variation based on step index for more natural playback
    const variation = (stepIndex % 10) * 10; // 0-90ms variation
    const baseDelay = this.getDelay();
    
    return Math.max(baseDelay + variation, this.minDelayMs);
  }
  
  /**
   * Adjust playback speed
   */
  adjustSpeed(multiplier: number): void {
    // Support 1x, 2x, 4x speeds
    if ([1, 2, 4].includes(multiplier)) {
      this.multiplier = multiplier;
    } else {
      throw new Error(`Unsupported playback speed: ${multiplier}x. Use 1x, 2x, or 4x.`);
    }
  }
  
  /**
   * Get current speed multiplier
   */
  getMultiplier(): number {
    return this.multiplier;
  }
  
  /**
   * Get speed configuration
   */
  getConfig(): PlaybackSpeedConfig {
    return {
      multiplier: this.multiplier,
      baseDelayMs: this.baseDelayMs,
      minDelayMs: this.minDelayMs,
    };
  }
  
  /**
   * Calculate adjusted duration
   */
  calculateAdjustedDuration(baseDurationMs: number): number {
    return Math.round(baseDurationMs / this.multiplier);
  }
  
  /**
   * Calculate estimated playback time
   */
  calculateEstimatedTime(stepCount: number, baseDelayMs?: number): number {
    const delay = baseDelayMs ?? this.baseDelayMs;
    const adjustedDelay = delay / this.multiplier;
    return Math.round(stepCount * adjustedDelay);
  }
}

// ============================================================================
// Performance Metrics Collector
// ============================================================================

/**
 * Collects and reports performance metrics
 */
class PerformanceMetricsCollector {
  private metrics: PerformanceMetrics;
  
  constructor() {
    this.metrics = {
      totalBatchTranslationTimeMs: 0,
      batchTranslationCount: 0,
      totalElementMatchingTimeMs: 0,
      elementMatchCount: 0,
      elementCacheHits: 0,
      elementCacheMisses: 0,
      preWarmingTimeMs: 0,
      totalSteps: 0,
      actualDurationMs: 0,
    };
  }
  
  /**
   * Record batch translation metrics
   */
  recordBatchTranslation(timeMs: number): void {
    this.metrics.totalBatchTranslationTimeMs += timeMs;
    this.metrics.batchTranslationCount += 1;
  }
  
  /**
   * Record element matching metrics
   */
  recordElementMatching(matchTimeMs: number, wasCached: boolean): void {
    this.metrics.totalElementMatchingTimeMs += matchTimeMs;
    this.metrics.elementMatchCount += 1;
    
    if (wasCached) {
      this.metrics.elementCacheHits += 1;
    } else {
      this.metrics.elementCacheMisses += 1;
    }
  }
  
  /**
   * Record pre-warming metrics
   */
  recordPreWarming(timeMs: number): void {
    this.metrics.preWarmingTimeMs += timeMs;
  }
  
  /**
   * Record step execution
   */
  recordStep(): void {
    this.metrics.totalSteps += 1;
  }
  
  /**
   * Record actual duration
   */
  recordDuration(durationMs: number): void {
    this.metrics.actualDurationMs = durationMs;
  }
  
  /**
   * Get metrics
   */
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }
  
  /**
   * Reset metrics
   */
  reset(): void {
    this.metrics = {
      totalBatchTranslationTimeMs: 0,
      batchTranslationCount: 0,
      totalElementMatchingTimeMs: 0,
      elementMatchCount: 0,
      elementCacheHits: 0,
      elementCacheMisses: 0,
      preWarmingTimeMs: 0,
      totalSteps: 0,
      actualDurationMs: 0,
    };
  }
}

// ============================================================================
// Main PlaybackPerformanceOptimizer Class
// ============================================================================

/**
 * Main class for playback performance optimization
 */
export class PlaybackPerformanceOptimizer {
  private coordinateBatcher: CoordinateTranslationBatcher;
  private elementMatcher: OptimizedElementMatcher;
  private lookupWarmer: LookupTableWarmer;
  private speedController: PlaybackSpeedController;
  private metricsCollector: PerformanceMetricsCollector;
  private lookupTableId: string | null = null;
  
  constructor(options: PlaybackPerformanceOptions = {}) {
    const {
      enableBatchTranslation = true,
      enableElementOptimization = true,
      enableLookupPreWarming = true,
      batchTranslationSize = 10,
      elementCacheCapacity = 50,
      preWarmingBatchSize = 5,
      initialSpeedMultiplier = 1,
    } = options;
    
    // Initialize components
    this.coordinateBatcher = new CoordinateTranslationBatcher(batchTranslationSize);
    this.elementMatcher = new OptimizedElementMatcher(elementCacheCapacity);
    this.lookupWarmer = new LookupTableWarmer(preWarmingBatchSize);
    this.speedController = new PlaybackSpeedController({
      initialMultiplier: initialSpeedMultiplier,
    });
    this.metricsCollector = new PerformanceMetricsCollector();
    
    // Setup components based on options
    if (!enableBatchTranslation) {
      this.coordinateBatcher.clear();
    }
    
    if (!enableElementOptimization) {
      this.elementMatcher.clearCache();
    }
    
    if (!enableLookupPreWarming) {
      this.lookupWarmer.clear();
    }
  }
  
  // --------------------------------------------------------------------------
  // Batch Coordinate Translation
  // --------------------------------------------------------------------------
  
  /**
   * Batch translate coordinates for multi-step workflows
   * 
   * @param coordinates - Array of coordinate translation entries
   * @param screenWidth - Screen width in pixels
   * @param screenHeight - Screen height in pixels
   * @param dpiScale - Display DPI scaling factor
   * @returns Batched coordinate translation result
   */
  batchTranslateCoordinates(
    coordinates: Array<{ x: number; y: number }>,
    screenWidth: number,
    screenHeight: number,
    dpiScale: number = 1
  ): CoordinateTranslationResult {
    // Clear previous batch if it exists
    this.coordinateBatcher.clear();
    
    // Add all coordinates to batch
    coordinates.forEach((coord, index) => {
      this.coordinateBatcher.addCoordinate(
        coord.x,
        coord.y,
        screenWidth,
        screenHeight,
        dpiScale,
        index
      );
    });
    
    // Process batch
    const result = this.coordinateBatcher.processBatch();
    
    // Record metrics
    this.metricsCollector.recordBatchTranslation(result.processingTimeMs);
    
    return result;
  }
  
  /**
   * Translate a single coordinate using batch method (convenience wrapper)
   */
  translateCoordinate(
    x: number,
    y: number,
    screenWidth: number,
    screenHeight: number,
    dpiScale: number = 1
  ): { pixelX: number; pixelY: number } {
    // Create a single-entry batch
    this.coordinateBatcher.addCoordinate(
      x,
      y,
      screenWidth,
      screenHeight,
      dpiScale,
      0
    );
    
    const result = this.coordinateBatcher.processBatch();
    
    return {
      pixelX: result.pixelX[0] ?? 0,
      pixelY: result.pixelY[0] ?? 0,
    };
  }
  
  // --------------------------------------------------------------------------
  // Optimized Element Matching
  // --------------------------------------------------------------------------
  
  /**
   * Optimize element selector matching with caching
   * 
   * @param entry - Element match entry with selector(s)
   * @returns Element match result
   */
  optimizeElementMatching(entry: ElementMatchEntry): ElementMatchResult {
    const result = this.elementMatcher.matchElement(entry);
    
    // Record metrics (wasCached is true if matchTimeMs is 0)
    const wasCached = result.matchTimeMs === 0;
    this.metricsCollector.recordElementMatching(result.matchTimeMs, wasCached);
    
    return result;
  }
  
  /**
   * Optimize matching multiple elements
   */
  optimizeMultipleElementMatching(entries: ElementMatchEntry[]): ElementMatchResult[] {
    return entries.map(entry => this.optimizeElementMatching(entry));
  }
  
  // --------------------------------------------------------------------------
  // Pre-warmed Lookup Tables
  // --------------------------------------------------------------------------
  
  /**
   * Pre-warm element lookup tables
   * 
   * @param entries - Element match entries to warm up
   */
  warmLookupTables(entries: ElementMatchEntry[]): void {
    // Record start time
    const startTime = Date.now();
    
    // Add entries to warm-up queue
    this.lookupWarmer.addToQueue(entries);
    
    // Perform pre-warming
    this.lookupWarmer.preWarm();
    
    // Record metrics
    const totalTime = Date.now() - startTime;
    this.metricsCollector.recordPreWarming(totalTime);
    
    // Generate lookup table ID
    this.lookupTableId = `warmup-${startTime}`;
  }
  
  /**
   * Find element using pre-warmed lookup table
   */
  findWithLookupTable(selector: string): ElementMatchResult | null {
    if (!this.lookupTableId) {
      return null;
    }
    
    return this.lookupWarmer.findWithLookupTable(selector, this.lookupTableId);
  }
  
  // --------------------------------------------------------------------------
  // Playback Speed Adjustment
  // --------------------------------------------------------------------------
  
  /**
   * Adjust playback speed (1x, 2x, 4x)
   * 
   * @param multiplier - Speed multiplier (1, 2, or 4)
   */
  adjustPlaybackSpeed(multiplier: number): void {
    this.speedController.adjustSpeed(multiplier);
  }
  
  /**
   * Get current playback delay with speed adjustment
   */
  getPlaybackDelay(): number {
    return this.speedController.getDelay();
  }
  
  /**
   * Get playback delay for specific step
   */
  getStepDelay(stepIndex: number): number {
    return this.speedController.getStepDelay(stepIndex);
  }
  
  /**
   * Get current speed multiplier
   */
  getSpeedMultiplier(): number {
    return this.speedController.getMultiplier();
  }
  
  /**
   * Calculate adjusted duration
   */
  calculateAdjustedDuration(baseDurationMs: number): number {
    return this.speedController.calculateAdjustedDuration(baseDurationMs);
  }
  
  /**
   * Calculate estimated playback time
   */
  calculateEstimatedTime(stepCount: number, baseDelayMs?: number): number {
    return this.speedController.calculateEstimatedTime(stepCount, baseDelayMs);
  }
  
  // --------------------------------------------------------------------------
  // Performance Metrics
  // --------------------------------------------------------------------------
  
  /**
   * Get performance metrics
   */
  getMetrics(): PerformanceMetrics {
    return this.metricsCollector.getMetrics();
  }
  
  /**
   * Reset performance metrics
   */
  resetMetrics(): void {
    this.metricsCollector.reset();
  }
  
  /**
   * Get optimizer statistics
   */
  getStats(): {
    batchTranslation: { size: number; capacity: number };
    elementMatching: { size: number; capacity: number; usage: number };
    lookupTables: { queued: number; tables: number };
    speedMultiplier: number;
    metrics: PerformanceMetrics;
  } {
    return {
      batchTranslation: {
        size: this.coordinateBatcher.getBatchSize(),
        capacity: this.coordinateBatcher['batchSize'],
      },
      elementMatching: this.elementMatcher.getStats(),
      lookupTables: this.lookupWarmer.getWarmUpProgress(),
      speedMultiplier: this.speedController.getMultiplier(),
      metrics: this.metricsCollector.getMetrics(),
    };
  }
  
  /**
   * Clear all caches and reset optimizer
   */
  clear(): void {
    this.coordinateBatcher.clear();
    this.elementMatcher.clearCache();
    this.lookupWarmer.clear();
    this.resetMetrics();
    this.lookupTableId = null;
  }
}

// ============================================================================
// Export Classes and Interfaces
// ============================================================================

// Re-export all classes for testing and external use
export {
  CoordinateTranslationBatcher,
  OptimizedElementMatcher,
  LookupTableWarmer,
  PlaybackSpeedController,
  PerformanceMetricsCollector,
};

/**
 * Create a new playback performance optimizer instance
 */
export function createPlaybackPerformanceOptimizer(
  options?: PlaybackPerformanceOptions
): PlaybackPerformanceOptimizer {
  return new PlaybackPerformanceOptimizer(options);
}

/**
 * Global playback performance optimizer instance
 * Create with default configuration
 */
export const playbackPerformanceOptimizer = new PlaybackPerformanceOptimizer();
