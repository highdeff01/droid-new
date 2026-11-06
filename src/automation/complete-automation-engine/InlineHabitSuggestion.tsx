/**
 * Inline Habit Suggestion Component (React 19)
 *
 * Displays context-aware habit suggestions in a minimal UI footprint.
 * Shows when matching context detected, with confidence indicators.
 * Uses React 19 features: ref as prop, no React import needed.
 *
 * Features:
 * - Inline display with minimal UI footprint
 * - Confidence score visualization
 * - Context matching indicators
 * - One-click habit activation
 * - Accessibility support (ARIA labels, keyboard navigation)
 */

import { useEffectEvent, useMemo } from 'react';

import type { Habit } from './habit-types';
import type { ExecutionContext } from './integration-types';

import { IgcChipComponent, IgcButtonComponent, IgcIconComponent } from 'igniteui-react';

/**
 * Inline habit suggestion props
 */
export interface InlineHabitSuggestionProps {
  /** Habit to suggest */
  habit: Habit;
  
  /** Current execution context for matching */
  context?: ExecutionContext;
  
  /** Whether suggestion is active/matched */
  isMatched?: boolean;
  
  /** Optional handler when suggestion is accepted */
  onAccept?: (habit: Habit) => void;
  
  /** Optional handler when suggestion is dismissed */
  onDismiss?: (habit: Habit) => void;
  
  /** Optional handler when suggestion is executed */
  onExecute?: (habit: Habit) => void;
  
  /** Optional confidence threshold for display (default: 50) */
  minConfidence?: number;
  
  /** Optional compact mode for constrained UI */
  compact?: boolean;
}

/**
 * Icon component wrapper for igniteui-react
 */
const Icon = IgcIconComponent;
const Chip = IgcChipComponent;
const Button = IgcButtonComponent;

/**
 * InlineHabitSuggestion - Inline habit suggestion component
 *
 * Displays habit suggestions in minimal UI footprint when context matches.
 * Shows confidence score and context match indicators.
 *
 * @param props - InlineHabitSuggestionProps
 * @returns Inline habit suggestion component
 */
