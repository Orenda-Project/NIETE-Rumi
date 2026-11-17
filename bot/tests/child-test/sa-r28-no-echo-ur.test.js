'use strict';

/**
 * sa_r28_no_echo_ur (app_settings, default OFF): the echo check zeroed a "correct" answer when speech-to-text heard
 * under half of it; in Urdu speech-to-text hears the phone's loud question and misses the child's quiet answer. ON, an
 * Urdu questions task skips the echo check and its prompt says a repetition of the question is not an answer. English
 * keeps the check. Only the clip, speech-to-text and the model are stand-ins. Every fixture is synthetic.
 */

jest.mock('../../shared/config/supabase', () => ({ from: () => { throw new Error('no db in this test'); } }));

const score = require('../../shared/services/child-test/sa/score');
const noEchoUr = require('../../shared/services/child-test/app/no-echo-ur-switch');

const SID = 'eeeeeeee-0000-4000-8000-000000000041';
const KEY = (task, id) => `child-test/sandbox/sch-1/${SID}/sa/${task}__${id}.webm`;

const Q_UR = [
  { id: 'ur.story_x.q1', prompt: { text: 'بانو کس کے ساتھ کھیلتی تھی؟' }, accept: ['مٹھو', 'مٹھو میاں'], reject: ['بلی'], src: 'synthetic' },
  { id: 'ur.story_x.q2', prompt: { text: 'مٹھو کہاں رہتا تھا؟' }, accept: ['پنجرے میں'], reject: [], src: 'synthetic' },
];
const Q_EN = [{ id: 'en.story_x.q1', prompt: { text: 'Who did Bano play with?' }, accept: ['the parrot'], reject: ['the cat'], src: 'synthetic' }];
const BATTERY = {
  tasks: [
    { id: 'ur.story_x_comp', w3: true, kind: 'questions', subtask: 'reading_comprehension', lang: 'ur', response: 'record', stop: {}, items: Q_UR },
    { id: 'en.story_x_comp', w3: true, kind: 'questions', subtask: 'reading_comprehension', lang: 'en', response: 'record', stop: {}, items: Q_EN },
  ],
};
// per question: what speech-to-text heard (the phone's question only, on q1) and what the model returned
const HEARD = {
  'ur.story_x.q1': { stt: 'بانو کس کے ساتھ کھیلتی تھی', answer: 'مٹھو', verdict: 'correct', confidence: 0.9 },
  'ur.story_x.q2': { stt: 'بلی', answer: 'بلی', verdict: 'wrong', confidence: 0.9 },
  'en.story_x.q1': { stt: 'Who did Bano play with', answer: 'the parrot', verdict: 'correct', confidence: 0.9 },
};

