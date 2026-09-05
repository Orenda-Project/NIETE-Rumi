'use strict';
/**
 * The digest's SLO statements reach the teacher's PDF ("what this quiz checks")
 * and the class report verbatim. A real staging PDF printed "فیکشن کی تعریف
 * بیان کر سکیں" — the transcript's transliteration copied into the goal line,
 * while every question below it said "Fraction". The same fixer that cleans
 * the questions cleans the digest.
 */
const { normaliseDigest } = require('../../bot/shared/services/quiz/transcript-quiz-digest.service');

test('transliterated English terms in SLO statements and the as-taught topic are written in English letters', () => {
  const d = normaliseDigest({
    topic: 'Proper fraction', topic_as_taught: 'پروپر فیکشن', subject: 'maths', confidence: 0.9,
    slos: [{ id: 'S1', statement: 'فیکشن کی تعریف بیان کر سکیں', evidence_quote: 'x', taught_level: 'recall' },
           { id: 'S2', statement: 'نیومریٹر اور ڈینومینیٹر کی شناخت کر سکیں', evidence_quote: 'y', taught_level: 'recall' }],
    key_terms: [{ term: 'fraction', as_spoken: 'فیکشن' }],
  });
  expect(d.slos[0].statement).toMatch(/fraction/i);
  expect(d.slos[0].statement).not.toMatch(/فیکشن/);
  expect(d.slos[1].statement).toMatch(/numerator/i);
  expect(d.topic_as_taught).toMatch(/proper fraction/i);
  // What was SPOKEN stays as spoken — that is the record of the lesson.
  expect(d.key_terms[0].as_spoken).toBe('فیکشن');
});

/**
 * Round 4, lane E. Ten real prod lessons were seeded onto staging and digested;
 * FOUR of the ten came back with the as-taught topic written in Urdu letters —
 * the exact thing the digest prompt forbids and the fixer exists to undo. The
 * round-3 table was written from a maths-only corpus, so science and geometry
 * walked straight through it, and a whole English phrase ("structure of an
 * atom") is not a term the table can ever hold.
 *
 * topicFor(digest,'ur') returns topic_as_taught, so each of these was what the
 * teacher read on the offer, on the /quiz row, on the PDF hero and on the
 * report header.
 */
describe('as-taught topics from the seeded real lessons (2026-09-06)', () => {
  const asTaught = (topic_as_taught, topic) => normaliseDigest({
    topic, topic_as_taught, subject: 'science', confidence: 0.9,
    slos: [{ id: 'S1', statement: 's', evidence_quote: 'q', taught_level: 'recall' }],
  }).topic_as_taught;

  test('a whole English phrase in Urdu letters falls back to the clean English label', () => {
    // "اسٹرکچر آف این ایٹم" — آف is not an Urdu word, it is "of" inside an
    // English phrase, so the run is a transliteration, not Urdu.
    const out = asTaught('اسٹرکچر آف این ایٹم', 'Structure of an Atom');
    expect(out).toBe('Structure of an Atom');
    expect(out).not.toMatch(/آف/);
  });

  test('electric circuit is written in English letters', () => {
    const out = asTaught('الیکٹرک سرکٹ', 'Electric Circuit');
    expect(out).toMatch(/electric circuit/i);
    expect(out).not.toMatch(/الیکٹرک|سرکٹ/);
  });

  test('radius and diameter are written in English letters, and the Urdu around them survives', () => {
    const out = asTaught('circle، ریڈیس، اور ڈائی میٹر', 'Circle, Radius, and Diameter');
    expect(out).toMatch(/radius/i);
    expect(out).toMatch(/diameter/i);
    expect(out).not.toMatch(/ریڈیس|ڈائی میٹر/);
    expect(out).toMatch(/اور/);        // a genuine Urdu word is not touched
  });

  test('proper / improper / mixed are written in English letters when they stand alone', () => {
    const out = asTaught('fractions, پراپر fraction, امپراپر fraction, مکس fraction', 'Fractions and Their Types');
    expect(out).toMatch(/improper/i);
    expect(out).toMatch(/proper/i);
    expect(out).toMatch(/mixed/i);
    expect(out).not.toMatch(/پراپر|امپراپر|مکس/);
  });

  test('a genuinely Urdu topic is left exactly as it is', () => {
    // The other six of the ten. If the fixer ever reaches into real Urdu, this
    // is what it breaks first.
    expect(asTaught('کینجر جھیل کی لوک کہانی', 'Kinjhar Lake folk tale')).toBe('کینجر جھیل کی لوک کہانی');
    expect(asTaught('نقشوں کی اقسام', 'Types of Maps')).toBe('نقشوں کی اقسام');
  });
});
