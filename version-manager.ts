/**
 * Version Manager
 * Handles semantic version comparison, version management, and update detection logic.
 * 
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
 * Supports: Pack version comparison, changelog parsing, update detection, rollback
 */

// ============================================================================
// Type Definitions
// ============================================================================

/** Semantic version (MAJOR.MINOR.PATCH) */
export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
}

/** Version comparison result */
export type VersionComparison = 'less' | 'equal' | 'greater';

/** Update information with changelog */
export interface UpdateInfo {
  currentVersion: string;
  availableVersion: string;
  updateType: 'major' | 'minor' | 'patch';
  changelog: string;
  releaseNotes?: string;
  breakingChanges?: string[];
  newFeatures?: string[];
  bugFixes?: string[];
  releaseDate?: Date;
  downloadUrl?: string;
}

/** Version history entry */
export interface VersionHistoryEntry {
  version: string;
  timestamp: number;
  author: string;
  changes: string[];
  workflowSnapshots?: Record<string, unknown>;
  deprecated?: boolean;
}

/** Update preferences configuration */
export interface UpdatePreferences {
  autoUpdate: boolean;
  notificationEnabled: boolean;
  updateChannel: 'stable' | 'beta' | 'nightly';
  checkInterval: number;  // minutes
  autoRollbackOnFailure: boolean;
  showChangelog: boolean;
}

/** Update event types */
export type UpdateEventType = 
  | 'update-available'
  | 'update-downloading'
  | 'update-downloaded'
  | 'update-installing'
  | 'update-installed'
  | 'update-failed'
  | 'update-rollback';

/** Update event for notification system */
export interface UpdateEvent {
  type: UpdateEventType;
  timestamp: number;
  packId: string;
  currentVersion: string;
  newVersion?: string;
  error?: string;
  details?: Record<string, unknown>;
}

/** Update preference configuration */
export interface UpdateConfig {
  /** Default update preferences */
  defaultPreferences: UpdatePreferences;
  
  /** Auto-update interval in minutes */
  checkInterval: number;
  
  /** Maximum update history to retain */
  maxHistory: number;
  
  /** Enable rollback capability */
  enableRollback: boolean;
}

// ============================================================================
// Version Parsing and Comparison
// ============================================================================

/**
 * Parse a semantic version string into its components.
 * 
 * @param version - Version string (e.g., "1.2.3", "2.0.0-beta.1")
 * @returns SemVer object with major, minor, patch, and optional prerelease
 * @throws Error if version is invalid
 */
export function parseSemVer(version: string): SemVer {
  const semverRegex = /^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.]+))?$/;
  const match = version.match(semverRegex);
  
  if (!match) {
    throw new Error(`Invalid semantic version: "${version}"`);
  }
  
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4],
  };
}

/**
 * Convert SemVer object back to string.
 * 
 * @param semver - SemVer object
 * @returns Version string
 */
export function formatSemVer(semver: SemVer): string {
  return semver.prerelease
    ? `${semver.major}.${semver.minor}.${semver.patch}-${semver.prerelease}`
    : `${semver.major}.${semver.minor}.${semver.patch}`;
}

/**
 * Compare two semantic versions.
 * 
 * @param versionA - First version
 * @param versionB - Second version
 * @returns 'less', 'equal', or 'greater'
 */
export function compareVersions(versionA: string, versionB: string): VersionComparison {
  const a = parseSemVer(versionA);
  const b = parseSemVer(versionB);
  
  // Compare major versions
  if (a.major !== b.major) {
    return a.major < b.major ? 'less' : 'greater';
  }
  
  // Compare minor versions
  if (a.minor !== b.minor) {
    return a.minor < b.minor ? 'less' : 'greater';
  }
  
  // Compare patch versions
  if (a.patch !== b.patch) {
    return a.patch < b.patch ? 'less' : 'greater';
  }
  
  // Compare prerelease (prerelease versions are less than non-prerelease)
  if (a.prerelease && !b.prerelease) {
    return 'less';
  }
  if (!a.prerelease && b.prerelease) {
    return 'greater';
  }
  if (a.prerelease && b.prerelease) {
    // If both have prerelease, compare as strings
    if (a.prerelease < b.prerelease) return 'less';
    if (a.prerelease > b.prerelease) return 'greater';
  }
  
  return 'equal';
}

