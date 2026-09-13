/**
 * Turning a Slack thread into an issue.
 *
 * Everything above `ingestSlackMessage` is pure and unit-tested (ingest.test.ts) — the messy
 * parts of this feature are all parsing, and parsing is the part worth pinning down: Slack's
 * wire format is not the text you see on screen (`<@U123>`, `<http://x|x>`, `&amp;`), and the
 * bug report is prose written by someone who was not thinking about a tracker.
 *
 * The rule for what becomes the issue: the THREAD PARENT is the bug report; replies are
 * context. Someone typing "@bugtracker add" as the 15th reply is pointing at the bug at the
 * top of the thread, not at their own message.
 *
 * Field inference is deliberately dumb — explicit hints the triager typed, plus a keyword map
 * for Module. It does not guess Priority from tone. Anything it cannot fill is left empty,
 * which lands the issue in the Intake view, which is exactly the queue a human should see.
 */
import type { ProjectSchema } from '../../../shared/types.js';
import { db, withActor } from '../db/pool.js';
import { getItem, getSchema } from '../db/board.js';
import type { BoardItem } from '../../../shared/types.js';
import type { SlackMessage, SlackUser } from './client.js';

// ---------- pure: Slack wire format ----------

/** Slack's message text is not display text. Convert the bits that matter to markdown. */
export function slackTextToMarkdown(
  text: string,
  userNames: Map<string, string> = new Map(),
): string {
  return (
    text
      // <http://url|label> and <http://url>
      .replace(
        /<(https?:\/\/[^|>]+)\|([^>]+)>/g,
        (_m, url: string, label: string) => `[${label}](${url})`,
      )
      .replace(/<(https?:\/\/[^|>]+)>/g, (_m, url: string) => url)
      // <mailto:a@b|a@b>
      .replace(/<mailto:([^|>]+)(?:\|[^>]*)?>/g, (_m, addr: string) => addr)
      // <@U123|name> / <@U123>
      .replace(
        /<@([UW][A-Z0-9]+)(?:\|([^>]+))?>/g,
        (_m, id: string, name?: string) => `@${name || userNames.get(id) || id}`,
      )
      // <!subteam^S123|@team> / <!subteam^S123>
      .replace(/<!subteam\^([A-Z0-9]+)(?:\|([^>]+))?>/g, (_m, id: string, name?: string) =>
        name ? String(name) : `@team-${id}`,
      )
      // <!here>, <!channel>, <!everyone>
      .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, (_m, kind: string) => `@${kind}`)
      // HTML entities, last so the replacements above see the original angle brackets.
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
  );
}

/**
 * Reads "@bugtracker add p1 cda ios" and returns just the hints ("p1 cda ios"), or null when
 * the mention is not an `add` command — someone saying "ask @bugtracker about this" should not
 * silently file a bug. A bare "@bugtracker add" is valid and yields an empty hint string.
 */
export function parseAddCommand(text: string, botUserId: string | undefined): string | null {
  const mention = botUserId ? new RegExp(`<@${botUserId}>`, 'g') : /<@[UW][A-Z0-9]+>/g;
  const rest = text.replace(mention, ' ').replace(/\s+/g, ' ').trim();
  const m = /^add\b(.*)$/is.exec(rest);
  return m ? m[1]!.trim() : null;
}

/** First meaningful line, cleaned of mentions and clipped to the column's 256-char limit. */
export function deriveTitle(markdown: string): string {
  const line = markdown
    .split('\n')
    // Strip quote/bullet marks, and numbered-list markers only when they look like one
    // ("1." / "2)") — a bare leading digit is part of the sentence ("2 factor auth is broken").
    .map((l) =>
      l
        .replace(/^[\s>*•\-–—]+/, '')
        .replace(/^\d+[.)]\s+/, '')
        .trim(),
    )
    .find((l) => l.replace(/@\S+/g, '').trim().length >= 3);
  const cleaned = (line ?? 'Bug reported in Slack')
    .replace(/@\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned.length > 250 ? `${cleaned.slice(0, 247)}…` : cleaned) || 'Bug reported in Slack';
}

// ---------- pure: field inference ----------

