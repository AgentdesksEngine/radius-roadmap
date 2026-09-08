import { route } from '../_lib/http.js';
import { requireToken } from '../_lib/session.js';
import { GitHubClient } from '../_lib/github/gql.js';
import { getMembers } from '../_lib/github/board.js';

export default route({
  GET: async (req, res) => {
    const { accessToken } = await requireToken(req, res);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.status(200).json(await getMembers(new GitHubClient(accessToken)));
  },
});
