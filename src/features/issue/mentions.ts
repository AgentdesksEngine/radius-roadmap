/**
 * Mention tokens in comment markdown.
 *
 * The stored form is `[@Jane Doe](mention:<profile uuid>)`: a link the markdown renderer
 * already understands, carrying the id rather than the name so a renamed profile does not
 * break the link, and so the server can resolve recipients without guessing at display names
 * (api/_lib/notify.ts parses the same shape).
 */
export const MENTION_TRIGGER = '@';

export function mentionToken(name: string, profileId: string): string {
  // A ']' in a display name would end the link text early; nothing else needs escaping.
  return `[@${name.replace(/]/g, '')}](mention:${profileId})`;
}

export interface MentionQuery {
  /** Index of the '@' that opened this query. */
  start: number;
  /** Text typed after the '@', so far. */
  text: string;
}

/**
 * Is the caret inside an `@…` the picker should answer? Only right after whitespace or at the
 * very start, so an email address in the middle of a sentence never opens it, and only while
 * the query is still short and single-line.
 */
export function activeMention(value: string, caret: number): MentionQuery | null {
  const upto = value.slice(0, caret);
  const at = upto.lastIndexOf(MENTION_TRIGGER);
  if (at === -1) return null;
  const before = at === 0 ? '' : upto[at - 1]!;
  if (before && !/\s/.test(before)) return null;
  const text = upto.slice(at + 1);
  if (/[\s\n]/.test(text) || text.length > 40) return null;
  return { start: at, text };
}

/** Replaces the open `@…` with a finished token, and says where the caret should land. */
export function applyMention(
  value: string,
  query: MentionQuery,
  caret: number,
  name: string,
  profileId: string,
): { value: string; caret: number } {
  const token = mentionToken(name, profileId);
  const next = `${value.slice(0, query.start)}${token} ${value.slice(caret)}`;
  return { value: next, caret: query.start + token.length + 1 };
}
