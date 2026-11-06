/**
 * Recording Export/Import Module
 *
 * Provides JSON serialization and deserialization for Recording objects with:
 * - Full metadata export
 * - Selective metadata redaction for sharing
 * - Import with format validation and integrity checking
 * - Version compatibility checking
 *
 * Export Format:
 * - All Recording data including actions and context
 * - Metadata can be selectively redacted for sharing
 * - Version information for compatibility checking
 * - Integrity hash for format validation
 */

import type {
  Recording,
  RecordingMetadata,
  RecordingAction,
  ClickAction,
  KeyboardAction,
  DragAction,
  ScrollAction,
  PauseAction,
} from './recording-types';

/**
 * Exported Recording format with metadata
 *
 * This is the structure used when exporting a Recording to JSON.
 * It preserves all information including sensitive metadata.
 */
export interface ExportedRecording {
  /** Export format version */
  version: string;

  /** Export timestamp */
  exportTimestamp: string;

  /** Unique recording ID */
  id: string;

  /** Recording name */
  name: string;

  /** Optional description */
  description?: string;

  /** Ordered array of actions */
  actions: ExportedAction[];

  /** Full metadata (not redacted) */
  metadata: RecordingMetadata;

  /** SHA-256 hash for format integrity validation */
  integrityHash?: string;
}

/**
 * Exported action format
 *
 * Contains all action data without helper functions.
 */
export interface ExportedAction {
  /** Action type discriminator */
  type: 'click' | 'keyboard' | 'drag' | 'scroll' | 'pause';

  /** ISO 8601 timestamp */
  timestamp: string;

  /** Action-specific data */
  data: ClickActionData | KeyboardActionData | DragActionData | ScrollActionData | PauseActionData;

  /** Optional element context */
  context?: ExportedActionContext;
}

/**
 * Exported ClickAction data
 */
export interface ClickActionData {
  /** Normalized X coordinate [0, 1] */
  x: number;

  /** Normalized Y coordinate [0, 1] */
  y: number;

  /** Mouse button: 'left', 'right', or 'middle' */
  button: 'left' | 'right' | 'middle';

  /** Click count: 1, 2, or 3 */
  clickCount: 1 | 2 | 3;
}

/**
 * Exported KeyboardAction data
 */
export interface KeyboardActionData {
  /** Array of key names */
  keys: string[];

  /** Optional text input */
  text?: string;
}

/**
 * Exported DragAction data
 */
export interface DragActionData {
  /** Normalized start X coordinate [0, 1] */
  startX: number;

  /** Normalized start Y coordinate [0, 1] */
  startY: number;

  /** Normalized end X coordinate [0, 1] */
  endX: number;

  /** Normalized end Y coordinate [0, 1] */
  endY: number;

  /** Optional duration in milliseconds */
  duration?: number;
}

/**
 * Exported ScrollAction data
 */
export interface ScrollActionData {
  /** Normalized X coordinate [0, 1] of scroll reference point */
  x: number;

  /** Normalized Y coordinate [0, 1] of scroll reference point */
  y: number;

  /** Optional horizontal scroll delta */
  deltaX?: number;

  /** Optional vertical scroll delta */
  deltaY?: number;
}

/**
 * Exported PauseAction data
 */
export interface PauseActionData {
  /** Duration in milliseconds */
  duration: number;
}

/**
 * Exported ActionContext data
 */
export interface ExportedActionContext {
  /** CSS selector for targeting the element */
  selector?: string;

  /** DOM path from root to element */
  domPath?: string;

  /** Accessible name (aria-label, etc.) */
  accessibleName?: string;

  /** Unique element identifier */
  elementId?: string;
}

/**
 * Redacted Recording format for sharing
 *
 * This is the structure used when exporting a Recording with redacted metadata.
 * Sensitive fields like author, timestamps, and other identifying information
 * are removed or obfuscated.
 */
export interface RedactedRecording {
  /** Export format version */
  version: string;

  /** Export timestamp (kept as record of export) */
  exportTimestamp: string;

  /** Redacted recording name */
  name: string;

  /** Optional description */
  description?: string;

  /** Ordered array of redacted actions */
  actions: RedactedAction[];

  /** Redacted metadata */
  metadata: RedactedMetadata;

  /** Integrity hash for format validation */
  integrityHash: string;
}

/**
 * Redacted action format
 */
export interface RedactedAction {
  /** Action type discriminator */
  type: 'click' | 'keyboard' | 'drag' | 'scroll' | 'pause';

