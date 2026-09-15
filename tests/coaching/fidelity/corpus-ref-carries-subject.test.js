'use strict';
/**
 * The _fidelity_ref stub is the ONLY thing a corpus-linked session carries where a
 * lesson plan's structure would otherwise be — `lesson_plan_structured` is REPLACED
 * by `{_fidelity_ref:{lesson_id, content_hash, version_stamp}}`. It has no `subject`
 * key, so any consumer reading `lesson_plan_structured.subject` reads null on every
 * corpus-path session.
 *
 * The lesson_id itself encodes the subject (`grade_<n>_<subject>_ch<m>_seg<k>`), so
 * the ref can carry it forward at write time. `resolveFidelitySources` then hands it
 * on with the rest of the key.
 */
const { resolveCorpusRef } = require('../../../bot/shared/services/coaching/lp-coaching/lp-coaching-linker.service');
const { resolveFidelitySources } = require('../../../bot/shared/services/coaching/fidelity/fidelity-orchestrator');

function mockClient(result) {
  const calls = { eq: {} };
  const chain = {
    select() { return chain; },
    eq(c, v) { calls.eq[c] = v; return chain; },
    maybeSingle() { return Promise.resolve(result); },
  };
  return { calls, from(t) { calls.table = t; return chain; } };
}

describe('resolveCorpusRef carries the subject the lesson_id encodes', () => {
  test('a maths lesson id yields subject + grade alongside the version keys', async () => {
    const c = mockClient({
      data: { lesson_id: 'grade_5_math_ch5_seg3', version_stamp: 'v8', content_hash: 'h' },
      error: null,
    });
    const ref = await resolveCorpusRef('asset-uuid-1', c);
    expect(ref).toEqual({
      lesson_id: 'grade_5_math_ch5_seg3',
      version_stamp: 'v8',
      content_hash: 'h',
      subject: 'maths',
      grade: '5',
    });
  });

  test('a two-word subject token parses (general_science → science)', async () => {
    const c = mockClient({
      data: { lesson_id: 'grade_2_general_science_ch1_seg1', version_stamp: 'v8', content_hash: 'h' },
      error: null,
    });
    const ref = await resolveCorpusRef('a', c);
    expect(ref.subject).toBe('science');
    expect(ref.grade).toBe('2');
  });

  test('a lesson_id that does not parse leaves subject and grade null, never guessed', async () => {
    const c = mockClient({ data: { lesson_id: 'legacy-lp-7', version_stamp: 'v1', content_hash: 'h' }, error: null });
    const ref = await resolveCorpusRef('a', c);
    expect(ref.lesson_id).toBe('legacy-lp-7');
    expect(ref.subject).toBeNull();
    expect(ref.grade).toBeNull();
  });
});

describe('resolveFidelitySources passes the subject through to the fidelity meta', () => {
  test('a ref written after this change hands subject + grade on', () => {
    const r = resolveFidelitySources({
      lesson_plan_structured: {
        _fidelity_ref: { lesson_id: 'grade_4_urdu_ch8_seg3', subject: 'urdu', grade: '4' },
      },
    });
    expect(r.corpusKey.subject).toBe('urdu');
    expect(r.meta.lesson_id).toBe('grade_4_urdu_ch8_seg3');
    expect(r.meta.subject).toBe('urdu');
    expect(r.meta.grade).toBe('4');
  });

  test('a ref written BEFORE this change still works — the subject is derived from lesson_id', () => {
    const r = resolveFidelitySources({
      lesson_plan_structured: { _fidelity_ref: { lesson_id: 'grade_1_english_ch12_seg2' } },
    });
    expect(r.meta.subject).toBe('english');
    expect(r.meta.grade).toBe('1');
  });

  test('no corpus ref → meta carries no subject, and uploadedText still wins', () => {
    const r = resolveFidelitySources({ lesson_plan_text: 'my plan' });
    expect(r.corpusKey).toBeNull();
    expect(r.uploadedText).toBe('my plan');
    expect(r.meta.subject).toBeUndefined();
  });
});
