/**
 * Habit Repository with Confidence Scoring and Similarity Search
 *
 * Implements CRUD operations for Habit objects with full execution history tracking.
 * Supports confidence score updates, similarity-based searches, and context-based queries.
 *
 * Features:
 * - Save/load Habit objects with execution history
 * - Confidence score updates with trend tracking
 * - Similarity search using pattern matching
 * - Context-based habit matching for suggestions
 * - Query by confidence, execution count, and tags
 */

import type { Habit, HabitPattern, HabitCondition, ConfidenceScore, HabitExecutionRecord } from './habit-types';
import type { EntityId, Timestamp } from './integration-types';
import { globalEventDispatcher } from './event-dispatcher';
import { calculateOverallConfidence, applyConfidenceDecay } from './habit-types';

/**
 * Query options for Habit searches
 */
export interface HabitQueryOptions {
  /** Filter by minimum confidence score */
  minConfidence?: number;
  /** Filter by execution count */
  minExecutions?: number;
  /** Filter by source type */
  sourceType?: 'extracted-from-workflow' | 'extracted-from-pack' | 'manual' | 'collaborative';
  /** Filter by lifecycle state */
  lifecycle?: 'new' | 'learning' | 'mature' | 'deprecated';
  /** Search by tags (matches any tag) */
  tags?: string[];
  /** Filter by context requirements */
  context?: {
    windowTitle?: string;
    applicationName?: string;
    urlPattern?: string;
  };
  /** Maximum results to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Result of a Habit query
 */
export interface HabitQueryResult {
  /** Matching Habits */
  items: Habit[];
  /** Total count of matching Habits */
  total: number;
  /** Pagination info */
  pagination?: { limit: number; offset: number; page: number; totalPages: number };
}

/**
 * Similarity search options
 */
export interface SimilaritySearchOptions {
  /** Threshold for similarity score (0-100) */
  threshold?: number;
  /** Maximum number of results */
  limit?: number;
  /** Include exact matches */
  includeExact?: boolean;
}

/**
 * Habit similarity result
 */
export interface HabitSimilarityResult {
  habit: Habit;
  similarityScore: number;
  matchedConditions: number;
  confidenceBoost?: number;
}

/**
 * Habit repository class
 */
export class HabitRepository {
  private habits: Map<string, Habit> = new Map();
  private patternIndex: Map<string, Set<string>> = new Map();
  private tagIndex: Map<string, Set<string>> = new Map();
  private sourceIndex: Map<string, Set<string>> = new Map();
  private confidenceIndex: Map<number, Set<string>> = new Map();
  private lifecycleIndex: Map<string, Set<string>> = new Map();

  /**
   * Save a Habit
   * - Updates confidence scores
   * - Updates all indexes
   * - Emits appropriate events
   */
  save(habit: Habit): Habit {
    // Validate habit
    this.validateHabit(habit);

    const existing = this.habits.get(habit.id);
    const isNew = !existing;

    // Apply confidence decay if updating
    if (!isNew) {
      applyConfidenceDecay(habit);
    }

    // Calculate overall confidence
    habit.confidence.overall = calculateOverallConfidence(habit.confidence);

    // Update storage
    this.habits.set(habit.id, habit);

    // Update indexes
    this.updateIndexes(habit, isNew ? 'add' : 'update');

    // Emit event
    if (isNew) {
      globalEventDispatcher.emit({ type: 'HabitExtracted', habit });
    } else {
      globalEventDispatcher.emit({
        type: 'HabitUpdated',
        habit,
        changes: { type: 'confidence-updated' },
      });
    }

    return habit;
  }

  /**
   * Find a Habit by ID
   */
  findById(id: string): Habit | undefined {
    return this.habits.get(id);
  }

  /**
   * Find Habits by pattern (exact match or similar)
   */
  findByPattern(pattern: HabitPattern, options?: { strict?: boolean }): Habit[] {
    const candidates = this.getAll();
    
    if (options?.strict) {
      // Exact pattern match
      return candidates.filter(habit => this.patternsMatch(habit.pattern, pattern));
    }

    // Fuzzy pattern match
    return candidates
      .map(habit => ({
        habit,
        similarity: this.calculatePatternSimilarity(habit.pattern, pattern),
      }))
      .filter(item => item.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity)
      .map(item => item.habit);
  }

