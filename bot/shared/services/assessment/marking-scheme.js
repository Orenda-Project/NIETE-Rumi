'use strict';
/**
 * The marking scheme a model writes, made safe to print.
 *
 * The generator asks for a scheme on every written item: points that add to the
 * item's marks, accepted alternatives, the common error. Models get the sums
 * wrong, invent kinds, put a paragraph in a chip and attach schemes to MCQs.
 * `normaliseScheme` checks each question against the pattern slot it was set
 * for and keeps only what a teacher can mark with: a split that does not add up
 * is dropped (the answer still prints), every cap counts code points, and the
 * words a comprehension asks the child to pick must really be in its passage.
 *
 * A written row left with no points would print only what it is worth (a bare
 * «2.5» chip, nothing to mark against): it gets one Accuracy point worth the
 * row's marks, carrying its answer, and is listed in `_layout.scheme_shortfall`
 * so the before-the-exam box can say how many rows code filled.
 *
 * Pure: deep-clones its input, never throws. A question it cannot make sense of
 * loses its scheme and leaves a log line; the paper itself never fails here,
 * except through `shortfall` (too few pick words, a part with no answer), which
 * the engine acts on.
 */

const { dropContradictedAccepts, tidyAccepts } = require('./scheme-accept-check');

const BLOOMS = Object.freeze({
  remember: 'Remember', r: 'Remember',
  understand: 'Understand', u: 'Understand',
  apply: 'Apply', a: 'Apply',
});
const KINDS = new Set(['M', 'A', 'U', 'K', 'L']);

// A cut marking line is a wrong instruction, so the caps only stop a runaway:
// recorded scheme lines run to ~210 code points (accept), ~175 (point, error).
const POINT_TEXT_MAX = 240;
const ACCEPT_MAX = 6;
const ACCEPT_TEXT_MAX = 240;
const COMMON_ERROR_MAX = 240;
const SUM_TOLERANCE = 1e-9;

const TREES = ['unseen', 'seen'];
const CATEGORIES = ['objective', 'subjective'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// A value for a log line; never throws (BigInt, cycles).
function show(v) {
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
  } catch (err) {
    return typeof v;
  }
}

function clone(v) {
  try {
    return structuredClone(v);
  } catch (err) {
    return JSON.parse(JSON.stringify(v));
  }
}

/** A string cut to `n` code points, ending with "…" when cut. Astral characters count once. */
function capCodePoints(str, n) {
  if (str === null || str === undefined) return '';
  const s = String(str);
  const cps = [...s];
  if (cps.length <= n) return s;
  if (n <= 0) return '';
  return `${cps.slice(0, n - 1).join('').trimEnd()}…`;
}

/** 'Remember' | 'Understand' | 'Apply' for R/U/A in any case, else null. */
function canonicalBlooms(value) {
  if (typeof value !== 'string') return null;
  const k = value.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(BLOOMS, k) ? BLOOMS[k] : null;
}

// A number, or a numeric string; anything else is NaN (so the sum check fails).
function toNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  return NaN;
}

// Halves, or quarters when the item itself is worth a quarter (Urdu Q4 is 1.25 a part).
function roundMarks(v, itemMarks) {
  const steps = Number.isInteger(Number(itemMarks) * 2) ? 2 : 4;
  return Math.round(toNumber(v) * steps) / steps;
}

function kindOf(k) {
  const kind = typeof k === 'string' ? k.trim().toUpperCase() : '';
  return KINDS.has(kind) ? kind : 'K';
}

function textOf(t) {
  if (typeof t === 'string') return t;
  if (typeof t === 'number') return String(t);
  return '';
}

// "327,750" + "Rs." → "327,750 (Rs.)": the unit reads as part of the answer.
function joinText(a, b) {
  if (!a) return b || '';
  return b ? `${a} (${b})` : a;
}

