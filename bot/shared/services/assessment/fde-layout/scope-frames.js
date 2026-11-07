'use strict';
// Part of fde-layout.js (see its header); split for the 300-line limit, bd-5jmnfj.4.52.

// A type key reduced to letters and digits, singular: "MCQs", "MCQ" and
// "Multiple choice questions" all meet at "mcq".
const TYPE_ALIAS = {
  multiplechoice: 'mcq', multiplechoicequestion: 'mcq',
  shortquestion: 'shortquestion', shortanswer: 'shortquestion',
};

function typeKey(name) {
  const k = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/s$/, '');
  return TYPE_ALIAS[k] || k;
}

function slotKey(tag) {
  return String(tag || '').toLowerCase().replace(/\s+/g, '');
}

const UNIT_WORD = {
  maths: ['Units', 'ابواب'], science: ['Chapters', 'ابواب'], english: ['Units', 'یونٹ'], // ur: needs fluent-Urdu review
  urdu: ['Lessons', 'اسباق'], social_studies: ['Chapters', 'ابواب'], // ur: needs fluent-Urdu review
};
// One chapter in scope: "Unit 3", never "Units 3".
const UNIT_WORD_ONE = {
  maths: ['Unit', 'باب'], science: ['Chapter', 'باب'], english: ['Unit', 'یونٹ'], // ur: needs fluent-Urdu review
  urdu: ['Lesson', 'سبق'], social_studies: ['Chapter', 'باب'], // ur: needs fluent-Urdu review
};

/** The word the paper names its scope with ("Lessons" / «اسباق»), for a screen that must say the same. */
function unitWord(subjectKey, count) {
  const table = Number(count) === 1 ? UNIT_WORD_ONE : UNIT_WORD;
  const [en, ur] = table[subjectKey] || table.maths;
  return { en, ur };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// Every item the model wrote, whichever branch and type it landed under.
function walk(examJson) {
  const out = [];
  for (const branch of ['seen', 'unseen']) {
    const tree = examJson && examJson[branch];
    if (!tree || typeof tree !== 'object') continue;
    for (const [category, types] of Object.entries(tree)) {
      if (!types || typeof types !== 'object') continue;
      for (const [type, list] of Object.entries(types)) {
        if (!Array.isArray(list)) continue;
        list.forEach((q) => {
          if (q && typeof q === 'object' && !Array.isArray(q)) out.push({ category, type, q });
        });
      }
    }
  }
  return out;
}

/** "3, 4" → "3–4"; "3, 5, 6" → "3, 5–6". */
function runs(numbers) {
  const sorted = [...new Set(numbers.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < sorted.length; i += 1) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
    parts.push(i === j ? String(sorted[i]) : `${sorted[i]}–${sorted[j]}`);
    i = j;
  }
  return parts.join(', ');
}

// Every page a page list names ("1-12, 14–40"), or null if it does not parse.
function pageSet(list) {
  const pages = new Set();
  for (const part of String(list).split(',')) {
    const m = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (b < a || b - a > 1000) return null;
    for (let p = a; p <= b; p += 1) pages.add(p);
  }
  return pages;
}

// The units a page list covers when it is exactly whole units of the pattern, else null.
function unitsOfPages(P, list) {
  const unitRanges = (P.scope && P.scope.unit_ranges) || [];
  const want = pageSet(list);
  if (!unitRanges.length || !want || !want.size) return null;
  const units = [];
  const covered = new Set();
  for (const u of unitRanges) {
    const own = pageSet(u.ranges);
    if (!own || !own.size) continue;
    const inside = [...own].filter((p) => want.has(p)).length;
    if (inside === 0) continue;
    if (inside !== own.size) return null;
    units.push(Number(u.chapter));
    own.forEach((p) => covered.add(p));
  }
  if (!units.length || covered.size !== want.size) return null;
  return units.sort((a, b) => a - b);
}

function scopeBlock(P, scope) {
  const kind = scope && (scope.kind === 'chapters' || scope.kind === 'pages') ? scope.kind : 'fde';
  const chapters = kind === 'chapters' && Array.isArray(scope.chapters) ? scope.chapters.map(Number) : null;
  const pages = kind === 'pages' && scope.pages ? String(scope.pages) : null;
  let coversEn = null;
  let coversUr = null;
  if (chapters && chapters.length) {
    const one = new Set(chapters).size === 1;
    const [en, ur] = (one ? UNIT_WORD_ONE : UNIT_WORD)[P.key] || (one ? UNIT_WORD_ONE : UNIT_WORD).maths;
    coversEn = P.header.covers_partial_en.replace('{units}', `${en} ${runs(chapters)}`);
    coversUr = P.header.covers_partial_ur.replace('{units}', `${ur} ${runs(chapters)}`);
    if (one) {
      // The template's own "these units/chapters/lessons" / «انہی ابواب/اسباق» read as one too.
      coversEn = coversEn.replace(/\bthese (units|chapters|lessons)\b/, `this ${en.toLowerCase()}`);
      coversUr = coversUr.replace(/انہی (ابواب|اسباق)/, `اسی ${ur}`); // needs fluent-Urdu review
    }
  } else if (pages) {
    // A page list that is exactly whole units of the pattern names the units, not the pages.
    const units = unitsOfPages(P, pages);
    if (units) {
      const [en, ur] = (units.length === 1 ? UNIT_WORD_ONE : UNIT_WORD)[P.key] || (units.length === 1 ? UNIT_WORD_ONE : UNIT_WORD).maths;
      coversEn = P.header.covers_partial_en.replace('{units}', `${en} ${runs(units)}`);
      coversUr = P.header.covers_partial_ur.replace('{units}', `${ur} ${runs(units)}`);
    } else {
      coversEn = P.header.covers_partial_en.replace('{units}', `pp ${pages}`);
      coversUr = P.header.covers_partial_ur.replace('{units}', `ص ${pages}`);
    }
    // A page list is not units: the template's "these units/chapters/lessons" reads "these pages".
    coversEn = coversEn.replace(/\bthese (units|chapters|lessons)\b/, 'these pages');
    coversUr = coversUr.replace(/انہی (ابواب|اسباق)/, 'انہی صفحات'); // needs fluent-Urdu review
  }
  return {
    kind, chapters, pages,
    label_en: P.scope.label_en, label_ur: P.scope.label_ur,
    line_en: P.scope.line_en, line_ur: P.scope.line_ur,
    covers_en: coversEn, covers_ur: coversUr,
  };
}

function fill(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (m, k) => (values[k] === undefined ? m : String(values[k])));
}

