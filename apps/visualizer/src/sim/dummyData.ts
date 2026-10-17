import type { Action, MeshAnnotations, Persona, Suggestion, Task } from '@infallible/contracts';

export const PERSONAS: Persona[] = [
  {
    id: '6b0f3c1e-0a51-4c5e-9a43-0d1f1e6a0001',
    name: 'Margaret',
    description: 'Retired teacher with cataracts. Reads the screen at arm’s length.',
    attributes: {
      age: 74,
      gender: 'female',
      guiding_prompt: 'You squint at small text and often guess at decimals.',
      modifiers: [{ id: 'blur', parameters: { sigma: 3 } }],
    },
  },
  {
    id: '6b0f3c1e-0a51-4c5e-9a43-0d1f1e6a0002',
    name: 'James',
    description: 'Essential tremor. Small buttons are hard to hit reliably.',
    attributes: {
      age: 68,
      gender: 'male',
      guiding_prompt: 'Your hands shake; you sometimes press the neighbouring button.',
      modifiers: [{ id: 'tremor', parameters: { amplitude: 0.4 } }],
    },
  },
  {
    id: '6b0f3c1e-0a51-4c5e-9a43-0d1f1e6a0003',
    name: 'Priya',
    description: 'Red-green colour deficiency. Relies on icon shape over colour.',
    attributes: {
      age: 34,
      gender: 'female',
      guiding_prompt: 'You cannot tell red warnings from green confirmations.',
      modifiers: [{ id: 'color_deficiency', parameters: { kind: 'deuteranopia' } }],
    },
  },
  {
    id: '6b0f3c1e-0a51-4c5e-9a43-0d1f1e6a0004',
    name: 'Tom',
    description: 'Age-related hearing loss. Misses quiet alarm tones.',
    attributes: {
      age: 81,
      gender: 'male',
      guiding_prompt: 'You rarely notice beeps unless you are looking at the pump.',
      modifiers: [{ id: 'hearing_loss', parameters: { db: 35 } }],
    },
  },
  {
    id: '6b0f3c1e-0a51-4c5e-9a43-0d1f1e6a0005',
    name: 'Alex',
    description: 'Newly diagnosed teenager. Rushes through confirmation screens.',
    attributes: {
      age: 16,
      gender: 'nonbinary',
      guiding_prompt: 'You are impatient and tap OK without reading.',
      modifiers: [],
    },
  },
];

export const TASKS: Task[] = [
  {
    id: '2d7c9a40-5b8e-4f0a-8c1d-3e2f4a5b0001',
    name: 'Meal bolus 2.5 U',
    description: 'I need to cover lunch with two and a half units.',
    goal: 'Deliver a 2.5 unit bolus.',
    initial_state: { screen: 'home', bolus_units: 0 },
    success: 'bolus_units == 2.5',
    max_steps: 25,
  },
  {
    id: '2d7c9a40-5b8e-4f0a-8c1d-3e2f4a5b0002',
    name: 'Change basal to 0.8 U/h',
    description: 'My doctor lowered my basal rate.',
    goal: 'Set the basal rate to 0.8 U/h.',
    initial_state: { screen: 'home', basal_rate: 1.0 },
    success: 'basal_rate == 0.8',
    max_steps: 25,
  },
  {
    id: '2d7c9a40-5b8e-4f0a-8c1d-3e2f4a5b0003',
    name: 'Respond to occlusion alarm',
    description: 'The pump is alarming and I do not know why.',
    goal: 'Acknowledge the occlusion alarm.',
    initial_state: { screen: 'home', alarms: ['occlusion'] },
    success: "'occlusion' not in alarms",
    max_steps: 25,
  },
];

/** Which (persona, task) pairs the mock run scores as failed. */
export const FAILS: Partial<Record<string, string[]>> = {
  '6b0f3c1e-0a51-4c5e-9a43-0d1f1e6a0001': ['2d7c9a40-5b8e-4f0a-8c1d-3e2f4a5b0001'],
  '6b0f3c1e-0a51-4c5e-9a43-0d1f1e6a0002': ['2d7c9a40-5b8e-4f0a-8c1d-3e2f4a5b0002'],
  '6b0f3c1e-0a51-4c5e-9a43-0d1f1e6a0004': ['2d7c9a40-5b8e-4f0a-8c1d-3e2f4a5b0003'],
  '6b0f3c1e-0a51-4c5e-9a43-0d1f1e6a0005': ['2d7c9a40-5b8e-4f0a-8c1d-3e2f4a5b0001'],
};

export const REASONING = [
  'Looking for the bolus option on the home screen.',
  'The number is small. I think it says 25?',
  'Pressing up until it looks right.',
  'That button should be select.',
  'Not sure that registered, pressing again.',
  'Tilting the pump to cut the glare.',
  'Bringing it closer to read the decimal.',
  'Screen changed, I think it is done.',
];

