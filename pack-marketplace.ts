/**
 * Pack Marketplace Publishing
 * Validates pack metadata, handles publishing to marketplace, manages discovery, ratings, and downloads.
 * 
 * Requirements: 10.5, 10.6, 10.7, 10.8
 */

/** Pack ID for marketplace. */
export type MarketplacePackId = string & { readonly __brand: 'MarketplacePackId' };

/** Marketplace category with hierarchy support. */
export interface PackCategory {
  id: string;
  name: string;
  path: string[];  // Full path in hierarchy, e.g., ["Productivity", "Email", "Draft Templates"]
  parent?: string;
  description?: string;
}

/** Pack publication status. */
export type PublicationStatus = 'draft' | 'submitted' | 'published' | 'rejected' | 'delisted' | 'archived';

/** User rating (1-5 stars). */
export type Rating = 1 | 2 | 3 | 4 | 5;

/**
 * Complete marketplace pack metadata including hierarchy and versioning.
 */
export interface MarketplacePack {
  id: MarketplacePackId;
  packId: string;  // Reference to original pack
  name: string;
  description: string;
  version: string;
  author: string;
  authorEmail?: string;
  
  // Categorization with hierarchy support
  category: PackCategory;
  tags: string[];
  keywords: string[];
  
  // Content
  readme?: string;  // Markdown documentation
  changelog?: string;  // Version changelog with support for multiple versions
  license?: string;
  
  // Publishing info
  status: PublicationStatus;
  publishedAt?: number;  // timestamp
  lastPublishedAt?: number;  // timestamp of last publish
  updatedAt: number;
  deprecatedAt?: number;  // when pack was deprecated
  
  // Marketplace stats
  downloads: number;
  rating: number;  // 0..5, weighted average
  ratingCount: number;  // total ratings
  viewCount: number;
  userRating?: number;  // current user's rating if authenticated
  
  // Version management
  latestVersion: string;
  versionChangelog?: Record<string, string>;  // version -> changelog
  updateAvailable?: boolean;  // whether user has newer version than marketplace
  
  // Requirements
  minRequiredVersion?: string;  // e.g., "1.2.0"
  maxTestedVersion?: string;
  
  // URLs
  repositoryUrl?: string;
  documentationUrl?: string;
  issuesUrl?: string;
  
  // Discovery metadata
  featured: boolean;
  verified: boolean;
  verifiedAt?: number;
}

/**
 * User review/rating for a pack.
 */
export interface PackReview {
  id: string;
  packId: MarketplacePackId;
  userId: string;
  userName?: string;
  rating: Rating;
  title: string;
  review: string;
  createdAt: number;
  updatedAt?: number;
  helpful: number;  // count of helpful votes
  verified: boolean;  // did reviewer use the pack?
  versionAtReview: string;  // pack version at review time
}

/**
 * Pack installation record.
 */
export interface PackInstallation {
  id: string;
  packId: MarketplacePackId;
  userId: string;
  version: string;
  installedAt: number;
  lastUpdatedAt?: number;
  lastUsedAt?: number;
  enabled: boolean;
  deviceInfo?: {
    platform: 'windows' | 'macos' | 'linux';
    version?: string;
  };
}

/**
 * User engagement metrics for a pack.
 */
export interface PackEngagementMetrics {
  packId: MarketplacePackId;
  userId: string;
  lastActivity: number;
  activityCount: number;
  successfulExecutions: number;
  failedExecutions: number;
  lastVersionUsed: string;
}

/**
 * Search query for marketplace packs.
 */
export interface MarketplaceSearchQuery {
  query?: string;  // Text search
  categoryPath?: string[];  // Category path in hierarchy
  tags?: string[];  // AND/OR combinations
  minRating?: number;  // 0..5
  minDownloads?: number;
  sortBy?: 'rating' | 'downloads' | 'recent' | 'relevance' | 'verified';
  limit?: number;
  offset?: number;
  includeTags?: boolean;  // Include tag metadata in response
}

/**
 * Search results from marketplace.
 */
export interface MarketplaceSearchResults {
  total: number;
  results: MarketplacePack[];
  query: MarketplaceSearchQuery;
  facets?: {
    categories: Array<{ path: string[]; count: number }>;
    tags: Array<{ tag: string; count: number }>;
    authors: Array<{ author: string; count: number }>;
  };
}

/**
 * Validation result for pack publishing.
 */
export interface PublicationValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  suggestions?: string[];  // Suggestions for improvement
}

/**
 * Publish request with metadata and workflow references.
 */
export interface PublishRequest {
  packId: string;
  version: string;
  changelog: string;
  author: string;
  authorEmail?: string;
  name: string;
  description: string;
  category: PackCategory;
  tags: string[];
  keywords: string[];
  readme?: string;
  license?: string;
  repositoryUrl?: string;
  documentationUrl?: string;
  issuesUrl?: string;
  minRequiredVersion?: string;
}

/**
 * Version bump request with type and changelog.
 */
export interface VersionBumpRequest {
  packId: MarketplacePackId;
  version: string;
  bumpType: 'major' | 'minor' | 'patch';
  changelog: string;
  workflowsUpdated?: string[];
}

// ============================================================================
// Rating and Review System
// ============================================================================

