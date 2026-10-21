'use strict';

/**
 * The coach's per-session Results (saResults): what the server holds for one self-administered session, per task —
 * how the child answered, attempted / correct, options per tile and the chance-corrected score, items per minute,
 * the stop reason, and for a recorded task whether the recording is kept and scored later or already scored.
 * The coach's own session only; never a name, a roll number or a student id.
 */

const sa = require('../../shared/services/child-test/app/sa-api.service');

const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'aaaaaaaa-0000-4000-8000-000000000009';
const SID = 'cccccccc-0000-4000-8000-000000000003';

function world({ session = {}, blocks } = {}) {
  const sessions = {
    [SID]: {
      id: SID,
      coach_user_id: COACH,
      student_id: 'st-1',
      draw_id: 'd-1',
      school_id: 'sch-1',
      grade: 3,
      form: 'A',
      item_bank_version: 'sa-battery',
      status: 'completed',
      started_at: '2026-10-21T05:00:00Z',
      finished_at: '2026-10-21T05:20:00Z',
      device: { block: 'B1' },
      ...session,
    },
  };
  const rows = blocks || [
    {
      block: 'ur.letters', response_mode: 'tap', lang: 'ur', created_at: '2026-10-21T05:01:00Z', ai_status: 'scored',
      ai_marks: { tap_correct: 18, tap_attempted: 24, options_n: 4, chance_corrected: 16, items_per_min: 24, stop_reason: 'time_up' },
      responses: [{ kind: 'result', mode: 'tap', correct: 18, incorrect: 6, attempted: 24, name: 'Asha Testwala' }],
    },
    {
      block: 'ma.add1', response_mode: 'keypad', lang: 'ur', created_at: '2026-10-21T05:05:00Z', ai_status: 'scored',
      ai_marks: { keypad_correct: 7, keypad_attempted: 9, items_per_min: 9, stop_reason: 'complete' },
      responses: [{ kind: 'result', mode: 'keypad' }],
    },
    {
      block: 'ur.oral_reading', response_mode: 'record', lang: 'ur', created_at: '2026-10-21T05:10:00Z',
      ai_status: 'failed', ai_reason: 'final:sa_score_later', ai_marks: null,
      audio_r2_key: 'child-test/x/sch-1/sess/sa/ur.oral_reading.webm',
      responses: [{ kind: 'result', mode: 'record', stop_reason: 'complete' }],
    },
  ];
  const store = {
    getSession: async (id) => ({ ok: true, session: sessions[id] || null }),
    listBlocks: async (id) => ({ ok: true, blocks: id === SID ? rows : [] }),
  };
  const saStore = { findByClient: async () => ({ ok: true, sessionId: null }) };
  return {
    enabled: async () => true,
    supabase: { from: () => { throw new Error('no direct reads'); } },
    store,
    saStore,
    bank: null,
    now: () => new Date('2026-10-21T06:00:00Z'),
    log: () => {},
    logError: () => {},
  };
}

