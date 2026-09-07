import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AuthStatus,
  Person,
  BoardData,
  BoardItem,
  CreateIssueRequest,
  FieldWriteValue,
  IssueComment,
  OrgMember,
  ProjectSchema,
  UpdateIssueRequest,
} from '@shared/types';
import { get, patch, post } from './client';

export const keys = {
  auth: ['auth'] as const,
  schema: ['schema'] as const,
  board: ['board'] as const,
  members: ['members'] as const,
  comments: (issueId: string) => ['comments', issueId] as const,
};

export function useAuth() {
  return useQuery({ queryKey: keys.auth, queryFn: () => get<AuthStatus>('/api/auth/me'), staleTime: 5 * 60_000 });
}

export function useSchema(enabled = true) {
  return useQuery({ queryKey: keys.schema, queryFn: () => get<ProjectSchema>('/api/project/schema'), staleTime: 10 * 60_000, enabled });
}

export function useBoard(enabled = true) {
  return useQuery({
    queryKey: keys.board,
    queryFn: () => get<BoardData>('/api/project/items'),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    enabled,
  });
}

export function useMembers(enabled = true) {
  return useQuery({ queryKey: keys.members, queryFn: () => get<OrgMember[]>('/api/org/members'), staleTime: 10 * 60_000, enabled });
}

export function useComments(issueId: string | undefined) {
  return useQuery({
    queryKey: keys.comments(issueId ?? ''),
    queryFn: () => get<IssueComment[]>(`/api/issues/${encodeURIComponent(issueId!)}/comments`),
    enabled: Boolean(issueId),
  });
}

/** Replace one item in the cached board (or append if new). */
function upsertItem(board: BoardData | undefined, item: BoardItem): BoardData | undefined {
  if (!board) return board;
  const idx = board.items.findIndex((i) => i.itemId === item.itemId);
  const items = idx === -1 ? [item, ...board.items] : board.items.map((i) => (i.itemId === item.itemId ? item : i));
  return { ...board, items };
}

function patchItem(board: BoardData | undefined, itemId: string, fn: (i: BoardItem) => BoardItem) {
  if (!board) return board;
  return { ...board, items: board.items.map((i) => (i.itemId === itemId ? fn(i) : i)) };
}

export interface SetFieldArgs {
  itemId: string;
  fieldId: string;
  fieldName: string;
  value: FieldWriteValue;
  /** Display info for the optimistic update. */
  optimistic?: BoardItem['fields'][string] | null;
}

export function useSetField() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, fieldId, value }: SetFieldArgs) =>
      post<BoardItem>(`/api/items/${encodeURIComponent(itemId)}/field`, { fieldId, value }),
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey: keys.board });
      const prev = qc.getQueryData<BoardData>(keys.board);
      qc.setQueryData<BoardData>(keys.board, (b) =>
        patchItem(b, args.itemId, (i) => {
          const fields = { ...i.fields };
          if (args.optimistic === null || args.value === null) delete fields[args.fieldName];
          else if (args.optimistic) fields[args.fieldName] = args.optimistic;
          return { ...i, fields, updatedAt: new Date().toISOString() };
        }),
      );
      return { prev };
    },
    onError: (_e, _a, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.board, ctx.prev);
    },
    onSuccess: (item) => {
      qc.setQueryData<BoardData>(keys.board, (b) => upsertItem(b, item));
    },
  });
}

export function useUpdateIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ issueId, optimisticAssignees: _o, ...body }: UpdateIssueRequest & { issueId: string; itemId: string; optimisticAssignees?: Person[] }) =>
      patch<{ ok: true; item: BoardItem | null }>(`/api/issues/${encodeURIComponent(issueId)}`, body),
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey: keys.board });
      const prev = qc.getQueryData<BoardData>(keys.board);
      qc.setQueryData<BoardData>(keys.board, (b) =>
        patchItem(b, args.itemId, (i) => ({
          ...i,
          title: args.title ?? i.title,
          body: args.body ?? i.body,
          assignees: args.optimisticAssignees ?? i.assignees,
          state: args.state ?? i.state,
          stateReason: args.state === 'CLOSED' ? (args.stateReason ?? 'COMPLETED') : args.state === 'OPEN' ? 'REOPENED' : i.stateReason,
          closedAt: args.state === 'CLOSED' ? new Date().toISOString() : args.state === 'OPEN' ? null : i.closedAt,
          updatedAt: new Date().toISOString(),
        })),
      );
      return { prev };
    },
    onError: (_e, _a, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.board, ctx.prev);
    },
    onSuccess: (res) => {
      if (res.item) qc.setQueryData<BoardData>(keys.board, (b) => upsertItem(b, res.item!));
    },
  });
}

export function useCreateIssue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateIssueRequest) => post<BoardItem>('/api/issues', body),
    onSuccess: (item) => qc.setQueryData<BoardData>(keys.board, (b) => upsertItem(b, item)),
  });
}

export function useAddComment(issueId: string, itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => post<IssueComment>(`/api/issues/${encodeURIComponent(issueId)}/comments`, { body }),
    onSuccess: (c) => {
      qc.setQueryData<IssueComment[]>(keys.comments(issueId), (cs) => [...(cs ?? []), c]);
      qc.setQueryData<BoardData>(keys.board, (b) => patchItem(b, itemId, (i) => ({ ...i, commentCount: i.commentCount + 1 })));
    },
  });
}
