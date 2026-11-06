/**
 * Recording UI Controls Component
 *
 * Main component that integrates all recording UI elements:
 * - RecordingToolbar (start/stop/pause/resume)
 * - RecordingStatusIndicator (visual feedback)
 * - StepPreview (review recorded steps)
 * - StepReorderList (drag-and-drop reordering)
 *
 * Features:
 * - Unified recording interface
 * - State management for recording session
 * - Step preview and reordering
 * - Integration with recording system events
 * - Accessibility support throughout
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';

import type { Recording, RecordingAction } from './recording-types';
import type { RecordingCapturedEvent } from './integration-types';

// Import individual components
import { RecordingToolbar, RecordingToolbarGroup } from './RecordingToolbar';
import { RecordingStatusIndicator, RecordingStatusBadge } from './RecordingStatusIndicator';
import { StepPreview } from './StepPreview';
import { StepReorderList } from './StepReorderList';

/**
 * Recording state types
 */
export type RecordingState = 'idle' | 'recording' | 'paused' | 'processing' | 'completed';

/**
 * Recording UI controls props
 */
export interface RecordingUIControlsProps {
  /** Optional existing recording to edit */
  recording?: Recording;
  
  /** Whether recording is enabled */
  enabled?: boolean;
  
  /** Function to start recording */
  onStartRecording?: (name: string) => void;
  
  /** Function to stop recording */
  onStopRecording?: () => void;
  
  /** Function to pause recording */
  onPauseRecording?: () => void;
  
  /** Function to resume recording */
  onResumeRecording?: () => void;
  
  /** Function to save recording */
  onSaveRecording?: (recording: Recording) => Promise<void>;
  
  /** Function to delete step from recording */
  onDeleteStep?: (recordingId: string, stepIndex: number) => void;
  
  /** Function to reorder steps */
  onReorderSteps?: (recordingId: string, newOrder: RecordingAction[]) => void;
  
  /** Function to update step in recording */
  onUpdateStep?: (recordingId: string, stepIndex: number, action: RecordingAction) => void;
  
  /** Optional event handler for captured events */
  onEvent?: (event: RecordingCapturedEvent) => void;
}

/**
 * RecordingUIControls - Main component integrating all recording UI controls
 *
 * @param props - RecordingUIControlsProps
 * @returns Recording UI controls component
 */
