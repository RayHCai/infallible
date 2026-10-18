### Track

Health

### Idea

Agent personas for testing insulin pumps

### Data

MAUDE: FDA registry of reports on health-device (mostly production) failures

### Background

Over 27k failure reports in MAUDE for insulin pumps. A lot of these come from incident reports where the reaction from a user is the cause (e.x, something isn’t clear, a button doesn’t make sense, etc). These failures can be tested before release. If we test the device on various types of people (age, race, disabilities, etc), we can see how these failures might occur (e.x, a person with blurry vision might miss input a dosage/decimal error).

### Solution

If we build upon Artificial Societies, we can construct various agent personas using MAUDE data, as well as other forums on common insulin pump users. The next step is to build a simulation gym, where each agent persona is given a way to interact with the world. Then, a user can scan a pump with their phone which will place the object in the sim.

Ideally, we can connect a physical “pump” to use actual firmware, but we can also just include dummy firmware as well in the simulation.

As we run the simulation, we can run through a set list of scenarios (picked from the most common instances in MAUDE), and see how each agent fails and where.

Ideally, the simulation will make a proposed change and then show what the same result of said change was.

### Architecture

#### Overview

Four deployable components, one device host, and one offline script:

| Component | Runtime | Role |
|---|---|---|
| `driver` | Python (FastAPI) | Backend. HTTP API, run pipeline, SQLite, object-builder, evaluator. Spawns N `agent-persona` processes per run. |
| `agent-persona` | Python (one process per agent, N per run) | Loads a persona, gets its view as a 3D snapshot from the visualizer, runs the Claude decision loop, streams frames to the visualizer. |
| `visualizer` | Tauri (Rust shell) + Three.js/TS | Desktop UI. QR, dashboard, single live persona view, suggestion animation. |
| `scanner` | Expo / React Native / TS + one native capture module | Phone app. Scan QR, capture the pump, upload to driver. |
| `firmware` | Python on Raspberry Pi | Pump emulator host. One emulator instance per agent, each exposing input-in / screen-out over the network. |
| `data` | Python script (offline) | MAUDE ETL. Produces `personas.json` and `tasks.yaml`. Never runs during a sim. |

#### Communication

```
scanner ──HTTP──> driver
visualizer ──HTTP──> driver            (start/stop/connect, run status)
visualizer <──WS──  driver             (run-level state: pipeline step, per-agent summary)
driver <──Redis Streams──> agent-persona   (tasks out; task results + state events in)
agent-persona ──WS──> visualizer       (rendered frames + audio, for the selected agent only)
agent-persona <──TCP/WS──> firmware    (button/dial events in; screen framebuffer + state out)
```

Why Redis stays: the control plane (task dispatch, task completion, agent state events) is a multi-producer / multi-consumer problem once N persona processes exist. Redis Streams give consumer groups, acks, and replay (the visualizer or driver can tail the stream to rebuild state after a reconnect) without the driver managing N sockets. Use Streams, not pub/sub, so nothing is lost if a consumer is slow.

Why frames do **not** go through Redis: rendered images are large and only one consumer (the visualizer) wants them, for one agent at a time. The visualizer opens a WebSocket directly to the selected agent-persona's frame port (advertised in that agent's Redis state event). Switching the selected persona closes one socket and opens another. The driver never touches pixels.

Redis streams:
- `run:{run_id}:tasks` — driver → agents. One entry per (agent_id, task_id). Consumer group per agent.
- `run:{run_id}:events` — agents → driver + visualizer. `agent_ready`, `task_started`, `action`, `task_done`, `agent_error`. Each `action` entry carries the structured action plus a pointer to the trace file; the driver persists these to SQLite.

#### driver

Does three things: own run state, orchestrate the pipeline, collect results and produce suggestions.

