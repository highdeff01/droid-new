/**
 * Multi-Display Manager - Coordinate Translation for Deployment
 * Handles multi-display scenarios, display detection, and coordinate mapping across displays.
 *
 * **Validates: Requirements 9.6, 9.7, 9.8, 42.1, 42.2**
 */

import type { DisplayInfo, NormalizedCoord, PixelCoord, TranslatedCoord, CoordinateContext } from './coordinate-translation.js';

/**
 * Detected multi-display environment configuration.
 */
export interface MultiDisplayEnvironment {
  displays: DisplayInfo[];
  primaryDisplay: DisplayInfo | null;
  totalDisplays: number;
  totalWidth: number;
  totalHeight: number;
  arrangement: 'linear' | 'grid' | 'unknown';
}

/**
 * Display mapping for cross-platform coordinate translation.
 */
export interface DisplayMapping {
  displayId: string;
  sourceDisplay: DisplayInfo;
  targetDisplay: DisplayInfo;
  offset: { x: number; y: number };
  scaleFactor: number;
  confidence: number;
}

/**
 * Multi-display scenario configuration.
 */
export interface MultiDisplayScenario {
  mode: 'single' | 'extended' | 'mirrored' | 'duplicated';
  activeDisplays: number;
  primaryDisplayIndex: number;
  displayLayout: DisplayInfo[];
}

/**
 * Cross-platform adaptation config for Windows/Mac/Linux.
 */
export interface PlatformAdaptationConfig {
  platform: 'windows' | 'mac' | 'linux';
  dpiScalingEnabled: boolean;
  perMonitorDpi: boolean; // Windows 10 v1607+
  fractionalScaling: boolean;
  displayScalingFactor: number;
}

/**
 * Multi-display manager that detects, tracks, and maps displays for coordinate translation.
 *
 * Responsibilities:
 * - Detect active displays and their layout
 * - Handle display changes (add/remove/resize)
 * - Map coordinates across displays
 * - Support cross-platform display adaptation
 * - Provide fallback strategies for display detection failures
 */
export class MultiDisplayManager {
  private environment: MultiDisplayEnvironment | null = null;
  private lastDetectionTime = 0;
  private readonly detectionThreshold = 5000; // Re-detect displays every 5 seconds

  constructor(
    private readonly displayDetector?: () => DisplayInfo[]
  ) {}

  /**
   * Detect current multi-display environment.
   * Returns cached result if recently detected (within threshold).
   */
  getEnvironment(): MultiDisplayEnvironment {
    const now = Date.now();
    if (this.environment && now - this.lastDetectionTime < this.detectionThreshold) {
      return this.environment;
    }

    this.environment = this.detectEnvironment();
    this.lastDetectionTime = now;
    return this.environment;
  }

  /**
   * Force re-detection of display environment.
   * Call this when display configuration may have changed (e.g., monitor connected/disconnected).
   */
  forceRecompute(): void {
    this.environment = null;
    this.lastDetectionTime = 0;
  }

  /**
   * Detect and compute multi-display environment.
   */
  private detectEnvironment(): MultiDisplayEnvironment {
    const rawDisplays = this.displayDetector?.() ?? this.getDefaultDisplays();

    if (rawDisplays.length === 0) {
      // Fallback: assume single display
      return {
        displays: [this.getDefaultDisplay(0)],
        primaryDisplay: this.getDefaultDisplay(0),
        totalDisplays: 1,
        totalWidth: 1920,
        totalHeight: 1080,
        arrangement: 'linear',
      };
    }

    // Sort displays by position (left-to-right for linear, top-to-bottom for vertical)
    const sortedDisplays = [...rawDisplays].sort((a, b) => {
      const offsetXA = a.offsetX ?? 0;
      const offsetXB = b.offsetX ?? 0;
      if (offsetXA !== offsetXB) {
        return offsetXA - offsetXB;
      }
      const offsetYA = a.offsetY ?? 0;
      const offsetYB = b.offsetY ?? 0;
      return offsetYA - offsetYB;
    });

    // Calculate total canvas size
    let totalWidth = 0;
    let totalHeight = 0;

    sortedDisplays.forEach((display) => {
      const displayOffsetX = display.offsetX ?? 0;
      const displayOffsetY = display.offsetY ?? 0;
      totalWidth = Math.max(totalWidth, displayOffsetX + display.width);
      totalHeight = Math.max(totalHeight, displayOffsetY + display.height);
    });

    // Determine arrangement
    const arrangement = this.determineArrangement(sortedDisplays);

    // Find primary display
    const primaryDisplay = sortedDisplays.find((d) => d.isPrimary) ?? sortedDisplays[0];

    return {
      displays: sortedDisplays,
      primaryDisplay,
      totalDisplays: sortedDisplays.length,
      totalWidth,
      totalHeight,
      arrangement,
    };
  }

