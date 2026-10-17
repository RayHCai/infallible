import type { RunView } from '../state/runStore';

export function BuildingView({ build }: { build: RunView['build'] }) {
  return (
    <section className="hero">
      <p className="eyebrow">Building the pump</p>
      <div className="progress" role="progressbar" aria-valuenow={Math.round(build.progress * 100)}>
        <span style={{ transform: `scaleX(${build.progress})` }} />
      </div>
      <p className="muted">{build.stage}</p>
      {build.source === 'fallback' && <span className="chip">fallback mesh</span>}
    </section>
  );
}
