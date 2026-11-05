import os from 'node:os';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { summarizeFolder, unreadableFolder, type FolderSpec, type ScannedFile, type SystemDisplay, type SystemInfo } from './system-api.js';

/** Most entries one folder scan visits before it stops (keeps a huge folder from stalling the app). */
export const SCAN_ENTRY_LIMIT = 20_000;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Walks `root` breadth-first and summarizes it; an unreadable root is reported, unreadable sub-entries are skipped. */
export async function scanFolder(root: string, limit = SCAN_ENTRY_LIMIT): Promise<FolderSpec> {
  try {
    if (!(await fs.stat(root)).isDirectory()) return unreadableFolder(root, 'Not a folder');
  } catch (error) {
    return unreadableFolder(root, errorText(error));
  }
  const files: ScannedFile[] = [];
  let folders = 0;
  let visited = 0;
  const queue = [root];
  while (queue.length && visited < limit) {
    const dir = queue.shift()!;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (++visited > limit) break;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        folders += 1;
        queue.push(full);
      } else if (entry.isFile()) {
        const st = await fs.stat(full).catch(() => null);
        if (st) files.push({ path: path.relative(root, full), size: st.size, modified: st.mtimeMs });
      }
    }
  }
  return summarizeFolder(root, files, folders, visited > limit || queue.length > 0);
}

/** Free and total bytes of the disk holding the user's home folder; null when the OS does not say. */
async function systemDisk(): Promise<SystemInfo['disk']> {
  try {
    const s = await fs.statfs(os.homedir());
    return { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
  } catch {
    return null;
  }
}

/** The computer's OS, CPU, memory, uptime and disk from Node's os/fs, with the displays Electron reports. */
export async function nativeSystemInfo(displays: SystemDisplay[]): Promise<SystemInfo> {
  const cpus = os.cpus();
  return {
    source: 'electron',
    os: `${os.type()} ${os.release()} (${os.platform()})`,
    arch: os.arch(),
    cpu: { model: cpus[0]?.model.trim() || 'Unknown CPU', cores: cpus.length },
    memory: { totalBytes: os.totalmem(), freeBytes: os.freemem() },
    displays,
    uptimeSec: Math.round(os.uptime()),
    uptimeOf: 'system',
    disk: await systemDisk(),
  };
}
