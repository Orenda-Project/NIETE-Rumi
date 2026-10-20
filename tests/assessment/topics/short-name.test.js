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
    expect(shortName('Ordering numbers; comparing groups, making sets — more words')).toBe('Ordering numbers');
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

describe('shortName: a cut never ends on a dangling word', () => {
  test('a cut falls back to the last clause separator at code point 15 or later', () => {
    expect(shortName('Echo the Sounds, Sameen Says & Guess the Mess (Speaking & Listening)')).toBe('Echo the Sounds, Sameen Says');
    expect(shortName('Echo/Bingo, Ball of Questions & Chain of Whispers (Speaking)')).toBe('Echo/Bingo, Ball of Questions');
    expect(shortName('Sentence Detective, Capitalise the Adventure & Questions Station')).toBe('Sentence Detective');
    expect(shortName("Pinky's Play (Role-Play), Reading with Attention & Discuss and Share")).toBe("Pinky's Play (Role-Play)");
    expect(shortName('Weave a Poem Together + Present and Share')).toBe('Weave a Poem Together');
  });

  test('a separator before code point 15 is ignored; the trailing connector is stripped instead', () => {
    expect(shortName('Hangman + segmenting unfamiliar words to spell')).toBe('Hangman + segmenting unfamiliar words');
    expect(shortName('Echo the Sounds, Sameen Says Hello Today More')).toBe('Echo the Sounds');
    expect(shortName('Echo the Sound, Sameen Says Hello Today More!')).toBe('Echo the Sound, Sameen Says Hello Today');
  });

  test('weak trailing words (using, between, that, when, while, which, about, as) are stripped too', () => {
    expect(shortName('Measure the mass of objects using non-standard units')).toBe('Measure the mass of objects');
    expect(shortName('Identify and differentiate between living and non-living')).toBe('Identify and differentiate');
    expect(shortName('Solve real-world word problems that involve money')).toBe('Solve real-world word problems');
    expect(shortName('Use unitary method for one object when the value is given')).toBe('Use unitary method for one object');
    expect(shortName('Read the whole story aloud slowly while pointing')).toBe('Read the whole story aloud slowly');
    expect(shortName('Find and name all the flat shapes which have four sides')).toBe('Find and name all the flat shapes');
    expect(shortName("Talk with your partner in class about Pinky's family")).toBe('Talk with your partner in class');
    expect(shortName('Count the coins one by one as fast as you can now')).toBe('Count the coins one by one as fast');
  });

  test('Urdu connector words are stripped from a cut', () => {
    expect(shortName('حروف تہجی کی پہچان اور آوازوں کو ملا کے الفاظ کی تشکیل کرنا')).toBe('حروف تہجی کی پہچان اور آوازوں کو ملا');
  });

  test('a name within 40 code points is never changed, even ending in a connector', () => {
    expect(shortName('ABC Order & the Articles a/an/the')).toBe('ABC Order & the Articles a/an/the');
    expect(shortName('Reading for the')).toBe('Reading for the');
  });

  test('stripping is case-insensitive and stops before the name would be empty', () => {
    expect(shortName('The of and or a an to in on for with at by from into the of')).toBe('The');
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
