'use strict';

/**
 * /observe2 — how a coach's evidence becomes a level on each of the 17 FICO ICT indicators.
 *
 * Every threshold is read off the level 3 / level 4 descriptors in the impact team's workbook.
 * One piece of evidence lands on exactly one level. Where the rubric leaves a count with no level
 * (exactly one instance on C1, C6, D1, D3, D4; D2's "spread across the lesson"), the rule gives 2
 * and marks `hole: true`: a placeholder for the team to close, not a decision.
 *
 * Three kinds of row:
 * - SEEN   (D2, C3, C5, C7, C8, D3): from the coach's live form, combined across Part 1 and Part 2.
 * - HEARD  (C1, C2, C4, C6, D1, D4, D5): from the moments Rumi found in the recording that the coach
 *          confirmed, plus Rumi's summary counts (e.g. closed questions) that decide no level alone.
 * - PICK   (F1-F4): no counting rule yet (Section F is unreviewed); the coach picks.
 *
 * A result is { level, because, source, hole?, check? } where level is 1-4, 'NA', 'IE', or null
 * (null = the coach picks at the check).
 */

const { CODES, PLAIN } = require('./fico17');

const SEEN_CODES = ['D2', 'C3', 'C5', 'C7', 'C8', 'D3'];
const HEARD_CODES = ['C1', 'C2', 'C4', 'C6', 'D1', 'D4', 'D5'];
const PICK_CODES = ['F1', 'F2', 'F3', 'F4'];

// One answer -> one level.
const PICKED = { hands: 1, once: 2, often: 3, varied: 4 };
const GROUPS = { none: 1, alone: 2, combine: 3, roles: 4, cannot: 'NA' };
const LISTEN = { turns: 2, once: 2, often: 3, agreed: 4 };
const LISTEN_SAID = {
  turns: 'each spoke, no one replied', once: 'one child replied to another',
  often: 'they replied to each other often', agreed: 'they disagreed, then agreed',
};
const MATERIALS = { none: 1, teacher: 2, children: 3, explain: 4, nofit: 'NA' };
const SWITCH = { stalled: 1, slow: 2, clear: 3, ahead: 4 };
const PARTS = ['p1', 'p2'];

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const whole = (v) => { const n = num(v); return n != null && Number.isInteger(n) && n >= 0 ? n : null; };
const count = (v) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : 0);
const hasGroups = (g) => Boolean(g) && g !== 'none' && g !== 'cannot';
const phrase = (code, level) => PLAIN[code][level - 1].toLowerCase();
const partName = (p) => (p === 'p1' ? 'Part 1' : 'Part 2');

// ---------------------------------------------------------------- seen rows

function d2(a) {
  const p1 = whole(a.p1_spoke), p2 = whole(a.p2_spoke), fresh = whole(a.p2_new);
  if (p1 == null && p2 == null) return null;
  const present = whole(a.present);
  const off = (present != null && ((p1 != null && p1 > present) || (p2 != null && p2 > present)
    || (p1 != null && fresh != null && fresh > present - p1)))
    || (p2 != null && fresh != null && fresh > p2);
  if (off) return { level: null, because: "the numbers don't add up yet: check them in the form", source: 'seen', check: true };
  const total = (p1 || 0) + (fresh || 0);
  if (p2 == null) return { level: total <= 2 ? 1 : 2, because: `${total} children spoke, Part 1 only so far`, source: 'seen' };
  const spread = (p1 || 0) > 0 && p2 > 0;
  const counted = `${total} different children spoke (${p1 || 0} in Part 1, ${fresh || 0} more in Part 2)`;
  if (total <= 2) return { level: 1, because: counted, source: 'seen' };
  if (total <= 5) return { level: 2, because: counted, source: 'seen' };
  if (!spread) return { level: 2, because: `${total} different children spoke, all in Part ${p1 ? 1 : 2}: not spread across the lesson, so 2 for now`, source: 'seen', hole: true };
  if ((fresh || 0) >= 2) return { level: 4, because: `${total} different children spoke, ${fresh} of them for the first time in Part 2`, source: 'seen' };
  return { level: 3, because: `${total} different children spoke, in both parts`, source: 'seen' };
}

