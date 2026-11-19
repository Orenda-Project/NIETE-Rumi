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
 *
 * DESIGN RULE — the six combined indicators (C3 C5 C7 D2 D3 D4) never carry a Digital Coach level, on any surface
 * (reports, debriefs, portal, Flows, PDFs, averages), for every grade. Their levels depend on what can be seen in the
 * room, and transcript-only scoring of them is not yet reliable enough to show. The DC therefore reports evidence
 * for them (quotes and timestamps; student turns for D2), and the coach's level, with its written reason, is stored
 * beside that evidence for the same visit. Those pairs are the calibration data: a DC level for these combined indicators may be
 * introduced only after it has been checked against the coaches' levels. Enforced, not displayed-away: the prompt
 * asks no level for them, the validator refuses a reply that gives one, the scorer drops any that arrives, and
 * tests/coaching/fico17-v6-six-never-dc-graded.test.js fails if any DC path emits or renders one.
 * Where the pairs live and how to query them: docs/fico17-v6.md.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RUBRIC_FILE = path.join(__dirname, 'fico17_v6.rubric.json');
const RUBRIC = JSON.parse(fs.readFileSync(RUBRIC_FILE, 'utf8'));
// The coach-facing Urdu (level names, indicator names, definitions, level texts, what the coach adds). The rubric sheet
// is English only, so this is a reviewed DRAFT (status in the file); English is the fallback for any missing key.
const URDU = JSON.parse(fs.readFileSync(path.join(__dirname, 'fico17_v6.ur.json'), 'utf8'));
// Per-indicator N/A (operator-approved 19 Nov): which indicators offer N/A and its words for each, en + Urdu draft. It overrides
// the rubric's na_rule / na_link for every reader: N/A only where the thing scored could not happen in the lesson.
const NA_FILE = path.join(__dirname, 'fico17_v6.na.json');
const NA_TABLE = JSON.parse(fs.readFileSync(NA_FILE, 'utf8'));

const RUBRIC_KEY = 'fico17_v6';
const RUBRIC_SHA8 = crypto.createHash('sha256').update(fs.readFileSync(RUBRIC_FILE)).digest('hex').slice(0, 8);
// dc-2 (per-indicator N/A, 19 Nov): the prompt allows N/A only on C2 (and C5's evidence), and the validator refuses it elsewhere.
const DC_PROMPT_VERSION = `fico17-v6-dc-2+${RUBRIC_SHA8}`;
// The coach's own scoring has no model; its stamp names the rubric data it was scored against. coach-2 (13 Nov):
// the coach chose 1-4 only. coach-3 (19 Nov): 1-4, plus N/A on C2 C3 C5 D4 only, each with its own label,
// so a coach-3 review can be told from a coach-2 one.
const COACH_PROMPT_VERSION = `fico17-v6-coach-3+${RUBRIC_SHA8}`;

const CODES = RUBRIC.indicators.map((i) => i.code);
const BY_CODE = Object.fromEntries(RUBRIC.indicators.map((i) => [i.code, i]));
const DC_CODES = CODES.filter((c) => BY_CODE[c].kind === 'dc');
const COMBINED_CODES = CODES.filter((c) => BY_CODE[c].kind === 'combined');
// Starred (queue #184, operator 19 Nov): never sent to the Digital Coach at all and mandatory for the coach. Read from the
// indicator's own `starred` field, as FICO-S does. v6's rubric.json carries none yet: which v6 indicators are starred is
// the operator's call (the six combined ones above are a different rule: evidence only for the DC).
const STARRED_CODES = CODES.filter((c) => BY_CODE[c].starred === true);
const isStarred = (code) => STARRED_CODES.includes(code);
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

/** The coach's language for v6 text: 'ur' or 'en'. */
const langOf = (lang) => (String(lang || '').toLowerCase().startsWith('ur') ? 'ur' : 'en');

