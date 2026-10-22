'use strict';

/**
 * The visit review (sa-review.service.js): one self-administered session, task by task and item by item — the
 * recordings (short-lived links), the app's marks, the scoring agents' marks, a "suspect" flag, the reviewer's own ear
 * and the app's right / wrong derived from it — and the reviewer's mark written back. The coach's own session, or any
 * for a results admin (asAdmin: true from the portal). Never what the child said, a transcript or a name.
 */

const review = require('../../shared/services/child-test/app/sa-review.service');

const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000009';
const SID = 'cccccccc-0000-4000-8000-000000000003';
const FIX_AT = '2026-10-22T06:37:45Z';

function world({ session = {}, blocks, reviews, fixAt = FIX_AT } = {}) {
  const calls = { saved: [], presigned: [] };
  const s = {
    id: SID, coach_user_id: COACH, student_id: 'st-1', draw_id: 'd-1', school_id: 'sch-1', grade: 3, form: 'A',
    item_bank_version: 'sa-battery', status: 'completed', started_at: '2026-10-23T05:00:00Z', finished_at: '2026-10-23T05:36:00Z',
    device: { block: 'rdf_auto' }, ...session,
  };
  const rows = blocks || [
    {
      block: 'ur.words4', response_mode: 'record', lang: 'ur', created_at: '2026-10-23T05:05:00Z', ai_status: 'scored',
      ai_scored_at: '2026-10-23T05:06:00Z', audio_r2_key: 'child-test/sandbox/sch-1/x/sa/ur.words4.webm', transcript: 'secret words',
      ai_marks: {
        correct: 3, attempted: 4,
        detail: { items: [
          { i: 1, ref: 'گھر', verdict: 'correct', conf: 0.9, heard: 'گھر' },
          { i: 2, ref: 'آم', verdict: 'correct', conf: 0.8, heard: 'آم', no_speech: true },
          { i: 3, ref: 'نل', verdict: 'wrong', conf: 0.7, heard: 'نر' },
          { i: 4, ref: 'دل', verdict: 'correct', conf: 0.9, heard: 'دل' },
        ] },
      },
      responses: [{ kind: 'result', mode: 'record', time_used_ms: 7800, name: 'Asha Testwala' }],
    },
    {
      block: 'ur.story_comp_w3', response_mode: 'oral', lang: 'ur', created_at: '2026-10-23T05:10:00Z', ai_status: 'scored',
      ai_scored_at: '2026-10-22T06:00:00Z',
      audio_r2_keys: ['child-test/sandbox/sch-1/x/sa/ur.story_comp_w3_q1.webm', 'child-test/sandbox/sch-1/x/sa/ur.story_comp_w3_q2.webm'],
      ai_marks: { correct: 2, of: 2, detail: { items: [
        { i: 1, id: 'ur.story_w3.q1', verdict: 'correct', conf: 0.9, heard: 'جواب' },
        { i: 2, id: 'ur.story_w3.q2', verdict: 'correct', conf: 0.9, heard: 'جی' },
      ] } },
      responses: [
        { kind: 'answer', item_id: 'ur.story_w3.q1', ms: 3500 },
        { kind: 'answer', item_id: 'ur.story_w3.q2', ms: 700 },
        { kind: 'result', mode: 'oral', time_used_ms: 18000 },
      ],
    },
    {
      block: 'ma.missing4', response_mode: 'keypad', lang: 'ur', created_at: '2026-10-23T05:20:00Z', ai_status: 'scored',
      ai_marks: { keypad_correct: 2, keypad_attempted: 4 }, responses: [{ kind: 'result', mode: 'keypad', correct: 2, attempted: 4, time_used_ms: 7500 }],
    },
  ];
  const saved = reviews || [
    { session_id: SID, task_id: 'ur.words4', item_key: '1', agents: { consensus: 'c', flash: 'c', pro: 'c', stt: 'c', confidence: 0.95 }, mark: 'correct', note: 'clear', reviewed_by: OTHER, reviewed_at: '2026-10-23T09:00:00Z' },
    { session_id: SID, task_id: 'ur.words4', item_key: '2', agents: { consensus: 's', no_speech: true, confidence: 0 }, mark: 'wrong', note: null, reviewed_by: COACH, reviewed_at: '2026-10-23T09:01:00Z' },
    { session_id: SID, task_id: 'ur.words4', item_key: '3', agents: { consensus: 'w', flash: 'w', pro: 'c', disputed: true, confidence: 0.4 }, mark: 'unclear', note: null, reviewed_by: COACH, reviewed_at: '2026-10-23T09:02:00Z' },
  ];
  const deps = {
    enabled: async () => true,
    supabase: { from: () => { throw new Error('no direct reads'); } },
    store: {
      getSession: async (id) => ({ ok: true, session: id === SID ? s : null }),
      listBlocks: async () => ({ ok: true, blocks: rows }),
      listStudents: async () => ({ ok: true, students: [{ id: 'st-1', student_name: 'Asha Testwala', student_name_urdu: 'آشا ٹیسٹ والا' }] }),
    },
    reviewStore: {
      listItemReviews: async () => ({ ok: true, reviews: saved }),
      saveItemReview: async (r) => { calls.saved.push(r); return { ok: true }; },
    },
    r2: { presignKey: async (key, ttl) => { calls.presigned.push([key, ttl]); return `https://r2.example/${key}?sig=1`; } },
    settings: { fixAt: async () => fixAt },
    now: () => new Date('2026-10-23T09:30:00Z'),
    log: () => {},
    logError: () => {},
  };
  return { deps, calls };
}

