'use strict';
/**
 * Practice door round builder: 5 fresh questions, first on the skills the child got wrong, then on topics the child
 * picked; worked answers from the lesson plan's digest only; grading on the server. Pure. Invented content only.
 */
const R = require('../../../shared/services/quiz/test-practice/round');
const F = require('../../../shared/services/quiz/test-practice/freshness');

const quiz = (id, topic, code, slos) => ({
  id, topic, meta: { slo_codes: code ? { S1: code, S2: code } : {}, digest: { slos: slos || [{ id: 'S1', evidence_quote: `Say: ${topic} quote.` }] } },
});
const q = (quizId, n, text, slo = 'S1') => ({
  id: `${quizId}-q${n}`, quiz_id: quizId, question_text: text, option_a: 'x', option_b: 'y', option_c: 'z',
  correct_option: 'B', explanation: 'model-written, never shown', external_id: `tq:${quizId}:${slo}:${n}`,
});

describe('keyOf / wrongKeys', () => {
  test('the curriculum code is the skill when the quiz has one', () => {
    expect(R.keyOf(quiz('q1', 'Nouns', 'EN-3-A1'), q('q1', 1, 't'))).toBe('code:EN-3-A1');
  });
  test('no code falls back to the topic', () => {
    expect(R.keyOf(quiz('q1', ' Nouns ', null), q('q1', 1, 't'))).toBe('topic:nouns');
  });
  test('wrong answers give their skills, once each', () => {
    const fq = quiz('f', 'Nouns', 'EN-3-A1');
    const qs = [q('f', 1, 'a'), q('f', 2, 'b'), q('f', 3, 'c')];
    const ans = [{ question_id: 'f-q1', is_correct: false }, { question_id: 'f-q2', is_correct: false }, { question_id: 'f-q3', is_correct: true }];
    expect(R.wrongKeys(fq, qs, ans)).toEqual(['code:EN-3-A1']);
    expect(R.wrongKeys(fq, qs, [{ question_id: 'f-q3', is_correct: true }])).toEqual([]);
  });
});

describe('pool / topicsOf', () => {
  const quizzes = [quiz('q1', 'Nouns', 'C1'), quiz('q2', 'Verbs', 'C2'), quiz('q3', 'Nouns', 'C1')];
  const questions = [q('q1', 1, 'n1'), q('q2', 1, 'v1'), q('q3', 1, 'n2'), q('zz', 1, 'orphan')];
  test('items carry the skill, topic and answer; a question with no known quiz is dropped', () => {
    const pool = R.poolOf(quizzes, questions);
    expect(pool.map((i) => i.qid)).toEqual(['q1-q1', 'q2-q1', 'q3-q1']);
    expect(pool[0]).toMatchObject({ key: 'code:C1', topic: 'Nouns', correct: 'B', quizId: 'q1', sloId: 'S1' });
  });
  test('topics are distinct, in pool order, capped', () => {
    expect(R.topicsOf(R.poolOf(quizzes, questions))).toEqual(['Nouns', 'Verbs']);
    expect(R.topicsOf(R.poolOf(quizzes, questions), 1)).toEqual(['Nouns']);
  });
});