  /**
   * Determine display arrangement type.
   */
  private determineArrangement(displays: DisplayInfo[]): 'linear' | 'grid' | 'unknown' {
    if (displays.length <= 1) {
      return 'linear';
    }

    // Check if all displays are aligned on the same horizontal or vertical axis
    const xValues = new Set(displays.map((d) => d.offsetX));
    const yValues = new Set(displays.map((d) => d.offsetY));

    if (xValues.size === 1) {
      // All displays have same X offset → vertical linear arrangement
      return 'linear';
    } else if (yValues.size === 1) {
      // All displays have same Y offset → horizontal linear arrangement
      return 'linear';
    }

    // Multiple unique X and Y values → grid arrangement
    if (xValues.size > 1 && yValues.size > 1) {
      return 'grid';
    }

    return 'unknown';
  }

  /**
   * Map normalized coordinates to a specific display in the multi-display environment.
   */
  mapNormalizedToDisplay(
    normalized: NormalizedCoord,
    displayIndex: number
  ): { x: number; y: number; display: DisplayInfo } | null {
    const environment = this.getEnvironment();

    if (displayIndex < 0 || displayIndex >= environment.displays.length) {
      return null;
    }

    const display = environment.displays[displayIndex];
    const offsetX = display.offsetX ?? 0;
    const offsetY = display.offsetY ?? 0;

    return {
      x: normalized.x * display.width + offsetX,
      y: normalized.y * display.height + offsetY,
      display,
    };
  }

  /**
   * Map pixel coordinates to normalized coordinates on the appropriate display.
   */
  mapPixelToNormalized(pixelX: number, pixelY: number): { x: number; y: number; displayIndex: number } | null {
    const environment = this.getEnvironment();

    for (let i = 0; i < environment.displays.length; i++) {
      const display = environment.displays[i];
      const offsetX = display.offsetX ?? 0;
      const offsetY = display.offsetY ?? 0;
      if (
        pixelX >= offsetX &&
        pixelX < offsetX + display.width &&
        pixelY >= offsetY &&
        pixelY < offsetY + display.height
      ) {
        return {
          x: (pixelX - offsetX) / display.width,
          y: (pixelY - offsetY) / display.height,
          displayIndex: i,
        };
      }
    }

    // Fallback: return coordinates clamped to primary display
    const primary = environment.primaryDisplay ?? environment.displays[0];
    const primaryOffsetX = primary.offsetX ?? 0;
    const primaryOffsetY = primary.offsetY ?? 0;
    return {
      x: Math.max(0, Math.min(1, (pixelX - primaryOffsetX) / primary.width)),
      y: Math.max(0, Math.min(1, (pixelY - primaryOffsetY) / primary.height)),
      displayIndex: 0,
    };
  }

  /**
   * Get all active displays with their offsets.
   */
  getActiveDisplays(): DisplayInfo[] {
    return this.getEnvironment().displays;
  }

  /**
   * Get display by index.
   */
  getDisplay(index: number): DisplayInfo | null {
    const environment = this.getEnvironment();
    return environment.displays[index] ?? null;
  }

  /**
   * Get primary display.
   */
  getPrimaryDisplay(): DisplayInfo | null {
    return this.getEnvironment().primaryDisplay ?? null;
  }

  /**
   * Get the display index that contains the given pixel coordinates.
   */
  getDisplayIndexAtCoords(pixelX: number, pixelY: number): number {
    const environment = this.getEnvironment();

    for (let i = 0; i < environment.displays.length; i++) {
      const display = environment.displays[i];
      const offsetX = display.offsetX ?? 0;
      const offsetY = display.offsetY ?? 0;
      if (
        pixelX >= offsetX &&
        pixelX < offsetX + display.width &&
        pixelY >= offsetY &&
        pixelY < offsetY + display.height
      ) {
        return i;
      }
    }

    // Fallback: return primary display index
    return environment.displays.indexOf(environment.primaryDisplay ?? environment.displays[0]);
  }

