'use strict';

/**
 * bd-ra8xu.38 — FICO17 v6, the rubric every v6 reader shares (the DC prompt, /observe, /observe2, reports).
 *
 * The indicator text is data: fico17_v6.rubric.json, generated from the binding text (deploy spec Appendix A,
 * FICO17_v6_rubric.appendix-a.md) by bot/scripts/build-fico17-v6-rubric.js. Never hand-edit the JSON.
 *
 * V3 ('fico', 37 rows, B/C/D/F) and v6 ('fico17_v6', 17 rows, C/D/F) share codes that mean different things
 * (V3 C5 is not v6 C5). A score is only ever read with the rubric it was stamped with; totals and averages never
 * mix the two. Lesson-plan fidelity is not one of the 17: it is computed separately, as /observe2 does today.
 *
 * Who sets each level:
 *   DC_CODES (11)        the Digital Coach sets the level from the transcript; a coach may change it with a reason.
 *   COMBINED_CODES (6)   the coach sets the level from the room, with a written reason of at least
 *                        JUSTIFICATION_MIN characters; the DC gives evidence only (D2: turn counts only).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RUBRIC_FILE = path.join(__dirname, 'fico17_v6.rubric.json');
const RUBRIC = JSON.parse(fs.readFileSync(RUBRIC_FILE, 'utf8'));

const RUBRIC_KEY = 'fico17_v6';
const RUBRIC_SHA8 = crypto.createHash('sha256').update(fs.readFileSync(RUBRIC_FILE)).digest('hex').slice(0, 8);
const DC_PROMPT_VERSION = `fico17-v6-dc-1+${RUBRIC_SHA8}`;
// The coach's own scoring has no model; its stamp names the rubric data it was scored against.
const COACH_PROMPT_VERSION = `fico17-v6-coach-1+${RUBRIC_SHA8}`;

const CODES = RUBRIC.indicators.map((i) => i.code);
const BY_CODE = Object.fromEntries(RUBRIC.indicators.map((i) => [i.code, i]));
const DC_CODES = CODES.filter((c) => BY_CODE[c].kind === 'dc');
const COMBINED_CODES = CODES.filter((c) => BY_CODE[c].kind === 'combined');
const LEVEL_LABELS = RUBRIC.level_labels;

const JUSTIFICATION_MIN = 20;

// The three sections, as the /observe screens and the reports group them. B (lesson-plan fidelity) is not here.
// `domain` is the key a v6 analysis uses under analysis.domains. It is deliberately NOT a V3 domain key, so no
// reader written for V3 can sum a v6 row by accident (V3 C5 and v6 C5 are different indicators).
const SECTIONS = {
  C: { key: 'C', domain: 'v6_teacher', name: 'What the teacher does', codes: CODES.filter((c) => c[0] === 'C') },
  D: { key: 'D', domain: 'v6_children', name: 'What the children do', codes: CODES.filter((c) => c[0] === 'D') },
  F: { key: 'F', domain: 'v6_subject', name: 'Subject knowledge', codes: CODES.filter((c) => c[0] === 'F') },
};
const DOMAIN_OF = Object.fromEntries(Object.values(SECTIONS).flatMap((s) => s.codes.map((c) => [c, s.domain])));

// Level titles for WhatsApp option lists (≤ 30 code points each). The six combined ones are the spec's (§7.3).
// The eleven DC ones are DRAFTS read off the v6 level text (the spec gives none): Ahwaz and Rifat to confirm.
const TITLES = {
  C1: ['No questions, or answers given', 'Closed questions only', '2+ open questions, waited', "A 'why', then a follow-up"],
  C2: ['Wrong answer ignored', 'Marked wrong, reason once', 'Reason given 2+ times', 'Child fixed it; new way tried'],
  C3: ['Took whoever answered', 'Chose who answered once', 'Chose who answered 2+ times', '2+ named children answered'],
  C4: ['Teacher decided everything', 'Small choices only', 'A real choice or idea taken up', 'Children led a part'],
  C5: ['Over 3 min, no signal', 'Signal, 2-3 min', 'Under 2 min', 'Switched without being told'],
  C6: ['Flat or dismissive', 'Praise for right answers only', 'Praised effort 2+ times', 'Mistakes used, views invited'],
  C7: ['No pair or group task', 'Groups, each works alone', 'Shared task, one product', 'Roles and report back'],
  C8: ['No book or object mentioned', 'Shown only, not used', 'Children used them, linked', 'Child explained with them'],
  D1: ['One-word answers only', 'Longer, but only repeated', '2+ answers gave reasons', "Child's own example or link"],
  D2: ['No child spoke', 'Only 1-2 children', '3-5 children', '6+, and 2+ quiet ones later'],
  D3: ['No child spoke to another', 'Once', '2+ times', 'Reasons, one shared answer'],
  D4: ['Silent or waited', 'Only answered when sure', 'Tried while unsure, 2+', 'Tried unasked or again'],
  D5: ['No question of their own', 'Task questions only', 'A question about the idea', '2+, one beyond the lesson'],
  F1: ['Wrong content left standing', 'A slip not corrected', 'All correct', 'Warned of a common mistake'],
  F2: ['Everyday words only', 'Terms used, not explained', 'Terms explained 2+ times', 'Children made to use them'],
  F3: ['How only, no reason', 'Some reasons, mostly rules', 'Explained why 2+ times', 'Went further, or children did'],
  F4: ['No link to life or lessons', 'Link mentioned, not explained', 'Link explained', 'A child built on the link'],
};
// Whether a draft title still needs the rubric owner's check.
const DRAFT_TITLE_CODES = DC_CODES.slice();

// The not-applicable options each combined indicator offers (§7.3), with their descriptions.
const NA_OPTIONS = {
  C5: { title: 'No switch', description: 'The class did not change activity.' },
  C7: { title: 'No group task', description: 'Everyone worked alone or as one class.' },
  D3: { title: 'No child-to-child talk', description: BY_CODE.D3.na_rule },
};

const cp = (s) => Array.from(String(s || '')).length;

/** Text cut at the last full word before `max - 3` code points, with an ellipsis; unchanged when it fits. */
function clip(s, max) {
  const chars = Array.from(String(s || ''));
  if (chars.length <= max) return chars.join('');
  const head = chars.slice(0, max - 3).join('');
  const cut = head.lastIndexOf(' ');
  return `${(cut > 0 ? head.slice(0, cut) : head).trimEnd()}…`;
}

