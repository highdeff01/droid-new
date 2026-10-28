import { useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import { currentObjective, nextGoals, runningProjects, type GoalRecord } from './goal-objectives.js';
import { ALL_PROJECTS } from './knowledge-store.js';
import { isPopupEntry } from './attention.js';
import { NOTE_SECTIONS, filterNotes, noteValues, notesStream, outcomeOf, recentActions, type NoteFilter, type NoteSection, type StreamNote } from './live-briefing.js';
import styles from './droid-assist.module.css';

const clock = (t: number) => new Date(t).toLocaleTimeString();
/** Actions and notes shown at once; older ones stay in their own panels. */
const SHOWN = 15;

/**
 * Scrolls the element `id` into view and focuses it; returns false when it is no longer rendered
 * (evicted from the gallery, log or timeline).
 */
function reveal(id: string): boolean {
  const el = document.getElementById(id);
  if (!el) return false;
  el.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
  return true;
}

const GOAL_TONE: Record<GoalRecord['state'], string> = { pending: 'info', active: 'warn', achieved: 'ok', failed: 'error' };

/** Current objective with its traced state, and the queued next goals. */
function ObjectiveSection({ engine }: { engine: AssistEngine }) {
  const [draft, setDraft] = useState('');
  const current = currentObjective(engine.objectives);
  const next = nextGoals(engine.objectives);
  return (
    <div aria-label="Objective">
      <h4>Current objective</h4>
      {current ? (
        <p data-tone={GOAL_TONE[current.state]}><b>{current.text}</b> <small>· {current.state} · since {clock(current.time)}</small></p>
      ) : (
        <p className={styles.muted}>No objective yet — type a goal and press ✨ AI plan.</p>
      )}
      <h4>Next goals <small>{next.length}</small></h4>
      <ol aria-label="Next goals">
        {next.map((g) => (
          <li key={g.id}>{g.text} <button type="button" aria-label={`Drop goal ${g.text}`} onClick={() => engine.removeGoal(g.id)}>✕</button></li>
        ))}
      </ol>
      <form onSubmit={(e) => { e.preventDefault(); engine.queueNextGoal(draft); setDraft(''); }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Next goal" placeholder="Queue a next goal" />
        <button type="submit" disabled={!draft.trim()}>Queue</button>
      </form>
    </div>
  );
}

/** The AI's preferred key frames, each clickable through to the comparison gallery. */
function PreferredSection({ engine, notify }: { engine: AssistEngine; notify: (text: string) => void }) {
  const open = (id: number) => {
    if (!reveal(`frame-${id}`) && !reveal(`pinned-frame-${id}`)) notify(`Frame #${id} is no longer in the gallery.`);
  };
  return (
    <div aria-label="Preferred screenshots">
      <h4>Preferred screenshots <small>{engine.preferred.length}</small></h4>
      {!engine.preferred.length && <p className={styles.muted}>The AI and its agents mark key frames here as they work.</p>}
      <div className={styles.gallery}>
        {engine.preferred.map((p) => (
          <figure key={p.frame.id}>
            <button type="button" onClick={() => open(p.frame.id)} aria-label={`Open frame ${p.frame.id} in the gallery`}>
              <img src={p.frame.url} alt={`Preferred frame ${p.frame.id}`} />
            </button>
            <figcaption>#{p.frame.id} · {p.by} · {p.reason}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

/** Previous actions with their outcome, most recent first. */
function ActionsSection({ engine }: { engine: AssistEngine }) {
  const actions = recentActions(engine.history).slice(0, SHOWN);
  return (
    <div aria-label="Previous actions">
      <h4>Previous actions <small>{engine.history.length}</small></h4>
      {!actions.length && <p className={styles.muted}>No actions performed yet.</p>}
      <ul className={styles.log}>
        {actions.map((r) => {
          const outcome = outcomeOf(r);
          return (
            <li key={r.id} data-tone={outcome === 'failed' ? 'error' : outcome === 'ok' ? 'ok' : 'warn'}>
              <time>{clock(r.time)}</time> <b>{outcome}</b> {r.action}{r.text ? ` "${r.text}"` : ''} <small>· {r.source} · {r.message}</small>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** One picker of the notes filter; '' means any. */
function FilterPicker({ label, value, options, onChange }: { label: string; value: string | undefined; options: readonly string[]; onChange: (v: string | undefined) => void }) {
  return (
    <label>{label}{' '}
      <select aria-label={`Filter by ${label.toLowerCase()}`} value={value ?? '\u0000'} onChange={(e) => onChange(e.target.value === '\u0000' ? undefined : e.target.value)}>
        <option value={'\u0000'}>All</option>
        {options.map((o) => <option key={o} value={o}>{o || '(no project)'}</option>)}
      </select>
    </label>
  );
}

/** The running notes stream from every agent and the main AI, filterable and clickable to its source entry. */
function NotesSection({ engine, notify }: { engine: AssistEngine; notify: (text: string) => void }) {
  const [filter, setFilter] = useState<NoteFilter>({});
  // Popup entries stay in the Popups panel (attention quarantine).
  const all = notesStream(engine.log.filter((l) => !isPopupEntry(l)), engine.timeline);
  const shown = filterNotes(all, filter).slice(0, SHOWN);
  const open = (n: StreamNote) => {
    if (!reveal(`${n.ref.kind === 'log' ? 'log' : 'think'}-${n.ref.id}`)) notify(`That ${n.ref.kind === 'log' ? 'log entry' : 'thinking entry'} is no longer kept.`);
  };
  return (
    <div aria-label="Notes stream">
      <h4>Notes stream <small>{all.length}</small></h4>
      <div className={styles.group}>
        <FilterPicker label="Project" value={filter.project} options={noteValues(all, 'project')} onChange={(project) => setFilter({ ...filter, project })} />
        <FilterPicker label="Agent" value={filter.agent} options={noteValues(all, 'agent')} onChange={(agent) => setFilter({ ...filter, agent })} />
        <FilterPicker label="Section" value={filter.section} options={NOTE_SECTIONS} onChange={(section) => setFilter({ ...filter, section: section as NoteSection | undefined })} />
      </div>
      {!shown.length && <p className={styles.muted}>No notes match.</p>}
      <ul className={styles.log}>
        {shown.map((n) => (
          <li key={n.id}>
            <button type="button" onClick={() => open(n)} title={n.ref.kind === 'log' ? 'Show in the activity log' : 'Show in the Qwen thinking timeline'}>
              <time>{clock(n.time)}</time> <b>{n.agent}</b> <small>[{n.section}{n.project ? ` · ${n.project}` : ''}]</small> {n.text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** User notes: added here, stored as knowledge and injected into the target project's next AI call. */
function UserNotesSection({ engine }: { engine: AssistEngine }) {
  const [text, setText] = useState('');
  const [project, setProject] = useState(ALL_PROJECTS);
  const projects = runningProjects(engine.objectives);
  return (
    <div aria-label="User notes">
      <h4>Your notes <small>{engine.userNotes.length}</small></h4>
      <form onSubmit={(e) => { e.preventDefault(); engine.addNote(text, project); setText(''); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} aria-label="Note" placeholder="Tell the AI something" />
        <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Note project">
          <option value={ALL_PROJECTS}>All projects</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button type="submit" disabled={!text.trim()}>Add note</button>
      </form>
      <ul className={styles.log}>
        {engine.userNotes.slice(0, SHOWN).map((n) => (
          <li key={n.id}>
            <time>{clock(n.time)}</time> {n.text} <small>· {n.project === ALL_PROJECTS ? 'all projects' : n.project} · {n.injectedInto.length ? `injected into ${n.injectedInto.map((p) => p || '(no project)').join(', ')}` : 'waiting for the next AI turn'}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The always-visible live briefing dashboard: what the AI knows and is doing. */
export function LiveBriefingPanel({ engine }: { engine: AssistEngine }) {
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <section className={styles.panel} aria-label="Live briefing">
      <h3>Live briefing <small>{engine.aiWorking ? 'AI working' : 'idle'}</small></h3>
      {notice && <p className={styles.muted} role="status">{notice}</p>}
      <ObjectiveSection engine={engine} />
      <PreferredSection engine={engine} notify={setNotice} />
      <ActionsSection engine={engine} />
      <NotesSection engine={engine} notify={setNotice} />
      <UserNotesSection engine={engine} />
    </section>
  );
}
