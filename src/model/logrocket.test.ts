import { describe, expect, it } from 'vitest';
import type { BoardItem } from '@shared/types';
import { parseSessionUrl, projectsFor, sessionSearchUrl, shortRecordingId } from './logrocket';

const SESSION =
  'https://app.logrocket.com/3q0c2i/radius-brokerage-platform/s/6-0000aaaa-1111-2222-3333-444455556666/0';

function item(fields: BoardItem['fields']): BoardItem {
  return { itemId: 'PVTI_1', fields } as unknown as BoardItem;
}
const team = (name: string) => ({ Team: { kind: 'singleSelect' as const, optionId: name, name } });
const platform = (...names: string[]) => ({
  Platform: { kind: 'multiSelect' as const, options: names.map((n) => ({ id: n, name: n })) },
});

describe('parseSessionUrl', () => {
  it('pulls the org, project and recording out of a real session URL', () => {
    expect(parseSessionUrl(SESSION)).toMatchObject({
      org: '3q0c2i',
      projectId: 'radius-brokerage-platform',
      projectName: 'Radius Brokerage Platform',
      recordingId: '6-0000aaaa-1111-2222-3333-444455556666',
      sessionId: '0',
    });
  });

  it('keeps the timestamp query so the link lands where it was copied', () => {
    const withTime = `${SESSION}?t=12345`;
    expect(parseSessionUrl(withTime)?.url).toBe(withTime);
  });

  it('tolerates surrounding whitespace from a paste', () => {
    expect(parseSessionUrl(`  ${SESSION}\n`)?.recordingId).toBe(
      '6-0000aaaa-1111-2222-3333-444455556666',
    );
  });

  it('falls back to the raw slug for a project it does not know', () => {
    const url = SESSION.replace('radius-brokerage-platform', 'brand-new-app');
    expect(parseSessionUrl(url)?.projectName).toBe('brand-new-app');
  });

  it('rejects anything that is not a session link', () => {
    expect(parseSessionUrl('')).toBeNull();
    expect(parseSessionUrl('not a url')).toBeNull();
    expect(parseSessionUrl('https://example.com/3q0c2i/soul/s/abc/0')).toBeNull();
    // an issues link, not a session
    expect(parseSessionUrl('https://app.logrocket.com/3q0c2i/soul/issues/abc')).toBeNull();
    expect(parseSessionUrl('https://app.logrocket.com/3q0c2i/soul/s/')).toBeNull();
  });
});

describe('projectsFor', () => {
  it('narrows by Platform when it is set', () => {
    expect(projectsFor(item(platform('iOS'))).map((p) => p.id)).toEqual(['office-ios']);
  });

  it('offers every web property for a web bug', () => {
    expect(projectsFor(item(platform('Web'))).map((p) => p.id)).toEqual([
      'radius-brokerage-platform',
      'client-portal-ycwjp',
      'soul',
    ]);
  });

  it('combines platforms without repeating a project', () => {
    const ids = projectsFor(item({ ...platform('iOS', 'Android'), ...team('iOS') })).map(
      (p) => p.id,
    );
    expect(ids).toEqual(['office-ios', 'office-android']);
  });

  it('falls back to Team when Platform is unset', () => {
    expect(projectsFor(item(team('Android'))).map((p) => p.id)).toEqual(['office-android']);
  });

  it('offers everything real when the issue says nothing, rather than nothing', () => {
    const ids = projectsFor(item({})).map((p) => p.id);
    expect(ids).toContain('office-ios');
    expect(ids).not.toContain('sandbox');
  });
});

describe('links', () => {
  it('builds a session search URL for a project', () => {
    expect(sessionSearchUrl('office-ios')).toBe(
      'https://app.logrocket.com/3q0c2i/office-ios/sessions',
    );
  });

  it('shortens a recording id to something a human can compare', () => {
    expect(shortRecordingId('6-0000aaaa-1111-2222-3333-444455556666')).toBe('0000aaaa');
  });
});
