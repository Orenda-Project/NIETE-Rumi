/**
 * bd-ga7xz — TARGETED REVISION, behind LP612_TARGETED_REVISION (default false).
 *
 * BREAKDOWN.md §4 lever 2: every revision round re-emits the ENTIRE ~7,900-token lp_doc
 * (R² 0.911 against output tokens alone) — a round that exists to fix one page rewrites the
 * whole lesson. Behind the flag, a revision round instead asks for a pointer -> whole-subtree
 * REPLACEMENT MAP, not RFC-6902 ops — `sanitizeOverlay`'s own comment block records that this
 * model mis-points fine-grained JSON Pointers at a measured rate (8 of 55 `ur_overlay` pointers
 * on one real document addressed blocks it had not written, bd-vnyuw), so the address space is
 * deliberately coarse: one pointer per top-level section, one per `page2` key, one per other
 * top-level key — all derived from the document itself, never a hardcoded schema guess.
 *
 * Safety argument under test: a bad patch fails the SAME gate a bad rewrite does (`runGates` on
 * the merged document, `notWorseVisual` deciding acceptance) — nothing here weakens a gate for a
 * patched candidate, and a patch that cannot be merged costs at most one extra call in the SAME
 * round, never the lesson.
 *
 * Two layers of coverage, per root CLAUDE.md Rule 6 (mock the network boundary, never the
 * module under test, never skip the call chain):
 *
 *   (A) unit tests on the pure merge primitives (`deriveAllowedPointers`, `applyReplacements`,
 *       `parseTargetedReply`) — these have no network boundary, so a direct unit test IS the
 *       real code path;
 *   (B) the six scenarios the brief asks for, driven through the real `authorLessonPlan()`
 *       ladder with the LLM doubled at `llm-client`, exactly as the existing lp612 suites do.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const mockLogEvent = jest.fn();
const mockLogToFile = jest.fn();

jest.mock('../../bot/shared/services/llm-client', () => {
  const create = jest.fn();
  return { getClient: () => ({ chat: { completions: { create } } }),
    // bd-oak77.29: the author service resolves its client PER MODEL now, so the mock has to
    // state that half of llm-client's contract too. Same `create` spy either way — these
    // suites assert on the payload, not on which provider it went to.
    getClientForModel: (m) => ({ client: { chat: { completions: { create } } }, model: String(m || '') }),
    __create: create };
});
jest.mock('../../bot/shared/utils/logger', () => ({
  logToFile: (...a) => mockLogToFile(...a), logError: jest.fn(), logWarn: jest.fn(),
}));
jest.mock('../../bot/shared/utils/structured-logger', () => ({
  logEvent: (...a) => mockLogEvent(...a),
  getCurrentCorrelationId: () => undefined,
}));

const create = require('../../bot/shared/services/llm-client').__create;
const {
  authorLessonPlan, buildRevisionPrompt,
  deriveAllowedPointers, applyReplacements, parseTargetedReply,
} = require('../../bot/shared/services/lp612-author.service');
const CLEAN_DOC = require('./__fixtures__/v9_gate_base.lp.json');

const named = (name) => mockLogEvent.mock.calls.filter((c) => c[0] === name);
const proseLines = (msg) => mockLogToFile.mock.calls.filter((c) => c[0] === msg);
const clone = (d) => JSON.parse(JSON.stringify(d));
// The SEGMENT fixture below carries yt:null, so `applyVideo` strips the fixture's baked-in
// development-section video from EVERY accepted document, targeted or not — orthogonal to
// what these tests check. Compare against a sections array with that same stripping applied.
const sectionsWithoutVideo = (doc) => clone(doc.sections).map((s) => {
  if (s.id === 'development') delete s.video;
  return s;
});

const BOOK = { title: 'Biology 9', publisher: 'PCTB', subject: 'biology', grade: 9, medium: 'en', language: 'English', offset: 4 };
const TOC = { chapters: [{ number: 1, title: 'The Biological Method', printed_start: 9 }] };
const SEGMENT = {
  segment_id: 'seg-1', book_stem: 'grade_9_biology', grade: 9, subject: 'biology',
  medium: 'en', language: 'English', chapter_number: 1, chapter_title: 'The Biological Method',
  chapter_key: 'g9-bio-ch1', subtopic_title: 'Observation and hypothesis',
  menu_title: 'Observation & hypothesis', printed_page_start: 11, printed_page_end: 12,
  pages_covered: [11, 12], order_index: 3, lp_type: 'SCI-9-10', yt: null, notes: null,
};

const reply = (obj) => ({
  choices: [{ message: { content: JSON.stringify(obj) } }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
});

const CLIPPED_A = 'OVERFLOW on s2: content is 40px taller than the page. Offending: exam_bank (+40px)';
const CLIPPED_B = 'OVERFLOW on s3: content is 12px taller than the page. Offending: mistakes (+12px)';

// page2.exam_bank is an OBJECT ({mcq, srq, erq_skeleton, how_marked} — see brief_author_v3.md
// §5), not a bare array — the replacement must match that KIND or applyReplacements correctly
// rejects it as a type mismatch (that rejection is covered separately, in scenario 6).
//
// Built by CLONING the fixture's own already-lint-clean exam_bank and touching one string
// field, rather than inventing new MCQ/distractor content: the real (unmocked) schema+lint
// gate runs on every merged candidate in these tests, and grade-9 exam_bank content carries
// real, easy-to-violate-by-accident rules (>=2 distractor-coded MCQs, distractor codes that
// must not collide with painted text elsewhere on the page). A synthetic exam_bank tripped
// both on the first pass — proof the safety argument (a bad patch fails the same gate a bad
// rewrite does) actually holds, but not what these tests are checking.
const NEW_EXAM_BANK = JSON.parse(JSON.stringify(CLEAN_DOC.page2.exam_bank));
NEW_EXAM_BANK.how_marked += ' — TARGETED REVISION MARKER';

let dir;
beforeEach(() => {
  jest.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-targeted-'));
  const d = path.join(dir, SEGMENT.book_stem);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, '_book.json'), JSON.stringify(BOOK));
  fs.writeFileSync(path.join(d, '_toc.json'), JSON.stringify(TOC));
  for (const n of [11, 12]) {
    fs.writeFileSync(path.join(d, `pg_${String(n).padStart(3, '0')}.json`), JSON.stringify({
      printed_page_number: n, pdf_page_index: n + 4, page_type: 'content',
      blocks: [{ t: 'heading', text: `1.${n} Observation` }],
    }));
  }
  process.env.LP612_PAGE_TRUTH_DIR = dir;
  delete process.env.LP612_TARGETED_REVISION;
});
afterEach(() => {
  delete process.env.LP612_PAGE_TRUTH_DIR;
  delete process.env.LP612_TARGETED_REVISION;
});

const run = (opts, renderCheck, rounds = 3) => authorLessonPlan({
  segment: SEGMENT, lang: 'en', model: 'test/model', rounds, renderCheck, correlationId: 'c',
  ...opts,
});

// ── (A) the pure merge primitives ────────────────────────────────────────────

describe('deriveAllowedPointers', () => {
  test('one pointer per section, one per page2 key, one per other top-level key — from the doc, not a hardcoded schema', () => {
    const allowed = deriveAllowedPointers(CLEAN_DOC);
    CLEAN_DOC.sections.forEach((_, i) => expect(allowed).toContain(`/sections/${i}`));
    Object.keys(CLEAN_DOC.page2).forEach((k) => expect(allowed).toContain(`/page2/${k}`));
    expect(allowed).toContain('/objectives');
    expect(allowed).not.toContain('/sections');
    expect(allowed).not.toContain('/page2');
  });

  test('a document with fewer sections offers fewer pointers — it is derived, not fixed', () => {
    const smaller = clone(CLEAN_DOC);
    smaller.sections = smaller.sections.slice(0, 2);
    const allowed = deriveAllowedPointers(smaller);
    expect(allowed).toContain('/sections/0');
    expect(allowed).toContain('/sections/1');
    expect(allowed).not.toContain('/sections/2');
  });
});

describe('applyReplacements', () => {
  test('merges a valid replacement onto a DEEP CLONE, leaving the original untouched', () => {
    const original = clone(CLEAN_DOC);
    const originalSnapshot = clone(original);
    const result = applyReplacements(original, { '/page2/exam_bank': NEW_EXAM_BANK });

    expect(result.ok).toBe(true);
    expect(result.doc.page2.exam_bank).toEqual(NEW_EXAM_BANK);
    // everything else is untouched
    const { exam_bank, ...restResult } = result.doc.page2;
    const { exam_bank: _origExam, ...restOriginal } = originalSnapshot.page2;
    expect(restResult).toEqual(restOriginal);
    expect(result.doc.sections).toEqual(originalSnapshot.sections);
    // the ORIGINAL object was never mutated
    expect(original).toEqual(originalSnapshot);
  });

  test('rejects the WHOLE patch when one pointer is not in the allowed list (does not resolve)', () => {
    const original = clone(CLEAN_DOC);
    const result = applyReplacements(original, {
      '/page2/exam_bank': NEW_EXAM_BANK,
      '/page2/does_not_exist_field': { anything: true },
    });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    // all-or-nothing: even the VALID pointer was not applied
    expect(result.doc).toBe(original);
    expect(original.page2.exam_bank).not.toEqual(NEW_EXAM_BANK);
  });

  test('rejects a pointer whose replacement changes the JSON kind (array -> string)', () => {
    const original = clone(CLEAN_DOC);
    const result = applyReplacements(original, { '/page2/exam_bank': 'now a string, not an array' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /type mismatch/.test(e))).toBe(true);
  });

  test('rejects a malformed pointer (no leading slash)', () => {
    const result = applyReplacements(clone(CLEAN_DOC), { 'page2/exam_bank': NEW_EXAM_BANK });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /malformed pointer/.test(e))).toBe(true);
  });

  test('rejects a non-object replace payload', () => {
    const result = applyReplacements(clone(CLEAN_DOC), null);
    expect(result.ok).toBe(false);
  });
});

describe('parseTargetedReply', () => {
  test('recognises {"replace": {...}}', () => {
    expect(parseTargetedReply({ replace: { '/page2/exam_bank': [] } })).toMatchObject({ mode: 'replace' });
  });
  test('recognises {"full": {...}} (the escape hatch)', () => {
    expect(parseTargetedReply({ full: { lesson_id: 'x' } })).toMatchObject({ mode: 'full', doc: { lesson_id: 'x' } });
  });
  test('anything else — prose, a bare lp_doc, neither key — is invalid, never assumed to BE the doc', () => {
    expect(parseTargetedReply({ lesson_id: 'x' })).toMatchObject({ mode: 'invalid' });
    expect(parseTargetedReply('a string')).toMatchObject({ mode: 'invalid' });
    expect(parseTargetedReply(null)).toMatchObject({ mode: 'invalid' });
  });
});

// ── (B) buildRevisionPrompt's targeted/untargeted shapes ─────────────────────

describe('buildRevisionPrompt({ targeted })', () => {
  const args = () => ({
    doc: clone(CLEAN_DOC),
    gates: { schema: [], lint: [], render: [CLIPPED_A], warns: [] },
    originalUser: 'THE ORIGINAL TASK', notes: null, lang: 'en',
  });

  test('flag/param OFF (default): byte-identical to the untargeted prompt — no `targeted` key at all', () => {
    const a = buildRevisionPrompt(args());
    const b = buildRevisionPrompt({ ...args(), targeted: false });
    expect(a).toBe(b);
    expect(a).toContain('Return the COMPLETE corrected lp_doc JSON — the whole document, not a patch, not a diff.');
    expect(a).not.toContain('ALLOWED POINTERS');
    expect(a).not.toContain('REPLACEMENT MAP');
  });

  test('targeted:true asks for a replacement map, names the allowed pointers, and gives the escape hatch', () => {
    const p = buildRevisionPrompt({ ...args(), targeted: true });
    expect(p).toContain('REPLACEMENT MAP');
    expect(p).toContain('ALLOWED POINTERS');
    expect(p).toContain('/page2/exam_bank');
    expect(p).toContain('"full"');
    expect(p).not.toContain('Return the COMPLETE corrected lp_doc JSON — the whole document, not a patch, not a diff.');
  });
});

// ── (B) the six ladder-level scenarios ───────────────────────────────────────

describe('1. flag OFF — the ladder asks for a full document, exactly as before bd-ga7xz', () => {
  test('the revision prompt sent to the model has no targeted-revision language', async () => {
    const renderCheck = jest.fn()
      .mockResolvedValueOnce([CLIPPED_A])
      .mockResolvedValueOnce([]);
    create.mockResolvedValue(reply(CLEAN_DOC));

    await run({}, renderCheck, 3); // no targetedRevision option, no env var — flag OFF by default

    const revisionCall = create.mock.calls[1][0];
    const userMsg = revisionCall.messages[1].content;
    expect(userMsg).toContain('Return the COMPLETE corrected lp_doc JSON — the whole document, not a patch, not a diff.');
    expect(userMsg).not.toContain('ALLOWED POINTERS');
  });
});

describe('2. flag ON + {"replace": {...}} — merges onto the held doc, and runGates sees the MERGED doc', () => {
  test('the merged candidate keeps the rest of the document and reaches the gate', async () => {
    const renderCheck = jest.fn()
      .mockResolvedValueOnce([CLIPPED_A])   // round 0 gate: enter the ladder
      .mockResolvedValueOnce([]);           // round 1 gate on the MERGED candidate: clean
    create
      .mockResolvedValueOnce(reply(CLEAN_DOC))                                  // round 0 (author)
      .mockResolvedValueOnce(reply({ replace: { '/page2/exam_bank': NEW_EXAM_BANK } })); // round 1

    const out = await run({ targetedRevision: true }, renderCheck, 3);

    expect(create).toHaveBeenCalledTimes(2); // no fallback call needed
    // runGates(candidate, renderCheck, ...) calls renderCheck(candidate) — the SECOND call's
    // argument IS the document the gate actually ran on.
    const gatedDoc = renderCheck.mock.calls[1][0];
    expect(gatedDoc.page2.exam_bank).toEqual(NEW_EXAM_BANK);
    const { exam_bank, ...restPage2 } = gatedDoc.page2;
    const { exam_bank: _o, ...restOriginalPage2 } = CLEAN_DOC.page2;
    expect(restPage2).toEqual(restOriginalPage2);
    expect(gatedDoc.sections).toEqual(sectionsWithoutVideo(CLEAN_DOC));

    expect(out.rounds).toBe(1);
    // Not asserting out.lintClean here: appending the marker text nudges the whole-document
    // word count and can trip the ADVISORY `BUDGET` line (bd-wbvtb) — real, reported, and
    // correctly non-blocking (it never reached blockingCost, which is what accepted this
    // round), but orthogonal to what this scenario checks.
    expect(out.lpDoc.page2.exam_bank).toEqual(NEW_EXAM_BANK);
  });
});

describe('3. flag ON + an unresolvable pointer — rejected, then ONE fallback full-rewrite call in the SAME round', () => {
  test('patch_rejected fires and the fallback candidate is what reaches the gate', async () => {
    const FALLBACK_DOC = clone(CLEAN_DOC);
    FALLBACK_DOC.lesson_id = 'FALLBACK_APPLIED';

    const renderCheck = jest.fn()
      .mockResolvedValueOnce([CLIPPED_A])   // round 0
      .mockResolvedValueOnce([]);           // round 1 gate on the FALLBACK candidate
    create
      .mockResolvedValueOnce(reply(CLEAN_DOC))                                             // round 0
      .mockResolvedValueOnce(reply({ replace: { '/page2/not_a_real_field': ['x'] } }))      // round 1 targeted attempt
      .mockResolvedValueOnce(reply(FALLBACK_DOC));                                          // round 1 fallback

    const out = await run({ targetedRevision: true }, renderCheck, 3);

    expect(create).toHaveBeenCalledTimes(3); // author + targeted attempt + fallback, same round

    const rejected = named('lp612.author.patch_rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0][1]).toMatchObject({ segmentId: 'seg-1', round: 1 });

    // the fallback call asked for a full rewrite, not another replacement map
    const fallbackCallArgs = create.mock.calls[2][0];
    expect(fallbackCallArgs.messages[1].content)
      .toContain('Return the COMPLETE corrected lp_doc JSON — the whole document, not a patch, not a diff.');

    // the gate ran on the FALLBACK document, not the rejected patch
    const gatedDoc = renderCheck.mock.calls[1][0];
    expect(gatedDoc.lesson_id).toBe('FALLBACK_APPLIED');

    expect(out.rounds).toBe(1);
    expect(out.lpDoc.lesson_id).toBe('FALLBACK_APPLIED');
  });

  test('a reply that parses to neither replace nor full is treated the same way — rejected, then falls back', async () => {
    const renderCheck = jest.fn()
      .mockResolvedValueOnce([CLIPPED_A])
      .mockResolvedValueOnce([]);
    create
      .mockResolvedValueOnce(reply(CLEAN_DOC))
      .mockResolvedValueOnce(reply({ some_other_shape: true })) // neither replace nor full
      .mockResolvedValueOnce(reply(CLEAN_DOC));                  // fallback

    await run({ targetedRevision: true }, renderCheck, 3);

    expect(create).toHaveBeenCalledTimes(3);
    const rejected = named('lp612.author.patch_rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0][1].reason).toBe('unparseable_shape');
  });
});

describe('4. flag ON + {"full": {...}} — behaves exactly as today (the escape hatch)', () => {
  test('the full document is used directly, no fallback call is made', async () => {
    const FULL_DOC = clone(CLEAN_DOC);
    FULL_DOC.lesson_id = 'FULL_REWRITE_APPLIED';

    const renderCheck = jest.fn()
      .mockResolvedValueOnce([CLIPPED_A])
      .mockResolvedValueOnce([]);
    create
      .mockResolvedValueOnce(reply(CLEAN_DOC))
      .mockResolvedValueOnce(reply({ full: FULL_DOC }));

    const out = await run({ targetedRevision: true }, renderCheck, 3);

    expect(create).toHaveBeenCalledTimes(2); // no fallback needed
    expect(named('lp612.author.patch_rejected')).toHaveLength(0);
    expect(out.lpDoc.lesson_id).toBe('FULL_REWRITE_APPLIED');
  });
});

describe('5. notWorseVisual still rejects a patched candidate that is worse — the held doc survives', () => {
  test('a merged-but-worse candidate is discarded; the previous document is returned untouched', async () => {
    const renderCheck = jest.fn()
      .mockResolvedValueOnce([CLIPPED_A])            // round 0: 1 blocking defect
      .mockResolvedValueOnce([CLIPPED_A, CLIPPED_B]); // round 1 candidate: WORSE (2 blocking)
    create
      .mockResolvedValueOnce(reply(CLEAN_DOC))
      .mockResolvedValueOnce(reply({ replace: { '/page2/exam_bank': NEW_EXAM_BANK } }));

    // rounds:1 so the ladder ends right after the rejection — the returned document must be
    // the ORIGINAL, not the merged-but-worse candidate. (Not a raw deep-equal against the
    // fixture: applyVideo() strips the fixture's baked-in video on every accepted document
    // whenever the segment carries no `yt` — true for the untargeted path too, and orthogonal
    // to what this test is checking.)
    const out = await run({ targetedRevision: true }, renderCheck, 1);

    expect(out.lpDoc.page2.exam_bank).not.toEqual(NEW_EXAM_BANK);
    expect(out.lpDoc.page2.exam_bank).toEqual(CLEAN_DOC.page2.exam_bank);
    expect(out.lpDoc.lesson_id).toBe(CLEAN_DOC.lesson_id);
    expect(out.lpDoc.sections).toEqual(sectionsWithoutVideo(CLEAN_DOC));
  });
});

describe('6. a type-changing replacement (array -> string) is rejected, then falls back', () => {
  test('patch_rejected names the type mismatch and the round still lands a usable candidate', async () => {
    const renderCheck = jest.fn()
      .mockResolvedValueOnce([CLIPPED_A])
      .mockResolvedValueOnce([]);
    create
      .mockResolvedValueOnce(reply(CLEAN_DOC))
      .mockResolvedValueOnce(reply({ replace: { '/page2/exam_bank': 'not an array anymore' } }))
      .mockResolvedValueOnce(reply(CLEAN_DOC));

    await run({ targetedRevision: true }, renderCheck, 3);

    expect(create).toHaveBeenCalledTimes(3);
    expect(named('lp612.author.patch_rejected')).toHaveLength(1);
    const rejectionLog = proseLines('lp612 author: targeted patch rejected — falling back to a full rewrite this round');
    expect(rejectionLog).toHaveLength(1);
    expect(rejectionLog[0][1].errors.some((e) => /type mismatch/.test(e))).toBe(true);
  });
});

// ── telemetry the A/B needs ───────────────────────────────────────────────────

describe('per-round telemetry: patchMode, pointersReplaced, completionTokens', () => {
  test('a "replace" round reports patchMode=replace and the pointer count', async () => {
    const renderCheck = jest.fn().mockResolvedValueOnce([CLIPPED_A]).mockResolvedValueOnce([]);
    create
      .mockResolvedValueOnce(reply(CLEAN_DOC))
      .mockResolvedValueOnce(reply({ replace: { '/page2/exam_bank': NEW_EXAM_BANK } }));

    await run({ targetedRevision: true }, renderCheck, 3);

    const events = named('lp612.author.revision_round');
    expect(events).toHaveLength(1);
    expect(events[0][1]).toMatchObject({ round: 1, patchMode: 'replace', pointersReplaced: 1 });
    expect(typeof events[0][1].completionTokens).toBe('number');
  });

  test('flag OFF reports patchMode=full on every round', async () => {
    const renderCheck = jest.fn().mockResolvedValueOnce([CLIPPED_A]).mockResolvedValueOnce([]);
    create.mockResolvedValue(reply(CLEAN_DOC));

    await run({}, renderCheck, 3);

    const events = named('lp612.author.revision_round');
    expect(events).toHaveLength(1);
    expect(events[0][1]).toMatchObject({ round: 1, patchMode: 'full', pointersReplaced: 0 });
  });

  test('a fallback round reports patchMode=fallback', async () => {
    const renderCheck = jest.fn().mockResolvedValueOnce([CLIPPED_A]).mockResolvedValueOnce([]);
    create
      .mockResolvedValueOnce(reply(CLEAN_DOC))
      .mockResolvedValueOnce(reply({ replace: { '/page2/nope': [] } }))
      .mockResolvedValueOnce(reply(CLEAN_DOC));

    await run({ targetedRevision: true }, renderCheck, 3);

    const events = named('lp612.author.revision_round');
    expect(events).toHaveLength(1);
    expect(events[0][1]).toMatchObject({ round: 1, patchMode: 'fallback' });
  });
});

// ── the env var wires the default ────────────────────────────────────────────

describe('LP612_TARGETED_REVISION env var', () => {
  test('"true" turns targeted revision on when no explicit option is passed', async () => {
    process.env.LP612_TARGETED_REVISION = 'true';
    const renderCheck = jest.fn().mockResolvedValueOnce([CLIPPED_A]).mockResolvedValueOnce([]);
    create
      .mockResolvedValueOnce(reply(CLEAN_DOC))
      .mockResolvedValueOnce(reply({ replace: { '/page2/exam_bank': NEW_EXAM_BANK } }));

    const out = await run({}, renderCheck, 3); // no explicit targetedRevision option

    expect(out.lpDoc.page2.exam_bank).toEqual(NEW_EXAM_BANK);
  });

  test('an explicit targetedRevision:false option overrides a "true" env var', async () => {
    process.env.LP612_TARGETED_REVISION = 'true';
    const renderCheck = jest.fn().mockResolvedValueOnce([CLIPPED_A]).mockResolvedValueOnce([]);
    create.mockResolvedValue(reply(CLEAN_DOC));

    await run({ targetedRevision: false }, renderCheck, 3);

    const revisionCall = create.mock.calls[1][0];
    expect(revisionCall.messages[1].content).not.toContain('ALLOWED POINTERS');
  });
});
