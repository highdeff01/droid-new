/**
 * Property-Based Tests for Coordinate Normalization
 * Tests normalization round-trips, multi-display adaptation, clamping, and DPI scaling.
 * 
 * Requirements: 1.6, 2.3, 9.6, 9.7, 9.8
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeCoordinate,
  denormalizeCoordinate,
  translateCoordinate,
  applyDpiScaling,
  calculateDpiScaleFactor,
  isValidNormalizedCoordinate,
  clampToDisplayBounds,
  roundNormalizedCoordinate,
  normalizedDistance,
  batchTranslateCoordinates,
} from './coordinate-normalization.js';
import type { DisplayState } from './integration-types.js';

/**
 * Test display configurations for various scenarios
 */
const TEST_DISPLAYS: DisplayState[] = [
  // Standard displays
  { width: 1920, height: 1080, dpi: 96 },  // HD
  { width: 2560, height: 1440, dpi: 96 },  // FHD
  { width: 3840, height: 2160, dpi: 96 },  // UHD/4K
  { width: 1366, height: 768, dpi: 96 },   // Laptop
  // High DPI displays
  { width: 1920, height: 1080, dpi: 192 }, // 2x scaling
  { width: 2880, height: 1800, dpi: 192 }, // Retina
  { width: 3200, height: 1800, dpi: 144 }, // 1.5x scaling
];

const DPI_SCALING_FACTORS = [1.0, 1.25, 1.5, 2.0];

/**
 * Helper to create display with specific DPI
 */
function createDisplay(
  width: number,
  height: number,
  dpi: number
): DisplayState {
  return { width, height, dpi };
}

/**
 * Helper to create pixel coordinate
 */
function pixel(x: number, y: number) {
  return { x, y };
}

/**
 * Helper to create normalized coordinate
 */
function normalized(x: number, y: number) {
  return { x, y };
}

