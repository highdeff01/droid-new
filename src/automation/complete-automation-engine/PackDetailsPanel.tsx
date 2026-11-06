/**
 * Pack Details Panel Component
 *
 * Displays detailed information about a selected pack including:
 * - Full pack metadata
 * - List of workflows in the pack
 * - Version history
 * - Execution statistics
 * - Deployment progress
 * - Accessibility support and keyboard navigation
 *
 * Features:
 * - Comprehensive pack details view
 * - Workflow list with details
 * - Version history timeline
 * - Execution stats visualization
 * - Deployment progress tracking
 * - Collapsible sections for better UX
 */

import React, { useEffectEvent, useState } from 'react';

import type { Pack } from './pack-types';
import type { PackDeploymentCompleteEvent } from './integration-types';
import type { ExecutionMetrics } from './integration-types';

import { IgcTabsComponent, IgcTabComponent } from 'igniteui-react';
import { IgcCardContentComponent } from 'igniteui-react';
import { IgcListComponent, IgcListItemComponent } from 'igniteui-react';
import { IgcProgressComponent } from 'igniteui-react';
import { IgcIconComponent } from 'igniteui-react';

/**
 * Pack details panel props
 */
export interface PackDetailsPanelProps {
  /** The pack to display details for */
  pack: Pack;
  
  /** Whether the panel is expanded */
  expanded?: boolean;
  
  /** Function to call when panel is closed */
  onClose?: () => void;
  
  /** Function to call when deploy is clicked */
  onDeploy?: () => void;
  
  /** Optional execution history for this pack */
  executionHistory?: PackDeploymentCompleteEvent[];
  
  /** Optional current deployment progress */
  deploymentProgress?: {
    totalWorkflows: number;
    completedWorkflows: number;
    status: 'pending' | 'running' | 'completed' | 'failed';
    errorMessage?: string;
  };
}

/**
 * Icon component wrapper for igniteui-react
 */
const Icon = IgcIconComponent;
const Tabs = IgcTabsComponent;
const Tab = IgcTabComponent;
const Content = IgcCardContentComponent;
const List = IgcListComponent;
const ListItem = IgcListItemComponent;
const Progress = IgcProgressComponent;

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * Calculate execution success rate from history
 */
function calculateSuccessRate(history: PackDeploymentCompleteEvent[]): number {
  if (history.length === 0) {
    return 0;
  }
  
  const successCount = history.filter(event => event.success).length;
  return (successCount / history.length) * 100;
}

/**
 * Get deployment status message
 */
function getDeploymentStatusMessage(progress?: {
  totalWorkflows: number;
  completedWorkflows: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  errorMessage?: string;
}): string {
  if (!progress) {
    return 'Ready to deploy';
  }
  
  switch (progress.status) {
    case 'pending':
      return 'Deployment pending';
    case 'running':
      return `Deploying... ${progress.completedWorkflows}/${progress.totalWorkflows} workflows`;
    case 'completed':
      return 'Deployment completed successfully';
    case 'failed':
      return progress.errorMessage || 'Deployment failed';
    default:
      return 'Unknown status';
  }
}

/**
 * PackDetailsPanel - Displays detailed pack information
 *
 * @param props - PackDetailsPanelProps
 * @returns Pack details panel component
 */
