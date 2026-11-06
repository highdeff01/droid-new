/**
 * Pack System Type Definitions
 *
 * Defines the complete type model for packs, which are versioned collections of workflows
 * with deployment policies, marketplace metadata, and distribution information. Packs are
 * the primary distribution unit for automation.
 *
 * Key concepts:
 * - Packs are named collections of workflow IDs (not embedded workflows, stored separately)
 * - Packs follow semantic versioning for reproducibility
 * - Packs can depend on other packs
 * - Packs include deployment policies that control execution
 * - Packs include marketplace metadata for distribution and discovery
 * - Packs support integrity verification via checksums
 */

/**
 * Condition for conditional deployment execution.
 *
 * Allows pack deployment to be gated by environment conditions or custom expressions.
 *
 * Example: Only deploy on Windows with expression "platform === 'windows'"
 */
export interface DeploymentCondition {
  /** Unique identifier for this condition */
  name: string;

  /** Condition expression to evaluate (e.g., "platform === 'windows'") */
  expression: string;

  /** Whether this condition must be satisfied for deployment to proceed */
  required: boolean;
}

/**
 * Deployment policy for pack execution.
 *
 * Controls how workflows in a pack are deployed and executed:
 * - Sequential: workflows run one after another
 * - Parallel: workflows run concurrently
 * - Conditional: workflows run based on conditions
 *
 * Policies define retry behavior, error handling, and rollback strategies.
 */
export interface DeploymentPolicy {
  /** Execution mode: workflows run sequentially, in parallel, or conditionally */
  mode: 'sequential' | 'parallel' | 'conditional';

  // Sequential-specific settings:
  /** Maximum number of retries on failure (sequential mode) */
  maxRetries?: number;

  /** Delay between retries in milliseconds (sequential mode) */
  retryDelayMs?: number;

  /** Stop deployment if a workflow fails (sequential mode) */
  stopOnError?: boolean;

  // Parallel-specific settings:
  /** Maximum number of concurrent workflows (parallel mode) */
  maxConcurrency?: number;

  // Conditional-specific settings:
  /** Array of conditions for conditional execution (conditional mode) */
  conditions?: DeploymentCondition[];

  // All modes:
  /** Rollback deployment if any workflow fails */
  rollbackOnFailure?: boolean;

  /** Maximum time allowed for deployment in milliseconds */
  timeoutMs?: number;
}

/**
 * Reference to a workflow within a pack.
 *
 * Workflows are referenced by ID, not embedded, allowing workflows to be managed
 * and versioned independently from packs.
 */
export interface WorkflowReference {
  /** Unique identifier of the referenced workflow */
  workflowId: string;

  /** Optional semantic version constraint (e.g., "^1.0.0", "1.2.x") */
  version?: string;

  /** Whether this workflow is optional in pack execution */
  optional?: boolean;
}

/**
 * Pack manifest: the deployment specification.
 *
 * Defines which workflows are included in the pack, in what order, with what
 * execution constraints and environment variables.
 */
export interface PackManifest {
  /** Array of workflow references in execution order */
  workflows: WorkflowReference[];

  /** Deployment policy for pack execution */
  policy: DeploymentPolicy;

  /** Environment variables available during pack deployment */
  environment?: Record<string, unknown>;
}

/**
 * Version information for a pack.
 *
 * Tracks semantic versioning, release dates, and compatibility information
 * to support multiple active versions and coordinated updates.
 */
export interface PackVersion {
  /** Semantic version (semver) of the pack (e.g., "1.0.0") */
  version: string;

  /** ISO 8601 timestamp when this version was released */
  releasedAt: string;

  /** Changelog describing changes in this version */
  changelog?: string;

  /** Versions of dependencies this pack is compatible with (e.g., ["^1.0.0"]) */
  compatibleWith?: string[];

  /** Whether this version is deprecated and should not be used */
  deprecated?: boolean;

  /** Whether this version is a prerelease (e.g., "1.0.0-beta.1") */
  prerelease?: boolean;
}

