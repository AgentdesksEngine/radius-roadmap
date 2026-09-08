import { getSchema } from '../_lib/db/board';
import { noStore, route } from '../_lib/http';
import { requireUser } from '../_lib/session';

export default route({
  GET: async (req, res) => {
    await requireUser(req, res);
    const schema = await getSchema({ force: req.query.refresh === '1' });
    noStore(res);
    res.status(200).json(schema);
  },
});
