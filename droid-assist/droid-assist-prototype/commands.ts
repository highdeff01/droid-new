/** A slash command typed into the assist input. */
export type AssistCommand = { kind: 'use'; target: string } | { kind: 'error'; message: string };

/**
 * Parses the assist input. Returns null for plain goals (anything not starting with "/").
 * Only "/use <target>" is a command; "/use" without a target and unknown commands are errors.
 */
export function parseCommand(input: string): AssistCommand | null {
  const text = input.trim();
  if (!text.startsWith('/')) return null;
  const match = /^\/use(?:\s+(.*))?$/.exec(text);
  if (!match) return { kind: 'error', message: `Unknown command "${text.split(/\s/)[0]}" — try /use <app or target>` };
  const target = (match[1] ?? '').trim();
  return target ? { kind: 'use', target } : { kind: 'error', message: 'Usage: /use <app or target>' };
}