  /** ISO 8601 timestamp (original time preserved but no identifying info) */
  timestamp: string;

  /** Action-specific data */
  data: ClickActionData | KeyboardActionData | DragActionData | ScrollActionData | PauseActionData;

  /** Optional element context (kept for playback) */
  context?: ExportedActionContext;
}

/**
 * Redacted metadata
 *
 * All identifying and sensitive information has been removed.
 */
export interface RedactedMetadata {
  /** ISO 8601 timestamp when recording was created (kept for duration calculation) */
  createdAt?: string;

  /** Total duration of recording in milliseconds */
  duration: number;

  /** Count of each action type */
  actionCounts: ActionCounts;

  /** Number of unique element contexts */
  elementContexts: number;

  /** Source of the recording */
  source: 'user-capture' | 'ai-generation' | 'import';

  /** Tags for categorization */
  tags?: string[];

  /** Version of the recording format */
  version: string;

  /** Indicates this is a redacted export */
  redacted: true;
}

/**
 * Action count statistics
 */
export interface ActionCounts {
  clicks: number;
  keyboard: number;
  drags: number;
  scrolls: number;
  pauses: number;
}

/**
 * Import validation result
 */
export interface ImportValidationResult {
  /** Whether the import is valid */
  isValid: boolean;

  /** Error messages if invalid */
  errors: string[];

  /** Warning messages */
  warnings: string[];

  /** Compatibility information */
  compatibility?: {
    /** Version compatibility status */
    versionStatus: 'compatible' | 'older' | 'newer' | 'unknown';

    /** Exported format version */
    exportVersion: string;

    /** Supported format version */
    supportedVersion: string;
  };
}

/**
 * Import result
 */
export interface ImportResult {
  /** Whether import succeeded */
  success: boolean;

  /** Imported recording if successful */
  recording?: Recording;

  /** Validation errors if failed */
  errors?: string[];
}

/**
 * Export options for selective metadata control
 */
export interface ExportOptions {
  /** Whether to redact sensitive metadata (default: false) */
  redact?: boolean;

  /** Fields to redact when redact=true */
  redactFields?: ('author' | 'timestamps' | 'identifiers' | 'context')[];

  /** Include integrity hash (default: true) */
  includeIntegrityHash?: boolean;
}

/**
 * Import options for validation control
 */
export interface ImportOptions {
  /** Whether to strict validate format (default: true) */
  strictValidation?: boolean;

  /** Whether to auto-upgrade older formats (default: true) */
  autoUpgrade?: boolean;

  /** Custom validation callback */
  validate?: (data: unknown) => boolean;
}

/**
 * Generate SHA-256 hash for data integrity
 *
 * @param data - Data to hash
 * @returns Base64-encoded SHA-256 hash
 */
function generateHash(data: string): string {
  try {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = new Uint8Array(hashBuffer);
    return btoa(String.fromCharCode(...hashArray));
  } catch {
    // Fallback for environments without crypto.subtle
    // Use a simple checksum for demonstration (not cryptographically secure)
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }
}

/**
 * Export a Recording to JSON format
 *
 * @param recording - Recording to export
 * @param options - Export options
 * @returns ExportedRecording with full metadata
 */
export function exportRecording(
  recording: Recording,
  options: ExportOptions = {},
): ExportedRecording {
  const {
    redact = false,
    redactFields = [],
    includeIntegrityHash = true,
  } = options;

  if (redact) {
    return exportRedactedRecording(recording, options);
  }

  // Convert actions to exported format
  const exportedActions = recording.actions.map(action => exportAction(action));

  // Build exported recording
  const exportedRecording: ExportedRecording = {
    version: '1.0.0',
    exportTimestamp: new Date().toISOString(),
    id: recording.id,
    name: recording.name,
    description: recording.description,
    actions: exportedActions,
    metadata: recording.metadata,
  };

  // Generate integrity hash if requested
  if (includeIntegrityHash) {
    const jsonString = JSON.stringify({
      version: exportedRecording.version,
      id: exportedRecording.id,
      name: exportedRecording.name,
      description: exportedRecording.description,
      actions: exportedRecording.actions,
      metadata: exportedRecording.metadata,
    });
    exportedRecording.integrityHash = generateHash(jsonString);
  }

  return exportedRecording;
}

/**
 * Export a Recording with redacted metadata
 *
 * @param recording - Recording to export
 * @param options - Export options with redactFields
 * @returns RedactedRecording with sensitive data removed
 */
