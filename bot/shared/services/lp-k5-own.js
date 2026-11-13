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
 *
 * THE GRADUAL RELEASE NEVER GOES (bd-snkn32.12). Her answers change the strategy INSIDE each part; the parts themselves
 * (hook/Opening → I Do → We Do → You Do → wrap/Check) are fixed. A plan missing any of them, or with one that has no
 * text in it, is refused — the parent before the rewrite (the worker), the rewrite before it is printed (this gate).
 *
 * HARD vs SOFT (bd-snkn32.40). This gate holds the hard rules only. Minutes, class-size caps and length are fixed in
 * code after the reply (lp-own-fit); they never refuse and never cost another model call.
 */
const { SIZES, RESOURCES, LEVELS, WAYS, MATERIALS_LINE } = require('./lp612-own-instruction');
const { GRR_LINE, ROTE_LINE, YOU_DO_LINE, bookLine } = require('./lp612-own-ways');
const { pagesLine } = require('./lp-k5-own-pages');
// bd-snkn32.30 — one period, and a load that shrinks with her class (tester: "cannot be covered in one class").
const P = require('./lp-own-period');

let jsonrepair = null;
try { ({ jsonrepair } = require('jsonrepair')); } catch (_) { /* strict parse only */ }

const SECTIONS = ['hook', 'iDo', 'weDo', 'youDo', 'wrap'];
/** The placeholder some stored Urdu parts carry; a rewrite must drop the part instead (the reviewer's rule). */
const NOT_READY_UR = 'یہ حصہ ابھی تیار نہیں ہوا';
/** Longer than this × her day plan (a change 1.3x, a make 1x) is warned about, never refused (bd-snkn32.40, lp-own-fit). */
const { EDIT_GROWTH: MAX_GROWTH, MAKE_GROWTH } = require('./lp-own-fit');

/** bd-snkn32.27 — the board, in either language: a plan for a teacher with no board must not use one. */
const BOARD = /\b(?:black|white|chalk)?board\b|بورڈ|تختہ سیاہ/i;

const isLanguage = (subject) => /^(urdu|english)\b/i.test(String(subject || '').trim());
const isEarly = (grade) => Number(grade) >= 1 && Number(grade) <= 3;

function system(lang) {
  const language = lang === 'ur'
    ? 'This plan is from an URDU book: write every teacher-facing string in Urdu (Urdu script, for Nastaliq), with no Roman Urdu and no English sentences. Keep `sayLocal` / `teacherSaysLocal` / `promptLocal` in Urdu too, or leave them as they are.'
    : 'This plan is from an ENGLISH book: keep the plan in English and keep its Roman-Urdu "say it locally" lines (sayLocal, teacherSaysLocal, promptLocal), about one per section.';
  return [
    'You rewrite ONE primary-school (grades 1-5) teaching day for ONE teacher\'s own class in Pakistan.',
    'You get the day\'s plan as JSON. Reply with the rewritten plan as JSON only, in the same JSON shape: the same top-level keys and the same field names, so the same printer can print it.',
    'Never change: the learning outcome (`goal`, `sloFull`, `sloCode`), `meta` (the day, the topic, the pages), or the section order hook → iDo → weDo → youDo → wrap. Give all five sections a `minutes` number; together they fill exactly the day\'s period (`meta.minutes`), never more.',
    'Every section keeps a quick check for understanding. Keep it no longer than the plan you were given: one action line, then short steps of one sentence each.',
    'Always keep all five parts, hook, iDo, weDo, youDo and wrap, each with real teaching in it: change how each part is taught, never drop or empty a part. Inside a part, a field with nothing to say may be left out; never write a placeholder such as "not ready".',
    GRR_LINE, // in the make and the change alike (k5EditMessages uses this system)
    ROTE_LINE,
    language,
  ].join('\n');
}

/** The two messages for the model. Throws on answers that did not come through parseOwnAnswers. */
function k5Messages({ script, answers, lang, grade, subject, dayPages = null, bookText = null }) {
  const a = answers || {};
  const ways = a.ways || [a.way]; // bd-snkn32.24 — one or several
  if (!SIZES[a.size] || !LEVELS[a.level] || !ways.every((k) => WAYS[k]) || !Array.isArray(a.resources)) {
    throw new Error('k5Messages needs answers from parseOwnAnswers');
  }
  const have = a.resources.map((r) => RESOURCES[r]).filter(Boolean).join(', ');
  const lines = [
    `Her class: ${SIZES[a.size]}; ${LEVELS[a.level]}. Grade ${grade}.`,
    // bd-snkn32.27 — only what she has: no slates (ICT works in the book), the board only when she has one.
    // bd-snkn32.30 — the load is set by her class size: fewer activities for a bigger class, whole-class checks.
    `${P.loadLine(a.size)}${a.resources.includes('board') ? ' No activity needs every child to come to the board.' : ''}`,
    `What she has: ${have}. Use nothing else. With no board, point to the picture on the book page instead.`,
    MATERIALS_LINE,
    'Level: behind means start from the skill they need first, in smaller steps; ahead means add a stretch task; mixed means a two-level You Do.',
    ways.length > 1
      ? `Teaching ways, combined in We Do: ${ways.map((k) => WAYS[k]).join(' ')}`
      : `Teaching way, for We Do: ${WAYS[a.way]}`,
    YOU_DO_LINE,
  ];
  if (ways.includes('tarl') && isLanguage(subject) && isEarly(grade)) {
    lines.push('Group the children by level: sound, letter, word and sentence groups.');
  }
  const period = P.periodOf(script);
  if (period) lines.push(P.timingLine(period)); // the day's own period, never an assumed one
  if (a.pages) lines.push(pagesLine(a.pages, dayPages)); // bd-snkn32.17 — the pages she chose
  const book = bookLine(bookText); // the page text, so the plan teaches from the real page
  if (book) lines.push(book);
  if (a.note) lines.push(`Her own note (follow it where it fits the outcome and these rules; do not quote it back): "${a.note}"`);
  lines.push('', 'The day\'s plan:', JSON.stringify(script));
  return [{ role: 'system', content: system(lang) }, { role: 'user', content: lines.join('\n') }];
}

