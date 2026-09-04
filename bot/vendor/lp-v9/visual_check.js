// visual_check.js — the deterministic gate for brief v3 §4b, THE VISUAL CONTRACT.
//
// A straight transliteration of `lp_author/visual_check.py` into the language the SERVING lane
// actually runs. Same rules V0–V14, same codes, same message strings — asserted string-for-string
// against the Python over 62 real lesson documents (`test/visual_check_parity.js`).
//
// WHY THIS FILE EXISTS AT ALL, given the Python already did.
// -------------------------------------------------------------------------------------------
// The Python gate was never reachable from the serving lane. `bot/vendor/lp-v9/` is a Node
// worker; nothing there can `import visual_check`, and nothing did. So `author_lp.py`'s own
// `except ImportError` fallback — "ONE visual of ANY kind", which its comment names as
// *"exactly how they shipped 'bereft' of diagrams"* — is what the runtime ran, permanently,
// while the brief told the model on every single call that this gate was running on its output.
//
// Measured over the 62 documents teachers actually received (39 delivered off staging + the
// n=24 study's 23 cells), 2026-09-04: the Python gate fails **48 of 62 (77%)** and **V6, the
// per-subject minimum, fires 45 times**. Live distribution was 1.77 diagrams/document, 82.6%
// of them flow+mindmap+panels, and NINE of the twenty diagram types never appeared once. The
// canon lane, same engine and schema and brief and model but with this gate ON, ran 3.00
// diagrams/document across 11 kinds. The gate is the only variable.
//
// What it deliberately does NOT do (unchanged from the Python): it cannot tell whether a
// diagram is GOOD, whether its labels are right, or whether it is the figure the lesson needed.
// A human reads the rendered page for that. This is a floor, not a judgement.

// The legal diagram types + their aliases, from `diagrams/README.md`.
// `illustrative` is legal to the renderer but is NOT a visual — it is the honest placeholder for
// art the engine does not draw, so it never counts toward a minimum.
const DIAGRAM_TYPES = new Set([
  "grid", "area_model", "hundred_square",
  "numberline", "number_line",
  "fraction_bar", "bar_model", "tape_diagram",
  "graph", "plot", "function_plot",
  "geometry", "construction",
  "flow", "process", "chain",
  "mindmap", "concept_map",
  "timeline", "chronology",
  "panels", "comparison", "compare",
  "circuit", "circuit_diagram",
  "ray_diagram", "optics", "lens", "mirror",
  "free_body", "fbd", "force_diagram", "vector",
  "atom", "bohr", "electron_shells", "dot_and_cross",
  "molecule", "smiles", "structure",
  "chem_equation", "equation", "reaction",
  "punnett", "genetics", "cross",
  "cell", "leaf_cross_section", "heart_loop", "bio_schematic",
  // `dna_helix` (aliases rna_helix / nucleic_acid_helix / helix) shipped into the engine in
  // PR #57 on 2026-09-02 and reached NO brief. A capability the model has never been shown
  // cannot be chosen — it appears 0 times in 115 shipped diagrams. §4b.4 now carries it.
  "dna_helix", "rna_helix", "nucleic_acid_helix", "helix",
  "labelled_figure", "textbook_figure", "photo_labels",
  "illustrative", "ai_art", "placeholder",
]);

// type -> canonical family, so a spec written with an alias still satisfies its subject minimum.
const CANON = {
  area_model: "grid", hundred_square: "grid",
  number_line: "numberline",
  bar_model: "fraction_bar", tape_diagram: "fraction_bar",
  plot: "graph", function_plot: "graph",
  construction: "geometry",
  process: "flow", chain: "flow",
  concept_map: "mindmap",
  chronology: "timeline",
  comparison: "panels", compare: "panels",
  circuit_diagram: "circuit",
  optics: "ray_diagram", lens: "ray_diagram", mirror: "ray_diagram",
  fbd: "free_body", force_diagram: "free_body", vector: "free_body",
  bohr: "atom", electron_shells: "atom", dot_and_cross: "atom",
  smiles: "molecule", structure: "molecule",
  rna_helix: "dna_helix", nucleic_acid_helix: "dna_helix", helix: "dna_helix",
  equation: "chem_equation", reaction: "chem_equation",
  genetics: "punnett", cross: "punnett",
  bio_schematic: "cell",
  photo_labels: "labelled_figure", textbook_figure: "labelled_figure",
  ai_art: "illustrative", placeholder: "illustrative",
};

