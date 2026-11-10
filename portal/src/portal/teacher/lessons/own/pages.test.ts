import { describe, it, expect } from 'vitest';
import { MAX_SPAN, checkBand, checkPages, checkPages612, fmtPg, parseLabel, parsePg, pgToSend } from './pages';

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

describe('checkPages612 — bd-snkn32.19: grades 6–12, inside the lesson or through the next one', () => {
  const lesson = { start: 42, end: 45 };
  const next = { start: 46, end: 48 };
  it('any range inside the lesson, one page included', () => {
    expect(checkPages612('42', '45', lesson, next)).toEqual({ range: { start: 42, end: 45 }, both: false });
    expect(checkPages612('42', '42', lesson, next)).toEqual({ range: { start: 42, end: 42 }, both: false });
    expect(checkPages612('43', '44', lesson, null)).toEqual({ range: { start: 43, end: 44 }, both: false });
  });
  it('ending exactly at the next lesson\'s end joins both lessons', () => {
    expect(checkPages612('42', '48', lesson, next)).toEqual({ range: { start: 42, end: 48 }, both: true });
    expect(checkPages612('44', '48', lesson, next)).toEqual({ range: { start: 44, end: 48 }, both: true });
  });
  it('refuses anything else', () => {
    expect(checkPages612('41', '45', lesson, next)).toBeNull();
    expect(checkPages612('42', '46', lesson, next)).toBeNull();
    expect(checkPages612('42', '47', lesson, next)).toBeNull();
    expect(checkPages612('42', '48', lesson, null)).toBeNull();
    expect(checkPages612('46', '48', lesson, next)).toBeNull();
    expect(checkPages612('45', '43', lesson, next)).toBeNull();
    expect(checkPages612('', '45', lesson, next)).toBeNull();
    expect(checkPages612('42', '45', null, next)).toBeNull();
  });
});

describe('checkBand / pgToSend — one check for every band, and what rides in the address', () => {
  const lesson = { start: 42, end: 45 };
  const next = { start: 46, end: 48 };
  it('grades 1–5 widen freely (never "both"); 6–12 stay inside or run to the next lesson\'s end', () => {
    expect(checkBand(true, '42', '47', lesson, next)).toEqual({ range: { start: 42, end: 47 }, both: false });
    expect(checkBand(false, '42', '47', lesson, next)).toBeNull();
    expect(checkBand(false, '42', '48', lesson, next)).toEqual({ range: { start: 42, end: 48 }, both: true });
  });
  it('the natural range sends nothing; anything else sends her pages', () => {
    expect(pgToSend({ range: lesson, both: false }, lesson, next)).toBeUndefined();
    expect(pgToSend({ range: { start: 42, end: 48 }, both: true }, lesson, next)).toBeUndefined();
    expect(pgToSend({ range: { start: 43, end: 48 }, both: true }, lesson, next)).toEqual({ start: 43, end: 48 });
    expect(pgToSend({ range: { start: 42, end: 42 }, both: false }, lesson, next)).toEqual({ start: 42, end: 42 });
    expect(pgToSend(null, lesson, next)).toBeUndefined();
    expect(pgToSend({ range: lesson, both: false }, null, next)).toBeUndefined();
  });
});