// A length written with its unit in the stem: "a base of 12 cm", "15 m long", "in metres".
const UNIT_IN_STEM = /\b\d[\d,.]*\s*(?:mm|cm|m|km)\b|\b(?:millimet|centimet|met|kilomet)(?:re|er)s?\b/i;

/**
 * Units the child does not choose are part of the answer: every U merges into
 * the last A (marks added, text joined). With no A, the first U becomes it.
 */
function foldUnits(points) {
  let target = -1;
  for (let i = points.length - 1; i >= 0; i -= 1) {
    if (points[i].kind === 'A') { target = i; break; }
  }
  if (target === -1) {
    target = points.findIndex((p) => p.kind === 'U');
    if (target === -1) return points;
    points[target].kind = 'A';
  }
  const out = [];
  points.forEach((p, i) => {
    if (p.kind !== 'U' || i === target) { out.push(p); return; }
    points[target].text = joinText(points[target].text, p.text);
    points[target].marks += p.marks;
  });
  return out;
}

/**
 * A slot whose items are answered in parts (Science Q2(b): two of three, 2.5
 * each): { n, marks } for the parts one item is marked on, else null.
 */
function partMarks(slot, itemMarks) {
  const ip = slot && isObject(slot.item_parts) ? slot.item_parts : null;
  const each = ip ? toNumber(ip.marks_each) : NaN;
  if (!(each > 0) || !Number.isFinite(itemMarks)) return null;
  const n = Math.round(itemMarks / each);
  return n >= 1 && Math.abs(n * each - itemMarks) <= SUM_TOLERANCE ? { n, marks: each } : null;
}

// Whether `values` can be shared out into `n` groups that each add to `target`.
function splitsInto(values, n, target) {
  const sorted = [...values].sort((a, b) => b - a);
  const groups = new Array(n).fill(0);
  const place = (i) => {
    if (i === sorted.length) return groups.every((g) => Math.abs(g - target) <= SUM_TOLERANCE);
    const tried = new Set();
    for (let g = 0; g < n; g += 1) {
      if (tried.has(groups[g]) || groups[g] + sorted[i] > target + SUM_TOLERANCE) continue;
      tried.add(groups[g]);
      groups[g] += sorted[i];
      if (place(i + 1)) return true;
      groups[g] -= sorted[i];
    }
    return false;
  };
  return sorted.every((v) => v > 0) && place(0);
}

