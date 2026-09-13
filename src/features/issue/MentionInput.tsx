import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useMembers } from '@/api/hooks';
import { Avatar } from '@/components/ui/Avatar';
import { activeMention, applyMention, type MentionQuery } from './mentions';

/**
 * The comment box, plus an @-picker anchored to the caret.
 *
 * Not the shared `Picker`: that opens from a trigger element in a popover, which cannot
 * follow a caret inside a textarea. This is the same menu chrome driven by the text itself.
 */
export function MentionInput({
  value,
  onChange,
  onSubmit,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder?: string;
}) {
  const { data: members } = useMembers();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<MentionQuery | null>(null);
  const [active, setActive] = useState(0);
  /** Set after an insert so the caret can be restored once React has re-rendered the value. */
  const pendingCaret = useRef<number | null>(null);

  const matches = query
    ? (members ?? [])
        .filter((m) => (m.name ?? '').toLowerCase().includes(query.text.toLowerCase()))
        .slice(0, 6)
    : [];

  useEffect(() => {
    if (pendingCaret.current == null || !ref.current) return;
    ref.current.selectionStart = ref.current.selectionEnd = pendingCaret.current;
    pendingCaret.current = null;
  }, [value]);

  useEffect(() => setActive(0), [query?.text]);

  const sync = (el: HTMLTextAreaElement) => setQuery(activeMention(el.value, el.selectionStart));

  const choose = (index: number) => {
    const member = matches[index];
    const el = ref.current;
    if (!member || !query || !el) return;
    const next = applyMention(el.value, query, el.selectionStart, member.name ?? 'Unknown', member.id);
    pendingCaret.current = next.caret;
    onChange(next.value);
    setQuery(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (query && matches.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => (i + 1) % matches.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        choose(active);
        return;
      }
      if (e.key === 'Escape') {
        // Stop here: the panel's Escape handler would otherwise close the whole issue.
        e.preventDefault();
        setQuery(null);
        return;
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onSubmit();
  };

  return (
    <div className="mention-wrap">
      <textarea
        ref={ref}
        className="textarea"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          sync(e.target);
        }}
        onClick={(e) => sync(e.currentTarget)}
        onKeyUp={(e) => sync(e.currentTarget)}
        onBlur={() => setQuery(null)}
        onKeyDown={onKeyDown}
      />
      {query && matches.length > 0 && (
        <ul className="mention-menu" role="listbox">
          {matches.map((m, i) => (
            <li key={m.id}>
              <button
                type="button"
                className={`menu-item ${i === active ? 'active' : ''}`}
                // mousedown, not click: blur would close the menu before click lands.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(i);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <Avatar person={m} size={16} /> {m.name ?? 'Unknown'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