/** Shorthand a triager can type after "add". Keys are matched as whole words, case-insensitively. */
const PRIORITY_ALIASES: Record<string, string> = {
  p0: 'Urgent',
  urgent: 'Urgent',
  critical: 'Urgent',
  blocker: 'Urgent',
  p1: 'High',
  high: 'High',
  p2: 'Medium',
  medium: 'Medium',
  p3: 'Low',
  low: 'Low',
};

const WORK_TYPE_ALIASES: Record<string, string> = {
  bug: 'Bug',
  feature: 'Feature request',
  fr: 'Feature request',
  task: 'Task',
  ux: 'UX improvement',
  design: 'Design',
};

const PLATFORM_ALIASES: Record<string, string> = { ios: 'iOS', android: 'Android', web: 'Web' };

/**
 * Keyword → Module, derived from how bugs are actually described in #product-critical-bugs
 * ("RLA document splitter", "cap tracker", "commission breakdown", "sub manager"). First match
 * in this list wins, so the more specific phrases are listed first.
 */
const MODULE_KEYWORDS: [RegExp, string][] = [
  [/\bcda\b|commission breakdown|gross commission|rerm/i, 'CDA'],
  [/auditing dash|audit\.radiusagent|transaction-queue/i, 'Auditing dashboard'],
  [/subscription|stripe|billing|e&o|charge/i, 'Subscriptions'],
  [/\brla\b|document splitter|docusign|envelope|signing/i, 'Documentation'],
  [/\bmls\b|listing search|offer writing/i, 'MLS feed'],
  [/\bfub\b|follow up boss|\blead\b|\bcrm\b|client portal/i, 'CRM'],
  [/cap tracker|\bcap\b|report|dashboard metric/i, 'Reporting'],
  [/transaction|coversheet|escrow|closing/i, 'Transaction management'],
  [/collaborator|permission|role|access|login|sign ?in|onboarding flow/i, 'Settings'],
  [/import|csv upload/i, 'Client imports'],
  [/\bpod\b|automation|campaign|drip/i, 'Pods and automation'],
  [/\bai\b|copilot|assistant|prompt/i, 'AI'],
  [/\bcall\b|dialer|phone number|voicemail/i, 'Call'],
  [/\bnote\b|notes tab/i, 'Notes'],
];

export interface DraftFields {
  /** field name -> option name */
  select: Record<string, string>;
  /** field name -> option names */
  multiSelect: Record<string, string[]>;
  /** field name -> raw text */
  text: Record<string, string>;
}

function optionExists(schema: ProjectSchema, fieldName: string, optionName: string): boolean {
  const f = schema.fields.find((x) => x.name.toLowerCase() === fieldName.toLowerCase());
  return Boolean(f?.options?.some((o) => o.name.toLowerCase() === optionName.toLowerCase()));
}

/**
 * Explicit hints the triager typed after the command, e.g. "@bugtracker add p1 cda ios".
 * Only whole-word matches count, so a hint can never be picked up out of quoted bug prose.
 */
export function parseHints(hintText: string, schema: ProjectSchema): DraftFields {
  const out: DraftFields = { select: {}, multiSelect: {}, text: {} };
  // Two passes: `tokens` keeps adjacent pairs so multi-word option names ("client imports",
  // "auditing dashboard") can match; `words` is the single-word view everything else uses.
  const tokens: string[] = hintText.toLowerCase().match(/[a-z0-9&+]+(?:[ -][a-z0-9&+]+)?/g) ?? [];
  const words: string[] = hintText.toLowerCase().match(/[a-z0-9&+]+/g) ?? [];
  const platforms: string[] = [];

  for (const w of words) {
    const priority = PRIORITY_ALIASES[w];
    if (priority && !out.select.Priority && optionExists(schema, 'Priority', priority))
      out.select.Priority = priority;

    const workType = WORK_TYPE_ALIASES[w];
    if (workType && !out.select['Work type'] && optionExists(schema, 'Work type', workType))
      out.select['Work type'] = workType;

    const platform = PLATFORM_ALIASES[w];
    if (platform && optionExists(schema, 'Platform', platform) && !platforms.includes(platform))
      platforms.push(platform);

    if (!out.select.Team && optionExists(schema, 'Team', w)) {
      const team = schema.fields
        .find((f) => f.name === 'Team')
        ?.options?.find((o) => o.name.toLowerCase() === w);
      if (team) out.select.Team = team.name;
    }
  }

  // "sev:high" — explicit, because a bare "high" already means Priority.
  const sev = /\bsev(?:erity)?[:=]\s*(high|medium|low)\b/i.exec(hintText);
  if (sev) {
    const name = sev[1]![0]!.toUpperCase() + sev[1]!.slice(1).toLowerCase();
    if (optionExists(schema, 'Severity', name)) out.select.Severity = name;
  }

  // Module by exact option name, including the multi-word ones ("client imports").
  const moduleField = schema.fields.find((f) => f.name === 'Module');
  for (const o of moduleField?.options ?? []) {
    if (tokens.includes(o.name.toLowerCase()) || words.includes(o.name.toLowerCase())) {
      out.select.Module = o.name;
      break;
    }
  }

  if (platforms.length) out.multiSelect.Platform = platforms;
  return out;
}

