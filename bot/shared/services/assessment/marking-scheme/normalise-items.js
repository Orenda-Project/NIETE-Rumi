'use strict';
// Part of marking-scheme.js (see its header); split for the 300-line limit, bd-5jmnfj.37.
const { dropContradictedAccepts, tidyAccepts } = require('../scheme-accept-check');
const { namesPrintedLetter } = require('../fde-printed-letter-note');
const { splitIdeaPoints } = require('../fde-science-r2'); // v37 round 7: a filled Science Q2 (b) row, one point per idea
const { ACCEPT_MAX, ACCEPT_TEXT_MAX, COMMON_ERROR_MAX, IDEA_MAX, IDEA_SPLIT, POINT_TEXT_MAX, SUM_TOLERANCE, UNIT_IN_STEM, answerOf, capCodePoints, fillPoints, foldUnits, hasPoints, isObject, kindOf, partMarks, partOfAnswer, roundMarks, show, splitIdeas, splitsInto, textOf, toNumber } = require('./basics');

/** Rule 4 on one holder of a `scheme` (a question or a comprehension sub-question). */
function normaliseOne(holder, marks, questionText, slot, label, log) {
  const s = holder.scheme;
  if (!isObject(s)) {
    delete holder.scheme;
    log.push(`${label}: scheme is not an object, dropped`);
    return;
  }

  if ('points' in s) {
    if (!Array.isArray(s.points)) {
      delete s.points;
      log.push(`${label}: points are not a list, dropped`);
    } else {
      let points = s.points.map((p) => (isObject(p)
        ? { text: textOf(p.text), marks: roundMarks(p.marks, marks), kind: kindOf(p.kind) }
        : { text: '', marks: NaN, kind: 'K' }));
      // The child chooses a unit only when the stem gives its lengths in one (bd-5jmnfj.4.55).
      const unitChoice = slot.grain && slot.grain.unit_choice === true && UNIT_IN_STEM.test(String(questionText || ''));
      if (!unitChoice) points = foldUnits(points);
      const aOnly = slot.shape === 'words' || (typeof questionText === 'string' && /expanded form/i.test(questionText));
      if (aOnly) points.forEach((p) => { if (p.kind === 'M') p.kind = 'A'; });
      points.forEach((p) => { p.text = capCodePoints(p.text, POINT_TEXT_MAX); });

      const sum = points.reduce((t, p) => t + p.marks, 0);
      const target = toNumber(marks);
      const each = partMarks(slot, target);
      if (!(Number.isFinite(sum) && Number.isFinite(target) && Math.abs(sum - target) <= SUM_TOLERANCE)) {
        delete s.points;
        log.push(`${label}: points add to ${show(sum)}, marks ${show(marks)}; points dropped`);
      } else if (each && !splitsInto(points.map((p) => p.marks), each.n, each.marks)) {
        // The parts print their own chips; a parent split that cannot be shared out over them is wrong.
        delete s.points;
        log.push(`${label}: points ${show(points.map((p) => p.marks))} do not split into ${each.n} × ${show(each.marks)}; points dropped`);
      } else {
        s.points = IDEA_SPLIT.has(slot.slot) ? splitIdeas(points) : points;
        if (IDEA_SPLIT.has(slot.slot) && s.points.length === 1 && s.points[0].marks > IDEA_MAX) {
          delete s.points;
          log.push(`${label}: one point of ${show(marks)} with one idea; points dropped`);
        }
      }
    }
  }

  if ('accept' in s) {
    let list = null;
    if (typeof s.accept === 'string') list = [s.accept];
    else if (Array.isArray(s.accept)) list = s.accept;
    if (!list) {
      delete s.accept;
      log.push(`${label}: accept is not a list, dropped`);
    } else {
      const kept = list
        .filter((a) => typeof a === 'string' || typeof a === 'number')
        .map((a) => String(a).trim())
        .filter(Boolean);
      if (kept.length > ACCEPT_MAX) log.push(`${label}: accept cut from ${kept.length} to ${ACCEPT_MAX}`);
      s.accept = kept.slice(0, ACCEPT_MAX).map((a) => capCodePoints(a, ACCEPT_TEXT_MAX));
    }
  }

  if ('common_error' in s) {
    if (typeof s.common_error === 'string') {
      s.common_error = capCodePoints(s.common_error, COMMON_ERROR_MAX);
    } else {
      delete s.common_error;
      log.push(`${label}: common_error is not a string, dropped`);
    }
  }

  // A note naming a letter the stem prints is wrong for this item: held back (bd-5jmnfj.4.58.2).
  if (typeof s.common_error === 'string' && namesPrintedLetter(holder.question, s.common_error)) {
    log.push(`${label}: common_error names a printed letter, dropped`);
    delete s.common_error;
  }
  // An alternative the common error names is that error (bd-5jmnfj.4.50.10).
  if (Array.isArray(s.accept) && typeof s.common_error === 'string') {
    const { accept, dropped } = dropContradictedAccepts(s.accept, holder.answer, s.common_error);
    s.accept = accept;
    if (dropped.length) log.push(`${label}: accept ${show(dropped)} is the common error, dropped`);
  }
  // Duplicates, a base verb under an -ing question, a greeting's usual alternatives (bd-5jmnfj.4.51.4).
  if (Array.isArray(s.accept)) s.accept = tidyAccepts(s.accept, holder, slot);

  // Only mathsCheck may say a key was checked; whatever the model wrote is reset.
  s.checked = null;
}

