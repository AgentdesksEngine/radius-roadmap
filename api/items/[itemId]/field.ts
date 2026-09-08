import { z } from 'zod';
import { setItemFieldAndSync } from '../../_lib/db/board';
import { HttpError, param, readJson, route } from '../../_lib/http';
import { requireUser } from '../../_lib/session';

const Body = z.object({
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

export default route({
  POST: async (req, res) => {
    const { profileId } = await requireUser(req, res);
    const itemId = param(req, 'itemId');
    const parsed = Body.safeParse(readJson(req));
    if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
    const item = await setItemFieldAndSync(profileId, { itemId, ...parsed.data });
    res.status(200).json(item);
  },
});
