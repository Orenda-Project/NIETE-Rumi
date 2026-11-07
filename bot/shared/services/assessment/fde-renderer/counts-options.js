'use strict';
// Part of assessment-paper-fde.renderer.js (see its header); split for the 300-line limit, bd-5jmnfj.37.
const Patterns = require('../patterns');
const TeacherSlot = require('../fde-teacher-slot'); // bd-5jmnfj.39.1: Islamiat Q3, written by the teacher
const WorkSpace = require('../fde-work-space');
const { equalPartsLine } = require('../fde-marks-line');
const { addOutOf, esc, slotTotal, substitute, textOf } = require('./fonts-digits');

/**
 * A slot's instruction and marks line for `present` items on the paper.
 * Unremoved, it is FDE's line exactly; after a removal only the count atoms
 * change, and a choice that still exists says how many it is now out of.
 */
function choiceLine(slot, present, lang, items) {
  present = TeacherSlot.counted(slot, present); // a teacher-filled slot (Islamiat Q3) holds what it must answer
  const live = Math.min(slot.attempt, present);
  const ctx = { w: live, n: live, t: live * slot.marks_each, g: present };
  const raw = slot[`instruction_${lang}`];
  let instruction = substitute(raw, ctx, lang);
  if (instruction && present < slot.generate && live < present && /\{w:/.test(raw)) {
    instruction = addOutOf(raw, ctx, lang, present);
  }
  // "the poem “{q}”": a one-item slot names its item, on the paper and in the scheme alike.
  if (instruction && /\{q\}/.test(raw) && Array.isArray(items) && items.length === 1) {
    instruction = instruction.replace('{q}', String(items[0].question || '').trim());
  }
  const marksLine = substitute(equalPartsLine(slot[`marks_line_${lang}`], slot, items), ctx, lang); // bd-5jmnfj.4.58.2
  const text = [instruction, marksLine].filter(Boolean).join(' ');
  return { instruction, marksLine, text };
}

// ── the paper's items, grouped by slot ─────────────────────────────────────

function layoutOf(examJson) {
  const L = examJson && examJson._layout;
  if (!L || typeof L !== 'object' || !Array.isArray(L.sections)) {
    const err = new Error('NO_LAYOUT: this renderer only prints board-pattern papers');
    err.code = 'NO_LAYOUT';
    throw err;
  }
  return L;
}

/** slot id → every item in tree order (removed ones flagged), and the live ones. */
function itemsBySlot(examJson, L) {
  const all = new Map();
  for (const sec of L.sections) for (const slot of sec.slots) all.set(slot.slot, []);
  for (const branch of ['seen', 'unseen']) {
    const tree = examJson[branch];
    if (!tree || typeof tree !== 'object') continue;
    for (const types of Object.values(tree)) {
      if (!types || typeof types !== 'object') continue;
      for (const list of Object.values(types)) {
        if (!Array.isArray(list)) continue;
        list.forEach((q) => {
          if (q && typeof q === 'object' && all.has(q.slot)) all.get(q.slot).push(q);
        });
      }
    }
  }
  const live = new Map();
  for (const [id, list] of all) live.set(id, list.filter((q) => q.removed !== true));
  return { all, live };
}

function assertCounts(L, all, opts) {
  if (opts && opts.allowShort) return;
  for (const sec of L.sections) {
    for (const slot of sec.slots) {
      if (TeacherSlot.counted(slot, all.get(slot.slot).length) < slot.attempt) {
        const err = new Error(`PATTERN_SHORT_SLOT: ${slot.slot} holds ${all.get(slot.slot).length} of the ${slot.attempt} it must answer`);
        err.code = 'PATTERN_SHORT_SLOT';
        throw err;
      }
    }
  }
}

function sectionTotal(sec, live) {
  return sec.slots.reduce((sum, slot) => sum + slotTotal(slot, TeacherSlot.counted(slot, live.get(slot.slot).length)), 0);
}

/** The paper's total: the pattern's, recomputed only when a removal took a slot below its count. */
function totalMarks(examJson) {
  const L = layoutOf(examJson);
  const { live } = itemsBySlot(examJson, L);
  const short = L.sections.some((sec) => sec.slots.some((slot) => TeacherSlot.counted(slot, live.get(slot.slot).length) < slot.attempt));
  if (!short) return L.total_marks;
  return L.sections.reduce((sum, sec) => sum + sectionTotal(sec, live), 0);
}

function sectionCtx(sec, live) {
  const n = sec.slots.reduce((s, slot) => s + Math.min(slot.attempt, TeacherSlot.counted(slot, live.get(slot.slot).length)), 0);
  const noteSlot = sec.note_slot ? sec.slots.find((s) => s.slot === sec.note_slot) : null;
  const w = noteSlot ? Math.min(noteSlot.attempt, live.get(noteSlot.slot).length) : n;
  return { w, n, t: sectionTotal(sec, live), g: n };
}

// ── numbering ──────────────────────────────────────────────────────────────

function roman(n) {
  const map = [[10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  let left = n;
  for (const [v, s] of map) while (left >= v) { out += s; left -= v; }
  return out;
}

const URDU_LETTERS = ['الف', 'ب', 'ج', 'د', 'ہ', 'و'];

function itemNumber(slot, i, lang) {
  const k = i + 1;
  const style = slot.numbering || 'none';
  const cont = /^continue:(\d+)$/.exec(style);
  if (cont) return lang === 'ur' ? `سوال نمبر ${Number(cont[1]) + i}` : `Q${Number(cont[1]) + i}.`;
  switch (style) {
    case 'roman': return `${roman(k)})`;
    case 'roman_dot': return `${roman(k)}.`;
    case 'arabic': return `${k}.`;
    case 'urdu': return `${k}۔`;
    case 'paren_roman': return `(${roman(k)})`;
    case 'alpha_paren': return lang === 'ur' ? `(${URDU_LETTERS[i] || k})` : `(${String.fromCharCode(97 + i)})`;
    default: return '';
  }
}

function optionLabel(style, i) {
  if (style === 'A') return `${String.fromCharCode(65 + i)})`;
  if (style === 'ur') return `(${URDU_LETTERS[i]})`;
  if (style === 'ur_paren') return `${URDU_LETTERS[i]})`;
  return `(${String.fromCharCode(97 + i)})`;
}

// A model sometimes writes its own "a) " / "(b)" / «الف)» in front of an option.
function bareOption(text) {
  return String(text ?? '')
    .replace(/^\s*\(?[a-dA-D]\)?[.):]\s+/, '')
    // One delimiter only: «الف) ۔ (ختمہ)» is the label «الف)» then the mark «۔» (bd-5jmnfj.4.58.2).
    .replace(/^\s*\(?(الف|ب|ج|د)\s*(?:\)|[.:۔])\s*/, '')
    .trim();
}

const codePoints = (s) => [...String(s || '')].length;

// ── paper blocks ───────────────────────────────────────────────────────────

function optionsBlock(q, slot, ctx) {
  const opts = (q.options || []).map(bareOption);
  const long = opts.some((o) => codePoints(o) > 14);
  const cells = opts.map((o, i) => `<span class="opt"><span class="ol">${esc(optionLabel(slot.option_labels, i))}</span> ${textOf(o, ctx)}</span>`);
  return `<div class="opts ${long ? 'two' : 'four'}">${cells.join('')}</div>`;
}

function tableBlock(table, ctx) {
  if (!table || !Array.isArray(table.headers) || !Array.isArray(table.rows)) return '';
  const head = `<tr>${table.headers.map((h) => `<th>${textOf(h, ctx)}</th>`).join('')}</tr>`;
  const rows = table.rows.map((r) => `<tr>${(Array.isArray(r) ? r : [r]).map((c) => `<td>${textOf(c, ctx)}</td>`).join('')}</tr>`).join('');
  return `<table class="data">${head}${rows}</table>`;
}

/*
 * Whether a slot's `words` are printed for the child (a word list to work
 * from) or are the key. The layout copies `print_words` from the pattern; a
 * paper laid out before the flag existed takes it from the pattern by slot id.
 * Default: never print.
 */
function patternSlot(id) {
  for (const pid of Patterns.list()) {
    for (const S of Object.values(Patterns.get(pid).subjects)) {
      for (const sec of S.sections) {
        const found = sec.slots.find((s) => s.slot === id);
        if (found) return found;
      }
    }
  }
  return null;
}

/** A slot's own boolean flag, else its pattern's: a paper laid out before the flag still prints right. */
function slotFlag(slot, name) {
  if (typeof slot[name] === 'boolean') return slot[name];
  const p = patternSlot(slot.slot);
  return Boolean(p && p[name] === true);
}

function workSpace(q, slot) {
  // A tool drawing (protractor, compass) or an item with a method mark needs room the slot's two ruled lines
  // do not give (G5 Maths Q1 (b), bd-5jmnfj.4.58.9.1).
  const boxed = !slotFlag(slot, 'answer_box');
  const need = boxed ? WorkSpace.workMm(q) : null;
  if (need && WorkSpace.asksToolDrawing(q)) return `<div class="work-square" style="height:${Math.max(need, (slot.work_mm && /^\s*draw\b/i.test(String(q.question || ''))) ? Math.max(45, slot.work_mm) : 0)}mm"></div>`;
  if (slot.work_mm && /^\s*draw\b/i.test(String(q.question || ''))) {
    // A drawing item gets a full-width drawing space, never a small square (G5 Maths Q1 (b) x, bd-5jmnfj.4.58.4).
    return `<div class="work-square" style="height:${Math.max(45, slot.work_mm)}mm"></div>`;
  }
  // A Grade 1-2 child writes in a box under every written item (bd-5jmnfj.4.8); circling needs none.
  if (slotFlag(slot, 'answer_box')) {
    if (Array.isArray(q.options) && q.options.length) return '';
    // "34 ☐ 43": the child writes the sign in the drawn square (bd-5jmnfj.4.20).
    if (/☐/.test(String(q.question || ''))) return '';
    // A plant to label carries its own blank lines (bd-5jmnfj.4.33).
    if (q.picture && q.picture.kind === 'plant') return '';
    // Fill in the blank: the child writes on the ___ (bd-5jmnfj.4.39). Only a one-line slot with no
    // working space: a Grade 3-4 "___ x 25 = 4,000" still gets its box (bd-5jmnfj.33.2).
    // A picture-only item prints no stem, so its blank is not on the page: it keeps its box (G1 English Q12).
    if ((slot.lines || 1) < 2 && !slot.work_mm && /_{3,}/.test(String(q.question || '')) && !slotFlag(slot, 'picture_only')) return '';
    // A sentence under a picture gets three lines (bd-5jmnfj.4.57, .4.58.2).
    const lines = slotFlag(slot, 'sentence_box') ? 3 : (slot.lines || 1);
    return `<div class="write-box" style="height:${12 + 8 * Math.max(0, lines - 1)}mm"></div>`;
  }
  if ((slot.lines || 0) >= 2) {
    const h = Math.max(16, slot.lines * 8, need || 0);
    return `<div class="work-box" style="height:${h}mm"></div>`;
  }
  // A method mark with no ruled lines still gets a working box (bd-5jmnfj.4.58.9.1).
  if (need) return `<div class="work-box" style="height:${need}mm"></div>`;
  return '';
}

function wordList(words, ctx, boxed) {
  if (!Array.isArray(words) || !words.length) return '';
  const sep = ctx.medium === 'ur' ? ' – ' : ',  ';
  return `<div class="${boxed ? 'word-box' : 'word-line'}">${words.map((w) => textOf(w, ctx)).join(esc(sep))}</div>`;
}

function printsWords(slot) {
  return slotFlag(slot, 'print_words');
}

/*
 * The same opt-in for `topics`: printed only on a slot whose pattern names it
 * as a field in its prompt rule (English Q8). A `table` or `passage` always
 * prints: any data item may carry one, and an item without its data cannot be
 * answered.
 */
function printsField(slot, key) {
  const rule = typeof slot.prompt_rule === 'string' ? slot.prompt_rule : ((patternSlot(slot.slot) || {}).prompt_rule || '');
  return rule.includes(`\`${key}\``) && !rule.includes(`no \`${key}\``);
}

module.exports = {
  URDU_LETTERS, assertCounts, bareOption, choiceLine, codePoints, itemNumber, itemsBySlot, layoutOf,
  optionsBlock, printsField, printsWords, sectionCtx, sectionTotal, slotFlag, tableBlock, totalMarks,
  wordList, workSpace,
};
