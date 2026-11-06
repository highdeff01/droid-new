/**
 * Habit Context Requirements Component
 *
 * Displays the context requirements for a habit with visual indicators and hover support.
 * Shows what conditions must be met for the habit to be suggested or executed.
 *
 * Features:
 * - URL pattern display with regex indicators
 * - Window title pattern display
 * - Environment variable requirements
 * - Hover tooltip with detailed condition information
 * - Status indicators for each requirement type
 * - Accessibility support with ARIA attributes
 */

import React from 'react';

import type { HabitPattern } from './habit-types';
import { IgcTooltipComponent } from 'igniteui-react';
import { IgcButtonComponent } from 'igniteui-react';
import { IgcIconComponent } from 'igniteui-react';

/**
 * Habit context requirements props
 */
export interface HabitContextRequirementsProps {
  /** The habit pattern to display context requirements for */
  pattern: HabitPattern;
  
  /** Optional current context to check against requirements */
  currentContext?: {
    url?: string;
    title?: string;
    environment?: Record<string, string>;
  };
  
  /** Optional show status badges for requirements */
  showStatus?: boolean;
  
  /** Optional compact mode for smaller displays */
  compact?: boolean;
}

/**
 * Icon component wrapper for igniteui-react
 */
const Tooltip = IgcTooltipComponent;
const Button = IgcButtonComponent;
const Icon = IgcIconComponent;

/**
 * Check if a URL matches a pattern (regex)
 */
function matchesUrlPattern(pattern: string | undefined, url: string | undefined): boolean {
  if (!pattern || !url) return false;
  try {
    const regex = new RegExp(pattern);
    return regex.test(url);
  } catch {
    return false;
  }
}

/**
 * Check if a title matches a pattern (regex)
 */
function matchesTitlePattern(pattern: string | undefined, title: string | undefined): boolean {
  if (!pattern || !title) return false;
  try {
    const regex = new RegExp(pattern);
    return regex.test(title);
  } catch {
    return false;
  }
}

/**
 * Check if environment variables match
 */
function matchesEnvironmentPattern(
  pattern: Record<string, string> | undefined,
  environment: Record<string, string> | undefined
): boolean {
  if (!pattern || !environment) return false;
  
  for (const [key, value] of Object.entries(pattern)) {
    if (environment[key] !== value) {
      return false;
    }
  }
  return true;
}

/**
 * Get requirement status based on current context
 */
function getRequirementStatus(
  pattern: HabitPattern['context'],
  currentContext?: HabitContextRequirementsProps['currentContext']
): {
  url: 'success' | 'error' | 'pending';
  title: 'success' | 'error' | 'pending';
  environment: 'success' | 'error' | 'pending';
} {
  if (!currentContext) {
    return { url: 'pending', title: 'pending', environment: 'pending' };
  }

  return {
    url: pattern.url && currentContext.url
      ? matchesUrlPattern(pattern.url, currentContext.url) ? 'success' : 'error'
      : 'pending',
    title: pattern.title && currentContext.title
      ? matchesTitlePattern(pattern.title, currentContext.title) ? 'success' : 'error'
      : 'pending',
    environment: pattern.environment && currentContext.environment
      ? matchesEnvironmentPattern(pattern.environment, currentContext.environment) ? 'success' : 'error'
      : 'pending',
  };
}

/**
 * ContextRequirementItem - Individual requirement display
 */
function ContextRequirementItem({
  type,
  pattern,
  value,
  status,
  compact,
}: {
  type: 'url' | 'title' | 'environment';
  pattern: string | Record<string, string> | undefined;
  value?: string | Record<string, string>;
  status?: 'success' | 'error' | 'pending';
  compact?: boolean;
}): React.ReactNode {
  if (!pattern) return null;

  const icon = status === 'success' ? 'check_circle' : status === 'error' ? 'error' : 'info';
  const color = status === 'success' ? 'success' : status === 'error' ? 'error' : 'primary';

  return (
    <div
      className={`habit-requirement-item ${compact ? 'compact' : ''}`}
      role="listitem"
      aria-label={`${type} requirement: ${typeof pattern === 'string' ? pattern : Object.entries(pattern).map(([k, v]) => `${k}=${v}`).join(', ')}`
    }
    >
      <Icon name={icon} slot="icon-start" size="small" style={{ color: `var(--ig-${color}-500)` }} />
      <div className="habit-requirement-content">
        <span className="habit-requirement-label">{type}</span>
        <span className="habit-requirement-value">
          {typeof pattern === 'string' ? pattern : Object.entries(pattern).map(([k, v]) => `${k}=${v}`).join(', ')}
        </span>
      </div>
      {status && (
        <span
          className="habit-requirement-status"
          aria-label={status}
          style={{ color: `var(--ig-${color}-500)` }}
        >
          {status === 'success' && '✓'}
          {status === 'error' && '✗'}
          {status === 'pending' && '•'}
        </span>
      )}
    </div>
  );
}

