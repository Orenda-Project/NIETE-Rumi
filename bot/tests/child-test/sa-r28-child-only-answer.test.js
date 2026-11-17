'use strict';

/**
 * sa_r28_child_only_answer (app_settings, default OFF): in coach-led sums an adult may say the right answer after the
 * child's wrong one, and the model hears the whole clip. ON, the spoken-maths prompt says to mark only the child's own
 * final answer. Only the clip, speech-to-text and the model are stand-ins. Every fixture is synthetic.
 */

jest.mock('../../shared/config/supabase', () => ({ from: () => { throw new Error('no db in this test'); } }));

const score = require('../../shared/services/child-test/sa/score');
const childOnly = require('../../shared/services/child-test/app/child-only-answer-switch');

const SID = 'eeeeeeee-0000-4000-8000-000000000048';
const ITEMS = [
  { id: 'ma.add2i.01', show: '13 + 6', target: 19, answer: 19, src: 'synthetic' },
  { id: 'ma.add2i.02', show: '18 + 7', target: 25, answer: 25, src: 'synthetic' },
];
const BATTERY = { tasks: [{ id: 'ma.add2i', w3: true, kind: 'oral', subtask: 'mental_addition', lang: null, response: 'record', present: 'one_at_a_time', time_limit_s: null, stop: {}, items: ITEMS }] };
const session = () => ({ id: SID, grade: 3, form: 'A', item_bank_version: 'sa-battery', status: 'completed', finished_at: '2026-11-17T10:00:00Z' });
const row = () => ({
  id: 'row-ma.add2i', session_id: SID, block: 'ma.add2i', lang: 'ur', response_mode: 'record', ai_status: 'failed', ai_reason: 'final:sa_score_later',
  ai_marks: null, audio_r2_key: `child-test/sandbox/sch-1/${SID}/sa/ma.add2i.webm`, audio_r2_keys: null, updated_at: '2026-11-17T09:58:00Z',
  responses: [{ kind: 'result', mode: 'record', session_id: 'phone-session', time_used_ms: 20000, cells: [{ i: 0 }, { i: 1 }] }],
});

/**
 * The clip: item 1, the child says 18 and then a coach says 19; item 2, the child says 25. A model that is not told to
 * mark the child alone credits the coach's 19 (the pattern seen in coach-led sums); told so, it marks the child's 18.
 */
function standIns() {
  const prompts = [];
  return {
    prompts,
    bank: { forms: {}, tasks: {} },
    phoneBattery: () => BATTERY,
    clipOf: async (key) => ({ base64: 'AAAA', durationSec: 8, key }),
    speechOf: async () => ({ words: 4, text: 'اٹھارہ انیس پچیس', model: 'stt:test', cost: 0.003, seconds: 1 }),
    model: () => 'model:test',
    chatJSON: async ({ prompt }) => {
      prompts.push(prompt);
      const told = Boolean(score.__internals.CHILD_ONLY) && prompt.includes(score.__internals.CHILD_ONLY);
      const first = told ? { i: 1, heard: '18', v: 'w', conf: 0.8 } : { i: 1, heard: '19', v: 'c', conf: 0.8 };
      return { json: { found: true, last_attempted: 2, letters_correct: told ? 1 : 2, items: [first, { i: 2, heard: '25', v: 'c', conf: 0.9 }] }, cost: 0.001, seconds: 1 };
    },
  };
}
const OFF_ORAL = "A child in a Pakistani government school (grade 3-5), alone with a phone and wearing headphones, is doing an EGMA maths task: it says aloud the answer to each sum shown, worked out in its head. The phone showed the items ONE AT A TIME, in this order. The child may answer in Urdu, English or a mix (e.g. «انیس», \"nineteen\", \"unees\"); judge the NUMBER said. The phone's own voice may be faintly heard; ignore it.\nMarking rules: \"c\" if the child's final answer for that item is the correct number (a self-correction counts), \"w\" if it says a different number or \"I don't know\", \"s\" if it never reached the item or said nothing for it.\nITEMS (position: what was shown → the correct answer):\n1: shown \"3 + 4\" → correct answer 7\n2: shown \"5 + 2\" → correct answer 7\nFor EVERY position 1-2 return v = \"c\", \"w\" or \"s\", heard = the number the child said (\"\" if none), conf = your confidence 0-1.\nReturn ONLY JSON: {\"found\": true, \"last_attempted\": <int>, \"letters_correct\": <int>, \"items\": [{\"i\": 1, \"heard\": \"...\", \"v\": \"c|w|s\", \"conf\": 0.9}, ...]}";