// ── N/A, per indicator (per-indicator N/A, 19 Nov) ─────────────────────────────────────────
// The indicators that offer N/A (C2 C3 C5 D4), in rubric order. Every other indicator never offers it: its level 1
// already describes "nothing happened" (operator 13 Nov, D2).
const NA_CODES = CODES.filter((c) => NA_TABLE.indicators[c] && NA_TABLE.indicators[c].allowed === true);
// Where the Digital Coach may answer N/A itself: a level on C2 (Part 1); C5's evidence (Part 2). Nowhere else.
const DC_NA_LEVEL_CODES = NA_CODES.filter((c) => NA_TABLE.indicators[c].dc_level === true);
const DC_NA_EVIDENCE_CODES = NA_CODES.filter((c) => !!NA_TABLE.indicators[c].dc_evidence_rule);

function naAllowed(code) { return NA_CODES.includes(code); }
function naRow(code) { return naAllowed(code) ? NA_TABLE.indicators[code] : null; }
const pick = (byLang, lang) => (byLang && (byLang[langOf(lang)] || byLang.en)) || null;

/** An indicator's N/A choice in a language ({ id: 'NA', title ≤ 30, description ≤ 300 }), or null where it has none. */
function naOption(code, lang = 'en') {
  const row = naRow(code);
  if (!row) return null;
  const w = pick(row.coach, lang);
  return { id: 'NA', title: clip(w.title, 30), description: clip(w.description, 300) };
}

/**
 * The one sentence that says why an indicator is N/A ("No child was wrong in this lesson."), for reports. `by`: 'coach'
 * (the lesson, the default) or 'dc' (the transcript). An N/A saved where none is offered now (an old review) gets the
 * plain "Not applicable in this lesson." Null for an unknown code.
 */
function naSentence(code, lang = 'en', { by = 'coach' } = {}) {
  if (!BY_CODE[code]) return null;
  const row = naRow(code);
  if (!row) return pick(NA_TABLE.legacy, lang).sentence;
  return by === 'dc' ? pick(row.dc, lang) : pick(row.coach, lang).sentence;
}

/** The N/A option an old review keeps on an indicator that no longer offers one (so its choice still shows). */
function legacyNaOption(lang = 'en') {
  const w = pick(NA_TABLE.legacy, lang);
  return { id: 'NA', title: clip(w.title, 30), description: clip(w.description, 300) };
}

/** The Flow's note when Rumi chose N/A (C2), in a language; null where Rumi cannot. */
function naRumiNote(code, lang = 'en') {
  const row = naRow(code);
  return row && row.rumi_note ? pick(row.rumi_note, lang) : null;
}

/** { code, level } an indicator's N/A follows (C3 and D4: C1 at level 1), or null. */
function naFollows(code) {
  const row = naRow(code);
  return row && row.follows ? { code: row.follows.code, level: Number(row.follows.level) } : null;
}

/** The note shown when an N/A was chosen because of another indicator (C3/D4 after C1 = 1); null otherwise. */
function naFollowNote(code, lang = 'en') {
  const row = naRow(code);
  return row && row.follow_note ? pick(row.follow_note, lang) : null;
}

/** The rule the DC is given for an N/A: { level } on C2, { evidence } on C5; null elsewhere. */
function naDcRule(code) {
  const row = naRow(code);
  if (!row) return null;
  if (row.dc_level === true && row.dc_rule) return { level: row.dc_rule };
  if (row.dc_evidence_rule) return { evidence: row.dc_evidence_rule };
  return null;
}

// /observe2 ONLY (retired on prod 14 Nov; its check Flows are published, so their option lists must not change by a
// byte): the N/A each combined indicator offered there (§7.3). No /observe, portal, DC or report path reads this; they
// all read the approved table above (per-indicator N/A, 19 Nov).
const OBSERVE2_NA_OPTIONS = {
  C5: { title: 'No switch', description: 'The class did not change activity.' },
  C7: { title: 'No group task', description: 'Everyone worked alone or as one class.' },
  D3: { title: 'No child-to-child talk', description: BY_CODE.D3.na_rule },
};

