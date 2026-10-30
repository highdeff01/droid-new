import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BridgeTabs } from './bridge-tabs.js';
import type { AssistEngine } from './use-assist.js';

afterEach(cleanup);

/** The minimal fake AssistEngine BridgeTabs and its tab components read. */
function fakeEngine(): AssistEngine {
  return {
    mainBridge: { status: 'connected', lastError: null, peer: 'droid-main' },
    armed: true,
    replaying: false,
    source: 'demo',
    settings: { crewSize: 10 },
    selectMainApp: vi.fn(),
    frames: [
      { id: 1, time: 1, url: 'data:image/jpeg;base64,AA', data: {}, srcW: 10, srcH: 10, source: 'main-app' },
    ],
    bridgeV2: {
      swarmRound: null,
      runSwarm: vi.fn(),
      dispatchSwarm: vi.fn(),
      remote: { app: 'droid-main', running: true, goal: 'open settings', steps: 3, activeIndex: 1, agentsBusy: 2 },
      decision: null,
      coordination: [
        { index: 0, name: 'Click save', planned: true, dispatched: true, owner: 'assist', verified: true, state: 'complete' },
      ],
      flows: [{ time: 1, direction: 'to-main', text: 'open settings' }],
      browserLogs: [
        { id: 'blog-1', time: 1, app: 'droid-main', level: 'error', message: 'boom', count: 1 },
      ],
      clearBrowserLogs: vi.fn(),
    },
  } as unknown as AssistEngine;
}

describe('BridgeTabs', () => {
  it('shows Swarm by default', () => {
    const { getByRole } = render(<BridgeTabs engine={fakeEngine()} />);
    expect(getByRole('tab', { name: 'Swarm' }).getAttribute('aria-selected')).toBe('true');
  });

  it('Status tab shows the remote goal and droid-new state', () => {
    const { getByRole, getByLabelText } = render(<BridgeTabs engine={fakeEngine()} />);
    fireEvent.click(getByRole('tab', { name: 'Status' }));
    const content = getByLabelText('Status tab');
    expect(content.textContent).toContain('open settings');
    expect(content.textContent).toContain('idle');
  });

  it('Coordinate tab shows a row and a flow', () => {
    const { getByRole, getByLabelText } = render(<BridgeTabs engine={fakeEngine()} />);
    fireEvent.click(getByRole('tab', { name: 'Coordinate' }));
    const content = getByLabelText('Coordinate tab');
    expect(content.textContent).toContain('Click save');
    expect(content.textContent).toContain('open settings');
  });

  it('Screenshare tab shows the main-app frame image and the button calls selectMainApp', () => {
    const engine = fakeEngine();
    const { getByRole, getByAltText } = render(<BridgeTabs engine={engine} />);
    fireEvent.click(getByRole('tab', { name: 'Screenshare' }));
    expect(getByAltText('droid-main preview')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'Use as capture source' }));
    expect(engine.selectMainApp).toHaveBeenCalled();
  });

  it('Browser logs tab lists a droid-main error and Clear calls clearBrowserLogs', () => {
    const engine = fakeEngine();
    const { getByRole, getByLabelText } = render(<BridgeTabs engine={engine} />);
    fireEvent.click(getByRole('tab', { name: 'Browser logs' }));
    expect(getByLabelText('Browser logs tab').textContent).toContain('boom');
    fireEvent.click(getByRole('button', { name: 'Clear' }));
    expect(engine.bridgeV2.clearBrowserLogs).toHaveBeenCalled();
  });
});
