#!/usr/bin/env node
// render_lp.js — lp_doc JSON -> self-contained HTML -> two-page A4 PDF (+ PNGs).
//
//   node render_lp.js <lp_doc.json> [--out DIR] [--stem NAME] [--lang en|ur] [--png] [--no-pdf]
//
// Non-negotiables this script enforces (it exits non-zero if any fails):
//   • at most 2 TEACH pages and 2 SUPPORT pages, each part starting on a fresh page;
//   • NOTHING is silently clipped. Overflow is measured in the browser and reported
//     with the offending section id. A clipped LP is a lesson a teacher loses the
//     end of, and the end is the part that already gets cut (MDPI 16:5:699);
//   • fonts are loaded BEFORE the print pass (`await document.fonts.ready`) —
//     the Urdu "tofu"/overlap defects were font-load races, not missing glyphs;
//   • KaTeX + mhchem are rendered server-side; the page ships no client JS.
//
// Chrome comes from playwright-core (the main bot's copy, read-only) when it is
// available, else from `Google Chrome --headless --print-to-pdf`.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { buildHtml, scaledPx, PAGE, PAGE_FORMATS, isPrimary } = require("./lib/template");
const { applyOverlay } = require("./lib/overlay");
const { validateDoc } = require("./lib/validate");
const { REPO_ROOT } = require("./lib/fonts");
const { setInfo } = require("./lib/pdfmeta");
const { exemptionFor } = require("./lib/page_cap_exemptions");

// THE PAGE BOX LIVES IN lib/template.js AND IS IMPORTED, NEVER RE-DECLARED (v9.3, bd-oak77.16).
// v9.2 carried `const A4 = { w: 794, h: 1123 }` here AND `--page-w:794px` there — two homes for
// one number, which is exactly how a document gets laid out at one size and printed at another.
// v9.3's page is 520 x 2000: phone-first, because an A4 page fit to a 390-px screen delivers its
// 21px body at 67% of the arm's-length reading floor and the type has nowhere left to go. The
// measurement, the two-corpus page count and the printing trade-off are in
// prod_golive_2026-09-06/15_phone_page/DESIGN.md.
// Operator decision 2026-08-30 (floor raised to 18px on 2026-09-01): the body floor is the
// hard constraint, so the page
// cap gives instead. Each part starts on a fresh page.
//
// Revised after the 8-sample run (2026-08-30): COMPLETENESS BEATS PAGE COUNT. Holding TEACH
// to 2 pages cost the G7 sample its key_points AND its keywords, and the G10 Urdu sample its
// We-Do beat — the plan fitted, and taught less.
//
// Revised again after the 11-sample run (2026-08-31, operator: "prioritize completeness"):
// 6 of 11 real 6-12 plans packed past 3 teach pages and 2 of them past 2 support pages —
// a Grade 10 determinants lesson and a سیرت close-reading do not fit a science one-pager.
// TEACH may reach 4 and SUPPORT 3. The last page before each cap WARNS, so nobody drifts
// there by accident; over the cap FAILS LOUD. Over-cap is never trimmed — see the PDF note
// below: a plan that is too long is one we cut deliberately, not one Chrome eats.
//
// Revised again 2026-09-01, when the operator raised the body floor to 18px: "make it larger,
// and keep enough spacing that it doesn't get airtight". A deliberate font increase is NOT
// bloat, so the CAP gives, not the content — see the measured numbers in lint_lp.js. Over the
// cap is still a loud FAIL; the cap's job is to catch padding, and it still does.
//
// Revised again 2026-09-04 (bd-vjk68, operator: "we will stop cancelling or delaying lesson
// plans now because of the length issue"). TEACH 5 -> 6; SUPPORT unchanged at 4.
//
// MEASURED, not chosen. Every other lever against the page-overflow failure class was priced
// and eliminated first: card-count ceilings (best separating cut anywhere catches 2 over-cap
// parts and blocks 33 good ones), an exact-DP page packer (582 -> 582 pages over 62 documents,
// 0 repaginated), the word budget (r = 0.18 against printed pages), the model (sonnet is the
// faster one), the furniture trim (0 pages on its own), and rounds 5 -> 3 (loses 15% of
// deliveries). What was left was the cap itself. On the 9 live page-cap failures of 2026-09-04,
// EN teach 5->6 rescues 4 and EN teach 6 + UR support 6 rescues 7 — one sheet per language.
//
// AND THE OVER-CAP PARTS ARE NOT PADDED. Each carries 89-96% of its own cap's paper AS CONTENT
// (page_cap_decision_2026-09-04/card_ceilings/FINDING.md §4), so this is not room for bloat; it
// is the sheet the content already needed. The "cap as target" worry (23 of 27 EN lessons print
// at exactly the cap) is the LADDER trimming down to fit, not the author padding up — the author
// never sees a page count on round 0. Whether the distribution refills to the new cap is the
// open question, and it is now measurable: `over_cap` on niete_lp612_renders and the
// `lp612.deliver.over_cap` event carry the pages and the caps they were measured against.
//
// Revised again 2026-09-06 (07_font, operator: "increase the font ... it's very small, and
// it's very hard to read"). The body went 18px -> 21px and every other size with it — 21 being
// the number `bot/shared/templates/niete-brand.js` already declares as THE type floor for every
// teacher-facing artefact — which costs about a third more paper over the 62-document corpus. The caps
// move WITH the type for the reason the 2026-09-01 note already gives — a deliberate font
// increase is not bloat — and by how much is measured, not chosen: at the new type the OLD caps
// flag 53 of 62 documents, which is not a gate, it is noise. EN teach 6->7 / support 4->6 and
// UR teach 7->9 / support 6->7 is the TIGHTEST candidate that holds the flag rate at 2/62,
// against 1/62 at the old type. Numbers and the arm-by-arm table: 07_font/OPTIONS.md.
//
// LOWERED 2026-09-11 (bd-g6sww, closing bd-q29w9). Operator: LPs shipping at 11-16 pages are
// "unreadable" — the v9.2-type-scale ceiling above (7/6) still let a lesson reach that range. This
// is a universal, subject-agnostic hard ceiling; any subject-specific tightening belongs in the
// word budgets in lint_lp.js, not here. EN teach 7->4 / support 6->3.
const MAX_PAGES = { teach: 4, support: 3 };     // above this: FAIL
const WARN_PAGES = { teach: 3, support: 2 };    // above this: WARN, and keep going

// PAGE CAPS ARE LANGUAGE-AWARE; WORD BUDGETS ARE NOT (operator, 2026-09-03).
//
// The SAME document rendered in both languages measured en=9pp / ur=12pp — a
// controlled ~+33% footprint, because Nastaliq's tall marks and descenders need
// line-height ~2.05 against Latin's 1.55, so an Urdu page carries roughly 2/3
// the lines of an English one at the same floor. Under the English caps every
// Urdu render of a full English-cap plan failed PAGE COUNT while carrying
// IDENTICAL content — the staging field score the day this was measured was
// EN 2/3 ready vs UR 0/4, every Urdu failure a PAGE COUNT.
//
// The operator's call, verbatim: "keep the same word limit (though pages can be
// a bit more to allow for decent urdu spacing)". So the word budgets in
// lint_lp.js stay one set of numbers for both languages — an Urdu plan says no
// more than an English one — and Urdu pays its measured paper cost here, in
// pages: teach 7 / support 5 (5/4 × 4/3 line density, rounded up), warns one
// page under each cap exactly as English warns.
//
// SUPPORT 5 -> 6 on 2026-09-04 (bd-vjk68), and TEACH stays at 7. All three live Urdu page
// failures that day were "support needs 6; the cap is 5" — never teach — so the sheet goes
// where the failures are. Note this leaves the Urdu ratio uneven against English (teach
// 7/6 = 1.17, support 6/4 = 1.50) rather than the clean 4/3 the original derivation used:
// the derivation was a prediction, these are the measured overflows, and the measurement wins.
// The n=4 "raise-and-refill" datum for Urdu is too thin to settle whether 7 is still short —
// that is what the post-40-lesson re-measure is for.
//
// LOWERED 2026-09-11 (bd-g6sww, closing bd-q29w9), alongside the EN ceiling above. UR keeps its
// measured Nastaliq premium over EN rather than the field-measured overflow ratio this comment
// tracked through 2026-09-06 — at this size the corpus data thins out, so UR = round(EN x 1.33):
// teach 4x1.33=5.32->5, support 3x1.33=3.99->4.
const MAX_PAGES_UR = { teach: 5, support: 4 };
const WARN_PAGES_UR = { teach: 4, support: 3 };

// VENDOR DIVERGENCE (SYNC §3.17). PRIMARY (G1-5) TEACHES FROM A LONGER PLAN, and that is the
// operator's decision, not a drift. Asked to choose the shape, she took "one continuous plan, as
// today" over a per-move phone view and over a deliver/script split, and raised the teach cap
// from 4 to 9 in the same breath.
//
// The 4-page ceiling above was measured on G6-12, where the plan is a board-exam brief for a
// subject teacher who already knows the content. A primary plan is a different document with a
// different reader: one teacher takes every subject, the script is what she actually says, and
// the 2026-09 format survey found primary teachers asking for MORE script, not less. So the
// reduction this profile is being built for is SCAN COST, not word count -- nothing is hidden,
// collapsed or moved to the support sheet -- and a cap tuned to a shorter document would have
// forced exactly the deletion she ruled out.
//
// Support stays at 3. Her page map ends the plan at the close ("coming in can go") and primary's
// page2 surfaces are mostly dark by design (d0_page2.NO_PRIMARY_SOURCE), so nothing is pressing
// on that sheet and raising it would only give content somewhere to hide.
//
// TEACH IS 8, IN BOTH LANGUAGES, SINCE 2026-09-24 (bd-blxml). THIS SUPERSEDES bd-jr91a's 16 / 24
// OF THE DAY BEFORE, AND THE WAY IT SUPERSEDES IT IS THE WHOLE POINT: the cap came DOWN to the
// number she has always named, and the 40 lessons that cannot meet it are licensed BY NAME in
// page_cap_exemptions.json, each at its own measured height.
//
// SHE WAS ANSWERING A CHOICE, AGAIN. Put to her on 2026-09-24:
//   (a) raise the cap for those 40 only -- cheapest, 88% untouched, the 40 stay long;
//   (b) re-segment the 40 into more, shorter lessons;
//   (c) hold 8 as a target for the 88% and accept the 40.
// She answered "a". "Raise the cap for THOSE" presupposes a cap the other 295 are held to, and
// bd-jr91a had left that cap at 16 / 24 -- i.e. at no cap at all, measured against her own words:
// *"I want lower, we cant go beyond 8, its too much to read and remember!"* and *"22-24 pages no
// teacher will read ... ever"*. A hard cap of 24 is the literal opposite of the second sentence.
//
// NOTHING MAY BE CUT IS UNTOUCHED BY THIS. bd-jr91a raised the cap to honour *"dont cut anything,
// increase the page cap for those 14"*; ruling (a) honours the same sentence more narrowly. The 40
// keep every authored page they have -- their exemptions record the heights they actually render
// at -- and no elision path was added to this file by either ruling. None may be.
//
// THE CAP IS NOT LANGUAGE-QUALIFIED, AND THAT IS DELIBERATE. She said 8, not "8 unless it is
// Urdu". Urdu's Nastaliq premium is real and measured -- 23 of 88 Urdu lessons run over 8 against
// 2 of 112 English -- but it is absorbed by the exemption list, lesson by named lesson. A 12- or
// 24-page global Urdu cap hands that licence to every Urdu lesson ever authored, including the
// ones that fit in 5 today, which is a permission nobody granted. MAX_PAGES_PRIMARY_UR.teach is
// therefore written as the SAME constant, not as a second number that happens to agree.
//
// THE NUMBERS ARE THE CORPUS, NOT A GUESS. 335 built PDFs, `pages_by_part.teach` read off each
// lesson's own .render.json at the default (phone) format, so `scaleCapsToFormat` returned the
// caps unscaled at ratio 1 and the counts are in the sheet a teacher receives:
//
//   3p:1  4p:15  5p:55  6p:92  7p:98  8p:34 | 9p:19 10p:7 11p:7 12p:1 13p:1 14p:1 15p:2 18p:1 21p:1
//
// 295 of 335 (88.1%) already meet 8. 40 exceed it, by 106 pages in total. By subject: Urdu 23/88
// (26.1%), Maths 12/105 (11.4%), Science 3/30 (10.0%), English 2/112 (1.8%).
//
// AND THE CAP STILL FAILS LOUDLY, FOR AN EXEMPT LESSON TOO. The design invariant is untouched:
// nothing is trimmed to fit, and over cap the renderer FAILS. An exemption raises the cap for ONE
// named lesson to ONE recorded height; the same lesson one page taller fails exactly as loudly as
// an unlisted one, because a list of bare names would be a blanket amnesty. Covered as a gate in
// tests/lp612/primary-page-cap-8.test.js and primary-page-cap-exemptions.test.js.
//
// SUPPORT DID NOT MOVE. 0 of the 335 renders built a single support page, so nothing there was
// measured and nothing there is touched; 3 / 4 stand unamended.
const MAX_PAGES_PRIMARY = { teach: 8, support: 3 };
const MAX_PAGES_PRIMARY_UR = { teach: MAX_PAGES_PRIMARY.teach, support: 4 };   // the SAME 8, not a
                                                          // second number: see "NOT LANGUAGE-
                                                          // QUALIFIED" above

