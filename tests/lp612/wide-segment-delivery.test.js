/**
 * bd-oak77.30 — THE LAST PATH THAT STILL REFUSES A LESSON.
 *
 * Operator rule, restated as a gate on 2026-09-07: *"the length cap must not also forcefully fail
 * lessons."* Every other length limb already honours it — the printed-page cap only flags
 * `over_cap`, an author timeout delivers best-so-far, a render defect degrades and delivers. The
 * page RANGE cap does not: `fetchPages` throws `PAGE_RANGE_TOO_LARGE` over 25 printed pages and
 * `compactPageTruth` throws `PAGE_TRUTH_TOO_LARGE` over 90,000 characters, both before a single
 * model token is spent, and the worker puts both in `NO_RETRY_CODES` — so the teacher is told the
 * lesson is too long and there is no retry that can ever change that.
 *
 * Measured on production 2026-09-07: **109 of 4,938 servable segments (2.21%) span more than 25
 * printed pages**, every one of them `lp_type='revision'` — chapter reviews and semester summaries,
 * which span many pages by their nature. All are on the menu and tappable. One of them,
 * `grade_6_mathematics.s901` (32 printed pages), failed a real teacher on 2026-09-07.
 *
 * WHAT THE CAP ACTUALLY PROTECTS — measured with `messages.count_tokens`, not asserted:
 *   model claude-sonnet-5, context window 1,000,000 tokens
 *   · a normal 3-5 page segment  ->  41,967-46,302 prompt tokens   (4.3-4.6% of the window)
 *   · grade_6_mathematics.s901   ->  68,572                        (6.9%)
 *   · the 63-page worst case     ->  98,620                        (9.9%)
 *   · the densest, 48pp maths    -> 108,104                        (10.8%)  <- the corpus maximum
 * The system brief alone is 37,540 of those tokens and is the cached prefix. `MAX_TOKENS` (24,000)
 * does not move with input size. So the cap guards no technical limit; 25 is a number
 * `brief_segment_v2.md` asserted and the code adopted. The one real historical bound was
 * `compactPageTruth`'s silent 90k byte-slice — and THAT defect (a lesson authored from a book that
 * stops mid-sentence, invisible at every layer) is still guarded here: what replaces the throw is
 * never a byte-slice, it is dropping WHOLE TRAILING PAGES and saying so on the row and in the doc.
 *
 * Condensing the page-truth instead was measured and rejected: prose is only 30.0% of the payload,
 * and an aggressive deterministic condensation saves 4.7-34% (median 13.8%) while deleting the
 * explanatory half a revision lesson needs.
 *
 * THE FLAG. `LP612_WIDE_SEGMENTS` unset is the shipped default and is today's behaviour byte for
 * byte — the last describe() block asserts exactly that, because 4,827 working segments must not
 * move. Set true, no page range in this corpus can be refused. Rollback is unsetting one variable.
 *
 * The LLM is mocked at the network boundary (`llm-client`) and page-truth is served from a real
 * temp directory through `LP612_PAGE_TRUTH_DIR` — the production code path, a different source. The
 * refusal line itself therefore EXECUTES in every test below; nothing here is a source-text grep.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../bot/shared/services/llm-client', () => {
  const create = jest.fn();
  // bd-oak77.29: the author service resolves its client PER MODEL, so the mock states that half
  // of llm-client's contract too. Same `create` spy either way — this suite asserts on the
  // payload and on whether a call happened at all, not on which provider it went to.
  return {
    getClient: () => ({ chat: { completions: { create } } }),
    getClientForModel: (m) => ({ client: { chat: { completions: { create } } }, model: String(m || '') }),
    __create: create,
  };
});

const create = require('../../bot/shared/services/llm-client').__create;
const { authorLessonPlan } = require('../../bot/shared/services/lp612-author.service');
const { fetchPages } = require('../../bot/shared/services/lp612-pagetruth.service');

const CLEAN_DOC = require('./__fixtures__/v9_gate_base.lp.json');

const BOOK = {
  title: 'Mathematics 6', publisher: 'NBF', subject: 'mathematics', grade: 6,
  medium: 'en', language: 'English', offset: 4,
};
const TOC = { chapters: [{ number: 3, title: 'Ratio and Proportion', printed_start: 51 }] };

/** `grade_6_mathematics.s901` as production holds it: 32 printed pages, 51-82, lp_type revision. */
const PAGES_32 = Array.from({ length: 32 }, (_, i) => 51 + i);

