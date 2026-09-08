import { getMembers } from '../_lib/db/board.js';
import { route } from '../_lib/http.js';
import { requireUser } from '../_lib/session.js';

export default route({
  GET: async (req, res) => {
    await requireUser(req, res);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.status(200).json(await getMembers());
  },
});
