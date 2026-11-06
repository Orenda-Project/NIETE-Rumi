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

const CHUNK = 20; // design_pending: the longest list one call writes well (p3/p4 a5-a6 under-produced at 40 and 56)
const isGen = (s) => !(s.teacher_marked || s.project) && s.generate > 0;
const splits = (s, max) => isGen(s) && s.generate > max && !s.or && (s.attempt == null || s.attempt === s.printed)
  && (!s.stimulus || s.stimulus.mcqs_per_stimulus <= max);

/** A copy of slot `s` asking for `n` items (a stimulus slot: whole groups, rounded up). */
function sized(s, n) {
  if (!s.stimulus) return { ...s, generate: n, printed: n, attempt: n };
  const per = s.stimulus.mcqs_per_stimulus;
  const groups = Math.ceil(n / per);
  return { ...s, generate: groups * per, printed: groups * per, attempt: groups * per, stimulus: { ...s.stimulus, count: groups } };
}

/**
 * The calls one unit is written in: a slot of more than `max` items is asked in chunks of `max` or fewer (a stimulus
 * slot in whole groups), each chunk `{...unit, slots:[copy], chunk:{slot, from, to, total}}`; the other slots share
 * one call after them. A unit with nothing to split comes back as [unit].
 */
function chunksOf(unit, max = CHUNK) {
  if (!unit.slots.some((s) => splits(s, max))) return [unit];
  const out = [];
  unit.slots.filter((s) => splits(s, max)).forEach((s) => {
    const step = s.stimulus ? Math.floor(max / s.stimulus.mcqs_per_stimulus) * s.stimulus.mcqs_per_stimulus : max;
    for (let from = 1; from <= s.generate; from += step) {
      const to = Math.min(s.generate, from + step - 1);
      out.push({ ...unit, slots: [sized(s, to - from + 1)], chunk: { slot: s.slot, from, to, total: s.generate } });
    }
  });
  const rest = unit.slots.filter((s) => !splits(s, max));
  if (generatesAny(rest)) out.push({ ...unit, slots: rest });
  return out;
}

module.exports = { unitsOf, unitMarks, chunksOf, sized, CHUNK };
