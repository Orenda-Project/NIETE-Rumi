'use strict';

/**
 * The speech gate let a comprehension answer through that the child never gave (a sandbox G3 walk, the row's shape with
 * ids and names removed). STT put one stray word on a 0.7-s silent clip (q4) and two on a 1.7-s clip that held another
 * word (q3), so "no word heard" never fired, and the model gave back the expected answer as what it heard: both correct.
 * The scorer's own path runs here (the phone's battery, the prompt, the marks); only the clip, STT and the model are
 * stand-ins, answering what they answered on sandbox.
 */

const score = require('../../shared/services/child-test/sa/score');

const SID = 'cccccccc-0000-4000-8000-000000000004';
const PHONE_SID = 'dddddddd-0000-4000-8000-00000000000b';
const KEY = (q) => `child-test/sandbox/sch-1/${SID}/sa/ur.story_comp_w3__ur.story2.${q}.webm`;
const QS = ['q1', 'q2', 'q3', 'q4', 'q5'];

const session = () => ({ id: SID, grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed', finished_at: '2026-10-22T05:19:56Z', asked: QS.map((q) => `ur.story2.${q}`) });
const row = () => ({
  id: 'row-ur-comp', session_id: SID, block: 'ur.story_comp_w3', response_mode: 'oral', ai_status: 'failed', ai_reason: 'final:sa_score_later',
  ai_marks: null, audio_r2_key: null, audio_r2_keys: QS.map((q) => ({ i: `ur.story2.${q}`, key: KEY(q) })), updated_at: '2026-10-22T05:16:30Z',
  responses: [
    { kind: 'result', mode: 'oral', asked: QS.map((q) => `ur.story2.${q}`), task_id: 'ur.story_comp_w3', recorded: true, attempted: 5, scored_on: 'later', session_id: PHONE_SID, time_used_ms: 18167, last_item_index: 4, stop_reason: 'complete' },
    ...[12947, 1711, 1578, 543, 633].map((ms, k) => ({ kind: 'answer', item_id: `ur.story2.q${k + 1}`, value: 'spoken', ms })),
  ],
});

// per clip: its length, what STT heard, what the model returned (sandbox, 05:17Z)
const SANDBOX = {
  q1: { dur: 13.1, stt: 'مٹھو میاں کہاں پھدک رہی تھی بلا بلا بلا', answer: 'مٹھو میاں کہاں پھدک رہی تھی بلا بلا بلا', verdict: 'wrong', confidence: 0.95 },
  q2: { dur: 1.7, stt: 'blah blah blah', answer: 'blah blah blah', verdict: 'wrong', confidence: 0.99 },
  q3: { dur: 1.7, stt: 'بابا', answer: 'بانو کی', verdict: 'correct', confidence: 0.98 },
  q4: { dur: 0.7, stt: 'Thursday', answer: 'کیونکہ بانو مٹھو میاں سے پیار کرتی تھی', verdict: 'correct', confidence: 0.95 },
  q5: { dur: 0.6, stt: 'با', answer: 'با با با با', verdict: 'wrong', confidence: 0.95 },
};
const qOf = (key) => /\.(q\d)\.webm$/.exec(key)[1];

function standIns(over = {}) {
  const asked = [];
  const sttFor = [];
  const at = { ...SANDBOX, ...over };
  return {
    asked, sttFor,
    clipOf: async (key) => ({ base64: 'AAAA', durationSec: at[qOf(key)].dur, key }),
    speechOf: async (clip) => { const q = qOf(clip.key); sttFor.push(q); const t = at[q].stt; return { words: t.split(/\s+/).filter(Boolean).length, text: t, model: 'soniox:test', cost: 0.00002, seconds: 1 }; },
    model: () => 'google/gemini-test',
    chatJSON: async ({ prompt }) => {
      const id = /\[(ur\.story2\.q\d)\]/.exec(prompt)[1];
      const g = at[id.slice(-2)];
      asked.push(id.slice(-2));
      return { json: { questions: [{ id, answer: g.answer, verdict: g.verdict, confidence: g.confidence }] }, cost: 0.001, seconds: 1 };
    },
  };
}

const marks = (got) => got.marks.detail.items.map((i) => [i.id.slice(-2), i.verdict, i.conf, !!i.no_speech]);

describe('the speech gate on comprehension: an answer the child never gave is no answer, never correct', () => {
  const before = { ...process.env };
  beforeEach(() => { process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.CHILD_TEST_SA_SPEECH_GATE = 'on'; delete process.env.CHILD_TEST_SA_MIN_SPEECH_S; });
  afterEach(() => { process.env = { ...before }; });

  test('the sandbox row: q3 (echo of the answer STT did not hear) and q4 (0.7 s) are no answer; q1 and q2 unchanged', async () => {
    const s = standIns();
    const got = await score.scoreRow(row(), session(), s);
    expect(got.ok).toBe(true);
    expect(marks(got)).toEqual([
      ['q1', 'wrong', 0.95, false],
      ['q2', 'wrong', 0.99, false],
      ['q3', 'no_answer', 0, true],
      ['q4', 'no_answer', 0, true],
      ['q5', 'no_answer', 0, true],
    ]);
    expect(got.marks).toMatchObject({ correct: 0, of: 5 });
    expect(got.marks.detail.items[2]).toMatchObject({ echo: true, heard: '' });
    // a clip under 1 s goes to neither STT nor the model
    expect(s.sttFor).toEqual(['q1', 'q2', 'q3']);
    expect(s.asked).toEqual(['q1', 'q2', 'q3']);
    expect(got.marks.meta.calls.filter((c) => c.model === 'duration').map((c) => c.clip_s)).toEqual([0.7, 0.6]);
  });

  test('a right answer STT heard too stays correct', async () => {
    const got = await score.scoreRow(row(), session(), standIns({ q3: { dur: 1.7, stt: 'بانو کی', answer: 'بانو کی', verdict: 'correct', confidence: 0.98 } }));
    expect(marks(got)[2]).toEqual(['q3', 'correct', 0.98, false]);
  });

  test('a right answer in another script than STT wrote stays correct (no comparison across scripts)', async () => {
    const got = await score.scoreRow(row(), session(), standIns({ q3: { dur: 1.7, stt: 'بانو کی', answer: 'Bano ki', verdict: 'correct', confidence: 0.9 } }));
    expect(marks(got)[2][1]).toBe('correct');
  });

  test('a right answer in the child\'s own words (not an accept verbatim) is left to the model', async () => {
    const got = await score.scoreRow(row(), session(), standIns({ q4: { dur: 3.2, stt: 'بانو کو مٹھو اچھا لگتا', answer: 'بانو کو مٹھو اچھا لگتا تھا', verdict: 'correct', confidence: 0.8 } }));
    expect(marks(got)[3]).toEqual(['q4', 'correct', 0.8, false]);
  });

  test('a one-word answer in a 0.9-s clip is heard and marked (the minimum is 0.8 s)', async () => {
    const s = standIns({ q3: { dur: 0.9, stt: 'بانو', answer: 'بانو', verdict: 'correct', confidence: 0.9 } });
    const got = await score.scoreRow(row(), session(), s);
    expect(s.sttFor).toContain('q3');
    expect(marks(got)[2]).toEqual(['q3', 'correct', 0.9, false]);
  });

  test('the minimum is a setting: 0 turns the length check off (STT and the model then hear q4)', async () => {
    process.env.CHILD_TEST_SA_MIN_SPEECH_S = '0';
    const s = standIns();
    await score.scoreRow(row(), session(), s);
    expect(s.sttFor).toContain('q4');
  });

  test('switch off: the marks are what the model said (unchanged)', async () => {
    delete process.env.CHILD_TEST_SA_SPEECH_GATE;
    const got = await score.scoreRow(row(), session(), standIns());
    expect(marks(got).map((m) => m[1])).toEqual(['wrong', 'wrong', 'correct', 'correct', 'wrong']);
  });

  test('one clip for all questions: the echo check reads each question against what STT heard in it', async () => {
    const one = { ...row(), audio_r2_keys: null, audio_r2_key: `child-test/sandbox/sch-1/${SID}/sa/ur.story_comp_w3.webm` };
    const s = {
      clipOf: async () => ({ base64: 'AAAA', durationSec: 20 }),
      speechOf: async () => ({ words: 2, text: 'بابا نہیں', model: 'soniox:test', cost: 0, seconds: 1 }),
      model: () => 'google/gemini-test',
      chatJSON: async () => ({ json: { questions: [
        { id: 'ur.story2.q3', answer: 'بانو کی', verdict: 'correct', confidence: 0.98 },
        { id: 'ur.story2.q1', answer: 'نہیں', verdict: 'wrong', confidence: 0.9 },
      ] }, cost: 0, seconds: 1 }),
    };
    const got = await score.scoreRow(one, session(), s);
    const by = Object.fromEntries(got.marks.detail.items.map((i) => [i.id.slice(-2), i.verdict]));
    expect(by).toMatchObject({ q1: 'wrong', q3: 'no_answer' });
  });
});