// The higher part counts (did it happen at all). N/A only when no part shows the practice and a
// part says it could not happen.
function higher(a, key, map, code, naBecause) {
  const seen = PARTS.map((p) => ({ p, v: a[`${p}_${key}`] })).filter((x) => x.v);
  if (!seen.length) return null;
  const nums = seen.filter((x) => typeof map[x.v] === 'number');
  const best = nums.reduce((m, x) => (map[x.v] > (m ? map[m.v] : 0) ? x : m), null);
  if (seen.some((x) => map[x.v] === 'NA') && (!best || map[best.v] < 2)) return { level: 'NA', because: naBecause, source: 'seen' };
  if (!best) return null;
  const lv = map[best.v];
  const where = nums.length > 1 && map[nums[0].v] !== map[nums[1].v] ? ` (in ${partName(best.p)})` : '';
  return { level: lv, because: `you saw: ${phrase(code, lv)}${where}`, source: 'seen' };
}

function d3(a) {
  const withGroups = PARTS.filter((p) => hasGroups(a[`${p}_groups`]));
  if (!withGroups.length) {
    if (PARTS.some((p) => a[`${p}_groups`])) return { level: null, because: 'no group work to listen to: judge from what the recording caught near the recorder', source: 'heard' };
    return null;
  }
  const ticks = withGroups.flatMap((p) => a[`${p}_listen`] || []);
  if (!ticks.length) {
    if (withGroups.some((p) => String(a[`${p}_listen_other`] || '').trim())) return { level: null, because: 'you wrote something else: pick the level at the check', source: 'seen' };
    return null;
  }
  const lv = Math.max(...ticks.map((k) => LISTEN[k] || 0));
  if (!lv) return null;
  const hole = lv === 2 && ticks.includes('once');
  const ticked = [...new Set(ticks)].filter((k) => LISTEN_SAID[k]).map((k) => LISTEN_SAID[k]).join('; ');
  return { level: lv, because: `you ticked: ${ticked}${hole ? '. A single exchange has no level yet, so 2 for now' : ''}`, source: 'seen', hole };
}

// Only parts with a switch of activity count; the weaker switch decides (did the routine hold?).
function c5(a) {
  const switched = PARTS.filter((p) => a[`${p}_change`] === 'yes' && SWITCH[a[`${p}_change_how`]]);
  if (!switched.length) {
    if (PARTS.some((p) => a[`${p}_change`] === 'no') && !PARTS.some((p) => a[`${p}_change`] === 'yes')) return { level: 'NA', because: 'the class did not switch activity', source: 'seen' };
    return null;
  }
  const lv = Math.min(...switched.map((p) => SWITCH[a[`${p}_change_how`]]));
  const where = switched.length > 1 && SWITCH[a.p1_change_how] !== SWITCH[a.p2_change_how] ? ', the weaker of the two parts' : '';
  return { level: lv, because: `you saw: ${phrase('C5', lv)}${where}`, source: 'seen' };
}

function seenLevels(form) {
  const a = form || {};
  const all = {
    D2: d2(a),
    C3: higher(a, 'picked', PICKED, 'C3', ''),
    C5: c5(a),
    C7: higher(a, 'groups', GROUPS, 'C7', "the room can't seat groups"),
    C8: higher(a, 'materials', MATERIALS, 'C8', 'no material suits this topic'),
    D3: d3(a),
  };
  const out = {};
  for (const [code, r] of Object.entries(all)) if (r) out[code] = r;
  return out;
}

// ---------------------------------------------------------------- heard rows

// What each confirmed moment type counts towards. A moment is counted once; Rumi's summary counts
// (closed questions, generic praise) only decide between levels 1 and 2.
const ADDS = {
  open_q_one: ['open_q', 'one_child'], open_q_choral: ['open_q'],
  wrong_reason: ['wrong_reason'], wrong_fixed: ['wrong_fixed'], wrong_ignored: ['wrong_ignored'],
  praise_effort: ['praise_effort'], praise_generic: ['praise_generic'], mistake_useful: ['mistake_useful'],
  reasoning: ['reasoned'], long_answer: ['long_answer'],
  content_q: ['childq_content'], proc_q: ['childq_proc'],
  choice: ['choice'], handover: ['handover'], hedged: ['hedged'], unprompted: ['unprompted'],
};
const LEVEL4 = { probe: 'C1', strategy: 'C2', disagree: 'C6', beyond: 'D1', beyond_q: 'D5' };

