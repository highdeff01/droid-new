import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAiProxy, proxyOptionsFromEnv } from './ai-proxy.js';

/**
 * `npm run server`: the AI proxy plus the built app (dist/) on one origin, so the app reaches the
 * model without CORS. Set the AI endpoint to /api/ai/chat (Settings → Use local AI proxy).
 */

/** Default port; the desktop bridge already uses 3000. */
const DEFAULT_PORT = 3030;

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const options = proxyOptionsFromEnv(process.env);
const port = Number(process.env.PORT) || DEFAULT_PORT;

const app = createAiProxy(options);
app.use(express.static(dist));
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
// Loopback only: the proxy is unauthenticated, so it must not relay for the
// LAN. Override with HOST=0.0.0.0 only if you mean to expose it.
const host = process.env.HOST || '127.0.0.1';
app.listen(port, host, () => console.log(`[Droid Assist] AI proxy on http://${host}:${port} → ${options.upstream}`));
