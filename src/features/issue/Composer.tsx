import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { ImagePlus } from 'lucide-react';
import { useMembers } from '@/api/hooks';
import { Avatar } from '@/components/ui/Avatar';
import { useToast } from '@/components/ui/Toast';
import { imageMarkdown, isImage, uploadImage } from '@/lib/uploads';
import { MarkdownBody } from './Markdown';

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minHeight?: number;
  autoFocus?: boolean;
  /** ⌘↵ while the caret is in the box. */
  onSubmit?: () => void;
  id?: string;
}

/** The word being typed after an `@`, if the caret is still inside it. */
function mentionQuery(text: string, caret: number): string | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf('@');
  if (at === -1) return null;
  if (at > 0 && !/[\s(]/.test(upto[at - 1]!)) return null;
  const word = upto.slice(at + 1);
  return /^[\w.-]*$/.test(word) ? word : null;
}

/**
 * The markdown box used for descriptions, comments and new issues: a preview tab so the
 * markdown the placeholder promises can actually be checked, @mentions against the org
 * member list, and paste- or drop-to-attach for the screenshot that came with the bug.
 */
export function Composer({
  value,
  onChange,
  placeholder,
  minHeight = 80,
  autoFocus,
  onSubmit,
  id,
}: Props) {
  const { data: members } = useMembers();
  const toast = useToast();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [mention, setMention] = useState<{ q: string; at: number; pick: number } | null>(null);

  const matches = mention
    ? (members ?? [])
        .filter((m) => (m.name ?? '').toLowerCase().includes(mention.q.toLowerCase()))
        .slice(0, 6)
    : [];

  useEffect(() => {
    if (mention && matches.length === 0) setMention(null);
  }, [mention, matches.length]);

  const insert = (text: string) => {
    const el = ref.current;
    const at = el?.selectionStart ?? value.length;
    const next = `${value.slice(0, at)}${text}${value.slice(el?.selectionEnd ?? at)}`;
    onChange(next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = at + text.length;
      el?.setSelectionRange(pos, pos);
    });
  };

  const applyMention = (name: string) => {
    if (!mention) return;
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const handle = `@${name.replace(/\s+/g, '')} `;
    const next = `${value.slice(0, mention.at)}${handle}${value.slice(caret)}`;
    onChange(next);
    setMention(null);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = mention.at + handle.length;
      el?.setSelectionRange(pos, pos);
    });
  };

  const attach = async (files: File[]) => {
    const images = files.filter(isImage);
    if (!images.length) return;
    setUploading((n) => n + images.length);
    for (const file of images) {
      try {
        const url = await uploadImage(file);
        insert(`\n${imageMarkdown(file, url)}\n`);
      } catch (e) {
        toast.error(`Couldn’t attach ${file.name}: ${(e as Error).message}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (files.some(isImage)) {
      e.preventDefault();
      void attach(files);
    }
  };

  const onDrop = (e: DragEvent<HTMLTextAreaElement>) => {
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.some(isImage)) {
      e.preventDefault();
      void attach(files);
    }
  };

  return (
    <div className="composer-box">
      <div className="composer-tabs">
        <button
          className="composer-tab"
          aria-selected={tab === 'write'}
          onClick={() => setTab('write')}
        >
          Write
        </button>
        <button
          className="composer-tab"
          aria-selected={tab === 'preview'}
          onClick={() => setTab('preview')}
        >
          Preview
        </button>
      </div>

      {tab === 'write' ? (
        <div style={{ position: 'relative' }}>
          <textarea
            id={id}
            ref={ref}
            className={`textarea ${dragOver ? 'composer-drop' : ''}`}
            style={{ minHeight }}
            autoFocus={autoFocus}
            placeholder={placeholder}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              const caret = e.target.selectionStart;
              const q = mentionQuery(e.target.value, caret);
              setMention(q === null ? null : { q, at: caret - q.length - 1, pick: 0 });
            }}
            onPaste={onPaste}
            onDragOver={(e) => {
              if (Array.from(e.dataTransfer.items).some((i) => i.kind === 'file')) {
                e.preventDefault();
                setDragOver(true);
              }
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onKeyDown={(e) => {
              if (mention && matches.length) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setMention({ ...mention, pick: (mention.pick + 1) % matches.length });
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setMention({
                    ...mention,
                    pick: (mention.pick - 1 + matches.length) % matches.length,
                  });
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  applyMention(matches[mention.pick]?.name ?? '');
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault(); // handled here; don't let the shell close the drawer
                  setMention(null);
                  return;
                }
              }
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                onSubmit?.();
              }
            }}
          />
          {mention && matches.length > 0 && (
            <div className="mention-pop" style={{ left: 8, bottom: 8 }} role="listbox">
              {matches.map((m, i) => (
                <div
                  key={m.id}
                  role="option"
                  aria-selected={i === mention.pick}
                  className="menu-item"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyMention(m.name ?? '');
                  }}
                >
                  <Avatar person={m} size={16} />
                  <span className="truncate">{m.name || 'Unknown'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="composer-preview md-wrap" style={{ minHeight }}>
          {value.trim() ? (
            <MarkdownBody>{value}</MarkdownBody>
          ) : (
            <span className="faint">Nothing to preview yet.</span>
          )}
        </div>
      )}

      <div className="composer-hint">
        <ImagePlus size={13} />
        <span>
          {uploading > 0
            ? `Uploading ${uploading} image${uploading === 1 ? '' : 's'}…`
            : 'Paste or drop an image to attach it · @ to mention'}
        </span>
      </div>
    </div>
  );
}
