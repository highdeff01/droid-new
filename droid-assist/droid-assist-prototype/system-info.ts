import type { FolderSpec, NativeSystemApi, ScannedFile, SystemInfo } from './electron/system-api.js';
import { summarizeFolder, unreadableFolder } from './electron/system-api.js';
import type { RunSummary } from './run-stats.js';

/** Valid range of the System panel's refresh interval, in seconds. */
export const SYSTEM_REFRESH_SEC_RANGE: [number, number] = [5, 600];
export const DEFAULT_SYSTEM_REFRESH_SEC = 30;
/** Recent operations the System panel lists. */
export const RECENT_OPERATIONS = 8;
/** Free-disk share below which the disk counts as almost full. */
export const DISK_LOW_RATIO = 0.1;

/** The navigator fields the browser fallback reads (deviceMemory is Chromium-only). */
export interface BrowserEnv {
  userAgent: string;
  platform: string;
  hardwareConcurrency: number;
  deviceMemory?: number;
  screen: { width: number; height: number; devicePixelRatio: number };
  /** Seconds since this page loaded. */
  sessionSec: number;
}

/** The current browser's environment, read from navigator/screen/performance. */
export function browserEnv(): BrowserEnv {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    userAgent: nav.userAgent,
    platform: nav.platform || 'unknown',
    hardwareConcurrency: nav.hardwareConcurrency || 0,
    deviceMemory: nav.deviceMemory,
    screen: { width: window.screen?.width ?? 0, height: window.screen?.height ?? 0, devicePixelRatio: window.devicePixelRatio || 1 },
    sessionSec: Math.round(performance.now() / 1000),
  };
}

/** System info from the browser alone: what navigator tells (memory and disk mostly unknown, uptime of this session). */
export function browserSystemInfo(env: BrowserEnv): SystemInfo {
  const { width, height, devicePixelRatio } = env.screen;
  return {
    source: 'browser',
    os: `${env.platform} — ${env.userAgent}`,
    arch: 'unknown',
    cpu: { model: 'Unknown (browser)', cores: env.hardwareConcurrency },
    memory: { totalBytes: env.deviceMemory ? env.deviceMemory * 1024 ** 3 : null, freeBytes: null },
    displays: width && height ? [{ label: 'This screen', width: Math.round(width * devicePixelRatio), height: Math.round(height * devicePixelRatio), primary: true }] : [],
    uptimeSec: env.sessionSec,
    uptimeOf: 'session',
    disk: null,
  };
}

/** System info from the Electron API when present, else (or when it fails) the navigator fallback. */
export async function readSystemInfo(native: NativeSystemApi | undefined, env: () => BrowserEnv = browserEnv): Promise<SystemInfo> {
  if (native?.systemInfo) {
    try {
      return await native.systemInfo();
    } catch {
      // fall back to what the browser knows
    }
  }
  return browserSystemInfo(env());
}

/** The browser's directory handle as far as the folder scan needs it (File System Access API). */
export interface DirHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<DirHandle | FileHandle>;
}
export interface FileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<{ size: number; lastModified: number }>;
}

/** Summarizes a browser-picked folder by walking its handle (at most `limit` entries). */
export async function scanDirHandle(dir: DirHandle, limit = 20_000): Promise<FolderSpec> {
  const files: ScannedFile[] = [];
  let folders = 0;
  let visited = 0;
  const queue: Array<{ handle: DirHandle; prefix: string }> = [{ handle: dir, prefix: '' }];
  try {
    while (queue.length && visited < limit) {
      const { handle, prefix } = queue.shift()!;
      for await (const entry of handle.values()) {
        if (++visited > limit) break;
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.kind === 'directory') {
          folders += 1;
          queue.push({ handle: entry, prefix: rel });
        } else {
          const f = await entry.getFile();
          files.push({ path: rel, size: f.size, modified: f.lastModified });
        }
      }
    }
  } catch (error) {
    return unreadableFolder(dir.name, error instanceof Error ? error.message : String(error));
  }
  return summarizeFolder(dir.name, files, folders, visited > limit || queue.length > 0);
}

/** The newest run summaries, newest first: the System panel's recent operations. */
export const recentOperations = (runs: RunSummary[], limit = RECENT_OPERATIONS): RunSummary[] => [...runs].sort((a, b) => b.time - a.time).slice(0, limit);

/** Whether the system disk is almost full (less than DISK_LOW_RATIO free). */
export const diskLow = (info: SystemInfo | null): boolean => !!info?.disk && info.disk.totalBytes > 0 && info.disk.freeBytes / info.disk.totalBytes < DISK_LOW_RATIO;

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
/** Bytes as a short human size ("1.5 GB"); "unknown" for null. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'unknown';
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < UNITS.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${u === 0 ? v : v.toFixed(1)} ${UNITS[u]}`;
}

/** Seconds as "2d 3h 4m" (minutes always shown). */
export function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d ? `${d}d ` : ''}${d || h ? `${h}h ` : ''}${m}m`;
}