describe('saReview: the read', () => {
  test("the coach's own session: header with total minutes, each task's time and its recordings as 1-hour links", async () => {
    const w = world();
    const out = await review.saReview({ userId: COACH, sessionId: SID }, w.deps);
    expect(out.status).toBe('ok');
    expect(out.session).toMatchObject({ id: SID, grade: 3, block: 'rdf_auto', minutes: 36 });
    expect(out.tasks.map((t) => t.taskId)).toEqual(['ur.words4', 'ur.story_comp_w3', 'ma.missing4']);
    const words = out.tasks[0];
    expect(words.timeUsedS).toBe(7.8);
    expect(words.clips).toEqual([{ label: 'ur.words4', url: 'https://r2.example/child-test/sandbox/sch-1/x/sa/ur.words4.webm?sig=1' }]);
    expect(out.tasks[1].clips.map((c) => c.label)).toEqual(['q1', 'q2']);
    expect(w.calls.presigned.every(([, ttl]) => ttl === 3600)).toBe(true);
    expect(out.tasks[2]).toMatchObject({ taskId: 'ma.missing4', mode: 'keypad', clips: [], items: [], app: { correct: 2, attempted: 4 } });
  });

  test('per item: the app mark, the agents\' marks and the ear; the app right / wrong / unclear derived from the ear', async () => {
    const out = await review.saReview({ userId: COACH, sessionId: SID }, world().deps);
    const items = out.tasks[0].items;
    expect(items.map((x) => x.key)).toEqual(['1', '2', '3', '4']);
    expect(items[0]).toMatchObject({ ref: 'گھر', app: { verdict: 'correct', conf: 0.9 }, agents: { consensus: 'c' }, ear: { mark: 'correct', note: 'clear', mine: false }, appRight: 'right' });
    expect(items[1]).toMatchObject({ ear: { mark: 'wrong', mine: true }, appRight: 'wrong' });
    expect(items[2]).toMatchObject({ ear: { mark: 'unclear' }, appRight: 'unclear' });
    expect(items[3]).toMatchObject({ agents: null, ear: null, appRight: null });
    expect(out.tasks[0].agreement).toEqual({ reviewed: 3, earAgreesWithApp: 1, agentsAgreeWithApp: 2, withAgents: 3 });
  });

  test('suspect: an app "correct" on a no-speech clip or an answer under 1 s; never a wrong mark', async () => {
    const out = await review.saReview({ userId: COACH, sessionId: SID }, world().deps);
    expect(out.tasks[0].items.map((x) => x.suspect)).toEqual([false, true, false, false]);
    expect(out.tasks[1].items.map((x) => x.suspect)).toEqual([false, true]);
  });

  test('scored before or after the scorer fix (app_settings.sa_scorer_fix_at); unknown when not set', async () => {
    const out = await review.saReview({ userId: COACH, sessionId: SID }, world().deps);
    expect(out.fixAt).toBe(FIX_AT);
    expect(out.tasks.map((t) => t.scoredAfterFix)).toEqual([true, false, null]);
    const none = await review.saReview({ userId: COACH, sessionId: SID }, world({ fixAt: null }).deps);
    expect(none.tasks.map((t) => t.scoredAfterFix)).toEqual([null, null, null]);
  });

  test("another coach's session: not_found; a results admin (asAdmin: true) reads it; a string asAdmin does not", async () => {
    expect(await review.saReview({ userId: OTHER, sessionId: SID }, world().deps)).toEqual({ status: 'not_found' });
    expect((await review.saReview({ userId: OTHER, sessionId: SID, asAdmin: true }, world().deps)).status).toBe('ok');
    expect(await review.saReview({ userId: OTHER, sessionId: SID, asAdmin: 'true' }, world().deps)).toEqual({ status: 'not_found' });
  });

  test('not a self-administered session, or not a uuid: not_found', async () => {
    expect(await review.saReview({ userId: COACH, sessionId: SID }, world({ session: { item_bank_version: 'v3' } }).deps)).toEqual({ status: 'not_found' });
    expect(await review.saReview({ userId: COACH, sessionId: 'x' }, world().deps)).toEqual({ status: 'not_found' });
  });

  test("never what the child said, a transcript, a name, a student id or a draw id", async () => {
    const text = JSON.stringify(await review.saReview({ userId: COACH, sessionId: SID, asAdmin: true }, world().deps));
    expect(text).not.toMatch(/heard|transcript|secret words|Testwala|st-1|d-1|student|draw/);
    expect(text).not.toMatch(/نر|جواب/);
  });
});

