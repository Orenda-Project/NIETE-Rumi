/**
 * bd-zrdvmi.77.3 — ICT feedback sheet, Lesson Plan rows 936, 937, 942, 951 (Aug 2026 reports).
 *
 * Right after a lesson plan, teachers asked for it again in another shape — "in text form",
 * "improve the lp", "a simple version of the LP …", "change in the given LP" (a voice note) —
 * and got an answer from older chat (an application template, a generic plan). Their words name
 * the plan as "the LP", which no referring-back phrase covered, and the classifier was never
 * told a plan had just landed. These pin the reporters' own words.
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/lp-shelf.service', () => ({ getShelf: jest.fn(async () => []) }));
jest.mock('../../shared/services/lp-voicenote-script.service', () => ({ getVoicenoteScript: jest.fn(async () => null) }));
jest.mock('../../shared/services/coaching/fidelity/lp-fidelity-store', () => ({ resolveMoveList: jest.fn(async () => null) }));
jest.mock('../../shared/services/lp-v8-catalog.service', () => ({ lessonById: jest.fn(() => null) }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const {
  messageReferencesLp, resolveFollowUp, deliveryHint, injectLpContext, __setBuildLpContextForTests,
} = require('../../shared/services/lp-context.service');

const minsAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
const ONE = [{ lesson_id: 'grade_5_general_science_ch6_seg2', grade: 5, subject: 'general_science', chapter_number: 6, delivered_at: minsAgo(1) }];

const REPORTED = {
  936: 'Please make a change in the given LP, the activity needs fewer materials',
  937: 'Can you improve the lp',
  942: 'provide a simple verison of the LP including an engaging hook, new material simple introduction, short IP and GP related to my resourse limited class of 65',
  951: 'Give me this lesson plan in text form',
};

describe('ICT sheet rows 936/937/942/951 — the reporters\' words point at the plan just sent', () => {
  test.each(Object.entries(REPORTED))('row %s is recognised as about the delivered plan', (_row, msg) => {
    expect(messageReferencesLp(msg)).toBe(true);
  });

  test.each(Object.entries(REPORTED))('row %s gets the full plan (tier B) with the switch logic', (_row, msg) => {
    const r = resolveFollowUp({ message: msg, intent: { type: 'general', lp_reference: false }, entries: ONE });
    expect(r.tier).toBe('B');
    expect(r.lessonIds).toEqual(['grade_5_general_science_ch6_seg2']);
  });

  test('a short "give me in text form" with no plan word still reaches the plan (row 951 second ask)', () => {
    expect(resolveFollowUp({ message: 'give me in text form', intent: { type: 'general' }, entries: ONE }).tier).toBe('B');
  });

  test.each(['New lp', 'L/p', 'lp', 'lesson plan grade 5 maths', 'Class2'])(
    'a NEW request is not mistaken for the old plan: %s',
    (msg) => expect(messageReferencesLp(msg)).toBe(false),
  );

  test('the classifier is told a plan just landed', () => {
    expect(deliveryHint(ONE)).toMatch(/RECENT DELIVERY: a lesson plan PDF was sent to this teacher 1 minute\(s\) ago \(Grade 5/);
    expect(deliveryHint([{ ...ONE[0], delivered_at: minsAgo(60 * 24) }])).toBe('');
  });
});

describe('the switch decides the gate (one-step undo)', () => {
  const ctx = {
    identityLine: 'ID', fullBlock: 'FULL_PLAN', lessonIds: ['a'], source: 'shelf',
    referenceTerms: [], entries: [{ lesson_id: 'a', delivered_at: minsAgo(1) }],
  };
  afterEach(() => { delete process.env.LP_CONTEXT_V2_ENABLED; __setBuildLpContextForTests(null); });

  test('switch on: "give me in text form" carries the full plan', async () => {
    process.env.LP_CONTEXT_V2_ENABLED = 'true';
    const out = await injectLpContext({ userId: 'u1', message: 'give me in text form', intent: { type: 'general' }, prebuiltCtx: ctx });
    expect(out).toMatch(/FULL_PLAN/);
  });

  test('switch off: the old word-list gate decides, as on the live bot today', async () => {
    const out = await injectLpContext({ userId: 'u1', message: 'give me in text form', intent: { type: 'general' }, prebuiltCtx: ctx });
    expect(out).toBe('ID');
  });
});
