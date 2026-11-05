import { spawn } from 'node:child_process';
import electronPath from 'electron';
import { createServer } from 'vite';
import { buildElectron } from './build.mjs';

/**
 * Electron dev flow: serves the renderer from the Vite dev server (HMR intact), compiles
 * main + preload, then launches Electron pointed at the dev server. Exits with Electron.
 */
const server = await createServer();
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error('Vite dev server did not report a local URL');
await buildElectron();
/** The electron package's default export is the path of its binary when imported from Node. */
const electronBinary = /** @type {string} */ (/** @type {unknown} */ (electronPath));
const child = spawn(electronBinary, ['.'], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
