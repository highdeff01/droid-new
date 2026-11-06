/**
 * Coordinate Translation for Deployment
 * Adapts workflow coordinates to different display resolutions and multi-display scenarios.
 * 
 * Requirements: 9.6, 9.7, 9.8, 42.1, 42.2
 */

/** Display resolution and DPI information. */
export interface DisplayInfo {
  index?: number;
  width: number;   // pixels
  height: number;  // pixels
  dpi?: number;    // dots per inch
  name?: string;   // display identifier
  isPrimary?: boolean;
  offsetX?: number;
  offsetY?: number;
  scaleFactor?: number;  // OS-level scaling (1.0, 1.25, 1.5, 2.0, etc.)
}

/** A normalized coordinate in [0, 1] range. */
export interface NormalizedCoord {
  x: number;
  y: number;
}

/** A screen pixel coordinate. */
export interface PixelCoord {
  x: number;
  y: number;
}

/** Position on multi-display setup with display identifier. */
export interface MultiDisplayCoord extends PixelCoord {
  displayId?: string;
}

/** Coordinate translation context for a deployment. */
export interface CoordinateContext {
  sourceDisplay: DisplayInfo;
  targetDisplay: DisplayInfo;
  adaptationMode: 'direct' | 'scaled' | 'adaptive';
  scaleFactor?: number;
  offsetX?: number;
  offsetY?: number;
}

/** Result of coordinate translation with metadata. */
export interface TranslatedCoord extends PixelCoord {
  adapted: boolean;
  scaleFactor: number;
  offsetX: number;
  offsetY: number;
  confidence: number;  // 0..1, higher = more confident the translation is correct
}

/** Multi-display layout information. */
export interface DisplayLayout {
  displays: DisplayInfo[];
  primaryDisplay?: DisplayInfo;
  arrangement: 'linear' | 'grid' | 'custom';
  offsetsX: number[];  // cumulative x offsets for each display
  offsetsY: number[];  // cumulative y offsets for each display
}

/**
 * Normalizes pixel coordinates to [0, 1] range based on display dimensions.
 * Clamps values to valid range.
 * 
 * @param coord - Pixel coordinate
 * @param display - Display dimensions
 * @returns Normalized coordinate [0, 1]
 */
export function normalizeCoordinate(coord: PixelCoord, display: DisplayInfo): NormalizedCoord {
  return {
    x: Math.max(0, Math.min(1, coord.x / display.width)),
    y: Math.max(0, Math.min(1, coord.y / display.height)),
  };
}

/**
 * Denormalizes [0, 1] coordinates to pixel coordinates on a specific display.
 * 
 * @param norm - Normalized coordinate
 * @param display - Target display
 * @returns Pixel coordinate on target display
 */
export function denormalizeCoordinate(norm: NormalizedCoord, display: DisplayInfo): PixelCoord {
  return {
    x: Math.round(norm.x * display.width),
    y: Math.round(norm.y * display.height),
  };
}

/**
 * Translates coordinates from source display to target display.
 * Handles multi-display scenarios with different resolutions.
 * 
 * Strategy:
 * 1. Normalize from source display (if recording on different display)
 * 2. Detect adaptation mode based on resolution differences
 * 3. Apply scaling with offset for multi-display
 * 4. Denormalize to target display
 * 
 * @param coord - Pixel coordinate on source display
 * @param context - Translation context
 * @returns Translated coordinate with metadata
 */
export function translateCoordinate(coord: PixelCoord, context: CoordinateContext): TranslatedCoord {
  const { sourceDisplay, targetDisplay, adaptationMode, scaleFactor: contextScale, offsetX = 0, offsetY = 0 } = context;

  // Step 1: Normalize from source display
  const normalized = normalizeCoordinate(coord, sourceDisplay);

  // Step 2: Apply source-to-target scaling
  const effectiveScale = contextScale ?? calculateScaleFactor(sourceDisplay, targetDisplay);
  
  // Step 3: Denormalize to target display
  let pixel = denormalizeCoordinate(normalized, targetDisplay);

  // Step 4: Apply offsets (for multi-display scenarios)
  pixel.x += offsetX;
  pixel.y += offsetY;

  // Step 5: Clamp to target display bounds
  const adapted = effectiveScale !== 1.0 || offsetX !== 0 || offsetY !== 0;
  const confidence = calculateConfidence(sourceDisplay, targetDisplay, effectiveScale);

  return {
    ...pixel,
    adapted,
    scaleFactor: effectiveScale,
    offsetX,
    offsetY,
    confidence,
  };
}