const NON_VISUAL = new Set(["illustrative"]);

// Subject row of brief v3 §4b.2. Matched case-insensitively against provenance.subject as a
// SUBSTRING, longest key first, so "General Science" beats "Science".
//
// `one_of` is a LIST OF GROUPS and every group must be satisfied — a group is an OR, the list is
// an AND. That is the whole mechanism, and it is why the Biology row's shape mattered so much:
// see the note on that row.
const SUBJECT_RULES = {
  mathematic: {
    family: "maths",
    one_of: [["fraction_bar", "geometry", "graph", "grid", "numberline"]],
    latex_every_expression: true,
    marked_incorrect_example: true,
  },
  maths: { alias: "mathematic" },
  math: { alias: "mathematic" },
  chemistry: {
    family: "chemistry",
    one_of: [["chem_equation"], ["atom", "molecule"]],
    mole_ratio_latex: true,
    ce_required: true,
  },
  physics: {
    family: "physics",
    one_of: [["circuit", "free_body", "graph", "ray_diagram"]],
    formula_latex_block: true,
  },
  // TWO groups, deliberately — a SUBJECT-SPECIFIC figure and a PROCESS/RELATIONS map, not a
  // union of both.
  //
  // Until 2026-09-04 this was the single permissive union
  // ['cell','flow','labelled_figure','mindmap','punnett'], which one `flow` satisfies on its
  // own. That is why Biology posted ZERO V6 failures across the delivered corpus while carrying
  // ZERO labelled structures in 13 diagrams: the row asked for "a real labelled structure" in
  // the brief's prose and for "any of five things, one of which is flow" in the code, and the
  // code is what ran. The brief's own sentence for this row is "≥1 of cell ·
  // leaf_cross_section · heart_loop · labelled_figure — a real labelled structure. PLUS a
  // mindmap or a flow". Two groups IS that sentence, executed.
  //
  // `graph` is in the structure group because a biology graph — a growth curve, a bar chart
  // with error bars — is a real subject figure the book actually prints (323 of the 1,804
  // Biology illustrations read as a graph or chart). `punnett` and `dna_helix` likewise: they
  // are drawn biology, not a box-and-arrow abstraction of it.
  biology: {
    family: "biology",
    one_of: [
      ["cell", "dna_helix", "graph", "heart_loop", "labelled_figure", "leaf_cross_section", "punnett"],
      ["flow", "mindmap"],
    ],
    structure_or_process: true,
  },
  // GENERAL SCIENCE IS NOT BIOLOGY, and aliasing it there was over-reach.
  //
  // General Science 6–8 is biology AND chemistry AND physics in one book: of the 300 General
  // Science segments in the corpus, the delivered lessons include "Force: push and pull",
  // "Signs of chemical reactions" and "Flammability and hazard symbols" beside "Animal and
  // plant cell". Demanding a `cell` of a push-and-pull lesson forces an invented figure, which
  // is the opposite of what this gate is for — and only 70% of General Science segments carry a
  // labelled structure in their page-truth at all.
  //
  // So the structure group is the science-specific set across all three sciences. What is
  // EXCLUDED is the point: `flow`, `mindmap` and `panels` — the three types constructible from
  // any prose whatsoever, which is exactly why they are 83.5% of everything shipped.
  "general science": {
    family: "biology",
    one_of: [
      ["atom", "cell", "chem_equation", "circuit", "dna_helix", "free_body", "graph",
        "heart_loop", "labelled_figure", "leaf_cross_section", "molecule", "punnett", "ray_diagram"],
      ["flow", "mindmap"],
    ],
    structure_or_process: true,
  },
  english: {
    family: "literacy",
    one_of: [["mindmap"], ["flow", "timeline"]],
  },
  urdu: { alias: "english" },
  "pakistan studies": {
    family: "social",
    one_of: [["graph", "timeline"], ["panels"]],
  },
  "pak studies": { alias: "pakistan studies" },
  history: { alias: "pakistan studies" },
  geography: { alias: "pakistan studies" },
  islamiat: {
    family: "islamiat",
    one_of: [["flow", "mindmap", "panels"]],
    islamiat_rules: true,
  },
  islamiyat: { alias: "islamiat" },
  // COMPUTER SCIENCE HAD NO ROW AT ALL, so every CS lesson tripped V0 ("subject matches no row
  // in §4b.2") and NOTHING checked its diagrams — V0 fired on 4 delivered documents and the
  // gate then RETURNED, so none of V6-V14 ever ran on a CS lesson either.
  //
  // The row is derived from the CS page-truth, not from instinct. Across the 585 CS segments
  // (85% carry a figure), the printed figures read as: screenshots/interfaces 702, tables and
  // grids 414, graphs and charts 400, labelled structures 364, photographs 303, side-by-side
  // comparisons 88 — and flowcharts/algorithms only 54. So `flow` is genuinely right for an
  // algorithm chapter and stays first-class, but it is NOT what this book is mostly made of,
  // and a CS lesson that is nothing but one flowchart is the degenerate case this whole gate
  // exists to stop. Hence: a process-or-classification map, AND a second visual that is not
  // another process map.
  "computer science": {
    family: "computing",
    one_of: [
      ["flow", "mindmap"],
      ["graph", "grid", "labelled_figure", "panels", "timeline"],
    ],
  },
  computing: { alias: "computer science" },
  "information technology": { alias: "computer science" },
  // Agricultural Education (زرعی تعلیم) was the OTHER subject with no row — the same V0
  // short-circuit as Computer Science, on 132 segments. Its 309 printed figures are tables (107)
  // and paired before/after experiment illustrations — two pots, one watered and one not — with
  // 14 labelled structures and 10 charts. `panels` is therefore the book's own dominant shape
  // here and belongs in the first group, which is NOT true of any other subject in this table.
  "agricultural education": {
    family: "applied",
    one_of: [
      ["cell", "graph", "grid", "labelled_figure", "leaf_cross_section", "panels", "timeline"],
      ["flow", "mindmap"],
    ],
  },
  "zarai taleem": { alias: "agricultural education" },
};

