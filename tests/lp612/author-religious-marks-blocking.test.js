/**
 * RELIGIOUS_MARKS IS THE ONE DEFECT THE NEVER-FAIL POLICY MAY NOT SHIP.
 *
 * Prod survey, 2026-09-14, the 70 `v9.6` rows on `niete_lp612_renders`: 69 carry lint fails and
 * every one of them was delivered. Five of those fails, on one lesson, are `RELIGIOUS_MARKS` —
 * including this one, verbatim off the row:
 *
 *   RELIGIOUS_MARKS: /page2/board_final/diagram/steps/1/lines/0 names the Prophet ("محمد") with
 *   no honorific after it: "سیّد ولی محمد". Write "محمد ﷺ" …
 *
 * A teacher at a federal teacher-training institute opened a religious-education lesson that
 * names the Prophet with no honorific. The linter caught it. The ladder ran out of rounds and
 * the worker sent it anyway, because `lint_clean` is RECORDED on the row and never CONSULTED.
 *
 * Every other defect the never-fail policy ships makes a lesson uglier — one page long, one
 * diagram small. This one makes it offensive. `lint_lp.js`'s own rule already says so in the
 * message it emits: *"no Islamiat or سیرت lesson is served on demand, and --auto-send must be
 * able to refuse it"* (brief §4c.1). Nothing in this lane could refuse it.
 *
 * So: the ladder spends its FULL budget on it — the stale guard and the page-count budget are
 * both early exits, and neither may abandon a document carrying this code — and if the defect
 * is still there when the rounds run out, the lesson is not delivered.
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

/**
 * The fixture with one bare mention of the Prophet added to a homework item. Verified against
 * `lint()` to produce EXACTLY two defects, both `RELIGIOUS_MARKS` — the missing honorific and
 * the missing `needs_human_review` the mention drags in with it — and no schema error, no render
 * defect and no other lint code. So a round it triggers can only have been triggered by this.
 */
function religiousDoc() {
  const d = clone(CLEAN_DOC);
  const hw = d.sections.find((s) => s.id === 'homework');
  hw.homework.items[0].text += ' سیرتِ محمد۔';
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

let dir;
beforeEach(() => {
  jest.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-religious-'));
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

describe('a lesson still naming the Prophet without an honorific is not delivered', () => {
  test('the ladder refuses the document rather than returning it', async () => {
    // The whole point. Today this resolves with `fails` carrying RELIGIOUS_MARKS and the worker
    // renders, uploads and sends it — which is exactly what reached a teacher on prod.
    const renderCheck = jest.fn().mockResolvedValue([]);
    create.mockResolvedValue(reply(religiousDoc()));

    await expect(run(renderCheck)).rejects.toMatchObject({ code: 'LP612_RELIGIOUS_MARKS' });
  });

  test('the refusal names the defect, so the operator can see what has to be re-authored', async () => {
    const renderCheck = jest.fn().mockResolvedValue([]);
    create.mockResolvedValue(reply(religiousDoc()));

    const err = await run(renderCheck).then(() => null, (e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(Array.isArray(err.fails)).toBe(true);
    expect(err.fails.some((f) => String(f).startsWith('RELIGIOUS_MARKS:'))).toBe(true);
  });

  test('the ladder spends EVERY round on it — the stale guard may not abandon this code', async () => {
    // `STALE_ROUNDS` is 4: a defect the revisions never shift stops the climb early, which is
    // right for a clipped diagram and wrong here. Four rounds of an unchanging RELIGIOUS_MARKS
    // is not a reason to stop trying; it is a reason to keep re-authoring until the budget is
    // genuinely gone. `rounds: 8` so the stale guard (4) and the budget (8) cannot be confused.
    const renderCheck = jest.fn().mockResolvedValue([]);
    create.mockResolvedValue(reply(religiousDoc()));

    const err = await run(renderCheck, 8).catch((e) => e);

    expect(err.rounds).toBe(8);
    expect(create).toHaveBeenCalledTimes(9);          // the author call + eight revisions
  });

  test('and it is never offered as the checkpoint the timeout path delivers', async () => {
    // The second door out of this lane, and refusing at the end does not close it. `onCandidate`
    // hands the worker the best document so far with `deliverable` on it (`lp612-author.worker.js`
    // keeps it as `bestSoFar`), so a run that is killed by its clock — or resumed after a SIGKILL —
    // sends that candidate WITHOUT ever reaching the return path. A document carrying this code
    // may not be marked deliverable at any point.
    //
    // THIS ONE ALREADY HOLDS and is pinned rather than fixed: `isDeliverable` ships a defect only
    // when it is advisory or a whole-document render finding, and a lint code is neither. It is
    // here because the refusal at the end of the ladder is worthless if this predicate is ever
    // widened — the delivery bar has been widened twice already (bd-vjk68, bd-oak77.14).
    const seen = [];
    const renderCheck = jest.fn().mockResolvedValue([]);
    create.mockResolvedValue(reply(religiousDoc()));

    await authorLessonPlan({
      segment: SEGMENT, lang: 'en', model: 'test/model', rounds: 5, renderCheck,
      correlationId: 'c', onCandidate: (c) => seen.push(c),
    }).catch(() => {});

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.some((c) => c.deliverable)).toBe(false);
  });

  test('a document with the honorific in place is delivered exactly as before', async () => {
    // The guard against over-correcting. The gate only fires on a document that actually carries
    // religious content, and a correctly-honorified mention is not a defect.
    const ok = clone(CLEAN_DOC);
    ok.sections.find((s) => s.id === 'homework').homework.items[0].text += ' سیرتِ محمد ﷺ۔';
    ok.needs_human_review = true;
    const renderCheck = jest.fn().mockResolvedValue([]);
    create.mockResolvedValue(reply(ok));

    const out = await run(renderCheck);

    expect(out.fails.some((f) => String(f).startsWith('RELIGIOUS_MARKS:'))).toBe(false);
    expect(out.rounds).toBe(0);
  });

  test('an ordinary lesson with no religious content is untouched', async () => {
    const renderCheck = jest.fn().mockResolvedValue([]);
    create.mockResolvedValue(reply(CLEAN_DOC));

    const out = await run(renderCheck);

    expect(out.lintClean).toBe(true);
    expect(out.rounds).toBe(0);
  });
});
