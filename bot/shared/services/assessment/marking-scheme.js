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
 * Pure: deep-clones its input, never throws. A question it cannot make sense of
 * loses its scheme and leaves a log line; the paper itself never fails here,
 * except through `shortfall` (too few pick words), which the engine acts on.
 */

const BLOOMS = Object.freeze({
  remember: 'Remember', r: 'Remember',
  understand: 'Understand', u: 'Understand',
  apply: 'Apply', a: 'Apply',
});
const KINDS = new Set(['M', 'A', 'U', 'K', 'L']);

const POINT_TEXT_MAX = 160;
const ACCEPT_MAX = 6;
const ACCEPT_TEXT_MAX = 80;
const COMMON_ERROR_MAX = 160;
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
      if (!(slot.grain && slot.grain.unit_choice === true)) points = foldUnits(points);
      const aOnly = slot.shape === 'words' || (typeof questionText === 'string' && /expanded form/i.test(questionText));
      if (aOnly) points.forEach((p) => { if (p.kind === 'M') p.kind = 'A'; });
      points.forEach((p) => { p.text = capCodePoints(p.text, POINT_TEXT_MAX); });

      const sum = points.reduce((t, p) => t + p.marks, 0);
      const target = toNumber(marks);
      if (Number.isFinite(sum) && Number.isFinite(target) && Math.abs(sum - target) <= SUM_TOLERANCE) {
        s.points = points;
      } else {
        delete s.points;
        log.push(`${label}: points add to ${show(sum)}, marks ${show(marks)}; points dropped`);
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
      } else {
        kept.push(word);
      }
    }
    if (got) {
      if (key !== null && key !== kind) delete got[key];
      got[kind] = kept;
    }
    if (kept.length < needed) shortfall.push({ slot: slot.slot, kind, have: kept.length, need: needed });
  }
}

// Rule 5: each sub-question's scheme against its part's marks, then the picked words.
function normaliseComprehension(q, slot, label, log, shortfall) {
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
      if (isObject(sub) && 'scheme' in sub) {
        normaliseOne(sub, spec.marks_each, sub.question, slot, `${label} ${spec.key}[${k}]`, log);
      }
    });
  });

  const pickSpec = specs.find((sp) => isObject(sp.pick));
  if (pickSpec) checkPicks(q, parts, pickSpec, slot, label, log, shortfall);
}

function normaliseQuestion(q, slots, where, log, shortfall) {
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
  if (slot.shape === 'comprehension') normaliseComprehension(q, slot, label, log, shortfall);
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
 * can be put back). Returns { examJson, log, shortfall: [{ slot, kind, have, need }] }.
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
              normaliseQuestion(q, slots, where, log, shortfall);
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
  return { examJson: out, log, shortfall };
}

module.exports = { normaliseScheme, canonicalBlooms, capCodePoints };