/**
 * Pack metadata containing authorship, licensing, and marketplace information.
 *
 * Metadata supports:
 * - Attribution and licensing
 * - Marketplace discovery and distribution
 * - Platform compatibility
 * - Integrity verification
 */
export interface PackMetadata {
  /** ISO 8601 timestamp when pack was created */
  createdAt: string;

  /** ISO 8601 timestamp when pack was last updated */
  updatedAt: string;

  /** Author or organization name */
  author: string;

  /** License identifier (e.g., "MIT", "Apache-2.0") */
  license?: string;

  /** Human-readable description of the pack */
  description: string;

  /** Tags for categorization and discovery */
  tags?: string[];

  // Marketplace information:
  /** Unique identifier on the marketplace (if published) */
  marketplaceId?: string;

  /** URL to the pack on the marketplace */
  marketplaceUrl?: string;

  /** Number of times this pack has been downloaded */
  downloadCount?: number;

  /** User rating from 0 to 5 */
  rating?: number;

  // Integrity and compatibility:
  /** SHA-256 checksum for integrity verification */
  checksum?: string;

  /** Minimum platform version required (e.g., "1.0.0") */
  minimumPlatformVersion?: string;

  /** Array of supported platforms (e.g., ["windows", "macos", "linux"]) */
  supportedPlatforms?: string[];
}

/**
 * Pack dependency: references another pack that must be available.
 *
 * Packs can depend on other packs, enabling pack composition and code reuse.
 * Circular dependencies are not allowed.
 */
export interface PackDependency {
  /** Unique identifier of the required pack */
  packId: string;

  /** Semantic version range constraint (e.g., "^1.0.0", "1.2.x") */
  versionRange?: string;

  /** Whether this dependency is optional */
  optional?: boolean;
}

/**
 * Pack: a versioned collection of workflows with deployment policies and metadata.
 *
 * Packs are:
 * - Named collections of workflow IDs
 * - Versioned with semantic versioning
 * - Distributable via marketplaces
 * - Composable with other packs through dependencies
 * - Executable with defined deployment policies
 */
export interface Pack {
  /** Unique identifier for the pack (UUID or nanoid) */
  id: string;

  /** Human-readable name for the pack */
  name: string;

  /** Pack manifest defining workflows and deployment */
  manifest: PackManifest;

  /** Version information for this pack */
  version: PackVersion;

  /** Metadata about the pack */
  metadata: PackMetadata;

