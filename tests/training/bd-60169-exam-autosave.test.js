/**
 * bd-60169 — a teacher's answers survive a closed tab.
 *
 * Until this, `answers` lived in React state until Submit. A phone call, a
 * backgrounded app or a lost tab took the whole paper, including an
 * ~1,800-character written answer. One-question-per-page made it worse rather
 * than better: she can no longer see what she is about to lose.
 *
 * NO SCHEMA CHANGE — drafts go in `training_assessment_answers` against the
 * `UNIQUE (attempt_id, question_index)` key that already existed. A draft is a
 * row whose is_correct/answer_score are null, which is also what an ungraded
 * submitted row looks like, so no downstream reader learns a new state.
 *
 * THE TRAP THIS FILE EXISTS TO HOLD SHUT: submit used to `insert` those rows.
 * With autosave writing against the same key, a plain insert throws
 * duplicate-key ON SUBMIT — losing the paper at the one moment it must not
 * fail. The last test here is that upsert.
 */

const MODULE = '../../bot/shared/services/training/quiz-delivery.service';

/** Supabase double that records upserts and can fake an attempt's status. */
function fakeSupabase({ status = 'in_progress', userId = 'u-1', rows = [] } = {}) {
  const calls = { upserts: [], updates: [] };
  const api = (table) => {
    let filtered = table === 'training_assessment_attempts'
      ? [{ id: 'att-1', user_id: userId, status }]
      : rows.slice();
    const chain = {
      select() { return chain; },
      eq(col, val) {
        // The answers table is keyed by attempt_id, not id — filtering it by
        // the attempt's own column would silently return nothing and make a
        // passing test out of a broken load.
        if (table === 'training_assessment_answers' && col === 'attempt_id') return chain;
        filtered = filtered.filter(r => r[col] === val);
        return chain;
      },
      order() { return chain; },
      maybeSingle() { return Promise.resolve({ data: filtered[0] || null, error: null }); },
      upsert(payload, opts) {
        calls.upserts.push({ table, payload, opts });
        return Promise.resolve({ data: null, error: null });
      },
      update(payload) { calls.updates.push({ table, payload }); return chain; },
      then(res) { return Promise.resolve({ data: filtered, error: null }).then(res); },
    };
    return chain;
  };
  return { from: api, __calls: calls };
}

function load(supabase) {
  jest.resetModules();
  jest.doMock('../../bot/shared/config/supabase', () => supabase);
  jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
    sendMessage: jest.fn().mockResolvedValue(true),
    sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  }));
  return require(MODULE);
}

describe('bd-60169 — exam autosave', () => {
  afterEach(() => jest.resetModules());

  test('saves one answer against the existing unique key', async () => {
    const sb = fakeSupabase();
    const { saveModuleExamDraft } = load(sb);
    const out = await saveModuleExamDraft({
      userId: 'u-1', attemptId: 'att-1', questionId: 42, questionIndex: 1, chosenOption: '3',
    });
    expect(out.ok).toBe(true);
    const up = sb.__calls.upserts.find(u => u.table === 'training_assessment_answers');
    expect(up.opts).toEqual({ onConflict: 'attempt_id,question_index' });
    expect(up.payload.chosen_option).toBe('3');
  });

  test('a draft is NOT marked — no is_correct, no score', async () => {
    // Grading a draft would burn rubric calls and make a half-finished paper
    // look marked. She may change the answer any number of times.
    const sb = fakeSupabase();
    const { saveModuleExamDraft } = load(sb);
    await saveModuleExamDraft({
      userId: 'u-1', attemptId: 'att-1', questionId: 42, questionIndex: 0, answerText: 'half a thought',
    });
    const up = sb.__calls.upserts.find(u => u.table === 'training_assessment_answers');
    expect(up.payload.is_correct).toBeNull();
    expect(up.payload.answer_score).toBeNull();
    expect(up.payload.answer_text).toBe('half a thought');
  });

  test('refuses once the paper is graded — a late save cannot overwrite a mark', async () => {
    const sb = fakeSupabase({ status: 'passed' });
    const { saveModuleExamDraft } = load(sb);
    const out = await saveModuleExamDraft({
      userId: 'u-1', attemptId: 'att-1', questionId: 42, questionIndex: 0, chosenOption: '1',
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('not_in_progress');
    expect(sb.__calls.upserts.filter(u => u.table === 'training_assessment_answers')).toHaveLength(0);
  });

  test("refuses another teacher's attempt", async () => {
    const sb = fakeSupabase({ userId: 'someone-else' });
    const { saveModuleExamDraft } = load(sb);
    const out = await saveModuleExamDraft({
      userId: 'u-1', attemptId: 'att-1', questionId: 42, questionIndex: 0, chosenOption: '1',
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('not_found');
  });

  test('loads saved answers back, so resuming is not a blank paper', async () => {
    const sb = fakeSupabase({ rows: [
      { question_id: 42, question_index: 0, chosen_option: '3', answer_text: null },
      { question_id: 43, question_index: 1, chosen_option: null, answer_text: 'a long answer' },
    ] });
    const { loadModuleExamDraft } = load(sb);
    const out = await loadModuleExamDraft({ userId: 'u-1', attemptId: 'att-1' });
    expect(out.ok).toBe(true);
    expect(out.answers).toHaveLength(2);
    expect(out.answers[1].answer_text).toBe('a long answer');
  });

  test('THE TRAP: submit UPSERTS, so it survives rows autosave already wrote', () => {
    // A plain insert throws duplicate-key on (attempt_id, question_index) the
    // moment autosave has written a draft — losing the paper at submit.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../bot/shared/services/training/quiz-delivery.service.js'),
      'utf8',
    );
    const submitBlock = src.slice(src.indexOf('async function submitModuleExamPaper'));
    expect(submitBlock).toMatch(/\.upsert\(rows, \{ onConflict: 'attempt_id,question_index' \}\)/);
    expect(submitBlock).not.toMatch(/answers'\)\.insert\(rows\)/);
  });
});
