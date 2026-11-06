/**
 * Habit Discovery and Search
 * Implements searching, filtering, and discovering habits by various criteria.
 * Includes habit archival and recovery mechanisms.
 * 
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.5
 */

import type { Habit, HabitId } from './habit-extraction.js';

/**
 * Search filter for habit discovery.
 */
export interface HabitSearchFilter {
  query?: string;  // Target or description search
  minSuccessRate?: number;  // Minimum success rate (0..1)
  maxSuccessRate?: number;  // Maximum success rate (0..1)
  minFrequency?: number;  // Minimum usage count
  maxFrequency?: number;  // Maximum usage count
  minRecency?: number;  // Minimum days since last use
  maxRecency?: number;  // Maximum days since last use
  state?: string;  // learning, active, inactive, archived
  tags?: string[];  // Filter by tags (AND)
  sortBy?: 'confidence' | 'frequency' | 'recency' | 'success' | 'name';
  sortOrder?: 'asc' | 'desc';
  limit?: number;  // Max results
  offset?: number;  // For pagination
}

/**
 * Search result with metadata.
 */
export interface HabitSearchResult {
  habit: Habit;
  score: number;  // Relevance score (0..1)
  matchedFields?: string[];  // Which fields matched the query
  rank: number;  // Position in results
}

/**
 * Habit archival record for recovery.
 */
export interface ArchivedHabit {
  habit: Habit;
  archivedAt: number;
  reason?: string;
  archivedBy?: string;
}

/**
 * Calculates text similarity using Levenshtein distance.
 * Returns score 0..1 where 1 is perfect match.
 */
function textSimilarity(text1: string, text2: string): number {
  const s1 = text1.toLowerCase();
  const s2 = text2.toLowerCase();

  if (s1 === s2) return 1;
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;

  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1;

  // Simple Levenshtein-based similarity
  let distance = 0;
  const shorter = s1.length < s2.length ? s1 : s2;
  const longer = s1.length < s2.length ? s2 : s1;

  for (let i = 0; i < shorter.length; i++) {
    if (shorter[i] !== longer[i]) distance++;
  }
  distance += longer.length - shorter.length;

  return 1 - distance / maxLen;
}

/**
 * Searches habits by text query.
 * Searches target, description, and tags.
 * 
 * @param habits - Habits to search
 * @param query - Search query
 * @param minScore - Minimum relevance score (0..1)
 * @returns Matching habits with scores
 */
export function searchHabits(
  habits: Habit[],
  query: string,
  minScore: number = 0.3
): HabitSearchResult[] {
  if (!query || query.length === 0) return [];

  const results: HabitSearchResult[] = [];

  habits.forEach((habit) => {
    let score = 0;
    const matchedFields: string[] = [];

    // Search target
    const targetScore = textSimilarity(habit.target, query);
    if (targetScore > minScore) {
      score = Math.max(score, targetScore * 1.0);  // Target weighted heavily
      matchedFields.push(`target:${targetScore.toFixed(2)}`);
    }

    // Search description
    const descScore = textSimilarity(habit.description, query);
    if (descScore > minScore) {
      score = Math.max(score, descScore * 0.8);
      matchedFields.push(`description:${descScore.toFixed(2)}`);
    }

    if (score > minScore) {
      results.push({
        habit,
        score: Math.min(1, score),
        matchedFields,
        rank: -1,  // Will be set after sorting
      });
    }
  });

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  // Set rank
  results.forEach((r, i) => {
    r.rank = i + 1;
  });

  return results;
}

/**
 * Filters habits by various criteria.
 * 
 * @param habits - Habits to filter
 * @param filter - Filter criteria
 * @returns Filtered habits
 */
