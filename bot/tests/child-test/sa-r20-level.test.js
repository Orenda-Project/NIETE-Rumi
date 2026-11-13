'use strict';

/**
 * Round 20: the child's level per subject on Results (switch sa_r20_level, default OFF).
 *
 * Per subject (Urdu ur., English en., Maths ma.): where the child reached (the last part of that subject the child
 * actually did, not skipped), the level (the highest rung whose cut-off is met, walking up in order and stopping at
 * the first unmet; pending while a spoken part is not scored yet), and why the subject stopped (no answer / the coach).
 * The level words and cut-offs are placeholders awaiting reviewer approval (sa/level.js).
 * OFF: saResults and saSessions answer exactly as before.
 */

const level = require('../../shared/services/child-test/sa/level');
const sa = require('../../shared/services/child-test/app/sa-api.service');

const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
const SID = 'cccccccc-0000-4000-8000-000000000003';

let clock = 0;
const at = () => { clock += 1; return `2026-11-12T05:${String(clock).padStart(2, '0')}:00Z`; };

/** A spoken part, scored (marks) or not yet (marks null). */
const spoken = (block, marks, result = {}) => ({
  session_id: SID,
  block,
  response_mode: 'record',
  lang: 'ur',
  created_at: at(),
  ai_status: marks ? 'scored' : 'failed',
  ai_reason: marks ? null : 'final:sa_score_later',
  ai_marks: marks,
  audio_r2_key: `child-test/sandbox/sch-1/${SID}/sa/${block}.webm`,
  responses: [{ kind: 'result', mode: 'record', stop_reason: 'complete', ...result }],
});
/** A tap part, scored on the phone. */
const tap = (block, correct, attempted, result = {}) => ({
  session_id: SID,
  block,
  response_mode: 'tap',
  lang: 'ur',
  created_at: at(),
  ai_status: 'pending',
  ai_marks: null,
  responses: [{ kind: 'result', mode: 'tap', correct, attempted, stop_reason: 'complete', ...result }],
});
/** A part the phone skipped (nothing to score). */
const skipped = (block, reason = 'skipped_incomplete', mode = 'record') => ({
  session_id: SID, block, response_mode: mode, lang: 'ur', created_at: at(), ai_status: 'pending', ai_marks: null,
  responses: [{ kind: 'result', mode, attempted: 0, stop_reason: reason }],
});
const grid = (correct, n) => ({ correct, attempted: n, per_minute: correct, seconds_used: 60, detail: { kind: 'grid', items: Array.from({ length: n }, (_, i) => ({ i: i + 1 })) } });
const questions = (correct, of) => ({ correct, of, detail: { kind: 'questions', items: Array.from({ length: of }, (_, i) => ({ i: i + 1 })) } });

const ITEMS = { 'ur.letter_names5': 5, 'ur.letter_sounds5': 5, 'ur.words4': 4, 'ur.story_comp_w3': 6, 'ma.number_id8': 8, 'ma.discrimination2': 2, 'ma.missing4': 4, 'ma.add2i': 2, 'ma.sub2i': 2, 'ma.mul2i': 2, 'ma.fluency1m': 20 };
const opts = { itemsOf: (id) => ITEMS[id] ?? null };
const subjectOf = (out, s) => out.find((x) => x.subject === s);

