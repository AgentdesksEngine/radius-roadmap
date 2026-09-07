/** Prints the live field/option list of the project, with node ids. */
import { getSchema } from '../api/_lib/github/board';
import { scriptClient } from './_lib';

const schema = await getSchema(scriptClient(), { force: true });
console.log(`\n${schema.title}  (${schema.url})`);
console.log(`project id: ${schema.projectId}`);
console.log(`issues repo: ${schema.repository.nameWithOwner}  id: ${schema.repository.id}\n`);
for (const f of schema.fields) {
  console.log(`${f.name.padEnd(22)} ${f.dataType.padEnd(14)} ${f.id}`);
  for (const o of f.options ?? []) {
    console.log(`    ${o.name.padEnd(20)} ${o.color.padEnd(7)} ${o.id}${o.description ? `   ${o.description}` : ''}`);
  }
}
if (process.argv.includes('--json')) console.log(JSON.stringify(schema, null, 2));
