import { createContext, type ReactNode, useEffect, useState } from 'react';

export const LEAVE_MS = 380;

/** True inside a page that is animating out; heavy children can skip mounting. */
export const LeavingContext = createContext(false);

interface Page {
  id: string;
  children: ReactNode;
}

/** Crossfades pages keyed by `id`: the old page animates out while the new one enters. */
export function PageSwitch({ id, children }: { id: string; children: ReactNode }) {
  const [shown, setShown] = useState<Page>({ id, children });
  const [leaving, setLeaving] = useState<Page | null>(null);
  if (shown.id !== id) {
    setLeaving(shown);
    setShown({ id, children });
  } else if (shown.children !== children) {
    setShown({ id, children });
  }

  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => {
      setLeaving(null);
    }, LEAVE_MS);
    return () => {
      clearTimeout(t);
    };
  }, [leaving]);

  return (
    <div className="pages">
      {leaving && (
        <div key={`${leaving.id}:leave`} className="page page-leave" aria-hidden="true">
          <LeavingContext.Provider value={true}>{leaving.children}</LeavingContext.Provider>
        </div>
      )}
      <div key={id} className="page page-enter">
        {children}
      </div>
    </div>
  );
}

interface PresenceProps {
  show: boolean;
  className: string;
  children: ReactNode;
}

/** Keeps `children` mounted for the exit animation after `show` turns false. */
export function Presence({ show, className, children }: PresenceProps) {
  const [mounted, setMounted] = useState(show);
  const [last, setLast] = useState(children);
  if (show && last !== children) setLast(children);
  if (show && !mounted) setMounted(true);

  useEffect(() => {
    if (show || !mounted) return;
    const t = setTimeout(() => {
      setMounted(false);
    }, LEAVE_MS);
    return () => {
      clearTimeout(t);
    };
  }, [show, mounted]);

  if (!mounted) return null;
  return (
    <div className={`${className} ${show ? 'present-enter' : 'present-leave'}`}>
      {show ? children : last}
    </div>
  );
}
