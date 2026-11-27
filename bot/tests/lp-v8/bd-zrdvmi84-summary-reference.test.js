/**
 * bd-zrdvmi.84.1 — ICT feedback sheet, Lesson Plan row 941 (Grade 3 Maths ch2 day 2).
 *
 * Right after her lesson plan the teacher asked for "a bit of a detailed summary" and got a
 * summary of an English lesson on nouns. No word in the referring-back list covered a summary
 * ask, so the reply went out at Tier A (identity line only) and the model wrote from older chat.
 *
 * Pinned here: summary asks (English, Roman Urdu, Urdu) count as pointing at the lesson she was
 * just sent, and that lesson reaches the model (Tier B). Messages with no summary word stay out.
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
const RECENT = [{ lesson_id: 'grade_3_math_ch2_seg2', delivered_at: minsAgo(3) }];
const general = { type: 'general', lp_reference: false };
const CTX = {
  identityLine: 'Recently delivered to this teacher: Grade 3 Math — Ch 2 (3 min ago).',
  fullBlock: '## Recently delivered lesson plans\n<lesson_reference>Place value</lesson_reference>',
  lessonIds: ['grade_3_math_ch2_seg2'],
  source: 'shelf',
  referenceTerms: [],
};
// The positional resolver (bd-wpupy) exists on sandbox only; elsewhere the lexical list decides.
const testIfResolver = typeof resolveFollowUp === 'function' ? test : test.skip;

describe('row 941 — "give a detailed summary" points at the lesson just sent', () => {
  test.each([
    'Give a bit of a detailed summary',
    'please give me the summary',
    'summarise it for me',
    'can you summarize the lesson plan',
    'thora detailed summary de dein',
    'is ka khulasa bata dein',
    'تھوڑا تفصیلی خلاصہ دے دیں',
    'سمری دے دیں',
  ])('%s → refers to the lesson', (msg) => {
    expect(messageReferencesLp(msg, [])).toBe(true);
  });

  test('the summary ask puts the lesson she just got in front of the model (Tier B)', async () => {
    __setBuildLpContextForTests(async () => CTX);
    try {
      const out = await injectLpContext({ userId: 'u1', message: 'Give a bit of a detailed summary', intent: general, existingContext: null });
      expect(out).toContain(CTX.fullBlock);
    } finally { __setBuildLpContextForTests(null); }
  });

  testIfResolver('the summary ask resolves to Tier B on the lesson she just got', () => {
    const r = resolveFollowUp({ message: 'Give a bit of a detailed summary', intent: general, entries: RECENT });
    expect(r).toMatchObject({ tier: 'B', ask: false, lessonIds: ['grade_3_math_ch2_seg2'] });
  });

  test.each([
    'what should I teach tomorrow',
    'bachon ko kaise samjhaun',
    'آج کی حاضری کیسے لگاؤں',
  ])('no summary word, no reference: %s', (msg) => {
    expect(messageReferencesLp(msg, [])).toBe(false);
  });
});