function shortLabel(label) {
  return String(label || '').replace(/^Q\.\s?/, 'Q').replace(/^(Q\d+)\.\s*\(/, '$1 (').replace(/[.:]\s*$/, '').trim();
}

// One line per thing the teacher must bring: a frame to fill, the Naat page.
function pageOf(value) {
  const m = /^\s*(?:(?:book\s+)?(?:page|p\.?|pg\.?|ص|صفحہ)\s*)?(\d{1,3})\s*$/i.exec(value === null || value === undefined ? '' : String(value));
  const n = m ? Number(m[1]) : NaN;
  return n > 0 ? n : null;
}

function suppliesFor(P, bySlot) {
  const out = [];
  const S = P.supplies;
  for (const sec of P.sections) {
    for (const slot of sec.slots) {
      const placed = bySlot.get(slot.slot) || [];
      if (slot.alternatives) {
        const fixed = slot.alternatives.find((a) => a.kind === 'fixed');
        if (fixed) {
          const values = { slot: slot.label_ur, b: fixed.book_page };
          out.push({
            slot: slot.slot, kind: 'naat', book_page: fixed.book_page,
            line_en: fill(S.naat_en, { ...values, slot: shortLabel(slot.label_en) }),
            line_ur: fill(S.naat_ur, values),
          });
        }
      }
      if (!slot.frame || !placed.length) continue;
      const q = placed[0];
      // The page the item names ("168", 168, "Page 7", "p. 7"); one that does not read as a
      // page prints none, never the pattern's own example page.
      const book = pageOf(q.book_page);
      const name = String(q.question || '').trim();
      const frameEn = fill(slot.frame.supply_en, { q: name });
      const frameUr = fill(slot.frame.supply_ur, { q: name });
      const words = Array.isArray(q.words) ? q.words.map(String).filter(Boolean) : [];
      const tail = (template) => (words.length && slot.frame.word_bank ? fill(template, { words: words.join('، ') }) : '');
      const withPage = (template, values) => (book ? fill(template, values) : fill(template, values).replace(/ \((book p\.|کتاب ص) \{?b\}?\)| \((book p\.|کتاب ص) [^)]*\)/, ''));
      out.push({
        slot: slot.slot, kind: slot.frame.kind, book_page: book || null, scene: name || null, words,
        line_en: withPage(S.frame_en, { slot: shortLabel(slot.label_en), frame: frameEn, b: book }) + tail(S.words_en).replace(/، /g, ', '),
        line_ur: withPage(S.frame_ur, { slot: slot.label_ur, frame: frameUr, b: book }) + tail(S.words_ur),
      });
    }
  }
  return out;
}

