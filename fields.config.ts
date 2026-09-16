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
  /** Picking this option closes the issue; issues_sync_state_and_status() reads this live. */
  closesAs?: 'COMPLETED' | 'NOT_PLANNED';
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
    // Matches the Slack List's own "By status" board exactly (name, color, and column order)
    // instead of a normalized Linear-style set, so the tracker reads the same as the sheet the
    // team already triages from. Only 'Released to prod' and 'Duplicates requested by user'
    // close an issue automatically; everything else is informational, same as 'On alert' never
    // auto-closing under the old scheme.
    name: STATUS_FIELD,
    type: 'SINGLE_SELECT',
    options: [
      { name: 'Yet to prioritise', color: 'GRAY' },
      { name: 'Design', color: 'PURPLE' },
      { name: 'UX Improvements', color: 'ORANGE' },
      { name: 'New Requests', color: 'BLUE' },
      { name: 'Bugs', color: 'BLUE' },
      { name: 'Tasks', color: 'ORANGE' },
      { name: 'Logrocket and Mel sessions', color: 'BLUE' },
      { name: 'For the week', color: 'PURPLE' },
      { name: 'Work in progress', color: 'PINK' },
      { name: 'Dev Testing', color: 'BLUE' },
      { name: 'On staging (With QA)', color: 'PURPLE' },
      { name: 'Staging Bugs', color: 'BLUE' },
      { name: 'Release Ready', color: 'PURPLE' },
      { name: 'Released to prod', color: 'GREEN', closesAs: 'COMPLETED' },
      { name: 'Backlog', color: 'PINK' },
      { name: "On alert (couldn't replicate)", color: 'GRAY' },
      { name: 'New Modules', color: 'PURPLE' },
      { name: 'Duplicates requested by user', color: 'GREEN', closesAs: 'NOT_PLANNED' },
    ],
  },
  {
    // Multi-valued: one issue often spans several platforms, so several teams own it.
    name: TEAM_FIELD,
    type: 'MULTI_SELECT',
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
      { name: 'Slack', color: 'PURPLE', description: 'Captured from a Slack thread' },
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
