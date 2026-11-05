/**
 * Extracts only a complete unified Git diff from a model response.
 * Returns null for source snippets or prose so they cannot be mistaken for an applicable patch.
 */
export function extractUnifiedGitDiff(output: string): string | null {
  if (!output || output.length > 100_000) return null;
  const start = output.indexOf('diff --git ');
  if (start < 0) return null;
  const closingFence = output.indexOf('```', start);
  const candidate = output.slice(start, closingFence < 0 ? undefined : closingFence).trim();
  if (!candidate.startsWith('diff --git ') || !candidate.includes('\n--- ') || !candidate.includes('\n+++ ')) return null;
  const lines = candidate.split(/\r?\n/);
  if (!lines.some((line) => line.startsWith('@@ ') || line.startsWith('GIT binary patch'))) return null;
  return candidate;
}