// An answer a row can print: a non-empty string or a number, else null.
function answerOf(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/*
 * The text after letter k («a) …», «(b) …») in a situation's own answer, up to the
 * next letter; null when it carries no such letter. The same split the renderer
 * makes (assessment-paper-fde.renderer.js partOfAnswer), so the filled point and
 * the printed answer are the same words.
 */
function partOfAnswer(answer, k) {
  const text = String(answer ?? '');
  const re = /(^|[\s;.])\(?([a-cA-C])\)\s*/g;
  const marks = [];
  let m;
  while ((m = re.exec(text))) marks.push({ letter: m[2].toLowerCase(), start: m.index + m[1].length, body: m.index + m[0].length });
  const at = marks.findIndex((x) => x.letter === String.fromCharCode(97 + k));
  if (at < 0) return null;
  const end = at + 1 < marks.length ? marks[at + 1].start : text.length;
  return text.slice(marks[at].body, end).trim() || null;
}

const hasPoints = (holder) => isObject(holder.scheme) && Array.isArray(holder.scheme.points) && holder.scheme.points.length > 0;

// One Accuracy point worth the row's marks, on the row's answer. What else the model wrote is kept.
function fillPoints(holder, marks, answer) {
  if (!isObject(holder.scheme)) holder.scheme = { checked: null };
  holder.scheme.points = [{ kind: 'A', marks, text: capCodePoints(answer, POINT_TEXT_MAX) }];
}

// A meaning written over several lines of verse marks one idea per sentence: one A point of the
// row's whole marks would let a teacher give all or nothing. The answer is cut at each sentence
// end, sentences past one per mark are joined to the last point, and the marks are shared out in
// halves (the first points take the odd half). One sentence is one point, as before. Urdu Q6 (ب)
// only: the live subjects' rows keep their one point.
const SENTENCE_FILL = new Set(['urdu.C.Q6']);
function fillSentences(holder, marks, answer) {
  const sentences = answer.split(/(?<=[۔؟!?])\s+/u).map((s) => s.trim()).filter(Boolean);
  const n = Math.min(sentences.length, Math.floor(marks), Math.floor(marks * 2));
  if (n < 2) return fillPoints(holder, marks, answer);
  const texts = sentences.slice(0, n - 1).concat(sentences.slice(n - 1).join(' '));
  // The halves left over are fewer than the points (base is marks / n rounded down to a half).
  const base = Math.floor((marks / n) * 2) / 2;
  const odd = Math.round((marks - base * n) * 2);
  if (!isObject(holder.scheme)) holder.scheme = { checked: null };
  holder.scheme.points = texts.map((text, i) => ({ kind: 'A', marks: base + (i < odd ? 0.5 : 0), text: capCodePoints(text, POINT_TEXT_MAX) }));
}

// A meaning point above 2 marks that joins several ideas («… فائدے کا ذکر (صاف پانی سے بچاؤ اور
// خوشی کا ذکر)», A4) lets a teacher give all or nothing for them. It is cut at its brackets and
// commas into one point per idea, at most one per half mark, the marks shared out in halves as
// above. A point with one idea stays as written, except a lone point of the whole row: that is the
// lump again, so it is dropped and the row is written on the answer's sentences (fillSentences).
// Urdu Q6 (ب) only, whoever wrote the points.
const IDEA_SPLIT = new Set(['urdu.C.Q6']);
const IDEA_MAX = 2;
function splitIdeas(points) {
  return points.flatMap((p) => {
    if (!(p.marks > IDEA_MAX)) return [p];
    const ideas = p.text.split(/[()（）،,؛;]+/u).map((t) => t.trim()).filter(Boolean);
    const n = Math.min(ideas.length, Math.floor(p.marks * 2));
    if (n < 2) return [p];
    const texts = ideas.slice(0, n - 1).concat(ideas.slice(n - 1).join('، '));
    const base = Math.floor((p.marks / n) * 2) / 2;
    const odd = Math.round((p.marks - base * n) * 2);
    return texts.map((text, i) => ({ text, marks: base + (i < odd ? 0.5 : 0), kind: p.kind }));
  });
}

// Rows marked by criteria, or by their own sub-rows, never print the bare chip.
function fillsWhole(slot) {
  return !['comprehension', 'situation', 'composition'].includes(slot.shape)
    && !(slot.shape === 'frame' && isObject(slot.frame) && slot.frame.kind === 'picture');
}

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
      ctx.filled.push({ slot: slot.slot, item: ctx.item, part, filled_by: 'code' });
      log.push(`${where}: no points; one A point of ${show(each)} written on the answer`);
    } else if (q.removed !== true) {
      // A situation answer with no letters cannot say which part it answers: still short.
      ctx.shortfall.push({ slot: slot.slot, kind: 'answer', item: ctx.item, part, have: 0, need: 1 });
      log.push(`${where}: no points and no answer; the slot is short`);
    }
  });
}