// VENDOR DIVERGENCE (bd-blxml, 2026-09-24). WARN IS THE LAST SHEET AGAIN, AND IT SAYS SOMETHING.
//
// It was teach 4 EN / 5 UR: an authored phone-first TARGET, not `max - 1`. Operator, 2026-09-18,
// *"keep the max at 9, but ideally 4-5 pages on phone-first"* -- a lower aim than a ceiling of 9.
// Against bd-jr91a's ceiling of 16 that aim became noise: MEASURED over the same 335 renders, a
// warn of 4 fires on 319 of them, 95.2% of the corpus. A signal that fires on 95% of everything is
// not a signal, and it had stopped being the thing the operator was told about.
//
// Today's ruling puts the CEILING at the number she will tolerate, which is roughly where her aim
// already was. The useful sentence left is the one WARN carries everywhere else in this file --
// "this is your last sheet" -- so primary's warn is derived from its cap again, at max - 1 = 7.
// Measured firing rate at 7: 74 of 335, 22.1%. A fifth of the corpus, which is a signal.
//
// WHAT THIS GIVES UP, said out loud: her 4-5 phone-first aspiration is no longer represented by
// any number in this file. Expressing both a 4-5 aim AND a last-sheet warning needs a third
// threshold, which is a design change and hers to ask for, not one to smuggle in behind a ruling
// about the cap.
const WARN_PAGES_PRIMARY = { teach: MAX_PAGES_PRIMARY.teach - 1, support: 1 };
const WARN_PAGES_PRIMARY_UR = { teach: MAX_PAGES_PRIMARY_UR.teach - 1, support: 1 };

// `isPrimary` is IMPORTED from lib/template (bd-vbs5w). It used to be defined here, and once
// page 1's primary furniture started reading the same rule there were two copies of one grade
// test -- which is how a plan ends up capped as primary and laid out as secondary. It lives in
// the template because render_lp requires that module and not the reverse.

// VENDOR DIVERGENCE (bd-vbs5w, SYNC §3.20). A CAP IS A CONTENT BUDGET WRITTEN IN SHEETS, AND
// ONLY ONE SHEET WAS EVER MEASURED.
//
// Every number above was tuned against the 520x2000 phone page, because until the format became
// selectable (SYNC §3.14) that was the only page there was. The phone content box is 1986px and
// A4's is 1109px -- 56% of it -- so the same plan needs ~1.79x the sheets to say the same thing.
// English_seg6, green at `teach 8/9` on the phone, reported "teach needs 14 pages; the cap is 9"
// at --format a4 with nothing else changed: not a lesson over budget, a budget quoted in the
// wrong unit. Amena asked for both renders of every primary plan ("Both -- A4 to review, phone to
// deliver"), so a cap only one sheet can meet makes the review copy unrenderable.
//
// PHONE IS UNTOUCHED BY CONSTRUCTION: at ratio 1 the object is returned as it is, so whatever the
// constants say binds the sheet a teacher actually receives, and so does every reading of them that
// does not name a format (the author's budget card). That property is why this function was safe to
// add, and it is unchanged.
//
// WHAT CHANGED IS WHAT THE CONSTANTS SAY (bd-jr91a, 2026-09-23). This paragraph used to read
// *"bd-rjt3x's standing 'do not raise the cap' still binds the sheet a teacher actually receives"*.
// bd-rjt3x's standing instruction was OVERRIDDEN by the operator that day for the phone sheet, and
// the primary teach caps above moved 9 -> 16 / 12 -> 24 as a result. Nothing here moved with them:
// this function converts whatever budget it is handed, it never authors one, and a cap raise is
// therefore not a reason to touch it. The G6-12 caps did not move either; they never reach here.
//
// WARN IS SCALED, NOT RECOMPUTED (bd-788pe). It used to come back as `max - 1`, which was right
// while warn meant "nearly at the cap" -- deriving it kept the two from drifting apart. Primary's
// warn is now an authored target that is nowhere near its cap, and `max - 1` would throw it away
// and put it back one sheet under the scaled cap -- which since bd-jr91a is 29 A4 sheets, not the
// 16 this sentence used to name back when the phone cap was 9. A budget quoted in phone sheets and
// read on A4 is the defect this function exists to fix, so the target converts on the same
// geometry the cap does. The clamp is the one invariant left: a target above the cap could never
// fire, because the over-cap branch would have taken the render first.
function scaleCapsToFormat(caps, format) {
  const box = (f) => f.h - f.padT - f.padB;           // template.js: PAGE_CONTENT_H
  const fmt = PAGE_FORMATS[format] || PAGE_FORMATS.phone;
  const ratio = box(PAGE_FORMATS.phone) / box(fmt);
  if (ratio === 1) return caps;
  const scale = (n) => Math.max(1, Math.round(n * ratio));
  const max = { teach: scale(caps.max.teach), support: scale(caps.max.support) };
  const warn = { teach: Math.min(scale(caps.warn.teach), max.teach),
                 support: Math.min(scale(caps.warn.support), max.support) };
  return { max, warn };
}

/** The caps for one render, by the language actually being laid out, the plan's own profile, and
 *  the sheet it is being laid out on. `format` is optional and defaults to the measured one. */
function pageCapsFor(lang, doc, format, stem) {
  const ur = lang === "ur";
  if (isPrimary(doc)) {
    // PRIMARY ONLY, deliberately. The same physics would take the G6-12 teach cap from 4 to 7 on
    // A4. That is a real question, but it is the operator's: those caps gate the format G6-12
    // plans are delivered in, and they are not moving as a side effect of a G1-5 page-1 change.
    const base = ur
      ? { max: MAX_PAGES_PRIMARY_UR, warn: WARN_PAGES_PRIMARY_UR }
      : { max: MAX_PAGES_PRIMARY, warn: WARN_PAGES_PRIMARY };
    // THE NAMED EXEMPTION (bd-blxml). Ruling (a): raise the cap for the over-8 lessons ONLY. It
    // is applied HERE, before the format scaling, so an exempt lesson converts to A4 on exactly
    // the geometry every other cap does -- a licence quoted in phone sheets but enforced on A4
    // is the defect `scaleCapsToFormat` exists to prevent.
    //
    // It raises TEACH ONLY, to that ONE lesson's OWN measured height, and only when a stem was
    // passed: an unnamed render sees the bare 8. A listed lesson one page past its recorded
    // height fails as loudly as an unlisted one -- `overCapProblem` says so in the message.
    const ex = stem ? exemptionFor(stem) : null;
    return scaleCapsToFormat(
      ex ? { max: { ...base.max, teach: ex.teach }, warn: base.warn } : base,
      format,
    );
  }
  return ur
    ? { max: MAX_PAGES_UR, warn: WARN_PAGES_UR }
    : { max: MAX_PAGES, warn: WARN_PAGES };
}

// ── overflow absorption (bd-c3le6) ──────────────────────────────────────────
//
// A LESSON IS NOT DISCARDED FOR A HANDFUL OF PIXELS OF PAGE FURNITURE.
//
// Three lessons in the 2026-09-05 batch were authored, rendered, written to disk and then
// thrown away — d15 on 3px, d10 on 9px, d03 on 11px — after up to five revision rounds and
// several minutes of compute each. On all three, `overflowingSections` was EMPTY: no element
// carrying `data-sec`, i.e. no lesson content, was past the page's inner bottom edge. The only
// thing over the line was the FOOTER, the strip that prints "page 6 of 14". Nothing was
// clipped, and nothing was going to be.
//
// Operator, 2026-09-04: *"we will stop cancelling or delaying lesson plans now because of the
// length issue."* `OVERFLOW` was deliberately kept blocking when the page caps went soft,
// because overflow is CLIPPING rather than length. That reasoning is right and is kept below —
// it just does not describe a footer sitting in the page's own bottom margin.
//
// WHERE 12 COMES FROM. Not a tolerance chosen to cover the failures: it is the whitespace that
// exists between the last content pixel and the paper edge, and it is the same in both
// languages —
//
//     .pad { padding: 10px 21px 4px }    ->  4px below the footer
//     .foot{ padding-top: var(--sp-2) }  ->  8px above the footer
//                                         = 12px, reclaimable without moving one pixel of
//                                           content and without shrinking any type.
//
// `.foot`'s own padding-bottom (1px LTR, 7px RTL) is deliberately NOT reclaimed — Nastaliq
// descenders need it. The largest overflow ever measured in this programme is 11px, so the
// furniture-derived ceiling also clears every case on record; a 13px overflow still fails,
// because absorbing it would mean eating content.
//
// AND CLIPPING STILL FAILS AT ANY SIZE. If any of the lesson is past the line, no number of
// pixels makes it absorbable — that is what keeps this from quietly becoming "OVERFLOW is a
// warning now". See `absorbPlan` for WHICH measurement decides that, and why the obvious one
// is not enough on its own.
const OVERFLOW_ABSORB_MAX_PX = 12;

// THE FILL FLOOR — the operator's number, not a chosen one: "no page under ~85% except the last
// page of each part". It is the packer's fourth objective (see `packAtoms`) AND the line the
// report's `underfilled_pages` is measured against, so the packer and the report can never
// disagree about what counts as a hole. A page's fill is measured on the PRINTED page —
// continuation strip and repeated bar included, because a teacher reading it sees spent paper,
// not furniture.
const FILL_TARGET_PCT = 85;

