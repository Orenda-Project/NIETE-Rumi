#!/usr/bin/env node
// lint_lp.js — the deterministic gate. No LLM, no judgement, no "probably".
//
//   node lint_lp.js <lp_doc.json> [<lp_doc.json> ...] [--json] [--auto-send]
//
// --auto-send means "about to reach a teacher with no human in the loop". It promotes the
// needs_human_review warning to a hard failure (skill gate G5c: Islamiat and سیرت content
// is never served on-demand).
//
// WORD BUDGETS — MEASURED, not asserted, and re-measured after the page cap moved.
//
// Operator decision (2026-08-30, floor raised again 2026-09-01): the body floor is the hard
// constraint, so the PAGE CAP gives instead. The floor went 16.5px -> 18px because 16.5 still
// did not read on a phone, and the caps went 4+3 -> 5+4 pages to pay for it. A deliberate font
// increase is not bloat: the same words simply need more paper.
//
// WHAT THIS MEANS FOR THE BUDGETS BELOW: nothing. A word budget describes CONTENT VOLUME, and
// the golden fixture's content did not change when its type did — it is the same 1,399 words,
// now filling 5 teach + 4 support pages instead of 4 + 3. Re-measured after the type change,
// the ceiling is the same number for a bigger page allowance. Re-deriving it to a different
// value would have been arithmetic theatre.
//
// These numbers are the word counts of samples/g7_science_photosynthesis.lp.json, measured
// with lib/rich.js wordCount:
//
//     warmup 51 · introduction 64 · development 162 · activity 227 · conclusion 76 ·
//     homework 38 · objectives 26 · page2 511   ->   1,155 words total
//
// Reproduce the layout side with `node test/measure_sections.js <rendered.html>`; the render
// report's `page_breaks` and `pages_by_part` record where the pagination actually fell.
//
// Tolerance is +/-30%. OVER budget FAILS — it will not fit, and the renderer proves it.
// UNDER budget only WARNS: short is allowed (operator, 2026-08-30), and §6's own finding is
// that teachers cut the tail of a long plan first.
//
// Urdu needs no discount on these counts: Nastaliq's unitless line-height >= 2.0 means an Urdu
// page carries ~2/3 the lines of an English one at the same font size, and that cost is paid in
// PAGES, not words — render_lp.js gives an Urdu render its own caps (teach 7 / support 5 against
// English's 5 / 4; operator, 2026-09-03: "keep the same word limit (though pages can be a bit
// more to allow for decent urdu spacing)"). One set of word budgets for both languages: an Urdu
// plan says no more than an English one; it only breathes more.
// What survives the cut is §6's own ranking 1-8 (practice with answers, worked example,
// prerequisite check, misconception, board question, exit ticket + re-teach rule). What goes
// is length, not elements.

const fs = require("fs");
const path = require("path");
const { validateDoc } = require("./lib/validate");
const { frozenReason } = require("./lib/overlay");
const { wordCount, chemPlusDefects, fixChemPlus } = require("./lib/rich");
const { buildHtml } = require("./lib/template");
const { textNodes } = require("./lib/domtext");
const { allQuestions, questionIndex, duplicateRefs } = require("./lib/questions");
const { check: visualContract } = require("./visual_check");

// Brands that must never appear as CONTENT in a document that is not theirs (render-law 13,
// carried by the judges as J-BRAND-LEAK, critical). The authoring house is not the deployment
// brand: an ICT teacher opening a NIETE PDF must not read another company's product name.
const FOREIGN_BRANDS = [
  { re: /\bRumi\b/i, name: "Rumi" },
  { re: /\bTaleemabad\b/i, name: "Taleemabad" },
];

const SECTION_BUDGET = {
  warmup: 50,
  introduction: 62,
  development: 160,
  activity: 225,
  conclusion: 72,
  homework: 36,
};
// v9 moved content between sections, so the budgets move with it — never against it. The
// introduction absorbs the warm-up (62+50); the conclusion gains the board question, its mark
// scheme, the exit ticket and the re-teach rule; homework gains the tagged items themselves.
// The TOTAL is unchanged, which is the only number the page cap actually cares about.
// These are DERIVED, not measured — v9 is too new to have a measured corpus, and saying so is
// the honest version. They are the v8 numbers plus the content v9 moved into each section:
// the introduction absorbs the warm-up, development gains the textbook citation and the video
// slot, the conclusion gains the board question + mark scheme + exit ticket + re-teach rule,
// and homework gains the tagged items themselves. THE FIT PROOF IS STILL THE RENDERER: these
// catch a section that has run away, and render_lp.js's measured page cap catches the rest.
// MEASURED, now that a full-cap v9 document exists. The golden (at the hard cap — 4+3 pages at
// 16.5px, 5+4 at the 18px floor it now carries) counts
// intro 154 · dev 160 · activity 259 · conclusion 150 · homework 134; the gate
// fixture, a maths lesson, counts intro 147 · dev 219 · activity 129 · conclusion 92 · hw 123.
// Each budget takes the LARGER of the two, because the Development/Activity split is a SUBJECT
// property — maths spends its words on the I-do, biology on the investigation — and a budget
// derived from one subject fails the other. The section budgets bound the DISTRIBUTION; the doc
// ceiling bounds the SIZE. Their sums deliberately do not agree.
//
// OPTION B, 2026-09-02 (bd-avd51). The review pack put two ways of resolving the v9 page overflow
// to the operator: A = raise the caps to 6 teach / 5 support, B = HOLD 5/4 and cut the words.
// The operator chose B, verbatim: "Hold 5/4, cut word budgets ~15% (to ~1,100–1,200) -- I think
// the homework questions could be reduced somewhat? Learning outcomes take up the whole first
// page, could also be reduced?"
//
// So every section below is the pre-Option-B number scaled ~15% down — EXCEPT homework, which is
// cut ~30%, because the ask there was fewer ITEMS and not merely shorter ones (HW_ITEM_COUNT
// caps the count; this caps their words). The page caps themselves do not move: they live in
// render_lp.js and phone_gate.py and Option B is precisely the decision not to touch them.
//
//     intro 154 -> 131 · development 220 -> 187 · activity 260 -> 221 ·
//     conclusion 150 -> 128 · homework 135 -> 95
const SECTION_BUDGET_V9 = {
  introduction: 131,
  development: 187,
  activity: 221,
  conclusion: 128,
  homework: 95,
};

// ── the O box's own ceiling (Option B, second half) ─────────────────────────
// "Learning outcomes take up the whole first page, could also be reduced?" — measured across the
// ten fleet samples the outcome + ✓ by-the-end line + objectives run 70-120 words, median 92, and
// they are the first thing printed. Until now nothing bounded them: docWords counts the
// objectives' text and has never counted the outcome sentence or the by-the-end line at all, so
// the box could grow without moving any number the gate could see. These are HARD ceilings, not
// ±30% targets — the box is four short fields and there is nothing to distribute.
const OUTCOME_BOX_V9 = {
  outcome: 20,       // the outcome sentence: what the pupil can DO, in one line
  by_the_end: 22,    // the ✓ line naming the question type and its marks
  objective: 15,     // EACH objective
  total: 80,         // the whole box, because three legal fields can still fill a page
};
// Homework: the operator asked for fewer questions. Five is the cap, four is the shape the fleet
// samples already settled on. This is a different count from the you-do + exit-ticket graded bar
// (6-8 items) in §8 of the brief, which is classwork and is unchanged.
const MAX_HOMEWORK_ITEMS = 5;
const TOLERANCE = 0.3;
const DOC_BUDGET = { min: 700, max: 1250 }; // whole doc, all four pages — MEASURED capacity
// v9 carries more per plan and packs to a bigger cap. MEASURED off the golden:
// lp_v9/golden/PK_G9_BIO_CH1_BIOMETHOD_OBS_HYP_v9.lp.json is 1,399 words and renders at exactly
// the hard cap — 4+3 pages at the old 16.5px floor, 5+4 at the 18px floor it now carries. So
// 1,400 was not a convention with headroom, it was the largest v9 document that fits.
//
// 1,400 -> 1,200 (Option B, operator, 2026-09-02). 1,400 words fit the CAPS but not the PAGES:
// measured across all ten fleet samples, teach ran 5-7 pages against the 5-cap because v9 content
// is diagram- and table-heavy and words under-predict paper. Given the choice between raising the
// caps and cutting the words, the operator held the caps. Measured doc totals on the day of the
// decision were 1,257-1,357 (median 1,343), so 1,200 is a real ~11-15% cut and not a rounding.
// The FLOOR is unchanged at 800: it was never derived from the ceiling — it is the "under two
// pages of teach content" thinness line, and short only ever warns.
const DOC_BUDGET_V9 = { min: 800, max: 1200 };
// The masthead badge. Handed over by the print-quality work, 2026-09-02: the broken hero headers
// were uncapped AUTHOR-WRITTEN badges — an 82-code-point board_weight ("FBISE SSC-I Biology ·
// examinable in Section A (MCQ) and Section B (short-response)") pushed the G9 Bio masthead out of
// shape. The template is robust to it now; this is the content-side belt to that braces, because
// the real defect is a badge written as a sentence. "FBISE SSC-I · ~5 marks" is the shape.
//
// COUNTED IN CODE POINTS. Half this corpus is Urdu and a cap counted in UTF-16 units is the exact
// class of bug that took /language down for hours.
const MAX_BOARD_WEIGHT = 50;
const FDE_ORDER = ["introduction", "development", "activity", "conclusion", "homework"];
const MAX_ACTIVITIES = 7;

const PLACEHOLDERS = [
  { re: /\bTODO\b/i, name: "TODO" },
  { re: /\bFIXME\b/i, name: "FIXME" },
  { re: /\blorem ipsum\b/i, name: "lorem ipsum" },
  { re: /\bTBD\b/, name: "TBD" },
  { re: /\bXXX\b/, name: "XXX" },
  { re: /<[Nn]>|<[A-Za-z_]{1,12}>/, name: "<placeholder>" },
  { re: /\[\s*\]/, name: "empty [ ]" },
  { re: /\[ڈبہ\]/, name: "[ڈبہ] (untranslated box marker)" },
  { re: /#[0-9A-Fa-f]{6}\b/, name: "raw hex colour code" },
  { re: /\bINSERT\b|\bPLACEHOLDER\b/i, name: "INSERT/PLACEHOLDER" },
];

// ── string harvesting ───────────────────────────────────────────────────────
/** Every human-readable string in a value, with a JSON-Pointer-ish path. */
function harvest(node, at = "", out = []) {
  if (typeof node === "string") out.push({ at, s: node });
  else if (Array.isArray(node)) node.forEach((v, i) => harvest(v, `${at}/${i}`, out));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) harvest(v, `${at}/${k}`, out);
  }
  return out;
}

/** Every block in a section, including the children of a `split`. */
function allBlocks(blocks, out = []) {
  for (const b of blocks || []) {
    out.push(b);
    if (b.type === "split") { allBlocks(b.left, out); allBlocks(b.right, out); }
  }
  return out;
}

/** Words in a section's v9 EXTRAS — the checkpoint, exit ticket, re-teach rule and the tagged
 *  homework items. They are printed inside the section, so they must be budgeted with it. */
function extraWords(sec) {
  let n = 0;
  if (sec.checkpoint) {
    n += wordCount(sec.checkpoint.question);
    n += (sec.checkpoint.mark_scheme || []).reduce((a, m) => a + wordCount(m), 0);
  }
  for (const x of sec.exit_ticket || []) n += wordCount(x.q) + wordCount(x.a);
  if (sec.reteach_rule) n += wordCount(sec.reteach_rule);
  if (sec.homework) for (const it of sec.homework.items || []) n += wordCount(it.text);
  return n;
}

const sectionWords = (sec) =>
  harvest(sec.blocks).reduce((n, x) => n + (["support", "core", "extension", "guided", "independent"].includes(x.s) ? 0 : wordCount(x.s)), 0);

