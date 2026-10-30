import type { Frame, StepAction, WorkflowStep } from './types.js';
import { createOperation, type SavedOperation } from './saved-operations.js';
import { CALCULATOR, QUEST_TOGGLE, TALK_BUTTON, initialQuest } from './quest-world.js';
import { DEMO_ARCHIVE, DEMO_FILE, demoAd, initialDemoIcons } from './demo-desktop.js';

/**
 * Sample workflows shipped with the app: demo-world tours, a popup dismissal and a drag-and-drop.
 * Each step carries the demo scene it acts on; installing renders that scene as the step's reference
 * frame, so the samples run AI-free out of the box and can be loaded as recording templates.
 */

/** The demo desktop state a step's reference frame is rendered from. */
export interface SampleScene {
  /** The quest world is open in place of the puzzle game. */
  quest: boolean;
  /** The ad popup is showing. */
  ad: boolean;
}

/** One sample step: what it does, where, and on which scene. */
export interface SampleStep {
  name: string;
  action: StepAction;
  target: string;
  x: number;
  y: number;
  text?: string;
  endX?: number;
  endY?: number;
  endTarget?: string;
  scene: SampleScene;
}

/** A shipped sample: its name, goal and steps. */
export interface SampleWorkflow {
  name: string;
  goal: string;
  steps: SampleStep[];
}

/** Renders a demo scene as a Frame (the demo canvas); null where there is no canvas. */
export type SceneRenderer = (scene: SampleScene) => Frame | null;

const DESKTOP: SampleScene = { quest: false, ad: false };
const QUEST: SampleScene = { quest: true, ad: false };
const AD: SampleScene = { quest: false, ad: true };

const files = initialDemoIcons()[0];
const sword = initialQuest().items[0];
const knight = initialQuest().characters[0];
/** A demo tick at which the ad popup is showing (it is hidden at tick 0). */
export const AD_VISIBLE_TICK = 15;
const ad = demoAd(AD_VISIBLE_TICK);
const archive = { x: DEMO_ARCHIVE.x + DEMO_ARCHIVE.w / 2, y: DEMO_ARCHIVE.y + DEMO_ARCHIVE.h / 2 };

/** The demo tick a scene is rendered at. */
export const sceneTick = (scene: SampleScene) => (scene.ad ? AD_VISIBLE_TICK : 0);

const click = (name: string, target: string, p: { x: number; y: number }, scene: SampleScene): SampleStep => ({ name, action: 'click', target, x: p.x, y: p.y, scene });

/** Every sample shipped with the app. */
export const SAMPLE_WORKFLOWS: readonly SampleWorkflow[] = [
  {
    name: 'Sample: open Files',
    goal: 'click the Files icon on the demo desktop',
    steps: [click('Click Files', 'Files icon', files, DESKTOP)],
  },
  {
    name: 'Sample: quest world tour',
    goal: 'open the quest world, equip the sword, talk to the priest and run the calculator',
    steps: [
      click('Open the quest world', 'Quest button', QUEST_TOGGLE, DESKTOP),
      { name: 'Equip the sword', action: 'drag', target: 'Sword', x: sword.x, y: sword.y, endX: knight.x, endY: knight.y, endTarget: 'Knight Guy', scene: QUEST },
      click('Talk to the priest', 'Talk button', TALK_BUTTON, QUEST),
      click('Open the calculator', 'Calculator', CALCULATOR, QUEST),
      { name: 'Type the sum', action: 'type', target: 'Calculator', x: CALCULATOR.x, y: CALCULATOR.y, text: '25+75', scene: QUEST },
      { name: 'Run the calculator', action: 'key', target: 'Calculator', x: CALCULATOR.x, y: CALCULATOR.y, text: 'enter', scene: QUEST },
    ],
  },
  {
    name: 'Sample: dismiss the popup',
    goal: 'close the ad popup covering the game',
    steps: [click('Close the ad', 'ad close button', { x: ad.closeX, y: ad.closeY }, AD)],
  },
  {
    name: 'Sample: drag Report to Archive',
    goal: 'drag the Report file into the Archive folder',
    steps: [{ name: 'Drag Report to Archive', action: 'drag', target: 'Report file', x: DEMO_FILE.x, y: DEMO_FILE.y, endX: archive.x, endY: archive.y, endTarget: 'Archive folder', scene: DESKTOP }],
  },
];

const sceneKey = (s: SampleScene) => `${s.quest ? 'quest' : 'desktop'}${s.ad ? '+ad' : ''}`;

/** The sample's steps as pending workflow steps, each with its scene's reference frame when one could be rendered. */
export function sampleSteps(sample: SampleWorkflow, frames: ReadonlyMap<string, Frame | null>, idPrefix = 'sample'): WorkflowStep[] {
  return sample.steps.map(({ scene, ...s }, i) => {
    const refFrame = frames.get(sceneKey(scene)) ?? undefined;
    return { ...s, id: `${idPrefix}-${i + 1}`, status: 'pending', ...(refFrame ? { refFrame } : {}) };
  });
}

/** Each distinct scene of the samples rendered once. */
function renderScenes(samples: readonly SampleWorkflow[], render: SceneRenderer): Map<string, Frame | null> {
  const out = new Map<string, Frame | null>();
  for (const step of samples.flatMap((s) => s.steps)) {
    const key = sceneKey(step.scene);
    if (!out.has(key)) out.set(key, render(step.scene));
  }
  return out;
}

/** The samples as saved operations (source 'recorded'), their reference screenshots rendered from the demo desktop. */
export function sampleOperations(render: SceneRenderer, samples: readonly SampleWorkflow[] = SAMPLE_WORKFLOWS, now = Date.now()): SavedOperation[] {
  const frames = renderScenes(samples, render);
  return samples.map((sample, n) => {
    const steps = sampleSteps(sample, frames, `sample${n + 1}`);
    const screenshots = steps.map((s) => s.refFrame).filter((f, i, all): f is Frame => !!f && all.indexOf(f) === i);
    return createOperation({ name: sample.name, goal: sample.goal, steps, screenshots, source: 'recorded' }, now);
  });
}

/** A saved operation's steps as a fresh recording template: new ids, pending, run evidence dropped, reference frames kept. */
export function recordingTemplate(op: SavedOperation, newId: (i: number) => string): WorkflowStep[] {
  return op.steps.map(({ beforeFrame: _b, afterFrame: _a, shot: _s, verifiedAt: _v, correctedX: _cx, correctedY: _cy, ...s }, i) => ({ ...s, id: newId(i), status: 'pending' }));
}