export function filterHabits(habits: Habit[], filter: HabitSearchFilter): Habit[] {
  let filtered = [...habits];

  // Filter by success rate
  if (filter.minSuccessRate !== undefined) {
    filtered = filtered.filter((h) => h.successRate >= filter.minSuccessRate!);
  }
  if (filter.maxSuccessRate !== undefined) {
    filtered = filtered.filter((h) => h.successRate <= filter.maxSuccessRate!);
  }

  // Filter by frequency
  if (filter.minFrequency !== undefined) {
    filtered = filtered.filter((h) => h.totalAttempts >= filter.minFrequency!);
  }
  if (filter.maxFrequency !== undefined) {
    filtered = filtered.filter((h) => h.totalAttempts <= filter.maxFrequency!);
  }

  // Filter by recency
  const now = Date.now();
  if (filter.minRecency !== undefined) {
    const minMs = filter.minRecency * 24 * 60 * 60 * 1000;
    filtered = filtered.filter((h) => now - h.lastUsed >= minMs);
  }
  if (filter.maxRecency !== undefined) {
    const maxMs = filter.maxRecency * 24 * 60 * 60 * 1000;
    filtered = filtered.filter((h) => now - h.lastUsed <= maxMs);
  }

  // Filter by state
  if (filter.state) {
    filtered = filtered.filter((h) => h.state === filter.state);
  }

  return filtered;
}

/**
 * Sorts habits by specified criteria.
 * 
 * @param habits - Habits to sort
 * @param sortBy - Sort field
 * @param order - Sort order
 * @returns Sorted habits
 */
export function sortHabits(
  habits: Habit[],
  sortBy: 'confidence' | 'frequency' | 'recency' | 'success' | 'name' = 'confidence',
  order: 'asc' | 'desc' = 'desc'
): Habit[] {
  const sorted = [...habits];

  sorted.sort((a, b) => {
    let cmp = 0;

    switch (sortBy) {
      case 'confidence':
        cmp = a.feedbackScore - b.feedbackScore;
        break;
      case 'frequency':
        cmp = a.totalAttempts - b.totalAttempts;
        break;
      case 'recency':
        cmp = a.lastUsed - b.lastUsed;
        break;
      case 'success':
        cmp = a.successRate - b.successRate;
        break;
      case 'name':
        cmp = a.target.localeCompare(b.target);
        break;
    }

    return order === 'asc' ? cmp : -cmp;
  });

  return sorted;
}

/**
 * Discovers habits related to a given habit.
 * Finds similar habits by target and success rate.
 * 
 * @param habit - Reference habit
 * @param habits - All habits
 * @param limit - Max results
 * @returns Related habits
 */
export function discoverRelatedHabits(habit: Habit, habits: Habit[], limit: number = 5): Habit[] {
  const related: Array<{ h: Habit; score: number }> = [];

  habits.forEach((candidate) => {
    if (candidate.id === habit.id) return;

    let score = 0;

    // Target similarity
    const targetSim = textSimilarity(habit.target, candidate.target);
    score += targetSim * 0.5;

    // Success rate similarity
    const successDiff = Math.abs(habit.successRate - candidate.successRate);
    score += (1 - successDiff) * 0.3;

    // Conditions similarity
    if (habit.conditions.length === candidate.conditions.length) {
      score += 0.2;
    }

    related.push({ h: candidate, score });
  });

  // Sort by score and return top N
  return related
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.h);
}

/**
 * Groups habits by context or target category.
 * 
 * @param habits - Habits to group
 * @param groupBy - Grouping criteria: 'context' | 'state' | 'success-rate'
 * @returns Grouped habits
 */
export function groupHabits(
  habits: Habit[],
  groupBy: 'context' | 'state' | 'success-rate' = 'state'
): Map<string, Habit[]> {
  const groups = new Map<string, Habit[]>();

  habits.forEach((habit) => {
    let key: string;

    switch (groupBy) {
      case 'state':
        key = habit.state;
        break;
      case 'context':
        key = habit.conditions[0]?.context || 'no-context';
        break;
      case 'success-rate':
        if (habit.successRate >= 0.8) key = '80-100%';
        else if (habit.successRate >= 0.6) key = '60-80%';
        else if (habit.successRate >= 0.4) key = '40-60%';
        else key = '<40%';
        break;
    }

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(habit);
  });

  return groups;
}

/**
 * Comprehensive habit discovery engine.
 */
export class HabitDiscoveryEngine {
  private habits: Habit[] = [];
  private archive: Map<HabitId, ArchivedHabit> = new Map();

  /**
   * Indexes habits for discovery.
   * 
   * @param habits - Habits to index
   */
  public indexHabits(habits: Habit[]): void {
    this.habits = [...habits];
  }

