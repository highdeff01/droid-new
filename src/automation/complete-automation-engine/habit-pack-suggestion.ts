/**
 * Habit→Pack Suggestion Integration Module
 *
 * Provides integration between Habit and Pack systems:
 * - Suggests relevant packs when habits match current context
 * - Shows which habits drove pack suggestions
 * - Supports one-click deployment of suggested packs
 * - Tracks suggestion sources in execution logs
 *
 * Integration Points:
 * - Uses EventDispatcher to emit pack suggestion events
 * - Matches habits against current context to find relevant packs
 * - Tracks suggestion lineage for audit trail
 * - Supports deployment of suggested packs with context
 *
 * Architecture:
 * - Context matching: compare current context against habit conditions
 * - Pack matching: find packs that contain workflows matching habit patterns
 * - Suggestion generation: create pack suggestions with confidence scores
 * - One-click deployment: initiate pack deployment with suggestion context
 * - Source tracking: record which habits drove each pack suggestion
 */

import type { EventDispatcher } from './event-dispatcher';
import type { Pack, PackMetadata, PackDependency } from './pack-types';
import type { Habit, HabitPattern, HabitCondition, ConfidenceScores } from './habit-types';
import type { 
  ExecutionContext, 
  EntityId, 
  Timestamp, 
  createEntityId, 
  createTimestamp,
  createLineageRecord,
  LineageRecord,
  createExecutionContext
} from './integration-types';
import type { SystemEvent, HabitSuggestedEvent, PackDeploymentStartedEvent } from './integration-types';

/**
 * Pack suggestion with source tracking.
 * Shows which habits led to the pack suggestion.
 */
export interface PackSuggestion {
  /** Unique identifier for this suggestion */
  id: EntityId;

  /** Pack being suggested */
  pack: Pack;

  /** Source habits that triggered this suggestion */
  sourceHabits: Array<{
    habitId: string;
    confidence: number;
    matchedConditions: string[];
  }>;

  /** Confidence score for this suggestion (0..100) */
  confidenceScore: number;

  /** ISO 8601 timestamp when suggestion was created */
  timestamp: Timestamp;

  /** Explanation for why this pack was suggested */
  explanation?: string;

  /** Context that matched, if any */
  matchedContext?: string;
}

/**
 * Result of matching a habit to a pack.
 */
export interface HabitPackMatch {
  /** Whether the habit matches the pack */
  match: boolean;

  /** Strength of match (0..100) */
  matchScore: number;

  /** Which conditions matched */
  matchedConditions: string[];

  /** Which pack workflows matched */
  matchedWorkflows: string[];
}

/**
 * Deployment suggestion result.
 * Combines pack suggestion with deployment capabilities.
 */
export interface DeploymentSuggestion {
  /** Pack suggestion */
  packSuggestion: PackSuggestion;

  /** Whether pack can be deployed with current context */
  deployable: boolean;

  /** Reasons why pack cannot be deployed (if not deployable) */
  deploymentErrors?: string[];

  /** Suggested deployment action */
  action: 'deploy' | 'prompt-user' | 'show-info';
}

/**
 * Suggestion source record.
 * Tracks which habits drove a pack deployment.
 */
export interface SuggestionSourceRecord {
  /** ID of the pack suggestion */
  suggestionId: EntityId;

  /** ID of the pack that was deployed */
  packId: string;

  /** Array of habit IDs that triggered this suggestion */
  sourceHabitIds: string[];

  /** Timestamp when suggestion was made */
  suggestionTimestamp: Timestamp;

  /** Timestamp when pack was deployed */
  deploymentTimestamp?: Timestamp;

  /** Whether deployment succeeded */
  deploymentSuccess?: boolean;
}

/**
 * Habit→Pack suggestion processor.
 * Matches habits to packs and generates suggestions.
 */
export class HabitPackSuggestionProcessor {
  private readonly eventDispatcher: EventDispatcher;
  private readonly suggestionHistory: Map<EntityId, PackSuggestion> = new Map();
  private readonly suggestionSources: Map<EntityId, SuggestionSourceRecord> = new Map();