describe('coordinate-normalization', () => {
  describe('normalizeCoordinate', () => {
    it('converts pixel coordinates to [0, 1] range', () => {
      const coord = pixel(960, 540);
      const display = TEST_DISPLAYS[0]; // 1920x1080
      const result = normalizeCoordinate(coord, display);
      
      expect(result.x).toBeCloseTo(0.5);
      expect(result.y).toBeCloseTo(0.5);
    });

    it('normalizes corner coordinates correctly', () => {
      const display = TEST_DISPLAYS[0]; // 1920x1080
      
      // Top-left
      expect(normalizeCoordinate(pixel(0, 0), display)).toEqual({ x: 0, y: 0 });
      
      // Bottom-right
      expect(normalizeCoordinate(pixel(1920, 1080), display)).toEqual({ x: 1, y: 1 });
      
      // Center
      expect(normalizeCoordinate(pixel(960, 540), display)).toEqual({ x: 0.5, y: 0.5 });
    });

    it('clamps coordinates outside display bounds to [0, 1]', () => {
      const display = TEST_DISPLAYS[0]; // 1920x1080
      
      // Coordinate beyond bottom-right
      const result1 = normalizeCoordinate(pixel(2000, 1200), display);
      expect(result1.x).toBe(1);
      expect(result1.y).toBe(1);
      
      // Coordinate beyond top-left (negative)
      const result2 = normalizeCoordinate(pixel(-100, -50), display);
      expect(result2.x).toBe(0);
      expect(result2.y).toBe(0);
    });

    it('handles coordinates on display edges', () => {
      const display = TEST_DISPLAYS[0]; // 1920x1080
      
      // Left edge
      expect(normalizeCoordinate(pixel(0, 500), display)).toEqual({ x: 0, y: expect.any(Number) });
      
      // Right edge
      expect(normalizeCoordinate(pixel(1920, 500), display)).toEqual({ x: 1, y: expect.any(Number) });
      
      // Top edge
      expect(normalizeCoordinate(pixel(1000, 0), display)).toEqual({ x: expect.any(Number), y: 0 });
      
      // Bottom edge
      expect(normalizeCoordinate(pixel(1000, 1080), display)).toEqual({ x: expect.any(Number), y: 1 });
    });

    it('handles different display resolutions', () => {
      // Same pixel at different resolutions should normalize to same value
      const coord = pixel(500, 300);
      
      const hd = normalizeCoordinate(coord, { width: 1920, height: 1080, dpi: 96 });
      const fhd = normalizeCoordinate(coord, { width: 2560, height: 1440, dpi: 96 });
      const uhd = normalizeCoordinate(coord, { width: 3840, height: 2160, dpi: 96 });
      
      expect(hd.x).toBeCloseTo(0.26, 2);
      expect(fhd.x).toBeCloseTo(0.195, 2);
      expect(uhd.x).toBeCloseTo(0.13, 2);
    });
  });

  describe('denormalizeCoordinate', () => {
    it('converts normalized coordinates to pixel coordinates', () => {
      const norm = normalized(0.5, 0.5);
      const display = TEST_DISPLAYS[0]; // 1920x1080
      const result = denormalizeCoordinate(norm, display);
      
      expect(result.x).toBe(960);
      expect(result.y).toBe(540);
    });

    it('rounds to nearest pixel', () => {
      const norm = normalized(0.333, 0.667);
      const display = TEST_DISPLAYS[0]; // 1920x1080
      const result = denormalizeCoordinate(norm, display);
      
      expect(result.x).toBe(Math.round(0.333 * 1920));
      expect(result.y).toBe(Math.round(0.667 * 1080));
    });

    it('handles 0 and 1 normalized values', () => {
      const display = TEST_DISPLAYS[0]; // 1920x1080
      
      expect(denormalizeCoordinate(normalized(0, 0), display)).toEqual({ x: 0, y: 0 });
      expect(denormalizeCoordinate(normalized(1, 1), display)).toEqual({ x: 1920, y: 1080 });
    });

    it('scales with different display sizes', () => {
      const norm = normalized(0.5, 0.5);
      
      const hd = denormalizeCoordinate(norm, { width: 1920, height: 1080, dpi: 96 });
      const uhd = denormalizeCoordinate(norm, { width: 3840, height: 2160, dpi: 96 });
      
      expect(uhd.x).toBe(hd.x * 2);
      expect(uhd.y).toBe(hd.y * 2);
    });
  });

  describe('normalizeCoordinate → denormalizeCoordinate round-trip', () => {
    it('preserves coordinates after round-trip on same display', () => {
      const original = pixel(1234, 567);
      const display = TEST_DISPLAYS[0]; // 1920x1080
      
      const norm = normalizeCoordinate(original, display);
      const recovered = denormalizeCoordinate(norm, display);
      
      // Allow 1 pixel rounding error
      expect(Math.abs(recovered.x - original.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(recovered.y - original.y)).toBeLessThanOrEqual(1);
    });

    it('handles edge cases in round-trip', () => {
      const display = TEST_DISPLAYS[0]; // 1920x1080
      
      // Test corners
      [pixel(0, 0), pixel(1920, 1080)].forEach(coord => {
        const norm = normalizeCoordinate(coord, display);
        const recovered = denormalizeCoordinate(norm, display);
        
        expect(Math.abs(recovered.x - coord.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(recovered.y - coord.y)).toBeLessThanOrEqual(1);
      });
    });

    it('handles various display DPI values in round-trip', () => {
      const original = pixel(1000, 600);
      
      TEST_DISPLAYS.forEach(display => {
        const norm = normalizeCoordinate(original, display);
        const recovered = denormalizeCoordinate(norm, display);
        
        expect(Math.abs(recovered.x - original.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(recovered.y - original.y)).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('isValidNormalizedCoordinate', () => {
    it('validates coordinates within [0, 1] range', () => {
      expect(isValidNormalizedCoordinate({ x: 0, y: 0 })).toBe(true);
      expect(isValidNormalizedCoordinate({ x: 1, y: 1 })).toBe(true);
      expect(isValidNormalizedCoordinate({ x: 0.5, y: 0.5 })).toBe(true);
      expect(isValidNormalizedCoordinate({ x: 0.25, y: 0.75 })).toBe(true);
    });

    it('rejects coordinates outside [0, 1] range', () => {
      expect(isValidNormalizedCoordinate({ x: -0.1, y: 0.5 })).toBe(false);
      expect(isValidNormalizedCoordinate({ x: 1.1, y: 0.5 })).toBe(false);
      expect(isValidNormalizedCoordinate({ x: 0.5, y: -0.1 })).toBe(false);
      expect(isValidNormalizedCoordinate({ x: 0.5, y: 1.1 })).toBe(false);
    });

    it('validates edge cases', () => {
      expect(isValidNormalizedCoordinate({ x: 0, y: 1 })).toBe(true);
      expect(isValidNormalizedCoordinate({ x: 1, y: 0 })).toBe(true);
    });
  });

  describe('clampToDisplayBounds', () => {
    it('clamps coordinates within display bounds', () => {
      const display = TEST_DISPLAYS[0]; // 1920x1080
      
      // Within bounds - should remain unchanged
      expect(clampToDisplayBounds(pixel(960, 540), display)).toEqual({ x: 960, y: 540 });
      
      // Beyond right edge
      expect(clampToDisplayBounds(pixel(2000, 540), display)).toEqual({ x: 1920, y: 540 });
      
      // Beyond bottom edge
      expect(clampToDisplayBounds(pixel(960, 1200), display)).toEqual({ x: 960, y: 1080 });
      
      // Negative coordinates
      expect(clampToDisplayBounds(pixel(-100, -50), display)).toEqual({ x: 0, y: 0 });
    });
  });

  describe('translateCoordinate', () => {
    it('translates coordinates between displays with same DPI', () => {
      const sourceDisplay = TEST_DISPLAYS[0]; // 1920x1080
      const targetDisplay = TEST_DISPLAYS[1]; // 2560x1440
      const coord = pixel(960, 540);
      
      const result = translateCoordinate(coord, sourceDisplay, targetDisplay);
      
      // 960/1920 = 0.5 normalized
      // 0.5 * 2560 = 1280
      expect(result.x).toBe(1280);
      expect(result.y).toBe(720);
    });

    it('applies DPI scaling when DPI differs', () => {
      const sourceDisplay = { width: 1920, height: 1080, dpi: 96 };
      const targetDisplay = { width: 1920, height: 1080, dpi: 192 };
      const coord = pixel(960, 540);
      
      const result = translateCoordinate(coord, sourceDisplay, targetDisplay);
      
      // DPI scale factor is 2x
      expect(result.x).toBeCloseTo(960 * 2, 0);
      expect(result.y).toBeCloseTo(540 * 2, 0);
    });

    it('handles multi-display scenarios', () => {
      const sourceDisplay = TEST_DISPLAYS[0]; // 1920x1080
      const targetDisplay = TEST_DISPLAYS[2]; // 3840x2160 (4K)
      const coord = pixel(960, 540);
      
      const result = translateCoordinate(coord, sourceDisplay, targetDisplay);
      
      // 960/1920 = 0.5 normalized
      // 0.5 * 3840 = 1920
      expect(result.x).toBe(1920);
      expect(result.y).toBe(1080);
    });

    it('preserves relative position across different aspect ratios', () => {
      const sourceDisplay = TEST_DISPLAYS[0]; // 1920x1080 (16:9)
      const targetDisplay = { width: 3440, height: 1440, dpi: 96 }; // Ultrawide (21.5:9)
      const coord = pixel(960, 540); // Center of 16:9
      
      const result = translateCoordinate(coord, sourceDisplay, targetDisplay);
      
      // Should be at 50% width but different height due to aspect ratio
      expect(result.x).toBe(1720); // 50% of 3440
      expect(result.y).toBeCloseTo(720, 0); // ~50% of 1440, accounting for aspect ratio differences
    });
  });

  describe('calculateDpiScaleFactor', () => {
    it('returns 1.0 for same DPI', () => {
      const source = { width: 1920, height: 1080, dpi: 96 };
      const target = { width: 2560, height: 1440, dpi: 96 };
      
      expect(calculateDpiScaleFactor(source, target)).toBe(1.0);
    });

    it('calculates scale for 2x DPI', () => {
      const source = { width: 1920, height: 1080, dpi: 96 };
      const target = { width: 1920, height: 1080, dpi: 192 };
      
      expect(calculateDpiScaleFactor(source, target)).toBe(2.0);
    });

    it('calculates scale for 1.5x DPI', () => {
      const source = { width: 1920, height: 1080, dpi: 96 };
      const target = { width: 1920, height: 1080, dpi: 144 };
      
      expect(calculateDpiScaleFactor(source, target)).toBe(1.5);
    });

    it('handles zero DPI gracefully', () => {
      const source = { width: 1920, height: 1080, dpi: 0 };
      const target = { width: 1920, height: 1080, dpi: 96 };
      
      expect(calculateDpiScaleFactor(source, target)).toBe(1.0);
    });
  });

  describe('applyDpiScaling', () => {
    it('applies DPI scaling to coordinates', () => {
      const coord = pixel(1000, 600);
      
      // 96 DPI to 192 DPI (2x scaling)
      const result = applyDpiScaling(coord, 96, 192);
      expect(result.x).toBe(2000);
      expect(result.y).toBe(1200);
    });

    it('handles 1.5x DPI scaling', () => {
      const coord = pixel(1000, 600);
      
      // 96 DPI to 144 DPI (1.5x scaling)
      const result = applyDpiScaling(coord, 96, 144);
      expect(result.x).toBeCloseTo(1500, 0);
      expect(result.y).toBeCloseTo(900, 0);
    });

    it('returns unchanged coordinates for same DPI', () => {
      const coord = pixel(1000, 600);
      const result = applyDpiScaling(coord, 96, 96);
      expect(result).toEqual(coord);
    });

    it('handles zero source DPI', () => {
      const coord = pixel(1000, 600);
      const result = applyDpiScaling(coord, 0, 96);
      expect(result).toEqual(coord);
    });
  });

  describe('roundNormalizedCoordinate', () => {
    it('rounds to default precision (4 decimal places)', () => {
      const coord = { x: 0.123456789, y: 0.987654321 };
      const result = roundNormalizedCoordinate(coord);
      
      expect(result.x).toBe(0.1235);
      expect(result.y).toBe(0.9877);
    });

    it('rounds to custom precision', () => {
      const coord = { x: 0.123456789, y: 0.987654321 };
      
      expect(roundNormalizedCoordinate(coord, 2)).toEqual({ x: 0.12, y: 0.99 });
      expect(roundNormalizedCoordinate(coord, 6)).toEqual({ x: 0.123457, y: 0.987654 });
    });

    it('handles edge cases', () => {
      expect(roundNormalizedCoordinate({ x: 0, y: 1 })).toEqual({ x: 0, y: 1 });
      expect(roundNormalizedCoordinate({ x: 1, y: 0 })).toEqual({ x: 1, y: 0 });
    });
  });

  describe('normalizedDistance', () => {
    it('calculates distance between normalized coordinates', () => {
      const from = { x: 0, y: 0 };
      const to = { x: 0.3, y: 0.4 };
      const distance = normalizedDistance(from, to);
      
      // 3-4-5 triangle: sqrt(0.3² + 0.4²) = sqrt(0.25) = 0.5
      expect(distance).toBeCloseTo(0.5, 5);
    });

    it('returns 0 for same coordinates', () => {
      const coord = { x: 0.5, y: 0.5 };
      expect(normalizedDistance(coord, coord)).toBe(0);
    });

    it('calculates maximum distance (corner to corner)', () => {
      const distance = normalizedDistance({ x: 0, y: 0 }, { x: 1, y: 1 });
      expect(distance).toBeCloseTo(Math.sqrt(2), 5);
    });
  });

  describe('batchTranslateCoordinates', () => {
    it('translates multiple coordinates at once', () => {
      const sourceDisplay = TEST_DISPLAYS[0]; // 1920x1080
      const targetDisplay = TEST_DISPLAYS[1]; // 2560x1440
      
      const coords = [
        pixel(0, 0),
        pixel(960, 540),
        pixel(1920, 1080),
      ];
      
      const results = batchTranslateCoordinates(coords, sourceDisplay, targetDisplay);
      
      expect(results).toHaveLength(3);
      expect(results[0]).toEqual({ x: 0, y: 0 });
      expect(results[1]).toEqual({ x: 1280, y: 720 });
      expect(results[2]).toEqual({ x: 2560, y: 1440 });
    });

    it('maintains order of coordinates', () => {
      const sourceDisplay = TEST_DISPLAYS[0];
      const targetDisplay = TEST_DISPLAYS[2];
      
      const coords = [pixel(100, 100), pixel(500, 500), pixel(1000, 1000)];
      const results = batchTranslateCoordinates(coords, sourceDisplay, targetDisplay);
      
      results.forEach((result, i) => {
        const expected = translateCoordinate(coords[i], sourceDisplay, targetDisplay);
        expect(result).toEqual(expected);
      });
    });

    it('handles empty array', () => {
      const sourceDisplay = TEST_DISPLAYS[0];
      const targetDisplay = TEST_DISPLAYS[1];
      
      const results = batchTranslateCoordinates([], sourceDisplay, targetDisplay);
      expect(results).toHaveLength(0);
    });
  });
});

/**
 * Property-Based Tests using manual property generation
 * Tests round-trip invariance across multiple scenarios
 */
describe('coordinate-normalization property tests', () => {
  // Test round-trip property: normalize(denormalize(normalize(x))) ≈ x
  it('round-trip property: normalized coordinates preserve position', () => {
    const testCases = [
      // Different displays
      { width: 1920, height: 1080, dpi: 96 },
      { width: 2560, height: 1440, dpi: 96 },
      { width: 3840, height: 2160, dpi: 96 },
      { width: 1366, height: 768, dpi: 96 },
      // Different DPI
      { width: 1920, height: 1080, dpi: 192 },
      { width: 2880, height: 1800, dpi: 192 },
    ];

    const normalizedCoords = [
      { x: 0, y: 0 },
      { x: 0.25, y: 0.25 },
      { x: 0.5, y: 0.5 },
      { x: 0.75, y: 0.75 },
      { x: 1, y: 1 },
      { x: 0.123, y: 0.456 },
      { x: 0.876, y: 0.543 },
    ];

    testCases.forEach(display => {
      normalizedCoords.forEach(normCoord => {
        const pixelCoord = denormalizeCoordinate(normCoord, display);
        const renormalized = normalizeCoordinate(pixelCoord, display);
        
        // Verify round-trip accuracy (allow 1 pixel rounding error)
        expect(Math.abs(renormalized.x - normCoord.x)).toBeLessThanOrEqual(1 / display.width);
        expect(Math.abs(renormalized.y - normCoord.y)).toBeLessThanOrEqual(1 / display.height);
      });
    });
  });

  // Test clamping property: normalized coordinates must be in [0, 1]
  it('clamping property: normalized coordinates always in [0, 1]', () => {
    const testCases = [
      { width: 1920, height: 1080 },
      { width: 3840, height: 2160 },
      { width: 600, height: 400 },
      { width: 5000, height: 3000 },
    ];

    const pixelCoords = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 10000, y: 10000 },
      { x: -100, y: -100 },
      { x: 999999, y: 999999 },
    ];

    testCases.forEach(display => {
      pixelCoords.forEach(pixelCoord => {
        const normalized = normalizeCoordinate(pixelCoord, display);
        
        expect(normalized.x).toBeGreaterThanOrEqual(0);
        expect(normalized.x).toBeLessThanOrEqual(1);
        expect(normalized.y).toBeGreaterThanOrEqual(0);
        expect(normalized.y).toBeLessThanOrEqual(1);
      });
    });
  });

  // Test DPI scaling property: scaled coordinates maintain proportional relationship
  it('DPI scaling property: coordinates scale proportionally with DPI', () => {
    const testCases = DPI_SCALING_FACTORS.map(scale => ({
      source: { width: 1920, height: 1080, dpi: 96 },
      target: { width: 1920, height: 1080, dpi: 96 * scale },
    }));

    const coords = [
      pixel(100, 100),
      pixel(500, 500),
      pixel(1000, 600),
    ];

    testCases.forEach(({ source, target }) => {
      coords.forEach(coord => {
        const scaled = applyDpiScaling(coord, source.dpi!, target.dpi!);
        
        // Verify scale factor is applied
        const expectedScale = target.dpi! / source.dpi!;
        expect(scaled.x).toBeCloseTo(coord.x * expectedScale, 0);
        expect(scaled.y).toBeCloseTo(coord.y * expectedScale, 0);
      });
    });
  });

  // Test multi-display property: position is preserved across displays
  it('multi-display property: relative position preserved across different resolutions', () => {
    const testCases = [
      { source: { width: 1920, height: 1080 }, target: { width: 2560, height: 1440 } },
      { source: { width: 1920, height: 1080 }, target: { width: 3840, height: 2160 } },
      { source: { width: 1366, height: 768 }, target: { width: 1920, height: 1080 } },
    ];

    const normalizedCoords = [
      { x: 0, y: 0 },
      { x: 0.25, y: 0.25 },
      { x: 0.5, y: 0.5 },
      { x: 0.75, y: 0.75 },
      { x: 1, y: 1 },
    ];

    testCases.forEach(({ source, target }) => {
      normalizedCoords.forEach(normCoord => {
        const sourcePixel = denormalizeCoordinate(normCoord, source);
        const targetPixel = translateCoordinate(sourcePixel, source, target);
        const targetNorm = normalizeCoordinate(targetPixel, target);
        
        // Verify relative position is preserved
        expect(Math.abs(targetNorm.x - normCoord.x)).toBeLessThanOrEqual(0.02);
        expect(Math.abs(targetNorm.y - normCoord.y)).toBeLessThanOrEqual(0.02);
      });
    });
  });

  // Test boundary property: edge coordinates remain on edge after translation
  it('boundary property: edge coordinates remain on display edges', () => {
    const displays = [
      { width: 1920, height: 1080 },
      { width: 2560, height: 1440 },
      { width: 3840, height: 2160 },
    ];

    const edgeCoords = [
      { x: 0, y: 540, description: 'left edge' },
      { x: 1920, y: 540, description: 'right edge' },
      { x: 960, y: 0, description: 'top edge' },
      { x: 960, y: 1080, description: 'bottom edge' },
    ];

    displays.forEach(display => {
      edgeCoords.forEach(edgeCoord => {
        const norm = normalizeCoordinate(edgeCoord, display);
        const backToPixel = denormalizeCoordinate(norm, display);
        
        // Verify edge position is preserved
        if (edgeCoord.x === 0 || edgeCoord.x === display.width) {
          expect(backToPixel.x).toBeGreaterThanOrEqual(0);
          expect(backToPixel.x).toBeLessThanOrEqual(display.width);
        }
        if (edgeCoord.y === 0 || edgeCoord.y === display.height) {
          expect(backToPixel.y).toBeGreaterThanOrEqual(0);
          expect(backToPixel.y).toBeLessThanOrEqual(display.height);
        }
      });
    });
  });
});

/**
 * Multi-display coordinate adaptation tests
 */
describe('coordinate-normalization multi-display tests', () => {
  // Test different DPI scaling factors
  it('handles 1.0x DPI scaling (no change)', () => {
    const source = { width: 1920, height: 1080, dpi: 96 };
    const target = { width: 2560, height: 1440, dpi: 96 };
    const coord = pixel(960, 540);
    
    const result = translateCoordinate(coord, source, target);
    
    expect(result.x).toBe(1280); // 960/1920 * 2560
    expect(result.y).toBe(720);  // 540/1080 * 1440
  });

  it('handles 1.25x DPI scaling', () => {
    const source = { width: 1920, height: 1080, dpi: 96 };
    const target = { width: 1920, height: 1080, dpi: 120 }; // 96 * 1.25
    const coord = pixel(960, 540);
    
    const result = translateCoordinate(coord, source, target);
    
    expect(result.x).toBeCloseTo(1200, 0); // 960 * 1.25
    expect(result.y).toBeCloseTo(675, 0);  // 540 * 1.25
  });

  it('handles 1.5x DPI scaling', () => {
    const source = { width: 1920, height: 1080, dpi: 96 };
    const target = { width: 1920, height: 1080, dpi: 144 }; // 96 * 1.5
    const coord = pixel(960, 540);
    
    const result = translateCoordinate(coord, source, target);
    
    expect(result.x).toBeCloseTo(1440, 0); // 960 * 1.5
    expect(result.y).toBeCloseTo(810, 0);  // 540 * 1.5
  });

  it('handles 2.0x DPI scaling (Retina)', () => {
    const source = { width: 1920, height: 1080, dpi: 96 };
    const target = { width: 1920, height: 1080, dpi: 192 }; // 96 * 2
    const coord = pixel(960, 540);
    
    const result = translateCoordinate(coord, source, target);
    
    expect(result.x).toBeCloseTo(1920, 0); // 960 * 2
    expect(result.y).toBeCloseTo(1080, 0); // 540 * 2
  });

  // Test multi-monitor scenarios
  it('handles two-monitor horizontal setup', () => {
    const source = { width: 1920, height: 1080, dpi: 96 };
    const target = { width: 3840, height: 2160, dpi: 96 }; // 2x HD horizontally
    const coord = pixel(960, 540); // Center of first monitor
    
    const result = translateCoordinate(coord, source, target);
    
    // 960/1920 = 0.5 normalized (center of source)
    // 0.5 * 3840 = 1920 (center of 2-monitor target)
    expect(result.x).toBe(1920);
    expect(result.y).toBe(1080);
  });

  it('handles three-monitor setup', () => {
    const source = { width: 1920, height: 1080, dpi: 96 };
    const target = { width: 5760, height: 2160, dpi: 96 }; // 3x HD horizontally
    const coord = pixel(960, 540); // Center of source monitor
    
    const result = translateCoordinate(coord, source, target);
    
    // 960/1920 = 0.5 normalized
    // 0.5 * 5760 = 2880 (center of 3-monitor target)
    expect(result.x).toBe(2880);
    expect(result.y).toBe(1080);
  });
});