/**
 * Determine the type of update between two versions.
 * 
 * @param fromVersion - Current version
 * @param toVersion - Target version
 * @returns 'major', 'minor', or 'patch'
 */
export function getUpdateType(fromVersion: string, toVersion: string): 'major' | 'minor' | 'patch' | null {
  const comparison = compareVersions(fromVersion, toVersion);
  if (comparison !== 'less') {
    return null;  // Not an update
  }
  
  const from = parseSemVer(fromVersion);
  const to = parseSemVer(toVersion);
  
  if (to.major > from.major) {
    return 'major';
  } else if (to.minor > from.minor) {
    return 'minor';
  } else {
    return 'patch';
  }
}

/**
 * Bump version by type.
 * 
 * @param version - Current version
 * @param type - Version bump type ('major', 'minor', 'patch')
 * @returns Bumped version string
 */
export function bumpVersion(version: string, type: 'major' | 'minor' | 'patch'): string {
  const semver = parseSemVer(version);
  
  switch (type) {
    case 'major':
      return `${semver.major + 1}.0.0`;
    case 'minor':
      return `${semver.major}.${semver.minor + 1}.0`;
    case 'patch':
      return `${semver.major}.${semver.minor}.${semver.patch + 1}`;
  }
}

// ============================================================================
// Changelog Parsing
// ============================================================================

/** Parsed changelog entry */
export interface ChangelogEntry {
  version: string;
  date?: string;
  changes: ChangelogChange[];
}

/** Individual changelog change */
export interface ChangelogChange {
  type: 'breaking' | 'feature' | 'fix' | 'other';
  message: string;
  component?: string;
}

/**
 * Parse markdown changelog into structured data.
 * 
 * @param changelog - Markdown changelog string
 * @returns Array of changelog entries
 */