/**
 * bd-snkn32.44 — a reply whose object closed one brace early (`…]}},"materials":…`, G4 English ch7, both rounds):
 * the text with that closing brace taken out, or null when the object did not close early. No model call.
 */
function closedEarly(text) {
  let depth = 0; let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return c === '}' && text.slice(i + 1).trim() ? text.slice(0, i) + text.slice(i + 1) : null;
    }
  }
  return null;
}

/** The model's reply as a plan object, or null. */
function parseK5Reply(content) {
  const text = String(content || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : null);
  try { return obj(JSON.parse(text)); } catch (_) { /* a trailing comma, a raw newline, a brace too many: repair */ }
  const early = closedEarly(text);
  if (early) { try { return obj(JSON.parse(early)); } catch (_) { /* not that either */ } }
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

/** The gradual-release parts a plan lacks: absent, not an object, or with no text in it. [] = all five there. */
function missingGrr(script) {
  const s = script && typeof script === 'object' ? script : {};
  return SECTIONS.filter((k) => {
    const v = s[k];
    return !v || typeof v !== 'object' || Array.isArray(v) || !strings(v).some((x) => x.trim());
  });
}

/** Reasons to refuse the rewrite (the hard rules); [] passes. */
function checkK5Rewrite(orig, next, { lang, resources, size } = {}) {
  if (!next || typeof next !== 'object') return ['no plan'];
  const reasons = missingGrr(next).map((k) => `section ${k} is missing or empty`);
  const steps = next.iDo && next.iDo.steps;
  if (orig.iDo && Array.isArray(orig.iDo.steps) && orig.iDo.steps.length && (!Array.isArray(steps) || !steps.length)) {
    reasons.push('iDo has no steps');
  }
  if (orig.goal && next.goal !== orig.goal) reasons.push('goal (the learning outcome) changed');
  const om = orig.meta || {}; const nm = next.meta || {};
  if (om.day != null && nm.day !== om.day) reasons.push('the day changed');
  const all = strings(next);
  if (all.some((s) => s.includes(NOT_READY_UR))) reasons.push('a part says it is not ready');
  if (Array.isArray(resources) && !resources.includes('board')) {
    const used = SECTIONS.flatMap((k) => strings(next[k] || {})).find((s) => BOARD.test(s));
    if (used) reasons.push(`uses a board she does not have ("${used.slice(0, 60)}"): use the book page instead`);
  }
  if (Array.isArray(resources)) {
    // bd-snkn32.28 / .44 — the whole line and the words that matched go back, so the repair round can fix that line.
    const shared = strings(next.youDo || {}).find((s) => P.together(s));
    if (shared) reasons.push(`You Do has pair or group work ("${shared.slice(0, 200)}", the words "${P.together(shared)}"): in You Do each child works alone in her book or copy, with no partner or group talk; keep pairs and groups in We Do`);
  }
  if (lang === 'ur') {
    const said = SECTIONS.flatMap((k) => strings(next[k] || {})).filter((s) => s.trim().length > 12);
    const english = said.filter((s) => !urduEnough(s));
    if (said.length && english.length > said.length * 0.2) reasons.push('not in Urdu: an Urdu book\'s plan must be Urdu');
  }
  // bd-snkn32.40 — only the HARD rules refuse. The period, her class size's caps and the length are fixed (or warned
  // about) in code after the reply (lp-own-fit.fitK5); a per-child check goes back once (lp-own-fit.repairOnly).
  if (P.LOAD[size]) {
    const slate = P.slates(next)[0];
    if (slate) reasons.push(`uses slates ("${slate.slice(0, 60)}"): the children work in the book`);
  }
  return reasons;
}

module.exports = { system, k5Messages, parseK5Reply, checkK5Rewrite, missingGrr, SECTIONS, NOT_READY_UR, MAX_GROWTH, MAKE_GROWTH };
