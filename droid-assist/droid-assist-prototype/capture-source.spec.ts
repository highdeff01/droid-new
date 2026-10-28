import { describe, expect, it } from 'vitest';
import { captureLabel, captureStatus, frameProvider, stepPlan, type CaptureFacts } from './capture-source.js';

const facts = (over: Partial<CaptureFacts>): CaptureFacts => ({ source: 'screen', hasFrame: true, bridgeUrl: '', mainConnected: false, ...over });

describe('stepPlan', () => {
  it('local screen: a dry run verifies on its own captured frames with no bridge; real input goes to the desktop bridge', () => {
    expect(stepPlan('screen', { dryRun: true, bridgeUrl: '' })).toEqual({ frames: 'captured', input: 'desktop-bridge', needsBridge: false });
    expect(stepPlan('screen', { dryRun: false, bridgeUrl: 'http://pc' })).toEqual({ frames: 'captured', input: 'desktop-bridge', needsBridge: true });
  });

  it('main-app mirror: captured frames, input as run_script, never the desktop bridge', () => {
    expect(stepPlan('main-app', { dryRun: false, bridgeUrl: 'http://pc' })).toEqual({ frames: 'captured', input: 'main-app', needsBridge: false });
    expect(stepPlan('main-app', { dryRun: true, bridgeUrl: '' })).toMatchObject({ needsBridge: false });
  });

  it('bridge source uses cached frames for dry runs and the bridge for real input', () => {
    expect(stepPlan('bridge', { dryRun: true, bridgeUrl: 'http://pc' })).toEqual({ frames: 'captured', input: 'desktop-bridge', needsBridge: false });
    expect(stepPlan('bridge', { dryRun: false, bridgeUrl: 'http://pc' })).toEqual({ frames: 'bridge', input: 'desktop-bridge', needsBridge: true });
  });

  it('demo: simulated unless armed with a bridge URL', () => {
    expect(stepPlan('demo', { dryRun: true, bridgeUrl: 'http://pc' })).toEqual({ frames: 'demo', input: 'demo', needsBridge: false });
    expect(stepPlan('demo', { dryRun: false, bridgeUrl: '' })).toEqual({ frames: 'demo', input: 'demo', needsBridge: false });
    expect(stepPlan('demo', { dryRun: false, bridgeUrl: 'http://pc' })).toEqual({ frames: 'bridge', input: 'desktop-bridge', needsBridge: true });
  });

  it('no source has no plan and no frame provider', () => {
    expect(stepPlan('none', { dryRun: true, bridgeUrl: 'http://pc' })).toBeNull();
    expect(frameProvider('none')).toBeNull();
    expect(frameProvider('main-app')).toBe('captured');
  });
});

describe('captureStatus', () => {
  it('names the local capture kind', () => {
    expect(captureLabel('screen', 'native')).toBe('Electron screen capture');
    expect(captureLabel('screen', 'display-media')).toBe('Browser screen share');
    expect(captureLabel('main-app')).toBe('Main app mirror');
  });

  it('a shared screen with a frame is armed on its own frames', () => {
    const s = captureStatus(facts({ kind: 'display-media' }));
    expect(s).toMatchObject({ label: 'Browser screen share', armed: true });
    expect(s.detail).toMatch(/armed — frames: own captured frames, input: desktop bridge/);
  });

  it('is not armed before the first captured frame, without a main app, without a bridge URL or a source', () => {
    expect(captureStatus(facts({ kind: 'native', hasFrame: false }))).toMatchObject({ armed: false, detail: expect.stringMatching(/first captured frame/) });
    expect(captureStatus(facts({ source: 'main-app' }))).toMatchObject({ armed: false, detail: expect.stringMatching(/main app not connected/) });
    expect(captureStatus(facts({ source: 'main-app', mainConnected: true })).detail).toMatch(/input: main app run_script/);
    expect(captureStatus(facts({ source: 'bridge', hasFrame: false }))).toMatchObject({ armed: false, detail: expect.stringMatching(/no desktop bridge URL/) });
    expect(captureStatus(facts({ source: 'none' }))).toMatchObject({ armed: false, label: 'No capture' });
  });

  it('demo is always armed on its canvas', () => {
    expect(captureStatus(facts({ source: 'demo', hasFrame: false }))).toMatchObject({ armed: true, detail: expect.stringMatching(/demo canvas/) });
  });
});
