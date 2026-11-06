/**
 * Pack Marketplace Discovery and Search
 * Implements comprehensive discovery, search, and ranking functionality for marketplace packs.
 * 
 * Requirements: 10.5, 10.6, 10.7, 10.8
 */

import type { MarketplacePack, MarketplacePackId, PackCategory } from './pack-marketplace.js';

// ============================================================================
// Discovery and Search Types
// ============================================================================

/** Discovery query with advanced filtering. */
export interface DiscoveryQuery {
  query?: string;  // Free text search
  categories?: string[];  // Category IDs or paths
  tags?: string[];  // Required tags (AND logic)
  tagMode?: 'and' | 'or';  // Tag matching mode
  minRating?: number;  // Minimum rating (0..5)
  minDownloads?: number;  // Minimum downloads
  author?: string;  // Filter by author
  sortBy?: 'rating' | 'downloads' | 'recent' | 'relevance' | 'verified' | 'trending';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  featuredOnly?: boolean;  // Only featured packs
  verifiedOnly?: boolean;  // Only verified packs
  includeTags?: boolean;  // Include tag metadata
  exclude?: MarketplacePackId[];  // Exclude these pack IDs
}

/** Discovery result with metadata. */
export interface DiscoveryResult {
  packs: MarketplacePack[];
  total: number;
  query: DiscoveryQuery;
  facets?: DiscoveryFacets;
  pagination?: PaginationInfo;
}

/** Discovery facets for filtering. */
export interface DiscoveryFacets {
  categories: CategoryFacet[];
  tags: TagFacet[];
  authors: AuthorFacet[];
  ratings: RatingFacet[];
  downloads: DownloadFacet[];
}

/** Category facet with counts. */
export interface CategoryFacet {
  category: string;
  path: string[];
  count: number;
  selected: boolean;
}

/** Tag facet with counts. */
export interface TagFacet {
  tag: string;
  count: number;
  selected: boolean;
}

/** Author facet with counts. */
export interface AuthorFacet {
  author: string;
  count: number;
  selected: boolean;
}

/** Rating facet with counts. */
export interface RatingFacet {
  range: string;
  count: number;
  selected: boolean;
}

/** Download facet with counts. */
export interface DownloadFacet {
  range: string;
  count: number;
  selected: boolean;
}

/** Pagination information. */
export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// ============================================================================
// Trending Calculation
// ============================================================================

/** Trending score for a pack. */
export interface PackTrendingScore {
  packId: MarketplacePackId;
  score: number;
  breakdown: {
    ratingScore: number;
    downloadScore: number;
    recencyScore: number;
    engagementScore: number;
  };
}

/**
 * Calculates trending scores for packs.
 * 
 * Trending = rating * rating_count * 0.4 + 
 *            log10(downloads + 1) * 100 * 0.3 + 
 *            recency * 0.2 +
 *            engagement * 0.1
 * 
 * @param pack Pack to score
 * @param now Current timestamp
 * @param oneWeekAgo One week ago timestamp
 * @returns Trending score with breakdown
 */
export function calculateTrendingScore(
  pack: MarketplacePack,
  now: number = Date.now(),
  oneWeekAgo: number = now - 7 * 24 * 60 * 60 * 1000
): PackTrendingScore {
  // Rating score: higher rated packs score higher
  const ratingScore = pack.rating * pack.ratingCount * 10;

  // Download score: log scale to prevent dominance of very popular packs
  const downloadScore = Math.log10(pack.downloads + 1) * 100;

  // Recency score: recent publishes get boost
  const publishedAt = pack.publishedAt ?? now;
  const daysSincePublish = (now - publishedAt) / (24 * 60 * 60 * 1000);
  const recencyScore = Math.max(0, 100 - daysSincePublish);

  // Engagement score: recent downloads get boost
  const recentDownloads = Math.max(0, pack.downloads / 10);  // Simplified engagement metric

  // Combined score
  const score =
    ratingScore * 0.4 +
    downloadScore * 0.3 +
    recencyScore * 0.2 +
    recentDownloads * 0.1;

  return {
    packId: pack.id,
    score,
    breakdown: {
      ratingScore,
      downloadScore,
      recencyScore,
      engagementScore: recentDownloads,
    },
  };
}

/**
 * Gets trending packs from a collection.
 * 
 * @param packs Packs to score
 * @param limit Number of packs to return
 * @param now Current timestamp
 * @returns Trending packs sorted by score
 */
