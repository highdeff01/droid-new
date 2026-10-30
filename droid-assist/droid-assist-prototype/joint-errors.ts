/**
 * Cross-app error handling: an error detected in either app (step failure, drift red, bridge error,
 * a main-app error or a browser console error from the swarm tab) is diagnosed into one corrective
 * change — a bounded fix script run directly in droid-new, or a code-file fix for droid-main that is
 * held in the approval queue and only sent over the bridge once approved.
 */
import type { ApprovalDraft, ApprovalItem } from './approvals.js';
import type { CaptureInput, ErrorKind } from './error-forwarding.js';
import type { FixContext } from './fix-script.js';
import type { CodeFixPayload, InterceptPayload, JointApp } from './main-bridge-protocol.js';

/** Who queues droid-main code fixes for approval; approved items from it are sent as code_fix. */
export const CODE_FIX_REQUESTER = 'Joint errors';
/** The file of a droid-main error that named none: the main app locates it itself. */
export const UNKNOWN_FILE = '(main app locates the file)';
const FILE_PREFIX = 'Code fix in ';

/** One error with the app it happened in. */
export interface JointError extends CaptureInput {
  app: JointApp;
  /** The code file a droid-main error points at, when known. */
  file?: string;
}

/** The corrective change for one error. */
export type Correction = { kind: 'fix_script'; app: 'droid-new'; context: FixContext; reason: string } | { kind: 'code_fix'; app: 'droid-main'; draft: ApprovalDraft; reason: string };

/** The app an error kind is raised in: main-app errors are droid-main's, every other kind droid-new's. */
export const errorApp = (kind: ErrorKind): JointApp => (kind === 'main-app' ? 'droid-main' : 'droid-new');

/** A main-app intercept (error_occurred or console_error) as a droid-main error. */
export function interceptError(p: InterceptPayload, goal: string): JointError {
  const message = p.kind === 'console_error' ? `Console error: ${p.message}` : p.message;
  return { app: 'droid-main', kind: 'main-app', message, goal, ...(p.file ? { file: p.file } : {}) };
}

/** A droid-new error: a bounded fix script against the failing element (or the goal) in the flow. */
function scriptFix(e: JointError): Correction {
  const context: FixContext = { element: e.step || e.kind, flow: e.goal?.trim() || '(no flow)', problem: e.message };
  return { kind: 'fix_script', app: 'droid-new', context, reason: `${e.kind} error in droid-new — a bounded fix script repairs "${context.element}" directly` };
}

/** A droid-main error: a code-file fix queued for approval (system file — never auto-runs). */
function codeFix(e: JointError): Correction {
  const file = e.file?.trim() || UNKNOWN_FILE;
  const draft: ApprovalDraft = { requestedBy: CODE_FIX_REQUESTER, kind: 'operation', cls: 'system_file', summary: `${FILE_PREFIX}${file}: ${e.message}`, context: `droid-main reported "${e.message}"${e.step ? ` at ${e.step}` : ''} — the code fix is sent to the main app only after approval`, goal: e.goal ?? '' };
  return { kind: 'code_fix', app: 'droid-main', draft, reason: `error in droid-main — code fix for ${file} waits for approval` };
}

const CORRECTIONS: Record<JointApp, (e: JointError) => Correction> = { 'droid-new': scriptFix, 'droid-main': codeFix };

/** The corrective change for an error, by the app it happened in. */
export const diagnose = (e: JointError): Correction => CORRECTIONS[e.app](e);

/**
 * The code_fix command of an approved (or edited) joint code-fix item; null for any other item.
 * An edit replaces the fix text.
 */
export function codeFixPayload(item: ApprovalItem): CodeFixPayload | null {
  if (item.requestedBy !== CODE_FIX_REQUESTER || (item.status !== 'approved' && item.status !== 'edited')) return null;
  const body = item.summary.startsWith(FILE_PREFIX) ? item.summary.slice(FILE_PREFIX.length) : item.summary;
  const cut = body.indexOf(': ');
  const file = cut > 0 ? body.slice(0, cut) : UNKNOWN_FILE;
  const problem = cut > 0 ? body.slice(cut + 2) : body;
  return { file, problem, fix: item.edit?.trim() || `Fix "${problem}" in ${file}`, approvalId: item.id };
}
