/**
 * THE URDU TOGGLE HAS NEVER ONCE FIRED — bd-vnyuw.
 *
 * Measured on staging, 2026-09-05: of the nine EN-medium books ever requested in Urdu, the six
 * that reached `ready` ALL carry `overlay_dropped = true`. Not a sample — every one. The three
 * `false` rows are `failed` rows, where the column is never written.
 *
 * The cause is a contradiction between two prompts in the same call:
 *
 *   • the SYSTEM prompt (`brief_author_v3.md` §7b, §7c.7) says, of an English-medium book:
 *     "Then add an `ur_overlay` … overlay EVERY instruction string you are allowed to";
 *   • the USER prompt (`languageDirective`, injected per request) said the opposite:
 *     "the Urdu toggle is built by a separate pass over the finished document.
 *      Do NOT emit ur_overlay yourself."
 *
 * **That separate pass does not exist.** `git grep ur_overlay` over the whole repo finds only
 * readers — `applyOverlay`, `lint`, `visual_check`, and `sanitizeOverlay`, which can only DROP.
 * Nothing writes one. So `doc.ur_overlay` was always absent, `applyOverlay` always returned
 * `applied: []`, and the worker always set `overlay_dropped = true`. A teacher who chose «اردو»
 * received an English lesson in RTL chrome, silently, every single time.
 *
 * Three things are pinned here, and each was red on this branch's base:
 *   1. the per-request directive COMMANDS the overlay instead of forbidding it;
 *   2. `lint()` refuses an Urdu render of an EN-medium book that carries no usable overlay, so
 *      the revision ladder repairs it rather than the teacher discovering it (rule 24(c): a
 *      prompt's input contract is asserted in CODE, not trusted to the model);
 *   3. when it drops anyway, the row's telemetry says so with a distinct event, and the caption
 *      she reads names the actual state.
 */

const fs = require('fs');
const path = require('path');

const V = path.join(__dirname, '..', '..', 'bot', 'vendor', 'lp-v9');
const { lint, overlayDefects } = require(path.join(V, 'lint_lp.js'));
const { buildUserPrompt } = require('../../bot/shared/services/lp612-author.service');
const { UX_STRINGS } = require('../../bot/shared/config/ux-strings');

const BASE = path.join(__dirname, '__fixtures__', 'v9_gate_base.lp.json');
const raw = fs.readFileSync(BASE, 'utf8');

const doc = (mut = (d) => d) => mut(JSON.parse(raw));
const fails = (d, opts) => (lint(d, null, opts).fails || []).map(String);
const codes = (d, opts) => fails(d, opts).map((e) => e.split(/[\s:]/)[0]);

/** Every non-frozen instruction string in the fixture, so a test can build a full overlay. */
function fullOverlay(d) {
  const out = {};
  for (const ptr of overlayDefects.targets(d)) out[ptr] = 'اردو متن';
  return out;
}

// ── 1 · the per-request directive ───────────────────────────────────────────

describe('the LANGUAGE directive stops contradicting the brief', () => {
  const segment = {
    segment_id: 'grade_9_chemistry.c01.p007-008',
    book_stem: 'grade_9_chemistry',
    grade: 9,
    subject: 'Chemistry',
    language: 'en',
    period_minutes: 40,
  };
  const bundle = { book: { medium: 'en', title: 'Chemistry 9', grade: 9, offset: 0 }, pages: [] };
  const langSection = (lang, medium) => {
    const b = { ...bundle, book: { ...bundle.book, medium } };
    const p = buildUserPrompt({ segment: { ...segment, language: medium }, bundle: b, lang, video: null });
    return p.slice(p.indexOf('## LANGUAGE'), p.indexOf('lesson_id:'));
  };

  // bd-zle0u REVERSED THIS ONE, deliberately, and it is worth saying why here rather than only
  // in the new suite. bd-vnyuw's fix was right about the diagnosis and wrong about the layer:
  // telling the model to write the overlay INLINE made it re-emit the whole overlay on every
  // revision round (+~7k completion tokens each), and all three Urdu cells then blew the author
  // timeout and delivered nothing at all. The overlay now has its own pass over the ACCEPTED
  // document — the architecture the original directive falsely claimed already existed. What
  // makes the sentence true this time is code, not a promise: `stripOverlay` enforces it and
  // `overlayPass` performs it. Pinned in overlay-deferred.test.js.
  it('EN-medium book asked for in Urdu: the model is told to author ENGLISH and defer the overlay', () => {
    const s = langSection('ur', 'en');
    expect(s).toMatch(/ENGLISH/);
    expect(s).toMatch(/ur_overlay/);
    expect(s).toMatch(/separate/i);
  });

  it('and is pointed at the brief section that defines the overlay, not left to invent one', () => {
    expect(langSection('ur', 'en')).toMatch(/§?7b/);
  });

  it('UR-medium book still emits NO overlay — self-translation stays banned', () => {
    const s = langSection('ur', 'ur');
    expect(s).toMatch(/no ur_overlay|NO ur_overlay/i);
  });

  it('an English request against an English book says nothing about the overlay', () => {
    expect(langSection('en', 'en')).not.toMatch(/ur_overlay/);
  });
});