  /**
   * Creates a new habit-pack suggestion processor.
   *
   * @param eventDispatcher - Event dispatcher for emitting suggestion events
   */
  constructor(eventDispatcher: EventDispatcher) {
    this.eventDispatcher = eventDispatcher;
  }

  /**
   * Suggests relevant packs based on current context and available habits.
   *
   * This is the main entry point for the suggestion system:
   * 1. Matches habits against current context
   * 2. Finds packs containing workflows matching those habits
   * 3. Generates pack suggestions with confidence scores
   * 4. Tracks suggestion sources for audit trail
   *
   * @param currentContext - Current execution context
   * @param availableHabits - Array of habits to consider
   * @param availablePacks - Array of packs to consider
   * @returns Array of pack suggestions sorted by confidence
   */
  public suggestPacksForContext(
    currentContext: ExecutionContext,
    availableHabits: Habit[],
    availablePacks: Pack[]
  ): PackSuggestion[] {
    const suggestions: PackSuggestion[] = [];

    // For each habit, check if it matches current context
    for (const habit of availableHabits) {
      const matchResult = this.matchHabitToContext(habit, currentContext);

      if (matchResult.match) {
        // Find packs that contain workflows matching this habit pattern
        const matchingPacks = this.findMatchingPacks(habit, matchResult, availablePacks);

        for (const pack of matchingPacks) {
          const suggestion = this.generatePackSuggestion(
            pack,
            habit,
            matchResult.matchedConditions,
            currentContext
          );

          if (suggestion) {
            suggestions.push(suggestion);
          }
        }
      }
    }

    // Sort by confidence score (descending)
    suggestions.sort((a, b) => b.confidenceScore - a.confidenceScore);

    // Store suggestions in history
    for (const suggestion of suggestions) {
      this.suggestionHistory.set(suggestion.id, suggestion);
    }

    return suggestions;
  }

  /**
   * Matches a habit against current context.
   *
   * @param habit - Habit to match
   * @param context - Current execution context
   * @returns HabitPackMatch result
   */
  public matchHabitToContext(
    habit: Habit,
    context: ExecutionContext
  ): HabitPackMatch {
    const matchedConditions: string[] = [];
    let matchScore = 0;

    // Check pattern conditions
    if (habit.primaryPattern.context) {
      const { contextMatch, conditions } = this.checkContextMatch(
        habit.primaryPattern.context,
        context
      );

      if (contextMatch) {
        matchedConditions.push(...conditions);
        matchScore += 40; // Context matching is important
      }
    }

    // Check workflow reference if present
    if (habit.primaryPattern.workflowId) {
      // Would check if workflow exists and is accessible
      matchedConditions.push(`workflow-${habit.primaryPattern.workflowId}`);
      matchScore += 30; // Workflow reference is meaningful
    }

    // Check pack reference if present
    if (habit.primaryPattern.packId) {
      // Would check if pack exists and is accessible
      matchedConditions.push(`pack-${habit.primaryPattern.packId}`);
      matchScore += 30; // Pack reference is meaningful
    }

    // Apply frequency weighting
    if (habit.primaryPattern.frequency) {
      const frequencyWeights = {
        rare: 0.5,
        occasional: 0.7,
        frequent: 0.9,
        daily: 1.0,
      };

      const weight = frequencyWeights[habit.primaryPattern.frequency] || 1.0;
      matchScore *= weight;
    }

    // Check habit confidence
    matchScore += (habit.confidence.overall / 100) * 20;

    return {
      match: matchScore >= 50,
      matchScore: Math.min(100, matchScore),
      matchedConditions,
      matchedWorkflows: [],
    };
  }