describe('saReviewMark: the write', () => {
  const mark = (extra = {}, as = COACH) => ({ userId: as, sessionId: SID, taskId: 'ur.words4', itemKey: '4', mark: 'wrong', note: 'said "dil" late', ...extra });

  test('the coach marks an item of their own session: saved with who and when', async () => {
    const w = world();
    const out = await review.saReviewMark(mark(), w.deps);
    expect(out).toEqual({ status: 'ok' });
    expect(w.calls.saved).toEqual([{ sessionId: SID, taskId: 'ur.words4', itemKey: '4', mark: 'wrong', note: 'said "dil" late', reviewedBy: COACH, reviewedAt: '2026-10-23T09:30:00.000Z' }]);
  });

  test('a results admin marks any session; another coach cannot', async () => {
    expect((await review.saReviewMark(mark({ asAdmin: true }, OTHER), world().deps)).status).toBe('ok');
    expect(await review.saReviewMark(mark({}, OTHER), world().deps)).toEqual({ status: 'not_found' });
  });

  test('only correct | wrong | unclear (or none, to clear); only an item the session has', async () => {
    expect(await review.saReviewMark(mark({ mark: 'maybe' }), world().deps)).toEqual({ status: 'invalid', reason: 'bad_mark' });
    expect((await review.saReviewMark(mark({ mark: null, note: null }), world().deps)).status).toBe('ok');
    expect(await review.saReviewMark(mark({ itemKey: '9' }), world().deps)).toEqual({ status: 'invalid', reason: 'no_such_item' });
    expect(await review.saReviewMark(mark({ taskId: 'ma.missing4', itemKey: '1' }), world().deps)).toEqual({ status: 'invalid', reason: 'no_such_item' });
  });

  test('a note is at most 500 code points (Urdu counted by code point)', async () => {
    expect((await review.saReviewMark(mark({ note: 'ب'.repeat(500) }), world().deps)).status).toBe('ok');
    expect(await review.saReviewMark(mark({ note: 'ب'.repeat(501) }), world().deps)).toEqual({ status: 'invalid', reason: 'note_too_long' });
  });

  test("a note holding the child's roster name (English or Urdu) is refused, and nothing is saved", async () => {
    const w = world();
    expect(await review.saReviewMark(mark({ note: 'asha read it well' }), w.deps)).toEqual({ status: 'invalid', reason: 'name_in_note' });
    expect(await review.saReviewMark(mark({ note: 'آشا نے پڑھا' }), w.deps)).toEqual({ status: 'invalid', reason: 'name_in_note' });
    expect(w.calls.saved).toEqual([]);
  });
});

test('the bot routes map /sa/review and /sa/review-mark with only their fields', () => {
  const src = require('fs').readFileSync(require.resolve('../../shared/routes/child-test-app.routes'), 'utf8');
  expect(src).toMatch(/'\/sa\/review': \['saReview', \['userId', 'sessionId', 'asAdmin'\], 'sa-review.service'\]/);
  expect(src).toMatch(/'\/sa\/review-mark': \['saReviewMark', \['userId', 'sessionId', 'taskId', 'itemKey', 'mark', 'note', 'asAdmin'\], 'sa-review.service'\]/);
});