function docWords(doc) {
  const warm = warmupOf(doc);
  let n = (warm.items || []).reduce((a, i) => a + wordCount(i.q) + wordCount(i.a), 0);
  n += objectiveTexts(doc).reduce((a, o) => a + wordCount(o), 0);
  // EVERY word printed in a section, not just its blocks. v9 moved ~250 words per plan into
  // section-level DATA — the checkpoint and its mark scheme, the exit ticket, the re-teach
  // rule, the tagged homework items — and counting blocks alone made the "whole document"
  // number a lie by exactly that much. The golden fixture measured 1,155 by the old count and
  // 1,399 by this one, at the same 4+3 pages; only the second number can be compared against a
  // page capacity. Found while reconciling author_lp.py's Python lint against this file.
  n += doc.sections.reduce((a, s) => a + sectionWords(s) + extraWords(s), 0);
  n += harvest(doc.page2).reduce((a, x) => a + wordCount(x.s), 0);
  return n;
}

// ── shape helpers: one lint, two document shapes ────────────────────────────
// A 2.0 doc keeps its top-level warm-up and its array of objective strings; a 3.0 doc puts
// the warm-up inside the introduction and the objectives in the O box. Rather than branch at
// every use, the two shapes are read through these.
const isV3 = (doc) => doc && doc.schema_version === "3.0";
function warmupOf(doc) {
  if (!isV3(doc)) return doc.warmup || { items: [] };
  const intro = (doc.sections || []).find((s) => s.id === "introduction");
  return (intro && intro.warmup) || { items: [] };
}
function objectiveTexts(doc) {
  if (!isV3(doc)) return doc.objectives || [];
  return ((doc.objectives && doc.objectives.items) || []).map((o) => o.text);
}
/** The SLO codes this LP actually taught — the O box's, plus the plan's own. */
function taughtSlos(doc) {
  const out = new Set();
  if (doc.slo && doc.slo.code) out.add(String(doc.slo.code).trim());
  for (const o of (doc.objectives && doc.objectives.items) || []) {
    if (o.slo_code) out.add(String(o.slo_code).trim());
  }
  return out;
}
const sectionById = (doc, id) => (doc.sections || []).find((s) => s.id === id);

