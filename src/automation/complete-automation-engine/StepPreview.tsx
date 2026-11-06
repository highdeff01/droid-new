/**
 * Step Preview Component
 *
 * Displays a preview of recorded steps after recording completes.
 * Shows action summary, timing information, and element context.
 * Includes inline editing capabilities for step adjustments.
 *
 * Features:
 * - Action type icons for each step
 * - Timestamp and duration display
 * - Element context (selector, accessible name)
 * - Step details expansion
 * - Edit and delete actions
 */

import React, { useState, useMemo } from 'react';

import type { RecordingAction, Recording } from './recording-types';

/**
 * Step preview props
 */
export interface StepPreviewProps {
  /** Recording object to preview */
  recording?: Recording;
  
  /** Whether to show action details (expanded by default for new recordings) */
  showDetails?: boolean;
  
  /** Function to call when a step is edited */
  onStepEdit?: (stepIndex: number, updatedAction: RecordingAction) => void;
  
  /** Function to call when a step is deleted */
  onStepDelete?: (stepIndex: number) => void;
  
  /** Function to call when recording is saved */
  onSave?: () => void;
  
  /** Function to call when editing is cancelled */
  onCancel?: () => void;
  
  /** Whether the component is in editing mode */
  isEditing?: boolean;
}

/**
 * Get human-readable action type label
 */
function getActionLabel(actionType: RecordingAction['type']): string {
  const labels: Record<RecordingAction['type'], string> = {
    click: 'Click',
    keyboard: 'Keyboard',
    drag: 'Drag',
    scroll: 'Scroll',
    pause: 'Pause',
  };

  return labels[actionType] || 'Action';
}

/**
 * Get action icon based on type
 */
function getActionIcon(actionType: RecordingAction['type']): React.ReactNode {
  switch (actionType) {
    case 'click':
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
        </svg>
      );

    case 'keyboard':
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M20 5h-3V3c0-1.1-.9-2-2-2H9c-1.1 0-2 .9-2 2v2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-7 3h3v2h-3V8zm-2 0H8v2h3V8zm-3 0H5v2h3V8zm9 3h3v2h-3v-2zm-2 0H8v2h3v-2zm-3 0H5v2h3v-2zm9 3h3v2h-3v-2zm-2 0H8v2h3v-2zm-3 0H5v2h3v-2zm9 3h3v2h-3v-2zm-2 0H8v2h3v-2zm-3 0H5v2h3v-2z" />
        </svg>
      );

    case 'drag':
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-2 8h-6v-2h6v2zm0-4h-6v-2h6v2z" />
        </svg>
      );

    case 'scroll':
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M20 15.5c-1.25 0-2.45-.2-3.57-.57-.35-.1-.74-.03-1.02.24l-2.8 2.8c-.64.64-.18 1.73.65 1.73H15c2.21 0 4-1.79 4-4v-3h2v3zm-4-9c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-8 5c0 2.21 1.79 4 4 4v3H6c-2.21 0-4-1.79-4-4V10H2v3zm12 4.5c-1.25 0-2.45-.2-3.57-.57-.35-.1-.74-.03-1.02.24l-2.8 2.8c-.64.64-.18 1.73.65 1.73H15c2.21 0 4-1.79 4-4v-3h2v3zM12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z" />
        </svg>
      );

    case 'pause':
      return (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
        </svg>
      );
  }
}

/**
 * Format timestamp to readable time
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString();
}

/**
 * Format action details for display
 */
function formatActionDetails(action: RecordingAction): string {
  switch (action.type) {
    case 'click':
      return `Position: ${Math.round(action.x * 100)}%, ${Math.round(action.y * 100)}% | Button: ${action.button} | Count: ${action.clickCount}`;
    
    case 'keyboard':
      return `Keys: ${action.keys.join(' + ')}${action.text ? ` | Text: "${action.text}"` : ''}`;
    
    case 'drag':
      return `From: ${Math.round(action.startX * 100)}%,${Math.round(action.startY * 100)}% → To: ${Math.round(action.endX * 100)}%,${Math.round(action.endY * 100)}%`;
    
    case 'scroll':
      return `Position: ${Math.round(action.x * 100)}%,${Math.round(action.y * 100)}%${action.deltaX ? ` ΔX:${action.deltaX}` : ''}${action.deltaY ? ` ΔY:${action.deltaY}` : ''}`;
    
    case 'pause':
      return `Duration: ${action.duration}ms`;
  }
}

/**
 * StepPreview - Main component for displaying recorded steps
 *
 * @param props - StepPreviewProps
 * @returns Step preview component
 */
