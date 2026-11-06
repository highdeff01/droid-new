/**
 * Habit Suggestion Card Component
 *
 * Displays a suggested habit with all relevant information including:
 * - Habit name and description
 * - Confidence score with visual indicator
 * - Context requirements with status
 * - Accept/Dismiss buttons with feedback
 * - Keyboard navigation support
 * - Accessibility attributes
 *
 * Features:
 * - Full habit information display
 * - Visual confidence indicator
 * - Context requirements with hover support
 * - Accept/Dismiss actions with visual feedback
 * - Responsive card layout
 * - WCAG-compliant design
 */

import React, { useEffectEvent, useState } from 'react';

import type { Habit } from './habit-types';
import type { ExecutionContext } from './integration-types';
import type { HabitConfidenceIndicatorProps } from './HabitConfidenceIndicator';
import type { HabitContextRequirementsProps } from './HabitContextRequirements';

import { HabitConfidenceIndicator, HabitConfidenceIndicatorSmall } from './HabitConfidenceIndicator';
import { HabitContextRequirements } from './HabitContextRequirements';
import { IgcCardComponent, IgcCardHeaderComponent, IgcCardContentComponent, IgcCardActionsComponent } from 'igniteui-react';
import { IgcButtonComponent } from 'igniteui-react';
import { IgcIconComponent } from 'igniteui-react';
import { IgcBadgeComponent } from 'igniteui-react';

/**
 * Habit suggestion card props
 */
export interface HabitSuggestionCardProps {
  /** The habit being suggested */
  habit: Habit;
  
  /** Current execution context for context matching */
  context?: ExecutionContext;
  
  /** Optional on accept handler */
  onAccept?: (habit: Habit) => void;
  
  /** Optional on dismiss handler */
  onDismiss?: (habit: Habit) => void;
  
  /** Optional on execute handler */
  onExecute?: (habit: Habit) => void;
  
  /** Optional compact mode */
  compact?: boolean;
  
  /** Optional custom confidence indicator props */
  confidenceIndicatorProps?: Omit<HabitConfidenceIndicatorProps, 'confidence'>;
  
  /** Optional custom context requirements props */
  contextRequirementsProps?: Omit<HabitContextRequirementsProps, 'pattern' | 'currentContext'>;
}

/**
 * Icon component wrapper for igniteui-react
 */
const Icon = IgcIconComponent;
const Card = IgcCardComponent;
const CardHeader = IgcCardHeaderComponent;
const CardContent = IgcCardContentComponent;
const CardActions = IgcCardActionsComponent;
const Button = IgcButtonComponent;
const Badge = IgcBadgeComponent;

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * Get habit status based on confidence
 */
function getHabitStatus(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 80) return 'high';
  if (confidence >= 50) return 'medium';
  return 'low';
}

/**
 * Get status color based on confidence level
 */
function getStatusColor(confidence: number): 'success' | 'warning' | 'error' {
  if (confidence >= 80) return 'success';
  if (confidence >= 50) return 'warning';
  return 'error';
}

/**
 * HabitSuggestionCard - Displays a suggested habit with all relevant information
 *
 * @param props - HabitSuggestionCardProps
 * @returns HabitSuggestionCard component
 */
