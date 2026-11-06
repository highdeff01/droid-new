/**
 * Habit History List Component
 *
 * Displays execution history for habits with statistics and details:
 * - Habit name and confidence
 * - Execution timestamp and duration
 * - Success/failure status
 * - User feedback indicators
 * - Browse and filter functionality
 *
 * Features:
 * - Execution history timeline
 * - Confidence score display for each execution
 * - Success/failure status with visual indicators
 * - Feedback annotations
 * - Browse and filter capabilities
 * - Responsive list layout
 */

import React, { useEffectEvent, useState, useMemo, useCallback } from 'react';

import type { Habit } from './habit-types';
import type { HabitExecutionRecord } from './habit-types';
import type { HabitConfidenceIndicatorProps } from './HabitConfidenceIndicator';
import type { HabitContextRequirementsProps } from './HabitContextRequirements';

import { HabitConfidenceIndicator, HabitConfidenceIndicatorSmall } from './HabitConfidenceIndicator';
import { HabitContextRequirements } from './HabitContextRequirements';
import { IgcButtonComponent } from 'igniteui-react';
import { IgcIconComponent } from 'igniteui-react';
import { IgcListComponent, IgcListItemComponent } from 'igniteui-react';
import { IgcBadgeComponent } from 'igniteui-react';

/**
 * Habit history list props
 */
export interface HabitHistoryListProps {
  /** Array of habits to show history for */
  habits: Habit[];
  
  /** Optional execution records for specific habits */
  executionRecords?: Record<string, HabitExecutionRecord[]>;
  
  /** Optional filter by tag */
  filterTag?: string;
  
  /** Optional on habit click handler */
  onHabitClick?: (habit: Habit) => void;
  
  /** Optional on execution click handler */
  onExecutionClick?: (execution: HabitExecutionRecord, habit: Habit) => void;
  
  /** Optional compact mode */
  compact?: boolean;
  
  /** Optional maximum number of items to show */
  maxItems?: number;
}

/**
 * Icon component wrapper for igniteui-react
 */
const Icon = IgcIconComponent;
const List = IgcListComponent;
const ListItem = IgcListItemComponent;
const Button = IgcButtonComponent;
const Badge = IgcBadgeComponent;

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));

  if (days === 0) {
    return 'Today';
  } else if (days === 1) {
    return 'Yesterday';
  } else if (days < 7) {
    return date.toLocaleDateString('en-US', { weekday: 'short' });
  } else {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
    }).format(date);
  }
}

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${Math.round(ms / 1000)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
}

/**
 * Get execution status color based on success
 */
function getExecutionStatusColor(success: boolean): 'success' | 'error' {
  return success ? 'success' : 'error';
}

/**
 * Get execution status label
 */
function getExecutionStatusLabel(success: boolean): string {
  return success ? 'Success' : 'Failed';
}

/**
 * HabitHistoryItem - Individual execution history item
 */
