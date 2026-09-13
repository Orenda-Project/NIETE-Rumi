// The Urdu toggle + the printed label packs.
//
// Operator decision (2026-08-30): English-medium books are AUTHORED in English and get an
// Urdu TOGGLE — the same lp_doc, the same structure, instruction strings swapped. Not
// side-by-side. So `ur_overlay` is a flat map of RFC-6901 JSON Pointer -> Urdu string,
// applied to a deep clone at render time. One document, two renderings, no drift.
//
// What must NOT be overlaid (LP_DESIGN_RULES §5: textbook quotations stay in the book's
// language of instruction; the board text follows the exam): the verbatim SLO, anything
// in the exam bank, and any `board` block. lint_lp.js enforces this list; it lives here
// so the renderer and the linter cannot disagree about it.

/**
 * Fields the renderer PARSES rather than PRINTS — bd-oak77.23.
 *
 * The distinction the overlay has to make is not English-vs-Urdu, it is PRINTED vs PARSED. A
 * caption, a label, a paragraph is read by a human and should be translated; these are fed to a
 * parser or to a fixed geometry:
 *
 *   tex       KaTeX source (`lib/rich.js` -> katex.renderToString) on `latex` and `chem` blocks
 *   smiles    a molecular graph (`diagrams/types/molecule.js` -> OCL.Molecule.fromSmiles)
 *   equation  the same, for the diagram types that draw one
 *   formula   the molecule's FORMULA CARD — a large centred LTR slot laid out for about ten Latin
 *             characters like C7H6N4OS. Not parsed, but just as unable to hold a sentence.
 *
 * Found by reading a delivered page. Staging `grade_12_chemistry.c14.p227-230` ur shipped
 * `status=ready`, 19 pages, with
 *     /sections/1/blocks/2/spec/formula => "فاسفولپڈ (phospholipid) (بیکٹیریا کی جھلی کا جزو)"
 * — 49 code points in that card — and the molecule's label block painted on top of itself,
 * unreadable. `/sections/1/blocks/4/tex`, 184 characters of KaTeX, was selected on the same
 * document and survived ONLY because the model echoed it byte-identically. Two of 120 pointers
 * landed on a parsed field; one broke, one got away with it.
 *
 * THIS IS THE ONLY DEFINITION. `lint_lp.js` folds it into `OVERLAY_SKIP_KEYS` rather than keeping
 * its own copy, because a second copy is precisely what let these keys through: `overlayTargets`
 * consulted one list and this file another, and neither carried them. Same shape as the 727/729
 * FULL_COL drift.
 */
const MACHINE_KEYS = new Set([
  // PARSED — fed to a parser or a fixed geometry
  "tex", "smiles", "equation", "formula",
  // ID CROSS-REFERENCES and ENUMS — resolved or switched on, never read as prose.
  //
  // `closed_by` is here because PRODUCTION put it here. The one real Urdu lesson that reached prod
  // (`grade_9_biology.c04.p057-057`) has no molecule and no equation, so the formula-card failure
  // could not occur on it — and the class was present anyway:
  //     /sections/0/blocks/0/closed_by => "close-hook"
  // That is not a display string. It resolves against `/sections/1/blocks/0/id` and is the link
  // binding the lesson's hook to the paragraph that closes it. The overlay selected it, and it
  // survived only because the model echoed it byte-identically. That is STRICTLY WORSE than the
  // `tex` case: a translated identifier breaks a structural link SILENTLY, with no misdrawn box to
  // notice. `"close-hook"` clears `isInstructionProse` — ten characters, two Latin words — so
  // nothing was protecting it.
  //
  // The rest are frozen on the same principle rather than because each has been seen to break: a
  // short enum usually fails the prose heuristic, but that is luck, not a rule. A test derives this
  // set from `lp_doc.schema.json` and fails if a new enum or id-shaped field is added without being
  // frozen — because a hand-maintained list is exactly what let `formula` and `closed_by` through.
  "closed_by", "level", "format", "layout", "cognitive_level", "assessment_status",
  "textbook_page", "page", "unit", "units",
]);

/** The four the renderer feeds to a PARSER or a fixed geometry, as opposed to the identifiers. */
const PARSED_KEYS = new Set(["tex", "smiles", "equation", "formula"]);

/** The last segment of a JSON Pointer, unescaped. */
function pointerKey(ptr) {
  const i = String(ptr).lastIndexOf("/");
  return i < 0 ? "" : unescapeToken(String(ptr).slice(i + 1));
}

