/**
 * Pack Card Component
 *
 * Displays individual pack information in a card format with:
 * - Pack metadata (name, version, author)
 * - Pack statistics (workflows count, last executed, status)
 * - Visual indicators for version and status
 * - Accessibility support and keyboard navigation
 *
 * Features:
 * - Compact card layout for pack lists
 * - Pack version badge
 * - Workflow count display
 * - Author information
 * - Click handler for pack selection
 * - Keyboard accessible with Enter/Space activation
 */

import React, { useEffectEvent } from 'react';

import type { Pack } from './pack-types';
import { IgcCardComponent, IgcCardHeaderComponent, IgcCardContentComponent, IgcCardActionsComponent } from 'igniteui-react';
import { IgcBadgeComponent } from 'igniteui-react';
import { IgcButtonComponent } from 'igniteui-react';
import { IgcIconComponent } from 'igniteui-react';

/**
 * Pack card props
 */
export interface PackCardProps {
  /** The pack to display */
  pack: Pack;
  
  /** Whether the pack is selected */
  selected?: boolean;
  
  /** Function to call when pack is clicked */
  onClick?: (pack: Pack) => void;
  
  /** Function to call when deploy is clicked */
  onDeploy?: (pack: Pack) => void;
  
  /** Whether deploy button should be disabled */
  deployDisabled?: boolean;
}

/**
 * Icon component wrapper for igniteui-react
 */
const Icon = IgcIconComponent;
const Card = IgcCardComponent;
const CardHeader = IgcCardHeaderComponent;
const CardContent = IgcCardContentComponent;
const CardActions = IgcCardActionsComponent;
const Badge = IgcBadgeComponent;
const Button = IgcButtonComponent;

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

/**
 * Get version color based on version type
 */
function getVersionColor(version: string): 'primary' | 'success' | 'warning' | 'error' {
  if (version.includes('beta') || version.includes('alpha')) {
    return 'warning';
  }
  if (version.includes('rc')) {
    return 'error';
  }
  return 'primary';
}

/**
 * PackCard - Displays pack information in a card format
 *
 * @param props - PackCardProps
 * @returns PackCard component
 */
export function PackCard({
  pack,
  selected = false,
  onClick,
  onDeploy,
  deployDisabled = false,
}: PackCardProps): React.ReactNode {
  // Extract non-reactive logic for cleaner effects
  const handleClick = useEffectEvent(() => {
    onClick?.(pack);
  });

  const handleDeployClick = useEffectEvent((event: React.MouseEvent) => {
    event.stopPropagation();
    onDeploy?.(pack);
  });

  // Calculate statistics
  const workflowCount = pack.manifest.workflows.length;
  const lastExecuted = pack.version.releasedAt;

  return (
    <Card
      className={`pack-card ${selected ? 'selected' : ''}`}
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(event: React.KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleClick();
        }
      }}
      aria-selected={selected}
      aria-label={`Pack: ${pack.name}, version ${pack.version.version}, by ${pack.metadata.author}`}
    >
      {/* Card Header */}
      <CardHeader>
        <div className="pack-card-header-content">
          <h3 className="pack-card-title">{pack.name}</h3>
          <div className="pack-card-version">
            <Badge
              color={getVersionColor(pack.version.version)}
              shape="rounded"
            >
              v{pack.version.version}
            </Badge>
          </div>
        </div>
        <p className="pack-card-author" aria-label={`Author: ${pack.metadata.author}`}>
          <Icon name="person" slot="icon-start" size="small" />
          {pack.metadata.author}
        </p>
      </CardHeader>

      {/* Card Content */}
      <CardContent>
        <p className="pack-card-description">
          {pack.metadata.description || 'No description available'}
        </p>

        <div className="pack-card-stats">
          <div className="pack-card-stat">
            <span className="pack-card-stat-value">{workflowCount}</span>
            <span className="pack-card-stat-label">Workflows</span>
          </div>
          <div className="pack-card-stat">
            <span className="pack-card-stat-value" aria-label={`Last executed: ${lastExecuted}`}>
              {formatTimestamp(lastExecuted)}
            </span>
            <span className="pack-card-stat-label">Last Executed</span>
          </div>
          {pack.metadata.rating !== undefined && (
            <div className="pack-card-stat">
              <span className="pack-card-stat-value">{pack.metadata.rating}</span>
              <span className="pack-card-stat-label">Rating</span>
            </div>
          )}
          {pack.metadata.downloadCount !== undefined && (
            <div className="pack-card-stat">
              <span className="pack-card-stat-value">{pack.metadata.downloadCount}</span>
              <span className="pack-card-stat-label">Downloads</span>
            </div>
          )}
        </div>

        {pack.metadata.tags && pack.metadata.tags.length > 0 && (
          <div className="pack-card-tags">
            {pack.metadata.tags.map((tag, index) => (
              <span
                key={index}
                className="pack-card-tag"
                aria-label={`Tag: ${tag}`}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </CardContent>

      {/* Card Actions */}
      <CardActions>
        <Button
          variant="flat"
          onClick={handleDeployClick}
          disabled={deployDisabled}
          aria-label={`Deploy pack ${pack.name}`}
        >
          <Icon name="play_arrow" slot="icon-start" />
          Deploy
        </Button>
      </CardActions>
    </Card>
  );
}

/**
 * PackCardSkeleton - Loading state for pack cards
 *
 * @returns Skeleton component
 */
export function PackCardSkeleton(): React.ReactNode {
  return (
    <Card className="pack-card pack-card-skeleton" aria-busy="true">
      <CardHeader>
        <div className="pack-card-header-content">
          <h3 className="pack-card-title pack-card-skeleton-text" />
          <div className="pack-card-version pack-card-skeleton-badge" />
        </div>
        <p className="pack-card-author pack-card-skeleton-text" />
      </CardHeader>
      <CardContent>
        <p className="pack-card-description pack-card-skeleton-text" />
        <div className="pack-card-stats">
          <div className="pack-card-stat">
            <span className="pack-card-stat-value pack-card-skeleton-value" />
          </div>
          <div className="pack-card-stat">
            <span className="pack-card-stat-value pack-card-skeleton-value" />
          </div>
        </div>
      </CardContent>
      <CardActions>
        <Button variant="flat" disabled>
          Deploy
        </Button>
      </CardActions>
    </Card>
  );
}

/**
 * PackCardList - Container for pack card list
 *
 * @param props - Props including packs, selected pack, click handlers
 * @returns Pack card list container
 */
export function PackCardList({
  packs,
  selectedPackId,
  onClick,
  onDeploy,
  deployDisabled,
  loading = false,
}: {
  packs: Pack[];
  selectedPackId?: string;
  onClick?: (pack: Pack) => void;
  onDeploy?: (pack: Pack) => void;
  deployDisabled?: boolean;
  loading?: boolean;
}): React.ReactNode {
  return (
    <div className="pack-card-list" role="list" aria-label="Pack list">
      {loading ? (
        Array.from({ length: 6 }).map((_, index) => (
          <PackCardSkeleton key={index} />
        ))
      ) : (
        packs.map(pack => (
          <PackCard
            key={pack.id}
            pack={pack}
            selected={selectedPackId === pack.id}
            onClick={onClick}
            onDeploy={onDeploy}
            deployDisabled={deployDisabled}
          />
        ))
      )}
    </div>
  );
}