import type {
  Agent,
  DriverMessage,
  MeshAnnotations,
  Persona,
  RunListing,
  RunState,
  StartResponse,
  Suggestion,
  Task,
} from '@infallible/contracts';
import { type ReactNode, useCallback, useEffect, useMemo, useReducer, useState } from 'react';

import { driver } from './api/driver';
import { connectDriverSocket } from './api/driverSocket';
import { DRIVER_URL } from './config';
import { initialRunView, type RunView, runReducer } from './state/runStore';
import { useSnapshotServer } from './three/useSnapshotServer';
import { PageSwitch } from './ui/Transition';
import { BuildingView } from './views/BuildingView';
import { ConnectView } from './views/ConnectView';
import type { SandboxMode } from './views/SandboxView';
import { type Group, type Selection, SimView } from './views/SimView';
import { StartView } from './views/StartView';

const TERMINAL: RunState[] = ['completed', 'stopped', 'failed'];
const NOTICE_MS = 4000;
const HOME: Selection = { group: 'tasks', item: null };

// A saved run is shown by replaying its messages, so the view needs a reset between runs.
type ViewAction = DriverMessage | { type: 'reset' };
const viewReducer = (s: RunView, a: ViewAction) =>
  a.type === 'reset' ? initialRunView : runReducer(s, a);

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
  const [view, dispatch] = useReducer(viewReducer, initialRunView);
  const [start, setStart] = useState<StartResponse | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [personas, setPersonas] = useState<Map<string, Persona>>(new Map());
  const [tasks, setTasks] = useState<Task[]>([]);
  const [annotations, setAnnotations] = useState<MeshAnnotations | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selection, setSelection] = useState<Selection>(HOME);
  const [sandbox, setSandbox] = useState<SandboxMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `?run=<id>` opens a saved run directly.
  const [saved, setSaved] = useState(() => new URLSearchParams(window.location.search).get('run'));
  const [pastRuns, setPastRuns] = useState<RunListing[]>([]);

  useEffect(() => {
    dispatch({ type: 'reset' });
    if (!saved) return connectDriverSocket(dispatch);
    let cancelled = false;
    driver.replay(saved).then(
      (messages) => {
        if (!cancelled) messages.forEach(dispatch);
      },
      (err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setSaved(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [saved]);

  const switchRun = useCallback((id: string | null) => {
    setSelection(HOME);
    setSandbox(null);
    setSuggestions([]);
    setAgents([]);
    setAnnotations(null);
    setSaved(id);
  }, []);

  const runId = view.run?.id ?? null;
  const state = view.run?.state;
  // The driver serves a relative mesh path.
  const meshUrl = view.build.meshUrl ? `${DRIVER_URL}${view.build.meshUrl}` : null;

  // Refetched per run so a driver started after the visualizer still gets picked up.
  useEffect(() => {
    Promise.all([driver.personas(), driver.tasks()])
      .then(([p, t]) => {
        setPersonas(new Map(p.map((x) => [x.id, x])));
        setTasks(t);
      })
      .catch(() => {
        /* driver not up yet; the WS reconnect loop will surface state */
      });
  }, [runId]);

  useEffect(() => {
    if (!runId || !(state === 'running' || saved)) return;
    driver.agents(runId).then(setAgents, () => undefined);
    driver.annotations(runId).then(setAnnotations, () => undefined);
  }, [runId, state, saved]);

  const frameEndpoints = useMemo(
    () =>
      state === 'running'
        ? Object.values(view.agents).flatMap((a) => (a.frameEndpoint ? [a.frameEndpoint] : []))
        : [],
    [state, view.agents],
  );
  useSnapshotServer(meshUrl, annotations, frameEndpoints);

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
      setSelection(HOME);
      setSuggestions([]);
      setAgents([]);
      setStart(await driver.start());
    });
  }, [act]);

  const openAgent = useCallback(
    (agentId: string, taskId: string | null) => {
      const a = view.agents[agentId];
      if (!a) return;
      if (taskId && taskId in a.outcomes) {
        setSandbox({ kind: 'replay', agentId, taskId });
        return;
      }
      if (state === 'running' && (!taskId || taskId === a.currentTaskId)) {
        setSandbox({ kind: 'live', agentId });
        return;
      }
      const target = taskId ?? a.currentTaskId ?? Object.keys(a.outcomes).pop() ?? null;
      if (target) setSandbox({ kind: 'replay', agentId, taskId: target });
    },
    [view.agents, state],
  );

  const openChange = useCallback((suggestionId: string) => {
    setSelection({ group: 'suggestions', item: suggestionId });
    setSandbox({ kind: 'change', suggestionId });
  }, []);

  const selectGroup = useCallback((group: Group) => {
    setSelection({ group, item: null });
    setSandbox(null);
  }, []);

  const selectItem = useCallback(
    (item: string) => {
      switch (selection.group) {
        case 'tasks':
          setSelection({ group: 'tasks', item });
          setSandbox(null);
          break;
        case 'personas':
          setSelection({ group: 'personas', item });
          openAgent(item, null);
          break;
        case 'suggestions':
          openChange(item);
          break;
        case null:
          break;
      }
    },
    [selection.group, openAgent, openChange],
  );

  /** Cut the selection path back to `level` (0 = run, 1 = group, 2 = item). */
  const trim = useCallback(
    (level: number) => {
      if (level <= 0) {
        setSelection({ group: null, item: null });
        setSandbox(null);
      } else if (level === 1) {
        setSelection({ group: selection.group, item: null });
        setSandbox(null);
      } else if (selection.group === 'suggestions' && selection.item) {
        openChange(selection.item);
      } else {
        setSandbox(null);
      }
    },
    [selection, openChange],
  );

  const personaByAgent = useMemo(() => new Map(agents.map((a) => [a.id, a.persona_id])), [agents]);
  const agentViews = Object.values(view.agents);

  const page = (() => {
    if (saved) return 'sim';
    if (!runId || !state || TERMINAL.includes(state) || (state === 'prep' && !start)) {
      return state === 'completed' ? 'sim' : 'start';
    }
    if (state === 'prep') return 'qr';
    if (state === 'build') return 'build';
    if (state === 'connect') return 'connect';
    return 'sim';
  })();

  useEffect(() => {
    if (page !== 'start') return;
    driver.runs().then(
      (runs) => {
        setPastRuns(runs.filter((r) => TERMINAL.includes(r.run.state) && r.total > 0));
      },
      () => undefined,
    );
  }, [page]);

  useEffect(() => {
    if (page !== 'sim') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const depth =
        sandbox && sandbox.kind !== 'change' ? 3 : selection.item ? 2 : selection.group ? 1 : 0;
      if (depth > 0) trim(depth === 2 && selection.group === 'suggestions' ? 1 : depth - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [page, sandbox, selection, trim]);

  const body = (() => {
    switch (page) {
      case 'start':
        return (
          <StartView
            start={null}
            busy={busy}
            onStart={startRun}
            onSkip={() => undefined}
            runs={pastRuns}
            onOpenRun={switchRun}
          />
        );
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
            meshUrl={meshUrl}
            busy={busy}
            onConnect={(deviceId) => void act(() => driver.connect(deviceId))}
          />
        );
      case 'sim':
        return (
          <SimView
            runId={runId ?? ''}
            state={state ?? 'running'}
            agents={agentViews}
            personas={personas}
            personaByAgent={personaByAgent}
            tasks={tasks}
            suggestions={suggestions}
            selection={selection}
            sandbox={sandbox}
            meshUrl={meshUrl}
            annotations={annotations}
            onSelectGroup={selectGroup}
            onSelectItem={selectItem}
            onTrim={trim}
            onOpenAgent={openAgent}
            onOpenChange={openChange}
            onExit={
              saved
                ? () => {
                    switchRun(null);
                  }
                : undefined
            }
          />
        );
    }
  })();

  return (
    <main>
      {error && <p className="toast">{error}</p>}
      {state === 'completed' && !saved && <Notice key={runId}>Simulation complete</Notice>}
      <PageSwitch id={page}>{body}</PageSwitch>
    </main>
  );
}