- Run state lives in a SQLite database per driver instance (WAL mode). The driver is the **only** writer.
- A run starts on `POST /start`. One run per driver instance; other `/start` requests return 409 until the run is stopped or finishes.
- `POST /stop {run_id}` stops at any moment: kill persona processes, release firmware instances, mark run `stopped`.
- Run row:
```json
{ "id": "UUID", "state": "prep|build|connect|running|evaluating|completed|stopped|failed", "current_task_index": 0 }
```

Pipeline:
1. **Prep** — generate a run_id + QR code (encodes run_id and driver URL) and return it from `/start`. The visualizer displays it; the scanner reads it.
2. **Build** — `POST /build {run_id, capture...}` with the scanner's capture payload (see scanner). The driver runs the object-builder in a background task with a timeout (target < 2 min). On success the mesh is stored at `runs/{run_id}/pump.glb`; on failure or timeout, fall back to the bundled prebuilt pump mesh. Emits `build_done {source: "scan"|"fallback"}` on the WS.
3. **Connect** — the visualizer shows the "connect a device" screen. `POST /connect {device_id: null | UUID}`. The driver asks the firmware host (the Pi) to allocate N emulator instances and records their endpoints. A real pump would plug in here later via the same interface.
4. **Run** — spawn N `agent-persona` processes, each with `{run_id, agent_id, persona_id, mesh_path, firmware_endpoint, redis_url}`. Agent row:
```json
{ "id": "UUID", "run_id": "UUID", "persona_id": "UUID", "firmware_endpoint": "host:port", "frame_endpoint": "host:port" }
```
   Tasks are read from `tasks.yaml` and dispatched one at a time per agent. Agents run independently (no lockstep); the dashboard shows each agent's current task. If the demo needs a synchronized view, lockstep is a one-line change in the dispatcher.
5. **Collect** — every `action` event is written to the interactions table:
```json
{ "id": "UUID", "agent_id": "UUID", "task_id": "UUID", "step": 0, "options": ["str"], "chosen": "str", "timestamp": "ISO8601", "trace_path": "runs/{run_id}/traces/{agent_id}/{task_id}.json" }
```
   Failure detection: each task in `tasks.yaml` has a `success` predicate evaluated against the firmware's final state for that task (e.g. `bolus_units == 2.5`), plus `max_steps`. A task is `failed` if the predicate is false when the agent declares done or `max_steps` is hit. Deterministic; no LLM needed.
6. **Evaluate** — when all agents finish all tasks, build one evaluation context (personas, tasks, interaction rows, failed-task traces, mesh annotations) and make a single Claude call with a structured-output schema. Output is written to `runs/{run_id}/suggestions.json`:
```json
{ "suggestions": [ { "id": "UUID", "category": "hardware|firmware|interaction", "title": "str", "rationale": "str", "evidence": [ {"agent_id": "UUID", "task_id": "UUID", "step": 0} ], "proposed_change": { "type": "move_button|relabel|resize_text|confirm_dialog|...", "params": {} } } ] }
```
   `proposed_change` is a small enum so the visualizer can animate it on the mesh. Stretch: re-run the failed tasks with the change applied to the firmware config and report before/after.
7. Run marked `completed`.

#### object-builder (module inside driver)

Input: the scanner's capture payload. Output: a textured GLB with the screen region and button regions annotated (so firmware output can be composited onto the model, and so `press` actions map to 3D locations).

Pipeline:
1. Background removal / segmentation per frame (SAM 2 or `rembg`) so only the pump is reconstructed.
2. Reconstruction, two tiers:
   - **Fast tier (demo default):** InstantMesh (Apache-2.0) from 1–4 segmented views. Roughly 30–60 s on a consumer GPU; a recognizable, manipulable pump.
   - **Quality tier (if time allows):** COLMAP (SfM) + OpenMVS (dense, mesh, texture) over the full 40–80 frame capture. Several minutes, far better texture, needed if screen/button labels must be legible from the scan itself.
   - If the phone already produced a mesh (iOS path below), skip reconstruction and go to step 3.