  /**
   * Find Habits similar to a reference habit
   */
  findBySimilarity(
    referenceHabit: Habit,
    threshold: number = 70,
    options?: SimilaritySearchOptions
  ): HabitSimilarityResult[] {
    const results: HabitSimilarityResult[] = [];

    for (const habit of this.habits.values()) {
      if (habit.id === referenceHabit.id) continue;

      const similarity = this.calculateHabitSimilarity(habit, referenceHabit);
      
      if (similarity >= threshold) {
        results.push({
          habit,
          similarityScore: similarity,
          matchedConditions: this.countMatchedConditions(habit.pattern, referenceHabit.pattern),
        });
      }
    }

    // Sort by similarity score
    results.sort((a, b) => b.similarityScore - a.similarityScore);

    // Apply limit
    const limit = options?.limit ?? results.length;
    return results.slice(0, limit);
  }

  /**
   * Find Habits matching current context
   */
  findByContext(context: {
    windowTitle?: string;
    applicationName?: string;
    url?: string;
    visibleElements?: Array<{ selector: string; accessible_name: string }>;
  }): Habit[] {
    return this.getAll().filter(habit => {
      // Check context requirements
      if (habit.pattern.conditions.length === 0) return true;

      return habit.pattern.conditions.some(condition => {
        return this.conditionMatchesContext(condition, context);
      });
    });
  }

  /**
   * Update confidence scores for a Habit
   */
  updateConfidence(habitId: string, newConfidence: Partial<ConfidenceScore>): Habit {
    const habit = this.habits.get(habitId);
    if (!habit) {
      throw new Error(`Habit not found: ${habitId}`);
    }

    // Update confidence
    habit.confidence.breakdown = {
      ...habit.confidence.breakdown,
      ...newConfidence,
    };

    // Recalculate overall confidence
    habit.confidence.overall = calculateOverallConfidence(habit.confidence);

    // Update storage and indexes
    this.habits.set(habitId, habit);
    this.updateConfidenceIndex(habit);

    globalEventDispatcher.emit({
      type: 'HabitUpdated',
      habit,
      changes: { type: 'confidence-updated' },
    });

    return habit;
  }

  /**
   * Update execution history for a Habit
   */
  updateExecutionHistory(habitId: string, record: HabitExecutionRecord): Habit {
    const habit = this.habits.get(habitId);
    if (!habit) {
      throw new Error(`Habit not found: ${habitId}`);
    }

    const updatedHabit = {
      ...habit,
      executionHistory: [...habit.executionHistory, record],
    };

    // Update storage
    this.habits.set(habitId, updatedHabit);

    globalEventDispatcher.emit({
      type: 'HabitUpdated',
      habit: updatedHabit,
      changes: { type: 'execution-updated' },
    });

    return updatedHabit;
  }

  /**
   * Get execution history for a Habit
   */
  getExecutionHistory(habitId: string): HabitExecutionRecord[] {
    const habit = this.habits.get(habitId);
    return habit?.executionHistory ?? [];
  }

  /**
   * Get execution statistics for a Habit
   */
  getExecutionStats(habitId: string): {
    successRate: number;
    executionCount: number;
    lastExecuted?: string;
    frequencyPerWeek?: number;
  } {
    const history = this.getExecutionHistory(habitId);
    if (history.length === 0) {
      return { successRate: 0, executionCount: 0 };
    }

    const successCount = history.filter(e => e.success).length;
    const successRate = (successCount / history.length) * 100;
    const lastExecuted = history[history.length - 1].timestamp;

    // Calculate frequency (executions per week)
    const now = new Date();
    let frequencyPerWeek = 0;
    if (history.length > 1) {
      const firstExecuted = new Date(history[0].timestamp);
      const weeks = (now.getTime() - firstExecuted.getTime()) / (7 * 24 * 60 * 60 * 1000);
      frequencyPerWeek = weeks > 0 ? history.length / weeks : history.length;
    }

    return {
      successRate,
      executionCount: history.length,
      lastExecuted,
      frequencyPerWeek: Math.round(frequencyPerWeek * 10) / 10,
    };
  }

