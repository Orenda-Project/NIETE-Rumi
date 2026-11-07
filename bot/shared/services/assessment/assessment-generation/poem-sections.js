'use strict';
// Part of assessment-generation.service.js (see its header); split for the 300-line limit, bd-5jmnfj.37.
const Patterns = require('../patterns');
const { applyLayout, takenNote, firstAskNote, verseLines, scopeLessons, oneStory, STORY_ITEMS } = require('../fde-layout');
const { logToFile } = require('../../../utils/logger');
const { BookContent } = require('./answers-generate');
const { _walkQuestions } = require('./marks-answers');
const { POEM_SLOT, _splitPages } = require('./pattern-prompt');

/**
 * English Q5 / Urdu Q6 on chosen pages: the book poem nearest those pages when none of them holds one,
 * or null (the FDE syllabus, another subject, a page list that cannot be read, or a poem page already
 * chosen). A poem in a held lesson is never given.
 */
function patternPoemFor({ P, scope, pageContent }) {
  if (!P || !Array.isArray(P.poems) || !P.poems.length || !scope || scope.kind === 'fde') return null;
  const slot = POEM_SLOT[P.key];
  if (!slot || !P.sections.some((sec) => sec.slots.some((s) => s.slot === slot))) return null;
  const held = (P.scope && Array.isArray(P.scope.held)) ? P.scope.held : [];
  const poems = P.poems.filter((poem) => !held.includes(poem.unit));
  if (!poems.length) return null;
  const chosen = (_splitPages(pageContent) || []).map((p) => p.page);
  if (!chosen.length) return null;
  const pagesOf = (poem) => Patterns.parseRanges(poem.pages).flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i));
  if (poems.some((poem) => pagesOf(poem).some((n) => chosen.includes(n)))) return null;
  const distance = (poem) => Math.min(...pagesOf(poem).flatMap((n) => chosen.map((c) => Math.abs(n - c))));
  const nearest = poems.reduce((best, poem) => (distance(poem) < distance(best) ? poem : best));
  return { unit: nearest.unit, pages: nearest.pages, title: nearest.title };
}

/** Whitespace collapsed, so a quote laid out differently on the page still matches. */
function _flat(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * One spelling for a word however it was typed: vowel marks, tatweel and zero-width
 * characters gone, Arabic letter forms read as their Urdu ones (ي ى → ی, ك → ک,
 * ة ۃ ه ۂ ۀ → ہ, آ أ إ ٱ → ا), whitespace collapsed.
 */
function _heldNorm(text) {
  return _flat(String(text ?? '')
    .replace(/[ً-ٰٟۖ-ۭـ​-‏⁠﻿]/g, '')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ةۃهۂۀ]/g, 'ہ')
    .replace(/[آأإٱ]/g, 'ا'));
}
function _lettersOnly(text) { return _heldNorm(text).replace(/[^\p{L}]/gu, ''); }

/**
 * Urdu Q6's verses come from the poem's own pages: the given poem's text, or the poem pages inside
 * the loaded text. Letters only, so spacing and punctuation never decide. '' when neither is there
 * (another subject, a page that could not be loaded): then nothing is checked.
 */
function _versesReference(P, poem, content) {
  if (!P || P.key !== 'urdu' || !Array.isArray(P.poems) || !P.poems.length) return '';
  if (poem && poem.content) return _lettersOnly(poem.content);
  // Only a poem whose every page is loaded: on chosen pages that cut a poem in two, the lines on
  // the missing page would read as not the poem's, so nothing is checked.
  const pages = _splitPages(content) || [];
  const have = new Set(pages.map((pg) => pg.page));
  const pagesOf = (poem) => Patterns.parseRanges(poem.pages).flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i));
  const want = new Set(P.poems.map(pagesOf).filter((list) => list.every((n) => have.has(n))).flat());
  return _lettersOnly(pages.filter((pg) => want.has(pg.page)).map((pg) => pg.text).join('\n'));
}
// A line is the poem's when it is in the poem's text, or when three in four of its four-letter runs
// are: a model writes a word as it is spelled, not as the page store read it («بیماری» / «پیماری»).
function _lineFromPoem(line, ref) {
  const n = _lettersOnly(line);
  if (n.length < 8) return false;
  if (ref.includes(n)) return true;
  let found = 0;
  for (let i = 0; i + 4 <= n.length; i += 1) if (ref.includes(n.slice(i, i + 4))) found += 1;
  return found >= 0.75 * (n.length - 3);
}
/**
 * Urdu Q6: a verses item whose four lines are not the poem's (lesson prose reworded under «درج ذیل
 * اشعار کا مفہوم واضح کریں») is taken out of the reply, so the slot is short and Section C is asked
 * once more; it is never printed. An item with fewer than four lines is the layout's to refuse.
 * Mutates the tree.
 */
