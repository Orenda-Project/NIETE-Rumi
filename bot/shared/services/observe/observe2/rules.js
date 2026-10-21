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
 *          Since form version 5 the parts follow the lesson's steps (FICO pilot sheet R4/R10): Part 1
 *          is warm-up to guided practice, Part 2 the children working on their own and the wrap-up,
 *          which no longer asks C3, C7, D3 or C8; those come from Part 1 alone. Part 2's own answers
 *          add what the coach saw at the desks to two HEARD rows: C2 (the teacher helping the stuck)
 *          and D4 (what children did when the work got hard). Since form version 6 (pilot sheet R4's
 *          comment) Part 2 also asks whether the teacher asked children one by one if they understood
 *          (named on C2 and C3, no level) and re-explained a common mistake to the class (C2 at least 2).
 *          A form on the older Flow keeps the older answers, and they add up as before.
 * - HEARD  (C1, C2, C4, C6, D1, D4, D5): from the moments Rumi found in the recording that the coach
 *          confirmed, plus Rumi's summary counts (e.g. closed questions) that decide no level alone.
 *          Since form version 5, what the coach ticked under "What children's work showed" (R16) counts
 *          toward D1 and D5 the way a confirmed moment does, and is named on D1, D5, F3 and F4.
 * - PICK   (F1-F4): no counting rule yet (Section F is unreviewed); the coach picks.
 *
 * A result is { level, because, source, hole?, check? } where level is 1-4, 'NA', 'IE', or null
 * (null = the coach picks at the check).
 */

const { CODES, PLAIN, FOCUS, ALSO_NONE } = require('./fico17');

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
// "What was used?" (R17): named on C8's line, never a level (who used them sets C8, by its descriptors).
const USED_SAID = { book: 'the textbook or board', pictures: 'charts or pictures', objects: 'objects or manipulatives', made: 'materials the teacher made' };
const MATERIALS_USED = new Set(['teacher', 'children', 'explain']);
const usedOf = (a) => Object.keys(USED_SAID).filter((k) => (Array.isArray(a.p1_used) ? a.p1_used : []).includes(k));
/** "charts or pictures; materials the teacher made", or '' when nothing was ticked. */
const usedPhrase = (a) => usedOf(a || {}).map((k) => USED_SAID[k]).join('; ');
const SWITCH = { stalled: 1, slow: 2, clear: 3, ahead: 4 };
const PARTS = ['p1', 'p2'];
// Part 2 since form version 5: the children working on their own.
const TASK = { all: 'every child had a task of their own', some: 'only some children had a task of their own', none: 'no work on their own' };
const TEACHER_SAID = {
  round: 'went round the room', checked: 'looked at their work',
  cfu: 'asked children one by one whether they understood or needed help',
  helped: 'helped those who were stuck', reteach: 're-explained a common mistake to the whole class',
  more: 'gave more to early finishers', front: 'stayed at the front',
};
// The ticks that are a response to wrong answers or visible confusion, so C2 is at least 2. C2 level 1 reads
// "does not respond to wrong answers or visible confusion, or responds only by repeating the same explanation
// in the same words"; level 2 "marks the answer right or wrong, or re-explains". Re-explaining a mistake many
// children made is one occasion, and level 3 needs the reasoning on two, so neither raises C2 past 2 alone.
const RESPONDED = ['helped', 'reteach'];
// Asking each child whether they understood (form version 6, pilot sheet R4's comment): a teacher-to-student
// question turn (C3's evidence unit) that reaches children beyond the volunteers, and the way confusion is
// found (C2). It is named on both lines; it sets no level, as neither descriptor counts it.
const ASKED_EACH = 'cfu';
// "When the work got hard": the four D4 levels, word for word (the form's titles are PLAIN.D4), and
// "Nobody got stuck", which shows no level.
const STUCK = { waited: 1, sure: 2, unsure: 3, kept: 4, easy: null };
// "What children's work showed" (R16): recall or reasoning. A reasoning tick counts once toward the
// rubric's count, as a confirmed moment does ("explaining why … applying a rule to a new case" for D1;
// "a question about the content itself" for D5); their own example or link is D1's level-4 sign. Recall
// raises nothing; it is named. F3 and F4 have no counting rule, so the ticks are only named there.
const THINK_SAID = {
  recall: 'repeated or copied it', why: 'explained why or how', new: 'solved a new problem',
  ownq: 'asked a question about it', apply: 'gave their own example or link',
};
const THINK_ADDS = { why: ['reasoned'], new: ['reasoned'], ownq: ['childq_content'] };
const THINK_LEVEL4 = { apply: 'D1' };
const THINK_FOR = { D1: ['recall', 'why', 'new', 'apply'], D5: ['ownq'], F3: ['recall', 'why', 'new'], F4: ['apply'] };
// The ticks that can set a level on a HEARD row when the recording failed.
const THINK_COUNTS = { D1: ['why', 'new'], D5: ['ownq'] };

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

