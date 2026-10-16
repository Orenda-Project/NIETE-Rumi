'use strict';
/**
 * Puts a model's board-pattern output into the pattern's shape.
 *
 * The model is told which slot each item belongs to and how many to write, and
 * mostly does it. This pass handles the rest without ever editing a question's
 * words: a slot tag written loosely, a renamed type ("MCQ"), an untagged item,
 * extra items (dropped and counted, never printed), and the model's own marks
 * (replaced by the pattern's). A slot that came back short is REPORTED, not
 * padded — the caller fails the paper, because a board rehearsal with a
 * missing question is not one.
 *
 * The result carries `_layout`: a copy of the subject's pattern as it stood at
 * generation time, so a later change to the pattern never changes a stored
 * paper, plus the scope, the teacher-supply lines and room for the page counts
 * and notes later stages write.
 *
 * Pure, no I/O.
 */

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

function scopeBlock(P, scope) {
  const kind = scope && (scope.kind === 'chapters' || scope.kind === 'pages') ? scope.kind : 'fde';
  const chapters = kind === 'chapters' && Array.isArray(scope.chapters) ? scope.chapters.map(Number) : null;
  const pages = kind === 'pages' && scope.pages ? String(scope.pages) : null;
  let coversEn = null;
  let coversUr = null;
  if (chapters && chapters.length) {
    const [en, ur] = UNIT_WORD[P.key] || UNIT_WORD.maths;
    coversEn = P.header.covers_partial_en.replace('{units}', `${en} ${runs(chapters)}`);
    coversUr = P.header.covers_partial_ur.replace('{units}', `${ur} ${runs(chapters)}`);
  } else if (pages) {
    coversEn = P.header.covers_partial_en.replace('{units}', `pp ${pages}`);
    coversUr = P.header.covers_partial_ur.replace('{units}', `ص ${pages}`);
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
      const book = Number.isFinite(Number(q.book_page)) && q.book_page !== null && q.book_page !== ''
        ? Number(q.book_page) : slot.frame.book_page;
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

/**
 * applyLayout(examJson, P, scope, { now }) → { examJson, placed, unplaced, shortfall }
 *
 * P is one subject of a pattern (patterns.get(id).subjects[key]); scope is
 * { kind: 'fde' | 'chapters' | 'pages', chapters, pages }. Never throws.
 */
function applyLayout(examJson, P, scope, opts = {}) {
  const src = examJson && typeof examJson === 'object' ? clone(examJson) : {};
  const slots = P.sections.flatMap((sec) => sec.slots);
  const byId = new Map(slots.map((slot) => [slotKey(slot.slot), slot]));
  const bySlot = new Map(slots.map((slot) => [slot.slot, []]));
  const room = (slot) => bySlot.get(slot.slot).length < slot.generate;
  let unplaced = 0;

  const all = walk(src);
  const untagged = [];
  // Tagged items first, so an untagged one cannot take a tagged one's place.
  for (const entry of all) {
    let slot = byId.get(slotKey(entry.q.slot));
    if (!slot && entry.q.slot) {
      const tail = `.${slotKey(entry.q.slot).split('.').slice(-2).join('.')}`;
      slot = slots.find((s) => slotKey(s.slot).endsWith(tail));
    }
    if (!slot) { untagged.push(entry); continue; }
    if (room(slot)) bySlot.get(slot.slot).push(entry.q);
    else unplaced += 1;
  }
  for (const entry of untagged) {
    const key = typeKey(entry.type);
    const slot = slots.find((s) => typeKey(s.type) === key && room(s));
    if (slot) bySlot.get(slot.slot).push(entry.q);
    else unplaced += 1;
  }

  // Marks, lines and the canonical tag come from the pattern, never the model.
  const unseen = {};
  const usedKeys = new Set();
  const shortfall = [];
  let placed = 0;
  for (const slot of slots) {
    const list = bySlot.get(slot.slot);
    list.forEach((q) => {
      q.slot = slot.slot;
      q.marks = slot.marks_each;
      q.lines = slot.lines;
      if (Array.isArray(slot.parts_spec) && Array.isArray(q.parts)) {
        q.parts.forEach((part) => {
          const spec = part && slot.parts_spec.find((s) => s.key === part.key);
          if (spec && Array.isArray(part.questions)) {
            part.questions.forEach((sub) => { if (sub && typeof sub === 'object') sub.marks = spec.marks_each; });
          }
        });
      }
    });
    placed += list.length;
    if (list.length < slot.generate) shortfall.push({ slot: slot.slot, missing: slot.generate - list.length });
    let key = slot.type;
    for (let n = 2; usedKeys.has(key); n += 1) key = `${slot.type} (${n})`;
    usedKeys.add(key);
    if (!unseen[slot.category]) unseen[slot.category] = {};
    unseen[slot.category][key] = list;
  }

  const out = {};
  for (const [k, v] of Object.entries(src)) if (k !== 'seen' && k !== 'unseen' && k !== '_layout') out[k] = v;
  out.unseen = unseen;
  out._layout = {
    v: 2,
    preset_id: opts.presetId || 'fde_g5_2027',
    subject: P.key,
    medium: P.medium,
    scope: scopeBlock(P, scope),
    header: clone(P.header),
    sections: clone(P.sections),
    legend: clone(P.legend),
    before_exam: clone(P.before_exam),
    supplies: suppliesFor(P, bySlot),
    total_marks: P.total_marks,
    total_time_en: P.total_time_en,
    total_time_ur: P.total_time_ur,
    unplaced,
    generated_at: opts.now || new Date().toISOString(),
    pages: null,
    frame_pages: null,
    notes: [],
  };
  return { examJson: out, placed, unplaced, shortfall };
}

module.exports = { applyLayout, typeKey, slotKey };
