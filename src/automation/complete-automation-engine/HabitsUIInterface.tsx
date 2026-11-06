/**
 * Habits UI Interface Component
 *
 * Main interface for the Habits system with complete functionality:
 * - Display suggested habits based on current context
 * - Show confidence scores with visual indicators
 * - Display context requirements on hover
 * - Accept/dismiss buttons for suggestions
 * - Browse habit history with execution stats
 * - Integration with existing system (event dispatcher, repositories)
 * - Accessibility support and keyboard navigation
 *
 * Features:
 * - Display suggested habits with confidence scores
 * - Context requirements visualization
 * - Accept/dismiss actions with feedback
 * - Habit history browsing with statistics
 * - Real-time updates via event subscription
 * - Responsive layout with tabs
 * - WCAG-compliant design
 */

import React, { useEffectEvent, useState, useCallback, useMemo, useEffect } from 'react';

import type { Habit } from './habit-types';
import type { ExecutionContext } from './integration-types';
import type { EventDispatcher } from './event-dispatcher';
import type {
  HabitSuggestedEvent,
  HabitActedUponEvent,
} from './integration-types';

import { HabitSuggestionCard, HabitSuggestionCardList } from './HabitSuggestionCard';
import { HabitHistoryList } from './HabitHistoryList';
import { IgcTabsComponent, IgcTabComponent } from 'igniteui-react';
import { IgcCardComponent, IgcCardHeaderComponent, IgcCardContentComponent } from 'igniteui-react';
import { IgcButtonComponent } from 'igniteui-react';
import { IgcIconComponent } from 'igniteui-react';

/**
 * Habits UI interface props
 */
export interface HabitsUIInterfaceProps {
  /** Array of habits to display */
  habits: Habit[];
  
  /** Optional event dispatcher for subscribing to events */
  eventDispatcher?: EventDispatcher;
  
  /** Optional current context for habit matching */
  context?: ExecutionContext;
  
  /** Optional on accept handler */
  onAccept?: (habit: Habit) => void;
  
  /** Optional on dismiss handler */
  onDismiss?: (habit: Habit) => void;
  
  /** Optional on execute handler */
  onExecute?: (habit: Habit) => void;
  
  /** Optional on habit click handler */
  onHabitClick?: (habit: Habit) => void;
  
  /** Optional on execution click handler */
  onExecutionClick?: (execution: HabitExecutionRecord, habit: Habit) => void;
  
  /** Optional initial active tab */
  initialActiveTab?: 'suggestions' | 'history' | 'all';
  
  /** Optional execution records for history */
  executionRecords?: Record<string, HabitExecutionRecord[]>;
  
  /** Optional tag filter for history */
  filterTag?: string;
}

/**
 * Icon component wrapper for igniteui-react
 */
const Icon = IgcIconComponent;
const Tabs = IgcTabsComponent;
const Tab = IgcTabComponent;
const Card = IgcCardComponent;
const CardHeader = IgcCardHeaderComponent;
const CardContent = IgcCardContentComponent;
const Button = IgcButtonComponent;

/**
 * Type for execution records (imported from habit-types)
 */
interface HabitExecutionRecord {
  id: string;
  habitId: string;
  timestamp: string;
  source: 'suggestion-accepted' | 'auto-executed' | 'manual-trigger';
  success: boolean;
  duration: number;
  userFeedback?: 'approved' | 'corrected' | 'rejected';
  corrections?: Record<number, { originalAction: string; correctedAction: string; reason?: string }>;
}

/**
 * HabitsUIInterface - Main habits UI interface component
 *
 * @param props - HabitsUIInterfaceProps
 * @returns Habits UI interface component
 */
