'use strict';
/**
 * A picture-description frame needs a scene the key can be read against (v37 G5 Urdu Q7, bd-5jmnfj.4.58). The frame
 * printed empty with a teacher line, while the key described a boy, a monkey and a giraffe the page never showed.
 *   pictureSceneShortfall  an item in a picture frame with a word bank and no `describe_en` is asked again.
 *   noteUndrawnScenes      if the drawing failed (no `picture`), the teacher's supply line prints the scene the key
 *                          describes, so paper and key agree. Mutates `_layout.supplies` in place.
 */

const frameSlots = (examJson) => new Set((((examJson && examJson._layout && examJson._layout.sections) || []).flatMap((s) => s.slots || []))
  .filter((s) => s.frame && s.frame.kind === 'picture' && s.frame.word_bank).map((s) => s.slot));

function frameItems(examJson) {
  const wanted = frameSlots(examJson);
  const out = [];
  ['seen', 'unseen'].forEach((b) => Object.values((examJson && examJson[b]) || {}).forEach((types) => Object.values(types || {}).forEach((l) => {
    (Array.isArray(l) ? l : []).forEach((q) => { if (q && wanted.has(q.slot)) out.push(q); });
  })));
  return out;
}

const hasScene = (q) => typeof q.describe_en === 'string' && q.describe_en.trim();

function pictureSceneShortfall(examJson) {
  const bad = frameItems(examJson).filter((q) => !hasScene(q));
  return bad.map((q) => ({ slot: q.slot, reason: 'answer', items: [`${String(q.question).trim()} (no describe_en: the picture frame needs the scene the model answer describes, as one short English line)`] }));
}

function noteUndrawnScenes(examJson) {
  const supplies = (examJson && examJson._layout && examJson._layout.supplies) || [];
  frameItems(examJson).filter((q) => hasScene(q) && !(q.picture && q.picture.src)).forEach((q) => {
    const line = supplies.find((s) => s.slot === q.slot);
    if (!line) return;
    const scene = q.describe_en.trim();
    line.line_en = `${line.line_en} Scene for the picture: ${scene}`;
    line.line_ur = `${line.line_ur} — منظر (Scene): ${scene}`;
  });
  return examJson;
}

module.exports = { pictureSceneShortfall, noteUndrawnScenes };
