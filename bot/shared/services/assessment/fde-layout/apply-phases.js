'use strict';
// Part of fde-layout.js (see its header); split for the 300-line limit, bd-5jmnfj.4.52.
const { sameKeyFact } = require('./fact-twins');
const { bookSentences, sameLine, samePassage, sameStemKey, sameTask } = require('./given-back');
const { CONCEPTS, LESSON_ONLY, conceptOf, declaredConcept, entryOf, nameCue, nameInKey, oneStory, sameQuestion, storyCue, storyId } = require('./names-concepts');
const { Q5_SLOT, q5Note } = require('./notes');
const { clone, scopeBlock, slotKey, suppliesFor, walk, withFramePages } = require('./scope-frames');
const { sectionBStem, stripSpareLabel, stripStemOptions, stripTags } = require('./stem-tags');
const { sameQ4Kind, stemGivesKey } = require('./urdu-key-rules');

/**
 * firstAskNote(P, tree) → string | null
 *
 * What Social Studies Section D's FIRST ask is told, from Section C's first reply (`tree`, as the
 * model wrote it): every Q5 item C wrote, spares included, with its marking points. Null for any
 * other subject, or when C wrote no Q5 item.
 */
function firstAskNote(P, tree) {
  if (!P || P.key !== 'social_studies' || !Array.isArray(P.sections)) return null;
  const slots = P.sections.flatMap((sec) => sec.slots);
  const byId = new Map(slots.map((slot) => [slotKey(slot.slot), slot]));
  // Placed as the layout places it: by its tag, or a mis-tag by its tail.
  const slotOf = (tag) => {
    if (!tag) return null;
    const slot = byId.get(slotKey(tag));
    if (slot) return slot;
    const tail = `.${slotKey(tag).split('.').slice(-2).join('.')}`;
    return slots.find((s) => slotKey(s.slot).endsWith(tail)) || null;
  };
  const five = walk(tree).map((e) => e.q).filter((q) => (slotOf(q.slot) || {}).slot === Q5_SLOT);
  return q5Note(five);
}

// Reads each item's tags off it (they never print): the concept and source Urdu declares, the
// options a stem wrote out, and the words and names a later rule reads.
function readItems(src, P, lessons) {
  const all = walk(src);
  // Urdu: the concept Section A declares for a Q1 item is read here and taken off the item, so it
  // never prints; it is checked on chosen lessons only.
  const declared = new Map();
  // Urdu on one story: the source each Q1 item declares, read and taken off the same way.
  const story = P.key === 'urdu' && oneStory(lessons);
  const sources = new Map();
  const storyIds = new Set(story && src._layout && Array.isArray(src._layout.story_ids) ? src._layout.story_ids : []);
  all.forEach((entry) => {
    stripTags(entry.q); stripStemOptions(entry.q);
    if (P.key === 'social_studies') { stripSpareLabel(entry.q); sectionBStem(entry.q, P); }
    if (P.key !== 'urdu') return;
    stripStemOptions(entry.q, true);
    if (Object.prototype.hasOwnProperty.call(entry.q, 'concept')) {
      if (lessons) declared.set(entry.q, declaredConcept(entry.q.concept, P));
      delete entry.q.concept;
    }
    if (Object.prototype.hasOwnProperty.call(entry.q, 'source')) {
      if (story) sources.set(entry.q, String(entry.q.source || '').trim().toLowerCase());
      delete entry.q.source;
    } else if (storyIds.size && typeof entry.q.question === 'string' && storyIds.has(storyId(entry.q))) sources.set(entry.q, 'story');
  });
  // Urdu Q1: the items whose key of several words another Q1 item names as a person (nameInKey).
  const q1Items = P.key === 'urdu' ? all.map((e) => e.q).filter((q) => slotKey(q.slot) === slotKey('urdu.A.Q1')) : [];
  const nameGiven = new Set(q1Items.filter((q) => q1Items.some((b) => b !== q && nameInKey(q, b))));
  // Urdu: the words the reply's first Q3 asks the meaning of (a Q5 never asks them again).
  const q3 = P.key === 'urdu' ? all.find((e) => slotKey(e.q.slot) === slotKey('urdu.C.Q3') && Array.isArray(e.q.words)) : null;
  const q3Words = q3 ? q3.q.words.filter((w) => typeof w === 'string') : [];
  return { all, declared, story, sources, nameGiven, q3Words };
}

