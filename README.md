# Infallible

Agent personas that usability-test insulin pumps against real-world failure modes
from the FDA MAUDE database. See [prd.md](prd.md) for the product and architecture.

## Repository layout

```
apps/
  driver/          Python · FastAPI backend: HTTP/WS API, run pipeline, SQLite, object-builder, evaluator
  agent-persona/   Python · one process per simulated user: render → persona modifiers → Claude → act
  firmware/        Python · pump emulator host (Raspberry Pi) + per-agent emulator instances
  visualizer/      Tauri (Rust shell) + React/Three.js/TS desktop UI
  scanner/         Expo SDK 57 phone app + local native module (modules/object-capture)
packages/
  contracts/       Python · pydantic wire contracts — the single source of truth
  contracts-ts/    TS types generated from `contracts` (never hand-edited)
scripts/           Python · MAUDE exploration notebook
data/
  tasks/           scenario YAML (written by scripts/)
  personas/        persona JSON (written by scripts/)
  runs/{run_id}/   pump.glb, annotations, capture/, traces/, suggestions.json (written by the driver)
```

One lockfile per ecosystem: `uv.lock` (Python workspace) and `pnpm-lock.yaml` (pnpm
workspace). Every Python member shares the root `pyproject.toml` tooling config; every
TS package shares `tsconfig.base.json`, `eslint.config.mjs` and `.prettierrc.json`.

### How the pieces talk

```
scanner ──HTTP──▶ driver ◀──HTTP/WS── visualizer
                    │  ▲
       Redis Streams│  │ run:{id}:tasks / run:{id}:events
                    ▼  │
               agent-persona ×N ──WS (frames)──▶ visualizer (selected agent only)
                    │
                    └──WS──▶ firmware instance ×N (one isolated process per agent)
```

## Prerequisites