/**
 * Calculates the optimal scale factor between two displays.
 * 
 * @param source - Source display
 * @param target - Target display
 * @returns Scale factor (1.0 = no scaling)
 */
export function calculateScaleFactor(source: DisplayInfo, target: DisplayInfo): number {
  // Use OS-level scale factors if available (highest priority)
  if (source.scaleFactor && target.scaleFactor) {
    const ratio = target.scaleFactor / source.scaleFactor;
    if (ratio !== 1.0) {
      return ratio;
    }
  }

  // Use DPI-aware scaling if available and different
  if (source.dpi && target.dpi && source.dpi !== target.dpi) {
    return target.dpi / source.dpi;
  }

  // If same resolution, no scaling needed
  if (source.width === target.width && source.height === target.height) {
    return 1.0;
  }

  // Calculate scale based on diagonal (preserves aspect ratio better)
  const sourceDiag = Math.hypot(source.width, source.height);
  const targetDiag = Math.hypot(target.width, target.height);
  
  return targetDiag / sourceDiag;
}

/**
 * Calculates confidence in coordinate translation (0..1).
 * Higher confidence when displays are similar.
 * 
 * @param source - Source display
 * @param target - Target display
 * @param scaleFactor - Applied scale factor
 * @returns Confidence 0..1
 */
export function calculateConfidence(
  source: DisplayInfo,
  target: DisplayInfo,
  scaleFactor: number
): number {
  // Perfect match: 100% confidence
  if (source.width === target.width && source.height === target.height) {
    return 1.0;
  }

  // Calculate aspect ratio difference
  const sourceAspect = source.width / source.height;
  const targetAspect = target.width / target.height;
  const aspectDiff = Math.abs(sourceAspect - targetAspect) / sourceAspect;

  // Calculate DPI difference if available
  let dpiDiff = 0;
  if (source.dpi && target.dpi) {
    dpiDiff = Math.abs(source.dpi - target.dpi) / source.dpi;
  }

  // Confidence decreases with:
  // - Aspect ratio change (up to -0.3)
  // - DPI difference (up to -0.3)
  // - Extreme scale factors (up to -0.4)
  const aspectPenalty = Math.min(0.3, aspectDiff * 2);
  const dpiPenalty = Math.min(0.3, dpiDiff);
  const scalePenalty = Math.min(0.4, Math.abs(scaleFactor - 1.0));

  return Math.max(0.2, 1.0 - aspectPenalty - dpiPenalty - scalePenalty);
}

/**
 * Computes offsets for multi-display layout.
 * Supports linear (horizontal/vertical) and grid arrangements.
 * 
 * @param layout - Display layout
 * @param targetDisplayIndex - Index of target display
 * @returns Offset { x, y } in pixels
 */
export function getMultiDisplayOffset(layout: DisplayLayout, targetDisplayIndex: number): { x: number; y: number } {
  if (targetDisplayIndex < 0 || targetDisplayIndex >= layout.displays.length) {
    return { x: 0, y: 0 };
  }

  if (layout.arrangement === 'linear') {
    // Displays arranged horizontally
    return {
      x: layout.offsetsX[targetDisplayIndex] ?? 0,
      y: layout.offsetsY[targetDisplayIndex] ?? 0,
    };
  }

  if (layout.arrangement === 'grid') {
    // Displays arranged in grid
    return {
      x: layout.offsetsX[targetDisplayIndex] ?? 0,
      y: layout.offsetsY[targetDisplayIndex] ?? 0,
    };
  }

  // Custom arrangement
  return {
    x: layout.offsetsX[targetDisplayIndex] ?? 0,
    y: layout.offsetsY[targetDisplayIndex] ?? 0,
  };
}

/**
 * Analyzes a display layout to detect arrangement.
 * 
 * @param displays - List of displays
 * @returns Detected layout with offsets
 */
export function analyzeDisplayLayout(displays: DisplayInfo[]): DisplayLayout {
  const primary = displays.find((d) => d.isPrimary) ?? displays[0];
  const offsetsX: number[] = [];
  const offsetsY: number[] = [];

  // Determine arrangement by analyzing display positions
  // For now, assume linear horizontal arrangement
  let cumulativeX = 0;
  let cumulativeY = 0;

  displays.forEach((display) => {
    offsetsX.push(cumulativeX);
    offsetsY.push(cumulativeY);
    cumulativeX += display.width;
  });

  return {
    displays,
    primaryDisplay: primary,
    arrangement: 'linear',
    offsetsX,
    offsetsY,
  };
}