// Marks, lines and the `_layout` block of a laid-out paper, from what `applyLayout` placed.
function finishLayout(src, P, scope, opts, laid) {
  const { slots, bySlot, unplaced, counted, story, sources, storyCount, tally, putBack, held, repeated } = laid;
  // Marks, lines and the canonical tag come from the pattern, never the model.
  const unseen = {};
  const usedKeys = new Set();
  const shortfall = [];
  // Social Studies after the re-ask: a choice slot that prints fewer than it offers but still
  // leaves the child a choice (at least what the child answers, plus one) is not short; it is
  // recorded. Below that it is short, as a compulsory slot is.
  const shortChoice = [];
  const choiceFloor = (slot) => (P.key === 'social_studies' && opts.reasked && slot.compulsory === false ? Math.min(slot.generate, slot.attempt + 1) : slot.generate);
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
    if (list.length < choiceFloor(slot)) shortfall.push({ slot: slot.slot, missing: choiceFloor(slot) - list.length });
    else if (list.length < slot.generate) shortChoice.push({ slot: slot.slot, printed: list.length, generate: slot.generate });
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
    sections: withFramePages(clone(P.sections), bySlot),
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
  // `held` and `repeated` are Social Studies' only (the engine reads `held` for Section D, and logs both). `putBack` (Urdu: the
  // held items that came back, with their rule) only when there are some. Any other subject gets `held` only for Q1 items
  // held for a grammar concept the chosen lessons do not teach, and only when there are some.
  if (shortChoice.length) out._layout.short_choice = shortChoice;
  // Urdu: the holds by slot and rule, counts only. A paper laid out again from a laid paper (its held
  // items already gone) keeps the larger count the earlier layout recorded.
  if (P.key === 'urdu') {
    if (counted) out._layout.counted = true;
    // On one story: how many printed Q1 items ask a fact of the story (a top-up is told what is left). A
    // paper laid out again from a laid one (its sources already gone) keeps the count it had.
    const told = sources.size ? storyCount(bySlot.get('urdu.A.Q1') || []) : src._layout && src._layout.story_items;
    if (story && Number.isInteger(told)) out._layout.story_items = told;
    if (story && sources.size) out._layout.story_ids = (bySlot.get('urdu.A.Q1') || []).filter((p) => sources.get(p) === 'story').map(storyId);
    const before = src._layout && Array.isArray(src._layout.holds) ? src._layout.holds : [];
    const counts = new Map(before.map((h) => [`${h.slot}|${h.rule}`, h.n]));
    tally.forEach((n, k) => counts.set(k, Math.max(n, counts.get(k) || 0)));
    if (counts.size) out._layout.holds = [...counts].map(([k, n]) => { const [slot, rule] = k.split('|'); return { slot, rule, n }; });
  }
  const base = { examJson: out, placed, unplaced, shortfall, ...(putBack.length ? { putBack } : {}) };
  if (P.key === 'social_studies') return { ...base, held, shortChoice, repeated };
  const outside = held.filter((h) => h.rule === 'grammar_outside_lessons');
  return outside.length ? { ...base, held: outside } : base;
}

// The tests that find two items asking the same thing, for one subject on one scope. `twinRule` names
// the Social Studies test that matched; `sentences` is the book the passage test reads.
function twinTests(P, declared, conceptLessons, book) {
  // `id`, the slot both items are placed in: Urdu Q1 items also give each other away by a story
  // name, and ask a grammar concept once.
  // A concept asked again is a twin. `hard`: only a twin that may never print; an antonym or a synonym
  // asked again on lessons 4–5 gives nothing away, and is the last item put back (below).
  // The concepts an item asks: the one its stem or key names, and the one Section A declares for it,
  // as one set (a declared vocabulary item whose stem names a concept still asks it). A lesson entry
  // that names one concept («متشابہ الفاظ») is that concept's row; an entry of two is read by its stem.
  const conceptsOf = (q) => {
    const out = new Set();
    const c = conceptOf(q, conceptLessons);
    // A reply written before Section A declared its concepts was never asked to keep an antonym or a
    // synonym once on chosen lessons: there they stay vocabulary, as they printed.
    if (c && (conceptLessons || !LESSON_ONLY.has(c))) out.add(c);
    const d = declared.get(q);
    if (d && d.grammar && !d.pair) {
      const entry = CONCEPTS.some(([name]) => name === d.name) ? null : entryOf(P.lessons || [], d.name);
      out.add(entry && (entry.tags || []).length === 1 ? entry.tags[0] : d.name);
    }
    return out;
  };
  const conceptTwin = (p, q, hard) => {
    const mine = conceptsOf(q);
    const shared = [...conceptsOf(p)].filter((c) => mine.has(c));
    return hard ? shared.some((c) => !LESSON_ONLY.has(c)) : shared.length > 0;
  };
  // Social Studies: the book's sentences, when the engine passes its pages.
  const sentences = P.key === 'social_studies' ? bookSentences(book) : null;
  const twin = (p, q, id, hard = false) => sameQuestion(p, q) || (P.key === 'social_studies' && (sameKeyFact(p, q) || sameTask(p, q) || sameLine(p, q) || samePassage(p, q, sentences)))
    || (P.key === 'urdu' && (sameStemKey(p, q) || stemGivesKey(p, q) || (id === 'urdu.C.Q4' && sameQ4Kind(p, q))
      || (id === 'urdu.A.Q1' && (storyCue(p, q) || nameCue(p, q) || conceptTwin(p, q, hard)))));
  const twinRule = (p, q) => (sameQuestion(p, q) ? 'same_question' : sameKeyFact(p, q) ? 'same_key_fact' : sameTask(p, q) ? 'same_task'
    : sameLine(p, q) ? 'same_line' : 'same_passage');
  return { conceptTwin, sentences, twin, twinRule };
}

module.exports = {
  finishLayout, firstAskNote, readItems, twinTests,
};
