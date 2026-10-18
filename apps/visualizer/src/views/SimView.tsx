import type { MeshAnnotations, Persona, RunState, Suggestion, Task } from '@infallible/contracts';
import { type ReactNode, useMemo } from 'react';

import { type AgentView, taskStatus } from '../state/runStore';
import {
  Bars,
  ChevronRight,
  PersonasIcon,
  Spinner,
  StatusIcon,
  SuggestionsIcon,
  TasksIcon,
} from '../ui/icons';
import { modeKey, type SandboxMode, SandboxView } from './SandboxView';

export type Group = 'tasks' | 'personas' | 'suggestions';

/** Selection path through the column browser: group › item (› sandbox). */
export interface Selection {
  group: Group | null;
  item: string | null;
}

const GROUP_LABEL: Record<Group, string> = {
  tasks: 'Tasks',
  personas: 'Personas',
  suggestions: 'Suggestions',
};

export interface SimProps {
  runId: string;
  state: RunState;
  agents: AgentView[];
  personas: Map<string, Persona>;
  personaByAgent: Map<string, string>;
  tasks: Task[];
  suggestions: Suggestion[];
  selection: Selection;
  sandbox: SandboxMode | null;
  meshUrl: string | null;
  annotations: MeshAnnotations | null;
  onSelectGroup: (group: Group) => void;
  onSelectItem: (item: string) => void;
  onTrim: (level: number) => void;
  onOpenAgent: (agentId: string, taskId: string | null) => void;
  onOpenChange: (suggestionId: string) => void;
}

interface RowProps {
  glyph: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  meta?: ReactNode;
  on?: boolean;
  disabled?: boolean;
  chevron?: boolean;
  onClick?: () => void;
}

function Row({ glyph, title, sub, meta, on, disabled, chevron, onClick }: RowProps) {
  const body = (
    <>
      <span className="rg">{glyph}</span>
      <span className="rt">
        <span className="title">{title}</span>
        {sub && <span className="sub">{sub}</span>}
      </span>
      <span className="meta">{meta}</span>
      {chevron && (
        <span className="rc">
          <ChevronRight />
        </span>
      )}
    </>
  );
  const cls = `row ${on ? 'on' : ''} ${chevron ? 'chev' : ''}`;
  return (
    <li>
      {onClick ? (
        <button type="button" className={cls} disabled={disabled} onClick={onClick}>
          {body}
        </button>
      ) : (
        <div className={`${cls} static`}>{body}</div>
      )}
    </li>
  );
}

const Hint = ({ children }: { children: ReactNode }) => <p className="hint">{children}</p>;

/** Task the sandbox is showing, if any. */
function sandboxTask(sb: SandboxMode | null, agents: Record<string, AgentView>): string | null {
  if (!sb || sb.kind === 'change') return null;
  return sb.kind === 'replay' ? sb.taskId : (agents[sb.agentId]?.currentTaskId ?? null);
}

