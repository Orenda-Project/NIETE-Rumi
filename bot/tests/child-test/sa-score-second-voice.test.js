'use strict';

/**
 * A second voice in a recording (the tester: "always flag results that have a second voice that are heard"). With
 * CHILD_TEST_SA_SECOND_VOICE=on, every clip the scorer hears is also asked, in its own small call, whether another
 * person (an adult, another child) is heard speaking; the task's marks say so, and so does Results. The scoring
 * prompts are not touched (STORY is the study's prompt verbatim). The scorer's own path runs here; only the clip, STT
 * and the model are stand-ins.
 */

const score = require('../../shared/services/child-test/sa/score');
const sa = require('../../shared/services/child-test/app/sa-api.service');

const SID = 'cccccccc-0000-4000-8000-000000000004';
const PHONE_SID = 'dddddddd-0000-4000-8000-00000000000b';
const KEY = (q) => `child-test/sandbox/sch-1/${SID}/sa/ur.story_comp_w3__ur.story2.${q}.webm`;
const QS = ['q1', 'q2', 'q3'];

const session = () => ({ id: SID, grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed', finished_at: '2026-10-22T05:19:56Z', asked: QS.map((q) => `ur.story2.${q}`) });
const row = () => ({
  id: 'row-ur-comp', session_id: SID, block: 'ur.story_comp_w3', response_mode: 'oral', ai_status: 'failed', ai_reason: 'final:sa_score_later',
  ai_marks: null, audio_r2_key: null, audio_r2_keys: QS.map((q) => ({ i: `ur.story2.${q}`, key: KEY(q) })), updated_at: '2026-10-22T05:16:30Z',
  responses: [{ kind: 'result', mode: 'oral', asked: QS.map((q) => `ur.story2.${q}`), task_id: 'ur.story_comp_w3', recorded: true, attempted: 3, session_id: PHONE_SID, stop_reason: 'complete' }],
});
const qOf = (key) => /\.(q\d)\.webm$/.exec(key)[1];

/** voices: per question, what the voice check answers (true / false / 'fail'). */
function standIns(voices = {}) {
  const jobs = [];
  return {
    jobs,
    clipOf: async (key) => ({ base64: 'AAAA', durationSec: 4, key }),
    speechOf: async () => ({ words: 3, text: 'بانو کی بلی', model: 'soniox:test', cost: 0, seconds: 1 }),
    model: () => 'google/gemini-test',
    chatJSON: async ({ prompt, schema, job, audio }) => {
      jobs.push({ job, schema });
      if (job === 'child_test.sa_second_voice') {
        const v = voices[qOf(audio.key)];
        if (v === 'fail') throw new Error('model down');
        return { json: { second_voice: v === true, who: v === true ? 'adult' : 'none', confidence: 0.9 }, cost: 0.0002, seconds: 1 };
      }
      const id = /\[(ur\.story2\.q\d)\]/.exec(prompt)[1];
      return { json: { questions: [{ id, answer: 'بانو کی بلی', verdict: 'wrong', confidence: 0.9 }] }, cost: 0.001, seconds: 1 };
    },
  };
}

describe('a second voice in a recording is flagged on the marks (CHILD_TEST_SA_SECOND_VOICE)', () => {
  const before = { ...process.env };
  beforeEach(() => { process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; delete process.env.CHILD_TEST_SA_SPEECH_GATE; delete process.env.CHILD_TEST_SA_SECOND_VOICE; });
  afterEach(() => { process.env = { ...before }; });

  test('switch off: no voice check is made and the marks carry no flag (unchanged)', async () => {
    const s = standIns({ q2: true });
    const got = await score.scoreRow(row(), session(), s);
    expect(got.ok).toBe(true);
    expect(s.jobs.map((j) => j.job)).not.toContain('child_test.sa_second_voice');
    expect(got.marks.detail).not.toHaveProperty('second_voice');
  });

  test('on: one check per clip; a clip with another voice flags its item and the task', async () => {
    process.env.CHILD_TEST_SA_SECOND_VOICE = 'on';
    const s = standIns({ q1: false, q2: true, q3: false });
    const got = await score.scoreRow(row(), session(), s);
    expect(s.jobs.filter((j) => j.job === 'child_test.sa_second_voice')).toHaveLength(3);
    // the scoring calls keep their own schema; the voice check has its own
    expect(s.jobs.filter((j) => j.job === 'child_test.sa_questions').every((j) => j.schema.name === 'sa_questions')).toBe(true);
    expect(got.marks.detail).toMatchObject({ second_voice: true, second_voice_clips: 1, second_voice_checked: 3 });
    expect(got.marks.detail.items.map((i) => !!i.second_voice)).toEqual([false, true, false]);
    // the marks themselves are what the model said: a flag, never a change of score
    expect(got.marks.detail.items.map((i) => i.verdict)).toEqual(['wrong', 'wrong', 'wrong']);
    expect(got.marks.meta.calls.filter((c) => c.job === 'child_test.sa_second_voice')).toHaveLength(3);
  });

  test('on, nobody else heard: second_voice false', async () => {
    process.env.CHILD_TEST_SA_SECOND_VOICE = 'on';
    const got = await score.scoreRow(row(), session(), standIns({}));
    expect(got.marks.detail).toMatchObject({ second_voice: false, second_voice_clips: 0, second_voice_checked: 3 });
  });

  test('on: a voice check that fails never fails the row; it is counted as not checked', async () => {
    process.env.CHILD_TEST_SA_SECOND_VOICE = 'on';
    const got = await score.scoreRow(row(), session(), standIns({ q1: 'fail', q2: true }));
    expect(got.ok).toBe(true);
    expect(got.marks.detail).toMatchObject({ second_voice: true, second_voice_clips: 1, second_voice_checked: 2 });
  });

  test('one clip for the whole task (one recording per section): the task is flagged, every item with it', async () => {
    process.env.CHILD_TEST_SA_SECOND_VOICE = 'on';
    const one = { ...row(), audio_r2_keys: null, audio_r2_key: `child-test/sandbox/sch-1/${SID}/sa/ur.story_comp_w3__ur.story2.q1.webm` };
    const got = await score.scoreRow(one, session(), standIns({ q1: true }));
    expect(got.marks.detail).toMatchObject({ second_voice: true, second_voice_clips: 1, second_voice_checked: 1 });
  });

  test('on: the voice check gives the model room to think before its JSON (200 tokens ended half the prod checks no_json)', async () => {
    process.env.CHILD_TEST_SA_SECOND_VOICE = 'on';
    const s = standIns({});
    const asked = [];
    const inner = s.chatJSON;
    s.chatJSON = async (p) => { asked.push(p); return inner(p); };
    await score.scoreRow(row(), session(), s);
    const voice = asked.filter((p) => p.job === 'child_test.sa_second_voice');
    expect(voice).toHaveLength(3);
    expect(voice.every((p) => p.maxTokens >= 2000)).toBe(true);
  });

  test('on: a voice check with no JSON keeps why (finish reason, tokens) on its call record', async () => {
    process.env.CHILD_TEST_SA_SECOND_VOICE = 'on';
    const s = standIns({});
    const inner = s.chatJSON;
    const why = [{ finish_reason: 'length', content_chars: 0, reasoning_tokens: 200, completion_tokens: 200 }];
    s.chatJSON = async (p) => (p.job === 'child_test.sa_second_voice'
      ? { json: null, cost: 0.003, seconds: 8, error: 'no_json', detail: why }
      : inner(p));
    const got = await score.scoreRow(row(), session(), s);
    const calls = got.marks.meta.calls.filter((c) => c.job === 'child_test.sa_second_voice');
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.error === 'no_json' && c.second_voice === null)).toBe(true);
    expect(calls[0].detail).toEqual(why);
    expect(got.marks.detail).toMatchObject({ second_voice: false, second_voice_checked: 0 });
  });
});

