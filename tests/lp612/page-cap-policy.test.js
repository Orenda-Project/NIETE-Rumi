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

  // Lowered on 2026-09-11 (bd-g6sww, closing bd-q29w9). Operator: LPs shipping at 11-16 pages are
  // "unreadable" — the v9.2-type-scale ceiling (7/6 EN, 9/7 UR) still let a lesson reach that
  // range. The ceiling is a universal, subject-agnostic hard cap (any subject-specific tightening
  // is a word-budget lever in lint_lp.js, not this constant). UR keeps its premium over EN — Nastaliq
  // leads by ~+33% page cost on the same document (see bidi-caps.test.js, type-scale.test.js) — so
  // UR = round(EN x 1.33): teach 4x1.33=5.32->5, support 3x1.33=3.99->4.
  test('English is teach 4 / support 3, the new unreadable-length ceiling', () => {
    expect(R.pageCapsFor('en').max).toEqual({ teach: 4, support: 3 });
  });

  test('Urdu is teach 5 / support 4, EN x ~1.33 for the Nastaliq premium', () => {
    expect(R.pageCapsFor('ur').max).toEqual({ teach: 5, support: 4 });
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

// ── 1b · the same budget on a different sheet (bd-vbs5w) ─────────────────

/**
 * A CAP IS A CONTENT BUDGET WRITTEN IN SHEETS, AND ONLY ONE SHEET WAS EVER MEASURED.
 *
 * Every number above was tuned against the 520x2000 phone page, whose content box is 1986px,
 * because until the format became selectable (SYNC §3.14) that was the only page there was.
 * A4's box is 1109px — 56% of it — so the same plan needs ~1.79x the sheets to say the same
 * thing. English_seg6, green at `teach 8/9` on the phone, reported *"teach needs 14 pages; the
 * cap is 9"* at `--format a4` with nothing else changed: not a lesson over budget, a budget
 * quoted in the wrong unit.
 *
 * Amena asked for both renders of every primary plan — *"Both — A4 to review, phone to
 * deliver"* — so a cap only one of them can meet makes the review copy unrenderable.
 *
 * These pin the CONVERSION, not any one number: the phone caps come back untouched (bd-rjt3x's
 * "do not raise the cap" still binds the sheet a teacher receives), A4's are the same budget
 * read off A4's own geometry, and G6-12 does not move on either sheet.
 */
describe('the caps convert between page formats', () => {
  const R = require('../../bot/vendor/lp-v9/render_lp.js');
  const { PAGE_FORMATS } = require('../../bot/vendor/lp-v9/lib/template.js');

  const primary = { provenance: { grade: 4 } };
  const secondary = { provenance: { grade: 9 } };
  // The content box, read the way the layout derives it (template.js: PAGE_CONTENT_H).
  const box = (f) => PAGE_FORMATS[f].h - PAGE_FORMATS[f].padT - PAGE_FORMATS[f].padB;

  test('phone is the sheet the numbers were measured on, and comes back untouched', () => {
    expect(R.pageCapsFor('en', primary, 'phone').max).toEqual({ teach: 9, support: 3 });
    expect(R.pageCapsFor('en', primary).max).toEqual({ teach: 9, support: 3 });
    expect(R.pageCapsFor('ur', primary, 'phone').max).toEqual({ teach: 12, support: 4 });
  });

  test('A4 carries the SAME budget, converted by what an A4 sheet holds', () => {
    const ratio = box('phone') / box('a4');
    const a4 = R.pageCapsFor('en', primary, 'a4').max;
    // Derived, never restated: a literal would keep passing if the page box moved under it.
    expect(a4).toEqual({ teach: Math.round(9 * ratio), support: Math.round(3 * ratio) });
    expect(a4.teach).toBeGreaterThan(14);   // the measured A4 cost of a phone-green 8-page plan
  });

  test('an unknown format falls back to the measured sheet rather than inventing a cap', () => {
    expect(R.pageCapsFor('en', primary, 'billboard').max).toEqual({ teach: 9, support: 3 });
  });

  test('WARN is the operator\'s target on every sheet, never the cap minus one', () => {
    // Superseded by bd-788pe. WARN used to be derived from MAX because both said the same thing
    // -- "you are nearly out of room". For primary they now say different things (see 1c), so a
    // scaled MAX may not overwrite an authored WARN.
    for (const lang of ['en', 'ur']) {
      for (const format of ['phone', 'a4']) {
        const { max, warn } = R.pageCapsFor(lang, primary, format);
        expect(warn.teach).toBeLessThan(max.teach - 1);
        expect(warn.support).toBeLessThanOrEqual(max.support - 1);
      }
    }
  });

  test('G6-12 keeps its field-tuned caps on both sheets', () => {
    // The same physics would take teach 4 -> 7 on A4. That is a real question and it is the
    // operator's, not a side effect of a G1-5 page-1 change: these caps gate the format G6-12
    // plans are actually delivered in.
    for (const format of ['phone', 'a4']) {
      expect(R.pageCapsFor('en', secondary, format).max).toEqual({ teach: 4, support: 3 });
      expect(R.pageCapsFor('ur', secondary, format).max).toEqual({ teach: 5, support: 4 });
    }
  });
});

// ── 1c · the page TARGET the operator asked for (bd-788pe) ────────────────

/**
 * A CAP AND A TARGET ARE NOT THE SAME NUMBER, AND PRIMARY NOW NEEDS BOTH.
 *
 * Operator, 2026-09-18: *"I would like to keep 5 as the cap, once the content is sorted, we can
 * come to that page number, no?"*, then, asked which unit: *"keep the max at 9, but ideally 4-5
 * pages on phone-first"*.
 *
 * Both halves are load-bearing. Over cap FAILS -- the renderer never trims -- so a MAX of 5 today
 * would make every primary lesson render nothing at all, which is the one outcome that helps no
 * teacher. MAX therefore stays at the 9 she set when she took "one continuous plan". The 4-5 is
 * where the document is going once the seven "design pending" surfaces carry real content, and
 * the renderer's job until then is to say loudly, on every render, how far off it is.
 *
 * So WARN becomes the target: teach 4 + support 1 = the 5 pages she named, in PHONE units,
 * because "phone-first" is her own word and the phone is the sheet a teacher receives. The flip
 * to a hard gate, when the content lands, is one constant.
 */
describe('the primary page target', () => {
  const R = require('../../bot/vendor/lp-v9/render_lp.js');
  const { PAGE_FORMATS } = require('../../bot/vendor/lp-v9/lib/template.js');

  const primary = { provenance: { grade: 4 } };
  const box = (f) => PAGE_FORMATS[f].h - PAGE_FORMATS[f].padT - PAGE_FORMATS[f].padB;
  const ratio = box('phone') / box('a4');

  test('the phone target is 4 teach + 1 support -- the 5 pages she asked for', () => {
    expect(R.pageCapsFor('en', primary, 'phone').warn).toEqual({ teach: 4, support: 1 });
  });

  test('Urdu carries the same target with the Nastaliq premium', () => {
    // round(4 x 1.33) = 5, the same premium every other UR primary constant carries.
    expect(R.pageCapsFor('ur', primary, 'phone').warn).toEqual({ teach: 5, support: 1 });
  });

  test('MAX does not move, because over cap FAILS and never trims', () => {
    expect(R.pageCapsFor('en', primary, 'phone').max).toEqual({ teach: 9, support: 3 });
    expect(R.pageCapsFor('ur', primary, 'phone').max).toEqual({ teach: 12, support: 4 });
  });

  test('the target converts to A4 on the same geometry the cap does', () => {
    // A target quoted in phone sheets and read on A4 is the exact defect bd-vbs5w fixed for the
    // cap. Derived, never restated, so it follows the page box if the box moves.
    const warn = R.pageCapsFor('en', primary, 'a4').warn;
    expect(warn).toEqual({ teach: Math.round(4 * ratio), support: Math.round(1 * ratio) });
  });

  test('the target fires on the lesson we have today, or it is decoration', () => {
    // The reference plan (G4 English Ch.9 seg 6) measures teach 8 on the phone and 12 on A4 with
    // every surface still to fill. A target that does not fire on THAT is not a target.
    expect(R.pageCapsFor('en', primary, 'phone').warn.teach).toBeLessThan(8);
    expect(R.pageCapsFor('en', primary, 'a4').warn.teach).toBeLessThan(12);
  });

  test('the target never overtakes the cap it sits under', () => {
    for (const lang of ['en', 'ur']) {
      for (const format of ['phone', 'a4']) {
        const { max, warn } = R.pageCapsFor(lang, primary, format);
        expect(warn.teach).toBeLessThanOrEqual(max.teach);
        expect(warn.support).toBeLessThanOrEqual(max.support);
      }
    }
  });

  test('G6-12 keeps warn one sheet under cap -- the target is a primary decision', () => {
    const secondary = { provenance: { grade: 9 } };
    for (const format of ['phone', 'a4']) {
      const { max, warn } = R.pageCapsFor('en', secondary, format);
      expect(warn).toEqual({ teach: max.teach - 1, support: max.support - 1 });
    }
  });
});

// ── 2 · the ladder, and the budget card in the prompts ──────────────────────

describe('the ladder and the prompts', () => {
  jest.mock('../../bot/shared/services/llm-client', () => {
    const create = jest.fn();
    return { getClient: () => ({ chat: { completions: { create } } }),
    // bd-oak77.29: the author service resolves its client PER MODEL now, so the mock has to
    // state that half of llm-client's contract too. Same `create` spy either way — these
    // suites assert on the payload, not on which provider it went to.
    getClientForModel: (m) => ({ client: { chat: { completions: { create } } }, model: String(m || '') }),
    __create: create };
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
    // Read from the constants, never restated: the point of this assertion is that the card the
    // author is handed CARRIES THE LIVE CAPS, and a literal here would keep passing while the two
    // silently diverged — which is the exact defect it exists to catch.
    const EN = require('../../bot/vendor/lp-v9/render_lp.js').pageCapsFor('en').max;
    expect(user).toMatch(new RegExp(`TEACH .{0,4}${EN.teach} pages`));
    expect(user).toMatch(new RegExp(`SUPPORT .{0,4}${EN.support} pages`));
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
    const UR = require('../../bot/vendor/lp-v9/render_lp.js').pageCapsFor('ur').max;
    expect(user).toMatch(new RegExp(`TEACH .{0,4}${UR.teach} pages`));
    expect(user).toMatch(new RegExp(`SUPPORT .{0,4}${UR.support} pages`));
  });

  test('the card AIMS at the soft target, and names the cap only as the cap — bd-a8veu.22', async () => {
    // The other half of "why are all of them 7 pages?". The card stated the HARD caps as the aim
    // (`pageCapsFor(lang).max`) and then said "completeness beats page count", so the author
    // opened every lesson aiming at 4 + 3 = the exact 7 pages four sandbox renders came out at on
    // 2026-09-12. The renderer has always carried a soft target one page under each cap; the
    // author was never given it. Read from the constants, never restated — a literal here would
    // keep passing while the card and the renderer silently diverged.
    const renderCheck = jest.fn().mockResolvedValue([]);
    create.mockResolvedValue(reply(CLEAN_DOC));

    await run(renderCheck);

    const user = create.mock.calls[0][0].messages.find((m) => m.role === 'user').content;
    const EN = require('../../bot/vendor/lp-v9/render_lp.js').pageCapsFor('en');
    expect(user).toMatch(/AIM FOR/);
    expect(user).toMatch(new RegExp(`TEACH .{0,4}${EN.warn.teach} pages`));
    expect(user).toMatch(new RegExp(`SUPPORT .{0,4}${EN.warn.support} pages`));
    // The cap is still stated — it is a real failure boundary — but as the boundary, not the aim.
    expect(user).toMatch(new RegExp(`TEACH .{0,4}${EN.max.teach} pages`));
    // And the sentence that told the author length does not matter is gone. It has to keep
    // protecting the required properties (below), but not by denying the budget above it.
    expect(user).not.toMatch(/completeness beats page count/);
    expect(user).toMatch(/cutting a required property/i);
  });

  test('the Urdu card aims at the URDU soft target', async () => {
    const renderCheck = jest.fn().mockResolvedValue([]);
    create.mockResolvedValue(reply(CLEAN_DOC));

    await Author.authorLessonPlan({
      segment: SEGMENT, lang: 'ur', model: 'test/model', rounds: 1, renderCheck, correlationId: 'c',
    });

    const user = create.mock.calls[0][0].messages.find((m) => m.role === 'user').content;
    const UR = require('../../bot/vendor/lp-v9/render_lp.js').pageCapsFor('ur');
    expect(user).toMatch(new RegExp(`TEACH .{0,4}${UR.warn.teach} pages`));
    expect(user).toMatch(new RegExp(`SUPPORT .{0,4}${UR.warn.support} pages`));
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
