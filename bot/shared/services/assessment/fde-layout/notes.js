'use strict';
// Part of fde-layout.js (see its header); split for the 300-line limit, bd-5jmnfj.4.52.
const { Q4_KINDS } = require('../fde-task-line');
const { acceptOf } = require('./fact-twins');
const { RECALL_RULES, STORY_ITEMS, backNote, heldNote, itemsOf } = require('./names-concepts');
const { CROSS_HOLD, Q7_SLOT } = require('./points-cross');
const { verseLines } = require('./scope-frames');
const { Q6_SLOT } = require('./sst-recall');
const { keyText, plain } = require('./stem-tags');
const { q4Kind } = require('./urdu-key-rules');

function recallNote(section, held) {
  if (!section.slots.some((s) => s.slot === Q6_SLOT)) return null;
  const list = (Array.isArray(held) ? held : []).filter((h) => h && RECALL_RULES.has(h.rule) && h.slot === Q6_SLOT && h.q && typeof h.q.question === 'string');
  const lines = list.map(({ q }) => `- ${q.question.trim()}`);
  if (!lines.length) return null;
  const why = (list.some((h) => h.rule === 'names_body') ? ', or only names a government, court or body as its answer' : '')
    + (list.some((h) => h.rule === 'asks_frame') ? ', or only relays what someone asks («… نے پوچھا کہ …», «… جاننا چاہتا ہے کہ …») so its answer is the book\'s text' : '')
    + (list.some((h) => h.rule === 'tells_what') ? ', or only asks to tell someone what a place or a system is like («… کو بتائیں کہ … کیسا …») so its answer is the book\'s description' : '')
    + (list.some((h) => h.rule === 'book_list') ? ', or is answered by a list the book gives, its points the book\'s own sentences in order' : '');
  return `These Q6 items were set aside: each asks only book facts (who heads or chairs a body, what it is called, how many, when, what was done)${why}, whatever the story around them:\n${lines.join('\n')}\n`
    + 'A Q6 is a situation that needs two ideas applied; history recall goes to Q7. Write each new Q6 so the child decides, advises or explains what to do in the case, using two different ideas from these pages.';
}
// Social Studies: Section D is told every Q5 item with its marking points. A Q6 written beside C
// from the same pages set C's own cases again (a purse found on the road in Q5, a wallet in Q6),
// and a child who answers one has answered the other.
const Q5_SLOT = 'social_studies.C.Q5';
// What a Q5 item is about, as a noun phrase: its first sentence up to the question word or the
// instruction («ماس میڈیا اور سوشل میڈیا میں کیا فرق ہے؟» → «ماس میڈیا اور سوشل میڈیا»), case
// markers, pronouns and «فرق» / «نام» off its tail. Eight words at most; none when nothing is left.
const TOPIC_ENDS = new Set(['کیا', 'کیوں', 'کون', 'کونسا', 'کونسی', 'کس', 'کسے', 'کب', 'کہاں', 'کیسے', 'کتنا', 'کتنی', 'کتنے', 'کن',
  'لکھیں', 'بیان', 'وضاحت', 'واضح', 'بتائیں', 'دیں', 'کریں', 'what', 'why', 'how', 'which', 'who', 'when', 'where', 'explain', 'write', 'name', 'give']);
const TOPIC_TAIL = new Set(['میں', 'کے', 'کی', 'کا', 'کو', 'سے', 'لیے', 'ہمیں', 'ہم', 'آپ', 'اور', 'پر', 'نے', 'فرق', 'نام', 'in', 'of', 'the', 'a', 'and', 'for', 'to', 'is', 'are']);
function topicOf(stem) {
  const first = String(stem == null ? '' : stem).split(/[؟?۔.!]/)[0];
  const words = [];
  for (const w of first.trim().split(/\s+/)) {
    if (!w || TOPIC_ENDS.has(plain(w))) break;
    words.push(w.replace(/[،,:؛;]+$/, ''));
  }
  words.splice(8);
  while (words.length && TOPIC_TAIL.has(plain(words[words.length - 1]))) words.pop();
  const out = words.join(' ').trim();
  return out || null;
}
function q5Note(list) {
  const lines = list.filter((q) => q && typeof q.question === 'string' && q.question.trim()).map((q) => {
    const points = (q.scheme && Array.isArray(q.scheme.points) ? q.scheme.points : [])
      .map((p) => (typeof p === 'string' ? p : p && p.text)).filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim());
    return `- ${q.question.trim()}${points.length ? `\n  points: ${points.join('; ')}` : ''}`;
  });
  if (!lines.length) return null;
  const topics = [...new Set(list.map((q) => q && topicOf(q.question)).filter(Boolean))];
  return `Q5 of this paper asks these questions (under each, the points a full answer gives):\n${lines.join('\n')}\n`
    + 'A child who answers these has already answered them. No Q6 or Q7 item you write may ask anything a child answering these '
    + 'would already have answered, in any wording or with another person, place or object: set every item on a different case.'
    + (topics.length ? `\nQ5 topics: ${topics.join('; ')}.\nEvery Q6 situation must need a DIFFERENT topic from every Q5 topic above, `
      + 'not only different words, people or places: a story about one of these topics restates a Q5 item.' : '');
}

