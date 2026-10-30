'use strict';
/**
 * G5 Science give-aways that must not ship (v37 review, bd-5jmnfj.4.58). A Section A MCQ whose stem or options print the
 * answer to a Section B or C item (Q1 (a) xiv «carbon dioxide» beside Q3 (a) 5), and a B/C stem that prints another B/C
 * item's keyed answer, are found here; the giving item is taken off the paper (as Social Studies takes off its Q1 givers).
 *
 * An item's answer words are the content words (5 letters or more) of its answer and mark points that its own stem does not
 * print. Another item gives them away when its printed text (a stem and options, or a stem and sub-questions) carries two
 * of them, or all of a short point (two content words or fewer). One shared everyday word is not a give-away.
 *
 * `dropScienceGivers` takes each giver off, most words first, and tries a spare (one that gives nothing away) in its place.
 * Where the slot is left under the number the child attempts, `short` names it, so the paper is not shipped with a give-away.
 * Science slots Q1 (a), Q2 (b), Q3 (a) and Q3 (b) only. Pure: the input is never changed.
 */

const { keyedOptionGivers } = require('./fde-science-option-keys'); // v37r4: an MCQ whose keyed option is a key point

const SLOTS = new Set(['science.A.Q1a', 'science.B.Q2b', 'science.C.Q3a', 'science.C.Q3b']);
const ATTEMPT = { 'science.A.Q1a': 20, 'science.B.Q2b': 2, 'science.C.Q3a': 8, 'science.C.Q3b': 2 };
const MIN_WORD = 5;
const SHORT_POINT = 2;
const COMMON = 3; // a word printed by this many items or more is the paper's topic or plain English, not one item's key

const words = (s) => String(s == null ? '' : s).toLowerCase().match(/[\p{L}]+/gu) || [];
const stem = (w) => w.replace(/(ing|ed|es|s)$/, '') || w;
const terms = (s) => [...new Set(words(s).filter((w) => w.length >= MIN_WORD).map(stem))];
const str = (v) => (typeof v === 'string' ? v : '');
const subs = (q) => (Array.isArray(q.questions) ? q.questions.filter((s) => s && typeof s === 'object') : []);
const options = (q) => (Array.isArray(q.options) ? q.options.map(str) : []);
const pointTexts = (o) => ((o.scheme && Array.isArray(o.scheme.points)) ? o.scheme.points.map((p) => str(p && p.text)) : []);

const printedOf = (q) => new Set(terms([q.question, ...options(q), ...subs(q).map((s) => s.question)].join(' ')));

// The item's answer words and its short points, none of them printed by its own stem.
function targetOf(q) {
  const own = new Set(terms([q.question, ...subs(q).map((s) => s.question)].join(' ')));
  const parts = [q, ...subs(q)];
  const fresh = (t) => terms(t).filter((w) => !own.has(w));
  // The marking points are the key; the answer line stands in only where a part has no points (an answer's own wording is not a key).
  const all = new Set(parts.flatMap((o) => fresh((pointTexts(o).length ? pointTexts(o) : [str(o.answer)]).join(' '))));
  const short = parts.flatMap((o) => pointTexts(o)).map((t) => words(t).filter((w) => w.length >= MIN_WORD).map(stem))
    .filter((w) => w.length > 0 && w.length <= SHORT_POINT && w.every((x) => all.has(x)));
  return { all, short };
}

function allItems(examJson) {
  const out = [];
  for (const branch of ['seen', 'unseen']) {
    for (const types of Object.values((examJson && examJson[branch]) || {})) {
      for (const list of Object.values(types || {})) {
        if (Array.isArray(list)) list.forEach((q) => { if (q && typeof q === 'object' && SLOTS.has(q.slot)) out.push(q); });
      }
    }
  }
  return out;
}

