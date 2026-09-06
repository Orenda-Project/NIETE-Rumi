/**
 * bd-owx8t — AN ADVISORY DEFECT MUST NOT BE AN INSTRUCTION.
 *
 * `BUDGET` was made advisory on 2026-09-03 (bd-wbvtb): it is excluded from `blockingCost`, so it
 * can no longer buy a revision round of its own. What that change did NOT touch is the revision
 * PROMPT. Every round that happens for some other reason still ships the model:
 *
 *   • the whole `gates.lint` list, BUDGET lines included; and
 *   • a preamble reading "Fix EVERY listed defect, including every word-budget line: when a
 *     budget says CUT N words, actually delete that much text from that section ... and
 *     OVERSHOOT the cut by about 10%".
 *
 * That instruction contradicts the page-count instruction sitting a few lines below it in the
 * same prompt — "pages are spent on CARD COUNT, not on word count ... Shortening sentences will
 * NOT remove a page" — and it is the one stated first, in the preamble, with an amplifier.
 *
 * MEASURED, 2026-09-04, over 62 real lp_docs (39 delivered off staging since the Urdu caps went
 * live, plus the n=24 study's own cells), replayed through the shipped lint:
 *
 *   • BUDGET fires on 59 of the 62 — 95%. It is a constant, not a signal.
 *   • Those 59 are the documents teachers actually received: 119 BUDGET lines against 8 lines
 *     from every other lint code combined.
 *   • Whole-document counts run 1,290-1,830 words against the 1,200 ceiling; the minimum
 *     overrun is 90 words and the median is 1,602.
 *   • Word count explains almost none of the paper: r = 0.375 against the renderer's own
 *     measured content height, r = 0.18 against printed pages.
 *
 * So on every revision round the model is told to delete real text — and 10% more than asked —
 * to satisfy a ceiling no document in this corpus has ever met, for a quantity that does not
 * decide the page count it is being revised for. The defect stays computed, returned and stored
 * (`lint_fails` on the row): it is honest drafting feedback and it costs nothing to record.
 * It just stops being an order.
 *
 * ROUND COST OF THIS CHANGE: zero. `BUDGET` is already outside `blockingCost`, so it has never
 * started or prevented a round. Only the content of rounds that were going to happen anyway
 * changes.
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

/** The fixture padded past its homework word budget: two BUDGET defects, nothing else. */
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-adv-'));
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

/** The user message of the Nth chat completion (0 = the author call, 1 = the first revision). */
const promptOf = (n) => {
  const msgs = create.mock.calls[n][0].messages;
  return msgs.map((m) => m.content).join('\n');
};

describe('the revision prompt carries only defects the model must act on', () => {
  test('a BUDGET line is not shown to the model on a revision round', async () => {
    // The round is bought by the page-cap defect, which is real. What must not ride along is
    // the word ceiling: this document is 152 words over one no document has ever cleared.
    const renderCheck = jest.fn()
      .mockResolvedValueOnce([OVERFLOW])
      .mockResolvedValue([]);
    create.mockResolvedValue(reply(budgetOnlyDoc()));

    const out = await run(renderCheck);

    expect(out.rounds).toBe(1);
    expect(create).toHaveBeenCalledTimes(2);
    // The defect is real and IS still reported on the row.
    expect(out.fails.some((f) => f.startsWith('BUDGET'))).toBe(true);
    // It is simply not in front of the model.
    expect(promptOf(1)).not.toMatch(/^BUDGET:/m);
    expect(promptOf(1)).not.toMatch(/BUDGET: /);
  });

  test('the preamble no longer orders a word cut, nor an overshoot of one', async () => {
    const renderCheck = jest.fn()
      .mockResolvedValueOnce([OVERFLOW])
      .mockResolvedValue([]);
    create.mockResolvedValue(reply(budgetOnlyDoc()));

    await run(renderCheck);

    const p = promptOf(1);
    expect(p).not.toMatch(/word-budget/i);
    expect(p).not.toMatch(/OVERSHOOT/i);
    expect(p).not.toMatch(/CUT N words/i);
  });

  test('the page-count instruction — the one that is true — is untouched', async () => {
    // The guard against over-correcting. Removing the word rule must not remove the card rule
    // that replaced it; that is the only instruction in the prompt that can actually free a page.
    const renderCheck = jest.fn()
      .mockResolvedValueOnce([OVERFLOW])
      .mockResolvedValue([]);
    create.mockResolvedValue(reply(budgetOnlyDoc()));

    await run(renderCheck);

    const p = promptOf(1);
    expect(p).toMatch(/pages are spent on CARD COUNT/);
    expect(p).toMatch(/REMOVE WHOLE ITEMS/);
    expect(p).toContain(OVERFLOW);
  });

  test('a BLOCKING lint defect is still shown — only advisory codes are withheld', async () => {
    // ONESCREEN gates delivery and is not advisory. Withhold that and the model cannot fix it.
    const short = clone(CLEAN_DOC);
    short.one_screen = 'too short';
    const renderCheck = jest.fn().mockResolvedValue([]);
    create.mockResolvedValue(reply(short));

    await run(renderCheck, 1);

    expect(create).toHaveBeenCalledTimes(2);
    expect(promptOf(1)).toMatch(/ONESCREEN: /);
  });
});
