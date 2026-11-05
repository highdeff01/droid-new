/** IPC channel names of the auto-update API, shared by the Electron main process and the preload script. */
export const UPDATE_CHANNELS = {
  check: 'update:check',
  run: 'update:run',
} as const;

/** What a check reports to the renderer. */
export interface UpdateStatus {
  ok: boolean;
  /** Commits on the tracked remote the local branch does not have. */
  behind: number;
  /** Subject of the newest remote commit, when known. */
  latest: string;
  message: string;
  /** This app's version, as the renderer shows it. */
  version: string;
}

/** What a run reports to the renderer. */
export interface UpdateOutcome {
  ok: boolean;
  message: string;
  /** Step names and outcomes, in order. */
  steps: Array<{ name: string; ok: boolean }>;
}

/** The API the preload exposes on `window.droidUpdate` when running under Electron. */
export interface NativeUpdateApi {
  /** Checks GitHub for a newer build; resolves the status. Never throws. */
  check(): Promise<UpdateStatus>;
  /** Pulls, reinstalls and rebuilds the tracked branch; on success the app relaunches. */
  run(): Promise<UpdateOutcome>;
}