/**
 * Which pages may have their bottom furniture eaten, and by how much.
 *
 * Pure, and separate from the in-page mutation, because THIS is where the policy lives: the
 * two questions "is it small enough" and "is it furniture rather than content" are the whole
 * decision, and they belong somewhere a test can enumerate them without a browser.
 *
 * @param pages  the probe's per-page records
 * @param maxPx  the ceiling; defaults to the reclaimable furniture above
 */
function absorbPlan(pages, maxPx = OVERFLOW_ABSORB_MAX_PX) {
  const out = [];
  for (const p of pages || []) {
    if (!p) continue;
    const px = p.overflowPx;
    if (!(px > 1)) continue;                                    // 1px is already tolerated below
    if (px > maxPx) continue;                                   // past the furniture: real length

    // A SECTION BAR OVER THE LINE IS THE LOUD CASE, AND IT IS NOT THE ONE THAT MATTERS.
    //
    // This check was written first, on the reasoning "no `data-sec` element is past the line,
    // therefore no content is". That did not survive being checked. `data-sec` is emitted on
    // exactly four elements in lib/template.js and every one of them is a section BAR — no
    // block, card, list item, figure or table carries it. So `overflowingSections` is empty on
    // nearly every page, including pages where real content IS past the edge, and a guard that
    // is almost never false is not a guard. Kept because it is free and catches the loudest
    // case; the next check is the load-bearing one.
    if ((p.overflowingSections || []).length) continue;

    // THE ONE THAT DECIDES IT. `contentBottomPx` is the last painted pixel EXCLUDING `.foot` —
    // the probe skips anything inside the footer explicitly, so that a page whose footer is
    // pinned to the floor does not read as 100% full. If the content ends at or inside
    // `innerBottomPx`, every pixel of the LESSON is on the paper and the only thing over the
    // line is furniture, which is precisely what this absorbs. If it ends past it, that is the
    // lesson being cut off and it must keep failing at any size.
    //
    // `undefined` is not "past": a probe shape without these fields predates them, and absent
    // evidence must not silently deny a lesson the absorption it qualifies for.
    if (typeof p.contentBottomPx === 'number' && typeof p.innerBottomPx === 'number'
        && p.contentBottomPx > p.innerBottomPx) continue;

    out.push({ id: p.id, px });
  }
  return out;
}

// Take `px` out of a page's own bottom whitespace, bottom-most first. Returns what it actually
// took, per page, so the caller reports a measurement rather than an intention — `unabsorbed`
// is non-zero only if a page somehow had less furniture than the plan assumed, and the re-probe
// that follows is what decides the outcome either way.
const ABSORB = `(plan) => {
  const done = [];
  for (const item of plan) {
    const pg = document.getElementById(item.id);
    const pad = pg && pg.querySelector('.pad');
    if (!pad) continue;
    const foot = pad.querySelector('.foot');
    const padPb = parseFloat(getComputedStyle(pad).paddingBottom) || 0;
    const footPt = foot ? (parseFloat(getComputedStyle(foot).paddingTop) || 0) : 0;
    let need = item.px;
    const takePad = Math.min(need, padPb); need -= takePad;
    const takeFoot = Math.min(need, footPt); need -= takeFoot;
    if (takePad) pad.style.paddingBottom = (padPb - takePad) + 'px';
    if (takeFoot && foot) foot.style.paddingTop = (footPt - takeFoot) + 'px';
    done.push({ id: item.id, px: item.px, padPx: takePad, footPx: takeFoot, unabsorbed: need });
  }
  void document.body.offsetHeight;
  return done;
}`;

// THE TYPE FLOORS, in one place. D4 was 16.5/13; the operator moved it to 18/14 on 2026-09-01
// because 16.5 still did not read on a phone, and to 15.5pt (20.667px) on 2026-09-06 because it
// still did not — see prod_golive_2026-09-06/07_font/READABILITY.md for the measurement. The
// DIAGRAM label floor is NOT here — it belongs to the diagram engine (diagrams/lib/svg.js),
// which sizes labels against the figure's own column, not against the page's body scale.
//
// DERIVED, never a literal. A floor written as a number stops meaning anything the moment the
// scale moves — it passes trivially and stops catching the regression it exists for. And it is
// computed with the template's OWN `scaledPx`, because a floor of 20.67 against a computed
// 20.667 fails every render on a rounding artefact.
const BODY_FLOOR_PX = scaledPx(18);
const CHIP_FLOOR_PX = scaledPx(14);
// VENDOR DIVERGENCE (see SYNC.md, "chromium channel"): upstream hardcoded the macOS Chrome
// bundle path for the no-playwright fallback. On Railway that path does not exist, so the
// binary is now overridable and defaults per-platform. This fallback has no overflow probe
// and no PNGs and exists only so a dev box without playwright still produces a PDF.
const CHROME_CLI_BIN = process.env.LP612_CHROME_BIN ||
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "google-chrome");

function parseArgs(argv) {
  const a = { png: false, pdf: true, lang: null, out: null, stem: null, quiet: false, format: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--png") a.png = true;
    else if (v === "--no-pdf") a.pdf = false;
    else if (v === "--quiet") a.quiet = true;
    else if (v === "--lang") a.lang = argv[++i];
    else if (v === "--out") a.out = argv[++i];
    else if (v === "--stem") a.stem = argv[++i];
    // VENDOR DIVERGENCE (SYNC §3.14) — `phone` (default, what a teacher receives) or `a4`.
    else if (v === "--format") a.format = argv[++i];
    else rest.push(v);
  }
  a.doc = rest[0];
  return a;
}

// VENDOR DIVERGENCE (see SYNC.md, "playwright resolution"): upstream tried a machine-local
// checkout of another repo's node_modules first. Here playwright-core is a real dependency of
// bot/package.json, so the plain require is the only candidate — and in the root Jest suite it
// resolves to tests/__mocks__/playwright-core.js via moduleNameMapper, which is the seam that
// keeps a unit test from downloading or launching a browser.
function loadPlaywright() {
  try {
    return require("playwright-core");
  } catch (_) {
    return null;
  }
}

// VENDOR DIVERGENCE (see SYNC.md, "chromium channel"): upstream hardcoded
// `launch({ channel: "chrome" })`, which requires a Google Chrome INSTALL and fails on a
// Railway container, where the only browser is the chromium playwright ships. The channel is
// now: whatever LP612_CHROME_CHANNEL says; else "chrome" on macOS (a dev laptop has Chrome and
// the upstream behaviour is what the golden renders were eyeballed against); else undefined,
// which means playwright's own bundled chromium.
function chromeChannel() {
  const explicit = process.env.LP612_CHROME_CHANNEL;
  if (explicit) return explicit === "bundled" ? undefined : explicit;
  return process.platform === "darwin" ? "chrome" : undefined;
}

