/** A slash command typed into the assist input. */
export type AssistCommand = { kind: CommandName; target: string } | { kind: 'error'; message: string };

/** Every slash command and its usage line. */
const COMMANDS = {
  use: 'Usage: /use <app or target>',
  move: 'Usage: /move <on-screen target>, e.g. /move files icon',
  test: 'Usage: /test links Files, Notes · /test route Cart > Checkout > Pay · /test <what to verify>',
  measure: 'Usage: /measure <a> to <b> [to <c>…], e.g. /measure files icon to game icon, /measure files icon to left edge, /measure 100,200 to 400,200',
  arrange: 'Usage: /arrange <how to move or reorder elements>, e.g. /arrange move the Files icon below Game',
  scenario: 'Usage: /scenario <dragon|wedding> — resets the test world and plans that persona goal',
  do: 'Usage: /do <capability id> {json params} · /do <request for the main AI>, e.g. /do script.run {"name":"login"}',
  snip: 'Usage: /snip x,y,w,h [WxH] [display <id>], e.g. /snip 0.1,0.2,0.3,0.25 800x',
  crew: 'Usage: /crew locate <element> · /crew test <element or reason>',
  intercept: 'Usage: /intercept [bridge:|agent:|app:|ai:] <what changed> [at x,y], e.g. /intercept app: popup opened at 40%,50%',
  backtrack: 'Usage: /backtrack <number of recent steps>, e.g. /backtrack 3',
  section: 'Usage: /section <name> x,y,w,h · /section auto · /section remove <name>',
  scope: 'Usage: /scope <section>[, <section>…] · /scope all',
  replicate: 'Usage: /replicate <name> x,y,w,h, e.g. /replicate save button 0.8,0.05,0.1,0.06',
  sidetest: 'Usage: /sidetest <target window> : <experimental action> [: <main action>], e.g. /sidetest Game : move character left : move character to the door',
  research: 'Usage: /research <window or URL> : <what to find>',
  crew: 'Usage: /crew <goal>, e.g. /crew find the Save button and the Files icon — the main AI commands a crew of agents',
} as const;

/** The name of a slash command. */
export type CommandName = keyof typeof COMMANDS;
const isCommand = (name: string): name is CommandName => Object.prototype.hasOwnProperty.call(COMMANDS, name);

/**
 * Parses the assist input. Returns null for plain goals (anything not starting with "/").
 * "/use <target>" attaches to an app; "/move <target>" moves the mouse onto an on-screen target;
 * "/measure <a> to <b>" measures between points; "/arrange <goal>" plans and runs a drag
 * rearrangement; "/do <capability>" invokes a registered capability. A command without a target and unknown commands are errors.
 * rearrangement; "/snip <region>" screenshots a region. A command without a target and unknown commands are errors.
 */
export function parseCommand(input: string): AssistCommand | null {
  const text = input.trim();
  if (!text.startsWith('/')) return null;
  const match = /^\/([a-z]+)(?:\s+(.*))?$/.exec(text);
  const name = match?.[1] ?? '';
  if (!match || !isCommand(name)) return { kind: 'error', message: `Unknown command "${text.split(/\s/)[0]}" — try /use <app or target>, /move <target>, /test <links|route ...>, /measure <a> to <b>, /arrange <goal> or /scenario <dragon|wedding>` };
  if (!match || !isCommand(name)) return { kind: 'error', message: `Unknown command "${text.split(/\s/)[0]}" — try /use <app or target>, /move <target>, /test <links|route ...>, /measure <a> to <b>, /arrange <goal> or /do <capability>` };
  if (!match || !isCommand(name)) return { kind: 'error', message: `Unknown command "${text.split(/\s/)[0]}" — try /use <app or target>, /move <target>, /test <links|route ...>, /measure <a> to <b>, /arrange <goal> or /snip x,y,w,h` };
  if (!match || !isCommand(name)) return { kind: 'error', message: `Unknown command "${text.split(/\s/)[0]}" — try /use <app or target>, /move <target>, /test <links|route ...>, /measure <a> to <b>, /arrange <goal>, /crew <locate|test ...>, /intercept <text> or /backtrack <n>` };
  if (!match || !isCommand(name)) return { kind: 'error', message: `Unknown command "${text.split(/\s/)[0]}" — try /use <app or target>, /move <target>, /test <links|route ...>, /measure <a> to <b>, /arrange <goal>, /section <name> x,y,w,h, /scope <sections>, /replicate <name> x,y,w,h, /sidetest <target> : <action> or /research <target> : <query>` };
  if (!match || !isCommand(name)) return { kind: 'error', message: `Unknown command "${text.split(/\s/)[0]}" — try /use <app or target>, /move <target>, /test <links|route ...>, /measure <a> to <b>, /arrange <goal> or /crew <goal>` };
  const target = (match[2] ?? '').trim();
  return target ? { kind: name, target } : { kind: 'error', message: COMMANDS[name] };
}
