/**
 * bd-wbvtb — THE LADDER MUST STOP WHEN IT HAS STOPPED HELPING.
 *
 * Measured, n=24, 2026-09-03 (measurement_2026-09-03/MEASUREMENT.md §2 and §7):
 *
 *   • 23 of 24 lessons finished carrying a `BUDGET` defect.
 *   • 23 of 24 therefore burned ALL FIVE revision rounds. The one cell that stopped at 3 is
 *     the one cell with no BUDGET defect.
 *   • Every gate trajectory was FLAT from round 2 or 3 onward — e.g. c01 went
 *     6/6 → 6/5 → 5/5 → 5/5 → 5/5 → 5/5. Rounds 3, 4 and 5 changed nothing.
 *   • Cost of that: median 376s per lesson (19 of 24 over six minutes) and ~$0.35 a lesson,
 *     which is ~$3,900 of avoidable spend across 5,482 segments × 2 languages.
 *
 * TWO independent causes, and this suite covers both.
 *
 * (1) `BUDGET` is counted as if it gated delivery. It does not. The worker sends the PDF
 *     whenever the final render is inside both page caps; `lint_clean` is RECORDED on the row,
 *     never consulted. And the whole-document budget is not satisfiable in this lane anyway:
 *     across the study's 23 saved documents the word count runs 1,352-1,725 against a 1,200
 *     ceiling — the MINIMUM is 152 words over — and the repo's own v9 golden fixture
 *     (lp_v9/golden/PK_G9_BIO_CH1_BIOMETHOD_OBS_HYP_v9.lp.json) measures 1,380 and fails it
 *     too. So the ladder spends its whole budget on a defect no document in the corpus has
 *     ever cleared, while pushing the model to CUT WORDS when pages are spent on card count.
 *
 *     The ceiling itself is NOT changed here — the operator owns the budgets. What changes is
 *     that an unsatisfiable advisory defect no longer buys revision rounds.
 *
 * (2) Nothing detected a round that achieved nothing. Acceptance is `<=`, so a byte-identical
 *     candidate is accepted, the cost is unchanged, and the loop runs again — for as many
 *     rounds as it is given.
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

const clone = (d) => JSON.parse(JSON.stringify(d));

/**
 * The fixture with its homework padded past the section word budget. Verified to produce
 * EXACTLY two defects, both `BUDGET` (the section line and the whole-document line), and no
 * schema error, no render defect and no other lint code — so a round it triggers can only
 * have been triggered by BUDGET.
 */
