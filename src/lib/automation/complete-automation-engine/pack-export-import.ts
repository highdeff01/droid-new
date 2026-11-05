/**
 * Pack Export/Import Service
 *
 * Provides functionality to export packs to shareable JSON format with bundled workflows,
 * and import shared packs with comprehensive validation and compatibility checking.
 *
 * Key features:
 * - Export pack to portable JSON with metadata, version history, and bundled workflows
 * - Optional compression for large packs
 * - Generate integrity hash/signature for verification
 * - Import with format validation and compatibility checking
 * - Detect conflicts (duplicate pack IDs, versions)
 * - Validate workflow references and deployment policies
 * - Support version compatibility checking
 */

import crypto from 'crypto';
import zlib from 'zlib';
import { promisify } from 'util';
import {
  Pack,
  PackVersion,
  PackMetadata,
  DeploymentPolicy,
  WorkflowReference,
  validatePack,
  validatePackMetadata,
  validateDeploymentPolicy,
  versionSatisfies,
} from '../../../../pack-types';
import { Workflow } from '../../../../workflow-types';

// Promisify compression functions
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * Exported pack format with bundled workflows and metadata
 */
export interface PackExportData {
  /** Format version for compatibility checking (e.g., "1.0.0") */
  formatVersion: string;

  /** Pack metadata and structure */
  pack: Pack;

  /** Full version history for the pack */
  versionHistory: PackVersion[];

  /** Bundled workflows referenced by the pack */
  workflows: Record<string, Workflow>;

  /** Export timestamp (ISO 8601) */
  exportedAt: string;

  /** SHA-256 integrity hash of pack data (excluding this field) */
  hash?: string;

  /** Optional digital signature for authenticity (future use) */
  signature?: string;
}

/**
 * Import result with detailed validation information
 */
export interface PackImportResult {
  /** Whether import succeeded */
  success: boolean;

  /** Imported pack (if successful) */
  pack?: Pack;

  /** Version history (if successful) */
  versionHistory?: PackVersion[];

  /** Bundled workflows (if successful) */
  workflows?: Record<string, Workflow>;

  /** Validation errors (if failed) */
  errors: ImportValidationError[];

  /** Warnings (non-blocking issues) */
  warnings: ImportValidationWarning[];

  /** Compatibility information */
  compatibility?: {
    isCompatible: boolean;
    issues: CompatibilityIssue[];
    warnings: CompatibilityWarning[];
  };
}

/**
 * Validation error during import
 */
export interface ImportValidationError {
  code: string;
  message: string;
  field?: string;
  details?: Record<string, unknown>;
}

/**
 * Validation warning during import
 */
export interface ImportValidationWarning {
  code: string;
  message: string;
  field?: string;
  details?: Record<string, unknown>;
}

/**
 * Compatibility issue detected
 */
export interface CompatibilityIssue {
  type: 'version-mismatch' | 'platform-unsupported' | 'policy-conflict' | 'workflow-unavailable';
  message: string;
  details?: Record<string, unknown>;
  severity: 'error' | 'warning';
}

/**
 * Compatibility warning
 */
export interface CompatibilityWarning {
  type:
    | 'platform-partial-support'
    | 'version-deprecation'
    | 'policy-adjustment'
    | 'workflow-modification';
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Export conflict when a pack already exists
 */
export interface PackConflict {
  type: 'duplicate-id' | 'version-exists' | 'name-conflict';
  packId: string;
  existingVersion?: string;
  incomingVersion?: string;
  message: string;
}

/**
 * Format validation result
 */
export interface FormatValidationResult {
  isValid: boolean;
  errors: ImportValidationError[];
  warnings: ImportValidationWarning[];
}

/**
 * Compatibility checking result
 */
export interface CompatibilityCheckResult {
  isCompatible: boolean;
  issues: CompatibilityIssue[];
  warnings: CompatibilityWarning[];
}

/**
 * Pack Export/Import Service
 *
 * Handles all export and import operations for packs with validation,
 * compatibility checking, and integrity verification.
 */
export class PackExportImportService {
  /** Current format version */
  private static readonly FORMAT_VERSION = '1.0.0';

  /** Supported format versions for backward compatibility */
  private static readonly SUPPORTED_VERSIONS = ['1.0.0'];

  /** Current platform version (for compatibility checking) */
  private platformVersion: string;

  /** Current platform name */
  private platform: string;

  /** Existing packs for conflict detection */
  private existingPacks: Map<string, Pack>;

