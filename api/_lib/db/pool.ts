import postgres, { type TransactionSql } from 'postgres';
import { requireSupabaseEnv } from '../env';

let sql: ReturnType<typeof postgres> | undefined;

/** Pooled connection to the Supabase Postgres instance (transaction-mode pooler, port 6543). */
export function db() {
  if (!sql) {
    sql = postgres(requireSupabaseEnv().DATABASE_URL, { prepare: false });
  }
  return sql;
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
