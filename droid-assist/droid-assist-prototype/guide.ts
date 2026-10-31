/**
 * The built-in user guide: every feature area of Droid Assist with what it does and how to use it,
 * as plain data so it is searchable and testable. The Help panel renders this; nothing here touches
 * app state.
 */

/** One feature inside a guide section: a name, a one-line summary, and how to use it. */
export interface GuideFeature {
  name: string;
  summary: string;
  /** Step-by-step usage, in order. */
  how: string[];
}

/** A group of related features, e.g. "Automation" or "The bridge". */
export interface GuideSection {
  id: string;
  title: string;
  /** One line on what the area is for. */
  intro: string;
  features: GuideFeature[];
}

export const GUIDE: readonly GuideSection[] = [
  {
    id: 'start',
    title: 'Getting started',
    intro: 'Droid Assist watches your screen, learns the elements on it, and can replay your actions — on this PC directly or through the main Droid app.',
    features: [
      {
        name: 'The live screen',
        summary: 'The stage at the top shows the live frame the assistant is reading, with the grid, trail and annotations drawn over it.',
        how: [
          'Pick the display in Settings → Capture, or leave it on the primary display.',
          'Set Monitor mode: app (0.5 s), background (1 s) or advanced (0.25 s).',
          'Turn on Show grid to label cells A1..H12 so the AI can point at a spot by name.',
        ],
      },
      {
        name: 'Auto Act and arming',
        summary: 'Auto Act lets the assistant run its plan for real; arming is what lets input reach the PC.',
        how: [
          'Record or plan a workflow first; steps start pending.',
          'Turn on Auto Act in the HUD to let it run; keep the action budget in Settings as a ceiling.',
          'Press the abort hotkey (Shift+Escape by default) at any time to latch an emergency stop.',
        ],
      },
      {
        name: 'The AI endpoint',
        summary: 'Every AI feature calls one Ollama-compatible chat URL; connect it once in Settings.',
        how: [
          'Set the AI URL (default is a local Ollama /api/chat) and the model name.',
          'Press Connect and watch the status badge; a failed connect is reported plainly.',
          'Turn on Model thinking only if your model can answer with it on.',
        ],
      },
    ],
  },
  {
    id: 'workflows',
    title: 'Workflows, packs and the library',
    intro: 'A workflow is a saved sequence of steps you can replay; packs bundle workflows and settings for a job.',
    features: [
      {
        name: 'Recording a workflow',
        summary: 'Record your clicks and drags into a card you can replay and edit.',
        how: [
          'Press Record, perform the task, then press Stop.',
          'Name the card and Save; it lands in the Library.',
          'Replay it with Run, or edit any step (position, text, delay) in the Workflow panel.',
        ],
      },
      {
        name: 'The library and packs',
        summary: 'The Library holds every saved card; packs group cards and settings you can import and export.',
        how: [
          'Open Library to run, rename, duplicate or delete a card.',
          'Export a pack to share a set of workflows; import one to bring them in.',
          'Draft cards (a run in progress) can be saved into the library from the Workflow panel.',
        ],
      },
      {
        name: 'Auto-continue and retries',
        summary: 'After a run, the assistant verifies the goal on the live screen and keeps going until it is done.',
        how: [
          'Turn on Auto-continue in Settings to verify → re-plan → run.',
          'Set Max iterations to bound the loop, and Step retries for per-step re-verification.',
        ],
      },
    ],
  },
  {
    id: 'agents',
    title: 'Agents, crew and the swarm',
    intro: 'Specialist agents (habits, identify, goal tracer and more) work alongside a worker crew that corrects coordinates live.',
    features: [
      {
        name: 'The agent crew',
        summary: 'A pool of worker agents you size in Settings; they verify and correct steps in parallel.',
        how: [
          'Set Crew size (5–50, default 25) in Settings.',
          'Watch them on the Crew and Agent crew panels; each reports its own work.',
          'Loop control turns stages and agents on or off; guardrails are never in it.',
        ],
      },
      {
        name: 'The coordinate swarm',
        summary: 'For live drags, the swarm corrects each segment against the grid so the drag lands true.',
        how: [
          'Turn on Live drag in Settings to run armed drags as parallel live drags.',
          'The swarm cross-references both apps’ elements with consensus before correcting.',
        ],
      },
      {
        name: 'Subagents and the agent bus',
        summary: 'Subagents run test goals and report back; the bus forwards messages between agents.',
        how: [
          'Give a test goal (a test spec) to spawn subagents on their own sections.',
          'Read their reports in Subagent report; the bus log shows every forwarded element.',
        ],
      },
    ],
  },
  {
    id: 'bridge',
    title: 'The bridge and the two apps',
    intro: 'Droid Assist (this app) and the main Droid app coordinate over the assist bridge; droid-new is the boss and settles disputes.',
    features: [
      {
        name: 'Connecting the bridge',
        summary: 'Listen for the main app or dial out to it, over WebSocket or HTTP.',
        how: [
          'In Settings → Main app bridge, choose listen or dial and set host/port (or URL) and token.',
          'The bridge toolbar shows off / waiting / connecting / connected / error.',
          'The Bridge wizard walks through the first connect step by step.',
        ],
      },
      {
        name: 'Who is driving',
        summary: 'A driving flag shows which app currently owns execution; on a clash droid-new wins and the other’s command becomes a queued suggestion.',
        how: [
          'Read the driving flag on the Coordinate tab.',
          'When both apps command at once, the loser is queued as a suggestion you can accept.',
          'Disagreements route to the Resolution center with a recorded ruling.',
        ],
      },
      {
        name: 'Shared memory and the run ledger',
        summary: 'Learned stores sync both ways over the bridge, and the run ledger is one shared timeline of every step, verdict and handoff.',
        how: [
          'Learned habits, familiar elements, element maps, access paths and blacklist entries sync as deltas.',
          'Conflicts resolve to the most recent verified observation; nothing is dropped.',
          'Read the shared timeline on the Ledger tab; both apps show the same entries.',
        ],
      },
      {
        name: 'Cross-app testing and habits',
        summary: 'Each app tests in its own domain in the background; a method that works in either app strengthens the habit in both.',
        how: [
          'Goals are tested in the background using screenshots and cross-referenced against both apps’ history and logs.',
          'A success in one app is recorded as a habit update the other app receives over the store sync.',
          'Watch the strengthened habits in the Habits panel.',
        ],
      },
      {
        name: 'Health, approvals and resume',
        summary: 'Both apps exchange live health and capabilities, share one approval queue, and resume after a restart.',
        how: [
          'App selection picks the executor from real current health, never assumptions.',
          'Approve or reject queued items from either app; decisions sync both ways.',
          'If one app restarts mid-operation, the other holds state and replays what it missed.',
        ],
      },
      {
        name: 'Adaptive frame streaming',
        summary: 'When several consumers pull frames at once (the desktop, the phone, a verification), quality and rate adapt to the bandwidth, and verification frames are prioritised over monitoring ones.',
        how: [
          'Nothing to configure: the stream lowers quality and slows the rate as more consumers join.',
          'A step being verified always gets the fastest, clearest frames.',
          'Watch the plan in the log line “Frame stream: …”.',
        ],
      },
    ],
  },
  {
    id: 'triggers',
    title: 'Triggers, habits and the ruler',
    intro: 'Automations that fire on a condition, the habits the assistant forms, and the pixel ruler for measuring the screen.',
    features: [
      {
        name: 'Triggers',
        summary: 'Fire a workflow or action when a condition is met (a time, a screen change, an element appearing).',
        how: [
          'Open Triggers and add one: pick the condition and the action.',
          'Toggle it on; fire it by hand with Fire to test it.',
        ],
      },
      {
        name: 'Habits and learned elements',
        summary: 'The assistant remembers what worked and reuses it; you can pin, rename or forget a habit.',
        how: [
          'Open Habits to see what it learned; pin the ones you trust.',
          'Open Elements / Element map to see every identified element and train a mapped one.',
          'Habits sync to the other app over the bridge.',
        ],
      },
      {
        name: 'The ruler',
        summary: 'Measure distances and align elements on the live frame with the on-screen ruler.',
        how: [
          'Open Ruler and drag to measure between two points.',
          'Measurements feed the element map so targets stay accurate across resolutions.',
        ],
      },
    ],
  },
  {
    id: 'world',
    title: 'Quest world, knowledge and presentation',
    intro: 'The playful and knowledge layers: quests that frame the work as goals, dossiers that record what is known, and the presentation view.',
    features: [
      {
        name: 'Quest world and goals',
        summary: 'Goals are framed as quests with progress; the Goal tracer spots a stalled goal and reports it.',
        how: [
          'Set a goal in the Goals panel; progress and quest world update as steps complete.',
          'Set Goal stall in Settings to decide how many failed checks count as stalled.',
        ],
      },
      {
        name: 'Knowledge, profile and stats',
        summary: 'Portfolios, dossiers and stats record what the assistant knows about your apps and how it is doing.',
        how: [
          'Open Knowledge for portfolios and the profile; open Stats for counts and trends.',
          'The operation database records every operation with its input and output.',
        ],
      },
      {
        name: 'Presentation',
        summary: 'A clean view for showing what the assistant is doing without the control panels.',
        how: [
          'Open Presentation to show the live view and progress to someone else.',
          'Dock or float any panel to arrange the workspace; the layout is remembered per area.',
        ],
      },
    ],
  },
  {
    id: 'new',
    title: 'Voice, phone and plugins',
    intro: 'The newest input/output channels: talk to the app, reach it from your phone, and extend it with plugins.',
    features: [
      {
        name: 'Voice control',
        summary: 'Speech-to-text turns your spoken commands into the same commands you would type; text-to-speech reads notifications and AI answers back.',
        how: [
          'In Settings → Voice, turn on speech-to-text and pick push-to-talk or always-on.',
          'Say a command such as “run the shopping workflow”; it routes into the command parser.',
          'Turn on text-to-speech to hear notifications and AI responses; set the voice and rate.',
        ],
      },
      {
        name: 'Phone companion',
        summary: 'A lightweight web page served by the bridge shows both apps’ status and lets you approve items, trigger workflows and watch the live screen from a phone on the same network.',
        how: [
          'In Settings → Phone companion, turn it on and note the URL and port.',
          'Open that URL on your phone (same network) and enter the token if one is set.',
          'Approve or reject queued approvals, trigger a saved workflow, or watch the live screen.',
        ],
      },
      {
        name: 'Plugins',
        summary: 'Drop-in modules add commands, agents and panel types without touching the core; the AI can invoke a plugin’s features like built-ins.',
        how: [
          'Put a plugin folder (with its manifest) in the plugins directory.',
          'Enable it in Settings → Plugins; it registers into the capability registry.',
          'Its commands and features then appear alongside the built-ins.',
        ],
      },
    ],
  },
  {
    id: 'settings',
    title: 'Settings and safety',
    intro: 'Where everything is configured, how updates arrive, and the guardrails that keep automation safe.',
    features: [
      {
        name: 'Settings at a glance',
        summary: 'One panel for capture, AI, bridge, automation limits, notifications, recovery and the new channels.',
        how: [
          'Open Settings; each group is headed and explained in place.',
          'Changes save as you make them; the recovery scan reports anything it repaired on start.',
        ],
      },
      {
        name: 'Updates',
        summary: 'The packaged app can update itself: on start it checks GitHub main and, when behind, pulls, rebuilds and relaunches.',
        how: [
          'Leave Update on start on to receive features without a manual pull.',
          'Press Check for updates any time; press Update now to apply one by hand.',
        ],
      },
      {
        name: 'Safety limits',
        summary: 'Bounds on what runs without asking: action budget, allowed hours, operation classes and per-category auto-act.',
        how: [
          'Set the action budget — the ceiling on real input actions per run.',
          'Set the operation policy: allowed hours, allowed operation classes, project scope.',
          'Auto-apply bounds decide what aggressive mode may do without asking; everything else waits for approval.',
        ],
      },
    ],
  },
];

/** One search hit: the section and feature it is in, with the matched text. */
export interface GuideHit {
  section: GuideSection;
  feature: GuideFeature;
}

/** All features across the guide, in order. */
export const allFeatures = (): GuideHit[] => GUIDE.flatMap((section) => section.features.map((feature) => ({ section, feature })));

/**
 * Features matching `query` (case-insensitive) in their name, summary or steps. An empty or blank
 * query returns everything; a query matching nothing returns an empty list.
 */
export function searchGuide(query: string): GuideHit[] {
  const q = query.trim().toLowerCase();
  const all = allFeatures();
  if (!q) return all;
  return all.filter(({ section, feature }) => [section.title, section.intro, feature.name, feature.summary, ...feature.how].some((text) => text.toLowerCase().includes(q)));
}

/** How many features the guide documents, for the panel's heading. */
export const guideFeatureCount = (): number => GUIDE.reduce((n, s) => n + s.features.length, 0);
