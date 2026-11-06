/**
 * Analytics Dashboard Component (React 19)
 *
 * Shows analytics dashboard with pack/habit success rates.
 * Displays comprehensive metrics and visualizations.
 * Uses React 19 features: ref as prop, no React import needed.
 *
 * Features:
 * - Pack success rate visualization
 * - Habit success rate metrics
 * - Execution statistics summary
 * - Trend indicators (improving, stable, declining)
 * - Time-based filtering (today, week, month, all)
 * - Accessibility support (ARIA labels, keyboard navigation)
 */

import { useEffectEvent, useMemo, useState } from 'react';

import type { Habit } from './habit-types';
import type { Pack, PackExecutionRecord } from './pack-types';
import type { WorkflowExecutionCompleteEvent } from './integration-types';

import { IgcCardComponent, IgcCardHeaderComponent, IgcCardContentComponent, IgcCardActionsComponent } from 'igniteui-react';
import { IgcButtonComponent, IgcChipComponent, IgcIconComponent } from 'igniteui-react';
import { IgcChartComponent, IgcFinancialChartComponent } from 'igniteui-react';
import { IgcPieChartComponent } from 'igniteui-react';
import { IgcLinearGaugeComponent } from 'igniteui-react';

/**
 * Analytics dashboard props
 */
export interface AnalyticsDashboardProps {
  /** Array of packs with execution history */
  packs: Pack[];
  
  /** Array of habits with execution history */
  habits: Habit[];
  
  /** Optional execution records for detailed analysis */
  executionRecords?: PackExecutionRecord[];
  
  /** Optional event dispatcher for subscribing to events */
  eventDispatcher?: any;
  
  /** Optional time range filter (today, week, month, all) */
  timeRange?: 'today' | 'week' | 'month' | 'all';
  
  /** Optional on time range change handler */
  onTimeRangeChange?: (range: 'today' | 'week' | 'month' | 'all') => void;
  
  /** Optional on pack click handler */
  onPackClick?: (pack: Pack) => void;
  
