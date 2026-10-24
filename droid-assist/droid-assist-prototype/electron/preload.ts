import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CAPTURE_CHANNELS, type NativeCaptureApi, type NativeFrame } from './capture-api.js';

let frameListener: ((event: IpcRendererEvent, frame: NativeFrame) => void) | null = null;
let errorListener: ((event: IpcRendererEvent, message: string) => void) | null = null;

function dropListeners() {
  if (frameListener) ipcRenderer.removeListener(CAPTURE_CHANNELS.frame, frameListener);
  if (errorListener) ipcRenderer.removeListener(CAPTURE_CHANNELS.error, errorListener);
  frameListener = null;
  errorListener = null;
}

/** The narrow capture API the renderer sees as `window.droidNative`. */
const api: NativeCaptureApi = {
  async startCapture(intervalMs, onFrame, onError) {
    dropListeners();
    frameListener = (_event, frame) => onFrame(frame);
    errorListener = (_event, message) => onError(message);
    ipcRenderer.on(CAPTURE_CHANNELS.frame, frameListener);
    ipcRenderer.on(CAPTURE_CHANNELS.error, errorListener);
    await ipcRenderer.invoke(CAPTURE_CHANNELS.start, intervalMs);
  },
  setCaptureInterval(intervalMs) {
    ipcRenderer.send(CAPTURE_CHANNELS.setInterval, intervalMs);
  },
  stopCapture() {
    dropListeners();
    ipcRenderer.send(CAPTURE_CHANNELS.stop);
  },
};

contextBridge.exposeInMainWorld('droidNative', api);
