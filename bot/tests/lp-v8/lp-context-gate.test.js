/**
 * FEAT-059 / bd-njn7u Phase 3 — the Tier-B gate and the trap-killer (TDD, red first).
 *
 * Two halves:
 *
 *  1. detectIntent learns the ONE distinction the parent bot had to build a
 *     whole interceptor for: a question ABOUT a lesson she already has is
 *     `general` — even when it names a topic and grade — while `lesson_plan`
 *     stays reserved for wanting a NEW document. The same call also reports
 *     `lp_reference` so Tier-B gating costs zero extra LLM calls.
 *     BOTH directions are locked: referring-back → general, and bare
 *     topic+grade ("Mathematics for grade 2") → lesson_plan STILL — real
 *     teachers rely on that route daily.
 *
 *  2. injectLpContext — the single line each handler calls. Composes the
 *     tiered block onto any existing featureContext (the ContextService block
 *     must survive — never clobber), gates Tier B on classifier output OR the
 *     lexical referring-back fallback, and soft-fails to the caller's
 *     existing context.
 *
 * The classifier's real-world behaviour on the contrast phrasings is walked
 * on staging (Phase 5) — here the LLM is a recorded fixture; what these tests
 * pin is the prompt contract, the parser, the gate logic, and the composition.
 */

/* eslint-disable global-require */

// ─── openai.service with a captured LLM ─────────────────────────────────────

