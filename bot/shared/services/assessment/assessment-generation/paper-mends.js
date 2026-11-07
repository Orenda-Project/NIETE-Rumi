'use strict';
// Part of assessment-generation.service.js (see its header); split for the 300-line limit, bd-5jmnfj.37.
const { ONE_FIT_RULE, alternativeShortfall, acceptAlternatives } = require('../fde-accept-alternatives'); // two right answers, one keyed (bd-5jmnfj.4.58.9.1)
const { addSpareWord } = require('../fde-word-box-spare'); // bd-5jmnfj.33.7.1: a box still without a spare after the re-ask gets one book word
const { answerRepeats, giveawayNote, stillGivenAway } = require('../fde-answer-repeats');
const { applyLayout, takenNote, firstAskNote, verseLines, scopeLessons, oneStory, STORY_ITEMS } = require('../fde-layout');
const { checkBlueprint, missesSplit, levelDistance, levelNote } = require('../blueprint-check');
const { directedTasks } = require('../fde-directed-tasks'); // bd-5jmnfj.33.2: a do-as-directed item prints its task
const { keyFixes } = require('../fde-g5-key-fixes');
const { logToFile } = require('../../../utils/logger');
const { mathsCheck } = require('../maths-check');
const { mcqArithmetic, mcqNote } = require('../fde-mcq-arithmetic'); // bd-5jmnfj.33.2: a Maths MCQ key is its stem's arithmetic
const { mendG5Urdu, g5UrduShortfall, g5UrduNote } = require('../fde-g5-urdu-mends'); // round 6 G5 Urdu (bd-5jmnfj.4.58.9.1)
const { mendPictureNames } = require('../fde-urdu-r3-checks');
const { mendPlaceDigits } = require('../fde-place-digit'); // a key naming the wrong place digit (v37 G5 Maths Q2 i)
const { mendUrduOpposites } = require('../fde-urdu-r4');
const { mendUrduQ10 } = require('../fde-urdu-g5-checks');
const { midKeyFixes } = require('../fde-mid-key-fixes'); // bd-5jmnfj.33.3: match split, own labels, compare sign, unasked checks, division digits
const { noArrows } = require('../fde-no-arrows');
const { normaliseScheme } = require('../marking-scheme');
const { paragraphLength, lengthNote } = require('../fde-sentence-count'); // bd-5jmnfj.4.58.2
const { urduPunctFixes } = require('../fde-urdu-punct'); // bd-5jmnfj.4.58.3
const { wholeMarks } = require('../fde-whole-marks');
const { SST_Q1 } = require('./held-terms');
const { fail } = require('./models-prompts');
const { _dropProseVerses, _topUp } = require('./poem-sections');
const { TOS, _sectionMessages } = require('./section-calls');
const { _keptBookText, sstStemLevel } = require('./section-write');