// The pick-word check for one comprehension (rule 5).
function checkPicks(q, parts, pickSpec, slot, label, log, shortfall) {
  const need = pickSpec.pick;
  const part = parts.find((p) => isObject(p) && p.key === 'pick')
    || parts.find((p) => isObject(p) && isObject(p.pick));
  const passage = typeof q.passage === 'string' ? q.passage : '';
  if (!passage) log.push(`${label}: no passage to check picked words against`);
  if (part && !isObject(part.pick)) log.push(`${label}: pick is not an object`);
  const got = part && isObject(part.pick) ? part.pick : null;

  for (const [kind, needed] of Object.entries(need)) {
    let key = null;
    if (got) {
      key = Object.prototype.hasOwnProperty.call(got, kind) ? kind
        : Object.keys(got).find((k) => k.trim().toLowerCase() === kind.toLowerCase()) || null;
    }
    let words = key === null ? [] : got[key];
    if (key !== null && !Array.isArray(words)) {
      log.push(`${label}: pick ${kind} is not a list`);
      words = [];
    }
    const kept = [];
    for (const w of words) {
      const word = typeof w === 'string' ? w.trim() : '';
      if (!word) {
        log.push(`${label}: pick ${kind} ${show(w)} is empty, dropped`);
      } else if (!passage.includes(word)) {
        log.push(`${label}: pick ${kind} "${word}" is not in the passage, dropped`);
      } else if (kept.includes(word)) {
        log.push(`${label}: pick ${kind} "${word}" listed twice, kept once`);
      } else if (kept.length < needed) {
        kept.push(word);
      }
      // A valid word past the number needed is a spare: dropped without a log line.
    }
    if (got) {
      if (key !== null && key !== kind) delete got[key];
      got[kind] = kept;
    }
    if (kept.length < needed) shortfall.push({ slot: slot.slot, kind, have: kept.length, need: needed });
  }
}

// Rule 5: each sub-question's scheme against its part's marks, then the picked words. A
// sub-question the scheme prints as its own row (not a pick or antonym part, which print their
// own chips) left with no points (the model wrote the passage's scheme as lump rows on the item)
// gets one A point of its part marks on its own answer, listed with the rows code filled. Urdu
// only: the English papers are live and their comprehension questions carry their own points.
const PART_FILL = new Set(['urdu']);
function normaliseComprehension(q, slot, label, log, shortfall, ctx) {
  const specs = Array.isArray(slot.parts_spec) ? slot.parts_spec.filter(isObject) : [];
  if (!Array.isArray(q.parts)) log.push(`${label}: parts is not a list`);
  const parts = Array.isArray(q.parts) ? q.parts : [];

  parts.forEach((part, j) => {
    if (!isObject(part)) return;
    const spec = part.key === undefined ? specs[j] : specs.find((sp) => sp.key === part.key);
    if (!spec) {
      log.push(`${label}: part ${show(part.key)} is not in the pattern, left as is`);
      return;
    }
    if (!Array.isArray(part.questions)) return;
    part.questions.forEach((sub, k) => {
      if (!isObject(sub)) return;
      if ('scheme' in sub) normaliseOne(sub, spec.marks_each, sub.question, slot, `${label} ${spec.key}[${k}]`, log);
      const each = toNumber(spec.marks_each);
      const answer = answerOf(sub.answer);
      const ownRow = PART_FILL.has(slot.slot.split('.')[0]) && !isObject(spec.pick) && spec.key !== 'antonyms';
      if (ownRow && !hasPoints(sub) && answer && each > 0) {
        fillPoints(sub, each, answer);
        ctx.filled.push({ slot: slot.slot, item: ctx.item, part: `${spec.key}[${k}]`, filled_by: 'code' });
        log.push(`${label} ${spec.key}[${k}]: no points; one A point of ${show(each)} written on the answer`);
      }
    });
  });

  const pickSpec = specs.find((sp) => isObject(sp.pick));
  if (pickSpec) checkPicks(q, parts, pickSpec, slot, label, log, shortfall);
}

