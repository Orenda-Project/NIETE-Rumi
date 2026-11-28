/**
 * bd-xkkw9.5 — THE LADDER NEVER GIVES UP A DRAFT THAT FITS THE PAGE CAP FOR ONE THAT DOES NOT.
 *
 * niete-logs, production, 19-28 Nov: 24 of 188 delivered 6-12 lessons were over the cap. In 4 of
 * them the ladder HELD a draft the page check had passed (TEACH 4) and then kept a later draft
 * that came back at 5, because `notWorse` compares defect COUNTS and `PAGE COUNT` is one defect
 * like any other: grade_7_history.c06.p119-120 held a fitting draft with 6 blocking lint
 * findings, took a 5-page draft with no more of them, and the teacher got 5 pages.
 *
 * Every lint finding the held draft still carries is delivered either way (the ladder returns the
 * draft it holds whatever lint says). Only the page count differs, and the page cap is the rule
 * this lane exists to keep. So: a page-cap tier, below the schema tier and the subject-figure
 * tier (a figure is never traded for a page, bd-xkkw9.1), above the count. It protects only a fit
 * the render gate actually VERIFIED: a held draft whose render was never checked, or failed for
 * infrastructure, has no fit to protect, and the comparison is exactly what it was.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../bot/shared/services/llm-client', () => {
  const create = jest.fn();
  return { getClient: () => ({ chat: { completions: { create } } }),
    getClientForModel: (m) => ({ client: { chat: { completions: { create } } }, model: String(m || '') }),
    __create: create };
});
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const create = require('../../bot/shared/services/llm-client').__create;
const svc = require('../../bot/shared/services/lp612-author.service');
const CLEAN_DOC = require('./__fixtures__/v9_gate_base.lp.json');

/** The fixture with its pacing knocked out: one deterministic blocking lint finding. */
function pacingBrokenDoc() {
  const d = JSON.parse(JSON.stringify(CLEAN_DOC));
  d.sections.find((s) => s.id === 'activity').minutes += 7;
  return d;
}
const activityMinutes = (d) => d.sections.find((s) => s.id === 'activity').minutes;

const BOOK = { title: 'History 7', publisher: 'PCTB', subject: 'history', grade: 7, medium: 'en', language: 'English', offset: 4 };
const TOC = { chapters: [{ number: 6, title: 'Europe', printed_start: 110 }] };
const SEGMENT = {
  segment_id: 'seg-h', book_stem: 'grade_7_history', grade: 7, subject: 'history',
  medium: 'en', language: 'English', chapter_number: 6, chapter_title: 'Europe',
  chapter_key: 'g7-his-ch6', subtopic_title: 'Unit review', menu_title: 'Unit review',
  printed_page_start: 119, printed_page_end: 120, pages_covered: [119, 120], order_index: 3, lp_type: 'SCI-9-10', yt: null,
};
const reply = (obj) => ({
  choices: [{ message: { content: JSON.stringify(obj) } }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
});
const TEACH_OVER = 'PAGE COUNT: teach needs 5 pages; the cap is 4. The 8 block(s) past the cap are 1730px of content.';

let dir;
beforeEach(() => {
  jest.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-keepfit-'));
  const d = path.join(dir, SEGMENT.book_stem);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, '_book.json'), JSON.stringify(BOOK));
  fs.writeFileSync(path.join(d, '_toc.json'), JSON.stringify(TOC));
  for (const n of [119, 120]) {
    fs.writeFileSync(path.join(d, `pg_${String(n).padStart(3, '0')}.json`), JSON.stringify({
      printed_page_number: n, pdf_page_index: n + 4, page_type: 'content', blocks: [{ t: 'heading', text: `6.${n} Europe` }],
    }));
  }
  process.env.LP612_PAGE_TRUTH_DIR = dir;
});
afterEach(() => { delete process.env.LP612_PAGE_TRUTH_DIR; fs.rmSync(dir, { recursive: true, force: true }); });

const run = (renderCheck, rounds) => svc.authorLessonPlan({
  segment: SEGMENT, lang: 'en', model: 'test/model', rounds, renderCheck, correlationId: 'c',
});

describe('the history lesson of 28 Nov: a fitting draft is held, a longer one comes back', () => {
  test('the 5-page draft is refused and the teacher gets the draft that fits', async () => {
    // first draft: over and lint-broken · revision 1: fits, still lint-broken · revision 2: lint-clean, over again
    create.mockResolvedValueOnce(reply(pacingBrokenDoc()))
      .mockResolvedValueOnce(reply(pacingBrokenDoc()))
      .mockResolvedValueOnce(reply(CLEAN_DOC));
    const renderCheck = jest.fn()
      .mockResolvedValueOnce([TEACH_OVER])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([TEACH_OVER]);

    const out = await run(renderCheck, 2);

    expect(renderCheck).toHaveBeenCalledTimes(3);
    expect(activityMinutes(out.lpDoc)).toBe(activityMinutes(CLEAN_DOC) + 7);   // the held, fitting draft
    expect(out.fails.some((f) => f.startsWith('PAGE COUNT'))).toBe(false);
  });

  test('a held draft whose render was never verified has no fit to protect: the count decides, as before', async () => {
    create.mockResolvedValueOnce(reply(pacingBrokenDoc()))
      .mockResolvedValueOnce(reply(pacingBrokenDoc()))
      .mockResolvedValueOnce(reply(CLEAN_DOC));
    const renderCheck = jest.fn()
      .mockResolvedValueOnce([TEACH_OVER])
      .mockRejectedValueOnce(new Error('browser died'))   // revision 1 unverified
      .mockResolvedValueOnce([TEACH_OVER]);

    const out = await run(renderCheck, 2);

    expect(activityMinutes(out.lpDoc)).toBe(activityMinutes(CLEAN_DOC));   // revision 2 taken on the count
  });
});

describe('the tier, on gate results directly', () => {
  const nw = svc.__notWorseVisualForTests;
  const g = (o) => ({ schema: [], lint: [], render: [], warns: [], renderChecked: true, ...o });
  const doc = JSON.parse(JSON.stringify(CLEAN_DOC));

  test('over the cap with fewer findings never replaces a verified fit', () => {
    const held = g({ lint: ['A: x', 'B: y'] });
    const cand = g({ render: [TEACH_OVER] });
    expect(nw(cand, held, doc, doc)).toBe(false);
  });

  test('a fit still replaces a fit on the count, and an over-cap draft still replaces an over-cap one', () => {
    expect(nw(g({ lint: ['A: x'] }), g({ lint: ['A: x', 'B: y'] }), doc, doc)).toBe(true);
    expect(nw(g({ render: [TEACH_OVER] }), g({ render: [TEACH_OVER], lint: ['A: x'] }), doc, doc)).toBe(true);
  });

  test('an infrastructure failure is not a verified fit', () => {
    const held = g({ render: ['RENDER_INFRA: the page-cap gate could not be verified after 2 attempts'], lint: ['A: x'] });
    expect(nw(g({ render: [TEACH_OVER] }), held, doc, doc)).toBe(true);
  });
});