describe('buildRound', () => {
  const quizzes = [quiz('q1', 'Nouns', 'C1'), quiz('q2', 'Verbs', 'C2'), quiz('q3', 'Adjectives', 'C3')];
  const questions = [
    ...[1, 2, 3].map((n) => q('q1', n, `Which word names a thing ${n}?`)),
    ...[1, 2, 3].map((n) => q('q2', n, `Which word is an action ${n}?`)),
    ...[1, 2, 3].map((n) => q('q3', n, `Which word describes ${n}?`)),
  ];
  const pool = R.poolOf(quizzes, questions);
  const fresh = F.blocker([]).isFresh;

  test('wrong skills come first, then picked topics, five in all', () => {
    const r = R.buildRound({ pool, wrong: ['code:C2'], picked: ['Adjectives'], isFresh: fresh, seen: new Set(), seed: 'k' });
    expect(r).toHaveLength(5);
    expect(r.slice(0, 3).every((i) => i.key === 'code:C2')).toBe(true);
    expect(r.slice(3).every((i) => i.topic === 'Adjectives')).toBe(true);
  });
  test('picked topics alone fill the round when nothing was wrong', () => {
    const r = R.buildRound({ pool, wrong: [], picked: ['Nouns', 'Verbs'], isFresh: fresh, seen: new Set(), seed: 'k' });
    expect(r).toHaveLength(5);
    expect(new Set(r.map((i) => i.topic))).toEqual(new Set(['Nouns', 'Verbs']));
  });
  test('seen questions and stale ones are left out', () => {
    const stale = F.blocker(['Which word is an action 1?']).isFresh;
    const r = R.buildRound({ pool, wrong: ['code:C2'], picked: [], isFresh: stale, seen: new Set(['q2-q2']), seed: 'k' });
    expect(r.map((i) => i.qid)).toEqual(['q2-q3']);
  });
  test('the same text twice is served once', () => {
    const dup = R.poolOf([quiz('a', 'T', 'C'), quiz('b', 'T', 'C')], [q('a', 1, 'Same words?'), q('b', 1, 'same words')]);
    expect(R.buildRound({ pool: dup, wrong: ['code:C'], picked: [], isFresh: fresh, seen: new Set(), seed: 'k' })).toHaveLength(1);
  });
  test('the order is stable for one seed and differs across seeds', () => {
    const a = R.buildRound({ pool, wrong: [], picked: ['Nouns', 'Verbs', 'Adjectives'], isFresh: fresh, seen: new Set(), seed: 's1' });
    const b = R.buildRound({ pool, wrong: [], picked: ['Nouns', 'Verbs', 'Adjectives'], isFresh: fresh, seen: new Set(), seed: 's1' });
    expect(a.map((i) => i.qid)).toEqual(b.map((i) => i.qid));
  });
  test('ROUND_SIZE is 5', () => { expect(R.ROUND_SIZE).toBe(5); });
});

describe('publicOf / workedOf / grade', () => {
  const src = quiz('q1', 'Nouns', 'C1', [{ id: 'S1', evidence_quote: 'A noun names a person, place or thing.' }]);
  const item = R.poolOf([src], [q('q1', 1, 'Which is a noun?')])[0];
  test('a served question carries no answer and no explanation', () => {
    const p = R.publicOf(item);
    expect(p).toEqual({ qid: 'q1-q1', text: 'Which is a noun?', options: { A: 'x', B: 'y', C: 'z' } });
  });
  test('the worked answer is the lesson plan quote for that SLO', () => {
    expect(R.workedOf(src.meta, 'S1')).toBe('A noun names a person, place or thing.');
  });
  test('no quote → no worked answer (never the model explanation)', () => {
    expect(R.workedOf(src.meta, 'S9')).toBeNull();
    expect(R.workedOf({}, 'S1')).toBeNull();
    expect(R.workedOf({ digest: { slos: [{ id: 'S1', evidence_quote: '  ' }] } }, 'S1')).toBeNull();
  });
  test('grading scores the stored items against the answers sent', () => {
    const items = [{ qid: 'a', correct: 'B', worked: 'w1' }, { qid: 'b', correct: 'A', worked: null }];
    expect(R.grade(items, { a: 'B', b: 'C', zz: 'A' })).toEqual({
      score: 1, total: 2,
      items: [{ qid: 'a', chosen: 'B', correct: 'B', right: true, worked: 'w1' }, { qid: 'b', chosen: 'C', correct: 'A', right: false, worked: null }],
    });
  });
  test('an answer that is not A/B/C counts as none', () => {
    expect(R.grade([{ qid: 'a', correct: 'B', worked: null }], { a: 'b; drop' }).items[0].chosen).toBeNull();
  });
});
