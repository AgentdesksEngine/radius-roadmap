/**
 * The parsing in ingest.ts is where this feature is most likely to be quietly wrong, so the
 * fixtures below are shaped like real #product-critical-bugs traffic rather than tidy samples.
 */
import { describe, expect, it } from 'vitest';
import type { ProjectSchema } from '../../../shared/types.js';
import {
  buildIssueDraft,
  deriveTitle,
  inferModule,
  parseAddCommand,
  parseHints,
  slackTextToMarkdown,
} from './ingest.js';

// A cut-down stand-in for what getSchema() returns, with the option names from fields.config.ts.
const schema = {
  projectId: 'test',
  fields: [
    {
      id: 'f-status',
      name: 'Status',
      dataType: 'SINGLE_SELECT',
      options: [{ id: 'o-backlog', name: 'Backlog' }],
    },
    {
      id: 'f-team',
      name: 'Team',
      dataType: 'SINGLE_SELECT',
      options: [
        { id: 'o-ios', name: 'iOS' },
        { id: 'o-android', name: 'Android' },
        { id: 'o-backend', name: 'Backend' },
        { id: 'o-web', name: 'Web' },
      ],
    },
    {
      id: 'f-worktype',
      name: 'Work type',
      dataType: 'SINGLE_SELECT',
      options: [
        { id: 'o-bug', name: 'Bug' },
        { id: 'o-fr', name: 'Feature request' },
        { id: 'o-task', name: 'Task' },
      ],
    },
    {
      id: 'f-priority',
      name: 'Priority',
      dataType: 'SINGLE_SELECT',
      options: [
        { id: 'o-urgent', name: 'Urgent' },
        { id: 'o-high', name: 'High' },
        { id: 'o-medium', name: 'Medium' },
        { id: 'o-low', name: 'Low' },
      ],
    },
    {
      id: 'f-severity',
      name: 'Severity',
      dataType: 'SINGLE_SELECT',
      options: [
        { id: 'o-sev-high', name: 'High' },
        { id: 'o-sev-med', name: 'Medium' },
        { id: 'o-sev-low', name: 'Low' },
      ],
    },
    {
      id: 'f-module',
      name: 'Module',
      dataType: 'SINGLE_SELECT',
      options: [
        { id: 'o-crm', name: 'CRM' },
        { id: 'o-docs', name: 'Documentation' },
        { id: 'o-cda', name: 'CDA' },
        { id: 'o-audit', name: 'Auditing dashboard' },
        { id: 'o-subs', name: 'Subscriptions' },
        { id: 'o-txn', name: 'Transaction management' },
        { id: 'o-mls', name: 'MLS feed' },
        { id: 'o-settings', name: 'Settings' },
        { id: 'o-reporting', name: 'Reporting' },
        { id: 'o-other', name: 'Other' },
      ],
    },
    {
      id: 'f-source',
      name: 'Source',
      dataType: 'SINGLE_SELECT',
      options: [
        { id: 'o-qa', name: 'QA' },
        { id: 'o-agent', name: 'Agent' },
        { id: 'o-slack', name: 'Slack' },
        { id: 'o-internal', name: 'Internal' },
      ],
    },
    {
      id: 'f-platform',
      name: 'Platform',
      dataType: 'MULTI_SELECT',
      options: [
        { id: 'o-p-web', name: 'Web' },
        { id: 'o-p-ios', name: 'iOS' },
        { id: 'o-p-android', name: 'Android' },
      ],
    },
    { id: 'f-slacklink', name: 'Slack link', dataType: 'TEXT' },
    { id: 'f-reportedby', name: 'Reported by', dataType: 'TEXT' },
  ],
} as unknown as ProjectSchema;

