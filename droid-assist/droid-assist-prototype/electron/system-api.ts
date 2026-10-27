/** IPC channel names of the system-info API shared by the Electron main process and the preload script. */
export const SYSTEM_CHANNELS = {
  info: 'system:info',
  folderSpecs: 'system:folder-specs',
  pickFolder: 'system:pick-folder',
} as const;

/** Most recently modified files listed per folder. */
export const RECENT_FILES = 5;

/** A connected display as the System panel shows it. */
export interface SystemDisplay {
  label: string;
  width: number;
  height: number;
  primary: boolean;
}

/** The user's computer: OS, CPU, memory, displays, uptime and (natively) the system disk. */
export interface SystemInfo {
  /** Where the numbers come from: native OS APIs (Electron) or the browser's navigator. */
  source: 'electron' | 'browser';
  os: string;
  arch: string;
  cpu: { model: string; cores: number };
  /** Bytes; null when the browser does not tell. */
  memory: { totalBytes: number | null; freeBytes: number | null };
  displays: SystemDisplay[];
  /** Seconds the OS (Electron) or this app session (browser) has been up. */
  uptimeSec: number;
  uptimeOf: 'system' | 'session';
  /** Free and total bytes of the system disk; null when unknown. */
  disk: { freeBytes: number; totalBytes: number } | null;
}

/** One file found while scanning a folder. */
export interface ScannedFile {
  /** Path relative to the scanned folder. */
  path: string;
  size: number;
  /** Last modification time (ms since epoch). */
  modified: number;
}

/** Size, counts and recent modifications of one user-chosen folder. */
export interface FolderSpec {
  path: string;
  sizeBytes: number;
  files: number;
  folders: number;
  /** The newest RECENT_FILES files, newest first. */
  recent: ScannedFile[];
  /** True when the scan stopped at its entry cap (the numbers are a lower bound). */
  truncated: boolean;
  /** Why the folder could not be read; the numbers are then zero. */
  error?: string;
}

/** The folder spec of `path` from the files and sub-folders a scan found. */
export function summarizeFolder(path: string, files: ScannedFile[], folders: number, truncated = false): FolderSpec {
  return {
    path,
    sizeBytes: files.reduce((n, f) => n + f.size, 0),
    files: files.length,
    folders,
    recent: [...files].sort((a, b) => b.modified - a.modified).slice(0, RECENT_FILES),
    truncated,
  };
}

/** The spec of a folder that could not be read. */
export const unreadableFolder = (path: string, error: string): FolderSpec => ({ path, sizeBytes: 0, files: 0, folders: 0, recent: [], truncated: false, error });

/** The optional system methods the preload adds to `window.droidNative` under Electron. */
export interface NativeSystemApi {
  systemInfo?(): Promise<SystemInfo>;
  folderSpecs?(paths: string[]): Promise<FolderSpec[]>;
  /** A native folder picker; null when cancelled. */
  pickFolder?(): Promise<string | null>;
}
