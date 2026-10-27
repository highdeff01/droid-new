// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nativeSystemInfo, scanFolder } from './system-scan.js';

const tmpDirs: string[] = [];
const mkTmp = async (): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'system-scan-'));
  tmpDirs.push(dir);
  return dir;
};

afterEach(async () => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()!;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('scanFolder', () => {
  it('sums sizes, counts files and folders, and lists recent files newest first', async () => {
    const root = await mkTmp();
    await fs.writeFile(path.join(root, 'a.txt'), Buffer.alloc(10));
    await fs.writeFile(path.join(root, 'b.txt'), Buffer.alloc(20));
    await fs.mkdir(path.join(root, 'sub'));
    await fs.writeFile(path.join(root, 'sub', 'c.txt'), Buffer.alloc(5));

    const now = Date.now();
    await fs.utimes(path.join(root, 'a.txt'), new Date(now - 3000), new Date(now - 3000));
    await fs.utimes(path.join(root, 'b.txt'), new Date(now - 1000), new Date(now - 1000));
    await fs.utimes(path.join(root, 'sub', 'c.txt'), new Date(now - 2000), new Date(now - 2000));

    const spec = await scanFolder(root);

    expect(spec.sizeBytes).toBe(35);
    expect(spec.files).toBe(3);
    expect(spec.folders).toBe(1);
    expect(spec.truncated).toBe(false);
    expect(spec.recent.map((f) => f.path)).toEqual(['b.txt', path.join('sub', 'c.txt'), 'a.txt']);
  });

  it('reports an error and zero numbers for a missing path', async () => {
    const spec = await scanFolder(path.join(os.tmpdir(), 'does-not-exist-' + Date.now()));

    expect(spec.error).toBeTruthy();
    expect(spec.sizeBytes).toBe(0);
    expect(spec.files).toBe(0);
    expect(spec.folders).toBe(0);
  });

  it('reports "Not a folder" for a file path', async () => {
    const root = await mkTmp();
    const filePath = path.join(root, 'a.txt');
    await fs.writeFile(filePath, Buffer.alloc(1));

    const spec = await scanFolder(filePath);

    expect(spec.error).toBe('Not a folder');
  });

  it('marks truncated when the entry limit is reached', async () => {
    const root = await mkTmp();
    await fs.writeFile(path.join(root, 'a.txt'), Buffer.alloc(1));
    await fs.writeFile(path.join(root, 'b.txt'), Buffer.alloc(1));

    const spec = await scanFolder(root, 1);

    expect(spec.truncated).toBe(true);
  });
});

describe('nativeSystemInfo', () => {
  it('reports electron source, system uptime and real CPU/memory', async () => {
    const info = await nativeSystemInfo([]);

    expect(info.source).toBe('electron');
    expect(info.uptimeOf).toBe('system');
    expect(info.cpu.cores).toBeGreaterThan(0);
    expect(info.memory.totalBytes).toBeGreaterThan(0);
  });
});
