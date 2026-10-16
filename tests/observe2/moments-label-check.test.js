/**
 * /observe2 — a second look at each moment's label before the coach sees it (bd-eal7zn.8).
 *
 * After the quote check, about 1 in 3 moments still carried a label its words do not show (a closed
 * question as "open question", "make pairs" as "children led a part"; by hand, 0 of 17 hand-overs were
 * real). One batched call per visit, on the moments call's own job and model, reads each moment's words
 * against the type definitions and answers keep, relabel (to one of the existing types) or drop. The code
 * enforces it: a relabel must be a real type and pass the same speaker rule as any moment; each outcome
 * has its own counter, stored and logged. A failed or cut-off call keeps the moments as they were.
 *
 * Real: the moments module, the quote check, the label check, the store, the rules, completeJson (last
 * test). Mocked at the boundary: the database (in-memory), WhatsApp, the model (deps seams, LLM client).
 */
const { createFakeSupabase } = require('./helpers/fake-supabase');

let mockFake;
const mockCreate = jest.fn();
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFake.from(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock('../../bot/shared/services/llm-client', () => ({ getClient: () => ({ chat: { completions: { create: (...a) => mockCreate(...a) } } }) }));
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(() => Promise.resolve(true)),
  sendFlow: jest.fn(() => Promise.resolve(true)),
}));

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { logToFile } = require('../../bot/shared/utils/logger');
const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Moments = require('../../bot/shared/services/observe/observe2/moments');

// A made-up lesson, as the transcriber writes it.
const TRANSCRIPT = [
  '[00:40] Teacher (UR): پودوں کو دھوپ کیوں چاہیے؟ آپ کا کیا خیال ہے؟',
  '[00:52] Student (UR): کیونکہ وہ دھوپ سے اپنا کھانا بناتے ہیں۔',
  '[02:10] Teacher (UR): اسم کسے کہتے ہیں؟ کون بتائے گا؟',
  '[02:15] Student (UR): کسی چیز کا نام اسم کہلاتا ہے۔',
  '[05:10] Teacher (UR): اب دو دو بچے مل کر یہ سوال حل کریں۔',
  '[07:30] Student (UR): پتے سبز ہوتے ہیں کیونکہ ان میں کلوروفل ہوتا ہے۔',
  '[09:00] Teacher (UR): شاباش، بہت اچھی کوشش کی آپ نے، آپ نے خود سوچا۔',
  '[11:20] Teacher (UR): آج ہم نے پودوں کے بارے میں پڑھا، کل ٹیسٹ ہوگا۔',
].join('\n\n');

const M = (moment, type, minute, quote, why = 'A sentence on why.') => ({ moment, type, minute, quote, why });
const MODEL_OUT = {
  moments: [
    M('ask', 'open_q_one', '00:40', 'پودوں کو دھوپ کیوں چاہیے؟ آپ کا کیا خیال ہے؟ — کیونکہ وہ دھوپ سے اپنا کھانا بناتے ہیں۔'),
    M('ask', 'open_q_one', '02:10', 'اسم کسے کہتے ہیں؟ کون بتائے گا؟ — کسی چیز کا نام اسم کہلاتا ہے۔'),
    M('work', 'handover', '05:10', 'اب دو دو بچے مل کر یہ سوال حل کریں۔'),
    M('ask', 'long_answer', '07:30', 'پتے سبز ہوتے ہیں کیونکہ ان میں کلوروفل ہوتا ہے۔'),
    M('wrong', 'praise_effort', '09:00', 'شاباش، بہت اچھی کوشش کی آپ نے، آپ نے خود سوچا۔'),
    M('explain', 'life_link', '11:20', 'آج ہم نے پودوں کے بارے میں پڑھا، کل ٹیسٹ ہوگا۔'),
  ],
  counts: { closed_q: 3, praise_generic: 1 },
};
// One verdict per moment, in the order the check was shown them.
const VERDICTS = {
  verdicts: [
    { n: 1, verdict: 'keep' },
    { n: 2, verdict: 'drop' }, // a closed question: no type fits
    { n: 3, verdict: 'drop' }, // an instruction to work in pairs is never "children led a part"
    { n: 4, verdict: 'relabel', type: 'reasoning', why: 'The child gives the reason in their own words.' },
    { n: 5, verdict: 'relabel', type: 'closed_question', why: 'x' }, // not a type
    { n: 6, verdict: 'relabel', type: 'reasoning', why: 'x' }, // a child's type on the teacher's words
  ],
};
const reply = (out, used = 900) => ({ result: out, usage: { completion_tokens: used } });