// Notation written as prose that should have been $…$ / \ce{}. Deliberately narrow: each pattern
// was seen in a real v1 sample, and a false positive here costs a revision round for nothing.
const PROSE_MATHS = [
  [/\b(?:x|y|n)\s+squared\b/i, "“x squared” — write $x^2$"],
  [/\b(?:x|y|n)\s+cubed\b/i, "“x cubed” — write $x^3$"],
  [/\bsquare root of\b/i, "“square root of” — write $\\sqrt{…}$"],
  [/\bto the power (?:of )?\w+/i, "“to the power of” — write an exponent in $…$"],
  [/\bdivided by\b/i, "“divided by” — write $\\frac{…}{…}$ or $a \\div b$"],
  [/\bthe determinant of\s+[A-Z]\b/i, "“the determinant of A” — write $\\det(A)$ or $|A|$"],
  [/\b(?:one|two|three|1|2|3)\s+over\s+(?:one|two|three|\d)\b/i, "a fraction in words — use $\\frac{}{}$"],
];

// A chemical formula sitting in plain prose. Requires a digit so "CO" or "IT" cannot match, and a
// leading capital + lowercase-optional element pattern so "H2O", "CO2", "H2SO4", "CaCO3" all hit.
//
// `\w` in Python is UNICODE-aware on a str; JavaScript's is ASCII-only. The guards are therefore
// written as explicit unicode classes so an Urdu letter beside a token blocks the match here
// exactly as it does upstream — without that the port fires on Urdu pages the Python passes.
const PROSE_CHEM = /(?<![\\{])(?<![\p{L}\p{N}_])((?:[A-Z][a-z]?\d+){1,}[A-Z]?[a-z]?\d*)(?![\p{L}\p{N}_}])/gu;
const PROSE_CHEM_SHAPE = /^(?:[A-Z][a-z]?\d+)+[A-Z]?[a-z]?\d*$/;
const CHEM_WHITELIST = new Set([
  "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12",
  "A4", "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10", "B11",
  "V3", "P1", "P2", "Q1", "Q2", "Q3", "Q4", "SSC1", "HSSC1", "SSC2", "HSSC2",
]);

