/* eslint-disable */
// GENERATED from packages/contracts (Python). Do not edit — run `pnpm contracts:gen`.

/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "Action".
 */
export type Action =
  | PressAction
  | HoldAction
  | TurnAction
  | RotateViewAction
  | ZoomAction
  | WaitAction
  | ReadScreenAction
  | DoneAction;
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "AgentEvent".
 */
export type AgentEvent = AgentReady | TaskStarted | ActionEvent | TaskDone | AgentError;
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "DriverMessage".
 */
export type DriverMessage =
  | RunStateMessage
  | BuildProgressMessage
  | BuildDoneMessage
  | AgentEventMessage
  | TaskScoredMessage
  | TaskSummaryMessage
  | SuggestionsReadyMessage;
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "RunState".
 */
export type RunState =
  'prep' | 'build' | 'connect' | 'running' | 'evaluating' | 'completed' | 'stopped' | 'failed';
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "BuildSource".
 */
export type BuildSource = 'scan' | 'fallback';
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "TaskOutcome".
 */
export type TaskOutcome = 'passed' | 'failed' | 'errored';
/**
 * Perception / motor degradations applied locally by agent-persona.
 *
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "ModifierId".
 */
export type ModifierId =
  | 'blur'
  | 'contrast_loss'
  | 'color_deficiency'
  | 'tremor'
  | 'hearing_loss'
  | 'neuropathy'
  | 'rushing';
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "SuggestionCategory".
 */
export type SuggestionCategory = 'hardware' | 'firmware' | 'interaction';
/**
 * Small, closed set so the visualizer can animate every proposal.
 *
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "ChangeType".
 */
export type ChangeType =
  | 'move_button'
  | 'resize_button'
  | 'relabel'
  | 'resize_text'
  | 'confirm_dialog'
  | 'change_timeout'
  | 'add_audio_cue';

