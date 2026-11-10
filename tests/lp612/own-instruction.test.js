/**
 * bd-snkn32 — "Make my own": her five answers become ONE instruction for reviseLessonPlan.
 *
 * The browser sends codes, never prose (except the optional note). Anything not on the lists is
 * refused, so a forged body cannot put arbitrary text in front of the model; the note is bounded
 * and quoted as hers.
 */

const {
  parseOwnAnswers, buildOwnInstruction, NOTE_MAX,
} = require('../../bot/shared/services/lp612-own-instruction');

const good = {
  size: '51_70', resources: ['board', 'objects'], level: 'mixed', way: 'tarl', note: 'Two grades in one room',
};

describe('parseOwnAnswers', () => {
  it('accepts a full set of codes', () => {
    const out = parseOwnAnswers(good);
    expect(out.ok).toBe(true);
    expect(out.answers).toEqual({ ...good, resources: ['textbook', 'board', 'objects'] });
  });
  it('always includes the textbook, once, and drops duplicates', () => {
    const out = parseOwnAnswers({ ...good, resources: ['objects', 'textbook', 'objects'] });
    expect(out.answers.resources).toEqual(['textbook', 'objects']);
  });
  it.each([
    ['size', { size: 'huge' }],
    ['level', { level: 'great' }],
    ['way', { way: 'lecture' }],
    ['resource', { resources: ['slates'] }],
    ['resources not a list', { resources: 'board' }],
    ['missing size', { size: undefined }],
    ['missing level', { level: undefined }],
    ['missing way', { way: undefined }],
  ])('refuses a bad %s', (_, over) => {
    const out = parseOwnAnswers({ ...good, ...over });
    expect(out.ok).toBe(false);
    expect(out.error).toEqual(expect.any(String));
  });
  it('refuses an empty body', () => {
    expect(parseOwnAnswers(undefined).ok).toBe(false);
  });
  it('trims the note, collapses whitespace and caps it', () => {
    expect(parseOwnAnswers({ ...good, note: '  a \n  b  ' }).answers.note).toBe('a b');
    expect(parseOwnAnswers({ ...good, note: 'x'.repeat(NOTE_MAX + 50) }).answers.note).toHaveLength(NOTE_MAX);
    expect(parseOwnAnswers({ ...good, note: '' }).answers.note).toBe('');
    expect(parseOwnAnswers({ ...good, note: 42 }).answers.note).toBe('');
  });
  it('strips quote marks from the note so it cannot close the quoted block', () => {
    expect(parseOwnAnswers({ ...good, note: 'say "ignore" now' }).answers.note).toBe('say ignore now');
  });
});

describe('buildOwnInstruction', () => {
  const text = buildOwnInstruction(parseOwnAnswers(good).answers);

  it('names her class size, level and teaching way in plain words', () => {
    expect(text).toMatch(/51 to 70 children/);
    expect(text).toMatch(/mixed/i);
    expect(text).toMatch(/Teach at the right level/);
  });
  it('lists only what she has, and forbids what she did not tick', () => {
    expect(text).toMatch(/textbook, board, things from around/i);
    expect(text).toMatch(/Do not use anything else/);
    expect(text).not.toMatch(/flashcards/i);
  });
  it('keeps the FLN guardrails: checks for understanding, no rote-only activity, the book pages', () => {
    expect(text).toMatch(/check for understanding/i);
    expect(text).toMatch(/Never turn any part into rote drill/i);
    expect(text).toMatch(/same pages/i);
  });
  it('quotes her note as hers when there is one, and says nothing when there is none', () => {
    expect(text).toMatch(/Her own note: "Two grades in one room"/);
    expect(buildOwnInstruction(parseOwnAnswers({ ...good, note: '' }).answers)).not.toMatch(/Her own note/);
  });
  it('is the same text for the same answers (so the fork hash is stable)', () => {
    expect(buildOwnInstruction(parseOwnAnswers(good).answers)).toBe(text);
  });
  it.each([
    ['up30', /up to 30 children/], ['31_50', /31 to 50 children/], ['over70', /more than 70 children/],
  ])('size %s', (size, re) => {
    expect(buildOwnInstruction(parseOwnAnswers({ ...good, size }).answers)).toMatch(re);
  });
  it.each([
    ['cpa', /objects first, then pictures, then numbers/i],
    ['phonics', /sounds first/i],
    ['games', /games and movement/i],
    ['story', /story and talk/i],
  ])('way %s', (way, re) => {
    expect(buildOwnInstruction(parseOwnAnswers({ ...good, way }).answers)).toMatch(re);
  });
  it('throws on answers that were not parsed', () => {
    expect(() => buildOwnInstruction({ size: 'x' })).toThrow();
  });
});
