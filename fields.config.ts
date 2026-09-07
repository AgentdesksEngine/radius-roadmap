/**
 * Desired custom-field schema for the Radius Roadmap project.
 * `scripts/provision-fields.ts` makes the live project match this file (idempotent:
 * creates missing fields, adds missing options, renames options by `renameFrom`).
 *
 * Option order here is the column order on the board.
 */
import type { OptionColor } from './shared/types';

export interface OptionSpec {
  name: string;
  color: OptionColor;
  description?: string;
  /** Existing option name(s) to rename into this one, preserving the option id. */
  renameFrom?: string[];
}

export type FieldSpec =
  | { name: string; type: 'SINGLE_SELECT'; options: OptionSpec[] }
  | { name: string; type: 'MULTI_SELECT'; options: OptionSpec[] }
  | { name: string; type: 'DATE' }
  | { name: string; type: 'TEXT' }
  | { name: string; type: 'NUMBER' };

export const STATUS_FIELD = 'Status';
export const TEAM_FIELD = 'Team';

export const fields: FieldSpec[] = [
  {
    name: STATUS_FIELD,
    type: 'SINGLE_SELECT',
    options: [
      { name: 'Backlog', color: 'GRAY', description: 'Not yet prioritised' },
      { name: 'Todo', color: 'GRAY', description: 'Prioritised, not started' },
      { name: 'In progress', color: 'YELLOW', description: 'Being worked on', renameFrom: ['In Progress'] },
      { name: 'In review', color: 'ORANGE', description: 'Code review / dev testing' },
      { name: 'In QA', color: 'BLUE', description: 'On staging with QA' },
      { name: 'Ready to release', color: 'PINK', description: 'QA passed, waiting for a release' },
      { name: 'Done', color: 'PURPLE', description: 'Released to production' },
      { name: 'Canceled', color: 'GRAY', description: 'Duplicate or will not do' },
      { name: "Can't reproduce", color: 'RED', description: 'On alert: could not replicate' },
    ],
  },
  {
    name: TEAM_FIELD,
    type: 'SINGLE_SELECT',
    options: [
      { name: 'iOS', color: 'BLUE' },
      { name: 'Android', color: 'GREEN' },
      { name: 'Backend', color: 'ORANGE' },
      { name: 'Web', color: 'PURPLE' },
    ],
  },
  {
    name: 'Work type',
    type: 'SINGLE_SELECT',
    options: [
      { name: 'Bug', color: 'RED' },
      { name: 'Feature request', color: 'BLUE' },
      { name: 'Task', color: 'GRAY' },
      { name: 'UX improvement', color: 'PINK' },
      { name: 'Design', color: 'PURPLE' },
      { name: 'New module', color: 'GREEN' },
    ],
  },
  {
    name: 'Priority',
    type: 'SINGLE_SELECT',
    options: [
      { name: 'Urgent', color: 'RED', description: 'Critical bug' },
      { name: 'High', color: 'ORANGE', description: 'P1' },
      { name: 'Medium', color: 'YELLOW' },
      { name: 'Low', color: 'GRAY' },
    ],
  },
  {
    name: 'Severity',
    type: 'SINGLE_SELECT',
    options: [
      { name: 'High', color: 'RED' },
      { name: 'Medium', color: 'YELLOW' },
      { name: 'Low', color: 'GRAY' },
    ],
  },
  {
    name: 'Module',
    type: 'SINGLE_SELECT',
    options: [
      { name: 'CRM', color: 'BLUE' },
      { name: 'Documentation', color: 'GREEN' },
      { name: 'AI', color: 'PURPLE' },
      { name: 'Auditing dashboard', color: 'ORANGE' },
      { name: 'CDA', color: 'PINK' },
      { name: 'Client app', color: 'BLUE' },
      { name: 'Transaction management', color: 'YELLOW' },
      { name: 'Call', color: 'GRAY' },
      { name: 'Subscriptions', color: 'GREEN' },
      { name: 'Pods and automation', color: 'PURPLE' },
      { name: 'Settings', color: 'GRAY' },
      { name: 'Client imports', color: 'ORANGE' },
      { name: 'MLS feed', color: 'BLUE' },
      { name: 'Reporting', color: 'YELLOW' },
      { name: 'Notes', color: 'GRAY' },
      { name: 'Other', color: 'GRAY' },
    ],
  },
  {
    name: 'Source',
    type: 'SINGLE_SELECT',
    options: [
      { name: 'QA', color: 'BLUE' },
      { name: 'Agent', color: 'GREEN', description: 'Reported by a customer / agent' },
      { name: 'Internal', color: 'GRAY' },
    ],
  },
  {
    name: 'Platform',
    type: 'MULTI_SELECT',
    options: [
      { name: 'Web', color: 'BLUE' },
      { name: 'iOS', color: 'PURPLE' },
      { name: 'Android', color: 'GREEN' },
    ],
  },
  { name: 'ETA', type: 'DATE' },
  { name: 'Release date', type: 'DATE' },
  { name: 'Brokerage', type: 'TEXT' },
  { name: 'Reported by', type: 'TEXT' },
  { name: 'Slack link', type: 'TEXT' },
  // A LogRocket session replay URL. The panel renders it as a replay card and, when it is
  // empty, links out to the LogRocket projects that match the issue's Platform or Team.
  { name: 'LogRocket', type: 'TEXT' },
];
