/**
 * The gate the revision ladder could not see.
 *
 * Two staging renders failed identically, from different subjects:
 *
 *   PAGE COUNT: support needs 5 pages; the cap is 4
 *   PAGE COUNT: support needs 6 pages; the cap is 4
 *
 * The ladder gated on SCHEMA and LINT only. Neither knows anything about pagination — that is
 * the renderer's job, and the renderer runs AFTER the ladder has finished and gone home. So the
 * author produced a lint-clean document, the renderer refused it, and nothing in the loop ever
 * asked the model to cut. Every English lesson died there, and the ladder had spent three
 * perfectly good rounds polishing prose that was never going to fit.
 *
 * The fix is to put the real gate inside the loop: the ladder now optimises against what
 * actually decides whether a teacher gets a PDF.
 *
 * The renderer is injected rather than imported so this suite stays a unit test — it must not
 * launch a browser — and, more importantly, so the ASSERTIONS are about the ladder's control
 * flow, which is the thing that was wrong.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../bot/shared/services/llm-client', () => {
  const create = jest.fn();
  return { getClient: () => ({ chat: { completions: { create } } }), __create: create };
});

const create = require('../../bot/shared/services/llm-client').__create;
const { authorLessonPlan } = require('../../bot/shared/services/lp612-author.service');
const CLEAN_DOC = require('./__fixtures__/v9_gate_base.lp.json');

/** The fixture with its pacing knocked out — one deterministic lint FAIL, no schema error. */
function pacingBrokenDoc() {
  const d = JSON.parse(JSON.stringify(CLEAN_DOC));
  d.sections.find((s) => s.id === 'activity').minutes += 7;
  return d;
}

const BOOK = { title: 'Biology 9', publisher: 'PCTB', subject: 'biology', grade: 9, medium: 'en', language: 'English', offset: 4 };
const TOC = { chapters: [{ number: 1, title: 'The Biological Method', printed_start: 9 }] };
const SEGMENT = {
  segment_id: 'seg-1', book_stem: 'grade_9_biology', grade: 9, subject: 'biology',
  medium: 'en', language: 'English', chapter_number: 1, chapter_title: 'The Biological Method',
  chapter_key: 'g9-bio-ch1', subtopic_title: 'Observation and hypothesis',
  menu_title: 'Observation & hypothesis', printed_page_start: 11, printed_page_end: 12,
  pages_covered: [11, 12], order_index: 3, lp_type: 'SCI-9-10', yt: null,
};

