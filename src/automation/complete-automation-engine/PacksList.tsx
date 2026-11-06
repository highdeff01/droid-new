/**
 * Packs List Component
 *
 * Displays a list of packs with metadata, search filtering, and selection:
 * - Pack cards with metadata display
 * - Real-time search filtering with debouncing
 * - Pack selection state management
 * - Loading states
 * - Accessibility support and keyboard navigation
 *
 * Features:
 * - Display pack list with metadata (name, version, author, stats)
 * - Real-time search filtering
 * - Pack selection and details view
 * - Loading states for async data
 * - Responsive layout with pack cards
 */

import React, { useEffectEvent, useState, useMemo, useCallback } from 'react';

import type { Pack } from './pack-types';
import type { PackDeploymentCompleteEvent } from './integration-types';

import { PackCardList } from './PackCard';
import { PackDetailsPanel } from './PackDetailsPanel';
import { PackDeployButton } from './PackDeployButton';
import { IgcInputGroupComponent, IgcIconComponent } from 'igniteui-react';

/**
 * Packs list props
 */
export interface PacksListProps {
  /** Array of packs to display */
  packs: Pack[];
  
  /** Selected pack ID for details panel */
  selectedPackId?: string;
  
  /** Function to call when pack is selected */
  onPackSelect?: (pack: Pack) => void;
  
  /** Function to call when pack is deployed */
  onPackDeploy?: (pack: Pack) => void;
  
  /** Optional event dispatcher for deployment events */
  eventDispatcher?: any;
  
  /** Optional execution history for packs */
  executionHistory?: Record<string, PackDeploymentCompleteEvent[]>;
  
  /** Optional loading state */
  loading?: boolean;
  
  /** Optional error message */
  error?: string;
}

/**
 * Icon component wrapper for igniteui-react
 */
const InputGroup = IgcInputGroupComponent;
const Icon = IgcIconComponent;

/**
 * Debounce utility function
 */
function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func(...args);
    }, delay);
  };
}

/**
 * PacksList - Main packs list component
 *
 * @param props - PacksListProps
 * @returns Packs list component
 */