function tally(confirmed, heardCounts) {
  const c = {}, l4 = {};
  for (const it of confirmed || []) {
    for (const k of ADDS[it.type] || []) c[k] = (c[k] || 0) + 1;
    if (LEVEL4[it.type]) l4[LEVEL4[it.type]] = true;
  }
  const counts = heardCounts || {};
  c.closed_q = count(counts.closed_q);
  c.praise_generic = Math.max(count(c.praise_generic), count(counts.praise_generic));
  return { c, l4 };
}

const up = (l4, l3because, l4because) => (l4 ? { level: 4, because: `${l3because}, and ${l4because}` } : { level: 3, because: l3because });

const HEARD_RULES = {
  C1: ({ c, l4 }) => {
    const open = count(c.open_q), one = count(c.one_child);
    if (open >= 2 && one >= 2) return up(l4.C1, 'two or more open questions, each answered by one child', 'a "why" question with a follow-up');
    if (open >= 1 && one >= 1) return { level: 2, hole: true, because: 'one open question answered by one child: the rubric gives this no level, so 2 for now' };
    if (open + c.closed_q > 0) return { level: 2, because: 'questions were yes/no or answered in chorus' };
    return { level: 1, because: 'no real questions confirmed' };
  },
  C2: ({ c, l4 }) => {
    const reason = count(c.wrong_reason), fixed = count(c.wrong_fixed), ignored = count(c.wrong_ignored);
    if (reason >= 2) return up(l4.C2 && fixed >= 1, 'the reason was given on two or more wrong answers', 'a child fixed it and the teacher tried a new way');
    if (reason === 1) return { level: 2, because: 'the reason was given on one wrong answer' };
    if (ignored >= 1) return { level: 1, because: 'wrong answers were left without a reason' };
    return { level: null, because: 'no wrong answers confirmed: pick N/A if none happened' };
  },
  C4: ({ c }) => {
    if (!count(c.choice)) return { level: null, because: 'no real choice confirmed: pick 1 or 2' };
    return up(count(c.handover) > 0, 'a real choice was offered and acted on', 'part of the lesson was handed to the children');
  },
  C6: ({ c, l4 }) => {
    const eff = count(c.praise_effort);
    if (eff >= 2) return up(l4.C6 && count(c.mistake_useful) >= 1, 'two or more pieces of praise for effort or thinking', 'a mistake was used and disagreement welcomed');
    if (eff === 1) return { level: 2, hole: true, because: 'one piece of praise for effort: the rubric gives this no level, so 2 for now' };
    if (count(c.praise_generic) >= 1) return { level: 2, because: 'praise only for right answers, in general words' };
    return { level: 1, because: 'no encouragement confirmed' };
  },
  D1: ({ c, l4 }) => {
    const r = count(c.reasoned);
    if (r >= 2) return up(l4.D1, 'two or more children explained why', 'a child reasoned beyond what was asked');
    if (r === 1) return { level: 2, hole: true, because: 'one child explained why: the rubric gives this no level, so 2 for now' };
    if (count(c.long_answer) >= 1) return { level: 2, because: 'longer answers, but no reasoning' };
    return { level: 1, because: 'no answer longer than a phrase confirmed' };
  },
  D4: ({ c }) => {
    const h = count(c.hedged);
    if (h >= 2) return up(count(c.unprompted) > 0, 'two or more children tried while openly unsure', 'a child tried without being asked, or kept going after a wrong answer');
    if (h === 1) return { level: 2, hole: true, because: 'one unsure attempt: the rubric gives this no level, so 2 for now' };
    return { level: null, because: 'no unsure attempt confirmed: pick 1 or 2' };
  },
  D5: ({ c, l4 }) => {
    const q = count(c.childq_content);
    if (q >= 1) return up(l4.D5 && q >= 2, 'a child asked a question about the content', 'two questions, one going beyond the lesson');
    if (count(c.childq_proc) >= 1) return { level: 2, because: "only 'which page' questions" };
    return { level: 1, because: 'no child asked a question' };
  },
};

function heardLevels(confirmed, heardCounts) {
  const t = tally(confirmed, heardCounts);
  const out = {};
  for (const code of HEARD_CODES) out[code] = { ...HEARD_RULES[code](t), source: 'heard' };
  return out;
}

// ---------------------------------------------------------------- all 17

