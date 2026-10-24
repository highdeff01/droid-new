import { build } from 'esbuild';

/** Compiles the Electron main process (ESM) and the sandboxed preload (CommonJS) into dist-electron/. */
export async function buildElectron() {
  const common = { bundle: true, platform: 'node', target: 'node20', external: ['electron'], logLevel: 'info' };
  await build({ ...common, entryPoints: ['electron/main.ts'], format: 'esm', outfile: 'dist-electron/main.js' });
  await build({ ...common, entryPoints: ['electron/preload.ts'], format: 'cjs', outfile: 'dist-electron/preload.cjs' });
}

if (process.argv[1]?.endsWith('build.mjs')) await buildElectron();
