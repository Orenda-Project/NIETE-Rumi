'use strict';
/**
 * bd-5jmnfj.38.30 round 9: one review call per section, MCQs only (mirrors the .38.31 distractor review, written
 * for the board tree). Per item the reviewer answers five yes/no questions; any yes makes the item hard (check
 * 'review'), so it is dropped and goes to the targeted rewrite with the other hard items. No I/O: the writer
 * passes the model call in as `call`. Never throws.
 */
const { leaves } = require('../board-checks/walk');

const FAULTS = ['two_defensible', 'key_given_away', 'key_stands_out', 'implausible_distractor', 'level_wrong'];
const sigOf = (it) => JSON.stringify([it.question || it.main_question || '', it.options || []]);
const isMcq = (it) => it && (it.type === 'mcq' || it.type === 'scenario' || Array.isArray(it.options));

/** [{id: sectionId, items:[{n, id, ref, slot, question, options, answer, level, stimulus}]}], sections with MCQs only. */
function sectionsOf(examJson, only) {
  const by = new Map();
  leaves(examJson).forEach((l) => {
    const it = l.item;
    if (!isMcq(it) || (only && !only.has(it.id))) return;
    const sec = l.sectionId != null ? l.sectionId : '-';
    if (!by.has(sec)) by.set(sec, []);
    const list = by.get(sec);
    list.push({ n: list.length + 1, id: it.id, sig: sigOf(it), ref: l.ref, slot: l.slot, question: it.question || it.main_question || '', options: it.options || [], answer: it.answer, level: (it.tag && it.tag.blooms) || '?', stimulus: l.stimulus || null });
  });
  return [...by.entries()].map(([id, items]) => ({ id, items }));
}

const SYSTEM = `You review multiple-choice items from a Grade {grade} board paper written from the book text given. For each item answer five questions, true for yes:
- two_defensible: is more than one option defensible, or is no option clearly right? (Exactly one option must be defensible.)
- key_given_away: does the stem or the stimulus give the key away, word for word or as a paraphrase? (A stem that says "big gaps between levels near the lower shell" gives away "inner shell".)
- key_stands_out: is the key the longest or most detailed option, or does any distractor use always, never or only?
- implausible_distractor: is any distractor one no student who half-knows the lesson would choose?
- level_wrong: is the tagged level wrong? A book worked example, or a fact or definition restated from the book, is Knowledge (K).
Return JSON only: {"items": [{"n": <number>, "two_defensible": <bool>, "key_given_away": <bool>, "key_stands_out": <bool>, "implausible_distractor": <bool>, "level_wrong": <bool>, "why": "<one short line naming the fault, or empty>"}]}, one entry per item.`;

function reviewPrompt(section, grade) {
  const lines = section.items.map((i) => {
    const stim = i.stimulus ? `   stimulus: ${String(i.stimulus).slice(0, 600)}\n` : '';
    return `${stim}${i.n}. ${i.question}\n   options: ${i.options.join(' | ')}\n   key: ${i.answer}\n   level: ${i.level}`;
  });
  return { system: SYSTEM.replace('{grade}', String(grade)), user: `Review these ${section.items.length} items.\n\n${lines.join('\n\n')}` };
}

/** [{id, slot, sig, faults, why}] for the items the reply answers yes on. */
function flagsFrom(reply, section) {
  const list = reply && Array.isArray(reply.items) ? reply.items : [];
  const byN = new Map(section.items.map((i) => [i.n, i]));
  const out = [];
  list.forEach((r) => {
    const it = r && byN.get(Number(r.n));
    if (!it) return;
    const faults = FAULTS.filter((f) => r[f] === true);
    if (faults.length && !out.some((x) => x.id === it.id)) out.push({ id: it.id, slot: it.slot, sig: it.sig, question: it.question, faults, why: r.why ? String(r.why) : '' });
  });
  return out;
}

/**
 * Adds the flags whose item is still in examJson to a checks result as hard issues (mutates it). Items are matched
 * by text, not id: ids are positional, so a replacement takes the dropped item's id.
 */
