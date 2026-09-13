import { getBoard, getSchema } from '../_lib/db/board.js';
import { HttpError, noStore, param, route } from '../_lib/http.js';
import { sweepNotifications } from '../_lib/notify.js';
import { requireUser } from '../_lib/session.js';

/**
 * /api/project/items and /api/project/schema in one function — a single dynamic :action
 * segment rather than two files, to stay under the Hobby plan's per-deployment function cap.
 */
export default route({
  GET: async (req, res) => {
    const { profileId } = await requireUser(req, res);
    const action = param(req, 'action');

    if (action === 'items') {
      // The board. Reads go straight to Postgres — no server-side cache layer, unlike the
      // old GitHub-backed version. `?refresh=1` is accepted for URL compatibility but
      // there is nothing to force-refresh.
      const board = await getBoard(profileId);
      noStore(res);
      res.status(200).json(board);
      // Coalesced Slack DMs come due ~2 minutes after the event that opened the batch, which
      // outlives the invocation that enqueued them. The board is the most-hit endpoint in the
      // app, so it doubles as the outbox drain. Throttled, backgrounded, never awaited.
      sweepNotifications();
      return;
    }
    if (action === 'schema') {
      const schema = await getSchema({ force: req.query.refresh === '1' });
      noStore(res);
      res.status(200).json(schema);
      return;
    }
    throw new HttpError(404, 'Not found');
  },
});
