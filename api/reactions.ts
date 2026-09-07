import { z } from 'zod';
import { HttpError, readJson, route } from './_lib/http';
import { requireToken } from './_lib/session';
import { GitHubClient } from './_lib/github/gql';
import { setReaction } from './_lib/github/board';
import { invalidateBoard } from './_lib/board-cache';

const Body = z.object({
  /** Issue or comment node id — GitHub takes both on the same mutation. */
  subjectId: z.string().min(1),
  content: z.enum([
    'THUMBS_UP',
    'THUMBS_DOWN',
    'LAUGH',
    'HOORAY',
    'CONFUSED',
    'HEART',
    'ROCKET',
    'EYES',
  ]),
  on: z.boolean(),
});

export default route({
  POST: async (req, res) => {
    const { accessToken } = await requireToken(req, res);
    const parsed = Body.safeParse(readJson(req));
    if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
    const reactions = await setReaction(new GitHubClient(accessToken), parsed.data);
    invalidateBoard();
    res.status(200).json(reactions);
  },
});