// ── 2 · the gate that makes the ladder repair it ────────────────────────────

describe('OVERLAY_MISSING — an Urdu render of an EN book must carry its toggle', () => {
  it('fires when the document has no ur_overlay at all', () => {
    expect(codes(doc(), { lang: 'ur' })).toContain('OVERLAY_MISSING');
  });

  it('says what is missing and how much of it', () => {
    const msg = fails(doc(), { lang: 'ur' }).find((e) => e.startsWith('OVERLAY_MISSING'));
    expect(msg).toMatch(/ur_overlay/);
    expect(msg).toMatch(/\d+/); // the count of strings it should have covered
  });

  it('still fires on a token overlay that leaves the lesson essentially English', () => {
    const d = doc((x) => { x.ur_overlay = { '/one_screen': 'خلاصہ' }; return x; });
    expect(codes(d, { lang: 'ur' })).toContain('OVERLAY_MISSING');
  });

  it('is SILENT once the overlay covers the instruction strings', () => {
    const d = doc();
    d.ur_overlay = fullOverlay(d);
    expect(codes(d, { lang: 'ur' })).not.toContain('OVERLAY_MISSING');
  });

  it('never fires on an English render — an English book asked for in English drops nothing', () => {
    expect(codes(doc(), { lang: 'en' })).not.toContain('OVERLAY_MISSING');
    expect(codes(doc(), {})).not.toContain('OVERLAY_MISSING');
  });

  it('never fires on an Urdu-MEDIUM book, which is authored in Urdu and needs no toggle', () => {
    const d = doc((x) => { x.provenance.medium = 'ur'; return x; });
    expect(codes(d, { lang: 'ur' })).not.toContain('OVERLAY_MISSING');
  });

  it('counts only pointers the overlay is ALLOWED to replace', () => {
    const t = overlayDefects.targets(doc());
    expect(t.length).toBeGreaterThan(0);
    expect(t).not.toContain('/slo/text_verbatim');
    expect(t.filter((p) => p.startsWith('/page2/exam_bank'))).toHaveLength(0);
  });

  it('every target it counts actually resolves to a string in the document', () => {
    const d = doc();
    const { pointerGet } = require(path.join(V, 'lib', 'overlay.js'));
    for (const ptr of overlayDefects.targets(d)) {
      expect(typeof pointerGet(d, ptr)).toBe('string');
    }
  });
});

// ── 3 · what she is told when it drops anyway ───────────────────────────────

describe('the honesty line names the actual state', () => {
  const S = UX_STRINGS.lp612OverlayDropped;

  it('does not claim the instructions are partly Urdu when they are entirely English', () => {
    expect(S.en).not.toMatch(/partly in Urdu/i);
    expect(S.ur).not.toMatch(/جزوی اردو/);
  });

  it('says, in both languages, that the lesson is complete and the instructions are English', () => {
    expect(S.en).toMatch(/English/);
    expect(S.ur).toMatch(/انگریزی/);
    expect(S.ur).toMatch(/[؀-ۿ]/);
  });

  it('promises no retry — the render is cached per (segment, lang), so asking again serves this same file', () => {
    expect(S.en).not.toMatch(/try again|ask again|resend|retry/i);
    expect(S.ur).not.toMatch(/دوبارہ/);
  });

  it('fits inside the WhatsApp caption budget in CODE POINTS, both languages', () => {
    // The line is APPENDED to lp612Caption, so the pair must fit 1024 together.
    const worst = [...UX_STRINGS.lp612Caption.ur].length + 1 + [...S.ur].length;
    expect(worst).toBeLessThan(1024);
    expect([...S.en].length).toBeLessThan(300);
    expect([...S.ur].length).toBeLessThan(300);
  });
});

