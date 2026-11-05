import { execFile as execFileCallback } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
export const AGENT_WORKTREE_BRANCHES = {
  'stream-a': 'agent/stream-a-primary',
  'stream-b': 'agent/stream-b-alternative',
} as const;
export type AgentWorktreeId = keyof typeof AGENT_WORKTREE_BRANCHES;
export interface AgentWorktree {
  id: AgentWorktreeId;
  branch: string;
  path: string;
  baseCommit: string;
  prepared: boolean;
}
export interface AgentWorktreeSnapshot {
  repository: string;
  baseCommit: string;
  worktrees: Record<AgentWorktreeId, AgentWorktree>;
}
export interface AgentCheckResult {
  id: AgentWorktreeId;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  startedAt: number;
  finishedAt: number;
}
export interface AgentDiffResult {
  id: AgentWorktreeId;
  branch: string;
  baseCommit: string;
  diff: string;
  changedFiles: string[];
  clean: boolean;
}
export interface AgentWorktreeManagerOptions {
  rootDirectory: string;
  worktreeDirectory?: string;
  timeoutMs?: number;
  maxBufferBytes?: number;
}
const SHA = /^[0-9a-f]{40}$/i;
const PATCH_LIMIT = 1_000_000;
const OUTPUT_LIMIT = 2_000_000;
const CHECKS = ['npm test', 'npm run lint'] as const;
type CheckName = typeof CHECKS[number];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function safeRelativePath(value: string): boolean {
  return value.length > 0 && !path.isAbsolute(value) && !value.split(/[\\/]/).some((part) => part === '..' || part === '.git');
}

/**
 * Creates two local Git worktrees from one immutable base commit.
 * It never edits the source checkout, runs shell strings, or pushes without an explicit call.
 */
export class AgentWorktreeManager {
  private readonly root: string;
  private readonly worktreeRoot: string;
  private readonly timeoutMs: number;
  private readonly maxBuffer: number;
  private snapshot: AgentWorktreeSnapshot | null = null;

  constructor(options: AgentWorktreeManagerOptions) {
    this.root = path.resolve(options.rootDirectory);
    this.worktreeRoot = path.resolve(options.worktreeDirectory ?? path.join(path.dirname(this.root), `${path.basename(this.root)}-droid-agent-worktrees`));
    this.timeoutMs = Math.max(1_000, Math.min(30 * 60_000, options.timeoutMs ?? 10 * 60_000));
    this.maxBuffer = Math.max(64_000, Math.min(OUTPUT_LIMIT, options.maxBufferBytes ?? OUTPUT_LIMIT));
  }

  private async git(args: string[], cwd = this.root) {
    return execFile('git', args, { cwd, timeout: this.timeoutMs, maxBuffer: this.maxBuffer, windowsHide: true });
  }

  async inspectRepository(): Promise<{ root: string; branch: string; head: string }> {
    const root = (await this.git(['rev-parse', '--show-toplevel'])).stdout.trim();
    const branch = (await this.git(['branch', '--show-current'])).stdout.trim();
    const head = (await this.git(['rev-parse', 'HEAD'])).stdout.trim();
    if (path.resolve(root) !== this.root) throw new Error('Selected folder is not the Git repository root.');
    if (!SHA.test(head)) throw new Error('Git returned an invalid HEAD commit.');
    if (!branch) throw new Error('The source checkout is in detached HEAD state. Check out a branch first.');
    return { root, branch, head };
  }

  async prepare(requestedBaseCommit = ''): Promise<AgentWorktreeSnapshot> {
    const repo = await this.inspectRepository();
    const baseCommit = requestedBaseCommit.trim() || repo.head;
    if (!SHA.test(baseCommit)) throw new Error('Base commit must be a full 40-character Git SHA.');
    const resolved = (await this.git(['rev-parse', '--verify', `${baseCommit}^{commit}`])).stdout.trim();
    if (resolved.toLowerCase() !== baseCommit.toLowerCase()) throw new Error('The requested base commit did not resolve exactly.');
    await fs.mkdir(this.worktreeRoot, { recursive: true });
    const created: string[] = [];
    try {
      const worktrees = {} as Record<AgentWorktreeId, AgentWorktree>;
      for (const id of ['stream-a', 'stream-b'] as const) {
        const branch = AGENT_WORKTREE_BRANCHES[id];
        const directory = path.join(this.worktreeRoot, id);
        if (await fs.stat(directory).then(() => true).catch(() => false)) {
          throw new Error(`Worktree directory already exists: ${directory}. Inspect it before removing or reusing it.`);
        }
        await this.git(['worktree', 'add', '--detach', directory, baseCommit]);
        created.push(directory);
        await this.git(['switch', '-c', branch, baseCommit], directory);
        worktrees[id] = { id, branch, path: directory, baseCommit, prepared: true };
      }
      this.snapshot = { repository: repo.root, baseCommit, worktrees };
      return structuredClone(this.snapshot);
    } catch (error) {
      // Roll back only worktrees created by this prepare attempt. Never remove pre-existing directories.
      for (const directory of created.reverse()) {
        await this.git(['worktree', 'remove', '--force', directory]).catch(() => undefined);
      }
      throw new Error(`Could not prepare both isolated worktrees: ${errorText(error)}`);
    }
  }

