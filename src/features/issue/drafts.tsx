import { createContext, useContext, useEffect } from 'react';

/**
 * Anything inside the drawer holding unsaved text registers here, so closing can ask
 * before throwing it away. Its own module rather than the panel's, so the composer and
 * the activity feed can reach it without importing the panel that renders them.
 */
export const DirtyCtx = createContext<(id: string, dirty: boolean) => void>(() => {});

export function useDirtyDraft(id: string, dirty: boolean) {
  const mark = useContext(DirtyCtx);
  useEffect(() => {
    mark(id, dirty);
    return () => mark(id, false);
  }, [id, dirty, mark]);
}