3. Post-process with Open3D / trimesh: decimate, recenter, scale to real-world size (from ARKit scale or a user-entered reference dimension), export GLB.
4. **Annotation:** detect the screen rectangle and button regions. First version: Claude vision on 2–3 reference renders, returning normalized boxes projected onto the mesh. Fallback: the annotation JSON from the prebuilt mesh.

Fallback is the prebuilt mesh plus its annotation file. The run must never block on a bad scan.

#### agent-persona

Python process, one per agent. Owns the agent's perception and decision loop; owns nothing about run state.

Startup:
- Load the persona by `persona_id` from `personas.json` into a fixed system prompt.
- Load the mesh annotations. The agent's eye starts at the default pose around the pump; view actions move it (rotate, bring closer). Agents render nothing themselves: the visualizer, which is always open during a run, renders the 3D device scene from the eye (`ws://{frame_endpoint}/render`, `RenderRequest`/`RenderReply`).
- Connect to its firmware instance. Connect to Redis. Open a frame WebSocket server on `frame_endpoint`. Emit `agent_ready`.

Persona file:
```json
{
  "id": "UUID", "name": "str", "description": "str",
  "attributes": {
    "age": 0, "gender": "str", "guiding_prompt": "str",
    "modifiers": [ { "id": "blur|contrast_loss|color_deficiency|tremor|hearing_loss|...", "parameters": {} } ]
  }
}
```
Modifiers are local functions applied to the rendered frame, the audio, or the motor output (`vision.blur(img, sigma)`, `audio.attenuate(...)`, `motor.tremor(target_xy, amplitude)`). They are implemented **once**, here. The visualizer receives the already-degraded frames, so "what they see" is exactly what the model saw.

