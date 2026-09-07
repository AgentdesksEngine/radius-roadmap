import { SmilePlus } from 'lucide-react';
import type { Reaction, ReactionContent } from '@shared/types';
import { useSetReaction } from '@/api/hooks';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/Menu';
import { Tooltip } from '@/components/ui/Button';

export const REACTION_EMOJI: Record<ReactionContent, string> = {
  THUMBS_UP: '👍',
  THUMBS_DOWN: '👎',
  LAUGH: '😄',
  HOORAY: '🎉',
  CONFUSED: '😕',
  HEART: '❤️',
  ROCKET: '🚀',
  EYES: '👀',
};

const ORDER = Object.keys(REACTION_EMOJI) as ReactionContent[];

interface Props {
  subjectId: string;
  reactions: Reaction[];
  /** Board item to refresh when the subject is an issue. */
  itemId?: string;
  /** Issue whose activity feed to refresh when the subject is a comment. */
  issueId?: string;
}

/**
 * Reaction pills plus a picker. On a bug tracker this is the cheapest possible signal for
 * "this is hitting me too", and it lands on the GitHub issue where everyone else sees it.
 */
export function Reactions({ subjectId, reactions, itemId, issueId }: Props) {
  const set = useSetReaction();
  const toggle = (content: ReactionContent, on: boolean) =>
    set.mutate({ subjectId, content, on, itemId, issueId });

  return (
    <div className="reactions">
      {reactions.map((r) => (
        <Tooltip key={r.content} label={r.viewerHasReacted ? 'Remove reaction' : 'Add reaction'}>
          <button
            className={`reaction ${r.viewerHasReacted ? 'on' : ''}`}
            onClick={() => toggle(r.content, !r.viewerHasReacted)}
            aria-pressed={r.viewerHasReacted}
          >
            <span aria-hidden>{REACTION_EMOJI[r.content]}</span>
            {r.count}
          </button>
        </Tooltip>
      ))}
      <Menu>
        <MenuTrigger asChild>
          <button
            className={`reaction add ${reactions.length ? '' : 'bare'}`}
            aria-label="Add reaction"
          >
            <SmilePlus />
            {reactions.length === 0 && 'React'}
          </button>
        </MenuTrigger>
        <MenuContent align="start">
          <div className="reaction-grid">
            {ORDER.map((content) => (
              <MenuItem
                key={content}
                onSelect={() =>
                  toggle(content, !reactions.find((r) => r.content === content)?.viewerHasReacted)
                }
                aria-label={content}
              >
                <span aria-hidden>{REACTION_EMOJI[content]}</span>
              </MenuItem>
            ))}
          </div>
        </MenuContent>
      </Menu>
    </div>
  );
}
