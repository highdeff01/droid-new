/**
 * Tests for pack marketplace publishing system
 * Validates pack publishing, discovery, ratings, and downloads
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  validatePackForPublishing,
  MarketplaceRepository,
  type MarketplacePack,
  type Rating,
  type MarketplacePackId,
  type PackCategory,
} from './pack-marketplace.js';

describe('pack-marketplace', () => {
  describe('validatePackForPublishing', () => {
    it('validates complete valid pack', () => {
      const pack: Partial<MarketplacePack> = {
        name: 'Login Automation',
        description: 'Automates login process across multiple platforms',
        author: 'John Doe',
        authorEmail: 'john@example.com',
        category: 'productivity' as PackCategory,
        tags: ['login', 'automation', 'security'],
        version: '1.0.0',
        license: 'MIT',
      };

      const result = validatePackForPublishing(pack);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('requires pack name', () => {
      const result = validatePackForPublishing({});
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Pack name is required');
    });

    it('validates name length', () => {
      const tooShort = validatePackForPublishing({ name: 'ab' });
      expect(tooShort.valid).toBe(false);
      expect(tooShort.errors[0]).toContain('at least 3 characters');

      const tooLong = validatePackForPublishing({ name: 'a'.repeat(101) });
      expect(tooLong.valid).toBe(false);
      expect(tooLong.errors[0]).toContain('100 characters');
    });

    it('requires description', () => {
      const result = validatePackForPublishing({
        name: 'Test Pack',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Pack description is required');
    });

    it('validates description length', () => {
      const tooShort = validatePackForPublishing({
        name: 'Test',
        description: 'Too short',
      });
      expect(tooShort.valid).toBe(false);

      const tooLong = validatePackForPublishing({
        name: 'Test',
        description: 'a'.repeat(501),
      });
      expect(tooLong.valid).toBe(false);
    });

    it('requires author', () => {
      const result = validatePackForPublishing({
        name: 'Test Pack',
        description: 'Valid description that is long enough',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Author name is required');
    });

    it('requires category', () => {
      const result = validatePackForPublishing({
        name: 'Test Pack',
        description: 'Valid description that is long enough',
        author: 'John',
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Pack category is required');
    });

    it('requires tags', () => {
      const result = validatePackForPublishing({
        name: 'Test Pack',
        description: 'Valid description that is long enough',
        author: 'John',
        category: 'productivity' as PackCategory,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('At least one tag is required');
    });

    it('validates tag count (max 10)', () => {
      const result = validatePackForPublishing({
        name: 'Test Pack',
        description: 'Valid description that is long enough',
        author: 'John',
        category: 'productivity' as PackCategory,
        tags: Array(11).fill('tag'),
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Maximum 10 tags allowed');
    });

    it('validates tag length', () => {
      const result = validatePackForPublishing({
        name: 'Test Pack',
        description: 'Valid description that is long enough',
        author: 'John',
        category: 'productivity' as PackCategory,
        tags: ['a', 'valid-tag'],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('too short');
    });

    it('requires version', () => {
      const result = validatePackForPublishing({
        name: 'Test Pack',
        description: 'Valid description that is long enough',
        author: 'John',
        category: 'productivity' as PackCategory,
        tags: ['tag1'],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Pack version is required');
    });

    it('validates semantic version format', () => {
      const invalidVersion = validatePackForPublishing({
        name: 'Test Pack',
        description: 'Valid description that is long enough',
        author: 'John',
        category: 'productivity' as PackCategory,
        tags: ['tag1'],
        version: '1.0',
      });
      expect(invalidVersion.valid).toBe(false);

      const validVersion = validatePackForPublishing({
        name: 'Test Pack',
        description: 'Valid description that is long enough',
        author: 'John',
        category: 'productivity' as PackCategory,
        tags: ['tag1'],
        version: '1.0.0',
      });
      expect(validVersion.valid).toBe(true);

      const withPrerelease = validatePackForPublishing({
        name: 'Test Pack',
        description: 'Valid description that is long enough',
        author: 'John',
        category: 'productivity' as PackCategory,
        tags: ['tag1'],
        version: '1.0.0-beta.1',
      });
      expect(withPrerelease.valid).toBe(true);
    });

    it('validates email format', () => {
      const invalidEmail = validatePackForPublishing({
        name: 'Test Pack',
        description: 'Valid description that is long enough',
        author: 'John',
        category: 'productivity' as PackCategory,
        tags: ['tag1'],
        version: '1.0.0',
        authorEmail: 'not-an-email',
      });
      expect(invalidEmail.valid).toBe(false);
    });

    it('validates URL format', () => {
      const invalidUrl = validatePackForPublishing({
        name: 'Test Pack',
        description: 'Valid description that is long enough',
        author: 'John',
        category: 'productivity' as PackCategory,
        tags: ['tag1'],
        version: '1.0.0',
        repositoryUrl: 'not a url',
      });
      expect(invalidUrl.valid).toBe(false);

      const validUrl = validatePackForPublishing({
        name: 'Test Pack',
        description: 'Valid description that is long enough',
        author: 'John',
        category: 'productivity' as PackCategory,
        tags: ['tag1'],
        version: '1.0.0',
        repositoryUrl: 'https://github.com/user/repo',
      });
      expect(validUrl.valid).toBe(true);
    });

    it('warns about missing optional fields', () => {
      const result = validatePackForPublishing({
        name: 'Test Pack',
        description: 'Valid description that is long enough',
        author: 'John',
        category: 'productivity' as PackCategory,
        tags: ['tag1'],
        version: '1.0.0',
      });
      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.toLowerCase().includes('readme'))).toBe(true);
    });
  });

  describe('MarketplaceRepository', () => {
    let repo: MarketplaceRepository;

    beforeEach(() => {
      repo = new MarketplaceRepository();
    });

    it('publishes a valid pack', () => {
      const id = repo.publishPack({
        packId: 'pack-1',
        name: 'Login Automation',
        description: 'Automates login process across multiple platforms',
        author: 'John Doe',
        category: 'productivity' as PackCategory,
        tags: ['login', 'automation'],
        version: '1.0.0',
        updatedAt: Date.now(),
      });

      expect(id).toBeDefined();
      expect(id).toMatch(/mp-/);
    });

    it('rejects invalid pack on publish', () => {
      expect(() => {
        repo.publishPack({
          packId: 'pack-1',
          name: 'x',
          description: 'Too short',
          author: 'John',
          category: 'productivity' as PackCategory,
          tags: [],
          version: '1.0.0',
          updatedAt: Date.now(),
        });
      }).toThrow();
    });

    it('retrieves published pack', () => {
      const id = repo.publishPack({
        packId: 'pack-1',
        name: 'Test Pack',
        description: 'Valid description that is long enough for validation',
        author: 'John',
        category: 'productivity' as PackCategory,
        tags: ['tag1'],
        version: '1.0.0',
        updatedAt: Date.now(),
      }) as MarketplacePackId;

      const pack = repo.getPack(id);
      expect(pack).not.toBeNull();
      expect(pack?.name).toBe('Test Pack');
      expect(pack?.status).toBe('published');
    });

    it('increments view count on retrieval', () => {
      const id = repo.publishPack({
        packId: 'pack-1',
        name: 'Test Pack',
        description: 'Valid description that is long enough for validation',
        author: 'John',
        category: 'productivity' as PackCategory,
        tags: ['tag1'],
        version: '1.0.0',
        updatedAt: Date.now(),
      }) as MarketplacePackId;

      const pack1 = repo.getPack(id)!;
      expect(pack1.viewCount).toBe(1);

      const pack2 = repo.getPack(id)!;
      expect(pack2.viewCount).toBe(2);
    });

    it('returns null for non-existent pack', () => {
      const pack = repo.getPack('mp-nonexistent' as MarketplacePackId);
      expect(pack).toBeNull();
    });

    it('updates pack metadata', () => {
      const id = repo.publishPack({
        packId: 'pack-1',
        name: 'Test Pack',
        description: 'Valid description that is long enough for validation',
        author: 'John',
        category: 'productivity' as PackCategory,
        tags: ['tag1'],
        version: '1.0.0',
        updatedAt: Date.now(),
      }) as MarketplacePackId;

      repo.updatePack(id, {
        description: 'Updated description that is still valid and long enough',
        tags: ['updated', 'tags'],
      });

      const updated = repo.getPack(id)!;
      expect(updated.description).toContain('Updated');
      expect(updated.tags).toContain('updated');
    });

    it('delists a pack', () => {
      const id = repo.publishPack({
        packId: 'pack-1',
        name: 'Test Pack',
        description: 'Valid description that is long enough for validation',
        author: 'John',
        category: 'productivity' as PackCategory,
        tags: ['tag1'],
        version: '1.0.0',
        updatedAt: Date.now(),
      }) as MarketplacePackId;

      repo.delistPack(id, 'No longer maintained');

      const pack = repo.getPack(id)!;
      expect(pack.status).toBe('delisted');
    });

    it('searches packs by text', () => {
      repo.publishPack({
        packId: 'pack-1',
        name: 'Login Automation',
        description: 'Automates login process with security features',
        author: 'John',
        category: 'productivity' as PackCategory,
        tags: ['login', 'automation'],
        version: '1.0.0',
        updatedAt: Date.now(),
      });

      repo.publishPack({
        packId: 'pack-2',
        name: 'Invoice Generator',
        description: 'Generates invoices from templates',
        author: 'Jane',
        category: 'finance' as PackCategory,
        tags: ['finance', 'generator'],
        version: '1.0.0',
        updatedAt: Date.now(),
      });

      const results = repo.searchPacks({ query: 'login' });
      expect(results.total).toBeGreaterThanOrEqual(1);
      expect(results.results.some((p) => p.name.includes('Login'))).toBe(true);
    });

    it('filters packs by category', () => {
      repo.publishPack({
        packId: 'pack-1',
        name: 'Test Pack 1',
        description: 'Valid description that is long enough for validation',
        author: 'John',
        category: 'productivity' as PackCategory,
        tags: ['tag1'],
        version: '1.0.0',
        updatedAt: Date.now(),
      });

      repo.publishPack({
        packId: 'pack-2',
        name: 'Test Pack 2',
        description: 'Valid description that is long enough for validation',
        author: 'Jane',
        category: 'finance' as PackCategory,
        tags: ['tag2'],
        version: '1.0.0',
        updatedAt: Date.now(),
      });

      const results = repo.searchPacks({ category: 'finance' as PackCategory });
      expect(results.results.every((p) => p.category === 'finance')).toBe(true);
    });

    it('filters packs by tags', () => {
      repo.publishPack({
        packId: 'pack-1',
        name: 'Test Pack',
        description: 'Valid description that is long enough for validation',
        author: 'John',
        category: 'productivity' as PackCategory,
        tags: ['automation', 'testing'],
        version: '1.0.0',
        updatedAt: Date.now(),
      });

      const results = repo.searchPacks({ tags: ['automation'] });
      expect(results.results.length).toBeGreaterThan(0);
      expect(results.results[0].tags).toContain('automation');
    });

    it('sorts by rating', () => {
      const id1 = repo.publishPack({
        packId: 'pack-1',
        name: 'Pack 1',
        description: 'Valid description that is long enough for validation',
        author: 'John',
        category: 'productivity' as PackCategory,
        tags: ['tag1'],
        version: '1.0.0',
        updatedAt: Date.now(),
      }) as MarketplacePackId;

      const id2 = repo.publishPack({
        packId: 'pack-2',
        name: 'Pack 2',
        description: 'Valid description that is long enough for validation',
        author: 'Jane',
        category: 'productivity' as PackCategory,
        tags: ['tag2'],
        version: '1.0.0',
        updatedAt: Date.now(),
      }) as MarketplacePackId;

      // Add ratings
      repo.submitReview(id1, 'user-1', 5 as Rating, 'Great', 'Excellent pack');
      repo.submitReview(id2, 'user-2', 3 as Rating, 'Okay', 'It works');

      const results = repo.searchPacks({ sortBy: 'rating' });
      expect(results.results[0].id).toBe(id1);
    });

    it('records pack installation and increments downloads', () => {
      const id = repo.publishPack({
        packId: 'pack-1',
        name: 'Test Pack',
        description: 'Valid description that is long enough for validation',
        author: 'John',
        category: 'productivity' as PackCategory,
        tags: ['tag1'],
        version: '1.0.0',
        updatedAt: Date.now(),
      }) as MarketplacePackId;

      const pack1 = repo.getPack(id)!;
      expect(pack1.downloads).toBe(0);

      repo.recordInstallation(id, 'user-1', '1.0.0');

      const pack2 = repo.getPack(id)!;
      expect(pack2.downloads).toBe(1);
    });

    it('submits reviews and updates rating', () => {
      const id = repo.publishPack({
        packId: 'pack-1',
        name: 'Test Pack',
        description: 'Valid description that is long enough for validation',
        author: 'John',
        category: 'productivity' as PackCategory,
        tags: ['tag1'],
        version: '1.0.0',
        updatedAt: Date.now(),
      }) as MarketplacePackId;

      let pack = repo.getPack(id)!;
      expect(pack.rating).toBe(0);
      expect(pack.ratingCount).toBe(0);

      repo.submitReview(id, 'user-1', 5 as Rating, 'Excellent', 'Love this pack');
      repo.submitReview(id, 'user-2', 4 as Rating, 'Good', 'Works well');

      pack = repo.getPack(id)!;
      expect(pack.rating).toBe(4.5);
      expect(pack.ratingCount).toBe(2);
    });

    it('gets reviews for a pack', () => {
      const id = repo.publishPack({
        packId: 'pack-1',
        name: 'Test Pack',
        description: 'Valid description that is long enough for validation',
        author: 'John',
        category: 'productivity' as PackCategory,
        tags: ['tag1'],
        version: '1.0.0',
        updatedAt: Date.now(),
      }) as MarketplacePackId;

      repo.submitReview(id, 'user-1', 5 as Rating, 'Great', 'Excellent');
      repo.submitReview(id, 'user-2', 4 as Rating, 'Good', 'Works well');

      const reviews = repo.getReviews(id);
      expect(reviews).toHaveLength(2);
    });

    it('gets user installations', () => {
      const id1 = repo.publishPack({
        packId: 'pack-1',
        name: 'Pack 1',
        description: 'Valid description that is long enough for validation',
        author: 'John',
        category: 'productivity' as PackCategory,
        tags: ['tag1'],
        version: '1.0.0',
        updatedAt: Date.now(),
      }) as MarketplacePackId;

      const id2 = repo.publishPack({
        packId: 'pack-2',
        name: 'Pack 2',
        description: 'Valid description that is long enough for validation',
        author: 'Jane',
        category: 'productivity' as PackCategory,
        tags: ['tag2'],
        version: '1.0.0',
        updatedAt: Date.now(),
      }) as MarketplacePackId;

      repo.recordInstallation(id1, 'user-1', '1.0.0');
      repo.recordInstallation(id2, 'user-1', '1.0.0');
      repo.recordInstallation(id1, 'user-2', '1.0.0');

      const user1Installs = repo.getUserInstallations('user-1');
      expect(user1Installs).toHaveLength(2);

      const user2Installs = repo.getUserInstallations('user-2');
      expect(user2Installs).toHaveLength(1);
    });

    it('gets trending packs', () => {
      const id = repo.publishPack({
        packId: 'pack-1',
        name: 'Trending Pack',
        description: 'Valid description that is long enough for validation',
        author: 'John',
        category: 'productivity' as PackCategory,
        tags: ['tag1'],
        version: '1.0.0',
        updatedAt: Date.now(),
      }) as MarketplacePackId;

      // Record downloads and ratings
      for (let i = 0; i < 10; i++) {
        repo.recordInstallation(id, `user-${i}`, '1.0.0');
      }

      repo.submitReview(id, 'user-1', 5 as Rating, 'Great', 'Best pack');

      const trending = repo.getTrendingPacks(5);
      expect(trending.length).toBeGreaterThan(0);
      expect(trending[0].id).toBe(id);
    });

    it('gets featured packs', () => {
      const id = repo.publishPack({
        packId: 'pack-1',
        name: 'Featured Pack',
        description: 'Valid description that is long enough for validation',
        author: 'John',
        category: 'productivity' as PackCategory,
        tags: ['tag1'],
        version: '1.0.0',
        updatedAt: Date.now(),
      }) as MarketplacePackId;

      // Record sufficient downloads and high ratings
      for (let i = 0; i < 150; i++) {
        repo.recordInstallation(id, `user-${i}`, '1.0.0');
      }

      for (let i = 0; i < 10; i++) {
        repo.submitReview(id, `user-${i}`, 5 as Rating, 'Great', 'Love it');
      }

      const featured = repo.getFeaturedPacks(5);
      expect(featured.length).toBeGreaterThan(0);
      expect(featured[0].id).toBe(id);
    });

    it('verifies pack installations', () => {
      const id = repo.publishPack({
        packId: 'pack-1',
        name: 'Test Pack',
        description: 'Valid description that is long enough for validation',
        author: 'John',
        category: 'productivity' as PackCategory,
        tags: ['tag1'],
        version: '1.0.0',
        updatedAt: Date.now(),
      }) as MarketplacePackId;

      repo.recordInstallation(id, 'user-1', '1.0.0');
      const review = repo.submitReview(id, 'user-1', 5 as Rating, 'Great', 'Love it');

      expect(review.verified).toBe(true);

      const unverifiedReview = repo.submitReview(id, 'user-2', 4 as Rating, 'Good', 'Works');
      expect(unverifiedReview.verified).toBe(false);
    });

    it('clears all data', () => {
      repo.publishPack({
        packId: 'pack-1',
        name: 'Test Pack',
        description: 'Valid description that is long enough for validation',
        author: 'John',
        category: 'productivity' as PackCategory,
        tags: ['tag1'],
        version: '1.0.0',
        updatedAt: Date.now(),
      });

      repo.clear();

      const results = repo.searchPacks({});
      expect(results.total).toBe(0);
    });
  });
});