/** Last-resort Module guess from the bug text itself. Never overrides an explicit hint. */
export function inferModule(bodyText: string, schema: ProjectSchema): string | undefined {
  for (const [re, name] of MODULE_KEYWORDS) {
    if (re.test(bodyText) && optionExists(schema, 'Module', name)) return name;
  }
  return undefined;
}

// ---------- pure: the draft ----------

export interface DraftInput {
  parent: SlackMessage;
  replies: SlackMessage[];
  hintText: string;
  permalink?: string;
  reporterName?: string;
  userNames?: Map<string, string>;
  schema: ProjectSchema;
}

export interface IssueDraft {
  title: string;
  body: string;
  fields: DraftFields;
}

export function buildIssueDraft(input: DraftInput): IssueDraft {
  const {
    parent,
    replies,
    hintText,
    permalink,
    reporterName,
    userNames = new Map(),
    schema,
  } = input;

  const parentText = slackTextToMarkdown(parent.text ?? '', userNames);
  const title = deriveTitle(parentText);

  const body: string[] = [];
  if (parentText) body.push(parentText, '');

  const files = parent.files ?? [];
  if (files.length) {
    body.push('**Attachments**');
    for (const f of files)
      body.push(
        `- ${f.permalink ? `[${f.name ?? f.id}](${f.permalink})` : (f.name ?? f.id)}${f.mimetype ? ` · ${f.mimetype}` : ''}`,
      );
    body.push('');
  }

  // Replies are context, not the report. Quote them compactly and skip the bot's own noise.
  const context = replies.filter((m) => m.ts !== parent.ts && !m.bot_id && (m.text ?? '').trim());
  if (context.length) {
    body.push(`**Thread (${context.length} ${context.length === 1 ? 'reply' : 'replies'})**`);
    for (const m of context.slice(0, 30)) {
      const who = m.user ? (userNames.get(m.user) ?? m.user) : 'someone';
      const line = slackTextToMarkdown(m.text ?? '', userNames)
        .replace(/\n+/g, ' ')
        .trim();
      body.push(`- **${who}**: ${line.length > 400 ? `${line.slice(0, 397)}…` : line}`);
    }
    if (context.length > 30) body.push(`- …and ${context.length - 30} more in Slack.`);
    body.push('');
  }

  const meta: string[] = ['Captured from Slack by the bugtracker app.'];
  if (reporterName) meta.push(`Reported by ${reporterName}.`);
  if (permalink) meta.push(`[Open the Slack thread](${permalink})`);
  body.push('---', ...meta.map((m) => `<sub>${m}</sub>`));

  const fields = parseHints(hintText, schema);
  if (!fields.select.Module) {
    const guess = inferModule(
      `${parentText}\n${context.map((m) => m.text ?? '').join('\n')}`,
      schema,
    );
    if (guess) fields.select.Module = guess;
  }
  // Everything captured this way is a bug report until a human says otherwise.
  if (!fields.select['Work type'] && optionExists(schema, 'Work type', 'Bug'))
    fields.select['Work type'] = 'Bug';
  if (optionExists(schema, 'Source', 'Slack')) fields.select.Source = 'Slack';
  if (permalink) fields.text['Slack link'] = permalink;
  if (reporterName) fields.text['Reported by'] = reporterName;

  return { title, body: body.join('\n').trim(), fields };
}

