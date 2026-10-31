import { describe, expect, it } from 'vitest';
import { GUIDE, allFeatures, guideFeatureCount, searchGuide } from './guide.js';

describe('guide content', () => {
  it('covers every feature area the app ships', () => {
    const ids = GUIDE.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['start', 'workflows', 'agents', 'bridge', 'triggers', 'world', 'new', 'settings']));
  });

  it('gives every feature a name, a summary and at least one usage step', () => {
    for (const { feature } of allFeatures()) {
      expect(feature.name.trim()).not.toBe('');
      expect(feature.summary.trim()).not.toBe('');
      expect(feature.how.length).toBeGreaterThan(0);
      for (const step of feature.how) expect(step.trim()).not.toBe('');
    }
  });

  it('documents the newest channels and the two-app rules', () => {
    const text = allFeatures().map(({ feature }) => `${feature.name} ${feature.summary}`).join(' ').toLowerCase();
    for (const topic of ['voice', 'phone companion', 'plugin', 'who is driving', 'updates']) expect(text).toContain(topic);
  });

  it('counts every feature exactly once', () => {
    expect(guideFeatureCount()).toBe(allFeatures().length);
    expect(guideFeatureCount()).toBeGreaterThan(20);
  });
});

describe('searchGuide', () => {
  it('returns everything for an empty or blank query', () => {
    expect(searchGuide('').length).toBe(allFeatures().length);
    expect(searchGuide('   ').length).toBe(allFeatures().length);
  });

  it('matches a feature by name, case-insensitively', () => {
    const hits = searchGuide('VOICE');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.feature.name.toLowerCase().includes('voice'))).toBe(true);
  });

  it('matches text in a summary or a step, not only the name', () => {
    expect(searchGuide('Shift+Escape').some((h) => h.feature.how.join(' ').includes('Shift+Escape'))).toBe(true);
    expect(searchGuide('ollama').length).toBeGreaterThan(0);
  });

  it('matches a section title, returning that section’s features', () => {
    const hits = searchGuide('quest world');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.section.id === 'world')).toBe(true);
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(searchGuide('zzzz-no-such-feature')).toEqual([]);
  });
});
