// lp_doc 2.0 -> the 3.0 SHAPE, in memory, for the renderer.
//
// The v9 template renders exactly one shape. Rather than carry two layout code paths (which
// is how a "fix" lands in one and not the other), a 2.0 document is lifted into the 3.0 shape
// on the way into the renderer. This is a RENDER-TIME normalisation, never a rewrite of the
// artefact of record: the file on disk stays 2.0 and keeps being validated as 2.0.
//
// What the lift does, and why each is a lift and not a guess:
//   • objectives  [string]         -> { outcome, by_the_end, items:[{text, slo_code:null}] }
//                                     outcome = the first objective, which is what a 2.0 doc
//                                     put there by convention; by_the_end = slo.success_criterion.
//   • warmup      top-level        -> sections[introduction].warmup, minutes folded INTO the
//                                     introduction's own badge (spec §2: the warm-up is one row
//                                     inside the Introduction, not a section).
//   • say blocks                   -> paragraph blocks. Spec §8 bans the scripted box; the
//                                     WORDS are still the author's and are not thrown away.
//   • homework section             -> a plain section. A 2.0 doc has no tagged homework items,
//                                     so nothing is invented: the v9 homework table only prints
//                                     when the data is there.
// Everything else passes through untouched.

const clone = (x) => JSON.parse(JSON.stringify(x));

/** True for a document already in the 3.0 shape. */
const isV3 = (doc) => doc && doc.schema_version === "3.0";

function toV3(input) {
  if (isV3(input)) return input;
  const doc = clone(input);

  // objectives: array of strings -> the O box
  if (Array.isArray(doc.objectives)) {
    const items = doc.objectives.map((t) => ({ text: t, slo_code: null }));
    doc.objectives = {
      outcome: items.length ? items[0].text : (doc.slo && doc.slo.text_verbatim) || "",
      by_the_end: (doc.slo && doc.slo.success_criterion) || undefined,
      items,
    };
    if (doc.objectives.by_the_end === undefined) delete doc.objectives.by_the_end;
  }

  // warm-up: its own band -> a row inside the introduction, its minutes folded in
  if (doc.warmup && Array.isArray(doc.sections)) {
    const intro = doc.sections.find((s) => s.id === "introduction");
    if (intro) {
      intro.warmup = { items: (doc.warmup.items || []).map((i) => clone(i)) };
      intro.minutes = (intro.minutes || 0) + (doc.warmup.minutes || 0);
    }
    delete doc.warmup;
  }

  // say -> paragraph. The box goes; the sentence stays.
  const unsay = (blocks) => {
    for (const b of blocks || []) {
      if (b.type === "say") { b.type = "paragraph"; }
      if (b.type === "split") { unsay(b.left); unsay(b.right); }
    }
  };
  for (const s of doc.sections || []) unsay(s.blocks);

  doc.schema_version = "3.0";
  doc.template_version = "v9";
  doc.__migrated_from = "2.0";     // stripped before validation; the renderer never prints it
  return doc;
}

module.exports = { toV3, isV3 };
