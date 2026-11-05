import type { PlatformAdapter } from './platform-adapter.js';

/** Native macOS input is not part of this Windows-only desktop build. */
export class MacPlatformAdapter implements PlatformAdapter {
  async mouseMove(_x: number, _y: number): Promise<void> { throw this.unsupported(); }
  async mouseClick(_x: number, _y: number, _button: 'left' | 'right' | 'middle' = 'left'): Promise<void> { throw this.unsupported(); }
  async mouseDoubleClick(_x: number, _y: number): Promise<void> { throw this.unsupported(); }
  async mouseDrag(_startX: number, _startY: number, _endX: number, _endY: number): Promise<void> { throw this.unsupported(); }
  async mouseScroll(_x: number, _y: number, _deltaY: number): Promise<void> { throw this.unsupported(); }
  async mouseRelease(_button?: 'left' | 'right' | 'middle'): Promise<void> { throw this.unsupported(); }
  async keyPress(_keyCombo: string): Promise<void> { throw this.unsupported(); }
  async keyRelease(_keyCombo: string): Promise<void> { throw this.unsupported(); }
  async typeText(_text: string): Promise<void> { throw this.unsupported(); }
  async getMousePosition(): Promise<{ x: number; y: number }> { throw this.unsupported(); }
  async getActiveWindow(): Promise<string> { throw this.unsupported(); }
  async isAvailable(): Promise<boolean> { return false; }

  private unsupported(): Error {
    return new Error('Native macOS input is unsupported by this build; use the Droid desktop bridge instead.');
  }
}

export function getMacAdapter(): MacPlatformAdapter {
  return new MacPlatformAdapter();
}
