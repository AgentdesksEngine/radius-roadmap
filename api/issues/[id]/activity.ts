import { noStore, param, route } from '../../_lib/http';
import { requireToken } from '../../_lib/session';
import { GitHubClient } from '../../_lib/github/gql';
import { getActivity } from '../../_lib/github/board';

/** GET /api/issues/:id/activity — comments and timeline events in one chronological feed. */
export default route({
  GET: async (req, res) => {
    const { accessToken } = await requireToken(req, res);
    const events = await getActivity(new GitHubClient(accessToken), param(req, 'id'));
    noStore(res);
    res.status(200).json(events);
  },
});