// Spare items asked of a short held slot on a top-up, beyond the ones it is missing.
const SPARE_ITEMS = 4;
// Every short slot of the section, held or not: a slot that is not held against Section A (A's Q1,
// D's Q6) is only told to write nothing it keeps.
function keptNotes(P, section, examJson, cross, shortfall) {
  const out = [];
  for (const slot of section.slots) {
    const gap = (Array.isArray(shortfall) ? shortfall : []).find((f) => f && f.slot === slot.slot);
    if (!gap || !(gap.missing > 0)) continue;
    const label = slot.label_en || slot.slot.split('.').pop();
    const lines = itemsOf(examJson, slot.slot).map((q) => `- ${q.question.trim()} → ${keyText(q).trim()}`);
    // A slot the reply left empty is named where the reply carries it: «Q4 needs 1 more» alone came
    // back with no "Mind Map" twice. A one-item composition is asked for once, never with spares.
    if (!lines.length && slot.generate === 1) {
      out.push(`Your reply had no ${label} at all. Write exactly one ${label} item, under "unseen" → "${slot.category}" → "${slot.type}", `
        + `with "slot": "${slot.slot}"; keep every other item of this section as it was.`);
      continue;
    }
    const tests = cross.held.includes(slot.slot) ? `neither Section A nor ${label}'s kept items test` : `${label}'s kept items do not test`;
    out.push(`${lines.length ? `${label} already keeps these items (question → answer):\n${lines.join('\n')}\nNever write any of these again, in any wording. ` : ''}`
      + `${label} needs ${gap.missing} more: write ${gap.missing + SPARE_ITEMS} new ${label} items, each testing a fact that ${tests}; the paper takes the first ${gap.missing} that are new.`);
  }
  return out;
}
// Urdu Section A on a top-up: each short held slot's kept items and their keys. The re-ask writes
// the section's full count (no spare count asked), so the paper has a new item for every twin it holds.
// A top-up asks for spares beyond what it needs, at least two and half the gap rounded up (a top-up
// for seven wrote three twins of kept facts): an item the layout holds inside the re-ask then takes a
// spare's place.
const urduSpares = (missing) => Math.max(2, Math.ceil(missing / 2));
function urduKeptNotes(section, examJson, shortfall) {
  const out = [];
  for (const slot of section.slots) {
    const gap = (Array.isArray(shortfall) ? shortfall : []).find((f) => f && f.slot === slot.slot);
    if (!gap || !(gap.missing > 0)) continue;
    const label = slot.label_en || slot.slot.split('.').pop();
    const kept = itemsOf(examJson, slot.slot).filter((q) => keyText(q).trim());
    if (!kept.length) continue;
    const keys = [...new Set(kept.map((q) => keyText(q).trim().replace(/\s*\n\s*/g, '; ')))];
    out.push(`${label} already keeps these items (question → answer):\n${kept.map((q) => `- ${q.question.trim()} → ${keyText(q).trim()}`).join('\n')}\n`
      + `Never write any of these again, in any wording, and never key a new item on any of these answers: ${keys.join('، ')}\n`
      + `${label} needs ${gap.missing} more. Write ${gap.missing + urduSpares(gap.missing)} new items: the paper takes the first ${gap.missing} of your items that test a fact none of these tests.`);
  }
  return out;
}

// Urdu Section C top-up with Q5 short: the words Q3 keeps, so the new Q5 asks none of them.
function q3Note(section, examJson, shortfall) {
  const short = (Array.isArray(shortfall) ? shortfall : []).some((f) => f && f.slot === 'urdu.C.Q5' && f.missing > 0);
  if (!short || !section.slots.some((s) => s.slot === 'urdu.C.Q5')) return null;
  const words = [];
  for (const types of Object.values((examJson && examJson.unseen) || {})) {
    for (const list of Object.values(types || {})) {
      if (Array.isArray(list)) list.filter((q) => q && q.slot === 'urdu.C.Q3' && Array.isArray(q.words)).forEach((q) => words.push(...q.words.filter((w) => typeof w === 'string' && w.trim()).map((w) => w.trim())));
    }
  }
  return words.length ? `Q3 of this paper asks the meaning of these words: ${words.join('، ')}\nQ5's words and idioms never include any of them: each word on the paper is asked in one place.` : null;
}

