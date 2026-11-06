/**
 * Pack Update Notifications
 * Handles update detection, user notifications, changelog display, in-place updating, and rollback on failure.
 * 
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
 * Features: Detect newer versions, notify user with details and changelog, in-place updating, rollback on failure
 */

import {
  parseSemVer,
  compareVersions,
  getUpdateType,
  bumpVersion,
  parseChangelog,
  formatChangelogEntry,
  getChangelogForVersion,
  VersionHistoryManager,
  VersionRollbackManager,
  UpdateDetector,
  SemVer,
  VersionComparison,
  UpdateInfo,
  VersionHistoryEntry,
  UpdatePreferences,
  UpdateEvent,
  UpdateEventType,
  UpdateConfig,
} from './version-manager';

// ============================================================================
// Type Definitions
// ============================================================================

/** User notification preferences per pack */
export interface PackUpdatePreferences {
  packId: string;
  enabled: boolean;
  autoUpdate: boolean;
  notificationChannel: 'in-app' | 'email' | 'desktop';
  showChangelog: boolean;
  updateAutoVerified: boolean;  // Whether update was auto-verified
}

/** In-place update progress */
export interface UpdateProgress {
  packId: string;
  currentStep: 'download' | 'verify' | 'install' | 'migrate' | 'complete';
  totalSteps: number;
  progress: number;  // 0-100
  status: 'pending' | 'in-progress' | 'completed' | 'failed' | 'rolled-back';
  message?: string;
  timestamp: number;
}

/** Update result with details */
export interface UpdateResult {
  success: boolean;
  packId: string;
  fromVersion: string;
  toVersion: string;
  updateType: 'major' | 'minor' | 'patch';
  timestamp: number;
  error?: string;
  migrationNotes?: string[];
  warnings?: string[];
}

/** Update preferences storage */
export interface UpdatePreferencesStorage {
  global: UpdatePreferences;
  perPack: Map<string, PackUpdatePreferences>;
}

/** Notification message for user */
export interface NotificationMessage {
  id: string;
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  details?: string;
  timestamp: number;
  read: boolean;
  packId?: string;
  action?: {
    label: string;
    callback: () => void;
  };
}

// ============================================================================
// Event System
// ============================================================================

/** Event handler type for update events */
export type UpdateEventHandler = (event: UpdateEvent) => void;

/** Central event emitter for update notifications */
export class UpdateEventEmitter {
  private listeners: Map<UpdateEventType, UpdateEventHandler[]> = new Map();
  private eventHistory: UpdateEvent[] = [];

  /**
   * Subscribe to update events.
   * 
   * @param type - Event type to listen for
   * @param handler - Event handler function
   * @returns Unsubscribe function
   */
  on(type: UpdateEventType, handler: UpdateEventHandler): () => void {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);

    return () => {
      const handlers = this.listeners.get(type);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
    };
  }

  /**
   * Emit an update event.
   * 
   * @param event - Event to emit
   */
  emit(event: UpdateEvent): void {
    // Store in history
    this.eventHistory.push(event);
    if (this.eventHistory.length > 100) {
      this.eventHistory.shift();
    }

    // Notify listeners
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (error) {
          console.error(`Error in update event handler for ${event.type}:`, error);
        }
      }
    }
  }

  /**
   * Get event history for a pack.
   * 
   * @param packId - Pack identifier
   * @returns Array of events
   */
  getEventHistory(packId?: string): UpdateEvent[] {
    if (!packId) {
      return this.eventHistory.slice();
    }
    return this.eventHistory.filter((e) => e.packId === packId);
  }

  /**
   * Clear event history.
   */
  clearHistory(): void {
    this.eventHistory = [];
  }
}

// ============================================================================
// Notification System
// ============================================================================

/** Notification manager for displaying update alerts */
export class UpdateNotificationManager {
  private notifications: Map<string, NotificationMessage> = new Map();
  private eventEmitter: UpdateEventEmitter;
  private preferencesStorage: UpdatePreferencesStorage;
  private versionHistoryManager: VersionHistoryManager;
  private updateDetector: UpdateDetector;
  private versionRollbackManager: VersionRollbackManager;

