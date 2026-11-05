import { execFile as callback } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentWorktreeManager } from './agent-worktrees.js';

const execFile = promisify(callback);
const roots: string[] = [];
async function git(args: string[], cwd: string) {
  return execFile('git', args, { cwd, windowsHide: true });
}
async function fixture() {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'droid-worktree-test-'));
  roots.push(parent);
  const root = path.join(parent, 'repo');
  const worktreeDirectory = path.join(parent, 'worktrees');
  await fs.mkdir(root);
  await git(['init', '-b', 'main'], root);
  await git(['config', 'user.name', 'Droid Test'], root);
  await git(['config', 'user.email', 'test@example.com'], root);
  await fs.writeFile(path.join(root, 'README.md'), 'base\n');
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'fixture', version: '1.0.0', private: true,
    scripts: { test: "node -e \"console.log('tests passed')\"", lint: "node -e \"console.log('lint passed')\"" },
  }));
  await fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ name: 'fixture', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'fixture', version: '1.0.0' } } }));
  await git(['add', '.'], root);
  await git(['commit', '-m', 'base'], root);
  const base = (await git(['rev-parse', 'HEAD'], root)).stdout.trim();
  return { root, worktreeDirectory, base, manager: new AgentWorktreeManager({ rootDirectory: root, worktreeDirectory }) };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const patch = `diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-base
+stream-a
`;

describe('AgentWorktreeManager', () => {
  it('prepares two isolated branches from the exact same base', async () => {
    const f = await fixture();
    const result = await f.manager.prepare(f.base);
    expect(result.worktrees['stream-a'].baseCommit).toBe(f.base);
    expect(result.worktrees['stream-b'].baseCommit).toBe(f.base);
    expect(result.worktrees['stream-a'].path).not.toBe(result.worktrees['stream-b'].path);
    expect(await fs.readFile(path.join(result.worktrees['stream-b'].path, 'README.md'), 'utf8')).toBe('base\n');
  });

  it('applies patches to one stream and returns a diff without changing the other', async () => {
    const f = await fixture();
    const result = await f.manager.prepare(f.base);
    await f.manager.applyPatch('stream-a', patch);
    const diff = await f.manager.getDiff('stream-a');
    expect(diff.changedFiles).toEqual(['README.md']);
    expect(diff.diff).toContain('+stream-a');
    expect(await fs.readFile(path.join(result.worktrees['stream-b'].path, 'README.md'), 'utf8')).toBe('base\n');
  });

  it('includes newly-created files in the review diff', async () => {
    const f = await fixture();
    await f.manager.prepare(f.base);
    const newFilePatch = `diff --git a/new-agent-file.txt b/new-agent-file.txt
new file mode 100644
--- /dev/null
+++ b/new-agent-file.txt
@@ -0,0 +1 @@
+created by stream
`;
    await f.manager.applyPatch('stream-b', newFilePatch);
    const diff = await f.manager.getDiff('stream-b');
    expect(diff.changedFiles).toContain('new-agent-file.txt');
    expect(diff.diff).toContain('+created by stream');
  });

  it('runs allowlisted tests and lint and rejects other commands', async () => {
    const f = await fixture();
    await f.manager.prepare(f.base);
    const results = await f.manager.runChecks('stream-a');
    expect(results).toHaveLength(3);
    expect(results.map((item) => item.exitCode)).toEqual([0, 0, 0]);
    expect(results[1].stdout).toContain('tests passed');
    await expect(f.manager.runChecks('stream-a', ['npm install' as never])).rejects.toThrow('Run both checks together');
  });

  it('runs both independent worktree test suites concurrently without sharing directories', async () => {
    const f = await fixture();
    await f.manager.prepare(f.base);
    const [a, b] = await Promise.all([
      f.manager.runChecks('stream-a'),
      f.manager.runChecks('stream-b'),
    ]);
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(3);
    expect(a.every((item) => item.exitCode === 0)).toBe(true);
    expect(b.every((item) => item.exitCode === 0)).toBe(true);
    expect(a.every((item) => item.id === 'stream-a')).toBe(true);
    expect(b.every((item) => item.id === 'stream-b')).toBe(true);
  });

  it('does not allow a branch commit until dependency install, tests and lint pass', async () => {
    const f = await fixture();
    await f.manager.prepare(f.base);
    await f.manager.applyPatch('stream-a', patch);
    await expect(f.manager.commit('stream-a', ['README.md'], 'must not commit')).rejects.toThrow('npm ci, npm test, and npm run lint must all pass');
    const checks = await f.manager.runChecks('stream-a');
    expect(checks.every((item) => item.exitCode === 0)).toBe(true);
    const sha = await f.manager.commit('stream-a', ['README.md'], 'commit after checks');
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('requires rerunning checks if files change after testing', async () => {
    const f = await fixture();
    await f.manager.prepare(f.base);
    await f.manager.applyPatch('stream-a', patch);
    await f.manager.runChecks('stream-a');
    await fs.writeFile(path.join(f.worktreeDirectory, 'stream-a', 'README.md'), 'changed after test\n');
    await expect(f.manager.commit('stream-a', ['README.md'], 'stale test approval')).rejects.toThrow('changed after its last successful test run');
  });

  it('rejects invalid base SHA and unsafe patch paths', async () => {
    const f = await fixture();
    await expect(f.manager.prepare('main')).rejects.toThrow('full 40-character');
    await f.manager.prepare(f.base);
    await expect(f.manager.applyPatch('stream-a', patch.replaceAll('README.md', '../escape.txt'))).rejects.toThrow('Unsafe patch path');
  });
});
