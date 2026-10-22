'use strict';

/**
 * The coach confirms the last word read (the phone's sa_coach_last_word): the tester asked that the last word come
 * from the recording, with the coach's tap as the confirmation, "rather than the tap being what is actually used".
 * A passage row whose result says last_word_how ('confirm' | 'tap') takes words attempted from the recording (the
 * last word the model heard read); the coach's word is kept as the cross-check, and the row is flagged when the two
 * are more than one line apart. A row without last_word_how is unchanged (the tap counts, RULING #2).
 * The scorer's own path runs here; only the clip, STT and the model are stand-ins.
 */

const score = require('../../shared/services/child-test/sa/score');

const SID = 'cccccccc-0000-4000-8000-000000000006';
const PHONE_SID = 'dddddddd-0000-4000-8000-00000000000d';
const session = () => ({ id: SID, grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed', finished_at: '2026-10-22T14:19:56Z', asked: [] });
const row = (res) => ({
  id: 'row-en-story', session_id: SID, block: 'en.story_w3', response_mode: 'record', ai_status: 'failed', ai_reason: 'final:sa_score_later',
  ai_marks: null, audio_r2_key: `child-test/sandbox/sch-1/${SID}/sa/en.story_w3.webm`, audio_r2_keys: null, updated_at: '2026-10-22T14:16:30Z',
  responses: [{ kind: 'result', mode: 'record', task_id: 'en.story_w3', session_id: PHONE_SID, time_used_ms: 60000, stop_reason: 'time_up', ...res }],
});

/** The model reads the first `read` words of the 60 (all correct), the rest skipped; STT hears `words` words. */
function standIns({ read = 30, words = 25 } = {}) {
  return {
    clipOf: async () => ({ base64: 'AAAA', durationSec: 60 }),
    speechOf: async () => ({ words, text: 'Imran '.repeat(words).trim(), model: 'soniox:test', cost: 0, seconds: 1 }),
    model: () => 'google/gemini-test',
    chatJSON: async () => ({
      json: { words: Array.from({ length: 60 }, (_, k) => ({ i: k + 1, w: 'x', v: k < read ? 'correct' : 'skipped' })), words_correct: read, words_attempted: read, notes: '' },
      cost: 0.001, seconds: 1,
    }),
  };
}

describe('the last word read: from the recording, the coach\'s word as the cross-check (sa_coach_last_word)', () => {
  const before = { ...process.env };
  beforeEach(() => { process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.CHILD_TEST_SA_SPEECH_GATE = 'on'; });
  afterEach(() => { process.env = { ...before }; });

  test('they agree: attempted is the recording\'s last word; the coach\'s is kept; no flag', async () => {
    // the recording: 30 words read (word 30 is on line 4); the coach confirmed word 29 (line 4)
    const got = await score.scoreRow(row({ last_word_index: 28, last_word_how: 'confirm', last_word_suggested: 29 }), session(), standIns({ read: 30 }));
    expect(got.ok).toBe(true);
    expect(got.marks).toMatchObject({ attempted: 30, correct: 30 });
    expect(got.marks.detail).toMatchObject({ last_word_source: 'recording', last_word_heard: 30, last_word_tapped: 29, last_word_check: 'agree' });
  });

  test('more than one line apart: the recording still counts, and the row is flagged for the ear', async () => {
    // the coach confirmed the last word of the passage (60, line 7); the recording heard 30 (line 4)
    const got = await score.scoreRow(row({ last_word_index: 59, last_word_how: 'tap' }), session(), standIns({ read: 30 }));
    expect(got.marks).toMatchObject({ attempted: 30, correct: 30 });
    expect(got.marks.detail).toMatchObject({ last_word_source: 'recording', last_word_heard: 30, last_word_tapped: 60, last_word_check: 'differ' });
  });

  test('the recording holds no speech: the coach\'s word is used, and the row is flagged', async () => {
    const got = await score.scoreRow(row({ last_word_index: 29, last_word_how: 'confirm' }), session(), standIns({ read: 30, words: 0 }));
    expect(got.marks).toMatchObject({ attempted: 30, correct: 0 });
    expect(got.marks.detail).toMatchObject({ last_word_source: 'coach', last_word_heard: 0, last_word_tapped: 30, last_word_check: 'differ' });
  });

  test('without last_word_how (switch off on the phone): the tap counts, as today, with no cross-check', async () => {
    const got = await score.scoreRow(row({ last_word_index: 19 }), session(), standIns({ read: 30 }));
    expect(got.marks).toMatchObject({ attempted: 20, correct: 20 });
    expect(got.marks.detail).toMatchObject({ last_word_tapped: 20 });
    expect(got.marks.detail).not.toHaveProperty('last_word_source');
    expect(got.marks.detail).not.toHaveProperty('last_word_check');
  });
});

/**
 * RDF auto (the tester, round 5): the child taps the last word, as before, and the score still goes by where the
 * recording shows the child stopped; the child's tap is only the check. The phone sends no last_word_how in auto
 * mode, so the scorer takes the recording whenever the coach's sa_coach_last_word is on (the sweep reads it for the
 * session's coach). Off: the tap counts, as before.
 */
describe('RDF auto: the child\'s tap is the check, the recording gives the last word (sa_coach_last_word)', () => {
  const before = { ...process.env };
  beforeEach(() => { process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.CHILD_TEST_SA_SPEECH_GATE = 'on'; score.__internals.resetBoot(); });
  afterEach(() => { process.env = { ...before }; });
  const on = (x) => ({ ...standIns(x), lastWordFromRecording: true });

  test('the child tapped the last word of the passage, the recording heard 30: attempted 30, flagged', async () => {
    const got = await score.scoreRow(row({ last_word_index: 59 }), session(), on({ read: 30 }));
    expect(got.marks).toMatchObject({ attempted: 30, correct: 30 });
    expect(got.marks.detail).toMatchObject({ last_word_source: 'recording', last_word_heard: 30, last_word_tapped: 60, last_word_check: 'differ' });
  });

  test('they agree: attempted is the recording\'s last word, no flag', async () => {
    const got = await score.scoreRow(row({ last_word_index: 28 }), session(), on({ read: 30 }));
    expect(got.marks).toMatchObject({ attempted: 30, correct: 30 });
    expect(got.marks.detail).toMatchObject({ last_word_source: 'recording', last_word_heard: 30, last_word_tapped: 29, last_word_check: 'agree' });
  });

  test('the recording holds no speech: the child\'s tap is used, and the row is flagged', async () => {
    const got = await score.scoreRow(row({ last_word_index: 29 }), session(), on({ read: 30, words: 0 }));
    expect(got.marks).toMatchObject({ attempted: 30, correct: 0 });
    expect(got.marks.detail).toMatchObject({ last_word_source: 'child', last_word_heard: 0, last_word_tapped: 30, last_word_check: 'differ' });
  });

  test('no tap at all (time up): the recording gives the last word, nothing to check against', async () => {
    const got = await score.scoreRow(row({ last_word_index: null }), session(), on({ read: 30 }));
    expect(got.marks).toMatchObject({ attempted: 30, correct: 30 });
    expect(got.marks.detail).toMatchObject({ last_word_source: 'recording', last_word_heard: 30 });
    expect(got.marks.detail).not.toHaveProperty('last_word_check');
  });

  test('RDF manual is unchanged: the coach\'s word stays the check, the no-speech fallback says coach', async () => {
    const got = await score.scoreRow(row({ last_word_index: 29, last_word_how: 'confirm' }), session(), on({ read: 30, words: 0 }));
    expect(got.marks.detail).toMatchObject({ last_word_source: 'coach', last_word_tapped: 30, last_word_check: 'differ' });
  });

  test('the sweep reads the switch for the session\'s coach: on scores from the recording, off keeps the tap', async () => {
    const COACH_ON = 'aaaaaaaa-0000-4000-8000-0000000000a1';
    const COACH_OFF = 'aaaaaaaa-0000-4000-8000-0000000000a2';
    const SID2 = 'cccccccc-0000-4000-8000-000000000016';
    const rows = [row({ last_word_index: 59 }), { ...row({ last_word_index: 59 }), id: 'row-en-story-2', session_id: SID2, audio_r2_key: `child-test/sandbox/sch-1/${SID2}/sa/en.story_w3.webm` }];
    const sessions = [{ ...session(), coach_user_id: COACH_ON }, { ...session(), id: SID2, coach_user_id: COACH_OFF }];
    const db = fakeDb({ child_test_blocks: rows, child_test_sessions: sessions, child_test_events: [] });
    const seen = [];
    const out = await score.sweepOnce({ now: new Date('2026-10-22T15:00:00Z'), deps: { ...standIns({ read: 30 }), supabase: db, stopRules: false, coachLastWord: async (u) => { seen.push(u); return u === COACH_ON; } } });
    expect(out).toMatchObject({ scored: 2 });
    expect(seen).toEqual(expect.arrayContaining([COACH_ON, COACH_OFF]));
    expect(rows[0].ai_marks).toMatchObject({ attempted: 30, detail: { last_word_source: 'recording', last_word_tapped: 60, last_word_check: 'differ' } });
    expect(rows[1].ai_marks).toMatchObject({ attempted: 60 });
    expect(rows[1].ai_marks.detail).not.toHaveProperty('last_word_source');
  });

  test('the switch row itself (app_settings sa_coach_last_word = true, as on prod), read through the sweep\'s client', async () => {
    const r = row({ last_word_index: 59 });
    const db = fakeDb({ child_test_blocks: [r], child_test_sessions: [{ ...session(), coach_user_id: 'aaaaaaaa-0000-4000-8000-0000000000a3' }], child_test_events: [], app_settings: [{ key: 'sa_coach_last_word', value: true }] });
    await score.sweepOnce({ now: new Date('2026-10-22T15:00:00Z'), deps: { ...standIns({ read: 30 }), supabase: db, stopRules: false } });
    expect(r.ai_marks).toMatchObject({ attempted: 30, detail: { last_word_source: 'recording', last_word_heard: 30, last_word_tapped: 60, last_word_check: 'differ' } });
  });
});

function fakeDb(tables) {
  function query(name) {
    const f = []; let patch = null; let lim = null;
    const q = {
      select() { return q; }, order() { return q; }, in(c, v) { f.push((r) => v.includes(r[c])); return q; },
      limit(n) { lim = n; return q; },
      eq(c, v) { f.push((r) => r[c] === v); return q; },
      is(c, v) { f.push((r) => (r[c] ?? null) === v); return q; },
      like(c, v) { const p = v.replace(/%$/, ''); f.push((r) => String(r[c] || '').startsWith(p)); return q; },
      gte(c, v) { f.push((r) => String(r[c]) >= v); return q; },
      update(p) { patch = p; return q; },
      then(ok, bad) {
        const hit = (tables[name] || []).filter((r) => f.every((fn) => fn(r)));
        if (patch) { hit.forEach((r) => { Object.assign(r, patch); }); return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null }).then(ok, bad); }
        const copy = hit.map((r) => JSON.parse(JSON.stringify(r)));
        return Promise.resolve({ data: lim ? copy.slice(0, lim) : copy, error: null }).then(ok, bad);
      },
    };
    return q;
  }
  return { from: query };
}

