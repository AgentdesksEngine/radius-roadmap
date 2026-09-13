import { describe, expect, it } from 'vitest';
import { activeMention, applyMention, mentionToken } from './mentions';

const ID = '2f1e4c8a-1111-4a2b-8c3d-9e0f1a2b3c4d';

describe('mentionToken', () => {
  it('writes the id, not the name, so a rename cannot break the link', () => {
    expect(mentionToken('Jane Doe', ID)).toBe(`[@Jane Doe](mention:${ID})`);
  });

  it('drops a bracket that would end the link text early', () => {
    expect(mentionToken('Jane] Doe', ID)).toBe(`[@Jane Doe](mention:${ID})`);
  });
});

describe('activeMention', () => {
  it('opens at the start of the box', () => {
    expect(activeMention('@ja', 3)).toEqual({ start: 0, text: 'ja' });
  });

  it('opens after a space', () => {
    expect(activeMention('hey @ja', 7)).toEqual({ start: 4, text: 'ja' });
  });

  it('stays shut inside an email address', () => {
    expect(activeMention('mail jane@radiusagent.com', 25)).toBeNull();
  });

  it('closes once the query runs past a space', () => {
    expect(activeMention('@jane doe', 9)).toBeNull();
  });

  it('is null when there is no @ before the caret', () => {
    expect(activeMention('hello', 5)).toBeNull();
  });

  it('ignores an @ that comes after the caret', () => {
    expect(activeMention('hi @jane', 2)).toBeNull();
  });
});

describe('applyMention', () => {
  it('replaces the query with a finished token and a trailing space', () => {
    const out = applyMention('hey @ja', { start: 4, text: 'ja' }, 7, 'Jane Doe', ID);
    expect(out.value).toBe(`hey [@Jane Doe](mention:${ID}) `);
    expect(out.caret).toBe(out.value.length);
  });

  it('keeps whatever was typed after the caret', () => {
    const out = applyMention('hey @ja, look', { start: 4, text: 'ja' }, 7, 'Jane Doe', ID);
    expect(out.value).toBe(`hey [@Jane Doe](mention:${ID}) , look`);
    expect(out.value.slice(out.caret)).toBe(', look');
  });
});