export function parseChangelog(changelog: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  const lines = changelog.split('\n');
  
  let currentEntry: ChangelogEntry | null = null;
  
  for (const line of lines) {
    // Match version headers (e.g., "## [1.2.3] - 2024-01-15")
    const versionMatch = line.match(/^##\s*\[([\d.]+)\](?:\s*-\s*(.+))?$/);
    if (versionMatch) {
      if (currentEntry) {
        entries.push(currentEntry);
      }
      currentEntry = {
        version: versionMatch[1],
        date: versionMatch[2]?.trim(),
        changes: [],
      };
      continue;
    }
    
    // Match change items (e.g., "- ** Breaking**: Description")
    if (currentEntry) {
      const changeMatch = line.match(/^-?\s*\*\*(.+?)\*\*:\s*(.+)$/);
      if (changeMatch) {
        const typeMap: Record<string, ChangelogChange['type']> = {
          breaking: 'breaking',
          feature: 'feature',
          fix: 'fix',
          added: 'feature',
          changed: 'feature',
          deprecated: 'other',
          removed: 'breaking',
          fixed: 'fix',
          security: 'breaking',
        };
        
        const changeType = typeMap[changeMatch[1].toLowerCase()] ?? 'other';
        currentEntry.changes.push({
          type: changeType,
          message: changeMatch[2].trim(),
        });
      }
    }
  }
  
  if (currentEntry) {
    entries.push(currentEntry);
  }
  
  return entries;
}

/**
 * Extract changelog for a specific version.
 * 
 * @param changelog - Full changelog markdown
 * @param version - Version to extract
 * @returns Changelog entry or null if not found
 */
export function getChangelogForVersion(changelog: string, version: string): ChangelogEntry | null {
  const entries = parseChangelog(changelog);
  return entries.find((e) => e.version === version) ?? null;
}

/**
 * Format changelog entry for display.
 * 
 * @param entry - Changelog entry
 * @returns Formatted string for display
 */
export function formatChangelogEntry(entry: ChangelogEntry): string {
  const lines: string[] = [];
  
  lines.push(`## [${entry.version}]${entry.date ? ` - ${entry.date}` : ''}`);
  
  // Group changes by type
  const byType: Record<string, ChangelogChange[]> = {
    breaking: [],
    feature: [],
    fix: [],
    other: [],
  };
  
  for (const change of entry.changes) {
    byType[change.type].push(change);
  }
  
  // Add sections
  if (byType.breaking.length > 0) {
    lines.push('\n### Breaking Changes');
    for (const change of byType.breaking) {
      lines.push(`- ${change.message}`);
    }
  }
  
  if (byType.feature.length > 0) {
    lines.push('\n### New Features');
    for (const change of byType.feature) {
      lines.push(`- ${change.message}`);
    }
  }
  
  if (byType.fix.length > 0) {
    lines.push('\n### Bug Fixes');
    for (const change of byType.fix) {
      lines.push(`- ${change.message}`);
    }
  }
  
  if (byType.other.length > 0) {
    lines.push('\n### Other Changes');
    for (const change of byType.other) {
      lines.push(`- ${change.message}`);
    }
  }
  
  return lines.join('\n');
}

// ============================================================================
// Version History Management
// ============================================================================

/**
 * Version history manager for tracking and managing pack versions.
 * 
 * Features:
 * - Track version history with timestamps and authors
 * - Store version snapshots
 * - Support rollback to previous versions
 * - Deprecated version tracking
 */
export class VersionHistoryManager {
  private history: Map<string, VersionHistoryEntry[]> = new Map();

  /**
   * Add a version to history.
   * 
   * @param packId - Pack identifier
   * @param entry - Version history entry
   */
  addVersion(packId: string, entry: VersionHistoryEntry): void {
    const versions = this.history.get(packId) ?? [];
    versions.push(entry);
    this.history.set(packId, versions);
  }

  /**
   * Get version history for a pack.
   * 
   * @param packId - Pack identifier
   * @returns Array of version history entries (newest first)
   */
  getVersionHistory(packId: string): VersionHistoryEntry[] {
    const versions = this.history.get(packId) ?? [];
    return versions.slice().sort((a, b) => {
      // Sort by timestamp descending (newest first)
      return b.timestamp - a.timestamp;
    });
  }

  /**
   * Get specific version from history.
   * 
   * @param packId - Pack identifier
   * @param version - Version to retrieve
   * @returns Version history entry or null if not found
   */
  getVersionEntry(packId: string, version: string): VersionHistoryEntry | null {
    const versions = this.history.get(packId) ?? [];
    return versions.find((e) => e.version === version) ?? null;
  }

  /**
   * Check if a version exists in history.
   * 
   * @param packId - Pack identifier
   * @param version - Version to check
   * @returns true if version exists
   */
  hasVersion(packId: string, version: string): boolean {
    return this.getVersionEntry(packId, version) !== null;
  }

  /**
   * Get latest version for a pack.
   * 
   * @param packId - Pack identifier
   * @returns Latest version string or null if no history
   */
  getLatestVersion(packId: string): string | null {
    const versions = this.getVersionHistory(packId);
    if (versions.length === 0) {
      return null;
    }
    return versions[0].version;
  }

  /**
   * Get previous version (for rollback).
   * 
   * @param packId - Pack identifier
   * @param currentVersion - Current version
   * @returns Previous version string or null if none exists
   */
  getPreviousVersion(packId: string, currentVersion: string): string | null {
    const versions = this.getVersionHistory(packId);
    const currentIndex = versions.findIndex((v) => v.version === currentVersion);
    
    if (currentIndex > 0 && currentIndex < versions.length) {
      return versions[currentIndex - 1].version;
    }
    
    return null;
  }

  /**
   * Mark a version as deprecated.
   * 
   * @param packId - Pack identifier
   * @param version - Version to deprecate
   * @param reason - Optional deprecation reason
   */
  deprecateVersion(packId: string, version: string, reason?: string): void {
    const versions = this.history.get(packId);
    if (!versions) {
      return;
    }

    const entry = versions.find((v) => v.version === version);
    if (entry) {
      entry.deprecated = true;
      if (reason) {
        entry.changes.push(`Deprecated: ${reason}`);
      }
    }
  }

  /**
   * Remove old versions beyond retention limit.
   * 
   * @param packId - Pack identifier
   * @param maxVersions - Maximum versions to retain
   */
  trimHistory(packId: string, maxVersions: number = 20): void {
    const versions = this.history.get(packId);
    if (!versions || versions.length <= maxVersions) {
      return;
    }

    // Keep newest versions
    const trimmed = versions.slice(0, maxVersions);
    this.history.set(packId, trimmed);
  }

  /**
   * Get all versions between two versions.
   * 
   * @param packId - Pack identifier
   * @param fromVersion - Starting version
   * @param toVersion - Ending version
   * @returns Array of version entries between (exclusive)
   */
  getVersionsBetween(packId: string, fromVersion: string, toVersion: string): VersionHistoryEntry[] {
    const versions = this.getVersionHistory(packId);
    const fromIndex = versions.findIndex((v) => v.version === fromVersion);
    const toIndex = versions.findIndex((v) => v.version === toVersion);

    if (fromIndex === -1 || toIndex === -1) {
      return [];
    }

    // Return versions between (exclusive)
    const startIndex = Math.min(fromIndex, toIndex) + 1;
    const endIndex = Math.max(fromIndex, toIndex);

    return versions.slice(startIndex, endIndex);
  }
}

// ============================================================================
// Update Detection
// ============================================================================

/**
 * Update detector for finding available pack updates.
 * 
 * Compares local pack versions against marketplace versions
 * and detects available updates.
 */
export class UpdateDetector {
  private versionHistoryManager: VersionHistoryManager;
  private marketplacePacks: Map<string, { latestVersion: string; changelog: string }> = new Map();
  private checkTimestamps: Map<string, number> = new Map();

  constructor(versionHistoryManager?: VersionHistoryManager) {
    this.versionHistoryManager = versionHistoryManager ?? new VersionHistoryManager();
  }

  /**
   * Register marketplace pack information.
   * 
   * @param packId - Pack identifier
   * @param latestVersion - Latest marketplace version
   * @param changelog - Changelog for latest version
   */
  registerMarketplacePack(packId: string, latestVersion: string, changelog: string): void {
    this.marketplacePacks.set(packId, {
      latestVersion,
      changelog,
    });
  }

  /**
   * Check for available updates for a pack.
   * 
   * @param packId - Pack identifier
   * @param currentVersion - Current local version
   * @param changelog - Current local changelog
   * @returns UpdateInfo if update available, null otherwise
   */
  checkForUpdate(packId: string, currentVersion: string, changelog: string): UpdateInfo | null {
    const marketplace = this.marketplacePacks.get(packId);
    if (!marketplace) {
      return null;  // Pack not in marketplace
    }

    const comparison = compareVersions(currentVersion, marketplace.latestVersion);
    if (comparison !== 'less') {
      return null;  // No update available
    }

    const updateType = getUpdateType(currentVersion, marketplace.latestVersion);
    if (!updateType) {
      return null;
    }

    // Parse changelog for this specific version
    const changelogEntry = getChangelogForVersion(marketplace.changelog, marketplace.latestVersion);
    
    // Extract change categories
    const breakingChanges = [];
    const newFeatures = [];
    const bugFixes = [];

    if (changelogEntry) {
      for (const change of changelogEntry.changes) {
        switch (change.type) {
          case 'breaking':
            breakingChanges.push(change.message);
            break;
          case 'feature':
            newFeatures.push(change.message);
            break;
          case 'fix':
            bugFixes.push(change.message);
            break;
        }
      }
    }

    return {
      currentVersion,
      availableVersion: marketplace.latestVersion,
      updateType,
      changelog: marketplace.changelog,
      releaseNotes: changelogEntry ? formatChangelogEntry(changelogEntry) : marketplace.changelog,
      breakingChanges,
      newFeatures,
      bugFixes,
      releaseDate: changelogEntry?.date ? new Date(changelogEntry.date) : undefined,
    };
  }

  /**
   * Check for updates across all packs.
   * 
   * @param packs - Array of packs to check
   * @returns Map of packId to UpdateInfo for available updates
   */
  checkAllPacks(packs: { id: string; version: string; changelog?: string }[]): Map<string, UpdateInfo> {
    const updates = new Map<string, UpdateInfo>();

    for (const pack of packs) {
      const update = this.checkForUpdate(pack.id, pack.version, pack.changelog ?? '');
      if (update) {
        updates.set(pack.id, update);
      }
    }

    return updates;
  }

  /**
   * Record update check timestamp.
   * 
   * @param packId - Pack identifier
   * @param timestamp - Check timestamp (default: now)
   */
  recordCheck(packId: string, timestamp?: number): void {
    this.checkTimestamps.set(packId, timestamp ?? Date.now());
  }

  /**
   * Get last check timestamp for a pack.
   * 
   * @param packId - Pack identifier
   * @returns Timestamp or null if never checked
   */
  getLastCheck(packId: string): number | null {
    return this.checkTimestamps.get(packId) ?? null;
  }
}

// ============================================================================
// Version Rollback
// ============================================================================

/**
 * Version rollback manager for restoring previous pack versions.
 * 
 * Features:
 * - Create version snapshots before updates
 * - Restore previous versions on failure
 * - Track rollback history
 */
export class VersionRollbackManager {
  private snapshots: Map<string, { version: string; data: unknown; timestamp: number }[]> = new Map();
  private versionHistoryManager: VersionHistoryManager;

  constructor(versionHistoryManager?: VersionHistoryManager) {
    this.versionHistoryManager = versionHistoryManager ?? new VersionHistoryManager();
  }

  /**
   * Create a snapshot of current pack version before update.
   * 
   * @param packId - Pack identifier
   * @param packData - Current pack data
   */
  createSnapshot(packId: string, packData: unknown): void {
    const snapshots = this.snapshots.get(packId) ?? [];
    
    // Get current version from pack data
    // This assumes pack data has a version field
    const currentVersion = this.extractVersionFromData(packData);
    
    snapshots.push({
      version: currentVersion,
      data: packData,
      timestamp: Date.now(),
    });
    
    // Keep only recent snapshots (last 10)
    if (snapshots.length > 10) {
      snapshots.shift();
    }
    
    this.snapshots.set(packId, snapshots);
  }

  /**
   * Restore a previous version.
   * 
   * @param packId - Pack identifier
   * @param version - Version to restore
   * @returns Restored pack data or null if not found
   */
  restoreVersion(packId: string, version: string): unknown | null {
    const snapshots = this.snapshots.get(packId) ?? [];
    const snapshot = snapshots.find((s) => s.version === version);

    if (snapshot) {
      return snapshot.data;
    }

    return null;
  }

  /**
   * Restore to previous version (most recent before current).
   * 
   * @param packId - Pack identifier
   * @param currentVersion - Current version
   * @returns Restored pack data or null if not found
   */
  restorePreviousVersion(packId: string, currentVersion: string): unknown | null {
    const snapshots = this.snapshots.get(packId) ?? [];
    const currentIndex = snapshots.findIndex((s) => s.version === currentVersion);

    if (currentIndex > 0) {
      return snapshots[currentIndex - 1].data;
    }

    // Fallback to version history
    const previousVersion = this.versionHistoryManager.getPreviousVersion(packId, currentVersion);
    if (previousVersion) {
      // Try to get from snapshots
      return this.restoreVersion(packId, previousVersion);
    }

    return null;
  }

  /**
   * Get rollback history for a pack.
   * 
   * @param packId - Pack identifier
   * @returns Array of snapshots (newest first)
   */
  getRollbackHistory(packId: string): Array<{ version: string; timestamp: number }> {
    const snapshots = this.snapshots.get(packId) ?? [];
    return snapshots
      .slice()
      .sort((a, b) => b.timestamp - a.timestamp)
      .map((s) => ({ version: s.version, timestamp: s.timestamp }));
  }

  /**
   * Clear rollback snapshots for a pack.
   * 
   * @param packId - Pack identifier
   */
  clearSnapshots(packId: string): void {
    this.snapshots.delete(packId);
  }

  /**
   * Extract version from pack data.
   * 
   * @param packData - Pack data object
   * @returns Version string
   * @throws Error if version cannot be extracted
   */
  private extractVersionFromData(packData: unknown): string {
    // This is a simplified version - in practice, you'd extract from the actual pack structure
    if (typeof packData === 'object' && packData !== null) {
      const data = packData as Record<string, unknown>;
      
      // Try common version field names
      const versionFields = ['version', 'packVersion', 'metaVersion', 'dataVersion'];
      for (const field of versionFields) {
        if (typeof data[field] === 'string') {
          return data[field];
        }
      }
    }

    throw new Error('Cannot extract version from pack data');
  }
}

// ============================================================================
// Export all
// ============================================================================

export {
  VersionHistoryManager,
  VersionRollbackManager,
  UpdateDetector,
  parseSemVer,
  formatSemVer,
  compareVersions,
  getUpdateType,
  bumpVersion,
  parseChangelog,
  getChangelogForVersion,
  formatChangelogEntry,
};
