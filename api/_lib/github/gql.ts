import { HttpError } from '../http';

const GRAPHQL_URL = 'https://api.github.com/graphql';
const REST_URL = 'https://api.github.com';

export interface GraphQLErrorItem {
  message: string;
  type?: string;
  path?: (string | number)[];
}

export class GitHubGraphQLError extends Error {
  constructor(
    public errors: GraphQLErrorItem[],
    public query: string,
  ) {
    super(errors.map((e) => e.message).join('; '));
  }
}

/** Minimal GitHub client bound to one token. Server-side only. */
export class GitHubClient {
  constructor(private readonly token: string) {}

  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'radius-bugtracker',
        // Required for issue types / sub-issues fields on some schemas.
        'GraphQL-Features': 'issue_types,sub_issues',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (res.status === 401) throw new HttpError(401, 'GitHub rejected the token');
    if (res.status === 403 || res.status === 429) {
      const reset = res.headers.get('x-ratelimit-reset');
      throw new HttpError(429, 'GitHub rate limit reached', { resetAt: reset ? Number(reset) * 1000 : null });
    }
    if (!res.ok) throw new HttpError(502, `GitHub GraphQL HTTP ${res.status}`, await res.text());

    const json = (await res.json()) as { data?: T; errors?: GraphQLErrorItem[] };
    if (json.errors?.length) {
      const notFound = json.errors.every((e) => e.type === 'NOT_FOUND');
      if (notFound) throw new HttpError(404, json.errors.map((e) => e.message).join('; '));
      const forbidden = json.errors.some((e) => e.type === 'FORBIDDEN' || e.type === 'INSUFFICIENT_SCOPES');
      if (forbidden) throw new HttpError(403, json.errors.map((e) => e.message).join('; '));
      throw new GitHubGraphQLError(json.errors, query);
    }
    if (!json.data) throw new HttpError(502, 'Empty GraphQL response');
    return json.data;
  }

  async rest<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    const res = await fetch(`${REST_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'radius-bugtracker',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = (text ? JSON.parse(text) : null) as T;
    return { status: res.status, data };
  }
}
