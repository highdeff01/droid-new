/**
 * Pack Habit Confidence Display Component (React 19)
 *
 * Displays extracted habits with confidence scores in pack results.
 * Shows confidence breakdown with visual indicators.
 * Uses React 19 features: ref as prop, no React import needed.
 *
 * Features:
 * - Confidence score visualization with color coding
 * - Confidence breakdown display (success, frequency, recency, feedback)
 * - Trend indicators (improving, stable, declining)
 * - Habit extraction metadata
 * - Accessibility support (ARIA labels, keyboard navigation)
 */

import { useMemo } from 'react';

import type { Habit, ConfidenceScores } from './habit-types';
import type { PackExecutionRecord } from './pack-types';

import { IgcCardComponent, IgcCardHeaderComponent, IgcCardContentComponent } from 'igniteui-react';
import { IgcProgressBarComponent, IgcChipComponent, IgcIconComponent } from 'igniteui-react';

/**
 * Pack habit confidence display props
 */
export interface PackHabitConfidenceDisplayProps {
  /** Array of habits with confidence scores */
  habits: Habit[];
  
  /** Optional execution record with extraction data */
  executionRecord?: PackExecutionRecord;
  
  /** Optional confidence threshold for display (default: 50) */
  minConfidence?: number;
  
  /** Optional on habit click handler */
  onHabitClick?: (habit: Habit) => void;
  
  /** Optional show breakdown toggle */
  showBreakdown?: boolean;
  
  /** Optional compact mode */
  compact?: boolean;
}

/**
 * Icon component wrapper for igniteui-react
 */
const Icon = IgcIconComponent;
const Card = IgcCardComponent;
const CardHeader = IgcCardHeaderComponent;
const CardContent = IgcCardContentComponent;
const ProgressBar = IgcProgressBarComponent;
const Chip = IgcChipComponent;

/**
 * PackHabitConfidenceDisplay - Display extracted habits with confidence
 *
 * Shows habits extracted from pack execution with confidence scores and breakdown.
 * Provides detailed confidence information and visual indicators.
 *
 * @param props - PackHabitConfidenceDisplayProps
 * @returns Confidence display component
 */
