import { useState } from 'react';
import { ExternalLink, Play, Plus, Search, X } from 'lucide-react';
import type { BoardItem, ProjectField } from '@shared/types';
import { useSetField } from '@/api/hooks';
import { IconButton } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import {
  parseSessionUrl,
  projectsFor,
  sessionSearchUrl,
  shortRecordingId,
} from '@/model/logrocket';

/**
 * The LogRocket field, rendered as a replay rather than a string.
 *
 * With a session attached it is a link anyone can act on. Without one it is the fastest
 * route to finding it: the projects offered are narrowed by the issue's own Platform and
 * Team, so nobody has to remember whether the office app is `office-ios` or `Office iOS`.
 */
export function LogRocketField({ item, field }: { item: BoardItem; field: ProjectField }) {
  const setField = useSetField();
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const [pasting, setPasting] = useState(false);

  const value = item.fields[field.name];
  const stored = value?.kind === 'text' ? value.text : '';
  const session = parseSessionUrl(stored);

  const write = (text: string | null) =>
    setField.mutate(
      {
        itemId: item.itemId,
        fieldId: field.id,
        fieldName: field.name,
        value: text ? { text } : null,
        optimistic: text ? { kind: 'text', text } : null,
      },
      { onError: (e) => toast.error(`Couldn’t save the session link: ${e.message}`) },
    );

  const attach = () => {
    const url = draft.trim();
    if (!url) return;
    if (!parseSessionUrl(url)) {
      toast.error('That is not a LogRocket session link. Copy the URL from the replay itself.');
      return;
    }
    write(url);
    setDraft('');
    setPasting(false);
  };

  if (session) {
    return (
      <span className="logrocket">
        <a className="lr-session" href={session.url} target="_blank" rel="noreferrer">
          <Play size={12} />
          <span className="truncate">{session.projectName}</span>
          <span className="mono faint">{shortRecordingId(session.recordingId)}</span>
        </a>
        <IconButton label="Remove session link" size="sm" onClick={() => write(null)}>
          <X />
        </IconButton>
      </span>
    );
  }

  if (pasting) {
    return (
      <span className="logrocket">
        <input
          className="prop-input"
          autoFocus
          placeholder="Paste a LogRocket session URL"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => (draft.trim() ? attach() : setPasting(false))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') attach();
            if (e.key === 'Escape') {
              setDraft('');
              setPasting(false);
            }
          }}
        />
      </span>
    );
  }

  // Nothing attached: offer to paste one, and say where to go looking. The button and the
  // project links share one wrapping row so the whole thing reads as a single control.
  return (
    <span className="logrocket empty-state">
      <button className="prop-btn empty lr-attach" onClick={() => setPasting(true)}>
        <Plus size={13} /> Attach a session
      </button>
      {projectsFor(item).map((p) => (
        <a
          key={p.id}
          className="tag lr-search"
          href={sessionSearchUrl(p.id)}
          target="_blank"
          rel="noreferrer"
          title={`Search sessions in ${p.name}`}
        >
          <Search size={10} />
          {p.name}
          <ExternalLink size={10} />
        </a>
      ))}
    </span>
  );
}
