import { describe, it, expect } from 'vitest';
import { MAX_SPAN, checkPages, fmtPg, parseLabel, parsePg } from './pages';

/** bd-snkn32.17 — the book pages of a grades 1–5 Make my own (pure): read, typed, checked like the bot checks them. */

describe('parseLabel — the day\'s pages as the list shows them', () => {
  it('reads a range, an en-dash range and a single page', () => {
    expect(parseLabel('p.3-4')).toEqual({ start: 3, end: 4 });
    expect(parseLabel('p.10–13')).toEqual({ start: 10, end: 13 });
    expect(parseLabel('p.2')).toEqual({ start: 2, end: 2 });
  });
  it('is null for nothing or nonsense', () => {
    expect(parseLabel(null)).toBeNull();
    expect(parseLabel('')).toBeNull();
    expect(parseLabel('Worksheet')).toBeNull();
  });
});

describe('parsePg / fmtPg — her pages in the address', () => {
  it('round-trips', () => {
    expect(parsePg('3-6')).toEqual({ start: 3, end: 6 });
    expect(parsePg('3')).toEqual({ start: 3, end: 3 });
    expect(fmtPg({ start: 3, end: 6 })).toBe('3-6');
    expect(fmtPg({ start: 3, end: 3 })).toBe('3');
  });
  it('drops what the bot would refuse', () => {
    expect(parsePg('6-3')).toBeNull();
    expect(parsePg('x')).toBeNull();
    expect(parsePg('0-2')).toBeNull();
    expect(parsePg(null)).toBeNull();
  });
});

describe('checkPages — what she typed', () => {
  const day = { start: 3, end: 4 };
  it('whole numbers, first ≤ last', () => {
    expect(checkPages('3', '6', day)).toEqual({ start: 3, end: 6 });
    expect(checkPages(' 4 ', '4', day)).toEqual({ start: 4, end: 4 });
    expect(checkPages('6', '4', day)).toBeNull();
    expect(checkPages('', '4', day)).toBeNull();
    expect(checkPages('3.5', '4', day)).toBeNull();
    expect(checkPages('0', '4', day)).toBeNull();
  });
  it('at most MAX_SPAN pages, unless the day itself is longer', () => {
    expect(checkPages('3', String(3 + MAX_SPAN - 1), day)).not.toBeNull();
    expect(checkPages('3', String(3 + MAX_SPAN), day)).toBeNull();
    expect(checkPages('1', '20', { start: 1, end: 20 })).toEqual({ start: 1, end: 20 });
  });
});
