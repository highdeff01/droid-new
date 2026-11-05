import { useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import { personaProgress, type Persona } from './persona.js';
import type { Lane, Sighting } from './element-relevance.js';
import styles from './droid-assist.module.css';

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** One persona's development: counts, level and the newest portfolio entries. */
function Portfolio({ persona }: { persona: Persona }) {
  const p = personaProgress(persona);
  return (
    <>
      <p>
        Level <b>{p.level}</b> · {p.did} action(s) · {p.learned} lesson(s) · {p.achieved} achievement(s)
        {p.lastActive !== null && <small> · last active {new Date(p.lastActive).toLocaleString()}</small>}
      </p>
      {!persona.entries.length && <p className={styles.muted}>No portfolio entries yet — play a turn.</p>}
      <ul className={styles.log}>
        {persona.entries.slice(0, 20).map((e) => (
          <li key={`${e.time}-${e.kind}-${e.text}`} data-tone={e.kind === 'achieved' ? 'ok' : e.kind === 'learned' ? 'warn' : 'info'}>
            <b>{e.kind}</b> {e.text} <small>· {new Date(e.time).toLocaleTimeString()}</small>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The element-relevance log of this play session, most recently seen first. */
function SightingList({ sightings }: { sightings: Sighting[] }) {
  if (!sightings.length) return <p className={styles.muted}>Elements the character sees appear here with position and relevance.</p>;
  return (
    <ol>
      {sightings.map((s) => (
        <li key={s.name}>
          <b>{s.name}</b> at ({pct(s.x)}, {pct(s.y)}) · relevance {s.relevance.toFixed(2)} <small>· turn {s.turn}</small>
        </li>
      ))}
    </ol>
  );
}

function LaneList({ lanes }: { lanes: Lane[] }) {
  if (!lanes.length) return null;
  return (
    <ul>
      {lanes.map((l) => <li key={`${l.kind}-${l.element.name}`}>{l.kind === 'act' ? '▶' : '👁'} {l.label}</li>)}
    </ul>
  );
}

/** Persona portfolios for game/character play, AI play through the mirror, and the interaction perspective. */
export function PersonaPanel({ engine }: { engine: AssistEngine }) {
  const { personas, personaId, playing, sightings, playView, lanes, mirror } = engine;
  const [name, setName] = useState('');
  const [character, setCharacter] = useState('');
  const active = personas.find((p) => p.id === personaId) ?? null;
  return (
    <section className={styles.panel} aria-label="Personas">
      <h3>Personas <small>{personas.length} portfolio(s)</small></h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          engine.addPersona(name, character);
          setName('');
          setCharacter('');
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Character name" aria-label="Persona name" />
        <input value={character} onChange={(e) => setCharacter(e.target.value)} placeholder="Who they are, how they play" aria-label="Persona character" />
        <button type="submit">Add</button>
      </form>
      <select value={personaId ?? ''} onChange={(e) => engine.selectPersona(e.target.value || null)} aria-label="Active persona">
        <option value="">— no persona —</option>
        {personas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {active && (
        <>
          <button type="button" onClick={() => void engine.playTurns(1)} disabled={playing}>Play 1 turn</button>
          <button type="button" onClick={() => void engine.playTurns(5)} disabled={playing}>Play 5 turns</button>
          <button type="button" onClick={() => engine.deletePersona(active.id)}>Delete</button>
          <p><small>{mirror.real ? 'AI input goes to the PC through the mirror' : 'AI input is a DRY RUN until armed with a connected bridge'}</small></p>
          <Portfolio persona={active} />
        </>
      )}
      <h4>Perspective <small>turn {playView.turn}</small></h4>
      <p>{playView.summary}</p>
      <LaneList lanes={lanes} />
      <h4>Element log</h4>
      <SightingList sightings={sightings} />
    </section>
  );
}
