import { describe, expect, it, vi } from 'vitest';
import type { WorkflowStep } from './types.js';
import type { AccessProfile, HopOutcome, PathHop, Reach } from './access-paths.js';
import {
  PATH_MIN_USES,
  PATH_RELIABLE_RATE,
  PATH_TOLERANCE,
  PATH_VERSION_LIMIT,
  applyReach,
  deletePath,
  editPath,
  hopText,
  isAccessProfile,
  learnPaths,
  parseHops,
  pathOutcome,
  reachTarget,
  recordPathResult,
  rememberPath,
  usablePath,
} from './access-paths.js';

const GAMES_HOP: PathHop = { label: 'Games', action: 'click', x: 0.1, y: 0.1 };
const CUSTOM_GAME_HOP: PathHop = { label: 'Custom Game', action: 'click', x: 0.25, y: 0.3 };
const CHARACTER_LIST_HOP: PathHop = { label: 'Character list', action: 'click', x: 0.3, y: 0.5 };
const FIFTH_SLOT_HOP: PathHop = { label: '5th slot', action: 'click', x: 0.5, y: 0.75 };
const CHARACTER_5_HOPS: PathHop[] = [GAMES_HOP, CUSTOM_GAME_HOP, CHARACTER_LIST_HOP, FIFTH_SLOT_HOP];

/** Profile for target "Character 5" in context "Game", built via rememberPath with an explicit `now`. */
function buildCharacterProfile(now: number): AccessProfile[] {
  return rememberPath([], { target: 'Character 5', context: 'Game', hops: CHARACTER_5_HOPS }, now);
}

const STEP: WorkflowStep = { id: 'step1', name: 'Reach Character 5', action: 'click', x: 0.5, y: 0.75, status: 'pending' };

const ok = (over: Partial<HopOutcome> = {}): HopOutcome => ({ ok: true, executed: true, message: 'ok', target: { x: 0, y: 0 }, check: { changed: true }, ...over });

describe('characterProfile', () => {
  it('rememberPath builds a profile with the Games → Custom Game → Character list → 5th slot hops', () => {
    const profiles = buildCharacterProfile(1000);
    expect(profiles).toHaveLength(1);
    const [profile] = profiles;
    expect(profile.target).toBe('Character 5');
    expect(profile.context).toBe('Game');
    expect(profile.versions[0]).toMatchObject({ version: 1, hops: CHARACTER_5_HOPS, uses: 1, successes: 1, savedAt: 1000, lastUsed: 1000 });
  });
});

