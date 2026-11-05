/**
 * Update-on-start for the packaged app: it checks GitHub `main`, and when it is behind pulls the
 * latest, reinstalls, rebuilds and relaunches — so a merged feature reaches the running app without
 * a manual pull / npm install / rebuild. Every step is a plain command run through an injected
 * runner, so the decision logic is testable without git or Electron.
 */

/** Runs one command, resolving its captured output; never throws. */
export type CommandRunner = (command: string, args: readonly string[]) => Promise<{ ok: boolean; output: string }>;

/** Where the app lives and how it updates. */
export interface UpdateOptions {
  /** The git working tree to pull into (the repository root). */
  repoRoot: string;
  /** The directory to reinstall and rebuild in (the prototype package). */
  appDir: string;
  /** Remote name, default `origin`. */
  remote?: string;
  /** Branch to track, default `main`. */
  branch?: string;
}

/** What a check found. */
export interface UpdateCheck {
  ok: boolean;
  /** Commits on the remote the local branch does not have. */
  behind: number;
  /** Subject of the newest remote commit, when known. */
  latest: string;
  message: string;
}

/** The outcome of one update step, in order. */
export interface UpdateStep {
  name: string;
  ok: boolean;
  output: string;
}

/** The whole update run. */
export interface UpdateResult {
  ok: boolean;
  steps: UpdateStep[];
  message: string;
}

const remote = (o: UpdateOptions) => o.remote ?? 'origin';
const branch = (o: UpdateOptions) => o.branch ?? 'main';

/** Fetches the tracked branch. */
async function fetchRemote(o: UpdateOptions, run: CommandRunner): Promise<{ ok: boolean; output: string }> {
  return run('git', ['-C', o.repoRoot, 'fetch', '--quiet', remote(o), branch(o)]);
}

/**
 * Checks whether the local branch is behind the remote. Never throws: a missing git, an unreachable
 * remote or a detached checkout all come back as `ok: false` with a reason.
 */
export async function checkForUpdate(o: UpdateOptions, run: CommandRunner): Promise<UpdateCheck> {
  const fetched = await fetchRemote(o, run);
  if (!fetched.ok) return { ok: false, behind: 0, latest: '', message: `Could not reach ${remote(o)}/${branch(o)} — ${fetched.output.trim() || 'git fetch failed'}` };
  const target = `${remote(o)}/${branch(o)}`;
  const counted = await run('git', ['-C', o.repoRoot, 'rev-list', '--count', `HEAD..${target}`]);
  if (!counted.ok) return { ok: false, behind: 0, latest: '', message: `Could not compare with ${target} — ${counted.output.trim() || 'git rev-list failed'}` };
  const behind = Number.parseInt(counted.output.trim(), 10) || 0;
  if (behind === 0) return { ok: true, behind: 0, latest: '', message: 'Up to date' };
  const subject = await run('git', ['-C', o.repoRoot, 'log', '-1', '--format=%s', target]);
  const latest = subject.ok ? subject.output.trim() : '';
  return { ok: true, behind, latest, message: `${behind} new commit${behind === 1 ? '' : 's'} on ${target}${latest ? ` — ${latest}` : ''}` };
}

/** Pulls the tracked branch fast-forward-only, reinstalls, rebuilds. Stops at the first failure. */
export async function runUpdate(o: UpdateOptions, run: CommandRunner): Promise<UpdateResult> {
  const steps: UpdateStep[] = [];
  const attempt = async (name: string, command: string, args: readonly string[]): Promise<boolean> => {
    const r = await run(command, args);
    steps.push({ name, ok: r.ok, output: r.output.trim() });
    return r.ok;
  };

  if (!(await attempt('fetch', 'git', ['-C', o.repoRoot, 'fetch', '--quiet', remote(o), branch(o)]))) {
    return { ok: false, steps, message: `Update stopped at fetch — ${steps.at(-1)?.output || 'git fetch failed'}` };
  }
  if (!(await attempt('pull', 'git', ['-C', o.repoRoot, 'pull', '--ff-only', remote(o), branch(o)]))) {
    return { ok: false, steps, message: `Update stopped at pull — the local branch has diverged or is dirty; ${steps.at(-1)?.output || 'git pull failed'}` };
  }
  if (!(await attempt('install', 'npm', ['--prefix', o.appDir, 'install']))) {
    return { ok: false, steps, message: `Update stopped at install — ${steps.at(-1)?.output || 'npm install failed'}` };
  }
  if (!(await attempt('build', 'npm', ['--prefix', o.appDir, 'run', 'build']))) {
    return { ok: false, steps, message: `Update stopped at build — ${steps.at(-1)?.output || 'build failed'}` };
  }
  return { ok: true, steps, message: `Updated to ${remote(o)}/${branch(o)} and rebuilt — relaunching` };
}

/** One line for the log or the settings panel. */
export const updateLine = (c: UpdateCheck): string => (c.ok ? (c.behind ? `Update available: ${c.message}` : 'Droid Assist is up to date') : `Update check failed: ${c.message}`);
