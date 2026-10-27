import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FolderSpec, NativeSystemApi, SystemInfo } from './electron/system-api.js';
import { readSystemInfo, scanDirHandle, type DirHandle } from './system-info.js';
import { SYSTEM_FOLDER_LIMIT } from './storage.js';

type DirectoryPicker = () => Promise<DirHandle>;
/** The browser's folder picker (File System Access API), when it has one. */
const browserPicker = (): DirectoryPicker | undefined => (globalThis as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export interface SystemInfoOptions {
  refreshSec: number;
  /** Persisted native folder paths (Electron). */
  folders: string[];
  setFolders: (paths: string[]) => void;
  native: NativeSystemApi | undefined;
}

/**
 * System info for the System panel: computer info and folder specs, refreshed every `refreshSec`
 * and on demand. Electron folders are native paths (persisted); browser folders are picked
 * handles kept for the session and rescanned on every refresh.
 */
export function useSystemInfo({ refreshSec, folders, setFolders, native }: SystemInfoOptions) {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [nativeSpecs, setNativeSpecs] = useState<FolderSpec[]>([]);
  const [browserSpecs, setBrowserSpecs] = useState<FolderSpec[]>([]);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const live = useRef({ folders, setFolders, native });
  useLayoutEffect(() => {
    live.current = { folders, setFolders, native };
  });
  const handlesRef = useRef<DirHandle[]>([]);

  /** Reads system info and every folder's specs now; resolves the fresh info. */
  const refresh = useCallback(async (): Promise<SystemInfo> => {
    const { native: api, folders: paths } = live.current;
    const nativeScan = api?.folderSpecs && paths.length ? api.folderSpecs(paths).catch(() => []) : Promise.resolve([]);
    const [next, specs, picked] = await Promise.all([readSystemInfo(api), nativeScan, Promise.all(handlesRef.current.map((h) => scanDirHandle(h)))]);
    setInfo(next);
    setNativeSpecs(specs);
    setBrowserSpecs(picked);
    setRefreshedAt(Date.now());
    return next;
  }, []);

  const folderKey = folders.join('\n');
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), refreshSec * 1000);
    return () => clearInterval(id);
  }, [refresh, refreshSec, folderKey]);

  /** Lets the user pick a folder to watch; resolves an error message, or null when one was added. */
  const addFolder = useCallback(async (): Promise<string | null> => {
    const { native: api, folders: paths, setFolders: save } = live.current;
    try {
      if (api?.pickFolder) {
        const path = await api.pickFolder();
        if (!path) return 'No folder chosen';
        if (!paths.includes(path)) save([...paths, path].slice(0, SYSTEM_FOLDER_LIMIT));
        return null;
      }
      const picker = browserPicker();
      if (!picker) return 'Folder access is not supported in this browser';
      const handle = await picker();
      handlesRef.current = [...handlesRef.current.filter((h) => h.name !== handle.name), handle].slice(0, SYSTEM_FOLDER_LIMIT);
      const spec = await scanDirHandle(handle);
      setBrowserSpecs((s) => [...s.filter((x) => x.path !== spec.path), spec]);
      return null;
    } catch (error) {
      return error instanceof DOMException && error.name === 'AbortError' ? 'No folder chosen' : `Could not open the folder: ${errorText(error)}`;
    }
  }, []);

  /** Stops watching a folder. */
  const removeFolder = useCallback((path: string) => {
    const { folders: paths, setFolders: save } = live.current;
    if (paths.includes(path)) save(paths.filter((p) => p !== path));
    handlesRef.current = handlesRef.current.filter((h) => h.name !== path);
    setBrowserSpecs((s) => s.filter((x) => x.path !== path));
    setNativeSpecs((s) => s.filter((x) => x.path !== path));
  }, []);

  return { info, folders: [...nativeSpecs, ...browserSpecs], refreshedAt, refresh, addFolder, removeFolder };
}
