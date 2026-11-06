/**
 * Recording Status Indicator Component
 *
 * Provides visual feedback during active recording sessions.
 * Displays recording duration, action count, and current state with
 * accessible indicators for screen readers.
 *
 * Features:
 * - Real-time duration display
 * - Action count tracking
 * - Visual recording indicator (pulse animation)
 * - Status text with screen reader support
 * - Responsive design for different screen sizes
 */

import React, { useEffect, useMemo, useCallback } from 'react';

/**
 * Recording status props
 */
export interface RecordingStatusIndicatorProps {
  /** Current recording state */
  state: 'idle' | 'recording' | 'paused' | 'processing';
  
  /** Recording start time (ISO string or timestamp) */
  startTime?: string;
  
  /** Number of actions captured */
  actionCount?: number;
  
  /** Optional duration override (in milliseconds) */
  duration?: number;
  
  /** Whether to show additional details */
  showDetails?: boolean;
}

/**
 * RecordingStatusIndicator - Main status indicator component
 *
 * @param props - RecordingStatusIndicatorProps
 * @returns Status indicator component
 */
export function RecordingStatusIndicator({
  state,
  startTime,
  actionCount = 0,
  duration: overrideDuration,
  showDetails = false,
}: RecordingStatusIndicatorProps): React.ReactNode {
  // Calculate duration based on state and start time
  const currentDuration = useMemo(() => {
    if (overrideDuration !== undefined) {
      return overrideDuration;
    }

    if (state === 'recording' && startTime) {
      const start = new Date(startTime).getTime();
      const now = Date.now();
      return Math.max(0, now - start);
    }

    return 0;
  }, [state, startTime, overrideDuration]);

  // Format duration as mm:ss.ms
  const formattedDuration = useMemo(() => {
    const milliseconds = Math.floor(currentDuration % 1000);
    const seconds = Math.floor((currentDuration / 1000) % 60);
    const minutes = Math.floor((currentDuration / (1000 * 60)) % 60);

    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
  }, [currentDuration]);

  // Screen reader text for current state
  const screenReaderText = useMemo(() => {
    switch (state) {
      case 'recording':
        return `Recording in progress. Duration: ${formattedDuration}. Actions captured: ${actionCount}.`;
      case 'paused':
        return `Recording paused. Duration so far: ${formattedDuration}.`;
      case 'processing':
        return 'Processing recording. Please wait.';
      case 'idle':
      default:
        return 'Recording ready to start.';
    }
  }, [state, formattedDuration, actionCount]);

  // Get status icon based on state
  const getStatusIcon = useCallback(() => {
    switch (state) {
      case 'recording':
        return (
          <span
            className="recording-status-icon recording-icon"
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="currentColor"
            >
              <circle cx="12" cy="12" r="10" />
            </svg>
          </span>
        );

      case 'paused':
        return (
          <span
            className="recording-status-icon paused-icon"
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="currentColor"
            >
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          </span>
        );

      case 'processing':
        return (
          <span
            className="recording-status-icon processing-icon"
            aria-hidden="true"
          >
            <svg
              className="recording-status-spinner"
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle
                cx="12"
                cy="12"
                r="10"
                strokeOpacity="0.25"
              />
              <path
                d="M12 2a10 10 0 0 1 10 10"
                strokeOpacity="0.75"
                strokeLinecap="round"
              />
            </svg>
          </span>
        );

      case 'idle':
      default:
        return (
          <span
            className="recording-status-icon idle-icon"
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 24 24"
              width="24"
              height="24"
              fill="currentColor"
            >
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
            </svg>
          </span>
        );
    }
  }, [state]);

  return (
    <div
      className={`recording-status-indicator ${state}`}
      role="status"
      aria-live={state === 'recording' ? 'polite' : 'off'}
      aria-atomic="true"
    >
      {/* Status icon */}
      <div className="recording-status-icon-container">
        {getStatusIcon()}
      </div>

      {/* Status text */}
      <div className="recording-status-text">
        <span className="status-main-text">
          {state === 'recording' && 'Recording'}
          {state === 'paused' && 'Paused'}
          {state === 'processing' && 'Processing'}
          {state === 'idle' && 'Ready'}
        </span>
        <span className="status-secondary-text">
          {formattedDuration} • {actionCount} action{actionCount !== 1 && 's'}
        </span>
      </div>

      {/* Additional details (optional) */}
      {showDetails && (
        <div className="recording-status-details">
          <div className="detail-item">
            <span className="detail-label">Duration:</span>
            <span className="detail-value">{formattedDuration}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Actions:</span>
            <span className="detail-value">{actionCount}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">State:</span>
            <span className="detail-value" aria-label={`Recording is currently ${state}`}>
              {state}
            </span>
          </div>
        </div>
      )}

      {/* Screen reader only text */}
      <div className="sr-only" aria-live="polite">
        {screenReaderText}
      </div>
    </div>
  );
}

/**
 * RecordingStatusBadge - Small badge for compact displays
 *
 * @param props - RecordingStatusIndicatorProps without showDetails
 * @returns Badge component
 */
export function RecordingStatusBadge({
  state,
  startTime,
  actionCount = 0,
}: RecordingStatusIndicatorProps): React.ReactNode {
  const duration = useMemo(() => {
    if (state === 'recording' && startTime) {
      const start = new Date(startTime).getTime();
      const now = Date.now();
      return Math.max(0, now - start);
    }
    return 0;
  }, [state, startTime]);

  const seconds = Math.floor(duration / 1000);
  
  const getStatusColor = useCallback(() => {
    switch (state) {
      case 'recording':
        return 'recording';
      case 'paused':
        return 'paused';
      case 'processing':
        return 'processing';
      default:
        return 'idle';
    }
  }, [state]);

  return (
    <span className={`recording-status-badge ${getStatusColor()}`}>
      <span className="badge-duration">{seconds}s</span>
      <span className="badge-actions">{actionCount}</span>
    </span>
  );
}