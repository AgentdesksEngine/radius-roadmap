import type { VercelRequest, VercelResponse } from '@vercel/node';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void> | void;

/**
 * Wraps per-method handlers with method dispatch and uniform error handling.
 * Usage: export default route({ GET: async (req, res) => {...}, POST: ... })
 */
export function route(handlers: Partial<Record<'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', Handler>>): Handler {
  return async (req, res) => {
    const method = (req.method ?? 'GET').toUpperCase() as keyof typeof handlers;
    const handler = handlers[method];
    if (!handler) {
      res.setHeader('Allow', Object.keys(handlers).join(', '));
      res.status(405).json({ error: `Method ${method} not allowed` });
      return;
    }
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message, details: err.details });
        return;
      }
      console.error(`[api] ${req.method} ${req.url} failed:`, err);
      const message = err instanceof Error ? err.message : 'Unexpected error';
      res.status(500).json({ error: message });
    }
  };
}

export function readJson<T>(req: VercelRequest): T {
  const body = req.body;
  if (body == null || body === '') throw new HttpError(400, 'Request body required');
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new HttpError(400, 'Body is not valid JSON');
    }
  }
  return body as T;
}

export function param(req: VercelRequest, name: string): string {
  const v = req.query[name];
  const s = Array.isArray(v) ? v[0] : v;
  if (!s) throw new HttpError(400, `Missing route parameter: ${name}`);
  return s;
}

export function noStore(res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
}
