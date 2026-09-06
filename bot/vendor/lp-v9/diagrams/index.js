// ─────────────────────────────────────────────────────────────────────────────
// DIAGRAM ENGINE — deterministic diagram-as-code → SVG for 6-12 lesson plans.
// LANE L2 owns this folder. (This replaces L1's placeholder stub; the contract
// L1 documented there is preserved verbatim below and is honoured by this code.)
//
// CONTRACT (the only thing render_lp.js depends on):
//
//     module.exports.renderDiagram(spec) -> string   // an <svg>…</svg> fragment
//
//   • `spec` is the lp_doc `diagram.spec` object, verbatim. It always has a
//     `type` (string); everything else is L2's per-type vocabulary. L1 never
//     inspects or rewrites it.
//   • The return value is inlined into the page inside a <figure>. It IS an
//     SVG fragment — no <html>, no <script>, no external url() references.
//   • The root <svg> carries a `viewBox` and `width="100%"` plus an inline
//     `height:auto;max-width:100%` — it can never overflow the A4 column.
//   • Colours are emitted as `var(--navy, #0B2545)` etc., so a diagram inherits
//     the LP palette when it is on the page and still renders standalone.
//   • Text is real <text>. Urdu comes through as <foreignObject> + dir="rtl" +
//     the Nastaliq stack, never SVG <text> (SVG has no bidi/shaping guarantees).
//   • Minimum type size is 12 user units ≈ 13 px at a 794 px page width.
//   • THROWS for an unknown `type` — L1 catches, substitutes its placeholder and
//     reports an unrendered diagram rather than shipping a silently blank box.
//   • Pure and SYNCHRONOUS: no network, no async. (It is also await-safe, so
//     `await renderDiagram(spec)` works if a caller prefers that form.)
//
// The one exception to "no filesystem": `labelled_figure` reads an image from a
// path when the spec gives one instead of a data URI, and `circuit` can shell out
// to schemdraw when `engine:"schemdraw"` is asked for explicitly. Both default to
// pure in-process rendering; the production path never touches either.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require("fs");
const path = require("path");

const TYPES_DIR = path.join(__dirname, "types");

function loadRegistry() {
  const reg = new Map();
  const mods = [];
  for (const f of fs.readdirSync(TYPES_DIR).sort()) {
    if (!f.endsWith(".js")) continue;
    // eslint-disable-next-line global-require
    const m = require(path.join(TYPES_DIR, f));
    for (const nm of [m.type, ...(m.aliases || [])]) {
      if (reg.has(nm)) throw new Error(`duplicate diagram type "${nm}" (${f})`);
      reg.set(nm, m);
    }
    mods.push(m);
  }
  return { reg, mods };
}

const { reg: REGISTRY, mods: MODULES } = loadRegistry();

class DiagramError extends Error {}

/**
 * Render one diagram spec to a complete, self-contained SVG string.
 * @param {object} spec {type, ...}
 * @returns {string}
 */
function renderDiagram(spec) {
  if (!spec || typeof spec !== "object") throw new DiagramError("renderDiagram: spec must be an object");
  const t = spec.type;
  if (!t) throw new DiagramError("renderDiagram: spec.type is required");
  const mod = REGISTRY.get(t);
  if (!mod) {
    throw new DiagramError(
      `renderDiagram: unknown diagram type "${t}". Known: ${[...REGISTRY.keys()].sort().join(", ")}`
    );
  }
  const out = mod.render(spec);
  if (typeof out !== "string" || !out.startsWith("<svg")) {
    throw new DiagramError(`renderDiagram: type "${t}" did not return an <svg> string`);
  }
  return out;
}

/** Every registered type with its aliases, one-line summary and first example. */
function listTypes() {
  return MODULES.map((m) => ({
    type: m.type,
    aliases: m.aliases || [],
    summary: m.summary || "",
    example: (m.examples && m.examples[0] && m.examples[0].spec) || null,
  })).sort((a, b) => a.type.localeCompare(b.type));
}

/** All named examples across all types — used by test.js and the gallery build. */
function allExamples() {
  const out = [];
  for (const m of MODULES) for (const ex of m.examples || []) out.push({ ...ex, type: m.type });
  return out;
}

// The collision contract. `checkOverlaps(svg)` returns [] for a clean diagram
// and one row per colliding pair otherwise. It reads the emitted STRING, so it
// is the same check whether the SVG came from this engine, a cached LP doc, or
// the lint gate in ../lint_lp.js. See README.md §"Collision contract".
const { checkOverlaps, elementBoxes, textBox } = require("./lib/measure");

// The DEGENERACY contract, alongside the collision one. checkOverlaps asks "can you read every
// label?"; checkDegenerate asks "is there a shape here worth reading?" — a near-flat
// parallelogram passes the first and fails the second. See lib/degenerate.js.
const { checkDegenerate } = require("./lib/degenerate");

module.exports = {
  renderDiagram,
  listTypes,
  allExamples,
  checkOverlaps,
  checkDegenerate,
  elementBoxes,
  textBox,
  DiagramError,
  IS_STUB: false,
};