  /** Optional dependencies on other packs */
  dependencies?: PackDependency[];
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Helper function to create a new DeploymentCondition.
 *
 * @param name - Unique identifier for the condition
 * @param expression - Expression to evaluate
 * @param required - Whether the condition must be satisfied
 * @returns DeploymentCondition object
 */
export function createDeploymentCondition(
  name: string,
  expression: string,
  required: boolean = true,
): DeploymentCondition {
  return {
    name,
    expression,
    required,
  };
}

/**
 * Helper function to create a new sequential DeploymentPolicy.
 *
 * @param maxRetries - Maximum retries on failure
 * @param retryDelayMs - Delay between retries
 * @param stopOnError - Stop deployment if a workflow fails
 * @param rollbackOnFailure - Rollback if any workflow fails
 * @param timeoutMs - Maximum deployment time
 * @returns DeploymentPolicy object
 */
export function createSequentialPolicy(
  maxRetries?: number,
  retryDelayMs?: number,
  stopOnError?: boolean,
  rollbackOnFailure?: boolean,
  timeoutMs?: number,
): DeploymentPolicy {
  return {
    mode: 'sequential',
    maxRetries,
    retryDelayMs,
    stopOnError,
    rollbackOnFailure,
    timeoutMs,
  };
}

/**
 * Helper function to create a new parallel DeploymentPolicy.
 *
 * @param maxConcurrency - Maximum concurrent workflows
 * @param rollbackOnFailure - Rollback if any workflow fails
 * @param timeoutMs - Maximum deployment time
 * @returns DeploymentPolicy object
 */
export function createParallelPolicy(
  maxConcurrency?: number,
  rollbackOnFailure?: boolean,
  timeoutMs?: number,
): DeploymentPolicy {
  return {
    mode: 'parallel',
    maxConcurrency,
    rollbackOnFailure,
    timeoutMs,
  };
}

/**
 * Helper function to create a new conditional DeploymentPolicy.
 *
 * @param conditions - Array of conditions for execution
 * @param rollbackOnFailure - Rollback if any workflow fails
 * @param timeoutMs - Maximum deployment time
 * @returns DeploymentPolicy object
 */
export function createConditionalPolicy(
  conditions?: DeploymentCondition[],
  rollbackOnFailure?: boolean,
  timeoutMs?: number,
): DeploymentPolicy {
  return {
    mode: 'conditional',
    conditions,
    rollbackOnFailure,
    timeoutMs,
  };
}

/**
 * Helper function to create a new WorkflowReference.
 *
 * @param workflowId - ID of the referenced workflow
 * @param version - Optional version constraint
 * @param optional - Whether this workflow is optional
 * @returns WorkflowReference object
 */
export function createWorkflowReference(
  workflowId: string,
  version?: string,
  optional?: boolean,
): WorkflowReference {
  return {
    workflowId,
    version,
    optional,
  };
}

/**
 * Helper function to create a new PackManifest.
 *
 * @param workflows - Array of workflow references
 * @param policy - Deployment policy
 * @param environment - Optional environment variables
 * @returns PackManifest object
 */
export function createPackManifest(
  workflows: WorkflowReference[],
  policy: DeploymentPolicy,
  environment?: Record<string, unknown>,
): PackManifest {
  return {
    workflows,
    policy,
    environment,
  };
}

/**
 * Helper function to create a new PackVersion.
 *
 * @param version - Semantic version (e.g., "1.0.0")
 * @param releasedAt - ISO 8601 release timestamp
 * @param changelog - Optional changelog
 * @param compatibleWith - Optional compatibility versions
 * @param deprecated - Whether this version is deprecated
 * @param prerelease - Whether this is a prerelease
 * @returns PackVersion object
 */
export function createPackVersion(
  version: string,
  releasedAt: string,
  changelog?: string,
  compatibleWith?: string[],
  deprecated?: boolean,
  prerelease?: boolean,
): PackVersion {
  return {
    version,
    releasedAt,
    changelog,
    compatibleWith,
    deprecated,
    prerelease,
  };
}

/**
 * Helper function to create PackMetadata.
 *
 * @param author - Author name
 * @param description - Pack description
 * @param license - Optional license
 * @param tags - Optional tags
 * @returns PackMetadata object
 */
export function createPackMetadata(
  author: string,
  description: string,
  license?: string,
  tags?: string[],
): PackMetadata {
  const now = new Date().toISOString();

  return {
    createdAt: now,
    updatedAt: now,
    author,
    description,
    license,
    tags,
  };
}

/**
 * Helper function to create a new PackDependency.
 *
 * @param packId - ID of the required pack
 * @param versionRange - Optional version constraint
 * @param optional - Whether this dependency is optional
 * @returns PackDependency object
 */
export function createPackDependency(
  packId: string,
  versionRange?: string,
  optional?: boolean,
): PackDependency {
  return {
    packId,
    versionRange,
    optional,
  };
}

/**
 * Helper function to create a new Pack.
 *
 * @param id - Unique pack identifier
 * @param name - Pack name
 * @param manifest - Pack manifest
 * @param version - Pack version
 * @param metadata - Pack metadata
 * @param dependencies - Optional pack dependencies
 * @returns Pack object
 */
export function createPack(
  id: string,
  name: string,
  manifest: PackManifest,
  version: PackVersion,
  metadata: PackMetadata,
  dependencies?: PackDependency[],
): Pack {
  return {
    id,
    name,
    manifest,
    version,
    metadata,
    dependencies,
  };
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validates that a string is a valid ISO 8601 timestamp.
 *
 * @param timestamp - Timestamp to validate
 * @throws Error if timestamp is not valid ISO 8601
 */
export function validateTimestamp(timestamp: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z?$/.test(timestamp)) {
    throw new Error(
      `Invalid timestamp: "${timestamp}" must be ISO 8601 format`,
    );
  }
}

/**
 * Validates that a string is a valid semantic version.
 *
 * Accepts versions like "1.0.0", "2.1.3-beta.1", "1.0.0-rc.1".
 *
 * @param version - Version string to validate
 * @throws Error if version is not valid semver
 */
export function validateSemanticVersion(version: string): void {
  if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/.test(version)) {
    throw new Error(
      `Invalid semantic version: "${version}" must be in format MAJOR.MINOR.PATCH`,
    );
  }
}

