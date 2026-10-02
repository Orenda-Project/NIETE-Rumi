/**
 * Child test L15 (bd-s1oo0.20) — why the simulation scored worse than L5's offline eval.
 *
 * On the same five fixtures the bot's marks matched L5's field by field; the gap was in what the
 * sim compared them with:
 *   1. real quick sums: the key is the May test's level-1 sums ("1+4 = 5", …) while the bot scores
 *      the bank's m3A sums (1 + 1, 2 - 1, …) — two different answer lists, so the count is not
 *      comparable (the same reason May made-up words and numbers are already skipped);
 *   2. fallback parts the composite does not hold: L8's key carries the enumerator's letters AND
 *      words counts even when only one of them (or neither) was cut into the note — build_real.py
 *      now writes `null` for a part with no cut, and a null part is not compared;
 *   3. a story key the recording contradicts (`key_quality: 'contested'`) stays in per_session but
 *      out of the story counts and the per-word precision / recall.
 *
 * Pure functions; nothing mocked.
 */
const { compareSession, summarise } = require('../../../scripts/child-test/score-run-compare');

const MAY_QS = ['1+4 = 5', '2+2 = 4', '3+3 = 6', '6+4 = 10', '5+5 = 10', '5-1 = 4', '4-2 = 2', '6-3 = 3'];

const ai = (over = {}) => ({
  urdu: { story: { words_correct: 59, words_attempted: 60, confidence: 0.9, flagged: [] }, questions: [], first_sounds: [], nonwords: [], protocol_flags: [], meta: {}, ...over.urdu },
  english: { story: { words_correct: 30, words_attempted: 31, confidence: 0.9, flagged: [] }, questions: [], nonwords: [], protocol_flags: [], meta: {}, ...over.english },
  maths: { maths: { numbers: [], quick_sums: { correct: 16, attempted: 20, confidence: 0.7 }, written: [], word_problem: null }, protocol_flags: [], meta: {} },
});

const blocksOf = (marks) => Object.fromEntries(Object.entries(marks).map(([b, m]) => [b, { ai_marks: m, coach_marks: null, ai_status: 'scored' }]));

const realKey = (over = {}) => ({
  fixture_id: 'AA_x', kind: 'real', grade: 3, form: 'A', cut_quality: { urdu: 'ok', english: 'ok', maths: 'ok' },
  blocks: {
    urdu: { story: { words_correct: 58, words_attempted: 60, flagged: [], key_quality: 'exact' }, fallback: null, questions: [] },
    english: { story: { words_correct: 29, words_attempted: 31, flagged: [], key_quality: 'exact' }, questions: [], nonwords: [] },
    maths: { maths: { numbers: [], quick_sums: { correct: 10, attempted: 11, seconds: 60, items: MAY_QS }, written: null, word_problem: null } },
    ...over,
  },
});

describe('L15: the sim compares only what the key and the bot share', () => {
  test('real quick sums keyed on May items are not compared with the bank-scored count', () => {
    const out = compareSession({ session: { id: 's', grade: 3, form: 'A' }, blocks: blocksOf(ai()), key: realKey() });
    expect(out.quick_sums).toEqual([]);
  });

  test('quick sums keyed on bank items (synthetic) are still compared', () => {
    const k = realKey({ maths: { maths: { numbers: [], quick_sums: { correct: 14, attempted: 20, items: [{ id: 'm3A-qs1', answer: 2, verdict: 'correct' }] }, written: null, word_problem: null } } });
    k.kind = 'synthetic';
    const out = compareSession({ session: { id: 's', grade: 3, form: 'A' }, blocks: blocksOf(ai()), key: k });
    expect(out.quick_sums).toEqual([{ source: 'ai', ai: 16, key: 14, conf: 0.7 }]);
  });

  test('a fallback part the key has no audio for (null) is not compared; the cut part is', () => {
    const fb = { letters: { correct: 9, of: 10 }, words: { correct: 0, of: 10 }, confidence: 0.5 };
    const marks = ai({ urdu: { story: null, fallback: fb }, english: { story: null, fallback: { letters: { correct: 0, of: 10 }, words: { correct: 0, of: 10 } } } });
    const k = realKey({
      urdu: { story: null, fallback: { letters: { correct: 8, of: 10 }, words: null }, questions: [] },
      english: { story: null, fallback: { letters: null, words: null }, questions: [], nonwords: [] },
    });
    const out = compareSession({ session: { id: 's', grade: 3, form: 'A' }, blocks: blocksOf(marks), key: k });
    expect(out.fallback).toEqual([{ source: 'ai', block: 'urdu', part: 'letters', ai: 9, key: 8 }]);
    const s = summarise([out]);
    expect(s.fallback.letters.ai).toMatchObject({ n: 1, mae: 1 });
    expect(s.fallback.words.ai.n || 0).toBe(0);
  });

  test('a contested story key is listed but kept out of the story counts and per-word P/R', () => {
    const contested = realKey({
      urdu: { story: { words_correct: 11, words_attempted: 60, flagged: [{ idx: 1 }, { idx: 2 }, { idx: 3 }], key_quality: 'contested', contested_reason: 'stt hears 45 of 60' }, fallback: null, questions: [] },
    });
    contested.fixture_id = 'AA_bad';
    const fine = realKey();
    const per = [
      compareSession({ session: { id: 's1', grade: 3, form: 'A' }, blocks: blocksOf(ai()), key: contested }),
      compareSession({ session: { id: 's2', grade: 3, form: 'A' }, blocks: blocksOf(ai()), key: fine }),
    ];
    expect(per[0].story.find((r) => r.block === 'urdu').key_quality).toBe('contested');
    const s = summarise(per);
    expect(s.story.urdu.ai).toMatchObject({ n: 1, mae: 1 });
    expect(s.story.urdu.ai_words.recall).toBeNull();
    expect(s.story.urdu.contested).toEqual(['AA_bad']);
    expect(s.story.english.ai).toMatchObject({ n: 2 });
  });
});
