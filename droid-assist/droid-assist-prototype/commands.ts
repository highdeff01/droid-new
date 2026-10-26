/** A slash command typed into the assist input. */
export type AssistCommand = { kind: CommandName; target: string } | { kind: 'error'; message: string };

/** Every slash command and its usage line. */
const COMMANDS = {
  use: 'Usage: /use <app or target>',
  move: 'Usage: /move <on-screen target>, e.g. /move files icon',
  arrange: 'Usage: /arrange <how to move or reorder elements>, e.g. /arrange move the Files icon below Game',
} as const;

/** The name of a slash command. */
export type CommandName = keyof typeof COMMANDS;
const isCommand = (name: string): name is CommandName => Object.prototype.hasOwnProperty.call(COMMANDS, name);

/**
 * Parses the assist input. Returns null for plain goals (anything not starting with "/").
 * "/use <target>" attaches to an app; "/move <target>" moves the mouse onto an on-screen target;
 * "/arrange <goal>" plans and runs a drag rearrangement. A command without a target and unknown
 * commands are errors.
 */
export function parseCommand(input: string): AssistCommand | null {
  const text = input.trim();
  if (!text.startsWith('/')) return null;
  const match = /^\/([a-z]+)(?:\s+(.*))?$/.exec(text);
  const name = match?.[1] ?? '';
  if (!match || !isCommand(name)) return { kind: 'error', message: `Unknown command "${text.split(/\s/)[0]}" — try /use <app or target>, /move <target> or /arrange <goal>` };
  const target = (match[2] ?? '').trim();
  return target ? { kind: name, target } : { kind: 'error', message: COMMANDS[name] };
}
