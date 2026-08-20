'use strict';
/**
 * P1.3 — uploaded-LP extractor. LLM MOCKED. Encodes D21 (image-only PDF has no text → fail loud) and
 * the schema/normalisation contract that keeps the grader+scorer identical for uploaded vs corpus LPs.
 */
const { extractUploadedLp, normalizeMoves } = require('../../../bot/shared/services/coaching/fidelity/lp-upload-extractor');

function fakeClient(content, usage = { prompt_tokens: 200, completion_tokens: 120 }) {
  const calls = [];
  return { calls, chat: { completions: { create: async (p) => { calls.push(p); return { choices: [{ message: { content } }], usage }; } } } };
}

const LP_TEXT = 'Lesson Plan Template\nSubject English\nTopic Reading Comprehension\nDuration 40 minutes\n' +
  '5 min Introduction: greet the students, show the picture on page 40, ask what place is shown.\n' +
  '20 min Development: read the passage in groups, answer the guiding questions.\n' +
  '10 min Independent: students write answers to two comprehension questions.\n' +
  '5 min Plenary: ask which place they found most interesting.';

describe('lp-upload-extractor (LLM mocked)', () => {
  test('calls luna in json_object mode with the upload brief + the LP text', async () => {
    const payload = JSON.stringify({ template: 'UPLOADED', goal: 'read + comprehend', total_minutes: 40,
      moves: [{ move_id: 'm1', phase: 'warm_up', type: 'instruction', text: 'greet + show picture' }] });
    const c = fakeClient(payload);
    const out = await extractUploadedLp(LP_TEXT, { lessonId: 'sess1', client: c });
    const p = c.calls[0];
    expect(p.model).toBe('openai/gpt-5.6-luna');
    expect(p.response_format).toEqual({ type: 'json_object' });
    expect(p.messages[0].content).toContain('UPLOAD LP EXTRACTOR');
    expect(p.messages[1].content).toContain('Reading Comprehension');
    expect(out.template).toBe('UPLOADED');
    expect(out.goal).toBe('read + comprehend');
    expect(out.moves[0].move_id).toBe('m1');
  });

  test('normalises tags: bad phase/bucket/selection → safe defaults; empty-text moves dropped', () => {
    const moves = normalizeMoves([
      { text: 'a', phase: 'ENGAGE', bucket: 'core', selection: 'pick' }, // invalid enums → defaults
      { move_id: 'x', phase: 'exit', bucket: 'optional_extension', selection: 'choose_one', text: 'exit q', adjudicable: false },
      { text: '   ' }, // empty → dropped
    ]);
    expect(moves).toHaveLength(2);
    expect(moves[0]).toMatchObject({ move_id: 'm1', phase: 'explain', bucket: 'must_happen', selection: 'none', source_field: 'uploaded' });
    expect(moves[1]).toMatchObject({ move_id: 'x', phase: 'exit', selection: 'choose_one', adjudicable: false });
  });

  test('image-only / empty LP (no text layer) → lp_unparseable (D21: caller needs a vision read)', async () => {
    await expect(extractUploadedLp('   ', { client: fakeClient('{}') })).rejects.toMatchObject({ code: 'lp_unparseable' });
  });

  test('model returns zero usable moves → lp_unparseable after a retry (never a phantom empty list)', async () => {
    const c = fakeClient(JSON.stringify({ template: 'UPLOADED', moves: [] }));
    await expect(extractUploadedLp(LP_TEXT, { client: c })).rejects.toMatchObject({ code: 'lp_unparseable' });
    expect(c.calls).toHaveLength(2);
  });

  test('composes with grader+scorer: uploaded moves score exactly like corpus moves', async () => {
    const { scoreFidelity } = require('../../../bot/shared/services/coaching/fidelity/fidelity-scorer');
    const payload = JSON.stringify({ template: 'UPLOADED', goal: 'g', total_minutes: 40, moves: [
      { move_id: 'm1', phase: 'warm_up', type: 'instruction', text: 'greet', bucket: 'must_happen' },
      { move_id: 'm2', phase: 'exit', type: 'check', text: 'exit q', bucket: 'must_happen' },
    ] });
    const ext = await extractUploadedLp(LP_TEXT, { client: fakeClient(payload) });
    // pretend the grader judged one done, one not
    const analysis = scoreFidelity(ext.moves, [{ move_id: 'm1', verdict: 'executed' }, { move_id: 'm2', verdict: 'not_done' }]);
    expect(analysis.fidelity_pct).toBe(50);
    expect(analysis.prescribed_count).toBe(2);
  });
});
