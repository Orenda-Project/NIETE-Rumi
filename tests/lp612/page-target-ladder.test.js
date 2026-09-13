/**
 * bd-a8veu.22 — THE SOFT PAGE TARGET HAS TO REACH THE AUTHOR, OR IT IS NOT A TARGET.
 *
 * `render_lp.js` has had two numbers per part since the Urdu caps went in: a HARD cap (English
 * teach 4 / support 3, Urdu 5 / 4) and a SOFT target one page below it. Only the hard cap ever
 * did anything. The soft-target breach was pushed to `report.warnings`, and `warnings` is read by
 * exactly nobody on the success path — `lp612-render.service` attaches it to a throw that only
 * `problems.length` can fire, and the worker's `renderCheck` returns `[]` for any render that did
 * not throw. So the ladder was handed an empty defect list and stopped.
 *
 * The consequence is measurable and was measured: four test renders off sandbox on 2026-09-12
 * (grade 6 geography, grade 6 maths, grade 7 english, grade 7 urdu) came out at EXACTLY 7 pages
 * each — 4 teach + 3 support, the hard cap to the page. The only length pressure in the system
 * fires at the hard cap and pushes a document back to exactly the hard cap, and the warning text
 * itself said "Allowed — completeness beats page count", which is the opposite instruction.
 *
 * THE FIX, in one sentence: the soft-target breach becomes a `PAGE TARGET:` defect the ladder
 * can see, priced exactly like `PAGE COUNT:` — ONE revision round (`PAGE_COUNT_ROUND_BUDGET`),
 * then deliver. It never fails a render and never blocks delivery: a document that stays long is
 * still sent, the same as today. All it buys is one round in which the author is told, in the
 * renderer's own measured units, what to cut.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../bot/shared/services/llm-client', () => {
  const create = jest.fn();
  return {
    getClient: () => ({ chat: { completions: { create } } }),
    getClientForModel: (m) => ({ client: { chat: { completions: { create } } }, model: String(m || '') }),
    __create: create,
  };
});

const create = require('../../bot/shared/services/llm-client').__create;
const { authorLessonPlan } = require('../../bot/shared/services/lp612-author.service');
const CLEAN_DOC = require('./__fixtures__/v9_gate_base.lp.json');

const clone = (d) => JSON.parse(JSON.stringify(d));

const BOOK = { title: 'Biology 9', publisher: 'PCTB', subject: 'biology', grade: 9, medium: 'en', language: 'English', offset: 4 };
const TOC = { chapters: [{ number: 1, title: 'The Biological Method', printed_start: 9 }] };
const SEGMENT = {
  segment_id: 'seg-1', book_stem: 'grade_9_biology', grade: 9, subject: 'biology',
  medium: 'en', language: 'English', chapter_number: 1, chapter_title: 'The Biological Method',
  chapter_key: 'g9-bio-ch1', subtopic_title: 'Observation and hypothesis',
  menu_title: 'Observation & hypothesis', printed_page_start: 11, printed_page_end: 12,
  pages_covered: [11, 12], order_index: 3, lp_type: 'SCI-9-10', yt: null,
};

/** What the renderer now says about a plan that fits, but runs a page past what we aimed at. */
const TARGET = 'PAGE TARGET: teach runs to 4 pages; the soft target is 3 (hard cap 4). '
  + 'The 2 block(s) past the target are 410px of content, out of teach\'s 19 — '
  + 'that is what has to come out, and a BLOCK is the unit: shortening the prose inside a block '
  + 'removes no page. Tallest sections in teach: p1-C "Development" 6 blocks/880px. '
  + 'Cut whole blocks from the tallest, or move them to the other part. '
  + 'This is a TARGET, not the cap: the lesson renders and is delivered either way.';

const reply = (obj) => ({
  choices: [{ message: { content: typeof obj === 'string' ? obj : JSON.stringify(obj) } }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
});

let dir;
beforeEach(() => {
  jest.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-tgt-'));
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

const run = (renderCheck, extra = {}) => authorLessonPlan({
  segment: SEGMENT, lang: 'en', model: 'test/model', rounds: 5, renderCheck, correlationId: 'c', ...extra,
});

/** The user message of the Nth chat completion (0 = the author call, 1 = the first revision). */
const promptOf = (n) => create.mock.calls[n][0].messages.map((m) => m.content).join('\n');

describe('a soft page-target breach buys exactly one revision round', () => {
  test('the ladder revises once and stops, even though the target is never met', async () => {
    // The renderer says the same thing every time — this document never comes in under the
    // target. Without the page-count budget applying, the ladder would keep climbing until the
    // stale guard stopped it, four rounds and ~four minutes of a teacher's wait later.
    const renderCheck = jest.fn().mockResolvedValue([TARGET]);
    create.mockResolvedValue(reply(clone(CLEAN_DOC)));

    const out = await run(renderCheck);

    expect(out.rounds).toBe(1);
    expect(create).toHaveBeenCalledTimes(2); // the author call + exactly one revision
  });

  test('the advice reaches the model, in the renderer own words', async () => {
    const renderCheck = jest.fn().mockResolvedValue([TARGET]);
    create.mockResolvedValue(reply(clone(CLEAN_DOC)));

    await run(renderCheck);

    const p = promptOf(1);
    expect(p).toContain('PAGE TARGET:');
    expect(p).toContain('the soft target is 3');
    // And the page-count theory fires for it too: pages are spent on CARD COUNT, so the fix is
    // to remove whole items. Told only "it is too long", the model shortens sentences and moves
    // nothing — that was measured on the first render-gated run.
    expect(p).toMatch(/HOW TO FIX A PAGE-COUNT ERROR/);
  });

  test('a document that is only over the target is still deliverable', async () => {
    // THE WHOLE POINT. Over the HARD cap is a render failure; over the TARGET is not. If this
    // predicate ever says otherwise, a run that times out holding a perfectly good 7-page lesson
    // throws it away rather than sending it.
    const renderCheck = jest.fn().mockResolvedValue([TARGET]);
    create.mockResolvedValue(reply(clone(CLEAN_DOC)));

    const seen = [];
    await run(renderCheck, { onCandidate: (c) => seen.push(c) });

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((c) => c.deliverable)).toBe(true);
  });

  test('a plan already inside the target spends no round at all', async () => {
    const renderCheck = jest.fn().mockResolvedValue([]);
    create.mockResolvedValue(reply(clone(CLEAN_DOC)));

    const out = await run(renderCheck);

    expect(out.rounds).toBe(0);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
