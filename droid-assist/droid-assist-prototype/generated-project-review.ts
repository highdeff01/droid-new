export interface GeneratedFile {
  path: string;
  content: string;
  language?: string;
}
export type GeneratedProjectIssueCode =
  | 'missing_file'
  | 'duplicate_file'
  | 'unsafe_path'
  | 'empty_file'
  | 'unclosed_fence'
  | 'missing_file_header'
  | 'unresolved_relative_import';
export interface GeneratedProjectIssue {
  code: GeneratedProjectIssueCode;
  message: string;
  path?: string;
}
export interface GeneratedProjectReview {
  files: GeneratedFile[];
  issues: GeneratedProjectIssue[];
  complete: boolean;
}

const IMPORT_PATH = /(?:from\s*|import\s*(?:\(\s*)?)(['"])(\.\.?\/[^'"]+)\1/g;

function isSafeRelativePath(path: string): boolean {
  if (!path || path.length > 240 || path.includes('\\') || path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return false;
  const segments = path.split('/');
  const reservedWindowsName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
  return segments.every((part) =>
    part.length > 0 &&
    part !== '.' &&
    part !== '..' &&
    !/[. ]$/.test(part) &&
    !reservedWindowsName.test(part)
  ) && !/[<>:"|?*\u0000-\u001f]/.test(path);
}

function findFileHeaders(output: string): Array<{ path: string; index: number; length: number }> {
  const headers: Array<{ path: string; index: number; length: number }> = [];
  let offset = 0;
  let fenceChar: string | undefined;
  let fenceLength = 0;

  for (const line of output.match(/[^\\r\\n]*(?:\\r?\\n|$)/g) ?? []) {
    if (!line) continue;
    const text = line.replace(/\\r?\\n$/, '');
    const fence = text.match(/^\\s*(`{3,}|~{3,})/);
    if (fence) {
      const token = fence[1];
      const char = token[0];
      if (!fenceChar) {
        fenceChar = char;
        fenceLength = token.length;
      } else if (char === fenceChar && token.length >= fenceLength && /^\\s*(?:`{3,}|~{3,})\\s*$/.test(text)) {
        fenceChar = undefined;
        fenceLength = 0;
      }
    } else if (!fenceChar) {
      const header = text.match(/^[ \\t]*FILE[ \\t]*:[ \\t]*(.*?)[ \\t]*$/);
      if (header) headers.push({ path: header[1].trim(), index: offset, length: line.length });
    }
    offset += line.length;
  }
  return headers;
}

function stripFence(source: string): { content: string; language?: string; closed: boolean } {
  const trimmed = source.trim();
  const opening = trimmed.match(/^\x60\x60\x60([^\r\n]*)\r?\n/);
  if (!opening) return { content: trimmed, closed: true };
  const bodyStart = opening[0].length;
  const closing = trimmed.indexOf('\n\x60\x60\x60', Math.max(0, bodyStart - 1));
  if (closing < 0) return { content: trimmed.slice(bodyStart), language: opening[1].trim() || undefined, closed: false };
  return {
    content: trimmed.slice(bodyStart, closing).replace(/\r?\n$/, ''),
    language: opening[1].trim() || undefined,
    closed: true,
  };
}

/**
 * Review the explicit FILE: sections emitted by multi-file generation. This is a
 * static completeness check only; it does not execute or write generated code.
 */
export function reviewGeneratedProject(output: string, expectedPaths: string[] = []): GeneratedProjectReview {
  const issues: GeneratedProjectIssue[] = [];
  const matches = findFileHeaders(output);
  const files: GeneratedFile[] = [];
  const seen = new Set<string>();
  const seenCanonical = new Set<string>();

  if (!matches.length && output.trim()) {
    issues.push({ code: 'missing_file_header', message: 'No explicit FILE: path headers were found.' });
  }

  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    const path = match.path;
    const start = match.index + match.length;
    const end = index + 1 < matches.length ? matches[index + 1].index : output.length;
    if (!isSafeRelativePath(path)) {
      issues.push({ code: 'unsafe_path', path, message: `Rejected unsafe or invalid generated path: ${path || '(empty)'}` });
      continue;
    }
    const canonicalPath = path.toLocaleLowerCase('en-US');
    if (seenCanonical.has(canonicalPath)) {
      issues.push({ code: 'duplicate_file', path, message: `The output declares ${path} more than once (paths are compared case-insensitively for Windows compatibility).` });
      continue;
    }
    seen.add(path);
    seenCanonical.add(canonicalPath);
    const extracted = stripFence(output.slice(start, end));
    if (!extracted.closed) issues.push({ code: 'unclosed_fence', path, message: `The code fence for ${path} is not closed.` });
    if (!extracted.content.trim()) issues.push({ code: 'empty_file', path, message: `${path} has no generated content.` });
    files.push({ path, content: extracted.content, language: extracted.language });
  }

  for (const expected of expectedPaths) {
    if (!seen.has(expected)) issues.push({ code: 'missing_file', path: expected, message: `Expected file ${expected} was not generated.` });
  }

  const generated = new Set(files.map((file) => file.path));
  for (const file of files) {
    for (const match of file.content.matchAll(IMPORT_PATH)) {
      const specifier = match[2];
      if (!specifier) continue;
      const base = file.path.split('/').slice(0, -1);
      const parts = [...base];
      let escapesProjectRoot = false;
      for (const segment of specifier.split('/')) {
        if (segment === '.') continue;
        if (segment === '..') {
          if (!parts.length) {
            escapesProjectRoot = true;
            break;
          }
          parts.pop();
        } else parts.push(segment);
      }
      if (escapesProjectRoot) {
        issues.push({
          code: 'unsafe_path',
          path: file.path,
          message: `Relative import "${specifier}" in ${file.path} escapes the generated project root.`,
        });
        continue;
      }
      const resolved = parts.join('/');
      const candidates = [resolved, resolved + '.ts', resolved + '.tsx', resolved + '.js', resolved + '.jsx', resolved + '/index.ts', resolved + '/index.tsx'];
      if (!candidates.some((candidate) => generated.has(candidate))) {
        issues.push({ code: 'unresolved_relative_import', path: file.path, message: `Relative import "${specifier}" in ${file.path} does not match a generated file.` });
      }
    }
  }

  return { files, issues, complete: issues.length === 0 && files.length > 0 };
}
