/**
 * Local stand-in for Vercel's serverless runtime.
 * Maps http://localhost:3001/api/<path> to ./api/<path>.ts (supporting [param] segments and
 * index.ts) and calls the default export with Vercel-like req/res helpers.
 * Vite proxies /api to this server (see vite.config.ts), so the SPA and API share an origin.
 */
import http from 'node:http';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadDotenv } from './_lib';

loadDotenv();
process.env.VERCEL_ENV ??= 'development';

const API_DIR = path.resolve('api');
const PORT = Number(process.env.API_PORT ?? 3001);

interface Route {
  pattern: string[]; // e.g. ['issues', '[number]', 'comments']
  file: string;
}

function collectRoutes(dir = API_DIR, prefix: string[] = []): Route[] {
  const out: Route[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('_')) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectRoutes(full, [...prefix, entry]));
    } else if (/\.(ts|js)$/.test(entry) && !/\.test\./.test(entry)) {
      const name = entry.replace(/\.(ts|js)$/, '');
      out.push({ pattern: name === 'index' ? prefix : [...prefix, name], file: full });
    }
  }
  // Static segments win over dynamic ones.
  return out.sort((a, b) => a.pattern.filter((s) => s.startsWith('[')).length - b.pattern.filter((s) => s.startsWith('[')).length);
}

function match(route: Route, segments: string[]): Record<string, string> | null {
  if (route.pattern.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i++) {
    const p = route.pattern[i]!;
    const s = segments[i]!;
    if (p.startsWith('[') && p.endsWith(']')) params[p.slice(1, -1)] = decodeURIComponent(s);
    else if (p !== s) return null;
  }
  return params;
}

function parseCookies(header: string | undefined) {
  const out: Record<string, string> = {};
  for (const part of header?.split(';') ?? []) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return undefined;
  const text = Buffer.concat(chunks).toString('utf8');
  const type = req.headers['content-type'] ?? '';
  if (type.includes('application/json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

const routes = collectRoutes();
console.log(`[dev-api] ${routes.length} routes:`);
for (const r of routes) console.log(`  /api/${r.pattern.join('/')}`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const segments = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);

  let params: Record<string, string> | null = null;
  let route: Route | undefined;
  for (const r of routes) {
    params = match(r, segments);
    if (params) {
      route = r;
      break;
    }
  }
  if (!route || !params) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `No API route for ${url.pathname}` }));
    return;
  }

  // Vercel-style request decorations
  const vreq = req as http.IncomingMessage & { query: Record<string, string | string[]>; cookies: Record<string, string>; body: unknown };
  vreq.query = { ...Object.fromEntries(url.searchParams), ...params };
  vreq.cookies = parseCookies(req.headers.cookie);
  vreq.body = await readBody(req);

  // Vercel-style response helpers
  const vres = res as http.ServerResponse & {
    status: (code: number) => typeof vres;
    json: (body: unknown) => void;
    send: (body: unknown) => void;
    redirect: (statusOrUrl: number | string, url?: string) => void;
  };
  vres.status = (code) => {
    res.statusCode = code;
    return vres;
  };
  vres.json = (body) => {
    if (!res.hasHeader('content-type')) res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };
  vres.send = (body) => {
    if (typeof body === 'object' && body !== null && !Buffer.isBuffer(body)) vres.json(body);
    else res.end(body as string);
  };
  vres.redirect = (statusOrUrl, maybeUrl) => {
    const status = typeof statusOrUrl === 'number' ? statusOrUrl : 307;
    const target = typeof statusOrUrl === 'number' ? maybeUrl! : statusOrUrl;
    res.statusCode = status;
    res.setHeader('Location', target);
    res.end();
  };

  const started = Date.now();
  try {
    const mod = await import(pathToFileURL(route.file).href);
    await mod.default(vreq, vres);
  } catch (err) {
    console.error(`[dev-api] ${req.method} ${url.pathname} crashed:`, err);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'crash' }));
    }
  } finally {
    console.log(`[dev-api] ${req.method} ${url.pathname} -> ${res.statusCode} (${Date.now() - started}ms)`);
  }
});

server.listen(PORT, () => console.log(`[dev-api] listening on http://localhost:${PORT}`));
