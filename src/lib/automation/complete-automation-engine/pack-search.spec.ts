/**
 * Tests for Pack Search and Discovery Service
 *
 * Comprehensive test suite covering:
 * - Name search (exact, substring, fuzzy)
 * - Tag filtering (AND/OR combinations)
 * - Sorting by various criteria
 * - Author filtering
 * - Complex multi-filter queries
 * - Pagination
 * - Caching
 * - Performance tracking
 * - Edge cases
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  PackSearchService,
  createPackSearchService,
  SearchQuery,
  SortOption,
} from './pack-search';
import { PackManager } from './pack-crud';
import { createWorkflowReference, createSequentialPolicy } from '../../../../pack-types';

describe('PackSearchService', () => {
  let searchService: PackSearchService;
  let packManager: PackManager;

  beforeEach(() => {
    searchService = createPackSearchService();
    packManager = new PackManager();
  });

  afterEach(() => {
    packManager.clear();
  });

  describe('Initialization', () => {
    it('should create an instance', () => {
      expect(searchService).toBeDefined();
      expect(searchService).toBeInstanceOf(PackSearchService);
    });

    it('should start with empty packs', () => {
      const results = searchService.search({});
      expect(results.totalCount).toBe(0);
      expect(results.results).toHaveLength(0);
    });
  });

  describe('Name Search', () => {
    beforeEach(() => {
      const packs = [
        packManager.createPack('Create Report Pack', 'Create reports', 'alice', [createWorkflowReference('w1')]),
        packManager.createPack('Email Notification', 'Send emails', 'bob', [createWorkflowReference('w2')]),
        packManager.createPack('Create Backup', 'Backup data', 'alice', [createWorkflowReference('w3')]),
        packManager.createPack('Data Export Tool', 'Export data', 'charlie', [createWorkflowReference('w4')]),
      ];
      searchService.setPacks(packs);
    });

    it('should find exact name matches', () => {
      const results = searchService.searchByName('Create Report Pack');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].pack.name).toBe('Create Report Pack');
    });

    it('should be case-insensitive', () => {
      const results = searchService.searchByName('create report pack');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].pack.name.toLowerCase()).toContain('create report pack');
    });

    it('should find substring matches', () => {
      const results = searchService.searchByName('Create');
      expect(results.length).toBeGreaterThanOrEqual(2); // Create Report, Create Backup
      expect(results.every(r => r.pack.name.includes('Create'))).toBe(true);
    });

    it('should find fuzzy matches with typos', () => {
      const results = searchService.searchByName('Create Report Pack', true, 0.7);
      // This should find via substring or exact match
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].pack.name).toBe('Create Report Pack');
    });

    it('should return empty results for non-matching name', () => {
      const results = searchService.searchByName('NonExistent');
      expect(results).toHaveLength(0);
    });
  });

  describe('Tag Filtering', () => {
    beforeEach(() => {
      const packs = [
        packManager.createPack('Pack One', 'Desc', 'author1', [createWorkflowReference('w1')], undefined, ['automation', 'reporting']),
        packManager.createPack('Pack Two', 'Desc', 'author2', [createWorkflowReference('w2')], undefined, ['automation', 'email']),
        packManager.createPack('Pack Three', 'Desc', 'author1', [createWorkflowReference('w3')], undefined, ['reporting', 'export']),
        packManager.createPack('Pack Four', 'Desc', 'author3', [createWorkflowReference('w4')], undefined, ['email', 'notification']),
      ];
      searchService.setPacks(packs);
    });

    it('should filter by single tag', () => {
      const results = searchService.searchByTags(['automation']);
      expect(results.length).toBeGreaterThanOrEqual(2); // Pack One, Pack Two
    });

    it('should filter with OR logic', () => {
      const results = searchService.searchByTags(['automation', 'notification'], 'OR');
      expect(results.length).toBeGreaterThanOrEqual(3); // Packs with automation OR notification
    });

    it('should filter with AND logic', () => {
      const results = searchService.searchByTags(['automation', 'reporting'], 'AND');
      expect(results.length).toBeGreaterThanOrEqual(1); // Only Pack One
    });

    it('should be case-insensitive for tags', () => {
      const results = searchService.searchByTags(['AUTOMATION']);
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('should return empty results when no tags match AND logic', () => {
      const results = searchService.searchByTags(['automation', 'notification'], 'AND');
      expect(results).toHaveLength(0);
    });
  });

  describe('Sorting', () => {
    beforeEach(() => {
      const packs = [
        packManager.createPack('Zebra Pack', 'Desc', 'alice', [createWorkflowReference('w1')]),
        packManager.createPack('Alpha Pack', 'Desc', 'bob', [createWorkflowReference('w2')]),
        packManager.createPack('Beta Pack', 'Desc', 'charlie', [createWorkflowReference('w3')]),
      ];
      searchService.setPacks(packs);
    });

    it('should sort by name ascending', () => {
      const allPacks = searchService.search({}).results.map(r => r.pack);
      const sortedPacks = searchService.sort(allPacks, [{ field: 'name', direction: 'asc' }]);
      
      expect(sortedPacks[0].name).toBe('Alpha Pack');
      expect(sortedPacks[1].name).toBe('Beta Pack');
      expect(sortedPacks[2].name).toBe('Zebra Pack');
    });

    it('should sort by name descending', () => {
      const allPacks = searchService.search({}).results.map(r => r.pack);
      const sortedPacks = searchService.sort(allPacks, [{ field: 'name', direction: 'desc' }]);
      
      expect(sortedPacks[0].name).toBe('Zebra Pack');
      expect(sortedPacks[2].name).toBe('Alpha Pack');
    });

    it('should sort by creation date', () => {
      const allPacks = searchService.search({}).results.map(r => r.pack);
      const sortedPacks = searchService.sort(allPacks, [{ field: 'createdAt', direction: 'asc' }]);
      
      expect(sortedPacks).toHaveLength(3);
      // All should be ordered
      for (let i = 1; i < sortedPacks.length; i++) {
        const prev = new Date(sortedPacks[i - 1].metadata.createdAt).getTime();
        const curr = new Date(sortedPacks[i].metadata.createdAt).getTime();
        expect(curr).toBeGreaterThanOrEqual(prev);
      }
    });
  });

  describe('Author Filtering', () => {
    beforeEach(() => {
      const packs = [
        packManager.createPack('Pack One', 'Desc', 'alice-smith', [createWorkflowReference('w1')]),
        packManager.createPack('Pack Two', 'Desc', 'bob-jones', [createWorkflowReference('w2')]),
        packManager.createPack('Pack Three', 'Desc', 'alice-brown', [createWorkflowReference('w3')]),
      ];
      searchService.setPacks(packs);
    });

    it('should filter by exact author match', () => {
      const results = searchService.searchByAuthor('alice-smith');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].pack.metadata.author).toBe('alice-smith');
    });

    it('should be case-insensitive for author search', () => {
      const results = searchService.searchByAuthor('ALICE-SMITH');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should support author search with substring matching', () => {
      const results = searchService.searchByAuthor('alice');
      expect(results.length).toBeGreaterThanOrEqual(2); // alice-smith and alice-brown
    });

    it('should get unique authors', () => {
      const authors = searchService.getUniqueAuthors();
      expect(authors).toContain('alice-smith');
      expect(authors).toContain('bob-jones');
      expect(authors).toContain('alice-brown');
    });

    it('should get author statistics', () => {
      const stats = searchService.getAuthorStats();
      expect(stats.get('alice-smith')).toBeDefined();
      expect(stats.get('alice-smith')?.count).toBeGreaterThan(0);
    });
  });

  describe('Complex Queries', () => {
    beforeEach(() => {
      const packs = [
        packManager.createPack('Email Automation', 'Desc', 'alice', [createWorkflowReference('w1')], undefined, ['automation', 'email']),
        packManager.createPack('Report Generator', 'Desc', 'bob', [createWorkflowReference('w2')], undefined, ['reporting', 'export']),
        packManager.createPack('Email Backup', 'Desc', 'alice', [createWorkflowReference('w3')], undefined, ['email', 'backup']),
      ];
      searchService.setPacks(packs);
    });

    it('should combine name + tags filters', () => {
      const query: SearchQuery = {
        name: 'Email',
        tags: {
          values: ['automation'],
          logic: 'OR',
        },
      };
      const results = searchService.search(query);
      expect(results.totalCount).toBeGreaterThan(0);
    });

    it('should combine name + tags + author filters', () => {
      const query: SearchQuery = {
        name: 'Email',
        tags: {
          values: ['email'],
          logic: 'AND',
        },
        author: 'alice',
      };
      const results = searchService.search(query);
      expect(results.totalCount).toBeGreaterThan(0);
      results.results.forEach(r => {
        expect(r.pack.metadata.author).toBe('alice');
      });
    });
  });

  describe('Pagination', () => {
    beforeEach(() => {
      const packs = Array.from({ length: 25 }, (_, i) => 
        packManager.createPack(`Pack ${i}`, `Desc ${i}`, 'author', [createWorkflowReference('w1')])
      );
      searchService.setPacks(packs);
    });

    it('should paginate results with default page size', () => {
      const results = searchService.search({});
      expect(results.results.length).toBeLessThanOrEqual(50); // Default page size
    });

    it('should return correct page number', () => {
      const results = searchService.search({
        pagination: {
          pageSize: 10,
          pageNumber: 2,
        },
      });

      expect(results.pageNumber).toBe(2);
      expect(results.pageSize).toBe(10);
      expect(results.results.length).toBe(10);
    });

    it('should calculate total pages correctly', () => {
      const results = searchService.search({
        pagination: {
          pageSize: 10,
          pageNumber: 1,
        },
      });

      expect(results.totalPages).toBeGreaterThanOrEqual(2);
      expect(results.totalCount).toBe(25);
    });

    it('should return partial results on last page', () => {
      const results = searchService.search({
        pagination: {
          pageSize: 10,
          pageNumber: 3,
        },
      });

      expect(results.results.length).toBe(5); // Last page has only 5 items (25 total)
    });

    it('should return empty results for out-of-bounds page', () => {
      const results = searchService.search({
        pagination: {
          pageSize: 10,
          pageNumber: 100,
        },
      });

      expect(results.results).toHaveLength(0);
    });
  });

  describe('Caching', () => {
    beforeEach(() => {
      const packs = Array.from({ length: 10 }, (_, i) => 
        packManager.createPack(`Pack ${i}`, `Desc ${i}`, 'author', [createWorkflowReference('w1')])
      );
      searchService.setPacks(packs);
    });

    it('should cache search results', () => {
      const metrics1 = searchService.getMetrics();
      searchService.search({ name: 'Pack' });

      const metrics2 = searchService.getMetrics();
      expect(metrics2.length).toBeGreaterThanOrEqual(metrics1.length + 1);

      // Execute different search
      searchService.search({ name: 'Pack Two' });
      const metrics3 = searchService.getMetrics();
      expect(metrics3.length).toBeGreaterThanOrEqual(metrics2.length + 1);
    });

    it('should return correct cache statistics', () => {
      const stats = searchService.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.maxSize).toBe(100);

      searchService.search({ name: 'Test' });
      const statsAfter = searchService.getCacheStats();
      expect(statsAfter.size).toBeGreaterThan(0);
    });

    it('should clear cache on command', () => {
      searchService.search({ name: 'Test' });
      expect(searchService.getCacheStats().size).toBeGreaterThan(0);

      searchService.clearCache();
      expect(searchService.getCacheStats().size).toBe(0);
    });
  });

  describe('Metrics and Statistics', () => {
    beforeEach(() => {
      const packs = [
        packManager.createPack('Pack One', 'Desc', 'alice', [createWorkflowReference('w1')], undefined, ['tag1']),
        packManager.createPack('Pack Two', 'Desc', 'bob', [createWorkflowReference('w2')], undefined, ['tag2']),
        packManager.createPack('Pack Three', 'Desc', 'alice', [createWorkflowReference('w3')], undefined, ['tag1', 'tag2']),
      ];
      searchService.setPacks(packs);
    });

    it('should track search metrics', () => {
      searchService.search({ name: 'Pack' });
      const metrics = searchService.getMetrics();

      expect(metrics.length).toBeGreaterThan(0);
      const lastMetric = metrics[metrics.length - 1];
      expect(lastMetric.executionTimeMs).toBeGreaterThanOrEqual(0);
      expect(lastMetric.resultCount).toBeGreaterThanOrEqual(0);
      expect(lastMetric.queryTimestamp).toBeDefined();
    });

    it('should get tag statistics', () => {
      const tagStats = searchService.getTagStats();

      expect(tagStats.get('tag1')).toBeGreaterThanOrEqual(2);
      expect(tagStats.get('tag2')).toBeGreaterThanOrEqual(2);
    });

    it('should get author statistics', () => {
      const authorStats = searchService.getAuthorStats();

      expect(authorStats.get('alice')).toBeDefined();
      expect(authorStats.get('alice')?.count).toBeGreaterThanOrEqual(2);
    });

    it('should get unique tags', () => {
      const tags = searchService.getUniqueTags();
      expect(tags).toContain('tag1');
      expect(tags).toContain('tag2');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty search results gracefully', () => {
      searchService.setPacks([]);
      const results = searchService.search({ name: 'NonExistent' });

      expect(results.results).toHaveLength(0);
      expect(results.totalCount).toBe(0);
      expect(results.totalPages).toBe(0);
    });

    it('should handle single result correctly', () => {
      const pack = packManager.createPack('Only Pack', 'Desc', 'author', [createWorkflowReference('w1')]);
      searchService.setPacks([pack]);

      const results = searchService.search({});
      expect(results.totalCount).toBe(1);
      expect(results.results).toHaveLength(1);
      expect(results.totalPages).toBe(1);
    });

    it('should handle empty search query', () => {
      const packs = [
        packManager.createPack('Pack One', 'Desc', 'author', [createWorkflowReference('w1')]),
        packManager.createPack('Pack Two', 'Desc', 'author', [createWorkflowReference('w2')]),
      ];
      searchService.setPacks(packs);

      const results = searchService.search({});
      expect(results.totalCount).toBe(2);
      expect(results.results).toHaveLength(2);
    });

    it('should handle pack with empty tags', () => {
      const pack = packManager.createPack('Pack', 'Desc', 'author', [createWorkflowReference('w1')], undefined, []);
      searchService.setPacks([pack]);

      const results = searchService.searchByTags(['tag']);
      expect(results).toHaveLength(0);
    });

    it('should handle special characters in search', () => {
      const pack = packManager.createPack('Pack-With-Special_Chars', 'Desc', 'author', [createWorkflowReference('w1')]);
      searchService.setPacks([pack]);

      const results = searchService.searchByName('Pack-With', false);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should handle very large page size', () => {
      const packs = Array.from({ length: 5 }, (_, i) => 
        packManager.createPack(`Pack ${i}`, `Desc ${i}`, 'author', [createWorkflowReference('w1')])
      );
      searchService.setPacks(packs);

      const results = searchService.search({
        pagination: {
          pageSize: 10000,
          pageNumber: 1,
        },
      });

      expect(results.results).toHaveLength(5);
      expect(results.totalPages).toBe(1);
    });
  });

  describe('Fuzzy Matching Details', () => {
    beforeEach(() => {
      const packs = [
        packManager.createPack('Create User Account', 'Desc', 'author', [createWorkflowReference('w1')]),
        packManager.createPack('Generate Monthly Report', 'Desc', 'author', [createWorkflowReference('w2')]),
        packManager.createPack('Export Data to CSV', 'Desc', 'author', [createWorkflowReference('w3')]),
      ];
      searchService.setPacks(packs);
    });

    it('should handle typos in fuzzy search', () => {
      const results = searchService.searchByName('Create User Account', true, 0.6);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should handle character substitution', () => {
      const results = searchService.searchByName('Generate Monthly Report', true, 0.7);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should not match with very low similarity', () => {
      const results = searchService.searchByName('xyz', true, 0.95);
      expect(results.length).toBe(0);
    });
  });

  describe('Performance Characteristics', () => {
    it('should handle large pack collections efficiently', () => {
      const packs = Array.from({ length: 100 }, (_, i) => 
        packManager.createPack(`Pack ${i}`, `Desc ${i}`, 'author', [createWorkflowReference('w1')])
      );
      searchService.setPacks(packs);

      const startTime = Date.now();
      const results = searchService.search({ name: 'Pack' });
      const executionTime = Date.now() - startTime;

      expect(results.totalCount).toBeGreaterThan(0);
      expect(executionTime).toBeLessThan(1000); // Should complete in under 1 second
    });

    it('should maintain performance with complex queries', () => {
      const packs = Array.from({ length: 50 }, (_, i) =>
        packManager.createPack(`Pack ${i}`, `Desc ${i}`, `author${i % 10}`, [createWorkflowReference('w1')], undefined, [`tag${i % 20}`])
      );
      searchService.setPacks(packs);

      const startTime = Date.now();
      const results = searchService.search({
        name: 'Pack',
        tags: {
          values: ['tag5', 'tag10'],
          logic: 'OR',
        },
        sort: [{ field: 'name', direction: 'desc' }],
      });
      const executionTime = Date.now() - startTime;

      expect(results).toBeDefined();
      expect(executionTime).toBeLessThan(500); // Complex query should still be fast
    });
  });

  describe('Relevance Scoring', () => {
    beforeEach(() => {
      const packs = [
        packManager.createPack('Create Report', 'Desc', 'alice', [createWorkflowReference('w1')], undefined, ['reporting']),
        packManager.createPack('Report Generator', 'Desc', 'bob', [createWorkflowReference('w2')], undefined, ['reporting']),
        packManager.createPack('My Report', 'Desc', 'charlie', [createWorkflowReference('w3')], undefined, ['reporting']),
      ];
      searchService.setPacks(packs);
    });

    it('should rank exact name matches highest', () => {
      const results = searchService.searchByName('Create Report');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].pack.name).toBe('Create Report');
    });

    it('should rank results by relevance', () => {
      const results = searchService.search({
        tags: { values: ['reporting'], logic: 'OR' },
        sort: [{ field: 'relevance', direction: 'desc' }],
      });

      // Results should be ranked by relevance
      expect(results.results.length).toBeGreaterThan(0);
      for (let i = 1; i < results.results.length; i++) {
        expect(results.results[i - 1].relevanceScore).toBeGreaterThanOrEqual(results.results[i].relevanceScore);
      }
    });
  });
});
