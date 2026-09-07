import { z } from 'zod';
import { HttpError, param, readJson, route } from '../../_lib/http';
import { requireToken } from '../../_lib/session';
import { GitHubClient } from '../../_lib/github/gql';
import { setItemFieldAndSync } from '../../_lib/github/board';
import { cacheItems } from '../../_lib/board-cache';

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
    const { accessToken } = await requireToken(req, res);
    const itemId = param(req, 'itemId');
    const parsed = Body.safeParse(readJson(req));
    if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
    const item = await setItemFieldAndSync(new GitHubClient(accessToken), { itemId, ...parsed.data });
    cacheItems([item]);
    res.status(200).json(item);
  },
});