// C8's line names the materials used, so a teacher's own are recognised by name (R17).
function named(r, a) {
  const used = usedPhrase(a);
  return r && used && typeof r.level === 'number' ? { ...r, because: `${r.because}. Used: ${used}` } : r;
}

function seenLevels(form) {
  const a = form || {};
  const all = {
    D2: d2(a),
    C3: higher(a, 'picked', PICKED, 'C3', ''),
    C5: c5(a),
    C7: higher(a, 'groups', GROUPS, 'C7', "the room can't seat groups"),
    C8: named(higher(a, 'materials', MATERIALS, 'C8', 'no material suits this topic'), a),
    D3: d3(a),
  };
  const out = {};
  for (const [code, r] of Object.entries(all)) if (r) out[code] = r;
  return out;
}

// ---------------------------------------------------------------- seen at the desks (Part 2)

const workedAlone = (a) => Boolean(a.p2_task) && a.p2_task !== 'none';

// What the coach saw while the children worked on their own, for the HEARD rows it speaks to:
// { code: { level|null, note } }. `note` reads after "you saw " (the check) or "Seen " (the record).
function desk(a) {
  const out = {};
  if (!a.p2_task) return out;
  const some = a.p2_task === 'some' ? ` (${TASK.some})` : '';
  if (!workedAlone(a)) {
    out.D4 = { level: null, note: `${TASK.none} in Part 2` };
    return out;
  }
  if (Object.prototype.hasOwnProperty.call(STUCK, a.p2_stuck)) {
    const lv = STUCK[a.p2_stuck];
    out.D4 = lv == null
      ? { level: null, note: `nobody got stuck while they worked alone${some}` }
      : { level: lv, note: `while they worked alone: ${phrase('D4', lv)}${some}` };
  }
  const ticks = (a.p2_teacher || []).filter((k) => TEACHER_SAID[k]);
  if (ticks.length) {
    // C2 level 1 reads "does not respond to wrong answers or visible confusion": a teacher who helped
    // the children who were stuck, or re-explained a mistake to the class, did respond, so C2 is at least 2.
    // Every tick is named.
    out.C2 = {
      level: ticks.some((k) => RESPONDED.includes(k)) ? 2 : null,
      note: `while they worked alone, the teacher ${ticks.map((k) => TEACHER_SAID[k]).join('; ')}`,
    };
  }
  if (ticks.includes(ASKED_EACH)) out.C3 = { level: null, note: `while they worked alone, the teacher ${TEACHER_SAID[ASKED_EACH]}` };
  return out;
}

const thinkTicks = (a) => Object.keys(THINK_SAID).filter((k) => (Array.isArray(a.p2_think) ? a.p2_think : []).includes(k));

// What the children's work showed, for the indicators it speaks to: { code: phrase }.
function thinking(a) {
  const ticks = thinkTicks(a);
  const out = {};
  for (const [code, kinds] of Object.entries(THINK_FOR)) {
    const seen = ticks.filter((k) => kinds.includes(k));
    if (seen.length) out[code] = `in Part 2, children ${seen.map((k) => THINK_SAID[k]).join('; ')}`;
  }
  return out;
}

/**
 * What the coach saw on the live form beyond a level, per indicator, for the record's evidence (the
 * teacher's portal shows it under each indicator): { code: sentence }.
 */
function seenNotes(answers) {
  const out = {};
  const a = answers || {};
  for (const [code, s] of Object.entries(desk(a))) out[code] = `Seen ${s.note}`;
  for (const [code, note] of Object.entries(thinking(a))) out[code] = out[code] ? `${out[code]}; ${note}` : `Seen ${note}`;
  const used = usedPhrase(a);
  if (used) out.C8 = `Used: ${used}`;
  return out;
}

