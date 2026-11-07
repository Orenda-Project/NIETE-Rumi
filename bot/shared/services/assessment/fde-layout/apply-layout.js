'use strict';
// Part of fde-layout.js (see its header); split for the 300-line limit, bd-5jmnfj.4.52.
const { finallyNotLast } = require('../fde-order-check');
const { Q4_KINDS, q4TaskKnown } = require('../fde-task-line');
const { finishLayout, readItems, twinTests } = require('./apply-phases');
const { givenBack, namesOwnKey, stemNamesKey } = require('./given-back');
const { GRAMMAR_REPEAT, LESSON_ONLY, STORY_ITEMS, declaredMiss, markEndsStem, outsideLessons, scopeLessons, twoRightOptions } = require('./names-concepts');
const { CROSS_HOLD, DIAGRAM_SLOT, Q7_SLOT, SAME_POINTS, SST_A_Q1, keyInOwnStem, notDiagramName, samePoints, wordTwice } = require('./points-cross');
const { clone, settleVerses, slotKey, typeKey } = require('./scope-frames');
const { Q6_SLOT, asksFrame, asksRecall, bookList, namesBody, tellsWhat, tierSlip } = require('./sst-recall');
const { printable, spreadKeys } = require('./stem-tags');
const { DATE_KEY_SLOTS, asksTwo, bookSplit, groupWordListed, keyAcceptSplit, keyedOnDate, lettersOfKey, printsOwnKey, q4Kind, sameQ4Kind, syllableSplit } = require('./urdu-key-rules');

/**
 * applyLayout(examJson, P, scope, { now }) → { examJson, placed, unplaced, shortfall }
 *
 * P is one subject of a pattern (patterns.get(id).subjects[key]); scope is
 * { kind: 'fde' | 'chapters' | 'pages', chapters, pages }. `opts.reasked` is true once the
 * engine's one re-ask has run (a held item may then fill a place nothing else takes). Social
 * Studies also gets `held`: every item the last pass set aside, { slot, rule, printed, q },
 * `printed` when it was put back.
 * Never throws.
 */