/**
 * HabitContextRequirements - Displays context requirements for a habit pattern
 *
 * @param props - HabitContextRequirementsProps
 * @returns HabitContextRequirements component
 */
export function HabitContextRequirements({
  pattern,
  currentContext,
  showStatus = false,
  compact = false,
}: HabitContextRequirementsProps): React.ReactNode {
  const status = showStatus && currentContext
    ? getRequirementStatus(pattern.context, currentContext)
    : undefined;

  return (
    <div
      className={`habit-context-requirements ${compact ? 'compact' : ''}`}
      role="region"
      aria-label="Context requirements"
    >
      {/* Context Requirements Header */}
      <div className="habit-context-requirements-header">
        <h3 className="habit-context-requirements-title">
          <Icon name="location_on" slot="icon-start" size="small" />
          Context Requirements
        </h3>
        {pattern.frequency && (
          <span className="habit-context-frequency">
            {pattern.frequency}
          </span>
        )}
      </div>

      {/* Context Requirements List */}
      <div className="habit-context-requirements-list" role="list">
        {/* URL Pattern */}
        {pattern.context?.url && (
          <ContextRequirementItem
            type="url"
            pattern={pattern.context.url}
            value={currentContext?.url}
            status={status?.url}
            compact={compact}
          />
        )}

        {/* Title Pattern */}
        {pattern.context?.title && (
          <ContextRequirementItem
            type="title"
            pattern={pattern.context.title}
            value={currentContext?.title}
            status={status?.title}
            compact={compact}
          />
        )}

        {/* Environment Variables */}
        {pattern.context?.environment && (
          <ContextRequirementItem
            type="environment"
            pattern={pattern.context.environment}
            value={currentContext?.environment}
            status={status?.environment}
            compact={compact}
          />
        )}
      </div>

      {/* Requirement Match Status */}
      {showStatus && currentContext && (
        <div className="habit-context-status-summary" role="status" aria-live="polite">
          {status && (
            <div className={`habit-context-summary-item ${status.url}`}>
              <Icon name={status.url === 'success' ? 'check' : 'close'} slot="icon-start" size="small" />
              URL: {status.url === 'success' ? 'Matched' : status.url === 'error' ? 'No match' : 'Not checked'}
            </div>
          )}
          {status && (
            <div className={`habit-context-summary-item ${status.title}`}>
              <Icon name={status.title === 'success' ? 'check' : 'close'} slot="icon-start" size="small" />
              Title: {status.title === 'success' ? 'Matched' : status.title === 'error' ? 'No match' : 'Not checked'}
            </div>
          )}
          {status && (
            <div className={`habit-context-summary-item ${status.environment}`}>
              <Icon name={status.environment === 'success' ? 'check' : 'close'} slot="icon-start" size="small" />
              Environment: {status.environment === 'success' ? 'Matched' : status.environment === 'error' ? 'No match' : 'Not checked'}
            </div>
          )}
        </div>
      )}

      {/* Hover Instructions */}
      <div
        className="habit-context-hint"
        aria-hidden="true"
      >
        <Icon name="info" slot="icon-start" size="small" />
        Hover for detailed match information
      </div>
    </div>
  );
}

/**
 * HabitContextRequirementsCompact - Compact version for smaller displays
 */
export function HabitContextRequirementsCompact(
  props: Omit<HabitContextRequirementsProps, 'compact'>
): React.ReactNode {
  return <HabitContextRequirements {...props} compact />;
}
