/**
 * Makes the live project's custom fields match fields.config.ts.
 *  - creates missing fields
 *  - adds missing options, renames options listed in `renameFrom` (keeping their ids),
 *    updates colors/descriptions, and puts options in config order
 *  - never deletes fields or options
 * Usage: pnpm schema:provision [--dry-run]
 */
import type { OptionColor } from '../shared/types';
import { SCHEMA_QUERY } from '../api/_lib/github/board';
import { env } from '../api/_lib/env';
import { fields as specs, type FieldSpec, type OptionSpec } from '../fields.config';
import { scriptClient, sleep } from './_lib';

const dryRun = process.argv.includes('--dry-run');
const gh = scriptClient();
const e = env();

interface LiveOption {
  id: string;
  name: string;
  color: OptionColor;
  description: string;
}
interface LiveField {
  __typename: string;
  id: string;
  name: string;
  dataType: string;
  options?: LiveOption[];
  multiSelectOptions?: LiveOption[];
}

async function loadLive() {
  const data = await gh.graphql<{
    organization: { projectV2: { id: string; fields: { nodes: LiveField[] } } | null } | null;
  }>(SCHEMA_QUERY, { org: e.GITHUB_ORG, number: e.GITHUB_PROJECT_NUMBER, repo: e.GITHUB_ISSUES_REPO });
  const p = data.organization?.projectV2;
  if (!p) throw new Error('Project not found');
  return p;
}

function mergeOptions(live: LiveOption[], spec: OptionSpec[]): { next: LiveOption[]; changed: string[] } {
  const changed: string[] = [];
  const byName = new Map(live.map((o) => [o.name.toLowerCase(), { ...o }]));
  const claimed = new Set<string>();
  const next: LiveOption[] = [];

  for (const s of spec) {
    let match = byName.get(s.name.toLowerCase());
    if (!match) {
      for (const from of s.renameFrom ?? []) {
        const m = byName.get(from.toLowerCase());
        if (m) {
          match = m;
          changed.push(`rename "${m.name}" -> "${s.name}"`);
          m.name = s.name;
          break;
        }
      }
    }
    if (match) {
      if (match.name !== s.name) {
        changed.push(`rename "${match.name}" -> "${s.name}"`);
        match.name = s.name;
      }
      if (match.color !== s.color) {
        changed.push(`color ${s.name}: ${match.color} -> ${s.color}`);
        match.color = s.color;
      }
      const desc = s.description ?? match.description ?? '';
      if (match.description !== desc) {
        changed.push(`description ${s.name}`);
        match.description = desc;
      }
      claimed.add(match.id);
      next.push(match);
    } else {
      changed.push(`add "${s.name}"`);
      next.push({ id: '', name: s.name, color: s.color, description: s.description ?? '' });
    }
  }
  // Keep any live options not mentioned in the spec (never delete).
  for (const o of live) if (!claimed.has(o.id)) next.push({ ...o });

  const orderChanged = next.filter((o) => o.id).map((o) => o.id).join(',') !== live.map((o) => o.id).join(',');
  if (orderChanged && !changed.length) changed.push('reorder');
  return { next, changed };
}

const toInput = (o: LiveOption) => ({ ...(o.id ? { id: o.id } : {}), name: o.name, color: o.color, description: o.description });

const project = await loadLive();
console.log(`${dryRun ? '[dry run] ' : ''}Provisioning ${e.GITHUB_ORG}#${e.GITHUB_PROJECT_NUMBER} (${project.id})\n`);

let failures = 0;
for (const spec of specs) {
  try {
    await provision(spec);
  } catch (err) {
    failures++;
    console.error(`x ${spec.name}: ${err instanceof Error ? err.message : err}`);
  }
}

async function provision(spec: FieldSpec) {
  const live = project.fields.nodes.find((f) => f.name.toLowerCase() === spec.name.toLowerCase());

  if (!live) {
    const opts = 'options' in spec ? spec.options.map((o) => ({ name: o.name, color: o.color, description: o.description ?? '' })) : undefined;
    console.log(`+ create ${spec.type.padEnd(13)} ${spec.name}${opts ? `  [${opts.map((o) => o.name).join(', ')}]` : ''}`);
    if (dryRun) return;
    await gh.graphql(
      `mutation($projectId: ID!, $name: String!, $dataType: ProjectV2CustomFieldType!,
                $single: [ProjectV2SingleSelectFieldOptionInput!], $multi: [ProjectV2MultiSelectFieldOptionInput!]) {
         createProjectV2Field(input: { projectId: $projectId, name: $name, dataType: $dataType,
                                       singleSelectOptions: $single, multiSelectOptions: $multi }) {
           projectV2Field { ... on ProjectV2FieldCommon { id name } }
         }
       }`,
      {
        projectId: project.id,
        name: spec.name,
        dataType: spec.type,
        single: spec.type === 'SINGLE_SELECT' ? opts : null,
        multi: spec.type === 'MULTI_SELECT' ? opts : null,
      },
    );
    await sleep(500);
    return;
  }

  if (live.dataType !== spec.type) {
    console.log(`! ${spec.name}: live type ${live.dataType} != ${spec.type}; leaving as is`);
    return;
  }
  if (!('options' in spec)) {
    console.log(`= ${spec.name} ok`);
    return;
  }

  const liveOpts = (spec.type === 'MULTI_SELECT' ? live.multiSelectOptions : live.options) ?? [];
  const { next, changed } = mergeOptions(liveOpts, spec.options);
  if (!changed.length) {
    console.log(`= ${spec.name} ok`);
    return;
  }
  console.log(`~ update ${spec.name}: ${changed.join('; ')}`);
  if (dryRun) return;
  const key = spec.type === 'MULTI_SELECT' ? 'multiSelectOptions' : 'singleSelectOptions';
  const inputType = spec.type === 'MULTI_SELECT' ? 'ProjectV2MultiSelectFieldOptionInput' : 'ProjectV2SingleSelectFieldOptionInput';
  await gh.graphql(
    `mutation($fieldId: ID!, $options: [${inputType}!]) {
       updateProjectV2Field(input: { fieldId: $fieldId, ${key}: $options }) {
         projectV2Field { ... on ProjectV2FieldCommon { id name } }
       }
     }`,
    { fieldId: live.id, options: next.map(toInput) },
  );
  await sleep(500);
}

console.log(dryRun ? '\nDry run complete.' : `\nDone${failures ? ` with ${failures} failure(s)` : ''}. Run \`pnpm schema:dump\` to see the result.`);
if (failures) process.exit(1);