/**
 * Weighted rating calculation with multiple factors.
 * 
 * Uses a Bayesian average to balance:
 * - User ratings (weighted by confidence)
 * - Review quality (verified users, helpful votes)
 * - Execution success rate
 * 
 * @param reviews Array of reviews for the pack
 * @param engagementMetrics User engagement data
 * @returns Weighted average rating (0..5)
 */
export function calculateWeightedRating(
  reviews: PackReview[],
  engagementMetrics?: PackEngagementMetrics[]
): number {
  if (reviews.length === 0) {
    return 0;
  }

  // Calculate average rating
  const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;

  // Calculate weighted factors
  const verifiedWeight = reviews.filter((r) => r.verified).length / reviews.length;
  const helpfulWeight = reviews.reduce((sum, r) => sum + r.helpful, 0) / (reviews.length * 10);
  const successRate = engagementMetrics
    ? engagementMetrics.reduce((sum, m) => sum + m.successfulExecutions, 0) /
      Math.max(
        1,
        engagementMetrics.reduce((sum, m) => sum + m.successfulExecutions + m.failedExecutions, 0)
      )
    : 0.5;

  // Bayesian weighted average
  // More weight to average rating if more reviews
  const reviewWeight = Math.min(1, reviews.length / 20);  // Cap at 20 reviews for full weight
  const successWeight = 0.3;  // Weight for success rate
  const reviewQualityWeight = 0.2;  // Weight for review quality

  // Combined score
  const weightedRating =
    avgRating * (1 - successWeight - reviewQualityWeight) +
    5 * successRate * successWeight +
    avgRating * verifiedWeight * reviewQualityWeight * 0.5 +
    avgRating * (1 + Math.log10(1 + helpfulWeight)) * reviewQualityWeight * 0.5;

  return Math.min(5, Math.max(0, weightedRating));
}

/**
 * Calculates weighted rating trend over time.
 * 
 * @param reviews Array of reviews sorted by createdAt
 * @param windowDays Number of days for rolling window
 * @returns Trend data with period averages
 */
export function calculateRatingTrend(
  reviews: PackReview[],
  windowDays: number = 30
): Array<{ periodStart: number; periodEnd: number; average: number; count: number }> {
  if (reviews.length === 0) {
    return [];
  }

  const now = Date.now();
  const results: Array<{ periodStart: number; periodEnd: number; average: number; count: number }> = [];

  // Sort reviews by date
  const sortedReviews = [...reviews].sort((a, b) => a.createdAt - b.createdAt);

  // Create time windows
  let periodEnd = now;
  let periodStart = now - windowDays * 24 * 60 * 60 * 1000;

  for (let i = 0; i < 6; i++) {  // Last 6 periods (6 months)
    const periodReviews = sortedReviews.filter(
      (r) => r.createdAt >= periodStart && r.createdAt < periodEnd
    );

    if (periodReviews.length > 0) {
      const average = periodReviews.reduce((sum, r) => sum + r.rating, 0) / periodReviews.length;
      results.push({
        periodStart,
        periodEnd,
        average,
        count: periodReviews.length,
      });
    }

    periodEnd = periodStart;
    periodStart = periodStart - windowDays * 24 * 60 * 60 * 1000;
  }

  return results;
}

// ============================================================================
// Category Hierarchy Management
// ============================================================================

/**
 * Category manager for marketplace hierarchies.
 * Supports category hierarchies like "Productivity → Email → Draft Templates"
 */
export class CategoryManager {
  private categories: Map<string, PackCategory> = new Map();

  /**
   * Adds or updates a category in the hierarchy.
   * 
   * @param category Category to add/update
   */
  addCategory(category: PackCategory): void {
    this.categories.set(category.id, category);
  }

  /**
   * Gets a category by ID.
   * 
   * @param categoryId Category ID
   * @returns Category or undefined if not found
   */
  getCategory(categoryId: string): PackCategory | undefined {
    return this.categories.get(categoryId);
  }

  /**
   * Gets full path for a category.
   * 
   * @param categoryId Category ID
   * @returns Full path array
   */
  getCategoryPath(categoryId: string): string[] {
    const category = this.categories.get(categoryId);
    if (!category) {
      return [];
    }

    if (category.path && category.path.length > 0) {
      return category.path;
    }

    // Build path from parent chain
    const path: string[] = [category.name];
    let current = category;

    while (current.parent) {
      const parent = this.categories.get(current.parent);
      if (parent) {
        path.unshift(parent.name);
        current = parent;
      } else {
        break;
      }
    }

    return path;
  }

  /**
   * Gets all root categories (no parent).
   * 
   * @returns Array of root categories
   */
  getRootCategories(): PackCategory[] {
    return Array.from(this.categories.values()).filter((c) => !c.parent);
  }

  /**
   * Gets child categories for a parent.
   * 
   * @param parentId Parent category ID
   * @returns Array of child categories
   */
  getChildCategories(parentId: string): PackCategory[] {
    return Array.from(this.categories.values()).filter((c) => c.parent === parentId);
  }

  /**
   * Gets all categories with their full paths.
   * 
   * @returns Array of categories with resolved paths
   */
  getAllCategoriesWithPaths(): Array<PackCategory & { fullPath: string }> {
    return Array.from(this.categories.values()).map((c) => ({
      ...c,
      fullPath: this.getCategoryPath(c.id).join(' → '),
    }));
  }