export function InlineHabitSuggestion({
  habit,
  context,
  isMatched = true,
  onAccept,
  onDismiss,
  onExecute,
  minConfidence = 50,
  compact = false,
}: InlineHabitSuggestionProps): React.ReactNode {
  const confidence = useMemo(() => {
    return habit.confidence.overall;
  }, [habit.confidence]);

  // Check if confidence meets threshold
  const isEligible = confidence >= minConfidence;

  // Extract context match info
  const matchedConditions = useMemo(() => {
    if (!context || !habit.primaryPattern.context) {
      return [];
    }

    const matches: string[] = [];

    // Check URL pattern
    if (habit.primaryPattern.context.url && context.currentUrl) {
      try {
        const pattern = new RegExp(habit.primaryPattern.context.url);
        if (pattern.test(context.currentUrl)) {
          matches.push('url');
        }
      } catch (e) {
        // Invalid regex, skip
      }
    }

    // Check window title
    if (habit.primaryPattern.context.title && context.applicationName) {
      try {
        const pattern = new RegExp(habit.primaryPattern.context.title);
        if (pattern.test(context.applicationName)) {
          matches.push('title');
        }
      } catch (e) {
        // Invalid regex, skip
      }
    }

    return matches;
  }, [context, habit.primaryPattern.context]);

  const hasContextMatch = isMatched && matchedConditions.length > 0;
  const isLowConfidence = confidence < minConfidence;

  // Handle accept
  const handleAccept = useEffectEvent(() => {
    onAccept?.(habit);
  });

  // Handle dismiss
  const handleDismiss = useEffectEvent(() => {
    onDismiss?.(habit);
  });

  // Handle execute
  const handleExecute = useEffectEvent(() => {
    onExecute?.(habit);
  });

  // Keyboard navigation handler
  const handleKeyDown = useEffectEvent((event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleExecute();
    } else if (event.key === 'Escape') {
      handleDismiss();
    }
  });

  if (!isEligible) {
    return null;
  }

  if (compact) {
    // Compact version for constrained UI
    return (
      <Chip
        className="inline-habit-suggestion compact"
        variant="filled"
        aria-label={`Habit suggestion: ${habit.name} with ${confidence}% confidence`}
        onClick={handleExecute}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <Icon name="auto_awesome" slot="icon-start" size="small" />
        <span className="habit-suggestion-name">{habit.name}</span>
        <span 
          className="habit-suggestion-confidence" 
          aria-label={`${confidence}% confidence`}
          style={{
            backgroundColor: getConfidenceColor(confidence),
          }}
        >
          {confidence}%
        </span>
        {hasContextMatch && (
          <span 
            className="habit-suggestion-match-indicator" 
            aria-label="Context matched"
            style={{ visibility: 'visible' }}
          >
            <Icon name="check_circle" size="x-small" />
          </span>
        )}
      </Chip>
    );
  }

  // Standard version with expandable details
  return (
    <div
      className="inline-habit-suggestion"
      role="alert"
      aria-live="polite"
      aria-label={`Suggested habit: ${habit.name}`}
      onKeyDown={handleKeyDown}
    >
      <div className="habit-suggestion-card">
        <div className="habit-suggestion-header">
          <Icon name="auto_awesome" slot="icon-start" />
          <h3 className="habit-suggestion-title">{habit.name}</h3>
        </div>
        
        {habit.description && (
          <p className="habit-suggestion-description">{habit.description}</p>
        )}
        
        <div className="habit-suggestion-meta">
          {/* Confidence Score */}
          <div 
            className="habit-suggestion-confidence"
            style={{
              backgroundColor: getConfidenceColor(confidence),
            }}
          >
            <span className="confidence-label">Confidence:</span>
            <span className="confidence-value">{confidence}%</span>
          </div>

          {/* Context Match Indicators */}
          {hasContextMatch && (
            <div 
              className="habit-suggestion-context-match"
              aria-label="Context matches detected"
            >
              <Icon name="target" size="x-small" />
              <span className="context-match-label">
                Context match: {matchedConditions.join(', ')}
              </span>
            </div>
          )}

          {/* Low Confidence Warning */}
          {isLowConfidence && (
            <div 
              className="habit-suggestion-warning"
              role="warning"
              aria-label="Low confidence warning"
            >
              <Icon name="warning" size="x-small" />
              <span className="warning-label">
                Low confidence: May not be accurate
              </span>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="habit-suggestion-actions" role="group">
          <Button
            variant="filled"
            onClick={handleExecute}
            aria-label={`Execute habit: ${habit.name}`}
          >
            <Icon name="play_arrow" slot="icon-start" />
            Execute
          </Button>

          <Button
            variant="flat"
            onClick={handleAccept}
            aria-label={`Accept suggestion: ${habit.name}`}
            title="Accept this habit suggestion"
          >
            <Icon name="thumb_up" slot="icon-start" />
            Accept
          </Button>

          <Button
            variant="flat"
            onClick={handleDismiss}
            aria-label={`Dismiss suggestion: ${habit.name}`}
            title="Dismiss this habit suggestion"
          >
            <Icon name="thumb_down" slot="icon-start" />
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * getConfidenceColor - Get confidence color based on score
 *
 * @param confidence - Confidence score (0..100)
 * @returns CSS color string
 */
function getConfidenceColor(confidence: number): string {
  if (confidence >= 80) {
    return 'var(--ig-success-500)';
  } else if (confidence >= 50) {
    return 'var(--ig-warning-500)';
  } else {
    return 'var(--ig-error-500)';
  }
}

/**
 * InlineHabitSuggestionList - List of inline habit suggestions
 *
 * @param props - Habit list with optional context
 * @returns List of inline habit suggestions
 */
export function InlineHabitSuggestionList({
  habits,
  context,
  onAccept,
  onDismiss,
  onExecute,
  minConfidence = 50,
  compact = false,
}: {
  habits: Habit[];
  context?: ExecutionContext;
  onAccept?: (habit: Habit) => void;
  onDismiss?: (habit: Habit) => void;
  onExecute?: (habit: Habit) => void;
  minConfidence?: number;
  compact?: boolean;
}): React.ReactNode {
  const filteredHabits = useMemo(() => {
    return habits.filter(habit => habit.confidence.overall >= minConfidence);
  }, [habits, minConfidence]);

  if (filteredHabits.length === 0) {
    return (
      <div className="inline-habit-suggestion-list empty" aria-label="No habit suggestions">
        <p className="suggestion-list-empty-message">
          No habit suggestions for current context
        </p>
      </div>
    );
  }

  return (
    <div className="inline-habit-suggestion-list" role="list" aria-label="Habit suggestions">
      {filteredHabits.map((habit, index) => (
        <div key={habit.id} role="listitem">
          <InlineHabitSuggestion
            habit={habit}
            context={context}
            onAccept={onAccept}
            onDismiss={onDismiss}
            onExecute={onExecute}
            minConfidence={minConfidence}
            compact={compact}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * InlineHabitSuggestionSkeleton - Loading state for inline habit suggestions
 *
 * @returns Loading skeleton component
 */
export function InlineHabitSuggestionSkeleton(): React.ReactNode {
  return (
    <div className="inline-habit-suggestion loading" aria-busy="true" aria-label="Loading habit suggestions">
      <div className="habit-suggestion-card skeleton">
        <div className="habit-suggestion-header skeleton-header">
          <div className="skeleton-icon" />
          <div className="skeleton-title" />
        </div>
        <div className="skeleton-description" />
        <div className="skeleton-meta">
          <div className="skeleton-confidence" />
        </div>
        <div className="skeleton-actions">
          <div className="skeleton-button" />
          <div className="skeleton-button" />
        </div>
      </div>
    </div>
  );
}

// Styles for inline habit suggestions
/*
.inline-habit-suggestion {
  margin: 0.5rem 0;
  animation: fadeIn 0.3s ease-in-out;
}

.inline-habit-suggestion.compact {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
}

.habit-suggestion-card {
  background: var(--ig-surface);
  border-radius: 0.5rem;
  padding: 1rem;
  border: 1px solid var(--ig-border-subtle);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.habit-suggestion-card.skeleton {
  background: var(--ig-surface-50);
}

.habit-suggestion-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.habit-suggestion-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.habit-suggestion-description {
  margin: 0.5rem 0;
  color: var(--ig-text-subtle);
  font-size: 0.875rem;
}

.habit-suggestion-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0.75rem 0;
}

.habit-suggestion-confidence {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.875rem;
  font-weight: 500;
  color: white;
}

.habit-suggestion-context-match,
.habit-suggestion-warning {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
}

.habit-suggestion-context-match {
  background: var(--ig-success-50);
  color: var(--ig-success-700);
}

.habit-suggestion-warning {
  background: var(--ig-warning-50);
  color: var(--ig-warning-700);
}

.habit-suggestion-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.habit-suggestion-actions :first-child {
  flex: 1;
}

.habit-suggestion-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.habit-suggestion-list.empty {
  padding: 1rem;
  text-align: center;
  color: var(--ig-text-subtle);
}

.skeleton {
  animation: pulse 1.5s infinite;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}
*/