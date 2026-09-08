import { z } from 'zod';
import { setReaction } from './_lib/db/board';
import { HttpError, readJson, route } from './_lib/http';
import { requireUser } from './_lib/session';

const Body = z.object({
  /** Issue or comment id — resolved to a subject_type server-side. */
  subjectId: z.string().min(1),
  content: z.enum(['THUMBS_UP', 'THUMBS_DOWN', 'LAUGH', 'HOORAY', 'CONFUSED', 'HEART', 'ROCKET', 'EYES']),
  on: z.boolean(),
});

export default route({
  POST: async (req, res) => {
    const { profileId } = await requireUser(req, res);
    const parsed = Body.safeParse(readJson(req));
    if (!parsed.success) throw new HttpError(400, 'Invalid body', parsed.error.issues);
    const reactions = await setReaction(profileId, parsed.data);
    res.status(200).json(reactions);
  },
});
