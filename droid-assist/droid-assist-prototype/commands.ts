/** A slash command typed into the assist input. */
export type AssistCommand = { kind: CommandName; target: string } | { kind: 'error'; message: string };

/** Every slash command and its usage line. */
const COMMANDS = {
  use: 'Usage: /use <app or target>',
  move: 'Usage: /move <on-screen target>, e.g. /move files icon',
  test: 'Usage: /test links Files, Notes · /test route Cart > Checkout > Pay · /test <what to verify>',
  measure: 'Usage: /measure <a> to <b> [to <c>…], e.g. /measure files icon to game icon, /measure files icon to left edge, /measure 100,200 to 400,200',
  arrange: 'Usage: /arrange <how to move or reorder elements>, e.g. /arrange move the Files icon below Game',
  crew: 'Usage: /crew locate <element> · /crew test <element or reason>',
  intercept: 'Usage: /intercept [bridge:|agent:|app:|ai:] <what changed> [at x,y], e.g. /intercept app: popup opened at 40%,50%',
  backtrack: 'Usage: /backtrack <number of recent steps>, e.g. /backtrack 3',
} as const;

/** The name of a slash command. */
export type CommandName = keyof typeof COMMANDS;
const isCommand = (name: string): name is CommandName => Object.prototype.hasOwnProperty.call(COMMANDS, name);

/**
 * Parses the assist input. Returns null for plain goals (anything not starting with "/").
 * "/use <target>" attaches to an app; "/move <target>" moves the mouse onto an on-screen target;
 * "/measure <a> to <b>" measures between points; "/arrange <goal>" plans and runs a drag
 * rearrangement. A command without a target and unknown commands are errors.
 */
export function parseCommand(input: string): AssistCommand | null {
  const text = input.trim();
  if (!text.startsWith('/')) return null;
  const match = /^\/([a-z]+)(?:\s+(.*))?$/.exec(text);
  const name = match?.[1] ?? '';
  if (!match || !isCommand(name)) return { kind: 'error', message: `Unknown command "${text.split(/\s/)[0]}" — try /use <app or target>, /move <target>, /test <links|route ...>, /measure <a> to <b>, /arrange <goal>, /crew <locate|test ...>, /intercept <text> or /backtrack <n>` };
  const target = (match[2] ?? '').trim();
  return target ? { kind: name, target } : { kind: 'error', message: COMMANDS[name] };
}
