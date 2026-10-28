import { describe, expect, it, vi } from 'vitest';
import {
  MAX_SCRIPT_CHARS,
  RECOVERY_OPS,
  RECOVERY_OP_KINDS,
  backoffDelays,
  checkScriptRules,
  decide,
  enqueue,
  hardTrack,
  maintenanceSteps,
  rechatSteps,
  reconnectWithBackoff,
  scaffoldApp,
  splitArg,
  type Approval,
} from './recovery-ops.js';

describe('RECOVERY_OPS', () => {
  it('has all 10 kinds', () => {
    expect(RECOVERY_OP_KINDS.sort()).toEqual(
      ['retry', 'fix', 'appRecover', 'test', 'elementRecover', 'hardTrack', 'createApp', 'maintenance', 'rechat', 'reconnect'].sort(),
    );
  });

  it('marks only maintenance as admin', () => {
    for (const kind of RECOVERY_OP_KINDS) {
      expect(RECOVERY_OPS[kind].admin).toBe(kind === 'maintenance');
    }
  });
});

describe('enqueue', () => {
  it('adds a pending item newest first', () => {
    const q1 = enqueue([], 'maintenance', 'backup', 100);
    const q2 = enqueue(q1, 'maintenance', 'repair', 200);
    expect(q2).toHaveLength(2);
    expect(q2[0]).toMatchObject({ op: 'maintenance', arg: 'repair', time: 200, status: 'pending' });
    expect(q2[1]).toMatchObject({ op: 'maintenance', arg: 'backup', time: 100, status: 'pending' });
  });
});

describe('decide', () => {
  function makeQueue(): Approval[] {
    return enqueue([], 'maintenance', 'backup', 1);
  }

  it('approves a pending item and returns it', () => {
    const queue = makeQueue();
    const { queue: next, item } = decide(queue, queue[0].id, true);
    expect(item).toMatchObject({ id: queue[0].id, status: 'approved' });
    expect(next[0].status).toBe('approved');
  });

  it('rejects a pending item and returns it', () => {
    const queue = makeQueue();
    const { queue: next, item } = decide(queue, queue[0].id, false);
    expect(item).toMatchObject({ id: queue[0].id, status: 'rejected' });
    expect(next[0].status).toBe('rejected');
  });

  it('returns item null and the queue unchanged for an already-decided id', () => {
    const queue = makeQueue();
    const { queue: decided } = decide(queue, queue[0].id, true);
    const { queue: next, item } = decide(decided, queue[0].id, false);
    expect(item).toBeNull();
    expect(next).toEqual(decided);
  });

  it('returns item null and the queue unchanged for an unknown id', () => {
    const queue = makeQueue();
    const { queue: next, item } = decide(queue, 'nope', true);
    expect(item).toBeNull();
    expect(next).toEqual(queue);
  });
});

describe('checkScriptRules', () => {
  it('passes a harmless console.log script', () => {
    expect(checkScriptRules('console.log("hello")')).toEqual([]);
  });

  it('breaks the destructive command rule for rm -rf /', () => {
    expect(checkScriptRules('rm -rf /')).toEqual(['destructive file or disk command']);
  });

  it('breaks the system power rule for shutdown /s', () => {
    expect(checkScriptRules('shutdown /s')).toEqual(['system power or registry change']);
  });

  it('breaks the network write rule for git push', () => {
    expect(checkScriptRules('git push')).toEqual(['network or registry write']);
  });

  it('breaks the privilege escalation rule for sudo x', () => {
    expect(checkScriptRules('sudo x')).toEqual(['privilege escalation']);
  });

  it('breaks the size rule for a script longer than MAX_SCRIPT_CHARS', () => {
    const script = 'a'.repeat(MAX_SCRIPT_CHARS + 1);
    expect(checkScriptRules(script)).toEqual([`longer than ${MAX_SCRIPT_CHARS} characters`]);
  });
});

