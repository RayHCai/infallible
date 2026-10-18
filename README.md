# Infallible

Thousands of FDA MAUDE reports trace insulin-pump harm to use errors: a misread decimal, a missed alarm, a button pressed by a shaky hand. Infallible scans a pump, emulates its firmware, and lets Claude-driven personas with simulated vision, hearing, and motor impairments run MAUDE-derived tasks on it, then proposes design fixes from where they fail.

```mermaid
flowchart LR
  subgraph offline["Offline · scripts/"]
    maude[(openFDA MAUDE)] --> seed["build_seed_data.py<br/>Haiku extract · Opus write"]
    seed --> seedfiles[("data/<br/>personas.json · tasks.yaml")]
  end

  subgraph phone["Phone"]
    scanner["scanner<br/>Expo · RN"]
  end

  subgraph desktop["Desktop"]
    visualizer["visualizer<br/>Tauri · React · Three.js"]
  end

  subgraph backend["Backend · Docker"]
    driver["driver · FastAPI<br/>run pipeline · object-builder · evaluator"]
    sqlite[(SQLite)]
    redis[("Redis Streams<br/>run:id:tasks · run:id:events")]
    agents["agent-persona ×N<br/>perceive → modify → plan → act"]
  end

  subgraph pi["Raspberry Pi"]
    fwhost["firmware host"]
    emus["pump emulator ×N<br/>one isolated process per agent"]
  end

  subgraph ext["External APIs"]
    claude["Claude<br/>planner · evaluator"]
    jev["Jev<br/>label readability"]
  end

  seedfiles --> driver
  visualizer -->|"QR: run id + driver URL"| scanner
  scanner -->|"HTTP POST /build (frames, poses)"| driver
  visualizer <-->|"HTTP + WS /ws: run state"| driver
  driver --- sqlite
  driver -->|"spawn"| agents
  driver <-->|"tasks / events"| redis
  redis <--> agents
  driver -->|"HTTP /allocate · /release"| fwhost
  fwhost --> emus
  agents <-->|"WS: press · turn · frame · state"| emus
  visualizer <-->|"WS /render: 3D snapshot from agent's eye"| agents
  agents -->|"WS: degraded frames + audio"| visualizer
  agents --> claude
  agents --> jev
  driver -->|"evaluate → suggestions.json"| claude

  contracts["packages/contracts<br/>pydantic → generated TS"] -.- driver
  contracts -.- agents
  contracts -.- fwhost
  contracts -.- visualizer
  contracts -.- scanner
```
