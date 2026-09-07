import type { BoardItem } from '@shared/types';
import { PLATFORM, TEAM, selectName } from './board';

/**
 * LogRocket session replays, attached to bugs.
 *
 * For an agent-reported bug the replay is the most useful thing anyone can add, and today
 * it gets pasted into a Slack thread and lost. The field holds the session URL; everything
 * here is about turning that URL into something readable, and about pointing whoever is
 * triaging at the right LogRocket project when there is no URL yet.
 */

/** Field name in the GitHub project. Declared in fields.config.ts. */
export const LOGROCKET_FIELD = 'LogRocket';

/** Radius Agent's LogRocket organization: the first path segment of every session URL. */
export const LOGROCKET_ORG = '3q0c2i';

export interface LogRocketProject {
  id: string;
  name: string;
}

export const LOGROCKET_PROJECTS: Record<string, LogRocketProject> = {
  'office-ios': { id: 'office-ios', name: 'Office iOS' },
  'office-android': { id: 'office-android', name: 'Office Android' },
  'radius-brokerage-platform': {
    id: 'radius-brokerage-platform',
    name: 'Radius Brokerage Platform',
  },
  'client-portal-ycwjp': { id: 'client-portal-ycwjp', name: 'Client Portal' },
  soul: { id: 'soul', name: 'Soul' },
  sandbox: { id: 'sandbox', name: 'Sandbox' },
};

/** Which LogRocket projects could hold a session for a given Team or Platform value. */
const BY_SURFACE: Record<string, string[]> = {
  ios: ['office-ios'],
  android: ['office-android'],
  web: ['radius-brokerage-platform', 'client-portal-ycwjp', 'soul'],
  backend: ['radius-brokerage-platform', 'client-portal-ycwjp', 'soul'],
};

function platformNames(item: BoardItem): string[] {
  const v = item.fields[PLATFORM];
  return v?.kind === 'multiSelect' ? v.options.map((o) => o.name) : [];
}

/**
 * Candidate projects for an issue, narrowed by Platform where it is set and falling back
 * to Team. An unclassified issue gets every project rather than none — a triager with no
 * idea which app it is still needs somewhere to look.
 */
export function projectsFor(item: BoardItem): LogRocketProject[] {
  const surfaces = [...platformNames(item), selectName(item, TEAM)].filter((s): s is string =>
    Boolean(s),
  );
  const ids = new Set(surfaces.flatMap((s) => BY_SURFACE[s.toLowerCase()] ?? []));
  const chosen = [...ids]
    .map((id) => LOGROCKET_PROJECTS[id])
    .filter((p): p is LogRocketProject => Boolean(p));
  if (chosen.length) return chosen;
  return Object.values(LOGROCKET_PROJECTS).filter((p) => p.id !== 'sandbox');
}

export interface LogRocketSession {
  org: string;
  projectId: string;
  projectName: string;
  recordingId: string;
  sessionId: string;
  url: string;
}

/**
 * Parse a pasted session URL.
 * Shape: https://app.logrocket.com/<org>/<project>/s/<recordingId>/<sessionId>
 * Query strings (LogRocket adds `?t=` when you copy at a timestamp) are preserved in
 * `url` so the link still lands on the right moment.
 */
export function parseSessionUrl(raw: string): LogRocketSession | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'app.logrocket.com') return null;

  const [org, projectId, s, recordingId, sessionId] = parsed.pathname.split('/').filter(Boolean);
  if (s !== 's' || !org || !projectId || !recordingId) return null;

  return {
    org,
    projectId,
    projectName: LOGROCKET_PROJECTS[projectId]?.name ?? projectId,
    recordingId,
    sessionId: sessionId ?? '0',
    url: trimmed,
  };
}

/** A short, readable stand-in for a 36-character recording id. */
export function shortRecordingId(recordingId: string): string {
  const tail = recordingId.split('-').slice(1).join('-');
  return (tail || recordingId).slice(0, 8);
}

export function sessionSearchUrl(projectId: string): string {
  return `https://app.logrocket.com/${LOGROCKET_ORG}/${projectId}/sessions`;
}