export function StepPreview({
  recording,
  showDetails = false,
  onStepEdit,
  onStepDelete,
  onSave,
  onCancel,
  isEditing = false,
}: StepPreviewProps): React.ReactNode {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [editMode, setEditMode] = useState(false);

  // Toggle step expansion
  const toggleStepExpansion = useCallback((index: number) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  // Handle start editing
  const startEditing = useCallback(() => {
    setEditMode(true);
  }, []);

  // Handle save
  const handleSave = useCallback(() => {
    onSave?.();
    setEditMode(false);
  }, [onSave]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    setEditMode(false);
    onCancel?.();
  }, [onCancel]);

  // Handle step edit
  const handleStepEdit = useCallback((index: number, updatedAction: RecordingAction) => {
    onStepEdit?.(index, updatedAction);
  }, [onStepEdit]);

  // Handle step delete
  const handleStepDelete = useCallback((index: number) => {
    if (confirm('Are you sure you want to delete this step?')) {
      onStepDelete?.(index);
    }
  }, [onStepDelete]);

  // No recording data
  if (!recording || !recording.actions || recording.actions.length === 0) {
    return (
      <div className="step-preview no-steps">
        <div className="empty-state">
          <div className="empty-icon">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" />
            </svg>
          </div>
          <p className="empty-text">
            {isEditing ? 'No steps recorded yet. Start recording to add steps.' : 'No recording available.'}
          </p>
          {isEditing && (
            <button
              className="btn-primary"
              onClick={() => alert('Please start recording to capture steps')}
            >
              Start Recording
            </button>
          )}
        </div>
      </div>
    );
  }

  // Recording actions list
  const actions = recording.actions;

  return (
    <div className="step-preview">
      {/* Header */}
      <div className="step-preview-header">
        <div className="step-preview-title">
          <h2>Step Preview</h2>
          <span className="step-count">{actions.length} step{actions.length !== 1 && 's'}</span>
        </div>
        <div className="step-preview-actions">
          {!editMode ? (
            <button
              className="btn-edit"
              onClick={startEditing}
              disabled={!isEditing}
              title={isEditing ? 'Edit steps' : 'Recording must be completed first'}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
              </svg>
              Edit
            </button>
          ) : (
            <>
              <button
                className="btn-save"
                onClick={handleSave}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z" />
                </svg>
                Save
              </button>
              <button
                className="btn-cancel"
                onClick={handleCancel}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                </svg>
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {/* Recording metadata summary */}
      <div className="step-preview-summary">
        <div className="summary-item">
          <span className="summary-label">Duration:</span>
          <span className="summary-value">{Math.round(recording.metadata.duration)}ms</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">Created:</span>
          <span className="summary-value">{new Date(recording.metadata.createdAt).toLocaleString()}</span>
        </div>
        {recording.metadata.tags && recording.metadata.tags.length > 0 && (
          <div className="summary-item tags">
            <span className="summary-label">Tags:</span>
            <span className="summary-value">{recording.metadata.tags.join(', ')}</span>
          </div>
        )}
      </div>

      {/* Steps list */}
      <ul className="step-list" role="list" aria-label="Recording steps">
        {actions.map((action, index) => {
          const isExpanded = expandedSteps.has(index);

          return (
            <li
              key={`${action.timestamp}-${index}`}
              className={`step-item ${editMode ? 'editable' : ''}`}
              onClick={() => toggleStepExpansion(index)}
              role="button"
              aria-expanded={isExpanded}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleStepExpansion(index);
                }
              }}
            >
              {/* Step header */}
              <div className="step-header">
                <div className="step-number">{index + 1}</div>
                <div className="step-info">
                  <div className="step-type">
                    <span className="step-type-icon">
                      {getActionIcon(action.type)}
                    </span>
                    <span className="step-type-label">{getActionLabel(action.type)}</span>
                  </div>
                  <div className="step-timestamp">
                    {formatTimestamp(action.timestamp)}
                  </div>
                </div>
                <div className="step-duration">
                  {action.type === 'pause' ? `${action.duration}ms` : ''}
                </div>
                {editMode && (
                  <div className="step-actions">
                    <button
                      className="step-delete-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStepDelete(index);
                      }}
                      title="Delete step"
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                        <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>

              {/* Step details (expandable) */}
              {isExpanded && (
                <div className="step-details">
                  <div className="step-detail-item">
                    <span className="detail-label">Timestamp:</span>
                    <span className="detail-value">{action.timestamp}</span>
                  </div>
                  <div className="step-detail-item">
                    <span className="detail-label">Details:</span>
                    <span className="detail-value">{formatActionDetails(action)}</span>
                  </div>
                  {action.context && (
                    <>
                      {action.context.selector && (
                        <div className="step-detail-item">
                          <span className="detail-label">Selector:</span>
                          <code className="detail-value selector">{action.context.selector}</code>
                        </div>
                      )}
                      {action.context.accessibleName && (
                        <div className="step-detail-item">
                          <span className="detail-label">Accessible Name:</span>
                          <span className="detail-value">{action.context.accessibleName}</span>
                        </div>
                      )}
                      {action.context.domPath && (
                        <div className="step-detail-item">
                          <span className="detail-label">DOM Path:</span>
                          <span className="detail-value">{action.context.domPath}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Footer */}
      <div className="step-preview-footer">
        <div className="preview-stats">
          <span>Total duration: {Math.round(recording.metadata.duration)}ms</span>
          <span>•</span>
          <span>Actions: {actions.length}</span>
        </div>
        {editMode && (
          <button
            className="btn-add-step"
            onClick={() => alert('Add step feature coming soon')}
            disabled={true}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
            </svg>
            Add Step
          </button>
        )}
      </div>
    </div>
  );
}