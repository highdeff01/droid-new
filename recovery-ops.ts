import type { WorkflowStep } from './types.js';
import { uid } from './planner.js';

/** Every recovery operation the resolution center can execute. */
export type RecoveryOpKind = 'retry' | 'fix' | 'appRecover' | 'test' | 'elementRecover' | 'hardTrack' | 'createApp' | 'maintenance' | 'rechat' | 'reconnect';

/** What an operation is, and whether it must wait for an approval before it runs. */
export interface RecoveryOp {
  label: string;
  description: string;
  /** Admin-class: queued behind the approval queue, never run directly. */
  admin: boolean;
  /** What the operation is given (app name, element, script…); empty when it takes nothing. */
  arg: string;
}

/** The recovery operation catalogue. */
export const RECOVERY_OPS: Readonly<Record<RecoveryOpKind, RecoveryOp>> = {
  retry: { label: 'Main retry', description: 'Re-runs the failed and drifted plan steps through the gated pipeline', admin: false, arg: '' },
  fix: { label: 'Error fix', description: 'Has the supervisor review the run and apply its confident fixes', admin: false, arg: '' },
  appRecover: { label: 'App recovery', description: 'Relaunches or refocuses an app on the PC', admin: false, arg: 'App' },
  test: { label: 'Main test', description: 'Self-tests the plan (verifies every step, no input)', admin: false, arg: '' },
  elementRecover: { label: 'Element recovery', description: 'Re-locates a lost element once', admin: false, arg: 'Element' },
  hardTrack: { label: 'Hard tracking', description: 'Persistently re-acquires a lost element until found or out of attempts', admin: false, arg: 'Element' },
  createApp: { label: 'App creation', description: 'Scaffolds a small app/script within the sandboxed script rules', admin: false, arg: 'Name: script' },
  maintenance: { label: 'Computer maintenance', description: 'Repair, backup or cleanup routine via computer control (admin, needs approval)', admin: true, arg: 'repair | backup | cleanup' },
  rechat: { label: 'Re-chat', description: 'Reroutes the question to another AI in a separate program (browser side research)', admin: false, arg: 'Program: message' },
  reconnect: { label: 'Reconnect', description: 'Re-establishes the desktop bridge with retry and backoff', admin: false, arg: '' },
};

/** Every operation, in panel order. */
export const RECOVERY_OP_KINDS = Object.keys(RECOVERY_OPS) as RecoveryOpKind[];

/** An operation's result. */
export interface OpResult {
  ok: boolean;
  message: string;
}

/** One admin operation waiting for (or decided by) the user. */
export interface Approval {
  id: string;
  time: number;
  op: RecoveryOpKind;
  arg: string;
  status: 'pending' | 'approved' | 'rejected';
}

/** Queues an admin operation for approval, newest first. */
export function enqueue(queue: Approval[], op: RecoveryOpKind, arg: string, now = Date.now()): Approval[] {
  return [{ id: uid('apr'), time: now, op, arg, status: 'pending' }, ...queue];
}

/** Approves or rejects a pending item; returns the queue and the item decided (null when none was pending). */
export function decide(queue: Approval[], id: string, approve: boolean): { queue: Approval[]; item: Approval | null } {
  const found = queue.find((a) => a.id === id && a.status === 'pending');
  if (!found) return { queue, item: null };
  const item: Approval = { ...found, status: approve ? 'approved' : 'rejected' };
  return { queue: queue.map((a) => (a.id === id ? item : a)), item };
}

/** Largest script an app scaffold may contain. */
export const MAX_SCRIPT_CHARS = 8000;

/** The sandboxed script rules: what a scaffolded script may never do. */
const SCRIPT_RULES: ReadonlyArray<{ rule: string; pattern: RegExp }> = [
  { rule: 'destructive file or disk command', pattern: /\brm\s+-[a-z]*r[a-z]*f|\bdel\s+\/[sq]|\bformat\s+[a-z]:|\bmkfs\b|\bdiskpart\b|\brmdir\s+\/s|Remove-Item\b.*-Recurse/i },
  { rule: 'system power or registry change', pattern: /\bshutdown\b|\breg\s+(delete|add)\b|\bbcdedit\b/i },
  { rule: 'network or registry write', pattern: /\bnpm\s+publish\b|\bgit\s+push\b|\bcurl\b.*-X\s*(POST|PUT|DELETE)|-Method\s+(Post|Put|Delete)/i },
  { rule: 'privilege escalation', pattern: /\bsudo\b|\brunas\b/i },
];

/** Every sandbox rule the script breaks (empty when it may be scaffolded). */
export function checkScriptRules(script: string): string[] {
  const broken = SCRIPT_RULES.filter((r) => r.pattern.test(script)).map((r) => r.rule);
  return script.length > MAX_SCRIPT_CHARS ? [...broken, `longer than ${MAX_SCRIPT_CHARS} characters`] : broken;
}