// The mends and checks every laid-out paper gets before its pictures: keys, schemes, digits, Urdu
// spelling, the Social Studies level log and the blueprint. Returns the mended paper.
function _mendPaper({ examJson, P, key, model, loaded, poem, requestId, pattern }) {
  const giveaways = answerRepeats(examJson);
  if (giveaways.length) logToFile('[assessment] answers given away', { requestId, pattern, giveaways });
  const lengths = paragraphLength(examJson);
  if (lengths.length) logToFile('[assessment] paragraph length off', { requestId, pattern, lengths });

  const alts = acceptAlternatives(examJson, P); examJson = alts.examJson; // a second true preposition goes to accept (bd-5jmnfj.4.58.9.1)
  if (alts.notes.length) logToFile('[assessment] accept widened', { requestId, pattern, notes: alts.notes });
  const digits = mendPlaceDigits(examJson); examJson = digits.examJson;
  if (digits.notes.length || digits.wrong.length) logToFile('[assessment] place digit', { requestId, pattern, notes: digits.notes, wrong: digits.wrong });
  const q10 = mendUrduQ10(examJson); examJson = q10.examJson; // G5 Urdu Q10: one gender, a real sender, the current year (round 6)
  if (q10.notes.length) logToFile('[assessment] urdu Q10 mended', { requestId, pattern, notes: q10.notes });
  const g5u = mendG5Urdu(examJson); examJson = g5u.examJson; // antonym alternatives, Q10 form lines, a title give-away point, a box key in its box (v37r4 G5 Urdu)
  if (g5u.notes.length) logToFile('[assessment] G5 urdu mended', { requestId, pattern, notes: g5u.notes });
  const pn = mendPictureNames(examJson); examJson = pn.examJson; // G1 Urdu Q10: لڑکی / لڑکا / بچہ, never a name no picture shows
  if (pn.notes.length) logToFile('[assessment] urdu picture names mended', { requestId, pattern, notes: pn.notes });
  const opp = mendUrduOpposites(examJson); examJson = opp.examJson; // G1 Urdu Q8: a keyed opposite takes its true synonym (round 4)
  if (opp.notes.length) logToFile('[assessment] urdu opposites widened', { requestId, pattern, notes: opp.notes });
  const scheme = normaliseScheme(examJson);
  scheme.examJson = wholeMarks(scheme.examJson);
  examJson = noArrows(scheme.examJson); // a quarter mark a teacher cannot award becomes half marks (G5 Urdu Q4); bd-5jmnfj.4.50.1: no arrow in any text a child or teacher reads
  if (scheme.log.length) logToFile('[assessment] scheme normalised', { pattern, notes: scheme.log.slice(0, 50), count: scheme.log.length });
  if (scheme.shortfall.length) {
    throw fail('PATTERN_SHORT_SLOT', 'A question slot came back short.', { shortfall: scheme.shortfall, examJson, model });
  }

  const notesBefore = (examJson._layout.notes || []).length;
  examJson = mathsCheck(examJson, { subject: key }).examJson;
  (examJson._layout.notes || []).slice(notesBefore).forEach((note) => {
    logToFile('[assessment] maths key replaced', { slot: note.slot, n: note.n ?? note.index ?? null, computed: note.computed, model: note.model });
  });
  if (P.g5_rules === false) {
    // Grade 3–4 (bd-5jmnfj.33.2): after the re-ask, a Maths MCQ key still wrong moves to the right option,
    // and an item with no right option has its keyed option rewritten to the computed answer.
    const fixed = mcqArithmetic(examJson, { subject: key, fix: true });
    examJson = fixed.examJson;
    fixed.notes.forEach((note) => logToFile(note.kind === 'key_moved' ? '[assessment] mcq key moved' : '[assessment] mcq option rewritten', { requestId, pattern, ...note }));
    // bd-5jmnfj.33.3 (v31 review): one pair per match item, no own "Q5." label, the true compare sign,
    // no A point for an unasked check, division points naming the digits really used first.
    const mid = midKeyFixes(examJson, { subject: key });
    examJson = mid.examJson;
    mid.notes.forEach((note) => logToFile('[assessment] mid key fixed', { requestId, pattern, ...note }));
    // bd-5jmnfj.33.7.1 (v36): a word box still holding only its answers gets one spare word the chapter already uses.
    const spare = addSpareWord(examJson, P, _keptBookText(loaded.content));
    examJson = spare.examJson;
    spare.notes.forEach((note) => logToFile('[assessment] word box spare added', { requestId, pattern, ...note }));
  }
  const keyed = keyFixes(examJson); // bd-5jmnfj.4.57: paragraph length from the template, no lone-letter syllable split
  examJson = keyed.examJson;
  keyed.notes.forEach((note) => logToFile('[assessment] key fixed', note));
  // Grade 3–4 (bd-5jmnfj.33.2): a do-as-directed item's task (main_question) is printed, as the slot instruction or after the stem.
  const directed = directedTasks(examJson, P);
  examJson = directed.examJson;
  directed.notes.forEach((note) => logToFile('[assessment] directed task printed', { requestId, pattern, ...note }));
  if (key === 'urdu') { // an Urdu option or key carrying a Latin full stop or question mark (v27, bd-5jmnfj.4.58.3)
    const punct = urduPunctFixes(examJson);
    const spelt = require('../fde-urdu-spelling').urduSpelling(punct.examJson); punct.notes.push(...spelt.notes); // bd-5jmnfj.4.58.4
    examJson = spelt.examJson;
    punct.notes.forEach((note) => logToFile('[assessment] urdu punctuation fixed', note));
  }

  // Urdu Q6's verses given from a lesson outside the chosen ones: the paper says where they come from.
  const versesPrinted = Object.values(examJson.unseen || {}).flatMap((t) => Object.values(t || {})).flat()
    .some((q) => q && q.slot === 'urdu.C.Q6' && typeof q.passage === 'string' && q.passage.trim());
  if (key === 'urdu' && poem && versesPrinted) examJson._layout.verse_source = { lesson: poem.unit, pages: poem.pages };

  // Social Studies: how Q1 came out by thinking level, against the counts its prompt asks for. The levels are
  // the model's own tags, so this is a steer to read in the log, never a gate.
  if (key === 'social_studies') {
    const q1 = Object.values(examJson.unseen || {}).flatMap((t) => Object.values(t || {})).flat().filter((q) => q && q.slot === SST_Q1);
    const n = (level) => q1.filter((q) => q.blooms === level).length;
    const [remember, understand, apply] = [n('Remember'), n('Understand'), n('Apply')];
    const byStem = { remember: 0, understand: 0, apply: 0 };
    q1.forEach((q) => { byStem[sstStemLevel(q)] += 1; });
    logToFile('[assessment] q1 levels', {
      requestId, pattern, remember, understand, apply, untagged: q1.length - remember - understand - apply,
      meets: remember === 8 && understand === 6 && apply === 6, by_stem: byStem,
    });
  }

  // Report-only: what the paper carries against its pattern and FDE's split; it never fails a paper.
  const sectionLevels = P.sections.every((s) => s.levels) ? Object.fromEntries(P.sections.map((s) => [s.id, s.levels])) : null;
  const blueprint = checkBlueprint(examJson, { tos: P.tos || TOS[key] || null, sectionLevels });
  examJson._layout.blueprint = blueprint;
  // Islamiat's Nazra sheet (bd-5jmnfj.39.1): every task is the teacher's to fill, so no content is written.
  if (P.oral) examJson._layout.oral = { ...P.oral, content: [] };
  logToFile('[assessment] blueprint checked', { pattern, subject: key, ok: blueprint.ok, total: blueprint.total, levels: blueprint.levels, problems: blueprint.problems });
  return examJson;
}