// ───────────────────────────────────────────────────────── python-shaped helpers
//
// The message strings are asserted byte-for-byte against the Python, and several of them
// interpolate a LIST or a repr. Python renders those in its own way; these two helpers are how
// the port says the same words rather than nearly the same words.

/** Python's `f"{sorted(xs)}"` — `['a', 'b']`, single quotes, comma-space. */
function pyList(xs) {
  return `[${xs.map((x) => `'${x}'`).join(", ")}]`;
}
/** Python's `{x!r}` for the values that reach it here: a string, or None. */
function pyRepr(x) {
  return x === undefined || x === null ? "None" : `'${x}'`;
}
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

// ───────────────────────────────────────────────────────── walking the doc

/** Yield [section_id, block] for every block anywhere in the document, splits flattened. */
function iterBlocks(doc) {
  const out = [];
  const walk = (secId, blocks) => {
    for (const b of blocks || []) {
      if (!isObj(b)) continue;
      out.push([secId, b]);
      if (b.type === "split") {
        for (const side of ["left", "right"]) {
          if (isObj(b[side])) walk(secId, [b[side]]);
        }
      }
    }
  };
  // The warm-up has never carried `blocks` in either era — it is a list of q/a `items` — so this
  // yields nothing and always did. It is kept, pointed at the v9 home (sections[].warmup) rather
  // than the v2 top-level key, so that if the warm-up ever grows blocks the visual contract sees
  // them instead of silently skipping them.
  for (const s of doc.sections || []) walk("warmup", ((s || {}).warmup || {}).blocks);
  walk("warmup", (doc.warmup || {}).blocks); // 2.0 documents keep it at the top level
  for (const s of doc.sections || []) walk((s || {}).id || "?", (s || {}).blocks);
  return out;
}

/** [all families found anywhere, [[section_id, family]] for real `diagram` blocks only]. */
function diagramFamilies(doc) {
  const fams = [];
  const placed = [];
  for (const [sec, b] of iterBlocks(doc)) {
    const t = b.type;
    if (t === "diagram") {
      const spec = b.spec || {};
      const fam = Object.prototype.hasOwnProperty.call(CANON, spec.type) ? CANON[spec.type] : spec.type;
      if (fam) {
        fams.push(fam);
        placed.push([sec, fam]);
      }
    } else if (t === "textbook_figure") {
      fams.push("labelled_figure");
    }
  }
  const bf = ((doc.page2 || {}).board_final || {}).diagram;
  if (isObj(bf) && bf.type) {
    fams.push(Object.prototype.hasOwnProperty.call(CANON, bf.type) ? CANON[bf.type] : bf.type);
  }
  return [fams, placed];
}

function allStrings(node, ptr = "", out = []) {
  if (typeof node === "string") out.push([ptr, node]);
  else if (Array.isArray(node)) node.forEach((v, i) => allStrings(v, `${ptr}/${i}`, out));
  else if (isObj(node)) for (const [k, v] of Object.entries(node)) allStrings(v, `${ptr}/${k}`, out);
  return out;
}