  /**
   * Delete a Habit by ID
   * Returns true if deleted, false if not found
   */
  delete(id: string): boolean {
    const habit = this.habits.get(id);
    if (!habit) return false;

    this.habits.delete(id);
    this.updateIndexes(habit, 'remove');

    globalEventDispatcher.emit({
      type: 'HabitUpdated',
      habit,
      changes: { type: 'habit-deleted' },
    });

    return true;
  }

  /**
   * Delete all Habits
   * Returns count of deleted Habits
   */
  deleteAll(): number {
    const count = this.habits.size;
    
    // Get all Habits for event emission
    const deletedHabits = [...this.habits.values()];
    
    this.habits.clear();
    
    // Clear all indexes
    this.patternIndex.clear();
    this.tagIndex.clear();
    this.sourceIndex.clear();
    this.confidenceIndex.clear();
    this.lifecycleIndex.clear();

    deletedHabits.forEach(habit => {
      globalEventDispatcher.emit({
        type: 'HabitUpdated',
        habit,
        changes: { type: 'habit-deleted' },
      });
    });

    return count;
  }

  /**
   * Get count of all Habits
   */
  getCount(): number {
    return this.habits.size;
  }

  /**
   * Get all Habits
   */
  getAll(): Habit[] {
    return [...this.habits.values()];
  }

