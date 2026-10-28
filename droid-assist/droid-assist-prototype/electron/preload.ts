import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CAPTURE_CHANNELS, type NativeCaptureApi, type NativeFrame } from './capture-api.js';
import { SYSTEM_CHANNELS, type NativeSystemApi } from './system-api.js';
import { MAIN_BRIDGE_CHANNELS, type MainBridgeNativeApi } from './main-bridge-api.js';
import { WINDOW_CHANNELS, type NativeWindowApi } from './window-api.js';

let frameListener: ((event: IpcRendererEvent, frame: NativeFrame) => void) | null = null;
let errorListener: ((event: IpcRendererEvent, message: string) => void) | null = null;

function dropListeners() {
  if (frameListener) ipcRenderer.removeListener(CAPTURE_CHANNELS.frame, frameListener);
  if (errorListener) ipcRenderer.removeListener(CAPTURE_CHANNELS.error, errorListener);
  frameListener = null;
  errorListener = null;
}

/** The narrow capture API the renderer sees as `window.droidNative`. */
const api: NativeCaptureApi & Required<NativeSystemApi> = {
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
  listDisplays() {
    return ipcRenderer.invoke(CAPTURE_CHANNELS.displays);
  },
  selectDisplay(id) {
    ipcRenderer.send(CAPTURE_CHANNELS.selectDisplay, id);
  },
  grabDisplay(id) {
    return ipcRenderer.invoke(CAPTURE_CHANNELS.grabDisplay, id);
  },
  systemInfo() {
    return ipcRenderer.invoke(SYSTEM_CHANNELS.info);
  },
  folderSpecs(paths) {
    return ipcRenderer.invoke(SYSTEM_CHANNELS.folderSpecs, paths);
  },
  pickFolder() {
    return ipcRenderer.invoke(SYSTEM_CHANNELS.pickFolder);
  },
};

contextBridge.exposeInMainWorld('droidNative', api);

type TextListener = (event: IpcRendererEvent, value: string) => void;
const bridgeListeners = new Map<string, TextListener>();

function dropBridgeListeners() {
  for (const [channel, listener] of bridgeListeners) ipcRenderer.removeListener(channel, listener);
  bridgeListeners.clear();
}

function onBridge(channel: string, handler: (value: string) => void) {
  const listener: TextListener = (_event, value) => handler(value);
  bridgeListeners.set(channel, listener);
  ipcRenderer.on(channel, listener);
}

/** The main-app bridge listener the renderer sees as `window.droidMainBridge`. */
const mainBridge: MainBridgeNativeApi = {
  async listen(options, handlers) {
    dropBridgeListeners();
    onBridge(MAIN_BRIDGE_CHANNELS.open, handlers.onOpen);
    onBridge(MAIN_BRIDGE_CHANNELS.message, handlers.onMessage);
    onBridge(MAIN_BRIDGE_CHANNELS.close, handlers.onClose);
    onBridge(MAIN_BRIDGE_CHANNELS.error, handlers.onError);
    await ipcRenderer.invoke(MAIN_BRIDGE_CHANNELS.listen, options);
  },
  send(text) {
    return ipcRenderer.invoke(MAIN_BRIDGE_CHANNELS.send, text);
  },
  stop() {
    dropBridgeListeners();
    ipcRenderer.send(MAIN_BRIDGE_CHANNELS.stop);
  },
};

contextBridge.exposeInMainWorld('droidMainBridge', mainBridge);
/** The window-placement API the renderer sees as `window.droidWindow`. */
const windowApi: NativeWindowApi = {
  state: () => ipcRenderer.invoke(WINDOW_CHANNELS.state),
  stepAside: () => ipcRenderer.invoke(WINDOW_CHANNELS.stepAside),
  restore: () => ipcRenderer.invoke(WINDOW_CHANNELS.restore),
};

contextBridge.exposeInMainWorld('droidWindow', windowApi);