export function SimView(props: SimProps) {
  const {
    runId,
    state,
    agents,
    personas,
    personaByAgent,
    tasks,
    suggestions,
    selection,
    sandbox,
    onSelectGroup,
    onSelectItem,
    onTrim,
    onOpenAgent,
    onOpenChange,
  } = props;
  const { group, item } = selection;
  const byId = useMemo(() => Object.fromEntries(agents.map((a) => [a.agentId, a])), [agents]);
  const nameOf = (agentId: string) =>
    personas.get(personaByAgent.get(agentId) ?? '')?.name ?? agentId.slice(0, 8);
  const taskById = (id: string | null) => tasks.find((t) => t.id === id);
  const done = tasks.filter((t) => taskStatus(t.id, agents) === 'done').length;
  const sbTask = sandboxTask(sandbox, byId);
  const sbAgent = sandbox && sandbox.kind !== 'change' ? sandbox.agentId : null;
  const completed = state === 'completed';
  const id8 = runId.slice(0, 8);

  // Breadcrumbs: Run › group › item › sandbox target.
  const crumbs: { label: string; level: number }[] = [{ label: `Run ${id8}`, level: 0 }];
  if (group) crumbs.push({ label: GROUP_LABEL[group], level: 1 });
  if (group && item) {
    const label =
      group === 'tasks'
        ? (taskById(item)?.name ?? item)
        : group === 'personas'
          ? nameOf(item)
          : (suggestions.find((s) => s.id === item)?.title ?? item);
    crumbs.push({ label, level: 2 });
  }
  if (sbAgent) {
    const taskName = taskById(sbTask)?.name ?? '';
    const label =
      group === 'personas'
        ? taskName
        : group === 'suggestions'
          ? `${nameOf(sbAgent)} · ${taskName}`
          : nameOf(sbAgent);
    crumbs.push({ label, level: 3 });
  }

  return (
    <section className="sim">
      <header className="top">
        <div className="brand">
          <Bars />
          Infallible
        </div>
        <nav className="crumbs" aria-label="Selection path">
          {crumbs.map((c, i) => (
            <span key={c.level} style={{ display: 'contents' }}>
              {i > 0 && <ChevronRight />}
              <button
                type="button"
                aria-current={i === crumbs.length - 1 ? 'page' : undefined}
                onClick={() => {
                  onTrim(c.level);
                }}
              >
                {c.label}
              </button>
            </span>
          ))}
        </nav>
        <div className="top-r">
          <span className="state">
            {state === 'evaluating' ? <Spinner /> : <span className={`dot ${state}`} />}
            {state}
          </span>
          <span className="wide">
            {agents.length} personas · {tasks.length} tasks
          </span>
          {completed && suggestions.length > 0 && (
            <button
              type="button"
              className="see"
              onClick={() => {
                onOpenChange(suggestions[0]?.id ?? '');
              }}
            >
              See suggestions ({suggestions.length})
            </button>
          )}
        </div>
      </header>

      <div className="browser">
        {/* column 1: run */}
        <section className="col">
          <div className="col-head">
            <span className="eyebrow">Run</span>
            <code className="meta">{id8}</code>
          </div>
          <div className="col-body">
            <ul className="rows">
              <Row
                glyph={<TasksIcon />}
                title="Tasks"
                meta={`${done}/${tasks.length} done`}
                on={group === 'tasks'}
                chevron
                onClick={() => {
                  onSelectGroup('tasks');
                }}
              />
              <Row
                glyph={<PersonasIcon />}
                title="Personas"
                meta={agents.length}
                on={group === 'personas'}
                chevron
                onClick={() => {
                  onSelectGroup('personas');
                }}
              />
              {(completed && suggestions.length > 0) || group === 'suggestions' ? (
                <Row
                  glyph={<SuggestionsIcon />}
                  title="Suggestions"
                  meta={suggestions.length}
                  on={group === 'suggestions'}
                  chevron
                  onClick={() => {
                    onSelectGroup('suggestions');
                  }}
                />
              ) : null}
              {state === 'evaluating' && (
                <Row glyph={<Spinner />} title="Evaluating" meta="scoring runs" />
              )}
            </ul>
            <dl className="summary">
              <dt>State</dt>
              <dd>{state}</dd>
              <dt>Personas</dt>
              <dd>{agents.length}</dd>
              <dt>Tasks</dt>
              <dd>{tasks.length}</dd>
              <dt>Run id</dt>
              <dd>
                <code>{id8}</code>
              </dd>
            </dl>
          </div>
        </section>

        {/* column 2: group items */}
        <section className="col">
          {group === null && (
            <>
              <div className="col-head">
                <span className="eyebrow">&nbsp;</span>
              </div>
              <div key="none" className="col-body">
                <Hint>Select tasks or personas</Hint>
              </div>
            </>
          )}
          {group === 'tasks' && (
            <>
              <div className="col-head">
                <span className="eyebrow">Tasks</span>
                <span className="meta">
                  {done}/{tasks.length} done
                </span>
              </div>
              <div key="tasks" className="col-body">
                <ul className="rows">
                  {tasks.map((t) => (
                    <Row
                      key={t.id}
                      glyph={<StatusIcon status={taskStatus(t.id, agents)} />}
                      title={t.name}
                      meta={`${agents.filter((a) => t.id in a.outcomes).length}/${agents.length}`}
                      on={item === t.id}
                      onClick={() => {
                        onSelectItem(t.id);
                      }}
                    />
                  ))}
                </ul>
              </div>
            </>
          )}
          {group === 'personas' && (
            <>
              <div className="col-head">
                <span className="eyebrow">Personas</span>
                <span className="meta">{agents.length}</span>
              </div>
              <div key="personas" className="col-body">
                <ul className="rows">
                  {agents.map((a) => {
                    const persona = personas.get(personaByAgent.get(a.agentId) ?? '');
                    const name = nameOf(a.agentId);
                    const task = taskById(a.currentTaskId);
                    const sub = completed ? (
                      'done'
                    ) : a.status === 'error' ? (
                      (a.lastError ?? 'error')
                    ) : (
                      <>
                        {a.status === 'working' && <Spinner />}
                        {task?.name ?? a.status}
                      </>
                    );
                    return (
                      <Row
                        key={a.agentId}
                        glyph={<span className="av">{name.slice(0, 1)}</span>}
                        title={
                          <>
                            {name}
                            {persona && <small>{persona.attributes.age}</small>}
                          </>
                        }
                        sub={sub}
                        meta={
                          <span className="score">
                            <span className="p">{a.passed}</span> /{' '}
                            <span className="f">{a.failed + a.errored}</span>
                          </span>
                        }
                        on={item === a.agentId}
                        onClick={() => {
                          onSelectItem(a.agentId);
                        }}
                      />
                    );
                  })}
                </ul>
                {agents.length === 0 && <Hint>Starting agents</Hint>}
              </div>
            </>
          )}
          {group === 'suggestions' && (
            <>
              <div className="col-head">
                <span className="eyebrow">Suggestions</span>
                <span className="meta">{suggestions.length}</span>
              </div>
              <div key="suggestions" className="col-body">
                <ul className="rows">
                  {suggestions.map((s) => (
                    <Row
                      key={s.id}
                      glyph={<span className={`cat ${s.category}`} />}
                      title={s.title}
                      meta={s.category}
                      on={item === s.id}
                      onClick={() => {
                        onSelectItem(s.id);
                      }}
                    />
                  ))}
                </ul>
              </div>
            </>
          )}
        </section>

        {/* column 3: detail */}
        <section className="col">
          {!(group && item) && (
            <>
              <div className="col-head">
                <span className="eyebrow">&nbsp;</span>
              </div>
              <div key="none" className="col-body">
                {group === 'tasks' && <Hint>Select a task</Hint>}
                {group === 'personas' && <Hint>Select a persona</Hint>}
                {group === 'suggestions' && <Hint>Select a suggestion</Hint>}
              </div>
            </>
          )}
          {group === 'tasks' && item && (
            <TaskDetail {...props} taskId={item} sbAgent={sbAgent} sbTask={sbTask} />
          )}
          {group === 'personas' && item && (
            <PersonaDetail {...props} agentId={item} sbAgent={sbAgent} sbTask={sbTask} />
          )}
          {group === 'suggestions' && item && (
            <SuggestionDetail {...props} suggestionId={item} sbAgent={sbAgent} sbTask={sbTask} />
          )}
        </section>

        {/* column 4: sandbox */}
        <section className="col">
          {sandbox ? (
            <SandboxView
              key={modeKey(sandbox)}
              mode={sandbox}
              meshUrl={props.meshUrl}
              annotations={props.annotations}
              agents={byId}
              personas={personas}
              personaByAgent={personaByAgent}
              tasks={tasks}
              suggestions={suggestions}
              showPersona={group !== 'personas'}
              onOpenAgent={onOpenAgent}
            />
          ) : (
            <>
              <div className="col-head">
                <span className="eyebrow">Sandbox</span>
              </div>
              <div key="none" className="col-body">
                {group === 'tasks' && item && <Hint>Select an attempt</Hint>}
                {group === 'personas' && item && <Hint>Select a task</Hint>}
              </div>
            </>
          )}
        </section>
      </div>
    </section>
  );
}

