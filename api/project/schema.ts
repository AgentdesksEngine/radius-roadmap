import { noStore, route } from '../_lib/http';
import { requireToken } from '../_lib/session';
import { GitHubClient } from '../_lib/github/gql';
import { getSchema } from '../_lib/github/board';

export default route({
  GET: async (req, res) => {
    const { accessToken } = await requireToken(req, res);
    const schema = await getSchema(new GitHubClient(accessToken), { force: req.query.refresh === '1' });
    noStore(res);
    res.status(200).json(schema);
  },
});