function budgetOnlyDoc() {
  const d = clone(CLEAN_DOC);
  const hw = d.sections.find((s) => s.id === 'homework');
  hw.homework.items[0].text += ' ' + Array(120).fill('carefully').join(' ');
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-stop-'));
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

const run = (renderCheck, rounds = 5) => authorLessonPlan({
  segment: SEGMENT, lang: 'en', model: 'test/model', rounds, renderCheck, correlationId: 'c',
});

// ── (1) an advisory defect must not buy a revision round ────────────────────

describe('a non-blocking BUDGET defect does not spend rounds', () => {
  test('a document whose ONLY defects are BUDGET costs zero revision rounds', async () => {
    // This is the 23-of-24 case, reduced. The document renders inside both caps, so the
    // teacher gets it; the ladder must not spend five rounds and three minutes on a word
    // ceiling that does not gate delivery and that no document in the corpus has ever met.
    const renderCheck = jest.fn().mockResolvedValue([]);
    create.mockResolvedValue(reply(budgetOnlyDoc()));

    const out = await run(renderCheck);

    expect(out.rounds).toBe(0);
    expect(create).toHaveBeenCalledTimes(1);          // the author call, and nothing else
  });

  test('the BUDGET defect is still REPORTED, just not chased', async () => {
    // Not gating is not the same as not knowing. The defect stays on the returned row so the
    // corpus can still be measured for it, and `lintClean` stays honest.
    const renderCheck = jest.fn().mockResolvedValue([]);
    create.mockResolvedValue(reply(budgetOnlyDoc()));

    const out = await run(renderCheck);

    expect(out.fails.some((f) => f.startsWith('BUDGET'))).toBe(true);
    expect(out.lintClean).toBe(false);
  });

  test('once the BLOCKING defect clears, a lingering BUDGET does not keep the loop alive', async () => {
    // The exact measured shape: round 1 is over the page cap AND over budget; the revision
    // fixes the pages and leaves the budget where it was. That is a finished lesson, and the
    // study shows the four rounds after it change nothing.
    const renderCheck = jest.fn()
      .mockResolvedValueOnce([OVERFLOW])
      .mockResolvedValue([]);
    create.mockResolvedValue(reply(budgetOnlyDoc()));

    const out = await run(renderCheck);

    expect(out.rounds).toBe(1);
    expect(create).toHaveBeenCalledTimes(2);          // author + exactly one revision
  });

  test('a BLOCKING defect still spends its round — the ladder is not simply disabled', async () => {
    // The guard against over-correcting: a page-count defect must still be chased, because
    // that one really does decide whether a teacher gets a PDF.
    const renderCheck = jest.fn()
      .mockResolvedValueOnce([OVERFLOW])
      .mockResolvedValue([]);
    create.mockResolvedValue(reply(CLEAN_DOC));

    const out = await run(renderCheck);

    expect(out.rounds).toBe(1);
    expect(out.fails).toHaveLength(0);
  });
});

// ── (2) a round that achieves nothing must end the climb ────────────────────

describe('the ladder stops when a round stops making progress', () => {
  // A NON-page-count defect, so these two exercise the STALE guard rather than bd-vjk68's
  // one-round page-count budget. `OVERFLOW` above is (confusingly) a PAGE COUNT string; this is
  // the renderer's actual clipped-content finding, and it is not covered by the length policy.
  const CLIPPED = 'OVERFLOW on s2: content is 40px taller than the page. Offending: exam_bank (+40px)';

  test('an unfixable blocking defect does not burn every round', async () => {
    // c01's measured trajectory was 6/6 → 6/5 → 5/5 → 5/5 → 5/5 → 5/5: flat from round 3, and
    // rounds 3-5 were bought and thrown away. The ladder must stop short of the ceiling once
    // four consecutive rounds have improved nothing.
    const renderCheck = jest.fn().mockResolvedValue([CLIPPED]);
    create.mockResolvedValue(reply(CLEAN_DOC));

    const out = await run(renderCheck, 8);

    expect(out.rounds).toBe(4);
    expect(create).toHaveBeenCalledTimes(5);
  });

  test('a lesson whose progress is INVISIBLE to the defect list still gets its rounds', async () => {
    // Study cell c09, reduced, and the reason the stale threshold is 4 rather than 3. Its
    // defect list read "support needs 5 pages; the cap is 4" — ONE defect, never fewer — on the
    // opening gate and on the next three rounds, while the document really was shrinking
    // underneath (its teach part went 5 pages to 4). It came inside the cap on round 4.
    //
    // So the ladder has to tolerate THREE consecutive flat rounds and still take the fourth.
    // At a threshold of 3 it breaks at the top of round 4 and that lesson is lost — measured:
    // 11/24 delivered at 4, 10/24 at 3.
    //
    // WRITTEN WITH A CLIPPED-CONTENT DEFECT SINCE bd-vjk68, and the substitution is the whole
    // story of that bead. c09's real defect was a PAGE COUNT, and a page count no longer earns
    // four flat rounds: it earns one, and then the lesson is DELIVERED one page over cap
    // (`over_cap` on its row) instead of costing the teacher four more minutes for a 50%-then-18%
    // chance of losing a sheet. The stale threshold itself is unchanged, and this is the
    // behaviour it still governs for every defect that is a broken document rather than a long one.
    const renderCheck = jest.fn()
      .mockResolvedValueOnce([CLIPPED])   // the opening gate
      .mockResolvedValueOnce([CLIPPED])   // after round 1 — flat
      .mockResolvedValueOnce([CLIPPED])   // after round 2 — flat
      .mockResolvedValueOnce([CLIPPED])   // after round 3 — flat
      .mockResolvedValue([]);             // round 4 finally fits
    create.mockResolvedValue(reply(CLEAN_DOC));

    const out = await run(renderCheck, 5);

    expect(out.rounds).toBe(4);
    expect(out.fails).toHaveLength(0);     // the lesson is delivered, not abandoned
  });

  test('and the SAME trajectory, page-count only, now costs ONE round (bd-vjk68)', async () => {
    // The other side of the substitution above, stated rather than implied: the c09 shape with
    // its real defect. One round, then the draft is handed back over cap for the worker to
    // deliver — the operator's "stop delaying lesson plans because of the length issue".
    const renderCheck = jest.fn().mockResolvedValue([OVERFLOW]);
    create.mockResolvedValue(reply(CLEAN_DOC));

    const out = await run(renderCheck, 5);

    expect(out.rounds).toBe(1);
    expect(out.fails).toContain(OVERFLOW);
  });

  test('but a ladder that IS still improving keeps climbing', async () => {
    // Three defects, one cleared per round. Nothing here may be cut short: the stop condition
    // must key on PROGRESS, not on a fixed smaller round count.
    const three = ['PAGE COUNT: support needs 7 pages; the cap is 4.',
                   'PAGE COUNT: teach needs 7 pages; the cap is 5.',
                   'OVERFLOW on s2: content is 40px taller than the page.'];
    const renderCheck = jest.fn()
      .mockResolvedValueOnce(three)
      .mockResolvedValueOnce(three.slice(1))
      .mockResolvedValueOnce(three.slice(2))
      .mockResolvedValue([]);
    create.mockResolvedValue(reply(CLEAN_DOC));

    const out = await run(renderCheck, 5);

    expect(out.rounds).toBe(3);
    expect(out.fails).toHaveLength(0);
  });

  test('the returned document is still the best draft, never nothing', async () => {
    // Stopping early must not change what is served. The renderer rejects it downstream and
    // the teacher gets the designed apology — that path is unchanged.
    const renderCheck = jest.fn().mockResolvedValue([OVERFLOW]);
    create.mockResolvedValue(reply(CLEAN_DOC));

    const out = await run(renderCheck, 5);

    expect(out.lpDoc).toBeTruthy();
    expect(out.fails).toContain(OVERFLOW);
  });
});
