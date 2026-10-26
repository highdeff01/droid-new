import { useCallback, useEffect, useRef, useState } from 'react';
import { pingAi, type AiConfig, type AiStatus } from './ai.js';
import styles from './droid-assist.module.css';

/** Common model sizes offered as quick-select chips on an Ollama-compatible server. */
export const MODEL_CANDIDATES = ['qwen3.5:0.8b', 'qwen3.5:2b', 'qwen3.5:4b', 'qwen3.5:7b', 'qwen3.5:9b'];

/** The per-candidate ping results, keyed by model name; a model never pinged has no entry. */
export type ModelPings = Record<string, AiStatus>;

const PING_LABEL: Record<AiStatus['state'], string> = { checking: 'pinging…', online: 'reachable', offline: 'error' };
const PING_TONE: Record<AiStatus['state'], string> = { checking: 'info', online: 'ok', offline: 'error' };

/**
 * Pings candidate models against `url` with the real health check. Results are cleared when the
 * endpoint changes, and a ping still in flight for a previous endpoint is discarded, never shown.
 */
export function useModelPings(url: string, ping: (cfg: AiConfig) => Promise<AiStatus> = pingAi) {
  const [pings, setPings] = useState<ModelPings>({});
  const urlRef = useRef(url);
  useEffect(() => {
    urlRef.current = url;
    setPings({});
  }, [url]);
  const pingModel = useCallback(async (model: string) => {
    const target = url;
    setPings((p) => ({ ...p, [model]: { state: 'checking', detail: `Pinging ${model}…` } }));
    const status = await ping({ url: target, model });
    if (urlRef.current === target) setPings((p) => ({ ...p, [model]: status }));
  }, [url, ping]);
  return { pings, pingModel };
}

/** One candidate: a select chip, its Ping button and its live ping status. */
function CandidateChip({ model, selected, status, onSelect, onPing }: {
  model: string; selected: boolean; status: AiStatus | undefined; onSelect: () => void; onPing: () => void;
}) {
  return (
    <li data-tone={status ? PING_TONE[status.state] : undefined}>
      <button type="button" aria-pressed={selected} onClick={onSelect}>{model}</button>
      <button type="button" onClick={onPing} disabled={status?.state === 'checking'} aria-label={`Ping ${model}`}>Ping</button>
      {status && <small aria-live="polite" title={status.detail}>{PING_LABEL[status.state]} — {status.detail}</small>}
    </li>
  );
}

/** Settings → AI model: free-text model name plus candidate chips, each pingable before selecting. */
export function ModelPicker({ url, model, onSelect, ping }: {
  url: string; model: string; onSelect: (model: string) => void; ping?: (cfg: AiConfig) => Promise<AiStatus>;
}) {
  const { pings, pingModel } = useModelPings(url, ping);
  return (
    <div className={styles.setting}>
      <label className={styles.setting}>AI model
        <input value={model} onChange={(e) => onSelect(e.target.value)} aria-label="AI model" />
      </label>
      <ul className={styles.log} aria-label="Model candidates">
        {MODEL_CANDIDATES.map((m) => (
          <CandidateChip key={m} model={m} selected={m === model} status={pings[m]} onSelect={() => onSelect(m)} onPing={() => void pingModel(m)} />
        ))}
      </ul>
    </div>
  );
}