  /**
   * Finds packs that contain workflows matching the given habit.
   *
   * @param habit - Habit to match
   * @param matchResult - Result of context matching
   * @param availablePacks - Available packs to search
   * @returns Array of matching packs
   */
  private findMatchingPacks(
    habit: Habit,
    matchResult: HabitPackMatch,
    availablePacks: Pack[]
  ): Pack[] {
    const matchingPacks: Pack[] = [];

    for (const pack of availablePacks) {
      let packMatchScore = 0;
      const packMatchedWorkflows: string[] = [];

      // Check if any workflows in pack match the habit
      for (const workflowRef of pack.manifest.workflows) {
        if (workflowRef.workflowId === habit.primaryPattern.workflowId) {
          packMatchScore += 50;
          packMatchedWorkflows.push(workflowRef.workflowId);
        }
      }

      // Check if pack tags match habit tags
      if (habit.tags) {
        for (const tag of habit.tags) {
          if (pack.metadata.tags?.includes(tag)) {
            packMatchScore += 20;
          }
        }
      }

      // Check if pack contains the habit's pack reference
      if (habit.primaryPattern.packId && pack.id === habit.primaryPattern.packId) {
        packMatchScore += 30;
        packMatchedWorkflows.push('entire-pack');
      }

      if (packMatchScore >= 50) {
        // Update match result with pack-specific information
        matchResult.matchScore = Math.max(matchResult.matchScore, packMatchScore);
        matchResult.matchedWorkflows = packMatchedWorkflows;

        matchingPacks.push(pack);
      }
    }

    return matchingPacks;
  }

  /**
   * Checks if current context matches habit pattern context.
   *
   * @param patternContext - Habit pattern context
   * @param currentContext - Current execution context
   * @returns Object with match result and matched conditions
   */
  private checkContextMatch(
    patternContext: HabitPattern['context'],
    currentContext: ExecutionContext
  ): { contextMatch: boolean; conditions: string[] } {
    const matchedConditions: string[] = [];

    // Check URL pattern
    if (patternContext.url && currentContext.currentUrl) {
      try {
        const urlPattern = new RegExp(patternContext.url);
        if (urlPattern.test(currentContext.currentUrl)) {
          matchedConditions.push(`url-match:${patternContext.url}`);
        }
      } catch (e) {
        // Invalid regex, skip this condition
      }
    }

    // Check window title pattern
    if (patternContext.title && currentContext.variables['windowTitle']) {
      try {
        const titlePattern = new RegExp(patternContext.title);
        if (titlePattern.test(currentContext.variables['windowTitle'] as string)) {
          matchedConditions.push(`title-match:${patternContext.title}`);
        }
      } catch (e) {
        // Invalid regex, skip this condition
      }
    }

    // Check environment variables
    if (patternContext.environment) {
      for (const [key, value] of Object.entries(patternContext.environment)) {
        if (currentContext.variables[key] === value) {
          matchedConditions.push(`env-match:${key}=${value}`);
        }
      }
    }

    return {
      contextMatch: matchedConditions.length > 0,
      conditions: matchedConditions,
    };
  }