const FROZEN_POINTERS = [
  { test: (p) => p === "/slo/text_verbatim", why: "the printed outcome is quoted verbatim from the book" },
  { test: (p) => p.startsWith("/page2/exam_bank"), why: "the exam is sat in the book's language" },
  // Two rules, not one, because the two failure modes are different and the message a human reads
  // should say which one they are looking at (rule 24(d) applies to engineer-facing copy too).
  {
    test: (p) => PARSED_KEYS.has(pointerKey(p)),
    why: "the renderer PARSES this field rather than printing it — a translated formula, SMILES "
      + "string or KaTeX source does not draw",
  },
  {
    test: (p) => MACHINE_KEYS.has(pointerKey(p)),
    why: "this is an identifier or an enum the document RESOLVES against, not text anyone reads — "
      + "translating it breaks the link silently",
  },
];

function unescapeToken(t) {
  return t.replace(/~1/g, "/").replace(/~0/g, "~");
}

function pointerParts(ptr) {
  if (ptr === "" || ptr === "/") return [];
  if (!ptr.startsWith("/")) throw new Error(`not a JSON Pointer: ${ptr}`);
  return ptr.slice(1).split("/").map(unescapeToken);
}

function pointerGet(doc, ptr) {
  let cur = doc;
  for (const part of pointerParts(ptr)) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = Array.isArray(cur) ? cur[Number(part)] : cur[part];
  }
  return cur;
}

/** Parent container + final key, so a caller can inspect the *owner* of a pointer. */
function pointerParent(doc, ptr) {
  const parts = pointerParts(ptr);
  if (!parts.length) return null;
  const key = parts.pop();
  let cur = doc;
  for (const part of parts) {
    if (cur === null || typeof cur !== "object") return null;
    cur = Array.isArray(cur) ? cur[Number(part)] : cur[part];
  }
  return cur && typeof cur === "object" ? { parent: cur, key } : null;
}

function pointerSet(doc, ptr, value) {
  const loc = pointerParent(doc, ptr);
  if (!loc) throw new Error(`ur_overlay: pointer does not resolve: ${ptr}`);
  const k = Array.isArray(loc.parent) ? Number(loc.key) : loc.key;
  if (loc.parent[k] === undefined) throw new Error(`ur_overlay: pointer targets nothing: ${ptr}`);
  loc.parent[k] = value;
}

/** Why a pointer may not be overlaid, or null if it may. */
function frozenReason(doc, ptr) {
  for (const f of FROZEN_POINTERS) if (f.test(ptr)) return f.why;
  const loc = pointerParent(doc, ptr);
  if (loc && loc.parent && loc.parent.type === "board" && loc.key === "text") {
    return "board text follows the exam's language, not the instruction's";
  }
  return null;
}

/**
 * Apply the Urdu toggle. Returns { doc, applied, errors } — never mutates the input.
 * lang 'en' (or no overlay) returns a clone unchanged.
 */
function applyOverlay(lpDoc, lang) {
  const doc = JSON.parse(JSON.stringify(lpDoc));
  const applied = [];
  const errors = [];
  if (lang !== "ur" || !doc.ur_overlay) return { doc, applied, errors };

  for (const [ptr, value] of Object.entries(doc.ur_overlay)) {
    const frozen = frozenReason(doc, ptr);
    if (frozen) {
      errors.push(`${ptr}: may not be overlaid — ${frozen}`);
      continue;
    }
    try {
      pointerSet(doc, ptr, value);
      applied.push(ptr);
    } catch (e) {
      errors.push(e.message);
    }
  }
  return { doc, applied, errors };
}