export function getTrendingPacks(
  packs: MarketplacePack[],
  limit: number = 10,
  now: number = Date.now()
): MarketplacePack[] {
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

  return packs
    .map((p) => ({ pack: p, score: calculateTrendingScore(p, now, oneWeekAgo) }))
    .sort((a, b) => b.score.score - a.score.score)
    .slice(0, limit)
    .map((item) => item.pack);
}

/**
 * Gets recently trending packs (within last week).
 * 
 * @param packs Packs to score
 * @param limit Number of packs to return
 * @returns Recently trending packs
 */
export function getRecentlyTrendingPacks(
  packs: MarketplacePack[],
  limit: number = 10
): MarketplacePack[] {
  const now = Date.now();
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

  return packs
    .filter((p) => p.downloads > 0)
    .map((p) => ({ pack: p, score: calculateTrendingScore(p, now, oneWeekAgo) }))
    .sort((a, b) => b.score.breakdown.recencyScore - a.score.breakdown.recencyScore)
    .slice(0, limit)
    .map((item) => item.pack);
}

// ============================================================================
// Relevance Scoring
// ============================================================================

/** Relevance score for a pack. */
export interface PackRelevanceScore {
  packId: MarketplacePackId;
  score: number;
  breakdown: {
    textMatch: number;
    ratingMatch: number;
    tagMatch: number;
    categoryMatch: number;
    verifiedBonus: number;
    featuredBonus: number;
  };
}

/**
 * Calculates relevance score for a pack against a query.
 * 
 * @param pack Pack to score
 * @param query Search query
 * @returns Relevance score with breakdown
 */
export function calculateRelevanceScore(
  pack: MarketplacePack,
  query?: string
): PackRelevanceScore {
  let textMatch = 0;
  let ratingMatch = 0;
  let tagMatch = 0;
  let categoryMatch = 0;
  let verifiedBonus = 0;
  let featuredBonus = 0;

  // Text match: search query matches pack fields
  if (query) {
    const q = query.toLowerCase();
    const searchFields = [
      pack.name.toLowerCase(),
      pack.description.toLowerCase(),
      pack.author.toLowerCase(),
      ...pack.tags,
      ...pack.keywords,
    ];

    const matches = searchFields.filter((field) => field.includes(q)).length;
    textMatch = (matches / searchFields.length) * 100;
  }

  // Rating match: higher rated packs score higher when searching broadly
  ratingMatch = pack.rating * pack.ratingCount * 5;

  // Tag match: if query contains tags
  if (query) {
    const q = query.toLowerCase();
    tagMatch = pack.tags.filter((tag) => tag.toLowerCase().includes(q)).length * 10;
  }

  // Category match: if query contains category name
  if (query) {
    const q = query.toLowerCase();
    if (pack.category.name.toLowerCase().includes(q)) {
      categoryMatch = 50;
    }
  }

  // Verified bonus
  if (pack.verified) {
    verifiedBonus = 200;
  }

  // Featured bonus
  if (pack.featured) {
    featuredBonus = 100;
  }

  // Combined score
  const score = 
    textMatch * 0.3 +
    ratingMatch * 0.3 +
    tagMatch * 0.1 +
    categoryMatch * 0.1 +
    verifiedBonus +
    featuredBonus;

  return {
    packId: pack.id,
    score,
    breakdown: {
      textMatch,
      ratingMatch,
      tagMatch,
      categoryMatch,
      verifiedBonus,
      featuredBonus,
    },
  };
}

// ============================================================================
// Discovery Engine
// ============================================================================

/**
 * Pack discovery engine for marketplace search and filtering.
 * Implements comprehensive discovery with scoring, faceting, and pagination.
 */
export class PackDiscoveryEngine {
  constructor(private packs: Map<MarketplacePackId, MarketplacePack>) {}