describe('Results says a second voice was heard', () => {
  const COACH = 'aaaaaaaa-0000-4000-8000-000000000001';
  const world = (marks) => ({
    enabled: async () => true,
    supabase: { from: () => { throw new Error('no direct reads'); } },
    store: {
      getSession: async () => ({ ok: true, session: { id: SID, coach_user_id: COACH, grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed', device: {} } }),
      listBlocks: async () => ({ ok: true, blocks: [{ block: 'ur.story_comp_w3', response_mode: 'oral', lang: 'ur', ai_status: 'scored', audio_r2_key: 'k', ai_marks: marks, responses: [] }] }),
    },
    saStore: { findByClient: async () => ({ ok: true, sessionId: null }) },
    bank: null,
    now: () => new Date('2026-10-22T06:00:00Z'),
    log: () => {},
    logError: () => {},
  });

  test('a task whose marks heard another voice carries secondVoice: true', async () => {
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, world({ correct: 1, of: 3, detail: { second_voice: true, second_voice_clips: 1 } }));
    expect(out.tasks[0]).toMatchObject({ recording: 'scored', secondVoice: true });
  });

  test('no flag (or not checked): no secondVoice key at all', async () => {
    const out = await sa.saResults({ userId: COACH, sessionId: SID }, world({ correct: 1, of: 3, detail: { second_voice: false } }));
    expect(out.tasks[0]).not.toHaveProperty('secondVoice');
  });
});