// ---------- impure: persistence ----------

function fieldsToJsonb(schema: ProjectSchema, fields: DraftFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const byName = (n: string) => schema.fields.find((f) => f.name.toLowerCase() === n.toLowerCase());

  for (const [fieldName, optionName] of Object.entries(fields.select)) {
    const f = byName(fieldName);
    const o = f?.options?.find((x) => x.name.toLowerCase() === optionName.toLowerCase());
    if (f && o) out[f.id] = { optionId: o.id };
  }
  for (const [fieldName, optionNames] of Object.entries(fields.multiSelect)) {
    const f = byName(fieldName);
    const ids = (f?.options ?? [])
      .filter((o) => optionNames.some((n) => n.toLowerCase() === o.name.toLowerCase()))
      .map((o) => o.id);
    if (f && ids.length) out[f.id] = { optionIds: ids };
  }
  for (const [fieldName, value] of Object.entries(fields.text)) {
    const f = byName(fieldName);
    if (f && value) out[f.id] = { text: value.slice(0, 1024) };
  }
  return out;
}

/** Slack profile email -> an existing profile id, so the issue is authored by a real person. */
async function profileIdForSlackUser(user: SlackUser | undefined): Promise<string | null> {
  const email = user?.profile?.email?.toLowerCase();
  if (!email) return null;
  const rows = await db()<
    { id: string }[]
  >`select id from profiles where lower(email) = ${email} limit 1`;
  return rows[0]?.id ?? null;
}

export interface IngestResult {
  item: BoardItem;
  /** false when this Slack message had already been captured — the caller should say so, not re-announce. */
  created: boolean;
}

/**
 * Idempotent by (channel, parent ts) — see the partial unique index in 0003_slack_ingest.sql.
 * A duplicate trigger resolves to the existing issue rather than raising, so Slack event
 * retries and double-taps are both harmless.
 */
export async function ingestSlackMessage(args: {
  channelId: string;
  parent: SlackMessage;
  replies: SlackMessage[];
  hintText: string;
  permalink?: string;
  reporter?: SlackUser;
  userNames?: Map<string, string>;
}): Promise<IngestResult> {
  const schema = await getSchema();
  const reporterName =
    args.reporter?.profile?.real_name ?? args.reporter?.real_name ?? args.reporter?.name;
  const draft = buildIssueDraft({ ...args, reporterName, schema });
  const authorId = await profileIdForSlackUser(args.reporter);
  const fieldsJson = fieldsToJsonb(schema, draft.fields);

  const existing = await db()<{ id: string }[]>`
    select id from issues where slack_channel_id = ${args.channelId} and slack_message_ts = ${args.parent.ts} limit 1
  `;
  if (existing[0]) return { item: await getItem(existing[0].id, authorId), created: false };

  const issueId = await withActor(authorId, async (tx) => {
    const rows = await tx<{ id: string }[]>`
      insert into issues (title, body, author_id, fields, slack_channel_id, slack_message_ts)
      values (${draft.title}, ${draft.body}, ${authorId}, ${JSON.stringify(fieldsJson)}::jsonb, ${args.channelId}, ${args.parent.ts})
      on conflict (slack_channel_id, slack_message_ts) where slack_channel_id is not null and slack_message_ts is not null
      do nothing
      returning id
    `;
    if (rows[0]) return rows[0].id;
    // Lost the race against a concurrent delivery of the same event — take theirs.
    const raced = await tx<{ id: string }[]>`
      select id from issues where slack_channel_id = ${args.channelId} and slack_message_ts = ${args.parent.ts} limit 1
    `;
    return raced[0]?.id ?? null;
  });

  if (!issueId)
    throw new Error(
      `Slack ingest could not resolve an issue for ${args.channelId}/${args.parent.ts}`,
    );
  const wasInserted = !existing[0];
  return { item: await getItem(issueId, authorId), created: wasInserted };
}
