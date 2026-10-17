-- Driver run-state schema. The driver process is the ONLY writer.
-- Bump PRAGMA user_version (see database.py) when changing this file.

CREATE TABLE IF NOT EXISTS runs (
    id                  TEXT PRIMARY KEY,
    state               TEXT NOT NULL,
    current_task_index  INTEGER NOT NULL DEFAULT 0,
    build_source        TEXT,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS agents (
    id                  TEXT PRIMARY KEY,
    run_id              TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    persona_id          TEXT NOT NULL,
    firmware_endpoint   TEXT NOT NULL,
    frame_endpoint      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agents_run_id ON agents(run_id);

CREATE TABLE IF NOT EXISTS interactions (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    task_id     TEXT NOT NULL,
    step        INTEGER NOT NULL,
    options     TEXT NOT NULL,  -- JSON array
    chosen      TEXT NOT NULL,  -- JSON action
    timestamp   TEXT NOT NULL,
    trace_path  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS interactions_agent_task ON interactions(agent_id, task_id, step);

CREATE TABLE IF NOT EXISTS task_results (
    agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    task_id     TEXT NOT NULL,
    outcome     TEXT NOT NULL,
    steps       INTEGER NOT NULL,
    final_state TEXT NOT NULL,  -- JSON
    PRIMARY KEY (agent_id, task_id)
);
