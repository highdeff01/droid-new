import type { AskFn } from './ai.js';
import { reviewGeneratedProject, type GeneratedFile, type GeneratedProjectReview } from './generated-project-review.js';

export interface GeneratedProjectRepairOptions {
  maxAttempts?: number;
  signal?: AbortSignal;
  maxContextChars?: number;
}
export interface GeneratedProjectRepairResult {
  originalOutput: string;
  output: string;
  review: GeneratedProjectReview;
  attempts: number;
  repaired: boolean;
}

/** Rebuild explicit FILE sections without changing the original source held by the caller. */
export function assembleGeneratedProject(files: GeneratedFile[]): string {
  return files.map((file) => `FILE: ${file.path}\n\x60\x60\x60${file.language ?? ''}\n${file.content}\n\x60\x60\x60`).join('\n\n');
}

/**
 * Ask the configured planner to repair only files implicated by static review findings.
 * This is deliberately text-only: it never writes files, executes code, or dispatches input.
 */
export async function repairGeneratedProject(
  ask: AskFn,
  originalOutput: string,
  options: GeneratedProjectRepairOptions = {},
): Promise<GeneratedProjectRepairResult> {
  const maxAttempts = Math.max(1, Math.min(2, Math.floor(options.maxAttempts ?? 2)));
  const maxContextChars = Math.max(8_000, Math.min(60_000, Math.floor(options.maxContextChars ?? 36_000)));
  let output = originalOutput;
  let review = reviewGeneratedProject(output);
  let attempts = 0;
  if (!review.issues.length) return { originalOutput, output, review, attempts, repaired: false };

  for (let attempt = 0; attempt < maxAttempts && review.issues.length; attempt++) {
    if (options.signal?.aborted) break;
    const targets = [...new Set(review.issues.map((issue) => issue.path).filter((path): path is string => Boolean(path)))];
    const selected = review.files.filter((file) => targets.includes(file.path));
    let remaining = maxContextChars;
    const context = selected.map((file) => {
      const content = file.content.slice(0, Math.max(0, Math.min(file.content.length, remaining)));
      remaining -= content.length;
      return `FILE: ${file.path}\n${content}`;
    }).join('\n\n');
    const prompt = [
      'Repair the generated project based on the static diagnostics below.',
      'Return ONLY complete replacement files, each using FILE: relative/path.ext followed by one fenced code block.',
      'Only return files listed as repair targets. Do not alter unrelated files, invent paths, omit required imports, or add explanations.',
      'For missing_file diagnostics, create the exact missing target path.',
      'Diagnostics:', ...review.issues.map((issue) => `- ${issue.code} ${issue.path ? `[${issue.path}]` : ''}: ${issue.message}`),
      'Existing target file context:', context || '(No existing target file content.)',
    ].join('\n');
    const reply = await ask({
      system: 'You are a conservative generated-code repair agent. Return complete corrected source files only. Preserve behavior and public interfaces wherever possible.',
      prompt,
      signal: options.signal,
    });
    attempts++;
    const patch = reviewGeneratedProject(reply.content, targets);
    if (!patch.files.length || patch.issues.some((issue) => issue.code === 'unsafe_path' || issue.code === 'duplicate_file' || issue.code === 'missing_file_header' || issue.code === 'unclosed_fence' || issue.code === 'empty_file')) break;
    const allowed = new Set(targets);
    const replacements = new Map(patch.files.filter((file) => allowed.has(file.path)).map((file) => [file.path, file]));
    if (!replacements.size) break;
    const merged = review.files.map((file) => replacements.get(file.path) ?? file);
    for (const file of patch.files) {
      if (!review.files.some((existing) => existing.path === file.path) && allowed.has(file.path)) merged.push(file);
    }
    output = assembleGeneratedProject(merged);
    review = reviewGeneratedProject(output);
  }
  return { originalOutput, output, review, attempts, repaired: output !== originalOutput && review.issues.length === 0 };
}
