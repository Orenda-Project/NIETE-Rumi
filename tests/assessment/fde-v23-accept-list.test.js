/**
 * bd-5jmnfj.4.51.4 — v23 G1 English accept lists.
 *   Q13 i  accept ["Good morning","Good morning."]  -> Hello / Assalam-o-Alaikum must pass too.
 *   Q13 ii accept ["Sorry","Sorry.","I am sorry."]  -> "Sorry" printed twice.
 *   Q8     asks for the -ing word, accept ["running","run"] -> "run" contradicts the question.
 * Rows are the real v23 g1-english-exam.json shapes. Goes through normaliseScheme.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

const { normaliseScheme } = require('../../bot/shared/services/assessment/marking-scheme');
const Patterns = require('../../bot/shared/services/assessment/patterns');

const G1 = () => Patterns.get('fde_g1_2026').subjects.english;

const q13 = (answer, accept, common_error) => ({
  slot: 'g1.english.C.Q13', lines: 1, marks: 2, answer, blooms: 'Apply',
  scheme: { accept, points: [{ kind: 'K', text: 'Writes the correct words', marks: 2 }], checked: null, common_error },
  question: 'What will they say?',
});
const q8 = (answer, accept) => ({
  slot: 'g1.english.B.Q8', lines: 1, marks: 1, answer, blooms: 'Understand',
  scheme: { accept, points: [{ kind: 'A', text: 'correct -ing action word', marks: 1 }], checked: null, common_error: 'Writing a different action' },
  question: 'What is the child doing?',
});
function run(slotKey, items, type) {
  const exam = { _layout: { v: 2, subject: 'english', sections: G1().sections }, unseen: { subjective: { [type]: items } } };
  return normaliseScheme(exam).examJson.unseen.subjective[type];
}
const lower = (l) => l.map((a) => a.toLowerCase().replace(/[.!]+$/, ''));

describe('Q13 greetings', () => {
  test('i: a meeting greeting also accepts Hello and Assalam-o-Alaikum, once each', () => {
    const [row] = run('q13', [q13('Good morning.', ['Good morning', 'Good morning.'], 'Writes Good night or another greeting')], 'Speech Bubbles');
    const got = lower(row.scheme.accept);
    expect(got).toEqual(expect.arrayContaining(['good morning', 'hello', 'assalam-o-alaikum']));
    expect(new Set(got).size).toBe(got.length);
  });

  test('ii: "Sorry" and "Sorry." are one entry, "I am sorry." stays', () => {
    const [row] = run('q13', [q13('Sorry.', ['Sorry', 'Sorry.', 'I am sorry.'], 'Writes Thank you instead of saying sorry')], 'Speech Bubbles');
    expect(lower(row.scheme.accept)).toEqual(['sorry', 'i am sorry']);
  });

  test('a sorry key is not widened with hello', () => {
    const [row] = run('q13', [q13('Sorry.', ['Sorry'], 'x')], 'Speech Bubbles');
    expect(lower(row.scheme.accept)).not.toContain('hello');
  });

  test('a thank-you key is not widened with hello either', () => {
    const [row] = run('q13', [q13('Thank you.', ['Thank you'], 'x')], 'Speech Bubbles');
    expect(lower(row.scheme.accept)).not.toContain('hello');
  });
});

describe('dedupe', () => {
  test('case-insensitive, trailing full stop ignored, first spelling kept', () => {
    const [row] = run('q13', [q13('Thank you.', ['Thank you', 'thank you.', 'THANK YOU', 'Thanks'], 'x')], 'Speech Bubbles');
    expect(row.scheme.accept).toEqual(['Thank you', 'Thanks']);
  });
});

describe('Q8 -ing questions', () => {
  test('the base verb leaves accept even when the common error does not name it (v23)', () => {
    const rows = run('q8', [q8('running', ['running', 'run']), q8('jumping', ['jumping', 'jump']), q8('reading', ['reading', 'read']), q8('swimming', ['swimming', 'swim'])], 'Action Words');
    expect(rows.map((r) => r.scheme.accept)).toEqual([['running'], ['jumping'], ['reading'], ['swimming']]);
  });

  test('a spelling variant that still ends in -ing stays', () => {
    const [row] = run('q8', [q8('swimming', ['swimming', 'swiming'])], 'Action Words');
    expect(row.scheme.accept).toEqual(['swimming', 'swiming']);
  });
});

describe('the writer is not told to accept the base verb', () => {
  test('g1.english.B.Q8 rule no longer says accept lists the plain word', () => {
    const slot = G1().sections.flatMap((s) => s.slots).find((s) => s.slot === 'g1.english.B.Q8');
    expect(slot.prompt_rule).not.toMatch(/accept lists the plain word/i);
  });
});
