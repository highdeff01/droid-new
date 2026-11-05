import { useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import type { WorkflowStep } from './types.js';
import { PACK_MOVE_LIMIT, type WorkflowPack } from './packs.js';
import type { PacksEngine } from './use-packs.js';
import styles from './droid-assist.module.css';

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const GOAL_HINT: Record<string, string> = { input: 'from your input', ai: 'AI-generated — edit it', user: 'edited' };

/** One step of a pack: selectable for a cross-run or perform-similar, movable to another pack. */
function PackStep({ step, pack, packs }: { step: WorkflowStep; pack: WorkflowPack; packs: PacksEngine }) {
  const others = packs.packs.filter((p) => p.id !== pack.id);
  return (
    <li>
      {step.refFrame ? <img src={step.refFrame.url} alt={`Screenshot of ${step.name}`} /> : <span className={styles.noThumb}>no shot</span>}
      <label>
        <input type="checkbox" checked={packs.selection.stepIds.includes(step.id)} onChange={() => packs.selectStep(step.id)} aria-label={`Select step ${step.name}`} />
        {' '}{step.name} <small>{step.action}{step.text ? ` "${step.text}"` : ''} at ({pct(step.x)}, {pct(step.y)})</small>
      </label>
      {others.length > 0 && (
        <select aria-label={`Move ${step.name} to`} value="" onChange={(e) => packs.move(step.id, e.target.value)}>
          <option value="">Move to…</option>
          {others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}
    </li>
  );
}

/** One pack: its goal bar above it, its controls, its steps and its background test log. */
function PackCard({ pack, packs, busy }: { pack: WorkflowPack; packs: PacksEngine; busy: boolean }) {
  const recordingThis = packs.recordingPackId === pack.id;
  return (
    <article className={styles.pack} aria-label={`Pack ${pack.name}`}>
      <label className={styles.goalBar}>
        <span>Goal{pack.goalSource ? <small> ({GOAL_HINT[pack.goalSource]})</small> : null}</span>
        <input value={pack.goal} onChange={(e) => packs.setGoal(pack.id, e.target.value)} placeholder="The AI writes a goal after recording — or type one" aria-label={`Goal of ${pack.name}`} />
      </label>
      <h4>
        <label>
          <input type="checkbox" checked={packs.selection.packIds.includes(pack.id)} onChange={() => packs.selectPack(pack.id)} aria-label={`Select pack ${pack.name}`} />
          {' '}{pack.name}
        </label>
        <small>{pack.kind === 'combined' ? `combined · ${pack.steps.length} step(s)` : `${pack.steps.length}/${PACK_MOVE_LIMIT} moves`}</small>
      </h4>
      <div className={styles.row}>
        {pack.kind === 'recorded' && <button type="button" onClick={() => packs.toggleRecord(pack.id)} disabled={busy && !recordingThis}>{recordingThis ? '■ Stop recording' : '● Record'}</button>}
        <button type="button" onClick={() => void packs.runPack(pack.id)} disabled={busy || !pack.steps.length}>▶ Run</button>
        <button type="button" onClick={() => packs.deletePack(pack.id)} disabled={recordingThis}>Delete</button>
      </div>
      {pack.steps.length ? <ul className={styles.steps}>{pack.steps.map((s) => <PackStep key={s.id} step={s} pack={pack} packs={packs} />)}</ul> : <p className={styles.muted}>No moves yet — press Record and click, Alt+click (navigate), type, press keys, scroll or drag on the screen.</p>}
      {pack.tests.length > 0 && (
        <ul className={styles.log} aria-label={`Tests of ${pack.name}`}>
          {pack.tests.map((t) => <li key={t.id} data-tone={t.status === 'pass' ? 'ok' : t.status === 'fail' ? 'error' : 'warn'}><b>{t.status.toUpperCase()}{t.dry ? ' (dry run)' : ''}</b> {new Date(t.time).toLocaleTimeString()} — {t.message}</li>)}
        </ul>
      )}
    </article>
  );
}

/**
 * Workflow Packs, below the screen preview: create packs, record up to 5 moves into each, edit
 * goal bars, combine packs, move steps, run a pack or a cross-run selection, ask the AI to
 * perform a similar action (incomplete shown in red), and see each pack's background tests.
 */
export function PacksPanel({ engine }: { engine: AssistEngine }) {
  const { packs } = engine;
  const [name, setName] = useState('');
  const [input, setInput] = useState('');
  const busy = packs.running !== null || engine.replaying || (engine.recording && !packs.recordingPackId);
  const picked = packs.selection.packIds.length + packs.selection.stepIds.length;
  return (
    <section className={styles.panel} aria-label="Workflow packs">
      <h3>Workflow Packs <small>{packs.running ? `${packs.running}…` : `${packs.packs.length} pack(s)`}</small></h3>
      <form
        className={styles.row}
        onSubmit={(e) => {
          e.preventDefault();
          packs.createPack(name, input);
          setName('');
          setInput('');
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Pack name" aria-label="Pack name" />
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="What should it do? (optional goal)" aria-label="Pack goal input" />
        <button type="submit">+ New pack</button>
      </form>
      <div className={styles.row}>
        <button type="button" onClick={packs.combine} disabled={packs.selection.packIds.length < 2}>Combine selected packs</button>
        <button type="button" onClick={() => void packs.crossRun()} disabled={busy || !picked}>▶ Cross-run selection</button>
        <button type="button" onClick={() => void packs.performSimilar()} disabled={busy || !picked}>✨ Perform similar action</button>
        <button type="button" onClick={packs.clearSelection} disabled={!picked}>Clear selection</button>
        <label><input type="checkbox" checked={packs.background} onChange={(e) => packs.setBackground(e.target.checked)} /> Background tests {engine.armed ? '(real input)' : '(dry run)'}</label>
        <button type="button" onClick={() => void packs.testPacks()} disabled={busy}>Test now</button>
      </div>
      {packs.report && (packs.report.complete
        ? <p className={styles.complete} role="status">{packs.report.message}</p>
        : <p className={styles.incomplete} role="alert">{packs.report.message}</p>)}
      {packs.packs.length ? packs.packs.map((p) => <PackCard key={p.id} pack={p} packs={packs} busy={busy} />) : <p className={styles.muted}>No packs yet — create one, then record up to {PACK_MOVE_LIMIT} moves into it.</p>}
    </section>
  );
}