const WIDE_SEGMENT = {
  segment_id: 'grade_6_mathematics.s901',
  book_stem: 'grade_6_mathematics',
  grade: 6,
  subject: 'mathematics',
  medium: 'en',
  language: 'English',
  chapter_number: null,
  chapter_title: null,
  subtopic_title: 'Review: 1-3',
  menu_title: 'Review: 1-3',
  section_ref: null,
  printed_page_start: 51,
  printed_page_end: 82,
  pages_covered: PAGES_32,
  lp_type: 'revision',
  skill_type: 'review',
  day_number: null,
  // Production truth: every revision row carries notes and NO slo_text (0 of 718 rows have one).
  slo_text: null,
  notes: 'Figure directive: keep the ratio bar model from p.58.',
  yt: null,
  prev_segment_id: null,
  next_segment_id: null,
};

const reply = (obj) => ({
  choices: [{ message: { content: typeof obj === 'string' ? obj : JSON.stringify(obj) } }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
});

let dir;

/** Realistic page-truth: enough blocks per page that the 32 pages are a real payload. */
function writePages(stem, printedPages, prosePerPage = 400) {
  const d = path.join(dir, stem);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, '_book.json'), JSON.stringify(BOOK));
  fs.writeFileSync(path.join(d, '_toc.json'), JSON.stringify(TOC));
  for (const n of printedPages) {
    fs.writeFileSync(path.join(d, `pg_${String(n).padStart(3, '0')}.json`), JSON.stringify({
      printed_page_number: n,
      pdf_page_index: n + BOOK.offset,
      page_type: 'content',
      blocks: [
        { t: 'heading', text: `Section ${n} — ratio` },
        { t: 'prose', text: `Body of printed page ${n}. `.repeat(Math.ceil(prosePerPage / 28)) },
        { t: 'list', title: 'Learning Outcomes', items: [`Solve a ratio problem from page ${n}.`] },
      ],
    }));
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-wide-'));
  writePages(WIDE_SEGMENT.book_stem, PAGES_32);
  process.env.LP612_PAGE_TRUTH_DIR = dir;
  delete process.env.LP_AUTHOR_MODEL;
  delete process.env.LP612_AUTHOR_ROUNDS;
  delete process.env.LP612_WIDE_SEGMENTS;
});

