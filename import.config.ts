/**
 * Slack List → GitHub import configuration. Used by scripts/import-slack-list.ts.
 * Map radiusagent.com emails (as they appear in the CSV) to GitHub logins so the
 * import can set real assignees. Unmapped people are recorded as text in the issue body.
 */
export const emailToLogin: Record<string, string> = {
  'sandeep.machiraju@radiusagent.com': 'sandeep-machiraju',
  // Fill these in (login only, no @). Frequency in the export shown for prioritisation.
  'raghvendra@radiusagent.com': '', // 98 assignments
  'akashdeep@radiusagent.com': '', // 90
  'siddhant.agarwal@radiusagent.com': '', // 70
  'shaily@radiusagent.com': '', // 66
  'mahesh@radiusagent.com': '', // 50
  'ashuthosh@radiusagent.com': '', // 561 submissions
  'alex@radiusagent.com': '', // 137 submissions, 246 collaborations
  'prachi.talreja@radiusagent.com': '', // 74 submissions
  'william@radiusagent.com': '', // 52 submissions
  'krish@radiusagent.com': '', // 27 collaborations
  'ranjith@radiusagent.com': '',
  'ravi.ghosh@radiusagent.com': '',
  'yogesh.singh@radiusagent.com': '',
  'trevor.beffa@radiusagent.com': '',
  'jessica.deferrari@radiusagent.com': '',
  'ethan.hall@radiusagent.com': '',
  'prajwal@radiusagent.com': '',
};

/** Slack "Status" column → (Status option, Work type option, close reason). */
export const statusMap: Record<string, { status: string; type?: string; close?: 'COMPLETED' | 'NOT_PLANNED' }> = {
  'released to prod': { status: 'Done', close: 'COMPLETED' },
  'new requests': { status: 'Backlog', type: 'Feature request' },
  'yet to prioritise': { status: 'Backlog' },
  backlog: { status: 'Backlog' },
  'new modules': { status: 'Backlog', type: 'New module' },
  'for the week': { status: 'Todo' },
  bugs: { status: 'Todo', type: 'Bug' },
  tasks: { status: 'Todo', type: 'Task' },
  design: { status: 'Todo', type: 'Design' },
  'ux improvements': { status: 'Todo', type: 'UX improvement' },
  'work in progress': { status: 'In progress' },
  'dev testing': { status: 'In review' },
  'on staging (with qa)': { status: 'In QA' },
  'staging bugs': { status: 'In QA', type: 'Bug' },
  'release ready': { status: 'Ready to release' },
  'duplicates requested by user': { status: 'Canceled', close: 'NOT_PLANNED' },
  "on alert (couldn't replicate)": { status: "Can't reproduce", type: 'Bug', close: 'NOT_PLANNED' },
};

/** Slack "Module" / "Category" values → Module option. */
export const moduleMap: Record<string, string> = {
  crm: 'CRM',
  documentation: 'Documentation',
  ai: 'AI',
  'auditing dashboard': 'Auditing dashboard',
  cda: 'CDA',
  'client app/client profile': 'Client app',
  'client app': 'Client app',
  'transaction management': 'Transaction management',
  transactions: 'Transaction management',
  call: 'Call',
  subscriptions: 'Subscriptions',
  'pods and automation': 'Pods and automation',
  settings: 'Settings',
  'client imports': 'Client imports',
  'mls feed': 'MLS feed',
  'reporting tab': 'Reporting',
  notes: 'Notes',
  other: 'Other',
};