/**
 * Validates that a version string is a valid semver or version range.
 *
 * Accepts semver, ranges like "^1.0.0", "1.2.x", ">=1.0.0", etc.
 *
 * @param versionRange - Version range to validate
 * @throws Error if version range is not valid
 */
export function validateVersionRange(versionRange: string): void {
  if (!versionRange || typeof versionRange !== 'string') {
    throw new Error('Version range must be a non-empty string');
  }

  // Accept common version range patterns
  const validPatterns = [
    /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/, // Exact: 1.0.0 or 1.0.0-beta
    /^\^/, // Caret: ^1.0.0
    /^~/, // Tilde: ~1.0.0
    /^>=/, // Greater than or equal: >=1.0.0
    /^<=/, // Less than or equal: <=1.0.0
    /^>/, // Greater than: >1.0.0
    /^</, // Less than: <1.0.0
    /^=/, // Equal: =1.0.0
    /^\d+\.\d+\.x$/, // Wildcard: 1.2.x
  ];

  if (!validPatterns.some((pattern) => pattern.test(versionRange))) {
    throw new Error(
      `Invalid version range: "${versionRange}" must be a valid semver or range`,
    );
  }
}

/**
 * Validates that all workflow references have valid workflow IDs.
 *
 * @param workflows - Array of workflow references
 * @throws Error if any workflow reference is invalid
 */
export function validateWorkflowReferences(workflows: WorkflowReference[]): void {
  for (let i = 0; i < workflows.length; i++) {
    const workflow = workflows[i];

    if (!workflow.workflowId || typeof workflow.workflowId !== 'string') {
      throw new Error(
        `Invalid workflow reference at index ${i}: workflowId must be a non-empty string`,
      );
    }

    if (workflow.version !== undefined) {
      validateVersionRange(workflow.version);
    }
  }
}

/**
 * Validates that a deployment policy is well-formed.
 *
 * @param policy - DeploymentPolicy to validate
 * @throws Error if policy is invalid
 */
export function validateDeploymentPolicy(policy: DeploymentPolicy): void {
  if (!policy.mode || !['sequential', 'parallel', 'conditional'].includes(policy.mode)) {
    throw new Error(
      `Invalid deployment policy: mode must be 'sequential', 'parallel', or 'conditional'`,
    );
  }

  if (policy.maxRetries !== undefined && policy.maxRetries < 0) {
    throw new Error('Invalid deployment policy: maxRetries must be non-negative');
  }

  if (policy.retryDelayMs !== undefined && policy.retryDelayMs < 0) {
    throw new Error('Invalid deployment policy: retryDelayMs must be non-negative');
  }

  if (policy.maxConcurrency !== undefined && policy.maxConcurrency < 1) {
    throw new Error('Invalid deployment policy: maxConcurrency must be at least 1');
  }

  if (policy.timeoutMs !== undefined && policy.timeoutMs < 0) {
    throw new Error('Invalid deployment policy: timeoutMs must be non-negative');
  }

  if (policy.conditions && Array.isArray(policy.conditions)) {
    for (let i = 0; i < policy.conditions.length; i++) {
      const condition = policy.conditions[i];
      if (!condition.name || typeof condition.name !== 'string') {
        throw new Error(
          `Invalid deployment condition at index ${i}: name must be a non-empty string`,
        );
      }
      if (!condition.expression || typeof condition.expression !== 'string') {
        throw new Error(
          `Invalid deployment condition "${condition.name}": expression must be a non-empty string`,
        );
      }
    }
  }
}