afterEach(() => {
  delete process.env.LP612_PAGE_TRUTH_DIR;
  delete process.env.LP612_WIDE_SEGMENTS;
  delete process.env.LP612_AUTHOR_ROUNDS;
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── RED 1: the refusal, executed ─────────────────────────────────────────────

describe('today, a wide segment is refused before a single model token is spent', () => {
  test('grade_6_mathematics.s901 (32 printed pages) throws PAGE_RANGE_TOO_LARGE with the flag off', async () => {
    create.mockResolvedValue(reply(CLEAN_DOC));
    await expect(authorLessonPlan({ segment: WIDE_SEGMENT, lang: 'en', model: 'test/model', rounds: 0 }))
      .rejects.toMatchObject({ code: 'PAGE_RANGE_TOO_LARGE' });
    // The whole point of the defect: the model is never asked. There is nothing to salvage.
    expect(create).not.toHaveBeenCalled();
  });
});

// ── RED 2: a lesson comes out instead, in BOTH languages ─────────────────────

describe('with LP612_WIDE_SEGMENTS, a wide segment produces a lesson', () => {
  beforeEach(() => { process.env.LP612_WIDE_SEGMENTS = 'true'; });

  test.each([['en'], ['ur']])('%s — 32 printed pages author to an lp_doc, no refusal', async (lang) => {
    create.mockResolvedValue(reply(CLEAN_DOC));

    const out = await authorLessonPlan({ segment: WIDE_SEGMENT, lang, model: 'test/model', rounds: 0 });

    expect(out).toBeTruthy();
    expect(out.lpDoc).toBeTruthy();
    expect(create).toHaveBeenCalled();
    // Every one of the 32 pages reached the prompt — the whole range, not a slice of it.
    const user = create.mock.calls[0][0].messages[1].content;
    for (const n of [51, 66, 82]) expect(user).toContain(`PRINTED PAGE ${n}`);
  });

  test('the 63-page worst case in the corpus authors too', async () => {
    const pages = Array.from({ length: 63 }, (_, i) => 6 + i);
    writePages('grade_11_computer_science', pages);
    create.mockResolvedValue(reply(CLEAN_DOC));

    const out = await authorLessonPlan({
      segment: { ...WIDE_SEGMENT, segment_id: 'grade_11_computer_science.c01.r990',
        book_stem: 'grade_11_computer_science', pages_covered: pages,
        printed_page_start: 6, printed_page_end: 68 },
      lang: 'en', model: 'test/model', rounds: 0,
    });

    expect(out.lpDoc).toBeTruthy();
    expect(create.mock.calls[0][0].messages[1].content).toContain('PRINTED PAGE 68');
  });

  test('fetchPages returns the whole range and says the coverage is complete', async () => {
    const bundle = await fetchPages({ bookStem: WIDE_SEGMENT.book_stem, pages: PAGES_32 });
    expect(bundle.pages).toHaveLength(32);
    expect(bundle.coverage).toMatchObject({ requested: 32, served: 32, complete: true });
  });
});

// ── RED 3: beyond even the raised bound it DEGRADES HONESTLY, never errors ───

describe('past the hard ceiling it degrades honestly — a real lesson over part of the range', () => {
  beforeEach(() => { process.env.LP612_WIDE_SEGMENTS = 'true'; });

  test('an absurd range is trimmed to whole leading pages and labelled, not refused', async () => {
    // 120 printed pages: wider than anything in the corpus (max 63), so this limb is unreachable
    // today. It exists so that a future import can never resurrect an outright refusal.
    const pages = Array.from({ length: 120 }, (_, i) => 1 + i);
    writePages('grade_9_absurd', pages);
    create.mockResolvedValue(reply(CLEAN_DOC));

    const bundle = await fetchPages({ bookStem: 'grade_9_absurd', pages });

    expect(bundle.pages.length).toBeGreaterThan(0);
    expect(bundle.pages.length).toBeLessThan(120);
    expect(bundle.coverage.complete).toBe(false);
    expect(bundle.coverage.requested).toBe(120);
    // WHOLE PAGES, contiguous from the start — never the old mid-sentence byte-slice.
    expect(bundle.pages[0].printed_page_number).toBe(1);
    const served = bundle.pages.map((p) => p.printed_page_number);
    expect(served).toEqual(Array.from({ length: served.length }, (_, i) => i + 1));

    const out = await authorLessonPlan({
      segment: { ...WIDE_SEGMENT, book_stem: 'grade_9_absurd', pages_covered: pages,
        printed_page_start: 1, printed_page_end: 120 },
      lang: 'en', model: 'test/model', rounds: 0,
    });
    expect(out.lpDoc).toBeTruthy();
    // The teacher's copy must say which pages it actually covers. Silence here is the exact
    // regression mask the old 90k byte-slice was (Rule 24(b)).
    expect(out.coverage).toMatchObject({ complete: false });
    const user = create.mock.calls[0][0].messages[1].content;
    expect(user).toMatch(/covers printed pages|partial|only the pages listed/i);
  });

  test('page-truth over the character bound drops whole trailing pages, never a byte-slice', async () => {
    const { compactPageTruth } = require('../../bot/shared/services/lp612-author.service');
    const fat = (n) => ({
      printed_page_number: n, pdf_page_index: n, page_type: 'content',
      blocks: [{ t: 'prose', text: `page ${n} `.repeat(6000) }],
    });
    const out = compactPageTruth([fat(1), fat(2), fat(3), fat(4), fat(5)], 60000);
    expect(out).not.toContain('[truncated]');
    // it ends at a page boundary: the last page it mentions is complete
    expect(out).toContain('PRINTED PAGE 1');
    expect(out.length).toBeLessThanOrEqual(60000);
  });
});

// ── the guard: flag off is byte-for-byte today ───────────────────────────────

describe('with the flag unset nothing moves — 4,827 working segments do not change', () => {
  test('an ordinary 2-page segment authors exactly as before', async () => {
    writePages('grade_9_biology', [11, 12]);
    create.mockResolvedValue(reply(CLEAN_DOC));
    const out = await authorLessonPlan({
      segment: { ...WIDE_SEGMENT, book_stem: 'grade_9_biology', pages_covered: [11, 12],
        printed_page_start: 11, printed_page_end: 12, lp_type: 'content' },
      lang: 'en', model: 'test/model', rounds: 0,
    });
    expect(out.lpDoc).toBeTruthy();
  });

  test('exactly 25 pages still passes and 26 still refuses — the boundary is unchanged', async () => {
    const p25 = Array.from({ length: 25 }, (_, i) => 51 + i);
    const b = await fetchPages({ bookStem: WIDE_SEGMENT.book_stem, pages: p25 });
    expect(b.pages).toHaveLength(25);
    await expect(fetchPages({ bookStem: WIDE_SEGMENT.book_stem, pages: [...p25, 76] }))
      .rejects.toMatchObject({ code: 'PAGE_RANGE_TOO_LARGE' });
  });
});