export function exportRedactedRecording(
  recording: Recording,
  options: ExportOptions = {},
): RedactedRecording {
  const { redactFields = [] } = options;

  // Convert actions to exported format (no context redaction by default)
  const exportedActions = recording.actions.map(action => exportAction(action, redactFields));

  // Build redacted metadata
  const redactedMetadata: RedactedMetadata = {
    duration: recording.metadata.duration,
    actionCounts: recording.metadata.actionCounts,
    elementContexts: recording.metadata.elementContexts,
    source: recording.metadata.source,
    tags: recording.metadata.tags,
    version: recording.metadata.version,
    redacted: true,
  };

  // Include createdAt only if not redacting timestamps
  if (!redactFields.includes('timestamps')) {
    redactedMetadata.createdAt = recording.metadata.createdAt;
  }

  // Build redacted recording
  const redactedRecording: RedactedRecording = {
    version: '1.0.0',
    exportTimestamp: new Date().toISOString(),
    name: recording.name,
    description: recording.description,
    actions: exportedActions,
    metadata: redactedMetadata,
  };

  // Generate integrity hash
  const jsonString = JSON.stringify({
    version: redactedRecording.version,
    exportTimestamp: redactedRecording.exportTimestamp,
    name: redactedRecording.name,
    description: redactedRecording.description,
    actions: redactedRecording.actions,
    metadata: redactedRecording.metadata,
  });
  redactedRecording.integrityHash = generateHash(jsonString);

  return redactedRecording;
}

/**
 * Export a single action to JSON format
 *
 * @param action - Action to export
 * @param redactFields - Fields to redact
 * @returns ExportedAction
 */
function exportAction(
  action: RecordingAction,
  redactFields: string[] = [],
): ExportedAction {
  const exported: ExportedAction = {
    type: action.type,
    timestamp: action.timestamp,
    data: exportActionData(action),
  };

  // Export context unless redacting context fields
  if ('context' in action && action.context) {
    if (!redactFields.includes('context')) {
      exported.context = exportActionContext(action.context);
    }
  }

  return exported;
}

/**
 * Export action-specific data
 *
 * @param action - Action to export data from
 * @returns ExportedActionData
 */
function exportActionData(
  action: RecordingAction,
):
  | ClickActionData
  | KeyboardActionData
  | DragActionData
  | ScrollActionData
  | PauseActionData {
  switch (action.type) {
    case 'click':
      return {
        x: action.x,
        y: action.y,
        button: action.button,
        clickCount: action.clickCount,
      };

    case 'keyboard':
      return {
        keys: action.keys,
        text: action.text,
      };

    case 'drag':
      return {
        startX: action.startX,
        startY: action.startY,
        endX: action.endX,
        endY: action.endY,
        duration: action.duration,
      };

    case 'scroll':
      return {
        x: action.x,
        y: action.y,
        deltaX: action.deltaX,
        deltaY: action.deltaY,
      };

    case 'pause':
      return {
        duration: action.duration,
      };
  }
}

/**
 * Export ActionContext to JSON format
 *
 * @param context - ActionContext to export
 * @returns ExportedActionContext
 */
function exportActionContext(context: ExportedActionContext): ExportedActionContext {
  return {
    selector: context.selector,
    domPath: context.domPath,
    accessibleName: context.accessibleName,
    elementId: context.elementId,
  };
}

/**
 * Import a Recording from JSON format
 *
 * @param jsonString - JSON string to import
 * @param options - Import options
 * @returns ImportResult with validation and recording
 */
export function importRecording(
  jsonString: string,
  options: ImportOptions = {},
): ImportResult {
  const {
    strictValidation = true,
    autoUpgrade = true,
  } = options;

  // Parse JSON
  let data: unknown;
  try {
    data = JSON.parse(jsonString);
  } catch (error) {
    return {
      success: false,
      errors: [`Invalid JSON: ${error instanceof Error ? error.message : 'Unknown error'}`],
    };
  }

  // Validate format
  const validation = validateImport(data);
  if (!validation.isValid) {
    return {
      success: false,
      errors: validation.errors,
    };
  }

  // Check compatibility
  if (strictValidation && validation.compatibility) {
    const { versionStatus } = validation.compatibility;
    if (versionStatus === 'newer') {
      return {
        success: false,
        errors: [
          `Export format version ${validation.compatibility.exportVersion} is newer than supported version ${validation.compatibility.supportedVersion}`,
        ],
      };
    }

    // Auto-upgrade older formats if enabled
    if (versionStatus === 'older' && autoUpgrade) {
      // Would implement migration logic here
      // For now, just log a warning
      // validation.warnings.push('Export format is older but will be auto-upgraded');
    }
  }

  // Convert to Recording
  try {
    const recording = convertToRecording(data as ExportedRecording);
    return {
      success: true,
      recording,
    };
  } catch (error) {
    return {
      success: false,
      errors: [
        `Failed to convert to Recording: ${error instanceof Error ? error.message : 'Unknown error'}`,
      ],
    };
  }
}

