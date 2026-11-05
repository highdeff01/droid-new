/**
 * Platform-specific input dispatch interface.
 * Abstracts OS-level mouse and keyboard operations for supported desktop builds.
 */

import { WindowsPlatformAdapter } from './platform-adapter-win.js';

export interface PlatformAdapter {
  // Mouse operations
  mouseMove(x: number, y: number): Promise<void>;
  mouseClick(x: number, y: number, button?: 'left' | 'right' | 'middle'): Promise<void>;
  mouseDoubleClick(x: number, y: number): Promise<void>;
  mouseDrag(startX: number, startY: number, endX: number, endY: number): Promise<void>;
  mouseScroll(x: number, y: number, deltaY: number): Promise<void>;
  mouseRelease(button?: 'left' | 'right' | 'middle'): Promise<void>;

  // Keyboard operations
  keyPress(keyCombo: string): Promise<void>;
  keyRelease(keyCombo: string): Promise<void>;
  typeText(text: string): Promise<void>;

  // State queries
  getMousePosition(): Promise<{ x: number; y: number }>;
  getActiveWindow(): Promise<string>;
  isAvailable(): Promise<boolean>;
}

/** Get the native adapter for the supported Windows desktop build. */
export function getPlatformAdapter(): PlatformAdapter {
  if (process.platform === 'win32') {
    return new WindowsPlatformAdapter();
  }
  throw new Error(`Native input is only supported by the Windows desktop build (current platform: ${process.platform}); use the Droid desktop bridge instead.`);
}
