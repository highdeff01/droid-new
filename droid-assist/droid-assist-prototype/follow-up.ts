/** Most verification passes over a presentation's slides or sections before the rest is reported unresolved. */
export const MAX_FOLLOW_UP_PASSES = 3;

/** One item's check result. */
export interface CheckResult {
  ok: boolean;
  reason: string;
}

/** Where one slide or section ended: verified, or unresolved after the last pass. */
export interface FollowUpItem {
  id: string;
  label: string;
  state: 'verified' | 'unresolved';
  attempts: number;
  reason: string;
}

/** The follow-up checks of one presentation: done only when nothing is left to do. */
export interface FollowUpReport {
  passes: number;
  items: FollowUpItem[];
  done: boolean;
}

const run = async <T>(check: (item: T, pass: number) => Promise<CheckResult>, item: T, pass: number): Promise<CheckResult> => {
  try {
    return await check(item, pass);
  } catch (error) {
    return { ok: false, reason: `check failed — ${error instanceof Error ? error.message : String(error)}` };
  }
};

/**
 * The project lifecycle follow-up: checks every item, then re-checks only the ones that failed on
 * the next pass, until nothing is pending or `maxPasses` passes ran; a throwing check is a failure.
 */
export async function runFollowUp<T extends { id: string }>(items: T[], label: (item: T) => string, check: (item: T, pass: number) => Promise<CheckResult>, maxPasses = MAX_FOLLOW_UP_PASSES): Promise<FollowUpReport> {
  const out = new Map<string, FollowUpItem>(items.map((i) => [i.id, { id: i.id, label: label(i), state: 'unresolved', attempts: 0, reason: 'not checked' }]));
  let pending = items;
  let passes = 0;
  while (pending.length && passes < maxPasses) {
    passes += 1;
    const failed: T[] = [];
    for (const item of pending) {
      const r = await run(check, item, passes);
      const prev = out.get(item.id)!;
      out.set(item.id, { ...prev, state: r.ok ? 'verified' : 'unresolved', attempts: prev.attempts + 1, reason: r.reason });
      if (!r.ok) failed.push(item);
    }
    pending = failed;
  }
  return { passes, items: [...out.values()], done: pending.length === 0 };
}

/** One-line text of a follow-up report for the log and notifications. */
export function followUpText(name: string, r: FollowUpReport): string {
  const verified = r.items.filter((i) => i.state === 'verified').length;
  const open = r.items.filter((i) => i.state === 'unresolved').map((i) => `"${i.label}": ${i.reason}`);
  return `Follow-up checks of "${name}": ${verified}/${r.items.length} verified in ${r.passes} pass(es)${r.done ? ' — nothing left to do' : ` — unresolved: ${open.join('; ')}`}`;
}