/** Count /Type /Page objects in a PDF buffer. */
function pdfPageCount(buf) {
  return (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
}

// Pass 1: measure every ATOM of each part at the real page width, so the page breaks are
// COMPUTED from what the browser actually lays out rather than estimated from word counts.
//
// v8.1: an atom is a section bar, a block, or one practice item — not a whole section. The
// height and the TOP MARGIN are reported separately, because the margin is real everywhere
// except on the first element of a page (`.pad > :first-child{margin-top:0}`); charging it
// there would silently shrink every page by up to one --sp-4.
//
// The `__probe` page carries the furniture the packer must also pay for and which is not an
// atom: the "…continued" strip, the per-page footer, and one repeated bar PER SECTION.
const MEASURE = `() => {
  document.body.classList.add('measuring');
  void document.body.offsetHeight;                 // force reflow before reading
  const box = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { h: Math.ceil(r.height + parseFloat(cs.marginBottom)), mt: Math.ceil(parseFloat(cs.marginTop)) };
  };
  const out = { parts: {}, probe: {} };
  for (const page of document.querySelectorAll('.page')) {
    const part = page.dataset.part;
    const pad = page.querySelector('.pad');
    if (part === '__probe') {
      for (const ch of pad.querySelectorAll('[data-probe]')) out.probe[ch.dataset.probe] = box(ch);
      continue;
    }
    out.parts[part] = out.parts[part] || [];
    for (const ch of pad.querySelectorAll(':scope > [data-atom]')) out.parts[part].push(box(ch));
  }
  document.body.classList.remove('measuring');
  return out;
}`;

/**
 * Greedy first-fit over ATOMS, with the two constraints v8 did not have.
 *
 * SUPERSEDED as the shipping packer by `packAtoms` below (VENDOR DIVERGENCE §3.7). Kept,
 * exported and still tested because it is the baseline every claim about the new packer is
 * measured against, and because it is the honest description of what produced every lesson
 * delivered before 2026-09-04.
 *
 * 1. GLUE — a break may not fall immediately after an atom marked `glue`. That is what keeps
 *    a section bar with its first block and a practice tag with its first item. When the
 *    natural break lands on a glued boundary the packer walks BACKWARDS to the last legal
 *    one; if that would empty the page it takes the illegal break rather than dropping
 *    content, because a lost block is worse than an orphan heading.
 * 2. FURNITURE — every page pays for its footer; every page after the first also pays for
 *    the "…continued" strip, and for the repeated section bar when it opens mid-section.
 *    Charging a guessed height instead is exactly how v8 overflowed every continuation page
 *    by the strip's own height (+39px on the Urdu G9 support page).
 *
 * @param atoms [{h, mt, glue, sec, first}]
 * @param capacity  the page box, ALREADY net of the footer
 * @param furn  { strip, contBar: {sectionKey: px} } — heights measured in the probe page
 * @returns { breaks:[atom index that starts each page after the first], pages:[{start, contBarSec}] }
 */
function packAtomsGreedy(atoms, capacity, furn = {}) {
  const strip = furn.strip || 0;
  const contBar = furn.contBar || {};
  const breaks = [];
  const pages = [];
  let pageStart = 0, pageIdx = 0;

  const open = (i, idx) => {
    const a = atoms[i] || {};
    // a page that opens on a section's OWN bar needs no repeat; one that opens in the middle
    // of a section does.
    const sec = idx > 0 && a.sec && !a.first ? a.sec : null;
    const overhead = idx > 0 ? strip + (sec ? (contBar[a.sec] || 0) : 0) : 0;
    pages[idx] = { start: i, contBarSec: sec };
    return capacity - overhead;
  };

  if (!atoms.length) return { breaks, pages: [] };
  let cap = open(0, 0);
  // the first atom of page 1 has its top margin suppressed by CSS; on a continuation page
  // the first atom follows the strip, so it keeps it.
  let used = atoms[0].h;

  for (let i = 1; i < atoms.length; i++) {
    const cost = atoms[i].h + (atoms[i].mt || 0);
    if (used + cost <= cap) { used += cost; continue; }
    let j = i;
    while (j > pageStart + 1 && atoms[j - 1].glue) j--;
    breaks.push(j);
    pageStart = j;
    pageIdx++;
    cap = open(j, pageIdx);
    used = atoms[j].h + (atoms[j].mt || 0);
    for (let k = j + 1; k <= i; k++) used += atoms[k].h + (atoms[k].mt || 0);
  }
  return { breaks, pages };
}

/**
 * VENDOR DIVERGENCE (SYNC.md §3.7) — THE EXACT PACKER. Replaces greedy first-fit as the
 * shipping packer; `packAtomsGreedy` above is retained as the measurement baseline.
 *
 * WHY a search at all — the part that is easy to get wrong in both directions.
 *
 * With a UNIFORM page box, greedy first-fit is ALREADY optimal for ordered items: taking the
 * latest feasible break is a straight exchange argument, and greedy's backwards walk over
 * `glue` lands on the latest LEGAL break, which is still optimal. A "cleverer search" over a
 * uniform box would buy exactly nothing, and saying otherwise would be the kind of claim
 * this pipeline has been burned by.
 *
 * The box is not uniform. A continuation page pays the "…continued" strip, and a page that
 * opens in the MIDDLE of a section also pays that section's repeated bar — so the box of the
 * NEXT page is a function of WHICH atom opens it. Greedy chooses that opener blindly, as a
 * side effect of stuffing the current page. Stopping one atom earlier, so the next page opens
 * on a section's own bar, can buy back the entire repeated bar. Measured over 62 real lesson
 * documents (2026-09-04): 582 pages printed where 555 suffice, and 5 parts over cap where an
 * exact pack leaves 0 — every one of those five already carrying 89-96% of the paper its cap
 * allows.
 *
 * THE MODEL. `best[i]` is the optimal packing of atoms[i..] given that a page STARTS at atom
 * i. Page 1 is exactly the page that starts at atom 0 and no other page can, so "starts at
 * atom i" already fixes the furniture and the DP needs no page index in its state — which is
 * what makes it exact rather than merely thorough. O(n²) over tens of atoms per part.
 *
 * THE OBJECTIVE, in order:
 *   1. PAGES — the failure class this exists to kill.
 *   2. ORPHANS — a break immediately after a `glue` atom, legal only on a page holding that
 *      one atom (greedy's own escape hatch for a glued atom taller than its page). Because
 *      greedy's packing is always in this DP's feasible set, the page count can never come
 *      out worse than greedy's, and minimising orphans after it means the packer can never
 *      buy a page by orphaning a heading — the one change that would make this a regression
 *      rather than a fix.
 *   3. FRONT-LOADING — with both of the above equal, the fullest possible page here. That is
 *      greedy's own rule, and choosing it is deliberate: it means that on any part where
 *      greedy was ALREADY page-optimal, this packer reproduces greedy's breaks exactly, so
 *      no break ever lands anywhere the shipped packer would not have put one. The change is
 *      then strictly "the same pagination, except where greedy was leaving a page on the
 *      table". On the 62-document corpus that is every part: pagination is unchanged.
 *
 *   4. THE FILL FLOOR — bd-5jaag, added 2026-09-23 on the operator's third report of the same
 *      defect ("too much space left empty, we should be accounting for all the space in the
 *      LP"; "English too has wasted white space"; "Urdu has similar feedback to english and
 *      Math with ... space wasted"). One term, BELOW page count, orphans and overflow and ABOVE
 *      both the soft-seam preference and front-loading, so the page count can never move and a
 *      broken render can never be bought. See THE FILL FLOOR below.
 *
 *      It was RANKED BELOW THE SOFT SEAM until bd-2hmag.B (same day, the operator's fourth
 *      report: "fix the wasted white space too"). That ranking meant the DP would accept a much
 *      worse hole rather than take one extra break at a seam where a break is always legal —
 *      1039 of 2016 non-final pages under the floor across the 330-lesson corpus, 233 of the
 *      610 worst cases being atoms that were already as small as an atom can be. The full
 *      argument and the two terms that stay above it are on `better()` below.
 *
 * THE TIE-BREAK WAS SUPPOSED TO BE "fill pages evenly / avoid a near-empty final page", and
 * for a year it was NOT, because the measurement argued against it. Two even-fill variants
 * were built and run over all 62 documents first, and BOTH ARE STILL REJECTED:
 *
 *   • Σ slack² over every page. It levels the whole document. It pulled teach page 1 of
 *     grade_11_physics from 1064px (full) down to 741px, pushing the first teaching section
 *     off the opening page and leaving its bottom third white — for ZERO pages saved. That is
 *     the exact defect the atom packer was built to remove ("this should be fixed and dynamic,
 *     there's way too much open space", operator 2026-08-30).
 *   • The COUNT of pages under 70% full, then front-loading. Better — it leaves a full page
 *     alone — but on c11 it removed the stranded page at the END of the support part by
 *     opening a 314px hole in the MIDDLE of it, which reads worse, and it still re-broke 33
 *     of 62 documents.
 *
 * THE FILL FLOOR is the third objective, and it is designed against those two measurements
 * rather than around them. The operator's own rule, already written into the report below, is
 * "no page under ~85% except the last page of each part" — that sentence describes what the
 * REPORT exempts (`underfilledPages`, below), not what the PACKER is allowed to ignore, and
 * conflating the two was bd-l7vig:
 *
 *   `gapSq`   Σ (px a page falls short of the floor)², over every page in the part, final page
 *             INCLUDED. The CLAMP at the floor is what kills the Σ slack² defect: a page at or
 *             above 85% scores exactly zero, so a full page has nothing this term wants to take
 *             and the gradient that emptied physics page 1 does not exist. The SQUARE is what
 *             kills the c11 defect on its own, without needing to look away from the final page
 *             to do it: moving one hole from the end into the middle trades one deficit for
 *             another of the SAME rough size, and a single deficit of size d already costs d² —
 *             cheaper than splitting it, per the same arithmetic that makes shallow-and-spread
 *             beat one deep hole below. There is no longer a second term: an EARLIER version of
 *             this objective (bd-5jaag) excluded the final page outright and ranked its own
 *             deficit (`lastGap`) below `gapSq` as a tie-break-only exemption. That is exactly
 *             what made the final page's shortfall invisible whenever every non-final page
 *             already cleared the floor — which is the ONLY situation a part with too little
 *             content to fill every page can ever be in. English_seg7 (bd-l7vig, measured
 *             2026-09-23): four pages front-loaded to 89-99% and a fifth left with whatever
 *             remained, 23%, because nothing scored that 23% against anything. Now it does: the
 *             final page's clamped square sits in the same sum as every other page's, so the
 *             DP will trade a shallow new deficit on an earlier page for closing a deep one on
 *             the last whenever the squares say that trade is cheaper — which, being a sum of
 *             squares, is exactly when it makes the shortfall shallower and more even rather
 *             than moving a hole from one place to another (still the c11 guarantee, just no
 *             longer needing a special case for the last page to keep it).
 *
 * A THIRD VARIANT WAS BUILT AND REJECTED HERE (bd-5jaag, 2026-09-23): the COUNT of non-final
 * pages under the floor, ranked ABOVE their depth. It is the c11 variant's defect one level
 * down. Over the 300-shape packer corpus it made the WORST page of 12 shapes worse — seed 28
 * from 69/56/58% to 40/86/58%, seed 208 from 95/93/68/57/78/34% to 95/93/33/93/78/34% — by
 * lifting one hole over the floor and digging the page in front of it twice as deep. A count
 * cannot tell an invisible 84% page from a glaring 33% one; `gapSq` is scored so that it can.
 * The deliberate consequence: over the 45 corpus shapes whose packing changes, the NUMBER of
 * below-floor pages rises 196 → 215 while the worst non-final page improves on 22 shapes and
 * worsens on none. Total whitespace in a document is fixed by its content and its page count;
 * only its distribution is ours, and shallow-and-spread reads better on a desk than one page
 * a teacher can see is half blank. This same trade-off is why bd-l7vig's fix is safe to make
 * unconditionally rather than only when the final page is the worst one: it is the SAME
 * squared-deficit term this variant was measured against, just no longer blind to one page.
 *
 * Charged on the PRINTED page: a continuation page's strip and repeated bar are paper already
 * spent, and they are read from the measured `furn`, so shrinking that furniture changes the
 * arithmetic without this packer knowing any of its heights.
 *
 * What it CANNOT do, stated plainly because the report must not claim otherwise: a page at 25%
 * is sixty points short, and the page in front of it may give up fifteen before it becomes a
 * hole itself. Deep troughs are structural — a tall atom that shares with nothing — and they
 * come out of the AUTHORING, not out of the packer. `underfilled_pages` in the render report
 * names every page still under the floor after packing, for exactly that reason.
 *
 * Same signature and same return shape as the greedy packer it replaces, so nothing
 * downstream changes.
 */
/**
 * The pages the packer could NOT get over the fill floor, named rather than glossed over.
 *
 * A page at 25% is sixty points short and the page in front of it may give up fifteen before it
 * becomes a hole itself; those troughs are structural — a tall atom that shares with nothing —
 * and they come out of the AUTHORING. The report has to say so, because a render that looks
 * clean while a teacher's printout has a half-blank page in it is a regression mask (rule 24b).
 *
 * The threshold is `FILL_TARGET_PCT` — the SAME constant `packAtoms` optimises against, so the
 * report and the packer can never disagree about what counts as a hole.
 *
 * bd-tqp5q. The last page of a part is not blindly exempt any more — a blanket exemption is
 * exactly what let English_seg7's 23% fifth page pass through this function as `[]` while
 * `page_fill_pct` printed it in plain sight two lines above. The operator's rule ("no page
 * under ~85% except the last page of each part") is read here for what it actually says: the
 * last page is forgiven WHEN there was structurally no way to have done better — i.e. when the
 * part's own content, spread as evenly as physically possible, still could not have cleared the
 * floor on every page. That is a testable claim, not an assumption: it is exactly "this part's
 * AVERAGE fill is below the floor". A part whose average already clears the floor had enough
 * paper to go around, so a low final page there means a boundary was chosen badly, not that the
 * content ran out — and it is flagged like any other page.
 *
 * This still asks nothing of `packAtoms`: the average is computed from the same rendered
 * `contentBottomPx`/`footTopPx` every other page in this function reads, so the report stays a
 * read of the geometry that actually printed, never a second opinion on the packer's own DP
 * state. Returns `[]` on a clean document and on a document with no probe — never undefined,
 * because an absent field reads as "not measured".
 *
 * @param {Array<{id, part, contentBottomPx, footTopPx}>} pages `probe.pages`, in DOM order.
 */
function underfilledPages(pages, target = FILL_TARGET_PCT) {
  if (!Array.isArray(pages)) return [];
  const lastOfPart = new Map();
  pages.forEach((p, i) => lastOfPart.set(p.part, i));

  const withFill = pages.map((p, i) => (
    { p, i, fill: Math.round((100 * p.contentBottomPx) / p.footTopPx) }
  ));

  const partAvg = new Map();      // part -> average fill of every page in it
  withFill.forEach(({ p, fill }) => {
    const s = partAvg.get(p.part) || { total: 0, n: 0 };
    s.total += fill; s.n += 1;
    partAvg.set(p.part, s);
  });

  return withFill
    .filter(({ p, i, fill }) => {
      if (fill >= target) return false;
      if (lastOfPart.get(p.part) !== i) return true;    // not the last page: no exemption to check
      const avg = partAvg.get(p.part);
      return avg.total / avg.n >= target;               // content ran out vs. boundary chosen badly
    })
    .map(({ p, fill }) => ({ id: p.id, part: p.part, fill }));
}

/**
 * @param opts.slack  px a page may be overfilled by, RANKED BELOW page count and orphans and
 *   ABOVE front-loading — so it can only ever remove a page, never buy a fuller one. Zero by
 *   default: every existing caller and the 300-seed regression corpus describe the exact
 *   packer, and this is an allowance the RENDERER grants because it knows it can pay for it
 *   (bd-c3le6 — the same `OVERFLOW_ABSORB_MAX_PX` the in-page absorber reclaims afterwards).
 *
 *   Why it exists: fixing the `.mats` measurement bug alone pushed d10's teach part from 6
 *   pages to 7, and page 7 carried the 52px Materials strip and nothing else — a blank page in
 *   a teacher's printout, because the packer was ELEVEN pixels short while twelve pixels of
 *   reclaimable furniture sat unused at the bottom of that page. Correct arithmetic that
 *   produces a blank page is not a fix.
 */
function packAtoms(atoms, capacity, furn = {}, opts = {}) {
  const n = atoms.length;
  if (!n) return { breaks: [], pages: [] };
  const strip = furn.strip || 0;
  const contBar = furn.contBar || {};
  const slack = Math.max(0, opts.slack || 0);
  // The floor, expressed as the px of whitespace a page may leave before it reads as a hole.
  // Charged against `capacity` — the PRINTED page — so a continuation page's furniture counts
  // as paper already spent and no furniture height is named here.
  const allowance = capacity * (1 - (opts.fillTarget == null ? FILL_TARGET_PCT : opts.fillTarget) / 100);
  const gapOf = (box, used) => Math.max(0, Math.round(box - used - allowance));

  // Which section's bar a page opening at atom i has to repeat — null when it opens on that
  // section's OWN bar, or when it is page 1.
  const contBarSecOf = (i) => {
    const a = atoms[i] || {};
    return i > 0 && a.sec && !a.first ? a.sec : null;
  };
  const boxOf = (i) => {
    if (i === 0) return capacity;
    const sec = contBarSecOf(i);
    return capacity - strip - (sec ? (contBar[sec] || 0) : 0);
  };
  // The first atom of page 1 has its top margin suppressed by CSS (`.pad > :first-child`);
  // a continuation page's first atom follows the strip and keeps it. Atom 0 is the only atom
  // that can ever open page 1, so the suppression is a property of the ATOM and not of where
  // the breaks fall — which is why a page's content total does not depend on the packing.
  const costOf = (j) => atoms[j].h + (j === 0 ? 0 : atoms[j].mt || 0);

  // `over` — pages that spent the slack — sits between orphans and the fill floor on purpose.
  // Above `used`, so at an equal page count the packing that pays nothing always wins and a
  // part that already fitted is paginated exactly as it was. Below `pages`, so the allowance
  // is spent whenever it removes a page. With slack = 0 the term is identically zero and the
  // comparison is the one the exact packer has always used.
  // VENDOR DIVERGENCE (bd-usirc, SYNC 3.22). `splits` -- breaks that fell on an atom marked
  // `soft` -- is the softest term there is. BELOW `pages`, so a seam can never buy paper the
  // way `glue` does; ABOVE `used`, so it still wins the ties that front-loading used to win,
  // which is where the gratuitous splits were. An atom that declares no `soft` scores zero here
  // and is packed by the comparison the exact packer has always used.
  // bd-5jaag / bd-l7vig. `gapSq` — the fill floor — is a SUM over the suffix, never a max, so
  // the DP's optimal substructure is untouched: extending two suffix packings with the same page
  // adds the same increment to both and cannot reverse their order. A document whose pages all
  // clear the floor scores zero, and is then packed by the comparison the exact packer has
  // always used — which is why a clean document is never re-broken. It used to be two terms,
  // with the final page of a part scored on a separate `lastGap` ranked below `gapSq` so it
  // could only ever win a tie — bd-l7vig found that a tie is the ONLY thing a struggling part
  // ever produced (every non-final page already clamped to zero the moment it cleared the
  // floor), so the final page's own shortfall never had anything to compete against. It is
  // charged on the same term as everything else now: see THE FILL FLOOR in the header comment
  // above for the full argument and the corpus case. The final page of a part is NOT exempt
  // from `gapSq`, on purpose and by measurement — that exemption is what bd-l7vig removed, and
  // re-adding it would strand English_seg7's fifth page at 23% all over again.
  //
  // bd-2hmag.B, 2026-09-23 — `gapSq` MOVES ABOVE `splits`, on the operator's FOURTH report of
  // the same defect ("fix the wasted white space too"). It had sat second from LAST, so the DP
  // would knowingly accept a much worse hole on one page rather than take a single extra break
  // after a `soft` atom anywhere in the sequence. That is not a tie-break, it is the floor
  // losing to a preference: measured over the 330-lesson rendered corpus, 1039 of 2016 non-final
  // pages were under the floor and 233 of the 610 worst cases were atoms ALREADY as small as an
  // atom can be — the one-turn `pc-m`/`pc-z` pieces of an already-split worked example, 130-313
  // characters each, sitting against 300-868px holes on the page in front of them. A one-line
  // sentence cannot be taller than a 300px hole, so finer splitting could never have reached
  // them; only the ranking could. A `soft` seam is by construction a place where a break is
  // always legal, so paying one to close a hole costs the reader nothing and NOTHING IS CUT —
  // this changes where a break falls, never what is on the page.
  //
  // `over` moves above `splits` in the same edit, and that is a second defect, not a side
  // effect: the old order would spend the renderer's 12px absorb allowance — overfilling a page
  // for no page saved — purely to dodge a seam (pinned in tests/lp612/packer-fill-outranks-seam
  // as `SLACK_FOR_A_SEAM`, which printed 101%/33%/82%). Overflow is a broken render (bd-p0nzj)
  // and the allowance exists to REMOVE A PAGE (bd-c3le6), nothing else.
  //
  // WHAT STAYS ABOVE THE FLOOR, and why each one is not negotiable:
  //   `pages`    filling pages by ADDING pages is not a fix. Verified, not assumed: over a
  //              4,000-shape synthetic corpus and a 42-lesson render sample the page count is
  //              bit-identical before and after, which is what `pages` being the top term of a
  //              lexicographic order guarantees.
  //   `over`     a page past its box is a PDF that does not print.
  //   `orphans`  an orphaned heading is the failure mode the atom contract was built to kill.
  // Ranking `gapSq` above `orphans` was measured too and rejected: +68 orphans over the same
  // 4,000 shapes to move the mean worst-page fill 53.0 -> 53.2.
  const better = (a, b) =>
    a.pages !== b.pages ? a.pages < b.pages
      : a.orphans !== b.orphans ? a.orphans < b.orphans
        : a.over !== b.over ? a.over < b.over
          : a.gapSq !== b.gapSq ? a.gapSq < b.gapSq
            : a.splits !== b.splits ? a.splits < b.splits
              : a.used > b.used;

  const best = new Array(n + 1).fill(null);
  best[n] = { pages: 0, orphans: 0, splits: 0, over: 0, gapSq: 0, used: 0, next: n };

  for (let i = n - 1; i >= 0; i--) {
    const box = boxOf(i);
    let used = 0;
    let pick = null;
    for (let j = i; j < n; j++) {
      used += costOf(j);
      // A page carrying more than one atom may not exceed its box — plus, at most, the slack
      // the renderer has said it can reclaim from that page's own bottom furniture. A single
      // atom taller than its own page still gets that page: losing content is never an option.
      if (used > box + slack && j > i) break;
      const orphan = j + 1 < n && atoms[j].glue ? 1 : 0;
      if (orphan && j !== i) continue;      // glue may only be broken to stand alone on a page
      const rest = best[j + 1];
      const gap = gapOf(box, used);                 // px this page leaves below the floor, final page included
      const cand = {
        pages: rest.pages + 1,
        orphans: rest.orphans + orphan,
        splits: rest.splits + (j + 1 < n && atoms[j].soft ? 1 : 0),
        over: rest.over + (used > box ? 1 : 0),
        gapSq: rest.gapSq + gap * gap,
        used,
        next: j + 1,
      };
      if (!pick || better(cand, pick)) pick = cand;
    }
    best[i] = pick;
  }

  const pages = [];
  for (let i = 0; i < n; i = best[i].next) pages.push({ start: i, contBarSec: contBarSecOf(i) });
  return { breaks: pages.slice(1).map((p) => p.start), pages };
}

/**
 * WHAT HAS TO COME OUT, AND FROM WHERE — read off the packing that just ran (bd-a8veu.1).
 *
 * The over-cap defect used to say only *"teach needs 5 pages; the cap is 4. Cut it."* That is
 * stated in a unit the author cannot measure: nothing in an `lp_doc` is a page, and the author
 * has no renderer, so "cut it" carries neither a QUANTITY nor a LOCUS. The revision prompt
 * already tells the model the right THEORY — pages are spent on card count, so remove whole
 * items — and then hands it a defect with no number to aim at.
 *
 * Everything the number needs was already measured a few lines above: the packer ran on real
 * per-atom heights, and every atom knows the section it belongs to. So the advice is READ, not
 * estimated — this function computes nothing the layout did not already decide.
 *
 * Two deliberate choices:
 *
 *   - A BLOCK is a deletable atom. A section BAR (`first`) is furniture the author never writes
 *     as an item, so it is not counted as something to cut — but its height IS counted, because
 *     emptying a section takes its bar with it.
 *   - An atom with no `sec` is page 1's masthead — hero, sequence strip, outcomes, resources.
 *     That is the teacher's at-a-glance card, not the author's to delete, so it is never named
 *     as a place to cut from.
 *
 * @returns null when the layout cannot support the claim — which is the whole point of the
 *   guard. A message that invents arithmetic is worse than the blunt one it replaced.
 */
function overCapAdvice(atoms, pages, cap, titles = {}) {
  if (!Array.isArray(atoms) || !Array.isArray(pages) || !atoms.length) return null;
  if (!(cap >= 1) || pages.length <= cap) return null;
  const from = pages[cap] && pages[cap].start;
  if (!(from > 0) || from >= atoms.length) return null;

  const costOf = (j) => atoms[j].h + (j === 0 ? 0 : atoms[j].mt || 0);
  const deletable = (a) => !a.first;

  let px = 0;
  let blocks = 0;
  for (let j = from; j < atoms.length; j++) {
    px += costOf(j);
    if (deletable(atoms[j])) blocks += 1;
  }

  const bySec = new Map();
  atoms.forEach((a, j) => {
    if (!a.sec) return;
    const e = bySec.get(a.sec) || { sec: a.sec, title: titles[a.sec] || null, blocks: 0, px: 0 };
    if (deletable(a)) e.blocks += 1;
    e.px += costOf(j);
    bySec.set(a.sec, e);
  });
  const sections = [...bySec.values()].sort((x, y) => y.px - x.px);
  if (!sections.length) return null;

  return { blocks, px: Math.round(px), totalBlocks: atoms.filter(deletable).length, sections };
}

/** How many of the tallest sections the defect names. Enough to choose between, short enough to read. */
const ADVICE_SECTIONS = 3;

/**
 * The over-cap defect, in whichever of its two forms the layout can actually support.
 *
 * The section is named by its KEY first, because that is what the author addresses in the
 * document; the printed heading is added only when it says something the key does not — which
 * on the support page is always, since those keys are bar letters (`p2-D`) and nothing else.
 */
function overCapProblem(part, n, cap, advice, ctx) {
  // WHICH LESSON (bd-blxml). The defect used to name a part and a number, so a wave of 335
  // renders reported 335 indistinguishable sentences. `ctx.stem` is the render stem -- the key
  // the exemption list is written on, so the operator can act on the message by editing one
  // line. `ctx` is optional, and a call without it is BYTE-IDENTICAL to the sentence G6-12 has
  // always had; that is asserted in tests/lp612/primary-page-cap-exemptions.test.js.
  const who = ctx && ctx.stem ? `${ctx.stem}: ` : "";
  // AN EXEMPTION OUTGROWN IS ITS OWN DEFECT, and it must not read like an ordinary over-cap: the
  // lesson HAS a licence and has outgrown it. Saying so is the only thing standing between a
  // height-bound list and a blanket amnesty nobody notices going stale.
  const tail = ctx && ctx.exempt
    ? ` ${ctx.stem} is listed in page_cap_exemptions.json at ${ctx.exempt} pages and now needs ${n}. `
      + `That list licences a KNOWN height, not any height: either bring it back to ${ctx.exempt}, `
      + `or re-measure the corpus and regenerate the list (regen_cap_exemptions.py).`
    : "";
  const plain = `PAGE COUNT: ${who}${part} needs ${n} pages; the cap is ${cap}. Cut it, or move content to the other part.${tail}`;
  if (!advice) return plain;
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const name = (s) => (s.title && norm(s.title) !== norm(s.sec) ? `${s.sec} "${s.title}"` : s.sec);
  const top = advice.sections
    .slice(0, ADVICE_SECTIONS)
    .map((s) => `${name(s)} ${s.blocks} blocks/${s.px}px`)
    .join(", ");
  return `PAGE COUNT: ${who}${part} needs ${n} pages; the cap is ${cap}.${tail} `
    + `The ${advice.blocks} block(s) past the cap are ${advice.px}px of content, out of ${part}'s ${advice.totalBlocks} — `
    + `that is what has to come out, and a BLOCK is the unit: shortening the prose inside a block removes no page. `
    + `Tallest sections in ${part}: ${top}. `
    + `Cut whole blocks from the tallest, or move them to the other part.`;
}

/**
 * THE SOFT TARGET, SAID TO SOMEONE — bd-a8veu.22.
 *
 * There have always been two numbers per part: the hard cap, above which the render FAILS, and a
 * soft target one page below it. Only the cap ever did anything. This sentence went into
 * `report.warnings`, which nothing reads on the success path, and it said *"Allowed —
 * completeness beats page count — but check nothing is padding"* — an instruction to no one, and
 * the opposite of the one the operator wants.
 *
 * The measured consequence: the only length pressure in the system fired at the hard cap and
 * pushed a document back to exactly the hard cap, so every lesson converged there. Four sandbox
 * renders on 2026-09-12 across four subjects and two grades came out at exactly 7 pages — 4 teach
 * + 3 support — all four.
 *
 * Two things change here and nothing else:
 *
 *   1. It carries the `PAGE TARGET:` code, which the author ladder prices exactly like
 *      `PAGE COUNT:` — ONE revision round, then deliver (`PAGE_COUNT_ROUND_BUDGET`).
 *   2. It carries the same per-block arithmetic the over-cap defect carries, read off the packing
 *      that just ran, because "shorten it" in a unit the author cannot measure is what produced
 *      shortened sentences and the same page count.
 *
 * WHAT DOES NOT CHANGE: it is a WARNING, not a `problem`. The render succeeds, the PDF is
 * written, the lesson is delivered. A plan that stays a page long is a delivered plan, exactly as
 * it is today — the last clause says so out loud, because the author is also being told elsewhere
 * never to drop a required property to save space.
 */
function overTargetWarning(part, n, target, cap, advice) {
  const head = `PAGE TARGET: ${part} runs to ${n} pages; the soft target is ${target} (hard cap ${cap}). `;
  const tail = "This is a TARGET, not the cap: the lesson renders and is delivered either way.";
  if (!advice) {
    return head + `Aim for ${target}: cut whole blocks, or move them to the other part. ` + tail;
  }
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const name = (s) => (s.title && norm(s.title) !== norm(s.sec) ? `${s.sec} "${s.title}"` : s.sec);
  const top = advice.sections
    .slice(0, ADVICE_SECTIONS)
    .map((s) => `${name(s)} ${s.blocks} blocks/${s.px}px`)
    .join(", ");
  return head
    + `The ${advice.blocks} block(s) past the target are ${advice.px}px of content, out of ${part}'s ${advice.totalBlocks} — `
    + `that is what would have to come out, and a BLOCK is the unit: shortening the prose inside a block removes no page. `
    + `Tallest sections in ${part}: ${top}. `
    + `Cut whole blocks from the tallest, or move them to the other part. `
    + tail;
}

/**
 * The v8 signature, kept because it is the honest description of the degenerate case
 * (no glue, no per-section bars) and because the packer's oldest regression tests speak it.
 */
function computeBreaks(heights, capacity, contHeight = 0) {
  const atoms = heights.map((h) => ({ h, mt: 0, glue: false, soft: false, sec: null, first: false }));
  return packAtoms(atoms, capacity, { strip: contHeight }).breaks;
}

// HORIZONTAL CLIP (bd-km7vu). The vertical half of the probe below has always reported
// overflowPx/overflowingSections; nothing checked the horizontal axis, which is how a TO
// PREPARE material chip (`.mi{ white-space:nowrap; }` inside `.page{ overflow:hidden }`) could
// grow wider than its container and lose everything past the page's right edge with no signal
// anywhere in <stem>.render.json. pdftotext on the produced PDF proved the text was genuinely
// gone, not merely off-screen.
//
// `scrollWidth > clientWidth` (beyond a 1px rounding tolerance) is the standard DOM signal for
// "this element's own content is wider than the box it was given". The clipped chip's OWN box
// does not carry that signal — white-space:nowrap just grows the chip's box to fit its unwrapped
// text, so the chip never overflows itself — the signal appears on whichever ANCESTOR actually
// has a constrained width (`.mlist`, `.rmat`, `.pad`, potentially `.page`). That is why every
// element on the page is scanned, not just text-bearing leaves or `[data-sec]` atoms.
//
// Kept as a standalone, exported, pure function (duck-typed on {scrollWidth, clientWidth,
// className, tagName, textContent} — the same surface a real Element exposes) so it has a real
// Node unit test despite this repo's Jest running `testEnvironment: 'node'` with no jsdom
// installed (tests/jest.config.js). The in-page PROBE below embeds this exact function body via
// `.toString()` rather than a hand-copied duplicate, so there is one algorithm, never two that
// can drift apart — same pattern as `underfilledPages` (see tests/lp612/underfilled-pages-report.test.js).
function clippedXFromElements(pageId, elements) {
  const out = [];
  for (const el of elements) {
    const sw = el.scrollWidth, cw = el.clientWidth;
    if (cw > 0 && sw - cw > 1) {
      out.push({
        page: pageId,
        selector: String(el.className || el.tagName || '').slice(0, 80),
        scrollWidth: sw,
        clientWidth: cw,
        text: String(el.textContent || '').trim().slice(0, 60),
      });
    }
  }
  return out;
}

// The in-page probe. Runs after fonts.ready; returns geometry + the smallest
// computed body-text size, so the phone gate can assert D4 without re-rendering.
const PROBE = `() => {
  const BODY_SEL = '.pad p, .pad li, .q, .a, .prompt, .res, .part';   // read in the room -> 18px
  const CHIP_SEL = '.kw, .op, .lf, .how, .tier, .kind, figcaption, .src, .cont, .marking, .tnote, .refq, .slocode, .seq, .hw .tag, .cite';  // chrome -> 14px
  const pages = [];
  let minBody = Infinity, minBodySample = null, minAny = Infinity, minChip = Infinity, minChipSample = null;
  for (const el of document.querySelectorAll('*')) {
    const t = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
    if (!t) continue;
    if (el.closest('.katex')) continue;           // KaTeX scripts are legitimately small
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < minAny) minAny = fs;
    if (el.matches(CHIP_SEL)) { if (fs < minChip) { minChip = fs; minChipSample = (el.className||el.tagName)+' :: '+el.textContent.trim().slice(0,40); } continue; }
    if (el.matches(BODY_SEL) && fs < minBody) {
      minBody = fs;
      minBodySample = (el.className || el.tagName) + ' :: ' + el.textContent.trim().slice(0, 48);
    }
  }
  for (const page of document.querySelectorAll('.page')) {
    const pad = page.querySelector('.pad');
    const pageBottom = page.getBoundingClientRect().bottom;
    const over = [];
    for (const el of page.querySelectorAll('[data-sec]')) {
      const r = el.getBoundingClientRect();
      const parent = el.parentElement;
      const pr = parent ? parent.getBoundingClientRect() : r;
      const bottom = Math.max(r.bottom, pr.bottom);
      if (bottom > pageBottom + 1) over.push({ sec: el.dataset.sec, overBy: Math.round(bottom - pageBottom) });
    }
    // Overflow is measured from the LAST PAINTED PIXEL, not from scrollHeight: .pad is a
    // flex column whose footer carries margin-top:auto, and scrollHeight over-reports that
    // auto margin by a few px. What matters is whether anything is drawn past the page's
    // inner bottom edge — that is what a clipped LP looks like.
    const cs = getComputedStyle(pad);
    const innerBottom = pageBottom - parseFloat(cs.paddingBottom);
    let lastBottom = 0, lastWhat = null, contentBottom = 0;
    for (const el of pad.querySelectorAll('*')) {
      if (!el.getClientRects().length) continue;
      const b = el.getBoundingClientRect().bottom;
      if (b > lastBottom) { lastBottom = b; lastWhat = (String(el.className) || el.tagName).slice(0, 40); }
      // FILL is measured over CONTENT only. Since v8.1 every page carries a footer pinned to
      // the page floor by margin-top:auto, so the last painted pixel is always the footer and
      // a naive fill reads 100% on a page that is two thirds white. That is the exact
      // illusion the operator asked us to stop having.
      if (!el.closest('.foot') && b > contentBottom) contentBottom = b;
    }
    // See clippedXFromElements above (bd-km7vu) — embedded by source so the in-browser scan and
    // the unit-tested predicate never drift apart. Reporting only: this never fails the render.
    const clippedX = (${clippedXFromElements.toString()})(page.id, page.querySelectorAll('*'));
    pages.push({
      id: page.id,
      part: page.dataset.part,          // which part a page ends is the fill floor's exemption
      contentHeight: Math.round(pad.scrollHeight),
      boxHeight: Math.round(pad.clientHeight),
      lastPaintedPx: Math.round(lastBottom - page.getBoundingClientRect().top),
      contentBottomPx: Math.round(contentBottom - page.getBoundingClientRect().top),
      footTopPx: Math.round((pad.querySelector('.foot') ? pad.querySelector('.foot').getBoundingClientRect().top : innerBottom) - page.getBoundingClientRect().top),
      innerBottomPx: Math.round(innerBottom - page.getBoundingClientRect().top),
      lastElement: lastWhat,
      overflowPx: Math.max(0, Math.round(lastBottom - innerBottom)),
      overflowingSections: over,
      clipped_x: clippedX,
    });
  }
  const byPart = {};
  for (const page of document.querySelectorAll('.page')) {
    byPart[page.dataset.part] = (byPart[page.dataset.part] || 0) + 1;
  }
  return {
    pageCount: document.querySelectorAll('.page').length,
    pagesByPart: byPart,
    minBodyFontPx: minBody === Infinity ? null : Math.round(minBody * 100) / 100,
    minBodySample,
    minAnyFontPx: minAny === Infinity ? null : Math.round(minAny * 100) / 100,
    minChipFontPx: minChip === Infinity ? null : Math.round(minChip * 100) / 100,
    minChipSample,
    pages,
  };
}`;

// VENDOR DIVERGENCE (SYNC §3.14). `geom` is the page box this render lays out on, and it is
// passed IN rather than read from the module. `PAGE` is destructured at require time, so once
// the format became selectable the imported binding froze on whatever the FIRST build used —
// a viewport and a PDF box silently disagreeing with the `@page` rule in the HTML. It comes
// from `buildHtml`'s return value, which is the only thing that knows what was actually built.
async function renderWithPlaywright(pw, htmlPath, outPdf, outPngStem, wantPng, repaginate, pdfMeta, geom = PAGE) {
  const channel = chromeChannel();
// VENDOR DIVERGENCE (see SYNC.md, "container launch flags"): two flags that matter only on a
  // container, and only under load (bd-v60qf).
  //   --disable-dev-shm-usage : a container's /dev/shm defaults to 64MB; Chromium keeps its
  //     shared memory there and a 9-page A4 render with embedded fonts and SVG diagrams exhausts
  //     it. The tab dies mid-render and it surfaces as "the render failed", with no readable
  //     out-of-memory anywhere — the worst shape of failure this pipeline can have.
  //   --no-sandbox : the sandbox needs kernel privileges the Railway container does not grant,
  //     without which the browser can fail to start at all.
  // Harmless on a dev box, which is exactly why nothing on a laptop would ever catch their absence.
  const LAUNCH_ARGS = ['--no-sandbox', '--disable-dev-shm-usage'];
  const browser = await pw.chromium.launch(
    channel ? { channel, args: LAUNCH_ARGS } : { args: LAUNCH_ARGS },
  );
  try {
    const page = await browser.newPage({ viewport: { width: geom.w, height: geom.h }, deviceScaleFactor: 2 });
    const load = async (p) => {
      await page.goto("file://" + p + "?t=" + Date.now(), { waitUntil: "load" });
      await page.evaluate("document.fonts.ready.then(function(){return true;})");
      await page.emulateMedia({ media: "print" }); // screen layout under-reports print height
      await page.waitForTimeout(120);
    };
    await load(htmlPath);

    // PASS 1 — measure, compute the breaks, rewrite the file, reload. Pagination is
    // therefore derived from real layout, never from a word-count estimate.
    if (repaginate) {
      const m = await page.evaluate(`(${MEASURE})()`);
      const P = m.probe || {};
      const footH = P.__foot ? P.__foot.h + P.__foot.mt : 0;
      const strip = P.__strip ? P.__strip.h : 0;
      const contBar = {};
      for (const [k, v] of Object.entries(P)) if (!k.startsWith("__")) contBar[k] = v.h + v.mt;
      // every page now carries a footer, so the usable box is the page box less that footer
      const capacity = repaginate.capacity - footH;
      const furn = { strip, contBar };
      const withMeta = (part) =>
        (m.parts[part] || []).map((b, i) => Object.assign({}, b, repaginate.atoms[part][i] || {}));
      // The packer is allowed to spend the same page-bottom furniture the absorber below
      // reclaims — and only to remove a page (bd-c3le6). The two numbers are ONE constant on
      // purpose: a packer allowed more slack than the absorber can pay for would manufacture
      // the very OVERFLOW this all exists to stop.
      const packOpts = { slack: OVERFLOW_ABSORB_MAX_PX };
      const teachAtoms = withMeta("teach");
      const supportAtoms = withMeta("support");
      const teach = packAtoms(teachAtoms, capacity, furn, packOpts);
      const support = packAtoms(supportAtoms, capacity, furn, packOpts);
      const breaks = { teach: teach.breaks, support: support.breaks };
      const rebuilt = repaginate.rebuild(breaks);
      fs.writeFileSync(htmlPath, rebuilt.html);
      await load(htmlPath);
      repaginate.warnings = rebuilt.warnings;
      repaginate.figureProblems = rebuilt.figureProblems;
      repaginate.figureRepairs = rebuilt.figureRepairs;
      repaginate.breaks = breaks;
      repaginate.furniture = { footer_px: footH, cont_strip_px: strip, cont_bar_px: contBar, capacity_px: capacity };
      // The layout the packer actually produced, MEASURED rather than estimated — the pages it
      // chose, and the atoms it chose them from, each carrying its real height and the section
      // it belongs to. The probe below re-reads the page count from the real render as a
      // cross-check; this is the only place the PER-BLOCK arithmetic behind it exists, and the
      // over-cap defect below is written from it (bd-a8veu.1).
      repaginate.packed = {
        teach: { pages: teach.pages, atoms: teachAtoms },
        support: { pages: support.pages, atoms: supportAtoms },
      };
    }
    // evaluate() treats a string as an EXPRESSION — a bare arrow function would come
    // back as an unserializable function object (silently undefined). Call it.
    let probe = await page.evaluate(`(${PROBE})()`);

    // bd-c3le6: a furniture-sized overflow is absorbed into the page's own bottom whitespace
    // and the lesson ships. Done HERE, before the PDF is printed, so the file the teacher
    // opens is the one that was re-probed — and the re-probe, not the plan, is what decides:
    // if absorbing did not clear it, `overflowPx` is still non-zero and the OVERFLOW defect
    // below fires exactly as it did before.
    let absorbed = [];
    const plan = absorbPlan(probe.pages);
    if (plan.length) {
      absorbed = (await page.evaluate(`(${ABSORB})(${JSON.stringify(plan)})`)) || [];
      probe = await page.evaluate(`(${PROBE})()`);
    }

    let pdfPages = null;
    if (outPdf) {
      // NO PAGE RANGE. A range — frozen OR cap-derived — is silent data loss: Chrome drops
      // the surplus pages, the teacher's PDF just ends, and the cross-check then blames
      // "a splitting block". A cap-derived "1-5" ate 2 whole teach pages of the G6 Islamiat
      // plan and both G10 Urdu support pages in the 2026-08-30 sample run.
      // The renderer emits EVERY page the packer laid out; going over the cap is reported
      // below as a loud PAGE COUNT failure. Cutting a long plan is an authoring decision.
      const buf = await page.pdf({ width: `${geom.w}px`, height: `${geom.h}px`, printBackground: true });
      // The internal identifiers the footer no longer prints live HERE instead — visible to
      // the pipeline (and in File > Properties), invisible to the teacher.
      fs.writeFileSync(outPdf, pdfMeta ? setInfo(buf, pdfMeta) : buf);
      pdfPages = pdfPageCount(buf);
    }
    if (wantPng) {
      const els = await page.$$(".page");
      for (let i = 0; i < els.length; i++) {
        await els[i].screenshot({ path: `${outPngStem}-p${i + 1}.png` });
      }
    }
    return { probe, pdfPages, absorbed, breaks: repaginate ? repaginate.breaks : null,
             furniture: repaginate ? repaginate.furniture : null,
             packed: repaginate ? repaginate.packed : null };
  } finally {
    await browser.close();
  }
}

function renderWithChromeCli(htmlPath, outPdf) {
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "lp8-"));
  execFileSync(CHROME_CLI_BIN, [
    "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
    `--user-data-dir=${tmp}`,
    `--print-to-pdf=${outPdf}`, "--virtual-time-budget=6000",
    "file://" + htmlPath,
  ], { stdio: "ignore" });
  return { probe: null, pdfPages: pdfPageCount(fs.readFileSync(outPdf)) };
}

