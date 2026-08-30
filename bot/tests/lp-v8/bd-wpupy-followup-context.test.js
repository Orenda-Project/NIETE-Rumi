/**
 * bd-wpupy — a deictic "this" must reach the lesson she just received.
 *
 * PRODUCTION EVIDENCE (NIETE prod, 2026-08-28, from niete-logs):
 *   grade_4_general_science_ch1_seg1 delivered 11:52:21
 *   11:53:00  lp_context.injected tier:"A"  -> "Give this to me in text form"
 *                                              answered with Grade 5 Fractions (11 Aug, stale)
 *   11:54:07  lp_context.injected tier:"B"  -> "Give me the science one in text form"
 *                                              answered correctly
 * SAME lessonIds in context both times. The only difference is the TIER, so this
 * is purely the Tier-B gate — not retrieval, not the shelf, not the source.
 *
 * Both gates keyed on lesson VOCABULARY:
 *   - REFERRING_BACK_TOKENS all require "lesson"/"sabaq"/"سبق"
 *   - the LLM classifier sees only the message, never that a lesson just landed
 * A teacher referring to something received 35s ago says "this", which matches
 * neither. Measured: 37/37 first-messages-after-delivery carried no token.
 *
 * WHY NOT "always inject when recent" (the naive fix, red-teamed out):
 *   8/37 of those messages are NEW lesson requests ("L/p", "Class2"). The
 *   previous lesson is then a MAXIMUM-similarity distractor at the exact moment
 *   she wants something else — literature puts a single irrelevant passage at up
 *   to 30% accuracy loss. That is the mirror-image bug, and worse, because she
 *   cannot rephrase out of it. Hence: intent-gated.
 */

/* eslint-disable global-require */

// resolveFollowUp is pure, but importing the module boots its collaborators.
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/lp-shelf.service', () => ({ getShelf: jest.fn(async () => []) }));
jest.mock('../../shared/services/lp-voicenote-script.service', () => ({ getVoicenoteScript: jest.fn(async () => null) }));
jest.mock('../../shared/services/coaching/fidelity/lp-fidelity-store', () => ({ resolveMoveList: jest.fn(async () => null) }));
jest.mock('../../shared/services/lp-v8-catalog.service', () => ({ lessonById: jest.fn(() => null) }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));

const {
  messageReferencesLp, resolveFollowUp, __consts,
} = require('../../shared/services/lp-context.service');

const minsAgo = (m) => new Date(Date.now() - m * 60 * 1000).toISOString();

const RECENT = [{ lesson_id: 'grade_4_general_science_ch1_seg1', delivered_at: minsAgo(1) }];
const TWO_DISTINCT = [
  { lesson_id: 'grade_4_urdu_ch7_seg1', delivered_at: minsAgo(2) },
  { lesson_id: 'grade_4_urdu_ch7_seg2', delivered_at: minsAgo(3) },
];
const SAME_TWICE = [
  { lesson_id: 'grade_5_math_ch5_seg8', delivered_at: minsAgo(1) },
  { lesson_id: 'grade_5_math_ch5_seg8', delivered_at: minsAgo(2) },
];
const OLD = [{ lesson_id: 'grade_4_general_science_ch1_seg1', delivered_at: minsAgo(60 * 24 * 5) }];

const general = { type: 'general', lp_reference: false };
const newLp = { type: 'lesson_plan', lp_reference: false };

describe('bd-wpupy — the exact production failure', () => {
  test('"Give this to me in text form" now reaches the lesson (was tier A)', () => {
    const r = resolveFollowUp({ message: 'Give this to me in text form', intent: general, entries: RECENT });
    expect(r.tier).toBe('B');
    expect(r.lessonIds).toEqual(['grade_4_general_science_ch1_seg1']);
  });

  test('"Give me the science one in text form" still works (was already tier B)', () => {
    const r = resolveFollowUp({
      message: 'Give me the science one in text form',
      intent: { type: 'general', lp_reference: true }, entries: RECENT,
    });
    expect(r.tier).toBe('B');
  });

  test('the other teacher\'s "Please give me this in text form" reaches it too', () => {
    expect(resolveFollowUp({ message: 'Please give me this in text form', intent: general, entries: RECENT }).tier)
      .toBe('B');
  });

  test.each([
    'Simplify this',
    'Make this simpler',
    'اسے آسان کر دیں',
    'لکھ کر بھیجیں',
    'اردو میں لکھ کر سینڈ کریں پلیز',
    'can you make it easier',
  ])('deictic/format follow-up reaches the lesson: %s', (msg) => {
    expect(resolveFollowUp({ message: msg, intent: general, entries: RECENT }).tier).toBe('B');
  });
});