Per-task loop (one task at a time, read from the task stream):
1. Reset the firmware instance to the task's `initial_state`.
2. **Snapshot:** pull the current screen framebuffer from firmware, ask the visualizer to render the device with that screen from the current eye pose (it also returns each button's projected box and whether it faces the eye or is occluded), apply vision modifiers, mix any firmware audio through audio modifiers. This is the frame context, taken before every plan, and pushed to the frame WebSocket.
3. **Plan** (Sonnet): given persona, task, and frame, produce a short plan over a fixed action vocabulary: `press(button_id)`, `hold(button_id, ms)`, `turn(dial, steps)`, `rotate_view(axis, deg)`, `zoom(delta)`, `wait(ms)`, `read_screen`, `done`; each may carry a `repeat` count (e.g. 20 presses of +0.1 U). The prompt asks for the action *this person* would most likely take, not the correct one.
4. **Act:** execute the whole plan in order, without re-looking. Physical actions pass through motor modifiers (a tremor can hit the adjacent button; rushing can hold a press into auto-repeat) and go to firmware. View actions move the eye.
5. Per executed action, emit an `action` event (options considered, chosen, firmware state after) to Redis and append to the local trace file.
6. Re-snapshot and re-plan after every plan; cap at `max_steps` plans.
7. On `done` or cap, emit `task_done` with the final firmware state. The driver scores it.

#### visualizer

Tauri desktop app. Rust is only the shell; all logic is TS. Three.js renders (a) the overview scene with N small pump instances and (b) the suggestion animation. The live persona view is **not** rendered by Three.js; it is the frame stream from that agent-persona's WebSocket, pixel-identical to what the model saw. Only one live view is open at a time.

Views:
1. Start → QR code (from `/start`).
2. Scanned → loading (build progress from driver WS; show "using fallback mesh" if applicable).
3. Connect device screen → calls `/connect`.
4. Dashboard: current task per agent, status, step count, pass/fail so far. Driven by the driver WS (which relays the Redis events stream).
5. Click a persona → open a WebSocket to that agent's `frame_endpoint`; show frames + audio + the agent's last reasoning line.
6. Run complete → list suggestions; selecting one animates the `proposed_change` on the mesh (move a button, enlarge the text region, add a confirm dialog on the screen texture).

#### scanner

Expo app with one custom native module for capture (Expo Modules API + config plugin). Expo alone cannot drive ARKit/ARCore.

Flow:
1. Open to QR scanner (`expo-camera`). Read `{run_id, driver_url}`.
2. Guided capture of the single object:
   - **iOS (primary demo path):** wrap RealityKit `ObjectCaptureSession` (iOS 17+, LiDAR devices). It provides the orbit guidance UI, the live object bounding box/highlight, and the captured image set with poses. On capable devices `PhotogrammetrySession` can also produce a USDZ/OBJ on-device; ship it when available.
   - **Android / non-LiDAR:** guided orbit capture with `expo-camera`, 40–80 frames with device-motion data; the driver reconstructs.
   - Live object highlight on the non-ARKit path: lightweight segmentation on a downscaled preview to tint the detected object. Cosmetic; not on the critical path.
3. `POST /build` (multipart) with `{run_id, frames[], poses[]?, scale?, mesh?}`.
4. Show "sent", reset.

#### firmware

No open-source *pump firmware* exists. OpenAPS / AndroidAPS / Loop are controllers that talk to pumps, Omnipy is a PDM emulator, and real pump firmware is proprietary. The closest open base is SecPump (an open insulin-pump workbench with insulin kinetics), which can be extended with a UI layer; otherwise build the emulator from scratch and keep the kinetics simple.

**Requirement: state isolation across N agents.** Every agent mutates pump state (presses buttons, changes bolus/basal, triggers alarms), so no two agents may ever share a firmware instance. The firmware must support one of two modes, selected per run:
- **Hosted (default):** the firmware host runs N independent instances, one per agent, each with its own process, memory, and state. Nothing (state, timers, alarms, config) is shared between instances.
- **Local copy:** each `agent-persona` process launches its own private copy of the firmware emulator locally (same binary/package, same interface below) and manipulates that copy's state directly. The driver passes `firmware_endpoint: "local"` and the agent starts the emulator on spawn and kills it on exit. Used when no Pi is available or when N exceeds what the Pi can host.

Both modes expose the identical per-instance interface, so the agent and driver code paths do not change. A physical pump, when connected, is a single instance and can only serve one agent at a time; the other N−1 agents fall back to emulator instances.

For the demo the firmware runs on the Raspberry Pi as a pump emulator:
- A small host service on the Pi allocates instances: `POST /allocate {run_id, n}` → endpoints; `POST /release {run_id}`.
- One emulator process per agent (N per run). Each is a real running program with its own event loop, menu system, bolus/basal logic, alarms, and a rendered GUI (pygame offscreen or Qt offscreen), so timing-dependent failures (holding a button too long, menu timeouts, alarm interrupts) can occur naturally.
- Interface per instance (the same one a future real-pump adapter would implement):
  - `input(event)` — `press`, `release`, `turn`, with timestamps.
  - `frame()` — current screen as PNG plus any audio cue.
  - `state()` — structured state (`screen`, `bolus_units`, `basal_rate`, `alarms`, ...) used only for scoring and traces, never shown to the agent.
  - `reset(initial_state)`.
- The Pi's HDMI output shows a tiled grid of the N instances' screens (a physical artifact for the demo).
- A config file per instance describes the physical layout (button ids → mesh annotation ids) and UI parameters (font size, confirm dialogs), so `proposed_change` edits can be applied by config for the before/after re-run.

#### data

Offline script, run once:
- Pull MAUDE (openFDA device/event endpoint) filtered to insulin pumps.
- Categorize failures by type, frequency, and patient demographics.
- Output `tasks.yaml` (top failure scenarios) and `personas.json` (top 5 demographic/ability profiles with modifier presets).

```yaml
tasks:
  - id: UUID
    name: str
    description: str          # what the user is trying to do, in their words (given to the agent)
    goal: str                 # objective with concrete values, no hints (given to the agent)
    initial_state: {}         # firmware reset state
    success: "bolus_units == 2.5"
    max_steps: 25
```