/** `{slot, ref, question, words, with}` for each item that prints another item's answer; `ref` is the item itself. */
function scienceGivers(examJson) {
  const items = allItems(examJson);
  const seen = new Map();
  items.forEach((q) => printedOf(q).forEach((w) => seen.set(w, (seen.get(w) || 0) + 1)));
  const rare = (w) => (seen.get(w) || 0) < COMMON;
  const targets = items.map(targetOf).map((t) => ({ all: new Set([...t.all].filter(rare)), short: t.short.filter((p) => p.every(rare)) }));
  const found = [];
  items.forEach((q, i) => {
    const printed = printedOf(q);
    const hits = new Set();
    const against = new Set();
    items.forEach((o, j) => {
      if (j === i) return;
      const shared = [...targets[j].all].filter((w) => printed.has(w));
      const wholePoint = targets[j].short.some((p) => p.every((w) => printed.has(w)));
      if (shared.length >= 2 || wholePoint) {
        (shared.length >= 2 ? shared : targets[j].short.find((p) => p.every((w) => printed.has(w)))).forEach((w) => hits.add(w));
        against.add(o.slot);
      }
    });
    if (hits.size) found.push({ slot: q.slot, ref: q, question: str(q.question), words: [...hits], with: [...against] });
  });
  // A keyed option that is a key point (one-word options, e-endings): added when the item is not already a giver.
  keyedOptionGivers(examJson).forEach((g) => {
    const same = found.find((f) => f.ref === g.ref);
    if (!same) found.push(g);
    else { same.words = [...new Set([...same.words, ...g.words])]; same.with = [...new Set([...same.with, ...g.with])]; }
  });
  return found;
}

const attemptOf = (examJson, slot) => {
  const sl = (((examJson && examJson._layout && examJson._layout.sections) || []).flatMap((s) => s.slots || [])).find((x) => x.slot === slot);
  return sl && Number.isFinite(sl.attempt) ? sl.attempt : ATTEMPT[slot];
};

const lists = (examJson, slot) => {
  const out = [];
  for (const branch of ['seen', 'unseen']) {
    for (const types of Object.values(examJson[branch] || {})) {
      for (const list of Object.values(types || {})) if (Array.isArray(list) && list.some((q) => q && q.slot === slot)) out.push(list);
    }
  }
  return out;
};

/**
 * Take each giver off where the slot keeps its attempt count: a clean spare takes its place, or the slot has headroom.
 * A giver the slot cannot spare stays, listed in `kept`; this never leaves a slot short and never fails a paper.
 * Returns `{examJson, dropped, kept}`, each row `{slot, question, words, with}`.
 */
function dropScienceGivers(examJson, { spares = [] } = {}) {
  const out = JSON.parse(JSON.stringify(examJson));
  const dropped = [];
  const kept = [];
  let pool = (spares || []).filter((q) => q && SLOTS.has(q.slot)).map((q) => JSON.parse(JSON.stringify(q)));
  const stays = new Set();
  const row = (g) => ({ slot: g.slot, question: g.question, words: g.words, with: g.with });
  for (let round = 0; round < 30; round += 1) {
    const giver = scienceGivers(out).filter((g) => !stays.has(g.ref)).sort((a, b) => b.words.length - a.words.length)[0];
    if (!giver) break;
    const list = lists(out, giver.slot).find((l) => l.includes(giver.ref));
    const at = list.indexOf(giver.ref);
    list.splice(at, 1);
    const before = scienceGivers(out).length;
    const clean = pool.find((s) => {
      if (s.slot !== giver.slot) return false;
      list.push(s);
      const bad = scienceGivers(out).length > before;
      list.pop();
      return !bad;
    });
    if (clean) {
      list.push(clean);
      pool = pool.filter((s) => s !== clean);
      dropped.push(row(giver));
    } else if (allItems(out).filter((q) => q.slot === giver.slot).length >= attemptOf(out, giver.slot)) {
      dropped.push(row(giver));
    } else {
      list.splice(at, 0, giver.ref);
      stays.add(giver.ref);
      kept.push(row(giver));
    }
  }
  return { examJson: out, dropped, kept };
}

/** Each giver as a give-away flag (`reason: 'giveaway'`, printed) a section re-ask reads; `with` names the slots it answers. */
function scienceGiverFlags(examJson) {
  return scienceGivers(examJson).map((g) => ({
    slot: g.slot, reason: 'giveaway', words: g.words, with: g.with, text: g.with.map(() => String(g.question).replace(/\s+/g, ' ').trim().slice(0, 70)), printed: true,
  }));
}

module.exports = { scienceGivers, dropScienceGivers, scienceGiverFlags };
