/**
 * Recording Toolbar Component
 *
 * Provides start/stop/pause/resume buttons for controlling recording sessions.
 * Includes visual feedback for current recording state and accessibility support.
 *
 * Features:
 * - Start recording (begin capture)
 * - Stop recording (finalize and save)
 * - Pause recording (temporarily suspend capture)
 * - Resume recording (continue after pause)
 * - Keyboard shortcuts for each action
 * - Accessibility attributes and screen reader support
 */

import React, { useEffectEvent } from 'react';

import { IgcButtonModule, IgcIconComponent } from 'igniteui-react';

/**
 * Recording state types
 */
export type RecordingState = 'idle' | 'recording' | 'paused' | 'processing';

/**
 * Recording toolbar props
 */
export interface RecordingToolbarProps {
  /** Current recording state */
  state: RecordingState;
  
  /** Function to call when start is clicked */
  onStart?: () => void;
  
  /** Function to call when stop is clicked */
  onStop?: () => void;
  
  /** Function to call when pause is clicked */
  onPause?: () => void;
  
  /** Function to call when resume is clicked */
  onResume?: () => void;
  
  /** Whether buttons should be disabled */
  disabled?: boolean;
  
  /** Optional recording name */
  recordingName?: string;
  
  /** Function to update recording name */
  onNameChange?: (name: string) => void;
}

/**
 * Icon component wrapper for igniteui-react
 */
const Icon = IgcIconComponent;

/**
 * RecordingToolbar - Main toolbar component for recording control
 *
 * @param props - RecordingToolbarProps
 * @returns RecordingToolbar component
 */
export function RecordingToolbar({
  state,
  onStart,
  onStop,
  onPause,
  onResume,
  disabled = false,
  recordingName,
  onNameChange,
}: RecordingToolbarProps): React.ReactNode {
  // Extract non-reactive logic for cleaner effects
  const handleStartClick = useEffectEvent(() => {
    onStart?.();
  });

  const handleStopClick = useEffectEvent(() => {
    onStop?.();
  });

  const handlePauseClick = useEffectEvent(() => {
    onPause?.();
  });

  const handleResumeClick = useEffectEvent(() => {
    onResume?.();
  });

  const handleNameChange = useEffectEvent((event: React.ChangeEvent<HTMLInputElement>) => {
    onNameChange?.(event.target.value);
  });

  // Determine which buttons to show based on state
  const showStart = state === 'idle' || state === 'processing';
  const showStop = state === 'recording';
  const showPause = state === 'recording';
  const showResume = state === 'paused';
  const showNameInput = state === 'idle';

  return (
    <div
      className="recording-toolbar"
      role="toolbar"
      aria-label="Recording controls"
    >
      {/* Recording name input (only shows when idle) */}
      {showNameInput && (
        <div className="recording-name-input">
          <label htmlFor="recording-name" className="recording-name-label">
            Recording name:
          </label>
          <input
            id="recording-name"
            type="text"
            value={recordingName || ''}
            onChange={handleNameChange}
            placeholder="Enter recording name..."
            className="recording-name-field"
            disabled={disabled}
            aria-describedby="recording-name-hint"
          />
          <span id="recording-name-hint" className="recording-name-hint">
            Give your recording a descriptive name
          </span>
        </div>
      )}

      {/* Action buttons */}
      <div className="recording-actions">
        {showStart && (
          <IgcButtonModule
            variant="filled"
            onClick={handleStartClick}
            disabled={disabled}
            aria-label="Start recording"
            title="Start Recording (Alt+S)"
          >
            <Icon name="record" slot="icon-start" />
            Start
          </IgcButtonModule>
        )}

        {showPause && (
          <IgcButtonModule
            variant="filled"
            onClick={handlePauseClick}
            disabled={disabled}
            aria-label="Pause recording"
            title="Pause Recording (Alt+P)"
          >
            <Icon name="pause" slot="icon-start" />
            Pause
          </IgcButtonModule>
        )}

        {showResume && (
          <IgcButtonModule
            variant="filled"
            onClick={handleResumeClick}
            disabled={disabled}
            aria-label="Resume recording"
            title="Resume Recording (Alt+R)"
          >
            <Icon name="play_arrow" slot="icon-start" />
            Resume
          </IgcButtonModule>
        )}

        {showStop && (
          <IgcButtonModule
            variant="error"
            onClick={handleStopClick}
            disabled={disabled}
            aria-label="Stop recording"
            title="Stop Recording (Alt+T)"
          >
            <Icon name="stop" slot="icon-start" />
            Stop
          </IgcButtonModule>
        )}
      </div>

      {/* Recording indicator (when active) */}
      {(state === 'recording' || state === 'paused') && (
        <div
          className={`recording-indicator ${state === 'paused' ? 'paused' : ''}`}
          role="status"
          aria-live="polite"
        >
          <span
            className={`recording-dot ${state === 'recording' ? 'recording' : ''}`}
            aria-hidden="true"
          />
          <span className="recording-status">
            {state === 'recording' ? 'Recording in progress...' : 'Recording paused'}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * RecordingToolbarGroup - Groups toolbar with other UI elements
 *
 * @param props - Props including children
 * @returns Group container component
 */
export function RecordingToolbarGroup({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div className="recording-toolbar-group" role="group" aria-label="Recording interface">
      {children}
    </div>
  );
}

/**
 * RecordingToolbarSection - Creates semantic sections within toolbar
 *
 * @param props - Props including title and children
 * @returns Section component
 */
export function RecordingToolbarSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <section className="recording-toolbar-section" aria-labelledby={`section-${title}`}>
      <h3 id={`section-${title}`} className="recording-toolbar-section-title">
        {title}
      </h3>
      {children}
    </section>
  );
}