export function RecordingUIControls({
  recording,
  enabled = true,
  onStartRecording,
  onStopRecording,
  onPauseRecording,
  onResumeRecording,
  onSaveRecording,
  onDeleteStep,
  onReorderSteps,
  onUpdateStep,
  onEvent,
}: RecordingUIControlsProps): React.ReactNode {
  // State management
  const [recordingState, setRecordingState] = useState<RecordingState>(
    recording ? (recording.actions.length > 0 ? 'completed' : 'idle') : 'idle'
  );
  
  const [recordingName, setRecordingName] = useState<string>('');
  const [startTime, setStartTime] = useState<string | undefined>(undefined);
  const [actions, setActions] = useState<RecordingAction[]>(recording?.actions || []);
  
  // Refs for managing state
  const isEditingRef = useRef(false);

  // Reset state when recording prop changes
  useEffect(() => {
    if (recording) {
      setRecordingState(recording.actions.length > 0 ? 'completed' : 'idle');
      setActions(recording.actions);
      setRecordingName(recording.name);
    }
  }, [recording]);

  // Start recording handler
  const handleStart = useCallback(() => {
    if (!recordingName.trim()) {
      alert('Please enter a recording name first.');
      return;
    }

    setRecordingState('recording');
    setStartTime(new Date().toISOString());
    
    if (onStartRecording) {
      onStartRecording(recordingName);
    }
  }, [recordingName, onStartRecording]);

  // Stop recording handler
  const handleStop = useCallback(async () => {
    if (recordingState !== 'recording') {
      return;
    }

    setRecordingState('processing');

    // Create recording object
    const newRecording: Recording = {
      id: recording?.id || crypto.randomUUID(),
      name: recordingName,
      actions: actions,
      metadata: {
        createdAt: startTime || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        duration: recording?.metadata?.duration || 0,
        actionCounts: recording?.metadata?.actionCounts || { clicks: 0, keyboard: 0, drags: 0, scrolls: 0, pauses: 0 },
        elementContexts: recording?.metadata?.elementContexts || 0,
        source: recording?.metadata?.source || 'user-capture',
        tags: recording?.metadata?.tags || [],
        version: '1.0.0',
      },
    };

    // Save recording
    if (onSaveRecording) {
      await onSaveRecording(newRecording);
    }

    setRecordingState('completed');
    
    if (onStopRecording) {
      onStopRecording();
    }
  }, [recordingState, recordingName, actions, startTime, recording, onSaveRecording, onStopRecording]);

  // Pause recording handler
  const handlePause = useCallback(() => {
    setRecordingState('paused');
    if (onPauseRecording) {
      onPauseRecording();
    }
  }, [onPauseRecording]);

  // Resume recording handler
  const handleResume = useCallback(() => {
    setRecordingState('recording');
    if (onResumeRecording) {
      onResumeRecording();
    }
  }, [onResumeRecording]);

  // Handle step deletion
  const handleStepDelete = useCallback((stepIndex: number) => {
    const newActions = actions.filter((_, index) => index !== stepIndex);
    setActions(newActions);

    if (onDeleteStep && recording?.id) {
      onDeleteStep(recording.id, stepIndex);
    }
  }, [actions, onDeleteStep, recording?.id]);

  // Handle step reordering
  const handleReorder = useCallback((newOrder: RecordingAction[]) => {
    setActions(newOrder);
    isEditingRef.current = true;

    if (onReorderSteps && recording?.id) {
      onReorderSteps(recording.id, newOrder);
    }
  }, [onReorderSteps, recording?.id]);

  // Handle step update
  const handleStepUpdate = useCallback((stepIndex: number, updatedAction: RecordingAction) => {
    const newActions = [...actions];
    newActions[stepIndex] = updatedAction;
    setActions(newActions);

    if (onUpdateStep && recording?.id) {
      onUpdateStep(recording.id, stepIndex, updatedAction);
    }
  }, [actions, onUpdateStep, recording?.id]);

  // Handle recording name change
  const handleNameChange = useCallback((name: string) => {
    setRecordingName(name);
  }, []);

  // Add captured action (called from outside via ref or event)
  const addCapturedAction = useCallback((action: RecordingAction) => {
    setActions(prev => [...prev, action]);
    if (onEvent) {
      onEvent({
        type: 'RecordingCaptured',
        source: 'recording',
        recordingId: recording?.id || '',
        action,
        actionCount: actions.length + 1,
        durationMs: 0, // Will be calculated when recording stops
      });
    }
  }, [onEvent, recording?.id, actions.length]);

  // Expose methods via ref
  const apiRef = useRef({
    addCapturedAction,
    getActions: () => actions,
    getState: () => recordingState,
    getRecording: () => ({
      id: recording?.id || '',
      name: recordingName,
      actions,
      metadata: {
        createdAt: startTime || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        duration: 0,
        actionCounts: { clicks: 0, keyboard: 0, drags: 0, scrolls: 0, pauses: 0 },
        elementContexts: 0,
        source: 'user-capture' as const,
        tags: [],
        version: '1.0.0',
      },
    }),
  });

  // Determine which buttons to show based on state
  const showStart = recordingState === 'idle' && enabled;
  const showStop = recordingState === 'recording' && enabled;
  const showPause = recordingState === 'recording' && enabled;
  const showResume = recordingState === 'paused' && enabled;
  const showStepPreview = recordingState === 'completed' || recordingState === 'recording';

  return (
    <div className="recording-ui-controls" role="region" aria-label="Recording interface">
      {/* Status Bar */}
      <div className="recording-status-bar">
        <RecordingStatusIndicator
          state={recordingState}
          startTime={startTime}
          actionCount={actions.length}
        />
        <RecordingStatusBadge
          state={recordingState}
          startTime={startTime}
          actionCount={actions.length}
        />
      </div>

      {/* Recording Toolbar */}
      <div className="recording-toolbar-container">
        <RecordingToolbar
          state={recordingState}
          onStart={showStart ? handleStart : undefined}
          onStop={showStop ? handleStop : undefined}
          onPause={showPause ? handlePause : undefined}
          onResume={showResume ? handleResume : undefined}
          disabled={!enabled}
          recordingName={recordingName}
          onNameChange={handleNameChange}
        />
      </div>

      {/* Main Content */}
      <div className="recording-content">
        {/* Step Preview (only show when recording is active or completed) */}
        {showStepPreview && (
          <div className="step-preview-container">
            <StepPreview
              recording={{
                id: recording?.id || '',
                name: recordingName,
                actions,
                metadata: {
                  createdAt: recording?.metadata?.createdAt || startTime || new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                  duration: recording?.metadata?.duration || 0,
                  actionCounts: recording?.metadata?.actionCounts || { clicks: 0, keyboard: 0, drags: 0, scrolls: 0, pauses: 0 },
                  elementContexts: recording?.metadata?.elementContexts || 0,
                  source: recording?.metadata?.source || 'user-capture',
                  tags: recording?.metadata?.tags || [],
                  version: '1.0.0',
                },
              }}
              showDetails={false}
              onStepDelete={handleStepDelete}
              onStepEdit={handleStepUpdate}
              onSave={() => alert('Recording saved successfully!')}
              onCancel={() => alert('Editing cancelled')}
              isEditing={recordingState === 'completed'}
            />
          </div>
        )}

        {/* Step Reorder List (only show when editing is enabled) */}
        {isEditingRef.current && (
          <div className="step-reorder-container">
            <StepReorderList
              actions={actions}
              onReorder={handleReorder}
              onSelect={(index) => console.log('Selected step:', index)}
              selectedIndex={-1}
              isDraggable={true}
            />
          </div>
        )}
      </div>

      {/* Hidden ref for external API access */}
      <div ref={apiRef as any} style={{ display: 'none' }} />
    </div>
  );
}

/**
 * RecordingUIControlsGroup - Container for grouping with other UI elements
 *
 * @param props - Props including title and children
 * @returns Group container component
 */
export function RecordingUIControlsGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <section className="recording-ui-controls-group" aria-labelledby={`group-${title}`}>
      <h2 id={`group-${title}`} className="recording-ui-controls-group-title">
        {title}
      </h2>
      {children}
    </section>
  );
}

// Re-export all components for convenience
export {
  RecordingToolbar,
  RecordingStatusIndicator,
  StepPreview,
  StepReorderList,
};
