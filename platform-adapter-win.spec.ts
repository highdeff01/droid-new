import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WindowsPlatformAdapter } from './platform-adapter-win.js';

describe('WindowsPlatformAdapter', () => {
  let adapter: WindowsPlatformAdapter;
  let invokeNative: (action: string, values?: Record<string, unknown>) => Promise<string>;

  beforeEach(() => {
    invokeNative = vi.fn(async (action: string) => action === 'position' ? '{"x":0,"y":0}' : '"Foreground"');
    adapter = new WindowsPlatformAdapter(invokeNative);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('mouseClick', () => {
    it('moves to position and clicks', async () => {
      await expect(adapter.mouseClick(960, 540, 'left')).resolves.toBeUndefined();
      expect(invokeNative).toHaveBeenCalledWith('click', { x: 960, y: 540, button: 'left' });
    });

    it('validates coordinate bounds', async () => {
      await expect(adapter.mouseClick(-5000, 540, 'left')).rejects.toThrow();
      await expect(adapter.mouseClick(960, 20000, 'left')).rejects.toThrow();
    });

    it('throws on invalid coordinates', async () => {
      await expect(adapter.mouseClick(NaN, 540, 'left')).rejects.toThrow();
      await expect(adapter.mouseClick(960, Infinity, 'left')).rejects.toThrow();
    });
  });

  describe('mouseDoubleClick', () => {
    it('performs double click at position', async () => {
      await expect(adapter.mouseDoubleClick(960, 540)).resolves.toBeUndefined();
    });
  });

  describe('mouseDrag', () => {
    it('drags from start to end position', async () => {
      await expect(adapter.mouseDrag(100, 100, 500, 500)).resolves.toBeUndefined();
    });

    it('validates start position', async () => {
      await expect(adapter.mouseDrag(-5000, 100, 500, 500)).rejects.toThrow();
    });

    it('validates end position', async () => {
      await expect(adapter.mouseDrag(100, 100, 20000, 500)).rejects.toThrow();
    });
  });

  describe('mouseScroll', () => {
    it('scrolls at position', async () => {
      await expect(adapter.mouseScroll(960, 540, 5)).resolves.toBeUndefined();
    });

    it('scrolls down with positive delta', async () => {
      await expect(adapter.mouseScroll(960, 540, 10)).resolves.toBeUndefined();
    });

    it('scrolls up with negative delta', async () => {
      await expect(adapter.mouseScroll(960, 540, -10)).resolves.toBeUndefined();
    });
  });

  describe('keyPress', () => {
    it('sends simple key press', async () => {
      await expect(adapter.keyPress('a')).resolves.toBeUndefined();
    });

    it('sends key combination', async () => {
      await expect(adapter.keyPress('ctrl+c')).resolves.toBeUndefined();
    });

    it('sends multi-modifier combination', async () => {
      await expect(adapter.keyPress('ctrl+shift+esc')).resolves.toBeUndefined();
    });

    it('sends alt+tab', async () => {
      await expect(adapter.keyPress('alt+tab')).resolves.toBeUndefined();
    });

    it('sends win+d', async () => {
      await expect(adapter.keyPress('win+d')).resolves.toBeUndefined();
    });
  });

  describe('typeText', () => {
    it('types plain ASCII text', async () => {
      await expect(adapter.typeText('hello')).resolves.toBeUndefined();
    });

    it('types text with special characters', async () => {
      await expect(adapter.typeText('test@example.com')).resolves.toBeUndefined();
    });

    it('types empty string', async () => {
      await expect(adapter.typeText('')).resolves.toBeUndefined();
    });

    it('types single character', async () => {
      await expect(adapter.typeText('x')).resolves.toBeUndefined();
    });
  });

  describe('mouseMove', () => {
    it('moves mouse to position', async () => {
      await expect(adapter.mouseMove(500, 300)).resolves.toBeUndefined();
    });

    it('validates coordinates', async () => {
      await expect(adapter.mouseMove(-5000, 300)).rejects.toThrow();
    });
  });

  describe('getMousePosition', () => {
    it('returns current mouse position', async () => {
      const pos = await adapter.getMousePosition();
      expect(pos).toHaveProperty('x');
      expect(pos).toHaveProperty('y');
      expect(typeof pos.x).toBe('number');
      expect(typeof pos.y).toBe('number');
    });
  });

  describe('isAvailable', () => {
    it('reports adapter availability', async () => {
      const available = await adapter.isAvailable();
      expect(typeof available).toBe('boolean');
    });
  });

  describe('integration scenarios', () => {
    it('can perform click sequence', async () => {
      await adapter.mouseClick(100, 100);
      await adapter.mouseClick(200, 200);
      await adapter.mouseClick(300, 300);
      expect(invokeNative).toHaveBeenCalledTimes(3);
    });

    it('can perform drag and click', async () => {
      await adapter.mouseDrag(100, 100, 300, 300);
      await adapter.mouseClick(500, 500);
    });

    it('can type and press keys', async () => {
      await adapter.typeText('password');
      await adapter.keyPress('enter');
      expect(invokeNative).toHaveBeenNthCalledWith(1, 'type', { text: 'password' });
      expect(invokeNative).toHaveBeenNthCalledWith(2, 'keyPress', { combo: 'enter' });
    });
  });
});
