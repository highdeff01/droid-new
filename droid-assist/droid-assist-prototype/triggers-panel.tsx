import { useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import { ELEMENT_EVENTS, conditionText, targetText, type ElementEvent, type Trigger, type TriggerDraft, type TriggerKind, type TriggerTarget } from './triggers.js';
import styles from './droid-assist.module.css';

/** The datetime-local value for a time (local clock, minutes). */
const localInput = (t: number) => {
  const d = new Date(t - new Date(t).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

const DRAFT_TARGET = 'draft';
/** Prefix of an operation's value in the target select (card ids have none). */
const OPERATION_PREFIX = 'op:';

const toTarget = (v: string): TriggerTarget => {
  if (v === DRAFT_TARGET) return { kind: 'draft' };
  return v.startsWith(OPERATION_PREFIX) ? { kind: 'operation', operationId: v.slice(OPERATION_PREFIX.length) } : { kind: 'card', cardId: v };
};

/** The panel form's fields, turned into a trigger draft on submit. */
interface Form {
  kind: TriggerKind;
  name: string;
  target: string;
  elementId: string;
  event: ElementEvent;
  at: string;
  everySec: number;
  cooldownSec: number;
  maxRuns: number;
}


const DRAFT_OF: Record<TriggerKind, (f: Form) => TriggerDraft> = {
  element: (f) => ({ kind: 'element', name: f.name, target: toTarget(f.target), cooldownSec: f.cooldownSec, maxRuns: f.maxRuns, elementId: f.elementId, event: f.event }),
  schedule: (f) => ({ kind: 'schedule', name: f.name, target: toTarget(f.target), cooldownSec: f.cooldownSec, maxRuns: f.maxRuns, at: new Date(f.at).getTime(), everySec: f.everySec }),
};

/** One trigger: condition, target, counters, enable toggle, Run now and delete. */
function TriggerItem({ engine, t }: { engine: AssistEngine; t: Trigger }) {
  const flow = t.target.kind === 'draft' ? 'draft card' : targetText(t.target, engine.cards, engine.operations);
  return (
    <li data-tone={t.enabled ? 'ok' : 'info'}>
      <label><input type="checkbox" checked={t.enabled} onChange={() => void engine.invoke('trigger.toggle', { id: t.id })} aria-label={`Enable ${t.name}`} /> <b>{t.name}</b></label>
      <small> · {conditionText(t, engine.elementMap)} → {flow} · cooldown {t.cooldownSec} s · runs {t.runs}{t.maxRuns ? `/${t.maxRuns}` : ''}{t.lastFired ? ` · last ${new Date(t.lastFired).toLocaleTimeString()}` : ''}</small>
      <button type="button" onClick={() => void engine.invoke('trigger.fire', { id: t.id })} title="Fires it now through the same gates (cooldown, run limit, abort, arm/disarm)">Run now</button>
      <button type="button" aria-label={`Delete ${t.name}`} onClick={() => engine.deleteTrigger(t.id)}>✕</button>
    </li>
  );
}

/** Triggers: run a saved flow or the draft card when a mapped element appears / disappears / changes, or on a schedule. */
export function TriggersPanel({ engine }: { engine: AssistEngine }) {
  const { triggers, elementMap, cards, operations, armed } = engine;
  const [form, setForm] = useState<Form>(() => ({ kind: 'element', name: '', target: DRAFT_TARGET, elementId: '', event: 'appear', at: localInput(Date.now() + 60_000), everySec: 0, cooldownSec: 30, maxRuns: 0 }));
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const elementId = form.elementId || elementMap[0]?.id || '';
  return (
    <section className={styles.panel} aria-label="Triggers">
      <h3>Triggers <small>{triggers.filter((t) => t.enabled).length}/{triggers.length} enabled · {armed ? 'real input armed' : 'disarmed: fires run as dry runs'}</small></h3>
      <p className={styles.muted}>Element triggers are evaluated on the live frame while the Screen watcher stage is on. Every fire runs the full pipeline under the guardrails and loop control.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          engine.addTrigger(DRAFT_OF[form.kind]({ ...form, elementId }));
          set({ name: '' });
        }}
      >
        <select value={form.kind} onChange={(e) => set({ kind: e.target.value as TriggerKind })} aria-label="Trigger kind">
          <option value="element">Element</option>
          <option value="schedule">Scheduled</option>
        </select>
        <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Trigger name" aria-label="Trigger name" />
        <select value={form.target} onChange={(e) => set({ target: e.target.value })} aria-label="Trigger runs">
          <option value={DRAFT_TARGET}>Draft card (current plan)</option>
          {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          {operations.map((o) => <option key={o.id} value={`${OPERATION_PREFIX}${o.id}`}>Operation: {o.name}</option>)}
        </select>
        {form.kind === 'element' ? (
          <>
            <select value={elementId} onChange={(e) => set({ elementId: e.target.value })} aria-label="Mapped element">
              {elementMap.map((el) => <option key={el.id} value={el.id}>{el.name}</option>)}
            </select>
            <select value={form.event} onChange={(e) => set({ event: e.target.value as ElementEvent })} aria-label="Element event">
              {ELEMENT_EVENTS.map((ev) => <option key={ev} value={ev}>{ev}s</option>)}
            </select>
          </>
        ) : (
          <>
            <input type="datetime-local" value={form.at} onChange={(e) => set({ at: e.target.value })} aria-label="Run at" />
            <label>every <input type="number" min={0} value={form.everySec} onChange={(e) => set({ everySec: Number(e.target.value) })} aria-label="Repeat every seconds" /> s (0 = once)</label>
          </>
        )}
        <label>cooldown <input type="number" min={0} value={form.cooldownSec} onChange={(e) => set({ cooldownSec: Number(e.target.value) })} aria-label="Cooldown seconds" /> s</label>
        <label>max runs <input type="number" min={0} value={form.maxRuns} onChange={(e) => set({ maxRuns: Number(e.target.value) })} aria-label="Run limit" /> (0 = no limit)</label>
        <button type="submit" disabled={!form.name.trim() || (form.kind === 'element' && !elementId)}>Add trigger</button>
      </form>
      <ul className={styles.log}>
        {triggers.map((t) => <TriggerItem key={t.id} engine={engine} t={t} />)}
      </ul>
    </section>
  );
}
