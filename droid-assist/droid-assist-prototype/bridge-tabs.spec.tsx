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
      driving: { driver: 'droid-new', since: 1, reason: 'droid-new is the boss and holds admin status' },
      suggestions: [],
      acceptSuggestion: vi.fn(() => true),
      dismissSuggestion: vi.fn(() => true),
      takeWheelBack: vi.fn(),
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

  it('shows who is driving on the Status tab', () => {
    const { getByRole, getByLabelText } = render(<BridgeTabs engine={fakeEngine()} />);
    fireEvent.click(getByRole('tab', { name: 'Status' }));
    expect(getByLabelText('Who is driving').textContent).toBe('Driving: droid-new');
  });

  it('queues droid-main\u2019s simultaneous commands on the Coordinate tab, with accept and dismiss', () => {
    const engine = fakeEngine();
    engine.bridgeV2.suggestions = [{ id: 'sug-1', from: 'droid-main', command: 'pause', reason: 'stop for a second', time: 5 }];
    const { getByRole, getByLabelText } = render(<BridgeTabs engine={engine} />);
    fireEvent.click(getByRole('tab', { name: 'Coordinate' }));
    const queued = getByLabelText('Queued suggestions');
    expect(queued.textContent).toContain('pause');
    expect(queued.textContent).toContain('stop for a second');
    fireEvent.click(getByRole('button', { name: 'Accept' }));
    expect(engine.bridgeV2.acceptSuggestion).toHaveBeenCalledWith('sug-1');
    fireEvent.click(getByRole('button', { name: 'Dismiss' }));
    expect(engine.bridgeV2.dismissSuggestion).toHaveBeenCalledWith('sug-1');
  });

  it('shows the driving flag and a take-back button while droid-main drives', () => {
    const engine = fakeEngine();
    engine.bridgeV2.driving = { driver: 'droid-main', since: 1, reason: 'droid-main took over step 1 "Click save" — stuck' };
    const { getByRole, getByLabelText } = render(<BridgeTabs engine={engine} />);
    fireEvent.click(getByRole('tab', { name: 'Coordinate' }));
    expect(getByLabelText('Driving flag').textContent).toContain('Driving: droid-main');
    fireEvent.click(getByRole('button', { name: 'Take the wheel back' }));
    expect(engine.bridgeV2.takeWheelBack).toHaveBeenCalled();
  });
});