describe('saResults', () => {
  test("the coach's own session: the header and one entry per task", async () => {
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, world());
    expect(out.status).toBe('ok');
    expect(out.session).toEqual({
      id: SID, grade: 3, form: 'A', block: 'B1', status: 'completed',
      startedAt: '2026-10-21T05:00:00Z', endedAt: '2026-10-21T05:20:00Z', lang: 'ur',
    });
    expect(out.tasks.map((t) => t.taskId)).toEqual(['ur.letters', 'ma.add1', 'ur.oral_reading']);
  });

  test('a tap task: attempted, correct, options per tile, chance-corrected, items per minute, stop reason', async () => {
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, world());
    expect(out.tasks[0]).toEqual({
      taskId: 'ur.letters', mode: 'tap', attempted: 24, correct: 18, optionsN: 4, chanceCorrected: 16,
      itemsPerMin: 24, stopReason: 'time_up', recording: 'none', score: null, title: null,
    });
  });

  test('a keypad task: its own counts, no options and no chance correction', async () => {
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, world());
    expect(out.tasks[1]).toEqual({
      taskId: 'ma.add1', mode: 'keypad', attempted: 9, correct: 7, optionsN: null, chanceCorrected: null,
      itemsPerMin: 9, stopReason: 'complete', recording: 'none', score: null, title: null,
    });
  });

  test('a recorded task with its recording and no marks: kept, scored later', async () => {
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, world());
    expect(out.tasks[2]).toMatchObject({ taskId: 'ur.oral_reading', mode: 'record', recording: 'scored_later', score: null, stopReason: 'complete' });
  });

  test('a recorded task once scored: the score (numbers only)', async () => {
    const blocks = [{
      block: 'ur.oral_reading', response_mode: 'record', lang: 'ur', ai_status: 'scored', audio_r2_key: 'k',
      ai_marks: { cwpm: 31, accuracy: 0.9, transcript_words: ['x'], note: 'Asha Testwala' }, responses: [],
    }];
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, world({ blocks }));
    expect(out.tasks[0]).toMatchObject({ recording: 'scored', score: { cwpm: 31, accuracy: 0.9 } });
  });

  test('a recorded task with no score is scored later, never 0: no recording yet, no scorer, or marks without numbers', async () => {
    const blocks = [
      { block: 'ur.letter_sounds', response_mode: 'record', ai_status: 'pending', ai_marks: null, responses: [{ kind: 'result', stop_reason: 'complete' }] },
      { block: 'ur.story', response_mode: 'record', ai_status: 'scored', ai_marks: { note: 'x' }, audio_r2_key: 'k', responses: [] },
      { block: 'ur.story_comp', response_mode: 'oral', ai_status: 'failed', ai_marks: null, responses: [{ kind: 'result', stop_reason: 'skipped_level2' }] },
      { block: 'en.story', response_mode: 'record', ai_status: 'failed', ai_marks: null, responses: [{ kind: 'result', stop_reason: 'mic_unavailable' }] },
    ];
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, world({ blocks }));
    const by = Object.fromEntries(out.tasks.map((t) => [t.taskId, t]));
    expect(by['ur.letter_sounds']).toMatchObject({ recording: 'scored_later', score: null, correct: null, chanceCorrected: null, itemsPerMin: null });
    expect(by['ur.story']).toMatchObject({ recording: 'scored_later', score: null });
    expect(by['ur.story_comp']).toMatchObject({ recording: 'none', stopReason: 'skipped_level2' });
    expect(by['en.story']).toMatchObject({ recording: 'none', stopReason: 'mic_unavailable' });
  });

  test("another coach's session is not_found", async () => {
    const out = await sa.saResults({ userId: OTHER, sessionId: SID }, world());
    expect(out).toEqual({ status: 'not_found' });
  });

  test("an admin (asAdmin from the portal's own check) reads another coach's session; anything but true is ignored", async () => {
    const out = await sa.saResults({ userId: OTHER, sessionId: SID, asAdmin: true }, world());
    expect(out.status).toBe('ok');
    expect(out.tasks).toHaveLength(3);
    for (const v of ['true', 1, {}]) {
      // eslint-disable-next-line no-await-in-loop
      expect(await sa.saResults({ userId: OTHER, sessionId: SID, asAdmin: v }, world())).toEqual({ status: 'not_found' });
    }
  });

  test('an admin still sees self-administered sessions only, and an unknown id is not_found', async () => {
    expect(await sa.saResults({ userId: OTHER, sessionId: SID, asAdmin: true }, world({ session: { item_bank_version: 'v3' } })))
      .toEqual({ status: 'not_found' });
    expect(await sa.saResults({ userId: OTHER, sessionId: 'not-a-uuid', asAdmin: true }, world())).toEqual({ status: 'not_found' });
    expect(await sa.saResults({ userId: OTHER, sessionId: 'dddddddd-0000-4000-8000-000000000004', asAdmin: true }, world()))
      .toEqual({ status: 'not_found' });
  });

  test('a coach-recorded (not SA) session is not_found', async () => {
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, world({ session: { item_bank_version: 'v3' } }));
    expect(out).toEqual({ status: 'not_found' });
  });

  test('never a name, a roll number, a student id, a draw id or a recording key in the answer', async () => {
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, world());
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/Testwala|st-1|d-1|sch-1|child-test\//);
    expect(text).not.toMatch(/name|roll|student|draw_id|school/i);
  });

  test('the bot route maps /sa/results to saResults with only the user and the session', () => {
    const src = require('fs').readFileSync(require.resolve('../../shared/routes/child-test-app.routes'), 'utf8');
    expect(src).toMatch(/'\/sa\/results': \['saResults', \['userId', 'sessionId', 'asAdmin'\], 'sa-api\.service'\]/);
  });
});

describe('saResults: task names from the battery', () => {
  const bank = {
    forms: { 'coach.G3.A': {} },
    tasks: { 'coach.G3.A/ma.add1': { title: { en: 'Addition, quick', ur: 'جمع، فوری' } } },
  };
  test("each task carries the battery's own title in both languages; an unknown task has none", async () => {
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, { ...world(), bank });
    const add = out.tasks.find((t) => t.taskId === 'ma.add1');
    expect(add.title).toEqual({ en: 'Addition, quick', ur: 'جمع، فوری' });
    expect(out.tasks.find((t) => t.taskId === 'ur.oral_reading').title).toBeNull();
  });
  test('the admin path names tasks the same way', async () => {
    const out = await sa.saResults({ userId: 'admin-1', sessionId: SID, asAdmin: true }, { ...world(), bank });
    expect(out.tasks.find((t) => t.taskId === 'ma.add1').title).toEqual({ en: 'Addition, quick', ur: 'جمع، فوری' });
  });
});