// A frame carries the page its own item names, or none (bd-5jmnfj.4.51.10).
function withFramePages(sections, bySlot) {
  for (const sec of sections) {
    for (const slot of sec.slots) {
      const q = slot.frame && (bySlot.get(slot.slot) || [])[0];
      if (q) slot.frame.book_page = pageOf(q.book_page);
    }
  }
  return sections;
}

// ── Urdu Q6: the four lesson-7 lines ──────────────────────────────────────

const VERSES_NEEDED = 4;

// The lines of a piece of text, and how they were joined (to put a remainder back the same way).
function verseLines(text) {
  const s = typeof text === 'string' ? text.trim() : '';
  if (!s) return { lines: [], joiner: '\n' };
  const byLine = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (byLine.length > 1) return { lines: byLine, joiner: '\n' };
  // One line of text: verses run on, each ending in «۔», «؟» or «،».
  return { lines: s.split(/(?<=[۔؟،])\s+/).map((l) => l.trim()).filter(Boolean), joiner: ' ' };
}

/**
 * A seen-verses item prints `passage` and nothing else. A reply that put the
 * lines in `question` has them moved; one with no four lines anywhere cannot
 * be printed (the child would be asked to explain verses the paper does not
 * show) and is not placed, so the slot reports short. Returns false for that.
 */
function settleVerses(slot, q) {
  if (!Array.isArray(slot.alternatives) || !slot.alternatives.some((a) => a && a.kind === 'seen_verses')) return true;
  if (verseLines(q.passage).lines.length >= VERSES_NEEDED) return true;
  const { lines, joiner } = verseLines(q.question);
  if (lines.length < VERSES_NEEDED) return false;
  // The verses are the last four lines; anything above them is the instruction.
  const lead = lines.slice(0, lines.length - VERSES_NEEDED).join(joiner);
  q.passage = lines.slice(-VERSES_NEEDED).join('\n');
  q.question = lead || (typeof q.main_question === 'string' && q.main_question.trim() ? q.main_question : '');
  return true;
}

// ── MCQ keys spread over the letters ──────────────────────────────────────
//
// A model keys about half its MCQs on (b) and almost none on (d); a child who
// always ticks (b) passes the section. Each item's options are turned round
// (their order otherwise kept) so the keys spread evenly across the letters.
// The key keeps its text and its shape; only the letter changes.

const URDU_LETTERS = ['الف', 'ب', 'ج', 'د'];
const LATIN_KEY = /^(\s*\(?)([a-dA-D])(\)?(?:[.):\s]|$))/;
const URDU_KEY = /^(\s*\(?)(الف|ب|ج|د)(\s*[.):۔]|\)?\s*$)/;

module.exports = {
  LATIN_KEY, URDU_KEY, URDU_LETTERS, clone, fill, scopeBlock, settleVerses, slotKey, suppliesFor, typeKey,
  unitWord, verseLines, walk, withFramePages,
};
