/**
 * bd-oak77.30 — THE BLAST-RADIUS PROOF.
 *
 * `LP612_WIDE_SEGMENTS` is going to be turned on overnight while nobody is watching, on a system
 * serving lessons. The entire safety argument for doing that is one claim:
 *
 *   turning the flag on changes the behaviour of the 109 segments that fail 100% of the time
 *   today, and of NOTHING ELSE.
 *
 * A claim like that is a hypothesis until it is executed (root Rule 16). This file executes it,
 * three ways, because there are exactly three ways it could be false:
 *
 *   1. the two length guards no longer throwing could alter some narrow path that used to throw
 *      for a DIFFERENT reason;
 *   2. the revision addendum could reach the 609 revision segments at or under 25 pages, which
 *      are authored successfully today;
 *   3. the prompt for an ordinary segment could differ by a byte — and one byte moves the
 *      prompt-cache prefix, which would change cost and latency fleet-wide.
 *
 * Measured against production 2026-09-07: 4,938 servable segments, 109 over 25 printed pages.
 * 4,829 segments must be untouched. That is what is asserted here.
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
const {
  buildUserPrompt, authorLessonPlan, compactPageTruth, PAGE_TRUTH_MAX_CHARS,
} = require('../../bot/shared/services/lp612-author.service');
const {
  fetchPages, MAX_SEGMENT_PAGES,
} = require('../../bot/shared/services/lp612-pagetruth.service');

const CLEAN_DOC = require('./__fixtures__/v9_gate_base.lp.json');

const BOOK = { title: 'Biology 9', publisher: 'PCTB', subject: 'biology', grade: 9, medium: 'en', language: 'English', offset: 4 };
const TOC = { chapters: [{ number: 1, title: 'The Biological Method', printed_start: 9 }] };

const NARROW = {
  segment_id: 'grade_9_biology.c01.p011-012',
  book_stem: 'grade_9_biology', grade: 9, subject: 'biology', medium: 'en', language: 'English',
  chapter_number: 1, chapter_title: 'The Biological Method',
  subtopic_title: 'Observation and hypothesis', menu_title: 'Observation & hypothesis',
  section_ref: '1.2', printed_page_start: 11, printed_page_end: 12, pages_covered: [11, 12],
  lp_type: 'content', skill_type: 'concept', day_number: 1,
  slo_text: 'Describe the steps of the biological method.', yt: null, notes: null,
  prev_segment_id: null, next_segment_id: 'seg-2',
};

const reply = (o) => ({ choices: [{ message: { content: JSON.stringify(o) } }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } });

let dir;
function writePages(stem, printed) {
  const d = path.join(dir, stem);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, '_book.json'), JSON.stringify(BOOK));
  fs.writeFileSync(path.join(d, '_toc.json'), JSON.stringify(TOC));
  for (const n of printed) {
    fs.writeFileSync(path.join(d, `pg_${String(n).padStart(3, '0')}.json`), JSON.stringify({
      printed_page_number: n, pdf_page_index: n + 4, page_type: 'content',
      blocks: [
        { t: 'heading', text: `1.${n} Observation` },
        { t: 'prose', text: `The observable body text of printed page ${n}.` },
        { t: 'list', title: 'Learning Outcomes', items: ['Describe the steps of the biological method.'] },
      ],
    }));
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-blast-'));
  writePages('grade_9_biology', Array.from({ length: 30 }, (_, i) => 11 + i));
  process.env.LP612_PAGE_TRUTH_DIR = dir;
  delete process.env.LP612_WIDE_SEGMENTS;
});
afterEach(() => {
  delete process.env.LP612_PAGE_TRUTH_DIR;
  delete process.env.LP612_WIDE_SEGMENTS;
  fs.rmSync(dir, { recursive: true, force: true });
});

const bundleFor = async (pages) => {
  const b = await fetchPages({ bookStem: 'grade_9_biology', pages });
  return b;
};

// ── 3. the prompt for an ordinary segment is BYTE-IDENTICAL ──────────────────

describe('claim 3 — an ordinary segment gets the same bytes with the flag on and off', () => {
  test.each([[2], [5], [12], [25]])('%i printed pages: the user turn is byte-identical', async (n) => {
    const pages = Array.from({ length: n }, (_, i) => 11 + i);
    const seg = { ...NARROW, pages_covered: pages, printed_page_end: 10 + n };

    delete process.env.LP612_WIDE_SEGMENTS;
    const off = buildUserPrompt({ segment: seg, bundle: await bundleFor(pages), lang: 'en', video: null });

    process.env.LP612_WIDE_SEGMENTS = 'true';
    const on = buildUserPrompt({ segment: seg, bundle: await bundleFor(pages), lang: 'en', video: null });

    expect(on).toBe(off);
    expect(on).not.toMatch(/REVISION LESSON OVER A WHOLE CHAPTER/);
    expect(on).not.toMatch(/COVERS PART OF ITS RANGE/);
  });

  test.each([['en'], ['ur']])('%s — the whole request the model receives is identical', async (lang) => {
    const seg = { ...NARROW };

    delete process.env.LP612_WIDE_SEGMENTS;
    create.mockResolvedValue(reply(CLEAN_DOC));
    await authorLessonPlan({ segment: seg, lang, model: 'test/model', rounds: 0 });
    const before = create.mock.calls[0][0];

    jest.clearAllMocks();
    process.env.LP612_WIDE_SEGMENTS = 'true';
    create.mockResolvedValue(reply(CLEAN_DOC));
    await authorLessonPlan({ segment: seg, lang, model: 'test/model', rounds: 0 });
    const after = create.mock.calls[0][0];

    // system message AND user turn, byte for byte. One byte here moves the prompt-cache prefix.
    expect(after.messages[0].content).toBe(before.messages[0].content);
    expect(after.messages[1].content).toBe(before.messages[1].content);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});

// ── 2. the revision addendum reaches ONLY segments over the threshold ────────

describe('claim 2 — the revision addendum never reaches a segment that works today', () => {
  beforeEach(() => { process.env.LP612_WIDE_SEGMENTS = 'true'; });

  test('a 25-page REVISION segment — the widest that authors today — does not get it', async () => {
    const pages = Array.from({ length: MAX_SEGMENT_PAGES }, (_, i) => 11 + i);
    const user = buildUserPrompt({
      segment: { ...NARROW, lp_type: 'revision', slo_text: null, pages_covered: pages },
      bundle: await bundleFor(pages), lang: 'en', video: null,
    });
    expect(user).not.toMatch(/REVISION LESSON OVER A WHOLE CHAPTER/);
  });

  test('26 pages — one over the threshold — does get it', async () => {
    const pages = Array.from({ length: MAX_SEGMENT_PAGES + 1 }, (_, i) => 11 + i);
    const user = buildUserPrompt({
      segment: { ...NARROW, lp_type: 'revision', slo_text: null, pages_covered: pages },
      bundle: await bundleFor(pages), lang: 'en', video: null,
    });
    expect(user).toMatch(/REVISION LESSON OVER A WHOLE CHAPTER/);
    expect(user).toMatch(/26 printed pages/);
    // and it must say the SPAN, so the model cannot read it as one more content day
    expect(user).toMatch(/RECALL/);
  });

  test('it is keyed on the SPAN, not on lp_type — a wide non-revision row still gets it', async () => {
    // Every over-threshold row in production is lp_type='revision', but the corpus is re-imported.
    // Keying on the span means a future wide row cannot slip through un-briefed.
    const pages = Array.from({ length: 30 }, (_, i) => 11 + i);
    const user = buildUserPrompt({
      segment: { ...NARROW, lp_type: 'content', pages_covered: pages },
      bundle: await bundleFor(pages), lang: 'en', video: null,
    });
    expect(user).toMatch(/REVISION LESSON OVER A WHOLE CHAPTER/);
  });
});

// ── 1. no narrow path that could previously throw is altered ─────────────────

describe('claim 1 — every other refusal still fires, with the flag on', () => {
  beforeEach(() => { process.env.LP612_WIDE_SEGMENTS = 'true'; });

  test('an empty page list is still PAGE_TRUTH_MISSING', async () => {
    await expect(fetchPages({ bookStem: 'grade_9_biology', pages: [] }))
      .rejects.toMatchObject({ code: 'PAGE_TRUTH_MISSING' });
  });

  test('a missing book is still PAGE_TRUTH_MISSING', async () => {
    await expect(fetchPages({ bookStem: 'no_such_book', pages: [11, 12] }))
      .rejects.toMatchObject({ code: 'PAGE_TRUTH_MISSING' });
  });

  test('a missing PAGE inside the range is still PAGE_TRUTH_MISSING — a lesson with a hole is refused', async () => {
    // The one refusal that must survive: an LP authored from four of its five pages is a lesson
    // with an invisible hole. Widening the RANGE cap must not soften this.
    await expect(fetchPages({ bookStem: 'grade_9_biology', pages: [11, 999] }))
      .rejects.toMatchObject({ code: 'PAGE_TRUTH_MISSING' });
  });

  test('a missing page inside a WIDE range is refused too', async () => {
    const pages = [...Array.from({ length: 30 }, (_, i) => 11 + i), 998];
    await expect(fetchPages({ bookStem: 'grade_9_biology', pages }))
      .rejects.toMatchObject({ code: 'PAGE_TRUTH_MISSING' });
  });

  test('corrupt page-truth is still PAGE_TRUTH_CORRUPT', async () => {
    fs.writeFileSync(path.join(dir, 'grade_9_biology', 'pg_011.json'), '{not json');
    await expect(fetchPages({ bookStem: 'grade_9_biology', pages: [11] }))
      .rejects.toMatchObject({ code: 'PAGE_TRUTH_CORRUPT' });
  });

  test('page-truth UNDER the character bound is returned whole and unmarked, either way', () => {
    const small = [{ printed_page_number: 1, pdf_page_index: 1, page_type: 'content',
      blocks: [{ t: 'prose', text: 'x'.repeat(500) }] }];
    delete process.env.LP612_WIDE_SEGMENTS;
    const off = compactPageTruth(small);
    process.env.LP612_WIDE_SEGMENTS = 'true';
    expect(compactPageTruth(small)).toBe(off);
    expect(off).not.toContain('[truncated]');
    expect(off.length).toBeLessThan(PAGE_TRUTH_MAX_CHARS);
  });
});
