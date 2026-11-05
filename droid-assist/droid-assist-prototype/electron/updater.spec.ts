// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { checkForUpdate, runUpdate, updateLine, type CommandRunner } from './updater.js';

const options = { repoRoot: '/repo', appDir: '/repo/app', remote: 'origin', branch: 'main' };

/** A runner that answers each command with a scripted result keyed by its first argument and subcommand. */
function runner(answers: Record<string, { ok: boolean; output?: string }>): CommandRunner {
  return vi.fn(async (command: string, args: readonly string[]) => {
    const key = [command, args.find((a) => a === 'fetch' || a === 'rev-list' || a === 'log' || a === 'pull' || a === 'install' || a === 'build')].join(' ');
    const found = answers[key] ?? answers[command];
    if (!found) return { ok: true, output: '' };
    return { ok: found.ok, output: found.output ?? '' };
  });
}

describe('checkForUpdate', () => {
  it('reports up to date when the local branch has every remote commit', async () => {
    const run = runner({ 'git fetch': { ok: true }, 'git rev-list': { ok: true, output: '0\n' } });
    const c = await checkForUpdate(options, run);
    expect(c).toMatchObject({ ok: true, behind: 0, message: 'Up to date' });
    expect(updateLine(c)).toBe('Droid Assist is up to date');
  });

  it('reports how far behind, with the newest commit subject', async () => {
    const run = runner({
      'git fetch': { ok: true },
      'git rev-list': { ok: true, output: '3\n' },
      'git log': { ok: true, output: 'Add voice control\n' },
    });
    const c = await checkForUpdate(options, run);
    expect(c).toMatchObject({ ok: true, behind: 3, latest: 'Add voice control' });
    expect(c.message).toContain('3 new commits');
    expect(updateLine(c)).toContain('Update available');
  });

  it('is honest when the remote cannot be reached', async () => {
    const run = runner({ 'git fetch': { ok: false, output: 'fatal: could not resolve host' } });
    const c = await checkForUpdate(options, run);
    expect(c.ok).toBe(false);
    expect(c.message).toContain('Could not reach origin/main');
    expect(c.message).toContain('could not resolve host');
  });

  it('is honest when the comparison fails', async () => {
    const run = runner({ 'git fetch': { ok: true }, 'git rev-list': { ok: false, output: 'boom' } });
    expect((await checkForUpdate(options, run)).message).toContain('Could not compare with origin/main');
  });
});

describe('runUpdate', () => {
  const allOk = { 'git fetch': { ok: true }, 'git pull': { ok: true }, 'npm install': { ok: true }, 'npm build': { ok: true } };

  it('fetches, pulls, reinstalls and rebuilds in order', async () => {
    const run = runner(allOk);
    const r = await runUpdate(options, run);
    expect(r.ok).toBe(true);
    expect(r.steps.map((s) => s.name)).toEqual(['fetch', 'pull', 'install', 'build']);
    expect(r.message).toContain('relaunching');
  });

  it('stops at the first failure and says which step failed', async () => {
    const run = runner({ ...allOk, 'npm build': { ok: false, output: 'tsc error' } });
    const r = await runUpdate(options, run);
    expect(r.ok).toBe(false);
    expect(r.steps.map((s) => s.name)).toEqual(['fetch', 'pull', 'install', 'build']);
    expect(r.steps.at(-1)).toMatchObject({ name: 'build', ok: false });
    expect(r.message).toContain('stopped at build');
    expect(r.message).toContain('tsc error');
  });

  it('does not pull when the fetch fails', async () => {
    const run = runner({ 'git fetch': { ok: false, output: 'offline' } });
    const r = await runUpdate(options, run);
    expect(r.ok).toBe(false);
    expect(r.steps.map((s) => s.name)).toEqual(['fetch']);
    expect(r.message).toContain('stopped at fetch');
  });

  it('names a diverged or dirty branch plainly when the fast-forward pull fails', async () => {
    const run = runner({ ...allOk, 'git pull': { ok: false, output: 'fatal: Not possible to fast-forward' } });
    const r = await runUpdate(options, run);
    expect(r.message).toContain('diverged or is dirty');
    expect(r.steps.map((s) => s.name)).toEqual(['fetch', 'pull']);
  });
});