function addUp({ form, confirmed, heardCounts } = {}) {
  const a = form || {};
  const out = {};
  const recordingFailed = a.incident === 'tech';
  const heard = heardLevels(confirmed, heardCounts);
  for (const code of HEARD_CODES) {
    out[code] = recordingFailed
      ? { level: 'IE', because: 'the recording failed, so nothing could be heard', source: 'heard' }
      : heard[code];
  }
  for (const code of PICK_CODES) out[code] = { level: null, because: "no counting rule yet: pick from the recording's moments", source: 'pick' };
  const seen = seenLevels(a);
  for (const code of SEEN_CODES) out[code] = seen[code] || { level: null, because: 'not answered in the form', source: 'seen' };
  if (a.incident === 'ridicule') out.C6 = { level: 1, because: 'you reported ridicule or humiliation, which forces 1', source: 'seen' };
  if (a.incident === 'error') out.F1 = { level: 1, because: 'you reported a wrong fact left standing, which forces 1', source: 'seen' };
  for (const code of CODES) if (!out[code]) out[code] = { level: null, because: 'not answered', source: 'pick' };
  return out;
}

// ---------------------------------------------------------------- the checks

const need = (e, a, k, msg) => { if (a[k] == null || a[k] === '' || a[k] === false) e[k] = msg; };

function partChecks(e, a, p) {
  const present = whole(a.present);
  const spoke = a[`${p}_spoke`];
  if (spoke === '' || spoke == null) e[`${p}_spoke`] = 'Type how many children spoke, 0 if none.';
  else if (whole(spoke) == null) e[`${p}_spoke`] = 'A whole number, please.';
  else if (present != null && whole(spoke) > present) e[`${p}_spoke`] = `Can't be more than the ${present} children present.`;
  need(e, a, `${p}_picked`, 'Choose who the teacher asked.');
  need(e, a, `${p}_groups`, 'Choose one, or "No".');
  if (hasGroups(a[`${p}_groups`]) && !(a[`${p}_listen`] || []).length && !String(a[`${p}_listen_other`] || '').trim()) {
    e[`${p}_listen`] = 'Tick what you saw, or write it in "Something else".';
  }
  need(e, a, `${p}_materials`, 'Choose one.');
  need(e, a, `${p}_change`, 'Yes or no.');
  if (a[`${p}_change`] === 'yes') need(e, a, `${p}_change_how`, 'Choose what happened at the switch.');
}

function validate(screen, answers) {
  const a = answers || {};
  const e = {};
  if (screen === 'PART_ONE') {
    const present = whole(a.present);
    if (a.present === '' || a.present == null) e.present = 'Type how many children are in class today.';
    else if (present == null || present < 1 || present > 120) e.present = 'A whole number between 1 and 120.';
    partChecks(e, a, 'p1');
  } else if (screen === 'PART_TWO') {
    partChecks(e, a, 'p2');
    const fresh = a.p2_new, n = whole(fresh), p2 = whole(a.p2_spoke), present = whole(a.present), p1 = whole(a.p1_spoke);
    if (fresh === '' || fresh == null) e.p2_new = 'Type how many, 0 if none.';
    else if (n == null) e.p2_new = 'A whole number, please.';
    else if (p2 != null && n > p2) e.p2_new = `Can't be more than the ${p2} children who spoke in Part 2.`;
    else if (present != null && p1 != null && n > present - p1) e.p2_new = `Only ${present - p1} children hadn't spoken in Part 1.`;
  } else if (screen === 'LESSON_PLAN') {
    need(e, a, 'lp', 'Choose one.');
    // Only when the list had plans to pick: with none, "Not in this list" is the only answer.
    if (a.lp && a.lp !== 'none' && a.has_plans) need(e, a, 'lp_pick', 'Pick the plan, or "Not in this list".');
  } else if (screen === 'AFTER') {
    need(e, a, 'incident', 'Choose one, or "Nothing to report".');
    if (a.incident && a.incident !== 'none') need(e, a, 'detail', 'Write what was said, and the minute.');
    need(e, a, 'priority', 'Pick what the teacher should work on first.');
    if (a.seal_ok !== true && a.seal_ok !== 'true') e.seal_ok = 'Tick the box to seal.';
  }
  return e;
}

module.exports = {
  SEEN_CODES, HEARD_CODES, PICK_CODES,
  PICKED, GROUPS, LISTEN, MATERIALS, SWITCH, ADDS, LEVEL4,
  seenLevels, heardLevels, addUp, validate,
};
