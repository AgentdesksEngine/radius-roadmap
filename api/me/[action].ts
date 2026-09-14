import { z } from 'zod';
import {
  createDashboard,
  createView,
  deleteDashboard,
  deleteView,
  listDashboards,
  listViews,
  updateDashboard,
  updateView,
} from '../_lib/db/me.js';
import { HttpError, noStore, param, readJson, route } from '../_lib/http.js';
import { requireUser } from '../_lib/session.js';

/**
 * Everything the signed-in person owns but does not share: saved views and dashboards.
 * One function with an :action segment, for the same function-cap reason as /api/auth and
 * /api/project. Watching and starring are not here — they hang off an issue, so they live in
 * api/issues/[...path].ts.
 */

const WidgetSchema = z.object({
  id: z.string().min(1),
  measure: z.enum(['stat', 'openByField', 'throughput', 'age', 'cycleTime']),
  title: z.string().max(120).optional(),
  stat: z.enum(['open', 'createdRecently', 'closedRecently', 'needsTriage', 'urgentOpen', 'net']).optional(),
  groupBy: z.string().max(120).optional(),
});

const CreateViewBody = z.object({
  name: z.string().trim().min(1).max(120),
  path: z.string().trim().min(1).max(200),
  filters: z.record(z.string(), z.unknown()).default({}),
  groupBy: z.string().max(120).default('Status'),
  pinned: z.boolean().optional(),
});

const PatchViewBody = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  pinned: z.boolean().optional(),
});

const CreateDashboardBody = z.object({
  name: z.string().trim().min(1).max(120),
  widgets: z.array(WidgetSchema).max(24).optional(),
});

const PatchDashboardBody = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  widgets: z.array(WidgetSchema).max(24).optional(),
});

const DeleteBody = z.object({ id: z.string().min(1) });

function body<T extends z.ZodTypeAny>(schema: T, raw: unknown): z.infer<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
  return parsed.data;
}

export default route({
  GET: async (req, res) => {
    const { profileId } = await requireUser(req, res);
    const action = param(req, 'action');
    noStore(res);
    if (action === 'views') {
      res.status(200).json(await listViews(profileId));
      return;
    }
    if (action === 'dashboards') {
      res.status(200).json(await listDashboards(profileId));
      return;
    }
    throw new HttpError(404, 'Not found');
  },

  POST: async (req, res) => {
    const { profileId } = await requireUser(req, res);
    const action = param(req, 'action');
    if (action === 'views') {
      res.status(201).json(await createView(profileId, body(CreateViewBody, readJson(req))));
      return;
    }
    if (action === 'dashboards') {
      const data = body(CreateDashboardBody, readJson(req));
      res.status(201).json(await createDashboard(profileId, data.name, data.widgets ?? []));
      return;
    }
    throw new HttpError(404, 'Not found');
  },

  PATCH: async (req, res) => {
    const { profileId } = await requireUser(req, res);
    const action = param(req, 'action');
    if (action === 'views') {
      const { id, ...patch } = body(PatchViewBody, readJson(req));
      res.status(200).json(await updateView(profileId, id, patch));
      return;
    }
    if (action === 'dashboards') {
      const { id, ...patch } = body(PatchDashboardBody, readJson(req));
      res.status(200).json(await updateDashboard(profileId, id, patch));
      return;
    }
    throw new HttpError(404, 'Not found');
  },

  DELETE: async (req, res) => {
    const { profileId } = await requireUser(req, res);
    const action = param(req, 'action');
    const { id } = body(DeleteBody, readJson(req));
    if (action === 'views') {
      await deleteView(profileId, id);
      res.status(200).json({ ok: true });
      return;
    }
    if (action === 'dashboards') {
      await deleteDashboard(profileId, id);
      res.status(200).json({ ok: true });
      return;
    }
    throw new HttpError(404, 'Not found');
  },
});
