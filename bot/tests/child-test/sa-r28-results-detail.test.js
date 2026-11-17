'use strict';

/**
 * Round 28 on the coach's Results (shapeTask through saResults): an extended timed task's scorer reports the first N
 * items (detail.of_base / correct_base) and Results shows "first N correct" beside the rate; a tap task the child heard
 * too few items of carries `unrated`. Today's rows (no such fields) come back byte for byte as before.
 */

const sa = require('../../shared/services/child-test/app/sa-api.service');

const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
const SID = 'cccccccc-0000-4000-8000-000000000003';

function world(blocks) {
  const session = {
    id: SID, coach_user_id: COACH, student_id: 'st-1', draw_id: 'd-1', school_id: 'sch-1', grade: 3, form: 'A',
    item_bank_version: 'sa-battery', status: 'completed', started_at: '2026-10-21T05:00:00Z',
    finished_at: '2026-10-21T05:20:00Z', device: { block: 'B1' },
  };
  return {
    enabled: async () => true,
    supabase: { from: () => { throw new Error('no direct reads'); } },
    store: {
      getSession: async (id) => ({ ok: true, session: id === SID ? session : null }),
      listBlocks: async (id) => ({ ok: true, blocks: id === SID ? blocks : [] }),
    },
    saStore: { findByClient: async () => ({ ok: true, sessionId: null }) },
    bank: null,
    now: () => new Date('2026-10-21T06:00:00Z'),
    log: () => {},
    logError: () => {},
  };
}

const words = (detail) => ({
  block: 'ur.words4', response_mode: 'record', lang: 'ur', created_at: '2026-10-21T05:01:00Z', ai_status: 'scored',
  audio_r2_key: 'k', ai_marks: { correct: 9, attempted: 12, per_minute: 9, ...(detail ? { detail } : {}) },
  responses: [{ kind: 'result', mode: 'record', stop_reason: 'time_up' }],
});

describe('round 28 Results detail', () => {
  test('an extended timed task whose marks carry of_base / correct_base gets firstN', async () => {
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, world([words({ of_base: 4, correct_base: 3, of_all: 12 })]));
    expect(out.tasks[0].firstN).toEqual({ correct: 3, of: 4 });
    expect(out.tasks[0].score).toEqual({ correct: 9, attempted: 12, per_minute: 9 });
  });

  test("today's row (no base fields, or a non-number) is byte-identical: no firstN key", async () => {
    for (const detail of [null, { of_all: 12 }, { of_base: 4 }, { of_base: '4', correct_base: 3 }]) {
      // eslint-disable-next-line no-await-in-loop
      const out = await sa.saResults({ userId: COACH, sessionId: SID }, world([words(detail)]));
      expect(out.tasks[0]).toEqual({
        taskId: 'ur.words4', mode: 'record', attempted: null, correct: null, optionsN: null, chanceCorrected: null,
        itemsPerMin: null, stopReason: 'time_up', recording: 'scored', score: { correct: 9, attempted: 12, per_minute: 9 }, title: null,
      });
    }
  });

  test('a tap task with unrated: true (too few heard) passes unrated, presented and asked through', async () => {
    const blocks = [{
      block: 'ur.story_mcq_w3', response_mode: 'tap', lang: 'ur', created_at: '2026-10-21T05:02:00Z', ai_status: 'scored',
      ai_marks: { tap_correct: 2, tap_attempted: 3, options_n: 4, stop_reason: 'complete' },
      responses: [{ kind: 'result', mode: 'tap', correct: 2, attempted: 3, unrated: true, presented: 3, asked: ['ur.story_w3.q1', 'ur.story_w3.q2', 'ur.story_w3.q3'] }],
    }];
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, world(blocks));
    expect(out.tasks[0]).toMatchObject({ mode: 'tap', correct: 2, attempted: 3, unrated: true, presented: 3, asked: ['ur.story_w3.q1', 'ur.story_w3.q2', 'ur.story_w3.q3'] });
  });

  test('a tap task without those fields has no unrated / presented / asked keys', async () => {
    const blocks = [{
      block: 'ur.letter_pick10', response_mode: 'tap', lang: 'ur', created_at: '2026-10-21T05:02:00Z', ai_status: 'scored',
      ai_marks: { tap_correct: 8, tap_attempted: 10, options_n: 5, stop_reason: 'complete' },
      responses: [{ kind: 'result', mode: 'tap', correct: 8, attempted: 10, unrated: false }],
    }];
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, world(blocks));
    expect(Object.keys(out.tasks[0]).sort()).toEqual(['attempted', 'chanceCorrected', 'correct', 'itemsPerMin', 'mode', 'optionsN', 'recording', 'score', 'stopReason', 'taskId', 'title']);
  });
});

describe("round 28 Results detail: today's spoken questions", () => {
  test('an oral comprehension result that keeps asked[] (as today) gets no asked / presented / unrated key', async () => {
    const blocks = [{
      block: 'ur.story_comp_w3', response_mode: 'oral', lang: 'ur', created_at: '2026-10-21T05:03:00Z', ai_status: 'scored',
      audio_r2_key: 'k', ai_marks: { correct: 2, of: 4 },
      responses: [{ kind: 'result', mode: 'oral', asked: ['ur.story_w3.q1', 'ur.story_w3.q2'], presented: 2, unrated: true }],
    }];
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, world(blocks));
    expect(Object.keys(out.tasks[0]).sort()).toEqual(['attempted', 'chanceCorrected', 'correct', 'itemsPerMin', 'mode', 'optionsN', 'recording', 'score', 'stopReason', 'taskId', 'title']);
  });
});

