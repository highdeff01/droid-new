import { useState } from 'react';
import { candidateUrls, discoverBridges, NOTHING_FOUND, verifyBridge, type BridgeCandidate, type VerifyStep } from './bridge-discovery.js';
import { checkBridge } from './bridge.js';
import { InsecureBridgeWarning } from './hud.js';
import styles from './droid-assist.module.css';

/** The wizard's current step and what it shows. */
type WizardState =
  | { step: 'scanning'; probed: number; total: number }
  | { step: 'results'; candidates: BridgeCandidate[] }
  | { step: 'token'; candidate: BridgeCandidate; tokenCheck: string }
  | { step: 'verifying'; candidate: BridgeCandidate }
  | { step: 'done'; candidate: BridgeCandidate; checks: VerifyStep[]; connected: boolean };

const STATUS_LABEL: Record<BridgeCandidate['status'], string> = { online: 'online', 'needs-token': 'answers — token required' };
const STEP_LABEL: Record<VerifyStep['step'], string> = { health: 'Health check', 'dry-run': 'Dry run (wait)' };

/** The page's own hostname, a hint to the local subnet (empty outside a browser). */
const pageHost = () => (typeof location === 'undefined' ? '' : location.hostname);

/** One discovered bridge: its URL, latency, status, insecure marker and a Use button. */
function CandidateRow({ candidate, onPick }: { candidate: BridgeCandidate; onPick: () => void }) {
  return (
    <li data-tone={candidate.insecure ? 'warn' : 'ok'}>
      <b>{candidate.url}</b> {candidate.latencyMs} ms — {STATUS_LABEL[candidate.status]}
      {candidate.insecure && <small> ⚠ plain http on the LAN — unencrypted</small>}
      <button type="button" onClick={onPick} aria-label={`Use ${candidate.url}`}>Use</button>
    </li>
  );
}

/** The verification checklist: one line per step with its honest result. */
function CheckList({ checks }: { checks: VerifyStep[] }) {
  return (
    <ul className={styles.log} aria-label="Bridge verification">
      {checks.map((c) => (
        <li key={c.step} data-tone={c.ok ? 'ok' : 'error'}><b>{c.ok ? '✓' : '✗'} {STEP_LABEL[c.step]}</b> {c.message}</li>
      ))}
    </ul>
  );
}

/**
 * Settings → "Find bridge": sweeps localhost and the local subnet for the python bridge, lists
 * responders with latency, auto-fills the picked URL, takes/tests the token, then verifies end to
 * end (health + a dry wait run) and only then connects.
 */
export function BridgeWizard({ bridgeUrl, token, onFill, onConnect }: {
  bridgeUrl: string;
  token: string;
  /** Saves the bridge URL and token into the settings. */
  onFill: (url: string, token: string) => void;
  /** Connects to the verified bridge. */
  onConnect: (url: string, token: string) => Promise<unknown>;
}) {
  const [state, setState] = useState<WizardState | null>(null);
  const [draftToken, setDraftToken] = useState(token);

  const scan = async () => {
    const urls = candidateUrls([pageHost(), bridgeUrl]);
    setState({ step: 'scanning', probed: 0, total: urls.length });
    const candidates = await discoverBridges(urls, draftToken, { onProgress: (probed) => setState({ step: 'scanning', probed, total: urls.length }) });
    setState({ step: 'results', candidates });
  };
  const pick = (candidate: BridgeCandidate) => {
    onFill(candidate.url, draftToken);
    setState({ step: 'token', candidate, tokenCheck: '' });
  };
  const testToken = async (candidate: BridgeCandidate) => {
    const health = await checkBridge(candidate.url, draftToken);
    setState({ step: 'token', candidate, tokenCheck: health.ok ? 'Token accepted' : health.message });
  };
  const verify = async (candidate: BridgeCandidate) => {
    onFill(candidate.url, draftToken);
    setState({ step: 'verifying', candidate });
    const checks = await verifyBridge(candidate.url, draftToken);
    const connected = checks.every((c) => c.ok) && (await onConnect(candidate.url, draftToken)) !== false;
    setState({ step: 'done', candidate, checks, connected });
  };

  return (
    <div className={styles.setting} aria-label="Bridge connection wizard">
      <button type="button" onClick={() => void scan()} disabled={state?.step === 'scanning' || state?.step === 'verifying'}>Find bridge</button>
      {state?.step === 'scanning' && <small role="status">Step 1/3 — scanning localhost and the local network… {state.probed}/{state.total}</small>}
      {state?.step === 'results' && (state.candidates.length ? (
        <>
          <small role="status">Step 1/3 — found {state.candidates.length} bridge(s); pick one</small>
          <ul className={styles.log} aria-label="Bridge candidates">
            {state.candidates.map((c) => <CandidateRow key={c.url} candidate={c} onPick={() => pick(c)} />)}
          </ul>
        </>
      ) : <small role="status">{NOTHING_FOUND}</small>)}
      {(state?.step === 'token' || state?.step === 'verifying' || state?.step === 'done') && <InsecureBridgeWarning bridgeUrl={state.candidate.url} />}
      {state?.step === 'token' && (
        <>
          <small role="status">Step 2/3 — {state.candidate.url} filled in; enter the bridge token (DROID_BRIDGE_TOKEN)</small>
          <span className={styles.row}>
            <input type="password" value={draftToken} onChange={(e) => setDraftToken(e.target.value)} aria-label="Wizard bridge token" autoComplete="off" />
            <button type="button" onClick={() => void testToken(state.candidate)}>Test token</button>
            <button type="button" onClick={() => void verify(state.candidate)}>Verify &amp; connect</button>
          </span>
          {state.tokenCheck && <small>{state.tokenCheck}</small>}
        </>
      )}
      {state?.step === 'verifying' && <small role="status">Step 3/3 — verifying {state.candidate.url} (health check, then a dry wait run)…</small>}
      {state?.step === 'done' && (
        <>
          <CheckList checks={state.checks} />
          <small role="status">{state.connected ? `Bridge connected: ${state.candidate.url}` : `Not connected — ${state.candidate.url} failed verification`}</small>
        </>
      )}
    </div>
  );
}
