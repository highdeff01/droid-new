import { useState } from 'react';
import type { AssistEngine } from './use-assist.js';
import type { ExecutionMode } from './execution-mode.js';
import { EXECUTION_MODES, MODE_IDS } from './execution-mode.js';
import { MainBridgeBadge } from './hud.js';
import styles from './droid-assist.module.css';

/** Compact toolbar usable while running: connect/status, arm/disarm, execution mode, crew size, a request to droid-main and regulate controls. */
export function BridgeToolbar({ engine }: { engine: AssistEngine }) {
  const { mainBridge, armed, toggleArmed, settings, setSettings, setMode, bridgeV2 } = engine;
  const [request, setRequest] = useState('');

  const submitRequest = (e: React.FormEvent) => {
    e.preventDefault();
    const text = request.trim();
    if (!text) return;
    void bridgeV2.sendUserRequest(text);
    setRequest('');
  };

  return (
    <div role="toolbar" aria-label="Bridge toolbar" className={styles.hud2}>
      <MainBridgeBadge state={mainBridge} />
      <button type="button" onClick={toggleArmed}>{armed ? 'Disarm real input' : 'Arm real input'}</button>
      <label>Mode
        <select value={settings.executionMode} onChange={(e) => setMode(e.target.value as ExecutionMode, 'selected in the toolbar', 'user')} aria-label="Execution mode">
          {MODE_IDS.map((m) => <option key={m} value={m}>{EXECUTION_MODES[m].label}</option>)}
        </select>
      </label>
      <label>Crew size
        <input
          type="number"
          min={5}
          max={50}
          value={settings.crewSize}
          onChange={(e) => {
            const crewSize = Number(e.target.value);
            setSettings((s) => ({ ...s, crewSize }));
          }}
          aria-label="Crew size"
        />
      </label>
      <form onSubmit={submitRequest}>
        <input value={request} onChange={(e) => setRequest(e.target.value)} aria-label="Request to droid-main" />
        <button type="submit">Send</button>
      </form>
      <button type="button" onClick={() => void bridgeV2.regulateMain('pause')}>Pause droid-main</button>
      <button type="button" onClick={() => void bridgeV2.regulateMain('stop')}>Stop droid-main</button>
    </div>
  );
}
