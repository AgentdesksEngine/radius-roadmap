import { z } from 'zod';
import { HttpError, readJson, route } from '../_lib/http';
import { requireToken } from '../_lib/session';
import { GitHubClient } from '../_lib/github/gql';
import { BULK_LIMIT, setFieldOnItems } from '../_lib/github/board';
import { cacheItems } from '../_lib/board-cache';

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
    const { accessToken } = await requireToken(req, res);
    const parsed = Body.safeParse(readJson(req));
    if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
    const result = await setFieldOnItems(new GitHubClient(accessToken), parsed.data);
    cacheItems(result.items);
    res.status(200).json(result);
  },
});
