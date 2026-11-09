'use strict';
/**
 * bd-snkn32.4 — "Make my own" for a grades 1–5 day: the rewrite request and the gate on its answer. Pure (no I/O).
 *
 * WHAT IS REWRITTEN. A grades 1–5 day has no lp_doc (its PDF was built offline), but its plan is stored as a slide
 * script (niete_lp_asset_sources, the grades 1–5 format: hook, iDo, weDo, youDo, wrap) in the BOOK's language. Her
 * answers rewrite that script in place: same JSON shape, same outcome, same day, same language. The 6-12 lane's
 * phrases for her answers are reused (lp612-own-instruction), so a teacher's answer means the same in both bands.
 *
 * THE PRODUCT REVIEWER'S RULES (docs/lp612/make-my-own-g1-5-product-review.md §4): the outcome and the day never
 * move; size decides pairs/groups and choral checks; only what she has; level reshapes the steps; the way shapes
 * We Do and You Do; her note is followed, never quoted back; an Urdu book stays Urdu throughout with no Roman Urdu,
 * an English book keeps its Roman-Urdu `sayLocal` lines; no longer than her day plan; a part with nothing in it is
 * dropped, never printed as "not ready". TaRL in an early language class groups by sound, letter, word, sentence.
 */
const { SIZES, RESOURCES, LEVELS, WAYS } = require('./lp612-own-instruction');

let jsonrepair = null;
try { ({ jsonrepair } = require('jsonrepair')); } catch (_) { /* strict parse only */ }

const SECTIONS = ['hook', 'iDo', 'weDo', 'youDo', 'wrap'];
/** The placeholder some stored Urdu parts carry; a rewrite must drop the part instead (the reviewer's rule). */
const NOT_READY_UR = 'یہ حصہ ابھی تیار نہیں ہوا';
/** Longer than this × her day plan is refused: she reads it on a phone before class. */
const MAX_GROWTH = 1.3;

const isLanguage = (subject) => /^(urdu|english)\b/i.test(String(subject || '').trim());
const isEarly = (grade) => Number(grade) >= 1 && Number(grade) <= 3;

function system(lang) {
  const language = lang === 'ur'
    ? 'This plan is from an URDU book: write every teacher-facing string in Urdu (Urdu script, for Nastaliq), with no Roman Urdu and no English sentences. Keep `sayLocal` / `teacherSaysLocal` / `promptLocal` in Urdu too, or leave them as they are.'
    : 'This plan is from an ENGLISH book: keep the plan in English and keep its Roman-Urdu "say it locally" lines (sayLocal, teacherSaysLocal, promptLocal), about one per section.';
  return [
    'You rewrite ONE primary-school (grades 1-5) teaching day for ONE teacher\'s own class in Pakistan.',
    'You get the day\'s plan as JSON. Reply with the rewritten plan as JSON only, in the same JSON shape: the same top-level keys and the same field names, so the same printer can print it.',
    'Never change: the learning outcome (`goal`, `sloFull`, `sloCode`), `meta` (the day, the topic, the pages), or the section order hook → iDo → weDo → youDo → wrap. Keep each section\'s minutes adding up to the same total.',
    'Every section keeps a quick check for understanding. Keep it no longer than the plan you were given: one action line, then short steps of one sentence each.',
    'If a part has nothing in it, leave it empty; never write a placeholder such as "not ready".',
    language,
  ].join('\n');
}

/** The two messages for the model. Throws on answers that did not come through parseOwnAnswers. */
function k5Messages({ script, answers, lang, grade, subject }) {
  const a = answers || {};
  if (!SIZES[a.size] || !LEVELS[a.level] || !WAYS[a.way] || !Array.isArray(a.resources)) {
    throw new Error('k5Messages needs answers from parseOwnAnswers');
  }
  const have = a.resources.map((r) => RESOURCES[r]).filter(Boolean).join(', ');
  const lines = [
    `Her class: ${SIZES[a.size]}; ${LEVELS[a.level]}. Grade ${grade}.`,
    'Class size: with a big class use choral answers, fingers or slates for the checks, and pairs; no activity needs every child to come to the board.',
    `What she has: ${have}. Use nothing else. With no board, point to the picture on the book page instead.`,
    'Level: behind means start from the skill they need first, in smaller steps; ahead means add a stretch task; mixed means a two-level You Do.',
    `Teaching way, for We Do and You Do: ${WAYS[a.way]}`,
  ];
  if (a.way === 'tarl' && isLanguage(subject) && isEarly(grade)) {
    lines.push('Group the children by level: sound, letter, word and sentence groups.');
  }
  if (a.note) lines.push(`Her own note (follow it where it fits the outcome and these rules; do not quote it back): "${a.note}"`);
  lines.push('', 'The day\'s plan:', JSON.stringify(script));
  return [{ role: 'system', content: system(lang) }, { role: 'user', content: lines.join('\n') }];
}

/** The model's reply as a plan object, or null. */
function parseK5Reply(content) {
  const text = String(content || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : null);
  try { return obj(JSON.parse(text)); } catch (_) { /* a trailing comma, a raw newline: repair */ }
  if (!jsonrepair || !/^\s*\{/.test(text)) return null;
  try { return obj(JSON.parse(jsonrepair(text))); } catch (_) { return null; }
}

/** Every string in a value, depth first. */
function strings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

const ARABIC = /[؀-ۿ]/;
const LATIN_WORDS = /[A-Za-z]{3,}/g;

/** Is this mostly Urdu? (Roman letters may appear in a page ref or a number name, not as the sentence.) */
function urduEnough(s) {
  const latin = (s.match(LATIN_WORDS) || []).join('').length;
  const arabic = (s.match(/[؀-ۿ]/g) || []).length;
  return ARABIC.test(s) && arabic >= latin;
}

/** Reasons to refuse the rewrite; [] passes. */
function checkK5Rewrite(orig, next, { lang } = {}) {
  if (!next || typeof next !== 'object') return ['no plan'];
  const reasons = [];
  for (const k of SECTIONS) {
    if (orig[k] && (!next[k] || typeof next[k] !== 'object')) reasons.push(`section ${k} is missing`);
  }
  const steps = next.iDo && next.iDo.steps;
  if (orig.iDo && Array.isArray(orig.iDo.steps) && orig.iDo.steps.length && (!Array.isArray(steps) || !steps.length)) {
    reasons.push('iDo has no steps');
  }
  if (orig.goal && next.goal !== orig.goal) reasons.push('goal (the learning outcome) changed');
  const om = orig.meta || {}; const nm = next.meta || {};
  if (om.day != null && nm.day !== om.day) reasons.push('the day changed');
  const all = strings(next);
  if (all.some((s) => s.includes(NOT_READY_UR))) reasons.push('a part says it is not ready');
  if (lang === 'ur') {
    const said = SECTIONS.flatMap((k) => strings(next[k] || {})).filter((s) => s.trim().length > 12);
    const english = said.filter((s) => !urduEnough(s));
    if (said.length && english.length > said.length * 0.2) reasons.push('not in Urdu: an Urdu book\'s plan must be Urdu');
  }
  const size = (o) => JSON.stringify(o).length;
  if (size(next) > size(orig) * MAX_GROWTH) reasons.push('too long for a phone: longer than her day plan');
  return reasons;
}

module.exports = { k5Messages, parseK5Reply, checkK5Rewrite, SECTIONS, NOT_READY_UR, MAX_GROWTH };