  /**
   * Discovers packs based on query and filters.
   * 
   * @param query Discovery query
   * @returns Discovery results
   */
  discoverPacks(query: DiscoveryQuery): DiscoveryResult {
    // Start with all published packs
    let results = Array.from(this.packs.values()).filter((p) => p.status === 'published');

    // Apply filters
    if (query.exclude) {
      results = results.filter((p) => !query.exclude!.includes(p.id));
    }

    if (query.featuredOnly) {
      results = results.filter((p) => p.featured);
    }

    if (query.verifiedOnly) {
      results = results.filter((p) => p.verified);
    }

    if (query.author) {
      results = results.filter((p) => p.author === query.author);
    }

    if (query.categories && query.categories.length > 0) {
      results = results.filter((p) => 
        query.categories!.some((c) => 
          this.matchCategory(p.category, c)
        )
      );
    }

    if (query.tags && query.tags.length > 0) {
      const mode = query.tagMode ?? 'and';
      if (mode === 'and') {
        results = results.filter((p) => 
          query.tags!.every((tag) => p.tags.includes(tag))
        );
      } else {
        results = results.filter((p) => 
          query.tags!.some((tag) => p.tags.includes(tag))
        );
      }
    }

    if (query.minRating !== undefined) {
      results = results.filter((p) => p.rating >= query.minRating!);
    }

    if (query.minDownloads !== undefined) {
      results = results.filter((p) => p.downloads >= query.minDownloads!);
    }

    // Calculate scores for sorting
    if (query.sortBy === 'relevance') {
      results.sort((a, b) => {
        const scoreA = calculateRelevanceScore(a, query.query).score;
        const scoreB = calculateRelevanceScore(b, query.query).score;
        return query.sortOrder === 'asc' ? scoreA - scoreB : scoreB - scoreA;
      });
    } else if (query.sortBy === 'trending') {
      results.sort((a, b) => {
        const scoreA = calculateTrendingScore(a).score;
        const scoreB = calculateTrendingScore(b).score;
        return query.sortOrder === 'asc' ? scoreA - scoreB : scoreB - scoreA;
      });
    } else {
      // Standard sorting
      results.sort((a, b) => {
        let comparison = 0;
        switch (query.sortBy) {
          case 'rating':
            comparison = b.rating - a.rating || b.ratingCount - a.ratingCount;
            break;
          case 'downloads':
            comparison = b.downloads - a.downloads;
            break;
          case 'recent':
            comparison = (b.publishedAt ?? 0) - (a.publishedAt ?? 0);
            break;
          case 'verified':
            comparison = (b.verified ? 1 : 0) - (a.verified ? 1 : 0);
            break;
        }
        return query.sortOrder === 'asc' ? comparison : -comparison;
      });
    }

    // Pagination
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const paginated = results.slice(offset, offset + limit);
    const totalPages = Math.ceil(results.length / limit);

    // Build facets
    let facets;
    if (query.includeTags !== false) {
      facets = this.buildFacets(results, query);
    }

    return {
      packs: paginated,
      total: results.length,
      query,
      facets,
      pagination: {
        page: Math.floor(offset / limit) + 1,
        limit,
        total: results.length,
        totalPages,
        hasNext: offset + limit < results.length,
        hasPrev: offset > 0,
      },
    };
  }

  /**
   * Matches a pack's category against a category query.
   * 
   * @param category Pack category
   * @param query Category query (ID or path)
   * @returns true if matches
   */
  private matchCategory(category: PackCategory, query: string): boolean {
    // Check if it's an ID match
    if (category.id === query) {
      return true;
    }

    // Check if it's a path match
    const categoryPath = category.path || [];
    const queryPath = query.split(' → ');

    // Match exact path
    if (queryPath.every((segment, i) => categoryPath[i] === segment)) {
      return true;
    }

    // Match any ancestor
    return queryPath.some((segment, i) => categoryPath[i] === segment);
  }

