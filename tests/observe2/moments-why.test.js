/**
 * /observe2 — which moments Rumi picks, and why each one (bd-eal7zn.3; pilot sheet R5, R15).
 *
 * The audit (218 prod moments read by hand): 32% carried a label their words did not show ("understood?"
 * as a "'why' follow-up", "make groups" as "children led a part") and 16.5% showed no teaching at all
 * (a lone word, "shall I tell?", "no football tomorrow"). The v1 prompt asked for the clearest moments
 * "of different types where possible" with no test of whether the words are evidence. v2 asks for
 * evidence first, lists what is never a moment, asks for the question with its answer, and says to
 * return none rather than stretch a type. Each moment carries a short "why", in the coach's language,
 * shown under its quote in the check.
 *
 * Real: the moments module, the store, the rules, the check endpoint. Mocked at the boundary: the
 * database (in-memory), WhatsApp, the model (deps.llm).
 */
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockFake;
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../../bot/shared/services/observe/observe-debrief.service', () => ({ displayTimeZone: () => 'Asia/Karachi' }));

const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Moments = require('../../bot/shared/services/observe/observe2/moments');
const Check = require('../../bot/shared/routes/observe2-check-endpoint');

const TRANSCRIPT = [
  '[00:40] Teacher (UR): پودوں کو دھوپ کیوں چاہیے؟ آپ کا کیا خیال ہے؟',
  '[00:52] Student (UR): کیونکہ وہ دھوپ سے اپنا کھانا بناتے ہیں۔',
  '[05:10] Teacher (UR): نہیں، یہ غلط ہے۔ کوئی اور بتائے؟',
].join('\n\n');
const LONG_WHY = 'The teacher asked an open question and a child explained the reason in their own words, which shows real thinking about this lesson\'s topic.';
const MODEL_OUT = {
  moments: [
    { moment: 'ask', type: 'open_q_one', minute: '00:40', quote: 'پودوں کو دھوپ کیوں چاہیے؟ آپ کا کیا خیال ہے؟ — کیونکہ وہ دھوپ سے اپنا کھانا بناتے ہیں۔', why: LONG_WHY },
    { moment: 'wrong', type: 'wrong_ignored', minute: '05:10', quote: 'نہیں، یہ غلط ہے۔ کوئی اور بتائے؟' },
  ],
  counts: { closed_q: 1, praise_generic: 0 },
};
const LP_REF = { asset_id: 'a-1', lesson_id: 'grade_4_science_ch2_seg1', label: 'Why plants need sunlight, Grade 4 Science · Ch2 Day 1', subject: 'science', grade: '4' };

const formRow = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);
const cp = (s) => [...String(s)].length;

async function linked({ lang = 'en', answers = {} } = {}) {
  mockFake.__tables.users[0].preferred_language = lang;
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  Object.assign(formRow(form.id), { period_minutes: 40, answers, sealed_at: '2026-10-15T05:43:00.000Z' });
  mockFake.__tables.coaching_sessions = [{ id: 'sess-1', status: 'transcription_complete', transcript_text: TRANSCRIPT, observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 'teacher-1' }];
  await Store.linkSession(form.id, 'sess-1');
  return form.id;
}