describe('rememberPath', () => {
  it('creates a new profile with version 1, one use and one success', () => {
    const profiles = buildCharacterProfile(1000);
    expect(profiles[0].versions).toHaveLength(1);
    expect(profiles[0].versions[0]).toMatchObject({ version: 1, uses: 1, successes: 1 });
  });

  it('keeps one version with uses 2 when the same path (within PATH_TOLERANCE) is remembered again', () => {
    let profiles = buildCharacterProfile(1000);
    const shifted = CHARACTER_5_HOPS.map((h) => ({ ...h, x: h.x + PATH_TOLERANCE / 2 }));
    profiles = rememberPath(profiles, { target: 'Character 5', context: 'Game', hops: shifted }, 2000);
    expect(profiles[0].versions).toHaveLength(1);
    expect(profiles[0].versions[0]).toMatchObject({ version: 1, uses: 2, successes: 2, lastUsed: 2000 });
  });

  it('makes a changed path versions[0] version 2 and keeps the old version at versions[1] with its uses', () => {
    let profiles = buildCharacterProfile(1000);
    const changed = CHARACTER_5_HOPS.map((h) => ({ ...h, x: h.x + 0.3 }));
    profiles = rememberPath(profiles, { target: 'Character 5', context: 'Game', hops: changed }, 2000);
    expect(profiles[0].versions).toHaveLength(2);
    expect(profiles[0].versions[0]).toMatchObject({ version: 2, hops: changed, uses: 1, successes: 1 });
    expect(profiles[0].versions[1]).toMatchObject({ version: 1, hops: CHARACTER_5_HOPS, uses: 1, successes: 1 });
  });

  it('treats target and context case/space-insensitively as the same profile', () => {
    let profiles = buildCharacterProfile(1000);
    profiles = rememberPath(profiles, { target: ' character   5 ', context: ' GAME ', hops: CHARACTER_5_HOPS }, 2000);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].versions[0].uses).toBe(2);
  });

  it('keeps a different context as a separate profile', () => {
    let profiles = buildCharacterProfile(1000);
    profiles = rememberPath(profiles, { target: 'Character 5', context: 'Other Game', hops: CHARACTER_5_HOPS }, 2000);
    expect(profiles).toHaveLength(2);
  });

  it('leaves profiles unchanged for a blank target', () => {
    const profiles = buildCharacterProfile(1000);
    expect(rememberPath(profiles, { target: '   ', context: 'Game', hops: CHARACTER_5_HOPS }, 2000)).toBe(profiles);
  });

  it('leaves profiles unchanged for empty hops', () => {
    const profiles = buildCharacterProfile(1000);
    expect(rememberPath(profiles, { target: 'Character 5', context: 'Game', hops: [] }, 2000)).toBe(profiles);
  });

  it('never keeps more than PATH_VERSION_LIMIT versions', () => {
    let profiles: AccessProfile[] = [];
    for (let i = 1; i <= PATH_VERSION_LIMIT + 2; i++) {
      profiles = rememberPath(profiles, { target: 'Limit Target', context: 'Ctx', hops: [{ label: 'Target', action: 'click', x: i * 0.09, y: 0.5 }] }, 1000 + i);
    }
    expect(profiles[0].versions.length).toBeLessThanOrEqual(PATH_VERSION_LIMIT);
  });

  it('recordPathResult counts one more use (and success) of the current path', () => {
    const profiles = buildCharacterProfile(1000);
    const updated = recordPathResult(profiles, profiles[0].id, false, 2000);
    expect(updated[0].versions[0]).toMatchObject({ version: 1, uses: 2, successes: 1, lastUsed: 2000 });
  });

  it('editPath keeps the same counts when the hops are unchanged', () => {
    const profiles = buildCharacterProfile(1000);
    const updated = editPath(profiles, profiles[0].id, CHARACTER_5_HOPS, 3000);
    expect(updated[0].versions).toHaveLength(1);
    expect(updated[0].versions[0]).toMatchObject({ version: 1, uses: 1, successes: 1 });
  });

  it('editPath adds a new unused version when the hops change', () => {
    const profiles = buildCharacterProfile(1000);
    const changed = [GAMES_HOP, { ...FIFTH_SLOT_HOP, x: 0.9, y: 0.9 }];
    const updated = editPath(profiles, profiles[0].id, changed, 3000);
    expect(updated[0].versions).toHaveLength(2);
    expect(updated[0].versions[0]).toMatchObject({ version: 2, hops: changed, uses: 0, successes: 0 });
    expect(updated[0].versions[1]).toMatchObject({ version: 1, hops: CHARACTER_5_HOPS, uses: 1, successes: 1 });
  });

  it('editPath leaves profiles unchanged for an empty path', () => {
    const profiles = buildCharacterProfile(1000);
    expect(editPath(profiles, profiles[0].id, [], 3000)).toBe(profiles);
  });

  it('deletePath drops the named profile and keeps the rest', () => {
    let profiles = buildCharacterProfile(1000);
    profiles = rememberPath(profiles, { target: 'Other Target', context: 'Game', hops: CHARACTER_5_HOPS }, 1500);
    const target = profiles.find((p) => p.target === 'Character 5')!;
    const updated = deletePath(profiles, target.id);
    expect(updated).toHaveLength(1);
    expect(updated.some((p) => p.id === target.id)).toBe(false);
  });

  it('usablePath excludes a path with PATH_MIN_USES uses and a rate below PATH_RELIABLE_RATE', () => {
    let profiles = buildCharacterProfile(1000);
    profiles = recordPathResult(profiles, profiles[0].id, false, 2000);
    profiles = recordPathResult(profiles, profiles[0].id, false, 3000);
    expect(profiles[0].versions[0].uses).toBeGreaterThanOrEqual(PATH_MIN_USES);
    expect(profiles[0].versions[0].successes / profiles[0].versions[0].uses).toBeLessThan(PATH_RELIABLE_RATE);
    expect(usablePath(profiles, 'Character 5', 'Game')).toBeNull();
  });

  it('usablePath includes a path with fewer than PATH_MIN_USES uses even at a low rate', () => {
    let profiles = buildCharacterProfile(1000);
    profiles = recordPathResult(profiles, profiles[0].id, false, 2000);
    expect(profiles[0].versions[0].uses).toBeLessThan(PATH_MIN_USES);
    expect(usablePath(profiles, 'Character 5', 'Game')).not.toBeNull();
  });

  it('hopText/parseHops round-trip, including a double click', () => {
    const hops: PathHop[] = [
      { label: 'Games', action: 'click', x: 0.1, y: 0.25 },
      { label: 'Character 5', action: 'double_click', x: 0.5, y: 0.75 },
    ];
    const text = hops.map(hopText).join('\n');
    expect(hopText(hops[1])).toContain('×2');
    expect(parseHops(text)).toEqual(hops);
  });

  it('parseHops returns null for a malformed line', () => {
    expect(parseHops('not a hop line')).toBeNull();
  });

  it('parseHops returns null for an out-of-range percent', () => {
    expect(parseHops('Games @ 150%, 50%')).toBeNull();
  });

  it('parseHops returns null for empty text', () => {
    expect(parseHops('')).toBeNull();
  });

  it('isAccessProfile accepts a JSON round-tripped profile', () => {
    const profile = buildCharacterProfile(1000)[0];
    expect(isAccessProfile(JSON.parse(JSON.stringify(profile)))).toBe(true);
  });

  it('isAccessProfile rejects a profile missing its target', () => {
    const { target: _target, ...rest } = buildCharacterProfile(1000)[0];
    expect(isAccessProfile(rest)).toBe(false);
  });

  it('isAccessProfile rejects a profile with empty versions', () => {
    const profile = buildCharacterProfile(1000)[0];
    expect(isAccessProfile({ ...profile, versions: [] })).toBe(false);
  });

  it('isAccessProfile rejects a hop with x > 1', () => {
    const profile = buildCharacterProfile(1000)[0];
    const bad = { ...profile, versions: [{ ...profile.versions[0], hops: [{ ...profile.versions[0].hops[0], x: 1.5 }] }] };
    expect(isAccessProfile(bad)).toBe(false);
  });
});