/** Action vocabulary the mock cycles through before declaring done. */
export const ACTION_MIX: Action[] = [
  { kind: 'read_screen' },
  { kind: 'press', button_id: 'select' },
  { kind: 'rotate_view', axis: 'y', deg: -25 },
  { kind: 'press', button_id: 'up' },
  { kind: 'zoom', delta: 0.25 },
  { kind: 'press', button_id: 'up' },
  { kind: 'rotate_view', axis: 'x', deg: 15 },
  { kind: 'press', button_id: 'down' },
  { kind: 'hold', button_id: 'select', ms: 1200 },
  { kind: 'zoom', delta: -0.2 },
  { kind: 'press', button_id: 'back' },
  { kind: 'wait', ms: 800 },
  { kind: 'press', button_id: 'home' },
];

/** MiniMed 780G layout (the bundled fallback mesh): metres, Y up, +Z front. */
export const ANNOTATIONS: MeshAnnotations = {
  screen: { id: 'screen', x: 0.167, y: 0.067, w: 0.667, h: 0.495, anchor: [0, 0.018, 0.0132] },
  buttons: [
    { id: 'back', x: 0.315, y: 0.58, w: 0.185, h: 0.088, anchor: [-0.012, -0.012, 0.0146] },
    { id: 'up', x: 0.76, y: 0.58, w: 0.185, h: 0.088, anchor: [0.012, -0.012, 0.0146] },
    { id: 'select', x: 0.398, y: 0.67, w: 0.204, h: 0.113, anchor: [0, -0.022, 0.0146] },
    { id: 'home', x: 0.315, y: 0.79, w: 0.185, h: 0.088, anchor: [-0.012, -0.032, 0.0146] },
    { id: 'down', x: 0.76, y: 0.79, w: 0.185, h: 0.088, anchor: [0.012, -0.032, 0.0146] },
  ],
  scale_m: 1,
};

/** (persona, task) pairs the mock cites as evidence; agent ids are resolved per run. */
export const SUGGESTION_EVIDENCE: Record<string, [string, string][]> = {
  '9e1a7b20-3c4d-4e5f-8a9b-0c1d2e3f0001': [
    ['6b0f3c1e-0a51-4c5e-9a43-0d1f1e6a0001', '2d7c9a40-5b8e-4f0a-8c1d-3e2f4a5b0001'],
  ],
  '9e1a7b20-3c4d-4e5f-8a9b-0c1d2e3f0002': [
    ['6b0f3c1e-0a51-4c5e-9a43-0d1f1e6a0005', '2d7c9a40-5b8e-4f0a-8c1d-3e2f4a5b0001'],
  ],
  '9e1a7b20-3c4d-4e5f-8a9b-0c1d2e3f0003': [
    ['6b0f3c1e-0a51-4c5e-9a43-0d1f1e6a0002', '2d7c9a40-5b8e-4f0a-8c1d-3e2f4a5b0002'],
  ],
  '9e1a7b20-3c4d-4e5f-8a9b-0c1d2e3f0004': [
    ['6b0f3c1e-0a51-4c5e-9a43-0d1f1e6a0004', '2d7c9a40-5b8e-4f0a-8c1d-3e2f4a5b0003'],
  ],
};

export const SUGGESTIONS: Suggestion[] = [
  {
    id: '9e1a7b20-3c4d-4e5f-8a9b-0c1d2e3f0001',
    category: 'firmware',
    title: 'Enlarge bolus amount text',
    rationale: 'Low-vision personas misread 2.5 as 25 on the bolus entry screen.',
    evidence: [],
    proposed_change: { type: 'resize_text', params: { scale: 1.6 } },
  },
  {
    id: '9e1a7b20-3c4d-4e5f-8a9b-0c1d2e3f0002',
    category: 'interaction',
    title: 'Confirm large boluses',
    rationale: 'Rushed users accepted an unintended dose without reading the summary.',
    evidence: [],
    proposed_change: { type: 'confirm_dialog', params: { threshold_units: 5 } },
  },
  {
    id: '9e1a7b20-3c4d-4e5f-8a9b-0c1d2e3f0003',
    category: 'hardware',
    title: 'Separate Select from Down',
    rationale: 'Tremor caused presses intended for Select to land on Down.',
    evidence: [],
    proposed_change: { type: 'move_button', params: { button_id: 'select', dx: 0, dy: 0.12 } },
  },
  {
    id: '9e1a7b20-3c4d-4e5f-8a9b-0c1d2e3f0004',
    category: 'firmware',
    title: 'Louder occlusion alarm',
    rationale: 'Hearing-impaired personas never noticed the alarm had started.',
    evidence: [],
    proposed_change: { type: 'add_audio_cue', params: { event: 'occlusion', db: 12 } },
  },
];