const formRow = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);

async function linked() {
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  Object.assign(formRow(form.id), { period_minutes: 40, sealed_at: '2026-10-15T05:43:00.000Z' });
  mockFake.__tables.coaching_sessions = [{ id: 'sess-1', status: 'transcription_complete', transcript_text: TRANSCRIPT, observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 'teacher-1' }];
  await Store.linkSession(form.id, 'sess-1');
  return form.id;
}
const seams = (labelReply) => ({
  llm: jest.fn(() => Promise.resolve(reply(MODEL_OUT))),
  labelLlm: typeof labelReply === 'function' ? jest.fn(labelReply) : jest.fn(() => Promise.resolve(labelReply)),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockReset();
  mockFake = createFakeSupabase({
    users: [{ id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en' }],
  });
  process.env.OBSERVE2_CHECK_FLOW_ID = 'F-CHECK';
});
afterAll(() => { delete process.env.OBSERVE2_CHECK_FLOW_ID; });

describe('each label is checked against its words, and the code enforces the answer', () => {
  test('keep, relabel to a real type, drop; a relabel outside the types or against the speaker rule is dropped', async () => {
    const id = await linked();
    await Moments.runForSession('sess-1', '923000000001', seams(reply(VERDICTS)));
    const { moments } = formRow(id).rumi_moments;
    expect(moments.map((m) => [m.id, m.type, m.minute])).toEqual([
      ['ask_1', 'open_q_one', '00:40'],
      ['ask_2', 'reasoning', '07:30'],
    ]);
    expect(moments[1]).toMatchObject({ moment: 'ask', label: 'child explained why', why: 'The child gives the reason in their own words.' });
  });

  test('each outcome has its own counter, stored with the moments and logged', async () => {
    const id = await linked();
    await Moments.runForSession('sess-1', '923000000001', seams(reply(VERDICTS)));
    const labels = { status: 'ok', checked: 6, kept: 1, relabelled: 1, dropped: 2, relabel_invalid: 1, relabel_speaker: 1, missing: 0 };
    expect(formRow(id).rumi_moments.verified.labels).toEqual(labels);
    expect(logToFile).toHaveBeenCalledWith('[observe2] moment labels checked', expect.objectContaining({ formId: id, ...labels }), 'info');
  });

  test('the levels are added up from the checked labels', async () => {
    const id = await linked();
    await Moments.runForSession('sess-1', '923000000001', seams(reply(VERDICTS)));
    // the dropped "children led a part" no longer counts toward "Children's choices"
    expect(formRow(id).rumi_levels.C4).toMatchObject({ level: null });
    // the relabelled reason counts toward "Children's reasoning"
    expect(formRow(id).rumi_levels.D1).toMatchObject({ level: 2, hole: true });
  });

  test('a moment the reply leaves out is kept as it was, and counted', async () => {
    const id = await linked();
    await Moments.runForSession('sess-1', '923000000001', seams(reply({ verdicts: VERDICTS.verdicts.slice(0, 5) })));
    expect(formRow(id).rumi_moments.moments.map((m) => m.type)).toContain('life_link');
    expect(formRow(id).rumi_moments.verified.labels).toMatchObject({ missing: 1, checked: 6 });
  });
});

describe('what the check is asked', () => {
  test('one call for the whole visit: every moment with its words and the lines around it, and the type definitions', async () => {
    await linked();
    const s = seams(reply(VERDICTS));
    await Moments.runForSession('sess-1', '923000000001', s);
    expect(s.labelLlm).toHaveBeenCalledTimes(1);
    const [prompt, opts] = s.labelLlm.mock.calls[0];
    expect(opts).toEqual(expect.objectContaining({ maxTokens: 16000 }));
    for (const m of MODEL_OUT.moments) expect(prompt).toContain(m.quote);
    expect(prompt).toContain('[00:52] Student: کیونکہ وہ دھوپ سے اپنا کھانا بناتے ہیں۔');
    expect(prompt).toContain('- choice: the children decide something that matters');
    expect(prompt).toMatch(/"verdict":"keep\|relabel\|drop"/);
  });

  test('"children led a part" and "a real choice" get a strict test', async () => {
    await linked();
    const s = seams(reply(VERDICTS));
    await Moments.runForSession('sess-1', '923000000001', s);
    const [prompt] = s.labelLlm.mock.calls[0];
    expect(prompt).toMatch(/STRICT/);
    expect(prompt).toMatch(/handover.*keep it only if a child runs part of the lesson for the whole class/s);
    expect(prompt).toMatch(/choice.*keep it only if the children themselves decide something that matters/s);
    expect(prompt).toMatch(/children working in pairs or groups as they were told[^.]*never/);
  });

  test('without its own seam, the check goes through the moments call\'s seam (same job, same model)', async () => {
    await linked();
    const llm = jest.fn()
      .mockResolvedValueOnce(reply(MODEL_OUT))
      .mockResolvedValueOnce(reply(VERDICTS));
    await Moments.runForSession('sess-1', '923000000001', { llm });
    expect(llm).toHaveBeenCalledTimes(2);
    expect(llm.mock.calls[1][0]).toMatch(/STRICT/);
  });
});

describe('a check that fails never costs the coach the moments', () => {
  test.each([
    ['the call throws', () => Promise.reject(new Error('timeout')), 'error'],
    ['the reply is cut off at the output limit', () => Promise.resolve(reply({ verdicts: [] }, 16000)), 'cut_off'],
    ['the reply has no verdicts', () => Promise.resolve(reply({ moments: [] })), 'unreadable'],
  ])('%s: moments kept as checked, the check still opens, logged at error', async (_name, labelReply, reason) => {
    const id = await linked();
    const out = await Moments.runForSession('sess-1', '923000000001', seams(labelReply));
    expect(formRow(id).rumi_moments.moments).toHaveLength(6);
    expect(formRow(id).rumi_moments.verified.labels).toMatchObject({ status: 'failed', reason: expect.stringContaining(reason), checked: 6 });
    expect(logToFile).toHaveBeenCalledWith('[observe2] moment labels checked', expect.objectContaining({ status: 'failed' }), 'error');
    expect(out).toMatchObject({ action: 'check_sent' });
    expect(WhatsAppService.sendFlow).toHaveBeenCalled();
  });

  test('no moment left after the quote check: no call, nothing to check', async () => {
    const id = await linked();
    const s = { llm: jest.fn(() => Promise.resolve(reply({ moments: [], counts: {} }))), labelLlm: jest.fn() };
    await Moments.runForSession('sess-1', '923000000001', s);
    expect(s.labelLlm).not.toHaveBeenCalled();
    expect(formRow(id).rumi_moments.verified.labels).toMatchObject({ status: 'skipped', checked: 0 });
  });
});

describe('the default path (completeJson, the LLM client mocked)', () => {
  const choice = (content) => ({ choices: [{ finish_reason: 'stop', message: { content } }], usage: { completion_tokens: 800 } });

  // bd-08qvls.1: both calls are their own job now, observe2.moments (tests/llm/observe2-moments-job.test.js).
  test('the label check runs as observe2.moments, the moments call\'s own job', async () => {
    const id = await linked();
    mockCreate
      .mockResolvedValueOnce(choice(JSON.stringify(MODEL_OUT)))
      .mockResolvedValueOnce(choice(JSON.stringify(VERDICTS)));
    await Moments.runForSession('sess-1', '923000000001');
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[1][0]).toMatchObject({ job: 'observe2.moments', max_completion_tokens: 16000 });
    expect(mockCreate.mock.calls[1][0].model).toBe(mockCreate.mock.calls[0][0].model);
    expect(formRow(id).rumi_moments.verified.labels).toMatchObject({ status: 'ok', relabelled: 1 });
  });
});