const reply = (obj) => ({
  choices: [{ message: { content: typeof obj === 'string' ? obj : JSON.stringify(obj) } }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
});

const OVERFLOW = 'PAGE COUNT: support needs 6 pages; the cap is 4. Cut it, or move content to the other part.';

let dir;
beforeEach(() => {
  jest.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-rgate-'));
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

const run = (renderCheck, rounds = 3) => authorLessonPlan({
  segment: SEGMENT, lang: 'en', model: 'test/model', rounds, renderCheck, correlationId: 'c',
});

describe('the render gate runs inside the revision ladder', () => {
  test('an overflowing document triggers a revision round', async () => {
    // Round 1 overflows, the revision fits. Without a render gate the ladder sees a clean
    // document, stops, and hands back the one that cannot be rendered.
    const renderCheck = jest.fn()
      .mockResolvedValueOnce([OVERFLOW])
      .mockResolvedValue([]);
    create.mockResolvedValueOnce(reply(CLEAN_DOC)).mockResolvedValueOnce(reply(CLEAN_DOC));

    const out = await run(renderCheck);

    expect(renderCheck).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(2);   // author + one revision
    expect(out.rounds).toBe(1);
  });

  test('the model is TOLD the page count, in the renderer\'s own words', async () => {
    // A revision prompt that says "make it shorter" is a different instruction from one that
    // says "support needs 6 pages; the cap is 4". The ladder passes the defect verbatim.
    const renderCheck = jest.fn().mockResolvedValueOnce([OVERFLOW]).mockResolvedValue([]);
    create.mockResolvedValueOnce(reply(CLEAN_DOC)).mockResolvedValueOnce(reply(CLEAN_DOC));

    await run(renderCheck);

    const revisionPrompt = create.mock.calls[1][0].messages.map((m) => m.content).join('\n');
    expect(revisionPrompt).toContain('support needs 6 pages');
  });

  test('a document that renders cleanly costs NO extra rounds', async () => {
    const renderCheck = jest.fn().mockResolvedValue([]);
    create.mockResolvedValue(reply(CLEAN_DOC));

    const out = await run(renderCheck);

    expect(out.rounds).toBe(0);
    expect(create).toHaveBeenCalledTimes(1);
  });

  test('with NO renderCheck the ladder behaves exactly as before', async () => {
    // The gate is optional: every existing caller, and every existing test, must be unaffected.
    create.mockResolvedValue(reply(CLEAN_DOC));
    const out = await run(undefined);
    expect(out.rounds).toBe(0);
    expect(create).toHaveBeenCalledTimes(1);
  });

  test('a render that THROWS does not kill the run', async () => {
    // The renderer can fail for reasons that are not the document's fault — a browser that
    // would not launch. That must not turn into "no lesson"; it falls back to the old
    // behaviour, which is to serve what the lint gate approved.
    const renderCheck = jest.fn().mockRejectedValue(new Error('browser died'));
    create.mockResolvedValue(reply(CLEAN_DOC));

    const out = await run(renderCheck);
    expect(out.lpDoc).toBeTruthy();
  });

  test('a document that never fits still returns the best draft rather than nothing', async () => {
    // The ladder has always served its best effort rather than refusing. The render gate must
    // not change that: the renderer will reject it downstream and the teacher gets the honest
    // apology, which is the designed path.
    const renderCheck = jest.fn().mockResolvedValue([OVERFLOW]);
    create.mockResolvedValue(reply(CLEAN_DOC));

    const out = await run(renderCheck, 2);
    expect(out.lpDoc).toBeTruthy();
    expect(out.rounds).toBe(2);
  });
});

// ── telling the model the RIGHT way to cut ──────────────────────────────────

/**
 * Measured on the real corpus: page2 held 658 words across 6 A4 pages — about 110 words a page.
 * The support page is built from CARDS (exam bank, model answers, mistakes, differentiation),
 * each with fixed chrome at the mandatory 18px body floor, so pages are consumed by CARD COUNT
 * and not by prose length.
 *
 * That is why the first render-gated run only got 6 pages down to 5: the model shortened
 * sentences, which is nearly free in pages. It has to be told to drop whole items instead.
 */
describe('a page-overflow defect asks for ITEMS to be cut, not words', () => {
  test('the revision prompt says card count is what costs pages', async () => {
    const renderCheck = jest.fn().mockResolvedValueOnce([OVERFLOW]).mockResolvedValue([]);
    create.mockResolvedValueOnce(reply(CLEAN_DOC)).mockResolvedValueOnce(reply(CLEAN_DOC));

    await run(renderCheck);

    const prompt = create.mock.calls[1][0].messages.map((m) => m.content).join('\n');
    expect(prompt).toMatch(/whole items|CARD COUNT/i);
    expect(prompt).toMatch(/exam_bank/);
  });

  test('the hint appears ONLY when the page actually overflowed', async () => {
    // A lint-only revision must not be told to delete exam questions.
    const renderCheck = jest.fn().mockResolvedValue([]);
    create.mockResolvedValue(reply(pacingBrokenDoc()));

    await run(renderCheck, 1);

    const prompt = (create.mock.calls[1] || [{ messages: [] }])[0].messages
      .map((m) => m.content).join('\n');
    expect(prompt).not.toMatch(/CARD COUNT/i);
  });
});
