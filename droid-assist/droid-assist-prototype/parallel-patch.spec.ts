import { describe, expect, it } from 'vitest';
import { extractUnifiedGitDiff } from './parallel-patch.js';

describe('extractUnifiedGitDiff', () => {
  it('extracts a fenced complete diff and excludes trailing prose', () => {
    const output = 'Implementation follows.\n```diff\ndiff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n```\nThis is not part of the patch.';
    expect(extractUnifiedGitDiff(output)).toContain('+new');
    expect(extractUnifiedGitDiff(output)).not.toContain('not part of the patch');
  });
  it('accepts a raw complete diff', () => {
    const output = 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new';
    expect(extractUnifiedGitDiff(output)).toBe(output);
  });
  it('rejects code snippets and incomplete diffs', () => {
    expect(extractUnifiedGitDiff('```ts\nconst x = 1;\n```')).toBeNull();
    expect(extractUnifiedGitDiff('diff --git a/a b/a\n--- a/a\n+++ b/a')).toBeNull();
    expect(extractUnifiedGitDiff('x'.repeat(100_001))).toBeNull();
  });
});
