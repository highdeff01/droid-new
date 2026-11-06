/**
 * Coordinate Normalization Utilities for Complete Automation Engine
 * Provides coordinate normalization/denormalization functions with clamping and DPI handling.
 * 
 * Requirements: 1.6, 2.3, 9.6, 9.7, 9.8
 */

import type { DisplayState } from './integration-types';

/** Normalized coordinate in [0, 1] range */
export interface NormalizedCoordinate {
  x: number;
  y: number;
}

/** Pixel coordinate in screen space */
export interface PixelCoordinate {
  x: number;
  y: number;
}

/**
 * Normalizes screen pixel coordinates to [0, 1] range based on display resolution.
 * Clamps values to ensure they stay within valid range.
 * 
 * @param coord - Pixel coordinate to normalize
 * @param display - Display resolution information
 * @returns Normalized coordinate [0, 1]
 */
export function normalizeCoordinate(
  coord: PixelCoordinate,
  display: DisplayState
): NormalizedCoordinate {
  const x = coord.x / display.width;
  const y = coord.y / display.height;
  
  // Clamp to [0, 1] range to handle coordinates outside display bounds
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
  };
}

/**
 * Denormalizes [0, 1] coordinates to pixel coordinates on a specific display.
 * 
 * @param norm - Normalized coordinate [0, 1]
 * @param display - Target display resolution
 * @returns Pixel coordinate on target display
 */
export function denormalizeCoordinate(
  norm: NormalizedCoordinate,
  display: DisplayState
): PixelCoordinate {
  return {
    x: Math.round(norm.x * display.width),
    y: Math.round(norm.y * display.height),
  };
}

/**
 * Applies DPI scaling factor to coordinates.
 * 
 * @param coord - Pixel coordinate
 * @param sourceDpi - Source DPI
 * @param targetDpi - Target DPI
 * @returns DPI-adjusted coordinate
 */
export function applyDpiScaling(
  coord: PixelCoordinate,
  sourceDpi: number,
  targetDpi: number
): PixelCoordinate {
  if (sourceDpi === targetDpi || sourceDpi === 0) {
    return coord;
  }
  
  const scaleFactor = targetDpi / sourceDpi;
  return {
    x: Math.round(coord.x * scaleFactor),
    y: Math.round(coord.y * scaleFactor),
  };
}

/**
 * Transforms coordinate from one display to another with DPI scaling.
 * 
 * @param coord - Pixel coordinate on source display
 * @param sourceDisplay - Source display state
 * @param targetDisplay - Target display state
 * @returns Translated pixel coordinate on target display
 */
export function translateCoordinate(
  coord: PixelCoordinate,
  sourceDisplay: DisplayState,
  targetDisplay: DisplayState
): PixelCoordinate {
  // Step 1: Normalize from source display
  const normalized = normalizeCoordinate(coord, sourceDisplay);
  
  // Step 2: Handle DPI scaling if different
  const sourceDpi = sourceDisplay.dpi ?? 96;
  const targetDpi = targetDisplay.dpi ?? 96;
  
  if (sourceDpi !== targetDpi) {
    // Convert normalized coordinates to pixels at target display resolution
    // Then apply DPI scaling
    const pixelAtTargetResolution = denormalizeCoordinate(normalized, targetDisplay);
    const scaled = applyDpiScaling(pixelAtTargetResolution, sourceDpi, targetDpi);
    return scaled;
  }
  
  // Step 3: Denormalize to target display
  return denormalizeCoordinate(normalized, targetDisplay);
}

/**
 * Calculates the DPI scaling factor between two displays.
 * 
 * @param sourceDisplay - Source display state
 * @param targetDisplay - Target display state
 * @returns DPI scaling factor
 */
export function calculateDpiScaleFactor(
  sourceDisplay: DisplayState,
  targetDisplay: DisplayState
): number {
  const sourceDpi = sourceDisplay.dpi ?? 96;
  const targetDpi = targetDisplay.dpi ?? 96;
  
  if (sourceDpi === 0) return 1.0;
  return targetDpi / sourceDpi;
}

/**
 * Validates that a normalized coordinate is within [0, 1] range.
 * 
 * @param coord - Normalized coordinate to validate
 * @returns true if coordinate is valid
 */
export function isValidNormalizedCoordinate(coord: NormalizedCoordinate): boolean {
  return (
    typeof coord.x === 'number' &&
    typeof coord.y === 'number' &&
    coord.x >= 0 &&
    coord.x <= 1 &&
    coord.y >= 0 &&
    coord.y <= 1
  );
}

/**
 * Clamps a pixel coordinate to display bounds.
 * 
 * @param coord - Coordinate to clamp
 * @param display - Display bounds
 * @returns Clamped coordinate
 */
export function clampToDisplayBounds(
  coord: PixelCoordinate,
  display: DisplayState
): PixelCoordinate {
  return {
    x: Math.max(0, Math.min(display.width, coord.x)),
    y: Math.max(0, Math.min(display.height, coord.y)),
  };
}

/**
 * Rounds normalized coordinates to a specific precision.
 * Useful for testing and comparison.
 * 
 * @param coord - Normalized coordinate
 * @param precision - Number of decimal places (default: 4)
 * @returns Rounded normalized coordinate
 */
export function roundNormalizedCoordinate(
  coord: NormalizedCoordinate,
  precision: number = 4
): NormalizedCoordinate {
  const factor = Math.pow(10, precision);
  return {
    x: Math.round(coord.x * factor) / factor,
    y: Math.round(coord.y * factor) / factor,
  };
}

/**
 * Calculates the Euclidean distance between two normalized coordinates.
 * 
 * @param from - Source coordinate [0, 1]
 * @param to - Target coordinate [0, 1]
 * @returns Distance (0..1.414 for unit square)
 */
export function normalizedDistance(
  from: NormalizedCoordinate,
  to: NormalizedCoordinate
): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Transforms multiple coordinates at once for batch processing.
 * 
 * @param coords - Array of pixel coordinates
 * @param sourceDisplay - Source display
 * @param targetDisplay - Target display
 * @returns Array of translated pixel coordinates
 */
export function batchTranslateCoordinates(
  coords: PixelCoordinate[],
  sourceDisplay: DisplayState,
  targetDisplay: DisplayState
): PixelCoordinate[] {
  return coords.map(coord => translateCoordinate(coord, sourceDisplay, targetDisplay));
}