/**
 * VENDOR DIVERGENCE (see SYNC.md, "programmatic entry"): upstream had only a CLI `main()`
 * that called `process.exit()`. A long-lived worker cannot shell into a function that kills
 * the process, and shelling OUT to `node render_lp.js` would put a subprocess and a
 * stdout-parse between the caller and its errors. So `main()` was split: everything that does
 * work now lives in `renderDoc()`, which RETURNS its findings, and `main()` is the thin CLI
 * shell that prints them and picks an exit code. No render logic was changed in the split.
 *
 * @param {object} a  { doc: path, out?, stem?, lang?, png?, pdf?, quiet? }
 * @returns {Promise<{report, problems, warnings, htmlPath, pdfPath, pagesByPart, probe}>}
 * @throws  Error with .code 'SCHEMA_INVALID' | 'OVERLAY_INVALID' and .errors[]
 */
async function renderDoc(a) {
  if (!a || !a.doc) {
    const e = new Error("renderDoc needs { doc: <path to lp_doc.json> }");
    e.code = "NO_DOC";
    throw e;
  }
  const docPath = path.resolve(a.doc);
  const raw = JSON.parse(fs.readFileSync(docPath, "utf8"));

  const v = validateDoc(raw);
  if (!v.ok) {
    const e = new Error("SCHEMA INVALID — refusing to render:\n  " + v.errors.join("\n  "));
    e.code = "SCHEMA_INVALID";
    e.errors = v.errors;
    throw e;
  }

  const lang = a.lang || raw.provenance.medium || "en";
  const { doc, applied, errors: ovErrors } = applyOverlay(raw, lang);
  if (ovErrors.length) {
    const e = new Error("ur_overlay errors — refusing to render:\n  " + ovErrors.join("\n  "));
    e.code = "OVERLAY_INVALID";
    e.errors = ovErrors;
    throw e;
  }

  const outDir = path.resolve(a.out || path.join(path.dirname(docPath), "..", "out"));
  fs.mkdirSync(outDir, { recursive: true });
  const stem = a.stem || path.basename(docPath).replace(/\.(lp\.)?json$/i, "") + (lang === "ur" && raw.provenance.medium !== "ur" ? "_ur" : "");

  // v8.1: what the page no longer prints, the FILE still carries. `lesson_id`, `book_stem`
  // and `schema_version` are pipeline keys, so they go into the PDF's Info dictionary and
  // the render report — never into the teacher's footer.
  const pdfMeta = {
    Title: `${raw.provenance.topic} — Grade ${raw.provenance.grade} ${raw.provenance.subject}`,
    Subject: `lesson_id=${raw.lesson_id}; book_stem=${raw.provenance.book_stem}; pp.${raw.provenance.printed_pages}`,
    Keywords: `${raw.provenance.book_stem}; ${raw.lesson_id}; lp_doc ${raw.schema_version}; ${raw.lp_type}; lang=${lang}` +
      (raw.provenance.version ? `; v${raw.provenance.version}` : ""),
    Creator: (raw.provenance.brand && raw.provenance.brand.name) || "lp_html v8.1",
  };

  const pw = loadPlaywright();
  // VENDOR DIVERGENCE (SYNC §3.14). `format` rides on EVERY buildHtml call, the first one and
  // the repaginating rebuild alike: the rebuild re-enters the template, so omitting it there
  // would reset the geometry to the default halfway through a two-pass render.
  const format = a.format || "phone";
  let built = buildHtml(doc, { lang, docDir: path.dirname(docPath), probeCont: !!pw, format });
  const { warnings, fontReport, pageContentHeight, hasRasterFigure } = built;
  let figureProblems = built.figureProblems || [];
  // bd-oak77.14 — the figures the layout had to WIDEN to keep legible. Reported, never inferred:
  // a repair nobody can count is a fallback that masks itself (rule 24(b)).
  let figureRepairs = built.figureRepairs || [];
  const htmlPath = path.join(outDir, `${stem}.html`);
  fs.writeFileSync(htmlPath, built.html);

  const pdfPath = a.pdf ? path.join(outDir, `${stem}.pdf`) : null;
  let result;
  if (pw) {
    const repaginate = {
      capacity: pageContentHeight,
      atoms: built.atoms,
      rebuild: (breaks) => buildHtml(doc, { lang, docDir: path.dirname(docPath), breaks, format }),
    };
    result = await renderWithPlaywright(pw, htmlPath, pdfPath, path.join(outDir, stem), a.png, repaginate, pdfMeta, built.page);
    if (repaginate.warnings) { warnings.length = 0; warnings.push(...repaginate.warnings); }
    if (repaginate.figureProblems) figureProblems = repaginate.figureProblems;
    if (repaginate.figureRepairs) figureRepairs = repaginate.figureRepairs;
  } else {
    console.error("! playwright-core unavailable — falling back to Chrome CLI (no overflow probe, no PNGs)");
    result = pdfPath ? renderWithChromeCli(htmlPath, pdfPath) : { probe: null, pdfPages: null };
  }

  // ── report ────────────────────────────────────────────────────────────────
  const problems = [...figureProblems];   // an illegible or over-tall figure is a FAILURE,
                                          // never something the renderer quietly shrinks
  const probe = result.probe;
  if (probe) {
    for (const p of probe.pages) {
      if (p.overflowPx > 1) {
        const where = p.overflowingSections.length
          ? p.overflowingSections.map((s) => `${s.sec} (+${s.overBy}px)`).join(", ")
          : `last painted element: ${p.lastElement}`;
        problems.push(`OVERFLOW on ${p.id}: content is ${p.overflowPx}px taller than the page. Offending: ${where}`);
      }
    }
    if (probe.minBodyFontPx != null && probe.minBodyFontPx < BODY_FLOOR_PX) {
      problems.push(`TYPE FLOOR: smallest body text is ${probe.minBodyFontPx}px (<${BODY_FLOOR_PX}px) — ${probe.minBodySample}`);
    }
    if (probe.minChipFontPx != null && probe.minChipFontPx < CHIP_FLOOR_PX) {
      problems.push(`TYPE FLOOR: smallest chip/label is ${probe.minChipFontPx}px (<${CHIP_FLOOR_PX}px) — ${probe.minChipSample}`);
    }
  }
  const byPart = (probe && probe.pagesByPart) || {};
  // The stem is the exemption key; `pageCapsFor` looks it up itself, and it is looked up once
  // more here only so the message can say an exemption was OUTGROWN rather than merely exceeded.
  // PRIMARY ONLY, and that includes the MESSAGE. Naming the lesson is an improvement G6-12 would
  // want too, but its defect text is read by a different wave with its own log parsers, and a
  // G1-5 page-cap ruling is not the thing that should change it. `capCtx` is undefined off the
  // primary path, which makes `overCapProblem` fall through to the byte-identical old sentence.
  const capExempt = isPrimary(doc) ? exemptionFor(stem) : null;
  const CAPS = pageCapsFor(lang, doc, format, stem);
  for (const [part, cap] of Object.entries(CAPS.max)) {
    const n = byPart[part] || 0;
    if (n > cap) {
      // The per-block advice is only ever written from a packing that AGREES with the render.
      // The Chrome-CLI fallback has no measure pass at all, and a probe that counts different
      // pages from the packer means something else has already gone wrong — in both cases the
      // defect falls back to the blunt sentence rather than quote arithmetic it cannot stand
      // behind.
      const p = result.packed && result.packed[part];
      const advice = p && p.pages.length === n
        ? overCapAdvice(p.atoms, p.pages, cap, built.secTitles || {})
        : null;
      problems.push(overCapProblem(part, n, cap, advice, isPrimary(doc)
        ? { stem, exempt: part === "teach" && capExempt ? capExempt.teach : null }
        : null));
    } else if (CAPS.warn[part] && n > CAPS.warn[part]) {
      const target = CAPS.warn[part];
      const p = result.packed && result.packed[part];
      const advice = p && p.pages.length === n
        ? overCapAdvice(p.atoms, p.pages, target, built.secTitles || {})
        : null;
      warnings.push(overTargetWarning(part, n, target, cap, advice));
    }
  }
  const pagesBuilt = (byPart.teach || 0) + (byPart.support || 0);
  // A SHORT pdf and a LONG one are opposite bugs and used to share one misleading message.
  // Short = the teacher loses the end of the lesson — the most expensive defect this
  // renderer can ship, so it is named for what it is.
  if (result.pdfPages != null && pagesBuilt && result.pdfPages < pagesBuilt) {
    problems.push(`TRUNCATION: the PDF has ${result.pdfPages} page(s) but the layout built ${pagesBuilt} — ${pagesBuilt - result.pdfPages} page(s) of the lesson are MISSING from the file. The renderer must never emit fewer pages than the packer laid out.`);
  } else if (result.pdfPages != null && pagesBuilt && result.pdfPages > pagesBuilt) {
    problems.push(`PAGE COUNT: the PDF has ${result.pdfPages} page(s) but the layout built ${pagesBuilt}. A block is splitting across a page break.`);
  }
  // Chrome-CLI fallback has no per-part probe, so the per-part caps above cannot fire. Guard
  // the total there so a runaway build is still caught rather than shipped.
  if (!pagesBuilt && result.pdfPages != null && result.pdfPages > CAPS.max.teach + CAPS.max.support) {
    problems.push(`PAGE COUNT: PDF has ${result.pdfPages} pages; the cap is ${CAPS.max.teach + CAPS.max.support}.`);
  }

  const report = {
    lesson_id: doc.lesson_id,
    lang,
    overlay_applied: applied,
    // bd-c3le6. WHAT WAS ABSORBED IS RECORDED, always, as a list. A silent fallback is a
    // regression mask (rule 24(b)): if this ever starts firing on half the corpus, the packer
    // has drifted again and the number has to be the thing that says so, not a clean-looking
    // render. `[]` on a clean document, never absent.
    overflow_absorbed: result.absorbed || [],
    // bd-oak77.14. `[]` on a document whose figures all fitted — never absent.
    figure_repairs: figureRepairs,
    overflow_absorb_max_px: OVERFLOW_ABSORB_MAX_PX,
    html: path.relative(REPO_ROOT, htmlPath),
    pdf: pdfPath ? path.relative(REPO_ROOT, pdfPath) : null,
    pdf_pages: result.pdfPages,
    pages_by_part: (probe && probe.pagesByPart) || null,
    max_pages: CAPS.max,
    warn_pages: CAPS.warn,
    // bd-blxml. WHICH CAP APPLIED, and why it was not 8. `max_pages` alone cannot distinguish a
    // lesson licensed to 21 from a renderer whose cap has quietly moved; the audit that
    // regenerates this list has to be able to tell those apart from the reports alone. `null`
    // on the 295 that need no licence, never absent.
    page_cap_exemption: capExempt,
    has_raster_figure: !!hasRasterFigure,
    has_vector_figure: !!built.hasVectorFigure,
    page_breaks: result.breaks || null,
    furniture_px: result.furniture || null,
    cont_strip_px: result.furniture ? result.furniture.cont_strip_px : null,
    // MEASURED fill, not estimated. The operator's target is "no page under ~85% except the
    // last page of each part"; this is the number that says whether we hit it.
    page_fill_pct: probe && probe.pages
      ? probe.pages.map((p) => ({ id: p.id, fill: Math.round((100 * p.contentBottomPx) / p.footTopPx) }))
      : null,
    // bd-5jaag. The pages the packer could NOT lift over the floor, last-page-of-part exempt.
    // `[]` on a clean document, never absent: this is the number that says the packer has
    // stopped reaching, and the fix for those is authoring, not pagination.
    underfilled_pages: underfilledPages(probe && probe.pages),
    fill_target_pct: FILL_TARGET_PCT,
    pdf_metadata: pdfMeta,
    fonts_embedded: fontReport.resolved,
    fonts_missing: fontReport.missing,
    probe,
    warnings,
    problems,
  };
  const reportPath = path.join(outDir, `${stem}.render.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  return { report, reportPath, problems, warnings, htmlPath, pdfPath,
           pagesByPart: byPart, probe, pdfPages: result.pdfPages, figureRepairs };
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.doc) {
    console.error("usage: node render_lp.js <lp_doc.json> [--out DIR] [--stem NAME] [--lang en|ur] [--format phone|a4] [--png] [--no-pdf]");
    process.exit(2);
  }
  let out;
  try {
    out = await renderDoc(a);
  } catch (e) {
    if (e.code === "SCHEMA_INVALID" || e.code === "OVERLAY_INVALID" || e.code === "BAD_FORMAT") {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
  const { report, problems, warnings, htmlPath, pdfPath, probe, pdfPages } = out;
  const byPart = out.pagesByPart || {};
  const doc = { lesson_id: report.lesson_id };
  const lang = report.lang;
  if (!a.quiet) {
    console.log(`${doc.lesson_id}  [${lang}]  ->  ${path.relative(process.cwd(), pdfPath || htmlPath)}`);
    if (probe) {
      for (const p of probe.pages) {
        const fill = Math.round((100 * p.contentBottomPx) / p.footTopPx);
        console.log(`  ${p.id}: content ${p.contentBottomPx}px / box ${p.footTopPx}px = ${fill}% full` +
          (p.overflowPx > 0 ? `  ** CLIPPED by ${p.overflowPx}px (${p.lastElement}) **` : "  ok"));
      }
      console.log(`  pages: teach ${byPart.teach || 0}/${report.max_pages.teach} \u00b7 support ${byPart.support || 0}/${report.max_pages.support}`);
      console.log(`  smallest body ${probe.minBodyFontPx}px (floor ${BODY_FLOOR_PX}) · smallest chip ${probe.minChipFontPx}px (floor ${CHIP_FLOOR_PX}) · PDF pages: ${pdfPages}`);
    }
    for (const w of warnings) console.log(`  ! ${w}`);
  }
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(problems.length ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e.stack || String(e));
    process.exit(1);
  });
}

// Exported for test/run_tests.js — the packer is the new core logic and needs its own cover.
// `renderDoc` and `chromeChannel` are vendor additions (see SYNC.md).
module.exports = { renderDoc, chromeChannel, computeBreaks, packAtoms, packAtomsGreedy,
  overCapAdvice, overCapProblem,
  PAGE,
  MAX_PAGES, WARN_PAGES, MAX_PAGES_UR, WARN_PAGES_UR, pageCapsFor, isPrimary,
  MAX_PAGES_PRIMARY, WARN_PAGES_PRIMARY, MAX_PAGES_PRIMARY_UR, WARN_PAGES_PRIMARY_UR,
  exemptionFor,
  absorbPlan, OVERFLOW_ABSORB_MAX_PX,
  underfilledPages, FILL_TARGET_PCT,
  BODY_FLOOR_PX, CHIP_FLOOR_PX,
  clippedXFromElements };