// Urdu Section C top-up for a short Q4: the kinds it is missing, and the kinds it already has.
function q4Note(section, examJson, shortfall) {
  const short = (Array.isArray(shortfall) ? shortfall : []).some((f) => f && f.slot === 'urdu.C.Q4' && f.missing > 0);
  if (!short || !section.slots.some((s) => s.slot === 'urdu.C.Q4')) return null;
  const have = new Set(itemsOf(examJson, 'urdu.C.Q4').map(q4Kind).filter((k) => k >= 0));
  const missing = Q4_KINDS.filter((_, k) => !have.has(k)).map(([, label]) => label);
  if (!missing.length) return null;
  const kept = Q4_KINDS.filter((_, k) => have.has(k)).map(([, label]) => label);
  return `Q4 needs one item of each kind it is missing: ${missing.join('، ')}. Write only that kind, under its own heading.`
    + (kept.length ? `\nQ4 already has (never write these again): ${kept.join('، ')}.` : '');
}

// Urdu on one story: how many more Q1 items may ask a fact of the story, from the count the layout
// recorded (`_layout.story_items`), when Q1 is short.
function storyNote(section, examJson, shortfall) {
  const n = examJson && examJson._layout && examJson._layout.story_items;
  const short = (Array.isArray(shortfall) ? shortfall : []).some((f) => f && f.slot === 'urdu.A.Q1' && f.missing > 0);
  if (!Number.isInteger(n) || !short || !section.slots.some((s) => s.slot === 'urdu.A.Q1')) return null;
  const rest = 'from the lessons\' word lists, word meanings, idioms or the poem, and give it its "source"';
  return n >= STORY_ITEMS
    ? `Story items are used up: Q1 already asks ${n} facts of the story. Write every new Q1 item ${rest}.`
    : `Q1 keeps ${n} story items: at most ${STORY_ITEMS - n} new Q1 items may ask a fact of the story; write the others ${rest}.`;
}

/**
 * takenNote(P, section, examJson) → string | null
 *
 * What the engine's one re-ask of `section` is told, from the first layout (`examJson`): the
 * facts the slot its items are held against already tests. Social Studies C/D: Section A's
 * questions and answers (and D: the Q5 items, and its own items `opts.held` names, from
 * applyLayout's `held`). English A: Q4's words. Urdu A: Q4's questions and answers, Q3/Q5's
 * words and Q6's verse, and on a top-up the Q1 items it keeps with their keys. Null for any
 * other section or subject, so no
 * other prompt changes.
 */
