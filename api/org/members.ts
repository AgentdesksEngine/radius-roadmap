import { getMembers } from '../_lib/db/board';
import { route } from '../_lib/http';
import { requireUser } from '../_lib/session';

export default route({
  GET: async (req, res) => {
    await requireUser(req, res);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.status(200).json(await getMembers());
  },
});