describe('bd-wpupy — the fixation trap must NOT open (red team R1)', () => {
  test.each(['L/p', 'L/P', 'Class2', 'Cal parhana ha', 'lesson plan grade 5 maths fractions'])(
    'a NEW lesson request keeps tier A, so the old lesson cannot distract: %s',
    (msg) => {
      const r = resolveFollowUp({ message: msg, intent: newLp, entries: RECENT });
      expect(r.tier).toBe('A');
    },
  );

  test('a video request is not answered from the last lesson plan', () => {
    expect(resolveFollowUp({
      message: 'video dikhao', intent: { type: 'video', lp_reference: false }, entries: RECENT,
    }).tier).toBe('A');
  });

  test('an explicit referring-back phrase still wins even on a lesson_plan intent', () => {
    // "is lesson mein..." is unambiguously about what she has, whatever the
    // classifier decided about the artefact type.
    expect(resolveFollowUp({
      message: 'is lesson mein activity kaisi karun', intent: newLp, entries: RECENT,
    }).tier).toBe('B');
  });
});

describe('bd-wpupy — ambiguity is asked about, never guessed (F2, red team R3)', () => {
  test('two DISTINCT lessons in the window → ask, do not pick', () => {
    const r = resolveFollowUp({ message: 'Give this to me in text form', intent: general, entries: TWO_DISTINCT });
    expect(r.tier).toBe('A');
    expect(r.ask).toBe(true);
    expect(r.lessonIds).toEqual(['grade_4_urdu_ch7_seg1', 'grade_4_urdu_ch7_seg2']);
  });

  test('the SAME lesson delivered twice is not ambiguous — answer it', () => {
    const r = resolveFollowUp({ message: 'Give this to me in text form', intent: general, entries: SAME_TWICE });
    expect(r.tier).toBe('B');
    expect(r.ask).toBeFalsy();
  });

  test('an unambiguous single lesson never triggers the question', () => {
    expect(resolveFollowUp({ message: 'Simplify this', intent: general, entries: RECENT }).ask).toBeFalsy();
  });
});

describe('bd-wpupy — the window (F3, red team R11)', () => {
  test('a five-day-old lesson does not answer a bare "this"', () => {
    expect(resolveFollowUp({ message: 'Give this to me in text form', intent: general, entries: OLD }).tier)
      .toBe('A');
  });

  test('but naming it still works after five days', () => {
    expect(resolveFollowUp({
      message: 'the lesson you sent about science', intent: general, entries: OLD,
    }).tier).toBe('B');
  });

  test('the window is a real constant, not a magic number in a branch', () => {
    expect(__consts.FOLLOWUP_WINDOW_MS).toBeGreaterThan(0);
  });
});

describe('bd-wpupy — no over-firing on ordinary teacher speech (red team R6)', () => {
  test.each([
    ['میڈم، 4 کلاس کے کوئسچن بھیجیں، آسان آسان', 'asking for easy questions FOR STUDENTS'],
    ['آسان آسان پوچھیں، ٹیچر', 'telling the bot to ask students easy questions'],
    ['Class room coaching', 'a different feature entirely'],
    ['Digital couch', 'a typo for a different feature'],
  ])('%s → stays tier A (%s)', (msg) => {
    expect(resolveFollowUp({ message: msg, intent: general, entries: RECENT }).tier).toBe('A');
  });

  test('a long message that happens to contain "this" is not a deictic follow-up', () => {
    const msg = 'I was teaching my class today and this group of children in the back '
      + 'kept talking so I want to know how to manage that behaviour better next time';
    expect(resolveFollowUp({ message: msg, intent: general, entries: RECENT }).tier).toBe('A');
  });
});

