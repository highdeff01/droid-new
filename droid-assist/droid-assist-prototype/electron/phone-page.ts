/**
 * The phone companion's page: one self-contained mobile HTML page, no build step and no dependencies.
 * It polls the companion's own API, so what it shows is the engine's live state, never a copy.
 */
export function phonePage(token: string): string {
  const q = token ? `?token=${encodeURIComponent(token)}` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b1220">
<title>Droid Assist — companion</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0b1220; color: #e6edf7; font: 16px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding: 16px 14px 40px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .04em; color: #8aa0c0; margin: 22px 0 8px; }
  .muted { color: #8aa0c0; font-size: 13px; }
  .driving { display: inline-block; margin-top: 6px; padding: 4px 10px; border-radius: 999px; background: #16233a; border: 1px solid #2b3d5c; font-size: 13px; }
  .card { background: #111c2e; border: 1px solid #23324a; border-radius: 12px; padding: 12px; margin: 0 0 10px; }
  .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .grow { flex: 1; min-width: 0; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: #6b7a90; flex: none; }
  .dot.connected, .dot.ready, .dot.online { background: #34d399; }
  .dot.offline, .dot.error, .dot.failed { background: #f87171; }
  button { font: inherit; padding: 10px 14px; border-radius: 10px; border: 1px solid #2b3d5c; background: #16233a; color: #e6edf7; }
  button.primary { background: #2563eb; border-color: #2563eb; }
  button.danger { background: #7f1d1d; border-color: #7f1d1d; }
  button:disabled { opacity: .5; }
  img { width: 100%; border-radius: 12px; border: 1px solid #23324a; background: #000; }
  code { font-size: 12px; color: #8aa0c0; }
</style>
</head>
<body>
  <h1>Droid Assist</h1>
  <div class="muted" id="updated">connecting…</div>
  <div class="driving" id="driving">who is driving: —</div>

  <h2>Apps</h2>
  <div id="apps"><div class="muted">Loading…</div></div>

  <h2>Approvals</h2>
  <div id="approvals"><div class="muted">Loading…</div></div>

  <h2>Workflows</h2>
  <div id="workflows"><div class="muted">Loading…</div></div>

  <h2>Live screen</h2>
  <div id="screen"><div class="muted">No frame yet.</div></div>

<script>
const Q = ${JSON.stringify(q)};
const el = (id) => document.getElementById(id);
const api = (path, opts) => fetch(path + Q, opts).then((r) => r.json());

function card(html) { const d = document.createElement('div'); d.className = 'card'; d.innerHTML = html; return d; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

async function refresh() {
  let s;
  try { s = await api('/api/state'); } catch { el('updated').textContent = 'companion unreachable'; return; }
  if (!s.success) { el('updated').textContent = 'not authorized — open the link with the token'; return; }
  el('updated').textContent = 'updated ' + new Date(s.updatedAt).toLocaleTimeString();
  el('driving').textContent = 'who is driving: ' + (s.driving || 'neither');

  el('apps').replaceChildren(...(s.apps.length ? s.apps.map((a) =>
    card('<div class="row"><span class="dot ' + esc(a.status) + '"></span><span class="grow"><strong>' + esc(a.name) + '</strong><br><span class="muted">' + esc(a.status) + ' — ' + esc(a.detail) + '</span></span></div>')
  ) : [card('<span class="muted">No apps connected.</span>')]));

  el('approvals').replaceChildren(...(s.approvalList.length ? s.approvalList.map((a) => {
    const c = card('<div class="grow"><strong>' + esc(a.title) + '</strong><br><span class="muted">' + esc(a.detail) + '</span></div><div class="row" style="margin-top:8px"><button class="primary" data-act="approve" data-id="' + esc(a.id) + '">Approve</button><button class="danger" data-act="reject" data-id="' + esc(a.id) + '">Reject</button></div>');
    return c;
  }) : [card('<span class="muted">Nothing waiting for approval.</span>')]));

  el('workflows').replaceChildren(...(s.workflowList.length ? s.workflowList.map((w) =>
    card('<div class="row"><span class="grow"><strong>' + esc(w.name) + '</strong></span><button data-act="run" data-id="' + esc(w.id) + '">Run</button></div>')
  ) : [card('<span class="muted">No saved workflows.</span>')]));

  if (s.hasFrame) {
    const img = el('screen').querySelector('img') || document.createElement('img');
    img.alt = 'live screen';
    img.src = '/api/frame' + Q + '&t=' + Date.now();
    el('screen').replaceChildren(img);
  } else {
    el('screen').replaceChildren(card('<span class="muted">No frame yet.</span>'));
  }
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  b.disabled = true;
  const id = encodeURIComponent(b.dataset.id);
  const path = b.dataset.act === 'run' ? '/api/workflows/' + id + '/run' : '/api/approvals/' + id + '/' + b.dataset.act;
  try { await api(path, { method: 'POST' }); } finally { b.disabled = false; refresh(); }
});

refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>`;
}