/**
 * Validates that a pack manifest is well-formed.
 *
 * @param manifest - PackManifest to validate
 * @throws Error if manifest is invalid
 */
export function validatePackManifest(manifest: PackManifest): void {
  if (!manifest.workflows || !Array.isArray(manifest.workflows)) {
    throw new Error('Invalid pack manifest: workflows must be an array');
  }

  if (manifest.workflows.length === 0) {
    throw new Error('Invalid pack manifest: workflows array cannot be empty');
  }

  validateWorkflowReferences(manifest.workflows);
  validateDeploymentPolicy(manifest.policy);
}

/**
 * Validates that a pack version is well-formed.
 *
 * @param packVersion - PackVersion to validate
 * @throws Error if version is invalid
 */
export function validatePackVersion(packVersion: PackVersion): void {
  validateSemanticVersion(packVersion.version);
  validateTimestamp(packVersion.releasedAt);

  if (packVersion.compatibleWith !== undefined && Array.isArray(packVersion.compatibleWith)) {
    for (const compatVersion of packVersion.compatibleWith) {
      validateVersionRange(compatVersion);
    }
  }
}

/**
 * Validates that pack metadata is well-formed.
 *
 * @param metadata - PackMetadata to validate
 * @throws Error if metadata is invalid
 */
export function validatePackMetadata(metadata: PackMetadata): void {
  if (!metadata.author || typeof metadata.author !== 'string') {
    throw new Error('Invalid pack metadata: author must be a non-empty string');
  }

  if (!metadata.description || typeof metadata.description !== 'string') {
    throw new Error('Invalid pack metadata: description must be a non-empty string');
  }

  validateTimestamp(metadata.createdAt);
  validateTimestamp(metadata.updatedAt);

  if (metadata.rating !== undefined && (metadata.rating < 0 || metadata.rating > 5)) {
    throw new Error('Invalid pack metadata: rating must be between 0 and 5');
  }

  if (metadata.downloadCount !== undefined && metadata.downloadCount < 0) {
    throw new Error('Invalid pack metadata: downloadCount must be non-negative');
  }
}

/**
 * Detects circular dependencies in a pack's dependency graph.
 *
 * A circular dependency occurs when pack A depends on pack B, and pack B
 * (directly or indirectly) depends back on pack A.
 *
 * This function performs a depth-first search to detect cycles.
 *
 * @param pack - Pack to check
 * @param allPacks - Map of all packs by ID (used for transitive dependency checking)
 * @param visited - Set of visited pack IDs (used internally for cycle detection)
 * @param recursionStack - Set of pack IDs in current recursion stack
 * @returns true if a circular dependency is detected, false otherwise
 */
export function hasCircularDependency(
  pack: Pack,
  allPacks: Map<string, Pack>,
  visited: Set<string> = new Set(),
  recursionStack: Set<string> = new Set(),
): boolean {
  const packId = pack.id;

  // Mark as visited
  visited.add(packId);
  recursionStack.add(packId);

  // Check each dependency
  if (pack.dependencies) {
    for (const dep of pack.dependencies) {
      if (!visited.has(dep.packId)) {
        const depPack = allPacks.get(dep.packId);
        if (depPack && hasCircularDependency(depPack, allPacks, visited, recursionStack)) {
          return true;
        }
      } else if (recursionStack.has(dep.packId)) {
        // Found a back edge - circular dependency detected
        return true;
      }
    }
  }

  recursionStack.delete(packId);
  return false;
}

