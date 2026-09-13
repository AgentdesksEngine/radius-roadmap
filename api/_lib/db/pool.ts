import postgres, { type TransactionSql } from 'postgres';
import { requireSupabaseEnv } from '../env.js';

let sql: ReturnType<typeof postgres> | undefined;

/** Pooled connection to the Supabase Postgres instance (transaction-mode pooler, port 6543). */
export function db() {
  if (!sql) {
    sql = postgres(requireSupabaseEnv().DATABASE_URL, { prepare: false });
  }
  return sql;
}

/**
 * postgres.js types `sql.json()` with its own recursive JSONValue, which a plain
 * `Record<string, unknown>` does not structurally satisfy even though it is perfectly valid
 * JSON. Every call site means the same thing, so the cast lives here once.
 *
 * Always write `${tx.json(asJson(x))}::jsonb`, never `${JSON.stringify(x)}::jsonb`: postgres.js
 * JSON-encodes whatever the ::jsonb cast receives, so passing a string encodes it twice and
 * silently stores a jsonb *string* where an object was meant. Readers then find nothing.
 */
export function asJson(value: unknown): Parameters<TransactionSql['json']>[0] {
  return value as Parameters<TransactionSql['json']>[0];
}

/**
 * Runs `fn` inside a transaction with `app.current_profile_id` set for the duration, so
 * activity-log triggers (see supabase/migrations/0001_init.sql) can attribute the change
 * to the acting user. Pass `null` for system/migration writes that have no acting user.
 */
export function withActor<T>(profileId: string | null, fn: (tx: TransactionSql) => Promise<T>) {
  return db().begin(async (tx) => {
    await tx`select set_config('app.current_profile_id', ${profileId ?? ''}, true)`;
    return fn(tx);
  });
}