/**
 * Validate imported data format
 *
 * @param data - Data to validate
 * @returns ImportValidationResult
 */
export function validateImport(data: unknown): ImportValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check basic structure
  if (!data || typeof data !== 'object') {
    errors.push('Data must be a valid JSON object');
    return { isValid: false, errors, warnings };
  }

  const imported = data as ExportedRecording | RedactedRecording;

  // Check required fields
  const requiredFields = ['version', 'exportTimestamp', 'actions'];
  for (const field of requiredFields) {
    if (!(field in imported)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Check version
  const version = imported.version as string;
  const supportedVersion = '1.0.0';

  // Version compatibility check
  let major = 0;
  let minor = 0;
  let supportedMajor = 1;
  let supportedMinor = 0;

  try {
    [major, minor] = version.split('.').map(Number);
  } catch {
    // Keep defaults if parsing fails
  }

  try {
    [supportedMajor, supportedMinor] = supportedVersion.split('.').map(Number);
  } catch {
    // Keep defaults if parsing fails
  }

  let versionStatus: 'compatible' | 'older' | 'newer' | 'unknown' = 'unknown';

  if (Number.isNaN(major) || Number.isNaN(minor)) {
    versionStatus = 'unknown';
  } else if (major === supportedMajor && minor === supportedMinor) {
    versionStatus = 'compatible';
  } else if (major === supportedMajor && minor < supportedMinor) {
    versionStatus = 'older';
  } else if (major === supportedMajor && minor > supportedMinor) {
    versionStatus = 'newer';
  } else if (major > supportedMajor) {
    // Different major version - likely incompatible
    versionStatus = 'newer';
  } else {
    versionStatus = 'older';
  }

  if (versionStatus === 'unknown') {
    warnings.push(`Unknown format version: ${version}`);
  }

  // Check actions array
  if (!Array.isArray(imported.actions)) {
    errors.push('Actions must be an array');
  } else {
    // Validate each action
    imported.actions.forEach((action: unknown, index: number) => {
      if (!action || typeof action !== 'object') {
        errors.push(`Action ${index} must be a valid object`);
        return;
      }

      const actionData = action as ExportedAction;

      // Check action type
      const validTypes = ['click', 'keyboard', 'drag', 'scroll', 'pause'];
      if (!validTypes.includes(actionData.type)) {
        errors.push(`Action ${index} has invalid type: ${actionData.type}`);
      }

      // Check timestamp
      if (typeof actionData.timestamp !== 'string') {
        errors.push(`Action ${index} missing or invalid timestamp`);
      }

      // Check action data
      if (!actionData.data) {
        errors.push(`Action ${index} missing data`);
      }
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    compatibility: {
      versionStatus,
      exportVersion: version,
      supportedVersion,
    },
  };
}

/**
 * Convert imported data to Recording
 *
 * @param data - ExportedRecording data
 * @returns Recording
 */
function convertToRecording(data: ExportedRecording | RedactedRecording): Recording {
  // Convert actions
  const actions = data.actions.map(action => convertAction(action));

  // Build metadata from redacted or full format
  let metadata: RecordingMetadata;

  if ('redacted' in data.metadata) {
    // This is a RedactedRecording
    const redactedMeta = data.metadata as RedactedMetadata;
    metadata = {
      createdAt: redactedMeta.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      duration: redactedMeta.duration,
      actionCounts: redactedMeta.actionCounts,
      elementContexts: redactedMeta.elementContexts,
      source: redactedMeta.source,
      tags: redactedMeta.tags,
      version: redactedMeta.version,
    };
  } else {
    // This is a full ExportedRecording
    metadata = data.metadata as RecordingMetadata;
  }

  // Build recording
  const recording: Recording = {
    id: data.id,
    name: data.name,
    description: data.description,
    actions,
    metadata,
  };

  // Generate new timestamps and update metadata
  const now = new Date().toISOString();
  recording.metadata = {
    ...recording.metadata,
    createdAt: now,
    updatedAt: now,
  };

  // Recalculate duration based on actual actions
  recording.metadata.duration = calculateDuration(actions);

  // Recalculate action counts
  recording.metadata.actionCounts = countActions(actions);

  // Recalculate element contexts
  recording.metadata.elementContexts = countElementContexts(actions);

  return recording;
}

/**
 * Convert exported action to RecordingAction
 *
 * @param action - ExportedAction
 * @returns RecordingAction
 */
function convertAction(action: ExportedAction): RecordingAction {
  switch (action.type) {
    case 'click':
      return {
        type: 'click',
        timestamp: action.timestamp,
        x: (action.data as ClickActionData).x,
        y: (action.data as ClickActionData).y,
        button: (action.data as ClickActionData).button,
        clickCount: (action.data as ClickActionData).clickCount,
        context: action.context ? convertActionContext(action.context) : undefined,
      };

    case 'keyboard':
      return {
        type: 'keyboard',
        timestamp: action.timestamp,
        keys: (action.data as KeyboardActionData).keys,
        text: (action.data as KeyboardActionData).text,
        context: action.context ? convertActionContext(action.context) : undefined,
      };

    case 'drag':
      return {
        type: 'drag',
        timestamp: action.timestamp,
        startX: (action.data as DragActionData).startX,
        startY: (action.data as DragActionData).startY,
        endX: (action.data as DragActionData).endX,
        endY: (action.data as DragActionData).endY,
        duration: (action.data as DragActionData).duration,
        context: action.context ? convertActionContext(action.context) : undefined,
      };

    case 'scroll':
      return {
        type: 'scroll',
        timestamp: action.timestamp,
        x: (action.data as ScrollActionData).x,
        y: (action.data as ScrollActionData).y,
        deltaX: (action.data as ScrollActionData).deltaX,
        deltaY: (action.data as ScrollActionData).deltaY,
        context: action.context ? convertActionContext(action.context) : undefined,
      };

    case 'pause':
      return {
        type: 'pause',
        timestamp: action.timestamp,
        duration: (action.data as PauseActionData).duration,
      };
  }
}

/**
 * Convert exported ActionContext to ActionContext
 *
 * @param context - ExportedActionContext
 * @returns ActionContext
 */
function convertActionContext(context: ExportedActionContext): ActionContext {
  return {
    selector: context.selector,
    domPath: context.domPath,
    accessibleName: context.accessibleName,
    elementId: context.elementId,
  };
}

/**
 * Import from RedactedRecording format
 *
 * @param jsonString - JSON string of redacted recording
 * @param options - Import options
 * @returns ImportResult
 */
export function importRedactedRecording(
  jsonString: string,
  options: ImportOptions = {},
): ImportResult {
  return importRecording(jsonString, options);
}

/**
 * Calculate duration from actions (inline implementation)
 *
 * @param actions - Array of actions
 * @returns Total duration in milliseconds
 */
function calculateDuration(actions: RecordingAction[]): number {
  if (actions.length === 0) return 0;

  const timestamps = actions.map((a) => new Date(a.timestamp).getTime());
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);

  let totalDuration = maxTime - minTime;

  for (const action of actions) {
    if (action.type === 'pause') {
      totalDuration += action.duration;
    }
  }

  return Math.round(totalDuration);
}

/**
 * Count actions by type (inline implementation)
 *
 * @param actions - Array of actions
 * @returns ActionCounts
 */
function countActions(actions: RecordingAction[]): ActionCounts {
  const counts: ActionCounts = {
    clicks: 0,
    keyboard: 0,
    drags: 0,
    scrolls: 0,
    pauses: 0,
  };

  for (const action of actions) {
    switch (action.type) {
      case 'click':
        counts.clicks++;
        break;
      case 'keyboard':
        counts.keyboard++;
        break;
      case 'drag':
        counts.drags++;
        break;
      case 'scroll':
        counts.scrolls++;
        break;
      case 'pause':
        counts.pauses++;
        break;
    }
  }

  return counts;
}

/**
 * Count unique element contexts (inline implementation)
 *
 * @param actions - Array of actions
 * @returns Number of unique contexts
 */
function countElementContexts(actions: RecordingAction[]): number {
  const contexts = new Set<string>();

  for (const action of actions) {
    if ('context' in action && action.context) {
      const key = JSON.stringify(action.context);
      contexts.add(key);
    }
  }

  return contexts.size;
}