export function HabitsUIInterface({
  habits,
  eventDispatcher,
  context,
  onAccept,
  onDismiss,
  onExecute,
  onHabitClick,
  onExecutionClick,
  initialActiveTab = 'suggestions',
  executionRecords,
  filterTag,
}: HabitsUIInterfaceProps): React.ReactNode {
  const [activeTab, setActiveTab] = useState<'suggestions' | 'history' | 'all'>(initialActiveTab);
  const [suggestedHabits, setSuggestedHabits] = useState<Habit[]>([]);
  const [suggestionConfidence, setSuggestionConfidence] = useState<Record<string, number>>({});

  // Filter habits based on active tab
  const filteredHabits = useMemo(() => {
    switch (activeTab) {
      case 'suggestions':
        return suggestedHabits;
      case 'history':
        return habits.filter(habit => executionRecords?.[habit.id]?.length > 0);
      case 'all':
      default:
        return habits;
    }
  }, [activeTab, suggestedHabits, habits, executionRecords]);

  // Subscribe to habit suggestion events
  useEffect(() => {
    if (!eventDispatcher) {
      return;
    }

    let subscriptionId: string | undefined;

    subscriptionId = eventDispatcher.subscribe<HabitSuggestedEvent>(
      (event: HabitSuggestedEvent) => {
        const habit = habits.find(h => h.id === event.habitId);
        if (habit) {
          setSuggestedHabits(prev => [...prev, habit]);
          setSuggestionConfidence(prev => ({
            ...prev,
            [habit.id]: event.confidenceScore,
          }));
        }
      },
      { eventType: 'HabitSuggested' }
    );

    return () => {
      if (subscriptionId) {
        eventDispatcher.unsubscribe(subscriptionId);
      }
    };
  }, [eventDispatcher, habits]);

  // Subscribe to habit acted upon events
  useEffect(() => {
    if (!eventDispatcher) {
      return;
    }

    let subscriptionId: string | undefined;

    subscriptionId = eventDispatcher.subscribe<HabitActedUponEvent>(
      (event: HabitActedUponEvent) => {
        // Update execution records if provided
        if (onExecutionClick && event.action === 'executed') {
          // Trigger execution click to update UI
          const habit = habits.find(h => h.id === event.habitId);
          if (habit) {
            const newExecution: HabitExecutionRecord = {
              id: `exec-${Date.now()}`,
              habitId: habit.id,
              timestamp: new Date().toISOString(),
              source: 'auto-executed',
              success: event.success ?? true,
              duration: 1000, // Default duration
            };
            onExecutionClick(newExecution, habit);
          }
        }
      },
      { eventType: 'HabitActedUpon' }
    );

    return () => {
      if (subscriptionId) {
        eventDispatcher.unsubscribe(subscriptionId);
      }
    };
  }, [eventDispatcher, habits, onExecutionClick]);

  // Handle tab change
  const handleTabChange = useCallback((tab: 'suggestions' | 'history' | 'all') => {
    setActiveTab(tab);
  }, []);

  // Handle accept suggestion
  const handleAcceptSuggestion = useCallback((habit: Habit) => {
    onAccept?.(habit);
  }, [onAccept]);

  // Handle dismiss suggestion
  const handleDismissSuggestion = useCallback((habit: Habit) => {
    onDismiss?.(habit);
  }, [onDismiss]);

  // Handle execute habit
  const handleExecuteHabit = useCallback((habit: Habit) => {
    onExecute?.(habit);
  }, [onExecute]);

  // Handle habit click in history
  const handleHabitClick = useCallback((habit: Habit) => {
    onHabitClick?.(habit);
  }, [onHabitClick]);

  // Get confidence for a habit
  const getConfidence = useCallback((habitId: string): number => {
    return suggestionConfidence[habitId] ?? habits.find(h => h.id === habitId)?.confidence.overall ?? 0;
  }, [suggestionConfidence, habits]);

  return (
    <div className="habits-ui-interface" role="main" aria-label="Habits user interface">
      {/* Header */}
      <header className="habits-ui-header">
        <div className="habits-ui-header-content">
          <h1 className="habits-ui-title">Habits</h1>
          <p className="habits-ui-subtitle">
            Your learned automation patterns and execution history
          </p>
        </div>
        <div className="habits-ui-actions">
          <div className="habits-ui-stats">
            <div className="habits-ui-stat">
              <Icon name="school" slot="icon-start" size="small" />
              <span className="habits-ui-stat-value">{habits.length}</span>
              <span className="habits-ui-stat-label">Habits</span>
            </div>
            {executionRecords && (
              <div className="habits-ui-stat">
                <Icon name="history" slot="icon-start" size="small" />
                <span className="habits-ui-stat-value">
                  {Object.values(executionRecords).flat().length}
                </span>
                <span className="habits-ui-stat-label">Executions</span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="habits-ui-content">
        <Tabs
          className="habits-ui-tabs"
          value={activeTab}
          onChange={(event: CustomEvent) => {
            handleTabChange(event.detail.value as 'suggestions' | 'history' | 'all');
          }}
        >
          {/* Suggestions Tab */}
          <Tab label="Suggestions" value="suggestions">
            <div className="habits-ui-tab-content">
              <HabitSuggestionCardList
                habits={filteredHabits}
                context={context}
                onAccept={handleAcceptSuggestion}
                onDismiss={handleDismissSuggestion}
                onExecute={handleExecuteHabit}
                loading={suggestedHabits.length === 0 && habits.length > 0}
              />
            </div>
          </Tab>

          {/* History Tab */}
          <Tab label="History" value="history">
            <div className="habits-ui-tab-content">
              <HabitHistoryList
                habits={filteredHabits}
                executionRecords={executionRecords}
                filterTag={filterTag}
                onHabitClick={handleHabitClick}
                onExecutionClick={onExecutionClick}
                compact={false}
              />
            </div>
          </Tab>

          {/* All Habits Tab */}
          <Tab label="All Habits" value="all">
            <div className="habits-ui-tab-content">
              <HabitSuggestionCardList
                habits={filteredHabits}
                context={context}
                onAccept={handleAcceptSuggestion}
                onDismiss={handleDismissSuggestion}
                onExecute={handleExecuteHabit}
                loading={false}
              />
            </div>
          </Tab>
        </Tabs>
      </main>

      {/* Quick Stats Panel */}
      <aside className="habits-ui-stats" role="complementary" aria-label="Habit statistics">
        <div className="habits-ui-stats-content">
          <h2 className="habits-ui-stats-title">Statistics</h2>
          
          <div className="habits-ui-stats-grid">
            {/* Overall Success Rate */}
            <Card className="habits-ui-stat-card">
              <CardHeader>
                <h3 className="habits-ui-stat-title">Success Rate</h3>
              </CardHeader>
              <CardContent>
                {executionRecords && Object.values(executionRecords).length > 0 ? (
                  (() => {
                    const allExecutions = Object.values(executionRecords).flat();
                    const successCount = allExecutions.filter(e => e.success).length;
                    const totalCount = allExecutions.length;
                    const percentage = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0;
                    return (
                      <>
                        <span className="habits-ui-stat-value" style={{ fontSize: '2rem' }}>
                          {percentage}%
                        </span>
                        <p className="habits-ui-stat-subtitle">
                          {successCount} of {totalCount} executions
                        </p>
                      </>
                    );
                  })()
                ) : (
                  <p className="habits-ui-stat-placeholder">No execution data</p>
                )}
              </CardContent>
            </Card>

            {/* Most Used Habit */}
            <Card className="habits-ui-stat-card">
              <CardHeader>
                <h3 className="habits-ui-stat-title">Most Used</h3>
              </CardHeader>
              <CardContent>
                {habits.length > 0 ? (
                  (() => {
                    const mostUsed = [...habits].sort((a, b) => b.totalExecutions - a.totalExecutions)[0];
                    return (
                      <>
                        <div className="habits-ui-stat-value">
                          {mostUsed.name}
                        </div>
                        <p className="habits-ui-stat-subtitle">
                          {mostUsed.totalExecutions} executions
                        </p>
                      </>
                    );
                  })()
                ) : (
                  <p className="habits-ui-stat-placeholder">No habits found</p>
                )}
              </CardContent>
            </Card>

            {/* Recent Habits */}
            <Card className="habits-ui-stat-card">
              <CardHeader>
                <h3 className="habits-ui-stat-title">Recent Activity</h3>
              </CardHeader>
              <CardContent>
                {habits.length > 0 ? (
                  habits
                    .filter(h => h.lastExecutedAt)
                    .sort((a, b) => new Date(b.lastExecutedAt || 0).getTime() - new Date(a.lastExecutedAt || 0).getTime())
                    .slice(0, 2)
                    .map(habit => (
                      <div
                        key={habit.id}
                        className="habits-ui-stat-item"
                        aria-label={`${habit.name}: ${new Date(habit.lastExecutedAt || '').toLocaleDateString()}`}
                      >
                        <span className="habits-ui-stat-item-name">{habit.name}</span>
                        <span className="habits-ui-stat-item-time">
                          {habit.lastExecutedAt ? 'Recent' : 'Never'}
                        </span>
                      </div>
                    ))
                ) : (
                  <p className="habits-ui-stat-placeholder">No habits found</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Confidence Distribution */}
          <div className="habits-ui-confidence-distribution">
            <h3 className="habits-ui-distribution-title">Confidence Distribution</h3>
            <div className="habits-ui-distribution-bar">
              {habits.length > 0 ? (
                (() => {
                  const highConfidence = habits.filter(h => h.confidence.overall >= 80).length;
                  const mediumConfidence = habits.filter(h => h.confidence.overall >= 50 && h.confidence.overall < 80).length;
                  const lowConfidence = habits.filter(h => h.confidence.overall < 50).length;

                  const total = habits.length;

                  return (
                    <>
                      <div className="habits-ui-distribution-item success" style={{ width: `${(highConfidence / total) * 100}%` }}>
                        <span>{highConfidence}</span>
                      </div>
                      <div className="habits-ui-distribution-item warning" style={{ width: `${(mediumConfidence / total) * 100}%` }}>
                        <span>{mediumConfidence}</span>
                      </div>
                      <div className="habits-ui-distribution-item error" style={{ width: `${(lowConfidence / total) * 100}%` }}>
                        <span>{lowConfidence}</span>
                      </div>
                    </>
                  );
                })()
              ) : (
                <div className="habits-ui-distribution-empty">
                  <span className="habits-ui-stat-placeholder">No habits</span>
                </div>
              )}
            </div>
            <div className="habits-ui-distribution-legend">
              <span className="habits-ui-distribution-legend-item success">
                <span className="habits-ui-distribution-legend-color" style={{ backgroundColor: 'var(--ig-success-500)' }} />
                <span>High (80-100)</span>
              </span>
              <span className="habits-ui-distribution-legend-item warning">
                <span className="habits-ui-distribution-legend-color" style={{ backgroundColor: 'var(--ig-warning-500)' }} />
                <span>Medium (50-79)</span>
              </span>
              <span className="habits-ui-distribution-legend-item error">
                <span className="habits-ui-distribution-legend-color" style={{ backgroundColor: 'var(--ig-error-500)' }} />
                <span>Low (0-49)</span>
              </span>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

/**
 * HabitsUIInterfaceTabs - Tabs interface for habits and other modules
 *
 * @param props - Props including children tabs
 * @returns Tabs interface component
 */
export function HabitsUIInterfaceTabs({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <Tabs className="habits-ui-tabs">
      {children}
    </Tabs>
  );
}

/**
 * HabitsUITab - Individual tab for habits interface
 *
 * @param props - Props including label and children
 * @returns Tab component
 */
export function HabitsUITab({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <Tab label={label}>
      {children}
    </Tab>
  );
}

/**
 * HabitsUIInterfaceCompact - Compact version for embedded use
 *
 * @param props - HabitsUIInterfaceProps
 * @returns Compact UI interface
 */
export function HabitsUIInterfaceCompact({
  habits,
  context,
  onExecute,
}: HabitsUIInterfaceProps): React.ReactNode {
  const [selectedHabitId, setSelectedHabitId] = useState<string | undefined>(undefined);

  const handleHabitSelect = useCallback((habit: Habit) => {
    setSelectedHabitId(habit.id);
  }, []);

  const handleHabitExecute = useCallback((habit: Habit) => {
    onExecute?.(habit);
  }, [onExecute]);

  return (
    <div className="habits-ui-interface-compact" role="region" aria-label="Compact habits interface">
      <HabitSuggestionCardList
        habits={habits}
        context={context}
        onExecute={handleHabitExecute}
      />
    </div>
  );
}

// Re-export all components for convenience
export {
  HabitSuggestionCard,
  HabitSuggestionCardList,
  HabitSuggestionCardCompact,
  HabitSuggestionCardSkeleton,
  HabitHistoryList,
  HabitHistoryListCompact,
  HabitConfidenceIndicator,
  HabitConfidenceIndicatorSmall,
  HabitConfidenceIndicatorLarge,
  HabitContextRequirements,
  HabitContextRequirementsCompact,
};