export function PacksList({
  packs,
  selectedPackId,
  onPackSelect,
  onPackDeploy,
  eventDispatcher,
  executionHistory = {},
  loading = false,
  error,
}: PacksListProps): React.ReactNode {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(false);

  // Debounced search term update
  const debouncedSetSearchTerm = useMemo(
    () => debounce((value: string) => setSearchTerm(value), 300),
    []
  );

  // Handle search input change
  const handleSearchChange = useCallback((event: React.CustomEvent) => {
    const value = event.detail.value as string;
    setSearchQuery(value);
    debouncedSetSearchTerm(value);
  }, [debouncedSetSearchTerm]);

  // Filter packs based on search term
  const filteredPacks = useMemo(() => {
    if (!searchTerm.trim()) {
      return packs;
    }

    const term = searchTerm.toLowerCase();
    return packs.filter(pack => {
      // Search in pack name
      if (pack.name.toLowerCase().includes(term)) {
        return true;
      }
      
      // Search in author
      if (pack.metadata.author.toLowerCase().includes(term)) {
        return true;
      }
      
      // Search in description
      if (pack.metadata.description?.toLowerCase().includes(term)) {
        return true;
      }
      
      // Search in tags
      if (pack.metadata.tags?.some(tag => tag.toLowerCase().includes(term))) {
        return true;
      }
      
      return false;
    });
  }, [packs, searchTerm]);

  // Get execution history for selected pack
  const selectedPackHistory = selectedPackId 
    ? (executionHistory[selectedPackId] || []) 
    : [];

  // Handle pack selection
  const handlePackSelect = useCallback((pack: Pack) => {
    if (onPackSelect) {
      onPackSelect(pack);
    }
    setIsDetailsPanelOpen(true);
  }, [onPackSelect]);

  // Handle pack deploy
  const handlePackDeploy = useCallback((pack: Pack) => {
    if (onPackDeploy) {
      onPackDeploy(pack);
    }
  }, [onPackDeploy]);

  // Handle close details panel
  const handleCloseDetailsPanel = useCallback(() => {
    setIsDetailsPanelOpen(false);
  }, []);

  // Clear search
  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchTerm('');
  }, []);

  return (
    <div className="packs-list" role="main" aria-label="Packs list">
      {/* Search Bar */}
      <div className="packs-list-search">
        <InputGroup
          value={searchQuery}
          placeholder="Search packs by name, author, or tag..."
          clearInput={true}
          onClearInput={handleClearSearch}
          onChange={handleSearchChange}
          aria-label="Search packs"
        >
          <Icon name="search" slot="prefix" aria-hidden="true" />
        </InputGroup>
      </div>

      {/* Error State */}
      {error && (
        <div className="packs-list-error" role="alert">
          <Icon name="error" className="error-icon" />
          <span className="error-message">{error}</span>
        </div>
      )}

      {/* Packs List */}
      <div className="packs-list-content">
        <PackCardList
          packs={filteredPacks}
          selectedPackId={selectedPackId}
          onClick={handlePackSelect}
          onDeploy={handlePackDeploy}
          deployDisabled={isDetailsPanelOpen}
          loading={loading}
        />
      </div>

      {/* Pack Details Panel */}
      {selectedPackId && (
        <div className="packs-list-details-panel">
          <PackDetailsPanel
            pack={packs.find(p => p.id === selectedPackId) || { id: '', name: '', manifest: { workflows: [], policy: { mode: 'sequential' } }, version: { version: '1.0.0', releasedAt: '' }, metadata: { createdAt: '', updatedAt: '', author: '', description: '' } }}
            expanded={isDetailsPanelOpen}
            onClose={handleCloseDetailsPanel}
            onDeploy={() => {
              const pack = packs.find(p => p.id === selectedPackId);
              if (pack) {
                handlePackDeploy(pack);
              }
            }}
            executionHistory={selectedPackHistory}
          />
        </div>
      )}

      {/* Empty State */}
      {filteredPacks.length === 0 && !loading && !error && (
        <div className="packs-list-empty-state" role="status">
          <Icon name="folder_open" className="empty-state-icon" />
          <p className="empty-state-text">
            {searchTerm ? 'No packs match your search' : 'No packs available'}
          </p>
          {searchTerm && (
            <button
              className="empty-state-clear"
              onClick={handleClearSearch}
              aria-label="Clear search"
            >
              Clear search
            </button>
          )}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="packs-list-loading" role="status">
          <Icon name="progress_activity" className="loading-icon" />
          <span className="loading-text">Loading packs...</span>
        </div>
      )}
    </div>
  );
}

/**
 * PacksListWithDeploy - Packs list with deploy button at bottom
 *
 * @param props - PacksListProps
 * @returns Packs list with deploy controls
 */
export function PacksListWithDeploy({
  packs,
  selectedPackId,
  onPackSelect,
  onPackDeploy,
  eventDispatcher,
  executionHistory = {},
  loading = false,
  error,
}: PacksListProps): React.ReactNode {
  const selectedPack = packs.find(p => p.id === selectedPackId);

  return (
    <div className="packs-list packs-list-with-deploy" role="main" aria-label="Packs list with deployment">
      <PacksList
        packs={packs}
        selectedPackId={selectedPackId}
        onPackSelect={onPackSelect}
        onPackDeploy={onPackDeploy}
        eventDispatcher={eventDispatcher}
        executionHistory={executionHistory}
        loading={loading}
        error={error}
      />

      {/* Deployment Controls Footer */}
      {selectedPack && (
        <div className="packs-list-deploy-footer" role="contentinfo">
          <div className="deploy-footer-info">
            <span className="deploy-footer-label">Selected Pack:</span>
            <span className="deploy-footer-value">{selectedPack.name}</span>
            <span className="deploy-footer-version">
              v{selectedPack.version.version}
            </span>
          </div>
          <PackDeployButton
            pack={selectedPack}
            onDeploymentStart={() => onPackDeploy?.(selectedPack)}
            eventDispatcher={eventDispatcher}
          />
        </div>
      )}
    </div>
  );
}

/**
 * PacksListSkeleton - Loading state for packs list
 *
 * @returns Skeleton component
 */
export function PacksListSkeleton(): React.ReactNode {
  return (
    <div className="packs-list packs-list-skeleton" aria-busy="true">
      <div className="packs-list-search">
        <InputGroup placeholder="Search packs..." disabled />
      </div>
      <div className="packs-list-content">
        <div className="pack-card-list">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="pack-card pack-card-skeleton" />
          ))}
        </div>
      </div>
    </div>
  );
}