/**
 * Validates pack dependencies.
 *
 * @param pack - Pack to validate
 * @param allPacks - Map of all packs by ID for circular dependency checking
 * @throws Error if dependencies are invalid
 */
export function validatePackDependencies(pack: Pack, allPacks?: Map<string, Pack>): void {
  if (!pack.dependencies) {
    return;
  }

  if (!Array.isArray(pack.dependencies)) {
    throw new Error('Invalid pack dependencies: must be an array');
  }

  const seenPackIds = new Set<string>();

  for (let i = 0; i < pack.dependencies.length; i++) {
    const dep = pack.dependencies[i];

    if (!dep.packId || typeof dep.packId !== 'string') {
      throw new Error(
        `Invalid dependency at index ${i}: packId must be a non-empty string`,
      );
    }

    if (seenPackIds.has(dep.packId)) {
      throw new Error(
        `Invalid pack dependencies: duplicate dependency on pack "${dep.packId}"`,
      );
    }

    seenPackIds.add(dep.packId);

    if (dep.packId === pack.id) {
      throw new Error(
        `Invalid pack dependencies: pack cannot depend on itself`,
      );
    }

    if (dep.versionRange !== undefined) {
      validateVersionRange(dep.versionRange);
    }
  }

  // Check for circular dependencies if allPacks is provided
  if (allPacks && hasCircularDependency(pack, allPacks)) {
    throw new Error(
      `Circular dependency detected: pack "${pack.id}" has circular dependencies`,
    );
  }
}

/**
 * Validates a complete Pack object.
 *
 * Checks:
 * - Pack has valid ID and name
 * - Manifest is valid
 * - Version is valid
 * - Metadata is valid
 * - Dependencies are valid (no duplicates or self-references)
 * - No circular dependencies
 *
 * @param pack - Pack to validate
 * @param allPacks - Optional map of all packs for circular dependency checking
 * @throws Error if any validation fails
 */
export function validatePack(pack: Pack, allPacks?: Map<string, Pack>): void {
  if (!pack.id || typeof pack.id !== 'string') {
    throw new Error('Invalid pack: id must be a non-empty string');
  }

  if (!pack.name || typeof pack.name !== 'string') {
    throw new Error('Invalid pack: name must be a non-empty string');
  }

  validatePackManifest(pack.manifest);
  validatePackVersion(pack.version);
  validatePackMetadata(pack.metadata);
  validatePackDependencies(pack, allPacks);
}

/**
 * Serializes a Pack to JSON.
 *
 * @param pack - Pack to serialize
 * @returns JSON string representation of the pack
 */
export function serializePack(pack: Pack): string {
  return JSON.stringify(pack, null, 2);
}

/**
 * Deserializes a Pack from JSON.
 *
 * @param json - JSON string representation of a pack
 * @param allPacks - Optional map of all packs for circular dependency checking
 * @returns Deserialized Pack object
 * @throws Error if JSON is invalid or pack is malformed
 */
export function deserializePack(json: string, allPacks?: Map<string, Pack>): Pack {
  const pack = JSON.parse(json) as Pack;
  validatePack(pack, allPacks);
  return pack;
}

/**
 * Checks if a version string satisfies a version range constraint.
 *
 * @param version - Semantic version to check (e.g., "1.2.3")
 * @param range - Version range constraint (e.g., "^1.0.0")
 * @returns true if version satisfies the range, false otherwise
 */
