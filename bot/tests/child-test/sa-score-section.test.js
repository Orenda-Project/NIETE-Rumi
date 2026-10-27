'use strict';

/**
 * One recording per section (the phone's sa_section_recording): an oral task (comprehension, listening, spoken maths)
 * is recorded once, from Begin to the task's end, so an early or late answer is never cut. The row has one
 * audio_r2_key and the result carries rec_section: true and rec_marks [{ item_id, ask_ms, answer_ms, end_ms }] (ms from
 * the recording's start). The scorer cuts each item's stretch, from 1 s before its answer window opens to 2 s into the
 * next question (a late self-correction; never past that question's end; the last: 2.5 s after its screen moved on),
 * and marks it as it marks a per-item clip today.
 * The scorer's own path runs here; only the cut, STT and the model are stand-ins.
 */

const score = require('../../shared/services/child-test/sa/score');

const SID = 'cccccccc-0000-4000-8000-000000000005';
const PHONE_SID = 'dddddddd-0000-4000-8000-00000000000c';
const KEY = `child-test/sandbox/sch-1/${SID}/sa/ur.story_comp_w3.webm`;
const QS = ['q1', 'q2', 'q3'];
const ID = (q) => `ur.story2.${q}`;

const session = () => ({ id: SID, grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed', finished_at: '2026-10-22T14:19:56Z', asked: QS.map(ID) });
// the phone's marks: q1 asked at 0 s, answer window 4 s → moved on 9 s; q2 10 s / 13 s / 20 s; q3 21 s / 24.5 s / 30 s
const REC_MARKS = [
  { item_id: ID('q1'), ask_ms: 0, answer_ms: 4000, end_ms: 9000 },
  { item_id: ID('q2'), ask_ms: 10000, answer_ms: 13000, end_ms: 20000 },
  { item_id: ID('q3'), ask_ms: 21000, answer_ms: 24500, end_ms: 30000 },
];
const row = (res = {}) => ({
  id: 'row-ur-comp-section', session_id: SID, block: 'ur.story_comp_w3', response_mode: 'oral', ai_status: 'failed', ai_reason: 'final:sa_score_later',
  ai_marks: null, audio_r2_key: KEY, audio_r2_keys: null, updated_at: '2026-10-22T14:16:30Z',
  responses: [{ kind: 'result', mode: 'oral', asked: QS.map(ID), task_id: 'ur.story_comp_w3', recorded: true, attempted: 3, session_id: PHONE_SID, stop_reason: 'complete', rec_section: true, rec_marks: REC_MARKS, ...res }],
});

// per item: what STT hears in its stretch and what the model answers
const HEARD = {
  q1: { stt: 'بانو کی', answer: 'بانو کی', verdict: 'correct', confidence: 0.9 },
  q2: { stt: '', answer: 'کیونکہ وہ خوش تھی', verdict: 'correct', confidence: 0.9 },
  q3: { stt: 'پتہ نہیں', answer: 'پتہ نہیں', verdict: 'wrong', confidence: 0.9 },
};

function standIns() {
  const cuts = [];
  const prompts = [];
  return {
    cuts, prompts,
    clipOf: async () => { throw new Error('a section row is cut, never sent whole'); },
    sliceOf: async (key, windows) => {
      cuts.push({ key, windows });
      return windows.map((w) => ({ base64: 'AAAA', durationSec: w.to_s - w.from_s, item: w.item_id }));
    },
    speechOf: async (clip) => { const t = HEARD[clip.item.slice(-2)].stt; return { words: t.split(/\s+/).filter(Boolean).length, text: t, model: 'soniox:test', cost: 0, seconds: 1 }; },
    model: () => 'google/gemini-test',
    chatJSON: async ({ prompt, audio }) => {
      prompts.push(prompt);
      const id = /\[(ur\.story2\.q\d)\]/.exec(prompt)[1];
      const g = HEARD[id.slice(-2)];
      return { json: { questions: [{ id, answer: g.answer, verdict: g.verdict, confidence: g.confidence }] }, cost: 0.001, seconds: 1, audio };
    },
  };
}

describe('one recording per section: each item is cut from the task\'s one clip by the phone\'s marks', () => {
  const before = { ...process.env };
  beforeEach(() => { process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.CHILD_TEST_SA_SPEECH_GATE = 'on'; delete process.env.CHILD_TEST_SA_MIN_SPEECH_S; });
  afterEach(() => { process.env = { ...before }; });

  test('comprehension: one download, one stretch per question, each marked on its own (the gate per stretch)', async () => {
    const s = standIns();
    const got = await score.scoreRow(row(), session(), s);
    expect(got.ok).toBe(true);
    expect(s.cuts).toHaveLength(1);
    expect(s.cuts[0].key).toBe(KEY);
    expect(s.cuts[0].windows).toEqual([
      { item_id: ID('q1'), from_s: 3, to_s: 12 },
      { item_id: ID('q2'), from_s: 12, to_s: 23 },
      { item_id: ID('q3'), from_s: 23.5, to_s: 32.5 },
    ]);
    // one question per call, as with a per-question clip
    expect(s.prompts).toHaveLength(2);
    expect(s.prompts.every((p) => /ONE question/.test(p))).toBe(true);
    expect(got.marks.detail.items.map((i) => [i.id.slice(-2), i.verdict, !!i.no_speech])).toEqual([
      ['q1', 'correct', false],
      ['q2', 'no_answer', true],   // STT heard nothing in q2's stretch: no answer, never the model's "correct"
      ['q3', 'wrong', false],
    ]);
    expect(got.marks).toMatchObject({ correct: 1, of: 3 });
    expect(got.marks.detail.section).toBe(true);
  });

  test('a question the phone has no mark for (never asked, or the tab died) is no answer, not cut', async () => {
    const s = standIns();
    const got = await score.scoreRow(row({ rec_marks: REC_MARKS.slice(0, 2) }), session(), s);
    expect(s.cuts[0].windows.map((w) => w.item_id)).toEqual([ID('q1'), ID('q2')]);
    // q2 is now the last mark: its stretch runs to 2.5 s after its screen moved on
    expect(s.cuts[0].windows[1]).toEqual({ item_id: ID('q2'), from_s: 12, to_s: 22.5 });
    expect(got.marks.detail.items[2]).toMatchObject({ id: ID('q3'), verdict: 'no_answer' });
  });

  test('marks out of order are put in recording order; an answer before 1 s starts at 0', async () => {
    const s = standIns();
    const marks = [{ ...REC_MARKS[1] }, { item_id: ID('q1'), ask_ms: 0, answer_ms: 500, end_ms: 9000 }, { ...REC_MARKS[2] }];
    await score.scoreRow(row({ rec_marks: marks }), session(), s);
    expect(s.cuts[0].windows[0]).toEqual({ item_id: ID('q1'), from_s: 0, to_s: 12 });
  });

  test('a section row without usable marks is scored whole, as one clip for all questions (today\'s path)', async () => {
    const s = standIns();
    s.clipOf = async () => ({ base64: 'AAAA', durationSec: 30, item: ID('q1') });
    s.chatJSON = async ({ prompt }) => { s.prompts.push(prompt); return { json: { questions: QS.map((q) => ({ id: ID(q), answer: 'x', verdict: 'wrong', confidence: 0.5 })) }, cost: 0, seconds: 1 }; };
    const got = await score.scoreRow(row({ rec_marks: [] }), session(), s);
    expect(s.cuts).toHaveLength(0);
    expect(s.prompts).toHaveLength(1);
    expect(got.marks.detail.items.map((i) => i.verdict)).toEqual(['wrong', 'wrong', 'wrong']);
  });

  test('spoken maths: each sum is cut from the task\'s one clip and marked alone', async () => {
    const s = standIns();
    const asked = [];
    s.speechOf = async () => ({ words: 1, text: 'انیس', model: 'soniox:test', cost: 0, seconds: 1 });
    s.chatJSON = async ({ prompt }) => { asked.push(prompt); return { json: { found: true, last_attempted: 1, letters_correct: 1, items: [{ i: 1, heard: '19', v: 'c', conf: 0.9 }] }, cost: 0, seconds: 1 }; };
    const maths = {
      ...row(), id: 'row-ma-add', block: 'ma.add2i', audio_r2_key: `child-test/sandbox/sch-1/${SID}/sa/ma.add2i.webm`,
      responses: [{ kind: 'result', mode: 'oral', task_id: 'ma.add2i', session_id: PHONE_SID, stop_reason: 'complete', rec_section: true,
        rec_marks: [{ item_id: 'ma.add2i.01', ask_ms: 0, answer_ms: 2000, end_ms: 8000 }, { item_id: 'ma.add2i.02', ask_ms: 9000, answer_ms: 11000, end_ms: 15000 }] }],
    };
    const got = await score.scoreRow(maths, session(), s);
    expect(got.ok).toBe(true);
    expect(s.cuts[0].windows).toEqual([{ item_id: 'ma.add2i.01', from_s: 1, to_s: 11 }, { item_id: 'ma.add2i.02', from_s: 10, to_s: 17.5 }]);
    expect(asked).toHaveLength(2);
    expect(asked[0]).toMatch(/1: shown "13 \+ 6"/);
    expect(asked[1]).toMatch(/1: shown "18 \+ 7"/);
    expect(got.marks.detail.items.map((i) => i.verdict)).toEqual(['correct', 'correct']);
  });

  test('with CHILD_TEST_SA_SECOND_VOICE: the second-voice check hears the whole section clip once, never once per cut', async () => {
    process.env.CHILD_TEST_SA_SECOND_VOICE = 'on';
    const s = standIns();
    const whole = [];
    const voice = [];
    s.clipOf = async (key) => { whole.push(key); return { base64: 'AAAA', durationSec: 32, item: ID('q1') }; };
    const mark = s.chatJSON;
    s.chatJSON = async (args) => {
      if (args.job === 'child_test.sa_second_voice') { voice.push(args.audio.key); return { json: { second_voice: true, who: 'adult', confidence: 0.9 }, cost: 0, seconds: 1 }; }
      return mark(args);
    };
    const got = await score.scoreRow(row(), session(), s);
    expect(got.ok).toBe(true);
    expect(s.cuts).toHaveLength(1);
    expect(whole).toEqual([KEY]);
    expect(voice).toEqual([KEY]);
    expect(got.marks.detail).toMatchObject({ section: true, second_voice: true, second_voice_clips: 1, second_voice_checked: 1 });
    expect(got.marks.detail.items.every((i) => i.second_voice === true)).toBe(true);
  });
});
