import { describe, expect, it } from 'vitest';
import {
  browserSystemInfo,
  diskLow,
  formatBytes,
  formatUptime,
  readSystemInfo,
  recentOperations,
  scanDirHandle,
  type BrowserEnv,
  type DirHandle,
  type FileHandle,
} from './system-info.js';
import type { NativeSystemApi, SystemInfo } from './electron/system-api.js';
import type { RunSummary } from './run-stats.js';

const env = (overrides: Partial<BrowserEnv> = {}): BrowserEnv => ({
  userAgent: 'TestAgent/1.0',
  platform: 'TestOS',
  hardwareConcurrency: 8,
  screen: { width: 1000, height: 500, devicePixelRatio: 2 },
  sessionSec: 42,
  ...overrides,
});

describe('browserSystemInfo', () => {
  it('reports session uptime, cores and one primary display scaled by device pixel ratio', () => {
    const info = browserSystemInfo(env());
    expect(info.source).toBe('browser');
    expect(info.uptimeOf).toBe('session');
    expect(info.uptimeSec).toBe(42);
    expect(info.cpu.cores).toBe(8);
    expect(info.displays).toEqual([{ label: 'This screen', width: 2000, height: 1000, primary: true }]);
    expect(info.disk).toBeNull();
    expect(info.memory.freeBytes).toBeNull();
  });

  it('reports total memory from deviceMemory when present', () => {
    const info = browserSystemInfo(env({ deviceMemory: 4 }));
    expect(info.memory.totalBytes).toBe(4 * 1024 ** 3);
  });

  it('reports null total memory when deviceMemory is absent', () => {
    const info = browserSystemInfo(env());
    expect(info.memory.totalBytes).toBeNull();
  });
});

describe('readSystemInfo', () => {
  const browserInfo = browserSystemInfo(env());

  it('returns the native value when systemInfo succeeds', async () => {
    const native: NativeSystemApi = { systemInfo: async () => ({ ...browserInfo, source: 'electron' }) };
    const info = await readSystemInfo(native, () => env());
    expect(info.source).toBe('electron');
  });

  it('falls back to the browser when native is undefined', async () => {
    const info = await readSystemInfo(undefined, () => env());
    expect(info.source).toBe('browser');
  });

  it('falls back to the browser when systemInfo is missing', async () => {
    const info = await readSystemInfo({}, () => env());
    expect(info.source).toBe('browser');
  });

  it('falls back to the browser when systemInfo rejects', async () => {
    const native: NativeSystemApi = {
      systemInfo: async () => {
        throw new Error('boom');
      },
    };
    const info = await readSystemInfo(native, () => env());
    expect(info.source).toBe('browser');
  });
});

const fileHandle = (name: string, size: number, lastModified: number): FileHandle => ({
  kind: 'file',
  name,
  getFile: async () => ({ size, lastModified }),
});

const dirHandle = (name: string, entries: Array<DirHandle | FileHandle>): DirHandle => ({
  kind: 'directory',
  name,
  values: async function* () {
    for (const entry of entries) yield entry;
  },
});

describe('scanDirHandle', () => {
  it('sums sizes, counts files and nested folders, and lists recent files newest first', async () => {
    const sub = dirHandle('sub', [fileHandle('d.txt', 4, 400)]);
    const root = dirHandle('root', [fileHandle('a.txt', 10, 100), fileHandle('b.txt', 20, 500), fileHandle('c.txt', 30, 300), sub]);

    const spec = await scanDirHandle(root);

    expect(spec.sizeBytes).toBe(64);
    expect(spec.files).toBe(4);
    expect(spec.folders).toBe(1);
    expect(spec.truncated).toBe(false);
    expect(spec.recent.map((f) => f.path)).toEqual(['b.txt', 'sub/d.txt', 'c.txt', 'a.txt']);
  });

  it('caps the recent list at RECENT_FILES', async () => {
    const files = Array.from({ length: 7 }, (_, i) => fileHandle(`f${i}.txt`, 1, i));
    const root = dirHandle('root', files);

    const spec = await scanDirHandle(root);

    expect(spec.recent).toHaveLength(5);
    expect(spec.recent[0].path).toBe('f6.txt');
  });

  it('reports an error and zero numbers when values() throws', async () => {
    const root: DirHandle = {
      kind: 'directory',
      name: 'root',
      values: async function* () {
        throw new Error('denied');
      },
    };

    const spec = await scanDirHandle(root);

    expect(spec.error).toBe('denied');
    expect(spec.sizeBytes).toBe(0);
    expect(spec.files).toBe(0);
    expect(spec.folders).toBe(0);
  });

  it('marks truncated when the limit is reached', async () => {
    const root = dirHandle('root', [fileHandle('a.txt', 1, 1), fileHandle('b.txt', 1, 2), fileHandle('c.txt', 1, 3)]);

    const spec = await scanDirHandle(root, 1);

    expect(spec.truncated).toBe(true);
  });
});

describe('formatBytes', () => {
  it('reports unknown for null', () => {
    expect(formatBytes(null)).toBe('unknown');
  });

  it('reports whole bytes without decimals', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('reports larger sizes with one decimal', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
  });
});

describe('formatUptime', () => {
  it('reports days, hours and minutes', () => {
    expect(formatUptime(90061)).toBe('1d 1h 1m');
  });

  it('reports only minutes under an hour', () => {
    expect(formatUptime(125)).toBe('2m');
  });
});

describe('diskLow', () => {
  const infoWithDisk = (freeBytes: number, totalBytes: number): SystemInfo => ({ ...browserSystemInfo(env()), disk: { freeBytes, totalBytes } });

  it('is true when free space is below 10%', () => {
    expect(diskLow(infoWithDisk(5, 100))).toBe(true);
  });

  it('is false when free space is at or above 10%', () => {
    expect(diskLow(infoWithDisk(20, 100))).toBe(false);
  });

  it('is false for null info', () => {
    expect(diskLow(null)).toBe(false);
  });

  it('is false for null disk', () => {
    expect(diskLow(browserSystemInfo(env()))).toBe(false);
  });
});

describe('recentOperations', () => {
  const run = (n: number, time: number): RunSummary => ({ id: `r${n}`, time, session: 's', goal: 'g', attempted: 1, succeeded: 1, durationMs: 1, outcome: 'success' });

  it('sorts newest first and caps at the given limit', () => {
    const runs = [run(1, 100), run(2, 300), run(3, 200)];

    expect(recentOperations(runs, 2).map((r) => r.id)).toEqual(['r2', 'r3']);
  });
});
