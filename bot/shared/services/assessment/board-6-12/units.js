'use strict';
/**
 * The calls a board paper is written in: one per section, or one per timed part of a section.
 * design_pending: SPEC gives no shape for `section.parts` (no entry has one yet); the smallest reading
 * is [{id, slots:[slot ids], time_min?}]. Anything else is ignored and the section is one unit.
 */

const x4 = (m) => Math.round(m * 4);
const isPartList = (parts) => Array.isArray(parts) && parts.length > 0 && parts.every((p) => p && Array.isArray(p.slots));
const generatesAny = (slots) => slots.some((s) => !(s.teacher_marked || s.project) && s.generate > 0);

function unitsOf(variant) {
  const out = [];
  variant.sections.forEach((sec) => {
    const title = sec.label_en || sec.id;
    if (isPartList(sec.parts)) {
      sec.parts.forEach((p, i) => {
        const slots = sec.slots.filter((s) => p.slots.includes(s.slot));
        out.push({ key: `${sec.id}(${p.id || i + 1})`, section: sec, title, slots, time_min: p.time_min == null ? null : p.time_min, generates: generatesAny(slots) });
      });
    } else {
      out.push({ key: sec.id, section: sec, title, slots: sec.slots, time_min: sec.time_min == null ? null : sec.time_min, generates: generatesAny(sec.slots) });
    }
  });
  return out;
}

/** attempt x marks_each, a project slot at its own marks; summed in quarter marks. */
function unitMarks(slots) {
  return slots.reduce((n, s) => n + x4(s.project ? s.project.marks : s.marks_each) * (s.attempt || 1), 0) / 4;
}

module.exports = { unitsOf, unitMarks };
