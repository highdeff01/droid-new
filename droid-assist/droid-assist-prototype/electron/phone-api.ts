import type { PhoneApproval, PhoneAppStatus, PhoneState, PhoneWorkflow } from './phone-companion.js';

/** IPC channel names of the phone companion (main process ↔ preload). */
export const PHONE_CHANNELS = {
  start: 'phone:start',
  state: 'phone:state',
  stop: 'phone:stop',
  action: 'phone:action',
} as const;

/** Where the companion listens and the token a phone must present. */
export interface PhoneOptions {
  host: string;
  port: number;
  token: string;
}

/** The snapshot the renderer pushes to the companion. */
export interface PhonePush extends PhoneState {}

/** What the companion asks the engine to do, forwarded to the renderer. */
export type PhoneAction = { kind: 'approve'; id: string } | { kind: 'reject'; id: string } | { kind: 'runWorkflow'; id: string };

/** The result of starting the companion. */
export interface PhoneStartResult {
  /** The URL a phone on the same network opens, or empty when it could not start. */
  url: string;
  /** The failure reason when it could not start, else empty. */
  error: string;
}

/** The API the preload exposes on `window.droidPhone` when running under Electron. */
export interface PhoneNativeApi {
  /** Starts the companion (replacing a previous one); resolves with its URL or the failure reason. */
  start(options: PhoneOptions): Promise<PhoneStartResult>;
  /** Pushes the latest snapshot the phone reads. */
  push(state: PhonePush): void;
  /** Stops the companion. */
  stop(): void;
  /** Subscribes to the actions a phone triggers; returns an unsubscribe function. */
  onAction(handler: (action: PhoneAction) => void): () => void;
}

export type { PhoneAppStatus, PhoneApproval, PhoneWorkflow, PhoneState };
