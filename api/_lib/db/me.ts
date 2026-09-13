/**
 * Per-profile state that used to live in one browser: saved views and dashboards.
 * Everything here is scoped by profile_id in the WHERE clause — there is no other tenancy
 * check, so no query may take an id without it.
 */
import type { Dashboard, SavedView, Widget } from '../../../shared/types.js';
import { HttpError } from '../http.js';
import { asJson, db } from './pool.js';

interface SavedViewRow {
  id: string;
  name: string;
  path: string;
  filters: unknown;
  groupBy: string;
  pinned: boolean;
}

export async function listViews(profileId: string): Promise<SavedView[]> {
  return db()<SavedViewRow[]>`
    select id, name, path, filters, group_by as "groupBy", pinned
    from saved_views where profile_id = ${profileId} order by created_at
  `;
}

export async function createView(
  profileId: string,
  view: { name: string; path: string; filters: unknown; groupBy: string; pinned?: boolean },
): Promise<SavedView> {
  const sql = db();
  const [row] = await sql<SavedViewRow[]>`
    insert into saved_views (profile_id, name, path, filters, group_by, pinned)
    values (${profileId}, ${view.name}, ${view.path}, ${sql.json(asJson(view.filters))}::jsonb,
            ${view.groupBy}, ${view.pinned ?? false})
    returning id, name, path, filters, group_by as "groupBy", pinned
  `;
  return row!;
}

export async function updateView(
  profileId: string,
  id: string,
  patch: { name?: string; pinned?: boolean },
): Promise<SavedView> {
  const sql = db();
  const [row] = await sql<SavedViewRow[]>`
    update saved_views set
      name = coalesce(${patch.name ?? null}, name),
      pinned = coalesce(${patch.pinned ?? null}, pinned)
    where id = ${id} and profile_id = ${profileId}
    returning id, name, path, filters, group_by as "groupBy", pinned
  `;
  if (!row) throw new HttpError(404, 'View not found');
  return row;
}

export async function deleteView(profileId: string, id: string): Promise<void> {
  await db()`delete from saved_views where id = ${id} and profile_id = ${profileId}`;
}

export async function listDashboards(profileId: string): Promise<Dashboard[]> {
  return db()<Dashboard[]>`
    select id, name, widgets from dashboards where profile_id = ${profileId} order by created_at
  `;
}

export async function createDashboard(profileId: string, name: string, widgets: Widget[] = []): Promise<Dashboard> {
  const sql = db();
  const [row] = await sql<Dashboard[]>`
    insert into dashboards (profile_id, name, widgets)
    values (${profileId}, ${name}, ${sql.json(asJson(widgets))}::jsonb)
    returning id, name, widgets
  `;
  return row!;
}

export async function updateDashboard(
  profileId: string,
  id: string,
  patch: { name?: string; widgets?: Widget[] },
): Promise<Dashboard> {
  const sql = db();
  const [row] = await sql<Dashboard[]>`
    update dashboards set
      name = coalesce(${patch.name ?? null}, name),
      widgets = coalesce(${patch.widgets ? sql.json(asJson(patch.widgets)) : null}::jsonb, widgets),
      updated_at = now()
    where id = ${id} and profile_id = ${profileId}
    returning id, name, widgets
  `;
  if (!row) throw new HttpError(404, 'Dashboard not found');
  return row;
}

export async function deleteDashboard(profileId: string, id: string): Promise<void> {
  await db()`delete from dashboards where id = ${id} and profile_id = ${profileId}`;
}
