import { z } from 'zod';
import { createIssue } from '../_lib/db/board.js';
import { HttpError, readJson, route } from '../_lib/http.js';
import { requireUser } from '../_lib/session.js';

const Body = z.object({
  title: z.string().trim().min(1).max(256),
  body: z.string().max(60_000).optional(),
  fields: z
    .record(
      z.string(),
      z.union([
        z.object({ singleSelectOptionId: z.string() }),
        z.object({ multiSelectOptionIds: z.array(z.string()) }),
        z.object({ date: z.string() }),
        z.object({ text: z.string() }),
        z.object({ number: z.number() }),
        z.null(),
      ]),
    )
    .optional(),
  assigneeIds: z.array(z.string()).optional(),
  labelNames: z.array(z.string()).optional(),
});

export default route({
  POST: async (req, res) => {
    const { profileId } = await requireUser(req, res);
    const parsed = Body.safeParse(readJson(req));
    if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
    const item = await createIssue(profileId, parsed.data);
    res.status(201).json(item);
  },
});