// A HEARD row with what was seen at the desks: the higher level counts (did it happen at all), and
// what was seen is always named. A failed recording leaves what was seen standing.
function withSeen(r, s) {
  const lv = typeof r.level === 'number' ? r.level : null;
  if (s.level != null && (lv == null || s.level > lv)) {
    const heard = lv != null ? `; the recording: ${r.because}` : '';
    return { level: s.level, because: `you saw ${s.note}${heard}`, source: 'seen' };
  }
  return { ...r, because: [r.because, `you saw ${s.note}`].filter(Boolean).join('; ') };
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

function tally(confirmed, heardCounts, think = []) {
  const c = {}, l4 = {};
  for (const it of confirmed || []) {
    for (const k of ADDS[it.type] || []) c[k] = (c[k] || 0) + 1;
    if (LEVEL4[it.type]) l4[LEVEL4[it.type]] = true;
  }
  // What the coach saw of the children's thinking in Part 2 (R16), counted the same way.
  for (const k of think) {
    for (const key of THINK_ADDS[k] || []) c[key] = (c[key] || 0) + 1;
    if (THINK_LEVEL4[k]) l4[THINK_LEVEL4[k]] = true;
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

function heardLevels(confirmed, heardCounts, think = []) {
  const t = tally(confirmed, heardCounts, think);
  const out = {};
  for (const code of HEARD_CODES) out[code] = { ...HEARD_RULES[code](t), source: 'heard' };
  return out;
}

// ---------------------------------------------------------------- all 17

function addUp({ form, confirmed, heardCounts } = {}) {
  const a = form || {};
  const out = {};
  const recordingFailed = a.incident === 'tech';
  const think = thinkTicks(a);
  // A failed recording leaves only what the coach saw: their thinking ticks still count where they can.
  const heard = recordingFailed ? heardLevels([], {}, think) : heardLevels(confirmed, heardCounts, think);
  for (const code of HEARD_CODES) {
    const seenCounts = (THINK_COUNTS[code] || []).some((k) => think.includes(k));
    out[code] = recordingFailed && !seenCounts
      ? { level: 'IE', because: 'the recording failed, so nothing could be heard', source: 'heard' }
      : heard[code];
  }
  // What was seen at the desks: on a HEARD row now, on a SEEN row (C3) once that row is set below.
  const atDesks = desk(a);
  for (const [code, s] of Object.entries(atDesks)) if (!SEEN_CODES.includes(code)) out[code] = withSeen(out[code], s);
  for (const code of PICK_CODES) out[code] = { level: null, because: "no counting rule yet: pick from the recording's moments", source: 'pick' };
  for (const [code, note] of Object.entries(thinking(a))) out[code] = { ...out[code], because: `${out[code].because}; you saw ${note}` };
  const seen = seenLevels(a);
  for (const code of SEEN_CODES) out[code] = seen[code] || { level: null, because: 'not answered in the form', source: 'seen' };
  for (const [code, s] of Object.entries(atDesks)) if (SEEN_CODES.includes(code)) out[code] = withSeen(out[code], s);
  if (a.incident === 'ridicule') out.C6 = { level: 1, because: 'you reported ridicule or humiliation, which forces 1', source: 'seen' };
  if (a.incident === 'error') out.F1 = { level: 1, because: 'you reported a wrong fact left standing, which forces 1', source: 'seen' };
  for (const code of CODES) if (!out[code]) out[code] = { level: null, because: 'not answered', source: 'pick' };
  return out;
}

// ---------------------------------------------------------------- the checks

const need = (e, a, k, msg) => { if (a[k] == null || a[k] === '' || a[k] === false) e[k] = msg; };

function spokeCheck(e, a, p) {
  const present = whole(a.present);
  const spoke = a[`${p}_spoke`];
  if (spoke === '' || spoke == null) e[`${p}_spoke`] = 'Type how many children spoke, 0 if none.';
  else if (whole(spoke) == null) e[`${p}_spoke`] = 'A whole number, please.';
  else if (present != null && whole(spoke) > present) e[`${p}_spoke`] = `Can't be more than the ${present} children present.`;
}

function switchCheck(e, a, p) {
  need(e, a, `${p}_change`, 'Yes or no.');
  if (a[`${p}_change`] === 'yes') need(e, a, `${p}_change_how`, 'Choose what happened at the switch.');
}

function partChecks(e, a, p) {
  spokeCheck(e, a, p);
  need(e, a, `${p}_picked`, 'Choose who the teacher asked.');
  need(e, a, `${p}_groups`, 'Choose one, or "No".');
  if (hasGroups(a[`${p}_groups`]) && !(a[`${p}_listen`] || []).length && !String(a[`${p}_listen_other`] || '').trim()) {
    e[`${p}_listen`] = 'Tick what you saw, or write it in "Something else".';
  }
  need(e, a, `${p}_materials`, 'Choose one.');
  switchCheck(e, a, p);
}

// Part 1 since form version 5: what was used, once materials were (R17).
function usedCheck(e, a) {
  if (MATERIALS_USED.has(a.p1_materials) && !usedOf(a).length) e.p1_used = 'Tick what was used.';
}

// Part 2 since form version 5: the children working on their own.
function workAloneChecks(e, a) {
  spokeCheck(e, a, 'p2');
  need(e, a, 'p2_task', 'Choose one, or "No work on their own".');
  if (workedAlone(a)) {
    if (!(a.p2_teacher || []).length) e.p2_teacher = 'Tick what the teacher did, or "Stayed at the front".';
    need(e, a, 'p2_stuck', 'Choose what the children did when the work got hard.');
  }
  if (!thinkTicks(a).length) e.p2_think = 'Tick what you saw, or "Repeated or copied it".';
  switchCheck(e, a, 'p2');
}

// "Also work on" (R14): optional, but never the first pick again and never twice.
function alsoChecks(e, a) {
  const real = (v) => Boolean(v) && v !== ALSO_NONE && Boolean(FOCUS[v]);
  if (real(a.also_1) && a.also_1 === a.priority) e.also_1 = 'That is already your first pick. Choose another, or "Nothing else".';
  if (real(a.also_2) && a.also_2 === a.priority) e.also_2 = 'That is already your first pick. Choose another, or "Nothing else".';
  else if (real(a.also_2) && a.also_2 === a.also_1) e.also_2 = 'Already picked above. Choose another, or "Nothing else".';
}

/**
 * @param {string} screen
 * @param {object} answers the record's answers with this screen's on top
 * @param {{version?: string|number}} [opts] the form's version (`fv`); the parts' questions changed in 5
 */
function validate(screen, answers, { version } = {}) {
  const a = answers || {};
  const e = {};
  const byPhase = Number(version) >= 5;
  if (screen === 'PART_ONE') {
    const present = whole(a.present);
    if (a.present === '' || a.present == null) e.present = 'Type how many children are in class today.';
    else if (present == null || present < 1 || present > 120) e.present = 'A whole number between 1 and 120.';
    partChecks(e, a, 'p1');
    if (byPhase) usedCheck(e, a);
  } else if (screen === 'PART_TWO') {
    if (byPhase) workAloneChecks(e, a); else partChecks(e, a, 'p2');
    const fresh = a.p2_new, n = whole(fresh), p2 = whole(a.p2_spoke), present = whole(a.present), p1 = whole(a.p1_spoke);
    if (fresh === '' || fresh == null) e.p2_new = 'Type how many, 0 if none.';
    else if (n == null) e.p2_new = 'A whole number, please.';
    else if (p2 != null && n > p2) e.p2_new = `Can't be more than the ${p2} children who spoke in Part 2.`;
    else if (present != null && p1 != null && n > present - p1) e.p2_new = `Only ${present - p1} children hadn't spoken in Part 1.`;
  } else if (screen === 'LESSON_PLAN') {
    need(e, a, 'lp', 'Choose one.');
    // "Upload new" is always in the list, so a plan that was there is always picked or added.
    if (a.lp && a.lp !== 'none') need(e, a, 'lp_pick', 'Pick the plan, or "Upload new".');
    if (a.lp && a.lp !== 'none' && a.lp_pick === 'upload') need(e, a, 'lp_how', "Say how you'll add the plan: photos, a file, or typed.");
  } else if (screen === 'LP_PHOTOS') {
    if (!Array.isArray(a.lp_photos) || !a.lp_photos.length) e.lp_photos = 'Add at least one photo of the plan.';
  } else if (screen === 'LP_FILE') {
    if (!Array.isArray(a.lp_file) || !a.lp_file.length) e.lp_file = "Add the plan's file.";
  } else if (screen === 'LP_TEXT') {
    const { LP_TEXT_MIN } = require('./field-form.flow');
    if (String(a.lp_text || '').trim().length < LP_TEXT_MIN) e.lp_text = 'Type a little more: the steps the teacher planned, in order.';
  } else if (screen === 'PHOTOS') {
    need(e, a, 'photo_how', 'Choose how to add photos, or "No photos".');
  } else if (screen === 'PHOTO_TAKE') {
    if (!Array.isArray(a.photos) || !a.photos.length) e.photos = 'Add at least one photo, or go back and pick "No photos".';
  } else if (screen === 'PHOTO_FILES') {
    if (!Array.isArray(a.photo_files) || !a.photo_files.length) e.photo_files = 'Choose at least one photo, or go back and pick "No photos".';
  } else if (screen === 'AFTER') {
    need(e, a, 'incident', 'Choose one, or "Nothing to report".');
    if (a.incident && a.incident !== 'none') need(e, a, 'detail', 'Write what was said, and the minute.');
    need(e, a, 'priority', 'Pick what the teacher should work on first.');
    alsoChecks(e, a);
    if (a.seal_ok !== true && a.seal_ok !== 'true') e.seal_ok = 'Tick the box to seal.';
  }
  return e;
}

module.exports = {
  SEEN_CODES, HEARD_CODES, PICK_CODES,
  PICKED, GROUPS, LISTEN, MATERIALS, USED_SAID, SWITCH, TASK, TEACHER_SAID, STUCK, THINK_SAID, ADDS, LEVEL4, usedPhrase,
  seenLevels, heardLevels, addUp, validate, seenNotes,
};