export function PackHabitConfidenceDisplay({
  habits,
  executionRecord,
  minConfidence = 50,
  onHabitClick,
  showBreakdown = false,
  compact = false,
}: PackHabitConfidenceDisplayProps): React.ReactNode {
  // Filter habits by confidence threshold
  const filteredHabits = useMemo(() => {
    return habits.filter(habit => habit.confidence.overall >= minConfidence);
  }, [habits, minConfidence]);

  // Get confidence breakdown
  const breakdown = useMemo(() => {
    const averageSuccess = filteredHabits.reduce((sum, h) => sum + h.confidence.success, 0) / (filteredHabits.length || 1);
    const averageFrequency = filteredHabits.reduce((sum, h) => sum + h.confidence.frequency, 0) / (filteredHabits.length || 1);
    const averageRecency = filteredHabits.reduce((sum, h) => sum + h.confidence.recency, 0) / (filteredHabits.length || 1);
    const averageFeedback = filteredHabits.reduce((sum, h) => sum + h.confidence.feedback, 0) / (filteredHabits.length || 1);

    return {
      success: Math.round(averageSuccess),
      frequency: Math.round(averageFrequency),
      recency: Math.round(averageRecency),
      feedback: Math.round(averageFeedback),
    };
  }, [filteredHabits]);

  // Get trend indicator
  const trend = useMemo(() => {
    if (filteredHabits.length === 0) {
      return 'stable';
    }

    const averageConfidence = filteredHabits.reduce((sum, h) => sum + h.confidence.overall, 0) / filteredHabits.length;
    
    if (averageConfidence >= 80) {
      return 'improving';
    } else if (averageConfidence >= 50) {
      return 'stable';
    } else {
      return 'declining';
    }
  }, [filteredHabits]);

  // Handle habit click
  const handleHabitClick = (habit: Habit) => {
    onHabitClick?.(habit);
  };

  if (filteredHabits.length === 0) {
    return (
      <div 
        className="pack-habit-confidence-display empty" 
        aria-label="No habits with confidence found"
      >
        <p className="confidence-empty-message">
          No habits extracted with sufficient confidence
        </p>
      </div>
    );
  }

  if (compact) {
    // Compact version for constrained UI
    return (
      <div className="pack-habit-confidence-display compact">
        <div 
          className="confidence-summary"
          role="group"
          aria-label="Confidence summary"
        >
          <div 
            className="confidence-bar"
            style={{
              backgroundColor: getConfidenceColor(filteredHabits.reduce((sum, h) => sum + h.confidence.overall, 0) / filteredHabits.length),
            }}
          >
            <span className="confidence-bar-fill" style={{ width: `${filteredHabits.reduce((sum, h) => sum + h.confidence.overall, 0) / filteredHabits.length}%` }} />
          </div>
          <span className="confidence-label">
            {filteredHabits.length} habits • {Math.round(filteredHabits.reduce((sum, h) => sum + h.confidence.overall, 0) / filteredHabits.length)}% confidence
          </span>
        </div>
      </div>
    );
  }

  // Standard version with details
  return (
    <Card className="pack-habit-confidence-display">
      <CardHeader className="confidence-header">
        <div className="confidence-title">
          <Icon name="school" />
          <h3>Extracted Habits</h3>
        </div>
        
        {/* Overall Confidence Indicator */}
        <div className="confidence-indicator">
          <div 
            className="confidence-circle"
            style={{
              backgroundColor: getConfidenceColor(filteredHabits.reduce((sum, h) => sum + h.confidence.overall, 0) / filteredHabits.length),
            }}
          >
            <span className="confidence-value">
              {Math.round(filteredHabits.reduce((sum, h) => sum + h.confidence.overall, 0) / filteredHabits.length)}%
            </span>
          </div>
          <span className="confidence-trend">
            {trend === 'improving' && <Icon name="trending_up" size="x-small" />}
            {trend === 'stable' && <Icon name="trending_flat" size="x-small" />}
            {trend === 'declining' && <Icon name="trending_down" size="x-small" />}
            <span className="trend-label">{trend}</span>
          </span>
        </div>
      </CardHeader>

      <CardContent className="confidence-content">
        {/* Confidence Breakdown */}
        {showBreakdown && (
          <div className="confidence-breakdown">
            <h4 className="breakdown-title">Confidence Breakdown</h4>
            <div className="breakdown-grid">
              {/* Success Rate */}
              <div className="breakdown-item">
                <div className="breakdown-label">
                  <Icon name="check_circle" size="x-small" />
                  <span>Success Rate</span>
                </div>
                <div className="breakdown-bar-container">
                  <ProgressBar value={breakdown.success} style={{ width: '100%' }} />
                  <span className="breakdown-value">{breakdown.success}%</span>
                </div>
              </div>

              {/* Frequency */}
              <div className="breakdown-item">
                <div className="breakdown-label">
                  <Icon name="trending_up" size="x-small" />
                  <span>Frequency</span>
                </div>
                <div className="breakdown-bar-container">
                  <ProgressBar value={breakdown.frequency} style={{ width: '100%' }} />
                  <span className="breakdown-value">{breakdown.frequency}%</span>
                </div>
              </div>

              {/* Recency */}
              <div className="breakdown-item">
                <div className="breakdown-label">
                  <Icon name="schedule" size="x-small" />
                  <span>Recency</span>
                </div>
                <div className="breakdown-bar-container">
                  <ProgressBar value={breakdown.recency} style={{ width: '100%' }} />
                  <span className="breakdown-value">{breakdown.recency}%</span>
                </div>
              </div>

              {/* Feedback */}
              <div className="breakdown-item">
                <div className="breakdown-label">
                  <Icon name="feedback" size="x-small" />
                  <span>User Feedback</span>
                </div>
                <div className="breakdown-bar-container">
                  <ProgressBar value={breakdown.feedback} style={{ width: '100%' }} />
                  <span className="breakdown-value">{breakdown.feedback}%</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Extracted Habits List */}
        <div className="habits-list" role="list" aria-label="Extracted habits">
          {filteredHabits.map((habit, index) => (
            <div
              key={habit.id}
              className="habit-item"
              role="listitem"
              onClick={() => handleHabitClick(habit)}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleHabitClick(habit);
                }
              }}
              aria-label={`${habit.name} - ${habit.confidence.overall}% confidence`}
            >
              <div className="habit-item-header">
                <Icon name="auto_awesome" />
                <div className="habit-name">{habit.name}</div>
              </div>
              
              <div className="habit-confidence">
                <div 
                  className="confidence-bar"
                  style={{
                    backgroundColor: getConfidenceColor(habit.confidence.overall),
                  }}
                >
                  <span 
                    className="confidence-bar-fill" 
                    style={{ width: `${habit.confidence.overall}%` }}
                  />
                </div>
                <span className="confidence-text">
                  {habit.confidence.overall}% confidence
                </span>
              </div>

              {showBreakdown && (
                <div className="habit-breakdown">
                  <span className="breakdown-item">
                    <Icon name="check_circle" size="x-small" />
                    <span>{habit.confidence.success}% success</span>
                  </span>
                  <span className="breakdown-item">
                    <Icon name="trending_up" size="x-small" />
                    <span>{habit.confidence.frequency}% frequent</span>
                  </span>
                  <span className="breakdown-item">
                    <Icon name="schedule" size="x-small" />
                    <span>{habit.confidence.recency}% recent</span>
                  </span>
                </div>
              )}

              {/* Execution Metadata */}
              {habit.totalExecutions > 0 && (
                <div className="habit-execution">
                  <Chip variant="outlined" className="execution-chip">
                    <Icon name="play_arrow" size="x-small" />
                    {habit.totalExecutions} executions
                  </Chip>
                  <Chip variant="outlined" className={`execution-chip ${habit.successCount > habit.failureCount ? 'success' : 'error'}`}>
                    <Icon name="check" size="x-small" />
                    {Math.round((habit.successCount / habit.totalExecutions) * 100)}% success
                  </Chip>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="confidence-summary">
          <div className="summary-item">
            <span className="summary-label">Total Habits:</span>
            <span className="summary-value">{filteredHabits.length}</span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Average Confidence:</span>
            <span className="summary-value">
              {Math.round(filteredHabits.reduce((sum, h) => sum + h.confidence.overall, 0) / filteredHabits.length)}%
            </span>
          </div>
          <div className="summary-item">
            <span className="summary-label">Success Rate:</span>
            <span className="summary-value">
              {filteredHabits.length > 0 
                ? Math.round(filteredHabits.reduce((sum, h) => sum + h.successCount, 0) / filteredHabits.reduce((sum, h) => sum + h.totalExecutions, 0) * 100)
                : 0
              }%
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * PackHabitConfidenceDisplayList - List of confidence displays
 *
 * @param props - Array of habits with other props
 * @returns List of confidence displays
 */
export function PackHabitConfidenceDisplayList({
  habits,
  executionRecord,
  minConfidence = 50,
  onHabitClick,
  showBreakdown = false,
}: {
  habits: Habit[];
  executionRecord?: PackExecutionRecord;
  minConfidence?: number;
  onHabitClick?: (habit: Habit) => void;
  showBreakdown?: boolean;
}): React.ReactNode {
  const groupedHabits = useMemo(() => {
    const highConfidence = habits.filter(h => h.confidence.overall >= 80);
    const mediumConfidence = habits.filter(h => h.confidence.overall >= 50 && h.confidence.overall < 80);
    const lowConfidence = habits.filter(h => h.confidence.overall < 50);

    return { highConfidence, mediumConfidence, lowConfidence };
  }, [habits]);

  return (
    <div className="pack-habit-confidence-display-list">
      {groupedHabits.highConfidence.length > 0 && (
        <div className="confidence-section high-confidence">
          <h4 className="section-title">High Confidence Habits ({groupedHabits.highConfidence.length})</h4>
          <PackHabitConfidenceDisplay
            habits={groupedHabits.highConfidence}
            executionRecord={executionRecord}
            minConfidence={minConfidence}
            onHabitClick={onHabitClick}
            showBreakdown={showBreakdown}
          />
        </div>
      )}

      {groupedHabits.mediumConfidence.length > 0 && (
        <div className="confidence-section medium-confidence">
          <h4 className="section-title">Medium Confidence Habits ({groupedHabits.mediumConfidence.length})</h4>
          <PackHabitConfidenceDisplay
            habits={groupedHabits.mediumConfidence}
            executionRecord={executionRecord}
            minConfidence={minConfidence}
            onHabitClick={onHabitClick}
            showBreakdown={showBreakdown}
          />
        </div>
      )}

      {groupedHabits.lowConfidence.length > 0 && (
        <div className="confidence-section low-confidence">
          <h4 className="section-title">Low Confidence Habits ({groupedHabits.lowConfidence.length})</h4>
          <PackHabitConfidenceDisplay
            habits={groupedHabits.lowConfidence}
            executionRecord={executionRecord}
            minConfidence={minConfidence}
            onHabitClick={onHabitClick}
            showBreakdown={showBreakdown}
          />
        </div>
      )}
    </div>
  );
}

/**
 * PackHabitConfidenceDisplaySkeleton - Loading state for confidence display
 *
 * @returns Loading skeleton component
 */
export function PackHabitConfidenceDisplaySkeleton(): React.ReactNode {
  return (
    <Card className="pack-habit-confidence-display loading" aria-busy="true">
      <CardHeader className="skeleton-header">
        <div className="skeleton-title" />
        <div className="skeleton-confidence" />
      </CardHeader>
      <CardContent className="skeleton-content">
        <div className="skeleton-breakdown" />
        <div className="skeleton-list">
          <div className="skeleton-item" />
          <div className="skeleton-item" />
        </div>
      </CardContent>
    </Card>
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

// Styles for pack habit confidence display
/*
.pack-habit-confidence-display {
  margin: 1rem 0;
  animation: fadeIn 0.3s ease-in-out;
}

.pack-habit-confidence-display.compact {
  padding: 0.75rem;
  border-radius: 0.375rem;
  background: var(--ig-surface-50);
}

.confidence-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.confidence-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.125rem;
  font-weight: 600;
}

.confidence-indicator {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.confidence-circle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 4rem;
  height: 4rem;
  border-radius: 50%;
  color: white;
  font-size: 1.5rem;
  font-weight: 700;
}

.confidence-trend {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.875rem;
  font-weight: 500;
}

.breakdown-title {
  font-size: 0.875rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
  color: var(--ig-text-primary);
}

.breakdown-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
  margin-bottom: 1rem;
}

.breakdown-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.breakdown-label {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: var(--ig-text-subtle);
}

.breakdown-bar-container {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.breakdown-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--ig-text-primary);
}

.habits-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.habit-item {
  padding: 1rem;
  border: 1px solid var(--ig-border-subtle);
  border-radius: 0.375rem;
  cursor: pointer;
  transition: all 0.2s;
}

.habit-item:hover {
  background: var(--ig-surface-50);
  border-color: var(--ig-primary-300);
}

.habit-item-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.habit-name {
  font-weight: 600;
  color: var(--ig-text-primary);
}

.habit-confidence {
  margin-bottom: 0.5rem;
}

.confidence-bar {
  height: 0.5rem;
  border-radius: 0.25rem;
  overflow: hidden;
  background: var(--ig-surface-200);
}

.confidence-bar-fill {
  height: 100%;
  background: var(--ig-primary-500);
  transition: width 0.3s ease;
}

.confidence-text {
  font-size: 0.75rem;
  color: var(--ig-text-subtle);
  margin-top: 0.25rem;
  display: block;
}

.habit-breakdown {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
  font-size: 0.75rem;
}

.breakdown-item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--ig-text-subtle);
}

.habit-execution {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.execution-chip {
  font-size: 0.75rem;
  padding: 0.25rem 0.5rem;
}

.confidence-summary {
  display: flex;
  gap: 1.5rem;
  padding: 0.75rem;
  background: var(--ig-surface-50);
  border-radius: 0.375rem;
}

.summary-item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.summary-label {
  font-size: 0.75rem;
  color: var(--ig-text-subtle);
}

.summary-value {
  font-size: 1rem;
  font-weight: 600;
  color: var(--ig-text-primary);
}

.confidence-section {
  margin-bottom: 1.5rem;
}

.section-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--ig-text-primary);
  margin-bottom: 0.5rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.high-confidence .section-title { color: var(--ig-success-500); }
.medium-confidence .section-title { color: var(--ig-warning-500); }
.low-confidence .section-title { color: var(--ig-error-500); }

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