import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CaptureSourceBadge, MonitorStatus } from './hud.js';
import { captureStatus } from './capture-source.js';
import { useAssist } from './use-assist.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function Harness() {
  return <MonitorStatus engine={useAssist()} />;
}

describe('CaptureSourceBadge', () => {
  it('shows the Electron capture as armed for replay/drift on its own frames', () => {
    render(<CaptureSourceBadge status={captureStatus({ source: 'screen', kind: 'native', hasFrame: true, bridgeUrl: '', mainConnected: false })} />);
    const badge = screen.getByLabelText('Capture source');
    expect(badge.dataset.level).toBe('green');
    expect(badge.textContent).toMatch(/Capture: Electron screen capture/);
    expect(badge.textContent).toMatch(/Replay\/drift armed — frames: own captured frames/);
  });

  it('shows the main app mirror as not armed while it is disconnected', () => {
    render(<CaptureSourceBadge status={captureStatus({ source: 'main-app', hasFrame: true, bridgeUrl: '', mainConnected: false })} />);
    const badge = screen.getByLabelText('Capture source');
    expect(badge.dataset.level).toBe('red');
    expect(badge.textContent).toMatch(/Capture: Main app mirror.*Replay\/drift not armed — main app not connected/);
  });
});

describe('MonitorStatus', () => {
  it('shows the engine\'s active capture source and replay/drift arming', () => {
    render(<Harness />);
    const hud = screen.getByLabelText('Monitor status');
    expect(within(hud).getByLabelText('Capture source').textContent).toMatch(/Capture: Demo desktop.*Replay\/drift armed — frames: demo canvas/);
  });
});
