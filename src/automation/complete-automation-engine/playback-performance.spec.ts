/**
 * Playback Performance Optimization Tests
 *
 * Tests for:
 * - Batch coordinate translation
 * - Optimized element selector matching with caching
 * - Pre-warmed element lookup tables
 * - Playback speed adjustment
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PlaybackPerformanceOptimizer,
  createPlaybackPerformanceOptimizer,
  CoordinateTranslationBatcher,
  OptimizedElementMatcher,
  LookupTableWarmer,
  PlaybackSpeedController,
  PerformanceMetricsCollector,
} from './playback-performance';

// ============================================================================
// Unit Tests
// ============================================================================

// Coordinate Translation Batcher Tests
describe('CoordinateTranslationBatcher', () => {
  it('should batch coordinate translations', () => {
    const batcher = new CoordinateTranslationBatcher(3);
    
    batcher.addCoordinate(0.5, 0.5, 1920, 1080, 1, 0);
    batcher.addCoordinate(0.25, 0.75, 1920, 1080, 1, 1);
    batcher.addCoordinate(0.75, 0.25, 1920, 1080, 1, 2);
    
    expect(batcher.getBatchSize()).toBe(3);
    
    const result = batcher.processBatch();
    
    expect(result.pixelX).toEqual([960, 480, 1440]);
    expect(result.pixelY).toEqual([540, 810, 270]);
    expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
  });
  
  it('should handle different DPI scales', () => {
    const batcher = new CoordinateTranslationBatcher(2);
    
    batcher.addCoordinate(0.5, 0.5, 1920, 1080, 1.5, 0);
    batcher.addCoordinate(0.25, 0.75, 1920, 1080, 1.5, 1);
    
    const result = batcher.processBatch();
    
    expect(result.pixelX).toEqual([1440, 720]);
    expect(result.pixelY).toEqual([810, 1215]);
  });
  
  it('should clear batch', () => {
    const batcher = new CoordinateTranslationBatcher(3);
    
    batcher.addCoordinate(0.5, 0.5, 1920, 1080, 1, 0);
    batcher.clear();
    
    expect(batcher.getBatchSize()).toBe(0);
  });
});

// Optimized Element Matcher Tests
describe('OptimizedElementMatcher', () => {
  it('should cache element matches', () => {
    const matcher = new OptimizedElementMatcher(10);
    
    const entry = {
      selector: '#test-button',
    };
    
    // First match - not cached
    const result1 = matcher.matchElement(entry);
    expect(result1.found).toBe(false);
    
    // Second match - should be cached
    const result2 = matcher.matchElement(entry);
    expect(result2.found).toBe(false);
    expect(result2.matchTimeMs).toBe(0); // Cached
  });
  
  it('should support multiple selector types', () => {
    const matcher = new OptimizedElementMatcher(10);
    
    const entry = {
      selector: '#test-id',
      domPath: 'html > body > div',
      accessibleName: 'Test Button',
    };
    
    const result = matcher.matchElement(entry);
    expect(result.selector).toBe('#test-id');
  });
  
  it('should evict oldest entries when capacity exceeded', () => {
    const matcher = new OptimizedElementMatcher(2);
    
    matcher.matchElement({ selector: '#a' });
    matcher.matchElement({ selector: '#b' });
    matcher.matchElement({ selector: '#c' });
    
    // First entry should be evicted
    expect(matcher.getStats().size).toBe(2);
  });
  
  it('should clear cache', () => {
    const matcher = new OptimizedElementMatcher(10);
    
    matcher.matchElement({ selector: '#test' });
    matcher.clearCache();
    
    expect(matcher.getStats().size).toBe(0);
  });
});

// Lookup Table Warmer Tests
describe('LookupTableWarmer', () => {
  it('should pre-warm lookup tables', () => {
    const warmer = new LookupTableWarmer(5);
    
    const entries = [
      { selector: '#a', domPath: 'html > body > div.a' },
      { selector: '#b', domPath: 'html > body > div.b' },
    ];
    
    warmer.addToQueue(entries);
    warmer.preWarm();
    
    expect(warmer.getWarmUpProgress().tables).toBe(1);
  });
  
  it('should process entries in batches', () => {
    const warmer = new LookupTableWarmer(1); // Batch size of 1
    
    const entries = [
      { selector: '#a' },
      { selector: '#b' },
      { selector: '#c' },
    ];
    
    warmer.addToQueue(entries);
    
    // First pre-warm processes 1 entry
    warmer.preWarm();
    expect(warmer.getWarmUpProgress().queued).toBe(2); // 1 processed, 2 queued
    
    // Second pre-warm processes another entry
    warmer.preWarm();
    expect(warmer.getWarmUpProgress().queued).toBe(1); // 2 processed, 1 queued
  });
  
  it('should check if warm-up is complete', () => {
    const warmer = new LookupTableWarmer(5);
    
    expect(warmer.isWarmUpComplete()).toBe(true);
    
    warmer.addToQueue([{ selector: '#a' }]);
    expect(warmer.isWarmUpComplete()).toBe(false);
    
    warmer.preWarm();
    expect(warmer.isWarmUpComplete()).toBe(true);
  });
  
  it('should clear all tables', () => {
    const warmer = new LookupTableWarmer(5);
    
    warmer.addToQueue([{ selector: '#a' }]);
    warmer.preWarm();
    
    expect(warmer.getWarmUpProgress().tables).toBe(1);
    
    warmer.clear();
    expect(warmer.getWarmUpProgress().tables).toBe(0);
  });
});

// Playback Speed Controller Tests
describe('PlaybackSpeedController', () => {
  it('should support 1x speed (default)', () => {
    const controller = new PlaybackSpeedController({ initialMultiplier: 1 });
    
    expect(controller.getMultiplier()).toBe(1);
    expect(controller.getDelay()).toBe(1000); // baseDelayMs
  });
  
  it('should support 2x speed', () => {
    const controller = new PlaybackSpeedController({ initialMultiplier: 2 });
    
    expect(controller.getMultiplier()).toBe(2);
    expect(controller.getDelay()).toBe(500); // 1000 / 2
  });
  
  it('should support 4x speed', () => {
    const controller = new PlaybackSpeedController({ initialMultiplier: 4 });
    
    expect(controller.getMultiplier()).toBe(4);
    expect(controller.getDelay()).toBe(250); // 1000 / 4
  });
  
  it('should enforce minimum delay', () => {
    const controller = new PlaybackSpeedController({
      initialMultiplier: 100,
      baseDelayMs: 1000,
      minDelayMs: 100,
    });
    
    expect(controller.getDelay()).toBe(100); // minDelayMs
  });
  
  it('should adjust speed dynamically', () => {
    const controller = new PlaybackSpeedController({ initialMultiplier: 1 });
    
    controller.adjustSpeed(2);
    expect(controller.getMultiplier()).toBe(2);
    expect(controller.getDelay()).toBe(500);
    
    controller.adjustSpeed(4);
    expect(controller.getMultiplier()).toBe(4);
    expect(controller.getDelay()).toBe(250);
    
    controller.adjustSpeed(1);
    expect(controller.getMultiplier()).toBe(1);
    expect(controller.getDelay()).toBe(1000);
  });
  
  it('should calculate adjusted duration', () => {
    const controller = new PlaybackSpeedController({ initialMultiplier: 2 });
    
    expect(controller.calculateAdjustedDuration(2000)).toBe(1000);
    expect(controller.calculateAdjustedDuration(4000)).toBe(2000);
  });
  
  it('should calculate estimated time', () => {
    const controller = new PlaybackSpeedController({
      initialMultiplier: 2,
      baseDelayMs: 1000,
    });
    
    expect(controller.calculateEstimatedTime(10)).toBe(5000); // 10 * (1000 / 2)
  });
  
  it('should throw error for unsupported speed', () => {
    const controller = new PlaybackSpeedController({ initialMultiplier: 1 });
    
    expect(() => {
      controller.adjustSpeed(3);
    }).toThrow('Unsupported playback speed: 3x. Use 1x, 2x, or 4x.');
  });
});

// Performance Metrics Collector Tests
describe('PerformanceMetricsCollector', () => {
  it('should record batch translation metrics', () => {
    const collector = new PerformanceMetricsCollector();
    
    collector.recordBatchTranslation(100);
    collector.recordBatchTranslation(50);
    
    const metrics = collector.getMetrics();
    expect(metrics.totalBatchTranslationTimeMs).toBe(150);
    expect(metrics.batchTranslationCount).toBe(2);
  });
  
  it('should record element matching metrics', () => {
    const collector = new PerformanceMetricsCollector();
    
    collector.recordElementMatching(100, false); // Not cached
    collector.recordElementMatching(0, true); // Cached
    
    const metrics = collector.getMetrics();
    expect(metrics.totalElementMatchingTimeMs).toBe(100);
    expect(metrics.elementMatchCount).toBe(2);
    expect(metrics.elementCacheMisses).toBe(1);
    expect(metrics.elementCacheHits).toBe(1);
  });
  
  it('should record pre-warming metrics', () => {
    const collector = new PerformanceMetricsCollector();
    
    collector.recordPreWarming(200);
    
    const metrics = collector.getMetrics();
    expect(metrics.preWarmingTimeMs).toBe(200);
  });
  
  it('should reset metrics', () => {
    const collector = new PerformanceMetricsCollector();
    
    collector.recordBatchTranslation(100);
    collector.reset();
    
    const metrics = collector.getMetrics();
    expect(metrics.totalBatchTranslationTimeMs).toBe(0);
    expect(metrics.batchTranslationCount).toBe(0);
  });
});

// Main PlaybackPerformanceOptimizer Tests
describe('PlaybackPerformanceOptimizer', () => {
  let optimizer: PlaybackPerformanceOptimizer;
  
  beforeEach(() => {
    optimizer = new PlaybackPerformanceOptimizer();
  });
  
  it('should create optimizer with default options', () => {
    expect(optimizer).toBeDefined();
  });
  
  it('should support batch coordinate translation', () => {
    const result = optimizer.batchTranslateCoordinates(
      [{ x: 0.5, y: 0.5 }, { x: 0.25, y: 0.75 }],
      1920,
      1080
    );
    
    expect(result.pixelX).toEqual([960, 480]);
    expect(result.pixelY).toEqual([540, 810]);
  });
  
  it('should support element matching optimization', () => {
    const result = optimizer.optimizeElementMatching({
      selector: '#test-button',
    });
    
    expect(result).toBeDefined();
    expect(result.selector).toBe('#test-button');
  });
  
  it('should support lookup table pre-warming', () => {
    optimizer.warmLookupTables([
      { selector: '#a' },
      { selector: '#b' },
    ]);
    
    const stats = optimizer.getStats();
    expect(stats.lookupTables.tables).toBeGreaterThanOrEqual(1);
  });
  
  it('should support playback speed adjustment', () => {
    optimizer.adjustPlaybackSpeed(2);
    expect(optimizer.getSpeedMultiplier()).toBe(2);
    
    optimizer.adjustPlaybackSpeed(4);
    expect(optimizer.getSpeedMultiplier()).toBe(4);
    
    optimizer.adjustPlaybackSpeed(1);
    expect(optimizer.getSpeedMultiplier()).toBe(1);
  });
  
  it('should calculate adjusted duration with speed multiplier', () => {
    optimizer.adjustPlaybackSpeed(2);
    expect(optimizer.calculateAdjustedDuration(2000)).toBe(1000);
  });
  
  it('should get performance metrics', () => {
    const result = optimizer.batchTranslateCoordinates(
      [{ x: 0.5, y: 0.5 }],
      1920,
      1080
    );
    
    const metrics = optimizer.getMetrics();
    
    expect(metrics.totalBatchTranslationTimeMs).toBeGreaterThanOrEqual(0);
    expect(metrics.batchTranslationCount).toBe(1);
  });
  
  it('should get optimizer statistics', () => {
    const stats = optimizer.getStats();
    
    expect(stats.batchTranslation).toBeDefined();
    expect(stats.elementMatching).toBeDefined();
    expect(stats.lookupTables).toBeDefined();
    expect(stats.speedMultiplier).toBe(1); // Default
  });
  
  it('should clear all caches', () => {
    optimizer.warmLookupTables([{ selector: '#a' }]);
    optimizer.optimizeElementMatching({ selector: '#b' });
    
    optimizer.clear();
    
    const stats = optimizer.getStats();
    expect(stats.lookupTables.tables).toBe(0);
    expect(stats.elementMatching.size).toBe(0);
  });
  
  it('should support factory function', () => {
    const customOptimizer = createPlaybackPerformanceOptimizer({
      batchTranslationSize: 20,
      elementCacheCapacity: 100,
    });
    
    expect(customOptimizer).toBeDefined();
  });
  
  it('should initialize with custom speed multiplier', () => {
    const customOptimizer = createPlaybackPerformanceOptimizer({
      initialSpeedMultiplier: 2,
    });
    
    expect(customOptimizer.getSpeedMultiplier()).toBe(2);
  });
});

// ============================================================================
// Integration Tests
// ============================================================================

describe('PlaybackPerformanceOptimizer Integration', () => {
  it('should handle full workflow with optimizations', () => {
    const optimizer = new PlaybackPerformanceOptimizer();
    
    // 1. Batch translate coordinates
    const coordinates = [
      { x: 0.5, y: 0.5 },
      { x: 0.25, y: 0.75 },
      { x: 0.75, y: 0.25 },
    ];
    
    const translationResult = optimizer.batchTranslateCoordinates(
      coordinates,
      1920,
      1080
    );
    
    expect(translationResult.pixelX.length).toBe(3);
    expect(translationResult.pixelY.length).toBe(3);
    
    // 2. Optimize element matching
    const matchEntries = [
      { selector: '#step1' },
      { selector: '#step2' },
      { selector: '#step3' },
    ];
    
    matchEntries.forEach(entry => {
      optimizer.optimizeElementMatching(entry);
    });
    
    // 3. Pre-warm lookup tables
    const warmUpEntries = [
      { selector: '#warm1' },
      { selector: '#warm2' },
    ];
    
    optimizer.warmLookupTables(warmUpEntries);
    
    // 4. Adjust playback speed
    optimizer.adjustPlaybackSpeed(2);
    
    // 5. Calculate estimated time
    const estimatedTime = optimizer.calculateEstimatedTime(100);
    expect(estimatedTime).toBeLessThan(100000); // Should be faster than 1x
    
    // 6. Get metrics
    const metrics = optimizer.getMetrics();
    expect(metrics.batchTranslationCount).toBe(1);
    expect(metrics.elementMatchCount).toBe(3);
  });
});
