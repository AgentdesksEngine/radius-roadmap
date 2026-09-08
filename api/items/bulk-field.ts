import { z } from 'zod';
import { BULK_LIMIT, setFieldOnItems } from '../_lib/db/board.js';
import { HttpError, readJson, route } from '../_lib/http.js';
import { requireUser } from '../_lib/session.js';

const Body = z.object({
  itemIds: z.array(z.string().min(1)).min(1).max(BULK_LIMIT),
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

/** POST /api/items/bulk-field — one field value across a selection. Partial success is normal. */
export default route({
  POST: async (req, res) => {
    const { profileId } = await requireUser(req, res);
    const parsed = Body.safeParse(readJson(req));
    if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
    const result = await setFieldOnItems(profileId, parsed.data);
    res.status(200).json(result);
  },
});