describe('reachTarget', () => {
  it('runs every hop in order at its saved point and action when all hops succeed, via "path", without falling back', async () => {
    const profile = buildCharacterProfile(1000)[0];
    const runHop = vi.fn(async (_s: WorkflowStep) => ok());
    const fallback = vi.fn(async () => ok());
    const log = vi.fn();
    const result = await reachTarget(STEP, profile, { runHop, fallback, reached: [], log });
    expect(result.via).toBe('path');
    expect(result.out.ok).toBe(true);
    expect(result.out.executed).toBe(true);
    expect(result.out.check).toEqual({ changed: true });
    expect(runHop).toHaveBeenCalledTimes(CHARACTER_5_HOPS.length);
    CHARACTER_5_HOPS.forEach((hop, i) => {
      const step = runHop.mock.calls[i][0];
      expect(step).toMatchObject({ action: hop.action, x: hop.x, y: hop.y });
    });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('runs only the hops after an already-reached element', async () => {
    const profile = buildCharacterProfile(1000)[0];
    const runHop = vi.fn(async (_s: WorkflowStep) => ok());
    const fallback = vi.fn(async () => ok());
    const log = vi.fn();
    await reachTarget(STEP, profile, { runHop, fallback, reached: ['Custom Game'], log });
    expect(runHop).toHaveBeenCalledTimes(2);
    expect(runHop.mock.calls[0][0]).toMatchObject({ x: CHARACTER_LIST_HOP.x, y: CHARACTER_LIST_HOP.y });
    expect(runHop.mock.calls[1][0]).toMatchObject({ x: FIFTH_SLOT_HOP.x, y: FIFTH_SLOT_HOP.y });
  });

  it('with no profile, reaches fresh and calls fallback once without running any hop', async () => {
    const runHop = vi.fn(async () => ok());
    const fallback = vi.fn(async () => ok({ message: 'fresh' }));
    const log = vi.fn();
    const result = await reachTarget(STEP, null, { runHop, fallback, reached: [], log });
    expect(result.via).toBe('fresh');
    expect(result.out.message).toBe('fresh');
    expect(runHop).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('falls back when a hop returns ok:false, reporting the failed hop and not running later hops', async () => {
    const profile = buildCharacterProfile(1000)[0];
    let calls = 0;
    const runHop = vi.fn(async () => {
      calls++;
      return calls === 2 ? ok({ ok: false, message: 'blocked' }) : ok();
    });
    const fallbackResult = ok({ message: 'fallback-ok', target: { x: 0.26, y: 0.31 } });
    const fallback = vi.fn(async () => fallbackResult);
    const log = vi.fn();
    const result = await reachTarget(STEP, profile, { runHop, fallback, reached: [], log });
    expect(result.via).toBe('fallback');
    expect(result.failedHop).toBe(1);
    expect(result.out).toEqual(fallbackResult);
    expect(runHop).toHaveBeenCalledTimes(2);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('falls back when a hop executes but changes nothing on screen', async () => {
    const profile = buildCharacterProfile(1000)[0];
    let calls = 0;
    const runHop = vi.fn(async () => {
      calls++;
      return calls === 2 ? ok({ check: { changed: false } }) : ok();
    });
    const fallbackResult = ok({ message: 'fallback-ok' });
    const fallback = vi.fn(async () => fallbackResult);
    const log = vi.fn();
    const result = await reachTarget(STEP, profile, { runHop, fallback, reached: [], log });
    expect(result.via).toBe('fallback');
    expect(result.failedHop).toBe(1);
    expect(result.out).toEqual(fallbackResult);
    expect(runHop).toHaveBeenCalledTimes(2);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('does not fall back when a hop halts', async () => {
    const profile = buildCharacterProfile(1000)[0];
    const haltOut = ok({ ok: false, executed: false, message: 'halted', halt: true });
    let calls = 0;
    const runHop = vi.fn(async () => {
      calls++;
      return calls === 2 ? haltOut : ok();
    });
    const fallback = vi.fn(async () => ok());
    const log = vi.fn();
    const result = await reachTarget(STEP, profile, { runHop, fallback, reached: [], log });
    expect(result.via).toBe('path');
    expect(result.out.halt).toBe(true);
    expect(fallback).not.toHaveBeenCalled();
  });
});

describe('applyReach', () => {
  it('counts a path-only reach as one more use and success of the current version', () => {
    const profiles = buildCharacterProfile(1000);
    const profile = profiles[0];
    const reach: Reach<HopOutcome> = { via: 'path', out: ok() };
    const updated = applyReach(profiles, profile, reach, 2000);
    expect(updated.find((p) => p.id === profile.id)!.versions[0]).toMatchObject({ version: 1, uses: 2, successes: 2 });
  });

  it('saves the repaired path as a new current version after a successful fallback, keeping the old one', () => {
    const profiles = buildCharacterProfile(1000);
    const profile = profiles[0];
    const reach: Reach<HopOutcome> = { via: 'fallback', out: ok({ target: { x: 0.9, y: 0.9 } }), failedHop: 1 };
    const updated = applyReach(profiles, profile, reach, 3000).find((p) => p.id === profile.id)!;
    expect(updated.versions).toHaveLength(2);
    expect(updated.versions[0]).toMatchObject({ version: 2, hops: [GAMES_HOP, { ...FIFTH_SLOT_HOP, x: 0.9, y: 0.9 }], uses: 1, successes: 1 });
    expect(updated.versions[1]).toMatchObject({ version: 1, hops: CHARACTER_5_HOPS, uses: 2, successes: 1 });
  });

  it('counts only a failed use when the fallback itself fails', () => {
    const profiles = buildCharacterProfile(1000);
    const profile = profiles[0];
    const reach: Reach<HopOutcome> = { via: 'fallback', out: ok({ ok: false, message: 'still blocked' }), failedHop: 1 };
    const updated = applyReach(profiles, profile, reach, 3000).find((p) => p.id === profile.id)!;
    expect(updated.versions).toHaveLength(1);
    expect(updated.versions[0]).toMatchObject({ version: 1, uses: 2, successes: 1 });
  });

  it('leaves profiles unchanged for a halted reach', () => {
    const profiles = buildCharacterProfile(1000);
    const profile = profiles[0];
    const reach: Reach<HopOutcome> = { via: 'path', out: ok({ ok: false, executed: false, halt: true }) };
    expect(applyReach(profiles, profile, reach, 4000)).toBe(profiles);
  });

  it('pathOutcome reports success with no avoid lesson', () => {
    const profile = buildCharacterProfile(1000)[0];
    expect(pathOutcome(profile, true)).toEqual({ target: 'Character 5', context: 'Game', success: true, avoid: null });
  });

  it('pathOutcome reports failure naming the failed hop', () => {
    const profile = buildCharacterProfile(1000)[0];
    const outcome = pathOutcome(profile, false, 1);
    expect(outcome.success).toBe(false);
    expect(outcome.avoid).toContain('Custom Game');
  });
});

describe('learnPaths', () => {
  it('does not count again a target whose saved path was already counted during the run', () => {
    const start = rememberPath([], { target: 'Play', context: 'Game', hops: [{ label: 'Play', action: 'click', x: 0.5, y: 0.5 }] }, 1);
    const steps: WorkflowStep[] = [{ id: 's1', name: 'Click Play', target: 'Play', action: 'click', x: 0.5, y: 0.5, status: 'done' }];
    const learned = learnPaths(start, steps, 'Game', 2, ['play']);
    expect(learned[0].versions[0]).toMatchObject({ uses: 1, successes: 1 });
    expect(learnPaths(start, steps, 'Game', 2)[0].versions[0]).toMatchObject({ uses: 2, successes: 2 });
  });
  it('builds the last target\'s profile from the prior done clicks in order, using corrected points when present', () => {
    const steps: WorkflowStep[] = [
      { id: '1', name: 'Games', action: 'click', x: GAMES_HOP.x, y: GAMES_HOP.y, status: 'done', target: 'Games' },
      { id: '2', name: 'Custom Game', action: 'click', x: 0.2, y: 0.2, correctedX: CUSTOM_GAME_HOP.x, correctedY: CUSTOM_GAME_HOP.y, status: 'done', target: 'Custom Game' },
      { id: '3', name: 'Ignored (not done)', action: 'click', x: 0.6, y: 0.6, status: 'pending', target: 'Ignored' },
      { id: '4', name: 'Type something', action: 'type', x: 0.9, y: 0.9, status: 'done', target: 'Some field', text: 'hi' },
      { id: '5', name: 'Character list', action: 'click', x: CHARACTER_LIST_HOP.x, y: CHARACTER_LIST_HOP.y, status: 'done', target: 'Character list' },
      { id: '6', name: 'Character 5', action: 'double_click', x: FIFTH_SLOT_HOP.x, y: FIFTH_SLOT_HOP.y, status: 'done', target: 'Character 5' },
    ];
    const profiles = learnPaths([], steps, 'Game', 1000);
    const profile = profiles.find((p) => p.target === 'Character 5')!;
    expect(profile).toBeDefined();
    expect(profile.versions[0].hops).toEqual([
      GAMES_HOP,
      CUSTOM_GAME_HOP,
      CHARACTER_LIST_HOP,
      { label: 'Character 5', action: 'double_click', x: FIFTH_SLOT_HOP.x, y: FIFTH_SLOT_HOP.y },
    ]);
  });
});
