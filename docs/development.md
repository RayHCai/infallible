# Development

Design and wire protocols: [prd.md](prd.md).

## Layout

```
apps/driver          FastAPI backend: HTTP/WS API, run pipeline, SQLite, object-builder, evaluator
apps/agent-persona   one process per simulated user: perceive → persona modifiers → Claude → act
apps/firmware        pump emulator host (Raspberry Pi) + one isolated emulator per agent
apps/visualizer      Tauri desktop UI (React, Three.js); also renders agents' 3D snapshots
apps/scanner         Expo phone app + native object-capture module
packages/contracts   pydantic wire contracts, the single source of truth
packages/contracts-ts  TS types generated from contracts (`pnpm contracts:gen`, never hand-edit)
assets               procedural pump models → GLB (`pnpm assets:glb`)
scripts              offline MAUDE download, exploration notebook, seed-data builder
data                 personas.json, tasks.yaml; runs/ is written by the driver
```

## Prerequisites

uv ≥ 0.11 (installs Python 3.14), Node 22 with corepack (pnpm 10), Rust stable, Docker with Compose v2, and Xcode/Android Studio or EAS for scanner native builds.

## Run

```sh
corepack enable
pnpm bootstrap          # uv sync + pnpm install + git hooks
cp .env.example .env    # set ANTHROPIC_API_KEY, TYPESAFE_API_KEY, DRIVER_PUBLIC_URL (LAN IP)

pnpm stack:up           # redis + firmware + driver in Docker
pnpm dev:visualizer     # desktop app
pnpm dev:scanner        # scan the QR shown in the visualizer
```

Without Docker: `docker compose up -d redis`, then `pnpm dev:firmware` (:8100) and `pnpm dev:driver` (:8000). `DRIVER_FIRMWARE_MODE=local` skips the firmware host; each agent spawns its own emulator.

The scanner's `object-capture` module needs a development build (`pnpm --filter @infallible/scanner ios|android`); Expo Go falls back to guided `expo-camera` capture.

### Firmware on a Raspberry Pi

```sh
uv sync --package infallible-firmware
FIRMWARE_HOST=0.0.0.0 FIRMWARE_INSTANCE_BIND_HOST=0.0.0.0 FIRMWARE_ADVERTISE_HOST=raspberrypi.local \
  uv run python -m firmware.host   # --spawn N for manual pumps
```

Set `DRIVER_FIRMWARE_HOST_URL=http://raspberrypi.local:8100` on the laptop; the Pi then appears on the visualizer's Connect screen. Each emulator serves its pump GUI at `http://<host>:<port>/`, and the host's `/` tiles all of them.

## Commands

| Command | |
|---|---|
| `pnpm check` | lint + typecheck + tests, all languages (what CI runs) |
| `pnpm format` | ruff, prettier, rustfmt |
| `pnpm contracts:gen` | regenerate `packages/contracts-ts` |
| `pnpm stack:up` / `stack:down` / `stack:logs` | local Docker stack |

## MAUDE data

Offline only. `scripts/download_maude.py` fetches the openFDA device-event export (~19 GB) into `data/maude/raw/`; `scripts/maude.ipynb` cleans it into `data/maude/cleaned/`; `scripts/build_seed_data.py extract|build` writes `data/personas/personas.json` and `data/tasks/tasks.yaml`.

## Not yet implemented

- Object-builder reconstruction and annotation stages (`apps/driver/src/driver/object_builder/builder.py`); every build uses the bundled fallback mesh.
- iOS Object Capture flow (`apps/scanner/modules/object-capture/ios/ObjectCaptureModule.swift`).
- Re-running failed tasks with a `proposed_change` applied.