interface DetailProps extends SimProps {
  sbAgent: string | null;
  sbTask: string | null;
}

function TaskDetail({
  taskId,
  tasks,
  agents,
  personas,
  personaByAgent,
  sbAgent,
  sbTask,
  onOpenAgent,
}: DetailProps & { taskId: string }) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return null;
  const scored = agents.filter((a) => task.id in a.outcomes).length;
  return (
    <>
      <div className="col-head">
        <span className="eyebrow">Task</span>
        <span className="meta">
          {tasks.indexOf(task) + 1} of {tasks.length}
        </span>
      </div>
      <div key={task.id} className="col-body">
        <div className="pad">
          <h2>{task.name}</h2>
          <blockquote className="quote">{task.description}</blockquote>
          <dl className="facts">
            <dt>Goal</dt>
            <dd className="clamp" title={task.goal}>
              {task.goal}
            </dd>
            <dt>Success</dt>
            <dd>
              <code>{task.success}</code>
            </dd>
            <dt>Max steps</dt>
            <dd>{task.max_steps}</dd>
          </dl>
        </div>
        <div className="sec">
          <span className="eyebrow">Attempts</span>
          <span className="meta">
            {scored}/{agents.length} scored
          </span>
        </div>
        <ul className="rows">
          {agents.map((a) => {
            const outcome = a.outcomes[task.id];
            const live = a.currentTaskId === task.id && !outcome;
            const status = outcome ?? (live ? 'active' : 'pending');
            const steps = a.history[task.id]?.length ?? 0;
            return (
              <Row
                key={a.agentId}
                glyph={<StatusIcon status={status} />}
                title={
                  personas.get(personaByAgent.get(a.agentId) ?? '')?.name ?? a.agentId.slice(0, 8)
                }
                meta={steps > 0 ? `${steps} ${steps === 1 ? 'step' : 'steps'}` : ''}
                on={sbAgent === a.agentId && sbTask === task.id}
                disabled={status === 'pending'}
                onClick={() => {
                  onOpenAgent(a.agentId, task.id);
                }}
              />
            );
          })}
        </ul>
      </div>
    </>
  );
}