describe('sa/level.js (pure)', () => {
  test('the vocabulary: reading Beginner → Letters → Words → Story → Understands; maths Beginner → Numbers → Comparing → Add & subtract → Multiply', () => {
    expect(level.LADDERS.reading.map((r) => r.level)).toEqual(['letters', 'words', 'story', 'comprehension']);
    expect(level.LADDERS.maths.map((r) => r.level)).toEqual(['numbers', 'comparing', 'add_sub', 'multiply']);
    expect(level.BEGINNER).toBe('beginner');
    expect(level.STORY_FLOOR_WORDS).toBe(10);
  });

  test('Urdu: letters met (4/5), words met (3/4), story under the floor → Words; reached is the last part done', () => {
    const rows = [
      spoken('ur.letter_names5', grid(4, 5)),
      spoken('ur.letter_sounds5', grid(2, 5)),
      spoken('ur.words4', grid(3, 4)),
      spoken('ur.story_w3', { correct: 6, attempted: 9, per_minute: 6, seconds_used: 60 }),
      spoken('ur.story_comp_w3', questions(5, 6)),
    ];
    const ur = subjectOf(level.levelsOf(rows, [], opts), 'ur');
    expect(ur).toEqual({ subject: 'ur', reached: { taskId: 'ur.story_comp_w3', title: null }, level: 'words', pending: false, stop: null });
  });

  test('every rung met → Understands the story; the first rung unmet → Beginner', () => {
    const all = [
      spoken('ur.letter_names5', grid(5, 5)), spoken('ur.letter_sounds5', grid(5, 5)), spoken('ur.words4', grid(4, 4)),
      spoken('ur.story_w3', { correct: 40, attempted: 42, per_minute: 40, seconds_used: 60 }), spoken('ur.story_comp_w3', questions(3, 6)),
    ];
    expect(subjectOf(level.levelsOf(all, [], opts), 'ur').level).toBe('comprehension');
    const none = [spoken('ur.letter_names5', grid(3, 5)), spoken('ur.letter_sounds5', grid(1, 5)), spoken('ur.words4', grid(4, 4))];
    expect(subjectOf(level.levelsOf(none, [], opts), 'ur')).toMatchObject({ level: 'beginner', pending: false });
  });

  test('a spoken part not scored yet: the level so far, pending; nothing scored → no level, pending', () => {
    const rows = [spoken('en.letter_names5', grid(5, 5)), spoken('en.words4', null)];
    expect(subjectOf(level.levelsOf(rows, [], opts), 'en')).toMatchObject({ level: 'letters', pending: true, reached: { taskId: 'en.words4' } });
    const early = [spoken('en.letter_names5', null), spoken('en.letter_sounds5', null)];
    expect(subjectOf(level.levelsOf(early, [], opts), 'en')).toMatchObject({ level: null, pending: true, reached: { taskId: 'en.letter_sounds5' } });
  });

  test('maths: numbers 6/8, comparing + missing 5/6 pooled, add + sub 2/4 → Comparing', () => {
    const rows = [
      spoken('ma.number_id8', { correct: 6, of: 8 }),
      tap('ma.discrimination2', 2, 2),
      tap('ma.missing4', 3, 4),
      spoken('ma.add2i', { correct: 1, of: 2 }),
      spoken('ma.sub2i', { correct: 1, of: 2 }),
      spoken('ma.mul2i', { correct: 2, of: 2 }),
    ];
    expect(subjectOf(level.levelsOf(rows, [], opts), 'ma')).toMatchObject({ level: 'comparing', pending: false, reached: { taskId: 'ma.mul2i' } });
  });

  test('skipped parts are not "reached"; a skipped rung is unmet', () => {
    const rows = [spoken('ur.letter_names5', grid(5, 5)), skipped('ur.words4'), skipped('ur.story_w3'), skipped('ur.story_comp_w3', 'skipped_no_first_line', 'oral')];
    expect(subjectOf(level.levelsOf(rows, [], opts), 'ur')).toMatchObject({ reached: { taskId: 'ur.letter_names5' }, level: 'letters', pending: false });
  });

  test('stopped: no answer — an incomplete_move_on for silence, a part ended by silence, or a silent part', () => {
    const rows = [spoken('ur.letter_names5', grid(5, 5)), spoken('ur.words4', null), skipped('ur.story_w3')];
    const ev = [{ type: 'incomplete_move_on', task_id: 'ur.words4', data: { by: 'app', section: 'ur', reason: 'silence', in_a_row: 2 } }];
    expect(subjectOf(level.levelsOf(rows, ev, opts), 'ur').stop).toBe('no_answer');
    const bySilence = [spoken('en.letter_names5', null, { stop_reason: 'early_stop_silence' })];
    expect(subjectOf(level.levelsOf(bySilence, [], opts), 'en').stop).toBe('no_answer');
    const silent = [spoken('ma.number_id8', null, { silent: true }), skipped('ma.discrimination2', 'skipped_incomplete', 'tap')];
    expect(subjectOf(level.levelsOf(silent, [], opts), 'ma').stop).toBe('no_answer');
    // a time-up move-on is not a silence stop
    const timeUp = [{ type: 'incomplete_move_on', task_id: 'ur.words4', data: { reason: 'time_up' } }];
    expect(subjectOf(level.levelsOf(rows, timeUp, opts), 'ur').stop).toBe(null);
  });

  test('stopped by the coach: end_section on a part, or the parts it skipped', () => {
    const rows = [spoken('en.letter_names5', grid(5, 5)), spoken('en.words4', grid(1, 4), { stop_reason: 'end_section' }), skipped('en.story_w3', 'skipped_end_section')];
    const out = subjectOf(level.levelsOf(rows, [], opts), 'en');
    expect(out).toMatchObject({ stop: 'coach', reached: { taskId: 'en.words4' }, level: 'letters' });
  });

  test('a subject with none of the ladder parts (another block) gets no line; titles come from titleOf', () => {
    const rows = [tap('ur.letters', 10, 12), spoken('ma.number_id8', { correct: 8, of: 8 })];
    const out = level.levelsOf(rows, [], { ...opts, titleOf: (id) => ({ en: `T ${id}`, ur: null }) });
    expect(out.map((x) => x.subject)).toEqual(['ma']);
    expect(out[0].reached).toEqual({ taskId: 'ma.number_id8', title: { en: 'T ma.number_id8', ur: null } });
  });
});