export function versionSatisfies(version: string, range: string): boolean {
  // Parse version into components
  const versionMatch = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!versionMatch) {
    return false;
  }

  const [, major, minor, patch] = versionMatch.map(Number);
  const versionTuple = [major, minor, patch];

  // Handle exact version match
  if (/^\d+\.\d+\.\d+/.test(range)) {
    const rangeMatch = range.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (rangeMatch) {
      const [, rmajor, rminor, rpatch] = rangeMatch.map(Number);
      return major === rmajor && minor === rminor && patch === rpatch;
    }
  }

  // Handle caret range (^1.0.0)
  if (range.startsWith('^')) {
    const rangeMatch = range.slice(1).match(/^(\d+)\.(\d+)\.(\d+)/);
    if (rangeMatch) {
      const [, rmajor, rminor] = rangeMatch.map(Number);
      if (rmajor === 0) {
        // ^0.1.0 means >=0.1.0 and <0.2.0
        return major === 0 && minor === rminor && patch >= parseInt(rangeMatch[3]);
      }
      // ^1.0.0 means >=1.0.0 and <2.0.0
      return major === rmajor && (minor > rminor || (minor === rminor && patch >= parseInt(rangeMatch[3])));
    }
  }

  // Handle tilde range (~1.2.0)
  if (range.startsWith('~')) {
    const rangeMatch = range.slice(1).match(/^(\d+)\.(\d+)\.(\d+)/);
    if (rangeMatch) {
      const [, rmajor, rminor, rpatch] = rangeMatch.map(Number);
      // ~1.2.0 means >=1.2.0 and <1.3.0
      return major === rmajor && minor === rminor && patch >= rpatch;
    }
  }

  // Handle wildcard range (1.2.x)
  if (range.includes('.x')) {
    const rangeMatch = range.match(/^(\d+)\.(\d+)\.x$/);
    if (rangeMatch) {
      const [, rmajor, rminor] = rangeMatch.map(Number);
      return major === rmajor && minor === rminor;
    }
  }

  // Handle >= operator
  if (range.startsWith('>=')) {
    const rangeMatch = range.slice(2).match(/^(\d+)\.(\d+)\.(\d+)/);
    if (rangeMatch) {
      const [, rmajor, rminor, rpatch] = rangeMatch.map(Number);
      if (major !== rmajor) return major > rmajor;
      if (minor !== rminor) return minor > rminor;
      return patch >= rpatch;
    }
  }

  // Handle > operator
  if (range.startsWith('>')) {
    const rangeMatch = range.slice(1).match(/^(\d+)\.(\d+)\.(\d+)/);
    if (rangeMatch) {
      const [, rmajor, rminor, rpatch] = rangeMatch.map(Number);
      if (major !== rmajor) return major > rmajor;
      if (minor !== rminor) return minor > rminor;
      return patch > rpatch;
    }
  }

  // Handle <= operator
  if (range.startsWith('<=')) {
    const rangeMatch = range.slice(2).match(/^(\d+)\.(\d+)\.(\d+)/);
    if (rangeMatch) {
      const [, rmajor, rminor, rpatch] = rangeMatch.map(Number);
      if (major !== rmajor) return major < rmajor;
      if (minor !== rminor) return minor < rminor;
      return patch <= rpatch;
    }
  }

  // Handle < operator
  if (range.startsWith('<')) {
    const rangeMatch = range.slice(1).match(/^(\d+)\.(\d+)\.(\d+)/);
    if (rangeMatch) {
      const [, rmajor, rminor, rpatch] = rangeMatch.map(Number);
      if (major !== rmajor) return major < rmajor;
      if (minor !== rminor) return minor < rminor;
      return patch < rpatch;
    }
  }

  return false;
}

/**
 * Validates that a pack is compatible with a given platform.
 *
 * @param pack - Pack to check
 * @param platformVersion - Platform version (semver)
 * @param platform - Platform name (e.g., "windows", "macos", "linux")
 * @returns true if pack is compatible, false otherwise
 */
export function isPackCompatible(
  pack: Pack,
  platformVersion: string,
  platform: string,
): boolean {
  // Check minimum platform version
  if (pack.metadata.minimumPlatformVersion) {
    if (!versionSatisfies(platformVersion, `>=${pack.metadata.minimumPlatformVersion}`)) {
      return false;
    }
  }

  // Check supported platforms
  if (pack.metadata.supportedPlatforms && pack.metadata.supportedPlatforms.length > 0) {
    if (!pack.metadata.supportedPlatforms.includes(platform)) {
      return false;
    }
  }

  return true;
}