  /**
   * Finds categories by partial path match.
   * 
   * @param pathSegments Path segments to match
   * @returns Matching categories
   */
  findCategoriesByPath(pathSegments: string[]): PackCategory[] {
    return Array.from(this.categories.values()).filter((c) => {
      const fullPath = this.getCategoryPath(c.id);
      return pathSegments.every((segment, i) => fullPath[i] === segment);
    });
  }

  /**
   * Validates that a category path exists.
   * 
   * @param category Category to validate
   * @returns true if valid
   */
  validateCategory(category: PackCategory): boolean {
    if (!category.id || !category.name || !category.path) {
      return false;
    }

    // Check parent exists if specified
    if (category.parent && !this.categories.has(category.parent)) {
      return false;
    }

    return true;
  }
}

/**
 * Default category hierarchy for marketplace.
 */
export function createDefaultCategories(): CategoryManager {
  const manager = new CategoryManager();

  // Root categories
  manager.addCategory({
    id: 'productivity',
    name: 'Productivity',
    path: ['Productivity'],
  });

  manager.addCategory({
    id: 'communication',
    name: 'Communication',
    path: ['Communication'],
  });

  manager.addCategory({
    id: 'development',
    name: 'Development',
    path: ['Development'],
  });

  manager.addCategory({
    id: 'media',
    name: 'Media & Entertainment',
    path: ['Media & Entertainment'],
  });

  manager.addCategory({
    id: 'other',
    name: 'Other',
    path: ['Other'],
  });

  // Productivity subcategories
  manager.addCategory({
    id: 'productivity-email',
    name: 'Email',
    path: ['Productivity', 'Email'],
    parent: 'productivity',
    description: 'Email composition, scheduling, and management',
  });

  manager.addCategory({
    id: 'productivity-draft-templates',
    name: 'Draft Templates',
    path: ['Productivity', 'Email', 'Draft Templates'],
    parent: 'productivity-email',
    description: 'Email draft templates and回复 templates',
  });

  manager.addCategory({
    id: 'productivity-calendar',
    name: 'Calendar & Scheduling',
    path: ['Productivity', 'Calendar & Scheduling'],
    parent: 'productivity',
    description: 'Calendar management and meeting scheduling',
  });

  manager.addCategory({
    id: 'productivity-docs',
    name: 'Documents & Writing',
    path: ['Productivity', 'Documents & Writing'],
    parent: 'productivity',
    description: 'Document creation, editing, and formatting',
  });

  // Communication subcategories
  manager.addCategory({
    id: 'communication-chat',
    name: 'Chat & Messaging',
    path: ['Communication', 'Chat & Messaging'],
    parent: 'communication',
    description: 'Slack, Teams, Discord automations',
  });

  // Development subcategories
  manager.addCategory({
    id: 'development-ide',
    name: 'IDE & Editor',
    path: ['Development', 'IDE & Editor'],
    parent: 'development',
    description: 'VS Code, IntelliJ, and other IDE automations',
  });

  manager.addCategory({
    id: 'development-git',
    name: 'Git & Version Control',
    path: ['Development', 'Git & Version Control'],
    parent: 'development',
    description: 'Git workflows and version control automations',
  });

  return manager;
}

// ============================================================================
// Pack Marketplace Repository
// ============================================================================

/**
 * Pack marketplace repository for publishing, discovery, ratings, and downloads.
 * Implements complete marketplace functionality with validation, metadata management,
 * and comprehensive search capabilities.
 */
export class PackMarketplaceRepository {
  private packs: Map<MarketplacePackId, MarketplacePack> = new Map();
  private reviews: Map<string, PackReview> = new Map();
  private installations: Map<string, PackInstallation> = new Map();
  private engagement: Map<string, Map<string, PackEngagementMetrics>> = new Map();
  private searchIndex: Map<string, Set<MarketplacePackId>> = new Map();
  private categoryManager: CategoryManager;

  constructor(categoryManager?: CategoryManager) {
    this.categoryManager = categoryManager ?? createDefaultCategories();
  }

  /**
   * Publishes a pack to the marketplace.
   * Validates metadata and creates new marketplace entry.
   * 
   * @param request Publish request with all metadata
   * @returns Published pack ID
   * @throws Error if validation fails
   */
  publishPack(request: PublishRequest): MarketplacePackId {
    const validation = this.validatePublishRequest(request);
    if (!validation.valid) {
      throw new Error(`Pack validation failed: ${validation.errors.join('; ')}`);
    }

    // Create marketplace pack
    const id = `mp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}` as MarketplacePackId;
    const now = Date.now();

    const pack: MarketplacePack = {
      id,
      packId: request.packId,
      name: request.name,
      description: request.description,
      version: request.version,
      author: request.author,
      authorEmail: request.authorEmail,
      category: request.category,
      tags: request.tags,
      keywords: request.keywords,
      readme: request.readme,
      changelog: request.changelog,
      license: request.license,
      status: 'published',
      publishedAt: now,
      lastPublishedAt: now,
      updatedAt: now,
      downloads: 0,
      rating: 0,
      ratingCount: 0,
      viewCount: 0,
      latestVersion: request.version,
      versionChangelog: {
        [request.version]: request.changelog,
      },
      featured: false,
      verified: false,
    };

    this.packs.set(id, pack);
    this.indexPack(id, pack);

    return id;
  }