// ── the checks ──────────────────────────────────────────────────────────────
function lint(doc, docPath, opts = {}) {
  const F = [];
  const W = [];
  const fail = (code, msg) => F.push(`${code}: ${msg}`);
  const warn = (code, msg) => W.push(`${code}: ${msg}`);
  const profile = doc.lint_profile || "full";
  const full = profile === "full";
  const grade = doc.provenance ? doc.provenance.grade : null;

  // 0 — schema
  const v = validateDoc(doc);
  if (!v.ok) {
    for (const e of v.errors) fail("SCHEMA", e);
    return { fails: F, warns: W, profile }; // nothing below is trustworthy on an invalid doc
  }

  // 1 — the minutes are a promise. PACING_SUM on a v9 doc; MINUTES on the 2.0 corpus, which
  //     still carries the warm-up as a band of its own.
  const v3 = isV3(doc);
  const warm = warmupOf(doc);
  const mins = (v3 ? 0 : (doc.warmup.minutes || 0)) + doc.sections.reduce((a, s) => a + s.minutes, 0);
  if (mins !== doc.period_minutes) {
    fail(v3 ? "PACING_SUM" : "MINUTES",
      `the sections sum to ${mins} min but period_minutes is ${doc.period_minutes}. A ${mins}-minute plan against a ${doc.period_minutes}-minute claim is a hard fail (spec §4) — and the pacing line the teacher reads prints that sum.`);
  }
  if (v3) {
    // "0 min" on homework. The expert's mark-up: a badge that says the work costs nothing is
    // how homework ends up assigned in the corridor. Setting it and re-teaching against it are
    // the same act. (Format-doc §4's own example prints a 0 here; the expert's review and the
    // team sheet both call it a defect, so the reviewer sign-off list wins — see REPORT.)
    const hw = sectionById(doc, "homework");
    if (hw && !hw.minutes) {
      fail("PACING_SUM", "homework carries a 0-minute badge. Setting homework and reading it back takes time; give it its minutes and take them from a section that has slack.");
    }
  }

  // 2 — <= 7 activities (anything demanding pupil action: warm-up + every
  //     worked/faded/practice/support-extension block). A plan with more is a plan
  //     whose tail gets cut.
  const ACT_TYPES = new Set(["worked_example", "faded_example", "practice", "support_extension"]);
  const activities = 1 + doc.sections.reduce((a, s) => a + allBlocks(s.blocks).filter((b) => ACT_TYPES.has(b.type)).length, 0);
  if (activities > MAX_ACTIVITIES) {
    fail("ACTIVITIES", `${activities} activities (warm-up + ${activities - 1} blocks); the cap is ${MAX_ACTIVITIES}.`);
  }

  // 3 — the SLO is real, verbatim and sourced (R2)
  if (!doc.slo.text_verbatim || !doc.slo.text_verbatim.trim()) fail("SLO", "slo.text_verbatim is empty.");
  if (!doc.slo.source_page || !String(doc.slo.source_page).trim()) fail("SLO", "slo.source_page is missing — a verbatim quote must carry its page.");
  if (doc.slo.code === undefined) warn("SLO", "slo.code absent. Use null and say so in the objective when the book prints no code — never invent one.");

  // 4 — warm-up. v9: it lives inside the Introduction and the SCAFFOLD FOR TODAY COMES FIRST.
  //     "Prior knowledge alone is not a warm-up" (spec §3 I) — a set of prerequisite items
  //     that never reaches today's concept is the shape the Grade 8 English teacher rejected.
  const wu = warm.items || [];
  wu.forEach((it, i) => {
    if (!it.a || !it.a.trim()) fail("WARMUP", `item ${i + 1} has no answer. Every closed item is solved.`);
  });
  if (full && v3) {
    if (wu.length < 3) fail("WARMUP", `${wu.length} warm-up items; the spec wants a scaffold, a prerequisite and a spaced-review item.`);
    if (!wu.length || wu[0].kind !== "scaffold") {
      fail("WARMUP", `the first warm-up item is "${wu.length ? wu[0].kind : "missing"}", not "scaffold". The step that sets up TODAY'S concept comes first — prior knowledge alone is not a warm-up (spec §3 I).`);
    }
    if (!wu.some((i) => i.kind === "prerequisite")) fail("WARMUP", "no item is tagged prerequisite.");
    if (!wu.some((i) => i.kind === "spaced")) fail("WARMUP", "no item is tagged spaced — the retrieval item is missing.");
  } else if (full) {
    if (wu.length !== 3) fail("WARMUP", `${wu.length} warm-up items; the spec is exactly 3 (2 prerequisite + 1 spaced).`);
    const pre = wu.filter((i) => i.kind === "prerequisite").length;
    const sp = wu.filter((i) => i.kind === "spaced").length;
    if (pre !== 2 || sp !== 1) fail("WARMUP", `kinds are ${pre} prerequisite / ${sp} spaced; the spec is 2 + 1.`);
  }

  // 5 — the FDE spine, in order
  const ids = doc.sections.map((s) => s.id);
  if (full && JSON.stringify(ids) !== JSON.stringify(FDE_ORDER)) {
    fail(v3 ? "HEADINGS" : "SPINE", `sections are [${ids.join(", ")}]; the closed heading system is [${FDE_ORDER.join(", ")}], in that order (spec §2).`);
  }

  // 6 — the hook is a provocation, in the introduction (M3)
  const hooks = doc.sections.flatMap((s) => allBlocks(s.blocks).filter((b) => b.type === "ask" && b.hook).map((b) => ({ s: s.id, b })));
  if (hooks.length !== 1) {
    fail("HOOK", `${hooks.length} blocks marked hook:true; there must be exactly 1.`);
  } else {
    const { s, b } = hooks[0];
    if (s !== "introduction") fail("HOOK", `the hook sits in "${s}"; it belongs in the introduction.`);
    const q = b.question.trim();
    const isQuestion = /[?؟]\s*$/.test(q);
    const isCase = /\b(case|scenario|mystery|puzzle|imagine|suppose|consider)\b/i.test(q) ||
      /(کیس|معمہ|فرض کریں|تصور کریں|سوچیے)/.test(q);
    if (!isQuestion && !isCase) {
      fail("HOOK", `the hook is neither a question nor a case — it must end with "?" or pose a scenario. Got: "${q.slice(0, 70)}"`);
    }
    if (!b.look_for) warn("HOOK", "the hook has no look_for; the teacher is left guessing what a good answer contains.");
  }

  // 7 — a named misconception lives in the development
  const dev = doc.sections.find((s) => s.id === "development");
  if (full) {
    if (!dev) fail("MISCONCEPTION", "no development section, so no misconception could be checked.");
    else {
      const mis = allBlocks(dev.blocks).filter((b) => b.type === "watch_out");
      if (!mis.length) fail("MISCONCEPTION", "development carries no watch_out block. Naming the predictable wrong answer is the highest-leverage single check.");
      else if (!mis.some((b) => b.misconception)) {
        warn("MISCONCEPTION", "development has a watch_out but none is flagged misconception:true.");
      }
    }
  }

  // 8 — every closed item is solved
  for (const s of doc.sections) {
    for (const b of allBlocks(s.blocks)) {
      if (b.type === "practice") {
        b.items.forEach((it, i) => {
          if (!it.a || !it.a.trim()) fail("PRACTICE", `${s.id}: practice item ${i + 1} has no answer.`);
        });
      }
      if (b.type === "faded_example" && !b.answer) {
        fail("PRACTICE", `${s.id}: faded_example has no answer — the blanked steps must resolve somewhere.`);
      }
    }
  }

  // 9 — exam bank, grades 9-12 (FBISE's remit starts at SSC)
  const eb = doc.page2.exam_bank || {};
  if (full && grade >= 9) {
    if (!eb.mcq || eb.mcq.length < 2) fail("EXAM", `grade ${grade} needs >= 2 distractor-coded MCQs; found ${(eb.mcq || []).length}.`);
    (eb.mcq || []).forEach((q, i) => {
      const wrong = q.options.length - 1;
      if (!q.distractor_codes || q.distractor_codes.length < wrong) {
        fail("EXAM", `MCQ ${i + 1}: ${(q.distractor_codes || []).length} distractor codes for ${wrong} wrong options. A distractor that encodes nothing is a wasted distractor.`);
      }
    });
    if (!eb.srq || !eb.srq.mark_scheme || !eb.srq.mark_scheme.length) fail("EXAM", `grade ${grade} needs one board-phrased SRQ with a bullet mark scheme.`);
    if (!eb.erq_skeleton || !(eb.erq_skeleton.parts || []).length) fail("EXAM", `grade ${grade} needs an ERQ skeleton with parts and marks.`);
  } else if (full && grade >= 6) {
    if (!eb.mcq || eb.mcq.length < 2) warn("EXAM", `grade ${grade}: only ${(eb.mcq || []).length} MCQ(s). 2-3 is the retrieval-practice dose even below SSC.`);
    if (!eb.srq) warn("EXAM", `grade ${grade}: no SRQ. The board-phrasing habit starts before grade 9.`);
  }
  if (doc.board_weight) {
    const n = [...String(doc.board_weight)].length;
    if (n > MAX_BOARD_WEIGHT) {
      fail("BOARD_WEIGHT", `board_weight is ${n} code points; the cap is ${MAX_BOARD_WEIGHT}. It is a BADGE in the masthead, not a sentence — "FBISE SSC-I · ~5 marks", not a description of the paper. An 82-character badge is what broke the G9 Bio hero header. Got: "${String(doc.board_weight).slice(0, 60)}"`);
    }
  }
  if (grade != null && grade < 9 && doc.board_weight) {
    warn("EXAM", `board_weight is set on a grade-${grade} plan; FBISE's examining remit begins at SSC. Use null.`);
  }

  // 10 — no placeholders anywhere
  for (const { at, s } of harvest(doc)) {
    // /provenance/brand/primary_hex is a colour BY DEFINITION — the raw-hex rule exists to
    // catch a hex that leaked into teacher-facing prose, not to police a config field.
    if (at.startsWith("/revisions") || at.startsWith("/provenance/brand")) continue;
    for (const p of PLACEHOLDERS) {
      if (p.re.test(s)) fail("PLACEHOLDER", `${at || "/"} contains ${p.name}: "${s.slice(0, 60)}"`);
    }
  }

  // 10b — RENDER-LAW 13: no brand but the deployment's own may appear as content.
  //       The renderer used to hardcode "Rumi" into the hero kicker and the footer of every
  //       page; that is fixed, but a brand name can still arrive through an authored string,
  //       and this is the gate that catches it. A doc with NO brand is white-label: it may
  //       carry no brand name at all.
  {
    const ownBrand = (doc.provenance && doc.provenance.brand && doc.provenance.brand.name) || "";
    for (const { at, s } of harvest(doc)) {
      if (at.startsWith("/revisions") || at.startsWith("/provenance/brand")) continue;
      for (const b of FOREIGN_BRANDS) {
        if (!b.re.test(s)) continue;
        if (ownBrand && b.re.test(ownBrand)) continue;   // it IS this document's brand
        fail("BRANDLEAK", `${at || "/"} names "${b.name}"${ownBrand ? `, but this document's brand is "${ownBrand}"` : ", and this document carries no brand (white-label)"}. Render-law 13: no internal brand — the company's, the product's or a partner's — appears as content. Found in: "${s.slice(0, 60)}"`);
      }
    }
  }

  // 10c — mhchem: a `+` welded to the species on its right is read as an ionic CHARGE, so
  //       `\ce{2H2+O2->2H2O}` prints H₂⁺O₂ — wrong chemistry, rendered without complaint.
  //       28 equations in one authored sample were affected. WARN, because `lint_lp.js --fix`
  //       repairs it mechanically and a false positive must never block a render.
  for (const { at, s } of harvest(doc)) {
    if (at.startsWith("/revisions")) continue;
    // A `chem` block's tex IS a \ce body — but a `latex` block's tex is not, and reading one as
    // the other reported a phantom charge in every matrix product (the `+` in "ap+br").
    const isLatexBody = /\\begin\{|\\frac|\\\\/.test(s);
    const bare = /\/tex$/.test(at) && !/\\ce\{/.test(s) && !isLatexBody;
    for (const body of chemPlusDefects(s, bare)) {
      warn("CHEM", `${at || "/"}: \\ce{${body.slice(0, 50)}} has a "+" with no spaces around it — mhchem reads that as an ionic charge, not an operator. Run \`node lint_lp.js --fix <doc>\`.`);
    }
  }

  // 10d — a diagram that cannot render its own labels at 13.5px in the column it is given.
  //       Checked here as well as in the renderer so an author finds out before a build.
  if (full) {
    let renderDiagram = null, requiredBox = null, checkOverlaps = null;
    try {
      renderDiagram = require("./diagrams").renderDiagram;
      requiredBox = require("./diagrams/lib/svg").requiredBox;
      checkOverlaps = require("./diagrams").checkOverlaps;
    } catch (_) { /* engine absent — the renderer still checks */ }
    if (renderDiagram && requiredBox) {
      const FULL_COL = 794 - 22 * 2 - (10 * 2 + 3);   // 727px, per lib/template.js
      for (const s of doc.sections) {
        for (const b of allBlocks(s.blocks)) {
          if (b.type !== "diagram") continue;
          try {
            // The doc's own language decides how the diagram is drawn (an ur
            // overlay renders the same spec through the Nastaliq path), so the
            // spec is checked in the language it will actually ship in.
            const svg = renderDiagram(
              b.spec.lang || !opts.lang ? b.spec : { ...b.spec, lang: opts.lang }
            );
            const box = requiredBox(svg, { minPx: 13.5, colPx: FULL_COL });
            if (box.renderedPx != null && box.renderedPx < 13.5) {
              fail("FIGURE", `${s.id}: diagram "${b.spec.type}" renders its smallest label at ${box.renderedPx}px even at full width (floor 13.5px). It needs ${box.minWidthPx}px — simplify it or split it in two.`);
            }
            // 10e — ZERO overlaps. A label under a box, two labels on each
            //       other, or a rule through a label is a build failure, not a
            //       nit: it is unreadable on the page and it is what shipped in
            //       the G9 Bio ur mindmap. checkOverlaps reads the emitted SVG.
            if (checkOverlaps) {
              const ov = checkOverlaps(svg);
              if (ov.length) {
                fail(
                  "DIAGRAM_OVERLAP",
                  `${b.id || s.id} ${ov.length} — diagram "${b.spec.type}" has ${ov.length} colliding pair(s): ` +
                    ov.slice(0, 4).map((o) => `${o.kind} ${o.a} vs ${o.b} (${o.detail})`).join("; ")
                );
              }
            }
          } catch (_) { /* an unrenderable diagram is already reported by the renderer */ }
        }
      }
    }
  }

  // 11 — word budgets
  if (full) {
    const wuWords = (warm.items || []).reduce((a, i) => a + wordCount(i.q) + wordCount(i.a), 0);
    if (!v3 && wuWords) budget("warmup", wuWords);
    // v9 folds the warm-up into the introduction's budget, because that is where it is printed.
    for (const s of doc.sections) budget(s.id, sectionWords(s) + (v3 && s.id === "introduction" ? wuWords : 0) + extraWords(s));
    const total = docWords(doc);
    const DB = v3 ? DOC_BUDGET_V9 : DOC_BUDGET;
    if (total > DB.max) {
      fail("BUDGET", `whole document is ${total} words; the MEASURED page capacity at the 18px body floor is ${DB.min}-${DB.max}.`);
    } else if (total < DB.min) {
      warn("BUDGET", `whole document is ${total} words against a ${DB.min}-${DB.max} capacity — under two pages of teach content. Short is allowed; this is a nudge, not a gate.`);
    }
  }
  function budget(id, n) {
    const t = (v3 ? SECTION_BUDGET_V9 : SECTION_BUDGET)[id];
    if (!t) return;
    const lo = Math.round(t * (1 - TOLERANCE));
    const hi = Math.round(t * (1 + TOLERANCE));
    // Over budget FAILS (it will not fit). Under budget only WARNS — short is allowed.
    if (n > hi) fail("BUDGET", `${id} is ${n} words; the budget is ${t} ±30% (${lo}-${hi}). Over the top of the range it will not fit the page.`);
    else if (n < lo) warn("BUDGET", `${id} is ${n} words against a budget of ${t} (${lo}-${hi}). Short is allowed — but check the section is not thin.`);
  }

  // 12 — the one-screen WhatsApp body
  const os = wordCount(doc.one_screen);
  if (full && (os < 150 || os > 260)) fail("ONESCREEN", `one_screen is ${os} words; the WhatsApp body is ~200 (150-260).`);

  // 13 — the Urdu toggle may not overwrite the book's own language
  for (const ptr of Object.keys(doc.ur_overlay || {})) {
    const why = frozenReason(doc, ptr);
    if (why) fail("OVERLAY", `${ptr} may not be overlaid — ${why}.`);
  }

  // 14 — visuals are mandatory (M5/R1); a bare-bones LP was named as a failure
  const visuals = doc.sections.reduce(
    (a, s) => a + allBlocks(s.blocks).filter((b) => ["diagram", "textbook_figure", "latex", "chem"].includes(b.type)).length, 0);

  // 14a — a book crop's labels are pixels, and pixels do not survive a phone downscale. The
  //       `legend` is how the figure's content reaches the teacher as real, readable text, so it
  //       is mandatory. (This is what lets the phone gate treat a sub-floor run as advisory.)
  for (const s of doc.sections) {
    for (const b of allBlocks(s.blocks)) {
      if (b.type === "textbook_figure" && b.src && !b.legend) {
        fail("FIGURE", `${s.id}: a textbook_figure with a real crop must carry a \`legend\` — its labels are baked pixels and vanish at phone scale.`);
      }
    }
  }

  // 14b — a split may hold only CARDS. D4 forbids side-by-side body text, and a nested split
  // makes columns narrow enough that wrapping breaks the type floor.
  const NO_SPLIT = new Set(["paragraph", "practice", "worked_example", "faded_example", "split"]);
  for (const s of doc.sections) {
    for (const b of allBlocks(s.blocks)) {
      if (b.type !== "split") continue;
      for (const child of [...b.left, ...b.right]) {
        if (NO_SPLIT.has(child.type)) {
          fail("SPLIT", `${s.id}: a split may not contain a "${child.type}" — that is body text, and D4 forbids side-by-side body columns.`);
        }
      }
    }
  }
  // 14c — THE VISUAL CONTRACT (brief §4b), the per-subject minimum.
  //
  // `visuals === 0` below is the rule this REPLACES on a v9 document, and it is worth naming
  // what it was: it counts a `latex` or a `chem` block as a visual, so ONE typeset formula and
  // no picture at all satisfies it. `author_lp.py` calls that same rule its ImportError
  // fallback and says of it, in the source, *"exactly how they shipped 'bereft' of diagrams."*
  // Between 2026-09-02 and 2026-09-04 it was the ONLY visual rule the serving lane executed,
  // because `visual_check.py` was never vendored beside it — while the brief told the model on
  // every call that the real gate was running on its output. Replayed over the 62 documents
  // teachers received, the real gate fails 48 of them and its per-subject minimum (V6) fires 45
  // times; live output was 1.77 diagrams a lesson against a floor of 2, 83.5% of them
  // flow/mindmap/panels, with nine of the twenty types never appearing once.
  //
  // Scoped to v3 for the same reason every other v9 gate is (see §18): the 2.0 corpus predates
  // this contract and would turn red overnight without one of its lessons improving. A 2.0
  // document keeps the old floor; a 3.0 document gets the contract INSTEAD, so exactly one
  // authority speaks about visuals per document and the two never double-report the same miss.
  if (full && v3) {
    for (const e of visualContract(doc)) fail("VISUAL", e);
  } else if (full && visuals === 0) {
    fail("VISUALS", "page 1 carries no diagram, figure or formula. Visuals are mandatory (M5).");
  }

  // 15 — the hook must be CLOSED. The most repeated v7 complaint was an opening question
  //      the lesson never answers (L3 ask 3).
  if (full && hooks.length === 1) {
    const cb = hooks[0].b.closed_by;
    if (!cb) {
      (v3 ? fail : warn)("HOOKCLOSE", "the hook names no closed_by. Teachers' single most repeated v7 complaint was an opening question the lesson never answers — point at the block that resolves it.");
    } else {
      const later = doc.sections.filter((s) => s.id === "development" || s.id === "conclusion");
      const found = later.some((s) => allBlocks(s.blocks).some((b) => b.id === cb));
      if (!found) fail("HOOKCLOSE", `the hook's closed_by "${cb}" matches no block id in development or conclusion.`);
      // v9, spec §3 D: Development "closes the hook explicitly in its FIRST SENTENCE". So the
      // closing beat is development's first block, and it says so with closes_hook.
      else if (v3 && dev) {
        const first = dev.blocks[0] || {};
        if (first.id !== cb) {
          fail("HOOKCLOSE", `the hook is closed by "${cb}", but development opens with ${first.id ? `"${first.id}"` : `a ${first.type}`}. Development must close the hook in its first sentence (spec §3 D).`);
        } else if (!first.closes_hook) {
          fail("HOOKCLOSE", `development's first block answers the hook but does not carry closes_hook: true — say so, so the gate can hold the line.`);
        }
      }
    }
  }

  // 16 — the human-review gate (G5c). Islamiat / سیرت never goes out on-demand (L3 ask 2).
  if (doc.needs_human_review) {
    if (opts.autoSend) {
      fail("HUMANREVIEW", `needs_human_review is set${doc.human_review_reason ? ` (${doc.human_review_reason})` : ""} — this LP may not be auto-sent. Route it to the human queue.`);
    } else {
      warn("HUMANREVIEW", `needs_human_review is set${doc.human_review_reason ? ` (${doc.human_review_reason})` : ""}. Fine to render; --auto-send would refuse it.`);
    }
  }
  if (doc.needs_human_review && !doc.human_review_reason) {
    warn("HUMANREVIEW", "needs_human_review is set with no reason. The human picking this up needs to know why.");
  }

  // 17 — a stated ERQ total that disagrees with its parts (L3 ask 7)
  const erq = (doc.page2.exam_bank || {}).erq_skeleton;
  if (erq && erq.marks_total && (erq.parts || []).some((p) => p.marks)) {
    const sum = (erq.parts || []).reduce((a, p) => a + (p.marks || 0), 0);
    if (sum !== erq.marks_total) {
      fail("EXAM", `erq_skeleton.marks_total is ${erq.marks_total} but the parts sum to ${sum}.`);
    }
  }

  // 15b — the reference block must be able to answer everything the flow asked
  if (full && doc.page2.model_answers.length < 2) warn("MODELS", "fewer than 2 model-answer cards; the reference block is meant to answer every tier.");
  if (full && doc.page2.mistakes.length < 3) warn("MISTAKES", `${doc.page2.mistakes.length} mistake/repair pairs; the v7-1 shape teachers recognised carries 3.`);

  // ── DUPLICATE_DIAGRAM ────────────────────────────────────────────────────
  // One lesson, one drawing of any given figure. bd-t1nhp: the operator's first
  // staging maths LP (G8 Ch.7, y = mx + c) printed the SAME two-line graph twice
  // — once in Development, once as the reference page's board_final — eating
  // roughly half a page of paper a teacher pays for.
  //
  // This is an AUTHORING defect, not a render-layer one: `page2.board_final.diagram`
  // is its own authored spec that lib/template.js renders directly, so nothing
  // downstream can tell "deliberately restated" from "pasted twice". Catching it
  // here puts it in front of the revision ladder, which can drop one copy — as
  // opposed to silently de-duplicating at render time, which would quietly
  // discard a figure the author might have meant to vary.
  //
  // Captions are compared OUT: re-wording the caption does not make it a
  // different picture, and both real corpus instances differ only there (or not
  // at all). Anything else that differs IS a different figure and is allowed.
  {
    const PRESENTATIONAL = new Set(["caption", "title", "alt", "note", "source"]);
    const canonical = (v) => {
      if (Array.isArray(v)) return v.map(canonical);
      if (v && typeof v === "object") {
        const out = {};
        for (const k of Object.keys(v).sort()) {
          if (PRESENTATIONAL.has(k)) continue;
          out[k] = canonical(v[k]);
        }
        return out;
      }
      return v;
    };

    const placed = [];
    for (const s of doc.sections || []) {
      for (const b of allBlocks(s.blocks)) {
        if (b && b.type === "diagram" && b.spec && typeof b.spec === "object") {
          placed.push({ where: s.id, spec: b.spec });
        }
      }
    }
    if (doc.page2 && doc.page2.board_final && doc.page2.board_final.diagram) {
      placed.push({ where: "the reference page's board_final", spec: doc.page2.board_final.diagram });
    }

    const groups = new Map();
    for (const p of placed) {
      const key = `${p.spec.type}|${JSON.stringify(canonical(p.spec))}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      const where = g.map((p) => p.where);
      fail(
        "DUPLICATE_DIAGRAM",
        `the same "${g[0].spec.type}" figure is drawn ${g.length} times in this lesson — in ${where.join(" and in ")}. ` +
          `Their specs are identical once captions are set aside, so the teacher pays for the same picture twice and loses the space to something she does not already have. ` +
          `Keep ONE: if the figure belongs in the teaching flow, keep the body copy and let the board page describe the final state in words (draw_order); if it is genuinely the end state of the board, keep the board copy and cut it from the body.`
      );
    }
  }

  // ── 18 — THE V9 GATES ────────────────────────────────────────────────────
  // Everything below is scoped to a 3.0 document ON PURPOSE. The 2.0 corpus predates the
  // closed heading system and has no homework tags, no refs and no scaffold item; running
  // these against it would turn a working corpus into 200 red builds overnight without fixing
  // one of them. A 2.0 doc is migrated, then it is gated.
  if (v3) v9Gates(doc, { fail, warn, full, grade, opts });

  return { fails: F, warns: W, profile };
}

// ── the v9 gate set ─────────────────────────────────────────────────────────
//
// Each of these traces to a defect the expert ringed on a printed Grade 10 determinants LP, or
// to a row in the team's sheet reviews. None of them is a style preference, and none is a
// judge call: every one is decidable from the document or from the page it renders to.

/** Any LaTeX residue in a run of PAINTED text. The gate of record for defect class A. */
const LEAK_PATTERNS = [
  { re: /\$/, what: "a dollar delimiter" },
  { re: /\\(?:begin|end)\{/, what: "a \\begin/\\end environment" },
  { re: /\\[a-zA-Z]{2,}/, what: "a LaTeX control sequence" },
  { re: /\[\s*\[[^\][]*\]\s*,\s*\[/, what: "a Python-style row-list — a matrix is written in LaTeX, never as [[a,b],[c,d]]" },
];
/** The same row-list, findable in the SOURCE so the author gets a pointer, not just a symptom. */
const ROW_LIST = /\[\s*\[[^\][]*\]\s*,\s*\[/;

/** PROSE only — the maths removed. This is what tells a stated question from a notation
 *  fragment, because "Find $AB$ when …" is a question and "$|B|$, $B^{-1}$" is not. */
function normQ(s) {
  return String(s ?? "")
    .replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$/g, " ")
    .replace(/\\[a-zA-Z]+\{[^}]*\}|\\[a-zA-Z]+/g, " ")
    .replace(/\*\*/g, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
/** EVERYTHING that carries meaning, maths included — the normaliser for near-duplicate
 *  detection. Stripping the maths here was a real bug: "Find $AB$ when $A=…$" reduces to
 *  three prose words, and a 4-token floor then skipped every maths item in the corpus, so
 *  DUP_QUESTION could not see a homework item that copied a class item verbatim. The
 *  DELIMITERS and the LaTeX commands go; the numbers and the letters stay. */
function normDup(s) {
  return String(s ?? "")
    .replace(/\\(?:begin|end)\{[^}]*\}/g, " ")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/\*\*/g, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const tokens = (s) => normDup(s).split(" ").filter(Boolean);
function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// A question is WORDED when it frames a task in words. Terse notation — the expert's
// (`fill` added 2026-09-02, found by the Option B fleet re-run: the gate rejected "Fill in
// the blank with a word that keeps this hypothesis tentative…", the commonest exit-ticket
// shape there is. Same class as bd-nx6k6/SP-122 — a gate that fails CORRECT work gets
// routed around, and every verb missing from this list costs a revision round.)
// "|B|, B⁻¹: B = [ … ]" — is not a question, it is a heading over a hole.
const COMMANDS = /\b(find|calculate|work out|show|prove|state|explain|describe|write|evaluate|determine|solve|list|name|define|compare|identify|sketch|draw|verify|simplify|complete|give|say|choose|which|what|why|how|when|where|who|if|given|suppose|consider|add|multiply|divide|subtract|expand|factorise|factorize|convert|measure|label|match|arrange|predict|justify|comment|balance|check|read|use|estimate|plot|select|circle|tick|underline|fill|shade|highlight|order|rank)\b/i;
// An interrogative-auxiliary OPENING is a frame too: "Do two blocks … take the same time?"
// Anchored at the start on purpose — "is"/"do" mid-sentence prove nothing.
const AUX_OPEN = /^(do|does|did|is|are|was|were|can|could|will|would|should|has|have|had)\b/i;
// Standalone کریں/کیجیے is a frame: Urdu imperatives — تجزیہ کریں، پُر کریں، بیان کریں — all end
// in it, and it literally means "do". A quote with no instruction still has no کریں and fails.
// The Urdu list is systematically thinner than the English one and every verb missing from it
// costs a revision round on an Urdu-medium plan. `دیں`/`بنائیں`/`لگائیں`/`ملائیں` added
// 2026-09-02 after the Option B fleet re-run failed "…کی ایک مثال دیں" — a correctly-worded
// imperative — while the near-identical `دیا گیا` was already accepted.
const COMMANDS_UR = /(کریں|کیجیے|کیجئے|بتائیں|بتائیے|لکھیں|لکھیے|کیا|کیوں|کیسے|کون|کس|کہاں|کب|اگر|دیا گیا|دیں|دیجیے|بنائیں|بنائیے|لگائیں|ملائیں|جوڑیں|چنیں|گنیں|سمجھائیں|منتخب|شمار|پڑھیں|سنیں)/;
function unworded(q) {
  const s = String(q ?? "").trim();
  if (!s) return "it is empty";
  const prose = normQ(s);
  const words = prose.split(" ").filter(Boolean);
  // THE TEST IS THE FRAME, NOT THE WORD COUNT. A maths question is mostly maths — "Find $AB$
  // when $A = …$ and $B = …$" leaves three prose words and is a perfectly stated question.
  // What the expert ringed had no frame at all: "|B|, B⁻¹: B = [ … ]" tells the pupil nothing
  // to DO. So: no frame is a fail, and a frame with almost no prose around it is a fail.
  // A colon-terminated STEM is a question too — "A hypothesis must be:" is exactly how the
  // board writes an option-completion MCQ, and rejecting it would fail correct exam phrasing.
  // A question mark counts ANYWHERE (bd-nx6k6): an MCQ stem carries its ? before the options,
  // and "…same time? Check using $t=…$." is framed twice over. The COLON stays end-anchored —
  // a mid-string colon is how notation headers are written, and those must keep failing.
  const framed = /[?؟]/.test(s) || /[:：]\s*$/.test(s) ||
    COMMANDS.test(s) || COMMANDS_UR.test(s) || AUX_OPEN.test(prose);
  if (!framed) return `no interrogative or imperative frame — it does not tell the pupil what to DO ("${prose || s.slice(0, 40)}")`;
  if (words.length < 2) return `only ${words.length} word(s) of prose around the notation ("${prose}")`;
  // "$A^{-1}$ (p.68)" — a citation is a pointer, not a question.
  if (/^[^\p{L}]*\(?p\.?\s*\d+/iu.test(prose) && words.length < 6) return "it is a page citation, not a stated question";
  return null;
}

/** Distractor codes painted where a pupil reads them. Exported so a test can drive it directly. */
function distractorVisible(html, codes) {
  const bad = [];
  for (const n of textNodes(html)) {
    for (const c of codes) {
      if (!c || !n.text.includes(c)) continue;
      if (n.classes.includes("tnote")) continue;      // the teacher note is where it belongs
      bad.push({ code: c, classes: n.classes.join(".") });
    }
  }
  return bad;
}

// The EXPLICIT markers only. A "whole string in quotes" rule was tried and removed: a model
// answer that is a quoted sentence — '"The uncovered tank is the source of the mosquitoes"' —
// is not a script, it is the answer, and the rule failed the golden fixture on it. The `say`
// BLOCK is banned by the schema; this catches the shape smuggled into prose.
// What makes a coaching-corner question a REFLECTION rather than a content quiz: it points at
// her room, her pupils, or her own next move. Deliberately generous — a gate cannot judge the
// quality of a reflection, only tell it apart from "What is the order of the product?", which is
// answerable out of the textbook and tells her nothing about her own teaching.
const REFLECT_MARKERS =
  /\b(my|i|i'?ll|i'?d|we|we'?ll|our|myself|pupils?|students?|children|child|class|classroom|group|groups|girls|boys|row|rows|next time|next lesson|tomorrow|again|re-?teach|re-?taught|before the test|who|which of them)\b/i;
const REFLECT_MARKERS_UR =
  /(میں|میر[ےیا]|اپن[ےیا]|ہم|بچ[ےو]|بچوں|طلبہ|طالب|جماعت|کلاس|کمرہ|کل|اگل[ےی]|دوبارہ|پھر سے|کس کو|کون سے)/;

// ── RELIGIOUS_MARKS — the mechanical half of brief §4c ──────────────────────
//
// Operator, 2026-09-02: "For religion (Islamiyat) make sure Allah is typed correctly, honorifics
// for Prophet, and his companions should be appropriate, no impersonation of prophet or stuff of
// that sort should exist."
//
// Everything below is DECIDABLE — a missing ﷺ, a transliterated sacred name, a companion
// honorified in one line and bare in the next, prophetic speech with no hadith behind it. The
// judgement half is not automatable and is not attempted: §4c's `needs_human_review` hold stands
// and `--auto-send` still refuses these documents. The gate says so in its own message, because
// a green build is precisely what would otherwise be mistaken for clearance.
//
// LONGEST FIRST. "نبی" is a substring of "نبی کریم", and scanning short-first reports a missing
// honorific on every correctly-honorified mention in the corpus.
const PROPHET_TOKENS = [
  "سرورِ کائنات", "پیغمبر اسلام", "رسولِ اکرم", "رسول اللہ", "رسول کریم",
  "نبی کریم", "نبی اکرم", "نبی پاک", "آں حضرت", "آنحضرت", "حضور اکرم",
  "محمد", "حضور", "نبی",
].sort((a, b) => b.length - a.length);
const PROPHET_RE = new RegExp(PROPHET_TOKENS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
// The honorific may be the ligature or spelled out, and a comma or a quote may sit between.
const HONORIFIC_RE = /^[\s،۔:'"’”)(‏]{0,3}(ﷺ|صل[یى]\s*الل[ہه]\s*عليه?\s*وسلم|صلی\s*اللہ\s*علیہ\s*وسلم)/;
// A companion's name as the books print it. Bare "علی"/"عمر" would match ordinary words, so the
// unit is the HONORIFIC-BEARING NAME PHRASE: "حضرت <name>".
const COMPANION_RE = /حضرت\s+([^\s،۔:'"’”)(]+(?:\s+[^\s،۔:'"’”)(]+)?)/g;
const COMPANION_HON = /^[\s،۔]{0,2}(رضی\s*اللہ\s*عنہم?ا?|رضی\s*اللہ\s*عنہا|رضوان\s*اللہ|کرم\s*اللہ\s*وجہہ|علیہ\s*السلام|علیہا\s*السلام|رحمہ\s*اللہ|صدیق|فاروق|المرتضیٰ|ﷺ)/;
// Latin script has no place in a sacred name on an Urdu religious page — a transliteration is a
// de-pointing by another route, and §4c.5 bans that outright.
const TRANSLIT_RE = /\b(Allah|ALLAH|Muhammad|Mohammad|Muhammed|PBUH|SAW|SAWW|Sallallahu|Rasool|Rasul|Sahaba|Radiallahu|RA\b)/;
// Attributed prophetic SPEECH: a Prophet token, a speech verb, and a quoted span. That is a
// hadith, and a hadith without its source is the "content that has him speak" the operator ruled
// out. A source is a book-and-number, a page cite, or a named collection.
// The verb must INTRODUCE the words — a colon or an opening quote right after it. Tightened
// after the first run over the corpus: matching the verb alone fired on two correct book
// sentences in the G10 سیرت reader, where the Prophet ﷺ ACTS rather than speaks ("یہ تفریق پسند
// نہ فرمائی") and where "دریافت فرمایا" is somebody else asking. Neither is impersonation, and a
// gate that cries wolf on the book's own prose is a gate the authors learn to route around.
const SPEECH_VERB = /(فرمایا|ارشاد\s*فرمایا|کہا)\s*[:：]\s*['‘"“]?/;
const QUOTED_SPAN = /['‘"“][^'’"”]{6,}['’"”]/;
const HADITH_SOURCE = /(بخاری|مسلم|ترمذی|ابو\s*داؤد|نسائی|ابن\s*ماجہ|مؤطا|مسند|حدیث\s*[۰-۹0-9]|ص\s*[۰-۹0-9]|p\.?\s*\d)/;

const SAY_BOX = [
  /\bSAY\b\s*[:：]/,
  /\bSAY\b\s*["“]/,
  /\bsay\s*[:：]\s*["“]/i,
  /(کہیے|کہیں)\s*[:：]\s*["“]/,
];

function v9Gates(doc, ctx) {
  const { fail, warn, full, grade } = ctx;
  const qs = allQuestions(doc);
  const index = questionIndex(doc);
  const hw = sectionById(doc, "homework");
  const dev = sectionById(doc, "development");
  const intro = sectionById(doc, "introduction");
  const concl = sectionById(doc, "conclusion");
  const act = sectionById(doc, "activity");

  // ── MATH_LEAK ────────────────────────────────────────────────────────────
  // Two passes, and both matter. The RENDERED pass is the gate of record — it is the only
  // thing that can tell "$x$", which is correct, from "$x", which prints a dollar sign. The
  // SOURCE pass exists so the author is told WHERE, because a leak found in the DOM says only
  // that some string somewhere was wrong.
  for (const { at, s } of harvest(doc)) {
    if (at.startsWith("/revisions") || at.startsWith("/ur_overlay")) continue;
    if (ROW_LIST.test(s)) {
      fail("MATH_LEAK", `${at || "/"} writes a matrix as a row-list: "${s.slice(0, 60)}". Matrices are LaTeX — $\\begin{bmatrix} … \\end{bmatrix}$ — so they render as matrices, not as Python.`);
    }
    const dollars = (s.match(/\$/g) || []).length;
    if (dollars % 2 === 1) {
      fail("MATH_LEAK", `${at || "/"} has an odd number of $ delimiters, so one of them prints as a dollar sign: "${s.slice(0, 60)}"`);
    }
  }
  try {
    const lang = (ctx.opts && ctx.opts.lang) || doc.provenance.medium || "en";
    const html = buildHtml(doc, { lang }).html;
    for (const n of textNodes(html)) {
      for (const p of LEAK_PATTERNS) {
        if (!p.re.test(n.text)) continue;
        fail("MATH_LEAK", `the rendered page paints ${p.what} as literal text inside .${n.classes.slice(-2).join(".") || "page"}: "${n.text.trim().slice(0, 70)}". KaTeX must process EVERY text-bearing field — titles and badges and captions included.`);
        break;
      }
    }

    // ── DISTRACTOR_VISIBLE ────────────────────────────────────────────────
    const codes = ((doc.page2.exam_bank || {}).mcq || []).flatMap((m) => m.distractor_codes || []);
    for (const b of distractorVisible(html, codes)) {
      fail("DISTRACTOR_VISIBLE", `the distractor code "${b.code}" is painted in .${b.classes} — a pupil reading over the teacher's shoulder reads it too. Codes are data: they belong in the teacher note under the question, never beside the option.`);
    }


  } catch (e) {
    warn("MATH_LEAK", `the document could not be rendered, so the rendered-DOM pass did not run: ${e.message}`);
  }

  // ── HW_ANSWER_INLINE ─────────────────────────────────────────────────────
  // Defect class E, first row: the reviewed plan printed the answer beside the question, so
  // the homework asked the pupil to copy. Two shapes catch it — an ANNOUNCED answer, and an
  // item that has quietly absorbed its own key.
  const ANNOUNCED = /\b(?:answer|ans|solution|soln)\b\s*[:=]|\(\s*(?:answer|ans)\s*[:=]|جواب\s*[:：]/i;
  for (const it of (hw && hw.homework && hw.homework.items) || []) {
    if (ANNOUNCED.test(it.text || "")) {
      fail("HW_ANSWER_INLINE", `homework item ${it.ref || ""} announces its own answer: "${String(it.text).slice(0, 70)}". The answers live in the reference block, and nowhere else.`);
      continue;
    }
    const key = (doc.page2.homework_key || []).find((k) => k.ref === it.ref);
    if (!key) continue;
    const kt = tokens(key.answer);
    if (kt.length < 4) continue;
    if (jaccard(tokens(it.text), kt) >= 0.6) {
      fail("HW_ANSWER_INLINE", `homework item ${it.ref} restates its own worked answer. The item asks; the reference block answers.`);
    }
  }

  // ── UNWORDED_Q ───────────────────────────────────────────────────────────
  for (const q of qs) {
    const why = unworded(q.q);
    if (why) {
      fail("UNWORDED_Q", `${q.ref} (${q.where}) is not a fully-worded question — ${why}. Write "If $B = …$, find $B^{-1}$", not "|B|, B⁻¹: B = …".`);
    }
  }
  for (const s of doc.sections || []) {
    for (const b of allBlocks(s.blocks)) {
      if ((b.type === "worked_example" || b.type === "faded_example") && b.prompt) {
        const why = unworded(b.prompt);
        if (why) fail("UNWORDED_Q", `${s.id}: the ${b.type} prompt states no question — ${why}. A heading with a page number is a pointer; the pupil still needs the question.`);
      }
    }
  }

  // ── DUP_QUESTION ─────────────────────────────────────────────────────────
  // "Never repeats a class item" is the homework rule, but a fact stated twice in two places
  // is a §7 defect wherever it happens. Exam-bank echoes only warn: a bank is allowed to
  // rehearse the same idea in board phrasing.
  const HARD = new Set(["warmup", "practice", "exit", "checkpoint", "homework"]);
  for (let i = 0; i < qs.length; i++) {
    for (let j = i + 1; j < qs.length; j++) {
      const a = qs[i], b = qs[j];
      const ta = tokens(a.q), tb = tokens(b.q);
      if (ta.length < 4 || tb.length < 4) continue;
      const sim = normDup(a.q) === normDup(b.q) ? 1 : jaccard(ta, tb);
      if (sim < 0.85) continue;
      const hard = HARD.has(a.kind) && HARD.has(b.kind);
      const msg = `${a.ref} (${a.where}) and ${b.ref} (${b.where}) are the same question at ${Math.round(sim * 100)}% — "${String(a.q).slice(0, 50)}". Homework that repeats a class item asks the pupil to copy, not to practise.`;
      if (hard) fail("DUP_QUESTION", msg); else warn("DUP_QUESTION", msg);
    }
  }

  // ── HW_TAGS / HW_MCQ_WEIGHT ──────────────────────────────────────────────
  if (full && hw && hw.homework) {
    const items = hw.homework.items || [];
    const taught = taughtSlos(doc);
    items.forEach((it, i) => {
      const code = String(it.slo_code || "").trim();
      if (!code) { fail("HW_TAGS", `homework item ${i + 1} carries no SLO code. Every item is tagged [SLO code, K/U/A].`); return; }
      if (code.length > 24 || /\s{1,}\w+\s+\w+/.test(code)) {
        fail("HW_TAGS", `homework item ${i + 1}'s slo_code is prose, not a code: "${code.slice(0, 40)}".`);
      } else if (taught.size && !taught.has(code)) {
        fail("HW_TAGS", `homework item ${i + 1} is tagged ${code}, which this LP never taught (today's codes: ${[...taught].join(", ") || "none"}). Homework tests only what was taught today (spec §3 H).`);
      }
      if (!["K", "U", "A"].includes(it.level)) fail("HW_TAGS", `homework item ${i + 1} has no K/U/A level.`);
    });
    // ── HW_ITEM_COUNT ──────────────────────────────────────────────────────
    // Option B, operator 2026-09-02: "I think the homework questions could be reduced somewhat".
    // Fewer items, each still tagged, MCQ-weighted and answered in full. Nothing here touches the
    // you-do + exit-ticket graded bar of 6-8 — that is classwork, and it is unchanged.
    if (items.length > MAX_HOMEWORK_ITEMS) {
      fail("HW_ITEM_COUNT", `${items.length} homework items; the cap is ${MAX_HOMEWORK_ITEMS} (aim 4). Homework is the tail a teacher cuts first — set fewer, tagged, MCQ-weighted items and work every one of them in the reference block.`);
    }
    const mcq = items.filter((i) => i.format === "mcq").length;
    if (items.length && mcq * 2 < items.length) {
      fail("HW_MCQ_WEIGHT", `${mcq} of ${items.length} homework items are MCQ. The board's ratio is 50% and the Maths HoD asked for it in practice, homework AND assessment (spec §6).`);
    }
  }

  // ── REF_ABSENT ───────────────────────────────────────────────────────────
  for (const d of duplicateRefs(doc)) {
    fail("REF_ABSENT", `the ref "${d}" is declared by more than one question, so an answer pointing at it is ambiguous.`);
  }
  for (const m of doc.page2.model_answers || []) {
    if (!index.has(m.ref)) {
      fail("REF_ABSENT", `model answer "${m.ref}" answers a question the LP never states. Known refs: ${[...index.keys()].join(", ")}.`);
    }
  }
  for (const k of doc.page2.homework_key || []) {
    if (!index.has(k.ref)) fail("REF_ABSENT", `homework key "${k.ref}" solves an item the LP never sets.`);
  }
  // and the other direction: a question with no answer anywhere
  const answered = new Set([
    ...(doc.page2.model_answers || []).map((m) => m.ref),
    ...(doc.page2.homework_key || []).map((k) => k.ref),
  ]);
  for (const q of qs) {
    if (q.kind === "exam") continue;                      // the bank carries its own key
    if (q.a != null && String(q.a).trim()) continue;      // answered in place
    if (answered.has(q.ref)) continue;
    fail("REF_ABSENT", `${q.ref} (${q.where}) is asked and never answered — not in place, and not in the reference block.`);
  }
  // prose that points at a question by number
  // ONLY the explicit form. A bare "Q1" is almost always a TEXTBOOK citation — "Ex 1.3
  // Q1(a)-(c), p.25" — which spec §3 H positively asks for, and treating it as a dangling
  // internal reference made the gate fire on every correctly-cited exercise.
  const SEE_Q = /\bsee\s+(?:Q|question)\s*([A-Za-z]?\d+)/gi;
  for (const { at, s } of harvest(doc)) {
    if (at.startsWith("/revisions") || at.startsWith("/ur_overlay")) continue;
    SEE_Q.lastIndex = 0;
    let m;
    while ((m = SEE_Q.exec(s))) {
      const key = (m[1] || "").toUpperCase();
      if (!key) continue;
      const hit = [...index.keys()].some((k) => k.toUpperCase() === key || k.toUpperCase() === `Q${key}`);
      if (!hit) {
        fail("REF_ABSENT", `${at || "/"} points at "Q${key}", which is not a question this LP states: "${s.slice(0, 60)}"`);
      }
    }
  }

  // ── NO_SAY_BOX ───────────────────────────────────────────────────────────
  for (const s of doc.sections || []) {
    for (const b of allBlocks(s.blocks)) {
      if (b.type === "say") fail("NO_SAY_BOX", `${s.id} carries a say block. Spec §8: no Ask/Say script — give the teacher the example and the board line instead.`);
    }
  }
  for (const { at, s } of harvest(doc)) {
    if (at.startsWith("/revisions") || at.startsWith("/ur_overlay")) continue;
    for (const re of SAY_BOX) {
      if (re.test(s)) {
        fail("NO_SAY_BOX", `${at || "/"} is scripted talk: "${s.slice(0, 60)}". Teachers reject read-this-aloud boxes (spec §8).`);
        break;
      }
    }
  }
  const coach = String(doc.page2.coaching_lookfor || "");
  if (/[?؟]\s*$/.test(coach.trim())) {
    fail("NO_SAY_BOX", `the coaching corner's look-for is phrased as a question: "${coach.slice(0, 60)}". The LOOK-FOR is direct instruction about the observable move; the question the teacher asks HERSELF is a separate field, coaching_reflection.`);
  }

  // ── COACHING_CORNER ──────────────────────────────────────────────────────
  // The K-5 pattern, ported (operator, 2026-09-02): "We take something from that specific lesson,
  // and then we ask a question for the teacher to reflect on her own practice, and then also
  // offer that she can send an audio recording to our number (we list the number too)."
  //
  // The corner therefore has three parts and they are owned in three different places:
  //   1. the hook from THIS lesson  -> `coaching_lookfor`, gated above by NO_SAY_BOX
  //   2. the reflective question    -> `coaching_reflection`, gated here
  //   3. the record-and-send offer  -> renderer furniture (lib/template.js + lib/overlay.js),
  //      so the number lives in ONE place, cannot drift document to document, and costs no words
  //      against the budget Option B just cut.
  //
  // Part 2 is where NO_SAY_BOX and the K-5 pattern appeared to contradict each other: one gate
  // rejects a coaching corner phrased as a question, the other requires one. They do not
  // contradict, they are about different sentences. A question in the LOOK-FOR is the lesson's
  // content aimed at the teacher as if she were the pupil — the defect the expert ringed. A
  // question in the REFLECTION is her own practice, and what makes it decidably that is whether
  // it refers to her class, her pupils, or her own next move. A question that can be answered out
  // of the textbook is a content question wherever it is printed.
  if (full) {
    const refl = String(doc.page2.coaching_reflection || "").trim();
    if (!refl) {
      fail("COACHING_CORNER", "the coaching corner sets no reflective question. It is the teacher's own page: name one thing from THIS lesson and ask her what happened with HER class (spec §8; K-5's `wrap.reflection`).");
    } else if (!/[?؟]\s*$/.test(refl)) {
      fail("COACHING_CORNER", `the coaching reflection is a statement, not a question: "${refl.slice(0, 60)}". She reflects by answering something — end it with a question mark.`);
    } else if (!REFLECT_MARKERS.test(refl) && !REFLECT_MARKERS_UR.test(refl)) {
      fail("COACHING_CORNER", `the coaching reflection asks about the lesson's CONTENT, not about her practice: "${refl.slice(0, 70)}". A reflection names her class, her pupils, or what she does next — "Which of my pupils could …, and who do I re-teach tomorrow?" — not something answerable from the textbook.`);
    }
  }

  // ── RELIGIOUS_MARKS ──────────────────────────────────────────────────────
  religiousMarks(doc, ctx);

  // ── DIAGRAM_DEGENERATE ───────────────────────────────────────────────────
  if (full) {
    let renderDiagram = null, checkDegenerate = null;
    try {
      ({ renderDiagram, checkDegenerate } = require("./diagrams"));
    } catch (_) { /* engine absent — the renderer still reports an unrendered diagram */ }
    if (renderDiagram && checkDegenerate) {
      const specs = [];
      for (const s of doc.sections || []) {
        for (const b of allBlocks(s.blocks)) if (b.type === "diagram") specs.push({ where: s.id, spec: b.spec });
      }
      if (doc.page2.board_final && doc.page2.board_final.diagram) {
        specs.push({ where: "reference A", spec: doc.page2.board_final.diagram });
      }
      for (const { where, spec } of specs) {
        let svg = null;
        try { svg = renderDiagram(spec); } catch (_) { continue; }
        for (const d of checkDegenerate(svg)) {
          fail("DIAGRAM_DEGENERATE", `${where}: diagram "${spec.type}" is ${d.kind} — ${d.detail}. It is geometrically faithful and pedagogically useless; choose numbers that draw a shape a pupil can read an area off.`);
        }
      }
    }
  }

  // ── GRAPH_AXES / GRAPH_POINT_ORDER / GRAPH_ORIENTATION (bd-gel97) ────────
  // Not gated on `full`: these read the spec only, cost nothing, and a graph
  // is as wrong in a part-lint as in a whole-document one.
  {
    const gSpecs = [];
    for (const s of doc.sections || []) {
      for (const b of allBlocks(s.blocks)) if (b.type === "diagram" && b.spec) gSpecs.push({ where: b.id || s.id, spec: b.spec });
    }
    if (doc.page2 && doc.page2.board_final && doc.page2.board_final.diagram) {
      gSpecs.push({ where: "reference A", spec: doc.page2.board_final.diagram });
    }
    for (const { where, spec } of gSpecs) for (const d of graphDefects(spec, where)) fail(d.code, d.msg);
    for (const { where, spec } of gSpecs) for (const d of atomDefects(spec, where)) fail(d.code, d.msg);
  }

  // ── the rest of the closed heading system ────────────────────────────────
  if (full) {
    if (!doc.sequence) fail("SEQUENCE", "no sequence strip. Spec §5 wants a strip near the masthead saying where this LP sits, what comes next, and the next checkpoint.");
    if (dev && !dev.textbook_page) {
      fail("DEV_PAGE", "development cites no textbook page. Reviewer sign-off 7: \"Does Development cite the textbook page it teaches from?\"");
    }
    if (intro) {
      const kw = allBlocks(intro.blocks).find((b) => b.type === "keywords");
      if (!kw) warn("VOCAB_PAGE", "the introduction pre-teaches no vocabulary. Spec §3 I puts it here, never after homework.");
      else if (!kw.page) fail("VOCAB_PAGE", "the vocabulary pre-teach carries no textbook page number (spec §3 I).");
    }
    if (concl) {
      if (!concl.checkpoint) fail("CONCLUSION", "the conclusion has no board-phrased question with a mark scheme (spec §3 C).");
      if (!concl.exit_ticket || !concl.exit_ticket.length) fail("CONCLUSION", "the conclusion has no exit ticket (spec §3 C).");
      if (!concl.reteach_rule) fail("CONCLUSION", "the conclusion names no re-teach rule — the threshold and what to redo before the next LP (spec §3 C).");
    }
    if (act) {
      const beats = allBlocks(act.blocks)
        .map((b, i) => ({ b, i }))
        .filter(({ b }) => b.type === "faded_example" || (b.type === "practice" && b.mode));
      const guided = beats.find(({ b }) => b.type === "faded_example" || b.mode === "guided");
      const indep = beats.find(({ b }) => b.type === "practice" && b.mode === "independent");
      if (!guided) fail("WE_DO", "the activity goes straight to independent work. Guided (we do) comes before independent (you do) — spec §3 A, and any move homework will ask for is built once with the class first.");
      else if (!indep) warn("WE_DO", "the activity has a guided beat but no independent one.");
      else {
        if (guided.i > indep.i) fail("WE_DO", "independent practice comes before the guided beat. We do, then you do (spec §3 A).");
        for (const { b } of [guided, indep]) {
          if (!b.minutes) fail("WE_DO", `the ${b.type === "faded_example" ? "guided" : b.mode} beat is not timed. Both are timed (spec §3 A).`);
        }
      }
    }
    // Every objective is modelled, practised AND assessed today — an objective that only
    // appears in homework is a fail (spec §3 O). The decidable half of that: every objective
    // carries an SLO code, and the plan does not set more objectives than it can carry.
    for (const [i, o] of ((doc.objectives && doc.objectives.items) || []).entries()) {
      if (o.slo_code === undefined) {
        warn("OBJECTIVES", `objective ${i + 1} has no slo_code field. Use null and say so when the book prints no code — never invent one.`);
      }
    }
    if (!doc.objectives.by_the_end) {
      warn("OBJECTIVES", "the O box carries no \"✓ By the end you can answer…\" line naming the question type and its marks (spec §3 O).");
    }

    // ── OUTCOME_BOX ────────────────────────────────────────────────────────
    // Option B, operator 2026-09-02: "Learning outcomes take up the whole first page, could also
    // be reduced?" The O box is the first thing printed and it had no ceiling — the doc budget
    // counts the objectives' text and never counted the outcome or by-the-end lines at all. Hard
    // caps, not ±30% targets: it is four short fields with nothing to distribute between them.
    {
      const O = doc.objectives || {};
      const items = O.items || [];
      const nOutcome = wordCount(O.outcome);
      const nEnd = wordCount(O.by_the_end);
      if (nOutcome > OUTCOME_BOX_V9.outcome) {
        fail("OUTCOME_BOX", `the outcome sentence is ${nOutcome} words; the ceiling is ${OUTCOME_BOX_V9.outcome}. It names ONE thing the pupil can do — the detail belongs to the objectives under it.`);
      }
      if (nEnd > OUTCOME_BOX_V9.by_the_end) {
        fail("OUTCOME_BOX", `the "✓ By the end…" line is ${nEnd} words; the ceiling is ${OUTCOME_BOX_V9.by_the_end}. Name the question type and its marks, and stop.`);
      }
      items.forEach((o, i) => {
        const n = wordCount(o.text);
        if (n > OUTCOME_BOX_V9.objective) {
          fail("OUTCOME_BOX", `objective ${i + 1} is ${n} words; the ceiling is ${OUTCOME_BOX_V9.objective}. One verb, one object, one condition — an objective that needs a subordinate clause is two objectives.`);
        }
      });
      const box = nOutcome + nEnd + items.reduce((a, o) => a + wordCount(o.text), 0);
      if (box > OUTCOME_BOX_V9.total) {
        fail("OUTCOME_BOX", `the whole outcome-and-objectives box is ${box} words against a ceiling of ${OUTCOME_BOX_V9.total}. Every field can be legal and the box still fill the top of page 1 — that is the thing being fixed.`);
      }
    }
  }
}

/**
 * The mechanical half of brief §4c. Runs only on a document that actually carries religious
 * content, so an English maths LP never sees it.
 *
 * A NOTE ON WHAT A GREEN RESULT MEANS: nothing, on its own. Every message here ends by saying the
 * native-speaker review is still a hard hold, because the failure mode this gate could create —
 * "the linter passed it, ship it" — is worse than the defects it catches.
 */
function religiousMarks(doc, ctx) {
  const { fail, warn } = ctx;
  const HOLD = "Automated checks do NOT clear religious content: the native-speaker review remains a hard hold before any teacher delivery (brief §4c, gate G5c).";

  const strings = harvest(doc).filter(({ at }) =>
    !at.startsWith("/revisions") && !at.startsWith("/notes") && !at.startsWith("/provenance"));
  const isReligious = strings.some(({ s }) => PROPHET_RE.test(s) || /ﷺ|رضی\s*اللہ|علیہ\s*السلام|سیرت|حدیث|قرآن/.test(s));
  PROPHET_RE.lastIndex = 0;
  if (!isReligious) return;

  // 1 — the honorific after every mention of the Prophet. Mechanical, and blocking.
  for (const { at, s } of strings) {
    PROPHET_RE.lastIndex = 0;
    let m;
    while ((m = PROPHET_RE.exec(s))) {
      if (HONORIFIC_RE.test(s.slice(m.index + m[0].length))) continue;
      fail("RELIGIOUS_MARKS", `${at || "/"} names the Prophet ("${m[0]}") with no honorific after it: "${s.slice(Math.max(0, m.index - 20), m.index + m[0].length + 25)}". Write "${m[0]} ﷺ" — never de-pointed, abbreviated, transliterated or dropped (brief §4c.5). ${HOLD}`);
    }
  }

  // 2 — no sacred name in Latin script. A transliteration is a de-pointing by another route.
  for (const { at, s } of strings) {
    const t = TRANSLIT_RE.exec(s);
    if (t) {
      fail("RELIGIOUS_MARKS", `${at || "/"} writes a sacred name or honorific in Latin script ("${t[0]}"): "${s.slice(0, 70)}". These are set in Urdu/Arabic script as the book prints them — اللہ، نبی کریم ﷺ، رضی اللہ عنہ (brief §4c.5). ${HOLD}`);
    }
  }

  // 3 — companion honorifics, checked for INTERNAL CONSISTENCY. This is the version with no false
  //     positives: if the same document honorifies "حضرت عمر" in one line and leaves it bare in
  //     the next, the bare one is a slip, and it is decidable without a corpus of names.
  const honorified = new Set();
  const bare = [];
  for (const { at, s } of strings) {
    COMPANION_RE.lastIndex = 0;
    let m;
    while ((m = COMPANION_RE.exec(s))) {
      // The capture may have swallowed the first word of the honorific ("عمر رضی"), so the NAME
      // is the words before the honorific starts, and the honorific is looked for from the end of
      // "حضرت " onwards rather than from the end of a guessed name.
      const from = m.index + "حضرت".length;
      const rest = s.slice(from).replace(/^\s+/, "");
      const words = rest.split(/(\s+)/);
      let name = "", tail = rest, consumed = 0;
      for (let i = 0; i < Math.min(words.length, 5); i += 2) {
        const cand = rest.slice(consumed).replace(/^\s+/, "");
        if (name && COMPANION_HON.test(cand)) { tail = cand; break; }
        name += (name ? " " : "") + words[i];
        consumed += words[i].length + (words[i + 1] || "").length;
        tail = rest.slice(consumed).replace(/^\s+/, "");
        if (COMPANION_HON.test(tail)) break;
        if (i >= 2) break;                        // a name is at most three words
      }
      name = name.replace(/[،۔:'"’”)(]+$/, "").trim();
      if (!name) continue;
      const first = name.split(/\s+/)[0];
      if (COMPANION_HON.test(tail)) { honorified.add(first); continue; }
      bare.push({ at, s, name, first, idx: m.index });
    }
  }
  for (const b of bare) {
    if (!honorified.has(b.first)) continue;      // never honorified anywhere — not a slip, review it
    fail("RELIGIOUS_MARKS", `${b.at || "/"} names a companion ("حضرت ${b.name}") with no honorific, but this same document honorifies "حضرت ${b.first}" elsewhere: "${b.s.slice(Math.max(0, b.idx - 15), b.idx + 45)}". Carry the honorific the book prints — رضی اللہ عنہ / عنہا / عنہم (brief §4c.5). ${HOLD}`);
  }

  // 4 — no impersonation: the Prophet does not "speak" outside quoted, sourced hadith text.
  for (const { at, s } of strings) {
    PROPHET_RE.lastIndex = 0;
    if (!PROPHET_RE.test(s) && !/آپ\s*ﷺ|ﷺ/.test(s)) continue;
    PROPHET_RE.lastIndex = 0;
    if (!SPEECH_VERB.test(s) || !QUOTED_SPAN.test(s)) continue;
    if (HADITH_SOURCE.test(s)) continue;
    fail("RELIGIOUS_MARKS", `${at || "/"} puts words in the Prophet's mouth with no hadith behind them: "${s.slice(0, 80)}". Quoted prophetic speech carries its source — the collection and its number, or the textbook page it is printed on. If you cannot source it, it does not go in the lesson (brief §4c.4/§0). ${HOLD}`);
  }

  // 5 — a quoted span in religious content with no source at all. WARN: a quotation may be the
  //     book's own prose rather than a hadith, and the reviewer can tell which. The gate cannot.
  for (const { at, s } of strings) {
    if (!QUOTED_SPAN.test(s) || HADITH_SOURCE.test(s)) continue;
    if (!/حدیث|قرآن|آیت|سورۃ|فرمایا|ارشاد/.test(s)) continue;
    warn("RELIGIOUS_MARKS", `${at || "/"} quotes religious text with no source in the same string: "${s.slice(0, 70)}". Cite the collection and number, or the printed page. ${HOLD}`);
  }

  // 6 — the hold itself. §4c.1: no Islamiat or سیرت lesson is served on demand.
  if (!doc.needs_human_review) {
    fail("RELIGIOUS_MARKS", `this document carries religious content but does not set needs_human_review. Brief §4c.1: no Islamiat or سیرت lesson is served on demand, and --auto-send must be able to refuse it. ${HOLD}`);
  }
}

/** Walk every string in the doc and insert the spaces mhchem needs. Returns the count fixed. */
function fixChemInPlace(node, at = "") {
  let n = 0;
  if (Array.isArray(node)) {
    node.forEach((v, i) => {
      if (typeof v === "string") {
        const f = fixChemPlus(v);
        if (f !== v) { node[i] = f; n++; }
      } else n += fixChemInPlace(v, `${at}/${i}`);
    });
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === "string") {
        // a `chem` block's `tex` is the INSIDE of \ce{...}, with no wrapper to match on
        const bare = k === "tex" && node.type === "chem";
        const f = fixChemPlus(v, bare);
        if (f !== v) { node[k] = f; n++; }
      } else n += fixChemInPlace(v, `${at}/${k}`);
    }
  }
  return n;
}

// ── cli ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  // --auto-send = "this is about to go to a teacher with no human in the loop".
  const autoSend = args.includes("--auto-send");
  // --fix = repair the mechanical defects in place. Today that is exactly one: the mhchem
  // `+` that renders as a charge. Nothing judgement-shaped is ever auto-fixed.
  const doFix = args.includes("--fix");
  const files = args.filter((a) => !a.startsWith("--"));
  if (!files.length) {
    console.error("usage: node lint_lp.js <lp_doc.json> [more.json ...] [--json] [--auto-send]");
    process.exit(2);
  }
  let bad = 0;
  const all = [];
  for (const f of files) {
    const p = path.resolve(f);
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (e) {
      console.error(`${f}: NOT JSON — ${e.message}`);
      bad++;
      continue;
    }
    if (doFix) {
      const n = fixChemInPlace(doc);
      if (n) {
        fs.writeFileSync(p, JSON.stringify(doc, null, 1) + "\n");
        console.log(`   fixed ${n} mhchem "+" ${n === 1 ? "defect" : "defects"} in ${path.basename(p)}`);
      }
    }
    const r = lint(doc, p, { autoSend });
    all.push({ file: path.basename(p), ...r });
    if (!asJson) {
      const status = r.fails.length ? "FAIL" : "PASS";
      console.log(`\n${status}  ${path.basename(p)}${r.profile === "smoke" ? "   [LINT PROFILE: smoke — word budgets and FDE completeness SKIPPED; never ship this to a teacher]" : ""}`);
      for (const x of r.fails) console.log(`   ✗ ${x}`);
      for (const x of r.warns) console.log(`   ! ${x}`);
      if (!r.fails.length && !r.warns.length) console.log("   clean");
    }
    if (r.fails.length) bad++;
  }
  if (asJson) console.log(JSON.stringify(all, null, 2));
  process.exit(bad ? 1 : 0);
}

/* ══════════════════════════════════════════════════════════════════════════
   GRAPH AXES + POINT/CURVE ORIENTATION — bd-gel97
   ═════════════════════════════════════════════════════════════════════════

   The first gated Physics lesson shipped a board `graph` captioned
   "pressure falls as altitude rises" whose two marked points were written
   "(8.8 km, 33 kPa)" and PLOTTED at (33, 8.8) — the reverse — on axes that
   carried no labels at all, so a teacher could not tell which reading was
   meant. The visual gate asks "is there a graph", not "is the graph true".
   These three checks are the deterministic part of "is it true". No LLM.

   R1 · GRAPH_AXES — a graph names both of its axes.
        `xLabel` and `yLabel` are REQUIRED on every `graph` spec, with the
        unit in the label where the quantity has one ("Altitude (km)"). For a
        pure-maths curve they are literally "x" and "y" — cheap, and it keeps
        the rule with no exception to argue about.

   R2 · GRAPH_POINT_ORDER — a point's own annotation agrees with where it sits.
        Two sub-tests, both fire ONLY on an unambiguous contradiction:
        (a) the label states a coordinate PAIR — "(8.8 km, 33 kPa)", "(3, 0)" —
            and those two numbers match the plotted (x, y) SWAPPED but not
            straight. Silent when they match straight, when either number
            matches neither coordinate, or when the two numbers are equal.
        (b) the axis labels carry DISTINCT units and the point's label carries
            "<number> <unit>" for one of them; that number must be the
            coordinate on THAT axis. Fires only when the number is instead
            exactly the coordinate on the OTHER axis. A number matching
            neither is left alone — it may be a third quantity.

   R3 · GRAPH_ORIENTATION — a point agrees with the curve's orientation.
        Measured against the extent the plot ACTUALLY draws (graph.js
        `drawnExtent`, the same sampler the page uses), never the declared
        window. A point is flagged only when it is FAR outside that extent
        (> 35% of the extent's own span on some axis) AND its swap (y, x)
        lands INSIDE it (within 5%). A legitimate outlier is out on one axis
        and its swap is out too, because the two axes carry different scales;
        when the extent happens to be square the two measurements are
        identical by construction and nothing is ever flagged. Needs a curve
        or segment — a points-only scatter has nothing to disagree with.
   ══════════════════════════════════════════════════════════════════════════ */
const GRAPH_TYPES = new Set(["graph", "plot", "function_plot"]);
const GRAPH_OUT_TOL = 0.35;   // "far outside the locus", as a share of its own span
const GRAPH_IN_TOL = 0.05;    // "inside the locus" for the swapped reading
const GRAPH_NUM_TOL = 0.005;  // 0.5% — a label rounds, it does not re-derive

const gNum = (v) => (typeof v === "number" && isFinite(v) ? v : null);
const gClose = (a, b) => Math.abs(a - b) <= 1e-9 + GRAPH_NUM_TOL * Math.max(Math.abs(a), Math.abs(b), 1);
/** U+2212 MINUS and U+2013 EN DASH are what a maths author actually types. */
const gNormNums = (t) => String(t).replace(/[−–‒]/g, "-");
/** every "<number><unit?>" in a string, in order. Latin digits only — an Urdu-digit label is left alone. */
function gTokens(text) {
  const out = [];
  const re = /(-?\d+(?:\.\d+)?)\s*([A-Za-z°%][A-Za-z°%\/²³]*)?/g;
  let m;
  while ((m = re.exec(gNormNums(text)))) out.push({ n: Number(m[1]), unit: (m[2] || "").trim() });
  return out;
}
/** the coordinate pair a label states, if it states one: prefer a parenthesised group. */
function gPair(text) {
  const src = gNormNums(text);
  for (const grp of src.match(/\([^()]*\)/g) || []) {
    const t = gTokens(grp);
    if (t.length === 2) return t;
  }
  const t = gTokens(src);
  return t.length === 2 ? t : null;
}
/** the unit an axis label declares: "Pressure (kPa)" -> kpa, "Time in hours" -> hours. */
function gAxisUnit(label) {
  const s = String(label || "");
  const par = s.match(/\(([^()]{1,14})\)\s*$/);
  const raw = par ? par[1] : (s.match(/\b(?:in|per)\s+([A-Za-z°%\/]{1,10})\s*$/i) || [])[1];
  const u = String(raw || "").trim().toLowerCase();
  return /^[a-z°%\/²³]{1,10}$/.test(u) ? u : "";
}
function gExcess(v, lo, hi) { return v < lo ? lo - v : v > hi ? v - hi : 0; }
function gOutNorm(x, y, ext) {
  const sx = ext.x[1] - ext.x[0];
  const sy = ext.y[1] - ext.y[0];
  return Math.max(gExcess(x, ext.x[0], ext.x[1]) / sx, gExcess(y, ext.y[0], ext.y[1]) / sy);
}

/**
 * Every graph defect in one spec, as {code, msg} — pure, so it is testable
 * without a document and so the same rules can be replayed over a corpus.
 */

/* ---------------------------------------------------------------------------
   ATOM_UNKNOWN_ELEMENT — bd-8lifl

   `atom.js` carries a built-in table of H-Ca plus Fe/Cu/Zn/Br/I. For anything
   else, its resolver falls through to `givenSum || 1` and draws a ONE-ELECTRON
   atom -- hydrogen -- under whatever label the author wrote.

   Seen on a delivered Grade 10 Chemistry lesson (2026-09-05): a figure titled
   "WHY THE CHROMIUM ION IS Cr3+" drawing 1p+ 1n0 and a single K-shell electron.
   An atom with one electron cannot lose three, so the picture refuted its own
   caption, and every structural gate passed it.

   The engine is not wrong to have a small table; it is wrong to draw a
   confident substitute in silence. `Z` and `shells` are the documented way out
   (published in the brief's SS4b.5 since bd-8lifl), so the ladder can repair it.
   The renderer is deliberately left alone -- a throw would turn a repairable
   defect into a lost lesson.
--------------------------------------------------------------------------- */

/** Elements `atom.js` can draw unaided. Kept in step by atom-unknown-element.test.js. */
const ATOM_TABLE = new Set([
  "H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne",
  "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca",
  "Fe", "Cu", "Zn", "Br", "I",
]);
const ATOM_TYPES = new Set(["atom", "bohr", "electron_shells", "dot_and_cross"]);

/** `atom.js` normalises "cr"/"CR" to "Cr" before the lookup; mirror that exactly. */
function atomKey(raw) {
  const s = String(raw == null ? "" : raw).trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "Na";
}

function atomDefects(spec, where) {
  const out = [];
  if (!spec || typeof spec !== "object") return out;
  if (!ATOM_TYPES.has(String(spec.type || "").trim().toLowerCase())) return out;

  // Each side of a bonding picture resolves through the same table.
  const parties = [{ o: spec, what: "element" }];
  if (spec.partner && typeof spec.partner === "object") {
    parties.push({ o: spec.partner, what: "partner.element" });
  }

  for (const { o, what } of parties) {
    const raw = o.element || o.symbol;
    if (!raw) continue;
    const key = atomKey(raw);
    if (ATOM_TABLE.has(key)) continue;
    const hasZ = Number.isFinite(Number(o.Z)) && Number(o.Z) >= 1;
    const hasShells = Array.isArray(o.shells) && o.shells.some((v) => Number(v) > 0);
    if (hasZ || hasShells) continue;
    out.push({
      code: "ATOM_UNKNOWN_ELEMENT",
      msg: `${where}: \`atom\` ${what} ${JSON.stringify(String(raw))} is not one of the elements this `
        + `engine draws unaided (H-Ca plus Fe, Cu, Zn, Br, I), and neither \`Z\` nor \`shells\` `
        + `was given -- so it would draw a ONE-ELECTRON atom carrying that label. Give \`Z\` and `
        + `\`shells\` (and \`neutrons\`), or use a type that can carry the idea.`,
    });
  }
  return out;
}

function graphDefects(spec, where) {
  const out = [];
  if (!spec || typeof spec !== "object" || !GRAPH_TYPES.has(spec.type)) return out;
  const at = where ? `${where}: ` : "";
  const name = String(spec.title || spec.caption || "").trim().slice(0, 60) || "untitled";

  // R1 ─ both axes named.
  const missing = [];
  if (!String(spec.xLabel || "").trim()) missing.push("xLabel");
  if (!String(spec.yLabel || "").trim()) missing.push("yLabel");
  if (missing.length) {
    out.push({
      code: "GRAPH_AXES",
      msg: `${at}graph "${name}" has no ${missing.join("/")} — a teaching graph names both axes with units. ` +
        `Add "xLabel" and "yLabel" to the spec, each naming the quantity and its unit ` +
        `("Altitude (km)", "Pressure (kPa)"); for a pure-maths curve they are "x" and "y". ` +
        `Without them the reader cannot tell which quantity is which, and the plot cannot be checked against its own points.`,
    });
  }

  const pts = (Array.isArray(spec.points) ? spec.points : [])
    .filter((p) => p && gNum(p.x) !== null && gNum(p.y) !== null);
  const ux = gAxisUnit(spec.xLabel);
  const uy = gAxisUnit(spec.yLabel);

  for (const p of pts) {
    const label = String(p.label || "").trim();
    if (!label) continue;
    const tag = `"${label.slice(0, 48)}" plotted at (${p.x}, ${p.y})`;

    // R2a ─ the stated pair is the plotted pair, reversed.
    const pair = gPair(label);
    if (pair && !gClose(pair[0].n, pair[1].n)) {
      const direct = gClose(pair[0].n, p.x) && gClose(pair[1].n, p.y);
      const flipped = gClose(pair[0].n, p.y) && gClose(pair[1].n, p.x);
      if (flipped && !direct) {
        out.push({
          code: "GRAPH_POINT_ORDER",
          msg: `${at}graph "${name}": the point ${tag} is annotated (${pair[0].n}${pair[0].unit ? " " + pair[0].unit : ""}, ${pair[1].n}${pair[1].unit ? " " + pair[1].unit : ""}) — the same two numbers the OTHER way round. ` +
            `A point is written in the axis order it is plotted in: (x-quantity, y-quantity). Either swap "x" and "y" on the point, or rewrite the label.`,
        });
        continue;
      }
    }

    // R2b ─ a number carrying an axis's unit sits on the other axis.
    if (ux && uy && ux !== uy) {
      for (const t of gTokens(label)) {
        if (!t.unit) continue;
        const u = t.unit.toLowerCase();
        if (u === ux && !gClose(t.n, p.x) && gClose(t.n, p.y)) {
          out.push({
            code: "GRAPH_POINT_ORDER",
            msg: `${at}graph "${name}": the point ${tag} says "${t.n} ${t.unit}", and "${t.unit}" is the unit of the X axis ("${spec.xLabel}") — but ${t.n} is this point's Y value. It is plotted on the wrong axis.`,
          });
          break;
        }
        if (u === uy && !gClose(t.n, p.y) && gClose(t.n, p.x)) {
          out.push({
            code: "GRAPH_POINT_ORDER",
            msg: `${at}graph "${name}": the point ${tag} says "${t.n} ${t.unit}", and "${t.unit}" is the unit of the Y axis ("${spec.yLabel}") — but ${t.n} is this point's X value. It is plotted on the wrong axis.`,
          });
          break;
        }
      }
    }
  }

  // R3 ─ the points agree with the orientation of the curve they sit on.
  if (pts.length) {
    let ext = null;
    try { ext = require("./diagrams/types/graph").drawnExtent(spec); } catch (_) { ext = null; }
    if (ext && ext.x[1] > ext.x[0] && ext.y[1] > ext.y[0]) {
      for (const p of pts) {
        const outN = gOutNorm(p.x, p.y, ext);
        const swapN = gOutNorm(p.y, p.x, ext);
        if (outN >= GRAPH_OUT_TOL && swapN <= GRAPH_IN_TOL) {
          out.push({
            code: "GRAPH_ORIENTATION",
            msg: `${at}graph "${name}": the point (${p.x}, ${p.y})${p.label ? ` "${String(p.label).slice(0, 40)}"` : ""} lies far off the curve's own extent ` +
              `(x ${round2(ext.x[0])}…${round2(ext.x[1])}, y ${round2(ext.y[0])}…${round2(ext.y[1])}), while (${p.y}, ${p.x}) lands inside it. ` +
              `The point is plotted in the opposite axis order to the curve. Pick ONE orientation — (x-quantity, y-quantity) — and write the curve, the points and the axis labels in it.`,
          });
        }
      }
    }
  }
  return out;
}
function round2(v) { return Math.round(v * 100) / 100; }

module.exports = { lint, fixChemInPlace, distractorVisible, unworded, normQ, v9Gates, graphDefects, atomDefects,
  SECTION_BUDGET, SECTION_BUDGET_V9, DOC_BUDGET, DOC_BUDGET_V9, OUTCOME_BOX_V9,
  MAX_HOMEWORK_ITEMS, MAX_BOARD_WEIGHT, MAX_ACTIVITIES, PLACEHOLDERS, FOREIGN_BRANDS };
