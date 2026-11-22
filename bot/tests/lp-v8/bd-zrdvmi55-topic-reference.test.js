/**
 * bd-zrdvmi.55 — ICT feedback sheet, Lesson Plan row 918 (Grade 2 Urdu ch1 day 2).
 *
 * The teacher asked by voice note for "a worksheet linked to the topic" right after her
 * lesson plan, and got a worksheet on countable/uncountable nouns instead. The lexical
 * referring-back list only knew "lesson"/"sabaq" phrasings, so "this topic" / "اس ٹاپک" /
 * "اسی موضوع" never counted as pointing at the lesson she had just been given: the reply
 * went out at Tier A (identity line only) and the model wrote from chat history.
 *
 * Pinned here: topic phrasings count as a reference, a worksheet ask about the delivered
 * lesson reaches Tier B, and unrelated messages that merely contain the word "topic"
 * without a pointer stay out.
 */

/* eslint-disable global-require */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/lp-shelf.service', () => ({ getShelf: jest.fn(async () => []) }));
jest.mock('../../shared/services/lp-voicenote-script.service', () => ({ getVoicenoteScript: jest.fn(async () => null) }));
jest.mock('../../shared/services/coaching/fidelity/lp-fidelity-store', () => ({ resolveMoveList: jest.fn(async () => null) }));
jest.mock('../../shared/services/lp-v8-catalog.service', () => ({ lessonById: jest.fn(() => null) }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const {
  messageReferencesLp, resolveFollowUp, injectLpContext, __setBuildLpContextForTests,
} = require('../../shared/services/lp-context.service');

const minsAgo = (m) => new Date(Date.now() - m * 60 * 1000).toISOString();
const RECENT = [{ lesson_id: 'grade_2_urdu_ch1_seg2', delivered_at: minsAgo(4) }];
const general = { type: 'general', lp_reference: false };
const CTX = {
  identityLine: 'Recently delivered to this teacher: Grade 2 Urdu — Ch 1 (4 min ago).',
  fullBlock: '## Recently delivered lesson plans\n<lesson_reference>سبق</lesson_reference>',
  lessonIds: ['grade_2_urdu_ch1_seg2'],
  source: 'shelf',
  referenceTerms: [],
};
// The positional resolver (bd-wpupy) exists on sandbox only so far; staging and main decide Tier B with the
// lexical list alone. The injectLpContext test below runs on every branch; this one where the resolver exists.
const testIfResolver = typeof resolveFollowUp === 'function' ? test : test.skip;

describe('row 918 — "worksheet on this topic" points at the delivered lesson', () => {
  test.each([
    'اس ٹاپک سے متعلق ورک شیٹ بنا دیں',
    'اسی ٹاپک پر بچوں کے لیے ورک شیٹ بنائیں',
    'یہ ٹاپک بچوں کو سمجھ نہیں آیا، ورک شیٹ بنا دیں',
    'اس موضوع سے متعلق ایک ورک شیٹ بنا دیں',
    'اسی موضوع کی مشق کے لیے سوالات دیں',
    'is topic se related worksheet bana dein',
    'isi topic par worksheet chahiye',
    'Create a worksheet linked to this topic',
    'make a worksheet on the same topic for my class',
  ])('%s → refers to the lesson', (msg) => {
    expect(messageReferencesLp(msg, [])).toBe(true);
  });

  test('the voice-note ask puts the lesson she just got in front of the model (Tier B)', async () => {
    __setBuildLpContextForTests(async () => CTX);
    try {
      const out = await injectLpContext({ userId: 'u1', message: 'اس ٹاپک سے متعلق ورک شیٹ بنا دیں', intent: general, existingContext: null });
      expect(out).toContain(CTX.fullBlock);
    } finally { __setBuildLpContextForTests(null); }
  });

  testIfResolver('the voice-note ask resolves to Tier B on the lesson she just got', () => {
    const r = resolveFollowUp({ message: 'اس ٹاپک سے متعلق ورک شیٹ بنا دیں', intent: general, entries: RECENT });
    expect(r).toMatchObject({ tier: 'B', ask: false, lessonIds: ['grade_2_urdu_ch1_seg2'] });
  });

  test.each([
    'topic kya hona chahiye debate ka',
    'what topic should I choose for the assembly speech',
    'مجھے تقریر کے لیے کوئی موضوع بتائیں',
  ])('no pointer, no reference: %s', (msg) => {
    expect(messageReferencesLp(msg, [])).toBe(false);
  });
});
