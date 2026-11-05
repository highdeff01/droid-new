import type { WorkflowStep } from './types.js';

/**
 * Information about a display/monitor.
 */
export interface DisplayInfo {
  index: number;
  name: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  isPrimary: boolean;
}

let runtimeDisplays: DisplayInfo[] | undefined;
let runtimeDisplayVersion = 0;

/** Update coordinate translation with the current geometry reported by the host desktop. */
export function setRuntimeDisplayInfo(displays: DisplayInfo[]): void {
  runtimeDisplays = displays.map((display) => ({ ...display }));
  runtimeDisplayVersion++;
}

/**
 * Result of coordinate translation from normalized to pixel coordinates.
 */
export interface CoordinateTranslationResult {
  correctedX: number;
  correctedY: number;
  displayIndex: number;
  pixelX: number;
  pixelY: number;
}

/**
 * Translates normalized (0..1) screen coordinates to actual pixel coordinates,
 * handling multi-monitor setups and display caching.
 */
export class CoordinateTranslator {
  private displayCache: DisplayInfo[] | null = null;
  private displayCacheTime = 0;
  private displayCacheVersion = -1;
  private readonly displayCacheTTL = 5000; // 5 seconds

  constructor(private readonly displayProvider: () => DisplayInfo[] = () => runtimeDisplays ?? [{
    index: 0, name: 'Primary Display', width: 1920, height: 1080, offsetX: 0, offsetY: 0, isPrimary: true,
  }]) {}

  /**
   * Get current display configuration with caching (5 second TTL).
   * Queries OS for actual displays once per TTL period.
   */
  getDisplayInfo(): DisplayInfo[] {
    const now = Date.now();
    if (this.displayCache && this.displayCacheVersion === runtimeDisplayVersion && now - this.displayCacheTime < this.displayCacheTTL) {
      return this.displayCache;
    }

    this.displayCache = this.queryDisplays();
    this.displayCacheTime = now;
    this.displayCacheVersion = runtimeDisplayVersion;
    return this.displayCache;
  }

  /**
   * Retrieve the display configuration supplied by the hosting platform.
   */
  private queryDisplays(): DisplayInfo[] {
    const displays = this.displayProvider();
    if (!displays.length) throw new Error('No displays are available for coordinate translation');
    return displays;
  }

  /**
   * Invalidate the display cache (call when detecting screen changes).
   */
  invalidateCache(): void {
    this.displayCache = null;
    this.displayCacheTime = 0;
    this.displayCacheVersion = -1;
  }

  /**
   * Convert normalized (0..1) coordinates to pixel coordinates.
   * Clamps input to valid range and applies display offset.
   * @param x Normalized X (0=left, 1=right)
   * @param y Normalized Y (0=top, 1=bottom)
   * @param displayIndex Which display to use (default: 0=primary)
   * @returns Pixel coordinates {px, py}
   */
  normalizedToPixels(x: number, y: number, displayIndex = 0, displays = this.getDisplayInfo()): { px: number; py: number } {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError(`Invalid normalized coordinates: (${x}, ${y})`);
    // Clamp to valid range [0, 1]
    const clampedX = Math.max(0, Math.min(1, x));
    const clampedY = Math.max(0, Math.min(1, y));

    const display = this.selectDisplay(displays, displayIndex);

    // Apply display offset and scale by display dimensions
    const px = display.offsetX + clampedX * display.width;
    const py = display.offsetY + clampedY * display.height;

    return { px, py };
  }

  /**
   * Convert pixel coordinates back to normalized (0..1) coordinates (inverse).
   * Useful for drift correction and verification.
   * @param px Pixel X coordinate
   * @param py Pixel Y coordinate
   * @param displayIndex Which display (default: 0=primary)
   * @returns Normalized coordinates {x, y}
   */
  pixelsToNormalized(px: number, py: number, displayIndex = 0, displays = this.getDisplayInfo()): { x: number; y: number } {
    const display = this.selectDisplay(displays, displayIndex);
    if (!Number.isFinite(px) || !Number.isFinite(py)) throw new RangeError(`Invalid pixel coordinates: (${px}, ${py})`);
    if (display.width <= 0 || display.height <= 0) throw new RangeError(`Invalid display dimensions: ${display.width}×${display.height}`);

    // Reverse the transformation
    const x = (px - display.offsetX) / display.width;
    const y = (py - display.offsetY) / display.height;

    return { x, y };
  }

  /**
   * Translate a workflow step's normalized coordinates to pixel coordinates.
   * Updates step with correctedX/correctedY pixel values.
   * @param step WorkflowStep with normalized x,y
   * @param displayInfo Optional DisplayInfo array (will query OS if not provided)
   * @returns Updated step with correctedX/correctedY set
   */
  translateCoordinates(step: WorkflowStep, displayInfo?: DisplayInfo[]): WorkflowStep {
    const displays = displayInfo || this.getDisplayInfo();
    const displayIndex = step.displayIndex ?? 0;

    // Translate normalized coordinates to pixels
    const { px, py } = this.normalizedToPixels(step.x, step.y, displayIndex, displays);

    return {
      ...step,
      correctedX: px,
      correctedY: py,
    };
  }

  /**
   * Get the primary display.
   */
  getPrimaryDisplay(): DisplayInfo {
    const displays = this.getDisplayInfo();
    return displays.find(d => d.isPrimary) || displays[0];
  }

  /**
   * Get a display by index.
   */
  getDisplay(index: number): DisplayInfo | null {
    const displays = this.getDisplayInfo();
    return displays.find((display) => display.index === index) ?? null;
  }

  private selectDisplay(displays: DisplayInfo[], index: number): DisplayInfo {
    if (!displays.length) throw new Error('No displays are available for coordinate translation');
    return displays.find((display) => display.index === index) ?? displays.find((display) => display.isPrimary) ?? displays[0];
  }
}
