import { useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import type { SavedOperation } from './saved-operations.js';
import styles from './droid-assist.module.css';

/** Save the current steps, or ask the AI to plan a request, as a named operation. */
function SaveForm({ engine }: { engine: AssistEngine }) {
  const [name, setName] = useState('');
  const [request, setRequest] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (request.trim()) void engine.planOperation(request, name.trim() || request);
        else engine.saveOperation(name, engine.goal);
        setName('');
        setRequest('');
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Operation name" aria-label="Operation name" />
      <input value={request} onChange={(e) => setRequest(e.target.value)} placeholder='Ask the AI, e.g. "go to chrome and open youtube" (empty = save the current steps)' aria-label="Operation request" />
      <button type="submit" disabled={!name.trim() && !request.trim()}>{request.trim() ? 'Plan with AI and save' : 'Save current steps'}</button>
    </form>
  );
}

/** One saved operation: goal, steps, screenshots, counters, Run, Retry best and delete. */
function OperationItem({ engine, op }: { engine: AssistEngine; op: SavedOperation }) {
  return (
    <li data-tone={op.runs && op.successes === op.runs ? 'ok' : 'info'}>
      <b>{op.name}</b>
      <small> · {op.goal} · {op.steps.length} step(s) · {op.screenshots.length} screenshot(s) · {op.successes}/{op.runs} real run(s) succeeded · {op.source}</small>
      {op.screenshots.at(-1) && <img src={op.screenshots.at(-1)!.url} alt={`${op.name} reference`} width={96} />}
      <button type="button" onClick={() => void engine.runOperation(op.id)}>Run</button>
      <button type="button" onClick={() => void engine.retryBest(op.id)}>Retry best</button>
      <button type="button" aria-label={`Delete ${op.name}`} onClick={() => engine.deleteOperation(op.id)}>✕</button>
    </li>
  );
}

/** The main app's recent actions (the Settings playback window): step through them (no input) or replay them (dry run unless armed). */
function PlaybackView({ engine }: { engine: AssistEngine }) {
  const { playback, playbackIndex, armed } = engine;
  const entry = playback?.entries[playbackIndex];
  return (
    <>
      <h4>Playback of the last {engine.settings.playbackWindowSec} seconds</h4>
      <button type="button" onClick={() => void engine.loadPlayback()}>Load from main app</button>
      {playback && (
        <>
          <p className={styles.muted}>{playback.entries.length} action(s) · {armed ? 'Replay sends real input' : 'Replay is a dry run (real input disarmed)'}</p>
          {entry && (
            <div aria-label="Playback step">
              <button type="button" onClick={() => engine.showPlaybackStep(playbackIndex - 1)} disabled={playbackIndex === 0}>◀</button>
              <span> {playbackIndex + 1}/{playback.entries.length}: {entry.step.name} </span>
              <button type="button" onClick={() => engine.showPlaybackStep(playbackIndex + 1)} disabled={playbackIndex >= playback.entries.length - 1}>▶</button>
              {entry.shot ? <img src={entry.shot} alt={`Screenshot at ${entry.step.name}`} width={240} /> : <small> (no screenshot)</small>}
            </div>
          )}
          <button type="button" onClick={() => void engine.replayPlayback()} disabled={!playback.entries.length}>Replay</button>
          <button type="button" onClick={() => engine.saveOperation(`Playback ${new Date(playback.at).toLocaleTimeString()}`, `Repeat the actions of the last ${playback.windowSec} seconds`, 'playback', playback.entries.map((e) => e.step))} disabled={!playback.entries.length}>Save as operation</button>
        </>
      )}
    </>
  );
}

/** Saved operations, AI suggestions, playback, and the recently performed operations with retry. */
export function OperationsPanel({ engine }: { engine: AssistEngine }) {
  const { operations, suggested, detected, settings } = engine;
  return (
    <section className={styles.panel} aria-label="Operations">
      <h3>Operations <small>{operations.length} saved · retries {settings.operationRetries}</small></h3>
      <SaveForm engine={engine} />
      {suggested.length > 0 && <p className={styles.muted}>AI suggests: {suggested.map((o) => o.name).join(', ')}</p>}
      <ul className={styles.log}>
        {operations.map((op) => <OperationItem key={op.id} engine={engine} op={op} />)}
      </ul>
      <h4>Recently performed</h4>
      {detected.length ? (
        <ul className={styles.log}>
          {detected.map((d) => (
            <li key={d.op.id}>
              {d.op.name} <small>({d.via === 'run' ? 'run' : 'performed steps'}, {new Date(d.time).toLocaleTimeString()})</small>
              <button type="button" onClick={() => void engine.retryBest(d.op.id)}>Retry best variant</button>
            </li>
          ))}
        </ul>
      ) : <p className={styles.muted}>No saved operation detected in the recent runs.</p>}
      <PlaybackView engine={engine} />
    </section>
  );
}