function _dropProseVerses(tree, ref, requestId) {
  if (!ref || !tree || typeof tree !== 'object') return;
  for (const branch of ['seen', 'unseen']) {
    for (const types of Object.values(tree[branch] || {})) {
      if (!types || typeof types !== 'object') continue;
      for (const [type, list] of Object.entries(types)) {
        if (!Array.isArray(list)) continue;
        types[type] = list.filter((q) => {
          if (!q || q.slot !== 'urdu.C.Q6') return true;
          const fromPassage = verseLines(q.passage).lines;
          const lines = (fromPassage.length >= 4 ? fromPassage : verseLines(q.question).lines).slice(-4);
          if (lines.length < 4 || lines.filter((l) => _lineFromPoem(l, ref)).length >= 3) return true;
          logToFile('[assessment] Q6 verses not from the poem', { requestId, slot: q.slot, lines });
          return false;
        });
      }
    }
  }
}

/** The given poem's page text from the book store; null (and today's rule) when it cannot be loaded. */
async function _loadPatternPoem({ grade, subject, P, scope, pageContent }) {
  const poem = patternPoemFor({ P, scope, pageContent });
  if (!poem) return null;
  try {
    const got = await BookContent().loadPageRangeContent({ grade, subject, pageRanges: poem.pages });
    // The page store keeps the book's picture notes ("Object: Illustration of …") among the
    // poem's lines, and a page goes on to its activities after the poem ("Diving Deeper"; in the
    // Urdu book the poet's letter «پیارے طلبہ!» and the exercises); the given lines are printed
    // exactly, so neither is given.
    let activities = false;
    const content = got && got.content
      ? String(got.content).split('\n').filter((line) => {
        if (/^=== Page \d+ ===/.test(line)) activities = false;
        else if (/^\s*(?:Diving Deeper\b|پیارے طلبہ)/i.test(line)) activities = true;
        return !activities && !/^\s*Object:/.test(line);
      }).join('\n').trim()
      : '';
    return content ? { ...poem, content } : null;
  } catch (err) {
    logToFile('[assessment] Q5 poem pages not loaded', { pages: poem.pages, error: err.message });
    return null;
  }
}

/**
 * The text one section is set from. Every section gets all the loaded pages,
 * except on the FDE syllabus where a slot names its own pages (Maths: Section B
 * from Units 1–8, Section C from Units 11–12).
 */
function _sectionText(section, loaded, scopeKind, ranges) {
  const narrows = scopeKind === 'fde' && section.slots.some((s) => s.section_pages && s.section_pages !== 'scope');
  const whole = { content: loaded.content, pageReference: loaded.pageReference };
  if (!narrows || !ranges) return whole;
  const pages = _splitPages(loaded.content);
  if (!pages) {
    logToFile('[assessment] section pages cannot be split, using all pages', { section: section.id });
    return whole;
  }
  const wanted = Patterns.parseRanges(ranges);
  const kept = pages.filter((p) => wanted.some(([a, b]) => p.page >= a && p.page <= b));
  if (!kept.length) {
    logToFile('[assessment] section pages not loaded, using all pages', { section: section.id, ranges });
    return whole;
  }
  return { content: kept.map((p) => p.text).join('\n\n'), pageReference: ranges };
}

/** Concatenate the sections' trees: the same type under the same category becomes one list. */
/**
 * A comprehension item whose "questions" part came back with marks and no questions: the paper would
 * print the part's head and its marks over nothing. Read on a laid-out paper (the slot's parts_spec
 * says how many questions the part holds). Only the "questions" part is read: other parts keep
 * their content under other names.
 */