async function promptFor(opts) {
  await linked(opts);
  const llm = jest.fn(() => Promise.resolve(MODEL_OUT));
  await Moments.runForSession('sess-1', '923000000001', { llm });
  return llm.mock.calls[0][0];
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeSupabase({
    users: [{ id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en' }],
  });
  process.env.OBSERVE2_CHECK_FLOW_ID = 'F-CHECK';
});
afterAll(() => { delete process.env.OBSERVE2_CHECK_FLOW_ID; });

describe('what the model is asked for (v2)', () => {
  test('evidence first, and a list of what is never a moment', async () => {
    const p = await promptFor();
    expect(p).toMatch(/NEVER A MOMENT/);
    for (const rx of [/names|roll-call/i, /discipline/i, /single word/i, /understood\?/i, /does not make sense|garbled/i, /homework|copies|page/i]) expect(p).toMatch(rx);
  });

  test('no filling of types: none rather than a stretched type, and no "different types" ask', async () => {
    const p = await promptFor();
    expect(p).not.toMatch(/of different types where possible/);
    expect(p).toMatch(/return none rather than stretch/i);
    expect(p).toMatch(/instruction to work in pairs or groups is NOT a choice/i);
    expect(p).toMatch(/NOT a handover/);
    expect(p).toMatch(/NOT open/);
  });

  test('a question moment is quoted with its answer, in the transcript\'s own words', async () => {
    const p = await promptFor();
    expect(p).toMatch(/question, then " — ", then the answer/);
    expect(p).toMatch(/Never translate, fix or paraphrase/);
  });

  test('the lesson is named when the coach picked its plan', async () => {
    const p = await promptFor({ answers: { lp: 'used', lp_ref: LP_REF } });
    expect(p).toContain(`THE LESSON: ${LP_REF.label}`);
  });

  test('"why" is asked for in the coach\'s language (Urdu), gender-neutral', async () => {
    const ur = await promptFor({ lang: 'ur' });
    expect(ur).toMatch(/"why".*in Urdu/s);
    expect(ur).toMatch(/never "he" or "she"/);
    expect(ur).toMatch(/never in Roman letters/);
  });

  test('"why" is asked for in the coach\'s language (English)', async () => {
    const en = await promptFor({ lang: 'en' });
    expect(en).toMatch(/"why".*in English/s);
    expect(en).not.toMatch(/Roman letters/);
  });

  test('the stored prompt version says v2', async () => {
    const id = await linked();
    await Moments.runForSession('sess-1', '923000000001', { llm: () => Promise.resolve(MODEL_OUT) });
    expect(formRow(id).rumi_moments.prompt_version).toBe('observe2-moments-v2');
  });
});

describe('why each moment, stored and shown', () => {
  test('stored with the moment, cut to its cap; none given is an empty why', async () => {
    const id = await linked();
    await Moments.runForSession('sess-1', '923000000001', { llm: () => Promise.resolve(MODEL_OUT) });
    const [ask, wrong] = formRow(id).rumi_moments.moments;
    expect(cp(ask.why)).toBeLessThanOrEqual(Moments.WHY_MAX);
    expect(ask.why.startsWith('The teacher asked an open question')).toBe(true);
    expect(wrong.why).toBe('');
  });

  test('the check shows it under the quote, inside the 300 code points of the description', async () => {
    const id = await linked();
    await Moments.runForSession('sess-1', '923000000001', { llm: () => Promise.resolve(MODEL_OUT) });
    const long = { ...formRow(id).rumi_moments.moments[0], quote: 'ک'.repeat(280) };
    formRow(id).rumi_moments.moments[0] = long;
    const out = await Check.handleObserve2CheckInit(`coach-1:observe2-check:${id}`);
    const d = out.data.heard_ask_1_d;
    expect(cp(d)).toBeLessThanOrEqual(300);
    expect(d.endsWith(`\n${long.why}`)).toBe(true);
    expect(d.startsWith('"ک')).toBe(true);
  });

  test('a moment from before v2 (no why) shows its quote as before', async () => {
    const id = await linked();
    await Moments.runForSession('sess-1', '923000000001', { llm: () => Promise.resolve(MODEL_OUT) });
    delete formRow(id).rumi_moments.moments[1].why;
    const wrong = await Check.handleObserve2CheckDataExchange(`coach-1:observe2-check:${id}`, 'HEARD_ASK', { screen: 'HEARD_ASK' });
    expect(wrong.screen).toBe('HEARD_WRONG');
    expect(wrong.data.heard_wrong_1_d).toBe('"نہیں، یہ غلط ہے۔ کوئی اور بتائے؟"');
  });
});
