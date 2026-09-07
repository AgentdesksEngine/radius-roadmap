import { noStore, route } from '../_lib/http';
import { requireToken } from '../_lib/session';
import { readClient } from '../_lib/github/app';
import { getSchema } from '../_lib/github/board';

export default route({
  GET: async (req, res) => {
    const { accessToken } = await requireToken(req, res);
    const schema = await getSchema(await readClient(accessToken), { force: req.query.refresh === '1' });
    noStore(res);
    res.status(200).json(schema);
  },
});
