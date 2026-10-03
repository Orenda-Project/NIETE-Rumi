'use strict';

/**
 * How a drawn child is named to a coach or teacher (CONTRACT §18–§19, R1 §7; operator 3 Oct 2026):
 * the child's FULL name, the classroom in the roster's own words, and the class teacher. Never a roll:
 * NIETE rolls are the register's serial read off a photo, renumbered monthly, and 3.4% of children have
 * none — the coach finds a child by name, room and teacher instead.
 *
 *   childLabel  "Ayesha Khan · 3-A"                                   every later mention
 *   childPlace  "Grade 3 - A · Teacher: Saima Bibi"                    the line under a first mention
 *   childLine   "Ayesha Khan · Grade 3 - A · Teacher: Saima Bibi"       one line, first mention
 *
 * Same-name classmates (counted on the class roster by the draw): "(father: …)" when the father's name
 * tells them apart, else "(2 in this class)". Missing parts are dropped — never "null", never a throw.
 * In Urdu every name is wrapped in direction isolates (FSI…PDI): roster names are Latin script.
 *
 * Names go to WhatsApp (and the portal) only: never into logs or model prompts (CONTRACT §7).
 */

const { t, clip, digits } = require('./copy');

const ROW_TITLE_MAX = 24;          // WhatsApp list row.title, code points
const ROW_DESCRIPTION_MAX = 72;    // WhatsApp list row.description, code points
const SEP = ' · ';
const FSI = '⁨';
const PDI = '⁩';

const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const cps = (s) => [...String(s)].length;
/** A name inside an Urdu line, isolated so its direction cannot turn the line around. */
const iso = (lang, s) => (!s || lang === 'en' ? s : `${FSI}${s}${PDI}`);
const unIso = (s) => String(s || '').replace(/[⁦-⁩]/g, '');

/** The child's full name in the coach's language: the Urdu-script name for 'ur' when the roster has one, else the roster spelling. */
function childName(lang, c) {
  const ur = clean(c && c.displayNameUrdu);
  const roster = clean(c && c.displayName);
  return lang === 'en' ? (roster || ur) : (ur || roster);
}

/** Rolls are never shown (operator, 3 Oct 2026). Kept so older callers read "no roll" and move on. */
function rollOf() {
  return null;
}

/** "father: Hassan Raza" / "2 in this class" for a child with a same-name classmate; '' otherwise. */
function namesakeHint(lang, c) {
  const n = Number(c && c.namesakes);
  if (!(n > 1)) return '';
  const father = clean(lang === 'en' ? c.fatherName : (c.fatherNameUrdu || c.fatherName));
  if (c.fatherTellsApart && father) return t(lang, 'childTestFatherHint', { name: iso(lang, father) });
  return t(lang, 'childTestNamesakeCount', { n });
}

/** The name, or the no-name label, with the namesake hint in brackets. */
function nameWithHint(lang, c) {
  const name = childName(lang, c);
  const shown = name ? iso(lang, name) : t(lang, 'childTestChildNoName');
  const hint = namesakeHint(lang, c);
  return hint ? `${shown} (${hint})` : shown;
}

/** "Grade 3 - A" / "جماعت سوم - A" (the roster's label), or null. */
function classLong(lang, c) {
  const s = clean(c && (lang === 'en' ? c.classLabel : (c.classLabelUr || c.classLabel)));
  return s || null;
}

/** "3-A" (Urdu digits in Urdu), or null. */
function classShort(lang, c) {
  const s = clean(c && c.classShort);
  return s ? digits(lang, s) : null;
}

/** "Teacher: Saima Bibi" — or the first name only — or null when the room has no reachable class teacher. */
function teacherLine(lang, c, { firstNameOnly = false } = {}) {
  let name = clean(c && c.teacherName);
  if (!name) return null;
  if (firstNameOnly) name = name.split(' ')[0];
  return t(lang, 'childTestTeacherIs', { name: iso(lang, name) });
}

/** "Ayesha Khan · 3-A" — every mention after the first. */
function childLabel(lang, c) {
  return [nameWithHint(lang, c || {}), classShort(lang, c)].filter(Boolean).join(SEP);
}

/** "Grade 3 - A · Teacher: Saima Bibi" — the line under a child's first mention; '' when unknown. */
function childPlace(lang, c) {
  return [classLong(lang, c), teacherLine(lang, c)].filter(Boolean).join(SEP);
}

/** "Ayesha Khan · Grade 3 - A · Teacher: Saima Bibi" — the first mention, on one line. */
function childLine(lang, c) {
  return [nameWithHint(lang, c || {}), childPlace(lang, c)].filter(Boolean).join(SEP);
}

/** Several children on one line, in the given order. */
function childLabels(lang, children) {
  return (children || []).map((c) => childLabel(lang, c)).join(lang === 'en' ? ', ' : '، ');
}

/**
 * A WhatsApp list row. The title is the full name when it fits in 24 code points; otherwise it is
 * clipped and the description starts with the full name, so the full name is always on screen. The
 * description then carries the namesake hint, the room, the class teacher and the caller's status —
 * the teacher shortened to a first name, then dropped, before anything is clipped (72 code points).
 */
function childRow(lang, c, status) {
  const name = childName(lang, c);
  const fits = cps(name) <= ROW_TITLE_MAX;
  const title = clip(name || t(lang, 'childTestChildNoName'), ROW_TITLE_MAX);
  const said = unIso(clean(status));
  const hint = namesakeHint(lang, c || {});
  const head = [];
  if (name && !fits) head.push(name);
  if (hint && !said.includes(unIso(hint))) head.push(hint);
  const build = (teacher) => [...head, classLong(lang, c), teacher, clean(status)].filter(Boolean).join(SEP);
  for (const teacher of [teacherLine(lang, c), teacherLine(lang, c, { firstNameOnly: true }), null]) {
    const d = build(teacher);
    if (cps(d) <= ROW_DESCRIPTION_MAX) return { title, description: d };
  }
  return { title, description: clip(build(null), ROW_DESCRIPTION_MAX) };
}

module.exports = {
  childName, rollOf, namesakeHint, nameWithHint, classLong, classShort, teacherLine,
  childLabel, childPlace, childLine, childLabels, childRow, iso, ROW_TITLE_MAX, ROW_DESCRIPTION_MAX,
};