function takenNote(P, section, examJson, opts = {}) {
  const cross = P && CROSS_HOLD[P.key];
  if (!cross || !section || !Array.isArray(section.slots)) return null;
  if (!section.slots.some((s) => cross.held.includes(s.slot))) {
    // Social Studies: a top-up of a section with no held slot (A's Q1) is told what each short slot keeps.
    // Urdu: a Section C top-up for a Q5 held for a Q3 word is told Q3's words.
    if (P.key === 'urdu' && opts.topUp) return [q3Note(section, examJson, opts.shortfall), q4Note(section, examJson, opts.shortfall)].filter(Boolean).join('\n\n') || null;
    if (P.key !== 'social_studies' || !opts.topUp) return null;
    const kept = keptNotes(P, section, examJson, cross, opts.shortfall);
    const back = backNote(section, examJson, opts.held);
    const notes = back ? [back, ...kept] : kept;
    return notes.length ? notes.join('\n\n') : null;
  }
  const against = [];
  for (const branch of ['seen', 'unseen']) {
    for (const types of Object.values((examJson && examJson[branch]) || {})) {
      for (const list of Object.values(types || {})) {
        if (Array.isArray(list)) against.push(...list.filter((q) => q && [].concat(cross.against).includes(q.slot)));
      }
    }
  }
  if (P.key === 'english') {
    const words = against.flatMap((q) => (Array.isArray(q.words) ? q.words : [])).filter((w) => typeof w === 'string' && w.trim());
    if (!words.length) return null;
    return `Q4 of this paper asks the child to use these words in sentences: ${words.map((w) => w.trim()).join(', ')}. `
      + 'No item you write in this section may use any of these words, in its stem or in its options.';
  }
  if (P.key === 'urdu') {
    // A Q4 stem can carry its options on the lines below it; the first line is the question. The
    // answers Q4 also accepts are named too: an MCQ keyed on one of them is held as well.
    const also = (q) => [...new Set(acceptOf(q).map((a) => a.trim()).filter((a) => a && plain(a) !== plain(keyText(q))))];
    const asked = against.filter((q) => q.slot === 'urdu.C.Q4' && typeof q.question === 'string' && q.question.trim() && keyText(q).trim())
      .map((q) => `- ${q.question.trim().split('\n')[0].trim()} → ${keyText(q).trim().replace(/\s*\n\s*/g, '; ')}`
        + (also(q).length ? ` (also accepted: ${also(q).join('; ')})` : ''));
    const notes = asked.length ? [`Q4 of this paper already asks these (question → answer):\n${asked.join('\n')}\n`
      + 'No MCQ you write in this section may be keyed on any of these answers or ask any of these again.'] : [];
    // Q3 and Q5's words, and Q6's verse, are printed in Section C: an MCQ on them gives C away.
    const words = [...new Set(against.filter((q) => q.slot === 'urdu.C.Q3' || q.slot === 'urdu.C.Q5')
      .flatMap((q) => (Array.isArray(q.words) ? q.words : [])).filter((w) => typeof w === 'string' && w.trim()).map((w) => w.trim()))];
    if (words.length) {
      notes.push(`Q3 and Q5 of this paper ask the meaning of, or a sentence with, these words: ${words.join('، ')}\n`
        + 'No MCQ you write in this section may ask the meaning of any of these words, or be keyed on their meaning.');
    }
    const verses = against.filter((q) => q.slot === 'urdu.C.Q6').flatMap((q) => verseLines(q.passage).lines);
    if (verses.length) {
      notes.push(`Q6 of this paper prints these verses:\n${verses.join('\n')}\n`
        + 'No MCQ you write in this section may ask about these verses or be answered from them.');
    }
    // A top-up keeps the first reply's Q1 items: name them and their keys, or the re-ask writes a
    // whole Section A again and its first items ask kept facts under new stems, keyed the same.
    // Its count is the section's own, so a held twin's place goes to the next new item.
    if (opts.topUp) notes.push(...urduKeptNotes(section, examJson, opts.shortfall));
    const story = opts.topUp && storyNote(section, examJson, opts.shortfall);
    if (story) notes.push(story);
    return notes.length ? notes.join('\n\n') : null;
  }
  const facts = against.filter((q) => typeof q.question === 'string' && q.question.trim())
    .map((q) => `- ${q.question.trim()} → ${keyText(q).trim()}`);
  const notes = facts.length ? [`Section A of this paper already asks these questions (question → answer):\n${facts.join('\n')}\n`
    + 'Never ask any of these facts again, in any wording: every question you write here must test something Section A does not.'] : [];
  // Section D's re-ask is told the Q5 items on the paper now, with their points (its first ask was
  // told C's first reply, firstAskNote).
  if (section.slots.some((s) => s.slot.startsWith('social_studies.D.'))) {
    const note = q5Note(itemsOf(examJson, Q5_SLOT));
    if (note) notes.push(note);
    // And the items of its own the layout set aside, with what they answer: a re-ask told only what
    // was kept writes the same restatement again.
    const aside = heldNote(section, opts.held);
    if (aside) notes.push(aside);
    const recall = recallNote(section, opts.held);
    if (recall) notes.push(recall);
    const ownKey = (Array.isArray(opts.held) ? opts.held : []).filter((h) => h && h.slot === Q7_SLOT && h.rule === 'key_in_own_stem' && h.q && typeof h.q.question === 'string');
    if (ownKey.length) {
      notes.push(`These Q7 items were set aside: each prints its own answer in its question:\n${ownKey.map(({ q }) => `- ${q.question.trim()} → ${keyText(q).trim()}`).join('\n')}\n`
        + 'A Q7 asks one fact its question does not say.');
    }
    // A D stem that prints a Q1 answer gives that Q1 item away (Section A is then asked again).
    const keys = [...new Set(against.map((q) => keyText(q).trim()).filter(Boolean))];
    if (keys.length) notes.push(`Never print any of these Section A answers in a stem you write (as a name, a date, a number or a term): ${keys.join('، ')}`);
  }
  // A top-up keeps the first reply's items: name what each short held slot keeps, and ask for spares,
  // since the refill is held against Section A as well.
  if (opts.topUp) notes.push(...keptNotes(P, section, examJson, cross, opts.shortfall));
  return notes.length ? notes.join('\n\n') : null;
}

module.exports = {
  Q5_SLOT, q5Note, takenNote,
};
