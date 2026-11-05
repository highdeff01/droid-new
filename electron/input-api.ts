import type { NativeAction } from '../bridge.js';

export const INPUT_CHANNELS = {
  available: 'input:available',
  run: 'input:run',
} as const;

export type { NativeAction };

/** The Windows native input API exposed by the sandboxed preload. */
export interface NativeInputApi {
  nativeInputAvailable(): Promise<boolean>;
  runNativeActions(actions: NativeAction[]): Promise<{ ok: boolean; message: string }>;
}
