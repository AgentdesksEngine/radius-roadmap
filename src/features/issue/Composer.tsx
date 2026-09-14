import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { ImagePlus } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { imageMarkdown, isImage, uploadImage } from '@/lib/uploads';
import { MarkdownBody } from './Markdown';
import { MentionInput } from './MentionInput';

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

/**
 * The markdown box used for descriptions, comments and new issues.
 *
 * The typing surface is `MentionInput`, so @mentions keep producing the
 * `[@Name](mention:<id>)` token that api/_lib/notify.ts parses into Slack DMs. What this
 * adds around it is a preview tab — the placeholder has always promised markdown without
 * offering any way to check it — and paste- or drop-to-attach, so the screenshot that came
 * with the bug stops being left behind in Slack.
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
  const toast = useToast();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);

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
          type="button"
          className="composer-tab"
          aria-selected={tab === 'write'}
          onClick={() => setTab('write')}
        >
          Write
        </button>
        <button
          type="button"
          className="composer-tab"
          aria-selected={tab === 'preview'}
          onClick={() => setTab('preview')}
        >
          Preview
        </button>
      </div>

      {tab === 'write' ? (
        <MentionInput
          value={value}
          onChange={onChange}
          onSubmit={() => onSubmit?.()}
          placeholder={placeholder}
          inputRef={ref}
          minHeight={minHeight}
          autoFocus={autoFocus}
          id={id}
          className={dragOver ? 'composer-drop' : ''}
          onPaste={onPaste}
          onDrop={onDrop}
          onDragOver={(e) => {
            if (Array.from(e.dataTransfer.items).some((i) => i.kind === 'file')) {
              e.preventDefault();
              setDragOver(true);
            }
          }}
          onDragLeave={() => setDragOver(false)}
        />
      ) : (
        <div className="composer-preview" style={{ minHeight }}>
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
