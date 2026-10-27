import { useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import { NOTE_TAGS, SECTION_SCOPES, type KnowledgeSection, type NoteTag, type SectionScope } from './knowledge-sections.js';
import { actorLabel, portfolioActors, queryPortfolio, type PortfolioKind } from './portfolio.js';
import type { LogEntry } from './types.js';
import styles from './droid-assist.module.css';

const clock = (t: number) => new Date(t).toLocaleString();
const TAG_TONE: Record<NoteTag, LogEntry['tone']> = { recent: 'info', important: 'ok', blacklist: 'error' };
const KIND_LABEL: Record<PortfolioKind, string> = { note: 'Note', method: 'Method', work: 'Work', result: 'Result' };

/** One section: rename in place, its notes (tagged, optionally scoped to an operation) and a note form. */
function SectionView({ engine, section }: { engine: AssistEngine; section: KnowledgeSection }) {
  const kb = engine.knowledge;
  const [name, setName] = useState(section.name);
  const [text, setText] = useState('');
  const [tag, setTag] = useState<NoteTag>('recent');
  const [operation, setOperation] = useState('');
  const addNote = () => {
    kb.addSectionNote(section.id, { text, tag, operation });
    setText('');
  };
  return (
    <div className={styles.card}>
      <div className={styles.row}>
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label={`Section name ${section.name}`} />
        <button type="button" onClick={() => kb.renameSection(section.id, name)} disabled={name.trim() === section.name}>Rename</button>
        <button type="button" aria-label={`Delete section ${section.name}`} onClick={() => kb.deleteSection(section.id)}>✕</button>
      </div>
      <small>{section.scope} · {section.notes.length} note(s) · updated {clock(section.updated)}</small>
      <ul className={styles.log} aria-label={`Notes of ${section.name}`}>
        {section.notes.map((n) => (
          <li key={n.id} data-tone={TAG_TONE[n.tag]}>
            <b>{n.tag}</b> {n.text}{n.operation && <small> · for "{n.operation}"</small>}
            <button type="button" aria-label={`Remove note ${n.text}`} onClick={() => kb.removeSectionNote(section.id, n.id)}>✕</button>
          </li>
        ))}
      </ul>
      <div className={styles.row}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Note or method" aria-label={`New note for ${section.name}`} />
        <select value={tag} onChange={(e) => setTag(e.target.value as NoteTag)} aria-label={`Note tag for ${section.name}`}>
          {NOTE_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input value={operation} onChange={(e) => setOperation(e.target.value)} placeholder="Only for operation (optional)" aria-label={`Note operation for ${section.name}`} />
        <button type="button" onClick={addNote}>Add note</button>
      </div>
    </div>
  );
}

/** The sectioned knowledge store: create sections per topic/project/agent and browse them one at a time. */
export function KnowledgePanel({ engine }: { engine: AssistEngine }) {
  const { sections } = engine.knowledge;
  const [name, setName] = useState('');
  const [scope, setScope] = useState<SectionScope>('topic');
  const [openId, setOpenId] = useState<string | null>(null);
  const open = sections.find((s) => s.id === openId) ?? null;
  const create = () => {
    engine.knowledge.createSection(name, scope);
    setName('');
  };
  return (
    <section className={styles.panel}>
      <h3>Knowledge sections <small>{sections.length}</small></h3>
      <div className={styles.row}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Topic, project or agent id" aria-label="New section name" />
        <select value={scope} onChange={(e) => setScope(e.target.value as SectionScope)} aria-label="New section scope">
          {SECTION_SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button type="button" onClick={create}>Create section</button>
      </div>
      {!sections.length && <p className={styles.muted}>A section whose name an operation mentions (or the agent it belongs to) is cross-referenced before that operation: important and blacklisted notes always, the newest recent ones too.</p>}
      <div className={styles.cards}>
        {sections.map((s) => (
          <button type="button" key={s.id} className={styles.savedCard} aria-pressed={s.id === openId} onClick={() => setOpenId(s.id === openId ? null : s.id)}>
            <strong>{s.name}</strong>
            <small>{s.scope} · {s.notes.length} note(s)</small>
          </button>
        ))}
      </div>
      {open && <SectionView key={open.id} engine={engine} section={open} />}
    </section>
  );
}

/** Each agent's and each AI's own portfolio: notes, methods, work and results with their source operation. */
export function PortfoliosPanel({ engine }: { engine: AssistEngine }) {
  const { portfolios } = engine.knowledge;
  const actors = portfolioActors(portfolios);
  const [picked, setPicked] = useState('');
  const actor = actors.includes(picked) ? picked : actors[0] ?? '';
  const names = Object.fromEntries(engine.agents.map((a) => [a.id, a.name]));
  const label = (a: string) => actorLabel(a, names, engine.settings.aiModel);
  const [note, setNote] = useState('');
  const addNote = () => {
    if (!actor || !note.trim()) return;
    engine.knowledge.recordFor(actor, 'note', note.trim());
    setNote('');
  };
  return (
    <section className={styles.panel}>
      <h3>Portfolios <small>{actors.length} actor(s)</small></h3>
      {!actors.length && <p className={styles.muted}>Every agent and AI model gets its own portfolio as it works: plans, verdicts, learned methods and step results.</p>}
      {actors.length > 0 && (
        <select value={actor} onChange={(e) => setPicked(e.target.value)} aria-label="Portfolio actor">
          {actors.map((a) => <option key={a} value={a}>{label(a)}</option>)}
        </select>
      )}
      {actors.length > 0 && (
        <div className={styles.row}>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for this portfolio" aria-label="New portfolio note" />
          <button type="button" onClick={addNote} disabled={!note.trim()}>Add note</button>
        </div>
      )}
      <ul className={styles.log} aria-label="Portfolio entries">
        {queryPortfolio(portfolios, { actor }).map((e) => (
          <li key={e.id} data-tone={e.ok === undefined ? 'info' : e.ok ? 'ok' : 'error'}>
            <b>{KIND_LABEL[e.kind]}</b> {e.text}
            <small> · {clock(e.time)}{e.source.operation ? ` · op "${e.source.operation}"` : ''}{e.source.opId ? ` (${e.source.opId})` : ''}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The user-habit profile: habits, goals and preferences learned from approvals, saves and corrections, with suggestions. */
export function ProfilePanel({ engine }: { engine: AssistEngine }) {
  const { profileSummary: s, profile, suggestions } = engine.knowledge;
  const tips = suggestions(engine.goal);
  return (
    <section className={styles.panel}>
      <h3>Your profile <small>{profile.length} signal(s)</small></h3>
      {!profile.length && <p className={styles.muted}>Approved commands, saved workflows and your corrections build this profile; it feeds planning and suggestions.</p>}
      <ul className={styles.log} aria-label="User profile">
        {s.habits.map((h) => <li key={`h:${h.text}`}><b>Habit</b> {h.text} <small>×{h.count}</small></li>)}
        {s.goals.map((g) => <li key={`g:${g.text}`}><b>Goal</b> {g.text} <small>×{g.count}</small></li>)}
        {s.preferences.map((p) => <li key={`p:${p}`} data-tone="warn"><b>Preference</b> {p}</li>)}
      </ul>
      {tips.length > 0 && (
        <ul className={styles.log} aria-label="Suggestions">
          {tips.map((t) => <li key={t} data-tone="ok"><b>Suggestion</b> {t}</li>)}
        </ul>
      )}
    </section>
  );
}
