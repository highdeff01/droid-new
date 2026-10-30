import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BridgeToolbar } from './bridge-toolbar.js';
import type { AssistEngine } from './use-assist.js';

afterEach(cleanup);

/** The minimal fake AssistEngine BridgeToolbar reads and calls. */
function fakeEngine(armed: boolean): AssistEngine {
  return {
    mainBridge: { status: 'connected', lastError: null, peer: 'droid-main' },
    armed,
    toggleArmed: vi.fn(),
    settings: { executionMode: 'thoughtful', crewSize: 10 },
    setSettings: vi.fn(),
    setMode: vi.fn(),
    bridgeV2: {
      sendUserRequest: vi.fn(async () => true),
      regulateMain: vi.fn(async () => true),
    },
  } as unknown as AssistEngine;
}

describe('BridgeToolbar', () => {
  it('Arm button calls toggleArmed and label reflects armed', () => {
    const engine = fakeEngine(false);
    const { getByRole } = render(<BridgeToolbar engine={engine} />);
    const button = getByRole('button', { name: 'Arm real input' });
    fireEvent.click(button);
    expect(engine.toggleArmed).toHaveBeenCalled();
  });

  it('shows Disarm when armed', () => {
    const { getByRole } = render(<BridgeToolbar engine={fakeEngine(true)} />);
    expect(getByRole('button', { name: 'Disarm real input' })).toBeTruthy();
  });

  it('mode select change calls setMode with the chosen mode', () => {
    const engine = fakeEngine(false);
    const { getByLabelText } = render(<BridgeToolbar engine={engine} />);
    fireEvent.change(getByLabelText('Execution mode'), { target: { value: 'parallel' } });
    expect(engine.setMode).toHaveBeenCalledWith('parallel', expect.any(String), 'user');
  });

  it('crew size change calls setSettings producing crewSize', () => {
    const engine = fakeEngine(false);
    const { getByLabelText } = render(<BridgeToolbar engine={engine} />);
    fireEvent.change(getByLabelText('Crew size'), { target: { value: '20' } });
    expect(engine.setSettings).toHaveBeenCalled();
    const updater = (engine.setSettings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updater({ executionMode: 'thoughtful', crewSize: 10 })).toEqual({ executionMode: 'thoughtful', crewSize: 20 });
  });

  it('submitting a request calls sendUserRequest with the trimmed text', () => {
    const engine = fakeEngine(false);
    const { getByLabelText, getByRole } = render(<BridgeToolbar engine={engine} />);
    fireEvent.change(getByLabelText('Request to droid-main'), { target: { value: '  do thing  ' } });
    fireEvent.click(getByRole('button', { name: 'Send' }));
    expect(engine.bridgeV2.sendUserRequest).toHaveBeenCalledWith('do thing');
  });

  it('pause and stop call regulateMain', () => {
    const engine = fakeEngine(false);
    const { getByRole } = render(<BridgeToolbar engine={engine} />);
    fireEvent.click(getByRole('button', { name: 'Pause droid-main' }));
    fireEvent.click(getByRole('button', { name: 'Stop droid-main' }));
    expect(engine.bridgeV2.regulateMain).toHaveBeenCalledWith('pause');
    expect(engine.bridgeV2.regulateMain).toHaveBeenCalledWith('stop');
  });
});