function world({ blocks, device = { block: 'rdf_auto' }, r20Level } = {}) {
  const sessions = {
    [SID]: {
      id: SID, coach_user_id: COACH, student_id: 'st-1', draw_id: 'd-1', school_id: 'sch-1', grade: 3, form: 'A',
      item_bank_version: 'sa-battery', status: 'completed', started_at: '2026-11-12T05:00:00Z', finished_at: '2026-11-12T05:30:00Z', device,
    },
  };
  const rows = blocks || [spoken('ur.letter_names5', grid(4, 5)), spoken('ur.words4', null), tap('ma.discrimination2', 2, 2)];
  const store = {
    getSession: async (id) => ({ ok: true, session: sessions[id] || null }),
    listBlocks: async (id) => ({ ok: true, blocks: id === SID ? rows : [] }),
    listSaSessions: async () => ({ ok: true, sessions: Object.values(sessions) }),
    listBlocksForSessions: async () => ({ ok: true, blocks: rows }),
    getSchoolsByIds: async () => ({ ok: true, schools: [{ id: 'sch-1', name: 'School One', region: 'Urban-I' }] }),
  };
  return {
    enabled: async () => true,
    practiceSwitch: false,
    supabase: { from: () => { throw new Error('no direct reads'); } },
    store,
    saStore: { findByClient: async () => ({ ok: true, sessionId: null }) },
    bank: null,
    stopRules: false,
    hidePractice: false,
    dashFilters: false,
    ...(r20Level !== undefined ? { r20Level } : {}),
    now: () => new Date('2026-11-12T06:00:00Z'),
    log: () => {},
    logError: () => {},
  };
}

describe('saResults / saSessions with sa_r20_level', () => {
  test('OFF (or absent): no levels key, the answer as before', async () => {
    for (const r20Level of [false, undefined]) {
      const out = await sa.saResults({ userId: COACH, sessionId: SID }, world({ r20Level }));
      expect(out.status).toBe('ok');
      expect(Object.keys(out).sort()).toEqual(['session', 'status', 'tasks']);
      const dash = await sa.saSessions({ userId: COACH }, world({ r20Level }));
      expect(Object.keys(dash.sessions[0].results).sort()).toEqual(['session', 'status', 'tasks']);
    }
  });

  test('ON: Results carries one line per subject, item counts from the phone battery', async () => {
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, world({ r20Level: true }));
    expect(out.levels).toEqual([
      { subject: 'ur', reached: { taskId: 'ur.words4', title: null }, level: 'letters', pending: true, stop: null },
      { subject: 'ma', reached: { taskId: 'ma.discrimination2', title: null }, level: 'beginner', pending: false, stop: null },
    ]);
    // the tasks themselves are unchanged
    const off = await sa.saResults({ userId: COACH, sessionId: SID }, world({ r20Level: false }));
    expect(out.tasks).toEqual(off.tasks);
  });

  test('ON: the coach-ended subject and the silence move-on read from the session events', async () => {
    const device = { block: 'rdf_auto', events: [{ seq: 3, type: 'incomplete_move_on', task_id: 'ur.words4', at: null, data: { by: 'app', section: 'ur', reason: 'silence', in_a_row: 2 } }] };
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, world({ r20Level: true, device }));
    expect(out.levels.find((x) => x.subject === 'ur').stop).toBe('no_answer');
  });

  test('ON: every dashboard session carries the same lines in its results', async () => {
    const dash = await sa.saSessions({ userId: COACH }, world({ r20Level: true }));
    expect(dash.sessions[0].results.levels.map((x) => [x.subject, x.level])).toEqual([['ur', 'letters'], ['ma', 'beginner']]);
  });
});
