/**
 * bd-vjk68 — THE PAGE CAP STOPS BEING A WAY TO LOSE A LESSON.
 *
 * Operator, 2026-09-04, verbatim: *"your recommendation accepted -- but please make sure author
 * is also aware of page/word budget etc, its weird that it only finds out later -- we will stop
 * cancelling or delaying lesson plans now because of the length issue"*.
 *
 * Three changes, all covered here.
 *
 * 1 · THE CAPS GO UP BY ONE SHEET PER LANGUAGE. EN teach 5 -> 6 (support stays 4); UR support
 *     5 -> 6 (teach stays 7). Computed on the 9 live page-cap failures since the Urdu caps
 *     went live: hold = 0 rescued, EN teach 5->6 = 4, EN teach 6 + UR support 6 = **7 of 9**
 *     (HANDOFF_feat080_2026-09-04.md §3.1).
 *
 * 2 · PAGE-COUNT OVERFLOW IS NEVER A DELIVERY FAILURE, AND NEVER BUYS MORE THAN ONE ROUND.
 *     Each revision round costs ~60s (latency_breakdown_2026-09-04/BREAKDOWN.md: authoring is
 *     (1 + rounds) x ~60s, and 99.0% of it is time inside LLM calls, because every round
 *     re-emits the WHOLE ~7,900-token document). Revision #1 fixes a page count 92% of the
 *     time, #2 50%, #3 18% — so rounds 3-5 spend three minutes buying a coin-flip that is
 *     already losing. When the only thing left is length, the lesson ships at whatever length
 *     it is.
 *
 * 3 · THE AUTHOR IS TOLD ITS BUDGET UP FRONT. §8 of the brief does carry the caps, at line ~890
 *     of a 70KB system prompt. The budget card is at the TOP of the user turn on round 0 and
 *     the first thing in every revision prompt, in the units the model can actually count.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// ── 1 · the caps themselves ─────────────────────────────────────────────────

describe('the page caps', () => {
  const R = require('../../bot/vendor/lp-v9/render_lp.js');

  test('English gets a sixth TEACH page; SUPPORT is unchanged at 4', () => {
    expect(R.pageCapsFor('en').max).toEqual({ teach: 6, support: 4 });
  });

  test('Urdu gets a sixth SUPPORT page; TEACH is unchanged at 7', () => {
    expect(R.pageCapsFor('ur').max).toEqual({ teach: 7, support: 6 });
  });

  test('each WARN still sits exactly one page under its own cap', () => {
    // The invariant the constants' own comment states ("warns one page under each cap exactly
    // as English warns"). A cap raised without its warn leaves the soft target firing two pages
    // early and every delivered lesson carrying a meaningless warning.
    for (const lang of ['en', 'ur']) {
      const { max, warn } = R.pageCapsFor(lang);
      expect(warn).toEqual({ teach: max.teach - 1, support: max.support - 1 });
    }
  });
});

// ── 2 · the ladder, and the budget card in the prompts ──────────────────────

describe('the ladder and the prompts', () => {
  jest.mock('../../bot/shared/services/llm-client', () => {
    const create = jest.fn();
    return { getClient: () => ({ chat: { completions: { create } } }), __create: create };
  });

  const create = require('../../bot/shared/services/llm-client').__create;
  const Author = require('../../bot/shared/services/lp612-author.service');
  const CLEAN_DOC = require('./__fixtures__/v9_gate_base.lp.json');

  const BOOK = {
    title: 'Biology 9', publisher: 'PCTB', subject: 'biology', grade: 9,
    medium: 'en', language: 'English', offset: 4,
  };
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

  // The renderer's own string, verbatim — the policy must key on what the renderer emits, not
  // on a paraphrase a future edit could silently drift away from.
  const PAGES = 'PAGE COUNT: teach needs 7 pages; the cap is 6. Cut it, or move content to the other part.';
  const PAGES_2 = 'PAGE COUNT: support needs 5 pages; the cap is 4. Cut it, or move content to the other part.';
  const NOT_PAGES = 'OVERFLOW on s2: content is 40px taller than the page. Offending: exam_bank (+40px)';

  let dir;
  beforeEach(() => {
    jest.clearAllMocks();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-cap-'));
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

  const run = (renderCheck, rounds = 5) => Author.authorLessonPlan({
    segment: SEGMENT, lang: 'en', model: 'test/model', rounds, renderCheck, correlationId: 'c',
  });

  test('a page-count-only defect set spends exactly ONE revision round, then delivers', async () => {
    // The measured population. 6 of the 9 live failures were the identical "teach needs 6; the
    // cap is 5" and nothing else. Under the old ladder that document bought FIVE rounds
    // (~5 minutes) and was then thrown away. It now buys one and ships.
    const renderCheck = jest.fn().mockResolvedValue([PAGES]);
    create.mockResolvedValue(reply(CLEAN_DOC));

    const out = await run(renderCheck, 5);

    expect(out.rounds).toBe(1);
    expect(create).toHaveBeenCalledTimes(2);        // the author call + exactly one revision
    expect(out.lpDoc).toBeTruthy();                 // and the draft is returned, never dropped
  });

  test('TWO page-count defects are still page-count-only — the rule is on the CODE, not the count', async () => {
    // Both parts over cap at once is the same failure class and must not buy two budgets.
    const renderCheck = jest.fn().mockResolvedValue([PAGES, PAGES_2]);
    create.mockResolvedValue(reply(CLEAN_DOC));

    const out = await run(renderCheck, 5);

    expect(out.rounds).toBe(1);
  });

  test('a NON page-count blocking defect still spends the ladder — this is length-only policy', async () => {
    // The guard against over-correcting. An OVERFLOW (content clipped off the bottom of a page)
    // is a defect a teacher meets on paper and it keeps today's behaviour exactly: the stale
    // guard stops it at 4, not the page-count budget at 1.
    const renderCheck = jest.fn().mockResolvedValue([PAGES, NOT_PAGES]);
    create.mockResolvedValue(reply(CLEAN_DOC));

    const out = await run(renderCheck, 8);

    expect(out.rounds).toBe(4);
  });

  test('a page-count set that clears inside its one round is not cut short of a LATER defect', async () => {
    // Round 1 fixes the pages and reveals a type-floor defect underneath. The page budget is
    // spent, but the ladder is not: the new defect is blocking and is chased normally.
    const renderCheck = jest.fn()
      .mockResolvedValueOnce([PAGES])
      .mockResolvedValueOnce(['TYPE FLOOR: smallest body text is 17px (<18px) — "Observe"'])
      .mockResolvedValue([]);
    create.mockResolvedValue(reply(CLEAN_DOC));

    const out = await run(renderCheck, 5);

    expect(out.rounds).toBe(2);
    expect(out.fails).toHaveLength(0);
  });

  test('the round-0 user turn OPENS with the budget card, in the caps for this language', async () => {
    // The operator's actual complaint: "its weird that it only finds out later". §8 of a 70KB
    // system prompt is not "up front"; the first line of the turn is.
    const renderCheck = jest.fn().mockResolvedValue([]);
    create.mockResolvedValue(reply(CLEAN_DOC));

    await run(renderCheck);

    const user = create.mock.calls[0][0].messages.find((m) => m.role === 'user').content;
    expect(user.slice(0, 400)).toMatch(/YOUR PAGE BUDGET/);
    expect(user).toMatch(/TEACH .{0,4}6 pages/);
    expect(user).toMatch(/SUPPORT .{0,4}4 pages/);
    // It must say the two honest things, or it reads as a gate and the model cuts real content.
    expect(user).toMatch(/measured after/i);
    expect(user).toMatch(/still delivered/i);
  });

  test('the Urdu card carries the URDU caps, not English ones', async () => {
    const renderCheck = jest.fn().mockResolvedValue([]);
    create.mockResolvedValue(reply(CLEAN_DOC));

    await Author.authorLessonPlan({
      segment: SEGMENT, lang: 'ur', model: 'test/model', rounds: 1, renderCheck, correlationId: 'c',
    });

    const user = create.mock.calls[0][0].messages.find((m) => m.role === 'user').content;
    expect(user).toMatch(/TEACH .{0,4}7 pages/);
    expect(user).toMatch(/SUPPORT .{0,4}6 pages/);
  });

  test('every revision prompt opens with the same card, ABOVE the defect lists', async () => {
    const prompt = Author.buildRevisionPrompt({
      doc: CLEAN_DOC,
      gates: { schema: [], lint: [], render: [PAGES], warns: [] },
      originalUser: 'ORIGINAL TASK',
      notes: null,
    });
    expect(prompt.indexOf('YOUR PAGE BUDGET')).toBeGreaterThanOrEqual(0);
    expect(prompt.indexOf('YOUR PAGE BUDGET')).toBeLessThan(prompt.indexOf('PAGE / LAYOUT ERRORS'));
    expect(prompt.indexOf('YOUR PAGE BUDGET')).toBeLessThan(prompt.indexOf('=== PREVIOUS lp_doc ==='));
  });
});
