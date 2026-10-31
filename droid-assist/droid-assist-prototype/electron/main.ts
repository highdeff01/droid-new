import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, screen, session, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { CAPTURE_CHANNELS } from './capture-api.js';
import { SYSTEM_CHANNELS } from './system-api.js';
import { nativeSystemInfo, scanFolder } from './system-scan.js';
import { WINDOW_CHANNELS, type WindowState } from './window-api.js';
import { startCaptureLoop, type CaptureLoop } from './capture-loop.js';
import { grabDisplay, grabScreen, listDisplays } from './screen-grab.js';
import { BRIDGE_URL_PATTERNS, withBridgeCors } from './bridge-cors.js';
import { MAIN_BRIDGE_CHANNELS, type ListenOptions } from './main-bridge-api.js';
import { startMainBridgeListener, type MainBridgeListener } from './main-bridge-server.js';
import { UPDATE_CHANNELS } from './update-api.js';
import { check, update } from './update-runner.js';

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

/** One main-app bridge listener per renderer. */
const listeners = new Map<number, MainBridgeListener>();

function stopListener(contents: WebContents) {
  listeners.get(contents.id)?.stop();
  listeners.delete(contents.id);
}

/** Wires the main-app bridge IPC: the HTTP + WebSocket listener the main Droid app connects to runs here. */
function registerMainBridgeIpc() {
  ipcMain.handle(MAIN_BRIDGE_CHANNELS.listen, async (event, options: ListenOptions) => {
    const contents = event.sender;
    stopListener(contents);
    const emit = (channel: string, value: string) => { if (!contents.isDestroyed()) contents.send(channel, value); };
    const listener = startMainBridgeListener(options, {
      onOpen: (peer) => emit(MAIN_BRIDGE_CHANNELS.open, peer),
      onMessage: (text) => emit(MAIN_BRIDGE_CHANNELS.message, text),
      onClose: (reason) => emit(MAIN_BRIDGE_CHANNELS.close, reason),
      onError: (message) => { listeners.delete(contents.id); emit(MAIN_BRIDGE_CHANNELS.error, message); },
    });
    listeners.set(contents.id, listener);
    contents.once('destroyed', () => stopListener(contents));
    await listener.ready;
  });
  ipcMain.handle(MAIN_BRIDGE_CHANNELS.send, (event, text: string) => listeners.get(event.sender.id)?.send(text) ?? false);
  ipcMain.on(MAIN_BRIDGE_CHANNELS.stop, (event) => stopListener(event.sender));
}

/** The placement of the window `contents` belongs to. */
function windowState(win: BrowserWindow): WindowState {
  return { visible: win.isVisible() && !win.isMinimized(), minimized: win.isMinimized(), focused: win.isFocused(), alwaysOnTop: win.isAlwaysOnTop(), bounds: win.getBounds() };
}

/** Wires the window-placement IPC: the App-placement agent steps the assist window aside or brings it back. */
function registerWindowIpc() {
  const placed = (event: IpcMainInvokeEvent, move: (win: BrowserWindow) => void) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('No window for this renderer');
    move(win);
    return windowState(win);
  };
  ipcMain.handle(WINDOW_CHANNELS.state, (event) => placed(event, () => undefined));
  ipcMain.handle(WINDOW_CHANNELS.stepAside, (event) => placed(event, (win) => win.minimize()));
  ipcMain.handle(WINDOW_CHANNELS.restore, (event) => placed(event, (win) => {
    win.restore();
    win.show();
    win.focus();
  }));
}

/** Wires the auto-update IPC: check GitHub, then pull/reinstall/rebuild and relaunch. */
function registerUpdateIpc() {
  ipcMain.handle(UPDATE_CHANNELS.check, async () => {
    const c = await check();
    return { ...c, version: app.getVersion() };
  });
  ipcMain.handle(UPDATE_CHANNELS.run, async () => {
    const r = await update();
    if (r.ok) {
      // The rebuilt app is on disk; restart into it. A short delay lets the reply reach the renderer.
      setTimeout(() => { app.relaunch(); app.exit(0); }, 500);
    }
    return { ok: r.ok, message: r.message, steps: r.steps.map((s) => ({ name: s.name, ok: s.ok })) };
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
  registerMainBridgeIpc();
  registerWindowIpc();
  registerUpdateIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