  /**
   * Updates an existing pack in the marketplace.
   * Validates metadata and updates record.
   * 
   * @param id Pack ID to update
   * @param updates Partial pack updates
   */
  updatePack(id: MarketplacePackId, updates: Partial<PublishRequest>): void {
    const existing = this.packs.get(id);
    if (!existing) {
      throw new Error(`Pack not found: ${id}`);
    }

    // Create updated pack
    const updated: MarketplacePack = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };

    const validation = this.validatePublishRequest({
      packId: updated.packId,
      version: updated.version,
      changelog: updated.changelog ?? '',
      author: updated.author,
      name: updated.name,
      description: updated.description,
      category: updated.category,
      tags: updated.tags,
      keywords: updated.keywords,
      readme: updated.readme,
      license: updated.license,
      repositoryUrl: updated.repositoryUrl,
      documentationUrl: updated.documentationUrl,
      issuesUrl: updated.issuesUrl,
    });

    if (!validation.valid) {
      throw new Error(`Pack validation failed: ${validation.errors.join('; ')}`);
    }

    this.packs.set(id, updated);
    this.reindexPack(id, updated);
  }

  /**
   * Submits a pack for review (draft → submitted).
   * 
   * @param id Pack ID to submit
   */
  submitPackForReview(id: MarketplacePackId): void {
    const pack = this.packs.get(id);
    if (!pack) {
      throw new Error(`Pack not found: ${id}`);
    }

    pack.status = 'submitted';
    pack.updatedAt = Date.now();
    this.packs.set(id, pack);
  }

  /**
   * Approves a submitted pack (submitted → published).
   * 
   * @param id Pack ID to approve
   */
  approvePack(id: MarketplacePackId): void {
    const pack = this.packs.get(id);
    if (!pack) {
      throw new Error(`Pack not found: ${id}`);
    }

    pack.status = 'published';
    pack.publishedAt = pack.publishedAt ?? Date.now();
    pack.lastPublishedAt = Date.now();
    pack.updatedAt = Date.now();
    this.packs.set(id, pack);
  }

  /**
   * Rejects a submitted pack (submitted → rejected).
   * 
   * @param id Pack ID to reject
   * @param reason Reason for rejection
   */
  rejectPack(id: MarketplacePackId, reason: string): void {
    const pack = this.packs.get(id);
    if (!pack) {
      throw new Error(`Pack not found: ${id}`);
    }

    pack.status = 'rejected';
    pack.updatedAt = Date.now();
    this.packs.set(id, pack);
  }

  /**
   * Deprecates a pack (sets deprecated flag).
   * Pack remains published but marked as deprecated.
   * 
   * @param id Pack ID to deprecate
   * @param reason Reason for deprecation
   */
  deprecatePack(id: MarketplacePackId, reason: string): void {
    const pack = this.packs.get(id);
    if (!pack) {
      throw new Error(`Pack not found: ${id}`);
    }

    pack.status = 'deprecated' as PublicationStatus;
    pack.deprecatedAt = Date.now();
    pack.updatedAt = Date.now();
    this.packs.set(id, pack);
  }

  /**
   * Delists a pack from the marketplace.
   * Pack becomes undiscoverable but remains in history.
   * 
   * @param id Pack ID to delist
   * @param reason Reason for delisting
   */
  delistPack(id: MarketplacePackId, reason: string): void {
    const pack = this.packs.get(id);
    if (!pack) {
      throw new Error(`Pack not found: ${id}`);
    }

    pack.status = 'delisted';
    pack.updatedAt = Date.now();
    this.packs.set(id, pack);
  }

  /**
   * Archives a pack.
   * Pack is removed from public view but kept for historical purposes.
   * 
   * @param id Pack ID to archive
   */
  archivePack(id: MarketplacePackId): void {
    const pack = this.packs.get(id);
    if (!pack) {
      throw new Error(`Pack not found: ${id}`);
    }

    pack.status = 'archived';
    pack.updatedAt = Date.now();
    this.packs.set(id, pack);
  }

  /**
   * Retrieves a pack by ID.
   * Increments view count.
   * 
   * @param id Pack ID
   * @returns Pack or null if not found
   */
  getPack(id: MarketplacePackId): MarketplacePack | null {
    const pack = this.packs.get(id);
    if (pack) {
      pack.viewCount += 1;
      this.packs.set(id, pack);
    }
    return pack ?? null;
  }

  /**
   * Gets packs by original pack ID (all versions).
   * 
   * @param packId Original pack ID
   * @returns Array of marketplace packs
   */
  getPackVersions(packId: string): MarketplacePack[] {
    return Array.from(this.packs.values()).filter((p) => p.packId === packId);
  }

  /**
   * Publishes a new version of an existing pack.
   * Maintains version history and changelog.
   * 
   * @param request Version bump request
   * @returns Updated pack ID
   */
  publishVersion(request: VersionBumpRequest): MarketplacePackId {
    // Find existing pack
    const existing = Array.from(this.packs.values()).find((p) => p.packId === request.packId);
    if (!existing) {
      throw new Error(`Pack not found: ${request.packId}`);
    }

    // Update version info
    existing.version = request.version;
    existing.latestVersion = request.version;
    existing.lastPublishedAt = Date.now();
    existing.updatedAt = Date.now();

    // Update changelog
    if (existing.versionChangelog) {
      existing.versionChangelog[request.version] = request.changelog;
    } else {
      existing.versionChangelog = { [request.version]: request.changelog };
    }

    this.packs.set(existing.id, existing);
    this.reindexPack(existing.id, existing);

    return existing.id;
  }

  /**
   * Bumps pack version (major/minor/patch).
   * Automatically calculates new version and updates changelog.
   * 
   * @param id Pack ID
   * @param bumpType Version bump type
   * @param changelog Changelog for this version
   * @returns Updated pack
   */
  bumpVersion(id: MarketplacePackId, bumpType: 'major' | 'minor' | 'patch', changelog: string): MarketplacePack {
    const pack = this.packs.get(id);
    if (!pack) {
      throw new Error(`Pack not found: ${id}`);
    }

    const [major, minor, patch] = pack.version.split('.').map(Number);
    let newVersion: string;

    switch (bumpType) {
      case 'major':
        newVersion = `${major + 1}.0.0`;
        break;
      case 'minor':
        newVersion = `${major}.${minor + 1}.0`;
        break;
      case 'patch':
        newVersion = `${major}.${minor}.${patch + 1}`;
        break;
    }

    pack.version = newVersion;
    pack.latestVersion = newVersion;
    pack.lastPublishedAt = Date.now();
    pack.updatedAt = Date.now();

    if (pack.versionChangelog) {
      pack.versionChangelog[newVersion] = changelog;
    } else {
      pack.versionChangelog = { [newVersion]: changelog };
    }

    this.packs.set(id, pack);
    this.reindexPack(id, pack);

    return pack;
  }

  /**
   * Verifies a pack (marks as verified by marketplace).
   * 
   * @param id Pack ID to verify
   */
  verifyPack(id: MarketplacePackId): void {
    const pack = this.packs.get(id);
    if (!pack) {
      throw new Error(`Pack not found: ${id}`);
    }

    pack.verified = true;
    pack.verifiedAt = Date.now();
    pack.updatedAt = Date.now();
    this.packs.set(id, pack);
  }

  /**
   * Marks a pack as featured.
   * 
   * @param id Pack ID to feature
   */
  featurePack(id: MarketplacePackId): void {
    const pack = this.packs.get(id);
    if (!pack) {
      throw new Error(`Pack not found: ${id}`);
    }

    pack.featured = true;
    pack.updatedAt = Date.now();
    this.packs.set(id, pack);
  }

  /**
   * Removes a pack from featured status.
   * 
   * @param id Pack ID to unfeature
   */
  unfeaturePack(id: MarketplacePackId): void {
    const pack = this.packs.get(id);
    if (!pack) {
      throw new Error(`Pack not found: ${id}`);
    }

    pack.featured = false;
    pack.updatedAt = Date.now();
    this.packs.set(id, pack);
  }

  /**
   * Searches marketplace packs with comprehensive filtering.
   * 
   * @param query Search query
   * @returns Search results with facets
   */
  searchPacks(query: MarketplaceSearchQuery): MarketplaceSearchResults {
    let results = Array.from(this.packs.values()).filter((p) => p.status === 'published');

    // Text search
    if (query.query) {
      const q = query.query.toLowerCase();
      results = results.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          (p.keywords || []).some((k) => k.toLowerCase().includes(q)) ||
          p.author.toLowerCase().includes(q)
      );
    }

    // Category path filter
    if (query.categoryPath && query.categoryPath.length > 0) {
      results = results.filter((p) => {
        const fullPath = this.categoryManager.getCategoryPath(p.category.id);
        return query.categoryPath!.every((segment, i) => fullPath[i] === segment);
      });
    }

    // Category ID filter
    if (query.categoryPath && query.categoryPath.length === 0 && query.categoryPath) {
      // Empty array means no category filter
    }

    // Tags filter (AND logic - pack must have all tags)
    if (query.tags && query.tags.length > 0) {
      results = results.filter((p) => query.tags!.every((tag) => p.tags.includes(tag)));
    }

    // Rating filter
    if (query.minRating !== undefined) {
      results = results.filter((p) => p.rating >= query.minRating!);
    }

    // Downloads filter
    if (query.minDownloads !== undefined) {
      results = results.filter((p) => p.downloads >= query.minDownloads!);
    }

    // Verified filter
    if (query.sortBy === 'verified') {
      results = results.filter((p) => p.verified).concat(results.filter((p) => !p.verified));
    }

    // Sorting
    const sortBy = query.sortBy ?? 'relevance';
    switch (sortBy) {
      case 'downloads':
        results.sort((a, b) => b.downloads - a.downloads);
        break;
      case 'rating':
        results.sort((a, b) => b.rating - a.rating || b.ratingCount - a.ratingCount);
        break;
      case 'recent':
        results.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
        break;
      case 'verified':
        results.sort((a, b) => (b.verified ? 1 : 0) - (a.verified ? 1 : 0));
        break;
      case 'relevance':
      default:
        // Combine rating, downloads, verified status, and recency for relevance
        results.sort((a, b) => {
          const aScore = 
            (a.rating * a.ratingCount) + 
            (Math.log10(a.downloads + 1) * 100) + 
            (a.verified ? 500 : 0) +
            (a.featured ? 200 : 0) +
            (Date.now() - (a.publishedAt ?? 0)) / 1000000;
          
          const bScore = 
            (b.rating * b.ratingCount) + 
            (Math.log10(b.downloads + 1) * 100) + 
            (b.verified ? 500 : 0) +
            (b.featured ? 200 : 0) +
            (Date.now() - (b.publishedAt ?? 0)) / 1000000;
          
          return bScore - aScore;
        });
        break;
    }

    // Pagination
    const offset = query.offset ?? 0;
    const limit = Math.min(query.limit ?? 20, 100);
    const paginated = results.slice(offset, offset + limit);

    // Build facets if requested
    let facets;
    if (query.includeTags !== false) {
      facets = {
        categories: this.getCategoryFacets(results),
        tags: this.getTagFacets(results),
        authors: this.getAuthorFacets(results),
      };
    }

    return {
      total: results.length,
      results: paginated,
      query,
      facets,
    };
  }

  /**
   * Gets category facets for search results.
   */
  private getCategoryFacets(packs: MarketplacePack[]): Array<{ path: string[]; count: number }> {
    const categoryCounts = new Map<string, number>();

    packs.forEach((pack) => {
      const path = this.categoryManager.getCategoryPath(pack.category.id);
      const pathKey = path.join('|');
      categoryCounts.set(pathKey, (categoryCounts.get(pathKey) ?? 0) + 1);
    });

    return Array.from(categoryCounts.entries()).map(([pathKey, count]) => ({
      path: pathKey.split('|'),
      count,
    }));
  }

  /**
   * Gets tag facets for search results.
   */
  private getTagFacets(packs: MarketplacePack[]): Array<{ tag: string; count: number }> {
    const tagCounts = new Map<string, number>();

    packs.forEach((pack) => {
      pack.tags.forEach((tag) => {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      });
    });

    return Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)  // Top 20 tags
      .map(([tag, count]) => ({ tag, count }));
  }

  /**
   * Gets author facets for search results.
   */
  private getAuthorFacets(packs: MarketplacePack[]): Array<{ author: string; count: number }> {
    const authorCounts = new Map<string, number>();

    packs.forEach((pack) => {
      authorCounts.set(pack.author, (authorCounts.get(pack.author) ?? 0) + 1);
    });

    return Array.from(authorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([author, count]) => ({ author, count }));
  }

  /**
   * Records a pack installation/download.
   * Increments download counter.
   * 
   * @param packId Pack being installed
   * @param userId User installing
   * @param version Version being installed
   * @param deviceInfo Optional device info
   * @returns Installation record
   */
  recordInstallation(
    packId: MarketplacePackId,
    userId: string,
    version: string,
    deviceInfo?: { platform: 'windows' | 'macos' | 'linux'; version?: string }
  ): PackInstallation {
    const pack = this.packs.get(packId);
    if (!pack) {
      throw new Error(`Pack not found: ${packId}`);
    }

    // Increment download counter
    pack.downloads += 1;
    this.packs.set(packId, pack);

    // Record installation
    const id = `inst-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const installation: PackInstallation = {
      id,
      packId,
      userId,
      version,
      installedAt: Date.now(),
      enabled: true,
      deviceInfo,
    };

    this.installations.set(id, installation);

    // Update engagement metrics
    this.updateEngagement(packId, userId, version, true);

    return installation;
  }

  /**
   * Updates user engagement metrics for a pack.
   */
  private updateEngagement(
    packId: MarketplacePackId,
    userId: string,
    version: string,
    success: boolean
  ): void {
    const key = `${packId}-${userId}`;
    let metrics = this.engagement.get(key);

    if (!metrics) {
      metrics = new Map();
      this.engagement.set(key, metrics);
    }

    let packMetrics = metrics.get(packId);
    if (!packMetrics) {
      packMetrics = {
        packId,
        userId,
        lastActivity: Date.now(),
        activityCount: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        lastVersionUsed: version,
      };
    }

    packMetrics.lastActivity = Date.now();
    packMetrics.activityCount += 1;
    packMetrics.lastVersionUsed = version;
    if (success) {
      packMetrics.successfulExecutions += 1;
    } else {
      packMetrics.failedExecutions += 1;
    }

    metrics.set(packId, packMetrics);
  }

  /**
   * Records a failed execution for engagement tracking.
   * 
   * @param packId Pack ID
   * @param userId User ID
   */
  recordExecutionFailure(packId: MarketplacePackId, userId: string): void {
    this.updateEngagement(packId, userId, 'unknown', false);
  }

  /**
   * Submits a review/rating for a pack.
   * Updates pack's average rating using weighted calculation.
   * 
   * @param packId Pack being reviewed
   * @param userId User submitting review
   * @param rating Rating (1-5 stars)
   * @param title Review title
   * @param review Review text
   * @param version Version being reviewed
   * @returns Review record
   */
  submitReview(
    packId: MarketplacePackId,
    userId: string,
    rating: Rating,
    title: string,
    review: string,
    version?: string
  ): PackReview {
    const pack = this.packs.get(packId);
    if (!pack) {
      throw new Error(`Pack not found: ${packId}`);
    }

    // Get user's existing review and decrement old rating
    const existingReview = Array.from(this.reviews.values()).find(
      (r) => r.packId === packId && r.userId === userId
    );

    if (existingReview) {
      // Remove old rating
      this.reviews.delete(existingReview.id);
    }

    // Create new review
    const id = `review-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const reviewRecord: PackReview = {
      id,
      packId,
      userId,
      rating,
      title,
      review,
      createdAt: Date.now(),
      helpful: 0,
      verified: this.isVerifiedInstallation(packId, userId),
      versionAtReview: version ?? pack.version,
    };

    this.reviews.set(id, reviewRecord);

    // Recalculate pack rating
    const reviews = Array.from(this.reviews.values()).filter((r) => r.packId === packId);
    const engagementMetrics = Array.from(this.engagement.values())
      .get(packId)
      ? Array.from(this.engagement.get(packId)!.values())
      : undefined;

    pack.rating = calculateWeightedRating(reviews, engagementMetrics);
    pack.ratingCount = reviews.length;
    this.packs.set(packId, pack);

    return reviewRecord;
  }

  /**
   * Updates a review.
   * Recalculates pack rating.
   * 
   * @param reviewId Review ID to update
   * @param updates Review updates
   * @returns Updated review
   */
  updateReview(reviewId: string, updates: Partial<PackReview>): PackReview {
    const review = this.reviews.get(reviewId);
    if (!review) {
      throw new Error(`Review not found: ${reviewId}`);
    }

    const updated = { ...review, ...updates, updatedAt: Date.now() };
    this.reviews.set(reviewId, updated);

    // Recalculate pack rating
    const packId = review.packId;
    const pack = this.packs.get(packId);
    if (pack) {
      const reviews = Array.from(this.reviews.values()).filter((r) => r.packId === packId);
      pack.rating = calculateWeightedRating(reviews);
      pack.ratingCount = reviews.length;
      this.packs.set(packId, pack);
    }

    return updated;
  }

  /**
   * Gets reviews for a pack.
   * 
   * @param packId Pack ID
   * @returns Array of reviews
   */
  getReviews(packId: MarketplacePackId): PackReview[] {
    return Array.from(this.reviews.values()).filter((r) => r.packId === packId);
  }

  /**
   * Marks a review as helpful.
   * 
   * @param reviewId Review ID
   * @returns Updated helpful count
   */
  markReviewHelpful(reviewId: string): number {
    const review = this.reviews.get(reviewId);
    if (!review) {
      throw new Error(`Review not found: ${reviewId}`);
    }

    review.helpful += 1;
    this.reviews.set(reviewId, review);

    return review.helpful;
  }

  /**
   * Deletes a review.
   * Recalculates pack rating.
   * 
   * @param reviewId Review ID to delete
   */
  deleteReview(reviewId: string): void {
    const review = this.reviews.get(reviewId);
    if (!review) {
      throw new Error(`Review not found: ${reviewId}`);
    }

    this.reviews.delete(reviewId);

    // Recalculate pack rating
    const packId = review.packId;
    const pack = this.packs.get(packId);
    if (pack) {
      const reviews = Array.from(this.reviews.values()).filter((r) => r.packId === packId);
      pack.rating = calculateWeightedRating(reviews);
      pack.ratingCount = reviews.length;
      this.packs.set(packId, pack);
    }
  }

  /**
   * Gets installation history for a user.
   * 
   * @param userId User ID
   * @returns Array of installations
   */
  getUserInstallations(userId: string): PackInstallation[] {
    return Array.from(this.installations.values()).filter((i) => i.userId === userId);
  }

  /**
   * Gets engagement metrics for a user on a pack.
   * 
   * @param packId Pack ID
   * @param userId User ID
   * @returns Engagement metrics or undefined
   */
  getEngagementMetrics(packId: MarketplacePackId, userId: string): PackEngagementMetrics | undefined {
    const key = `${packId}-${userId}`;
    const userMetrics = this.engagement.get(key);
    return userMetrics?.get(packId);
  }

  /**
   * Gets trending packs.
   * Returns high-rated, recently popular packs.
   * 
   * @param limit Number of packs to return
   * @returns Array of trending packs
   */
  getTrendingPacks(limit: number = 10): MarketplacePack[] {
    const now = Date.now();
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

    return Array.from(this.packs.values())
      .filter((p) => p.status === 'published')
      .map((p) => {
        // Score based on recent activity
        const recentDownloads = Array.from(this.installations.values()).filter(
          (i) => i.packId === p.id && i.installedAt > oneWeekAgo
        ).length;

        const recencyScore = recentDownloads * 10;
        const ratingScore = p.rating * p.ratingCount;
        const trendScore = recencyScore + ratingScore;

        return { pack: p, score: trendScore };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.pack);
  }

  /**
   * Gets featured/recommended packs.
   * Returns high-quality, well-maintained packs.
   * 
   * @param limit Number of packs to return
   * @returns Array of featured packs
   */
  getFeaturedPacks(limit: number = 10): MarketplacePack[] {
    return Array.from(this.packs.values())
      .filter((p) => p.status === 'published' && p.featured)
      .sort((a, b) => {
        // Sort by combined score: rating * count + downloads + verified bonus
        const aScore = a.rating * a.ratingCount + Math.log10(a.downloads) + (a.verified ? 500 : 0);
        const bScore = b.rating * b.ratingCount + Math.log10(b.downloads) + (b.verified ? 500 : 0);
        return bScore - aScore;
      })
      .slice(0, limit);
  }

  /**
   * Gets recently updated packs.
   * 
   * @param limit Number of packs to return
   * @returns Array of recently updated packs
   */
  getRecentlyUpdatedPacks(limit: number = 10): MarketplacePack[] {
    return Array.from(this.packs.values())
      .filter((p) => p.status === 'published')
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, limit);
  }

  /**
   * Gets packs by author.
   * 
   * @param author Author name
   * @param limit Maximum results
   * @returns Array of packs by author
   */
  getPacksByAuthor(author: string, limit: number = 20): MarketplacePack[] {
    return Array.from(this.packs.values())
      .filter((p) => p.status === 'published' && p.author === author)
      .slice(0, limit);
  }

  /**
   * Checks if a user has installed a pack.
   * 
   * @param packId Pack ID
   * @param userId User ID
   * @returns true if user has installed the pack
   */
  hasUserInstalled(packId: MarketplacePackId, userId: string): boolean {
    return Array.from(this.installations.values()).some(
      (i) => i.packId === packId && i.userId === userId
    );
  }

  /**
   * Checks if user has verified installation of pack.
   */
  private isVerifiedInstallation(packId: MarketplacePackId, userId: string): boolean {
    return Array.from(this.installations.values()).some(
      (i) => i.packId === packId && i.userId === userId && i.enabled
    );
  }

  /**
   * Clears all marketplace data (for testing).
   */
  clear(): void {
    this.packs.clear();
    this.reviews.clear();
    this.installations.clear();
    this.engagement.clear();
    this.searchIndex.clear();
  }

  /**
   * Indexes a pack for search.
   */
  private indexPack(id: MarketplacePackId, pack: MarketplacePack): void {
    const terms = [
      pack.name.toLowerCase(),
      ...pack.tags,
      ...pack.keywords,
      pack.author.toLowerCase(),
      this.categoryManager.getCategoryPath(pack.category.id).join(' '),
    ];

    terms.forEach((term) => {
      if (!this.searchIndex.has(term)) {
        this.searchIndex.set(term, new Set());
      }
      this.searchIndex.get(term)!.add(id);
    });
  }

  /**
   * Reindexes a pack after updates.
   */
  private reindexPack(id: MarketplacePackId, pack: MarketplacePack): void {
    // Clear existing index entries for this pack
    this.searchIndex.forEach((ids) => ids.delete(id));

    // Reindex with new data
    this.indexPack(id, pack);
  }

  /**
   * Gets category manager for hierarchy operations.
   */
  getCategoryManager(): CategoryManager {
    return this.categoryManager;
  }

  /**
   * Validates a publish request.
   * Ensures completeness and correctness.
   */
  private validatePublishRequest(request: PublishRequest): PublicationValidation {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];

    // Required fields
    if (!request.name || request.name.trim().length === 0) {
      errors.push('Pack name is required');
    } else if (request.name.length < 3) {
      errors.push('Pack name must be at least 3 characters');
    } else if (request.name.length > 100) {
      errors.push('Pack name must be 100 characters or less');
    }

    if (!request.description || request.description.trim().length === 0) {
      errors.push('Pack description is required');
    } else if (request.description.length < 20) {
      errors.push('Pack description must be at least 20 characters');
    } else if (request.description.length > 500) {
      errors.push('Pack description must be 500 characters or less');
      suggestions.push('Consider adding more details about what the pack does');
    }

    if (!request.author || request.author.trim().length === 0) {
      errors.push('Author name is required');
    }

    if (!request.category || !request.category.id) {
      errors.push('Pack category is required');
    } else if (!this.categoryManager.validateCategory(request.category)) {
      errors.push('Invalid category');
    }

    // Tags validation
    if (!request.tags || request.tags.length === 0) {
      errors.push('At least one tag is required');
    } else if (request.tags.length > 10) {
      errors.push('Maximum 10 tags allowed');
      suggestions.push('Select the most relevant tags for better discoverability');
    } else {
      request.tags.forEach((tag, i) => {
        if (tag.length < 2) {
          errors.push(`Tag ${i + 1} is too short (minimum 2 characters)`);
        }
        if (tag.length > 30) {
          errors.push(`Tag ${i + 1} is too long (maximum 30 characters)`);
          suggestions.push(`Consider shortening tag "${tag}"`);
        }
      });
    }

    // Version validation
    if (!request.version) {
      errors.push('Pack version is required');
    } else if (!isValidVersion(request.version)) {
      errors.push('Pack version must follow semantic versioning (e.g., 1.0.0)');
    }

    // Optional but recommended
    if (!request.readme) {
      warnings.push('README documentation is recommended for discoverability');
      suggestions.push('Include a README with usage instructions');
    }

    if (!request.license) {
      warnings.push('License information is recommended');
      suggestions.push('Add a license to clarify usage rights');
    }

    if (!request.authorEmail) {
      warnings.push('Author email is recommended for support inquiries');
    }

    if (!request.repositoryUrl) {
      warnings.push('Repository URL is recommended for source code access');
      suggestions.push('Link to your repository for transparency and collaboration');
    }

    // Email validation (if provided)
    if (request.authorEmail && !isValidEmail(request.authorEmail)) {
      errors.push('Invalid author email format');
    }

    // URL validation (if provided)
    if (request.repositoryUrl && !isValidUrl(request.repositoryUrl)) {
      errors.push('Invalid repository URL');
    }

    if (request.documentationUrl && !isValidUrl(request.documentationUrl)) {
      errors.push('Invalid documentation URL');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      suggestions,
    };
  }
}

/**
 * Validates email format.
 */
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validates URL format.
 */
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates semantic versioning format.
 */
function isValidVersion(version: string): boolean {
  const versionRegex = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?(\+[a-zA-Z0-9.]+)?$/;
  return versionRegex.test(version);
}