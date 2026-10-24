import { describe, expect, it } from 'vitest';
import { monitorInterval } from './capture.js';

describe('monitorInterval', () => {
  it('uses the configurable capture interval for app monitor', () => {
    expect(monitorInterval('app', 500)).toBe(500);
    expect(monitorInterval('app', 800)).toBe(800);
  });
  it('captures every second in background monitor', () => {
    expect(monitorInterval('background', 500)).toBe(1000);
  });
  it('captures every 0.25 s in advanced monitor', () => {
    expect(monitorInterval('advanced', 500)).toBe(250);
  });
});