export function PackDetailsPanel({
  pack,
  expanded = false,
  onClose,
  onDeploy,
  executionHistory = [],
  deploymentProgress,
}: PackDetailsPanelProps): React.ReactNode {
  const [activeTab, setActiveTab] = useState<string>('overview');

  // Extract non-reactive logic
  const handleClose = useEffectEvent(() => {
    onClose?.();
  });

  const handleDeploy = useEffectEvent(() => {
    onDeploy?.();
  });

  const handleTabChange = useEffectEvent((event: React.CustomEvent) => {
    setActiveTab(event.detail.selectedItem?.getAttribute('label') || 'overview');
  });

  // Calculate statistics
  const successRate = calculateSuccessRate(executionHistory);
  const totalDeployments = executionHistory.length;
  const totalWorkflows = pack.manifest.workflows.length;
  const deploymentStatus = getDeploymentStatusMessage(deploymentProgress);

  // Sort version history (most recent first)
  const versionHistory = [pack.version, ...(pack.version.history || [])].sort(
    (a, b) => new Date(b.releasedAt).getTime() - new Date(a.releasedAt).getTime()
  );

  return (
    <div
      className={`pack-details-panel ${expanded ? 'expanded' : ''}`}
      role="region"
      aria-label={`Details for pack: ${pack.name}`}
      aria-hidden={!expanded}
    >
      {/* Panel Header */}
      <div className="pack-details-header">
        <h2 className="pack-details-title">{pack.name}</h2>
        <button
          className="pack-details-close"
          onClick={handleClose}
          aria-label="Close pack details"
        >
          <Icon name="close" />
        </button>
      </div>

      {/* Deployment Status */}
      <div className="pack-details-deployment-status">
        <div className="deployment-status-indicator">
          {deploymentProgress?.status === 'running' ? (
            <Icon name="progress_activity" className="deployment-progress-icon" />
          ) : deploymentProgress?.status === 'failed' ? (
            <Icon name="error" className="deployment-error-icon" />
          ) : (
            <Icon name="check_circle" className="deployment-success-icon" />
          )}
        </div>
        <div className="deployment-status-text">
          <span className="deployment-status-main">{deploymentStatus}</span>
          {deploymentProgress?.status === 'running' && (
            <span className="deployment-status-sub">
              {deploymentProgress.completedWorkflows} of {deploymentProgress.totalWorkflows} workflows completed
            </span>
          )}
        </div>
      </div>

      {/* Progress Bar (if deploying) */}
      {deploymentProgress?.status === 'running' && (
        <div className="pack-details-deployment-progress">
          <Progress
            value={(deploymentProgress.completedWorkflows / deploymentProgress.totalWorkflows) * 100}
            labelVisibility="always"
            label={`${deploymentProgress.completedWorkflows}/${deploymentProgress.totalWorkflows}`}
          />
        </div>
      )}

      {/* Main Content */}
      <div className="pack-details-content">
        {/* Tabs */}
        <Tabs onChange={handleTabChange}>
          {/* Overview Tab */}
          <Tab label="Overview" selected={activeTab === 'overview'}>
            <Content className="pack-details-tab-content">
              {/* Basic Information */}
              <section className="pack-details-section">
                <h3 className="pack-details-section-title">Basic Information</h3>
                
                <div className="pack-details-info-grid">
                  <div className="pack-details-info-item">
                    <span className="pack-details-info-label">Version</span>
                    <span className="pack-details-info-value">
                      {pack.version.version}
                      {pack.version.prerelease && ' (Prerelease)'}
                      {pack.version.deprecated && ' (Deprecated)'}
                    </span>
                  </div>
                  <div className="pack-details-info-item">
                    <span className="pack-details-info-label">Author</span>
                    <span className="pack-details-info-value">{pack.metadata.author}</span>
                  </div>
                  <div className="pack-details-info-item">
                    <span className="pack-details-info-label">Created</span>
                    <span className="pack-details-info-value">{formatTimestamp(pack.metadata.createdAt)}</span>
                  </div>
                  <div className="pack-details-info-item">
                    <span className="pack-details-info-label">Last Updated</span>
                    <span className="pack-details-info-value">{formatTimestamp(pack.metadata.updatedAt)}</span>
                  </div>
                  {pack.metadata.license && (
                    <div className="pack-details-info-item">
                      <span className="pack-details-info-label">License</span>
                      <span className="pack-details-info-value">{pack.metadata.license}</span>
                    </div>
                  )}
                </div>
              </section>

              {/* Statistics */}
              <section className="pack-details-section">
                <h3 className="pack-details-section-title">Statistics</h3>
                
                <div className="pack-details-stats-grid">
                  <div className="pack-details-stat-card">
                    <span className="pack-details-stat-value">{totalWorkflows}</span>
                    <span className="pack-details-stat-label">Workflows</span>
                  </div>
                  <div className="pack-details-stat-card">
                    <span className="pack-details-stat-value">{totalDeployments}</span>
                    <span className="pack-details-stat-label">Deployments</span>
                  </div>
                  <div className="pack-details-stat-card">
                    <span className="pack-details-stat-value">{successRate.toFixed(0)}%</span>
                    <span className="pack-details-stat-label">Success Rate</span>
                  </div>
                  {pack.metadata.rating !== undefined && (
                    <div className="pack-details-stat-card">
                      <span className="pack-details-stat-value">{pack.metadata.rating}</span>
                      <span className="pack-details-stat-label">Rating</span>
                    </div>
                  )}
                </div>
              </section>

              {/* Description */}
              {pack.metadata.description && (
                <section className="pack-details-section">
                  <h3 className="pack-details-section-title">Description</h3>
                  <p className="pack-details-description-text">
                    {pack.metadata.description}
                  </p>
                </section>
              )}

              {/* Tags */}
              {pack.metadata.tags && pack.metadata.tags.length > 0 && (
                <section className="pack-details-section">
                  <h3 className="pack-details-section-title">Tags</h3>
                  <div className="pack-details-tags">
                    {pack.metadata.tags.map((tag, index) => (
                      <span
                        key={index}
                        className="pack-details-tag"
                        aria-label={`Tag: ${tag}`}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </section>
              )}
            </Content>
          </Tab>

          {/* Workflows Tab */}
          <Tab label="Workflows" selected={activeTab === 'workflows'}>
            <Content className="pack-details-tab-content">
              <section className="pack-details-section">
                <h3 className="pack-details-section-title">Workflows in Pack</h3>
                <List>
                  {pack.manifest.workflows.map((workflowRef, index) => (
                    <ListItem
                      key={index}
                      className="pack-details-workflow-item"
                      aria-label={`Workflow: ${workflowRef.workflowId}`}
                    >
                      <div className="workflow-item-content">
                        <Icon name="code" className="workflow-item-icon" />
                        <div className="workflow-item-info">
                          <span className="workflow-item-id">{workflowRef.workflowId}</span>
                          {workflowRef.version && (
                            <span className="workflow-item-version">v{workflowRef.version}</span>
                          )}
                        </div>
                      </div>
                      {workflowRef.optional && (
                        <span className="workflow-item-optional" aria-label="Optional workflow">
                          Optional
                        </span>
                      )}
                    </ListItem>
                  ))}
                </List>
              </section>

              <section className="pack-details-section">
                <h3 className="pack-details-section-title">Execution Policy</h3>
                <div className="pack-details-policy">
                  <span className="policy-label">Mode:</span>
                  <span className="policy-value">{pack.manifest.policy.mode}</span>
                  {pack.manifest.policy.mode === 'sequential' && (
                    <span className="policy-hint">
                      Workflows execute in order, one after another
                    </span>
                  )}
                  {pack.manifest.policy.mode === 'parallel' && (
                    <span className="policy-hint">
                      Workflows execute simultaneously
                    </span>
                  )}
                  {pack.manifest.policy.mode === 'conditional' && (
                    <span className="policy-hint">
                      Workflows execute based on conditions
                    </span>
                  )}
                  {pack.manifest.policy.rollbackOnFailure && (
                    <span className="policy-hint rollback-warning">
                      Rollback enabled on failure
                    </span>
                  )}
                </div>
              </section>
            </Content>
          </Tab>

          {/* Version History Tab */}
          <Tab label="Versions" selected={activeTab === 'versions'}>
            <Content className="pack-details-tab-content">
              <section className="pack-details-section">
                <h3 className="pack-details-section-title">Version History</h3>
                <div className="pack-details-version-timeline">
                  {versionHistory.map((version, index) => (
                    <div
                      key={index}
                      className={`pack-details-version-item ${version.version === pack.version.version ? 'current' : ''}`}
                    >
                      <div className="version-item-marker">
                        {version.version === pack.version.version && (
                          <span className="version-current-marker" aria-label="Current version" />
                        )}
                      </div>
                      <div className="version-item-content">
                        <div className="version-header">
                          <span className="version-number">v{version.version}</span>
                          {version.prerelease && (
                            <span className="version-badge prerelease">Prerelease</span>
                          )}
                          {version.deprecated && (
                            <span className="version-badge deprecated">Deprecated</span>
                          )}
                        </div>
                        <span className="version-date">{formatTimestamp(version.releasedAt)}</span>
                        {version.changelog && (
                          <p className="version-changelog">{version.changelog}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </Content>
          </Tab>

          {/* Execution History Tab */}
          <Tab label="Execution History" selected={activeTab === 'history'}>
            <Content className="pack-details-tab-content">
              <section className="pack-details-section">
                <h3 className="pack-details-section-title">Deployment History</h3>
                {executionHistory.length === 0 ? (
                  <div className="pack-details-empty-state">
                    <Icon name="history" className="empty-state-icon" />
                    <p>No deployment history available</p>
                  </div>
                ) : (
                  <List>
                    {executionHistory.slice(0, 10).map((event, index) => (
                      <ListItem
                        key={index}
                        className={`pack-details-execution-item ${event.success ? 'success' : 'failed'}`}
                        aria-label={`Deployment ${index + 1}: ${event.success ? 'Success' : 'Failure'}`}
                      >
                        <div className="execution-item-content">
                          <div className="execution-item-icon">
                            {event.success ? (
                              <Icon name="check_circle" className="success-icon" />
                            ) : (
                              <Icon name="error" className="error-icon" />
                            )}
                          </div>
                          <div className="execution-item-info">
                            <div className="execution-item-header">
                              <span className="execution-item-version">
                                v{event.version}
                              </span>
                              <span className="execution-item-date">
                                {formatTimestamp(event.timestamp)}
                              </span>
                            </div>
                            <div className="execution-item-details">
                              <span className="execution-item-duration">
                                {event.totalDurationMs}ms
                              </span>
                              <span className="execution-item-workflows">
                                {event.workflowResults.length} workflows
                              </span>
                              <span className="execution-item-success-rate">
                                {Math.round(
                                  (event.workflowResults.filter(r => r.success).length /
                                    event.workflowResults.length) *
                                    100
                                )}
                                % success
                              </span>
                            </div>
                          </div>
                        </div>
                      </ListItem>
                    ))}
                  </List>
                )}
              </section>
            </Content>
          </Tab>
        </Tabs>
      </div>

      {/* Action Footer */}
      <div className="pack-details-actions">
        <Button
          variant="flat"
          onClick={handleClose}
          aria-label="Close pack details"
        >
          Close
        </Button>
        {onDeploy && (
          <Button
            variant="filled"
            onClick={handleDeploy}
            disabled={deploymentProgress?.status === 'running'}
            aria-label={`Deploy pack ${pack.name}`}
          >
            <Icon name="play_arrow" slot="icon-start" />
            {deploymentProgress?.status === 'running' ? 'Deploying...' : 'Deploy Pack'}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * PackDetailsPanelSkeleton - Loading state for pack details panel
 *
 * @returns Skeleton component
 */
export function PackDetailsPanelSkeleton(): React.ReactNode {
  return (
    <div className="pack-details-panel pack-details-panel-skeleton" aria-busy="true">
      <div className="pack-details-header">
        <h2 className="pack-details-title pack-details-skeleton-title" />
        <div className="pack-details-close pack-details-skeleton-close" />
      </div>
      <div className="pack-details-content">
        <div className="pack-details-tab-content">
          <div className="pack-details-section">
            <div className="pack-details-info-grid">
              <div className="pack-details-info-item">
                <div className="pack-details-info-label pack-details-skeleton-label" />
                <div className="pack-details-info-value pack-details-skeleton-value" />
              </div>
              <div className="pack-details-info-item">
                <div className="pack-details-info-label pack-details-skeleton-label" />
                <div className="pack-details-info-value pack-details-skeleton-value" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}