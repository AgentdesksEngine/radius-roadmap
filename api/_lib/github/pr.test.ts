/**
 * The two things a PR webhook gets wrong in ways nobody notices for weeks: which issue it
 * attached itself to, and whether it was allowed to move that issue's status.
 *
 * The status table is the important half. A webhook moving a Done issue back to In review
 * because someone opened a follow-up PR is worse than a webhook that does nothing.
 */
import { describe, expect, it } from 'vitest';
import { extractIssueNumbers, nextStatusFor, prState, statusTargetFor } from './pr.js';

const pr = (over: Partial<{ branch: string; title: string; body: string }> = {}) => ({
  branch: '',
  title: '',
  body: '',
  ...over,
});

describe('extractIssueNumbers', () => {
  it('finds the key in a branch name', () => {
    expect(extractIssueNumbers(pr({ branch: 'jane/RAD-12-fix-login' }), 'RAD')).toEqual([12]);
  });

  it('finds it in the title and in the body', () => {
    expect(extractIssueNumbers(pr({ title: 'RAD-7 fix login' }), 'RAD')).toEqual([7]);
    expect(extractIssueNumbers(pr({ body: 'closes RAD-9' }), 'RAD')).toEqual([9]);
  });

  it('is case-insensitive', () => {
    expect(extractIssueNumbers(pr({ branch: 'rad-12-fix' }), 'RAD')).toEqual([12]);
  });

  it('links every issue a PR names, once each', () => {
    expect(
      extractIssueNumbers(pr({ branch: 'RAD-12-and-14', title: 'RAD-12 RAD-14 fix login' }), 'RAD'),
    ).toEqual([12, 14]);
  });

  it('returns nothing when no key is present', () => {
    expect(extractIssueNumbers(pr({ title: 'fix login' }), 'RAD')).toEqual([]);
  });

  it('does not match a key embedded in a longer token', () => {
    expect(extractIssueNumbers(pr({ title: 'GRAD-12 and RAD-12x' }), 'RAD')).toEqual([]);
  });

  it('respects a different key prefix', () => {
    expect(extractIssueNumbers(pr({ branch: 'BUG-3-fix' }), 'BUG')).toEqual([3]);
  });
});

describe('prState', () => {
  it('separates a merge from an abandoned close', () => {
    expect(prState({ action: 'closed', merged: true })).toBe('merged');
    expect(prState({ action: 'closed', merged: false })).toBe('closed');
  });

  it('treats everything else as open', () => {
    expect(prState({ action: 'opened', merged: false })).toBe('open');
    expect(prState({ action: 'converted_to_draft', merged: false })).toBe('open');
  });
});

describe('statusTargetFor', () => {
  it('asks for In review when a PR opens for real', () => {
    expect(statusTargetFor({ action: 'opened', merged: false, draft: false })).toBe('In review');
    expect(statusTargetFor({ action: 'ready_for_review', merged: false, draft: false })).toBe('In review');
    expect(statusTargetFor({ action: 'reopened', merged: false, draft: false })).toBe('In review');
  });

  it('asks for nothing while the PR is still a draft', () => {
    expect(statusTargetFor({ action: 'opened', merged: false, draft: true })).toBeNull();
    expect(statusTargetFor({ action: 'converted_to_draft', merged: false, draft: true })).toBeNull();
  });

  it('asks for Ready to release on a merge, and nothing on an abandoned close', () => {
    expect(statusTargetFor({ action: 'closed', merged: true, draft: false })).toBe('Ready to release');
    expect(statusTargetFor({ action: 'closed', merged: false, draft: false })).toBeNull();
  });

  it('asks for nothing when the PR body was merely edited', () => {
    expect(statusTargetFor({ action: 'edited', merged: false, draft: false })).toBeNull();
  });
});

describe('nextStatusFor', () => {
  it.each([
    ['Todo', 'In review'],
    ['In progress', 'In review'],
  ])('moves %s forward to In review', (current, expected) => {
    expect(nextStatusFor('In review', current)).toBe(expected);
  });

  it.each(['Backlog', 'In QA', 'Ready to release', 'Done', 'Canceled', "Can't reproduce"])(
    'leaves %s alone when a PR opens',
    (current) => {
      expect(nextStatusFor('In review', current)).toBeNull();
    },
  );

  it('does not re-apply In review to an issue already in review', () => {
    expect(nextStatusFor('In review', 'In review')).toBeNull();
  });

  it.each([
    ['In review', 'Ready to release'],
    ['In QA', 'Ready to release'],
  ])('moves %s forward on a merge', (current, expected) => {
    expect(nextStatusFor('Ready to release', current)).toBe(expected);
  });

  it.each(['Done', 'Canceled', "Can't reproduce", 'Todo', 'Backlog'])(
    'never overwrites %s on a merge',
    (current) => {
      expect(nextStatusFor('Ready to release', current)).toBeNull();
    },
  );

  it('does nothing when the event asked for nothing', () => {
    expect(nextStatusFor(null, 'Todo')).toBeNull();
  });

  it('does nothing when the issue has no status set at all', () => {
    expect(nextStatusFor('In review', null)).toBeNull();
  });
});
