import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, Menu, screen, session, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { autoUpdater } from 'electron-updater';
import { CAPTURE_CHANNELS } from './capture-api.js';
import { SYSTEM_CHANNELS } from './system-api.js';
import { nativeSystemInfo, scanFolder } from './system-scan.js';
import { WINDOW_CHANNELS, type WindowState } from './window-api.js';
import { startCaptureLoop, type CaptureLoop } from './capture-loop.js';
import { grabDisplay, grabScreen, listDisplays } from './screen-grab.js';
import { BRIDGE_URL_PATTERNS, withBridgeCors } from './bridge-cors.js';
import { MAIN_BRIDGE_CHANNELS, type ListenOptions } from './main-bridge-api.js';
import { startMainBridgeListener, type MainBridgeListener } from './main-bridge-server.js';
import { INPUT_CHANNELS, type NativeAction } from './input-api.js';
import { WindowsPlatformAdapter } from '../platform-adapter-win.js';

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

/** Runs the AI step's already-grounded action list through Windows SendInput in the main process. */
function registerNativeInputIpc() {
  const adapter = new WindowsPlatformAdapter();
  ipcMain.handle(INPUT_CHANNELS.available, () => adapter.isAvailable());
  ipcMain.handle(INPUT_CHANNELS.run, async (_event, actions: NativeAction[]) => {
    if (!Array.isArray(actions) || actions.length > 100) return { ok: false, message: 'Invalid native action list' };
    if (!(await adapter.isAvailable())) return { ok: false, message: 'Native Windows input is unavailable' };
    try {
      for (const action of actions) {
        if (!action || !Number.isFinite(action.x) || !Number.isFinite(action.y) || !Number.isFinite(action.delayMs) || action.delayMs < 0 || action.delayMs > 5000) {
          throw new Error('Invalid native action coordinates or delay');
        }
        if (action.delayMs) await new Promise((resolve) => setTimeout(resolve, action.delayMs));
        switch (action.action) {
          case 'click': await adapter.mouseClick(action.x, action.y); break;
          case 'double_click': await adapter.mouseDoubleClick(action.x, action.y); break;
          case 'move': await adapter.mouseMove(action.x, action.y, action.durationMs ?? 0); break;
          case 'drag':
            if (!Number.isFinite(action.endX) || !Number.isFinite(action.endY)) throw new Error('Drag action has no valid end point');
            await adapter.mouseDrag(action.x, action.y, action.endX!, action.endY!, action.durationMs ?? 0);
            break;
          case 'scroll': await adapter.mouseScroll(action.x, action.y, /up/i.test(action.keyPayload ?? '') ? -3 : 3); break;
          case 'type_text': await adapter.typeText(action.text ?? ''); break;
          case 'press_key':
          case 'hotkey': await adapter.keyPress(action.keyPayload ?? ''); break;
          case 'mouse_down': await adapter.mouseDown(action.x, action.y); break;
          case 'mouse_up': await adapter.mouseRelease('left'); break;
          case 'wait': break;
          default: throw new Error(`Unsupported native action: ${String(action.action)}`);
        }
      }
      return { ok: true, message: `Windows accepted ${actions.length} native input action(s)` };
    } catch (error) {
      await adapter.mouseRelease().catch(() => undefined);
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
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

function installUpdateMenu() {
  let manualCheck = false;
  let checkInProgress = false;
  const showUpdateMessage = (title: string, message: string, buttons = ['OK']) => {
    void dialog.showMessageBox({ type: 'info', title, message, buttons });
  };
  const checkForUpdates = async (manual = false) => {
    if (!app.isPackaged || process.platform !== 'win32') {
      if (manual) showUpdateMessage('Updates unavailable', 'GitHub updates are available in the installed Windows release, not in development or browser mode.');
      return;
    }
    if (checkInProgress) return;

    checkInProgress = true;
    manualCheck = manual;
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`GitHub update check failed: ${message}`);
      if (manual) showUpdateMessage('Update check failed', `Could not check GitHub for updates:\n\n${message}`);
      manualCheck = false;
    } finally {
      checkInProgress = false;
    }
  };

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on('update-available', (info) => {
    if (manualCheck) showUpdateMessage('Update available', `Droid Assist ${info.version} is downloading in the background.`);
    manualCheck = false;
  });
  autoUpdater.on('update-not-available', () => {
    if (manualCheck) showUpdateMessage('Droid Assist is up to date', `You are running version ${app.getVersion()}.`);
    manualCheck = false;
  });
  autoUpdater.on('update-downloaded', (info) => {
    void dialog.showMessageBox({
      type: 'info',
      title: 'Update ready',
      message: `Droid Assist ${info.version} has been downloaded.`,
      detail: 'Restart the app to install the update.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });
  autoUpdater.on('error', (error) => {
    console.error(`GitHub updater error: ${error.message}`);
    if (manualCheck) showUpdateMessage('Update failed', error.message);
    manualCheck = false;
  });

  const helpMenu = {
    label: 'Help',
    submenu: [
      { label: 'Check for Updates…', click: () => { void checkForUpdates(true); } },
      { type: 'separator' as const },
      { label: 'About Droid Assist', click: () => showUpdateMessage('About Droid Assist', `Version ${app.getVersion()}\nUpdates are published on GitHub.`) },
    ],
  };
  Menu.setApplicationMenu(Menu.buildFromTemplate([helpMenu]));

  if (app.isPackaged && process.platform === 'win32') {
    const startupCheck = setTimeout(() => { void checkForUpdates(); }, 5000);
    startupCheck.unref();
    const periodicCheck = setInterval(() => { void checkForUpdates(); }, 6 * 60 * 60 * 1000);
    periodicCheck.unref();
  }
}

void app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived({ urls: BRIDGE_URL_PATTERNS }, (details, callback) => {
    callback({ responseHeaders: withBridgeCors(details.responseHeaders) });
  });
  registerCaptureIpc();
  registerSystemIpc();
  registerNativeInputIpc();
  registerMainBridgeIpc();
  registerWindowIpc();
  installUpdateMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
