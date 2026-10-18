import { createContext, type ReactNode, useEffect, useState } from 'react';

const LEAVE_MS = 380;

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