function HabitHistoryItem({
  execution,
  habit,
  onClick,
  compact,
}: {
  execution: HabitExecutionRecord;
  habit: Habit;
  onClick?: (execution: HabitExecutionRecord, habit: Habit) => void;
  compact?: boolean;
}): React.ReactNode {
  const handleItemClick = useEffectEvent(() => {
    onClick?.(execution, habit);
  });

  const statusColor = getExecutionStatusColor(execution.success);
  const statusLabel = getExecutionStatusLabel(execution.success);

  return (
    <ListItem
      className={`habit-history-item ${compact ? 'compact' : ''}`}
      onClick={handleItemClick}
      role="listitem"
      aria-label={`Execution on ${formatTimestamp(execution.timestamp)}, ${statusLabel}`}
      tabIndex={0}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleItemClick();
        }
      }}
    >
      <div className="habit-history-content">
        <div className="habit-history-header">
          <div className="habit-history-name">
            <Icon name="schedule" slot="icon-start" size="small" />
            {habit.name}
          </div>
          <div className="habit-history-status">
            <Badge color={statusColor} shape="rounded">
              {statusLabel}
            </Badge>
          </div>
        </div>
        <div className="habit-history-details">
          <div className="habit-history-time">
            <Icon name="access_time" slot="icon-start" size="small" />
            {formatTimestamp(execution.timestamp)}
          </div>
          <div className="habit-history-duration">
            <Icon name="timer" slot="icon-start" size="small" />
            {formatDuration(execution.duration)}
          </div>
          {execution.source && (
            <div className="habit-history-source">
              <span className="habit-history-source-label">Source:</span>
              <span className="habit-history-source-value">{execution.source.replace(/-/g, ' ')}</span>
            </div>
          )}
        </div>
        {execution.userFeedback && (
          <div className="habit-history-feedback">
            <span className="habit-history-feedback-label">
              <Icon name={execution.userFeedback === 'approved' ? 'thumb_up' : 'thumb_down'} slot="icon-start" size="small" />
              {execution.userFeedback}
            </span>
          </div>
        )}
        {execution.corrections && Object.keys(execution.corrections).length > 0 && (
          <div className="habit-history-corrections">
            <span className="habit-history-corrections-label">
              <Icon name="build" slot="icon-start" size="small" />
              {Object.keys(execution.corrections).length} correction{Object.keys(execution.corrections).length !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>
    </ListItem>
  );
}

/**
 * HabitHistoryList - Displays execution history for habits
 *
 * @param props - HabitHistoryListProps
 * @returns HabitHistoryList component
 */
export function HabitHistoryList({
  habits,
  executionRecords,
  filterTag,
  onHabitClick,
  onExecutionClick,
  compact = false,
  maxItems = 20,
}: HabitHistoryListProps): React.ReactNode {
  const [showAll, setShowAll] = useState(false);

  // Filter habits by tag if provided
  const filteredHabits = useMemo(() => {
    if (!filterTag) return habits;
    return habits.filter(habit => habit.tags?.includes(filterTag));
  }, [habits, filterTag]);

  // Get execution records for filtered habits
  const executions = useMemo(() => {
    const allExecutions: Array<{ execution: HabitExecutionRecord; habit: Habit }> = [];

    for (const habit of filteredHabits) {
      const records = executionRecords?.[habit.id] || [];
      for (const record of records) {
        allExecutions.push({ execution: record, habit });
      }
    }

    // Sort by timestamp (most recent first)
    allExecutions.sort((a, b) => {
      return new Date(b.execution.timestamp).getTime() - new Date(a.execution.timestamp).getTime();
    });

    return allExecutions.slice(0, showAll ? undefined : maxItems);
  }, [filteredHabits, executionRecords, showAll, maxItems]);

  const handleShowMore = useEffectEvent(() => {
    setShowAll(true);
  });

  const handleShowLess = useEffectEvent(() => {
    setShowAll(false);
  });

  return (
    <div className={`habit-history-list ${compact ? 'compact' : ''}`}>
      {/* Header */}
      <div className="habit-history-header">
        <h2 className="habit-history-title">
          <Icon name="history" slot="icon-start" />
          Habit History
        </h2>
        {filterTag && (
          <div className="habit-history-filter">
            <Badge color="primary" shape="rounded">
              Filter: {filterTag}
            </Badge>
          </div>
        )}
      </div>

      {/* Statistics */}
      <div className="habit-history-stats" role="region" aria-label="History statistics">
        <div className="habit-history-stat">
          <span className="habit-history-stat-value">{executions.length}</span>
          <span className="habit-history-stat-label">Executions</span>
        </div>
        {executions.length > 0 && (
          <>
            <div className="habit-history-stat">
              <span className="habit-history-stat-value" style={{ color: 'var(--ig-success-500)' }}>
                {executions.filter(e => e.execution.success).length}
              </span>
              <span className="habit-history-stat-label">Success</span>
            </div>
            <div className="habit-history-stat">
              <span className="habit-history-stat-value" style={{ color: 'var(--ig-error-500)' }}>
                {executions.filter(e => !e.execution.success).length}
              </span>
              <span className="habit-history-stat-label">Failed</span>
            </div>
          </>
        )}
      </div>

      {/* Execution List */}
      <List className="habit-history-list-container" role="list">
        {executions.length === 0 ? (
          <div className="habit-history-empty" role="status" aria-live="polite">
            <Icon name="history" size="large" />
            <p>No execution history found</p>
          </div>
        ) : (
          executions.map((item, index) => (
            <HabitHistoryItem
              key={`${item.execution.id}-${index}`}
              execution={item.execution}
              habit={item.habit}
              onClick={onExecutionClick}
              compact={compact}
              aria-posinset={index + 1}
              aria-setsize={executions.length}
            />
          ))
        )}
      </List>

      {/* Show More/Less */}
      {!showAll && executions.length < (executionRecords ? Object.values(executionRecords).flat().length : 0) && (
        <div className="habit-history-footer">
          <Button
            variant="flat"
            onClick={handleShowMore}
            aria-label="Show all executions"
          >
            <Icon name="arrow_downward" slot="icon-start" />
            Show More
          </Button>
        </div>
      )}

      {showAll && (
        <div className="habit-history-footer">
          <Button
            variant="flat"
            onClick={handleShowLess}
            aria-label="Show fewer executions"
          >
            <Icon name="arrow_upward" slot="icon-start" />
            Show Less
          </Button>
        </div>
      )}

      {/* Habit List Summary */}
      {habits.length > 0 && (
        <div className="habit-history-habits" role="region" aria-label="Habits with history">
          <h3 className="habit-history-habits-title">Habits with History</h3>
          <div className="habit-history-habits-list" role="list">
            {habits.map((habit, index) => (
              <button
                key={habit.id}
                className="habit-history-habit-item"
                onClick={() => onHabitClick?.(habit)}
                aria-label={`View history for habit: ${habit.name}`}
                aria-current={filterTag && filterTag === 'all' ? undefined : undefined}
              >
                <span className="habit-history-habit-name">{habit.name}</span>
                <span className="habit-history-habit-count">
                  {executionRecords?.[habit.id]?.length || 0} executions
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * HabitHistoryListCompact - Compact version for smaller displays
 */
export function HabitHistoryListCompact(
  props: Omit<HabitHistoryListProps, 'compact'>
): React.ReactNode {
  return <HabitHistoryList {...props} compact />;
}
