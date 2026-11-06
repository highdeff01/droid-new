/**
 * Tests for coordinate translation system
 * Validates coordinate adaptation across different displays and multi-display scenarios.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeCoordinate,
  denormalizeCoordinate,
  translateCoordinate,
  calculateScaleFactor,
  calculateConfidence,
  getMultiDisplayOffset,
  analyzeDisplayLayout,
  adaptiveTranslateCoordinate,
  batchTranslateCoordinates,
  isCoordinateInBounds,
  clampCoordinateToBounds,
  normalizedDistance,
  isSignificantAdaptation,
  type DisplayInfo,
  type CoordinateContext,
  type NormalizedCoord,
} from './coordinate-translation.js';

// Test displays
const HD_DISPLAY: DisplayInfo = { width: 1920, height: 1080, dpi: 96, name: 'HD', isPrimary: true, scaleFactor: 1 };
const FHD_DISPLAY: DisplayInfo = { width: 2560, height: 1440, dpi: 96, name: 'FHD', scaleFactor: 1 };
const LAPTOP_DISPLAY: DisplayInfo = { width: 1366, height: 768, dpi: 96, name: 'Laptop', scaleFactor: 1 };
const UHD_DISPLAY: DisplayInfo = { width: 3840, height: 2160, dpi: 96, name: '4K', scaleFactor: 1 };
const HIGH_DPI_DISPLAY: DisplayInfo = { width: 1920, height: 1080, dpi: 192, name: 'HighDPI', scaleFactor: 2 };

describe('coordinate-translation', () => {
  describe('normalizeCoordinate', () => {
    it('converts pixel coordinates to [0, 1] range', () => {
      const coord = { x: 960, y: 540 };
      const result = normalizeCoordinate(coord, HD_DISPLAY);
      expect(result.x).toBeCloseTo(0.5);
      expect(result.y).toBeCloseTo(0.5);
    });

    it('clamps coordinates outside bounds to [0, 1]', () => {
      const coord = { x: 2000, y: 2000 };
      const result = normalizeCoordinate(coord, HD_DISPLAY);
      expect(result.x).toBe(1);
      expect(result.y).toBe(1);
    });

    it('handles negative coordinates', () => {
      const coord = { x: -100, y: -100 };
      const result = normalizeCoordinate(coord, HD_DISPLAY);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });

    it('correctly normalizes corners', () => {
      const topLeft = normalizeCoordinate({ x: 0, y: 0 }, HD_DISPLAY);
      expect(topLeft).toEqual({ x: 0, y: 0 });

      const bottomRight = normalizeCoordinate({ x: 1920, y: 1080 }, HD_DISPLAY);
      expect(bottomRight.x).toBe(1);
      expect(bottomRight.y).toBe(1);
    });
  });

  describe('denormalizeCoordinate', () => {
    it('converts normalized coordinates to pixel coordinates', () => {
      const norm = { x: 0.5, y: 0.5 };
      const result = denormalizeCoordinate(norm, HD_DISPLAY);
      expect(result).toEqual({ x: 960, y: 540 });
    });

    it('rounds to nearest pixel', () => {
      const norm = { x: 0.333, y: 0.333 };
      const result = denormalizeCoordinate(norm, HD_DISPLAY);
      expect(Number.isInteger(result.x)).toBe(true);
      expect(Number.isInteger(result.y)).toBe(true);
    });

    it('handles different display sizes', () => {
      const norm = { x: 0.5, y: 0.5 };
      const hd = denormalizeCoordinate(norm, HD_DISPLAY);
      const uhd = denormalizeCoordinate(norm, UHD_DISPLAY);
      expect(uhd.x).toBe(hd.x * 2);
      expect(uhd.y).toBe(hd.y * 2);
    });
  });

  describe('normalizeCoordinate → denormalizeCoordinate roundtrip', () => {
    it('preserves coordinates after normalization and denormalization', () => {
      const original = { x: 1234, y: 567 };
      const norm = normalizeCoordinate(original, HD_DISPLAY);
      const recovered = denormalizeCoordinate(norm, HD_DISPLAY);

      // Allow small rounding error (1 pixel max)
      expect(Math.abs(recovered.x - original.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(recovered.y - original.y)).toBeLessThanOrEqual(1);
    });

    it('handles multiple roundtrips', () => {
      let coord: NormalizedCoord = { x: 0.123, y: 0.456 };
      for (let i = 0; i < 5; i++) {
        const pixel = denormalizeCoordinate(coord, HD_DISPLAY);
        coord = normalizeCoordinate(pixel, HD_DISPLAY);
      }
      expect(coord.x).toBeCloseTo(0.123, 2);
      expect(coord.y).toBeCloseTo(0.456, 2);
    });
  });

  describe('calculateScaleFactor', () => {
    it('returns 1.0 for identical displays', () => {
      const scale = calculateScaleFactor(HD_DISPLAY, HD_DISPLAY);
      expect(scale).toBe(1.0);
    });

    it('calculates scale for different resolutions', () => {
      const scale = calculateScaleFactor(HD_DISPLAY, FHD_DISPLAY);
      expect(scale).toBeGreaterThan(1.0);
    });

    it('uses DPI when available', () => {
      const scale = calculateScaleFactor(HD_DISPLAY, HIGH_DPI_DISPLAY);
      expect(scale).toBeCloseTo(2.0, 1);
    });

    it('handles 4K displays correctly', () => {
      const scale = calculateScaleFactor(HD_DISPLAY, UHD_DISPLAY);
      expect(scale).toBeCloseTo(2.0, 1);
    });

    it('handles downscaling', () => {
      const scale = calculateScaleFactor(UHD_DISPLAY, LAPTOP_DISPLAY);
      expect(scale).toBeLessThan(1.0);
    });
  });

  describe('calculateConfidence', () => {
    it('returns 1.0 for identical displays', () => {
      const conf = calculateConfidence(HD_DISPLAY, HD_DISPLAY, 1.0);
      expect(conf).toBe(1.0);
    });

    it('reduces confidence for different resolutions', () => {
      const conf = calculateConfidence(HD_DISPLAY, FHD_DISPLAY, 1.33);
      expect(conf).toBeGreaterThan(0.6);
      expect(conf).toBeLessThan(1.0);
    });

    it('heavily penalizes extreme aspect ratios', () => {
      const wideDisplay: DisplayInfo = { width: 3440, height: 1440, name: 'Ultrawide' };
      const conf = calculateConfidence(HD_DISPLAY, wideDisplay, 1.5);
      expect(conf).toBeLessThan(0.8);
    });

    it('maintains minimum confidence of 0.2', () => {
      const extremeScale = calculateScaleFactor(HD_DISPLAY, { width: 600, height: 300 });
      const conf = calculateConfidence(HD_DISPLAY, { width: 600, height: 300 }, extremeScale);
      expect(conf).toBeGreaterThanOrEqual(0.2);
    });
  });

  describe('translateCoordinate', () => {
    it('translates coordinates with direct scaling', () => {
      const context: CoordinateContext = {
        sourceDisplay: HD_DISPLAY,
        targetDisplay: HD_DISPLAY,
        adaptationMode: 'direct',
      };
      const coord = { x: 960, y: 540 };
      const result = translateCoordinate(coord, context);
      expect(result.x).toEqual(960);
      expect(result.y).toEqual(540);
      expect(result.adapted).toBe(false);
    });

    it('scales coordinates for 2x display', () => {
      const context: CoordinateContext = {
        sourceDisplay: HD_DISPLAY,
        targetDisplay: UHD_DISPLAY,
        adaptationMode: 'scaled',
      };
      const coord = { x: 960, y: 540 };
      const result = translateCoordinate(coord, context);
      // Should be scaled by approximately 2x
      expect(result.x).toBeGreaterThan(1800);
      expect(result.y).toBeGreaterThan(1000);
    });

    it('applies multi-display offsets', () => {
      const context: CoordinateContext = {
        sourceDisplay: HD_DISPLAY,
        targetDisplay: HD_DISPLAY,
        adaptationMode: 'direct',
        offsetX: 1920,
        offsetY: 0,
      };
      const coord = { x: 100, y: 100 };
      const result = translateCoordinate(coord, context);
      expect(result.x).toBe(100 + 1920);
      expect(result.y).toBe(100);
    });

    it('returns adapted flag when scaling applied', () => {
      const context: CoordinateContext = {
        sourceDisplay: HD_DISPLAY,
        targetDisplay: { ...FHD_DISPLAY, scaleFactor: 1 },
        adaptationMode: 'scaled',
      };
      const coord = { x: 500, y: 500 };
      const result = translateCoordinate(coord, context);
      // FHD and HD have different resolutions, so should be adapted
      expect(result.adapted).toBe(true);
    });
  });

  describe('getMultiDisplayOffset', () => {
    it('returns zero offset for first display', () => {
      const layout = analyzeDisplayLayout([HD_DISPLAY, FHD_DISPLAY]);
      const offset = getMultiDisplayOffset(layout, 0);
      expect(offset).toEqual({ x: 0, y: 0 });
    });

    it('returns width offset for second display', () => {
      const layout = analyzeDisplayLayout([HD_DISPLAY, FHD_DISPLAY]);
      const offset = getMultiDisplayOffset(layout, 1);
      expect(offset.x).toBe(HD_DISPLAY.width);
    });

    it('handles out-of-bounds indices', () => {
      const layout = analyzeDisplayLayout([HD_DISPLAY]);
      const offset = getMultiDisplayOffset(layout, 5);
      expect(offset).toEqual({ x: 0, y: 0 });
    });
  });

  describe('analyzeDisplayLayout', () => {
    it('detects primary display', () => {
      const layout = analyzeDisplayLayout([HD_DISPLAY, FHD_DISPLAY]);
      expect(layout.primaryDisplay).toBe(HD_DISPLAY);
    });

    it('calculates cumulative offsets', () => {
      const layout = analyzeDisplayLayout([HD_DISPLAY, FHD_DISPLAY, LAPTOP_DISPLAY]);
      expect(layout.offsetsX).toEqual([0, HD_DISPLAY.width, HD_DISPLAY.width + FHD_DISPLAY.width]);
    });

    it('marks as linear arrangement', () => {
      const layout = analyzeDisplayLayout([HD_DISPLAY, FHD_DISPLAY]);
      expect(layout.arrangement).toBe('linear');
    });
  });

  describe('adaptiveTranslateCoordinate', () => {
    it('returns translation with high confidence', () => {
      const context: CoordinateContext = {
        sourceDisplay: HD_DISPLAY,
        targetDisplay: HD_DISPLAY,
        adaptationMode: 'direct',
      };
      const result = adaptiveTranslateCoordinate({ x: 100, y: 100 }, context);
      expect(result).not.toBeNull();
      expect(result!.confidence).toBe(1.0);
    });

    it('returns translation even with low confidence if requested', () => {
      const context: CoordinateContext = {
        sourceDisplay: HD_DISPLAY,
        targetDisplay: { width: 600, height: 300 },
        adaptationMode: 'adaptive',
      };
      const result = adaptiveTranslateCoordinate({ x: 960, y: 540 }, context, {
        minimumConfidence: 0.1,
      });
      expect(result).not.toBeNull();
    });
  });

  describe('batchTranslateCoordinates', () => {
    it('translates multiple coordinates', () => {
      const context: CoordinateContext = {
        sourceDisplay: HD_DISPLAY,
        targetDisplay: HD_DISPLAY,
        adaptationMode: 'direct',
      };
      const coords = [
        { x: 100, y: 100 },
        { x: 500, y: 500 },
        { x: 1000, y: 1000 },
      ];
      const results = batchTranslateCoordinates(coords, context);
      expect(results).toHaveLength(3);
      expect(results[0]).toEqual(expect.objectContaining({ x: 100, y: 100 }));
    });

    it('applies same context to all coordinates', () => {
      const context: CoordinateContext = {
        sourceDisplay: HD_DISPLAY,
        targetDisplay: FHD_DISPLAY,
        adaptationMode: 'scaled',
      };
      const coords = [
        { x: 960, y: 540 },
        { x: 960, y: 540 },
      ];
      const results = batchTranslateCoordinates(coords, context);
      expect(results[0].x).toBe(results[1].x);
      expect(results[0].y).toBe(results[1].y);
    });
  });

  describe('isCoordinateInBounds', () => {
    it('returns true for coordinates within bounds', () => {
      expect(isCoordinateInBounds({ x: 960, y: 540 }, HD_DISPLAY)).toBe(true);
    });

    it('returns false for coordinates outside bounds', () => {
      expect(isCoordinateInBounds({ x: 2000, y: 2000 }, HD_DISPLAY)).toBe(false);
    });

    it('returns true for boundary coordinates', () => {
      expect(isCoordinateInBounds({ x: 0, y: 0 }, HD_DISPLAY)).toBe(true);
      expect(isCoordinateInBounds({ x: 1920, y: 1080 }, HD_DISPLAY)).toBe(true);
    });
  });

  describe('clampCoordinateToBounds', () => {
    it('clamps coordinates to valid range', () => {
      const result = clampCoordinateToBounds({ x: 2000, y: 2000 }, HD_DISPLAY);
      expect(result.x).toBe(1920);
      expect(result.y).toBe(1080);
    });

    it('leaves valid coordinates unchanged', () => {
      const coord = { x: 960, y: 540 };
      const result = clampCoordinateToBounds(coord, HD_DISPLAY);
      expect(result).toEqual(coord);
    });
  });

  describe('normalizedDistance', () => {
    it('calculates distance between normalized coordinates', () => {
      const from: NormalizedCoord = { x: 0, y: 0 };
      const to: NormalizedCoord = { x: 0.3, y: 0.4 };
      const distance = normalizedDistance(from, to);
      expect(distance).toBeCloseTo(0.5, 1);  // 3-4-5 triangle
    });

    it('returns 0 for same coordinates', () => {
      const coord: NormalizedCoord = { x: 0.5, y: 0.5 };
      const distance = normalizedDistance(coord, coord);
      expect(distance).toBe(0);
    });
  });

  describe('isSignificantAdaptation', () => {
    it('returns false for similar displays', () => {
      // HD and FHD are actually quite similar (1.33x scale)
      const result = isSignificantAdaptation(HD_DISPLAY, { width: 1920, height: 1080, name: 'Same' });
      expect(result).toBe(false);
    });

    it('returns true for >20% resolution change', () => {
      const smaller = { width: 1200, height: 800 };
      const result = isSignificantAdaptation(HD_DISPLAY, smaller);
      expect(result).toBe(true);
    });

    it('returns true for extreme aspect ratios', () => {
      const ultrawide = { width: 3440, height: 1440 };
      const result = isSignificantAdaptation(HD_DISPLAY, ultrawide);
      expect(result).toBe(true);
    });
  });

  describe('cross-platform scenarios', () => {
    it('handles Windows 125% DPI scaling', () => {
      const windowsScaled: DisplayInfo = {
        width: 1920,
        height: 1080,
        scaleFactor: 1.25,
        dpi: 120,
      };
      // HD_DISPLAY has scaleFactor 1, so ratio is 1.25 / 1 = 1.25
      const scale = calculateScaleFactor(HD_DISPLAY, windowsScaled);
      expect(scale).toBeCloseTo(1.25, 1);
    });

    it('handles macOS Retina displays', () => {
      const retina: DisplayInfo = {
        width: 2880,
        height: 1800,
        scaleFactor: 2,
        dpi: 192,
      };
      const scale = calculateScaleFactor(HD_DISPLAY, retina);
      expect(scale).toBeCloseTo(2.0, 1);
    });

    it('handles Linux HIDPI', () => {
      const hidpi: DisplayInfo = {
        width: 3840,
        height: 2160,
        scaleFactor: 2,
        dpi: 192,
      };
      const context: CoordinateContext = {
        sourceDisplay: HD_DISPLAY,
        targetDisplay: hidpi,
        adaptationMode: 'adaptive',
      };
      const result = translateCoordinate({ x: 960, y: 540 }, context);
      expect(result.scaleFactor).toBeGreaterThan(1.5);
    });
  });

  describe('multi-display scenarios', () => {
    it('handles 3-monitor setup (horizontal)', () => {
      const layout = analyzeDisplayLayout([HD_DISPLAY, FHD_DISPLAY, LAPTOP_DISPLAY]);
      expect(layout.displays).toHaveLength(3);
      expect(layout.offsetsX).toHaveLength(3);
    });

    it('correctly offsets for second and third displays', () => {
      const layout = analyzeDisplayLayout([HD_DISPLAY, FHD_DISPLAY, LAPTOP_DISPLAY]);
      expect(layout.offsetsX[0]).toBe(0);
      expect(layout.offsetsX[1]).toBe(1920);
      expect(layout.offsetsX[2]).toBe(1920 + 2560);
    });

    it('translates coordinates to correct display in multi-monitor setup', () => {
      const layout = analyzeDisplayLayout([HD_DISPLAY, FHD_DISPLAY]);
      const context: CoordinateContext = {
        sourceDisplay: HD_DISPLAY,
        targetDisplay: HD_DISPLAY,
        adaptationMode: 'direct',
        offsetX: layout.offsetsX[1] ?? 0,
        offsetY: 0,
      };
      const result = translateCoordinate({ x: 100, y: 100 }, context);
      expect(result.x).toBe(100 + 1920);
      expect(result.y).toBe(100);
    });
  });
});