  /**
   * Builds discovery facets from results.
   */
  private buildFacets(results: MarketplacePack[], query: DiscoveryQuery): DiscoveryFacets {
    // Categories
    const categoryCounts = new Map<string, number>();
    const categoryPaths = new Map<string, string[]>();

    results.forEach((pack) => {
      const path = pack.category.path || [pack.category.name];
      const pathKey = path.join(' → ');
      categoryCounts.set(pathKey, (categoryCounts.get(pathKey) ?? 0) + 1);
      categoryPaths.set(pathKey, path);
    });

    const categories = Array.from(categoryCounts.entries()).map(([path, count]) => ({
      category: path,
      path: categoryPaths.get(path) ?? [],
      count,
      selected: false,
    }));

    // Tags
    const tagCounts = new Map<string, number>();
    results.forEach((pack) => {
      pack.tags.forEach((tag) => {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      });
    });

    const tags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag, count]) => ({
        tag,
        count,
        selected: false,
      }));

    // Authors
    const authorCounts = new Map<string, number>();
    results.forEach((pack) => {
      authorCounts.set(pack.author, (authorCounts.get(pack.author) ?? 0) + 1);
    });

    const authors = Array.from(authorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([author, count]) => ({
        author,
        count,
        selected: false,
      }));

    // Ratings
    const ratingCounts: Record<string, number> = {
      '5': 0,
      '4-4.9': 0,
      '3-3.9': 0,
      '2-2.9': 0,
      '0-1.9': 0,
    };
    results.forEach((pack) => {
      if (pack.rating >= 5) ratingCounts['5']++;
      else if (pack.rating >= 4) ratingCounts['4-4.9']++;
      else if (pack.rating >= 3) ratingCounts['3-3.9']++;
      else if (pack.rating >= 2) ratingCounts['2-2.9']++;
      else ratingCounts['0-1.9']++;
    });

    const ratings = Object.entries(ratingCounts).map(([range, count]) => ({
      range,
      count,
      selected: false,
    }));

    // Downloads
    const downloadCounts: Record<string, number> = {
      '100+': 0,
      '50-99': 0,
      '10-49': 0,
      '1-9': 0,
      '0': 0,
    };
    results.forEach((pack) => {
      if (pack.downloads >= 100) downloadCounts['100+']++;
      else if (pack.downloads >= 50) downloadCounts['50-99']++;
      else if (pack.downloads >= 10) downloadCounts['10-49']++;
      else if (pack.downloads >= 1) downloadCounts['1-9']++;
      else downloadCounts['0']++;
    });

    const downloads = Object.entries(downloadCounts).map(([range, count]) => ({
      range,
      count,
      selected: false,
    }));

    return {
      categories,
      tags,
      authors,
      ratings,
      downloads,
    };
  }

  /**
   * Gets similar packs to a given pack.
   * 
   * @param packId Pack ID to find similar to
   * @param limit Number of similar packs
   * @returns Similar packs
   */
  getSimilarPacks(packId: MarketplacePackId, limit: number = 5): MarketplacePack[] {
    const pack = this.packs.get(packId);
    if (!pack) {
      return [];
    }

    // Calculate similarity based on tags, category, and author
    const similar = Array.from(this.packs.values())
      .filter((p) => p.id !== packId && p.status === 'published')
      .map((p) => ({
        pack: p,
        similarity: this.calculateSimilarity(pack, p),
      }))
      .filter((s) => s.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)
      .map((s) => s.pack);

    return similar;
  }

  /**
   * Calculates similarity between two packs.
   * 
   * @param pack1 First pack
   * @param pack2 Second pack
   * @returns Similarity score (0..100)
   */
  private calculateSimilarity(pack1: MarketplacePack, pack2: MarketplacePack): number {
    let similarity = 0;

    // Category match: high weight
    if (pack1.category.id === pack2.category.id) {
      similarity += 40;
    } else if (this.pathsOverlap(pack1.category.path, pack2.category.path)) {
      similarity += 20;
    }

    // Tag overlap
    const commonTags = pack1.tags.filter((t) => pack2.tags.includes(t));
    if (pack1.tags.length > 0 || pack2.tags.length > 0) {
      const tagSimilarity = (commonTags.length * 2) / (pack1.tags.length + pack2.tags.length);
      similarity += tagSimilarity * 40;
    }

    // Author match
    if (pack1.author === pack2.author) {
      similarity += 20;
    }

    return Math.min(100, similarity);
  }

  /**
   * Checks if two paths have overlapping segments.
   */
  private pathsOverlap(path1?: string[], path2?: string[]): boolean {
    if (!path1 || !path2) {
      return false;
    }

    // Check if any segment overlaps
    return path1.some((segment, i) => path2[i] === segment);
  }

  /**
   * Gets pack categories with counts.
   * 
   * @returns Category list with counts
   */
  getCategories(): Array<{ category: string; path: string[]; count: number }> {
    const categoryCounts = new Map<string, number>();

    this.packs.forEach((pack) => {
      if (pack.status === 'published') {
        const path = pack.category.path || [pack.category.name];
        const pathKey = path.join(' → ');
        categoryCounts.set(pathKey, (categoryCounts.get(pathKey) ?? 0) + 1);
      }
    });

    return Array.from(categoryCounts.entries()).map(([path, count]) => ({
      category: path,
      path: path.split(' → '),
      count,
    }));
  }

  /**
   * Gets all tags with counts.
   * 
   * @param limit Maximum number of tags to return
   * @returns Tag list with counts
   */
  getTags(limit: number = 50): Array<{ tag: string; count: number }> {
    const tagCounts = new Map<string, number>();

    this.packs.forEach((pack) => {
      if (pack.status === 'published') {
        pack.tags.forEach((tag) => {
          tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
        });
      }
    });

    return Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([tag, count]) => ({ tag, count }));
  }

  /**
   * Gets author statistics.
   * 
   * @param limit Maximum number of authors to return
   * @returns Author list with counts
   */
  getAuthors(limit: number = 20): Array<{ author: string; count: number; avgRating: number }> {
    const authorStats = new Map<string, { count: number; totalRating: number }>();

    this.packs.forEach((pack) => {
      if (pack.status === 'published') {
        const stats = authorStats.get(pack.author) || { count: 0, totalRating: 0 };
        stats.count += 1;
        stats.totalRating += pack.rating;
        authorStats.set(pack.author, stats);
      }
    });

    return Array.from(authorStats.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, limit)
      .map(([author, stats]) => ({
        author,
        count: stats.count,
        avgRating: stats.count > 0 ? stats.totalRating / stats.count : 0,
      }));
  }
}

