/**
 * Habit Confidence Indicator Component
 *
 * Visualizes habit confidence scores with a percentage-based circular progress indicator.
 * Uses color coding to indicate confidence levels:
 * - Green (success): 80-100% (high confidence)
 * - Yellow (warning): 50-79% (medium confidence)
 * - Red (error): 0-49% (low confidence)
 *
 * Features:
 * - Circular progress bar with SVG
 * - Percentage display in center
 * - Color-coded based on confidence level
 * - Accessibility support with ARIA attributes
 * - Smooth transitions for score updates
 */

import React from 'react';

import type { ConfidenceScores } from './habit-types';
import { IgcProgressBarComponent } from 'igniteui-react';

/**
 * Habit confidence indicator props
 */
export interface HabitConfidenceIndicatorProps {
  /** Confidence scores for the habit */
  confidence: ConfidenceScores;
  
  /** Optional size for the indicator (small, medium, large) */
  size?: 'small' | 'medium' | 'large';
  
  /** Optional label to display above the indicator */
  label?: string;
  
  /** Optional tooltip text for hover information */
  tooltip?: string;
}

/**
 * Icon component wrapper for igniteui-react
 */
const ProgressBar = IgcProgressBarComponent;

/**
 * Get confidence color based on score
 */
function getConfidenceColor(score: number): 'success' | 'warning' | 'error' {
  if (score >= 80) {
    return 'success';
  } else if (score >= 50) {
    return 'warning';
  } else {
    return 'error';
  }
}

/**
 * Get confidence label based on score
 */
function getConfidenceLabel(score: number): string {
  if (score >= 80) {
    return 'High';
  } else if (score >= 50) {
    return 'Medium';
  } else {
    return 'Low';
  }
}

/**
 * Format score as percentage string
 */
function formatPercentage(score: number): string {
  return `${Math.round(score)}%`;
}

/**
 * HabitConfidenceIndicator - Displays confidence score as circular progress indicator
 *
 * @param props - HabitConfidenceIndicatorProps
 * @returns HabitConfidenceIndicator component
 */
export function HabitConfidenceIndicator({
  confidence,
  size = 'medium',
  label,
  tooltip,
}: HabitConfidenceIndicatorProps): React.ReactNode {
  const { overall } = confidence;
  const color = getConfidenceColor(overall);
  const scoreLabel = getConfidenceLabel(overall);

  // Size classes and dimensions
  const sizeClasses = {
    small: 'habit-confidence-small',
    medium: 'habit-confidence-medium',
    large: 'habit-confidence-large',
  };

  const sizeDimensions = {
    small: { width: 60, height: 60, fontSize: '0.75rem' },
    medium: { width: 80, height: 80, fontSize: '1rem' },
    large: { width: 100, height: 100, fontSize: '1.25rem' },
  };

  const dimensions = sizeDimensions[size];

  return (
    <div
      className={`habit-confidence-indicator ${sizeClasses[size]}`}
      role="img"
      aria-label={tooltip || `${label || 'Confidence'}: ${formatPercentage(overall)}, ${scoreLabel}`}
      title={tooltip || `${label || 'Confidence'}: ${formatPercentage(overall)}`}
    >
      {/* Circular progress with SVG */}
      <div
        className="habit-confidence-circle"
        style={{
          width: `${dimensions.width}px`,
          height: `${dimensions.height}px`,
          position: 'relative',
        }}
      >
        {/* Background circle */}
        <svg
          width={dimensions.width}
          height={dimensions.height}
          className="habit-confidence-svg"
          aria-hidden="true"
        >
          <circle
            cx={dimensions.width / 2}
            cy={dimensions.height / 2}
            r={(Math.min(dimensions.width, dimensions.height) / 2) - 8}
            fill="none"
            stroke="currentColor"
            strokeWidth="12"
            className="habit-confidence-track"
            style={{ color: 'var(--ig-surface-300)' }}
          />
          
          {/* Progress circle */}
          <circle
            cx={dimensions.width / 2}
            cy={dimensions.height / 2}
            r={(Math.min(dimensions.width, dimensions.height) / 2) - 8}
            fill="none"
            stroke="currentColor"
            strokeWidth="12"
            strokeDasharray={
              Math.PI * 2 * ((Math.min(dimensions.width, dimensions.height) / 2) - 8)
            }
            strokeDashoffset={
              Math.PI * 2 * ((Math.min(dimensions.width, dimensions.height) / 2) - 8) *
              (1 - overall / 100)
            }
            strokeLinecap="round"
            className="habit-confidence-progress"
            style={{ color: `var(--ig-${color}-500)` }}
            animate="true"
          />
        </svg>

        {/* Center content */}
        <div className="habit-confidence-center">
          {label && (
            <span className="habit-confidence-label" style={{ fontSize: '0.75rem' }}>
              {label}
            </span>
          )}
          <span
            className="habit-confidence-value"
            style={{ fontSize: dimensions.fontSize }}
          >
            {formatPercentage(overall)}
          </span>
          <span
            className="habit-confidence-score"
            style={{ fontSize: '0.6rem', color: `var(--ig-${color}-500)` }}
          >
            {scoreLabel}
          </span>
        </div>
      </div>

      {/* Score details if available */}
      {confidence.success !== undefined && (
        <div className="habit-confidence-details" role="list" aria-label="Confidence breakdown">
          <div className="habit-confidence-detail">
            <span className="habit-confidence-detail-label">Success</span>
            <span className="habit-confidence-detail-value" style={{ color: `var(--ig-${color}-500)` }}>
              {formatPercentage(confidence.success)}
            </span>
          </div>
          <div className="habit-confidence-detail">
            <span className="habit-confidence-detail-label">Frequency</span>
            <span className="habit-confidence-detail-value">
              {formatPercentage(confidence.frequency)}
            </span>
          </div>
          <div className="habit-confidence-detail">
            <span className="habit-confidence-detail-label">Recency</span>
            <span className="habit-confidence-detail-value">
              {formatPercentage(confidence.recency)}
            </span>
          </div>
          <div className="habit-confidence-detail">
            <span className="habit-confidence-detail-label">Feedback</span>
            <span className="habit-confidence-detail-value">
              {formatPercentage(confidence.feedback)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * HabitConfidenceIndicatorSmall - Small variant for compact displays
 */
export function HabitConfidenceIndicatorSmall(props: Omit<HabitConfidenceIndicatorProps, 'size'>): React.ReactNode {
  return <HabitConfidenceIndicator {...props} size="small" />;
}

/**
 * HabitConfidenceIndicatorLarge - Large variant for prominent displays
 */
export function HabitConfidenceIndicatorLarge(props: Omit<HabitConfidenceIndicatorProps, 'size'>): React.ReactNode {
  return <HabitConfidenceIndicator {...props} size="large" />;
}