// One Science Q2(b) part's points, scaled to the part marks, then rule 4.
function normaliseSituationPoints(sub, each, slot, where, log) {
  const given = sub.scheme.points.filter((pt) => isObject(pt) && toNumber(pt.marks) > 0);
  if (given.length) {
    const total = given.reduce((t, pt) => t + toNumber(pt.marks), 0);
    if (Math.abs(total - each) > SUM_TOLERANCE) {
      const scaled = given.map((pt) => Math.max(0.5, Math.round((toNumber(pt.marks) * each / total) * 2) / 2));
      // Half marks may not add up exactly: the largest point takes the difference.
      const big = scaled.indexOf(Math.max(...scaled));
      scaled[big] += each - scaled.reduce((t, m) => t + m, 0);
      if (scaled.every((m) => m > 0)) {
        given.forEach((pt, i) => { pt.marks = scaled[i]; });
        log.push(`${where}: points add to ${show(total)}, scaled to ${show(each)}`);
      }
    }
    sub.scheme.points = given;
  }
  normaliseOne(sub, each, sub.question, slot, where, log);
}

/*
 * Science Q2(b): each sub-question is marked out of the slot's part marks (2.5).
 * Points that add to something else are scaled to it in half marks (kinds and text
 * kept). A sub-question with no points is given one A point on its answer (its own,
 * or its letter in the situation's answer); with no answer either, the slot is short.
 * A sub-question's own marks number is removed, whatever the model wrote.
 */
function normaliseSituationParts(q, slot, label, log, ctx) {
  const each = toNumber(slot.item_parts && slot.item_parts.marks_each);
  if (!(each > 0) || !Array.isArray(q.questions)) return;
  q.questions.forEach((given, k) => {
    // A part the model wrote as a bare string is the same question: it becomes an object
    // so it can carry its points (the paper prints either shape the same way).
    const sub = typeof given === 'string' ? { question: given } : given;
    if (!isObject(sub)) return;
    if (sub !== given) q.questions[k] = sub;
    const where = `${label} part ${String.fromCharCode(97 + k)}`;
    // Marks come from the pattern, never the model: a sub-question's own number is
    // removed, so its row prints the part marks (2.5) and the item still counts as its
    // slot's 5 wherever marks are summed (two of three parts are attempted, not three).
    if (sub.marks !== undefined) {
      log.push(`${where}: marks ${show(sub.marks)} removed; the part is worth ${show(each)}`);
      delete sub.marks;
    }
    if (isObject(sub.scheme) && Array.isArray(sub.scheme.points)) normaliseSituationPoints(sub, each, slot, where, log);
    if (hasPoints(sub)) return;
    const part = String.fromCharCode(97 + k);
    const own = answerOf(sub.answer) || partOfAnswer(q.answer, k);
    if (own) {
      fillPoints(sub, each, own);
      if (/^science\./.test(slot.slot)) sub.scheme.points = splitIdeaPoints(own, each); // per-idea points, so partial credit is possible
      ctx.filled.push({ slot: slot.slot, item: ctx.item, part, filled_by: 'code' });
      log.push(`${where}: no points; ${sub.scheme.points.length} A point(s) of ${show(each)} written on the answer`);
    } else if (q.removed !== true) {
      // A situation answer with no letters cannot say which part it answers: still short.
      ctx.shortfall.push({ slot: slot.slot, kind: 'answer', item: ctx.item, part, have: 0, need: 1 });
      log.push(`${where}: no points and no answer; the slot is short`);
    }
  });
}

module.exports = {
  normaliseComprehension, normaliseOne, normaliseSituationParts,
};
