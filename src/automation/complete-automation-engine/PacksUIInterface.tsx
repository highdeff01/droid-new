/**
 * Packs UI Interface Component
 *
 * Main interface for the Packs system with complete functionality:
 * - Pack list with metadata display
 * - Real-time search filtering
 * - Pack details view with workflows, version history, execution stats
 * - Deploy button with progress indicator
 * - Integration with existing system (event dispatcher, repositories)
 * - Accessibility support and keyboard navigation
 *
 * Features:
 * - Display pack list with metadata (name, version, author, stats)
 * - Implement real-time search filtering
 * - Show pack details (workflows, version history, execution stats)
 * - Deploy button with progress indicator
 * - Integration with event system and execution feedback
 * - Responsive layout with pack cards and details panel
 */

import React, { useEffectEvent, useState, useCallback, useMemo } from 'react';

import type { Pack } from './pack-types';
import type { PackDeploymentCompleteEvent, PackDeploymentStartedEvent } from './integration-types';
import type { EventDispatcher } from './event-dispatcher';

import { PacksList, PacksListWithDeploy } from './PacksList';
import { PackDeployButton } from './PackDeployButton';
import { IgcTabsComponent, IgcTabComponent } from 'igniteui-react';
import { IgcCardComponent, IgcCardHeaderComponent, IgcCardContentComponent, IgcCardActionsComponent } from 'igniteui-react';
import { IgcButtonComponent } from 'igniteui-react';
import { IgcIconComponent } from 'igniteui-react';

/**
 * Packs UI interface props
 */
export interface PacksUIInterfaceProps {
  /** Array of packs to display */
  packs: Pack[];
  
  /** Optional event dispatcher for subscribing to events */
  eventDispatcher?: EventDispatcher;
  
  /** Optional pack repository for CRUD operations */
  onPackCreate?: (name: string, description?: string) => void;
  
  /** Optional pack delete handler */
  onPackDelete?: (packId: string) => void;
  
  /** Optional pack update handler */
  onPackUpdate?: (packId: string, updates: Partial<Pack>) => void;
  
  /** Optional deployment start handler */
  onDeploymentStart?: (pack: Pack) => Promise<void>;
  
  /** Optional deployment complete handler */
  onDeploymentComplete?: (event: PackDeploymentCompleteEvent) => void;
  