  constructor(platformVersion: string = '1.0.0', platform: string = 'windows') {
    this.platformVersion = platformVersion;
    this.platform = platform;
    this.existingPacks = new Map();
  }

  /**
   * Set existing packs for conflict detection during import
   *
   * @param packs - Array of existing packs
   */
  setExistingPacks(packs: Pack[]): void {
    this.existingPacks.clear();
    for (const pack of packs) {
      this.existingPacks.set(pack.id, pack);
    }
  }

  /**
   * Export a pack to shareable JSON format with bundled workflows.
   *
   * @param pack - Pack to export
   * @param workflows - Map of workflows referenced by the pack (keyed by workflow ID)
   * @param versionHistory - Complete version history of the pack
   * @param options - Export options
   * @returns Export data as JSON string
   * @throws Error if pack or workflows are invalid
   */
  exportPack(
    pack: Pack,
    workflows: Map<string, Workflow>,
    versionHistory: PackVersion[],
    options: ExportOptions = {},
  ): string {
    // Validate pack
    validatePack(pack);

    // Validate that all referenced workflows are provided
    for (const workflow of pack.manifest.workflows) {
      if (!workflows.has(workflow.workflowId)) {
        throw new Error(
          `Missing workflow "${workflow.workflowId}" referenced in pack manifest`,
        );
      }
    }

    // Validate version history
    if (!Array.isArray(versionHistory) || versionHistory.length === 0) {
      throw new Error('Version history must be a non-empty array');
    }

    // Build export data
    const workflowsRecord: Record<string, Workflow> = {};
    for (const [id, workflow] of workflows) {
      workflowsRecord[id] = workflow;
    }

    const exportData: PackExportData = {
      formatVersion: PackExportImportService.FORMAT_VERSION,
      pack,
      versionHistory,
      workflows: workflowsRecord,
      exportedAt: new Date().toISOString(),
    };

    // Generate hash for integrity verification
    if (options.includeHash !== false) {
      exportData.hash = this.generateHash(exportData);
    }

    // Serialize to JSON
    const json = JSON.stringify(exportData, null, 2);

    // Handle compression if requested
    if (options.compress) {
      return this.compressSync(json);
    }

    return json;
  }

