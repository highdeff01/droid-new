/**
 * Pack Deploy Button Component
 *
 * Provides deploy functionality with progress indicator for pack deployment:
 * - Deploy button with visual feedback
 * - Progress tracking during deployment
 * - Success/error states
 * - Deployment progress visualization
 * - Accessibility support and keyboard navigation
 *
 * Features:
 * - Start deployment for a pack
 * - Track deployment progress in real-time
 * - Display deployment status and completion
 * - Error handling with user feedback
 * - Integration with pack execution feedback system
 */

import React, { useEffectEvent, useState, useMemo } from 'react';

import type { Pack } from './pack-types';
import type { PackDeploymentStartedEvent, PackDeploymentCompleteEvent } from './integration-types';
import type { EventDispatcher } from './event-dispatcher';

import { IgcButtonComponent } from 'igniteui-react';
import { IgcLinearProgressComponent } from 'igniteui-react';
import { IgcIconComponent } from 'igniteui-react';
import { IgcToastComponent } from 'igniteui-react';
import { IgcSnackbarComponent } from 'igniteui-react';

/**
 * Deployment state types
 */
export type DeploymentState = 'idle' | 'pending' | 'running' | 'completed' | 'failed';

/**
 * Deployment progress information
 */
export interface DeploymentProgress {
  totalWorkflows: number;
  completedWorkflows: number;
  status: DeploymentState;
  errorMessage?: string;
}

/**
 * Pack deploy button props
 */
export interface PackDeployButtonProps {
  /** The pack to deploy */
  pack: Pack;
  
  /** Function to call when deployment starts */
  onDeploymentStart?: (pack: Pack) => void;
  
  /** Function to call when deployment completes */
  onDeploymentComplete?: (event: PackDeploymentCompleteEvent) => void;
  
  /** Optional event dispatcher for subscribing to deployment events */
  eventDispatcher?: EventDispatcher;
  
  /** Whether the button should be disabled */
  disabled?: boolean;
}

/**
 * Icon component wrapper for igniteui-react
 */
const Icon = IgcIconComponent;
const Button = IgcButtonComponent;
const LinearProgress = IgcLinearProgressComponent;
const Toast = IgcToastComponent;
const Snackbar = IgcSnackbarComponent;

/**
 * PackDeployButton - Displays deploy button with progress tracking
 *
 * @param props - PackDeployButtonProps
 * @returns Pack deploy button component
 */
