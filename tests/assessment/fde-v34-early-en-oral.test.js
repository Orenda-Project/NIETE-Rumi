/**
 * v29 Grade 1-2 English oral (bd-5jmnfj.4.58.4, round 4):
 *   G1 read-aloud cat / sun / dog repeated written items: fde-oral-fresh-words only replaced Arabic words;
 *   the speaking rubrics scored "confidence"; the read-aloud rubric had no descriptors;
 *   the teacher sheet never said the child reads from the card.
 */

const { freshReadWords } = require('../../bot/shared/services/assessment/fde-oral-fresh-words');
const { answerRepeats } = require('../../bot/shared/services/assessment/fde-answer-repeats');
const { oralSheet } = require('../../bot/shared/services/assessment/fde-oral-sheet');
const g1 = require('../../bot/shared/services/assessment/patterns/early/g1-english');
const g2 = require('../../bot/shared/services/assessment/patterns/early/g2-english');

const G1 = require('./fixtures/fde-v34-g1-english.json');

const readWords = (ex) => ex._layout.oral.content.find((c) => c.id === 'read_aloud').items.map((i) => i.ask);
const oralFlags = (ex) => answerRepeats(ex).filter((f) => f.with.includes('oral'));

describe('English read-aloud words the paper prints', () => {
  test('the v29 G1 paper has read-aloud words flagged against the written paper', () => {
    expect(oralFlags(G1).length).toBeGreaterThan(0);
  });

  test('every flagged English read-aloud word is replaced by a fresh one', () => {
    const { examJson, notes } = freshReadWords(G1);
    expect(oralFlags(examJson)).toEqual([]);
    expect(notes.length).toBeGreaterThan(0);
    expect(readWords(examJson)).toHaveLength(6);
    expect(new Set(readWords(examJson)).size).toBe(6);
  });

  test('a word that was not flagged stays; the input is not changed', () => {
    const before = readWords(G1).slice();
    const { examJson } = freshReadWords(G1);
    expect(readWords(G1)).toEqual(before);
    const bad = new Set(oralFlags(G1).flatMap((f) => f.words));
    before.filter((w) => !bad.has(w)).forEach((w) => expect(readWords(examJson)).toContain(w));
  });

  test('the replacement is a plain lowercase word', () => {
    const { notes } = freshReadWords(G1);
    notes.forEach((n) => expect(n.now).toMatch(/^[a-z]{2,4}$/));
  });
});

const rubricOf = (subject, id) => subject.oral.tasks.find((t) => t.id === id).rubric;
const texts = (r) => r.map((x) => x.en).join(' | ');

describe('speaking and read-aloud rubrics use observable criteria', () => {
  test('no speaking rubric scores confidence, expression or standard English', () => {
    [g1, g2].forEach((s) => expect(texts(rubricOf(s, 'speaking'))).not.toMatch(/confiden|express|standard/i));
  });

  test('speaking rubrics still add up to 5 and carry an Urdu line each', () => {
    [g1, g2].forEach((s) => {
      const r = rubricOf(s, 'speaking');
      expect(r.reduce((n, x) => n + x.marks, 0)).toBe(5);
      r.forEach((x) => expect(x.ur.length).toBeGreaterThan(3));
    });
  });

  test('the G2 read-aloud rows carry descriptors for the marks they pay', () => {
    const r = rubricOf(g2, 'read_aloud');
    expect(r.reduce((n, x) => n + x.marks, 0)).toBe(10);
    r.forEach((x) => expect(x.en).toMatch(/\d/));
  });

  test('the listening and speaking prompts keep the story free of other children and item 5 about the story', () => {
    [g1, g2].forEach((s) => {
      const ask = s.oral.tasks.find((t) => t.id === 'listening').ask;
      expect(ask).toMatch(/never about the child/i);
      expect(ask).toMatch(/at most two names/i);
    });
  });
});

describe('the teacher sheet names the reading card', () => {
  const ctx = { medium: 'en', text: (s) => String(s == null ? '' : s) };
  const oral = { ...g1.oral, content: G1._layout.oral.content };
  test('the read-aloud block says the words are on the child card', () => {
    const html = oralSheet(oral, ctx);
    const block = html.split('data-task="read_aloud"')[1];
    expect(block).toMatch(/reading card/i);
  });
});