describe("sa_r28_child_only_answer: spoken maths marks the child's own final answer", () => {
  const before = { ...process.env };
  beforeEach(() => {
    process.env.CHILD_TEST_SA_SCORER = 'on'; process.env.CHILD_TEST_R2_ENV = 'sandbox'; process.env.CHILD_TEST_SA_SPEECH_GATE = 'on';
    delete process.env.CHILD_TEST_SA_MIN_SPEECH_S; delete process.env.CHILD_TEST_SA_SECOND_VOICE;
  });
  afterEach(() => { process.env = { ...before }; });

  test('oralPrompt: OFF text is byte-identical to today; ON adds the child-only sentence', () => {
    const p = score.__internals.oralPrompt;
    const a = { lang: 'ur', task: { subtask: 'mental_addition' }, items: [{ show: '3 + 4', answer: '7' }, { show: '5 + 2', answer: '7' }], one: true };
    expect(p(a)).toBe(OFF_ORAL);
    expect(p({ ...a, childOnly: false })).toBe(OFF_ORAL);
    const S = score.__internals.CHILD_ONLY;
    expect(typeof S).toBe('string');
    // the signed sentence, by value: an answer that follows coach SUPPORT ("louder", "next") keeps its credit; only a number
    // another person said, or a change to it, is discounted, and the item is marked from what the child said before
    expect(S).toBe('Mark only the child\'s own answer for each item (a self-correction by the child counts). Ignore every other speaker, adult or child: a number said by another person is never the child\'s answer, and a number the child repeats or changes to after another person has said it is not either; mark such an item from what the child said before the other person spoke ("w" if a different number, "s" if nothing). Other words from another person (instructions, encouragement) do not change the mark.');
    const on = p({ ...a, childOnly: true });
    expect(on).toContain(S);
    expect(on.replace(` ${S}`, '')).toBe(OFF_ORAL);
  });

  test("OFF (default): the model is not told, credits the coach's answer: 2 correct", async () => {
    const s = standIns();
    const got = await score.scoreRow(row(), session(), s);
    expect(got.marks.correct).toBe(2);
    expect(s.prompts.some((x) => x.includes(score.__internals.CHILD_ONLY || '\u0000'))).toBe(false);
  });

  test("ON: the model is told to mark the child alone: the child's 18 is wrong, 1 correct", async () => {
    const s = standIns();
    const got = await score.scoreRow(row(), session(), { ...s, childOnlyAnswer: true });
    expect(s.prompts).toHaveLength(1);
    expect(s.prompts[0]).toContain(score.__internals.CHILD_ONLY);
    expect(got.marks.correct).toBe(1);
    expect(got.marks.detail.items.map((i) => [i.verdict, i.heard])).toEqual([['wrong', '18'], ['correct', '25']]);
  });
});

describe('the sweep reads app_settings sa_r28_child_only_answer', () => {
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

  test('setting true: the spoken-maths row is marked with the child-only prompt', async () => {
    const r = row();
    const db = fakeDb({ child_test_blocks: [r], child_test_sessions: [session()], app_settings: [{ key: 'sa_r28_child_only_answer', value: true }] });
    const out = await score.sweepOnce({ now: new Date('2026-11-17T10:05:00Z'), deps: { supabase: db, ...standIns() } });
    expect(out).toMatchObject({ found: 1, scored: 1 });
    expect(r.ai_marks).toMatchObject({ task: 'ma.add2i', correct: 1 });
  });
});

describe('the switch module (app_settings sa_r28_child_only_answer)', () => {
  test("a test's childOnlyAnswer wins; only JSON true is on; the setting fails closed", async () => {
    expect(childOnly.KEY).toBe('sa_r28_child_only_answer');
    expect(await childOnly.enabled({ childOnlyAnswer: true })).toBe(true);
    expect(await childOnly.enabled({ childOnlyAnswer: 1 })).toBe(false);
    const client = (rows, error = null) => ({ from: () => ({ select: () => ({ eq: async () => ({ data: rows, error }) }) }) });
    expect(await childOnly.on(1e13, client([{ key: 'sa_r28_child_only_answer', value: true }]))).toBe(true);
    expect(await childOnly.on(2e13, client(null, { message: 'down' }))).toBe(false);
  });
});
