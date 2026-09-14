import { useMemo, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bookmark, Eye, Inbox, Star, UserCheck } from 'lucide-react';
import type { BoardItem } from '@shared/types';
import { useAuth, useBoard, useSchema } from '@/api/hooks';
import { AvatarStack } from '@/components/ui/Avatar';
import { Tag } from '@/components/ui/Tag';
import { STATUS, TEAM, field, intakeItems, selectOption, selectOptions } from '@/model/board';
import { timeAgo } from '@/model/time';
import { useSavedViews, viewHref } from '@/model/views';
import { ViewHeader } from '../shell/ViewHeader';
import './home.css';

/** Open and not archived — "my work", not "everything I have ever touched". */
function live(items: BoardItem[]): BoardItem[] {
  return items.filter((i) => i.state === 'OPEN' && !i.isArchived);
}

/**
 * The landing page. Everything here is a slice of the board that is already in the cache —
 * no extra fetch — because watching and starring ride along on each BoardItem.
 */
export function HomeView() {
  const { data: auth } = useAuth();
  const { data: schema } = useSchema();
  const board = useBoard(Boolean(schema));
  const { views } = useSavedViews();
  const items = board.data?.items ?? [];
  const me = auth?.user?.id;

  const assigned = useMemo(
    () => live(items).filter((i) => me && i.assignees.some((a) => a.id === me)),
    [items, me],
  );
  const watching = useMemo(() => live(items).filter((i) => i.viewerWatching), [items]);
  const starred = useMemo(() => items.filter((i) => i.viewerStarred && !i.isArchived), [items]);
  const intake = useMemo(() => intakeItems(items), [items]);
  const pinned = views.filter((v) => v.pinned);

  return (
    <>
      <ViewHeader title="Home" search={false} />
      <div className="home">
        <Link to="/inbox" className="home-callout" data-tour="home-intake">
          <Inbox size={14} />
          <strong>{intake.length}</strong>
          <span>{intake.length === 1 ? 'issue needs triage' : 'issues need triage'}</span>
        </Link>

        <Section
          title="Assigned to me"
          icon={<UserCheck size={13} />}
          items={assigned}
          empty="Nothing is assigned to you right now."
        />
        <Section
          title="Watching"
          icon={<Eye size={13} />}
          items={watching}
          empty="Watch an issue to get a Slack DM when it moves."
        />
        <Section
          title="Starred"
          icon={<Star size={13} />}
          items={starred}
          empty="Star an issue to keep it here."
        />

        <section className="home-section" data-tour="home-views">
          <h2>
            <Bookmark size={13} /> Pinned views
          </h2>
          {pinned.length ? (
            <ul className="home-views">
              {pinned.map((v) => (
                <li key={v.id}>
                  <Link to={viewHref(v)}>{v.name}</Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="home-empty">Pin a saved view in the sidebar to reach it from here.</p>
          )}
        </section>
      </div>
    </>
  );
}

function Section({
  title,
  icon,
  items,
  empty,
}: {
  title: string;
  icon: ReactNode;
  items: BoardItem[];
  empty: string;
}) {
  const { data: schema } = useSchema();
  const navigate = useNavigate();
  const statusField = field(schema, STATUS);
  const teamField = field(schema, TEAM);

  // One navigation rather than route-then-set-param: `?i=` belongs to the board's URL, and
  // openIssue() would be writing it against Home's search params.
  const open = (item: BoardItem) => navigate(`/board?i=${encodeURIComponent(item.key)}`);

  return (
    <section className="home-section">
      <h2>
        {icon} {title}
        {items.length > 0 && <span className="count">{items.length}</span>}
      </h2>
      {items.length === 0 ? (
        <p className="home-empty">{empty}</p>
      ) : (
        <ul className="home-list">
          {items.slice(0, 12).map((item) => {
            const status = selectOption(item, statusField);
            const teams = selectOptions(item, teamField);
            return (
              <li key={item.itemId}>
                <button onClick={() => open(item)}>
                  <span className="mono muted">{item.key}</span>
                  <span className="home-title">{item.title}</span>
                  {teams.map((t) => (
                    <Tag key={t.id} color={t.color}>
                      {t.name}
                    </Tag>
                  ))}
                  {status && (
                    <Tag color={status.color} plain>
                      {status.name}
                    </Tag>
                  )}
                  <AvatarStack people={item.assignees} />
                  <span className="faint">{timeAgo(item.updatedAt)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
