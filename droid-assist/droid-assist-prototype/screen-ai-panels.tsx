import { useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import { inventoryLine, stateCounts } from './screen-inventory.js';
import { routeText } from './route-plot.js';
import { fixScriptText } from './fix-script.js';
import { parseSelection, retestText } from './retest.js';
import styles from './droid-assist.module.css';

/** Full-screen reading: every element detected on the current frame of the active capture source. */
export function InventoryPanel({ engine }: { engine: AssistEngine }) {
  const { inventory, source } = engine;
  const counts = stateCounts(inventory);
  return (
    <section className={styles.panel} aria-label="Screen inventory">
      <h3>Screen inventory <small>{inventory.length} element(s) · {source} · {counts.static} static / {counts.moved} moved / {counts['in-motion']} in motion</small></h3>
      {!inventory.length && <p className={styles.muted}>No frame read yet.</p>}
      <ul className={styles.log}>
        {inventory.map((e) => <li key={e.id} data-tone={e.state === 'static' ? 'info' : 'warn'}>{inventoryLine(e)}</li>)}
      </ul>
    </section>
  );
}

/** Route plotting: ranked routes to the goal through the inventory, and the saved access-path profiles. */
export function RoutesPanel({ engine }: { engine: AssistEngine }) {
  const { routes, routeProfiles, goal, replaying } = engine;
  return (
    <section className={styles.panel} aria-label="Routes">
      <h3>Routes <small>{routeProfiles.length} saved access path(s)</small></h3>
      <button type="button" onClick={() => engine.plotRoute()} disabled={!goal.trim()}>Plot routes to goal</button>
      {!routes.length && <p className={styles.muted}>No routes plotted.</p>}
      <ol>
        {routes.map((r, i) => (
          <li key={i}>
            {routeText(r)} <button type="button" onClick={() => void engine.runRoute(i)} disabled={replaying}>Run</button>
          </li>
        ))}
      </ol>
      {routeProfiles.length > 0 && (
        <ul className={styles.log}>
          {routeProfiles.map((p) => <li key={p.id}><b>{p.goal}</b> · {p.successes}/{p.uses} worked · {p.hops.map((h) => h.name).join(' → ')}</li>)}
        </ul>
      )}
    </section>
  );
}

/** The fix script awaiting review: its steps, with Run (through the guardrails) and Dismiss. */
export function FixScriptReview({ engine }: { engine: AssistEngine }) {
  const { pendingFix, armed, aborted, replaying } = engine;
  if (!pendingFix) return null;
  return (
    <div role="alert" aria-label="Fix script review">
      <h4>Fix script for review <small>{pendingFix.source} · {armed ? 'armed' : 'dry run'}</small></h4>
      <p>{pendingFix.context.problem} — {pendingFix.reason}</p>
      <ol>{pendingFix.steps.map((s) => <li key={s.id}>{s.action}{s.text ? ` "${s.text}"` : ''}{s.target ? ` "${s.target}"` : ''} — {s.name}</li>)}</ol>
      <p className={styles.muted}>{fixScriptText(pendingFix)}</p>
      <button type="button" onClick={() => void engine.runFixScript()} disabled={aborted || replaying}>Run fix script</button>
      <button type="button" onClick={engine.dismissFix}>Dismiss</button>
    </div>
  );
}

/** Flow retest ("route back"): re-run the flow or selected steps, with per-step results and the verdict. */
export function RetestPanel({ engine }: { engine: AssistEngine }) {
  const { retest, steps, replaying, fixMethods } = engine;
  const [selection, setSelection] = useState('');
  return (
    <section className={styles.panel} aria-label="Flow retest">
      <h3>Flow retest <small>{fixMethods.length} fix method(s) remembered</small></h3>
      <label>
        Steps <input value={selection} onChange={(e) => setSelection(e.target.value)} placeholder="all, or e.g. 2, 4-5" />
      </label>
      <button type="button" onClick={() => void engine.retestFlow(parseSelection(selection))} disabled={!steps.length || replaying}>Route back</button>
      {!retest && <p className={styles.muted}>No retest yet.</p>}
      {retest && (
        <>
          <p data-tone={retest.summary.pass ? 'ok' : 'error'}><b>{retestText(retest.summary)}</b></p>
          <ul className={styles.log}>
            {retest.results.map((r) => (
              <li key={r.stepId} data-tone={r.ok ? 'ok' : 'error'}>
                <b>{r.index + 1}. {r.name}</b> {r.ok ? 'passed' : 'failed'} — {r.message}{r.obstacle ? ` · obstacle: ${r.obstacle}` : ''}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