  /** Optional initial selected pack ID */
  initialSelectedPackId?: string;
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
const CardActions = IgcCardActionsComponent;
const Button = IgcButtonComponent;

/**
 * PacksUIInterface - Main packs UI interface component
 *
 * @param props - PacksUIInterfaceProps
 * @returns Packs UI interface component
 */
export function PacksUIInterface({
  packs,
  eventDispatcher,
  onPackCreate,
  onPackDelete,
  onPackUpdate,
  onDeploymentStart,
  onDeploymentComplete,
  initialSelectedPackId,
}: PacksUIInterfaceProps): React.ReactNode {
  const [selectedPackId, setSelectedPackId] = useState<string | undefined>(initialSelectedPackId);
  const [executionHistory, setExecutionHistory] = useState<Record<string, PackDeploymentCompleteEvent[]>>({});
  const [deploymentProgress, setDeploymentProgress] = useState<Record<string, {
    totalWorkflows: number;
    completedWorkflows: number;
    status: 'pending' | 'running' | 'completed' | 'failed';
    errorMessage?: string;
  }>>({});

  // Subscribe to deployment events
  React.useEffect(() => {
    if (!eventDispatcher) {
      return;
    }

    let subscriptionId: string | undefined;

    // Subscribe to PackDeploymentStartedEvent
    subscriptionId = eventDispatcher.subscribe<PackDeploymentStartedEvent>(
      (event: PackDeploymentStartedEvent) => {
        setDeploymentProgress(prev => ({
          ...prev,
          [event.packId]: {
            totalWorkflows: event.workflowCount,
            completedWorkflows: 0,
            status: 'running',
          },
        }));
      },
      { eventType: 'PackDeploymentStarted' }
    );

    return () => {
      if (subscriptionId) {
        eventDispatcher.unsubscribe(subscriptionId);
      }
    };
  }, [eventDispatcher]);

  // Subscribe to PackDeploymentCompleteEvent
  React.useEffect(() => {
    if (!eventDispatcher) {
      return;
    }

    let subscriptionId: string | undefined;

    subscriptionId = eventDispatcher.subscribe<PackDeploymentCompleteEvent>(
      (event: PackDeploymentCompleteEvent) => {
        // Update execution history
        setExecutionHistory(prev => ({
          ...prev,
          [event.packId]: [...(prev[event.packId] || []), event],
        }));

        // Update deployment progress
        const successCount = event.workflowResults.filter(r => r.success).length;
        setDeploymentProgress(prev => ({
          ...prev,
          [event.packId]: {
            totalWorkflows: event.workflowResults.length,
            completedWorkflows: successCount,
            status: event.success ? 'completed' : 'failed',
            errorMessage: event.success ? undefined : 'One or more workflows failed',
          },
        }));

        onDeploymentComplete?.(event);
      },
      { eventType: 'PackDeploymentComplete' }
    );

    return () => {
      if (subscriptionId) {
        eventDispatcher.unsubscribe(subscriptionId);
      }
    };
  }, [eventDispatcher, onDeploymentComplete]);

  // Handle pack selection
  const handlePackSelect = useCallback((pack: Pack) => {
    setSelectedPackId(pack.id);
  }, []);

  // Handle pack deploy
  const handlePackDeploy = useCallback(async (pack: Pack) => {
    if (onDeploymentStart) {
      await onDeploymentStart(pack);
    }
  }, [onDeploymentStart]);

  // Handle pack delete
  const handlePackDelete = useCallback((packId: string) => {
    if (onPackDelete) {
      onPackDelete(packId);
      if (selectedPackId === packId) {
        setSelectedPackId(undefined);
      }
    }
  }, [onPackDelete, selectedPackId]);

  // Handle pack creation
  const handlePackCreate = useCallback(() => {
    if (onPackCreate) {
      const name = prompt('Enter pack name:');
      if (name) {
        const description = prompt('Enter pack description (optional):', '');
        onPackCreate(name, description || undefined);
      }
    }
  }, [onPackCreate]);

  // Filter packs by status
  const getDeploymentStatus = useCallback((packId: string) => {
    const progress = deploymentProgress[packId];
    if (!progress) return 'idle';

    switch (progress.status) {
      case 'running':
        return 'deploying';
      case 'completed':
        return 'deployed';
      case 'failed':
        return 'failed';
      default:
        return 'idle';
    }
  }, [deploymentProgress]);

  return (
    <div className="packs-ui-interface" role="main" aria-label="Packs user interface">
      {/* Header */}
      <header className="packs-ui-header">
        <div className="packs-ui-header-content">
          <h1 className="packs-ui-title">Packs</h1>
          <p className="packs-ui-subtitle">
            Manage your automation packs, version history, and deployments
          </p>
        </div>
        {onPackCreate && (
          <Button
            variant="filled"
            onClick={handlePackCreate}
            aria-label="Create new pack"
          >
            <Icon name="add" slot="icon-start" />
            Create Pack
          </Button>
        )}
      </header>

      {/* Packs List with Deploy */}
      <main className="packs-ui-content">
        <PacksListWithDeploy
          packs={packs}
          selectedPackId={selectedPackId}
          onPackSelect={handlePackSelect}
          onPackDeploy={handlePackDeploy}
          eventDispatcher={eventDispatcher}
          executionHistory={executionHistory}
        />
      </main>

      {/* Quick Stats Panel */}
      <aside className="packs-ui-stats" role="complementary" aria-label="Pack statistics">
        <div className="packs-ui-stats-content">
          <h2 className="packs-ui-stats-title">Statistics</h2>
          
          <div className="packs-ui-stats-grid">
            <Card className="packs-ui-stat-card">
              <CardHeader>
                <h3 className="packs-ui-stat-title">Total Packs</h3>
              </CardHeader>
              <CardContent>
                <span className="packs-ui-stat-value">{packs.length}</span>
              </CardContent>
            </Card>

            <Card className="packs-ui-stat-card">
              <CardHeader>
                <h3 className="packs-ui-stat-title">Total Workflows</h3>
              </CardHeader>
              <CardContent>
                <span className="packs-ui-stat-value">
                  {packs.reduce((sum, pack) => sum + pack.manifest.workflows.length, 0)}
                </span>
              </CardContent>
            </Card>

            <Card className="packs-ui-stat-card">
              <CardHeader>
                <h3 className="packs-ui-stat-title">Deployment History</h3>
              </CardHeader>
              <CardContent>
                <span className="packs-ui-stat-value">
                  {Object.values(executionHistory).reduce((sum, history) => sum + history.length, 0)}
                </span>
              </CardContent>
            </Card>
          </div>

          {/* Deployment Status Summary */}
          <div className="packs-ui-deployment-summary">
            <h3 className="packs-ui-summary-title">Deployment Status</h3>
            <div className="packs-ui-summary-list">
              {packs.map(pack => {
                const status = getDeploymentStatus(pack.id);
                return (
                  <div
                    key={pack.id}
                    className={`packs-ui-summary-item ${status}`}
                    aria-label={`Pack ${pack.name}: ${status}`}
                  >
                    <div className="summary-item-name">
                      <Icon name="code" />
                      {pack.name}
                    </div>
                    <span className="summary-item-status">
                      {status === 'idle' && 'Ready'}
                      {status === 'deploying' && 'Deploying...'}
                      {status === 'deployed' && 'Deployed'}
                      {status === 'failed' && 'Failed'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

/**
 * PacksUIInterfaceTabs - Tabs interface for packs and other modules
 *
 * @param props - Props including children tabs
 * @returns Tabs interface component
 */
export function PacksUIInterfaceTabs({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <Tabs className="packs-ui-tabs">
      {children}
    </Tabs>
  );
}

/**
 * PacksUITab - Individual tab for packs interface
 *
 * @param props - Props including label and children
 * @returns Tab component
 */
export function PacksUITab({
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
 * PacksUIInterfaceCompact - Compact version for embedded use
 *
 * @param props - PacksUIInterfaceProps
 * @returns Compact UI interface
 */
export function PacksUIInterfaceCompact({
  packs,
  eventDispatcher,
  onPackDeploy,
}: PacksUIInterfaceProps): React.ReactNode {
  const [selectedPackId, setSelectedPackId] = useState<string | undefined>(undefined);

  const handlePackSelect = useCallback((pack: Pack) => {
    setSelectedPackId(pack.id);
  }, []);

  const handlePackDeploy = useCallback((pack: Pack) => {
    onPackDeploy?.(pack);
  }, [onPackDeploy]);

  return (
    <div className="packs-ui-interface-compact" role="region" aria-label="Compact packs interface">
      <PacksList
        packs={packs}
        selectedPackId={selectedPackId}
        onPackSelect={handlePackSelect}
        onPackDeploy={handlePackDeploy}
        eventDispatcher={eventDispatcher}
      />
    </div>
  );
}

// Re-export all components for convenience
export {
  PacksList,
  PacksListWithDeploy,
  PackCardList,
  PackCard,
  PackDetailsPanel,
  PackDeployButton,
};