export interface InfallibleContracts {
  Action: Action;
  Agent: Agent;
  AgentEvent: AgentEvent;
  BuildAccepted: BuildAccepted;
  ConnectRequest: ConnectRequest;
  ConnectResponse: ConnectResponse;
  Device: Device;
  DriverMessage: DriverMessage;
  MeshAnnotations: MeshAnnotations;
  Persona: Persona;
  QrPayload: QrPayload;
  RenderReply: RenderReply;
  RenderRequest: RenderRequest;
  Run: Run;
  StartResponse: StartResponse;
  StopRequest: StopRequest;
  SuggestionsFile: SuggestionsFile;
  Task: Task;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "PressAction".
 */
export interface PressAction {
  kind: 'press';
  button_id: string;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "HoldAction".
 */
export interface HoldAction {
  kind: 'hold';
  button_id: string;
  ms: number;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "TurnAction".
 */
export interface TurnAction {
  kind: 'turn';
  dial: string;
  steps: number;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "RotateViewAction".
 */
export interface RotateViewAction {
  kind: 'rotate_view';
  axis: 'x' | 'y' | 'z';
  deg: number;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "ZoomAction".
 */
export interface ZoomAction {
  kind: 'zoom';
  delta: number;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "WaitAction".
 */
export interface WaitAction {
  kind: 'wait';
  ms: number;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "ReadScreenAction".
 */
export interface ReadScreenAction {
  kind: 'read_screen';
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "DoneAction".
 */
export interface DoneAction {
  kind: 'done';
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "Agent".
 */
export interface Agent {
  id: string;
  run_id: string;
  persona_id: string;
  /**
   * host:port, or 'local' for a private emulator.
   */
  firmware_endpoint: string;
  /**
   * host:port of the agent's frame WebSocket.
   */
  frame_endpoint: string;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "AgentReady".
 */
export interface AgentReady {
  run_id: string;
  agent_id: string;
  at: string;
  type: 'agent_ready';
  frame_endpoint: string;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "TaskStarted".
 */
export interface TaskStarted {
  run_id: string;
  agent_id: string;
  at: string;
  type: 'task_started';
  task_id: string;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "ActionEvent".
 */
export interface ActionEvent {
  run_id: string;
  agent_id: string;
  at: string;
  type: 'action';
  task_id: string;
  step: number;
  options: string[];
  chosen:
    | PressAction
    | HoldAction
    | TurnAction
    | RotateViewAction
    | ZoomAction
    | WaitAction
    | ReadScreenAction
    | DoneAction;
  reasoning: string;
  state_after: {
    [k: string]: unknown | undefined;
  };
  trace_path: string;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "TaskDone".
 */
export interface TaskDone {
  run_id: string;
  agent_id: string;
  at: string;
  type: 'task_done';
  task_id: string;
  steps: number;
  /**
   * False when max_steps was hit.
   */
  declared_done: boolean;
  final_state: {
    [k: string]: unknown | undefined;
  };
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "AgentError".
 */
export interface AgentError {
  run_id: string;
  agent_id: string;
  at: string;
  type: 'agent_error';
  task_id: string | null;
  message: string;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "BuildAccepted".
 */
export interface BuildAccepted {
  run_id: string;
  frames_received: number;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "ConnectRequest".
 */
export interface ConnectRequest {
  /**
   * Physical pump id; null means emulators only.
   */
  device_id: string | null;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "ConnectResponse".
 */
export interface ConnectResponse {
  run_id: string;
  firmware_endpoints: string[];
}
/**
 * A pump attached to the driver's machine.
 *
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "Device".
 */
export interface Device {
  id: string;
  name: string;
  port: string;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "RunStateMessage".
 */
export interface RunStateMessage {
  type: 'run_state';
  run: Run;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "Run".
 */
export interface Run {
  id: string;
  state: RunState;
  current_task_index: number;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "BuildProgressMessage".
 */
export interface BuildProgressMessage {
  type: 'build_progress';
  run_id: string;
  stage: string;
  progress: number;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "BuildDoneMessage".
 */
export interface BuildDoneMessage {
  type: 'build_done';
  run_id: string;
  source: BuildSource;
  mesh_url: string;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "AgentEventMessage".
 */
export interface AgentEventMessage {
  type: 'agent_event';
  event: AgentReady | TaskStarted | ActionEvent | TaskDone | AgentError;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "TaskScoredMessage".
 */
export interface TaskScoredMessage {
  type: 'task_scored';
  run_id: string;
  agent_id: string;
  task_id: string;
  outcome: TaskOutcome;
  /**
   * Why the task failed or errored.
   */
  reason: string | null;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "TaskSummaryMessage".
 */
export interface TaskSummaryMessage {
  type: 'task_summary';
  run_id: string;
  agent_id: string;
  task_id: string;
  /**
   * Short plain-language recap of what the agent did.
   */
  summary: string;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "SuggestionsReadyMessage".
 */
export interface SuggestionsReadyMessage {
  type: 'suggestions_ready';
  run_id: string;
  count: number;
}
/**
 * Sidecar for every pump mesh (``pump.annotations.json``).
 *
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "MeshAnnotations".
 */
export interface MeshAnnotations {
  screen: BoxRegion;
  buttons: BoxRegion[];
  /**
   * Metres per mesh unit.
   */
  scale_m: number;
}
/**
 * Normalised (0..1) box in a reference render + its 3D anchor on the mesh.
 *
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "BoxRegion".
 */
export interface BoxRegion {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * x, y, z on the mesh, metres.
   *
   * @minItems 3
   * @maxItems 3
   */
  anchor: [number, number, number];
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "Persona".
 */
export interface Persona {
  id: string;
  name: string;
  description: string;
  attributes: PersonaAttributes;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "PersonaAttributes".
 */
export interface PersonaAttributes {
  age: number;
  gender: string;
  guiding_prompt: string;
  modifiers: Modifier[];
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "Modifier".
 */
export interface Modifier {
  id: ModifierId;
  parameters: {
    [k: string]: unknown | undefined;
  };
}
/**
 * What the visualizer's QR code encodes and the scanner decodes.
 *
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "QrPayload".
 */
export interface QrPayload {
  run_id: string;
  driver_url: string;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "RenderReply".
 */
export interface RenderReply {
  type: 'render_reply';
  id: number;
  png_b64: string;
  buttons: ButtonView[];
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "ButtonView".
 */
export interface ButtonView {
  id: string;
  /**
   * x0, y0, x1, y1 in frame pixels; may run off-frame.
   *
   * @minItems 4
   * @maxItems 4
   */
  box: [number, number, number, number];
  /**
   * Button face points toward the eye.
   */
  facing: boolean;
  /**
   * Device geometry blocks the line of sight to it.
   */
  occluded: boolean;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "RenderRequest".
 */
export interface RenderRequest {
  type: 'render_request';
  id: number;
  pose: EyePose;
  /**
   * Live firmware screen, shown on the device.
   */
  screen_png_b64: string;
  width: number;
  height: number;
}
/**
 * Agent's eye around the pump centre: angles in radians, radius in pump heights.
 *
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "EyePose".
 */
export interface EyePose {
  yaw: number;
  pitch: number;
  radius: number;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "StartResponse".
 */
export interface StartResponse {
  run_id: string;
  state: RunState;
  qr: QrPayload;
  qr_png_b64: string;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "StopRequest".
 */
export interface StopRequest {
  run_id: string;
}
/**
 * Shape of ``data/runs/{run_id}/suggestions.json``.
 *
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "SuggestionsFile".
 */
export interface SuggestionsFile {
  suggestions: Suggestion[];
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "Suggestion".
 */
export interface Suggestion {
  id: string;
  category: SuggestionCategory;
  title: string;
  rationale: string;
  evidence: Evidence[];
  proposed_change: ProposedChange;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "Evidence".
 */
export interface Evidence {
  agent_id: string;
  task_id: string;
  step: number;
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "ProposedChange".
 */
export interface ProposedChange {
  type: ChangeType;
  params: {
    [k: string]: unknown | undefined;
  };
}
/**
 * This interface was referenced by `InfallibleContracts`'s JSON-Schema
 * via the `definition` "Task".
 */
export interface Task {
  id: string;
  name: string;
  /**
   * What the user is trying to do, in their words.
   */
  description: string;
  /**
   * Instruction given to the agent.
   */
  goal: string;
  /**
   * Firmware reset state for this task.
   */
  initial_state: {
    [k: string]: unknown | undefined;
  };
  /**
   * Predicate over the final firmware state, e.g. 'bolus_units == 2.5'.
   */
  success: string;
  max_steps: number;
}
