import type {
  Agent,
  MeshAnnotations,
  Persona,
  RunState,
  StartResponse,
  Suggestion,
  Task,
} from '@infallible/contracts';
import { type ReactNode, useCallback, useEffect, useMemo, useReducer, useState } from 'react';

// Mock until the driver is wired: swap for `api/driver` + `api/driverSocket`.
import { driver } from './sim/mockDriver';
import { initialRunView, runReducer } from './state/runStore';
import { PageSwitch, Presence } from './ui/Transition';
import { BuildingView } from './views/BuildingView';
import { ConnectView } from './views/ConnectView';
import { modeKey, type SandboxMode, SandboxView } from './views/SandboxView';
import { SimView } from './views/SimView';
import { StartView } from './views/StartView';

const TERMINAL: RunState[] = ['completed', 'stopped', 'failed'];
const NOTICE_MS = 4000;

/** Toast that dismisses itself; remount (key) to show it again. */
function Notice({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => {
      setShown(false);
    }, NOTICE_MS);
    return () => {
      clearTimeout(t);
    };
  }, []);
  return shown ? <p className="toast">{children}</p> : null;
}

export function App() {
  const [view, dispatch] = useReducer(runReducer, initialRunView);
  const [start, setStart] = useState<StartResponse | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [personas, setPersonas] = useState<Map<string, Persona>>(new Map());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [annotations, setAnnotations] = useState<MeshAnnotations | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [sandbox, setSandbox] = useState<SandboxMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => driver.subscribe(dispatch), []);

  useEffect(() => {
    Promise.all([driver.personas(), driver.tasks()])
      .then(([p, t]) => {
        setPersonas(new Map(p.map((x) => [x.id, x])));
        setTasks(t);
      })
      .catch(() => {
        /* driver not up yet; the WS reconnect loop will surface state */
      });
  }, []);

  const runId = view.run?.id ?? null;
  const state = view.run?.state;

  useEffect(() => {
    if (!runId || state !== 'running') return;
    driver.agents(runId).then(setAgents, () => undefined);
    driver.annotations(runId).then(setAnnotations, () => undefined);
  }, [runId, state]);

  useEffect(() => {
    if (!runId || state !== 'completed') return;
    driver.suggestions(runId).then(
      (f) => {
        setSuggestions(f.suggestions);
      },
      () => undefined,
    );
  }, [runId, state]);

  const act = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const startRun = useCallback(() => {
    void act(async () => {
      setSandbox(null);
      setSelectedTask(null);
      setSuggestions([]);
      setAgents([]);
      setStart(await driver.start());
    });
  }, [act]);

  const closeSandbox = useCallback(() => {
    setSandbox(null);
  }, []);

  const openAgent = useCallback(
    (agentId: string, taskId: string | null) => {
      const a = view.agents[agentId];
      if (!a) return;
      if (taskId && taskId in a.outcomes) {
        setSandbox({ kind: 'replay', agentId, taskId });
        return;
      }
      if (state === 'running') {
        setSandbox({ kind: 'live', agentId });
        return;
      }
      const target = taskId ?? selectedTask ?? a.currentTaskId;
      if (target) setSandbox({ kind: 'replay', agentId, taskId: target });
    },
    [view.agents, state, selectedTask],
  );

  const personaByAgent = useMemo(() => new Map(agents.map((a) => [a.id, a.persona_id])), [agents]);
  const agentViews = Object.values(view.agents);

  const page = (() => {
    if (!runId || !state || TERMINAL.includes(state) || (state === 'prep' && !start)) {
      return state === 'completed' ? 'sim' : 'start';
    }
    if (state === 'prep') return 'qr';
    if (state === 'build') return 'build';
    if (state === 'connect') return 'connect';
    return 'sim';
  })();

  const body = (() => {
    switch (page) {
      case 'start':
        return <StartView start={null} busy={busy} onStart={startRun} onSkip={() => undefined} />;
      case 'qr':
        return (
          <StartView
            start={start}
            busy={busy}
            onStart={() => undefined}
            onSkip={() => void act(() => (runId ? driver.skipScan(runId) : Promise.resolve()))}
          />
        );
      case 'build':
        return <BuildingView build={view.build} />;
      case 'connect':
        return (
          <ConnectView
            meshUrl={view.build.meshUrl}
            busy={busy}
            onConnect={(deviceId) => void act(() => driver.connect(deviceId))}
          />
        );
      case 'sim':
        return (
          <SimView
            state={state ?? 'running'}
            agents={agentViews}
            personas={personas}
            personaByAgent={personaByAgent}
            tasks={tasks}
            suggestions={suggestions}
            selectedTask={selectedTask}
            onSelectTask={setSelectedTask}
            onOpenAgent={openAgent}
            onOpenSuggestions={() => {
              const first = suggestions[0];
              if (first) setSandbox({ kind: 'change', suggestionId: first.id });
            }}
          />
        );
    }
  })();

  return (
    <main className={sandbox ? 'pushed' : ''}>
      {error && <p className="toast">{error}</p>}
      {state === 'completed' && <Notice key={runId}>Simulation complete</Notice>}
      <PageSwitch id={page}>{body}</PageSwitch>
      <Presence show={sandbox !== null} className="overlay">
        {sandbox && (
          <SandboxView
            key={modeKey(sandbox)}
            mode={sandbox}
            meshUrl={view.build.meshUrl}
            annotations={annotations}
            agents={view.agents}
            personas={personas}
            personaByAgent={personaByAgent}
            tasks={tasks}
            suggestions={suggestions}
            onClose={closeSandbox}
            onOpen={setSandbox}
          />
        )}
      </Presence>
    </main>
  );
}
