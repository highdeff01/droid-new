/**
 * Pack Creation After Recording Component (React 19)
 *
 * Shows pack creation offer after successful workflow recording.
 * Uses React 19 features: ref as prop, no React import needed.
 *
 * Features:
 * - Post-recording pack creation prompt
 * - Workflow reference selection
 * - Pack metadata input (name, description, tags)
 * - Integration with event dispatcher for workflow events
 * - Accessibility support (ARIA labels, keyboard navigation)
 */

import { useEffectEvent, useState, useMemo } from 'react';

import type { Workflow } from './workflow-types';
import type { EventDispatcher } from './event-dispatcher';
import type { WorkflowCreatedEvent } from './integration-types';

import { IgcTextFieldComponent, IgcTextAreaComponent, IgcButtonComponent, IgcChipComponent, IgcIconComponent } from 'igniteui-react';

/**
 * Pack creation after recording props
 */
export interface PackCreationAfterRecordingProps {
  /** Array of workflows to add to pack */
  workflows: Workflow[];
  
  /** Optional event dispatcher for subscribing to workflow events */
  eventDispatcher?: EventDispatcher;
  
  /** Optional handler for creating pack */
  onCreatePack?: (name: string, description?: string, workflowIds?: string[]) => void;
  
  /** Optional handler for dismissing the offer */
  onDismiss?: () => void;
  
  /** Optional initial workflows to include */
  initialWorkflowIds?: string[];
  
  /** Optional open state */
  open?: boolean;
  
  /** Optional on open change handler */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Icon component wrapper for igniteui-react
 */
const Icon = IgcIconComponent;
const TextField = IgcTextFieldComponent;
const TextArea = IgcTextAreaComponent;
const Button = IgcButtonComponent;
const Chip = IgcChipComponent;

/**
 * PackCreationAfterRecording - Pack creation offer after recording
 *
 * Displays a prompt to create a pack after successful workflow recording.
 * Allows users to name the pack, add workflows, and create it.
 *
 * @param props - PackCreationAfterRecordingProps
 * @returns Pack creation offer component
 */
export function PackCreationAfterRecording({
  workflows,
  eventDispatcher,
  onCreatePack,
  onDismiss,
  initialWorkflowIds = [],
  open = true,
  onOpenChange,
}: PackCreationAfterRecordingProps): React.ReactNode {
  const [packName, setPackName] = useState('');
  const [packDescription, setPackDescription] = useState('');
  const [selectedWorkflowIds, setSelectedWorkflowIds] = useState<string[]>(initialWorkflowIds);
  const [isCreating, setIsCreating] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // Subscribe to workflow created events
  useEffect(() => {
    if (!eventDispatcher) {
      return;
    }

    let subscriptionId: string | undefined;

    subscriptionId = eventDispatcher.subscribe<WorkflowCreatedEvent>(
      (event: WorkflowCreatedEvent) => {
        // Check if workflow should be added to current pack
        if (workflows.find(w => w.id === event.workflowId)) {
          setSelectedWorkflowIds(prev => [...prev, event.workflowId]);
        }
      },
      { eventType: 'WorkflowCreated' }
    );

    return () => {
      if (subscriptionId) {
        eventDispatcher.unsubscribe(subscriptionId);
      }
    };
  }, [eventDispatcher, workflows]);

  // Handle workflow selection toggle
  const handleWorkflowToggle = useEffectEvent((workflowId: string) => {
    setSelectedWorkflowIds(prev => 
      prev.includes(workflowId) 
        ? prev.filter(id => id !== workflowId)
        : [...prev, workflowId]
    );
  });

  // Handle pack creation
  const handleCreatePack = useEffectEvent(async () => {
    if (!packName.trim() || selectedWorkflowIds.length === 0) {
      return;
    }

    setIsCreating(true);

    try {
      // Call pack creation handler
      await onCreatePack?.(packName, packDescription, selectedWorkflowIds);

      // Show success state
      setShowSuccess(true);

      // Auto-dismiss after delay
      setTimeout(() => {
        setShowSuccess(false);
        setPackName('');
        setPackDescription('');
        setSelectedWorkflowIds([]);
        onDismiss?.();
      }, 3000);
    } finally {
      setIsCreating(false);
    }
  });

  // Handle dismiss
  const handleDismiss = useEffectEvent(() => {
    onDismiss?.();
  });

  // Handle open change
  const handleOpenChange = useEffectEvent((event: CustomEvent) => {
    onOpenChange?.(event.detail.value);
  });

  // Get selected workflows
  const selectedWorkflows = useMemo(() => {
    return workflows.filter(w => selectedWorkflowIds.includes(w.id));
  }, [workflows, selectedWorkflowIds]);

  // Calculate pack name from workflow
  const packNameFromWorkflow = useMemo(() => {
    if (workflows.length === 1 && !packName) {
      return workflows[0].metadata.name.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
    }
    return packName;
  }, [workflows, packName]);

  // Update pack name when workflow changes
  if (workflows.length === 1 && !packName) {
    setPackName(packNameFromWorkflow);
  }

  if (!open) {
    return null;
  }

  if (showSuccess) {
    return (
      <div 
        className="pack-creation-after-recording success-state"
        role="alert"
        aria-live="polite"
        aria-label="Pack created successfully"
      >
        <div className="success-content">
          <Icon name="check_circle" size="large" />
          <h3>Pack Created Successfully</h3>
          <p>Your automation pack has been created and saved.</p>
          <Button onClick={handleDismiss}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="pack-creation-after-recording"
      role="region"
      aria-label="Create pack after recording"
    >
      <div className="pack-creation-card">
        <div className="pack-creation-header">
          <Icon name="collections_bookmark" size="large" />
          <div className="pack-creation-header-content">
            <h2>Save as Pack</h2>
            <p className="pack-creation-subtitle">
              Convert this workflow into a reusable automation pack
            </p>
          </div>
        </div>

        <div className="pack-creation-content">
          {/* Pack Name Input */}
          <div className="pack-creation-form-group">
            <label htmlFor="pack-name" className="pack-creation-label">
              Pack Name <span className="required">*</span>
            </label>
            <TextField
              id="pack-name"
              value={packName}
              onChange={(event: CustomEvent) => {
                setPackName(event.detail.value as string);
              }}
              placeholder="e.g., Login-Auto-Submit"
              required
              aria-required="true"
              helperText="Name your automation pack"
            />
          </div>

          {/* Pack Description Input */}
          <div className="pack-creation-form-group">
            <label htmlFor="pack-description" className="pack-creation-label">
              Description
            </label>
            <TextArea
              id="pack-description"
              value={packDescription}
              onChange={(event: CustomEvent) => {
                setPackDescription(event.detail.value as string);
              }}
              placeholder="Describe what this pack does..."
              rows={3}
              helperText="Optional description for your pack"
            />
          </div>

          {/* Selected Workflows */}
          <div className="pack-creation-form-group">
            <label className="pack-creation-label">
              Workflows to Include <span className="required">*</span>
            </label>
            {selectedWorkflows.length > 0 ? (
              <div 
                className="pack-creation-workflow-chips" 
                role="list" 
                aria-label="Selected workflows"
              >
                {selectedWorkflows.map(workflow => (
                  <Chip
                    key={workflow.id}
                    className="workflow-chip"
                    variant="filled"
                    onClick={() => handleWorkflowToggle(workflow.id)}
                    tabIndex={0}
                    aria-label={`Remove ${workflow.metadata.name} from pack`}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        handleWorkflowToggle(workflow.id);
                      }
                    }}
                  >
                    <Icon name="workflow" slot="icon-start" size="x-small" />
                    {workflow.metadata.name}
                    <Icon name="close" slot="end" size="x-small" />
                  </Chip>
                ))}
              </div>
            ) : (
              <p className="pack-creation-no-workflows">
                No workflows selected. Select workflows to include in this pack.
              </p>
            )}
          </div>