const session = () => ({ id: SID, grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed', finished_at: '2026-11-17T10:00:00Z' });
const row = (block, qs) => ({
  id: `row-${block}`, session_id: SID, block, response_mode: 'oral', ai_status: 'failed', ai_reason: 'final:sa_score_later',
  ai_marks: null, audio_r2_key: null, audio_r2_keys: qs.map((q) => ({ i: q.id, key: KEY(block, q.id) })), updated_at: '2026-11-17T09:58:00Z',
  responses: [{ kind: 'result', mode: 'oral', asked: qs.map((q) => q.id), session_id: 'phone-session', time_used_ms: 20000 }],
});
const urRow = () => row('ur.story_x_comp', Q_UR);
const enRow = () => row('en.story_x_comp', Q_EN);
const idOf = (key) => /__(.+)\.webm$/.exec(key)[1];

function standIns() {
  const prompts = [];
  return {
    prompts,
    bank: { forms: {}, tasks: {} },
    phoneBattery: () => BATTERY,
    clipOf: async (key) => ({ base64: 'AAAA', durationSec: 3, key }),
    speechOf: async (clip) => { const t = HEARD[idOf(clip.key)].stt; return { words: t.split(/\s+/).length, text: t, model: 'stt:test', cost: 0.003, seconds: 1 }; },
    model: () => 'model:test',
    chatJSON: async ({ prompt }) => {
      prompts.push(prompt);
      const id = /\[([a-z]{2}\.story_x\.q\d)\]/.exec(prompt)[1];
      const h = HEARD[id];
      return { json: { questions: [{ id, answer: h.answer, verdict: h.verdict, confidence: h.confidence }] }, cost: 0.001, seconds: 1 };
    },
  };
}
const marks = (got) => got.marks.detail.items.map((i) => [i.id, i.verdict, !!i.echo]);
const OFF_Q_UR = "A child in a Pakistani government school (grade 1-5), alone with a phone and wearing headphones, answers questions about a passage the child has just read on the phone, in an Urdu EGRA task. The clip holds the child's spoken answer to ONE question, the one listed. Judge the meaning, in any language or wording: CORRECT if it gives the right information, WRONG if it is incorrect or the child says they do not know, NO_ANSWER if nothing audible is said. Use each item's accepted and rejected answers and rubric.\nThe passage:\nبانو اور مٹھو میاں\nITEMS:\n1. [ur.story_x.q1] بانو کس کے ساتھ کھیلتی تھی؟\n   accept: مٹھو | مٹھو میاں\n   reject: بلی\n   rubric: -\nReturn ONLY JSON: {\"questions\":[{\"id\":\"<id>\",\"answer\":\"<the child's answer as heard>\",\"verdict\":\"correct|wrong|no_answer\",\"confidence\":<0-1>}]}";
const OFF_Q_EN = "A child in a Pakistani government school (grade 1-5), alone with a phone and wearing headphones, answers questions about a passage the child has just read on the phone, in an English EGRA task. The clip holds the child's answers to the questions below, in order. Judge the meaning, in any language or wording: CORRECT if it gives the right information, WRONG if it is incorrect or the child says they do not know, NO_ANSWER if nothing audible is said. Use each item's accepted and rejected answers and rubric.\nThe passage:\nBano and the parrot.\nITEMS:\n1. [en.story_x.q1] Who did Bano play with?\n   accept: the parrot\n   reject: the cat\n   rubric: -\nReturn ONLY JSON: {\"questions\":[{\"id\":\"<id>\",\"answer\":\"<the child's answer as heard>\",\"verdict\":\"correct|wrong|no_answer\",\"confidence\":<0-1>}]}";

describe('sa_r28_no_echo_ur: the echo check is off for Urdu questions', () => {
  const before = { ...process.env };
  beforeEach(() => {
    process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.CHILD_TEST_SA_SPEECH_GATE = 'on';
    delete process.env.CHILD_TEST_SA_MIN_SPEECH_S; delete process.env.CHILD_TEST_SA_SECOND_VOICE;
  });
  afterEach(() => { process.env = { ...before }; });

  test('OFF (default): STT heard only the question, the model accepted the answer -> echo, 0', async () => {
    const got = await score.scoreRow(urRow(), session(), standIns());
    expect(marks(got)).toEqual([['ur.story_x.q1', 'no_answer', true], ['ur.story_x.q2', 'wrong', false]]);
    expect(got.marks.correct).toBe(0);
  });

  test("ON: the same Urdu row keeps the model's mark (1 correct), no echo flag", async () => {
    const got = await score.scoreRow(urRow(), session(), { ...standIns(), noEchoUr: true });
    expect(marks(got)).toEqual([['ur.story_x.q1', 'correct', false], ['ur.story_x.q2', 'wrong', false]]);
    expect(got.marks.correct).toBe(1);
  });

  test('ON: English keeps the echo check', async () => {
    const got = await score.scoreRow(enRow(), session(), { ...standIns(), noEchoUr: true });
    expect(marks(got)).toEqual([['en.story_x.q1', 'no_answer', true]]);
  });

  test('questionsPrompt: OFF text is byte-identical to today; ON adds the repetition sentence for Urdu only', () => {
    const p = score.__internals.questionsPrompt;
    const task = { kind: 'questions', subtask: 'reading_comprehension' };
    const ur = { lang: 'ur', task, questions: [{ id: 'ur.story_x.q1', prompt: { text: 'بانو کس کے ساتھ کھیلتی تھی؟' }, accept: ['مٹھو', 'مٹھو میاں'], reject: ['بلی'] }], passage: 'بانو اور مٹھو میاں', single: false };
    const en = { lang: 'en', task, questions: [{ id: 'en.story_x.q1', prompt: { text: 'Who did Bano play with?' }, accept: ['the parrot'], reject: ['the cat'] }], passage: 'Bano and the parrot.', single: true };
    expect(p(ur)).toBe(OFF_Q_UR);
    expect(p(en)).toBe(OFF_Q_EN);
    const S = score.__internals.NO_ECHO_UR;
    expect(typeof S).toBe('string');
    expect(p({ ...ur, noEcho: true })).toContain(S);
    expect(p({ ...ur, noEcho: true }).replace(` ${S}`, '')).toBe(OFF_Q_UR);
    expect(p({ ...en, noEcho: true })).toBe(OFF_Q_EN);
  });

  test('ON: the prompt the model gets on an Urdu row carries the sentence; OFF it does not', async () => {
    const on = standIns();
    await score.scoreRow(urRow(), session(), { ...on, noEchoUr: true });
    expect(on.prompts.every((x) => x.includes(score.__internals.NO_ECHO_UR))).toBe(true);
    const off = standIns();
    await score.scoreRow(urRow(), session(), off);
    expect(off.prompts.some((x) => x.includes(score.__internals.NO_ECHO_UR || '\u0000'))).toBe(false);
  });
});

describe('the sweep reads app_settings sa_r28_no_echo_ur', () => {
  const before = { ...process.env };
  beforeEach(() => { process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.CHILD_TEST_SA_SPEECH_GATE = 'on'; score.__internals.resetBoot(); });
  afterEach(() => { process.env = { ...before }; });

  function fakeDb(tables) {
    function query(name) {
      const f = []; let patch = null; let lim = null;
      const q = {
        select() { return q; }, order() { return q; }, in() { return q; },
        limit(n) { lim = n; return q; },
        eq(c, v) { f.push((r) => r[c] === v); return q; },
        is(c, v) { f.push((r) => (r[c] ?? null) === v); return q; },
        like(c, v) { const pre = v.replace(/%$/, ''); f.push((r) => String(r[c] || '').startsWith(pre)); return q; },
        gte(c, v) { f.push((r) => String(r[c]) >= v); return q; },
        update(x) { patch = x; return q; },
        then(ok, bad) {
          try {
            const hit = (tables[name] || []).filter((r) => f.every((fn) => fn(r)));
            if (patch) { hit.forEach((r) => Object.assign(r, patch)); return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null }).then(ok, bad); }
            const copy = hit.map((r) => JSON.parse(JSON.stringify(r)));
            return Promise.resolve({ data: lim ? copy.slice(0, lim) : copy, error: null }).then(ok, bad);
          } catch (e) { return Promise.reject(e).then(ok, bad); }
        },
      };
      return q;
    }
    return { from: query };
  }

  test('setting true: the Urdu questions row keeps the model mark', async () => {
    const r = urRow();
    const db = fakeDb({ child_test_blocks: [r], child_test_sessions: [session()], app_settings: [{ key: 'sa_r28_no_echo_ur', value: true }] });
    const out = await score.sweepOnce({ now: new Date('2026-11-17T10:05:00Z'), deps: { supabase: db, ...standIns() } });
    expect(out).toMatchObject({ found: 1, scored: 1 });
    expect(r.ai_marks).toMatchObject({ task: 'ur.story_x_comp', correct: 1, of: 2 });
  });
});

describe('the switch module (app_settings sa_r28_no_echo_ur)', () => {
  test("a test's noEchoUr wins; only JSON true is on; the setting fails closed", async () => {
    expect(noEchoUr.KEY).toBe('sa_r28_no_echo_ur');
    expect(await noEchoUr.enabled({ noEchoUr: true })).toBe(true);
    expect(await noEchoUr.enabled({ noEchoUr: 'true' })).toBe(false);
    const client = (rows, error = null) => ({ from: () => ({ select: () => ({ eq: async () => ({ data: rows, error }) }) }) });
    expect(await noEchoUr.on(1e13, client([{ key: 'sa_r28_no_echo_ur', value: true }]))).toBe(true);
    expect(await noEchoUr.on(2e13, client(null, { message: 'down' }))).toBe(false);
  });
});
