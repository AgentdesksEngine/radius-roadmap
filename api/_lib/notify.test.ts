/**
 * The parts of the notification stack that decide *who* hears about something and *what*
 * they read — the pieces most likely to leak a DM to the wrong person, or none at all.
 * Nothing here touches Postgres or Slack.
 */
import { describe, expect, it } from 'vitest';
import { formatDigest, parseMentions, recipientsFor, type NotificationEvent } from './notify.js';

const JANE = '2f1e4c8a-1111-4a2b-8c3d-9e0f1a2b3c4d';
const SAM = '7b9d0e1f-2222-4c5d-9e0f-1a2b3c4d5e6f';

describe('parseMentions', () => {
  it('pulls the profile id out of a mention token', () => {
    expect(parseMentions(`hey [@Jane Doe](mention:${JANE}) can you look?`)).toEqual([JANE]);
  });

  it('finds several and drops duplicates', () => {
    const body = `[@Jane](mention:${JANE}) and [@Sam](mention:${SAM}) and [@Jane again](mention:${JANE})`;
    expect(parseMentions(body)).toEqual([JANE, SAM]);
  });

  it('ignores a plain @name, an ordinary link, and an email address', () => {
    expect(parseMentions('@jane please look')).toEqual([]);
    expect(parseMentions('[the docs](https://example.com/mention:x)')).toEqual([]);
    expect(parseMentions('mail jane@radiusagent.com about it')).toEqual([]);
  });

  it('ignores a token whose id is not shaped like a uuid', () => {
    expect(parseMentions('[@Nobody](mention:not-a-uuid)')).toEqual([]);
    expect(parseMentions('[@Nobody](mention:------------------------------------)')).toEqual([]);
  });

  it('is case-insensitive about the id but normalises it', () => {
    expect(parseMentions(`[@Jane](mention:${JANE.toUpperCase()})`)).toEqual([JANE]);
  });
});

describe('recipientsFor', () => {
  it('is watchers plus mentions', () => {
    expect(recipientsFor({ watchers: [JANE], mentions: [SAM], actorId: null }).sort()).toEqual(
      [JANE, SAM].sort(),
    );
  });

  it('never includes the person who caused the event', () => {
    expect(recipientsFor({ watchers: [JANE, SAM], mentions: [JANE], actorId: JANE })).toEqual([SAM]);
  });

  it('does not double up someone who is both a watcher and mentioned', () => {
    expect(recipientsFor({ watchers: [JANE], mentions: [JANE], actorId: null })).toEqual([JANE]);
  });

  it('is empty when the only watcher is the actor', () => {
    expect(recipientsFor({ watchers: [JANE], actorId: JANE })).toEqual([]);
  });

  it('keeps everyone when the event has no actor, as a PR webhook does', () => {
    expect(recipientsFor({ watchers: [JANE, SAM], actorId: null }).length).toBe(2);
  });
});

describe('formatDigest', () => {
  const base = { key: 'RAD-42', title: 'Login crashes on iOS', url: 'https://app.example/issue/RAD-42' };
  const at = '2026-09-13T10:00:00.000Z';
  const event = (kind: NotificationEvent['kind'], detail?: string): NotificationEvent => ({
    kind,
    actor: 'Jane Doe',
    ...(detail ? { detail } : {}),
    at,
  });

  it('reads as a sentence for a single event', () => {
    const text = formatDigest({ ...base, events: [event('comment')] });
    expect(text).toBe('*RAD-42* Login crashes on iOS\nJane Doe commented\nhttps://app.example/issue/RAD-42');
  });

  it('collapses several events into one counted message', () => {
    const text = formatDigest({
      ...base,
      events: [event('comment'), event('status', 'In review'), event('assigned', 'Sam')],
    });
    expect(text).toContain('3 updates on RAD-42:');
    expect(text).toContain('• Jane Doe moved it to In review');
    expect(text.split('\n').filter((l) => l.startsWith('•'))).toHaveLength(3);
  });

  it('always ends with the deep link', () => {
    const text = formatDigest({ ...base, events: [event('mention')] });
    expect(text.endsWith(base.url)).toBe(true);
  });

  it('says something sensible when there is no human actor', () => {
    const text = formatDigest({
      ...base,
      events: [{ kind: 'pr', actor: null, detail: 'radiusagent/app#12 was merged', at }],
    });
    expect(text).toContain('radiusagent/app#12 was merged');
  });
});