  /**
   * Search Habits with filtering
   */
  search(options: HabitQueryOptions = {}): HabitQueryResult {
    let results: Habit[] = [...this.habits.values()];

    // Filter by minimum confidence
    if (options.minConfidence !== undefined) {
      results = results.filter(h => h.confidence.overall >= options.minConfidence!);
    }

    // Filter by minimum executions
    if (options.minExecutions !== undefined) {
      results = results.filter(h => h.executionHistory.length >= options.minExecutions!);
    }

    // Filter by source type
    if (options.sourceType) {
      results = results.filter(h => h.metadata.sourceType === options.sourceType);
    }

    // Filter by lifecycle
    if (options.lifecycle) {
      results = results.filter(h => h.metadata.lifecycle === options.lifecycle);
    }

    // Filter by tags
    if (options.tags && options.tags.length > 0) {
      results = results.filter(h => 
        options.tags!.some(tag => h.metadata.tags.includes(tag))
      );
    }

    // Filter by context (simplified)
    if (options.context) {
      results = results.filter(h => this.contextMatches(h, options.context!));
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
   * Get Habits by source type
   */
  findBySourceType(sourceType: string): Habit[] {
    const ids = this.sourceIndex.get(sourceType);
    if (!ids) return [];
    return [...ids].map(id => this.habits.get(id)!).filter((h): h is Habit => h !== undefined);
  }

  /**
   * Get Habits by lifecycle state
   */
  findByLifecycle(lifecycle: string): Habit[] {
    const ids = this.lifecycleIndex.get(lifecycle);
    if (!ids) return [];
    return [...ids].map(id => this.habits.get(id)!).filter((h): h is Habit => h !== undefined);
  }

  /**
   * Get all source types used across Habits
   */
  getSourceTypes(): string[] {
    return [...this.sourceIndex.keys()];
  }

  /**
   * Get all lifecycle states used across Habits
   */
  getLifecycleStates(): string[] {
    return [...this.lifecycleIndex.keys()];
  }

  /**
   * Get all tags used across Habits
   */
  getAllTags(): string[] {
    return [...this.tagIndex.keys()];
  }

  /**
   * Get confidence distribution
   */
  getConfidenceDistribution(): { low: number; medium: number; high: number } {
    let low = 0;
    let medium = 0;
    let high = 0;

    for (const habit of this.habits.values()) {
      if (habit.confidence.overall < 50) low++;
      else if (habit.confidence.overall < 80) medium++;
      else high++;
    }

    return { low, medium, high };
  }

  /**
   * Get Habits sorted by confidence score
   */
  sortByConfidence(): Habit[] {
    return [...this.habits.values()].sort((a, b) => b.confidence.overall - a.confidence.overall);
  }

  /**
   * Suggest Habits based on context
   * Returns Habits sorted by confidence score
   */
  suggestHabits(context: {
    windowTitle?: string;
    applicationName?: string;
    url?: string;
    visibleElements?: Array<{ selector: string; accessible_name: string }>;
    minConfidence?: number;
  }): Habit[] {
    let results = this.findByContext(context);

    // Filter by minimum confidence
    if (context.minConfidence !== undefined) {
      results = results.filter(h => h.confidence.overall >= context.minConfidence!);
    }

    // Sort by confidence
    results.sort((a, b) => b.confidence.overall - a.confidence.overall);

    return results;
  }

  /**
   * Merge two similar Habits
   * Preserves execution history and variants
   */
  mergeHabits(targetId: string, sourceId: string): Habit {
    const target = this.habits.get(targetId);
    const source = this.habits.get(sourceId);

    if (!target || !source) {
      throw new Error('One or both Habits not found');
    }

    // Merge execution histories (keep both)
    const mergedHistory = [
      ...target.executionHistory,
      ...source.executionHistory,
    ];

    // Calculate merged confidence
    const targetConfidence = target.confidence.breakdown;
    const sourceConfidence = source.confidence.breakdown;

    const mergedConfidence = {
      successRate: (targetConfidence.successRate + sourceConfidence.successRate) / 2,
      frequency: targetConfidence.frequency + sourceConfidence.frequency,
      recency: Math.max(targetConfidence.recency, sourceConfidence.recency),
      userFeedback: (targetConfidence.userFeedback + sourceConfidence.userFeedback) / 2,
    };

    const mergedHabit: Habit = {
      ...target,
      executionHistory: mergedHistory,
      confidence: {
        ...target.confidence,
        breakdown: mergedConfidence,
        overall: calculateOverallConfidence(mergedConfidence),
      },
      variants: [...target.variants, { ...source, id: source.id + '-variant' }],
    };

    // Update storage
    this.habits.set(targetId, mergedHabit);
    this.habits.delete(sourceId);

    // Update indexes
    this.updateIndexes(mergedHabit, 'update');

    globalEventDispatcher.emit({
      type: 'HabitUpdated',
      habit: mergedHabit,
      changes: { type: 'habit-merged' },
    });

    return mergedHabit;
  }

  /**
   * Check if a Habit exists
   */
  exists(id: string): boolean {
    return this.habits.has(id);
  }

  /**
   * Calculate pattern similarity between two habits
   */
  private calculatePatternSimilarity(pattern1: HabitPattern, pattern2: HabitPattern): number {
    let score = 0;
    let maxScore = 0;

    // Compare conditions
    for (const cond1 of pattern1.conditions) {
      for (const cond2 of pattern2.conditions) {
        const conditionScore = this.calculateConditionSimilarity(cond1, cond2);
        score += conditionScore;
        maxScore += 1; // Normalized per condition pair
      }
    }

    // Compare actions
    for (const action1 of pattern1.actions) {
      for (const action2 of pattern2.actions) {
        const actionScore = this.calculateActionSimilarity(action1, action2);
        score += actionScore;
        maxScore += 1;
      }
    }

    if (maxScore === 0) return 0;
    return (score / maxScore) * 100;
  }

  /**
   * Calculate condition similarity
   */
  private calculateConditionSimilarity(cond1: HabitCondition, cond2: HabitCondition): number {
    if (cond1.type !== cond2.type) return 0;

    // For element-state conditions
    if (cond1.type === 'element-state') {
      const matcher1 = cond1.matcher as any;
      const matcher2 = cond2.matcher as any;
      
      if (matcher1.selector === matcher2.selector) {
        return 0.8;
      }
      if (matcher1.selector.includes(matcher2.selector) || 
          matcher2.selector.includes(matcher1.selector)) {
        return 0.5;
      }
      return 0;
    }

    // For context-match conditions
    if (cond1.type === 'context-match') {
      const matcher1 = cond1.matcher as any;
      const matcher2 = cond2.matcher as any;
      
      if (matcher1.field === matcher2.field) {
        return 0.7;
      }
      return 0;
    }

    // For other condition types
    return cond1.type === cond2.type ? 0.5 : 0;
  }

  /**
   * Calculate action similarity
   */
  private calculateActionSimilarity(action1: any, action2: any): number {
    if (action1.type !== action2.type) return 0;

    // For click actions
    if (action1.type === 'click') {
      const xDiff = Math.abs((action1.data as any).x - (action2.data as any).x);
      const yDiff = Math.abs((action1.data as any).y - (action2.data as any).y);
      
      // Normalize to 0-1 range
      if (xDiff < 0.1 && yDiff < 0.1) return 0.8;
      if (xDiff < 0.2 && yDiff < 0.2) return 0.5;
      return 0;
    }

    // For keyboard actions
    if (action1.type === 'keyboard') {
      const key1 = (action1.data as any).key;
      const key2 = (action2.data as any).key;
      return key1 === key2 ? 0.9 : 0;
    }

    // For drag actions
    if (action1.type === 'drag') {
      const startXDiff = Math.abs((action1.data as any).startX - (action2.data as any).startX);
      const startYDiff = Math.abs((action1.data as any).startY - (action2.data as any).startY);
      
      if (startXDiff < 0.1 && startYDiff < 0.1) return 0.8;
      return 0;
    }

    // For other action types
    return action1.type === action2.type ? 0.5 : 0;
  }

  /**
   * Calculate overall habit similarity
   */
  private calculateHabitSimilarity(habit1: Habit, habit2: Habit): number {
    const patternScore = this.calculatePatternSimilarity(habit1.pattern, habit2.pattern);
    
    // Factor in confidence scores
    const confidenceDiff = Math.abs(habit1.confidence.overall - habit2.confidence.overall);
    const confidenceScore = 100 - Math.min(confidenceDiff, 100);

    // Factor in source compatibility
    const sourceMatch = habit1.metadata.sourceType === habit2.metadata.sourceType ? 20 : 0;

    return (patternScore * 0.6) + (confidenceScore * 0.3) + sourceMatch;
  }

  /**
   * Count matched conditions
   */
  private countMatchedConditions(pattern1: HabitPattern, pattern2: HabitPattern): number {
    let count = 0;

    for (const cond1 of pattern1.conditions) {
      for (const cond2 of pattern2.conditions) {
        if (this.calculateConditionSimilarity(cond1, cond2) > 0.5) {
          count++;
        }
      }
    }

    return count;
  }

  /**
   * Check if pattern matches (exact)
   */
  private patternsMatch(pattern1: HabitPattern, pattern2: HabitPattern): boolean {
    if (pattern1.conditions.length !== pattern2.conditions.length) return false;
    if (pattern1.actions.length !== pattern2.actions.length) return false;

    // Check conditions
    for (const cond1 of pattern1.conditions) {
      const matched = pattern2.conditions.some(cond2 => 
        this.calculateConditionSimilarity(cond1, cond2) > 0.9
      );
      if (!matched) return false;
    }

    // Check actions
    for (const action1 of pattern1.actions) {
      const matched = pattern2.actions.some(action2 => 
        this.calculateActionSimilarity(action1, action2) > 0.9
      );
      if (!matched) return false;
    }

    return true;
  }

  /**
   * Check if condition matches context
   */
  private conditionMatchesContext(condition: HabitCondition, context: any): boolean {
    if (condition.type === 'element-state') {
      const matcher = condition.matcher as any;
      const selector = matcher.selector;
      
      return context.visibleElements?.some(element => 
        element.selector === selector || element.selector.includes(selector)
      );
    }

    if (condition.type === 'context-match') {
      const matcher = condition.matcher as any;
      
      if (matcher.field === 'windowTitle' && matcher.pattern) {
        return context.windowTitle?.includes(matcher.pattern);
      }
      if (matcher.field === 'applicationName' && matcher.pattern) {
        return context.applicationName?.includes(matcher.pattern);
      }
      if (matcher.field === 'url' && matcher.pattern) {
        return context.url?.includes(matcher.pattern);
      }
    }

    if (condition.type === 'time-pattern') {
      // Simplified: always match for prototype
      return true;
    }

    if (condition.type === 'sequence-history') {
      // Simplified: always match for prototype
      return true;
    }

    return false;
  }

  /**
   * Check if habit matches context
   */
  private contextMatches(habit: Habit, context: any): boolean {
    if (habit.pattern.conditions.length === 0) return true;

    return habit.pattern.conditions.some(condition => 
      this.conditionMatchesContext(condition, context)
    );
  }

  /**
   * Validate habit structure
   */
  private validateHabit(habit: Habit): void {
    if (!habit.id) {
      throw new Error('Habit must have an ID');
    }
    if (!habit.pattern) {
      throw new Error('Habit must have a pattern');
    }
    if (!habit.confidence) {
      throw new Error('Habit must have confidence scores');
    }
  }

  /**
   * Update confidence index for a habit
   */
  private updateConfidenceIndex(habit: Habit): void {
    // Remove from old confidence bucket
    const oldConfidence = Math.floor(habit.confidence.overall / 10) * 10;
    const confidenceSet = this.confidenceIndex.get(oldConfidence);
    confidenceSet?.delete(habit.id);

    // Add to new confidence bucket
    const newConfidence = Math.floor(habit.confidence.overall / 10) * 10;
    if (!this.confidenceIndex.has(newConfidence)) {
      this.confidenceIndex.set(newConfidence, new Set());
    }
    this.confidenceIndex.get(newConfidence)!.add(habit.id);
  }

  /**
   * Update all indexes for a Habit
   */
  private updateIndexes(habit: Habit, operation: 'add' | 'update' | 'remove'): void {
    const { id, pattern, metadata } = habit;

    // Pattern index
    if (operation === 'add' || operation === 'update') {
      const patternKey = this.createPatternKey(pattern);
      if (!this.patternIndex.has(patternKey)) {
        this.patternIndex.set(patternKey, new Set());
      }
      this.patternIndex.get(patternKey)!.add(id);
    } else if (operation === 'remove') {
      const patternKey = this.createPatternKey(pattern);
      const patternSet = this.patternIndex.get(patternKey);
      patternSet?.delete(id);
    }

    // Tags index
    if (operation === 'add' || operation === 'update') {
      for (const tag of metadata.tags) {
        if (!this.tagIndex.has(tag)) {
          this.tagIndex.set(tag, new Set());
        }
        this.tagIndex.get(tag)!.add(id);
      }
    } else if (operation === 'remove') {
      for (const tag of metadata.tags) {
        const tagSet = this.tagIndex.get(tag);
        tagSet?.delete(id);
      }
    }

    // Source type index
    if (operation === 'add' || operation === 'update') {
      if (!this.sourceIndex.has(metadata.sourceType)) {
        this.sourceIndex.set(metadata.sourceType, new Set());
      }
      this.sourceIndex.get(metadata.sourceType)!.add(id);
    } else if (operation === 'remove') {
      const sourceSet = this.sourceIndex.get(metadata.sourceType);
      sourceSet?.delete(id);
    }

    // Confidence index
    if (operation === 'add' || operation === 'update') {
      this.updateConfidenceIndex(habit);
    }

    // Lifecycle index
    if (operation === 'add' || operation === 'update') {
      if (!this.lifecycleIndex.has(metadata.lifecycle)) {
        this.lifecycleIndex.set(metadata.lifecycle, new Set());
      }
      this.lifecycleIndex.get(metadata.lifecycle)!.add(id);
    } else if (operation === 'remove') {
      const lifecycleSet = this.lifecycleIndex.get(metadata.lifecycle);
      lifecycleSet?.delete(id);
    }
  }

  /**
   * Create a key for pattern matching
   */
  private createPatternKey(pattern: HabitPattern): string {
    // Simplified: use condition types and action types as key
    const conditionTypes = pattern.conditions.map(c => c.type).sort().join(',');
    const actionTypes = pattern.actions.map(a => a.type).sort().join(',');
    return `${conditionTypes}|${actionTypes}`;
  }
}

/**
 * Create a new HabitRepository instance
 */
export function createHabitRepository(): HabitRepository {
  return new HabitRepository();
}

// Export types
export type { HabitQueryOptions, HabitQueryResult, SimilaritySearchOptions, HabitSimilarityResult };