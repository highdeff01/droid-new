/**
 * Habit Merging and Deduplication
 * Detects and merges similar habits, creating variants for context-specific variations.
 * Preserves execution history and statistics across merges.
 * 
 * Requirement: 13.5
 */

import { sequenceSimilarity } from './habit-extraction.js';
import type { Habit, HabitId } from './habit-extraction.js';

/**
 * Merge result with details about what was merged.
 */
export interface MergeResult {
  mergedHabit: Habit;
  sourceHabits: HabitId[];
  similarity: number;
  variantsCreated: number;
  statisticsAggregated: boolean;
}

/**
 * Detects duplicate or near-duplicate habits.
 * 
 * @param habits - Habits to analyze
 * @param threshold - Minimum similarity to consider duplicates (0..1)
 * @returns Array of duplicate groups
 */
export function detectDuplicates(
  habits: Habit[],
  threshold: number = 0.85
): Array<{
  group: Habit[];
  similarity: number;
  recommended_action: 'merge' | 'variant' | 'keep_separate';
}> {
  const groups: Array<{
    group: Habit[];
    similarity: number;
    recommended_action: 'merge' | 'variant' | 'keep_separate';
  }> = [];

  const processed = new Set<HabitId>();

  habits.forEach((habit1, idx1) => {
    if (processed.has(habit1.id)) return;

    const group = [habit1];
    let avgSimilarity = 1.0;

    habits.forEach((habit2, idx2) => {
      if (idx1 >= idx2 || processed.has(habit2.id)) return;

      const similarity = sequenceSimilarity(habit1.actionSequence, habit2.actionSequence);

      if (similarity >= threshold) {
        group.push(habit2);
        processed.add(habit2.id);
        avgSimilarity = (avgSimilarity + similarity) / 2;
      }
    });

    if (group.length > 1) {
      // Determine recommended action
      let action: 'merge' | 'variant' | 'keep_separate' = 'keep_separate';
      if (avgSimilarity >= 0.95) {
        action = 'merge';  // Very similar, should merge
      } else if (avgSimilarity >= 0.8) {
        action = 'variant';  // Similar but distinct, create variants
      }

      groups.push({
        group,
        similarity: avgSimilarity,
        recommended_action: action,
      });
    }

    processed.add(habit1.id);
  });

  return groups;
}

/**
 * Merges duplicate habits while preserving all data.
 * Creates the primary habit and adds others as variants.
 * Aggregates all statistics.
 * 
 * @param habitGroup - Group of similar habits to merge
 * @param keepPrimary - Which habit to use as primary (by ID)
 * @returns Merge result
 */
export function mergeHabitGroup(
  habitGroup: Habit[],
  keepPrimary?: HabitId
): MergeResult {
  if (habitGroup.length === 0) {
    throw new Error('Cannot merge empty habit group');
  }

  if (habitGroup.length === 1) {
    return {
      mergedHabit: habitGroup[0],
      sourceHabits: [habitGroup[0].id],
      similarity: 1.0,
      variantsCreated: 0,
      statisticsAggregated: false,
    };
  }

  // Select primary habit
  let primaryHabit: Habit;
  if (keepPrimary) {
    const found = habitGroup.find((h) => h.id === keepPrimary);
    if (!found) {
      throw new Error(`Primary habit ${keepPrimary} not in group`);
    }
    primaryHabit = found;
  } else {
    // Use habit with highest confidence as primary
    primaryHabit = habitGroup.reduce((best, h) => 
      (h.feedbackScore > best.feedbackScore) ? h : best
    );
  }

  // Aggregate statistics
  let totalSuccessCount = 0;
  let totalAttempts = 0;
  let totalSuggestions = 0;
  let totalAccepted = 0;
  let totalDismissed = 0;
  let totalCorrected = 0;
  let latestUsed = primaryHabit.lastUsed;

  habitGroup.forEach((habit) => {
    totalSuccessCount += habit.successCount;
    totalAttempts += habit.totalAttempts;
    totalSuggestions += habit.timesSuggested;
    totalAccepted += habit.timesAccepted;
    totalDismissed += habit.timesDismissed;
    totalCorrected += habit.timesCorrectRd;
    latestUsed = Math.max(latestUsed, habit.lastUsed);
  });

  // Calculate merged statistics
  const mergedSuccessRate = totalAttempts > 0 ? totalSuccessCount / totalAttempts : 0;

  // Create variants for non-primary habits
  const variants = habitGroup
    .filter((h) => h.id !== primaryHabit.id)
    .map((h) => ({
      id: h.id,
      name: h.target,
      actionSequence: h.actionSequence,
      conditions: h.conditions,
      successRate: h.successRate,
      usageCount: h.totalAttempts,
    }));

  // Build merged habit
  const mergedHabit: Habit = {
    ...primaryHabit,
    target: `${primaryHabit.target} (Merged)`,
    successCount: totalSuccessCount,
    totalAttempts: totalAttempts,
    successRate: mergedSuccessRate,
    timesSuggested: totalSuggestions,
    timesAccepted: totalAccepted,
    timesDismissed: totalDismissed,
    timesCorrectRd: totalCorrected,
    lastUsed: latestUsed,
    variants: [...primaryHabit.variants, ...variants],
    lessons: [
      ...primaryHabit.lessons,
      {
        kind: 'add',
        text: `Merged ${habitGroup.length} similar habits`,
        learned: Date.now(),
      },
    ],
  };

  return {
    mergedHabit,
    sourceHabits: habitGroup.map((h) => h.id),
    similarity: habitGroup.length > 1
      ? habitGroup.reduce((sum, h1) => 
          sum + habitGroup.reduce((s, h2) => 
            s + (h1.id !== h2.id ? sequenceSimilarity(h1.actionSequence, h2.actionSequence) : 0), 0
          ), 0) / (habitGroup.length * (habitGroup.length - 1))
      : 1.0,
    variantsCreated: variants.length,
    statisticsAggregated: true,
  };
}