  /**
   * Generates a pack suggestion from a matching habit.
   *
   * @param pack - Pack to suggest
   * @param habit - Habit that triggered the suggestion
   * @param matchedConditions - Conditions that matched
   * @param context - Current execution context
   * @returns PackSuggestion or undefined if generation fails
   */
  public generatePackSuggestion(
    pack: Pack,
    habit: Habit,
    matchedConditions: string[],
    context: ExecutionContext
  ): PackSuggestion | undefined {
    // Calculate suggestion confidence
    const confidenceScore = this.calculateSuggestionConfidence(habit, pack);

    const suggestionId = createEntityId(`suggestion-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);

    const suggestion: PackSuggestion = {
      id: suggestionId,
      pack,
      sourceHabits: [{
        habitId: habit.id,
        confidence: habit.confidence.overall,
        matchedConditions,
      }],
      confidenceScore,
      timestamp: createTimestamp(),
      explanation: this.generateExplanation(habit, pack, matchedConditions),
    };

    return suggestion;
  }

  /**
   * Calculates confidence score for a pack suggestion.
   *
   * Combines:
   - Habit confidence (50%)
   - Context match strength (30%)
   - Pack metadata quality (20%)
   *
   * @param habit - Habit that triggered suggestion
   * @param pack - Pack being suggested
   * @returns Confidence score (0..100)
   */
  private calculateSuggestionConfidence(habit: Habit, pack: Pack): number {
    // Habit confidence component (50%)
    const habitComponent = habit.confidence.overall * 0.5;

    // Context match component (30%) - assume good match if we're suggesting
    const contextComponent = 30;

    // Pack metadata quality component (20%)
    const metadataScore = this.calculatePackMetadataScore(pack);
    const metadataComponent = metadataScore * 0.2;

    return Math.min(100, habitComponent + contextComponent + metadataComponent);
  }

  /**
   * Calculates pack metadata quality score.
   *
   * Considers:
   * - Author reputation
   * - Rating
   * - Download count
   * - Version stability
   *
   * @param pack - Pack to evaluate
   * @returns Quality score (0..100)
   */
  private calculatePackMetadataScore(pack: Pack): number {
    let score = 50; // Base score

    // Rating boost (up to +20)
    if (pack.metadata.rating) {
      score += pack.metadata.rating * 4;
    }

    // Download count boost (up to +20)
    if (pack.metadata.downloadCount) {
      const downloadBoost = Math.min(20, Math.log10(pack.metadata.downloadCount + 1) * 5);
      score += downloadBoost;
    }

    // Version stability check
    if (pack.version.prerelease) {
      score -= 10;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Generates human-readable explanation for pack suggestion.
   *
   * @param habit - Habit that triggered suggestion
   * @param pack - Pack being suggested
   * @param matchedConditions - Conditions that matched
   * @returns Explanation string
   */
  private generateExplanation(
    habit: Habit,
    pack: Pack,
    matchedConditions: string[]
  ): string {
    const contextStr = matchedConditions.slice(0, 2).join(', ');

    return `Based on your habit "${habit.name}", we found "${pack.name}" which automates similar tasks. ` +
           `This matches your current context: ${contextStr || 'general usage'}.`;
  }

  /**
   * Deploys a suggested pack.
   *
   * Initiates pack deployment with suggestion context for tracking.
   *
   * @param packSuggestion - Pack suggestion to deploy
   * @param context - Current execution context
   * @returns Deployment result with suggestion tracking
   */
  public deploySuggestedPack(
    packSuggestion: PackSuggestion,
    context: ExecutionContext
  ): PackDeploymentStartedEvent {
    // Create deployment context with suggestion tracking
    const deploymentContext: ExecutionContext = {
      ...context,
      variables: {
        ...context.variables,
        suggestionId: packSuggestion.id,
        suggestionSource: 'habit-pack',
        sourceHabitIds: packSuggestion.sourceHabits.map(h => h.habitId),
      },
    };

    // Emit PackDeploymentStartedEvent with suggestion tracking
    const deploymentEvent: PackDeploymentStartedEvent = {
      type: 'PackDeploymentStarted',
      source: 'pack',
      timestamp: packSuggestion.timestamp,
      sourceId: packSuggestion.pack.id,
      packId: packSuggestion.pack.id,
      deploymentId: createEntityId(`deploy-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`),
      version: packSuggestion.pack.version.version,
      context: deploymentContext,
      workflowCount: packSuggestion.pack.manifest.workflows.length,
    };

    // Track suggestion source
    this.recordSuggestionSource(packSuggestion);

    // Emit event
    this.eventDispatcher.emit(deploymentEvent as SystemEvent);

    return deploymentEvent;
  }

  /**
   * Records suggestion source for audit trail.
   *
   * @param packSuggestion - Pack suggestion that was deployed
   */
  private recordSuggestionSource(packSuggestion: PackSuggestion): void {
    const suggestionSource: SuggestionSourceRecord = {
      suggestionId: packSuggestion.id,
      packId: packSuggestion.pack.id,
      sourceHabitIds: packSuggestion.sourceHabits.map(h => h.habitId),
      suggestionTimestamp: packSuggestion.timestamp,
    };

    this.suggestionSources.set(packSuggestion.id, suggestionSource);
  }

  /**
   * Gets suggestion sources for a pack deployment.
   *
   * @param packId - Pack identifier
   * @returns Array of suggestion sources
   */
  public getSuggestionSources(packId: string): SuggestionSourceRecord[] {
    return Array.from(this.suggestionSources.values())
      .filter(source => source.packId === packId);
  }

  /**
   * Gets suggestion source by suggestion ID.
   *
   * @param suggestionId - Suggestion identifier
   * @returns SuggestionSourceRecord or undefined
   */
  public getSuggestionSource(suggestionId: EntityId): SuggestionSourceRecord | undefined {
    return this.suggestionSources.get(suggestionId);
  }

  /**
   * Gets all pack suggestions from history.
   *
   * @returns Array of pack suggestions
   */
  public getAllSuggestions(): PackSuggestion[] {
    return Array.from(this.suggestionHistory.values());
  }

  /**
   * Gets suggestion history for a specific habit.
   *
   * @param habitId - Habit identifier
   * @returns Array of suggestions that included this habit
   */
  public getHabitSuggestions(habitId: string): PackSuggestion[] {
    return Array.from(this.suggestionHistory.values()).filter(suggestion =>
      suggestion.sourceHabits.some(h => h.habitId === habitId)
    );
  }
}

/**
 * Creates a new habit-pack suggestion processor.
 *
 * @param eventDispatcher - Event dispatcher for emitting suggestion events
 * @returns HabitPackSuggestionProcessor instance
 */
export function createHabitPackSuggestionProcessor(
  eventDispatcher: EventDispatcher
): HabitPackSuggestionProcessor {
  return new HabitPackSuggestionProcessor(eventDispatcher);
}

/**
 * Suggests relevant packs for a specific habit.
 *
 * Convenience function for single-habit suggestion.
 *
 * @param habit - Habit to find packs for
 * @param availablePacks - Available packs to search
 * @param context - Current execution context
 * @param processor - HabitPackSuggestionProcessor instance
 * @returns Array of pack suggestions
 */
export function suggestPacksForHabit(
  habit: Habit,
  availablePacks: Pack[],
  context: ExecutionContext,
  processor: HabitPackSuggestionProcessor
): PackSuggestion[] {
  const matchResult = processor.matchHabitToContext(habit, context);

  if (!matchResult.match) {
    return [];
  }

  const matchingPacks = processor.findMatchingPacks(habit, matchResult, availablePacks);

  return matchingPacks.map(pack =>
    processor.generatePackSuggestion(pack, habit, matchResult.matchedConditions, context)
  ).filter((s): s is PackSuggestion => s !== undefined);
}

/**
 * Matches a habit to a pack based on patterns and conditions.
 *
 * @param habit - Habit to match
 * @param pack - Pack to match against
 * @param context - Current execution context
 * @param processor - HabitPackSuggestionProcessor instance
 * @returns HabitPackMatch result
 */
export function matchHabitToPack(
  habit: Habit,
  pack: Pack,
  context: ExecutionContext,
  processor: HabitPackSuggestionProcessor
): HabitPackMatch {
  // First match against context
  const contextMatch = processor.matchHabitToContext(habit, context);

  if (!contextMatch.match) {
    return contextMatch;
  }

  // Then check pack-specific matching
  const matchingPacks = processor.findMatchingPacks(habit, contextMatch, [pack]);

  if (matchingPacks.length > 0) {
    return {
      match: true,
      matchScore: contextMatch.matchScore,
      matchedConditions: contextMatch.matchedConditions,
      matchedWorkflows: contextMatch.matchedWorkflows,
    };
  }

  return {
    match: false,
    matchScore: 0,
    matchedConditions: [],
    matchedWorkflows: [],
  };
}

/**
 * Deploys a suggested pack.
 *
 * Convenience function for one-click deployment.
 *
 * @param packSuggestion - Pack suggestion to deploy
 * @param context - Current execution context
 * @param processor - HabitPackSuggestionProcessor instance
 * @returns PackDeploymentStartedEvent
 */
export function deploySuggestedPack(
  packSuggestion: PackSuggestion,
  context: ExecutionContext,
  processor: HabitPackSuggestionProcessor
): PackDeploymentStartedEvent {
  return processor.deploySuggestedPack(packSuggestion, context);
}

/**
 * Tracks suggestion source for audit trail.
 *
 * @param packSuggestion - Pack suggestion that was deployed
 * @param success - Whether deployment succeeded
 * @param processor - HabitPackSuggestionProcessor instance
 */
export function trackSuggestionSource(
  packSuggestion: PackSuggestion,
  success: boolean,
  processor: HabitPackSuggestionProcessor
): void {
  const source = processor.getSuggestionSource(packSuggestion.id);

  if (source) {
    source.deploymentTimestamp = createTimestamp();
    source.deploymentSuccess = success;

    // Update in storage
    processor['suggestionSources'].set(packSuggestion.id, source);
  }
}
