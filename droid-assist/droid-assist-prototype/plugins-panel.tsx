import type { AssistEngine } from './use-assist.js';
import { examplePlugin } from './example-plugin.js';
import styles from './droid-assist.module.css';

/** One plugin row: its identity, status, what it registered, and the unload control. */
function PluginRow({ record, onUnload }: { record: AssistEngine['plugins']['plugins'][number]; onUnload: () => void }) {
  const registered = [
    record.capabilityIds.length ? `${record.capabilityIds.length} capabilit${record.capabilityIds.length === 1 ? 'y' : 'ies'}` : '',
    record.commandNames.length ? `${record.commandNames.length} command${record.commandNames.length === 1 ? '' : 's'}` : '',
    record.panelIds.length ? `${record.panelIds.length} panel${record.panelIds.length === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(', ') || 'nothing';
  return (
    <li className={styles.guideFeature}>
      <div className={styles.guideFeatureHead}>
        <strong>{record.manifest?.name ?? record.manifest?.id ?? 'unknown'} <small>v{record.manifest?.version ?? '?'}</small></strong>
        <small>{record.status}{record.error ? ` — ${record.error}` : ''} · registered {registered}</small>
        {record.manifest?.description && <small>{record.manifest.description}</small>}
      </div>
      {record.status !== 'disabled' && (
        <div className={styles.row} style={{ padding: '0 var(--sp-2) var(--sp-2)' }}>
          <button type="button" onClick={onUnload} aria-label={`Unload ${record.manifest?.id}`}>Unload</button>
        </div>
      )}
    </li>
  );
}

/**
 * Settings → Plugins: the loaded plugins with what each registered, the example plugin to load and
 * unload, and the plugin log. Loading is by module, so nothing here runs untrusted code from the web.
 */
export function PluginsPanel({ engine }: { engine: AssistEngine }) {
  const { plugins } = engine;
  const loaded = plugins.plugins.some((p) => p.manifest?.id === examplePlugin.manifest.id && p.status === 'active');
  return (
    <section className={styles.panel}>
      <h3>Plugins <small>{plugins.plugins.length} known · {plugins.capabilities.length} capabilities</small></h3>
      <p className={styles.muted}>A plugin adds capabilities, commands and panels through a sandboxed API; its capabilities join the registry so the AI invokes them like built-ins.</p>
      <span className={styles.row}>
        <button type="button" onClick={() => void plugins.load(examplePlugin)} disabled={loaded} aria-label="Load example plugin">Load example plugin</button>
      </span>
      {plugins.plugins.length === 0 && <p className={styles.muted}>No plugins loaded yet.</p>}
      <ul className={styles.guideList}>
        {plugins.plugins.map((record) => (
          <PluginRow key={record.manifest?.id} record={record} onUnload={() => void plugins.unload(record.manifest.id)} />
        ))}
      </ul>
      {plugins.commands.length > 0 && (
        <>
          <h4>Plugin commands</h4>
          <ul className={styles.guideList}>
            {plugins.commands.map((c) => <li key={c.name} className={styles.muted}><code>/{c.name}</code> — {c.usage}</li>)}
          </ul>
        </>
      )}
      {plugins.logs.length > 0 && (
        <>
          <h4>Plugin log</h4>
          <ul className={styles.guideList}>
            {plugins.logs.slice(-10).map((line, i) => <li key={i} className={styles.muted}>{line}</li>)}
          </ul>
        </>
      )}
    </section>
  );
}
