/**
 * bd-7l7ne -- WHAT PRIMARY ENRICHMENT DOES NOT CARRY IS NOT PRINTED ON A PRIMARY PLAN.
 *
 * Operator, on the first G1-5 plan rendered end to end from its live ICT traces:
 * *"what is pending is not relevant for Primary."*
 *
 * Stage-C enrichment for grades 1-5 does not produce seven of the surfaces the v9 schema makes
 * required, so `d0_page2.py` fills each with one sentinel string rather than inventing a proxy:
 *
 *     design pending -- not carried by primary Stage-C enrichment
 *
 * On grades 6-12 printing that is right. The surface exists, an author owes it, and the teacher
 * seeing the blank is how it gets written. A primary teacher is owed none of them, and on her
 * plan the same sentinel was nine lines of apology for surfaces that were never part of her
 * lesson.
 *
 * WHY THE CUT IS HERE AND NOT IN D0. `d0_page2.py` settled this once already, for `board_final`:
 * *"The suppression is the RENDERER's, not this module's, and deliberately so ... a D0 that
 * emitted nothing would be asking the schema to bend for one grade band."* So the DOCUMENT keeps
 * every sentinel -- the schema requires the property, lint reads it, and the enrichment backlog
 * IS that list. Only the paint changes. A stored lesson re-renders without them at no model cost,
 * and the day enrichment starts carrying a surface it appears with no render change at all.
 *
 * WHY THIS IS ITS OWN FILE. Operator, the same day: *"pls make sure the 1-5 work is separate from
 * 6-12."* Nothing in here runs for a grade 6-12 document -- `renderDoc` calls `prunePending` only
 * behind `ctx.primary`, which reads `provenance.grade` off the document itself. Keeping the rule
 * in one module rather than as nine conditions scattered through the painters is what makes that
 * claim checkable: `tests/lp612/primary-pending.test.js` asserts a grade-9 build is BYTE-IDENTICAL
 * with this module present.
 *
 * EVERY DROP IS LOUD. `prunePending` reports each one and `renderDoc` pushes them to the build
 * warnings, on the law `d0_diagram.py` sets for the diagram slots: a silent drop and an authoring
 * gap look identical from the outside, and telling them apart is the whole job of this pipeline.
 * The Grade 3 Maths Ch.2 Day 5 sample is the case in point -- its Check section holds exactly one
 * block and that block is a placeholder, so the section goes, and the warning is how anyone learns
 * that the lesson has no plenary rather than a badly rendered one.
 */

/**
 * The sentinel `d0_blocks.DESIGN_PENDING` writes, matched on its stable head rather than in full.
 *
 * There WAS a second sentinel, `L.videoPending` -- "design pending -- no video mapped yet" --
 * which this pattern deliberately did not match: it was a LABEL the renderer painted on an
 * unmapped day rather than a string the document carried, so it was the operator's to rule on
 * separately. She has (bd-jka9b): *"what is pending is not relevant for Primary."* The row and the
 * label are both gone, and the rationale recorded for them here was false anyway -- the videos
 * sheet was never 403 to the build account, and the SLO join reads it (bd-v2ikv).
 *
 * The distinction that outlives it is the one worth keeping: this module prunes pending content
 * OUT OF THE DOCUMENT, where "dark stages stay dark" governs and every drop is reported. Page
 * furniture the renderer paints around the document is a separate decision each time.
 */
const PENDING = /^\s*design pending\s*[—–-]\s*not carried\b/i;

const isPending = (v) => typeof v === "string" && PENDING.test(v);

/**
 * Keys that identify a node rather than fill it.
 *
 * A node that keeps only these has nothing left to say, so it goes: a `key_points` block reduced
 * to `{type, id, title}` would otherwise paint a heading over an empty list, and a section reduced
 * to `{id, title, minutes}` would paint a bare coloured bar -- which is exactly the "Check - 3 min"
 * bar with nothing under it that started this. `title` counts as identity for the same reason:
 * on these blocks it is the label of the content, never the content.
 */
const STRUCTURAL = new Set([
  "type", "id", "kind", "title", "move", "minutes", "n", "day", "of", "marks", "level", "lang",
]);

/** `path`, with the node's own name appended, so a warning says WHAT went and not only where. */
const label = (path, v) => {
  const name = v && typeof v === "object" ? (v.type || v.id) : null;
  return name ? `${path} (${name})` : path;
};

/**
 * One node, pruned.
 *
 * Returns `{ value, reports }`; `value === undefined` means the node itself is gone. Reports are
 * collapsed to the OUTERMOST drop -- when a block loses every paragraph, the warning names the
 * block, not each paragraph, because the block is the thing that left the page.
 *
 * A node that loses nothing is returned UNCHANGED, by reference. That is what keeps the structural
 * rule above from doing collateral damage: an object that legitimately holds only identity keys is
 * never touched, because nothing in it was pending.
 */
function prune(v, path) {
  if (isPending(v)) return { reports: [path] };
  if (Array.isArray(v)) {
    const out = [];
    let reports = [];
    let changed = false;
    let emptied = true;
    v.forEach((item, i) => {
      const r = prune(item, `${path}[${i}]`);
      reports = reports.concat(r.reports);
      if (r.value === undefined) { changed = true; return; }
      if (r.value !== item) changed = true;
      emptied = false;
      out.push(r.value);
    });
    if (!changed) return { value: v, reports };
    return emptied ? { reports: [path] } : { value: out, reports };
  }
  if (v && typeof v === "object") {
    const out = {};
    let reports = [];
    let content = 0;
    let changed = false;
    for (const k of Object.keys(v)) {
      const r = prune(v[k], `${path}/${k}`);
      reports = reports.concat(r.reports);
      if (r.value === undefined) { changed = true; continue; }
      if (r.value !== v[k]) changed = true;
      out[k] = r.value;
      if (!STRUCTURAL.has(k)) content += 1;
    }
    if (!changed) return { value: v, reports };
    return content ? { value: out, reports } : { reports: [label(path, v)] };
  }
  return { value: v, reports: [] };
}

/**
 * The branches a lesson's CONTENT lives in. Provenance, sequence and the furniture are not walked:
 * they carry no authored prose, and a generic sweep over the whole document would be a much larger
 * claim than this change is making.
 */
const BRANCHES = ["objectives", "sections", "page2", "big_idea"];

/**
 * `doc` with every design-pending surface removed, plus one report per drop.
 *
 * The input document is never mutated -- untouched branches come back by reference and changed
 * ones are rebuilt -- so the caller keeps the document the schema validated.
 */
function prunePending(doc) {
  if (!doc || typeof doc !== "object") return { doc, dropped: [] };
  const out = { ...doc };
  const dropped = [];
  for (const key of BRANCHES) {
    if (out[key] == null) continue;
    const r = prune(out[key], key);
    dropped.push(...r.reports);
    if (r.value === undefined) delete out[key];
    else out[key] = r.value;
  }
  return { doc: dropped.length ? out : doc, dropped };
}

module.exports = { isPending, prunePending, PENDING };
