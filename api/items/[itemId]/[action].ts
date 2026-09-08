import { z } from 'zod';
import { moveItem, setItemArchived, setItemFieldAndSync } from '../../_lib/db/board.js';
import { HttpError, param, readJson, route } from '../../_lib/http.js';
import { requireUser } from '../../_lib/session.js';

/**
 * /api/items/:itemId/archive, /field and /position in one function — a single dynamic
 * :action segment rather than three files, to stay under the Hobby plan's per-deployment
 * function cap. (/api/items/:itemId itself is the sibling `index.ts`, and
 * /api/items/bulk-field is the sibling `bulk-field.ts` — neither is itemId/action-shaped.)
 */

const ArchiveBody = z.object({ archived: z.boolean() });

const FieldBody = z.object({
  fieldId: z.string().min(1),
  value: z.union([
    z.object({ singleSelectOptionId: z.string().min(1) }),
    z.object({ multiSelectOptionIds: z.array(z.string().min(1)) }),
    z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    z.object({ text: z.string() }),
    z.object({ number: z.number() }),
    z.null(),
  ]),
});

/** `afterId: null` puts the item first. */
const PositionBody = z.object({ afterId: z.string().min(1).nullable() });

export default route({
  POST: async (req, res) => {
    const { profileId } = await requireUser(req, res);
    const itemId = param(req, 'itemId');
    const action = param(req, 'action');

    if (action === 'archive') {
      const parsed = ArchiveBody.safeParse(readJson(req));
      if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
      const item = await setItemArchived(profileId, itemId, parsed.data.archived);
      res.status(200).json(item);
      return;
    }
    if (action === 'field') {
      const parsed = FieldBody.safeParse(readJson(req));
      if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
      const item = await setItemFieldAndSync(profileId, { itemId, ...parsed.data });
      res.status(200).json(item);
      return;
    }
    if (action === 'position') {
      const parsed = PositionBody.safeParse(readJson(req));
      if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
      await moveItem(profileId, itemId, parsed.data.afterId);
      res.status(200).json({ ok: true });
      return;
    }
    throw new HttpError(404, 'Not found');
  },
});
