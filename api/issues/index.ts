import { z } from 'zod';
import { HttpError, readJson, route } from '../_lib/http';
import { requireToken } from '../_lib/session';
import { GitHubClient } from '../_lib/github/gql';
import { createIssue } from '../_lib/github/board';
import { cacheItems } from '../_lib/board-cache';

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
  assigneeLogins: z.array(z.string()).optional(),
  labelNames: z.array(z.string()).optional(),
});

export default route({
  POST: async (req, res) => {
    const { accessToken } = await requireToken(req, res);
    const parsed = Body.safeParse(readJson(req));
    if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
    const item = await createIssue(new GitHubClient(accessToken), parsed.data);
    cacheItems([item]);
    res.status(201).json(item);
  },
});
