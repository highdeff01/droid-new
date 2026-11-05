import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoordinateTranslator, type DisplayInfo } from './coordinate-translator.js';

describe('CoordinateTranslator', () => {
  let translator: CoordinateTranslator;

  beforeEach(() => {
    translator = new CoordinateTranslator();
  });

  describe('normalizedToPixels', () => {
    it('converts center point (0.5, 0.5) to center of 1920x1080 display', () => {
      const { px, py } = translator.normalizedToPixels(0.5, 0.5, 0);
      expect(px).toBe(960);
      expect(py).toBe(540);
    });

    it('converts top-left (0, 0) to (0, 0)', () => {
      const { px, py } = translator.normalizedToPixels(0, 0, 0);
      expect(px).toBe(0);
      expect(py).toBe(0);
    });

    it('converts bottom-right (1, 1) to display dimensions', () => {
      const { px, py } = translator.normalizedToPixels(1, 1, 0);
      expect(px).toBe(1920);
      expect(py).toBe(1080);
    });

    it('clamps coordinates to [0, 1] range', () => {
      const { px: px1, py: py1 } = translator.normalizedToPixels(-0.1, 1.2, 0);
      expect(px1).toBe(0);
      expect(py1).toBe(1080);

      const { px: px2, py: py2 } = translator.normalizedToPixels(1.5, -0.5, 0);
      expect(px2).toBe(1920);
      expect(py2).toBe(0);
    });
  });

  describe('pixelsToNormalized', () => {
    it('converts pixel center back to (0.5, 0.5)', () => {
      const { x, y } = translator.pixelsToNormalized(960, 540, 0);
      expect(x).toBeCloseTo(0.5, 5);
      expect(y).toBeCloseTo(0.5, 5);
    });

    it('inverts normalizedToPixels transformation', () => {
      const original = { x: 0.25, y: 0.75 };
      const { px, py } = translator.normalizedToPixels(original.x, original.y, 0);
      const { x, y } = translator.pixelsToNormalized(px, py, 0);

      expect(x).toBeCloseTo(original.x, 5);
      expect(y).toBeCloseTo(original.y, 5);
    });
  });

  describe('multi-monitor support', () => {
    it('handles multi-monitor offset correctly', () => {
      const displays: DisplayInfo[] = [
        { index: 0, name: 'Left', width: 1920, height: 1080, offsetX: 0, offsetY: 0, isPrimary: true },
        { index: 1, name: 'Right', width: 1920, height: 1080, offsetX: 1920, offsetY: 0, isPrimary: false },
      ];
      translator = new CoordinateTranslator(() => displays);

      // On display 0, (0.5, 0.5) = (960, 540)
      const { px: px0, py: py0 } = translator.normalizedToPixels(0.5, 0.5, 0);
      expect(px0).toBe(960);
      expect(py0).toBe(540);

      // On display 1, (0.5, 0.5) = (1920 + 960, 540)
      const { px: px1, py: py1 } = translator.normalizedToPixels(0.5, 0.5, 1);
      expect(px1).toBe(2880);
      expect(py1).toBe(540);
    });

    it('falls back to primary display for invalid index', () => {
      const displays: DisplayInfo[] = [
        { index: 0, name: 'Left', width: 1920, height: 1080, offsetX: 0, offsetY: 0, isPrimary: false },
        { index: 1, name: 'Primary', width: 2560, height: 1440, offsetX: 1920, offsetY: 0, isPrimary: true },
      ];
      translator = new CoordinateTranslator(() => displays);
      const { px, py } = translator.normalizedToPixels(0.5, 0.5, 999);
      expect(px).toBe(3200);
      expect(py).toBe(720);
    });
  });

  describe('display caching', () => {
    it('caches DisplayInfo results', () => {
      const displays1 = translator.getDisplayInfo();
      const displays2 = translator.getDisplayInfo();
      expect(displays1).toBe(displays2); // Same reference (cached)
    });

    it('invalidates cache on demand', () => {
      const displays1 = translator.getDisplayInfo();
      translator.invalidateCache();
      const displays2 = translator.getDisplayInfo();
      expect(displays1).not.toBe(displays2); // Different reference after invalidation
    });
  });

  describe('translateCoordinates', () => {
    it('updates WorkflowStep with pixel coordinates', () => {
      const step = {
        id: 'test',
        name: 'Test',
        action: 'click' as const,
        x: 0.5,
        y: 0.5,
        status: 'pending' as const,
      };

      const translated = translator.translateCoordinates(step);
      expect(translated.correctedX).toBe(960);
      expect(translated.correctedY).toBe(540);
      expect(translated.x).toBe(0.5); // Original preserved
      expect(translated.y).toBe(0.5);
    });

    it('uses the requested display and the supplied display geometry', () => {
      const displays: DisplayInfo[] = [
        { index: 0, name: 'Primary', width: 1920, height: 1080, offsetX: 0, offsetY: 0, isPrimary: true },
        { index: 1, name: 'Secondary', width: 1280, height: 720, offsetX: -1280, offsetY: 0, isPrimary: false },
      ];
      const step = { id: 'test', name: 'Test', action: 'click' as const, x: 0.5, y: 0.5, displayIndex: 1, status: 'pending' as const };
      expect(translator.translateCoordinates(step, displays)).toMatchObject({ correctedX: -640, correctedY: 360 });
    });
  });

  describe('getPrimaryDisplay and getDisplay', () => {
    it('returns primary display', () => {
      const primary = translator.getPrimaryDisplay();
      expect(primary).toBeDefined();
      expect(primary.isPrimary).toBe(true);
    });

    it('returns display by index', () => {
      const display = translator.getDisplay(0);
      expect(display).toBeDefined();
      expect(display?.index).toBe(0);
    });

    it('returns null for invalid display index', () => {
      const display = translator.getDisplay(999);
      expect(display).toBeNull();
    });
  });
});