/** One file of a scaffolded app. */
export interface ScaffoldFile {
  path: string;
  content: string;
}

/** A scaffold, or the rules that refused it. */
export type Scaffold = { ok: true; files: ScaffoldFile[] } | { ok: false; violations: string[] };

const slug = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app';

/** Rapid scaffold of a small app: its script and a README; refused when the script breaks a sandbox rule. */
export function scaffoldApp(name: string, script: string): Scaffold {
  const violations = checkScriptRules(script);
  if (violations.length) return { ok: false, violations };
  const dir = slug(name);
  return {
    ok: true,
    files: [
      { path: `${dir}/main.js`, content: `${script.trim()}\n` },
      { path: `${dir}/README.md`, content: `# ${name.trim() || dir}\n\nScaffolded by the Droid Assist resolution center. Run with \`node main.js\`.\n` },
    ],
  };
}

/** Splits an operation argument "head: rest" (rest empty when there is no colon). */
export function splitArg(arg: string): { head: string; rest: string } {
  const i = arg.indexOf(':');
  return i < 0 ? { head: arg.trim(), rest: '' } : { head: arg.slice(0, i).trim(), rest: arg.slice(i + 1).trim() };
}

const step = (name: string, action: WorkflowStep['action'], text: string): WorkflowStep => ({ id: uid('step'), name, action, text, x: 0.5, y: 0.5, status: 'pending' });

/** Opens a terminal, types one command and presses Enter: how computer control runs a routine. */
const terminal = (name: string, command: string): WorkflowStep[] => [step(`Open terminal for ${name}`, 'open_app', 'cmd'), step(name, 'type', command), step(`Run ${name}`, 'key', 'Enter')];

/** The computer repair, backup and maintenance routines, as computer-control steps. */
export const MAINTENANCE_ROUTINES: Readonly<Record<'repair' | 'backup' | 'cleanup', () => WorkflowStep[]>> = {
  repair: () => terminal('System file repair', 'sfc /scannow'),
  backup: () => terminal('Documents backup', 'robocopy "%USERPROFILE%\\Documents" "%USERPROFILE%\\DroidBackup" /E'),
  cleanup: () => terminal('Disk cleanup', 'cleanmgr /sagerun:1'),
};

/** The routine's steps; null when the name is not a routine. */
export function maintenanceSteps(name: string): WorkflowStep[] | null {
  const routine = MAINTENANCE_ROUTINES[name.trim().toLowerCase() as keyof typeof MAINTENANCE_ROUTINES];
  return routine ? routine() : null;
}

/** Re-chatting another AI in a separate program: open it, type the message, send. */
export function rechatSteps(program: string, message: string): WorkflowStep[] {
  return [step(`Open ${program}`, 'open_app', program), step(`Ask ${program}`, 'type', message), step(`Send to ${program}`, 'key', 'Enter')];
}

/** App recovery: relaunch or refocus the app. */
export const appRecoverSteps = (app: string): WorkflowStep[] => [step(`Recover ${app}`, 'open_app', app)];

/** Default reconnect schedule: attempts, first delay and cap (ms). */
export const RECONNECT_ATTEMPTS = 5;
export const BACKOFF_BASE_MS = 500;
export const BACKOFF_MAX_MS = 8000;

/** Exponential backoff: the delay before each retry after the first attempt, doubling up to `max`. */
export function backoffDelays(attempts = RECONNECT_ATTEMPTS, base = BACKOFF_BASE_MS, max = BACKOFF_MAX_MS): number[] {
  return Array.from({ length: Math.max(0, attempts - 1) }, (_, i) => Math.min(max, base * 2 ** i));
}

/** Tries `connect` until it succeeds, waiting each backoff delay between attempts. */
export async function reconnectWithBackoff(connect: () => Promise<boolean>, sleep: (ms: number) => Promise<void>, delays = backoffDelays()): Promise<{ ok: boolean; attempts: number }> {
  for (let attempt = 1; ; attempt++) {
    if (await connect()) return { ok: true, attempts: attempt };
    if (attempt > delays.length) return { ok: false, attempts: attempt };
    await sleep(delays[attempt - 1]);
  }
}

/** Hard tracking: attempts and the pause between them. */
export const HARD_TRACK_ATTEMPTS = 6;
export const HARD_TRACK_INTERVAL_MS = 1000;

/** Persistent re-acquisition: asks `find` until it returns a point or the attempts run out. */
export async function hardTrack<P>(find: (attempt: number) => Promise<P | null>, sleep: (ms: number) => Promise<void>, attempts = HARD_TRACK_ATTEMPTS, intervalMs = HARD_TRACK_INTERVAL_MS): Promise<{ point: P | null; attempts: number }> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const point = await find(attempt);
    if (point) return { point, attempts: attempt };
    if (attempt < attempts) await sleep(intervalMs);
  }
  return { point: null, attempts };
}