function applyFlags(checks, flags, examJson) {
  const now = new Map(sectionsOf(examJson).flatMap((s) => s.items).map((i) => [i.sig, i]));
  const live = [];
  (flags || []).forEach((x) => { const i = now.get(x.sig); if (i && !live.some((y) => y.id === i.id)) live.push({ id: i.id, slot: i.slot, faults: x.faults, why: x.why }); });
  if (!live.length) return checks;
  live.forEach((f) => {
    let row = checks.shortfall.find((r) => r.slot === f.slot);
    if (!row) { row = { slot: f.slot, reason: 'review', items: [], item_refs: [], hard: true }; checks.shortfall.push(row); }
    if (!row.items.includes(f.id)) row.items.push(f.id);
    row.why = row.why || {};
    if (!row.why[f.id]) row.why[f.id] = 'review';
    row.review = row.review || {};
    row.review[f.id] = { faults: f.faults, why: f.why };
  });
  checks.record.per_check = checks.record.per_check || {};
  checks.record.per_check.review = { issues: live.length, hard: live.length };
  checks.record.hard = (checks.record.hard || 0) + live.length;
  return checks;
}

/**
 * Round 9b: after the last rewrite the review stops being hard. A live reviewer says yes on ~45% of items, rewrites
 * included, so a hard review fails every paper; its leftovers become notes (mutates checks). Other reasons stay hard.
 * `groups` holds the ids of stimulus-group members. With `hold` (the writer's calls before its last), a key_given_away flag
 * (bd-5jmnfj.38.33) and a fault on a group member (bd-5jmnfj.38.34) stay hard, so the writer can swap or re-ask them.
 * Without it (the final call) every review flag left becomes a note, and those two kinds are marked paper_level: the
 * paper ships with them noted, never a throw (Amena's ruling, "ship with note").
 */
function soften(checks, { hold = false, groups = new Set() } = {}) {
  let moved = 0;
  let kept = 0;
  checks.shortfall = checks.shortfall.filter((row) => {
    const reviewIds = Object.keys(row.review || {}).filter((id) => row.why && row.why[id] === 'review');
    const serious = (id) => groups.has(id) || row.review[id].faults.includes('key_given_away');
    const mine = reviewIds.filter((id) => !(hold && serious(id)));
    kept += reviewIds.length - mine.length;
    mine.forEach((id) => {
      checks.notes.push({ check: 'review', id, slot: row.slot, faults: row.review[id].faults, why: row.review[id].why || '', ...(serious(id) ? { paper_level: true } : {}) });
      row.items = row.items.filter((x) => x !== id);
      if (row.item_refs) row.item_refs = row.item_refs.filter((x) => x !== id);
      delete row.why[id];
      moved += 1;
    });
    if (!Object.keys(row.review || {}).some((id) => row.why && row.why[id] === 'review')) delete row.review;
    return !(row.reason === 'review' && !row.items.length);
  });
  const counted = checks.record.per_check && checks.record.per_check.review;
  checks.record.hard = Math.max(0, (checks.record.hard || 0) - (counted ? counted.hard : moved) + kept);
  if (counted) counted.hard = kept;
  return checks;
}

/** Round 9b: {flagged, by_fault} of a set of flags, for the review log line. */
function tally(flags) {
  const by = {};
  flags.forEach((f) => f.faults.forEach((k) => { by[k] = (by[k] || 0) + 1; }));
  return { flagged: flags.length, by_fault: by };
}

/** Round 9b: '"stem": fault, fault (why)' for each flag whose stem was removed, so the rewrite is told what to avoid. */
function faultLines(flags, stems) {
  const want = new Set(stems);
  return flags.filter((f) => want.has(f.question)).map((f) => `"${f.question}": ${f.faults.map((k) => k.replace(/_/g, ' ')).join(', ')}${f.why ? ` (${f.why})` : ''}`);
}

/** One call per section; call({id, n, system, user}) resolves to the parsed reply. */
async function reviewPaper({ examJson, grade, call, only, seen, onError = () => {} }) {
  const out = [];
  for (const whole of sectionsOf(examJson, only)) {
    // round 9b: an item is reviewed once by its text (ids are positional, so an unchanged item can change id)
    const items = whole.items.filter((i) => !seen || !seen.has(i.sig)).map((i, k) => ({ ...i, n: k + 1 }));
    if (!items.length) continue;
    if (seen) items.forEach((i) => seen.add(i.sig));
    const sec = { id: whole.id, items };
    try {
      const p = reviewPrompt(sec, grade);
      out.push(...flagsFrom(await call({ id: `review-${sec.id}`, n: sec.items.length, ...p }), sec));
    } catch (err) {
      onError(err);
    }
  }
  return out;
}

module.exports = { FAULTS, sectionsOf, reviewPrompt, flagsFrom, applyFlags, reviewPaper, tally, faultLines, soften };
