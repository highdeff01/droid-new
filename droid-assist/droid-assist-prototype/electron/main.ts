import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, screen, session, type WebContents } from 'electron';
import { CAPTURE_CHANNELS } from './capture-api.js';
import { SYSTEM_CHANNELS } from './system-api.js';
import { nativeSystemInfo, scanFolder } from './system-scan.js';
import { startCaptureLoop, type CaptureLoop } from './capture-loop.js';
import { grabDisplay, grabScreen, listDisplays } from './screen-grab.js';
import { BRIDGE_URL_PATTERNS, withBridgeCors } from './bridge-cors.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** One capture loop per renderer. */
const loops = new Map<number, CaptureLoop>();
/** The display each renderer captures from; absent = primary. */
const selected = new Map<number, string | null>();

function stopLoop(contents: WebContents) {
  loops.get(contents.id)?.stop();
  loops.delete(contents.id);
}

/** Wires the capture IPC: the loop runs here, in the main process, so it is never throttled. */
function registerCaptureIpc() {
  ipcMain.handle(CAPTURE_CHANNELS.start, (event, intervalMs: number) => {
    const contents = event.sender;
    stopLoop(contents);
    const loop = startCaptureLoop(() => grabScreen(selected.get(contents.id) ?? null), {
      frame: (frame) => { if (!contents.isDestroyed()) contents.send(CAPTURE_CHANNELS.frame, frame); },
      error: (message) => {
        loops.delete(contents.id);
        if (!contents.isDestroyed()) contents.send(CAPTURE_CHANNELS.error, message);
      },
    }, intervalMs);
    loops.set(contents.id, loop);
    contents.once('destroyed', () => { stopLoop(contents); selected.delete(contents.id); });
  });
  ipcMain.handle(CAPTURE_CHANNELS.displays, () => listDisplays());
  ipcMain.handle(CAPTURE_CHANNELS.grabDisplay, (_event, id: string | null) => grabDisplay(id));
  ipcMain.on(CAPTURE_CHANNELS.selectDisplay, (event, id: string | null) => { selected.set(event.sender.id, id); });
  ipcMain.on(CAPTURE_CHANNELS.setInterval, (event, intervalMs: number) => loops.get(event.sender.id)?.setInterval(intervalMs));
  ipcMain.on(CAPTURE_CHANNELS.stop, (event) => stopLoop(event.sender));
}

/** Wires the System panel IPC: computer info, folder specs and a native folder picker. */
function registerSystemIpc() {
  ipcMain.handle(SYSTEM_CHANNELS.info, () => {
    const primary = screen.getPrimaryDisplay().id;
    const displays = screen.getAllDisplays().map((d) => ({
      label: d.label || `Display ${d.id}`,
      width: Math.round(d.size.width * d.scaleFactor),
      height: Math.round(d.size.height * d.scaleFactor),
      primary: d.id === primary,
    }));
    return nativeSystemInfo(displays);
  });
  ipcMain.handle(SYSTEM_CHANNELS.folderSpecs, (_event, paths: string[]) => Promise.all(paths.map((p) => scanFolder(p))));
  ipcMain.handle(SYSTEM_CHANNELS.pickFolder, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = { properties: ['openDirectory' as const] };
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return r.canceled ? null : r.filePaths[0] ?? null;
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'Droid Assist',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Keep the renderer's own timers (replay pacing, demo desktop) at full rate when hidden.
      backgroundThrottling: false,
    },
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(path.join(here, '..', 'dist', 'index.html'));
}

void app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived({ urls: BRIDGE_URL_PATTERNS }, (details, callback) => {
    callback({ responseHeaders: withBridgeCors(details.responseHeaders) });
  });
  registerCaptureIpc();
  registerSystemIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
