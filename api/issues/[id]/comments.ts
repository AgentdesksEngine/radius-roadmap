import { z } from 'zod';
import { HttpError, noStore, param, readJson, route } from '../../_lib/http';
import { requireToken } from '../../_lib/session';
import { GitHubClient } from '../../_lib/github/gql';
import { addComment, getComments } from '../../_lib/github/board';

const Body = z.object({ body: z.string().trim().min(1).max(60_000) });

export default route({
  GET: async (req, res) => {
    const { accessToken } = await requireToken(req, res);
    const comments = await getComments(new GitHubClient(accessToken), param(req, 'id'));
    noStore(res);
    res.status(200).json(comments);
  },
  POST: async (req, res) => {
    const { accessToken } = await requireToken(req, res);
    const parsed = Body.safeParse(readJson(req));
    if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
    const comment = await addComment(new GitHubClient(accessToken), param(req, 'id'), parsed.data.body);
    res.status(201).json(comment);
  },
});