describe('slackTextToMarkdown', () => {
  it('converts labelled links, bare links and mailto', () => {
    expect(slackTextToMarkdown('see <https://audit.radiusagent.com/x|the CDA> now')).toBe(
      'see [the CDA](https://audit.radiusagent.com/x) now',
    );
    expect(slackTextToMarkdown('<https://example.com/a>')).toBe('https://example.com/a');
    expect(slackTextToMarkdown('<mailto:a@b.com|a@b.com>')).toBe('a@b.com');
  });

  it('resolves user mentions through the name map, falling back to the id', () => {
    const names = new Map([['U01LPCLCLLD', 'Jessica DeFerrari']]);
    expect(slackTextToMarkdown('cc <@U01LPCLCLLD>', names)).toBe('cc @Jessica DeFerrari');
    expect(slackTextToMarkdown('cc <@U01LPCLCLLD|Jessica>', names)).toBe('cc @Jessica');
    expect(slackTextToMarkdown('cc <@UNKNOWN123>')).toBe('cc @UNKNOWN123');
  });

  it('handles subteam and broadcast mentions', () => {
    expect(slackTextToMarkdown('<!subteam^SJ70LJA1Z> please look')).toBe(
      '@team-SJ70LJA1Z please look',
    );
    expect(slackTextToMarkdown('<!here> heads up')).toBe('@here heads up');
  });

  it('unescapes entities only after the angle-bracket forms are consumed', () => {
    expect(slackTextToMarkdown('E&amp;O plan &lt;test&gt;')).toBe('E&O plan <test>');
  });
});

describe('parseAddCommand', () => {
  it('returns the hints after "add"', () => {
    expect(parseAddCommand('<@U0BOT> add p1 cda ios', 'U0BOT')).toBe('p1 cda ios');
  });

  it('treats a bare add as valid with no hints', () => {
    expect(parseAddCommand('<@U0BOT> add', 'U0BOT')).toBe('');
  });

  it('ignores mentions that are not add commands', () => {
    expect(parseAddCommand('<@U0BOT> what do you think?', 'U0BOT')).toBeNull();
    expect(parseAddCommand('ask <@U0BOT> about this', 'U0BOT')).toBeNull();
  });

  it('works when the mention trails the command word', () => {
    expect(parseAddCommand('<@U0BOT>   add   urgent', 'U0BOT')).toBe('urgent');
  });
});

describe('deriveTitle', () => {
  it('takes the first substantive line and drops mentions', () => {
    const text =
      '@team-SJ70LJA1Z testing commission groups we have a few issues:\n1. we cannot find Chris Cruz';
    expect(deriveTitle(text)).toBe('testing commission groups we have a few issues:');
  });

  it('skips a leading line that is only a mention', () => {
    expect(deriveTitle('@here\nMLS search is not working for offer writing')).toBe(
      'MLS search is not working for offer writing',
    );
  });

  it('clips very long titles to fit the column', () => {
    const title = deriveTitle('x'.repeat(400));
    expect(title.length).toBeLessThanOrEqual(250);
    expect(title.endsWith('…')).toBe(true);
  });

  it('falls back rather than producing an empty title', () => {
    expect(deriveTitle('   \n  ')).toBe('Bug reported in Slack');
  });
});

describe('parseHints', () => {
  it('maps priority shorthand', () => {
    expect(parseHints('p1', schema).select.Priority).toBe('High');
    expect(parseHints('p0', schema).select.Priority).toBe('Urgent');
    expect(parseHints('critical', schema).select.Priority).toBe('Urgent');
  });

  it('maps platform hints to the multi-select and a single-platform Team', () => {
    const hints = parseHints('ios android', schema);
    expect(hints.multiSelect.Platform).toEqual(['iOS', 'Android']);
    expect(hints.select.Team).toBe('iOS');
  });

  it('matches module option names including multi-word ones', () => {
    expect(parseHints('cda', schema).select.Module).toBe('CDA');
    expect(parseHints('auditing dashboard', schema).select.Module).toBe('Auditing dashboard');
  });

  it('requires sev: prefix so a bare "high" stays a Priority', () => {
    expect(parseHints('high', schema).select.Severity).toBeUndefined();
    expect(parseHints('high', schema).select.Priority).toBe('High');
    expect(parseHints('sev:high', schema).select.Severity).toBe('High');
  });

  it('returns nothing for empty hints', () => {
    expect(parseHints('', schema)).toEqual({ select: {}, multiSelect: {}, text: {} });
  });
});