  /**
   * Check if the coordinate system supports fractional scaling.
   */
  supportsFractionalScaling(): boolean {
    // Modern Windows (10 v1607+), macOS, and Linux with Wayland support fractional scaling
    const platform = this.getPlatform();
    return platform === 'mac' || platform === 'linux' || this.isWindows10OrLater();
  }

  /**
   * Get platform-specific display scaling factor.
   */
  getPlatformDisplayScaleFactor(): number {
    const platform = this.getPlatform();
    const environment = this.getEnvironment();
    const primary = environment.primaryDisplay;

    if (!primary) return 1.0;

    // Platform-specific scaling logic
    switch (platform) {
      case 'windows':
        // Windows uses DPI scaling (96 = 100%, 120 = 125%, 144 = 150%, etc.)
        return primary.dpi ? primary.dpi / 96 : 1.0;
      case 'mac':
        // macOS uses devicePixelRatio (typically 2.0 for Retina)
        return typeof window !== 'undefined' ? window.devicePixelRatio || 2.0 : 2.0;
      case 'linux':
        // Linux varies - use display scale factor if available
        return primary.scaleFactor ?? 1.0;
      default:
        return 1.0;
    }
  }

  /**
   * Get current platform.
   */
  getPlatform(): 'windows' | 'mac' | 'linux' | 'unknown' {
    if (typeof navigator === 'undefined') {
      return 'unknown';
    }

    const userAgent = navigator.userAgent.toLowerCase();

    if (userAgent.includes('win')) {
      return 'windows';
    } else if (userAgent.includes('mac')) {
      return 'mac';
    } else if (userAgent.includes('linux')) {
      return 'linux';
    }

    return 'unknown';
  }

  /**
   * Check if running on Windows 10 or later.
   */
  private isWindows10OrLater(): boolean {
    if (typeof navigator === 'undefined') return false;
    const userAgent = navigator.userAgent;
    return /Windows NT 10\./.test(userAgent);
  }

  /**
   * Create coordinate translation context for deployment.
   */
  createTranslationContext(
    sourceDisplay: DisplayInfo,
    targetDisplay: DisplayInfo,
    mode: 'direct' | 'scaled' | 'adaptive' = 'adaptive'
  ): CoordinateContext {
    const environment = this.getEnvironment();
    const primary = environment.primaryDisplay ?? environment.displays[0];

    // Calculate offset for multi-display scenarios
    const offsetX = (targetDisplay.offsetX ?? 0) - (sourceDisplay.offsetX ?? 0);
    const offsetY = (targetDisplay.offsetY ?? 0) - (sourceDisplay.offsetY ?? 0);

    // Calculate scale factor
    let scaleFactor = this.calculateScaleFactor(sourceDisplay, targetDisplay);

    // Adjust for platform-specific scaling
    const platformScale = this.getPlatformDisplayScaleFactor();
    if (platformScale !== 1.0) {
      scaleFactor *= platformScale;
    }

    return {
      sourceDisplay,
      targetDisplay,
      adaptationMode: mode,
      scaleFactor,
      offsetX,
      offsetY,
    };
  }

  /**
   * Calculate scale factor between displays, accounting for DPI and scaling.
   */
  private calculateScaleFactor(source: DisplayInfo, target: DisplayInfo): number {
    // Use OS-level scale factors if available (highest priority)
    if (source.scaleFactor && target.scaleFactor && source.scaleFactor !== 0) {
      return target.scaleFactor / source.scaleFactor;
    }

    // Use DPI-aware scaling if available and different
    if (source.dpi && target.dpi && source.dpi !== 0) {
      return target.dpi / source.dpi;
    }

    // Calculate based on diagonal dimensions (preserves aspect ratio)
    const sourceDiag = Math.hypot(source.width, source.height);
    const targetDiag = Math.hypot(target.width, target.height);

    if (sourceDiag === 0) return 1.0;
    return targetDiag / sourceDiag;
  }

