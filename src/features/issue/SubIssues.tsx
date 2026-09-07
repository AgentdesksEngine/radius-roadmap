import { CheckCircle2, CircleDot, Plus, X, XCircle } from 'lucide-react';
import type { BoardItem } from '@shared/types';
import { useBoard, useSetSubIssue } from '@/api/hooks';
import { AvatarStack } from '@/components/ui/Avatar';
import { IconButton } from '@/components/ui/Button';
import { Picker, type PickerItem } from '@/components/ui/Picker';
import { useToast } from '@/components/ui/Toast';
import { childrenOf } from '@/model/board';
import { useUi } from '../shell/state';

function StateIcon({ item }: { item: Pick<BoardItem, 'state' | 'stateReason'> }) {
  if (item.state === 'OPEN') return <CircleDot size={13} className="faint" />;
  return item.stateReason === 'COMPLETED' ? (
    <CheckCircle2 size={13} style={{ color: 'var(--c-purple)' }} />
  ) : (
    <XCircle size={13} className="faint" />
  );
}

/**
 * Parent and children for one issue. Children are read off the board rather than fetched:
 * every issue in this repo is a project item, so the board already knows the whole tree.
 */
export function SubIssues({ item }: { item: BoardItem }) {
  const { data: board } = useBoard();
  const { openIssue } = useUi();
  const setSub = useSetSubIssue();
  const toast = useToast();

  const all = board?.items ?? [];
  const children = childrenOf(all, item.number);
  const done = children.filter((c) => c.state === 'CLOSED' && c.stateReason === 'COMPLETED').length;
  const percent = children.length
    ? Math.round((done / children.length) * 100)
    : item.subIssues.percent;

  const candidates: PickerItem[] = all
    .filter(
      (i) =>
        i.itemId !== item.itemId &&
        !i.isArchived &&
        i.parent == null &&
        i.number !== item.parent?.number,
    )
    .slice(0, 300)
    .map((i) => ({
      id: i.issueId,
      label: i.title,
      hint: i.key,
      keywords: [i.key, String(i.number)],
    }));

  const attach = (subIssueId: string, on: boolean) =>
    setSub.mutate(
      { parentIssueId: item.issueId, subIssueId, attach: on },
      { onError: (e) => toast.error(`Couldn’t ${on ? 'add' : 'remove'} sub-issue: ${e.message}`) },
    );

  const detachParent = () => {
    if (!item.parent) return;
    setSub.mutate(
      { parentIssueId: item.parent.id, subIssueId: item.issueId, attach: false },
      { onError: (e) => toast.error(`Couldn’t detach from parent: ${e.message}`) },
    );
  };

  if (!item.parent && children.length === 0) {
    return (
      <div className="sub-issues">
        <Picker
          items={candidates}
          value={[]}
          multiple
          onSelect={(id) => attach(id, true)}
          placeholder="Search issues to nest…"
        >
          <button className="prop-btn empty">
            <Plus size={13} /> Add sub-issue
          </button>
        </Picker>
      </div>
    );
  }

  return (
    <div className="sub-issues">
      {item.parent && (
        <div className="parent-row">
          <span className="faint">Sub-issue of</span>
          <button className="sub-link" onClick={() => openIssue(item.parent!.key)}>
            <StateIcon item={item.parent} />
            <span className="mono muted">{item.parent.key}</span>
            <span className="truncate">{item.parent.title}</span>
          </button>
          <IconButton label="Detach from parent" size="sm" onClick={detachParent}>
            <X />
          </IconButton>
        </div>
      )}

      {children.length > 0 && (
        <>
          <div className="section-title">
            <span>Sub-issues</span>
            <span>
              {done}/{children.length} done
            </span>
          </div>
          <div
            className="progress"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          <ul className="sub-list">
            {children.map((c) => (
              <li key={c.itemId}>
                <button className="sub-link" onClick={() => openIssue(c.key)}>
                  <StateIcon item={c} />
                  <span className="mono muted">{c.key}</span>
                  <span className="truncate">{c.title}</span>
                </button>
                <AvatarStack people={c.assignees} size={16} />
                <IconButton
                  label={`Remove ${c.key}`}
                  size="sm"
                  onClick={() => attach(c.issueId, false)}
                >
                  <X />
                </IconButton>
              </li>
            ))}
          </ul>
        </>
      )}

      <Picker
        items={candidates}
        value={[]}
        multiple
        onSelect={(id) => attach(id, true)}
        placeholder="Search issues to nest…"
      >
        <button className="prop-btn empty">
          <Plus size={13} /> Add sub-issue
        </button>
      </Picker>
    </div>
  );
}