  constructor(
    eventEmitter: UpdateEventEmitter,
    preferencesStorage: UpdatePreferencesStorage,
    versionHistoryManager: VersionHistoryManager,
    updateDetector: UpdateDetector,
    versionRollbackManager: VersionRollbackManager,
  ) {
    this.eventEmitter = eventEmitter;
    this.preferencesStorage = preferencesStorage;
    this.versionHistoryManager = versionHistoryManager;
    this.updateDetector = updateDetector;
    this.versionRollbackManager = versionRollbackManager;
  }

  /**
   * Show an update notification to the user.
   * 
   * @param updateInfo - Update information
   * @param packName - Pack name for display
   */
  showUpdateNotification(updateInfo: UpdateInfo, packName: string): void {
    const { currentVersion, availableVersion, updateType, changelog, breakingChanges, newFeatures, bugFixes } = updateInfo;

    const notification: NotificationMessage = {
      id: `update-${packName}-${availableVersion}-${Date.now()}`,
      type: 'info',
      title: `${packName} ${updateType} Update Available`,
      message: `Version ${availableVersion} is now available (you have ${currentVersion})`,
      details: this.buildNotificationDetails(updateInfo, packName),
      timestamp: Date.now(),
      read: false,
      action: {
        label: 'View Changelog',
        callback: () => {
          this.showChangelog(updateInfo, packName);
        },
      },
    };

    this.notifications.set(notification.id, notification);
    this.eventEmitter.emit({
      type: 'update-available',
      timestamp: Date.now(),
      packId: packName,
      currentVersion,
      newVersion: availableVersion,
      details: { packName, updateType },
    });
  }