  /**
   * Get display mapping for cross-display coordinate translation.
   */
  getDisplayMapping(sourceIndex: number, targetIndex: number): DisplayMapping | null {
    const environment = this.getEnvironment();

    if (
      sourceIndex < 0 ||
      sourceIndex >= environment.displays.length ||
      targetIndex < 0 ||
      targetIndex >= environment.displays.length
    ) {
      return null;
    }

    const sourceDisplay = environment.displays[sourceIndex];
    const targetDisplay = environment.displays[targetIndex];

    // Calculate offset between displays
    const offsetX = (targetDisplay.offsetX ?? 0) - (sourceDisplay.offsetX ?? 0);
    const offsetY = (targetDisplay.offsetY ?? 0) - (sourceDisplay.offsetY ?? 0);

    // Calculate scale factor
    const scaleFactor = this.calculateScaleFactor(sourceDisplay, targetDisplay);

    // Calculate confidence based on display similarity
    const confidence = this.calculateConfidence(sourceDisplay, targetDisplay, scaleFactor);

    return {
      displayId: `map-${sourceIndex}-${targetIndex}`,
      sourceDisplay,
      targetDisplay,
      offset: { x: offsetX, y: offsetY },
      scaleFactor,
      confidence,
    };
  }

  /**
   * Calculate confidence in coordinate translation between displays.
   */
  private calculateConfidence(source: DisplayInfo, target: DisplayInfo, scaleFactor: number): number {
    // Perfect match: 100% confidence
    if (
      source.width === target.width &&
      source.height === target.height &&
      source.dpi === target.dpi &&
      source.scaleFactor === target.scaleFactor
    ) {
      return 1.0;
    }

    // Calculate aspect ratio difference
    const sourceAspect = source.width / source.height;
    const targetAspect = target.width / target.height;
    const aspectDiff = Math.abs(sourceAspect - targetAspect) / sourceAspect;

    // Calculate DPI difference
    let dpiDiff = 0;
    if (source.dpi && target.dpi) {
      dpiDiff = Math.abs(source.dpi - target.dpi) / source.dpi;
    }

    // Calculate scale penalty
    const scalePenalty = Math.min(0.4, Math.abs(scaleFactor - 1.0));

    // Calculate confidence
    const aspectPenalty = Math.min(0.3, aspectDiff * 2);
    const dpiPenalty = Math.min(0.3, dpiDiff);

    return Math.max(0.2, 1.0 - aspectPenalty - dpiPenalty - scalePenalty);
  }

  /**
   * Get default displays for testing or when detection fails.
   */
  private getDefaultDisplays(): DisplayInfo[] {
    return [this.getDefaultDisplay(0)];
  }

  /**
   * Get default display info.
   */
  private getDefaultDisplay(index: number): DisplayInfo {
    return {
      index,
      name: `Display ${index + 1}`,
      width: 1920,
      height: 1080,
      offsetX: index * 1920,
      offsetY: 0,
      isPrimary: index === 0,
      dpi: 96,
      scaleFactor: 1.0,
    };
  }

  /**
   * Check if displays have significant differences that require warning.
   */
  hasSignificantDisplayDifferences(): boolean {
    const environment = this.getEnvironment();
    if (environment.displays.length <= 1) return false;

    const primary = environment.primaryDisplay ?? environment.displays[0];
    const otherDisplays = environment.displays.filter((d) => d !== primary);

    for (const display of otherDisplays) {
      const widthDiff = Math.abs(primary.width - display.width) / primary.width;
      const heightDiff = Math.abs(primary.height - display.height) / primary.height;

      if (widthDiff > 0.2 || heightDiff > 0.2) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get display scenario based on current environment.
   */
  getScenario(): MultiDisplayScenario {
    const environment = this.getEnvironment();
    const primaryIndex = environment.displays.indexOf(environment.primaryDisplay ?? environment.displays[0]);

    let mode: MultiDisplayScenario['mode'] = 'single';
    if (environment.totalDisplays > 1) {
      if (environment.arrangement === 'linear') {
        mode = 'extended';
      } else {
        mode = 'mirrored'; // Assume mirrored if not linear
      }
    }

    return {
      mode,
      activeDisplays: environment.totalDisplays,
      primaryDisplayIndex: primaryIndex,
      displayLayout: environment.displays,
    };
  }
}