const TEACHER_SKIP_PREFIX = [
  "/provenance", "/slo/text_verbatim", "/notes", "/lesson_id", "/schema_version",
  "/lint_profile", "/lp_type", "/revisions",
  // v9 (lp_doc 3.0). `sequence` is the navigation strip near the masthead — it NAMES the
  // neighbouring lessons the way a contents page does ("the determinant of A", p.26), and
  // requiring $\det(A)$ in a lesson title is over-reach, not rigour. `one_screen` is the
  // WhatsApp MESSAGE BODY, not the page — WhatsApp has no KaTeX renderer, so "write $\det(A)$"
  // there puts a literal dollar-sign LaTeX string in front of a teacher.
  "/sequence", "/one_screen", "/template_version",
];
// v9 codes and refs are IDENTIFIERS, not prose: an slo_code "M-09-A-07", an item ref "H3", a
// K/U/A level, a format "mcq". Reading them as teacher prose is how a notation check fires on a tag.
const TEACHER_SKIP_LEAF = new Set([
  "slo_code", "ref", "level", "format", "kind", "textbook_page", "page", "closed_by", "id",
]);

/** Prose a teacher reads — the only place "x squared" or a bare H2O is a defect. */
function teacherStrings(doc) {
  const out = [];
  for (const [ptr, s] of allStrings(doc)) {
    if (TEACHER_SKIP_PREFIX.some((p) => ptr.startsWith(p))) continue;
    if (TEACHER_SKIP_LEAF.has(ptr.split("/").pop())) continue;
    // A diagram's labels are SVG text: they cannot carry LaTeX, so `y = x² − 2x − 3` there is
    // right, not a miss.
    if (ptr.includes("/spec/") || ptr.endsWith("/spec")) continue;
    if (ptr.includes("/board_final/diagram")) continue;
    if (ptr.endsWith("/tex") || ptr.endsWith("/equation")) continue;
    out.push([ptr, s]);
  }
  return out;
}

function resolveRule(subject) {
  const s = (subject || "").toLowerCase();
  const keys = Object.keys(SUBJECT_RULES).sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
  for (const key of keys) {
    if (s.includes(key)) {
      let rule = SUBJECT_RULES[key];
      while (rule.alias) rule = SUBJECT_RULES[rule.alias];
      return rule;
    }
  }
  return null;
}

// ───────────────────────────────────────────────────────── the checks

/**
 * @param {object} doc an lp_doc (2.0 or 3.0)
 * @returns {string[]} one line per defect, each beginning with its V-code
 */