  /**
   * Build detailed notification message with changelog highlights.
   * 
   * @param updateInfo - Update information
   * @param packName - Pack name
   * @returns Detailed message string
   */
  private buildNotificationDetails(updateInfo: UpdateInfo, packName: string): string {
    const { breakingChanges, newFeatures, bugFixes, availableVersion } = updateInfo;
    
    const lines: string[] = [
      `Update to ${packName} v${availableVersion}`,
    ];

    if (breakingChanges && breakingChanges.length > 0) {
      lines.push('\n⚠️ Breaking Changes:');
      for (const change of breakingChanges.slice(0, 3)) {
        lines.push(`  • ${change}`);
      }
      if (breakingChanges.length > 3) {
        lines.push(`  ... and ${breakingChanges.length - 3} more`);
      }
    }

    if (newFeatures && newFeatures.length > 0) {
      lines.push('\n✨ New Features:');
      for (const feature of newFeatures.slice(0, 3)) {
        lines.push(`  • ${feature}`);
      }
      if (newFeatures.length > 3) {
        lines.push(`  ... and ${newFeatures.length - 3} more`);
      }
    }

    if (bugFixes && bugFixes.length > 0) {
      lines.push('\n🐛 Bug Fixes:');
      for (const fix of bugFixes.slice(0, 3)) {
        lines.push(`  • ${fix}`);
      }
      if (bugFixes.length > 3) {
        lines.push(`  ... and ${bugFixes.length - 3} more`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Show changelog to the user.
   * 
   * @param updateInfo - Update information
   * @param packName - Pack name
   */
  showChangelog(updateInfo: UpdateInfo, packName: string): void {
    const { changelog, availableVersion, currentVersion, updateType } = updateInfo;
    const changelogEntry = getChangelogForVersion(changelog, availableVersion);

    let formattedChangelog;
    if (changelogEntry) {
      formattedChangelog = formatChangelogEntry(changelogEntry);
    } else {
      formattedChangelog = changelog;
    }

    const migrationNotes = this.generateMigrationNotes(updateInfo, packName);

    console.log('=== Changelog for', packName, availableVersion, '===\n');
    console.log(formattedChangelog);
    if (migrationNotes && migrationNotes.length > 0) {
      console.log('\n=== Migration Notes ===\n');
      console.log(migrationNotes.join('\n'));
    }

    // In a real implementation, this would show a modal or UI component
    // For now, we log it to console
  }

  /**
   * Generate migration notes based on update type and breaking changes.
   * 
   * @param updateInfo - Update information
   * @param packName - Pack name
   * @returns Array of migration notes
   */
  private generateMigrationNotes(updateInfo: UpdateInfo, packName: string): string[] {
    const { updateType, breakingChanges, availableVersion } = updateInfo;
    const notes: string[] = [];

    if (updateType === 'major') {
      notes.push(`⚠️ Major version upgrade: ${availableVersion}`);
      notes.push('  This may include breaking changes. Please review the changelog carefully.');
      notes.push('  Consider testing in a development environment first.');
    }

    if (breakingChanges && breakingChanges.length > 0) {
      notes.push('\n⚠️ Manual migration may be required due to breaking changes:');
      for (const change of breakingChanges) {
        notes.push(`  • ${change}`);
      }
    } else {
      notes.push('✓ No major breaking changes detected');
      notes.push('  Update should be safe to apply directly.');
    }

    notes.push('\nBackup Recommendation:');
    notes.push('  A rollback version has been created automatically.');
    notes.push('  If issues occur, use the rollback feature to restore the previous version.');

    return notes;
  }

  /**
   * Mark notification as read.
   * 
   * @param notificationId - Notification ID
   */
  markAsRead(notificationId: string): void {
    const notification = this.notifications.get(notificationId);
    if (notification) {
      notification.read = true;
    }
  }

  /**
   * Mark all notifications as read.
   */
  markAllAsRead(): void {
    for (const notification of this.notifications.values()) {
      notification.read = true;
    }
  }

  /**
   * Dismiss a notification.
   * 
   * @param notificationId - Notification ID
   */
  dismissNotification(notificationId: string): void {
    this.notifications.delete(notificationId);
  }

  /**
   * Dismiss all notifications for a pack.
   * 
   * @param packId - Pack identifier
   */
  dismissPackNotifications(packId: string): void {
    for (const [id, notification] of this.notifications.entries()) {
      if (notification.packId === packId) {
        this.notifications.delete(id);
      }
    }
  }

  /**
   * Get all pending notifications.
   * 
   * @returns Array of unread notifications
   */
  getPendingNotifications(): NotificationMessage[] {
    return Array.from(this.notifications.values()).filter((n) => !n.read);
  }

  /**
   * Get all notifications.
   * 
   * @returns Array of all notifications
   */
  getAllNotifications(): NotificationMessage[] {
    return Array.from(this.notifications.values()).sort(
      (a, b) => b.timestamp - a.timestamp
    );
  }

  /**
   * Check for updates and show notifications if updates are available.
   * 
   * @param packs - Array of packs to check
   * @param packNames - Map of packId to pack name
   */
  async checkAndNotify(packs: { id: string; version: string; changelog?: string }[], packNames: Record<string, string>): Promise<void> {
    for (const pack of packs) {
      const updateInfo = this.updateDetector.checkForUpdate(pack.id, pack.version, pack.changelog ?? '');
      
      if (updateInfo) {
        const pref = this.preferencesStorage.perPack.get(pack.id);
        const showNotification = pref?.enabled ?? this.preferencesStorage.global.notificationEnabled;
        
        if (showNotification) {
          const packName = packNames[pack.id] || pack.id;
          this.showUpdateNotification(updateInfo, packName);
        }
      }
    }
  }
}

// ============================================================================
// Update Manager
// ============================================================================

/** Update manager for handling the complete update workflow */
export class PackUpdateManager {
  private notificationManager: UpdateNotificationManager;
  private versionHistoryManager: VersionHistoryManager;
  private versionRollbackManager: VersionRollbackManager;
  private updateDetector: UpdateDetector;
  private eventEmitter: UpdateEventEmitter;
  private preferencesStorage: UpdatePreferencesStorage;
  private progressMap: Map<string, UpdateProgress> = new Map();
  private updateHistory: UpdateResult[] = [];

  constructor(
    notificationManager: UpdateNotificationManager,
    versionHistoryManager: VersionHistoryManager,
    versionRollbackManager: VersionRollbackManager,
    updateDetector: UpdateDetector,
    eventEmitter: UpdateEventEmitter,
    preferencesStorage: UpdatePreferencesStorage,
  ) {
    this.notificationManager = notificationManager;
    this.versionHistoryManager = versionHistoryManager;
    this.versionRollbackManager = versionRollbackManager;
    this.updateDetector = updateDetector;
    this.eventEmitter = eventEmitter;
    this.preferencesStorage = preferencesStorage;
  }

  /**
   * Check for updates for a specific pack.
   * 
   * @param packId - Pack identifier
   * @param currentVersion - Current version
   * @param changelog - Current changelog
   * @returns UpdateInfo if available, null otherwise
   */
  checkUpdate(packId: string, currentVersion: string, changelog: string): UpdateInfo | null {
    return this.updateDetector.checkForUpdate(packId, currentVersion, changelog);
  }

  /**
   * Start updating a pack.
   * 
   * @param packId - Pack identifier
   * @param updateInfo - Update information
   * @param packData - Current pack data for snapshot
   * @returns UpdateProgress for tracking
   */
  async startUpdate(packId: string, updateInfo: UpdateInfo, packData: unknown): Promise<UpdateProgress> {
    const { availableVersion } = updateInfo;
    const updateProgress: UpdateProgress = {
      packId,
      currentStep: 'download',
      totalSteps: 4,
      progress: 0,
      status: 'in-progress',
      timestamp: Date.now(),
    };

    this.progressMap.set(packId, updateProgress);

    try {
      // Step 1: Download (simulated)
      this.updateProgress(packId, 'download', 25, 'Downloading update...');
      await this.simulateDownload(packId, availableVersion);

      // Step 2: Verify checksum (simulated)
      this.updateProgress(packId, 'verify', 50, 'Verifying update...');
      await this.simulateVerification(packId, availableVersion);

      // Step 3: Create snapshot before install (rollback)
      this.versionRollbackManager.createSnapshot(packId, packData);
      this.versionHistoryManager.addVersion(packId, {
        version: updateInfo.currentVersion,
        timestamp: Date.now(),
        author: 'System',
        changes: ['Update pending', `Upgrading to ${availableVersion}`],
      });

      // Step 4: Install (simulated)
      this.updateProgress(packId, 'install', 75, 'Installing update...');
      await this.simulateInstall(packId, availableVersion);

      // Step 5: Migrate (simulated)
      this.updateProgress(packId, 'migrate', 90, 'Migrating data...');
      const migrationNotes = await this.simulateMigration(packId, updateInfo);

      // Complete
      this.updateProgress(packId, 'complete', 100, 'Update complete');
      updateProgress.status = 'completed';

      // Record update result
      const updateResult: UpdateResult = {
        success: true,
        packId,
        fromVersion: updateInfo.currentVersion,
        toVersion: availableVersion,
        updateType: updateInfo.updateType,
        timestamp: Date.now(),
        migrationNotes,
      };
      this.updateHistory.push(updateResult);

      // Emit success event
      this.eventEmitter.emit({
        type: 'update-installed',
        timestamp: Date.now(),
        packId,
        currentVersion: updateInfo.currentVersion,
        newVersion: availableVersion,
      });

      // Clear progress
      this.progressMap.delete(packId);

      return updateProgress;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      updateProgress.status = 'failed';
      updateProgress.message = errorMessage;
      this.updateProgress(packId, updateProgress.currentStep, updateProgress.progress, errorMessage);

      // Emit failure event
      this.eventEmitter.emit({
        type: 'update-failed',
        timestamp: Date.now(),
        packId,
        currentVersion: updateInfo.currentVersion,
        error: errorMessage,
      });

      // Auto rollback if configured
      if (this.preferencesStorage.global.autoRollbackOnFailure) {
        await this.rollback(packId, updateInfo.currentVersion);
      }

      this.progressMap.delete(packId);

      return updateProgress;
    }
  }

  /**
   * Rollback to a previous version.
   * 
   * @param packId - Pack identifier
   * @param targetVersion - Version to rollback to
   * @returns Rollback result
   */
  async rollback(packId: string, targetVersion?: string): Promise<UpdateResult> {
    try {
      const currentProgress = this.progressMap.get(packId);
      const currentVersion = currentProgress?.status === 'in-progress'
        ? currentProgress.timestamp.toString()
        : this.versionHistoryManager.getLatestVersion(packId);

      if (!currentVersion) {
        throw new Error(`No current version found for pack ${packId}`);
      }

      // Get version to rollback to
      const versionToRollback = targetVersion ?? this.versionRollbackManager.getRollbackHistory(packId)?.[0]?.version;

      if (!versionToRollback) {
        throw new Error(`No previous version available for rollback for pack ${packId}`);
      }

      // Restore previous version
      const restoredData = this.versionRollbackManager.restoreVersion(packId, versionToRollback);

      if (!restoredData) {
        throw new Error(`Failed to restore version ${versionToRollback} for pack ${packId}`);
      }

      // Update history
      this.versionHistoryManager.addVersion(packId, {
        version: currentVersion,
        timestamp: Date.now(),
        author: 'System',
        changes: ['Rollback performed', `Rolled back to ${versionToRollback}`],
        deprecated: true,
      });

      // Emit rollback event
      this.eventEmitter.emit({
        type: 'update-rollback',
        timestamp: Date.now(),
        packId,
        currentVersion,
        newVersion: versionToRollback,
      });

      // Record result
      const result: UpdateResult = {
        success: true,
        packId,
        fromVersion: currentVersion,
        toVersion: versionToRollback,
        updateType: 'patch' as const,
        timestamp: Date.now(),
        warnings: ['Rollback performed. Some new features may be unavailable.'],
      };
      this.updateHistory.push(result);

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.eventEmitter.emit({
        type: 'update-failed',
        timestamp: Date.now(),
        packId,
        error: errorMessage,
      });

      return {
        success: false,
        packId,
        fromVersion: targetVersion ?? 'unknown',
        toVersion: 'unknown',
        updateType: 'patch' as const,
        timestamp: Date.now(),
        error: errorMessage,
      };
    }
  }

  /**
   * Get update progress for a pack.
   * 
   * @param packId - Pack identifier
   * @returns UpdateProgress or null if not updating
   */
  getProgress(packId: string): UpdateProgress | null {
    return this.progressMap.get(packId) ?? null;
  }

  /**
   * Get update history for a pack.
   * 
   * @param packId - Pack identifier
   * @returns Array of update results
   */
  getUpdateHistory(packId: string): UpdateResult[] {
    return this.updateHistory.filter((h) => h.packId === packId);
  }

  /**
   * Check for updates and apply auto-updates if configured.
   * 
   * @param packs - Array of packs to check
   * @param packNames - Map of packId to pack name
   * @param packDataMap - Map of packId to pack data
   */
  async autoUpdateCheck(
    packs: { id: string; version: string; changelog?: string; data?: unknown }[],
    packNames: Record<string, string>,
    packDataMap: Record<string, unknown>,
  ): Promise<void> {
    for (const pack of packs) {
      const pref = this.preferencesStorage.perPack.get(pack.id);
      const globalAutoUpdate = this.preferencesStorage.global.autoUpdate;
      const packAutoUpdate = pref?.autoUpdate ?? globalAutoUpdate;

      if (packAutoUpdate) {
        const updateInfo = this.updateDetector.checkForUpdate(pack.id, pack.version, pack.changelog ?? '');
        
        if (updateInfo) {
          const packName = packNames[pack.id] || pack.id;
          
          // Check if update was auto-verified
          if (pref?.updateAutoVerified || !pref) {
            console.log(`Auto-update starting for ${packName}...`);
            await this.startUpdate(pack.id, updateInfo, packDataMap[pack.id]);
          } else {
            // Show notification but don't auto-update
            this.notificationManager.showUpdateNotification(updateInfo, packName);
          }
        }
      }
    }
  }

  // ============================================================================
  // Helper methods (simulated for demonstration)
  // ============================================================================

  private updateProgress(packId: string, step: UpdateProgress['currentStep'], progress: number, message?: string): void {
    const current = this.progressMap.get(packId);
    if (current) {
      current.currentStep = step;
      current.progress = progress;
      if (message) {
        current.message = message;
      }
      this.progressMap.set(packId, current);

      // Emit progress event
      this.eventEmitter.emit({
        type: 'update-downloading',
        timestamp: Date.now(),
        packId,
        currentVersion: current.timestamp.toString(),
        details: { step, progress, message },
      });
    }
  }

  private async simulateDownload(packId: string, version: string): Promise<void> {
    // Simulate network delay
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  private async simulateVerification(packId: string, version: string): Promise<void> {
    // Simulate checksum verification
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  private async simulateInstall(packId: string, version: string): Promise<void> {
    // Simulate installation
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  private async simulateMigration(packId: string, updateInfo: UpdateInfo): Promise<string[]> {
    // Generate migration notes based on update type
    const notes: string[] = [];
    
    if (updateInfo.updateType === 'major') {
      notes.push(`Major version upgrade may require manual configuration`);
    }

    if (updateInfo.breakingChanges && updateInfo.breakingChanges.length > 0) {
      notes.push(`Review breaking changes before using new version`);
    }

    return notes;
  }
}

// ============================================================================
// Main entry point for update system
// ============================================================================

/** Create complete update notification system */
export function createUpdateSystem(config: UpdateConfig = {
  defaultPreferences: {
    autoUpdate: false,
    notificationEnabled: true,
    updateChannel: 'stable',
    checkInterval: 60,
    autoRollbackOnFailure: true,
    showChangelog: true,
  },
  checkInterval: 60,
  maxHistory: 20,
  enableRollback: true,
}): {
  versionHistoryManager: VersionHistoryManager;
  versionRollbackManager: VersionRollbackManager;
  updateDetector: UpdateDetector;
  eventEmitter: UpdateEventEmitter;
  notificationManager: UpdateNotificationManager;
  updateManager: PackUpdateManager;
} {
  // Create components
  const versionHistoryManager = new VersionHistoryManager();
  const versionRollbackManager = new VersionRollbackManager(versionHistoryManager);
  const updateDetector = new UpdateDetector(versionHistoryManager);
  const eventEmitter = new UpdateEventEmitter();

  // Initialize preferences storage
  const preferencesStorage: UpdatePreferencesStorage = {
    global: config.defaultPreferences,
    perPack: new Map(),
  };

  // Create managers
  const notificationManager = new UpdateNotificationManager(
    eventEmitter,
    preferencesStorage,
    versionHistoryManager,
    updateDetector,
    versionRollbackManager,
  );

  const updateManager = new PackUpdateManager(
    notificationManager,
    versionHistoryManager,
    versionRollbackManager,
    updateDetector,
    eventEmitter,
    preferencesStorage,
  );

  return {
    versionHistoryManager,
    versionRollbackManager,
    updateDetector,
    eventEmitter,
    notificationManager,
    updateManager,
  };
}

// ============================================================================
// Export types and classes
// ============================================================================

export {
  UpdateEventEmitter,
  UpdateNotificationManager,
  PackUpdateManager,
  UpdatePreferences,
  UpdatePreferencesStorage,
  PackUpdatePreferences,
  UpdateProgress,
  UpdateResult,
  NotificationMessage,
  UpdateEventType,
};
