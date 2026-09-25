/**
 * bd-oak77.19 — a rejected targeted patch, and a schema-invalid candidate, must log enough to
 * say WHY without re-running the lesson.
 *
 * Seen in production: `lp612.author.patch_rejected` arrived as `pointers:[] errors:[]` with no
 * sign of what the model actually returned, how long it was, or whether it was cut off at
 * max_tokens. `lp612.author.schema_invalid` said `errorCount: 12` beside an `errors[]` of 5, with
 * nothing on the event saying the other 7 had been dropped.
 *
 * Two layers, per root CLAUDE.md Rule 6:
 *   (A) the pure `describeInvalidReply` helper (no network boundary, so a direct test IS the
 *       real code path);
 *   (B) the real `authorLessonPlan()` ladder with the LLM doubled at `llm-client` and the two
 *       loggers doubled at their module boundary — the same harness targeted-revision.test.js
 *       uses, so the events asserted on are the ones the ladder really emits.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const mockLogEvent = jest.fn();
const mockLogToFile = jest.fn();

jest.mock('../../bot/shared/services/llm-client', () => {
  const create = jest.fn();
  return { getClient: () => ({ chat: { completions: { create } } }),
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
const { authorLessonPlan, describeInvalidReply } = require('../../bot/shared/services/lp612-author.service');
const CLEAN_DOC = require('./__fixtures__/v9_gate_base.lp.json');

const named = (name) => mockLogEvent.mock.calls.filter((c) => c[0] === name);
const proseLines = (msg) => mockLogToFile.mock.calls.filter((c) => c[0] === msg);
const clone = (d) => JSON.parse(JSON.stringify(d));
const REJECT_LINE = 'lp612 author: targeted patch rejected — falling back to a full rewrite this round';

const BOOK = { title: 'Biology 9', publisher: 'PCTB', subject: 'biology', grade: 9, medium: 'en', language: 'English', offset: 4 };
const TOC = { chapters: [{ number: 1, title: 'The Biological Method', printed_start: 9 }] };
const SEGMENT = {
  segment_id: 'seg-1', book_stem: 'grade_9_biology', grade: 9, subject: 'biology',
  medium: 'en', language: 'English', chapter_number: 1, chapter_title: 'The Biological Method',
  chapter_key: 'g9-bio-ch1', subtopic_title: 'Observation and hypothesis',
  menu_title: 'Observation & hypothesis', printed_page_start: 11, printed_page_end: 12,
  pages_covered: [11, 12], order_index: 3, lp_type: 'SCI-9-10', yt: null, notes: null,
};

const reply = (obj, finishReason = 'stop') => ({
  choices: [{ message: { content: JSON.stringify(obj) }, finish_reason: finishReason }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
});

const CLIPPED_A = 'OVERFLOW on s2: content is 40px taller than the page. Offending: exam_bank (+40px)';

let dir;
beforeEach(() => {
  jest.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-reply-telemetry-'));
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

// ── (A) the pure helper ──────────────────────────────────────────────────────

describe('describeInvalidReply', () => {
  test('an object with neither key: its top-level keys become the pointers, and the error says what was missing', () => {
    const out = describeInvalidReply({ some_other_shape: true, lesson_id: 'x' });
    expect(out.pointers).toEqual(['/some_other_shape', '/lesson_id']);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toMatch(/neither "replace" nor "full"/);
    expect(out.errors[0]).toContain('some_other_shape');
  });

  test('a "replace" of the wrong type is named as such, not as a missing key', () => {
    const out = describeInvalidReply({ replace: ['/page2/exam_bank'] });
    expect(out.pointers).toEqual(['/replace']);
    expect(out.errors[0]).toMatch(/"replace" must be an object.*got array/);
  });

  test('a "full" of the wrong type is named as such', () => {
    const out = describeInvalidReply({ full: 'the whole doc' });
    expect(out.errors[0]).toMatch(/"full" must be an object.*got string/);
  });

  test('a non-object reply has no pointers and an error naming its type', () => {
    expect(describeInvalidReply([1, 2])).toEqual({ pointers: [], errors: [expect.stringMatching(/got array/)] });
    expect(describeInvalidReply(null)).toEqual({ pointers: [], errors: [expect.stringMatching(/got null/)] });
  });

  test('keys are escaped as JSON Pointer tokens', () => {
    expect(describeInvalidReply({ 'a/b': 1, 'c~d': 2 }).pointers).toEqual(['/a~1b', '/c~0d']);
  });
});

// ── (B) through the real ladder ──────────────────────────────────────────────

describe('patch_rejected on an unparseable shape says what came back', () => {
  test('pointers, errors, reply length, a preview and finish_reason reach BOTH log lines', async () => {
    const renderCheck = jest.fn()
      .mockResolvedValueOnce([CLIPPED_A])
      .mockResolvedValueOnce([]);
    const oddReply = { some_other_shape: true, note: 'z'.repeat(2000) };
    create
      .mockResolvedValueOnce(reply(CLEAN_DOC))
      .mockResolvedValueOnce(reply(oddReply, 'length'))
      .mockResolvedValueOnce(reply(CLEAN_DOC));

    await run({ targetedRevision: true }, renderCheck, 3);

    const rejected = named('lp612.author.patch_rejected');
    expect(rejected).toHaveLength(1);
    const ev = rejected[0][1];
    expect(ev.reason).toBe('unparseable_shape');
    expect(ev.pointers).toEqual(['/some_other_shape', '/note']);
    expect(ev.errors).toHaveLength(1);
    expect(ev.errors[0]).toMatch(/neither "replace" nor "full"/);
    expect(ev.finishReason).toBe('length');
    expect(ev.replyChars).toBe(JSON.stringify(oddReply).length);
    expect(ev.replyPreview.length).toBeLessThanOrEqual(500);
    expect(JSON.stringify(oddReply).startsWith(ev.replyPreview)).toBe(true);

    const prose = proseLines(REJECT_LINE);
    expect(prose).toHaveLength(1);
    expect(prose[0][1]).toMatchObject({
      pointers: ['/some_other_shape', '/note'], finishReason: 'length', replyChars: ev.replyChars,
    });
    expect(prose[0][1].errors).toHaveLength(1);
  });
});

describe('patch_rejected on an unresolvable pointer carries the merge errors on the queryable event', () => {
  test('errors[] is populated on logEvent, not only on the prose line', async () => {
    const renderCheck = jest.fn()
      .mockResolvedValueOnce([CLIPPED_A])
      .mockResolvedValueOnce([]);
    create
      .mockResolvedValueOnce(reply(CLEAN_DOC))
      .mockResolvedValueOnce(reply({ replace: { '/page2/not_a_real_field': ['x'] } }))
      .mockResolvedValueOnce(reply(CLEAN_DOC));

    await run({ targetedRevision: true }, renderCheck, 3);

    const ev = named('lp612.author.patch_rejected')[0][1];
    expect(ev.reason).toBe('unresolvable_or_invalid_pointer');
    expect(ev.pointers).toEqual(['/page2/not_a_real_field']);
    expect(ev.errors.length).toBeGreaterThan(0);
    expect(ev.finishReason).toBe('stop');
    expect(ev.replyChars).toBeGreaterThan(0);
  });
});

describe('schema_invalid makes its truncation visible', () => {
  /** The clean fixture with 25 independent schema errors: each `materials` item the wrong type. */
  function manyErrorDoc() {
    const d = clone(CLEAN_DOC);
    d.materials = Array.from({ length: 25 }, (_, i) => i);
    return { d };
  }

  test('more errors than the old cap of 5 are carried, and errorsOmitted squares the count', async () => {
    const { d } = manyErrorDoc();
    const renderCheck = jest.fn().mockResolvedValue([]);
    create.mockResolvedValueOnce(reply(d)).mockResolvedValueOnce(reply(CLEAN_DOC));

    await run({}, renderCheck, 1);

    const ev = named('lp612.author.schema_invalid')[0][1];
    expect(ev.errorCount).toBe(25);
    expect(ev.errors.length).toBe(Math.min(ev.errorCount, 20));
    expect(ev.errors.length).toBeGreaterThan(5);
    expect(ev.errorsOmitted).toBe(ev.errorCount - ev.errors.length);
  });
});