function check(doc) {
  const errs = [];
  const prov = doc.provenance || {};
  const subject = prov.subject || "";
  const grade = prov.grade || 0;
  const [fams, placed] = diagramFamilies(doc);
  const real = fams.filter((f) => !NON_VISUAL.has(f));
  const bodyDiagrams = placed.filter(([, f]) => !NON_VISUAL.has(f));

  // ── V1 · two typed diagrams, one at the point of use
  const boardDia = ((doc.page2 || {}).board_final || {}).diagram;
  const hasBoardDia = isObj(boardDia) && Boolean(boardDia.type);
  const totalDia = bodyDiagrams.length + (hasBoardDia ? 1 : 0);
  if (totalDia < 2) {
    errs.push(`V1 the lesson carries ${bodyDiagrams.length} in-body typed \`diagram\` block(s) `
      + `and ${hasBoardDia ? "a" : "no"} board_final diagram = ${totalDia}; `
      + "brief v3 §4b.1 requires at least 2");
  }
  if (!bodyDiagrams.some(([sec]) => sec === "development" || sec === "activity")) {
    errs.push("V2 no `diagram` block sits inside `development` or `activity` — §4b.1 requires "
      + "one AT THE POINT OF USE, beside the beat it explains");
  }

  // ── V3 · the board's final state is a picture, not prose about one
  if (!hasBoardDia) {
    errs.push("V3 page2.board_final.diagram is missing — §4b.1 makes it required; "
      + "`draw_order` is prose about a picture, not the picture");
  }

  // ── V4 · no placeholder art
  if (fams.some((f) => NON_VISUAL.has(f))) {
    errs.push("V4 an `illustrative` spec is present — that is the engine's honest placeholder "
      + "for art it does not draw, never a visual (§4b.1.7)");
  }

  // ── V5 · unknown diagram type (would throw in the renderer)
  for (const [sec, b] of iterBlocks(doc)) {
    if (b.type === "diagram") {
      const t = (b.spec || {}).type;
      if (!DIAGRAM_TYPES.has(t)) {
        errs.push(`V5 /${sec} diagram spec type ${pyRepr(t)} is not one of the 19 legal types — `
          + "the renderer throws and ships a placeholder");
      }
    }
  }

  const rule = resolveRule(subject);
  if (rule === null) {
    errs.push(`V0 subject ${pyRepr(subject)} matches no row in §4b.2 — add one before authoring it`);
    return errs;
  }

  // ── V6 · the subject's own minimum
  const have = new Set(real);
  for (const group of rule.one_of || []) {
    if (!group.some((g) => have.has(g))) {
      errs.push(`V6 [${subject}] none of ${pyList([...group].sort())} is present; §4b.2 requires one of `
        + `them. Present: ${have.size ? pyList([...have].sort()) : "nothing"}`);
    }
  }

  const strings = teacherStrings(doc);
  const blob = strings.map(([, s]) => s).join(" ");
  // everything, notation included — for the checks that WANT to see \ce{} and \frac
  const full = allStrings(doc).map(([, s]) => s).join(" ");

  // ── V7 · maths written as prose
  if (rule.latex_every_expression) {
    const hits = [];
    for (const [pat, msg] of PROSE_MATHS) {
      for (const [ptr, s] of strings) {
        if (pat.test(s)) { hits.push(`${ptr}: ${msg}`); break; }
      }
    }
    if (hits.length) {
      errs.push("V7 mathematical notation written as prose (§4b.1.4) — " + hits.slice(0, 4).join("; "));
    }
    const hasLatex = iterBlocks(doc).some(([, b]) => b.type === "latex") || full.includes("$");
    if (!hasLatex) {
      errs.push("V7 a Mathematics lesson with no `$…$` and no `latex` block anywhere — "
        + "§4b.2 requires LaTeX on every expression");
    }
  }

  // ── V8 · the marked incorrect example
  if (rule.marked_incorrect_example) {
    const low = blob.toLowerCase();
    const worded = ["incorrect", "wrong", "mistake", "error"].some((m) => low.includes(m));
    const marked = ["✗", "غلط"].some((m) => blob.includes(m));
    if (!worded && !marked) {
      errs.push("V8 [Maths] no marked incorrect example — §4b.2 requires one worked/faded "
        + "example showing the wrong step with the error EXPLICITLY MARKED (R5), "
        + "beside the correct line");
    }
  }

  // ── V9 · chemistry notation
  if (rule.ce_required) {
    if (!full.includes("\\ce{") && !iterBlocks(doc).some(([, b]) => b.type === "chem")) {
      errs.push("V9 [Chemistry] no `\\ce{…}` and no `chem` block — §4b.1.5 requires every "
        + "species and equation in mhchem");
    }
    let bad = (full.match(/\\ce\{[^}]*?[A-Za-z0-9)]\+[A-Z]/g) || []).length;
    for (const [ptr, t] of allStrings(doc)) {
      if ((ptr.endsWith("/tex") || ptr.endsWith("/equation")) && /^[^$]*[A-Za-z0-9)]\+[A-Z]/.test(t)) bad += 1;
    }
    if (bad) {
      errs.push("V9 [Chemistry] a `+` operator welded to the species on its right in "
        + `${bad} \\ce{} string(s) — mhchem reads it as an ionic charge (L15). `
        + "Put spaces around it.");
    }
  }
  if (rule.mole_ratio_latex) {
    const topicish = `${prov.topic || ""} ${doc.lesson_id === undefined ? "None" : String(doc.lesson_id)}`.toLowerCase();
    const wantMole = topicish.includes("mole") || blob.toLowerCase().includes("mole")
      || blob.toLowerCase().includes("stoichiom");
    if (wantMole) {
      // \dfrac and \tfrac are the same ratio typeset — the first version of this check only
      // looked for \frac and reported a FALSE MISS on a correct document. A gate that fails a
      // correct document costs a revision round and teaches the author to distrust it.
      const hasRatio = ["\\frac", "\\dfrac", "\\tfrac", "\\cfrac"].some((t) => full.includes(t))
        || iterBlocks(doc).some(([, b]) => b.type === "latex");
      if (!hasRatio) {
        errs.push("V9b [Chemistry] the mole ratio is not typeset — §4b.2 requires a "
          + "mole-ratio worked example in LaTeX ($\\frac{n(X)}{n(Y)}$ or a `latex` "
          + "block) with the arithmetic shown, not described");
      }
    }
  }

  // ── V10 · physics formula
  if (rule.formula_latex_block) {
    if (!iterBlocks(doc).some(([, b]) => b.type === "latex")) {
      errs.push("V10 [Physics] no `latex` block — §4b.2 requires the governing formula as a "
        + "display `latex` block with its symbols defined and the substitution shown");
    }
  }

  // ── V11 · chemical formulae left in plain prose, any subject
  const proseChem = [];
  for (const [ptr, s] of strings) {
    // ignore strings that are already inside \ce{} or $…$
    let stripped = s.replace(/\\ce\{[^}]*\}/g, " ");
    stripped = stripped.replace(/\$[^$]*\$/g, " ");
    PROSE_CHEM.lastIndex = 0;
    let m;
    while ((m = PROSE_CHEM.exec(stripped)) !== null) {
      const tok = m[1];
      if (CHEM_WHITELIST.has(tok) || tok.length < 3) continue;
      if (!PROSE_CHEM_SHAPE.test(tok)) continue;
      proseChem.push(`${ptr}: ${tok}`);
      break;
    }
  }
  if (proseChem.length && ["chemistry", "biology", "physics"].includes(rule.family)) {
    errs.push("V11 chemical formula(e) in plain prose — wrap in \\ce{{}} (§4b.1.5): "
      + proseChem.slice(0, 4).join("; "));
  }

  // ── V12 · Islamiat (§4c) — the deterministic half of it
  if (rule.islamiat_rules) {
    if (!doc.needs_human_review) {
      errs.push("V12 [Islamiat] needs_human_review must be true with a human_review_reason "
        + "(§4c.1) — no Islamiat lesson is served on demand");
    }
    for (const [sec, b] of iterBlocks(doc)) {
      if (b.type === "textbook_figure" || b.type === "labelled_figure") {
        errs.push(`V12 [Islamiat] /${sec} carries a raster figure — §4c.2 allows concept `
          + "diagrams only; no figurative imagery in a religious lesson");
      }
      if (b.type === "diagram") {
        const st = (b.spec || {}).type;
        const fam = Object.prototype.hasOwnProperty.call(CANON, st) ? CANON[st] : st;
        if (fam === "labelled_figure") {
          errs.push(`V12 [Islamiat] /${sec} labelled_figure — §4c.2 forbids it here`);
        }
      }
    }
    // a de-pointed honorific: bare "SAW"/"PBUH"/"s.a.w" instead of ﷺ
    if (/\b(?:PBUH|S\.?A\.?W\.?|SAWW|RA)\b/.test(blob)) {
      errs.push("V12 [Islamiat] a transliterated/abbreviated honorific (PBUH / SAW / RA) — "
        + "§4c.5 requires the printed form (ﷺ, رضی الله عنہ) exactly as the book sets it");
    }
    if (prov.medium === "ur" && doc.ur_overlay) {
      errs.push("V12 [Islamiat] an Urdu-medium book must be authored in Urdu with no "
        + "ur_overlay (§4c.6)");
    }
  }

  // ── V13 · grade sanity on the visual side
  if (grade && grade <= 8 && doc.board_weight) {
    errs.push("V13 grades 6-8 have no FBISE board component — board_weight must be null");
  }

  // ── V14 · A TALL VERTICAL FLOW EATS A PAGE, and the word count cannot see it.
  // A `flow` with `direction: "tb"` stacks its steps in one column at ~150px per step, so six
  // steps is ~935px — 86% of an A4 page for one figure. `lr` is the renderer's default and wraps
  // into rows; the same six steps then measure 408px.
  for (const [sec, blk] of iterBlocks(doc)) {
    const spec = isObj(blk) ? blk.spec : null;
    if (!isObj(spec) || spec.type !== "flow") continue;
    const steps = spec.steps || [];
    if (spec.direction === "tb" && steps.length >= 4) {
      errs.push(`V14 [${sec}] a \`flow\` with direction:"tb" and ${steps.length} steps stacks into a `
        + `~${150 * steps.length}px column — most of a page for one figure. Use "lr" (the `
        + "default; it wraps into rows), or split the flow. If the steps are not actually "
        + "sequential, a `mindmap` is the honest shape.");
    }
  }

  return errs;
}