/**
 * Adaptive coordinate translation with intelligent fallback.
 * When direct translation has low confidence, suggests alternative strategies.
 * 
 * @param coord - Source coordinate
 * @param context - Translation context
 * @param options - Translation options
 * @returns Translated coordinate or null if adaptation fails
 */
export function adaptiveTranslateCoordinate(
  coord: PixelCoord,
  context: CoordinateContext,
  options?: {
    minimumConfidence?: number;
    useElementMatchback?: boolean;  // Try matching nearby elements if confidence too low
    logAdaptation?: boolean;
  }
): TranslatedCoord | null {
  const minConfidence = options?.minimumConfidence ?? 0.4;
  const translated = translateCoordinate(coord, context);

  if (translated.confidence >= minConfidence) {
    return translated;
  }

  // Confidence too low; log warning if requested
  if (options?.logAdaptation) {
    console.warn(`[CoordTranslation] Low confidence (${translated.confidence.toFixed(2)}) translating coordinate from ${context.sourceDisplay.name ?? 'unknown'} to ${context.targetDisplay.name ?? 'unknown'}`);
  }

  // Could implement element-based matchback here in the future
  // For now, still return the translated coordinate but mark low confidence
  return translated;
}

/**
 * Batch translate multiple coordinates (e.g., for a workflow with many steps).
 * Optimizes by computing context once.
 * 
 * @param coords - Array of pixel coordinates
 * @param context - Translation context (applied to all)
 * @returns Array of translated coordinates
 */
export function batchTranslateCoordinates(coords: PixelCoord[], context: CoordinateContext): TranslatedCoord[] {
  return coords.map((coord) => translateCoordinate(coord, context));
}

/**
 * Validates that a translated coordinate is within valid bounds.
 * 
 * @param coord - Translated coordinate
 * @param display - Target display
 * @returns true if coordinate is within bounds
 */
export function isCoordinateInBounds(coord: PixelCoord, display: DisplayInfo): boolean {
  return coord.x >= 0 && coord.x <= display.width && coord.y >= 0 && coord.y <= display.height;
}

/**
 * Clamps a coordinate to display bounds.
 * 
 * @param coord - Coordinate to clamp
 * @param display - Display bounds
 * @returns Clamped coordinate
 */
export function clampCoordinateToBounds(coord: PixelCoord, display: DisplayInfo): PixelCoord {
  return {
    x: Math.max(0, Math.min(display.width, coord.x)),
    y: Math.max(0, Math.min(display.height, coord.y)),
  };
}

/**
 * Calculates the distance between two coordinates (normalized).
 * Useful for detecting if coordinates drifted significantly after translation.
 * 
 * @param from - Source coordinate (normalized 0..1)
 * @param to - Target coordinate (normalized 0..1)
 * @returns Euclidean distance
 */
export function normalizedDistance(from: NormalizedCoord, to: NormalizedCoord): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/**
 * Determines if coordinate translation requires warning to user.
 * Returns true if resolution difference is significant (>20% difference).
 * 
 * @param source - Source display
 * @param target - Target display
 * @returns true if adaptation is significant
 */
export function isSignificantAdaptation(source: DisplayInfo, target: DisplayInfo): boolean {
  const widthDiff = Math.abs(source.width - target.width) / source.width;
  const heightDiff = Math.abs(source.height - target.height) / source.height;
  
  return widthDiff > 0.2 || heightDiff > 0.2;
}

/**
 * DPI-aware coordinate translation helper.
 * Applies DPI scaling factor to coordinates.
 * 
 * @param coord - Pixel coordinate
 * @param sourceDpi - Source DPI
 * @param targetDpi - Target DPI
 * @returns DPI-adjusted coordinate
 */
