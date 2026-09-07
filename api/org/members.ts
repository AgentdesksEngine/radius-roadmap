import { route } from '../_lib/http';
import { requireToken } from '../_lib/session';
import { GitHubClient } from '../_lib/github/gql';
import { getMembers } from '../_lib/github/board';

export default route({
  GET: async (req, res) => {
    const { accessToken } = await requireToken(req, res);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.status(200).json(await getMembers(new GitHubClient(accessToken)));
  },
});