  getSnapshot(): AgentWorktreeSnapshot | null {
    return this.snapshot ? structuredClone(this.snapshot) : null;
  }

  private getWorktree(id: AgentWorktreeId): AgentWorktree {
    const worktree = this.snapshot?.worktrees[id];
    if (!worktree?.prepared) throw new Error(`Worktree ${id} has not been prepared in this session.`);
    return worktree;
  }

  async applyPatch(id: AgentWorktreeId, patch: string): Promise<{ applied: boolean; check: string }> {
    const worktree = this.getWorktree(id);
    if (!patch.trim()) throw new Error('Patch is empty.');
    if (patch.length > PATCH_LIMIT) throw new Error(`Patch exceeds ${PATCH_LIMIT} characters.`);
    if (!patch.includes('diff --git ')) throw new Error('Only a unified Git diff is accepted; source snippets are not auto-applied.');
    const pathLines = patch.split(/\\r?\\n/).filter((line) => line.startsWith('+++ b/') || line.startsWith('--- a/'));
    for (const line of pathLines) {
      const value = line.slice(6).split('\t')[0];
      if (value !== '/dev/null' && !safeRelativePath(value)) throw new Error(`Unsafe patch path rejected: ${value}`);
    }
    const patchFile = path.join(worktree.path, `.droid-agent-${id}.patch`);
    try {
      await fs.writeFile(patchFile, patch, { encoding: 'utf8', flag: 'wx' });
      const checked = await this.git(['apply', '--check', '--', patchFile], worktree.path);
      await this.git(['apply', '--', patchFile], worktree.path);
      return { applied: true, check: checked.stdout || 'git apply --check passed' };
    } finally {
      await fs.rm(patchFile, { force: true });
    }
  }

  async runChecks(id: AgentWorktreeId, commands: CheckName[] = [...CHECKS]): Promise<AgentCheckResult[]> {
    const worktree = this.getWorktree(id);
    if (!commands.length || commands.some((command) => !CHECKS.includes(command))) {
      throw new Error(`Only these allowlisted checks may run: ${CHECKS.join(', ')}`);
    }
    const results: AgentCheckResult[] = [];
    for (const command of commands) {
      const startedAt = Date.now();
      const [program, ...args] = command.split(' ');
      try {
        const result = await execFile(program, args, { cwd: worktree.path, timeout: this.timeoutMs, maxBuffer: this.maxBuffer, windowsHide: true });
        results.push({ id, command, exitCode: 0, stdout: result.stdout.slice(0, OUTPUT_LIMIT), stderr: result.stderr.slice(0, OUTPUT_LIMIT), startedAt, finishedAt: Date.now() });
      } catch (error) {
        const e = error as Error & { code?: number | string; stdout?: string; stderr?: string };
        results.push({ id, command, exitCode: typeof e.code === 'number' ? e.code : 1, stdout: (e.stdout ?? '').slice(0, OUTPUT_LIMIT), stderr: (e.stderr ?? errorText(error)).slice(0, OUTPUT_LIMIT), startedAt, finishedAt: Date.now() });
        break;
      }
    }
    return results;
  }

  async getDiff(id: AgentWorktreeId): Promise<AgentDiffResult> {
    const worktree = this.getWorktree(id);
    const [diff, names, status] = await Promise.all([
      this.git(['diff', '--no-ext-diff', '--binary', worktree.baseCommit, '--'], worktree.path),
      this.git(['diff', '--name-only', worktree.baseCommit, '--'], worktree.path),
      this.git(['status', '--porcelain=v1'], worktree.path),
    ]);
    const changedFiles = names.stdout.split(/\\r?\\n/).filter(Boolean);
    return { id, branch: worktree.branch, baseCommit: worktree.baseCommit, diff: diff.stdout.slice(0, OUTPUT_LIMIT), changedFiles, clean: status.stdout.trim().length === 0 };
  }

  /** Commit only explicit changed paths after the caller has inspected the diff and test output. */
  async commit(id: AgentWorktreeId, paths: string[], message: string): Promise<string> {
    const worktree = this.getWorktree(id);
    if (!message.trim() || message.length > 200) throw new Error('Commit message must be 1–200 characters.');
    if (!paths.length || paths.length > 100) throw new Error('Select between 1 and 100 changed paths.');
    for (const value of paths) if (!safeRelativePath(value)) throw new Error(`Unsafe commit path rejected: ${value}`);
    const changed = new Set((await this.getDiff(id)).changedFiles);
    if (paths.some((value) => !changed.has(value))) throw new Error('Commit paths must be changed files in this worktree diff.');
    await this.git(['add', '--', ...paths], worktree.path);
    await this.git(['commit', '-m', message], worktree.path);
    return (await this.git(['rev-parse', 'HEAD'], worktree.path)).stdout.trim();
  }

  /** Push is deliberately separate from commit and must be triggered by an explicit user action. */
  async push(id: AgentWorktreeId): Promise<string> {
    const worktree = this.getWorktree(id);
    await this.git(['push', '--set-upstream', 'origin', worktree.branch], worktree.path);
    return (await this.git(['rev-parse', 'HEAD'], worktree.path)).stdout.trim();
  }
}