          {/* Available Workflows (for selection) */}
          {workflows.length > 0 && selectedWorkflowIds.length < workflows.length && (
            <div className="pack-creation-form-group">
              <label className="pack-creation-label">
                Add More Workflows
              </label>
              <div className="pack-creation-workflow-list">
                {workflows
                  .filter(w => !selectedWorkflowIds.includes(w.id))
                  .map(workflow => (
                    <div
                      key={workflow.id}
                      className="pack-creation-workflow-item"
                      role="button"
                      tabIndex={0}
                      onClick={() => handleWorkflowToggle(workflow.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          handleWorkflowToggle(workflow.id);
                        }
                      }}
                      aria-label={`Add ${workflow.metadata.name} to pack`}
                    >
                      <Icon name="workflow" />
                      <div className="workflow-item-content">
                        <span className="workflow-item-name">{workflow.metadata.name}</span>
                        <span className="workflow-item-steps">
                          {workflow.steps.length} steps
                        </span>
                      </div>
                      <Icon name="add_circle" />
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Workflow Statistics */}
          {selectedWorkflows.length > 0 && (
            <div className="pack-creation-stats">
              <div className="pack-creation-stat">
                <span className="stat-value">{selectedWorkflows.length}</span>
                <span className="stat-label">Workflows</span>
              </div>
              <div className="pack-creation-stat">
                <span className="stat-value">
                  {selectedWorkflows.reduce((sum, w) => sum + w.steps.length, 0)}
                </span>
                <span className="stat-label">Total Steps</span>
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="pack-creation-actions">
          <Button
            variant="flat"
            onClick={handleDismiss}
            aria-label="Dismiss pack creation"
          >
            Cancel
          </Button>
          <Button
            variant="filled"
            onClick={handleCreatePack}
            disabled={
              !packName.trim() || 
              selectedWorkflowIds.length === 0 || 
              isCreating
            }
            aria-label="Create pack"
          >
            {isCreating ? (
              <>
                <Icon name="hourglass_empty" slot="icon-start" size="small" />
                Creating...
              </>
            ) : (
              <>
                <Icon name="create_new_folder" slot="icon-start" />
                Create Pack
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * PackCreationAfterRecordingToast - Toast notification for pack creation
 *
 * @param props - Pack name and workflow count
 * @returns Toast notification component
 */
export function PackCreationAfterRecordingToast({
  packName,
  workflowCount,
  onRestore,
}: {
  packName: string;
  workflowCount: number;
  onRestore?: () => void;
}): React.ReactNode {
  return (
    <div 
      className="pack-creation-toast"
      role="alert"
      aria-live="polite"
    >
      <div className="toast-content">
        <Icon name="check_circle" />
        <div className="toast-text">
          <span className="toast-title">Pack Created</span>
          <span className="toast-subtitle">
            "{packName}" with {workflowCount} workflow(s) created successfully
          </span>
        </div>
      </div>
      {onRestore && (
        <Button variant="flat" onClick={onRestore}>
          Undo
        </Button>
      )}
    </div>
  );
}

/**
 * PackCreationAfterRecordingSkeleton - Loading state for pack creation
 *
 * @returns Loading skeleton component
 */
export function PackCreationAfterRecordingSkeleton(): React.ReactNode {
  return (
    <div className="pack-creation-after-recording loading" aria-busy="true">
      <div className="pack-creation-card skeleton">
        <div className="pack-creation-header skeleton-header">
          <div className="skeleton-icon" />
          <div className="skeleton-title" />
        </div>
        <div className="skeleton-form">
          <div className="skeleton-input" />
          <div className="skeleton-textarea" />
        </div>
        <div className="skeleton-actions">
          <div className="skeleton-button" />
          <div className="skeleton-button" />
        </div>
      </div>
    </div>
  );
}

// Styles for pack creation after recording
/*
.pack-creation-after-recording {
  margin: 1rem 0;
  animation: slideIn 0.3s ease-out;
}

.pack-creation-card {
  background: var(--ig-surface);
  border-radius: 0.5rem;
  padding: 1.5rem;
  border: 1px solid var(--ig-border-subtle);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}

.pack-creation-card.skeleton {
  background: var(--ig-surface-50);
}

.pack-creation-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.pack-creation-header-content h2 {
  margin: 0;
  font-size: 1.25rem;
}

.pack-creation-subtitle {
  margin: 0.25rem 0 0;
  color: var(--ig-text-subtle);
  font-size: 0.875rem;
}

.pack-creation-content {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.pack-creation-form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.pack-creation-label {
  font-weight: 600;
  color: var(--ig-text-primary);
}

.required {
  color: var(--ig-error-500);
}

.pack-creation-workflow-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.workflow-chip {
  cursor: pointer;
  transition: transform 0.1s;
}

.workflow-chip:hover {
  transform: scale(1.02);
}

.pack-creation-workflow-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.pack-creation-workflow-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  border: 1px solid var(--ig-border-subtle);
  border-radius: 0.375rem;
  cursor: pointer;
  transition: all 0.2s;
}

.pack-creation-workflow-item:hover {
  background: var(--ig-surface-50);
  border-color: var(--ig-primary-300);
}

.workflow-item-content {
  flex: 1;
}

.workflow-item-name {
  display: block;
  font-weight: 500;
  color: var(--ig-text-primary);
}

.workflow-item-steps {
  font-size: 0.75rem;
  color: var(--ig-text-subtle);
}

.pack-creation-stats {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  background: var(--ig-surface-50);
  border-radius: 0.375rem;
}

.pack-creation-stat {
  text-align: center;
}

.pack-creation-stat .stat-value {
  display: block;
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--ig-primary-500);
}

.pack-creation-stat .stat-label {
  font-size: 0.75rem;
  color: var(--ig-text-subtle);
}

.pack-creation-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1.5rem;
}

.pack-creation-toast {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 1.5rem;
  background: var(--ig-success-50);
  border: 1px solid var(--ig-success-200);
  border-radius: 0.375rem;
  animation: slideIn 0.3s ease-out;
}

.toast-content {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.toast-text {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.toast-title {
  font-weight: 600;
  color: var(--ig-success-900);
}

.toast-subtitle {
  font-size: 0.875rem;
  color: var(--ig-success-700);
}

@keyframes slideIn {
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