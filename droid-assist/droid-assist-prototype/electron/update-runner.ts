import { spawn } from 'node:child_process';
import { app } from 'electron';
import { checkForUpdate, runUpdate, type CommandRunner, type UpdateOptions } from './updater.js';

/** How long a single update command may run before it is killed (a slow full rebuild fits). */
export const UPDATE_TIMEOUT_MS = 10 * 60_000;

/** Runs one command to completion, capturing stdout+stderr; never rejects. */
export const runCommand: CommandRunner = (command, args) =>
  new Promise((resolve) => {
    let output = '';
    let settled = false;
    const child = spawn(command, [...args], { shell: process.platform === 'win32', windowsHide: true });
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok, output });
    };
    const timer = setTimeout(() => {
      child.kill();
      output += `\ntimed out after ${UPDATE_TIMEOUT_MS / 60_000} min`;
      done(false);
    }, UPDATE_TIMEOUT_MS);
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.on('error', (error) => { output += String(error.message); done(false); });
    child.on('close', (code) => done(code === 0));
  });

/** Where the packaged app's repository and package live, derived from the running app path. */
export function updateOptions(): UpdateOptions {
  // In a packaged build the app is release/win-unpacked/resources/app.asar; the checkout it was built
  // from is not necessarily present. `DROID_UPDATE_ROOT` lets the user point at their clone.
  const repoRoot = process.env.DROID_UPDATE_ROOT ?? app.getAppPath();
  return { repoRoot, appDir: process.env.DROID_UPDATE_APPDIR ?? repoRoot };
}

/** Checks for an update with the real command runner. */
export const check = (options: UpdateOptions = updateOptions()) => checkForUpdate(options, runCommand);

/** Runs the update with the real command runner. */
export const update = (options: UpdateOptions = updateOptions()) => runUpdate(options, runCommand);