  /**
   * Export a pack asynchronously with optional compression.
   *
   * @param pack - Pack to export
   * @param workflows - Map of workflows referenced by the pack
   * @param versionHistory - Complete version history
   * @param options - Export options
   * @returns Promise resolving to export data as string (compressed if requested)
   */
  async exportPackAsync(
    pack: Pack,
    workflows: Map<string, Workflow>,
    versionHistory: PackVersion[],
    options: ExportOptions = {},
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        // Validate pack
        validatePack(pack);

        // Validate workflows
        for (const workflow of pack.manifest.workflows) {
          if (!workflows.has(workflow.workflowId)) {
            reject(
              new Error(
                `Missing workflow "${workflow.workflowId}" referenced in pack manifest`,
              ),
            );
            return;
          }
        }

        // Build export data
        const workflowsRecord: Record<string, Workflow> = {};
        for (const [id, workflow] of workflows) {
          workflowsRecord[id] = workflow;
        }

        const exportData: PackExportData = {
          formatVersion: PackExportImportService.FORMAT_VERSION,
          pack,
          versionHistory,
          workflows: workflowsRecord,
          exportedAt: new Date().toISOString(),
        };

        // Generate hash
        if (options.includeHash !== false) {
          exportData.hash = this.generateHash(exportData);
        }

        const json = JSON.stringify(exportData, null, 2);

        // Handle compression if requested
        if (options.compress) {
          gzip(json)
            .then((compressed) => {
              resolve(compressed.toString('base64'));
            })
            .catch(reject);
        } else {
          resolve(json);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Import a pack from JSON format with comprehensive validation.
   *
   * @param json - JSON string containing export data
   * @param options - Import options
   * @returns Import result with validation information
   */
  importPack(json: string, options: ImportOptions = {}): PackImportResult {
    const errors: ImportValidationError[] = [];
    const warnings: ImportValidationWarning[] = [];

    try {
      // Parse JSON
      let exportData: PackExportData;
      try {
        exportData = JSON.parse(json) as PackExportData;
      } catch (error) {
        errors.push({
          code: 'INVALID_JSON',
          message: 'Failed to parse JSON: ' + String(error),
        });
        return {
          success: false,
          errors,
          warnings,
        };
      }

      // Validate format
      const formatValidation = this.validateFormat(exportData);
      errors.push(...formatValidation.errors);
      warnings.push(...formatValidation.warnings);

      if (!formatValidation.isValid) {
        return {
          success: false,
          errors,
          warnings,
        };
      }

      // Check for conflicts
      const conflicts = this.detectConflicts(exportData.pack);
      if (conflicts.length > 0 && !options.allowConflicts) {
        errors.push({
          code: 'CONFLICT_DETECTED',
          message: `Pack conflicts detected: ${conflicts.map((c) => c.message).join('; ')}`,
          details: { conflicts },
        });
        return {
          success: false,
          errors,
          warnings,
        };
      }

      // Warn about conflicts even if allowed
      if (conflicts.length > 0) {
        conflicts.forEach((conflict) => {
          warnings.push({
            code: 'CONFLICT_ALLOWED',
            message: `Allowing conflict: ${conflict.message}`,
            details: { conflict },
          });
        });
      }

      // Check compatibility
      const compatibility = this.checkCompatibility(
        exportData.pack,
        exportData.workflows,
      );

      if (!compatibility.isCompatible && !options.allowIncompatible) {
        compatibility.issues.forEach((issue) => {
          errors.push({
            code: 'COMPATIBILITY_ISSUE',
            message: issue.message,
            details: {
              type: issue.type,
              severity: issue.severity,
              details: issue.details,
            },
          });
        });
        return {
          success: false,
          errors,
          warnings,
          compatibility,
        };
      }

      // Add compatibility warnings
      compatibility.warnings.forEach((warning) => {
        warnings.push({
          code: 'COMPATIBILITY_WARNING',
          message: warning.message,
          details: {
            type: warning.type,
            details: warning.details,
          },
        });
      });

      return {
        success: true,
        pack: exportData.pack,
        versionHistory: exportData.versionHistory,
        workflows: exportData.workflows,
        errors: [],
        warnings,
        compatibility,
      };
    } catch (error) {
      errors.push({
        code: 'IMPORT_ERROR',
        message: 'Unexpected error during import: ' + String(error),
      });
      return {
        success: false,
        errors,
        warnings,
      };
    }
  }

  /**
   * Import a pack from compressed format asynchronously.
   *
   * @param compressedJson - Base64-encoded compressed JSON
   * @param options - Import options
   * @returns Promise resolving to import result
   */
  async importPackAsync(
    compressedJson: string,
    options: ImportOptions = {},
  ): Promise<PackImportResult> {
    return new Promise((resolve, reject) => {
      try {
        // Attempt to decompress if it looks like base64
        if (this.isBase64(compressedJson)) {
          const buffer = Buffer.from(compressedJson, 'base64');
          gunzip(buffer)
            .then((decompressed) => {
              const json = decompressed.toString('utf-8');
              const result = this.importPack(json, options);
              resolve(result);
            })
            .catch(() => {
              // Not compressed, treat as regular JSON
              const result = this.importPack(compressedJson, options);
              resolve(result);
            });
        } else {
          // Regular JSON
          const result = this.importPack(compressedJson, options);
          resolve(result);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Validate the export format.
   *
   * @param exportData - Export data to validate
   * @returns Validation result
   */
  validateFormat(exportData: PackExportData): FormatValidationResult {
    const errors: ImportValidationError[] = [];
    const warnings: ImportValidationWarning[] = [];

    // Check required fields
    if (!exportData.formatVersion) {
      errors.push({
        code: 'MISSING_FORMAT_VERSION',
        message: 'Export data missing formatVersion field',
        field: 'formatVersion',
      });
    } else if (!PackExportImportService.SUPPORTED_VERSIONS.includes(exportData.formatVersion)) {
      errors.push({
        code: 'UNSUPPORTED_FORMAT_VERSION',
        message: `Format version "${exportData.formatVersion}" is not supported`,
        field: 'formatVersion',
        details: {
          supportedVersions: PackExportImportService.SUPPORTED_VERSIONS,
        },
      });
    }

    if (!exportData.pack) {
      errors.push({
        code: 'MISSING_PACK',
        message: 'Export data missing pack field',
        field: 'pack',
      });
      return { isValid: false, errors, warnings };
    }

    // Validate pack structure
    try {
      validatePack(exportData.pack);
    } catch (error) {
      errors.push({
        code: 'INVALID_PACK',
        message: 'Pack validation failed: ' + String(error),
        field: 'pack',
      });
    }

    // Check required metadata
    if (!exportData.pack.id || typeof exportData.pack.id !== 'string') {
      errors.push({
        code: 'MISSING_PACK_ID',
        message: 'Pack missing valid id field',
        field: 'pack.id',
      });
    }

    if (!exportData.pack.name || typeof exportData.pack.name !== 'string') {
      errors.push({
        code: 'MISSING_PACK_NAME',
        message: 'Pack missing valid name field',
        field: 'pack.name',
      });
    }

    if (!exportData.pack.manifest) {
      errors.push({
        code: 'MISSING_MANIFEST',
        message: 'Pack missing manifest field',
        field: 'pack.manifest',
      });
    }

    if (!exportData.pack.metadata) {
      errors.push({
        code: 'MISSING_METADATA',
        message: 'Pack missing metadata field',
        field: 'pack.metadata',
      });
    }

    // Check version history
    if (!Array.isArray(exportData.versionHistory) || exportData.versionHistory.length === 0) {
      errors.push({
        code: 'INVALID_VERSION_HISTORY',
        message: 'Export must include non-empty version history',
        field: 'versionHistory',
      });
    }

    // Check workflows
    if (!exportData.workflows || typeof exportData.workflows !== 'object') {
      errors.push({
        code: 'INVALID_WORKFLOWS',
        message: 'Export data missing or invalid workflows field',
        field: 'workflows',
      });
    } else {
      // Verify all referenced workflows are included
      const missingWorkflows: string[] = [];
      for (const workflow of exportData.pack.manifest.workflows) {
        if (!exportData.workflows[workflow.workflowId]) {
          missingWorkflows.push(workflow.workflowId);
        }
      }

      if (missingWorkflows.length > 0) {
        errors.push({
          code: 'MISSING_WORKFLOWS',
          message: `Missing bundled workflows: ${missingWorkflows.join(', ')}`,
          field: 'workflows',
          details: { missingWorkflows },
        });
      }
    }

    // Check hash if present
    if (exportData.hash) {
      const computedHash = this.generateHash(exportData);
      if (exportData.hash !== computedHash) {
        warnings.push({
          code: 'HASH_MISMATCH',
          message: 'Export integrity hash does not match (data may have been modified)',
          field: 'hash',
          details: {
            expected: exportData.hash,
            computed: computedHash,
          },
        });
      }
    }

    if (!exportData.exportedAt) {
      warnings.push({
        code: 'MISSING_EXPORT_TIMESTAMP',
        message: 'Export data missing exportedAt timestamp',
        field: 'exportedAt',
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Check compatibility of imported pack with current platform.
   *
   * @param pack - Pack to check
   * @param workflows - Bundled workflows
   * @returns Compatibility result
   */
  checkCompatibility(pack: Pack, workflows: Record<string, Workflow>): CompatibilityCheckResult {
    const issues: CompatibilityIssue[] = [];
    const warnings: CompatibilityWarning[] = [];

    // Check minimum platform version
    if (pack.metadata.minimumPlatformVersion) {
      if (!versionSatisfies(this.platformVersion, `>=${pack.metadata.minimumPlatformVersion}`)) {
        issues.push({
          type: 'version-mismatch',
          message: `Pack requires platform version ${pack.metadata.minimumPlatformVersion} or higher, but current version is ${this.platformVersion}`,
          details: {
            required: pack.metadata.minimumPlatformVersion,
            current: this.platformVersion,
          },
          severity: 'error',
        });
      }
    }

    // Check platform support
    if (
      pack.metadata.supportedPlatforms &&
      pack.metadata.supportedPlatforms.length > 0 &&
      !pack.metadata.supportedPlatforms.includes(this.platform)
    ) {
      issues.push({
        type: 'platform-unsupported',
        message: `Pack is not supported on platform "${this.platform}". Supported platforms: ${pack.metadata.supportedPlatforms.join(', ')}`,
        details: {
          supportedPlatforms: pack.metadata.supportedPlatforms,
          currentPlatform: this.platform,
        },
        severity: 'error',
      });
    }

    // Check deployment policy compatibility
    try {
      validateDeploymentPolicy(pack.manifest.policy);
    } catch (error) {
      issues.push({
        type: 'policy-conflict',
        message: 'Pack deployment policy is invalid: ' + String(error),
        severity: 'error',
      });
    }

    // Check workflow availability
    for (const workflowRef of pack.manifest.workflows) {
      if (!workflows[workflowRef.workflowId]) {
        issues.push({
          type: 'workflow-unavailable',
          message: `Referenced workflow "${workflowRef.workflowId}" is not bundled in export`,
          details: { workflowId: workflowRef.workflowId },
          severity: 'error',
        });
      }
    }

    // Warnings
    if (pack.version.deprecated) {
      warnings.push({
        type: 'version-deprecation',
        message: `Pack version ${pack.version.version} is marked as deprecated`,
        details: { version: pack.version.version },
      });
    }

    if (pack.version.prerelease) {
      warnings.push({
        type: 'version-deprecation',
        message: `Pack version ${pack.version.version} is a prerelease and may be unstable`,
        details: { version: pack.version.version },
      });
    }

    return {
      isCompatible: issues.filter((i) => i.severity === 'error').length === 0,
      issues,
      warnings,
    };
  }

  /**
   * Detect conflicts when importing a pack.
   *
   * @param pack - Pack being imported
   * @returns Array of detected conflicts
   */
  private detectConflicts(pack: Pack): PackConflict[] {
    const conflicts: PackConflict[] = [];

    // Check for duplicate pack ID
    const existing = this.existingPacks.get(pack.id);
    if (existing) {
      conflicts.push({
        type: 'duplicate-id',
        packId: pack.id,
        existingVersion: existing.version.version,
        incomingVersion: pack.version.version,
        message: `Pack with ID "${pack.id}" already exists (version ${existing.version.version}). Import has version ${pack.version.version}.`,
      });
    }

    return conflicts;
  }

  /**
   * Generate SHA-256 hash of export data for integrity verification.
   *
   * @param exportData - Export data to hash (hash field should be undefined)
   * @returns SHA-256 hash as hex string
   */
  private generateHash(exportData: PackExportData): string {
    // Remove hash field for consistent hashing
    const { hash, signature, ...dataToHash } = exportData;

    const json = JSON.stringify(dataToHash);
    return crypto.createHash('sha256').update(json).digest('hex');
  }

  /**
   * Synchronously compress a string using gzip.
   *
   * @param data - Data to compress
   * @returns Base64-encoded compressed data
   * @throws Error if compression fails
   */
  private compressSync(data: string): string {
    const compressed = zlib.gzipSync(data);
    return compressed.toString('base64');
  }

  /**
   * Check if a string appears to be base64-encoded.
   *
   * @param str - String to check
   * @returns true if string appears to be base64
   */
  private isBase64(str: string): boolean {
    try {
      // Check if it matches base64 pattern and can be decoded
      const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
      if (!base64Regex.test(str)) {
        return false;
      }

      // Try to decode to verify
      Buffer.from(str, 'base64');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate a hash for an exported pack for verification purposes.
   *
   * @param pack - Pack to hash
   * @param workflows - Bundled workflows
   * @returns Integrity hash as hex string
   */
  generatePackHash(pack: Pack, workflows: Record<string, Workflow>): string {
    const data = JSON.stringify({ pack, workflows });
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Perform round-trip test: export then import to verify consistency.
   *
   * @param pack - Pack to test
   * @param workflows - Bundled workflows
   * @param versionHistory - Version history
   * @returns true if round-trip succeeds and data matches
   */
  testRoundTrip(
    pack: Pack,
    workflows: Map<string, Workflow>,
    versionHistory: PackVersion[],
  ): boolean {
    try {
      // Export
      const exported = this.exportPack(pack, workflows, versionHistory);

      // Import
      const result = this.importPack(exported, { allowConflicts: true });

      if (!result.success || !result.pack) {
        return false;
      }

      // Verify pack data matches
      if (result.pack.id !== pack.id || result.pack.name !== pack.name) {
        return false;
      }

      // Verify workflows match
      if (!result.workflows) {
        return false;
      }

      for (const [id, workflow] of workflows) {
        if (!result.workflows[id]) {
          return false;
        }
      }

      // Verify version history matches
      if (result.versionHistory?.length !== versionHistory.length) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Export options
 */
export interface ExportOptions {
  /** Include SHA-256 hash for integrity verification */
  includeHash?: boolean;

  /** Compress the export data using gzip */
  compress?: boolean;
}

/**
 * Import options
 */
export interface ImportOptions {
  /** Allow import even if pack with same ID already exists */
  allowConflicts?: boolean;

  /** Allow import even if compatibility issues detected */
  allowIncompatible?: boolean;
}

/**
 * Create a new PackExportImportService instance
 *
 * @param platformVersion - Current platform version (semver)
 * @param platform - Platform name (e.g., "windows", "macos", "linux")
 * @returns New service instance
 */
export function createPackExportImportService(
  platformVersion: string = '1.0.0',
  platform: string = 'windows',
): PackExportImportService {
  return new PackExportImportService(platformVersion, platform);
}
