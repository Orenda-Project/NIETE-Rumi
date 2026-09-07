/**
 * bd-5w13w — the byte-identical revision re-issue, made measurable.
 *
 * BREAKDOWN.md §3B: `buildRevisionPrompt` is a pure function of `(doc, gates, originalUser,
 * notes)`. When a candidate is rejected as "worse", none of the four change, so the NEXT round
 * sends a byte-identical prompt to the model — a full ~56s live call for nothing. Observed
 * 1.24 times per lesson in the 2026-09-04 window, but every one of the 61 occurrences measured
 * there was a cassette replay, so the live cost is unmeasured.
 *
 * This suite proves two things, unconditionally (no flag — bd-5w13w ships without one):
 *
 *   1. `buildRevisionPrompt` really is byte-identical across two calls with the same inputs —
 *      the mechanism BREAKDOWN.md names.
 *   2. The ladder detects this happening to ITSELF and emits a queryable event
 *      (`lp612.author.prompt_reissued`) the moment a revision round's prompt hashes identically
 *      to the one before it — driven through the real `authorLessonPlan()` ladder with the LLM
 *      doubled at the network boundary, per root CLAUDE.md Rule 6 (never skip the call chain).
 *
 * Also covers the sibling ask: `promptSha` / `promptChars` / `completion_tokens` /
 * `prompt_tokens` land on the existing `lp612 author LLM call` log line.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

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
} = require('../../bot/shared/services/lp612-author.service');
const CLEAN_DOC = require('./__fixtures__/v9_gate_base.lp.json');

const named = (name) => mockLogEvent.mock.calls.filter((c) => c[0] === name);
const proseLines = (msg) => mockLogToFile.mock.calls.filter((c) => c[0] === msg);

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
  usage: { prompt_tokens: 111, completion_tokens: 222, total_tokens: 333 },
});

// A real, non-advisory, non-page-count render defect — so the round is genuinely blocking
// without tripping the page-count-only one-round budget (bd-vjk68) or the BUDGET advisory
// exemption (bd-wbvtb).
const CLIPPED_A = 'OVERFLOW on s2: content is 40px taller than the page. Offending: exam_bank (+40px)';
const CLIPPED_B = 'OVERFLOW on s3: content is 12px taller than the page. Offending: mistakes (+12px)';

let dir;
beforeEach(() => {
  jest.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-reissue-'));
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
});
afterEach(() => { delete process.env.LP612_PAGE_TRUTH_DIR; });

// ── 1. the pure-function proof (BREAKDOWN.md's own claim) ───────────────────

test('buildRevisionPrompt is byte-identical across two calls with the same (doc, gates, originalUser, notes)', () => {
  const doc = JSON.parse(JSON.stringify(CLEAN_DOC));
  const gates = { schema: [], lint: [], render: [CLIPPED_A], warns: [] };
  const originalUser = 'THE ORIGINAL TASK TEXT, UNCHANGED';
  const notes = 'some segment notes';

  const a = buildRevisionPrompt({ doc, gates, originalUser, notes, lang: 'en' });
  const b = buildRevisionPrompt({ doc, gates, originalUser, notes, lang: 'en' });

  expect(a).toBe(b);
  expect(crypto.createHash('sha256').update(a).digest('hex'))
    .toBe(crypto.createHash('sha256').update(b).digest('hex'));
});

// ── 2. the ladder fires the reissue event when this actually happens to it ──

describe('lp612.author.prompt_reissued', () => {
  test('fires when a rejected candidate leaves doc/gates unchanged, so the next round\'s prompt repeats', async () => {
    const renderCheck = jest.fn()
      .mockResolvedValueOnce([CLIPPED_A])          // round-0 gate: 1 blocking defect
      .mockResolvedValueOnce([CLIPPED_A, CLIPPED_B]) // round-1 candidate: WORSE, rejected
      .mockResolvedValueOnce([]);                   // round-2 candidate: clean, accepted

    create.mockResolvedValue(reply(CLEAN_DOC));

    const out = await authorLessonPlan({
      segment: SEGMENT, lang: 'en', model: 'test/model', rounds: 3,
      renderCheck, correlationId: 'corr-reissue',
    });

    // Round 1 was rejected (worse), so round 2 climbs from the SAME (doc, gates, notes) round 1
    // did — the exact mechanism BREAKDOWN.md names. That must be visible as a named event.
    const events = named('lp612.author.prompt_reissued');
    expect(events).toHaveLength(1);
    expect(events[0][1]).toMatchObject({
      correlationId: 'corr-reissue',
      segmentId: 'seg-1',
      round: 2,
    });
    expect(typeof events[0][1].promptSha).toBe('string');
    expect(events[0][1].promptSha.length).toBe(12);

    // Sanity: the ladder actually ran the shape this test assumes (3 calls: author + 2 revisions).
    expect(create).toHaveBeenCalledTimes(3);
    expect(out.rounds).toBe(2);
  });

  test('does NOT fire on the very first revision round (nothing to repeat yet)', async () => {
    const renderCheck = jest.fn()
      .mockResolvedValueOnce([CLIPPED_A])
      .mockResolvedValueOnce([]);
    create.mockResolvedValue(reply(CLEAN_DOC));

    await authorLessonPlan({
      segment: SEGMENT, lang: 'en', model: 'test/model', rounds: 3,
      renderCheck, correlationId: 'corr-first',
    });

    expect(named('lp612.author.prompt_reissued')).toHaveLength(0);
  });
});

// ── 3. the LLM-call log line carries the fingerprint + the split usage ──────

describe('the "lp612 author LLM call" line carries promptSha/promptChars/prompt_tokens/completion_tokens', () => {
  test('every call gets a 12-hex-char promptSha, a promptChars count, and the split token usage', async () => {
    const renderCheck = jest.fn().mockResolvedValue([]);
    create.mockResolvedValue(reply(CLEAN_DOC));

    await authorLessonPlan({
      segment: SEGMENT, lang: 'en', model: 'test/model', rounds: 0,
      renderCheck, correlationId: 'corr-line',
    });

    const lines = proseLines('lp612 author LLM call');
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const payload = lines[0][1];
    expect(typeof payload.promptSha).toBe('string');
    expect(payload.promptSha).toMatch(/^[0-9a-f]{12}$/);
    expect(typeof payload.promptChars).toBe('number');
    expect(payload.promptChars).toBeGreaterThan(0);
    expect(payload.completion_tokens).toBe(222);
    expect(payload.prompt_tokens).toBe(111);
    // The full usage blob stays too — this is additive, not a replacement.
    expect(payload.usage).toMatchObject({ prompt_tokens: 111, completion_tokens: 222 });
  });

  test('two calls with the identical (system, user) pair produce the identical promptSha', async () => {
    const renderCheck = jest.fn()
      .mockResolvedValueOnce([CLIPPED_A])
      .mockResolvedValueOnce([CLIPPED_A, CLIPPED_B])
      .mockResolvedValueOnce([]);
    create.mockResolvedValue(reply(CLEAN_DOC));

    await authorLessonPlan({
      segment: SEGMENT, lang: 'en', model: 'test/model', rounds: 3,
      renderCheck, correlationId: 'corr-samesha',
    });

    const lines = proseLines('lp612 author LLM call');
    // stage: author, revision1, revision2 (each with attempt suffix .a1)
    const revisionLines = lines.filter((l) => /^revision/.test(l[1].stage));
    expect(revisionLines).toHaveLength(2);
    expect(revisionLines[0][1].promptSha).toBe(revisionLines[1][1].promptSha);
  });
});