function applyLayout(examJson, P, scope, opts = {}) {
  const src = examJson && typeof examJson === 'object' ? clone(examJson) : {};
  const slots = P.sections.flatMap((sec) => sec.slots);
  const byId = new Map(slots.map((slot) => [slotKey(slot.slot), slot]));
  const bySlot = new Map(slots.map((slot) => [slot.slot, []]));
  const room = (slot) => bySlot.get(slot.slot).length < slot.generate;
  let unplaced = 0;
  let putBack = [];
  let held = [];
  // Urdu: how many items each rule set aside in the last pass, by slot (`_layout.holds`).
  let tally = new Map();
  // Urdu on chosen lessons: Q1 asks only those lessons' own grammar.
  const lessons = P.key === 'urdu' ? scopeLessons(P, scope) : null;

  const { all, declared, story, sources, nameGiven, q3Words } = readItems(src, P, lessons);
  const storyCount = (list) => list.filter((p) => sources.get(p) === 'story').length;
  // The antonym and synonym rows hold a reply to the prompt that gives Q1 its grammar count, one that
  // declares its concepts; a reply written before it was never asked to keep them once. A paper
  // laid out again from a counted one (`_layout.counted`) stays counted: its placed items have lost
  // their tags, and an item a top-up writes without one is still read by its stem.
  const counted = declared.size || (src._layout && src._layout.counted === true) ? lessons : null;
  // The lessons a concept is read against: the counted ones, or on the full syllabus all of them (it
  // teaches the antonym and the synonym, lessons 4–5), so a concept is asked once on every scope.
  const conceptLessons = counted || (P.key === 'urdu' && !lessons ? P.lessons : null);
  const { conceptTwin, sentences, twin, twinRule } = twinTests(P, declared, conceptLessons, opts.book);
  // `cross`: a subject whose sections can give each other away (CROSS_HOLD), with its rule.
  // `within`: Social Studies, a D item answered by another item's points ([{ slot, rule, name, inSlot }],
  // SAME_POINTS); an in-slot row reads the items already placed in its slot.
  // Social Studies: the items set aside as a repeat of one already placed, with the test that matched.
  let repeated = [];
  // Urdu: the Q5 items the last pass held only for a Q3 word: they may come back after the re-ask, so
  // Section A is read against their words too.
  let mayReturn = [];
  // `back`: Social Studies, the Q1 items a placed C/D stem gives away (givenBack), with the test that matched.
  const place = (cross, within, back = null) => {
    bySlot.forEach((list) => { list.length = 0; });
    unplaced = 0;
    held = [];
    repeated = [];
    putBack = [];
    tally = new Map();
    const no = (slot, rule) => {
      if (P.key === 'urdu') tally.set(`${slot.slot}|${rule}`, (tally.get(`${slot.slot}|${rule}`) || 0) + 1);
      return false;
    };
    const holds = (slot) => Boolean(cross) && cross.held.includes(slot.slot);
    const fallback = new Map(); // slot → held items, in reply order
    const inSlot = new Map(); // Urdu Q1: slot → items held inside Q1 that give nothing away, in reply order
    mayReturn = [];
    const keep = (id, q, rule) => { inSlot.set(id, [...(inSlot.get(id) || []), { q, rule }]); tally.set(`${id}|${rule}`, (tally.get(`${id}|${rule}`) || 0) + 1); };
    // An Urdu Q1 twin of a placed item: never printed, or, a concept repeat only, kept for the put-back.
    const twinOf = (slot, q) => {
      if (bySlot.get(slot.slot).some((p) => twin(p, q, slot.slot, true))) return no(slot, 'twin');
      keep(slot.slot, q, 'concept_repeat');
      return false;
    };
    const repeats = new Map(); // Social Studies: slot → items a placed item already asks, in reply order
    const hold = (slot, q, rule) => {
      fallback.set(slot.slot, [...(fallback.get(slot.slot) || []), q]);
      held.push({ slot: slot.slot, rule, printed: false, q });
      return no(slot, rule);
    };
    const restated = (slot, q) => (within || []).find((w) => w.slot === slot.slot
      && (w.inSlot ? (samePoints(bySlot.get(slot.slot)) || (() => false))(q) : w.rule(q)));
    const fits = (slot, q) => {
      if (!settleVerses(slot, q) || !printable(slot, q)) return no(slot, 'unprintable');
      if (slot.slot === DIAGRAM_SLOT && notDiagramName(q)) return no(slot, 'diagram_not_named');
      if (P.key === 'social_studies' && tierSlip(q)) return false;
      if (P.key === 'social_studies' && slot.slot === Q7_SLOT && keyInOwnStem(q)) return hold(slot, q, 'key_in_own_stem');
      if (P.key === 'social_studies' && slot.slot === SST_A_Q1 && namesOwnKey(q)) return hold(slot, q, 'key_in_own_stem');
      if (P.key === 'social_studies' && slot.slot === SST_A_Q1 && bySlot.get(slot.slot).some((p) => stemNamesKey(p, q))) return hold(slot, q, 'names_q1_key');
      if (P.key === 'urdu' && DATE_KEY_SLOTS.has(slot.slot) && keyedOnDate(q)) return no(slot, 'date_key');
      if (P.key === 'urdu' && slot.slot === 'urdu.C.Q4' && bySlot.get(slot.slot).some((p) => sameQ4Kind(p, q))) return no(slot, 'q4_kind_repeat');
      if (P.key === 'urdu' && slot.slot === 'urdu.C.Q4' && !q4TaskKnown(q)) return no(slot, 'q4_task_unknown');
      if (slot.type === 'Story Order' && finallyNotLast(q)) return no(slot, 'order_finally_not_last');
      if (P.key === 'urdu' && slot.slot === 'urdu.C.Q4' && keyAcceptSplit(q)) return no(slot, 'key_accept_split');
      if (P.key === 'urdu' && slot.slot === 'urdu.C.Q4' && groupWordListed(q)) return no(slot, 'group_word_listed');
      if (P.key === 'urdu' && slot.slot === 'urdu.C.Q4' && syllableSplit(q)) { keep(slot.slot, q, 'syllable_split'); return false; }
      if (P.key === 'urdu' && slot.slot === 'urdu.C.Q4' && bookSplit(q, P)) { keep(slot.slot, q, 'book_split'); return false; }
      // A word Q3 asks, asked again in Q5, gives nothing away: Section C is asked again first, and the
      // item comes back only if the re-ask leaves its place empty.
      if (P.key === 'urdu' && slot.slot === 'urdu.C.Q5' && q3Words.length && wordTwice(q, q3Words)) { keep(slot.slot, q, 'word_twice'); mayReturn.push(q); return false; }
      if (P.key === 'urdu' && slot.slot === 'urdu.A.Q1' && printsOwnKey(q)) return no(slot, 'prints_own_key');
      if (P.key === 'urdu' && slot.slot === 'urdu.A.Q1' && lettersOfKey(q)) return no(slot, 'letters_of_key');
      if (P.key === 'urdu' && slot.slot === 'urdu.A.Q1' && markEndsStem(q)) return no(slot, 'mark_ends_stem');
      if (P.key === 'urdu' && slot.slot === 'urdu.A.Q1' && nameGiven.has(q)) return no(slot, 'name_in_key');
      if (P.key === 'urdu' && slot.slot === 'urdu.A.Q1' && twoRightOptions(q)) return no(slot, 'two_right_options');
      const outsideOf = slot.slot === 'urdu.A.Q1' && outsideLessons(q, lessons);
      const outside = outsideOf && (counted || !LESSON_ONLY.has(outsideOf)) ? outsideOf : null;
      if (outside) { held.push({ slot: slot.slot, rule: 'grammar_outside_lessons', concept: outside }); return no(slot, 'grammar_outside_lessons'); }
      const miss = slot.slot === 'urdu.A.Q1' && counted && declaredMiss(q, declared.get(q), counted);
      // A tag the stem contradicts gives nothing away: the item is asked again first, and comes back
      // only when no printed item asks its concept (a concept asked again never comes back).
      if (miss === 'concept_tag_disagrees') { keep(slot.slot, q, miss); return false; }
      if (miss) return no(slot, miss);
      if (P.key === 'urdu' && slot.slot === 'urdu.A.Q1' && asksTwo(q)) { keep(slot.slot, q, 'asks_two'); return false; }
      // Urdu Q1's own twin rules run on every pass, not only once Section C gives a rule: a paper laid
      // out before Section C is in prints no Q1 twin either.
      if (P.key === 'urdu' && slot.slot === 'urdu.A.Q1' && !holds(slot) && bySlot.get(slot.slot).some((p) => twin(p, q, slot.slot))) return twinOf(slot, q);
      if (!holds(slot)) {
        const given = back && slot.slot === SST_A_Q1 ? back(q) : null;
        if (given) return hold(slot, q, given);
        if (P.key === 'social_studies' && slot.slot === Q6_SLOT && asksRecall(q)) return hold(slot, q, 'recall');
        if (P.key === 'social_studies' && slot.slot === Q6_SLOT && namesBody(q)) return hold(slot, q, 'names_body');
        if (P.key === 'social_studies' && slot.slot === Q6_SLOT && asksFrame(q)) return hold(slot, q, 'asks_frame');
        if (P.key === 'social_studies' && slot.slot === Q6_SLOT && tellsWhat(q)) return hold(slot, q, 'tells_what');
        if (P.key === 'social_studies' && slot.slot === Q6_SLOT && bookList(q, sentences)) return hold(slot, q, 'book_list');
        // Social Studies: one question once in every slot, not only the held ones (a top-up wrote a
        // kept MCQ again with its options shuffled). The repeat is the last resort: it comes back
        // after the re-ask only for a place nothing else takes.
        const first = P.key === 'social_studies' ? bySlot.get(slot.slot).find((p) => twin(p, q)) : null;
        if (first) {
          repeats.set(slot.slot, [...(repeats.get(slot.slot) || []), q]);
          repeated.push({ slot: slot.slot, rule: twinRule(first, q), q });
          return false;
        }
        const row = restated(slot, q);
        if (row) return hold(slot, q, row.name);
        // A Q1 item that will print sets aside each placed Q1 item whose key its stem names.
        if (P.key === 'social_studies' && slot.slot === SST_A_Q1) {
          const list = bySlot.get(slot.slot);
          list.filter((p) => stemNamesKey(q, p)).forEach((p) => { list.splice(list.indexOf(p), 1); hold(slot, p, 'names_q1_key'); });
        }
        return true;
      }
      const again = bySlot.get(slot.slot).find((p) => twin(p, q, slot.slot));
      if (again) {
        if (P.key === 'social_studies') repeated.push({ slot: slot.slot, rule: twinRule(again, q), q });
        return P.key === 'urdu' && slot.slot === 'urdu.A.Q1' ? twinOf(slot, q) : no(slot, 'twin');
      }
      if (cross.rule(q, slot.slot)) return hold(slot, q, 'section_a');
      const row = restated(slot, q);
      return row ? hold(slot, q, row.name) : true;
    };
    // Urdu on one story: a story item past the eighth gives nothing away, and is the last item put back.
    const storyFull = (slot, q) => {
      if (!story || slot.slot !== 'urdu.A.Q1' || sources.get(q) !== 'story' || storyCount(bySlot.get(slot.slot)) < STORY_ITEMS) return false;
      keep(slot.slot, q, 'story_cap');
      return true;
    };
    const offer = (slot, q) => {
      if (room(slot) && fits(slot, q) && !storyFull(slot, q)) bySlot.get(slot.slot).push(q);
      else unplaced += 1;
    };
    const untagged = [];
    // Tagged items first, so an untagged one cannot take a tagged one's place.
    for (const entry of all) {
      let slot = byId.get(slotKey(entry.q.slot));
      if (!slot && entry.q.slot) {
        const tail = `.${slotKey(entry.q.slot).split('.').slice(-2).join('.')}`;
        slot = slots.find((s) => slotKey(s.slot).endsWith(tail));
      }
      if (!slot) { untagged.push(entry); continue; }
      offer(slot, entry.q);
    }
    for (const entry of untagged) {
      const key = typeKey(entry.type);
      const slot = slots.find((s) => typeKey(s.type) === key && room(s));
      if (slot) offer(slot, entry.q);
      else unplaced += 1;
    }
    // A held item comes back only after the one re-ask (the engine says so, `opts.reasked`): the
    // clean items, the re-asked section's among them, have had their turn, and a paper with a
    // repeat beats no paper. Before it, the held item stays out, so the slot is short and the
    // section is asked again.
    if (!opts.reasked) return;
    // Urdu: an item held against Section C (Q4's sentence, Q6's verse, a Q3/Q5 word) never comes
    // back: it is the give-away a reader sees. The engine tops Section A up once more instead, and
    // only an item held inside Q1 that gives nothing away fills a place left after that: a stem that
    // asks two questions, then an antonym or synonym asked again (a repeat, not a give-away). A twin of
    // a kept item, or a stem that prints a key, never comes back. Q4's ارکان item whose key and
    // accepted answer split a word apart is asked again first, and comes back only if the re-ask leaves
    // its place empty (it printed so before; a paper that refuses is worse). On every scope a grammar
    // concept a printed item already asks never comes back (a tag the stem contradicts on the only item
    // of its concept still may): the engine tops Section A up once more, told grammar is used up, and a
    // place still empty after that fails the paper.
    if (P.key === 'urdu') {
      inSlot.forEach((list, id) => {
        const slot = slots.find((s) => s.slot === id);
        const order = list.filter((x) => x.rule === 'asks_two').concat(list.filter((x) => x.rule !== 'asks_two'));
        for (const { q, rule } of order) {
          if (!room(slot)) return;
          if (GRAMMAR_REPEAT.has(rule) && bySlot.get(id).some((p) => conceptTwin(p, q, false))) continue;
          if (bySlot.get(id).some((p) => twin(p, q, id, rule === 'concept_repeat' || rule === 'concept_tag_disagrees')) || (holds(slot) && cross.rule(q))) continue;
          bySlot.get(id).push(q);
          putBack.push({ slot: id, rule });
          unplaced -= 1;
        }
      });
      return;
    }
    // Social Studies: a caught item never prints, a repeat neither. A choice slot prints fewer
    // items (its count to answer and its marks stay), a compulsory one is short (below).
    if (P.key === 'social_studies') return;
    fallback.forEach((list, id) => {
      const slot = slots.find((s) => s.slot === id);
      for (const q of list) {
        if (!room(slot)) break;
        if (bySlot.get(id).some((p) => twin(p, q))) continue;
        bySlot.get(id).push(q);
        unplaced -= 1;
        held.filter((h) => h.q === q).forEach((h) => { h.printed = true; });
      }
    });
    repeats.forEach((list, id) => {
      const slot = slots.find((s) => s.slot === id);
      for (const q of list) {
        if (!room(slot)) break;
        bySlot.get(id).push(q);
        unplaced -= 1;
      }
    });
  };
  place(null);
  // A subject whose sections can give each other away is laid out again with its rule, built
  // from what the first pass placed in the slot that could be given away.
  const cross = CROSS_HOLD[P.key];
  const against = cross && slots.filter((s) => [].concat(cross.against).includes(s.slot));
  // Each item as the slot it was placed in (a mis-tag, «urdo.C.Q4», is placed by its tail).
  const rule = against && against.length && cross.rule(against.flatMap((s) => bySlot.get(s.slot).concat(s.slot === 'urdu.C.Q5' ? mayReturn : []).map((q) => ({ ...q, slot: s.slot }))));
  if (rule) place({ held: cross.held, rule });
  // Social Studies: D is laid out again against the point sets now placed, one row at a time in
  // SAME_POINTS order, each row built from the slots the rows before it have settled (Q5 is held only
  // against Section A, and Q6 never against Q7, so a later row cannot move an earlier one's slot). A
  // row that holds nothing leaves the paper as it was.
  if (P.key === 'social_studies') {
    const rows = [];
    for (const row of SAME_POINTS) {
      if (!bySlot.has(row.held) || !row.against.every((id) => bySlot.has(id))) continue;
      const inSlot = row.against.includes(row.held);
      // Read against the items placed: a held Social Studies item never prints, so it gives nothing away.
      const test = inSlot ? null : row.rule(row.against.flatMap((id) => bySlot.get(id)));
      if (!inSlot && !test) continue;
      rows.push({ slot: row.held, rule: test, name: row.name, inSlot });
      place(rule ? { held: cross.held, rule } : null, rows);
    }
    // Then Section A against the C and D stems now placed (they are laid out the same way again).
    const back = bySlot.has(SST_A_Q1) && givenBack(['social_studies.C.Q5', Q6_SLOT, 'social_studies.D.Q7']
      .flatMap((id) => (bySlot.get(id) || []).map((q) => ({ ...q, slot: id }))));
    if (back) place(rule ? { held: cross.held, rule } : null, rows, back);
  }
  // Urdu Q4 prints its kinds in FDE's order, whatever order the reply wrote them in.
  if (P.key === 'urdu' && bySlot.has('urdu.C.Q4')) {
    const rank = (q) => { const k = q4Kind(q); return k < 0 ? Q4_KINDS.length : k; };
    bySlot.get('urdu.C.Q4').sort((a, b) => rank(a) - rank(b));
  }
  spreadKeys(slots, bySlot);

  return finishLayout(src, P, scope, opts, { slots, bySlot, unplaced, counted, story, sources, storyCount, tally, putBack, held, repeated });
}

module.exports = {
  applyLayout,
};