function _emptyQuestionParts(examJson) {
  const specs = {};
  for (const section of (examJson && examJson._layout && examJson._layout.sections) || []) {
    for (const slot of section.slots || []) if (Array.isArray(slot.parts_spec)) specs[slot.slot] = slot.parts_spec;
  }
  const out = [];
  _walkQuestions(examJson, (q) => {
    if (!q.slot || !specs[q.slot] || !Array.isArray(q.parts)) return;
    q.parts.forEach((part) => {
      if (!part || part.key !== 'questions') return;
      if (Array.isArray(part.questions) && part.questions.length) return;
      const spec = specs[q.slot].find((x) => x.key === 'questions');
      out.push({ slot: q.slot, part: 'questions', missing: (spec && spec.n) || 1 });
    });
  });
  return out;
}

/**
 * The first reply, plus the second reply's items for the given slots that are not already in it. Nothing else of the second reply is kept.
 */
// For each short slot: the items a section's reply wrote under it and the layout's holds of it, by rule.
function _shortWhy(shortfall, tree, held) {
  return shortfall.map((f) => {
    let written = 0;
    _walkQuestions(tree, (q) => { if (q && q.slot === f.slot) written += 1; });
    const rules = {};
    for (const h of held || []) if (h.slot === f.slot) rules[h.rule] = (rules[h.rule] || 0) + 1;
    return { slot: f.slot, written, held: rules };
  });
}

function _mergeSections(trees) {
  const out = {};
  for (const tree of trees) {
    for (const branch of ['seen', 'unseen']) {
      const src = tree && tree[branch];
      if (!src || typeof src !== 'object') continue;
      out[branch] = out[branch] || {};
      for (const [category, types] of Object.entries(src)) {
        if (!types || typeof types !== 'object') continue;
        out[branch][category] = out[branch][category] || {};
        for (const [type, list] of Object.entries(types)) {
          if (!Array.isArray(list)) continue;
          out[branch][category][type] = (out[branch][category][type] || []).concat(list);
        }
      }
    }
  }
  return out;
}

/** Every string a question carries that a child or teacher would read. */
function _textsOf(q) {
  const out = [];
  const add = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === 'object') Object.values(v).forEach(add);
  };
  ['question', 'passage', 'answer', 'options', 'words', 'questions', 'parts', 'topics'].forEach((k) => add(q[k]));
  return out;
}

function _topUp(firstTree, secondTree, slots) {
  // Keyed on everything the item says, not its question line alone: an item whose stem sits in
  // another field has no question line, and two of those are not the same item.
  const keyOf = (q) => _textsOf(q).map((t) => _flat(t).toLowerCase()).join('\u0001');
  const seen = new Set();
  _walkQuestions(firstTree, (q) => seen.add(keyOf(q)));
  const extra = JSON.parse(JSON.stringify(secondTree || {}));
  for (const branch of ['seen', 'unseen']) {
    for (const types of Object.values((extra && extra[branch]) || {})) {
      if (!types || typeof types !== 'object') continue;
      for (const [type, list] of Object.entries(types)) {
        if (!Array.isArray(list)) continue;
        types[type] = list.filter((q) => q && slots.has(q.slot) && !seen.has(keyOf(q)));
      }
    }
  }
  const out = _mergeSections([firstTree, extra]);
  // A laid paper keeps what its layout recorded (the layout reads it back on Urdu papers only).
  if (firstTree && firstTree._layout) out._layout = firstTree._layout;
  return out;
}

// The markers the paper refuses in a question's own text (the renderer's item list). The renderer's
// own list is used when it exports one; this copy is the fallback.
const REVIEW_ITEM_FALLBACK = Object.freeze([/needs review/i, /\bfil{2}er\b/i, /\u26A0/, /Islamabad\sModel\sSchool/i, /MODEL PAPER FOR/i]);

function _reviewItemList() {
  try {
    const list = require('../assessment-paper-fde.renderer').REFUSED_ITEM;
    if (Array.isArray(list) && list.length) return list;
  } catch { /* the fallback below */ }
  return REVIEW_ITEM_FALLBACK;
}

module.exports = {
  _dropProseVerses, _emptyQuestionParts, _flat, _heldNorm, _loadPatternPoem, _mergeSections, _reviewItemList,
  _sectionText, _shortWhy, _textsOf, _topUp, _versesReference, patternPoemFor,
};
