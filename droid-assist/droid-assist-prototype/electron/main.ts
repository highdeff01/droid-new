import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, session, type WebContents } from 'electron';
import { CAPTURE_CHANNELS } from './capture-api.js';
import { startCaptureLoop, type CaptureLoop } from './capture-loop.js';
import { grabPrimaryScreen } from './screen-grab.js';
import { BRIDGE_URL_PATTERNS, withBridgeCors } from './bridge-cors.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** One capture loop per renderer. */
const loops = new Map<number, CaptureLoop>();

function stopLoop(contents: WebContents) {
  loops.get(contents.id)?.stop();
  loops.delete(contents.id);
}

/** Wires the capture IPC: the loop runs here, in the main process, so it is never throttled. */
function registerCaptureIpc() {
  ipcMain.handle(CAPTURE_CHANNELS.start, (event, intervalMs: number) => {
    const contents = event.sender;
    stopLoop(contents);
    const loop = startCaptureLoop(grabPrimaryScreen, {
      frame: (frame) => { if (!contents.isDestroyed()) contents.send(CAPTURE_CHANNELS.frame, frame); },
      error: (message) => {
        loops.delete(contents.id);
        if (!contents.isDestroyed()) contents.send(CAPTURE_CHANNELS.error, message);
      },
    }, intervalMs);
    loops.set(contents.id, loop);
    contents.once('destroyed', () => stopLoop(contents));
  });
  ipcMain.on(CAPTURE_CHANNELS.setInterval, (event, intervalMs: number) => loops.get(event.sender.id)?.setInterval(intervalMs));
  ipcMain.on(CAPTURE_CHANNELS.stop, (event) => stopLoop(event.sender));
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
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