function indicator(code) { return BY_CODE[code] || null; }
function isDc(code) { return DC_CODES.includes(code); }
function isCombined(code) { return COMBINED_CODES.includes(code); }
function levelText(code, n) {
  const ind = BY_CODE[code];
  const l = ind && ind.levels.find((x) => x.n === Number(n));
  return l ? l.text : null;
}

/**
 * The option list for one indicator's level choice: 1-4 with the v6 level text as the description (≤ 300),
 * then the indicator's NA option when it has one, then "Couldn't tell" when asked for (DC indicators only).
 */
function levelOptions(code, { couldntTell = false } = {}) {
  const ind = BY_CODE[code];
  if (!ind) return [];
  const out = ind.levels.map((l, i) => ({ id: String(l.n), title: TITLES[code][i], description: clip(l.text, 300) }));
  if (NA_OPTIONS[code]) out.push({ id: 'NA', title: NA_OPTIONS[code].title, description: clip(NA_OPTIONS[code].description, 300) });
  if (couldntTell) out.push({ id: 'IE', title: "Couldn't tell", description: clip(`Use when ${ind.couldnt_tell}`, 300) });
  return out;
}

/** The stamp every stored v6 score carries. */
function stamp(kind = 'dc') {
  return { rubric: RUBRIC_KEY, prompt_version: kind === 'coach' ? COACH_PROMPT_VERSION : DC_PROMPT_VERSION };
}

/** A level as stored: 1-4, 'NA' or 'IE'; anything else is null. */
function normLevel(v) {
  if (v === 'NA' || v === 'IE') return v;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 4 ? n : null;
}

/** A justification that counts: at least JUSTIFICATION_MIN code points once trimmed. */
function isJustified(text) { return cp(String(text || '').trim()) >= JUSTIFICATION_MIN; }

/**
 * v6 totals, never mixed with V3: the sum of numeric levels over the indicators that have one. NA and IE leave
 * both sides of the ratio (they are not low marks). Returns { marks, max, percentage, counted }.
 */
function totals(levels = {}) {
  let marks = 0;
  let counted = 0;
  for (const code of CODES) {
    const raw = levels[code];
    const v = normLevel(raw && typeof raw === 'object' ? (raw.level !== undefined ? raw.level : raw.result) : raw);
    if (typeof v !== 'number') continue;
    marks += v;
    counted += 1;
  }
  const max = counted * 4;
  return { marks, max, counted, percentage: max ? parseFloat(((marks / max) * 100).toFixed(1)) : 0 };
}

module.exports = {
  RUBRIC, RUBRIC_KEY, RUBRIC_SHA8, RUBRIC_FILE, DC_PROMPT_VERSION, COACH_PROMPT_VERSION,
  CODES, DC_CODES, COMBINED_CODES, LEVEL_LABELS, SECTIONS, DOMAIN_OF, TITLES, DRAFT_TITLE_CODES, NA_OPTIONS,
  JUSTIFICATION_MIN, cp, clip, indicator, isDc, isCombined, levelText, levelOptions, stamp, normLevel, isJustified, totals,
};
