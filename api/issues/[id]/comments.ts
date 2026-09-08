import { z } from 'zod';
import { addComment, getComments } from '../../_lib/db/board';
import { HttpError, noStore, param, readJson, route } from '../../_lib/http';
import { requireUser } from '../../_lib/session';

const Body = z.object({ body: z.string().trim().min(1).max(60_000) });

export default route({
  GET: async (req, res) => {
    await requireUser(req, res);
    const comments = await getComments(param(req, 'id'));
    noStore(res);
    res.status(200).json(comments);
  },
  POST: async (req, res) => {
    const { profileId } = await requireUser(req, res);
    const parsed = Body.safeParse(readJson(req));
    if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
    const comment = await addComment(profileId, param(req, 'id'), parsed.data.body);
    res.status(201).json(comment);
  },
});
