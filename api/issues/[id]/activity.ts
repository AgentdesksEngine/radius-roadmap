import { getActivity } from '../../_lib/db/board';
import { noStore, param, route } from '../../_lib/http';
import { requireUser } from '../../_lib/session';

/** GET /api/issues/:id/activity — comments and timeline events in one chronological feed. */
export default route({
  GET: async (req, res) => {
    await requireUser(req, res);
    const events = await getActivity(param(req, 'id'));
    noStore(res);
    res.status(200).json(events);
  },
});
