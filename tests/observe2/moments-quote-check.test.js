/**
 * /observe2 — every moment's quote is checked against the transcript, in code, before the coach sees
 * it (bd-eal7zn.3; pilot sheet R5, R15).
 *
 * The audit of 1,391 prod moments found the model quotes the transcript faithfully (98.4% verbatim),
 * but also one-word quotes that show nothing (12.1% are one or two words), "child" moments that quote
 * the teacher (44 of 325), and the same words reused for two moments. The model is asked not to; the
 * code makes sure. A quote not in the transcript, under three words (generic praise exempt), said by
 * the wrong speaker for its type, or a repeat is dropped, each with its own counter; a near match is
 * repaired to the transcript's words; the minute is the transcript line's.
 *
 * Real: the moments module, the quote check, the store, the rules. Mocked at the boundary: the
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

const WhatsAppService = require('../../bot/shared/services/whatsapp.service');
const { logToFile } = require('../../bot/shared/utils/logger');
const Store = require('../../bot/shared/services/observe/observe2/field-form.store');
const Moments = require('../../bot/shared/services/observe/observe2/moments');

// A made-up lesson, Urdu and English, as the transcriber writes it.
const TRANSCRIPT = [
  '[00:40] Teacher (UR): پودوں کو دھوپ کیوں چاہیے؟ آپ کا کیا خیال ہے؟',
  '[00:52] Student (UR): کیونکہ وہ دھوپ سے اپنا کھانا بناتے ہیں۔',
  '[03:05] Teacher (UR): شاباش۔',
  '[05:10] Teacher (UR): نہیں، یہ غلط ہے۔ کوئی اور بتائے؟',
  '[07:30] Student (UR): جی۔',
  '[09:00] Teacher (UR): پتے کو سبز رنگ کلوروفل دیتا ہے، یہ وہ چیز ہے جو دھوپ کو پکڑتی ہے۔',
  '[12:15] Teacher (EN): Why do you think the leaf is green? Tell me in your own words.',
  '[12:40] Student (EN): Because it has chlorophyll that catches the light.',
].join('\n\n');

const M = (moment, type, minute, quote) => ({ moment, type, minute, quote });
const MODEL_OUT = {
  moments: [
    // a question and its answer, two lines: kept, at the question's minute
    M('ask', 'open_q_one', '00:40', 'پودوں کو دھوپ کیوں چاہیے؟ آپ کا کیا خیال ہے؟ — کیونکہ وہ دھوپ سے اپنا کھانا بناتے ہیں۔'),
    // near-verbatim ("the" left out) at the wrong minute: repaired to the transcript's words and minute
    M('ask', 'reasoning', '21:00', 'Because it has chlorophyll that catches light.'),
    // not in the transcript
    M('ask', 'beyond', '14:00', 'Plants also need water to grow tall and strong.'),
    // one word
    M('ask', 'long_answer', '07:30', 'جی۔'),
    // one word, but generic praise is the evidence itself
    M('wrong', 'praise_generic', '03:05', 'شاباش۔'),
    // a child's question that the transcript gives to the teacher
    M('ask', 'content_q', '05:10', 'نہیں، یہ غلط ہے۔ کوئی اور بتائے؟'),
    // the same words as the teacher's: kept
    M('wrong', 'wrong_ignored', '05:10', 'نہیں، یہ غلط ہے۔ کوئی اور بتائے؟'),
    // the words of the first moment again
    M('explain', 'why_explained', '00:40', 'پودوں کو دھوپ کیوں چاہیے؟ آپ کا کیا خیال ہے؟'),
    M('explain', 'term_defined', '09:00', 'پتے کو سبز رنگ کلوروفل دیتا ہے، یہ وہ چیز ہے جو دھوپ کو پکڑتی ہے۔'),
  ],
  counts: { closed_q: 2, praise_generic: 1 },
};

const formRow = (id) => mockFake.__tables.observation_field_forms.find((r) => r.id === id);

async function linked(transcript = TRANSCRIPT, lang = 'en') {
  mockFake.__tables.users[0].preferred_language = lang;
  const { form } = await Store.createForm({ observerUserId: 'coach-1', teacherUserId: 'teacher-1', visitContext: {} });
  Object.assign(formRow(form.id), { period_minutes: 40, sealed_at: '2026-10-15T05:43:00.000Z' });
  mockFake.__tables.coaching_sessions = [{ id: 'sess-1', status: 'transcription_complete', transcript_text: transcript, observation_type: 'leader_observation', observer_user_id: 'coach-1', user_id: 'teacher-1' }];
  await Store.linkSession(form.id, 'sess-1');
  return form.id;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFake = createFakeSupabase({
    users: [{ id: 'coach-1', phone_number: '923000000001', name: 'Coach', preferred_language: 'en' }],
  });
  process.env.OBSERVE2_CHECK_FLOW_ID = 'F-CHECK';
});
afterAll(() => { delete process.env.OBSERVE2_CHECK_FLOW_ID; });

describe('what the model returns is checked against the transcript before it is stored', () => {
  test('kept, repaired, re-timed or dropped, each for its own reason', async () => {
    const id = await linked();
    await Moments.runForSession('sess-1', '923000000001', { llm: () => Promise.resolve(MODEL_OUT) });
    const { moments } = formRow(id).rumi_moments;
    const byType = Object.fromEntries(moments.map((m) => [m.type, m]));
    expect(moments.map((m) => m.type).sort()).toEqual(['open_q_one', 'praise_generic', 'reasoning', 'term_defined', 'wrong_ignored'].sort());
    expect(byType.open_q_one.minute).toBe('00:40');
    expect(byType.reasoning).toMatchObject({ quote: 'Because it has chlorophyll that catches the light.', minute: '12:40' });
    expect(byType.praise_generic.quote).toBe('شاباش۔');
    expect(new Set(moments.map((m) => m.id)).size).toBe(moments.length);
  });

  test('the counts are stored with the moments and logged as their own line', async () => {
    const id = await linked();
    await Moments.runForSession('sess-1', '923000000001', { llm: () => Promise.resolve(MODEL_OUT) });
    const verified = {
      returned: 9, kept: 5, repaired: 1, minute_fixed: 1,
      dropped: { not_in_transcript: 1, too_short: 1, speaker: 1, duplicate: 1 },
    };
    expect(formRow(id).rumi_moments.verified).toEqual(verified);
    expect(logToFile).toHaveBeenCalledWith('[observe2] moments checked against the transcript', expect.objectContaining({ formId: id, ...verified }), 'info');
  });

  test('the levels the recording adds up to are counted from the moments that survived', async () => {
    const id = await linked();
    await Moments.runForSession('sess-1', '923000000001', { llm: () => Promise.resolve(MODEL_OUT) });
    // the dropped "child's own question" is not counted: no child asked anything
    expect(formRow(id).rumi_levels.D5).toMatchObject({ level: 1 });
    expect(formRow(id).rumi_levels.D1).toMatchObject({ level: 2, hole: true });
  });

  test('a transcript that is one long turn: a child moment cannot be placed, so it is dropped', async () => {
    const id = await linked('[00:08] Teacher (UR): پودوں کو دھوپ کیوں چاہیے؟ کیونکہ وہ دھوپ سے اپنا کھانا بناتے ہیں۔ بہت اچھے۔');
    const out = { moments: [M('ask', 'reasoning', '00:08', 'کیونکہ وہ دھوپ سے اپنا کھانا بناتے ہیں۔')], counts: {} };
    await Moments.runForSession('sess-1', '923000000001', { llm: () => Promise.resolve(out) });
    expect(formRow(id).rumi_moments.moments).toEqual([]);
    expect(formRow(id).rumi_moments.verified.dropped.speaker).toBe(1);
  });
});

describe('when nothing survives the check', () => {
  test('the drop is logged as a warning, and the chat does not say "found 0 moments"', async () => {
    const id = await linked();
    await Moments.runForSession('sess-1', '923000000001', { llm: () => Promise.resolve({ moments: [M('ask', 'beyond', '14:00', 'Plants also need water to grow tall and strong.')], counts: {} }) });
    expect(formRow(id).rumi_moments.moments).toEqual([]);
    expect(logToFile).toHaveBeenCalledWith('[observe2] moments checked against the transcript', expect.objectContaining({ returned: 1, kept: 0 }), 'warn');
    const [, sent] = WhatsAppService.sendFlow.mock.calls[0];
    expect(sent.body).not.toMatch(/found 0/);
    expect(sent.body).toMatch(/no clear moment/i);
  });

  test('in Urdu too', async () => {
    await linked(TRANSCRIPT, 'ur');
    await Moments.runForSession('sess-1', '923000000001', { llm: () => Promise.resolve({ moments: [], counts: {} }) });
    const [, sent] = WhatsAppService.sendFlow.mock.calls[0];
    expect(sent.body).not.toMatch(/\b0\b/);
    expect(sent.body).toMatch(/کوئی واضح لمحہ نہیں/);
  });
});