describe('inferModule', () => {
  it.each([
    ['Anthony is stuck on the RLA document splitter, it says Analyzing forever', 'Documentation'],
    ['the commission breakdown for groups is throwing an error on agent split', 'CDA'],
    ['Tomer subscription updated to monthly but Stripe still charging $1,000', 'Subscriptions'],
    ['MLS search is not working for offer writing', 'MLS feed'],
    ['cannot log into her collaborator account, taking her through onboarding flow', 'Settings'],
    ['see audit.radiusagent.com/transaction-queue/purchase/13695', 'Auditing dashboard'],
  ])('maps %j to %s', (text, expected) => {
    expect(inferModule(text, schema)).toBe(expected);
  });

  it('returns undefined when nothing matches', () => {
    expect(inferModule('the thing is broken somehow', schema)).toBeUndefined();
  });
});

describe('buildIssueDraft', () => {
  const parent = {
    ts: '1789155012.447409',
    user: 'U01TBMNSBB2',
    text: 'Anthony Cannata is experiencing an issue with the *RLA document splitter in Radius*:\nHe clicks Split and it stays stuck on Analyzing.',
    files: [
      {
        id: 'F0C24KUKH1N',
        name: 'Video Project.mp4',
        mimetype: 'video/mp4',
        permalink: 'https://slack.com/f/1',
      },
    ],
  };
  const replies = [
    parent,
    { ts: '1789155999.1', user: 'U0AMWAQG2N8', text: 'Reproduced on staging too' },
    { ts: '1789156000.1', bot_id: 'B0BOT', text: 'Tracked as RAD-1' },
  ];

  const draft = buildIssueDraft({
    parent,
    replies,
    hintText: 'p1',
    permalink: 'https://radiusagent.slack.com/archives/C31A2FA3F/p1789155012447409',
    reporterName: 'William',
    userNames: new Map([['U0AMWAQG2N8', 'Peter Dias']]),
    schema,
  });

  it('titles from the first line of the parent, not the thread', () => {
    expect(draft.title).toBe(
      'Anthony Cannata is experiencing an issue with the *RLA document splitter in Radius*:',
    );
  });

  it('tags provenance and defaults Work type to Bug', () => {
    expect(draft.fields.select.Source).toBe('Slack');
    expect(draft.fields.select['Work type']).toBe('Bug');
    expect(draft.fields.text['Slack link']).toContain('p1789155012447409');
    expect(draft.fields.text['Reported by']).toBe('William');
  });

  it('applies the typed hint and infers the module from the prose', () => {
    expect(draft.fields.select.Priority).toBe('High');
    expect(draft.fields.select.Module).toBe('Documentation');
  });

  it('quotes human replies by name and skips the bot ones', () => {
    expect(draft.body).toContain('**Peter Dias**: Reproduced on staging too');
    expect(draft.body).not.toContain('Tracked as RAD-1');
    expect(draft.body).toContain('Thread (1 reply)');
  });

  it('lists attachments and links back to Slack', () => {
    expect(draft.body).toContain('[Video Project.mp4](https://slack.com/f/1)');
    expect(draft.body).toContain('Open the Slack thread');
  });

  it('leaves Team and Severity unset so the issue lands in Intake', () => {
    expect(draft.fields.select.Team).toBeUndefined();
    expect(draft.fields.select.Severity).toBeUndefined();
  });
});

describe('deriveTitle list-marker handling', () => {
  it('strips real list markers', () => {
    expect(deriveTitle('1. we cannot find Chris Cruz in the account')).toBe(
      'we cannot find Chris Cruz in the account',
    );
    expect(deriveTitle('• MLS search is down')).toBe('MLS search is down');
  });

  it('keeps a leading number that is part of the sentence', () => {
    expect(deriveTitle('2 factor authentication is broken')).toBe(
      '2 factor authentication is broken',
    );
  });
});
