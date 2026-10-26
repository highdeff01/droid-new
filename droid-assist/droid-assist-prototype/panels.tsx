import { useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import { frameDistance } from './drift.js';
import { checkBridge } from './bridge.js';
import { hotkeyFromEvent, sanitizeBudget } from './safety.js';
import { AiStatusBadge } from './hud.js';
import type { Habit, LogEntry } from './types.js';
import { isReliable, successRate } from './habits.js';
import type { ThinkingEntry, ThoughtKind } from './thinking-timeline.js';
import type { ElementSource, ScreenElement } from './elements.js';
import { gridRef } from './grid.js';
import styles from './droid-assist.module.css';

/** The N most recent frames with frame-to-frame drift, plus the AI-picked frames shown to the user. */
export function ComparisonGallery({ engine }: { engine: AssistEngine }) {
  const { frames, pinned } = engine;
  return (
    <section className={styles.panel}>
      <h3>Comparison gallery <small>{frames.length} recent frames</small></h3>
      <div className={styles.gallery}>
        {frames.map((f, i) => {
          const d = frames[i + 1] ? frameDistance(frames[i + 1].data, f.data) : 0;
          return (
            <figure key={f.id} className={d > 0.04 ? styles.changed : ''}>
              <img src={f.url} alt={`Frame ${f.id}`} />
              <figcaption>#{f.id} · Δ {d.toFixed(3)}</figcaption>
            </figure>
          );
        })}
      </div>
      {pinned.length > 0 && (
        <>
          <h4>AI-selected screenshots <small>most informative state changes from the last run</small></h4>
          <div className={styles.gallery}>
            {pinned.map((f) => (
              <figure key={f.id} className={styles.pinned}>
                <img src={f.url} alt={`Selected frame ${f.id}`} />
                <figcaption>#{f.id}</figcaption>
              </figure>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/** Live task assembly: the workflow's steps with status, drift and inline editing. */
export function WorkflowPanel({ engine }: { engine: AssistEngine }) {
  const { steps, setSteps, draftCard, setDraftCard } = engine;
  return (
    <section className={styles.panel}>
      <h3>Workflow <small>{steps.length} step(s)</small></h3>
      {!steps.length && <p className={styles.muted}>Record, or type a goal and press ✨ AI plan.</p>}
      <ol className={styles.steps}>
        {steps.map((s, i) => (
          <li key={s.id} data-status={s.status}>
            {s.shot ? <img src={s.shot.url} alt={`After step ${i + 1}`} title="Desktop screenshot after this step ran" /> : s.refFrame ? <img src={s.refFrame.url} alt="" /> : <span className={styles.noThumb}>{s.action}</span>}
            <div>
              <input value={s.name} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label={`Step ${i + 1} name`} />
              <small>
                {s.action}{s.target ? ` "${s.target}"` : ''} @ {(s.x * 100).toFixed(0)}%,{(s.y * 100).toFixed(0)}% · {s.status}
                {s.driftPx !== undefined && ` · drift ${s.driftPx}px`}
                {s.drift !== undefined && ` · match ${s.drift.toFixed(3)}`}
              </small>
              {(s.beforeFrame || s.afterFrame) && (
                <span className={styles.evidence} aria-label={`Step ${i + 1} evidence`}>
                  {s.beforeFrame && <img src={s.beforeFrame.url} alt={`Step ${i + 1} before`} title="Before" />}
                  {s.afterFrame && <img src={s.afterFrame.url} alt={`Step ${i + 1} after`} title="After" />}
                </span>
              )}
            </div>
            <button type="button" aria-label="Remove step" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>✕</button>
          </li>
        ))}
      </ol>
      {draftCard && (
        <div className={styles.card}>
          <input value={draftCard.name} onChange={(e) => setDraftCard({ ...draftCard, name: e.target.value })} aria-label="Workflow name" />
          <textarea value={draftCard.description} onChange={(e) => setDraftCard({ ...draftCard, description: e.target.value })} aria-label="Workflow description" />
          <button type="button" className={styles.primary} onClick={engine.saveCard}>💾 Save</button>
        </div>
      )}
    </section>
  );
}

/** Saved workflow cards for comparison and later selection. */
export function LibraryPanel({ engine }: { engine: AssistEngine }) {
  return (
    <section className={styles.panel}>
      <h3>Saved workflows <small>{engine.cards.length}</small></h3>
      {!engine.cards.length && <p className={styles.muted}>Saved cards appear here. The planner reuses similar ones automatically.</p>}
      <div className={styles.cards}>
        {engine.cards.map((c) => (
          <button type="button" key={c.id} className={styles.savedCard} onClick={() => engine.loadCard(c)}>
            <strong>{c.name}</strong>
            <span>{c.description}</span>
            <small>{c.steps.length} steps · {new Date(c.savedAt).toLocaleTimeString()}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

/** One habit: its counts, rate, last use and lessons; unreliable ones are flagged and not auto-applied. */
function HabitItem({ habit: h, engine }: { habit: Habit; engine: AssistEngine }) {
  const reliable = isReliable(h);
  return (
    <li data-tone={reliable ? 'ok' : 'warn'}>
      <b>{h.pinned ? '📌 ' : ''}{h.target}</b>{h.context && <small> · {h.context}</small>}
      {' '}<span>{h.successes} ok / {h.attempts - h.successes} failed · {Math.round(successRate(h) * 100)}%</span>
      {!reliable && <strong> · unreliable — not auto-applied</strong>}
      <small> · last used {new Date(h.lastUsed).toLocaleString()}</small>
      <button type="button" aria-label={`${h.pinned ? 'Unpin' : 'Pin'} habit ${h.target}`} onClick={() => engine.pinHabit(h.id)}>{h.pinned ? 'Unpin' : 'Pin'}</button>
      <button type="button" aria-label={`Delete habit ${h.target}`} onClick={() => engine.deleteHabit(h.id)}>✕</button>
      {h.lessons.length > 0 && (
        <ul>
          {h.lessons.map((l) => <li key={`${l.kind}:${l.text}`}><b>{l.kind === 'avoid' ? 'Avoid' : 'Add'}</b> {l.text}</li>)}
        </ul>
      )}
    </li>
  );
}

/**
 * Habits learned from every executed step (applied to planning and grounding while reliable),
 * then the run-level lessons the planner applies to new goals.
 */
export function PatternsPanel({ engine }: { engine: AssistEngine }) {
  return (
    <section className={styles.panel}>
      <h3>Habits <small>{engine.habits.length}</small></h3>
      {!engine.habits.length && <p className={styles.muted}>Each executed step's verdict builds a habit for its target: success rate, last good position and lessons.</p>}
      <ul className={styles.log} aria-label="Habits">
        {engine.habits.map((h) => <HabitItem key={h.id} habit={h} engine={engine} />)}
      </ul>
      <h3>Learned patterns <small>{engine.patterns.length}</small></h3>
      {!engine.patterns.length && <p className={styles.muted}>After each real run the AI notes what to avoid and what to add next time.</p>}
      <ul className={styles.log}>
        {engine.patterns.map((p) => (
          <li key={p.id} data-tone={p.kind === 'avoid' ? 'warn' : 'ok'}>
            <b>{p.kind === 'avoid' ? 'Avoid' : 'Add'}</b> {p.pattern}
            {p.context && <small> · {p.context}</small>}
            <button type="button" aria-label={`Delete pattern ${p.pattern}`} onClick={() => engine.deletePattern(p.id)}>✕</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Watcher / monitor agents and settings (gallery size, drift checkpoints, capture rate, bridge). */
export function AgentsPanel({ engine }: { engine: AssistEngine }) {
  const { agents, setAgents, settings, setSettings } = engine;
  const [bridge, setBridge] = useState('');
  return (
    <section className={styles.panel}>
      <h3>Agents</h3>
      {agents.map((a) => (
        <label key={a.id} className={styles.agent}>
          <input type="checkbox" checked={a.on} onChange={(e) => setAgents(agents.map((x) => (x.id === a.id ? { ...x, on: e.target.checked } : x)))} />
          <span><strong>{a.name}</strong><small>{a.description}</small></span>
        </label>
      ))}
      <h3>Settings</h3>
      <label className={styles.setting}>Gallery frames <b>{settings.gallerySize}</b>
        <input type="range" min={4} max={30} value={settings.gallerySize} onChange={(e) => setSettings({ ...settings, gallerySize: +e.target.value })} />
      </label>
      <label className={styles.setting}>Drift checkpoints per move <b>{settings.checkpoints}</b>
        <input type="range" min={1} max={20} value={settings.checkpoints} onChange={(e) => setSettings({ ...settings, checkpoints: +e.target.value })} />
      </label>
      <label className={styles.setting}>App monitor: capture every <b>{settings.captureMs} ms</b>
        <small>Background monitor is fixed at 1000 ms, advanced at 250 ms. Active: {engine.intervalMs} ms</small>
        <input type="range" min={250} max={2000} step={50} value={settings.captureMs} onChange={(e) => setSettings({ ...settings, captureMs: +e.target.value })} />
      </label>
      <label className={styles.setting}>Max real input actions per run <b>{settings.actionBudget}</b>
        <input type="number" min={1} value={settings.actionBudget} onChange={(e) => setSettings({ ...settings, actionBudget: sanitizeBudget(e.target.valueAsNumber) })} />
      </label>
      <label className={styles.setting}>Emergency-stop hotkey <b>{settings.abortHotkey}</b>
        <input
          readOnly
          value={settings.abortHotkey}
          aria-label="Emergency-stop hotkey: focus and press a new key combo"
          onKeyDown={(e) => {
            const combo = hotkeyFromEvent(e);
            if (!combo || combo === 'Tab') return;
            e.preventDefault();
            e.stopPropagation();
            setSettings({ ...settings, abortHotkey: combo });
          }}
        />
        <small>Focus the field and press a new combo (works while this page has focus).</small>
      </label>
      <label className={styles.setting}>Desktop bridge URL (pyautogui)
        <span className={styles.row}>
          <input value={settings.bridgeUrl} onChange={(e) => setSettings({ ...settings, bridgeUrl: e.target.value })} placeholder="/bridge or http://127.0.0.1:3000" />
          <button type="button" onClick={async () => setBridge((await checkBridge(settings.bridgeUrl)).message)} disabled={!settings.bridgeUrl}>Test</button>
          <button type="button" onClick={() => void engine.connectBridge()} disabled={!settings.bridgeUrl}>Connect</button>
        </span>
        {bridge && <small>{bridge}</small>}
      </label>
      <label className={styles.setting}>AI endpoint (Ollama /api/chat)
        <input value={settings.aiUrl} onChange={(e) => setSettings({ ...settings, aiUrl: e.target.value })} aria-label="AI endpoint URL" />
      </label>
      <label className={styles.setting}>AI model
        <input value={settings.aiModel} onChange={(e) => setSettings({ ...settings, aiModel: e.target.value })} aria-label="AI model" />
      </label>
      <AiStatusBadge status={engine.aiStatus} />
    </section>
  );
}

/** AI help: ask the model about the live screen; shows its latest answer or the connection error. */
export function AiHelpPanel({ engine }: { engine: AssistEngine }) {
  const { aiStatus, aiAnswer, aiBusy, settings } = engine;
  const [question, setQuestion] = useState('');
  const off = aiStatus.state !== 'online' || !settings.aiHelp;
  return (
    <section className={styles.panel}>
      <h3>AI help <small>{settings.aiModel}</small></h3>
      <AiStatusBadge status={aiStatus} />
      <form
        className={styles.row}
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim()) void engine.askScreen(question.trim());
        }}
      >
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about the screen…" aria-label="Ask the AI" />
        <button type="submit" disabled={off || aiBusy || !question.trim()}>{aiBusy ? '…' : 'Ask'}</button>
      </form>
      {aiStatus.state === 'offline' && <p className={styles.muted} role="alert">{aiStatus.detail}. AI plan, Auto act and AI help are unavailable.</p>}
      {aiAnswer && <p>{aiAnswer}</p>}
    </section>
  );
}

/** Persistent history of every executed mouse/keyboard action, with JSON/CSV export. */
export function ActionHistoryPanel({ engine }: { engine: AssistEngine }) {
  const { history } = engine;
  return (
    <section className={styles.panel}>
      <h3>Action history <small>{history.length} action(s)</small></h3>
      <div className={styles.row}>
        <button type="button" onClick={() => engine.exportHistory('json')} disabled={!history.length}>Export JSON</button>
        <button type="button" onClick={() => engine.exportHistory('csv')} disabled={!history.length}>Export CSV</button>
        <button type="button" onClick={engine.resetHistory} disabled={!history.length}>Clear</button>
      </div>
      <ul className={styles.log}>
        {history.slice(0, 200).map((a) => (
          <li key={a.id} data-tone={a.ok ? 'ok' : 'error'}>
            <time>{new Date(a.time).toLocaleTimeString()}</time> <b>{a.source}</b> {a.action} ({a.x}, {a.y}){a.text ? ` "${a.text}"` : ''} · {a.via}
          </li>
        ))}
      </ul>
    </section>
  );
}

const SOURCE_LABEL: Record<ElementSource, string> = { template: 'Template match', popup: 'Popup detected', familiar: 'Familiar' };

/** One listed element: name, source, grid cell + coordinates, its patch and the Test click button. */
function ElementItem({ engine, el }: { engine: AssistEngine; el: ScreenElement }) {
  return (
    <li data-tone={el.source === 'popup' ? 'warn' : 'info'}>
      {el.patch && <img src={el.patch} alt={`${el.name} patch`} width={32} height={32} />}
      <b>{el.name}</b> <small>{SOURCE_LABEL[el.source]}</small> · {gridRef(el)} = ({(el.x * 100).toFixed(1)}%, {(el.y * 100).toFixed(1)}%)
      {el.lastSeen !== undefined && <small> · seen {new Date(el.lastSeen).toLocaleTimeString()}</small>}
      <button type="button" onClick={() => void engine.testClick(el)} title={engine.armed ? 'Clicks this point on the PC (real input, budgeted)' : 'Highlights this point only (disarmed dry run)'}>
        Test click
      </button>
      {el.source === 'familiar' && <button type="button" aria-label={`Forget ${el.name}`} onClick={() => engine.forgetFamiliar(el.id)}>✕</button>}
    </li>
  );
}

/** On-screen elements found by template matching and popup detection, plus the familiar-elements memory. */
export function ElementsPanel({ engine }: { engine: AssistEngine }) {
  const { elements, armed } = engine;
  return (
    <section className={styles.panel} aria-label="Elements">
      <h3>Elements <small>{elements.length} · Test click {armed ? 'sends real input' : 'is highlight-only (disarmed)'}</small></h3>
      {!elements.length && <p className={styles.muted}>Verified or used targets are remembered here with their grid cell and coordinates.</p>}
      <ul className={styles.log}>
        {elements.map((el) => <ElementItem key={el.id} engine={engine} el={el} />)}
      </ul>
    </section>
  );
}

const KIND_LABEL: Record<ThoughtKind, string> = { thought: '💭 Thought', reflection: '🔁 Reflection', verdict: '⚖️ Verdict' };

/** Tone of an entry: failures as errors, verdicts by their outcome, the rest informational. */
function entryTone(e: ThinkingEntry): LogEntry['tone'] {
  if (e.error) return 'error';
  if (e.kind !== 'verdict') return 'info';
  return e.text.startsWith('SUCCESS') ? 'ok' : 'warn';
}

/** One timeline entry: what the model answered and the thinking it returned — or plainly that there was none. */
function ThinkingItem({ entry }: { entry: ThinkingEntry }) {
  return (
    <li data-tone={entryTone(entry)}>
      <time>{new Date(entry.time).toLocaleTimeString()}</time> <b>{entry.step}</b> · {KIND_LABEL[entry.kind]}
      {entry.error ? (
        <p role="alert">AI call failed — {entry.error}</p>
      ) : (
        <>
          <p>{entry.text}</p>
          {entry.thinking ? <pre className={styles.muted}>{entry.thinking}</pre> : <p className={styles.muted}>No thinking returned by the model</p>}
        </>
      )}
    </li>
  );
}

/** Qwen thinking: per-step timeline of the model's thought, follow-up reflection and final verdict. */
export function QwenThinkingPanel({ engine }: { engine: AssistEngine }) {
  const { timeline, aiStatus, settings } = engine;
  return (
    <section className={styles.panel} aria-label="Qwen thinking">
      <h3>Qwen thinking <small>{settings.aiModel}</small></h3>
      {aiStatus.state === 'offline' && <p className={styles.muted} role="alert">{aiStatus.detail}</p>}
      {!timeline.length && <p className={styles.muted}>No AI calls yet.</p>}
      <ul className={styles.log}>
        {timeline.map((e) => <ThinkingItem key={e.id} entry={e} />)}
      </ul>
    </section>
  );
}

/** Action record: everything the user, AI, and agents did. */
export function LogPanel({ engine }: { engine: AssistEngine }) {
  return (
    <section className={styles.panel}>
      <h3>Activity log</h3>
      <ul className={styles.log}>
        {engine.log.map((l) => (
          <li key={l.id} data-tone={l.tone}>
            <time>{new Date(l.time).toLocaleTimeString()}</time> <b>{l.source}</b> {l.message}
          </li>
        ))}
      </ul>
    </section>
  );
}