export function HabitSuggestionCard({
  habit,
  context,
  onAccept,
  onDismiss,
  onExecute,
  compact = false,
  confidenceIndicatorProps,
  contextRequirementsProps,
}: HabitSuggestionCardProps): React.ReactNode {
  const [isHovered, setIsHovered] = useState(false);

  // Extract non-reactive logic
  const handleAccept = useEffectEvent(() => {
    onAccept?.(habit);
  });

  const handleDismiss = useEffectEvent(() => {
    onDismiss?.(habit);
  });

  const handleExecute = useEffectEvent(() => {
    onExecute?.(habit);
  });

  // Calculate status
  const status = getHabitStatus(habit.confidence.overall);
  const statusColor = getStatusColor(habit.confidence.overall);
  const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);

  // Card layout classes
  const cardClasses = compact
    ? 'habit-suggestion-card compact'
    : 'habit-suggestion-card';

  return (
    <Card
      className={cardClasses}
      role="article"
      aria-label={`Suggested habit: ${habit.name}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Card Header */}
      <CardHeader>
        <div className="habit-suggestion-header">
          <h3 className="habit-suggestion-title">
            {compact ? (
              habit.name
            ) : (
              <>
                <span className="habit-suggestion-badge">
                  <Badge color={statusColor} shape="rounded">
                    {statusLabel}
                  </Badge>
                </span>
                <span>{habit.name}</span>
              </>
            )}
          </h3>
          {habit.tags && habit.tags.length > 0 && (
            <div className="habit-suggestion-tags">
              {habit.tags.slice(0, 3).map((tag, index) => (
                <span
                  key={index}
                  className="habit-suggestion-tag"
                  aria-label={`Tag: ${tag}`}
                >
                  {tag}
                </span>
              ))}
              {habit.tags.length > 3 && (
                <span className="habit-suggestion-tag-more" aria-label={`+${habit.tags.length - 3} more tags`}>
                  +{habit.tags.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
      </CardHeader>

      {/* Card Content */}
      <CardContent>
        {/* Habit Description */}
        {habit.description && (
          <p className="habit-suggestion-description">
            {habit.description}
          </p>
        )}

        {/* Compact Card: Show confidence in header */}
        {compact && (
          <div className="habit-suggestion-compact-confidence">
            <HabitConfidenceIndicatorSmall confidence={habit.confidence} />
          </div>
        )}

        {/* Context Requirements */}
        <div className="habit-suggestion-context">
          <HabitContextRequirements
            pattern={habit.primaryPattern}
            currentContext={{
              url: context?.currentUrl,
              title: context?.applicationName || context?.variables['windowTitle'] as string | undefined,
              environment: context?.variables,
            }}
            showStatus={!compact}
            compact={compact}
            {...contextRequirementsProps}
          />
        </div>

        {/* Execution Stats */}
        <div className="habit-suggestion-stats" role="group" aria-label="Execution statistics">
          <div className="habit-suggestion-stat">
            <Icon name="play_arrow" slot="icon-start" size="small" />
            <span className="habit-suggestion-stat-value">{habit.totalExecutions}</span>
            <span className="habit-suggestion-stat-label">Executions</span>
          </div>
          <div className="habit-suggestion-stat">
            <Icon name="check_circle" slot="icon-start" size="small" />
            <span className="habit-suggestion-stat-value">{habit.successCount}</span>
            <span className="habit-suggestion-stat-label">Success</span>
          </div>
          <div className="habit-suggestion-stat">
            <Icon name="error" slot="icon-start" size="small" />
            <span className="habit-suggestion-stat-value">{habit.failureCount}</span>
            <span className="habit-suggestion-stat-label">Failures</span>
          </div>
        </div>

        {/* Last Executed */}
        {habit.lastExecutedAt && (
          <div className="habit-suggestion-last-executed" aria-label={`Last executed: ${habit.lastExecutedAt}`}>
            <Icon name="schedule" slot="icon-start" size="small" />
            <span>Last executed: {formatTimestamp(habit.lastExecutedAt)}</span>
          </div>
        )}
      </CardContent>

      {/* Card Actions */}
      <CardActions className={`habit-suggestion-actions ${isHovered ? 'visible' : 'hidden'}`}>
        <Button
          variant="flat"
          onClick={handleExecute}
          aria-label={`Execute habit ${habit.name}`}
        >
          <Icon name="play_arrow" slot="icon-start" />
          Execute
        </Button>
        <Button
          variant="flat"
          onClick={handleAccept}
          aria-label={`Accept suggestion for habit ${habit.name}`}
        >
          <Icon name="thumb_up" slot="icon-start" />
          Accept
        </Button>
        <Button
          variant="flat"
          onClick={handleDismiss}
          aria-label={`Dismiss suggestion for habit ${habit.name}`}
        >
          <Icon name="thumb_down" slot="icon-start" />
          Dismiss
        </Button>
      </CardActions>

      {/* Accessibility: Keyboard navigation support */}
      <div
        className="habit-suggestion-keyboard-hint"
        aria-hidden="true"
        style={{ display: compact ? 'none' : 'block' }}
      >
        <kbd className="habit-suggestion-key">↑</kbd>
        <kbd className="habit-suggestion-key">↓</kbd>
        <kbd className="habit-suggestion-key">Enter</kbd>
        to navigate and execute
      </div>
    </Card>
  );
}

/**
 * HabitSuggestionCardCompact - Compact version for lists or embedded displays
 */
export function HabitSuggestionCardCompact(
  props: Omit<HabitSuggestionCardProps, 'compact'>
): React.ReactNode {
  return <HabitSuggestionCard {...props} compact />;
}

/**
 * HabitSuggestionCardList - Container for multiple suggestion cards
 *
 * @param props - Props including habits, context, handlers
 * @returns HabitSuggestionCardList component
 */
export function HabitSuggestionCardList({
  habits,
  context,
  onAccept,
  onDismiss,
  onExecute,
  loading = false,
}: {
  habits: Habit[];
  context?: ExecutionContext;
  onAccept?: (habit: Habit) => void;
  onDismiss?: (habit: Habit) => void;
  onExecute?: (habit: Habit) => void;
  loading?: boolean;
}): React.ReactNode {
  return (
    <div className="habit-suggestion-card-list" role="list" aria-label="Suggested habits">
      {loading ? (
        Array.from({ length: 3 }).map((_, index) => (
          <HabitSuggestionCardSkeleton key={index} />
        ))
      ) : habits.length === 0 ? (
        <div className="habit-suggestion-empty" role="status" aria-live="polite">
          <Icon name="schedule" size="large" />
          <p>No habit suggestions available</p>
        </div>
      ) : (
        habits.map((habit, index) => (
          <HabitSuggestionCard
            key={habit.id}
            habit={habit}
            context={context}
            onAccept={onAccept}
            onDismiss={onDismiss}
            onExecute={onExecute}
            aria-posinset={index + 1}
            aria-setsize={habits.length}
          />
        ))
      )}
    </div>
  );
}

/**
 * HabitSuggestionCardSkeleton - Loading state for suggestion cards
 */
export function HabitSuggestionCardSkeleton(): React.ReactNode {
  return (
    <Card className="habit-suggestion-card habit-suggestion-card-skeleton" aria-busy="true">
      <CardHeader>
        <div className="habit-suggestion-header">
          <h3 className="habit-suggestion-title habit-suggestion-card-skeleton-text" />
          <div className="habit-suggestion-tags">
            <div className="habit-suggestion-tag habit-suggestion-card-skeleton-badge" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="habit-suggestion-description habit-suggestion-card-skeleton-text" />
        <div className="habit-suggestion-context">
          <div className="habit-context-requirements habit-suggestion-card-skeleton-box" />
        </div>
        <div className="habit-suggestion-stats">
          <div className="habit-suggestion-stat habit-suggestion-card-skeleton-item" />
          <div className="habit-suggestion-stat habit-suggestion-card-skeleton-item" />
        </div>
      </CardContent>
      <CardActions className="habit-suggestion-actions hidden">
        <Button variant="flat" disabled />
        <Button variant="flat" disabled />
        <Button variant="flat" disabled />
      </CardActions>
    </Card>
  );
}
