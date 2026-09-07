import { noStore, route } from '../_lib/http';
import { requireToken } from '../_lib/session';
import { GitHubClient } from '../_lib/github/gql';
import { getBoard } from '../_lib/github/board';

export default route({
  GET: async (req, res) => {
    const { accessToken } = await requireToken(req, res);
    const board = await getBoard(new GitHubClient(accessToken));
    noStore(res);
    res.status(200).json(board);
  },
});
