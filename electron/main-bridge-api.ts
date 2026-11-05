/** IPC channel names of the main-app bridge listener (main process ↔ preload). */
export const MAIN_BRIDGE_CHANNELS = {
  listen: 'main-bridge:listen',
  send: 'main-bridge:send',
  stop: 'main-bridge:stop',
  open: 'main-bridge:open',
  message: 'main-bridge:message',
  close: 'main-bridge:close',
  error: 'main-bridge:error',
} as const;

/** Where the listener accepts the main Droid app, and the token it must present. */
export interface ListenOptions {
  host: string;
  port: number;
  /** Required as `?token=` (WebSocket) or `Authorization: Bearer` (HTTP) when non-empty. */
  token: string;
}

/** What the listener reports to the renderer. */
export interface ListenHandlers {
  /** The main app connected; `peer` describes it (transport and remote address). */
  onOpen(peer: string): void;
  /** One JSON text message from the main app. */
  onMessage(text: string): void;
  /** The main app went away; the listener keeps waiting for the next connection. */
  onClose(reason: string): void;
  /** The listener itself failed (e.g. the port is taken); it is stopped. */
  onError(message: string): void;
}

/** The API the preload exposes on `window.droidMainBridge` when running under Electron. */
export interface MainBridgeNativeApi {
  /** Starts listening (replacing a previous listener); resolves once the port is bound, rejects with the reason otherwise. */
  listen(options: ListenOptions, handlers: ListenHandlers): Promise<void>;
  /** Sends one JSON text message to the connected main app; false when none is connected. */
  send(text: string): Promise<boolean>;
  /** Closes the listener and any connection. */
  stop(): void;
}