/**
 * /observe2's option list for one indicator's level choice (its shared check Flow): 1-4 with the v6 short titles and
 * level text (≤ 300), then that Flow's N/A on C5 C7 D3, then "Couldn't tell" when asked for. Unchanged by per-indicator N/A.
 */
function levelOptions(code, { couldntTell = false } = {}) {
  const ind = BY_CODE[code];
  if (!ind) return [];
  const out = ind.levels.map((l, i) => ({ id: String(l.n), title: TITLES[code][i], description: clip(l.text, 300) }));
  const na = OBSERVE2_NA_OPTIONS[code];
  if (na) out.push({ id: 'NA', title: na.title, description: clip(na.description, 300) });
  if (couldntTell) out.push({ id: 'IE', title: "Couldn't tell", description: clip(`Use when ${ind.couldnt_tell}`, 300) });
  return out;
}

/** A level's name ('Proficient' / 'ماہر'), from the rubric's level labels. */
function levelName(n, lang = 'en') {
  const k = String(n);
  if (langOf(lang) === 'ur' && URDU.level_labels[k]) return URDU.level_labels[k];
  return LEVEL_LABELS[k] || null;
}

/** An indicator's coach-facing text in a language: { name, definition, levels[4], coach_adds }, English fallback. */
function indicatorText(code, lang = 'en') {
  const ind = BY_CODE[code];
  if (!ind) return null;
  const en = { name: ind.name, definition: ind.definition, levels: ind.levels.map((l) => l.text), coach_adds: ind.coach_adds || null };
  if (langOf(lang) !== 'ur') return en;
  const u = URDU.indicators[code] || {};
  return {
    name: u.name || en.name,
    definition: u.definition || en.definition,
    levels: en.levels.map((t, i) => (u.levels && u.levels[i]) || t),
    coach_adds: u.coach_adds || en.coach_adds,
  };
}

/** A section's name in a language ('What the teacher does' / 'استاد کیا کرتا ہے'). */
function sectionName(letter, lang = 'en') {
  const s = SECTIONS[letter];
  if (!s) return null;
  return (langOf(lang) === 'ur' && URDU.sections[letter]) || s.name;
}

/**
 * The coach's (HITL) choices for one indicator, on every coach path (/observe, /observe2, portal), operator 13 Nov:
 * ids 1-4, the title is the level's name (Not Observed / Developing / Proficient / Highly Effective), the description
 * the rubric sheet's level text word for word. No Couldn't tell: the coach was in the room. N/A (per-indicator N/A, 19 Nov) only on
 * the indicators the approved table allows (C2 C3 C5 D4), last, with that indicator's own words.
 */
function coachLevelOptions(code, lang = 'en', { na = true } = {}) {
  const t = indicatorText(code, lang);
  if (!t) return [];
  const out = t.levels.map((text, i) => ({ id: String(i + 1), title: clip(levelName(i + 1, lang), 30), description: clip(text, 300) }));
  // `na: false`: /observe2's coach copy (retired, its Flow published with 1-4 only) keeps exactly what it had.
  const opt = na ? naOption(code, lang) : null;
  if (opt) out.push(opt);
  return out;
}

/** The ids a coach may choose on one indicator: '1'-'4', and 'NA' where the table allows it. */
function coachIds(code) { return naAllowed(code) ? ['1', '2', '3', '4', 'NA'] : ['1', '2', '3', '4']; }

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
  CODES, DC_CODES, COMBINED_CODES, STARRED_CODES, isStarred, LEVEL_LABELS, SECTIONS, DOMAIN_OF, TITLES, DRAFT_TITLE_CODES,
  JUSTIFICATION_MIN, cp, clip, indicator, isDc, isCombined, levelText, levelOptions, stamp, normLevel, isJustified, totals,
  URDU, langOf, levelName, indicatorText, sectionName, coachLevelOptions, coachIds,
  NA_TABLE, NA_FILE, NA_CODES, DC_NA_LEVEL_CODES, DC_NA_EVIDENCE_CODES, naAllowed, naOption, naSentence, legacyNaOption,
  naRumiNote, naFollows, naFollowNote, naDcRule,
};
