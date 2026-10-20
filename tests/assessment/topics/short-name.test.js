'use strict';
/** Task 3 — teacher-facing topic names and id slugs. */
const { shortName, slugify, MAX_NAME } = require('../../../bot/shared/services/assessment/topics/short-name');

const cps = (s) => Array.from(s).length;

describe('shortName', () => {
  test('cap is 40 code points', () => {
    expect(MAX_NAME).toBe(40);
  });

  test('a short name is returned trimmed and unchanged', () => {
    expect(shortName('  Introducing Myself  ')).toBe('Introducing Myself');
  });

  test('a name of exactly 40 code points is not cut', () => {
    const s = 'abcd efgh ijkl mnop qrst uvwx yzab cdefg';
    expect(cps(s)).toBe(40);
    expect(shortName(s)).toBe(s);
  });

  test('cuts at a word boundary, never mid-word', () => {
    expect(shortName("Meet Pinky: Reading a Self-Introduction (Pinky's Day Out!)")).toBe('Meet Pinky: Reading a Self-Introduction');
    const out = shortName('Reading the News Report Pinky Cricket Play and Jojo Football Fun');
    expect(out).toBe('Reading the News Report Pinky Cricket');
    expect(cps(out)).toBeLessThanOrEqual(40);
  });

  test('trailing joiners and punctuation left by the cut are dropped', () => {
    expect(shortName("Reading 'Helping Hands at Dani's Hut!' + Sensory Comprehension")).toBe("Reading 'Helping Hands at Dani's Hut!'");
    expect(shortName('Before, After & Between: Skill Sharpener & Copy work extra')).toBe('Before, After & Between: Skill Sharpener');
    expect(shortName('Ordering numbers; comparing groups, making sets — more words')).toBe('Ordering numbers; comparing groups');
  });

  test('a cut inside a parenthesis drops the dangling "(" part', () => {
    expect(shortName('Punctuation Patrol: sentence endings (. ? !) and capitals')).toBe('Punctuation Patrol: sentence endings');
    expect(shortName('(Starting with a bracket that never closes at all here')).toBe('(Starting with a bracket that never');
    expect(shortName('Closed (a b) then a long tail of words that runs on')).toBe('Closed (a b) then a long tail of words');
  });

  test('a single over-long word is hard-cut at 40 code points', () => {
    const w = 'x'.repeat(55);
    expect(shortName(w)).toBe('x'.repeat(40));
  });

  test('strips a (Memory Lane)-style suffix that names the row section', () => {
    expect(shortName('Introducing Myself (Diving Deeper)', 'Diving Deeper')).toBe('Introducing Myself');
    expect(shortName('All About Me: Key Words (Memory Lane)', 'Memory Lane')).toBe('All About Me: Key Words');
    expect(shortName("Name It & Sort It (Imagination Canvas + Connect and Create)", 'Imagination Canvas + Connect and Create')).toBe('Name It & Sort It');
  });

  test('the suffix match is case-insensitive and piece-wise (+ and / split the section)', () => {
    expect(shortName('New Words (New words to know / Sound It Out!)', 'New Words To Know')).toBe('New Words');
    expect(shortName('Spelling (Imagination Canvas)', 'Imagination Canvas + Brain Break')).toBe('Spelling');
  });

  test('a parenthesis that is not the section is kept', () => {
    expect(shortName("Meet Pinky (Pinky's Day Out!)", 'Journey Through the Text')).toBe("Meet Pinky (Pinky's Day Out!)");
    expect(shortName('Count Back on the Hopscotch (9 to 0)')).toBe('Count Back on the Hopscotch (9 to 0)');
  });

  test('a mid-string parenthesis matching the section is kept (only a suffix is stripped)', () => {
    expect(shortName('Words (Memory Lane) and more', 'Memory Lane')).toBe('Words (Memory Lane) and more');
  });

  test('Urdu: counted in code points, cut between words, diacritics stay on their letter', () => {
    const urdu = 'تخلیقی لکھائی — اپنا تعارف لکھنا (اور اسم کا تعارف) اور مزید الفاظ یہاں';
    const out = shortName(urdu);
    expect(cps(out)).toBeLessThanOrEqual(40);
    expect(urdu.startsWith(out)).toBe(true);
    expect(urdu.charAt(out.length)).toBe(' ');
    expect(out).toBe('تخلیقی لکھائی — اپنا تعارف لکھنا');
    expect(shortName('حمد – میرا خُدا')).toBe('حمد – میرا خُدا');
  });

  test('Urdu hard cut never leaves a combining mark without its letter', () => {
    const word = 'خُ'.repeat(25); // 50 code points, marks at odd positions
    const out = shortName(word);
    expect(cps(out)).toBeLessThanOrEqual(40);
    expect(/\p{M}$/u.test(out) || !/\p{M}/u.test(Array.from(word)[cps(out)] || '')).toBe(true);
    expect(/^\p{M}/u.test(Array.from(word).slice(cps(out)).join(''))).toBe(false);
  });

  test('empty or missing text gives an empty name', () => {
    expect(shortName('')).toBe('');
    expect(shortName(undefined)).toBe('');
  });
});

describe('slugify', () => {
  test('lowercases and joins words with single hyphens', () => {
    expect(slugify("All About Me: Key Words (Memory Lane)")).toBe('all-about-me-key-words-memory-lane');
  });

  test('keeps Urdu letters and their marks', () => {
    expect(slugify('حمد – میرا خُدا')).toBe('حمد-میرا-خُدا');
  });

  test('trims leading/trailing separators', () => {
    expect(slugify('  --Hello!!  ')).toBe('hello');
  });

  test('caps at 48 code points without a trailing hyphen', () => {
    const s = slugify('abcdefghij '.repeat(10));
    expect(Array.from(s).length).toBeLessThanOrEqual(48);
    expect(s.endsWith('-')).toBe(false);
    expect(s).toBe('abcdefghij-abcdefghij-abcdefghij-abcdefghij-abcd');
  });

  test('same text gives the same slug', () => {
    expect(slugify('Meet Pinky')).toBe(slugify('Meet Pinky'));
  });
});

describe('short-name edge cases', () => {
  test('empty pieces in the suffix or section never match', () => {
    expect(shortName('Words (Other / )', 'Memory Lane / ')).toBe('Words (Other / )');
  });

  test('a suffix naming the section among other words is dropped', () => {
    expect(shortName('Words (Memory Lane + Fun)', 'Memory Lane')).toBe('Words');
  });

  test('slugify of nothing is empty; a capped slug never ends in "-"', () => {
    expect(slugify(undefined)).toBe('');
    const s = slugify('abcdefghijk '.repeat(5));
    expect(s.endsWith('-')).toBe(false);
    expect(s).toHaveLength(47);
  });
});