const capturedRequests = [];
let mockLlmReply = 'general';
jest.mock('../../shared/services/llm-client', () => ({
  getClient: () => ({
    chat: {
      completions: {
        create: jest.fn(async (req) => {
          capturedRequests.push(req);
          return { choices: [{ message: { content: mockLlmReply } }] };
        }),
      },
    },
  }),
}));
jest.mock('../../shared/database/bot-helpers', () => ({
  getConversationHistory: jest.fn(async () => []),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

// lp-context.service's real dependency chain (supabase config process.exit(78)s
// without env; redis/r2 likewise want a live world). injectLpContext is driven
// through __setBuildLpContextForTests, and messageReferencesLp is pure — the
// deps below are never exercised, only satisfied.
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/lp-shelf.service', () => ({ getShelf: jest.fn(async () => []) }));
jest.mock('../../shared/services/lp-voicenote-script.service', () => ({ getVoicenoteScript: jest.fn(async () => null) }));
jest.mock('../../shared/services/coaching/fidelity/lp-fidelity-store', () => ({ resolveMoveList: jest.fn(async () => null) }));

const OpenAIService = require('../../shared/services/openai.service');

beforeEach(() => {
  capturedRequests.length = 0;
  mockLlmReply = 'general';
});

describe('detectIntent — the classifier prompt carries the referring-back contrast', () => {
  test('prompt teaches: a question ABOUT a received lesson is general, even with topic+grade', async () => {
    await OpenAIService.detectIntent('is lesson mein activity kaisi karun');
    const sys = capturedRequests[0].messages.find((m) => m.role === 'system').content;
    expect(sys).toMatch(/already has|already received/i);
    expect(sys).toMatch(/walay sabaq|referring/i);
    expect(sys).toMatch(/NEW document/i);
    // The example phrasings ride in the prompt so the model has anchors.
    expect(sys).toContain('is lesson mein activity');
    expect(sys).toContain('grade 2 maths walay sabaq');
  });

  test('prompt still teaches bare topic+grade → lesson_plan (the route teachers rely on)', async () => {
    await OpenAIService.detectIntent('Mathematics for grade 2');
    const sys = capturedRequests[0].messages.find((m) => m.role === 'system').content;
    expect(sys).toContain('"Mathematics for grade 2" → lesson_plan');
  });

  test('prompt asks for the lp_ref marker', async () => {
    await OpenAIService.detectIntent('yeh wali activity mushkil hai');
    const sys = capturedRequests[0].messages.find((m) => m.role === 'system').content;
    expect(sys).toMatch(/lp_ref/);
  });
});

describe('detectIntent — parsing the extended output', () => {
  test('"general lp_ref" → general with lp_reference true', async () => {
    mockLlmReply = 'general lp_ref';
    const intent = await OpenAIService.detectIntent('is sabaq ki activity mushkil hai');
    expect(intent.type).toBe('general');
    expect(intent.lp_reference).toBe(true);
  });

  test('"general" alone → lp_reference false (backward compatible)', async () => {
    mockLlmReply = 'general';
    const intent = await OpenAIService.detectIntent('school kaisa chal raha hai');
    expect(intent.type).toBe('general');
    expect(intent.lp_reference).toBe(false);
  });

  test('"lesson_plan" still routes to lesson_plan', async () => {
    mockLlmReply = 'lesson_plan';
    const intent = await OpenAIService.detectIntent('Mathematics for grade 2');
    expect(intent.type).toBe('lesson_plan');
    expect(intent.lp_reference).toBe(false);
  });

  test('"video" unaffected', async () => {
    mockLlmReply = 'video';
    const intent = await OpenAIService.detectIntent('video dikhao fractions par');
    expect(intent.type).toBe('video');
  });

  test('LLM failure → keyword fallback still answers, lp_reference false', async () => {
    mockLlmReply = null; // choices[0].message.content = null → parse throws → fallback
    const intent = await OpenAIService.detectIntent('lesson plan chahiye');
    expect(intent.type).toBe('lesson_plan');
    expect(intent.lp_reference).toBe(false);
  });
});

// ─── the lexical fallback + composition ─────────────────────────────────────

const { messageReferencesLp, injectLpContext, __setBuildLpContextForTests } = require('../../shared/services/lp-context.service');

const CTX = {
  identityLine: 'Recently delivered to this teacher: Grade 1 Urdu — Ch 7 “چھٹی کا دن” (3h ago).',
  fullBlock: '## Recently delivered lesson plans\n<lesson_reference>سبق</lesson_reference>',
  lessonIds: ['grade_1_urdu_ch7_seg1'],
  source: 'shelf',
  referenceTerms: ['چھٹی', 'کہانی', 'holiday'],
};

describe('messageReferencesLp — lexical referring-back fallback', () => {
  test.each([
    'اس سبق میں مشکل ہے',
    'is lesson ki activity kaisi karun',
    'grade 2 maths walay sabaq mein time kam parta hai',
    'yeh wala lesson phir samjha dein',
    'jo aap ne bheja us mein sawal hai',
  ])('referring-back: %s → true', (msg) => {
    expect(messageReferencesLp(msg, CTX.referenceTerms)).toBe(true);
  });

  test('a shelf word (chapter/topic) in the message counts as a reference', () => {
    expect(messageReferencesLp('چھٹی والی کہانی بچوں کو پسند آئی', CTX.referenceTerms)).toBe(true);
  });

  test.each([
    'school mein sports day hai',
    'mera beta bimar hai',
    'attendance kaise mark karun',
  ])('unrelated: %s → false', (msg) => {
    expect(messageReferencesLp(msg, CTX.referenceTerms)).toBe(false);
  });
});

describe('injectLpContext — tiers, composition, soft-fail', () => {
  afterEach(() => __setBuildLpContextForTests(null));

  test('nothing recent → the existing featureContext passes through untouched', async () => {
    __setBuildLpContextForTests(async () => null);
    expect(await injectLpContext({ userId: 'u1', message: 'salam', intent: { type: 'general' }, existingContext: null })).toBeNull();
    expect(await injectLpContext({ userId: 'u1', message: 'salam', intent: { type: 'general' }, existingContext: 'VIDEO CTX' })).toBe('VIDEO CTX');
  });

  test('no reference signals → Tier A only (identity line, no full block)', async () => {
    __setBuildLpContextForTests(async () => CTX);
    const out = await injectLpContext({ userId: 'u1', message: 'school mein sports day hai', intent: { type: 'general', lp_reference: false }, existingContext: null });
    expect(out).toContain(CTX.identityLine);
    expect(out).not.toContain('<lesson_reference>');
  });

  test('classifier says lp_reference → Tier B (full block rides along)', async () => {
    __setBuildLpContextForTests(async () => CTX);
    const out = await injectLpContext({ userId: 'u1', message: 'is ki activity mushkil hai', intent: { type: 'general', lp_reference: true }, existingContext: null });
    expect(out).toContain(CTX.identityLine);
    expect(out).toContain('<lesson_reference>');
  });

  test('classifier miss + lexical hit → Tier B anyway (the OR-fallback)', async () => {
    __setBuildLpContextForTests(async () => CTX);
    const out = await injectLpContext({ userId: 'u1', message: 'اس سبق میں وقت کم پڑتا ہے', intent: { type: 'general', lp_reference: false }, existingContext: null });
    expect(out).toContain('<lesson_reference>');
  });

  test('an existing featureContext is composed in front, never clobbered', async () => {
    __setBuildLpContextForTests(async () => CTX);
    const out = await injectLpContext({ userId: 'u1', message: 'اس سبق کا سوال', intent: { type: 'general', lp_reference: true }, existingContext: 'EXISTING VIDEO CONTEXT' });
    expect(out.startsWith('EXISTING VIDEO CONTEXT')).toBe(true);
    expect(out).toContain(CTX.identityLine);
  });

  test('builder throwing → existing context returned, never a throw', async () => {
    __setBuildLpContextForTests(async () => { throw new Error('boom'); });
    const out = await injectLpContext({ userId: 'u1', message: 'salam', intent: { type: 'general' }, existingContext: 'KEEP ME' });
    expect(out).toBe('KEEP ME');
  });
});
