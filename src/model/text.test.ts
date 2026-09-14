import { describe, expect, it } from 'vitest';
import { excerpt, plainText } from './text';

describe('plainText', () => {
  it('drops markdown syntax but keeps the words', () => {
    expect(plainText('**Bug:** the [CDA page](https://x.test) is _slow_')).toBe(
      'Bug: the CDA page is slow',
    );
  });

  it('strips the HTML that comes through with Slack-imported bodies', () => {
    expect(plainText('<p>Agent <b>Kenny R.</b> cannot log in</p>')).toBe(
      'Agent Kenny R. cannot log in',
    );
  });

  it('removes code fences, images and list markers', () => {
    expect(plainText('- step one\n- step two\n\n```\nstack trace\n```\n![shot](a.png)')).toBe(
      'step one step two',
    );
  });

  it('collapses the whitespace a multi-line body arrives with', () => {
    expect(plainText('line one\n\n\nline   two')).toBe('line one line two');
  });
});

describe('excerpt', () => {
  it('leaves a short body alone, with no ellipsis', () => {
    expect(excerpt('Short one', 260)).toBe('Short one');
  });

  it('cuts on a word boundary and marks the cut', () => {
    const out = excerpt('alpha bravo charlie delta echo', 14);
    expect(out).toBe('alpha bravo…');
    expect(out).not.toContain('charlie');
  });

  it('does not leave a dangling separator before the ellipsis', () => {
    expect(excerpt('alpha bravo, charlie', 13)).toBe('alpha bravo…');
  });
});