export function PackDeployButton({
  pack,
  onDeploymentStart,
  onDeploymentComplete,
  eventDispatcher,
  disabled = false,
}: PackDeployButtonProps): React.ReactNode {
  const [deploymentState, setDeploymentState] = useState<DeploymentState>('idle');
  const [deploymentProgress, setDeploymentProgress] = useState<DeploymentProgress>({
    totalWorkflows: 0,
    completedWorkflows: 0,
    status: 'idle',
  });
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'info'>('info');

  // Subscribe to deployment events
  React.useEffect(() => {
    if (!eventDispatcher) {
      return;
    }

    const subscriptionId = eventDispatcher.subscribe((event: any) => {
      if (event.type === 'PackDeployed' && event.packId === pack.id) {
        setDeploymentState('running');
        // We need to get the workflow count from somewhere - simplified for now
        setDeploymentProgress({
          totalWorkflows: pack.manifest.workflows.length,
          completedWorkflows: 0,
          status: 'running',
        });
      }
    });

    return () => {
      eventDispatcher.unsubscribe(subscriptionId);
    };
  }, [eventDispatcher, pack.id, pack.manifest.workflows.length]);

  // Handle deployment completion
  React.useEffect(() => {
    if (!eventDispatcher) {
      return;
    }

    const subscriptionId = eventDispatcher.subscribe((event: any) => {
      if (event.type === 'PackDeployed' && event.packId === pack.id) {
        const workflowResults = event.results?.workflowResults || [];
        const successCount = workflowResults.filter((r: any) => r.success).length;
        const total = workflowResults.length;

        setDeploymentState(success ? 'completed' : 'failed');
        setDeploymentProgress({
          totalWorkflows: total,
          completedWorkflows: success ? total : successCount,
          status: success ? 'completed' : 'failed',
          errorMessage: success ? undefined : 'One or more workflows failed',
        });

        setToastMessage(
          success
            ? `Pack "${pack.name}" deployed successfully!`
            : `Pack "${pack.name}" deployment failed. ${total - successCount} workflow(s) failed.`
        );
        setToastType(success ? 'success' : 'error');

        setShowToast(true);
        onDeploymentComplete?.(event as PackDeploymentCompleteEvent);
      }
    });

    return () => {
      eventDispatcher.unsubscribe(subscriptionId);
    };
  }, [eventDispatcher, pack.id, pack.name, onDeploymentComplete]);

  // Extract non-reactive logic
  const handleDeploy = useEffectEvent(() => {
    if (deploymentState === 'running' || disabled) {
      return;
    }

    setDeploymentState('pending');

    // Simulate deployment start (in real implementation, this would call deployment executor)
    const deploymentStartedEvent: PackDeploymentStartedEvent = {
      id: 'event_' + Math.random().toString(36).substring(2),
      type: 'PackDeploymentStarted',
      timestamp: new Date().toISOString(),
      source: 'pack',
      sourceId: pack.id,
      packId: pack.id,
      deploymentId: 'deploy_' + Math.random().toString(36).substring(2),
      version: pack.version.version,
      context: {
        displayState: {
          width: 1920,
          height: 1080,
        },
      },
      workflowCount: pack.manifest.workflows.length,
    };

    if (eventDispatcher) {
      eventDispatcher.emit(deploymentStartedEvent as any);
    }

    setDeploymentProgress({
      totalWorkflows: pack.manifest.workflows.length,
      completedWorkflows: 0,
      status: 'running',
    });

    onDeploymentStart?.(pack);
  });

  // Auto-hide toast after 5 seconds
  React.useEffect(() => {
    if (showToast) {
      const timeout = setTimeout(() => {
        setShowToast(false);
      }, 5000);

      return () => clearTimeout(timeout);
    }
  }, [showToast]);

  // Calculate deployment percentage
  const deploymentPercentage = useMemo(() => {
    if (deploymentProgress.totalWorkflows === 0) {
      return 0;
    }
    return (deploymentProgress.completedWorkflows / deploymentProgress.totalWorkflows) * 100;
  }, [deploymentProgress]);

  // Get button label based on state
  const getButtonLabel = useMemo(() => {
    switch (deploymentState) {
      case 'idle':
        return 'Deploy';
      case 'pending':
        return 'Starting...';
      case 'running':
        return 'Deploying...';
      case 'completed':
        return 'Deployed';
      case 'failed':
        return 'Deploy Failed';
      default:
        return 'Deploy';
    }
  }, [deploymentState]);

  // Get button icon based on state
  const getButtonIcon = useMemo(() => {
    switch (deploymentState) {
      case 'running':
        return 'progress_activity';
      case 'completed':
        return 'check_circle';
      case 'failed':
        return 'error';
      default:
        return 'play_arrow';
    }
  }, [deploymentState]);

  // Get button variant based on state
  const getButtonVariant = useMemo(() => {
    switch (deploymentState) {
      case 'running':
        return 'primary';
      case 'completed':
        return 'success';
      case 'failed':
        return 'error';
      default:
        return 'filled';
    }
  }, [deploymentState]);

  return (
    <div className="pack-deploy-button" role="group" aria-label="Pack deployment controls">
      {/* Progress Bar (show when deploying) */}
      {deploymentState === 'running' && (
        <div className="pack-deploy-progress-container">
          <LinearProgress
            value={deploymentPercentage}
            labelVisibility="always"
            label={`${Math.round(deploymentPercentage)}%`}
            aria-label={`Deployment progress: ${Math.round(deploymentPercentage)}% complete`}
          />
          <span className="pack-deploy-progress-text">
            {deploymentProgress.completedWorkflows} of {deploymentProgress.totalWorkflows} workflows
          </span>
        </div>
      )}

      {/* Deploy Button */}
      <Button
        variant={getButtonVariant()}
        onClick={handleDeploy}
        disabled={disabled || deploymentState === 'pending' || deploymentState === 'running'}
        aria-label={`Deploy pack ${pack.name}`}
        aria-busy={deploymentState === 'running'}
      >
        <Icon name={getButtonIcon()} slot="icon-start" />
        {getButtonLabel()}
      </Button>

      {/* Toast Notification */}
      <Toast
        open={showToast}
        onClose={() => setShowToast(false)}
        position="top-center"
        duration={5000}
      >
        <span className="toast-message" role="alert">
          {toastMessage}
        </span>
      </Toast>

      {/* Error Details (if failed) */}
      {deploymentState === 'failed' && deploymentProgress.errorMessage && (
        <Snackbar
          open={deploymentState === 'failed'}
          actionLabel="Details"
          onActionClick={() => {
            // Show deployment details (implementation dependent)
            console.log('Deployment failed:', deploymentProgress.errorMessage);
          }}
          aria-live="assertive"
        >
          {deploymentProgress.errorMessage}
        </Snackbar>
      )}
    </div>
  );
}

/**
 * PackDeployButtonGroup - Container for grouping deploy buttons
 *
 * @param props - Props including title and children
 * @returns Button group container
 */
export function PackDeployButtonGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div className="pack-deploy-button-group" role="group" aria-labelledby={`deploy-group-${title}`}>
      <h3 id={`deploy-group-${title}`} className="pack-deploy-button-group-title">
        {title}
      </h3>
      {children}
    </div>
  );
}

/**
 * PackDeployButtonList - List of deploy buttons for multiple packs
 *
 * @param props - Props including packs, handlers, and event dispatcher
 * @returns Button list container
 */
export function PackDeployButtonList({
  packs,
  onDeploymentStart,
  onDeploymentComplete,
  eventDispatcher,
}: {
  packs: Pack[];
  onDeploymentStart?: (pack: Pack) => void;
  onDeploymentComplete?: (event: PackDeploymentCompleteEvent) => void;
  eventDispatcher?: EventDispatcher;
}): React.ReactNode {
  return (
    <div className="pack-deploy-button-list" role="list" aria-label="Pack deployment list">
      {packs.map(pack => (
        <PackDeployButton
          key={pack.id}
          pack={pack}
          onDeploymentStart={onDeploymentStart}
          onDeploymentComplete={onDeploymentComplete}
          eventDispatcher={eventDispatcher}
        />
      ))}
    </div>
  );
}