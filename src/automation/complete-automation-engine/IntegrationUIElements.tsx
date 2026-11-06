/**
 * Integration UI Elements Component (React 19)
 *
 * Main integration component combining all UI elements for the Complete Automation Engine.
 * Orchestrates inline habit suggestions, pack creation after recording,
 * confidence display, and analytics dashboard.
 * Uses React 19 features: ref as prop, no React import needed.
 *
 * Features:
 * - Unified UI for all integration elements
 * - Context-aware habit suggestions
 * - Pack creation after workflow recording
 * - Confidence display for extracted habits
 * - Analytics dashboard with success rates
 * - Event dispatcher integration
 * - Accessibility support (ARIA labels, keyboard navigation)
 */

import { useEffectEvent, useState, useMemo, useEffect } from 'react';

import type { Habit } from './habit-types';
import type { Pack, PackExecutionRecord } from './pack-types';
import type { Workflow } from './workflow-types';
import type { ExecutionContext } from './integration-types';
import type { EventDispatcher } from './event-dispatcher';
import type { HabitSuggestedEvent, WorkflowCreatedEvent, PackModifiedEvent } from './integration-types';

import { InlineHabitSuggestion, InlineHabitSuggestionList } from './InlineHabitSuggestion';
import { PackCreationAfterRecording } from './PackCreationAfterRecording';
import { PackHabitConfidenceDisplay, PackHabitConfidenceDisplayList } from './PackHabitConfidenceDisplay';
import { AnalyticsDashboard } from './AnalyticsDashboard';
import { IgcTabsComponent, IgcTabComponent } from 'igniteui-react';

/**
 * Integration UI elements props
 */
export interface IntegrationUIElementsProps {
  /** Array of packs */
  packs: Pack[];
  
  /** Array of habits */
  habits: Habit[];
  
  /** Optional workflows for pack creation */
  workflows?: Workflow[];
  
  /** Optional current execution context */
  context?: ExecutionContext;
  
  /** Optional event dispatcher */
  eventDispatcher?: EventDispatcher;
  
  /** Optional execution records */
  executionRecords?: Record<string, HabitExecutionRecord[]>;
  
  /** Optional pack execution records */
  packExecutionRecords?: PackExecutionRecord[];
  
  /** Optional pack creation handler */
  onCreatePack?: (name: string, description?: string, workflowIds?: string[]) => void;
  
  /** Optional habit execution handler */
  onExecuteHabit?: (habit: Habit) => void;
  
  /** Optional habit click handler */
  onHabitClick?: (habit: Habit) => void;
  
  /** Optional pack click handler */
  onPackClick?: (pack: Pack) => void;
  
  /** Optional habit acceptance handler */
  onAcceptHabit?: (habit: Habit) => void;
  
  /** Optional habit dismissal handler */
  onDismissHabit?: (habit: Habit) => void;
  
  /** Optional workflow recording completion handler */
  onWorkflowRecordingComplete?: (workflow: Workflow) => void;
}

/**
 * Icon component wrapper for igniteui-react
 */
const Icon = IgcIconComponent;
const Tabs = IgcTabsComponent;
const Tab = IgcTabComponent;

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
 * IntegrationUIElements - Main integration component
 *
 * Combines all integration UI elements into a unified interface:
 * - Inline habit suggestions
 * - Pack creation after recording
 * - Confidence display for extracted habits
 * - Analytics dashboard
 *
 * @param props - IntegrationUIElementsProps
 * @returns Integration UI elements component
 */