// Urdu or Social Studies Section A still short after its re-ask is topped up once more, for exactly
// what it misses plus spares; the topped-up reply goes into `results`.
async function _topUpSectionA({ key, built, merged, P, layoutScope, layOpts, results, extraUsages, writeOne, system, model, requestId, pattern, versesRef }) {
  const sstA = key === 'social_studies';
  const a = key === 'urdu' || sstA ? built.find(({ section }) => section.slots.some((s) => s.slot === `${key}.A.Q1`)) : null;
  const check = a && applyLayout(merged(), P, layoutScope, layOpts(false));
  const shortA = check ? check.shortfall.filter((f) => a.section.slots.some((s) => s.slot === f.slot)) : [];
  if (shortA.length) {
    logToFile('[assessment] section topped up again', { requestId, pattern, section: a.section.id, shortfall: shortA, ...(check.held ? { held: check.held } : {}) });
    const i = results.findIndex((r) => r.id === a.section.id);
    const first = results[i];
    extraUsages.push(...first.usages);
    const note = takenNote(P, a.section, check.examJson, { topUp: true, shortfall: shortA, ...(sstA ? { held: check.held } : {}) });
    const second = await writeOne(note
      ? { ...a, messages: _sectionMessages({ system, user: `${a.user}\n\n${note}`, pageContent: a.pageContent, model }) }
      : a);
    results[i] = { ...second, tree: _topUp(first.tree, second.tree, new Set(shortA.map((f) => f.slot))) };
    _dropProseVerses(results[i].tree, versesRef, requestId);
  }
}

module.exports = {
  _mendPaper, _topUpSectionA,
};
