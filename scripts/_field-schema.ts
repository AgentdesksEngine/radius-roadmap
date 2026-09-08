/**
 * Seeds field_defs / field_options from fields.config.ts into Supabase. Shared by both one-off
 * migration scripts (migrate-github-to-supabase.ts, import-slack-to-supabase.ts) so the two
 * imports can never disagree on a field/option's id, color, or sort order.
 */
import { db } from '../api/_lib/db/pool';
import { fields as fieldSpecs } from '../fields.config';

export interface FieldMaps {
  fieldIdByName: Map<string, string>;
  optionIdByKey: Map<string, string>; // `${fieldName.toLowerCase()}|${optionName.toLowerCase()}`
  statusFieldId: string;
}

export async function seedFieldSchema(dryRun: boolean): Promise<FieldMaps> {
  const sql = db();
  const fieldIdByName = new Map<string, string>();
  const optionIdByKey = new Map<string, string>();

  await sql.begin(async (tx) => {
    for (const [sortOrder, spec] of fieldSpecs.entries()) {
      const dataType = spec.type;
      let fieldId: string;
      if (dryRun) {
        fieldId = `dry-run:${spec.name}`;
      } else {
        const [row] = await tx<{ id: string }[]>`
          insert into field_defs (name, data_type, sort_order)
          values (${spec.name}, ${dataType}, ${sortOrder})
          on conflict (name) do update set data_type = excluded.data_type, sort_order = excluded.sort_order
          returning id
        `;
        fieldId = row!.id;
      }
      fieldIdByName.set(spec.name, fieldId);

      if ('options' in spec) {
        for (const [optSortOrder, opt] of spec.options.entries()) {
          const closesAs =
            spec.name.toLowerCase() === 'status'
              ? (['done'].includes(opt.name.toLowerCase())
                  ? 'COMPLETED'
                  : ['canceled', 'cancelled'].includes(opt.name.toLowerCase())
                    ? 'NOT_PLANNED'
                    : null)
              : null;
          let optionId: string;
          if (dryRun) {
            optionId = `dry-run:${spec.name}:${opt.name}`;
          } else {
            const [row] = await tx<{ id: string }[]>`
              insert into field_options (field_def_id, name, color, description, sort_order, closes_as)
              values (${fieldId}, ${opt.name}, ${opt.color}, ${opt.description ?? ''}, ${optSortOrder}, ${closesAs})
              on conflict (field_def_id, name) do update set
                color = excluded.color, description = excluded.description,
                sort_order = excluded.sort_order, closes_as = excluded.closes_as
              returning id
            `;
            optionId = row!.id;
          }
          optionIdByKey.set(`${spec.name.toLowerCase()}|${opt.name.toLowerCase()}`, optionId);
        }
      }
    }
  });

  const statusFieldId = fieldIdByName.get('Status');
  if (!statusFieldId) throw new Error('fields.config.ts has no Status field');
  return { fieldIdByName, optionIdByKey, statusFieldId };
}