describe('scaffoldApp', () => {
  it('returns files my-tool/main.js and my-tool/README.md for a harmless script', () => {
    const result = scaffoldApp('My Tool!', 'console.log("hi")');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.files.map((f) => f.path)).toEqual(['my-tool/main.js', 'my-tool/README.md']);
  });

  it('returns ok false with violations for a script that breaks a rule', () => {
    const result = scaffoldApp('Bad Tool', 'sudo rm -rf /');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected not ok');
    expect(result.violations).toContain('privilege escalation');
    expect(result.violations).toContain('destructive file or disk command');
  });
});

describe('backoffDelays', () => {
  it('backoffDelays(5,500,8000) doubles each attempt', () => {
    expect(backoffDelays(5, 500, 8000)).toEqual([500, 1000, 2000, 4000]);
  });

  it('caps at the max delay', () => {
    expect(backoffDelays(6, 1000, 3000)).toEqual([1000, 2000, 3000, 3000, 3000]);
  });
});

describe('reconnectWithBackoff', () => {
  function fakeSleep() {
    const sleeps: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      sleeps.push(ms);
    });
    return { sleep, sleeps };
  }

  it('succeeds on the 3rd attempt with sleeps [500,1000]', async () => {
    const { sleep, sleeps } = fakeSleep();
    let calls = 0;
    const connect = vi.fn(async () => {
      calls += 1;
      return calls >= 3;
    });
    const result = await reconnectWithBackoff(connect, sleep);
    expect(result).toEqual({ ok: true, attempts: 3 });
    expect(sleeps).toEqual([500, 1000]);
  });

  it('returns ok false with attempts = delays.length+1 when it never succeeds', async () => {
    const { sleep } = fakeSleep();
    const connect = vi.fn(async () => false);
    const delays = backoffDelays();
    const result = await reconnectWithBackoff(connect, sleep, delays);
    expect(result).toEqual({ ok: false, attempts: delays.length + 1 });
  });
});

describe('hardTrack', () => {
  function fakeSleep() {
    const sleeps: number[] = [];
    const sleep = vi.fn(async (ms: number) => {
      sleeps.push(ms);
    });
    return { sleep, sleeps };
  }

  it('finds on attempt 2 with one sleep', async () => {
    const { sleep, sleeps } = fakeSleep();
    const find = vi.fn(async (attempt: number) => (attempt === 2 ? { x: 1, y: 2 } : null));
    const result = await hardTrack(find, sleep);
    expect(result).toEqual({ point: { x: 1, y: 2 }, attempts: 2 });
    expect(sleeps).toEqual([1000]);
  });

  it('returns point null after all attempts when never found', async () => {
    const { sleep } = fakeSleep();
    const find = vi.fn(async () => null);
    const result = await hardTrack(find, sleep);
    expect(result.point).toBeNull();
    expect(result.attempts).toBe(6);
  });
});

describe('maintenanceSteps', () => {
  it('gives backup open_app/type/key steps ending in key Enter', () => {
    const steps = maintenanceSteps('backup');
    expect(steps).not.toBeNull();
    expect(steps!.map((s) => s.action)).toEqual(['open_app', 'type', 'key']);
    expect(steps!.at(-1)).toMatchObject({ action: 'key', text: 'Enter' });
  });

  it('returns null for an unknown name', () => {
    expect(maintenanceSteps('nope')).toBeNull();
  });
});

describe('rechatSteps', () => {
  it("opens ChatGPT, types 'hi' and presses Enter", () => {
    const steps = rechatSteps('ChatGPT', 'hi');
    expect(steps.map((s) => s.action)).toEqual(['open_app', 'type', 'key']);
    expect(steps[0]).toMatchObject({ action: 'open_app', text: 'ChatGPT' });
    expect(steps[1]).toMatchObject({ action: 'type', text: 'hi' });
    expect(steps[2]).toMatchObject({ action: 'key', text: 'Enter' });
  });
});

describe('splitArg', () => {
  it("splits 'A: b: c' into head 'A' and rest 'b: c'", () => {
    expect(splitArg('A: b: c')).toEqual({ head: 'A', rest: 'b: c' });
  });

  it('returns an empty rest when there is no colon', () => {
    expect(splitArg('A')).toEqual({ head: 'A', rest: '' });
  });
});