describe('bd-wpupy — nothing delivered, nothing to resolve', () => {
  test('no entries → tier A, no ask, no crash', () => {
    const r = resolveFollowUp({ message: 'Give this to me in text form', intent: general, entries: [] });
    expect(r.tier).toBe('A');
    expect(r.ask).toBeFalsy();
  });

  test('the old lexical helper still behaves for callers that use it', () => {
    expect(messageReferencesLp('is lesson mein activity kaisi karun', [])).toBe(true);
    expect(messageReferencesLp('Give this to me in text form', [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Found by the replay harness on real production traffic, not by inspection.
// ---------------------------------------------------------------------------
describe('bd-wpupy — Urdu diacritics must not hide a reference', () => {
  const { normaliseUrdu } = require('../../shared/services/lp-context.service');

  test('a real teacher question with a zabar still matches (was silently missed)', () => {
    // «اس لَیسن پلان» — zabar on the ل. The token list has «اس لیسن».
    const msg = 'کیا اس لَیسن پلان میں بچوں کو ریڈنگ کے ذریعے بھی سکھایا جا سکتا ہے؟';
    expect(messageReferencesLp(msg, [])).toBe(true);
  });

  test('this was broken for the EXISTING token list too, not just the new gate', () => {
    expect(messageReferencesLp('اس لَیسن میں کیا کروں', [])).toBe(true);
    expect(messageReferencesLp('اس لیسن میں کیا کروں', [])).toBe(true);
  });

  test('normalisation strips harakat and leaves the letters alone', () => {
    expect(normaliseUrdu('لَیسن')).toBe('لیسن');
    expect(normaliseUrdu('lesson')).toBe('lesson');
  });
});

// ---------------------------------------------------------------------------
// F4 — the SOURCE fix. The lexical tokens above are a safety net; this is the
// thing that actually resolves "Urdu ma explain krna" and "How to improve",
// which no token list could reach without over-firing on ordinary speech.
// ---------------------------------------------------------------------------
describe('bd-wpupy F4 — the classifier is told what just landed', () => {
  const { deliveryHint } = require('../../shared/services/lp-context.service');
  const recentEntry = [{
    lesson_id: 'grade_4_general_science_ch1_seg1', grade: 4,
    subject: 'general_science', chapter_number: 1, delivered_at: minsAgo(2),
  }];

  test('a recent delivery produces a hint naming what she was sent', () => {
    const h = deliveryHint(recentEntry);
    expect(h).toMatch(/RECENT DELIVERY/);
    expect(h).toMatch(/Grade 4/);
    expect(h).toMatch(/Chapter 1/);
    expect(h).toMatch(/minute\(s\) ago/);
  });

  test('it teaches BOTH sides — the follow-ups and the new-request negatives', () => {
    const h = deliveryHint(recentEntry);
    expect(h).toMatch(/general lp_ref/);
    expect(h).toMatch(/L\/p/);                       // the fixation trap
    expect(h).toMatch(/lesson_plan, never lp_ref/);
    expect(h).toMatch(/FOR HER STUDENTS/);           // the آسان آسان false positive
  });

  test('nothing delivered recently → no hint, so the classifier is unchanged', () => {
    expect(deliveryHint([])).toBe('');
    expect(deliveryHint([{ lesson_id: 'x', delivered_at: minsAgo(60 * 24 * 5) }])).toBe('');
  });

  test('a malformed entry cannot produce a broken hint', () => {
    expect(deliveryHint([{}])).toBe('');
    expect(deliveryHint(null)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// The handler builds the LP context once (for the classifier hint) and hands it
// on, so a message costs ONE build, not two. Caught during review that the
// first attempt referenced the variable across a function boundary — a
// ReferenceError on every general-conversation message.
// ---------------------------------------------------------------------------
describe('bd-wpupy — the context is built once per message', () => {
  test('injectLpContext uses a prebuilt context instead of rebuilding', async () => {
    const { injectLpContext, __setBuildLpContextForTests } = require('../../shared/services/lp-context.service');
    const build = jest.fn(async () => ({
      identityLine: 'ID', fullBlock: 'FULL', lessonIds: ['a'], source: 'shelf',
      referenceTerms: [], entries: [{ lesson_id: 'a', delivered_at: minsAgo(1) }],
    }));
    __setBuildLpContextForTests(build);

    const prebuilt = {
      identityLine: 'PREBUILT', fullBlock: 'FULL', lessonIds: ['a'], source: 'shelf',
      referenceTerms: [], entries: [{ lesson_id: 'a', delivered_at: minsAgo(1) }],
    };
    const out = await injectLpContext({
      userId: 'u1', message: 'hello', intent: { type: 'general' }, prebuiltCtx: prebuilt,
    });
    expect(build).not.toHaveBeenCalled();
    expect(out).toMatch(/PREBUILT/);

    // and without one it still builds, so every other caller is unaffected
    await injectLpContext({ userId: 'u1', message: 'hello', intent: { type: 'general' } });
    expect(build).toHaveBeenCalledTimes(1);
    __setBuildLpContextForTests(null);
  });

  test('a null prebuilt context (nothing delivered) does not trigger a rebuild', async () => {
    const { injectLpContext, __setBuildLpContextForTests } = require('../../shared/services/lp-context.service');
    const build = jest.fn(async () => null);
    __setBuildLpContextForTests(build);
    const out = await injectLpContext({
      userId: 'u1', message: 'hi', intent: { type: 'general' }, prebuiltCtx: null, existingContext: 'KEEP',
    });
    expect(build).not.toHaveBeenCalled();
    expect(out).toBe('KEEP');
    __setBuildLpContextForTests(null);
  });
});

// ---------------------------------------------------------------------------
// Found by the live end-to-end run, not by unit reasoning: a real classifier
// (gpt-4o via OpenRouter) returned `general lp_ref` for "Can you generate video
// related to it" — pointing at the lesson while asking for a different artefact.
// That would put the lesson plan in front of the model when she wants a video.
// Model-dependent, so it is guarded in code where behaviour is deterministic.
// ---------------------------------------------------------------------------
describe('bd-wpupy — asking for a DIFFERENT artefact from the lesson', () => {
  const explicit = { type: 'general', lp_reference: true };
  const RECENT_ONE = [{ lesson_id: 'grade_1_english_ch1_seg1', delivered_at: minsAgo(2) }];

  test.each([
    'Can you generate video related to it',
    'make a presentation from this lesson',
    'is lesson ka quiz bana do',
    'اس سبق کی ویڈیو بنا دیں',
  ])('stays tier A even with lp_ref set: %s', (msg) => {
    const r = resolveFollowUp({ message: msg, intent: explicit, entries: RECENT_ONE });
    expect(r.tier).toBe('A');
    expect(r.why).toBe('other-artefact-from-lesson');
  });

  test('but a plain question about the lesson is unaffected', () => {
    expect(resolveFollowUp({
      message: 'is lesson mein activity kaisi karun', intent: explicit, entries: RECENT_ONE,
    }).tier).toBe('B');
  });
});