// ============================================================================
// Discovery Utilities
// ============================================================================

/**
 * Creates a default discovery query.
 */
export function createDiscoveryQuery(): DiscoveryQuery {
  return {
    limit: 20,
    offset: 0,
    sortBy: 'relevance',
    includeTags: true,
  };
}

/**
 * Creates a category filter.
 */
export function createCategoryFilter(path: string[]): string[] {
  return [path.join(' → ')];
}

/**
 * Creates a tag filter.
 */
export function createTagFilter(tags: string[], mode: 'and' | 'or' = 'and'): {
  tags: string[];
  tagMode: 'and' | 'or';
} {
  return { tags, tagMode: mode };
}

/**
 * Creates a rating filter.
 */
export function createRatingFilter(minRating: number): DiscoveryQuery {
  return { minRating };
}

/**
 * Creates a download filter.
 */
export function createDownloadFilter(minDownloads: number): DiscoveryQuery {
  return { minDownloads };
}

/**
 * Parses a category path string into segments.
 */
export function parseCategoryPath(path: string): string[] {
  return path.split(' → ').filter((s) => s.length > 0);
}

/**
 * Formats a category path for display.
 */
export function formatCategoryPath(path: string[]): string {
  return path.join(' → ');
}

/**
 * Validates a discovery query.
 */
export function validateDiscoveryQuery(query: DiscoveryQuery): boolean {
  if (query.limit && (query.limit < 1 || query.limit > 100)) {
    return false;
  }
  if (query.offset && query.offset < 0) {
    return false;
  }
  if (query.minRating !== undefined && (query.minRating < 0 || query.minRating > 5)) {
    return false;
  }
  if (query.minDownloads !== undefined && query.minDownloads < 0) {
    return false;
  }
  return true;
}

// ============================================================================
// Category Hierarchy Utilities
// ============================================================================

/**
 * Builds a category tree from flat category list.
 */
export function buildCategoryTree(categories: PackCategory[]): Record<string, PackCategory[]> {
  const tree: Record<string, PackCategory[]> = {};

  categories.forEach((category) => {
    const parentId = category.parent || 'root';
    if (!tree[parentId]) {
      tree[parentId] = [];
    }
    tree[parentId].push(category);
  });

  return tree;
}

/**
 * Gets category descendants.
 */
export function getCategoryDescendants(
  categoryId: string,
  tree: Record<string, PackCategory[]>
): PackCategory[] {
  const descendants: PackCategory[] = [];
  const children = tree[categoryId] || [];

  children.forEach((child) => {
    descendants.push(child);
    descendants.push(...getCategoryDescendants(child.id, tree));
  });

  return descendants;
}

/**
 * Gets category ancestors.
 */
export function getCategoryAncestors(
  categoryId: string,
  categories: Map<string, PackCategory>
): PackCategory[] {
  const ancestors: PackCategory[] = [];
  let current = categories.get(categoryId);

  while (current?.parent) {
    const parent = categories.get(current.parent);
    if (parent) {
      ancestors.unshift(parent);
      current = parent;
    } else {
      break;
    }
  }

  return ancestors;
}

/**
 * Gets full category path from ID.
 */
export function getCategoryPathFromId(
  categoryId: string,
  categories: Map<string, PackCategory>
): string[] {
  const ancestors = getCategoryAncestors(categoryId, categories);
  const current = categories.get(categoryId);
  if (current) {
    ancestors.push(current);
  }
  return ancestors.map((c) => c.name);
}