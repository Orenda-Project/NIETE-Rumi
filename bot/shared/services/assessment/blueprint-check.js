'use strict';
/**
 * The blueprint check (bd-5jmnfj.2): read a laid-out board-pattern paper back against its pattern
 * and the subject's table of specification. The prompt asks the model for the marks split by
 * thinking level; this is what says whether the paper it wrote carries it.
 *
 * A slot gives the paper min(attempt, live) × marks_each — the renderer's own count — so a choice
 * slot ("any 8 of 12") counts the marks a child answers, shared evenly across its live items. A
 * removed item counts nowhere. Pure: no model, no I/O.
 */
const { canonicalBlooms } = require('./marking-scheme');

const LEVELS = ['Remember', 'Understand', 'Apply'];
const TOLERANCE = 5; // percentage points either side of a level's target

/** slot id → the live items placed in it, from both branches of the tree. */
function liveBySlot(examJson, L) {
  const by = new Map();
  for (const sec of L.sections) for (const slot of sec.slots) by.set(slot.slot, []);
  for (const branch of ['seen', 'unseen']) {
    const tree = examJson[branch];
    if (!tree || typeof tree !== 'object') continue;
    for (const types of Object.values(tree)) {
      if (!types || typeof types !== 'object') continue;
      for (const list of Object.values(types)) {
        if (!Array.isArray(list)) continue;
        list.forEach((q) => {
          if (q && typeof q === 'object' && q.removed !== true && by.has(q.slot)) by.get(q.slot).push(q);
        });
      }
    }
  }
  return by;
}

/**
 * @param {object} examJson  a paper applyLayout has laid out (carries `_layout`)
 * @param {object} [opts]
 * @param {object} [opts.tos]  target % per level, e.g. { Remember: 10, Understand: 50, Apply: 40 }
 * @param {number} [opts.tolerance]  allowed miss in percentage points (default 5)
 * @returns {{ ok, total, expected, sections, levels, problems }}
 */
function checkBlueprint(examJson, { tos = null, tolerance = TOLERANCE } = {}) {
  const L = examJson && examJson._layout;
  if (!L || !Array.isArray(L.sections)) {
    const err = new Error('NO_LAYOUT: the blueprint check reads board-pattern papers only');
    err.code = 'NO_LAYOUT';
    throw err;
  }
  const live = liveBySlot(examJson, L);
  const problems = [];
  const levels = Object.fromEntries(LEVELS.map((band) => [band, { marks: 0, pct: 0 }]));

  const sections = L.sections.map((sec) => {
    let marks = 0;
    for (const slot of sec.slots) {
      const list = live.get(slot.slot);
      if (list.length < slot.attempt) {
        problems.push({ code: 'SLOT_SHORT', slot: slot.slot, live: list.length, attempt: slot.attempt });
      }
      const slotMarks = Math.min(slot.attempt, list.length) * slot.marks_each;
      marks += slotMarks;
      const each = list.length ? slotMarks / list.length : 0;
      let untagged = 0;
      list.forEach((q) => {
        const band = canonicalBlooms(q.blooms);
        if (band) levels[band].marks += each;
        else untagged += 1;
      });
      if (untagged) problems.push({ code: 'UNTAGGED', slot: slot.slot, count: untagged });
    }
    if (marks !== sec.marks) problems.push({ code: 'SECTION', section: sec.id, marks, expected: sec.marks });
    return { id: sec.id, marks, expected: sec.marks };
  });

  const total = sections.reduce((sum, s) => sum + s.marks, 0);
  if (total !== L.total_marks) problems.push({ code: 'TOTAL', total, expected: L.total_marks });

  for (const band of LEVELS) {
    levels[band].pct = total ? (levels[band].marks / total) * 100 : 0;
    if (!tos || typeof tos[band] !== 'number') continue;
    const off = levels[band].pct - tos[band];
    levels[band].target = tos[band];
    if (Math.abs(off) > tolerance + 1e-9) problems.push({ code: 'LEVEL', level: band, pct: levels[band].pct, target: tos[band], off });
  }

  return { ok: problems.length === 0, total, expected: L.total_marks, sections, levels, problems };
}

/** True when the paper's split by level misses its target (bd-5jmnfj.18: such a paper is written once more). */
function missesSplit(bp) {
  return Boolean(bp && bp.problems.some((p) => p.code === 'LEVEL'));
}

/** How far a paper sits from its target: the sum of each level's miss, in percentage points. */
function levelDistance(bp) {
  return LEVELS.reduce((sum, band) => {
    const l = bp.levels[band];
    return sum + (typeof l.target === 'number' ? Math.abs(l.pct - l.target) : 0);
  }, 0);
}

/** The note a second run is given: the first paper's split by marks, and the target. */
function levelNote(bp) {
  const split = (pick) => LEVELS.map((band) => `${band} ${pick(bp.levels[band])}%`).join(', ');
  return [
    `The paper written for this request came out at ${split((l) => Math.round(l.pct))} of the marks.`,
    `The board's split is ${split((l) => l.target)}. Write this section so the paper meets that split:`,
    'change which questions you ask, not just their tags. Tag every item with the level it truly tests.',
  ].join(' ');
}

module.exports = { checkBlueprint, missesSplit, levelDistance, levelNote, TOLERANCE };