| Tool | Version | Used for |
|---|---|---|
| [uv](https://docs.astral.sh/uv/) | ≥ 0.11 | Python 3.14 + all Python deps (installs Python itself) |
| Node.js + corepack | 22 (see `.node-version`) | pnpm 10 (pinned via `packageManager`) |
| Rust | stable (see `rust-toolchain.toml`) | Tauri shell |
| Docker | with Compose v2 | local stack |
| Xcode / Android Studio, or EAS | — | scanner native builds |

## Quick start

```sh
corepack enable                 # gives you the pinned pnpm
pnpm bootstrap                  # uv sync + pnpm install + git hooks (after `git init`)
cp .env.example .env            # set ANTHROPIC_API_KEY and DRIVER_PUBLIC_URL (your LAN IP)

pnpm stack:up                   # redis + firmware + driver in Docker (healthchecked)
pnpm dev:visualizer             # desktop app (Tauri dev window)
pnpm dev:scanner                # Expo dev server; scan the QR shown in the visualizer
```

The visualizer shows a QR code → the scanner captures the pump and uploads it → the
driver builds the mesh (or falls back to the bundled one) → **Connect** allocates one
emulator per persona and spawns the agents → the dashboard streams progress → at the end
one Claude call produces `suggestions.json`, which the visualizer animates on the mesh.

The custom `object-capture` native module needs a development build
(`pnpm --filter @infallible/scanner ios` / `android`, or EAS). In Expo Go the app
automatically falls back to guided `expo-camera` capture.

### Without Docker

```sh
docker compose up -d redis      # or any local Redis
pnpm dev:firmware               # firmware host on :8100
pnpm dev:driver                 # driver on :8000 (spawns agents as local processes)
```

Set `DRIVER_FIRMWARE_MODE=local` to skip the firmware host entirely; each agent then
spawns its own private emulator.

### Pump emulator on a Raspberry Pi

Every emulator instance serves a pump GUI on its own port (`http://<host>:<port>/`) that
mirrors its live screen and state and accepts button presses (mouse or arrow keys / Enter /
Esc / M). The host's `/` page tiles every running pump. To run it on the Pi:

```sh
# on the Pi (after installing uv and cloning the repo)
uv sync --package infallible-firmware
FIRMWARE_HOST=0.0.0.0 FIRMWARE_INSTANCE_BIND_HOST=0.0.0.0 FIRMWARE_ADVERTISE_HOST=raspberrypi.local uv run python -m firmware.host  # --spawn N for manual pumps
chromium-browser --kiosk http://localhost:8100/   # optional: pump grid on the HDMI output
```

On the laptop set `DRIVER_FIRMWARE_HOST_URL=http://raspberrypi.local:8100`. The Pi then
appears as a device on the visualizer's Connect screen, and each run gets N fresh pumps on it.

## Commands

| Command | What it does |
|---|---|
| `pnpm check` | everything CI runs: lint + typecheck + tests, all languages |
| `pnpm lint` / `pnpm format` | ruff + prettier/eslint + rustfmt/clippy |
| `pnpm typecheck` | mypy (strict) + `tsc` in every TS package |
| `pnpm test` | pytest + vitest + jest |
| `pnpm contracts:gen` | regenerate `packages/contracts-ts` from the Python models |
| `pnpm stack:up` / `stack:down` / `stack:logs` | local Docker stack |
| `docker compose watch` | rebuild containers on source changes |

## MAUDE scripts (`scripts/`)

Offline only; never runs during a simulation. `uv run python scripts/download_maude.py`
fetches the full openFDA device/event bulk export (~19 GB) into `data/maude/raw/`
(git-ignored). `scripts/maude.ipynb` then walks the pipeline step by step: extract insulin-pump
reports to `data/maude/cleaned/`, add ids, list fields. Open it in VS Code with the root
`.venv` kernel.

## Contracts

`packages/contracts` (pydantic) defines every message that crosses a process boundary:
HTTP bodies, the driver WebSocket, Redis Stream entries, the firmware protocol, and the
files under `data/`. TS types are generated from it. A pre-commit hook regenerates them
when the Python models change, and CI fails if the generated output is stale.

## Quality gates

- **pre-commit** (staged files): whitespace/EOL, YAML/JSON/TOML validity, gitleaks, ruff,
  prettier, eslint, rustfmt, hadolint, actionlint, `uv.lock` freshness, contract regeneration.
- **commit-msg**: Conventional Commits.
- **pre-push**: mypy, pytest, TS lint + typecheck + tests, clippy.
- **CI** (`.github/workflows/ci.yml`): path-filtered jobs per toolchain, contract drift,
  Docker build + Compose smoke test against the healthchecks, and a single `ci-ok` gate.
- **CD** (`.github/workflows/release.yml`): multi-arch images (amd64 + arm64 for the Pi)
  to GHCR with SBOM + provenance on `main`/tags; on `v*` tags, draft desktop
  installers (macOS/Windows/Linux) via tauri-action and EAS builds (needs `EXPO_TOKEN`).

Git isn't initialised yet. After `git init`, run `pnpm bootstrap` to install the hooks.

## Container images

Alpine-based multi-stage builds: uv resolves a non-editable venv in a builder stage and
only that venv is copied into a non-root (uid 10001) runtime with no build tools.
Containers run read-only, with all capabilities dropped and `no-new-privileges`.

| Image | Compressed | Contents |
|---|---|---|
| `infallible/driver` | ~42 MB | driver + agent-persona (agents are subprocesses of the driver) |
| `infallible/firmware` | ~36 MB | firmware host + emulator (multi-arch for the Pi) |

## Stubs / next steps

Interfaces exist and are wired end-to-end; these implementations are intentionally left
as clearly-marked seams:

- **object-builder stages** (`apps/driver/src/driver/object_builder/builder.py`): segmentation,
  InstantMesh / COLMAP+OpenMVS reconstruction, Claude-vision annotation. Until registered, every
  build uses the bundled fallback mesh.
- **3D renderer** (`agent_persona/renderer.py`): the default `CompositeRenderer` is a 2D
  approximation; a ModernGL/trimesh renderer (`render` extra) plugs into the same protocol.
- **iOS Object Capture flow** (`modules/object-capture/ios/ObjectCaptureModule.swift`).
- **Pi HDMI tiled display**, physical-pump adapter, and the before/after re-run with
  `proposed_change` applied via the firmware `configure` op.
