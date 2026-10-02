/**
 * Child test L14 (bd-s1oo0.18) — the simulation scores itself.
 *
 * L5's comparison functions (story rows, item rows, count stats, agreement) are factored out of
 * scripts/child-test/eval-scoring.js into scripts/child-test/eval-compare.js so the sim scorer
 * (sim/score_run.py → scripts/child-test/score-run-compare.js) reuses them instead of a second
 * implementation. compareSession is the glue: one session's ai_marks / coach_marks per block against
 * the fixture's key (strip key merged into maths), plus the pre-fill count from coach_marks.meta.
 *
 * Pure functions; nothing mocked.
 */
const C = require('../../../scripts/child-test/eval-compare');
const { compareSession, mergeStripKey, prefillOf, summarise } = require('../../../scripts/child-test/score-run-compare');

const keyStory = { words_correct: 34, words_attempted: 40, flagged: [{ idx: 3 }, { idx: 7 }], key_quality: 'exact' };

describe('eval-compare: L5 functions, now importable', () => {
  test('eval-scoring.js uses the shared module (no second copy of the comparisons)', () => {
    const src = require('fs').readFileSync(require.resolve('../../../scripts/child-test/eval-scoring'), 'utf8');
    expect(src).toMatch(/require\('\.\/eval-compare'\)/);
    expect(src).not.toMatch(/^function (storyRow|itemRows|stats|agreement)\(/m);
  });

  test('storyRow: counts and per-word tp/fp/fn on the words both reached', () => {
    const rec = { id: 'k1', block: 'urdu', aiMarks: { protocol_flags: [], story: { words_correct: 30, words_attempted: 40, confidence: 0.5, flagged: [{ idx: 3, confidence: 0.9 }, { idx: 5, confidence: 0.4 }] } } };
    const r = C.storyRow(rec, keyStory, 'real');
    expect(r).toMatchObject({ key_correct: 34, ai_correct: 30, ai_conf: 0.5, tp: 1, fp: 1, fn: 1, tpChip: 1, fpChip: 0 });
  });

  test('itemRows: none counts as wrong; a missing AI item is "missing"; written items read from maths', () => {
    const rec = { id: 'k1', block: 'urdu', aiMarks: { questions: [{ id: 'q1', verdict: 'none', confidence: 0.8 }], maths: { written: [{ id: 'w1', verdict: 'blank', confidence: 0.9 }] } } };
    const q = C.itemRows(rec, [{ id: 'q1', verdict: 'wrong' }, { id: 'q2', verdict: 'correct' }, { id: 'q3', verdict: null }], 'questions', 'real');
    expect(q.map((x) => [x.item, x.ai, x.key])).toEqual([['q1', 'wrong', 'wrong'], ['q2', 'missing', 'correct']]);
    const w = C.itemRows(rec, [{ id: 'w1', verdict: 'blank' }], 'written', 'strip');
    expect(w[0]).toMatchObject({ ai: 'blank', key: 'blank', conf: 0.9 });
  });

  test('stats + agreement as L5 reports them', () => {
    expect(C.stats([{ ai: 10, key: 12 }, { ai: 20, key: 20 }])).toMatchObject({ n: 2, mae: 1, bias: -1, within1: 50, within3: 100, exact: 50 });
    expect(C.agreement([{ ai: 'wrong', key: 'wrong' }, { ai: 'correct', key: 'wrong' }, { ai: 'missing', key: 'wrong' }])).toEqual({ n: 2, missing: 1, agree: 50 });
  });

  test('tolerance: L5\'s evaluation bands (story ±5, quick sums ±3, fallback ±3), items exact after none→wrong', () => {
    expect(C.withinTolerance('story.words_correct', 41, 36)).toBe(true);
    expect(C.withinTolerance('story.words_correct', 42, 36)).toBe(false);
    expect(C.withinTolerance('maths.quick_sums.correct', 9, 12)).toBe(true);
    expect(C.withinTolerance('maths.quick_sums.correct', 8, 12)).toBe(false);
    expect(C.withinTolerance('fallback.letters', 4, 7)).toBe(true);
    expect(C.verdictAgrees('questions', 'none', 'wrong')).toBe(true);
    expect(C.verdictAgrees('questions', 'correct', 'wrong')).toBe(false);
    expect(C.verdictAgrees('maths.written', 'blank', 'unreadable')).toBe(false);
  });
});

describe('score-run-compare: one session against its key', () => {
  const key = {
    fixture_id: 'AA_x', kind: 'real', grade: 3, form: 'A', cut_quality: { urdu: 'ok', english: 'ok', maths: 'ok' },
    blocks: {
      urdu: { story: keyStory, fallback: null, questions: [{ id: 'u3A-q1', verdict: 'correct' }, { id: 'u3A-q2', verdict: 'wrong' }], first_sounds: null, nonwords: null },
      english: { story: { words_correct: 10, words_attempted: 12, flagged: [] }, questions: [], nonwords: [{ id: 'may-pw_eng-1', verdict: 'wrong' }] },
      maths: { maths: { numbers: [], quick_sums: { correct: 10, attempted: 11 }, written: null, word_problem: null } },
    },
  };
  const strip = { strip_id: 'strip-g3-00-d1', written: [{ id: 'm3A-w1', verdict: 'blank' }, { id: 'm3A-w2', verdict: 'wrong' }], word_problem: { id: 'm3A-wp', verdict: 'correct' } };
  const ai = {
    urdu: { story: { words_correct: 28, words_attempted: 40, confidence: 0.4, flagged: [{ idx: 3, confidence: 0.5 }] }, questions: [{ id: 'u3A-q1', verdict: 'correct', confidence: 0.9 }, { id: 'u3A-q2', verdict: 'correct', confidence: 0.5 }], first_sounds: [], nonwords: [], protocol_flags: [], meta: { cost_usd: 0.03 } },
    english: { story: { words_correct: 11, words_attempted: 12, confidence: 0.8, flagged: [] }, questions: [], nonwords: [], protocol_flags: [], meta: { cost_usd: 0.04 } },
    maths: { maths: { numbers: [], quick_sums: { correct: 5, attempted: 11, confidence: 0.7 }, written: [{ id: 'm3A-w1', verdict: 'blank', confidence: 0.95 }, { id: 'm3A-w2', verdict: 'correct', confidence: 0.9 }], word_problem: { verdict: 'correct', confidence: 0.9 } }, protocol_flags: [], meta: { cost_usd: 0.015 } },
  };
  const coach = {
    urdu: { story: { words_correct: 34, words_attempted: 40, flagged: [{ idx: 3 }, { idx: 7 }] }, questions: [{ id: 'u3A-q1', verdict: 'correct' }, { id: 'u3A-q2', verdict: 'wrong' }], first_sounds: [], nonwords: [],
      meta: { shown_empty: ['story.words_correct', 'story.words_attempted', 'questions[u3A-q2]'] } },
    english: { story: { words_correct: 11, words_attempted: 12, flagged: [] }, questions: [], nonwords: [], meta: { shown_empty: [] } },
    maths: { maths: { numbers: [], quick_sums: { correct: 10, attempted: 11 }, written: [{ id: 'm3A-w1', verdict: 'blank' }, { id: 'm3A-w2', verdict: 'correct' }], word_problem: { verdict: 'correct' } }, meta: { shown_empty: ['maths.quick_sums'] } },
  };

  test('mergeStripKey puts the strip\'s written key into the maths block', () => {
    const k = mergeStripKey(key, strip);
    expect(k.blocks.maths.maths.written.map((w) => w.id)).toEqual(['m3A-w1', 'm3A-w2']);
    expect(k.blocks.maths.maths.word_problem.verdict).toBe('correct');
    expect(key.blocks.maths.maths.written).toBeNull();   // the fixture key is not mutated
  });

  test('prefillOf counts the fields the coach saw and the ones that arrived empty', () => {
    expect(prefillOf(coach.urdu)).toEqual({ fields: 4, shown_empty: 3, prefilled: 1 });
    expect(prefillOf(coach.maths)).toEqual({ fields: 4, shown_empty: 1, prefilled: 3 });
  });

  test('compareSession: AI vs key and coach vs key per field, grade check, cost', () => {
    const blocks = Object.fromEntries(['urdu', 'english', 'maths'].map((b) => [b, { ai_marks: ai[b], coach_marks: coach[b] }]));
    const out = compareSession({ session: { id: 's1', grade: 3, form: 'A' }, blocks, key: mergeStripKey(key, strip) });
    expect(out.grade_ok).toBe(true);
    const urduAi = out.story.find((r) => r.block === 'urdu' && r.source === 'ai');
    const urduCoach = out.story.find((r) => r.block === 'urdu' && r.source === 'coach');
    expect(urduAi).toMatchObject({ ai_correct: 28, key_correct: 34 });
    expect(urduCoach).toMatchObject({ ai_correct: 34, key_correct: 34 });
    const q2 = out.items.filter((r) => r.item === 'u3A-q2');
    expect(q2.map((r) => [r.source, r.ai, r.key])).toEqual([['ai', 'correct', 'wrong'], ['coach', 'wrong', 'wrong']]);
    const w2 = out.items.filter((r) => r.item === 'm3A-w2');
    expect(w2.map((r) => [r.source, r.field, r.ai])).toEqual([['ai', 'written', 'correct'], ['coach', 'written', 'correct']]);
    expect(out.items.some((r) => r.field === 'word_problem' && r.source === 'ai' && r.ai === 'correct' && r.key === 'correct')).toBe(true);
    expect(out.quick_sums).toEqual([{ source: 'ai', ai: 5, key: 10, conf: 0.7 }, { source: 'coach', ai: 10, key: 10, conf: null }]);
    expect(out.prefill).toEqual({ fields: 4 + 2 + 4, shown_empty: 4, prefilled: 6 });
    expect(out.cost_usd).toBeCloseTo(0.085, 5);
  });

  test('a session whose grade differs from the fixture is flagged and kept out of accuracy', () => {
    const blocks = { urdu: { ai_marks: ai.urdu, coach_marks: null } };
    const out = compareSession({ session: { id: 's2', grade: 5, form: 'A' }, blocks, key });
    expect(out.grade_ok).toBe(false);
    expect(out.story).toEqual([]);
    expect(out.items).toEqual([]);
  });

  test('summarise: per field AI vs key and coach vs key, with L5\'s stats', () => {
    const blocks = Object.fromEntries(['urdu', 'english', 'maths'].map((b) => [b, { ai_marks: ai[b], coach_marks: coach[b] }]));
    const s = summarise([compareSession({ session: { id: 's1', grade: 3, form: 'A' }, blocks, key: mergeStripKey(key, strip) })]);
    expect(s.story.urdu.ai).toMatchObject({ n: 1, mae: 6 });
    expect(s.story.urdu.coach).toMatchObject({ n: 1, mae: 0 });
    expect(s.items.questions.ai).toMatchObject({ n: 2, agree: 50 });
    expect(s.items.questions.coach).toMatchObject({ n: 2, agree: 100 });
    expect(s.items.written.ai).toMatchObject({ n: 2, agree: 50 });
    expect(s.quick_sums.ai).toMatchObject({ n: 1, mae: 5 });
    expect(s.prefill).toMatchObject({ fields: 10, prefilled: 6, rate: 0.6 });
  });
});