// ── printed label packs ──────────────────────────────────────────────────────
const LABELS = {
  en: {
    objectives: "Learning objectives", warmup: "Warm-up",
    introduction: "Introduction", development: "Development", activity: "Activity",
    conclusion: "Conclusion", homework: "Home work",
    min: "min", say: "Say", ask: "Open with this question", askPlain: "Ask this", lookFor: "Look for",
    watch: "Watch out", board: "On the board", keywords: "Key words",
    keyPoints: "Key points", worked: "Worked example", faded: "Faded example",
    guided: "Guided practice", independent: "Independent practice",
    practice: "Practice", answer: "Answer", support: "Support", extension: "Extension",
    // bd-a8veu.3 — `slo` captions the QUOTED curriculum wording; `outcome` (below) heads the box.
    // In English both were "Learning outcome", so the box printed that heading twice over two
    // differently-worded sentences and read as two of the three styles the operator counted. Urdu
    // never collided (متعینہ تدریسی مقصد / تدریسی نتیجہ) and is unchanged.
    materials: "Materials", pacing: "Pacing", slo: "Curriculum SLO",
    prerequisite: "prerequisite", spaced: "spaced review",
    supportPage: "Reference", notReadAloud: "Not read aloud in class",
    p2Board: "The board at the end of the lesson", p2Model: "Model answers",
    p2Mistakes: "Common mistakes and the question you ask back",
    // bd-x0pw1. "Exam bank" was a filing label — it said which drawer the questions were in and
    // nothing about what they were for or whether the teacher had to use them. The operator's
    // heading does both jobs: FBISE names the register they are written in, and (Optional) is the
    // permission she was otherwise left to infer. The word belongs in the HEADING, not in the
    // questions — the author brief forbids repeating it inside the bank.
    p2Diff: "Differentiation", p2Exam: "FBISE format Questions - (Optional)", p2Hw: "Homework, in full",
    p2Next: "Next period", p2NotGoing: "Not going today", p2Coach: "Coaching corner",
    pupilSays: "What pupils write", youAsk: "You ask",
    stuck: "If stuck", barrier: "If the method is the barrier", early: "If they finish early",
    mcq: "MCQs — distractor-coded",
    // The SRQ label follows the GRADE. FBISE's examining remit starts at SSC, so on a
    // grade 6-8 plan nothing may be framed as board practice (the author brief forbids it).
    srq: "Short response — board phrasing", srqEarly: "Short response — exam-style",
    // bd-a8veu.17. "Extended response" is an assessment-designer's name for a question type and
    // "skeleton" was ours for the shape printed under it; a teacher calls it the long question, and
    // what the parts-and-marks structure is FOR is planning an answer that earns all of them. The
    // schema key stays `erq_skeleton` — this is the display label and nothing else.
    erq: "Long question — answer plan", markScheme: "Mark scheme", howMarked: "How this is marked",
    marks: "marks", drawOrder: "Draw it in this order", tier: { support: "support", core: "core", extension: "extension" },
    figureIn: "as in your book", page: "p.", reading: "Reading the diagram",
    // bd-s19g8. This line used to ENUMERATE what page 2 holds ("board plan, answers, mistakes,
    // differentiation"). Sections B and F are optional now, and E is going the same way, so a
    // hardcoded list on page 1 became a promise page 2 need not keep — the Urdu string, which
    // named نمونہ جوابات outright, advertised a model-answer block that was no longer printed.
    // The strip's job is to say what the following pages ARE, not to index them; the support
    // page carries its own lettered index.
    continues: "Support pages follow — planning material for you, not read aloud in class.", continued: "continued",
    // v8.1 footer + header furniture. `grade` used to be injected by template.js instead of
    // living here, which is why the Urdu pack silently had no say in it.
    // ── v9 furniture (the closed heading system) ──────────────────────────
    outcome: "Learning outcome", locallyAdded: "locally added",
    kind: { scaffold: "scaffold for today", prerequisite: "prerequisite", spaced: "spaced review" },
    seqPrev: "Last", seqNext: "Next", seqCheck: "Checkpoint",
    fromBook: "Teaching from", video: "Video",
    checkpoint: "Board question", exitTicket: "Exit ticket", reteach: "Re-teach rule",
    markAbbr: "m", teacherNote: "Teacher note —", distractors: "what each wrong option catches",
    refMissing: "\u26a0 this answer names no question in the plan",
    grade: "Grade", pp: "pp. ",
    pageOf: (n, m) => `page ${n} of ${m}`,
    // ── the coaching corner's standing offer (ported from the K-5 strip) ──
    // FURNITURE, not authored data: the number lives here and nowhere else, so it cannot drift
    // document to document and costs no words against the doc budget. K-5's own gate
    // (niete-nbpro/src/qa.js) checks for exactly this LOCAL form on the page — teachers did not
    // know what a wa.me link meant, and "+92" is not how the number is dialled here.
    // A CTA that does not say what comes BACK is just a request, so step 3 says it.
    coachAsk: "Ask yourself",
    coachOffer: "Record up to 40 minutes of this lesson",
    coachSend: "Send it to NIETE on WhatsApp — ⁦0320 6281951⁩",
    coachBack: "Same-day tips back: what worked, and one thing to try",
  },
  ur: {
    objectives: "تدریسی مقاصد", warmup: "ابتدائی دہرائی",
    introduction: "تعارف", development: "تدریس", activity: "سرگرمی",
    conclusion: "اختتام", homework: "گھر کا کام",
    min: "منٹ", say: "کہیے", ask: "اس سوال سے آغاز کریں", askPlain: "یہ سوال پوچھیں", lookFor: "جواب میں یہ دیکھیں",
    watch: "خیال رکھیے", board: "تختۂ سیاہ پر", keywords: "کلیدی الفاظ",
    keyPoints: "اہم نکات", worked: "حل شدہ مثال", faded: "نیم حل شدہ مثال",
    guided: "رہنمائی کے ساتھ مشق", independent: "انفرادی مشق",
    practice: "مشق", answer: "جواب", support: "مدد", extension: "اضافی کام",
    materials: "درکار اشیاء", pacing: "وقت کی تقسیم", slo: "متعینہ تدریسی مقصد",
    prerequisite: "سابقہ علم", spaced: "دہرائی",
    supportPage: "حوالہ جاتی مواد", notReadAloud: "کلاس میں پڑھ کر نہ سنائیں",
    p2Board: "سبق کے اختتام پر تختۂ سیاہ", p2Model: "نمونہ جوابات",
    p2Mistakes: "عام غلطیاں اور آپ کا جوابی سوال",
    // bd-x0pw1 — see the English note. FBISE is spelled out in Urdu letters rather than left in
    // Latin: the heading is the renderer's own furniture and sits in an RTL line, and a Latin
    // acronym there needs bidi isolates to print in the right order. The QUESTIONS under it are
    // still frozen to the book's language by the ur_overlay rule; only the heading is translated.
    p2Diff: "انفرادی فرق کے مطابق", p2Exam: "ایف بی آئی ایس ای طرز کے سوالات — (اختیاری)", p2Hw: "گھر کے کام کے مکمل جوابات",
    p2Next: "اگلا پیریڈ", p2NotGoing: "آج نہیں پڑھانا", p2Coach: "کوچنگ کارنر",
    pupilSays: "طلبہ کیا لکھتے ہیں", youAsk: "آپ پوچھیں",
    stuck: "اگر بچے اٹک جائیں", barrier: "اگر طریقہ رکاوٹ بنے", early: "اگر جلد فارغ ہو جائیں",
    mcq: "کثیر الانتخابی سوالات",
    srq: "مختصر جواب — بورڈ کے الفاظ میں", srqEarly: "مختصر جواب — امتحانی انداز",
    erq: "تفصیلی سوال — جواب کی ترتیب", markScheme: "نمبروں کی تقسیم", howMarked: "نمبر کیسے ملتے ہیں",
    marks: "نمبر", drawOrder: "اسی ترتیب سے بنائیں", tier: { support: "مدد", core: "بنیادی", extension: "اضافی" },
    figureIn: "آپ کی کتاب میں", page: "صفحہ ", reading: "تصویر کو کیسے پڑھیں",
    // bd-s19g8 — see the English note: no enumeration, because page 2's sections are optional.
    continues: "اگلے صفحات معاون مواد ہیں — یہ آپ کی تیاری کے لیے ہیں، کلاس میں پڑھ کر نہ سنائیں۔", continued: "جاری ہے",
    outcome: "تدریسی نتیجہ", locallyAdded: "مقامی اضافہ",
    kind: { scaffold: "آج کے سبق کی بنیاد", prerequisite: "سابقہ علم", spaced: "دہرائی" },
    seqPrev: "پچھلا", seqNext: "اگلا", seqCheck: "جانچ",
    fromBook: "تدریس بمطابق", video: "ویڈیو",
    checkpoint: "بورڈ کے انداز کا سوال", exitTicket: "اختتامی پرچی", reteach: "دوبارہ پڑھانے کا اصول",
    markAbbr: "نمبر", teacherNote: "استاد کے لیے نوٹ —", distractors: "ہر غلط جواب کس غلط فہمی کو پکڑتا ہے",
    refMissing: "\u26a0 اس جواب کا سوال منصوبے میں موجود نہیں",
    grade: "جماعت", pp: "صفحات ",
    pageOf: (n, m) => `صفحہ ${n} از ${m}`,
    // The Urdu page reflects in Urdu — the ONE thing that stays as it is printed is the number
    // itself, because that is what she dials.
    coachAsk: "خود سے پوچھیے",
    coachOffer: "اس سبق کی چالیس منٹ تک کی ریکارڈنگ بنائیے",
    // The number is wrapped in a LEFT-TO-RIGHT ISOLATE (U+2066 … U+2069). Without it the RTL
    // paragraph reorders the two digit groups and the page prints "6281951 0320" — a number
    // a teacher cannot dial. Found by rendering the Urdu page and looking at it.
    coachSend: "واٹس ایپ پر نیٹ کو بھیجیے — ⁦0320 6281951⁩",
    coachBack: "اسی دن جواب: کیا اچھا رہا، اور ایک بات جو آزمانی ہے",
  },
};

module.exports = { applyOverlay, frozenReason, MACHINE_KEYS, pointerGet, pointerParent, pointerParts, LABELS };