function normaliseQuestion(q, slots, where, log, shortfall, ctx) {
  if (!isObject(q)) {
    log.push(`${where}: not a question, skipped`);
    return;
  }
  const slot = typeof q.slot === 'string' ? slots.get(q.slot.trim()) : undefined;
  if (!slot) {
    log.push(`${where}: unknown slot ${show(q.slot)}, left as is`);
    return;
  }
  const label = `${slot.slot} ${where}`;

  const objective = slot.category === 'objective' || slot.shape === 'mcq';
  if (objective && 'scheme' in q) {
    delete q.scheme;
    log.push(`${label}: scheme dropped on an objective item`);
  }

  const blooms = canonicalBlooms(q.blooms);
  if (!blooms) log.push(`${label}: blooms ${show(q.blooms)} set to Understand`);
  q.blooms = blooms || 'Understand';

  if (objective) return;
  if ('scheme' in q) normaliseOne(q, q.marks, q.question, slot, label, log);
  if (slot.shape === 'comprehension') normaliseComprehension(q, slot, label, log, shortfall, ctx);
  if (slot.shape === 'situation') normaliseSituationParts(q, slot, label, log, { ...ctx, shortfall });

  // The marks the row prints (the renderer's own fallback), on its answer.
  const marks = Number(q.marks) || toNumber(slot.marks_each);
  const answer = answerOf(q.answer);
  if (fillsWhole(slot) && !hasPoints(q) && answer && Number.isFinite(marks) && marks > 0) {
    (SENTENCE_FILL.has(slot.slot) ? fillSentences : fillPoints)(q, marks, answer);
    ctx.filled.push({ slot: slot.slot, item: ctx.item, part: null, filled_by: 'code' });
    const n = q.scheme.points.length;
    log.push(`${label}: no points; ${n > 1 ? `${n} A points of ${show(marks)} written on its sentences` : `one A point of ${show(marks)} written on the answer`}`);
  }
}

function slotIndex(layout) {
  const slots = new Map();
  if (!isObject(layout) || !Array.isArray(layout.sections)) return slots;
  for (const sec of layout.sections) {
    if (!isObject(sec) || !Array.isArray(sec.slots)) continue;
    for (const slot of sec.slots) {
      if (isObject(slot) && typeof slot.slot === 'string') slots.set(slot.slot, slot);
    }
  }
  return slots;
}

/**
 * Check every question's scheme against its slot (removed questions too: they
 * can be put back). Returns { examJson, log, shortfall: [{ slot, kind, have, need }] };
 * rows code filled are listed in `examJson._layout.scheme_shortfall` as
 * [{ slot, item, part, filled_by: 'code' }], a key that is absent when none was.
 */
function normaliseScheme(examJson) {
  const log = [];
  const shortfall = [];
  let out;
  try {
    out = clone(examJson);
  } catch (err) {
    log.push(`paper could not be copied (${err.message}), left as is`);
    return { examJson, log, shortfall };
  }
  if (!isObject(out)) {
    log.push('not a paper, left as is');
    return { examJson: out, log, shortfall };
  }

  // Rows filled on an earlier pass have points now; their entries are kept.
  const filled = isObject(out._layout) && Array.isArray(out._layout.scheme_shortfall) ? out._layout.scheme_shortfall : [];
  try {
    const slots = slotIndex(out._layout);
    for (const tree of TREES) {
      if (!isObject(out[tree])) continue;
      for (const category of CATEGORIES) {
        const types = out[tree][category];
        if (!isObject(types)) continue;
        for (const [type, list] of Object.entries(types)) {
          if (!Array.isArray(list)) continue;
          list.forEach((q, i) => {
            const where = `${tree}.${category}.${type}[${i}]`;
            try {
              normaliseQuestion(q, slots, where, log, shortfall, { filled, item: i });
            } catch (err) {
              if (isObject(q)) delete q.scheme;
              log.push(`${where}: ${err.message}; scheme dropped`);
            }
          });
        }
      }
    }
  } catch (err) {
    log.push(`normaliseScheme stopped early: ${err.message}`);
  }
  if (isObject(out._layout)) {
    const seen = new Set();
    const rows = filled.filter((f) => {
      const key = isObject(f) ? `${f.slot}|${f.item}|${f.part}` : '';
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (rows.length) out._layout.scheme_shortfall = rows;
    else delete out._layout.scheme_shortfall;
  }
  return { examJson: out, log, shortfall };
}

module.exports = { normaliseScheme, canonicalBlooms, capCodePoints };