/**
 * Batch deduplication across all habits.
 * Automatically detects and merges duplicates.
 * 
 * @param habits - All habits
 * @param threshold - Similarity threshold for merging (0..1)
 * @returns Deduplicated habit list and merge summary
 */
export function deduplicateHabits(
  habits: Habit[],
  threshold: number = 0.85
): {
  deduplicated: Habit[];
  mergesSummary: {
    totalHabits: number;
    mergedGroups: number;
    habitsRemoved: number;
    habitsMerged: number;
  };
} {
  const duplicateGroups = detectDuplicates(habits, threshold);

  const deduplicated: Habit[] = [];
  const processedIds = new Set<HabitId>();
  let mergedCount = 0;
  let removedCount = 0;

  // Handle merged groups
  duplicateGroups.forEach((group) => {
    if (group.recommended_action === 'merge') {
      const result = mergeHabitGroup(group.group);
      deduplicated.push(result.mergedHabit);
      group.group.forEach((h) => processedIds.add(h.id));
      mergedCount += group.group.length;
      removedCount += group.group.length - 1;
    }
  });

  // Add non-duplicate habits
  habits.forEach((habit) => {
    if (!processedIds.has(habit.id)) {
      deduplicated.push(habit);
    }
  });

  return {
    deduplicated,
    mergesSummary: {
      totalHabits: habits.length,
      mergedGroups: duplicateGroups.filter((g) => g.recommended_action === 'merge').length,
      habitsRemoved: removedCount,
      habitsMerged: mergedCount,
    },
  };
}

/**
 * Creates a variant of an existing habit for specific context.
 * 
 * @param parentHabit - Parent habit to create variant from
 * @param variantName - Name for the variant
 * @param conditions - Specific conditions for this variant
 * @returns New variant habit
 */
export function createHabitVariant(
  parentHabit: Habit,
  variantName: string,
  conditions: any[]
): Habit {
  const newId = `${parentHabit.id}-variant-${Date.now()}` as any;

  return {
    ...parentHabit,
    id: newId,
    target: variantName,
    conditions,
    description: `Variant: ${variantName}`,
    successCount: 0,
    totalAttempts: 0,
    successRate: 0.5,
    timesSuggested: 0,
    timesAccepted: 0,
    timesDismissed: 0,
    timesCorrectRd: 0,
    firstSeen: Date.now(),
    lastUsed: Date.now(),
    state: 'learning',
    lessons: [],
  };
}

/**
 * Finds the best match for a given habit from a list.
 * Useful for fuzzy matching and deduplication detection.
 * 
 * @param searchHabit - Habit to find match for
 * @param candidates - Candidate habits to search
 * @param minSimilarity - Minimum similarity threshold (0..1)
 * @returns Best matching habit or undefined
 */
export function findBestMatch(
  searchHabit: Habit,
  candidates: Habit[],
  minSimilarity: number = 0.75
): Habit | undefined {
  let bestMatch: Habit | undefined;
  let bestScore = minSimilarity;

  candidates.forEach((candidate) => {
    if (candidate.id === searchHabit.id) return;

    const similarity = sequenceSimilarity(searchHabit.actionSequence, candidate.actionSequence);

    if (similarity > bestScore) {
      bestScore = similarity;
      bestMatch = candidate;
    }
  });

  return bestMatch;
}

/**
 * Generates a deduplication report.
 * Shows what would be merged and why.
 * 
 * @param duplicates - Detected duplicates
 * @returns Human-readable report
 */
export function generateDeduplicationReport(
  duplicates: Array<{
    group: Habit[];
    similarity: number;
    recommended_action: 'merge' | 'variant' | 'keep_separate';
  }>
): string {
  const lines: string[] = [
    'Habit Deduplication Report',
    `Total duplicate groups found: ${duplicates.length}`,
    '',
  ];

  let toMerge = 0;
  let toVariant = 0;
  let toKeep = 0;

  duplicates.forEach((group, idx) => {
    lines.push(`Group ${idx + 1}:`);
    lines.push(`  Similarity: ${(group.similarity * 100).toFixed(0)}%`);
    lines.push(`  Habits: ${group.group.length}`);
    lines.push(`  Action: ${group.recommended_action}`);

    group.group.forEach((h) => {
      lines.push(`    - ${h.target} (success: ${(h.successRate * 100).toFixed(0)}%, used: ${h.totalAttempts}x)`);
    });

    lines.push('');

    if (group.recommended_action === 'merge') toMerge += group.group.length;
    else if (group.recommended_action === 'variant') toVariant += group.group.length;
    else toKeep += group.group.length;
  });

  lines.push('Summary:');
  lines.push(`  Habits to merge: ${toMerge}`);
  lines.push(`  Habits to create variants from: ${toVariant}`);
  lines.push(`  Habits to keep separate: ${toKeep}`);

  return lines.join('\n');
}