function PersonaDetail({
  agentId,
  tasks,
  agents,
  personas,
  personaByAgent,
  sbTask,
  onOpenAgent,
}: DetailProps & { agentId: string }) {
  const agent = agents.find((a) => a.agentId === agentId);
  if (!agent) return null;
  const persona = personas.get(personaByAgent.get(agent.agentId) ?? '');
  const name = persona?.name ?? agent.agentId.slice(0, 8);
  return (
    <>
      <div className="col-head">
        <span className="eyebrow">Persona</span>
        <span className="meta">
          {Object.keys(agent.outcomes).length}/{tasks.length} scored
        </span>
      </div>
      <div key={agent.agentId} className="col-body">
        <div className="pad">
          <div className="who">
            <span className="av lg">{name.slice(0, 1)}</span>
            <div className="rt">
              <h2>{name}</h2>
              {persona && (
                <span className="sub">
                  {persona.attributes.age} · {persona.attributes.gender}
                </span>
              )}
            </div>
            <span className={`pill ${agent.status}`}>{agent.status}</span>
          </div>
          {persona && persona.attributes.modifiers.length > 0 ? (
            <div className="chips">
              {persona.attributes.modifiers.map((m) => (
                <span key={m.id} className="chip">
                  {m.id.replace('_', ' ')}
                </span>
              ))}
            </div>
          ) : (
            <span className="muted">No modifiers</span>
          )}
          {persona && <p className="muted">{persona.description}</p>}
          {agent.lastError && <p className="failure">{agent.lastError}</p>}
        </div>
        <div className="sec">
          <span className="eyebrow">Tasks</span>
          <span className="meta score">
            <span className="p">{agent.passed} pass</span> ·{' '}
            <span className="f">{agent.failed + agent.errored} fail</span>
          </span>
        </div>
        <ul className="rows">
          {tasks.map((t) => {
            const outcome = agent.outcomes[t.id];
            const live = agent.currentTaskId === t.id && !outcome;
            const steps = agent.history[t.id]?.length ?? 0;
            return (
              <Row
                key={t.id}
                glyph={<StatusIcon status={outcome ?? (live ? 'active' : 'pending')} />}
                title={t.name}
                meta={steps > 0 ? `${steps} ${steps === 1 ? 'step' : 'steps'}` : ''}
                on={sbTask === t.id}
                disabled={!(t.id in agent.history)}
                onClick={() => {
                  onOpenAgent(agent.agentId, t.id);
                }}
              />
            );
          })}
        </ul>
      </div>
    </>
  );
}

function SuggestionDetail({
  suggestionId,
  suggestions,
  tasks,
  personas,
  personaByAgent,
  sandbox,
  onOpenAgent,
}: DetailProps & { suggestionId: string }) {
  const s = suggestions.find((x) => x.id === suggestionId);
  if (!s) return null;
  const params = Object.entries(s.proposed_change.params)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join(', ');
  return (
    <>
      <div className="col-head">
        <span className="eyebrow">Suggestion</span>
        <span className="meta">
          {suggestions.indexOf(s) + 1} of {suggestions.length}
        </span>
      </div>
      <div key={s.id} className="col-body">
        <div className="pad">
          <span className={`cat ${s.category}`}>{s.category}</span>
          <h2>{s.title}</h2>
          <p className="muted">{s.rationale}</p>
          <dl className="facts">
            <dt>Change</dt>
            <dd>
              <code>
                {s.proposed_change.type}({params})
              </code>
            </dd>
          </dl>
        </div>
        <div className="sec">
          <span className="eyebrow">Evidence</span>
          <span className="meta">{s.evidence.length}</span>
        </div>
        <ul className="rows">
          {s.evidence.map((e) => (
            <Row
              key={`${e.agent_id}:${e.task_id}:${e.step}`}
              glyph={<span className="muted">§{e.step}</span>}
              title={personas.get(personaByAgent.get(e.agent_id) ?? '')?.name ?? 'agent'}
              sub={tasks.find((t) => t.id === e.task_id)?.name ?? 'task'}
              on={
                sandbox?.kind === 'replay' &&
                sandbox.agentId === e.agent_id &&
                sandbox.taskId === e.task_id
              }
              onClick={() => {
                onOpenAgent(e.agent_id, e.task_id);
              }}
            />
          ))}
        </ul>
      </div>
    </>
  );
}
