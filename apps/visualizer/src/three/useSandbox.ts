import type { MeshAnnotations } from '@infallible/contracts';
import { useContext, useEffect, useRef } from 'react';

import { LeavingContext } from '../ui/Transition';
import { Sandbox } from './sandbox';

/**
 * Owns one Sandbox for the lifetime of the component. Declare it before any
 * effect that uses `sandboxRef`, so the instance exists when they run.
 */
export function useSandbox(
  interactive: boolean,
  meshUrl: string | null,
  annotations: MeshAnnotations | null,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sandboxRef = useRef<Sandbox | null>(null);
  // A page fading out must not spin up a second WebGL context.
  const leaving = useContext(LeavingContext);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || leaving) return;
    const sandbox = new Sandbox(el, interactive);
    sandboxRef.current = sandbox;
    return () => {
      sandbox.dispose();
      sandboxRef.current = null;
    };
  }, [interactive, leaving]);

  useEffect(() => {
    void sandboxRef.current?.loadMesh(meshUrl);
  }, [meshUrl, leaving]);

  useEffect(() => {
    sandboxRef.current?.setAnnotations(annotations);
  }, [annotations, leaving]);

  return { containerRef, sandboxRef };
}
