/**
 * One-off: make Team multi-valued and populate it from assignees.
 *
 *   pnpm tsx scripts/backfill-teams.ts --dry-run
 *   pnpm tsx scripts/backfill-teams.ts
 *
 * Three steps, in one transaction:
 *   1. field_defs.Team -> MULTI_SELECT (matches fields.config.ts).
 *   2. Existing single-valued { optionId } values -> { optionIds: [...] }.
 *   3. Union in the teams of each issue's assignees, per `emailToTeam`.
 *
 * Runs with session_replication_role = replica: this is a backfill of historical rows, so the
 * activity-log triggers in 0001_init.sql should not narrate it as 979 live edits.
 */
import { db } from '../api/_lib/db/pool';
import { emailToTeam } from '../import.config';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const sql = db();
  const [teamField] = await sql<{ id: string; data_type: string }[]>`
    select id, data_type from field_defs where name = 'Team'`;
  if (!teamField) throw new Error('No Team field');

  const options = await sql<{ id: string; name: string }[]>`
    select id, name from field_options where field_def_id = ${teamField.id}`;
  const optionIdByName = new Map(options.map((o) => [o.name, o.id]));
  for (const name of new Set(Object.values(emailToTeam)))
    if (!optionIdByName.has(name)) throw new Error(`Team option "${name}" does not exist`);

  // issue -> team option ids, unioned from its assignees.
  const rows = await sql<{ id: string; fields: Record<string, unknown>; emails: string[] }[]>`
    select i.id, i.fields, coalesce(array_agg(p.email) filter (where p.email is not null), '{}') emails
    from issues i
    left join issue_assignees a on a.issue_id = i.id
    left join profiles p on p.id = a.profile_id
    group by i.id, i.fields`;

  const updates: { id: string; optionIds: string[] }[] = [];
  let fromAssignees = 0;
  let converted = 0;
  for (const r of rows) {
    const existing = r.fields[teamField.id] as
      { optionId?: string; optionIds?: string[] } | undefined;
    const before = existing?.optionIds ?? (existing?.optionId ? [existing.optionId] : []);
    const derived = r.emails
      .map((e) => emailToTeam[e.toLowerCase()])
      .filter((t): t is string => Boolean(t))
      .map((t) => optionIdByName.get(t)!);
    const next = [...new Set([...before, ...derived])];
    // Keep option order stable so the UI lists teams the same way everywhere.
    next.sort(
      (a, b) => options.findIndex((o) => o.id === a) - options.findIndex((o) => o.id === b),
    );
    if (
      next.length === before.length &&
      next.every((id, i) => id === before[i]) &&
      existing?.optionIds
    )
      continue;
    if (!next.length) continue;
    if (existing?.optionId) converted++;
    if (derived.length && !before.length) fromAssignees++;
    updates.push({ id: r.id, optionIds: next });
  }

  console.log(`Team field is ${teamField.data_type} -> MULTI_SELECT`);
  console.log(`${rows.length} issues scanned`);
  console.log(
    `  ${updates.length} to write (${converted} converted from single, ${fromAssignees} newly tagged from assignees)`,
  );
  const tally = new Map<number, number>();
  for (const u of updates) tally.set(u.optionIds.length, (tally.get(u.optionIds.length) ?? 0) + 1);
  for (const [n, c] of [...tally.entries()].sort())
    console.log(`  ${c} issues with ${n} team${n === 1 ? '' : 's'}`);

  if (dryRun) {
    console.log('\n[dry run] nothing written');
    await sql.end();
    return;
  }

  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    await tx`update field_defs set data_type = 'MULTI_SELECT' where id = ${teamField.id}`;
    for (const u of updates) {
      await tx`update issues set fields = jsonb_set(fields, array[${teamField.id}], ${tx.json({ optionIds: u.optionIds })}::jsonb) where id = ${u.id}`;
    }
  });
  console.log(`\nWrote ${updates.length} issues.`);
  await sql.end();
}

main();