// ── 4 · the other half of the same bug ──────────────────────────────────────
//
// AN URDU-MEDIUM BOOK WAS BEING TOLD IT WAS ENGLISH — bd-xrv72.
//
// `_book.json` and `niete_lp612_segments.medium` both store the human LABEL — `"Urdu"` /
// `"English"` — while `clampLanguage()` is a CODE clamp over `LANGUAGE_OFFER = ['ur','en']`
// and returns the `en` floor for anything it does not recognise. `clampLanguage("Urdu")` is
// therefore `"en"`, and `buildUserPrompt` opened a native Urdu book's prompt with, verbatim:
//
//     "The teacher asked for URDU. This is an English-medium book, so author the lp_doc in
//      ENGLISH…"
//
// …under an identity line that contradicted itself in place: `medium: ur (en)`.
//
// 306 of the 1,000 staging segments sampled are Urdu-medium and every one of them got that.
// The model usually overrides it, because the page-truth in front of it is visibly Urdu —
// d01 came back 77% Urdu, d02 73% — but it is a coin flip, and on d03
// (`grade_7_zari_taleem`, a PCTB Urdu book) it complied: an English lesson under Urdu
// headings, `provenance.medium: "en"`, and `overlay_dropped = FALSE`, because the worker
// reads the segment's own `language` column and that column was right. A clean-looking row
// on a wrong-language lesson — rule 24(a), a status field is a claim.
//
// Red-first: on this branch's base, `medium: 'Urdu'` produces the English-medium branch.

describe('the book medium is read as a language, not clamped away', () => {
  const segment = {
    segment_id: 'grade_7_zari_taleem.c01.p005-005',
    book_stem: 'grade_7_zari_taleem',
    grade: 7,
    subject: 'Agricultural Education (Zarai Taleem)',
    period_minutes: 40,
  };
  const promptFor = (bookMedium, bookLanguage, lang, segExtra = {}) => buildUserPrompt({
    segment: { ...segment, ...segExtra },
    bundle: {
      book: {
        medium: bookMedium, language: bookLanguage, title: 'زرعی تعلیم', grade: 7,
        subject: 'Zarai Taleem', offset: 4,
      },
      pages: [],
    },
    lang,
    video: null,
  });
  const langSection = (p) => p.slice(p.indexOf('## LANGUAGE'), p.indexOf('lesson_id:'));
  const identity = (p) => p.slice(p.indexOf('grade: '), p.indexOf('chapter:'));

  it('the exact shape that shipped — medium:"Urdu" — is NOT called an English-medium book', () => {
    const s = langSection(promptFor('Urdu', 'ur', 'ur'));
    expect(s).not.toMatch(/English-medium book/);
    expect(s).toMatch(/Urdu/);
  });

  it('and the identity line no longer contradicts itself in place', () => {
    // It printed `medium: ur (en)` — the raw value and the clamped one, disagreeing.
    expect(identity(promptFor('Urdu', 'ur', 'ur'))).not.toMatch(/\(en\)/);
    expect(identity(promptFor('Urdu', 'ur', 'ur'))).toMatch(/\(ur\)/);
  });

  it('an Urdu book asked for in ENGLISH still refuses to self-translate', () => {
    expect(langSection(promptFor('Urdu', 'ur', 'en'))).toMatch(/URDU-MEDIUM book/);
  });

  it('"English" as a label is still English — the map runs both ways', () => {
    const s = langSection(promptFor('English', 'en', 'ur'));
    expect(s).toMatch(/English-medium book/);
    expect(identity(promptFor('English', 'en', 'ur'))).toMatch(/\(en\)/);
  });

  it('an ISO code still works — this is a widening, not a replacement', () => {
    expect(langSection(promptFor('ur', 'ur', 'ur'))).not.toMatch(/English-medium book/);
    expect(langSection(promptFor('en', 'en', 'ur'))).toMatch(/English-medium book/);
  });

  it('falls back to the SEGMENT when the book record carries no medium at all', () => {
    const s = langSection(promptFor(null, null, 'ur', { medium: 'Urdu', language: 'ur' }));
    expect(s).not.toMatch(/English-medium book/);
  });

  it('an unrecognised label still floors to English rather than throwing', () => {
    expect(() => promptFor('Klingon', 'kl', 'ur')).not.toThrow();
    expect(langSection(promptFor('Klingon', 'kl', 'ur'))).toMatch(/English-medium book/);
  });
});