export function IntegrationUIElements({
  packs,
  habits,
  workflows = [],
  context,
  eventDispatcher,
  executionRecords,
  packExecutionRecords,
  onCreatePack,
  onExecuteHabit,
  onHabitClick,
  onPackClick,
  onAcceptHabit,
  onDismissHabit,
  onWorkflowRecordingComplete,
}: IntegrationUIElementsProps): React.ReactNode {
  const [activeTab, setActiveTab] = useState<'habits' | 'packs' | 'analytics'>('habits');
  const [recordingCompleted, setRecordingCompleted] = useState(false);
  const [showPackCreation, setShowPackCreation] = useState(false);

  // Filter workflows by execution status
  const completedWorkflows = useMemo(() => {
    return workflows.filter(w => {
      const record = packExecutionRecords?.find(r => 
        r.workflowResults.some(wr => wr.workflowId === w.id)
      );
      return record?.success ?? false;
    });
  }, [workflows, packExecutionRecords]);

  // Handle workflow recording completion
  useEffect(() => {
    if (!eventDispatcher) {
      return;
    }

    let subscriptionId: string | undefined;

    subscriptionId = eventDispatcher.subscribe<WorkflowCreatedEvent>(
      (event: WorkflowCreatedEvent) => {
        // Check if workflow should trigger pack creation
        const newWorkflow = workflows.find(w => w.id === event.workflowId);
        if (newWorkflow) {
          setRecordingCompleted(true);
          setShowPackCreation(true);
        }
      },
      { eventType: 'WorkflowCreated' }
    );

    return () => {
      if (subscriptionId) {
        eventDispatcher.unsubscribe(subscriptionId);
      }
    };
  }, [eventDispatcher, workflows]);

  // Handle pack modification
  useEffect(() => {
    if (!eventDispatcher) {
      return;
    }

    let subscriptionId: string | undefined;

    subscriptionId = eventDispatcher.subscribe<PackModifiedEvent>(
      (event: PackModifiedEvent) => {
        // Handle pack modification events
        // Could trigger UI updates or notifications
        console.log('Pack modified:', event.packId);
      },
      { eventType: 'PackModified' }
    );

    return () => {
      if (subscriptionId) {
        eventDispatcher.unsubscribe(subscriptionId);
      }
    };
  }, [eventDispatcher]);

  // Handle habit suggestion
  useEffect(() => {
    if (!eventDispatcher) {
      return;
    }

    let subscriptionId: string | undefined;

    subscriptionId = eventDispatcher.subscribe<HabitSuggestedEvent>(
      (event: HabitSuggestedEvent) => {
        // Handle habit suggestion events
        // Could trigger UI updates or notifications
        console.log('Habit suggested:', event.habitId, 'confidence:', event.confidence);
      },
      { eventType: 'HabitSuggested' }
    );

    return () => {
      if (subscriptionId) {
        eventDispatcher.unsubscribe(subscriptionId);
      }
    };
  }, [eventDispatcher]);

  // Handle tab change
  const handleTabChange = useEffectEvent((tab: 'habits' | 'packs' | 'analytics') => {
    setActiveTab(tab);
  });

  // Handle pack creation
  const handlePackCreation = useEffectEvent((name: string, description?: string, workflowIds?: string[]) => {
    onCreatePack?.(name, description, workflowIds);
    setRecordingCompleted(false);
    setShowPackCreation(false);
  });

  // Handle dismiss pack creation
  const handleDismissPackCreation = useEffectEvent(() => {
    setRecordingCompleted(false);
    setShowPackCreation(false);
  });

  return (
    <div className="integration-ui-elements">
      {/* Header */}
      <header className="integration-header">
        <div className="integration-title">
          <Icon name="auto_awesome" />
          <h2>Complete Automation Engine</h2>
        </div>
        <p className="integration-subtitle">
          Integrated UI for habits, packs, and analytics
        </p>
      </header>

      {/* Main Content */}
      <main className="integration-content">
        {/* Tabs */}
        <Tabs
          className="integration-tabs"
          value={activeTab}
          onChange={(event: CustomEvent) => {
            handleTabChange(event.detail.value as 'habits' | 'packs' | 'analytics');
          }}
        >
          {/* Habits Tab */}
          <Tab label="Habits" value="habits">
            <div className="integration-tab-content habits-tab">
              {/* Inline Habit Suggestions */}
              <section className="habits-section" aria-labelledby="habits-suggestions-heading">
                <h3 id="habits-suggestions-heading" className="section-title">
                  Inline Habit Suggestions
                </h3>
                <p className="section-subtitle">
                  Context-aware automation suggestions based on your habits
                </p>
                <div className="inline-suggestions-container">
                  {context ? (
                    <InlineHabitSuggestionList
                      habits={habits}
                      context={context}
                      onAccept={onAcceptHabit}
                      onDismiss={onDismissHabit}
                      onExecute={onExecuteHabit}
                    />
                  ) : (
                    <div 
                      className="context-placeholder"
                      aria-label="No context available for habit suggestions"
                    >
                      <p className="placeholder-message">
                        No current context available. Habit suggestions require context matching.
                      </p>
                    </div>
                  )}
                </div>
              </section>

              {/* Habit Confidence Display */}
              <section className="habits-section" aria-labelledby="habits-confidence-heading">
                <h3 id="habits-confidence-heading" className="section-title">
                  Habit Confidence Analysis
                </h3>
                <p className="section-subtitle">
                  Detailed confidence scores and success rates for your habits
                </p>
                <PackHabitConfidenceDisplayList
                  habits={habits}
                  showBreakdown={true}
                  onHabitClick={onHabitClick}
                />
              </section>

              {/* Habit Execution History */}
              <section className="habits-section" aria-labelledby="habits-history-heading">
                <h3 id="habits-history-heading" className="section-title">
                  Habit Execution History
                </h3>
                <p className="section-subtitle">
                  Track your habit usage and performance over time
                </p>
                <div className="history-container">
                  {/* This would use HabitHistoryList component if available */}
                  <div className="history-placeholder">
                    <p className="placeholder-message">
                      Habit execution history visualization would appear here
                    </p>
                  </div>
                </div>
              </section>
            </div>
          </Tab>

          {/* Packs Tab */}
          <Tab label="Packs" value="packs">
            <div className="integration-tab-content packs-tab">
              {/* Pack Creation After Recording */}
              <section className="packs-section" aria-labelledby="pack-creation-heading">
                <h3 id="pack-creation-heading" className="section-title">
                  Pack Creation
                </h3>
                <p className="section-subtitle">
                  Convert successful workflow recordings into reusable automation packs
                </p>
                <div className="pack-creation-container">
                  {showPackCreation && completedWorkflows.length > 0 ? (
                    <PackCreationAfterRecording
                      workflows={completedWorkflows}
                      eventDispatcher={eventDispatcher}
                      onCreatePack={handlePackCreation}
                      onDismiss={handleDismissPackCreation}
                    />
                  ) : (
                    <div 
                      className="pack-creation-placeholder"
                      aria-label="No workflow recordings ready for pack creation"
                    >
                      <p className="placeholder-message">
                        No workflow recordings ready for pack creation.
                        Complete a workflow recording to create a new pack.
                      </p>
                    </div>
                  )}
                </div>
              </section>

              {/* Pack Execution Statistics */}
              <section className="packs-section" aria-labelledby="pack-stats-heading">
                <h3 id="pack-stats-heading" className="section-title">
                  Pack Execution Statistics
                </h3>
                <p className="section-subtitle">
                  Overview of pack performance and success rates
                </p>
                <div className="pack-stats-container">
                  {packs.length > 0 ? (
                    <div className="pack-stats-grid">
                      {packs.map(pack => {
                        const successRate = pack.executionHistory && pack.executionHistory.length > 0
                          ? Math.round(
                              (pack.executionHistory.filter(e => e.success).length / pack.executionHistory.length) * 100
                            )
                          : 0;

                        return (
                          <div
                            key={pack.id}
                            className="pack-stat-card"
                            onClick={() => onPackClick?.(pack)}
                            tabIndex={0}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                onPackClick?.(pack);
                              }
                            }}
                            role="button"
                            aria-label={`View pack ${pack.name} details`}
                          >
                            <div className="pack-stat-header">
                              <Icon name="collections_bookmark" />
                              <span className="pack-stat-name">{pack.name}</span>
                              <span className="pack-stat-version">v{pack.version.version}</span>
                            </div>
                            <div className="pack-stat-body">
                              <div className="pack-stat-item">
                                <span className="pack-stat-label">Executions</span>
                                <span className="pack-stat-value">
                                  {pack.executionHistory?.length || 0}
                                </span>
                              </div>
                              <div className="pack-stat-item">
                                <span className="pack-stat-label">Success Rate</span>
                                <span 
                                  className={`pack-stat-value ${successRate >= 80 ? 'success' : successRate >= 50 ? 'warning' : 'error'}`}
                                >
                                  {successRate}%
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div 
                      className="pack-stats-placeholder"
                      aria-label="No packs available"
                    >
                      <p className="placeholder-message">
                        No packs available. Create your first automation pack.
                      </p>
                    </div>
                  )}
                </div>
              </section>
            </div>
          </Tab>

          {/* Analytics Tab */}
          <Tab label="Analytics" value="analytics">
            <div className="integration-tab-content analytics-tab">
              <section className="analytics-section" aria-labelledby="analytics-heading">
                <h3 id="analytics-heading" className="section-title">
                  Analytics Dashboard
                </h3>
                <p className="section-subtitle">
                  Comprehensive metrics and visualizations for automation performance
                </p>
                <AnalyticsDashboard
                  packs={packs}
                  habits={habits}
                  executionRecords={packExecutionRecords}
                  eventDispatcher={eventDispatcher}
                  onPackClick={onPackClick}
                  onHabitClick={onHabitClick}
                />
              </section>
            </div>
          </Tab>
        </Tabs>
      </main>

      {/* Quick Actions Panel */}
      <aside className="integration-actions" role="complementary" aria-label="Quick actions">
        <div className="actions-content">
          <h2 className="actions-title">Quick Actions</h2>
          
          <div className="actions-grid">
            <button
              className="action-button"
              onClick={() => setActiveTab('habits')}
              aria-label="Go to habits section"
            >
              <Icon name="school" size="large" />
              <span className="action-label">Habits</span>
            </button>
            
            <button
              className="action-button"
              onClick={() => setActiveTab('packs')}
              aria-label="Go to packs section"
            >
              <Icon name="collections_bookmark" size="large" />
              <span className="action-label">Packs</span>
            </button>
            
            <button
              className="action-button"
              onClick={() => setActiveTab('analytics')}
              aria-label="Go to analytics section"
            >
              <Icon name="analytics" size="large" />
              <span className="action-label">Analytics</span>
            </button>
          </div>

          {/* System Status */}
          <div className="system-status">
            <h3 className="status-title">System Status</h3>
            <div className="status-list">
              <div className="status-item success">
                <Icon name="check_circle" size="x-small" />
                <span className="status-label">Event Dispatcher</span>
                <span className="status-indicator">Active</span>
              </div>
              <div className="status-item success">
                <Icon name="check_circle" size="x-small" />
                <span className="status-label">Context Matcher</span>
                <span className="status-indicator">Active</span>
              </div>
              <div className="status-item success">
                <Icon name="check_circle" size="x-small" />
                <span className="status-label">Confidence Engine</span>
                <span className="status-indicator">Active</span>
              </div>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="quick-stats">
            <h3 className="stats-title">Quick Stats</h3>
            <div className="stats-grid">
              <div className="stat-card">
                <span className="stat-value">{packs.length}</span>
                <span className="stat-label">Packs</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{habits.length}</span>
                <span className="stat-label">Habits</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">
                  {packExecutionRecords?.length || 0}
                </span>
                <span className="stat-label">Executions</span>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

/**
 * IntegrationUIElementsCompact - Compact version for embedded use
 *
 * @param props - IntegrationUIElementsProps
 * @returns Compact integration UI
 */
export function IntegrationUIElementsCompact({
  packs,
  habits,
  context,
}: IntegrationUIElementsProps): React.ReactNode {
  const activeTab = 'habits'; // Fixed tab for compact view

  return (
    <div className="integration-ui-elements-compact">
      {/* Quick Habit Suggestions */}
      <div className="compact-habits">
        <h4 className="compact-section-title">Habit Suggestions</h4>
        {context ? (
          <InlineHabitSuggestionList
            habits={habits}
            context={context}
            compact={true}
          />
        ) : (
          <p className="placeholder-message">No context available</p>
        )}
      </div>

      {/* Quick Stats */}
      <div className="compact-stats">
        <div className="compact-stat">
          <span className="compact-stat-label">Packs</span>
          <span className="compact-stat-value">{packs.length}</span>
        </div>
        <div className="compact-stat">
          <span className="compact-stat-label">Habits</span>
          <span className="compact-stat-value">{habits.length}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * IntegrationUIElementsTabs - Tabs interface for integration UI
 *
 * @param props - Children tabs
 * @returns Tabs interface component
 */
export function IntegrationUIElementsTabs({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <Tabs className="integration-ui-tabs">
      {children}
    </Tabs>
  );
}

/**
 * IntegrationUITab - Individual tab for integration UI
 *
 * @param props - Props including label and children
 * @returns Tab component
 */
export function IntegrationUITab({
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

// Re-export all components for convenience
export {
  InlineHabitSuggestion,
  InlineHabitSuggestionList,
  PackCreationAfterRecording,
  PackHabitConfidenceDisplay,
  PackHabitConfidenceDisplayList,
  AnalyticsDashboard,
};

// Styles for integration UI elements
/*
.integration-ui-elements {
  margin: 1rem 0;
  animation: fadeIn 0.3s ease-in-out;
}

.integration-header {
  margin-bottom: 1.5rem;
}

.integration-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.5rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.integration-subtitle {
  margin: 0;
  color: var(--ig-text-subtle);
}

.integration-content {
  display: flex;
  flex-direction: row;
  gap: 1rem;
  min-height: 400px;
}

.integration-tabs {
  flex: 1;
  min-width: 0;
}

.integration-tab-content {
  padding: 1rem;
  min-height: 400px;
}

.habits-section,
.packs-section,
.analytics-section {
  margin-bottom: 2rem;
}

.section-title {
  font-size: 1.125rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
  color: var(--ig-text-primary);
}

.section-subtitle {
  margin: 0 0 1rem;
  color: var(--ig-text-subtle);
  font-size: 0.875rem;
}

.inline-suggestions-container {
  min-height: 200px;
}

.pack-creation-container {
  min-height: 300px;
}

.pack-stats-container {
  min-height: 300px;
}

.pack-stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 1rem;
}

.pack-stat-card {
  background: var(--ig-surface);
  border-radius: 0.5rem;
  padding: 1rem;
  cursor: pointer;
  transition: transform 0.1s, background 0.2s;
  border: 1px solid var(--ig-border-subtle);
}

.pack-stat-card:hover {
  transform: translateY(-2px);
  background: var(--ig-surface-50);
  border-color: var(--ig-primary-300);
}

.pack-stat-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.pack-stat-name {
  font-weight: 600;
  flex: 1;
}

.pack-stat-version {
  font-size: 0.75rem;
  color: var(--ig-text-subtle);
}

.pack-stat-body {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.pack-stat-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.875rem;
}

.pack-stat-label {
  color: var(--ig-text-subtle);
}

.pack-stat-value {
  font-weight: 500;
}

.pack-stat-value.success { color: var(--ig-success-500); }
.pack-stat-value.warning { color: var(--ig-warning-500); }
.pack-stat-value.error { color: var(--ig-error-500); }

.integration-actions {
  width: 250px;
  flex-shrink: 0;
}

.actions-content {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.actions-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--ig-text-primary);
  margin-bottom: 0.5rem;
}

.actions-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 0.75rem;
}

.action-button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem;
  background: var(--ig-surface);
  border: 1px solid var(--ig-border-subtle);
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.2s;
}

.action-button:hover {
  background: var(--ig-surface-50);
  border-color: var(--ig-primary-300);
}

.system-status,
.quick-stats {
  background: var(--ig-surface-50);
  padding: 1rem;
  border-radius: 0.5rem;
}

.status-title,
.stats-title {
  font-size: 0.875rem;
  font-weight: 600;
  margin-bottom: 0.75rem;
}

.status-list,
.stats-grid {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
}

.status-label {
  flex: 1;
}

.status-indicator {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--ig-success-500);
}

.stat-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.75rem;
  background: white;
  border-radius: 0.375rem;
}

.stat-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--ig-primary-500);
}

.stat-label {
  font-size: 0.75rem;
  color: var(--ig-text-subtle);
}

.integration-ui-elements-compact {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
}

.compact-habits,
.compact-stats {
  background: var(--ig-surface-50);
  padding: 1rem;
  border-radius: 0.5rem;
}

.compact-section-title {
  font-size: 0.875rem;
  font-weight: 600;
  margin-bottom: 0.75rem;
}

.compact-stat {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.875rem;
}

.compact-stat-label {
  color: var(--ig-text-subtle);
}

.compact-stat-value {
  font-weight: 600;
  color: var(--ig-primary-500);
}

.placeholder-message {
  color: var(--ig-text-subtle);
  text-align: center;
  font-style: italic;
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
*/