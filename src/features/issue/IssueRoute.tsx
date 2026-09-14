import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';

/**
 * /issue/RAD-42 — the URL issueUrl() has always produced (and that every Slack DM links to),
 * which until now fell through to /board with no panel. The panel is driven by the `?i=` query
 * param rather than a route of its own, so this just rewrites one into the other.
 */
export function IssueRoute() {
  const { key } = useParams();
  useEffect(() => {
    document.title = key ? `${key} · Bugtracker` : 'Bugtracker';
  }, [key]);
  if (!key) return <Navigate to="/board" replace />;
  return <Navigate to={`/board?i=${encodeURIComponent(key.toUpperCase())}`} replace />;
}
