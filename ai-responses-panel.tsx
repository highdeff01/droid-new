import { useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import { RESPONSE_SOURCES, aiResponses, currentActivity, filterResponses, type AiResponse, type ResponseSource } from './ai-responses.js';
import styles from './droid-assist.module.css';

const clock = (t: number) => new Date(t).toLocaleTimeString();

/** One full response with its source, the model's thinking and links to its timeline and log entries. */
function ResponseItem({ response }: { response: AiResponse }) {
  const { entry, source, logId } = response;
  return (
    <li data-tone={entry.error ? 'error' : 'info'}>
      <time>{clock(entry.time)}</time> <b>{entry.step}</b> · {source}{entry.project ? ` · ${entry.project}` : ''}
      {entry.error ? <p role="alert">AI call failed — {entry.error}</p> : <p style={{ whiteSpace: 'pre-wrap' }}>{entry.text || '(no answer)'}</p>}
      {entry.thinking && <details><summary>Thinking</summary><pre className={styles.muted}>{entry.thinking}</pre></details>}
      <small>
        <a href={`#think-${entry.id}`}>thinking entry</a>
        {logId && <> · <a href={`#log-${logId}`}>log entry</a></>}
      </small>
    </li>
  );
}

/** Full AI responses: every reply on the thinking timeline (agents, findings, attempts, verdicts, tests) with what the AI does now and next. */
export function AiResponsesPanel({ engine }: { engine: AssistEngine }) {
  const [source, setSource] = useState<ResponseSource | ''>('');
  const { doing, next } = currentActivity(engine.steps, engine.objectives);
  const shown = filterResponses(aiResponses(engine.timeline, engine.log), source || undefined);
  return (
    <section className={styles.panel} aria-label="AI responses">
      <h3>AI responses <small>{shown.length}</small></h3>
      <p><b>Now:</b> {doing}</p>
      <h4>Next</h4>
      {next.length ? <ol aria-label="Plans next">{next.map((n, i) => <li key={i}>{n}</li>)}</ol> : <p className={styles.muted}>Nothing planned.</p>}
      <label>
        Source{' '}
        <select aria-label="Response source" value={source} onChange={(e) => setSource(e.target.value as ResponseSource | '')}>
          <option value="">all</option>
          {RESPONSE_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      {!shown.length && <p className={styles.muted}>No AI responses yet.</p>}
      <ul className={styles.log} aria-label="Responses">
        {shown.map((r) => <ResponseItem key={r.entry.id} response={r} />)}
      </ul>
    </section>
  );
}
