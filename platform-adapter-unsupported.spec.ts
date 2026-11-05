import { describe, expect, it } from 'vitest';
import { LinuxPlatformAdapter } from './platform-adapter-linux.js';
import { MacPlatformAdapter } from './platform-adapter-mac.js';

describe('unsupported native platform adapters', () => {
  it.each([
    ['macOS', new MacPlatformAdapter()],
    ['Linux', new LinuxPlatformAdapter()],
  ])('reports %s native input as unavailable instead of succeeding silently', async (_platform, adapter) => {
    await expect(adapter.isAvailable()).resolves.toBe(false);
    await expect(adapter.mouseClick(10, 10)).rejects.toThrow('unsupported by this build');
    await expect(adapter.getMousePosition()).rejects.toThrow('unsupported by this build');
  });
});