/**
 * Did this document meet EVERY group of its subject's §4b.2 minimum?
 *
 * The reward side of the contract. `check()` says what is wrong; this says the one thing that is
 * RIGHT and that acceptance must never trade away — see `notWorse` in the author service. A
 * subject with no §4b.2 row returns false: nothing to satisfy is not the same as satisfied.
 */
function meetsSubjectMinimum(doc) {
  const rule = resolveRule((doc.provenance || {}).subject || "");
  if (!rule) return false;
  const groups = rule.one_of || [];
  if (!groups.length) return false;
  const [fams] = diagramFamilies(doc);
  const have = new Set(fams.filter((f) => !NON_VISUAL.has(f)));
  return groups.every((group) => group.some((g) => have.has(g)));
}

module.exports = {
  check,
  meetsSubjectMinimum,
  diagramFamilies,
  resolveRule,
  iterBlocks,
  teacherStrings,
  SUBJECT_RULES,
  DIAGRAM_TYPES,
  CANON,
  NON_VISUAL,
};

// ───────────────────────────────────────────────────────── cli
if (require.main === module) {
  const fs = require("fs");
  const path = require("path");
  const args = process.argv.slice(2);
  const asTable = args.includes("--table");
  const asJson = args.includes("--json");
  const files = args.filter((a) => !a.startsWith("--"));
  if (!files.length) {
    console.error("usage: node visual_check.js <lp_doc.json> [more.json ...] [--table] [--json]");
    process.exit(2);
  }
  let rc = 0;
  const rows = [];
  for (const f of files) {
    if (f.endsWith(".report.json")) continue;
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(f, "utf8"));
    } catch (e) {
      console.log(`✗ ${path.basename(f)}: unreadable (${e.message})`);
      rc = 1;
      continue;
    }
    const errs = check(doc);
    const [fams] = diagramFamilies(doc);
    const dia = fams.filter((x) => !NON_VISUAL.has(x));
    rows.push({ doc: path.basename(f), subject: (doc.provenance || {}).subject, diagrams: dia, errors: errs });
    if (errs.length) rc = 1;
    if (!asTable && !asJson) {
      console.log(`${errs.length ? "✗" : "✓"} ${path.basename(f)}  [${dia.join(", ") || "NO DIAGRAMS"}]`);
      for (const e of errs) console.log(`    ${e}`);
    }
  }
  if (asJson) console.log(JSON.stringify(rows, null, 1));
  else if (asTable) {
    for (const r of rows) {
      console.log(`${r.errors.length ? "✗" : "✓"} ${r.doc.slice(0, 46).padEnd(46)} `
        + `${r.diagrams.length} dia  ${r.errors.length} err  ${r.diagrams.join(",")}`);
    }
  }
  process.exit(rc ? 1 : 0);
}
