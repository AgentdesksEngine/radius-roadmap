import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { BoardItem } from '@shared/types';
import { supabase } from '@/lib/supabaseClient';
import { get } from './client';
import { keys, upsertItem } from './hooks';

/**
 * Replaces the old GitHub-webhook + 30s poll: subscribes to `postgres_changes` on the
 * `issues` table (see the RLS policy in supabase/migrations/0001_init.sql) and, on any
 * insert/update, fetches the single changed item and folds it into the board cache. The
 * realtime payload itself doesn't carry a fully-hydrated BoardItem (labels/assignees/fields
 * need joins), so this is a signal to refetch one item, not a data channel.
 */
export function useBoardRealtime(enabled: boolean) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel('issues-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'issues' },
        async (payload) => {
          const id = (payload.new as { id?: string } | null)?.id;
          if (!id) return;
          try {
            const item = await get<BoardItem>(`/api/items/${encodeURIComponent(id)}`);
            qc.setQueryData(keys.board, (b: Parameters<typeof upsertItem>[0]) => upsertItem(b, item));
          } catch {
            // Best-effort — the next window-focus refetch will catch it up.
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, qc]);
}