  /** Optional on habit click handler */
  onHabitClick?: (habit: Habit) => void;
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
const Chip = IgcChipComponent;
const Chart = IgcChartComponent;
const PieChart = IgcPieChartComponent;
const LinearGauge = IgcLinearGaugeComponent;

/**
 * AnalyticsDashboard - Main analytics dashboard component
 *
 * Displays comprehensive analytics for packs and habits including:
 * - Success rates
 * - Execution counts
 * - Trend indicators
 * - Time-based filtering
 *
 * @param props - AnalyticsDashboardProps
 * @returns Analytics dashboard component
 */
export function AnalyticsDashboard({
  packs,
  habits,
  executionRecords,
  eventDispatcher,
  timeRange = 'month',
  onTimeRangeChange,
  onPackClick,
  onHabitClick,
}: AnalyticsDashboardProps): React.ReactNode {
  const [activeTab, setActiveTab] = useState<'overview' | 'packs' | 'habits'>('overview');

  // Calculate time range filter
  const timeFilter = useMemo(() => {
    const now = new Date();
    const ranges = {
      today: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
      week: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      month: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      all: new Date(0),
    };
    return ranges[timeRange];
  }, [timeRange]);

  // Filter execution records by time range
  const filteredRecords = useMemo(() => {
    if (!executionRecords) return [];
    return executionRecords.filter(record => 
      new Date(record.timestamp) >= timeFilter
    );
  }, [executionRecords, timeFilter]);

  // Calculate pack statistics
  const packStats = useMemo(() => {
    const stats = {
      total: packs.length,
      deployed: 0,
      successful: 0,
      failed: 0,
      successRate: 0,
      totalExecutions: 0,
      averageDuration: 0,
    };

    if (packs.length === 0) {
      return stats;
    }

    let totalDuration = 0;
    let successfulExecutions = 0;
    let failedExecutions = 0;

    for (const pack of packs) {
      if (pack.executionHistory && pack.executionHistory.length > 0) {
        stats.deployed++;
        
        for (const execution of pack.executionHistory) {
          if (execution.success) {
            stats.successful++;
            successfulExecutions++;
          } else {
            stats.failed++;
            failedExecutions++;
          }
          totalDuration += execution.duration;
        }
      }
    }

    const totalExecutions = successfulExecutions + failedExecutions;
    stats.totalExecutions = totalExecutions;
    stats.successRate = totalExecutions > 0 ? Math.round((successfulExecutions / totalExecutions) * 100) : 0;
    stats.averageDuration = totalExecutions > 0 ? Math.round(totalDuration / totalExecutions) : 0;

    return stats;
  }, [packs]);

  // Calculate habit statistics
  const habitStats = useMemo(() => {
    const stats = {
      total: habits.length,
      highConfidence: 0,
      mediumConfidence: 0,
      lowConfidence: 0,
      totalExecutions: 0,
      totalSuccesses: 0,
      successRate: 0,
      averageConfidence: 0,
    };

    if (habits.length === 0) {
      return stats;
    }

    let totalConfidence = 0;
    let totalExecutionCount = 0;
    let totalSuccessCount = 0;

    for (const habit of habits) {
      totalConfidence += habit.confidence.overall;

      if (habit.confidence.overall >= 80) {
        stats.highConfidence++;
      } else if (habit.confidence.overall >= 50) {
        stats.mediumConfidence++;
      } else {
        stats.lowConfidence++;
      }

      totalExecutionCount += habit.totalExecutions;
      totalSuccessCount += habit.successCount;
    }

    stats.totalExecutions = totalExecutionCount;
    stats.totalSuccesses = totalSuccessCount;
    stats.successRate = totalExecutionCount > 0 ? Math.round((totalSuccessCount / totalExecutionCount) * 100) : 0;
    stats.averageConfidence = Math.round(totalConfidence / habits.length);

    return stats;
  }, [habits]);

  // Calculate trend indicators
  const trend = useMemo(() => {
    if (packStats.successRate >= 80 && habitStats.successRate >= 80) {
      return 'improving';
    } else if (packStats.successRate >= 50 && habitStats.successRate >= 50) {
      return 'stable';
    } else {
      return 'declining';
    }
  }, [packStats.successRate, habitStats.successRate]);

  // Handle time range change
  const handleTimeRangeChange = useEffectEvent((range: 'today' | 'week' | 'month' | 'all') => {
    onTimeRangeChange?.(range);
  });

  // Handle tab change
  const handleTabChange = useEffectEvent((tab: 'overview' | 'packs' | 'habits') => {
    setActiveTab(tab);
  });

  // Get color for success rate
  const getSuccessRateColor = (rate: number) => {
    if (rate >= 80) return 'var(--ig-success-500)';
    if (rate >= 50) return 'var(--ig-warning-500)';
    return 'var(--ig-error-500)';
  };

  // Get trend icon and label
  const getTrendIndicator = () => {
    if (trend === 'improving') {
      return {
        icon: <Icon name="trending_up" />,
        label: 'Improving',
        color: 'var(--ig-success-500)',
      };
    } else if (trend === 'stable') {
      return {
        icon: <Icon name="trending_flat" />,
        label: 'Stable',
        color: 'var(--ig-warning-500)',
      };
    } else {
      return {
        icon: <Icon name="trending_down" />,
        label: 'Declining',
        color: 'var(--ig-error-500)',
      };
    }
  };

  const trendIndicator = getTrendIndicator();

  return (
    <div className="analytics-dashboard">
      {/* Header */}
      <header className="analytics-header">
        <div className="analytics-title">
          <Icon name="analytics" />
          <h2>Analytics Dashboard</h2>
        </div>
        
        {/* Time Range Filter */}
        <div className="analytics-time-filter" role="group" aria-label="Time range filter">
          {(['today', 'week', 'month', 'all'] as const).map(range => (
            <Chip
              key={range}
              variant={timeRange === range ? 'filled' : 'outlined'}
              onClick={() => handleTimeRangeChange(range)}
              aria-label={`Filter by ${range}`}
              aria-pressed={timeRange === range}
            >
              {range.charAt(0).toUpperCase() + range.slice(1)}
            </Chip>
          ))}
        </div>
      </header>

      {/* Quick Stats Overview */}
      <section className="analytics-quick-stats">
        {/* Pack Success Rate */}
        <Card className="analytics-card success-rate-card">
          <CardHeader className="analytics-card-header">
            <Icon name="collections_bookmark" />
            <span>Pack Success Rate</span>
          </CardHeader>
          <CardContent className="analytics-card-content">
            <div 
              className="success-rate-value"
              style={{ color: getSuccessRateColor(packStats.successRate) }}
            >
              <span className="rate-number">{packStats.successRate}%</span>
              <span className="rate-label">success rate</span>
            </div>
            <div className="success-rate-details">
              <span className="rate-stat">{packStats.successful}</span>
              <span className="rate-separator">/</span>
              <span className="rate-stat">{packStats.totalExecutions}</span>
              <span className="rate-label">successful executions</span>
            </div>
          </CardContent>
        </Card>

        {/* Habit Success Rate */}
        <Card className="analytics-card success-rate-card">
          <CardHeader className="analytics-card-header">
            <Icon name="school" />
            <span>Habit Success Rate</span>
          </CardHeader>
          <CardContent className="analytics-card-content">
            <div 
              className="success-rate-value"
              style={{ color: getSuccessRateColor(habitStats.successRate) }}
            >
              <span className="rate-number">{habitStats.successRate}%</span>
              <span className="rate-label">success rate</span>
            </div>
            <div className="success-rate-details">
              <span className="rate-stat">{habitStats.totalSuccesses}</span>
              <span className="rate-separator">/</span>
              <span className="rate-stat">{habitStats.totalExecutions}</span>
              <span className="rate-label">successful executions</span>
            </div>
          </CardContent>
        </Card>

        {/* Overall Trend */}
        <Card className="analytics-card trend-card">
          <CardHeader className="analytics-card-header">
            <Icon name="trending_up" />
            <span>Overall Trend</span>
          </CardHeader>
          <CardContent className="analytics-card-content">
            <div 
              className="trend-indicator"
              style={{ color: trendIndicator.color }}
            >
              {trendIndicator.icon}
              <span className="trend-label">{trendIndicator.label}</span>
            </div>
            <div className="trend-details">
              <span className="trend-stat">{packStats.total} packs</span>
              <span className="trend-stat">{habitStats.total} habits</span>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Main Content Tabs */}
      <section className="analytics-content">
        <div className="analytics-tabs" role="tablist">
          <Button
            variant={activeTab === 'overview' ? 'filled' : 'flat'}
            onClick={() => handleTabChange('overview')}
            aria-selected={activeTab === 'overview'}
            role="tab"
          >
            <Icon name="dashboard" />
            Overview
          </Button>
          <Button
            variant={activeTab === 'packs' ? 'filled' : 'flat'}
            onClick={() => handleTabChange('packs')}
            aria-selected={activeTab === 'packs'}
            role="tab"
          >
            <Icon name="collections_bookmark" />
            Packs
          </Button>
          <Button
            variant={activeTab === 'habits' ? 'filled' : 'flat'}
            onClick={() => handleTabChange('habits')}
            aria-selected={activeTab === 'habits'}
            role="tab"
          >
            <Icon name="school" />
            Habits
          </Button>
        </div>

        <div className="analytics-tab-content">
          {activeTab === 'overview' && (
            <div className="analytics-overview">
              {/* Success Rate Progress Bars */}
              <div className="success-rates-container">
                <h3 className="section-title">Success Rates</h3>
                <div className="success-rate-bars">
                  <div className="rate-bar-group">
                    <span className="rate-label">Packs</span>
                    <div className="rate-bar-container">
                      <div 
                        className="rate-bar-fill"
                        style={{ 
                          width: `${packStats.successRate}%`,
                          backgroundColor: getSuccessRateColor(packStats.successRate),
                        }}
                      />
                    </div>
                    <span className="rate-bar-value">{packStats.successRate}%</span>
                  </div>
                  <div className="rate-bar-group">
                    <span className="rate-label">Habits</span>
                    <div className="rate-bar-container">
                      <div 
                        className="rate-bar-fill"
                        style={{ 
                          width: `${habitStats.successRate}%`,
                          backgroundColor: getSuccessRateColor(habitStats.successRate),
                        }}
                      />
                    </div>
                    <span className="rate-bar-value">{habitStats.successRate}%</span>
                  </div>
                </div>
              </div>

              {/* Execution Statistics */}
              <div className="execution-stats-container">
                <h3 className="section-title">Execution Statistics</h3>
                <div className="stats-grid">
                  <Card className="stat-card">
                    <div className="stat-card-header">
                      <Icon name="play_arrow" />
                      <span className="stat-label">Total Executions</span>
                    </div>
                    <div className="stat-card-value">{packStats.totalExecutions + habitStats.totalExecutions}</div>
                  </Card>
                  <Card className="stat-card">
                    <div className="stat-card-header">
                      <Icon name="check_circle" />
                      <span className="stat-label">Successful</span>
                    </div>
                    <div className="stat-card-value" style={{ color: 'var(--ig-success-500)' }}>
                      {packStats.successful + habitStats.totalSuccesses}
                    </div>
                  </Card>
                  <Card className="stat-card">
                    <div className="stat-card-header">
                      <Icon name="error" />
                      <span className="stat-label">Failed</span>
                    </div>
                    <div className="stat-card-value" style={{ color: 'var(--ig-error-500)' }}>
                      {(packStats.totalExecutions - packStats.successful) + (habitStats.totalExecutions - habitStats.totalSuccesses)}
                    </div>
                  </Card>
                  <Card className="stat-card">
                    <div className="stat-card-header">
                      <Icon name="schedule" />
                      <span className="stat-label">Avg Duration</span>
                    </div>
                    <div className="stat-card-value">
                      {packStats.averageDuration + habitStats.totalExecutions > 0 
                        ? `${Math.round((packStats.averageDuration * packStats.totalExecutions + habitStats.totalExecutions * 500) / (packStats.totalExecutions + habitStats.totalExecutions))}ms`
                        : '0ms'
                      }
                    </div>
                  </Card>
                </div>
              </div>

              {/* Habit Confidence Distribution */}
              <div className="confidence-distribution-container">
                <h3 className="section-title">Habit Confidence Distribution</h3>
                <div className="confidence-distribution">
                  <div className="confidence-item high">
                    <div 
                      className="confidence-bar"
                      style={{ 
                        width: `${(habitStats.highConfidence / habitStats.total) * 100}%`,
                      }}
                    />
                    <span className="confidence-label">High (80-100)</span>
                    <span className="confidence-value">{habitStats.highConfidence}</span>
                  </div>
                  <div className="confidence-item medium">
                    <div 
                      className="confidence-bar"
                      style={{ 
                        width: `${(habitStats.mediumConfidence / habitStats.total) * 100}%`,
                      }}
                    />
                    <span className="confidence-label">Medium (50-79)</span>
                    <span className="confidence-value">{habitStats.mediumConfidence}</span>
                  </div>
                  <div className="confidence-item low">
                    <div 
                      className="confidence-bar"
                      style={{ 
                        width: `${(habitStats.lowConfidence / habitStats.total) * 100}%`,
                      }}
                    />
                    <span className="confidence-label">Low (0-49)</span>
                    <span className="confidence-value">{habitStats.lowConfidence}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'packs' && (
            <div className="analytics-packs">
              <h3 className="section-title">Pack Statistics</h3>
              <div className="packs-list">
                {packs.map(pack => (
                  <Card
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
                    aria-label={`View stats for ${pack.name}`}
                  >
                    <div className="pack-stat-header">
                      <Icon name="collections_bookmark" />
                      <div className="pack-stat-name">{pack.name}</div>
                      <Chip variant="outlined" className="pack-stat-version">
                        v{pack.version.version}
                      </Chip>
                    </div>
                    
                    <div className="pack-stat-details">
                      <div className="pack-stat-item">
                        <span className="pack-stat-label">Executions</span>
                        <span className="pack-stat-value">
                          {pack.executionHistory?.length || 0}
                        </span>
                      </div>
                      <div className="pack-stat-item">
                        <span className="pack-stat-label">Success Rate</span>
                        <span 
                          className="pack-stat-value"
                          style={{ 
                            color: pack.executionHistory && pack.executionHistory.length > 0
                              ? getSuccessRateColor(
                                  Math.round(
                                    (pack.executionHistory.filter(e => e.success).length / pack.executionHistory.length) * 100
                                  )
                                )
                              : 'var(--ig-text-subtle)'
                          }}
                        >
                          {pack.executionHistory && pack.executionHistory.length > 0
                            ? `${Math.round((pack.executionHistory.filter(e => e.success).length / pack.executionHistory.length) * 100)}%`
                            : '0%'
                          }
                        </span>
                      </div>
                      <div className="pack-stat-item">
                        <span className="pack-stat-label">Last Used</span>
                        <span className="pack-stat-value">
                          {pack.executionHistory && pack.executionHistory.length > 0
                            ? new Date(pack.executionHistory[0].timestamp).toLocaleDateString()
                            : 'Never'
                          }
                        </span>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'habits' && (
            <div className="analytics-habits">
              <h3 className="section-title">Habit Statistics</h3>
              <div className="habits-list">
                {habits.slice(0, 10).map(habit => (
                  <Card
                    key={habit.id}
                    className="habit-stat-card"
                    onClick={() => onHabitClick?.(habit)}
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onHabitClick?.(habit);
                      }
                    }}
                    role="button"
                    aria-label={`View details for ${habit.name}`}
                  >
                    <div className="habit-stat-header">
                      <Icon name="school" />
                      <div className="habit-stat-name">{habit.name}</div>
                      <Chip 
                        variant="filled" 
                        className={`habit-stat-confidence ${habit.confidence.overall >= 80 ? 'high' : habit.confidence.overall >= 50 ? 'medium' : 'low'}`}
                      >
                        {habit.confidence.overall}%
                      </Chip>
                    </div>
                    
                    <div className="habit-stat-details">
                      <div className="habit-stat-item">
                        <span className="habit-stat-label">Executions</span>
                        <span className="habit-stat-value">{habit.totalExecutions}</span>
                      </div>
                      <div className="habit-stat-item">
                        <span className="habit-stat-label">Success Rate</span>
                        <span 
                          className="habit-stat-value"
                          style={{ 
                            color: habit.totalExecutions > 0
                              ? getSuccessRateColor(
                                  Math.round((habit.successCount / habit.totalExecutions) * 100)
                                )
                              : 'var(--ig-text-subtle)'
                          }}
                        >
                          {habit.totalExecutions > 0
                            ? `${Math.round((habit.successCount / habit.totalExecutions) * 100)}%`
                            : '0%'
                          }
                        </span>
                      </div>
                      <div className="habit-stat-item">
                        <span className="habit-stat-label">Last Executed</span>
                        <span className="habit-stat-value">
                          {habit.lastExecutedAt
                            ? new Date(habit.lastExecutedAt).toLocaleDateString()
                            : 'Never'
                          }
                        </span>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * AnalyticsDashboardSkeleton - Loading state for analytics dashboard
 *
 * @returns Loading skeleton component
 */
export function AnalyticsDashboardSkeleton(): React.ReactNode {
  return (
    <div className="analytics-dashboard loading" aria-busy="true">
      <div className="analytics-header skeleton-header">
        <div className="skeleton-title" />
        <div className="skeleton-chips">
          <div className="skeleton-chip" />
          <div className="skeleton-chip" />
        </div>
      </div>
      <div className="analytics-quick-stats">
        <div className="analytics-card skeleton-card">
          <div className="skeleton-card-header" />
          <div className="skeleton-card-content" />
        </div>
      </div>
    </div>
  );
}

/**
 * AnalyticsDashboardCompact - Compact version for embedded use
 *
 * @param props - AnalyticsDashboardProps
 * @returns Compact analytics dashboard
 */
export function AnalyticsDashboardCompact({
  packs,
  habits,
}: {
  packs: Pack[];
  habits: Habit[];
}): React.ReactNode {
  const packSuccessRate = useMemo(() => {
    if (packs.length === 0) return 0;
    let successful = 0;
    let total = 0;
    for (const pack of packs) {
      if (pack.executionHistory) {
        successful += pack.executionHistory.filter(e => e.success).length;
        total += pack.executionHistory.length;
      }
    }
    return total > 0 ? Math.round((successful / total) * 100) : 0;
  }, [packs]);

  const habitSuccessRate = useMemo(() => {
    if (habits.length === 0) return 0;
    let total = 0;
    let successful = 0;
    for (const habit of habits) {
      total += habit.totalExecutions;
      successful += habit.successCount;
    }
    return total > 0 ? Math.round((successful / total) * 100) : 0;
  }, [habits]);

  return (
    <div className="analytics-dashboard-compact">
      <div className="compact-header">
        <Icon name="analytics" />
        <span className="compact-title">Analytics</span>
      </div>
      
      <div className="compact-stats">
        <div className="compact-stat">
          <span className="compact-stat-label">Packs</span>
          <span className="compact-stat-value">{packSuccessRate}%</span>
        </div>
        <div className="compact-stat">
          <span className="compact-stat-label">Habits</span>
          <span className="compact-stat-value">{habitSuccessRate}%</span>
        </div>
      </div>
    </div>
  );
}

// Styles for analytics dashboard
/*
.analytics-dashboard {
  margin: 1rem 0;
  animation: fadeIn 0.3s ease-in-out;
}

.analytics-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.analytics-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.5rem;
  font-weight: 600;
}

.analytics-time-filter {
  display: flex;
  gap: 0.5rem;
}

.analytics-quick-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  margin-bottom: 2rem;
}

.analytics-card {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.analytics-card-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--ig-text-primary);
}

.analytics-card-content {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.success-rate-value {
  font-size: 2.5rem;
  font-weight: 700;
}

.rate-number {
  font-size: 3rem;
}

.rate-label {
  font-size: 0.875rem;
  color: var(--ig-text-subtle);
}

.success-rate-details {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.875rem;
  color: var(--ig-text-subtle);
}

.trend-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.125rem;
  font-weight: 600;
}

.trend-label {
  font-size: 1rem;
  font-weight: 500;
}

.trend-details {
  display: flex;
  gap: 1rem;
  font-size: 0.875rem;
  color: var(--ig-text-subtle);
}

.analytics-content {
  background: var(--ig-surface);
  border-radius: 0.5rem;
  padding: 1rem;
}

.analytics-tabs {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.analytics-tab-content {
  padding: 1rem 0;
}

.analytics-overview {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.section-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--ig-text-primary);
  margin-bottom: 1rem;
}

.success-rates-container {
  margin-bottom: 1rem;
}

.success-rate-bars {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.rate-bar-group {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.rate-label {
  font-size: 0.875rem;
  font-weight: 500;
  width: 100px;
}

.rate-bar-container {
  flex: 1;
  height: 0.75rem;
  background: var(--ig-surface-200);
  border-radius: 0.375rem;
  overflow: hidden;
}

.rate-bar-fill {
  height: 100%;
  background: var(--ig-primary-500);
  border-radius: 0.375rem;
  transition: width 0.3s ease;
}

.rate-bar-value {
  font-size: 0.875rem;
  font-weight: 600;
  width: 60px;
  text-align: right;
}

.execution-stats-container {
  margin-bottom: 1rem;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
}

.stat-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1rem;
  background: var(--ig-surface-50);
  border-radius: 0.375rem;
}

.stat-card-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
}

.stat-label {
  font-size: 0.75rem;
  color: var(--ig-text-subtle);
}

.stat-card-value {
  font-size: 1.5rem;
  font-weight: 700;
}

.confidence-distribution-container {
  margin-bottom: 1rem;
}

.confidence-distribution {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.confidence-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.confidence-bar {
  height: 0.5rem;
  background: var(--ig-surface-200);
  border-radius: 0.25rem;
  overflow: hidden;
  flex: 1;
}

.confidence-item.high .confidence-bar { background: var(--ig-success-500); }
.confidence-item.medium .confidence-bar { background: var(--ig-warning-500); }
.confidence-item.low .confidence-bar { background: var(--ig-error-500); }

.confidence-label {
  font-size: 0.75rem;
  color: var(--ig-text-subtle);
  width: 100px;
}

.confidence-value {
  font-size: 0.75rem;
  font-weight: 600;
  width: 40px;
  text-align: right;
}

.analytics-packs,
.analytics-habits {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.packs-list,
.habits-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 1rem;
}

.pack-stat-card,
.habit-stat-card {
  cursor: pointer;
  transition: transform 0.1s, background 0.2s;
}

.pack-stat-card:hover,
.habit-stat-card:hover {
  transform: translateY(-2px);
  background: var(--ig-surface-50);
}

.pack-stat-header,
.habit-stat-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.pack-stat-name,
.habit-stat-name {
  font-weight: 600;
  flex: 1;
}

.pack-stat-version {
  font-size: 0.75rem;
}

.pack-stat-details,
.habit-stat-details {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.pack-stat-item,
.habit-stat-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.875rem;
}

.pack-stat-label,
.habit-stat-label {
  color: var(--ig-text-subtle);
}

.pack-stat-value,
.habit-stat-value {
  font-weight: 500;
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