  /**
   * Executes complex search with multiple criteria.
   * 
   * @param filter - Search filter with query and criteria
   * @returns Ranked search results
   */
  public search(filter: HabitSearchFilter): HabitSearchResult[] {
    let results: HabitSearchResult[] = [];

    // Step 1: Text search if query provided
    if (filter.query) {
      results = searchHabits(this.habits, filter.query, 0.3);
    } else {
      results = this.habits.map((h, i) => ({
        habit: h,
        score: 1.0,
        rank: i + 1,
      }));
    }

    // Step 2: Apply filters to search results
    const habits = results.map((r) => r.habit);
    const filtered = filterHabits(habits, filter);

    // Re-create results with filtered set
    results = results.filter((r) => filtered.includes(r.habit));

    // Step 3: Sort
    const sortBy = filter.sortBy || 'confidence';
    const order = filter.sortOrder || 'desc';
    const sorted = sortHabits(filtered, sortBy as any, order);
    results = results.filter((r) => sorted.includes(r.habit));
    results = results.sort((a, b) => {
      const aIdx = sorted.indexOf(a.habit);
      const bIdx = sorted.indexOf(b.habit);
      return aIdx - bIdx;
    });

    // Step 4: Paginate
    const offset = filter.offset || 0;
    const limit = filter.limit || 50;
    return results.slice(offset, offset + limit);
  }

  /**
   * Discovers habits similar to target.
   * 
   * @param habitId - Reference habit ID
   * @param limit - Max results
   * @returns Related habits
   */
  public discoverRelated(habitId: HabitId, limit: number = 5): Habit[] {
    const habit = this.habits.find((h) => h.id === habitId);
    if (!habit) return [];
    return discoverRelatedHabits(habit, this.habits, limit);
  }

  /**
   * Archives a habit.
   * 
   * @param habitId - Habit to archive
   * @param reason - Why it was archived
   * @param userId - User who archived
   */
  public archiveHabit(habitId: HabitId, reason?: string, userId?: string): boolean {
    const habit = this.habits.find((h) => h.id === habitId);
    if (!habit) return false;

    this.archive.set(habitId, {
      habit,
      archivedAt: Date.now(),
      reason,
      archivedBy: userId,
    });

    // Remove from active habits
    this.habits = this.habits.filter((h) => h.id !== habitId);
    return true;
  }

  /**
   * Recovers an archived habit.
   * 
   * @param habitId - Habit to recover
   * @returns Recovered habit or undefined
   */
  public recoverHabit(habitId: HabitId): Habit | undefined {
    const archived = this.archive.get(habitId);
    if (!archived) return undefined;

    const habit = archived.habit;
    this.habits.push(habit);
    this.archive.delete(habitId);
    return habit;
  }

  /**
   * Gets archived habits.
   * 
   * @param limit - Max results
   * @returns Archived habits
   */
  public getArchived(limit: number = 50): ArchivedHabit[] {
    return Array.from(this.archive.values())
      .sort((a, b) => b.archivedAt - a.archivedAt)
      .slice(0, limit);
  }

  /**
   * Permanently deletes an archived habit.
   * 
   * @param habitId - Habit to delete
   * @returns True if deleted
   */
  public deleteArchived(habitId: HabitId): boolean {
    return this.archive.delete(habitId);
  }

  /**
   * Gets discovery statistics.
   * 
   * @returns Statistics object
   */
  public getStats(): Record<string, unknown> {
    const grouped = groupHabits(this.habits, 'state');
    const bySuccess = groupHabits(this.habits, 'success-rate');

    return {
      totalHabits: this.habits.length,
      archivedHabits: this.archive.size,
      byState: Object.fromEntries(
        Array.from(grouped.entries()).map(([k, v]) => [k, v.length])
      ),
      bySuccessRate: Object.fromEntries(
        Array.from(bySuccess.entries()).map(([k, v]) => [k, v.length])
      ),
      avgSuccessRate:
        this.habits.length > 0
          ? this.habits.reduce((sum, h) => sum + h.successRate, 0) / this.habits.length
          : 0,
    };
  }

  /**
   * Clears all habits and archive.
   */
  public clear(): void {
    this.habits = [];
    this.archive.clear();
  }
}
