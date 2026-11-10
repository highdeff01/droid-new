export type LongGenerationCheckpointMode = 'answer' | 'multi_file_code';

export interface LongGenerationCheckpoint {
  id: string;
  prompt: string;
  content: string;
  mode: LongGenerationCheckpointMode;
  rounds: number;
  updatedAt: number;
}

const KEY = 'droid-assist.long-generation-checkpoint.v1';
const MAX_CONTENT_CHARS = 100_000;

/** Save the newest completed generation snapshot. Returns false when browser storage is unavailable/full. */
export function saveLongGenerationCheckpoint(
  checkpoint: LongGenerationCheckpoint,
  storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
): boolean {
  if (!storage || !checkpoint.id || !checkpoint.content || checkpoint.content.length > MAX_CONTENT_CHARS) return false;
  try {
    storage.setItem(KEY, JSON.stringify(checkpoint));
    return true;
  } catch {
    return false;
  }
}

/** Load a validated checkpoint; corrupt or incompatible entries are ignored. */
export function loadLongGenerationCheckpoint(
  storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
): LongGenerationCheckpoint | null {
  if (!storage) return null;
  try {
    const value: unknown = JSON.parse(storage.getItem(KEY) ?? 'null');
    if (!value || typeof value !== 'object') return null;
    const item = value as Partial<LongGenerationCheckpoint>;
    if (typeof item.id !== 'string' || typeof item.prompt !== 'string' || typeof item.content !== 'string'
      || item.content.length > MAX_CONTENT_CHARS || (item.mode !== 'answer' && item.mode !== 'multi_file_code')
      || !Number.isInteger(item.rounds) || typeof item.updatedAt !== 'number') return null;
    return item as LongGenerationCheckpoint;
  } catch {
    return null;
  }
}

/** Remove the saved generation snapshot. */
export function clearLongGenerationCheckpoint(
  storage: Pick<Storage, 'removeItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
