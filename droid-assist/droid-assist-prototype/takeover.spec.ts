import { describe, expect, it, vi } from 'vitest';
import type { RegulatePayload } from './main-bridge-protocol.js';
import { applyRegulate, arbitrate, shouldHandOff, stepComplete, TAKEOVER_MS, type RegulateTarget, type StepAgreement } from './takeover.js';

const agreement = (over: Partial<StepAgreement> = {}): StepAgreement => ({
  index: 0,
  step: 'Click Save',
  owner: 'assist',
  verified: null,
  startedAt: 0,
  ...over,
});

describe('takeover', () => {
  describe('stepComplete', () => {
    it('is true only when verified, local and remote are all true', () => {
      expect(stepComplete(true, true, true)).toBe(true);
    });

    it('is false when the remote opinion is missing', () => {
      expect(stepComplete(true, true, undefined)).toBe(false);
    });

    it('is false when droid-new did not verify', () => {
      expect(stepComplete(false, true, true)).toBe(false);
    });

    it('is false when the local agents disagree', () => {
      expect(stepComplete(true, false, true)).toBe(false);
    });
  });

  describe('shouldHandOff', () => {
    it('does not hand off the first step before 10 s elapse', () => {
      const a = agreement({ index: 0, owner: 'assist', startedAt: 0 });
      expect(shouldHandOff(a, TAKEOVER_MS - 1)).toBe(false);
    });

    it('hands off the first step once 10 s elapse', () => {
      const a = agreement({ index: 0, owner: 'assist', startedAt: 0 });
      expect(shouldHandOff(a, TAKEOVER_MS)).toBe(true);
    });

    it('never hands off a step other than the first, even long after 10 s', () => {
      const a = agreement({ index: 1, owner: 'assist', startedAt: 0 });
      expect(shouldHandOff(a, 60_000)).toBe(false);
    });

    it('never hands off a step that is already complete', () => {
      const a = agreement({ index: 0, owner: 'assist', startedAt: 0, verified: true, local: true, remote: true });
      expect(shouldHandOff(a, 60_000)).toBe(false);
    });

    it('never hands off a step already owned by droid-main', () => {
      const a = agreement({ index: 0, owner: 'main', startedAt: 0 });
      expect(shouldHandOff(a, 60_000)).toBe(false);
    });
  });

  describe('arbitrate', () => {
    it('rules a verified step complete even when droid-main disagrees, citing the arbiter', () => {
      const a = agreement({ verified: true, local: true, remote: false });
      const ruling = arbitrate(a);
      expect(ruling.complete).toBe(true);
      expect(ruling.text).toContain('arbiter');
    });

    it('rules an unverified step not complete', () => {
      const a = agreement({ verified: false, local: true, remote: true });
      const ruling = arbitrate(a);
      expect(ruling.complete).toBe(false);
    });
  });

  describe('applyRegulate', () => {
    const target = (): RegulateTarget => ({
      pause: vi.fn(),
      stop: vi.fn(),
      resume: vi.fn(),
      setArmed: vi.fn(),
      setMode: vi.fn(),
    });

    it('calls pause for a pause command', () => {
      const t = target();
      applyRegulate({ command: 'pause' } as RegulatePayload, t, 'droid-main');
      expect(t.pause).toHaveBeenCalled();
    });

    it('calls stop for a stop command', () => {
      const t = target();
      applyRegulate({ command: 'stop' } as RegulatePayload, t, 'droid-main');
      expect(t.stop).toHaveBeenCalled();
    });

    it('calls resume for a resume command', () => {
      const t = target();
      applyRegulate({ command: 'resume' } as RegulatePayload, t, 'droid-main');
      expect(t.resume).toHaveBeenCalled();
    });

    it('calls setArmed(true) for an arm command', () => {
      const t = target();
      applyRegulate({ command: 'arm' } as RegulatePayload, t, 'droid-main');
      expect(t.setArmed).toHaveBeenCalledWith(true);
    });

    it('calls setArmed(false) for a disarm command', () => {
      const t = target();
      applyRegulate({ command: 'disarm' } as RegulatePayload, t, 'droid-main');
      expect(t.setArmed).toHaveBeenCalledWith(false);
    });

    it('calls setMode for a mode command', () => {
      const t = target();
      applyRegulate({ command: 'mode', mode: 'fast' } as RegulatePayload, t, 'droid-main');
      expect(t.setMode).toHaveBeenCalledWith('fast');
    });

    it('returns a log line naming the sender and the command', () => {
      const t = target();
      const line = applyRegulate({ command: 'pause' } as RegulatePayload, t, 'droid-main');
      expect(line).toContain('droid-main');
      expect(line).toContain('pause');
    });
  });
});