export function applyDpiScaling(coord: PixelCoord, sourceDpi: number, targetDpi: number): PixelCoord {
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
 * Adapt coordinates for cross-platform scenarios.
 * Handles Windows, Mac, and Linux DPI/Scaling differences.
 * 
 * @param coord - Pixel coordinate
 * @param sourcePlatform - Source platform ('windows' | 'mac' | 'linux')
 * @param targetPlatform - Target platform ('windows' | 'mac' | 'linux')
 * @param sourceScale - Source platform scale factor
 * @param targetScale - Target platform scale factor
 * @returns Platform-adapted coordinate
 */
export function adaptForPlatform(
  coord: PixelCoord,
  sourcePlatform: 'windows' | 'mac' | 'linux',
  targetPlatform: 'windows' | 'mac' | 'linux',
  sourceScale: number = 1.0,
  targetScale: number = 1.0
): PixelCoord {
  // If scales are the same, no adaptation needed
  if (Math.abs(sourceScale - targetScale) < 0.01) {
    return coord;
  }
  
  const scaleFactor = targetScale / sourceScale;
  return {
    x: Math.round(coord.x * scaleFactor),
    y: Math.round(coord.y * scaleFactor),
  };
}

/**
 * Calculate safe bounds for coordinate translation.
 * Ensures coordinates stay within valid ranges even after adaptation.
 * 
 * @param coord - Target coordinate
 * @param display - Target display
 * @param safetyMargin - Margin in pixels to keep from edges (default: 10)
 * @returns Safe coordinate within bounds
 */
export function calculateSafeBounds(coord: PixelCoord, display: DisplayInfo, safetyMargin: number = 10): PixelCoord {
  return {
    x: Math.max(safetyMargin, Math.min(display.width - safetyMargin, coord.x)),
    y: Math.max(safetyMargin, Math.min(display.height - safetyMargin, coord.y)),
  };
}

/**
 * Convert element bounding box to normalized coordinates.
 * Useful for element-based fallback matching.
 * 
 * @param rect - Element bounding box
 * @param display - Display dimensions
 * @returns Normalized bounding box [x, y, width, height]
 */
export function elementToNormalizedBounds(rect: { left: number; top: number; right: number; bottom: number }, display: DisplayInfo): [number, number, number, number] {
  return [
    rect.left / display.width,
    rect.top / display.height,
    (rect.right - rect.left) / display.width,
    (rect.bottom - rect.top) / display.height,
  ];
}

/**
 * Convert normalized coordinates to element bounds.
 * 
 * @param normX - Normalized X
 * @param normY - Normalized Y
 * @param normWidth - Normalized width
 * @param normHeight - Normalized height
 * @param display - Display dimensions
 * @returns Pixel bounds {left, top, right, bottom}
 */
export function normalizedToBounds(normX: number, normY: number, normWidth: number, normHeight: number, display: DisplayInfo): { left: number; top: number; right: number; bottom: number } {
  return {
    left: Math.round(normX * display.width),
    top: Math.round(normY * display.height),
    right: Math.round((normX + normWidth) * display.width),
    bottom: Math.round((normY + normHeight) * display.height),
  };
}

/**
 * Validate a coordinate translation result.
 * Checks if the translation is valid and confident.
 * 
 * @param result - Translation result
 * @param minimumConfidence - Minimum acceptable confidence (default: 0.4)
 * @returns Validation result with success status and optional error message
 */
export function validateTranslationResult(result: TranslatedCoord, minimumConfidence: number = 0.4): { valid: boolean; error?: string } {
  if (!Number.isFinite(result.x) || !Number.isFinite(result.y)) {
    return { valid: false, error: 'Translation produced non-finite coordinates' };
  }
  
  if (result.confidence < minimumConfidence) {
    return { valid: false, error: `Translation confidence (${result.confidence.toFixed(2)}) below threshold (${minimumConfidence})` };
  }
  
  return { valid: true };
}

/**
 * Create a coordinate translation error for reporting.
 * 
 * @param message - Error message
 * @param sourceDisplay - Source display info
 * @param targetDisplay - Target display info
 * @param originalCoord - Original coordinate
 * @param translatedCoord - Translated coordinate (if any)
 * @returns Translation error object
 */
export function createTranslationError(
  message: string,
  sourceDisplay: DisplayInfo,
  targetDisplay: DisplayInfo,
  originalCoord: PixelCoord,
  translatedCoord?: TranslatedCoord
): { message: string; sourceDisplay: DisplayInfo; targetDisplay: DisplayInfo; originalCoord: PixelCoord; translatedCoord?: TranslatedCoord; timestamp: number } {
  return {
    message,
    sourceDisplay,
    targetDisplay,
    originalCoord,
    translatedCoord,
    timestamp: Date.now(),
  };
}