// ── 5 · an imperfect overlay must not destroy the lesson ────────────────────
//
// FOUND BY RUNNING THE FIX, NOT BY READING IT (bd-vnyuw, 2026-09-05).
//
// With the directive corrected the model does emit an overlay — 55 pointers, 90.5% Urdu, on
// the first authoring call for `grade_8_mathematics.c01.p006-009`. Eight of those 55 pointed
// at blocks that do not exist in the document it wrote:
//
//   ur_overlay: pointer targets nothing: /sections/1/blocks/2/legend
//   ur_overlay: pointer does not resolve: /sections/1/blocks/3/steps/0
//   …
//
// `applyOverlay` collects those as `errors`, and `renderDoc` **throws `OVERLAY_INVALID` and
// refuses the whole document** the moment `errors` is non-empty. So the fix for "she gets an
// English lesson" had, on its own, created "she gets NO lesson" — the exact failure class this
// lane exists to remove, and the same shape as the `SCHEMA INVALID … /ur_overlay must be
// object` incident that `sanitizeOverlay` was written for in the first place.
//
// A pointer that resolves to nothing replaces nothing. Dropping it cannot lose a single
// character; keeping it loses the lesson. That is a mechanically-decidable repair of a
// mechanically-decidable defect — `sanitizeOverlay`'s stated remit, and the same routing rule
// `parseYt` and `sanitizeUnknownTopLevel` follow. A FROZEN pointer is dropped for the same
// reason: `applyOverlay` reports it as an error too, so leaving it in is equally fatal.
//
// The signal is not lost. Every dropped pointer lowers the overlay's coverage, and
// `OVERLAY_MISSING` blocks below half and names the pointers still missing — so the ladder is
// told to write them properly instead of the teacher being told nothing.

describe('sanitizeOverlay drops a pointer that cannot be applied', () => {
  const { sanitizeOverlay } = require('../../bot/shared/services/lp612-author.service');
  const withOverlay = (ov) => { const d = doc(); d.ur_overlay = ov; return d; };
  const keys = (d) => Object.keys(sanitizeOverlay(d).ur_overlay || {});

  it('keeps a pointer that resolves to a real string', () => {
    const good = overlayDefects.targets(doc())[0];
    expect(keys(withOverlay({ [good]: 'اردو' }))).toEqual([good]);
  });

  it('drops the exact shapes the first live overlay emitted', () => {
    // These are three of the eight the live overlay wrote. `/sections/1/blocks/2/legend` and
    // `/sections/1/blocks/3/steps/0` are verbatim from that run; the shared fixture happens to
    // HAVE a `steps/0` at that path, so the third is the same shape against a section index the
    // fixture does not reach — the point is the resolution, not the string.
    const d = withOverlay({
      '/sections/1/blocks/2/legend': 'اردو',
      '/sections/1/blocks/3/steps/99': 'اردو',
      '/sections/99/blocks/0/text': 'اردو',
    });
    expect(keys(d)).toEqual([]);
    expect('ur_overlay' in sanitizeOverlay(d)).toBe(false);
  });

  it('keeps the good pointers and drops only the unusable ones', () => {
    const good = overlayDefects.targets(doc()).slice(0, 3);
    const d = withOverlay({
      ...Object.fromEntries(good.map((p) => [p, 'اردو'])),
      '/sections/1/blocks/2/legend': 'اردو',
    });
    expect(keys(d).sort()).toEqual(good.sort());
  });

  it('drops a FROZEN pointer — applyOverlay reports it as an error, which is equally fatal', () => {
    expect(keys(withOverlay({ '/slo/text_verbatim': 'اردو' }))).toEqual([]);
    const d = doc();
    const examBank = (d.page2.exam_bank || [])[0];
    if (examBank) {
      expect(keys(withOverlay({ '/page2/exam_bank/0/q': 'اردو' }))).toEqual([]);
    }
  });

  it('what survives sanitising can ALWAYS be applied — no OVERLAY_INVALID is reachable', () => {
    const { applyOverlay } = require(path.join(V, 'lib', 'overlay.js'));
    const targets = overlayDefects.targets(doc());
    const d = withOverlay({
      ...Object.fromEntries(targets.map((p) => [p, 'اردو'])),
      '/slo/text_verbatim': 'اردو',
      '/sections/1/blocks/2/legend': 'اردو',
      '/nope/nothing/here': 'اردو',
    });
    const clean = sanitizeOverlay(d);
    const { applied, errors } = applyOverlay(clean, 'ur');
    expect(errors).toEqual([]);
    expect(applied.length).toBe(Object.keys(clean.ur_overlay).length);
  });

  it('still drops a non-string value and a pointer that is not a pointer', () => {
    const good = overlayDefects.targets(doc())[0];
    expect(keys(withOverlay({ [good]: 'اردو', notAPointer: 'x', '/slo/text_verbatim': 5 })))
      .toEqual([good]);
  });
});
