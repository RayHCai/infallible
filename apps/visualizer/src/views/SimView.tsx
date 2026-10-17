import type { Persona, RunState, Suggestion, Task } from '@infallible/contracts';

import { type AgentView, taskStatus } from '../state/runStore';
import { ArrowRight, Check, Close, Cross, Spinner, StatusIcon } from '../ui/icons';

export interface SimProps {
  state: RunState;
  agents: AgentView[];
  personas: Map<string, Persona>;
  personaByAgent: Map<string, string>;
  tasks: Task[];
  suggestions: Suggestion[];
  selectedTask: string | null;
  onSelectTask: (taskId: string | null) => void;
  onOpenAgent: (agentId: string, taskId: string | null) => void;
  onOpenSuggestions: () => void;
}

export function SimView(props: SimProps) {
  const { state, agents, tasks, suggestions, selectedTask, onSelectTask, onOpenSuggestions } =
    props;
  const done = tasks.filter((t) => taskStatus(t.id, agents) === 'done').length;
  const task = tasks.find((t) => t.id === selectedTask) ?? null;

  return (
    <section className="sim">
      <div className={`cards ${task ? 'cards-open' : ''}`}>
        <article className="card">
          <header className="card-head">
            <h2>Tasks</h2>
            <span className="count">
              {done}/{tasks.length}
            </span>
          </header>
          <ul className="rows">
            {tasks.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className={`row ${t.id === selectedTask ? 'row-selected' : ''}`}
                  onClick={() => {
                    onSelectTask(t.id === selectedTask ? null : t.id);
                  }}
                >
                  <StatusIcon status={taskStatus(t.id, agents)} />
                  <span className="row-title">{t.name}</span>
                </button>
              </li>
            ))}
            {state === 'evaluating' && (
              <li className="row-static muted">
                <span className="status status-active">
                  <Spinner />
                </span>
                <span className="row-title">Evaluating</span>
              </li>
            )}
            {state === 'completed' && suggestions.length > 0 && (
              <li>
                <button type="button" className="row row-next" onClick={onOpenSuggestions}>
                  <span className="status status-next">
                    <ArrowRight />
                  </span>
                  <span className="row-title">See suggestions</span>
                  <span className="row-meta">{suggestions.length}</span>
                </button>
              </li>
            )}
          </ul>
        </article>

        {task && (
          <TaskCard
            key={task.id}
            task={task}
            index={tasks.indexOf(task)}
            total={tasks.length}
            onClose={() => {
              onSelectTask(null);
            }}
            {...props}
          />
        )}

        <PersonasCard {...props} />
      </div>
    </section>
  );
}

interface TaskCardProps extends SimProps {
  task: Task;
  index: number;
  total: number;
  onClose: () => void;
}

function TaskCard({
  task,
  index,
  total,
  agents,
  personas,
  personaByAgent,
  onClose,
  onOpenAgent,
}: TaskCardProps) {
  return (
    <article className="card card-detail">
      <header className="card-head">
        <span className="eyebrow">
          Task {index + 1} of {total}
        </span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <Close />
        </button>
      </header>
      <h3>{task.name}</h3>
      <p className="quote">{task.description}</p>
      <dl className="facts">
        <dt>Goal</dt>
        <dd>{task.goal}</dd>
        <dt>Success</dt>
        <dd>
          <code>{task.success}</code>
        </dd>
        <dt>Max steps</dt>
        <dd>{task.max_steps}</dd>
      </dl>
      <ul className="rows">
        {agents.map((a) => {
          const outcome = a.outcomes[task.id];
          const live = a.currentTaskId === task.id && !outcome;
          const status = outcome ?? (live ? 'active' : 'pending');
          const steps = a.history[task.id]?.length ?? 0;
          return (
            <li key={a.agentId}>
              <button
                type="button"
                className="row"
                disabled={status === 'pending'}
                onClick={() => {
                  onOpenAgent(a.agentId, task.id);
                }}
              >
                <StatusIcon status={status} />
                <span className="row-title">
                  {personas.get(personaByAgent.get(a.agentId) ?? '')?.name ?? a.agentId.slice(0, 8)}
                </span>
                {steps > 0 && (
                  <span className="row-meta">
                    {steps} {steps === 1 ? 'step' : 'steps'}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </article>
  );
}

function PersonasCard({ agents, personas, personaByAgent, tasks, onOpenAgent }: SimProps) {
  return (
    <article className="card">
      <header className="card-head">
        <h2>Personas</h2>
        <span className="count">{agents.length}</span>
      </header>
      <ul className="rows">
        {agents.map((a) => {
          const persona = personas.get(personaByAgent.get(a.agentId) ?? '');
          const name = persona?.name ?? a.agentId.slice(0, 8);
          const task = tasks.find((t) => t.id === a.currentTaskId);
          return (
            <li key={a.agentId}>
              <button
                type="button"
                className="row row-persona"
                onClick={() => {
                  onOpenAgent(a.agentId, null);
                }}
              >
                <span className="avatar">{name.slice(0, 1)}</span>
                <span className="row-body">
                  <span className="row-title">
                    {name}
                    {persona && <span className="muted"> {persona.attributes.age}</span>}
                  </span>
                  <span className="row-sub">
                    {a.status === 'error'
                      ? (a.lastError ?? 'error')
                      : (task?.name ?? (a.status === 'idle' ? 'done' : a.status))}
                  </span>
                </span>
                <span className="row-end">
                  {a.status === 'working' && <Spinner />}
                  <span className="score">
                    <Check />
                    {a.passed}
                    <Cross />
                    {a.failed + a.errored}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {agents.length === 0 && <li className="muted empty">Starting agents</li>}
      </ul>
    </article>
  );
}