describe('round 28 follow-up: unavailable on tap tasks, the voice kind', () => {
  const mcq = (res) => [{
    block: 'ur.story_mcq_w3', response_mode: 'tap', lang: 'ur', created_at: '2026-10-21T05:02:00Z', ai_status: 'scored',
    ai_marks: { tap_correct: 4, tap_attempted: 5, options_n: 4, stop_reason: 'complete' },
    responses: [{ kind: 'result', mode: 'tap', correct: 4, attempted: 5, ...res }],
  }];
  const story = (detail) => [{
    block: 'ur.story_w3', response_mode: 'record', lang: 'ur', created_at: '2026-10-21T05:01:00Z', ai_status: 'scored',
    audio_r2_key: 'k', ai_marks: { correct: 20, per_minute: 20, detail },
    responses: [{ kind: 'result', mode: 'record', stop_reason: 'time_up' }],
  }];

  test('a tap result with unavailable (lost clips, a count) passes it through', async () => {
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, world(mcq({ unavailable: 1, presented: 5, of_all: 6 })));
    expect(out.tasks[0]).toMatchObject({ unavailable: 1, presented: 5 });
  });

  test("the voice check's kind is passed only when detail.voice_check is 'r28'", async () => {
    const r28 = await sa.saResults({ userId: COACH, sessionId: SID }, world(story({ second_voice: true, second_voice_kind: 'help', voice_check: 'r28' })));
    expect(r28.tasks[0]).toMatchObject({ secondVoice: true, secondVoiceKind: 'help' });
    const child = await sa.saResults({ userId: COACH, sessionId: SID }, world(story({ second_voice: true, second_voice_kind: 'other_child', voice_check: 'r28' })));
    expect(child.tasks[0].secondVoiceKind).toBe('other_child');
    const old = await sa.saResults({ userId: COACH, sessionId: SID }, world(story({ second_voice: true, second_voice_kind: 'help' })));
    expect(old.tasks[0]).toMatchObject({ secondVoice: true });
    expect('secondVoiceKind' in old.tasks[0]).toBe(false);
  });
});

describe('round 28: the tap-before-sound count on a tapped task (Results and the dashboard)', () => {
  const pick = (answers, extra = {}) => [{
    block: 'ur.letter_pick10', response_mode: 'tap', lang: 'ur', created_at: '2026-10-21T05:02:00Z', ai_status: 'scored',
    ai_marks: { tap_correct: 8, tap_attempted: 10, options_n: 5, stop_reason: 'complete' },
    responses: [{ kind: 'result', mode: 'tap', correct: 8, attempted: 10, answers, ...extra }],
  }];
  const a = (tapMs, before) => ({ item_id: 'x', value: 'ب', ok: true, ...(tapMs === undefined ? {} : { tap_ms: tapMs }), ...(before === undefined ? {} : { tap_before_sound: before }) });

  test('counts answers flagged tap_before_sound over answers that carry a tap_ms', async () => {
    const answers = [a(-120, true), a(340, false), a(510, false), a(-40, true), a(undefined, undefined), a(220)];
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, world(pick(answers)));
    expect(out.tasks[0].tapBeforeSound).toEqual({ n: 2, of: 5 });
  });

  test('round 28 A3: n sums pre_taps (taps before the sound, never scored) over the answered items', async () => {
    const answers = [{ ...a(-700), pre_taps: 2 }, a(340), { ...a(510), pre_taps: 1 }, a(undefined, undefined)];
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, world(pick(answers)));
    expect(out.tasks[0].tapBeforeSound).toEqual({ n: 3, of: 3 });
  });

  test('a tap task whose answers carry no tap_ms (today) has no tapBeforeSound key', async () => {
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, world(pick([a(undefined, undefined), a(undefined, undefined)])));
    expect('tapBeforeSound' in out.tasks[0]).toBe(false);
    const none = await sa.saResults({ userId: COACH, sessionId: SID }, world(pick(undefined)));
    expect('tapBeforeSound' in none.tasks[0]).toBe(false);
  });

  test('a spoken task whose result answers carry the fields gets nothing (byte-identical)', async () => {
    const blocks = [{
      block: 'ur.story_comp_w3', response_mode: 'oral', lang: 'ur', created_at: '2026-10-21T05:03:00Z', ai_status: 'scored',
      audio_r2_key: 'k', ai_marks: { correct: 2, of: 4 },
      responses: [{ kind: 'result', mode: 'oral', answers: [a(-10, true), a(300, false)] }],
    }];
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, world(blocks));
    expect(Object.keys(out.tasks[0]).sort()).toEqual(['attempted', 'chanceCorrected', 'correct', 'itemsPerMin', 'mode', 'optionsN', 'recording', 'score', 'stopReason', 'taskId', 'title']);
  });
});
