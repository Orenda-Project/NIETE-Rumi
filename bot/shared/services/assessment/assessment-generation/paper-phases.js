'use strict';
// Part of assessment-generation.service.js (see its header); split for the 300-line limit, bd-5jmnfj.37.
const Patterns = require('../patterns');
const StemCheck = require('../fde-stem-check');
const { ONE_FIT_RULE, alternativeShortfall, acceptAlternatives } = require('../fde-accept-alternatives'); // two right answers, one keyed (bd-5jmnfj.4.58.9.1)
const { answerRepeats, giveawayNote, stillGivenAway } = require('../fde-answer-repeats');
const { applyLayout, takenNote, firstAskNote, verseLines, scopeLessons, oneStory, STORY_ITEMS } = require('../fde-layout');
const { configForRequest, ensureCurrent } = require('../../../config/model-settings');
const { extractJsonFromResponse } = require('../assessment-json.util');
const { getClient, getClientForModel } = require('../../llm-client');
const { glyphShortfall, glyphNote } = require('../fde-glyph-check'); // bd-5jmnfj.4.58.7.7
const { keyTruthFlags, keyTruthNote } = require('../fde-key-truth'); // bd-5jmnfj.33.4: key-only terms, plural keys, restating points
const { logToFile } = require('../../../utils/logger');
const { matchRowsShortfall, matchRowsNote } = require('../fde-match-rows'); // bd-5jmnfj.33.5.3: a match item repeats no Column A or Column B entry
const { mcqArithmetic, mcqNote } = require('../fde-mcq-arithmetic'); // bd-5jmnfj.33.2: a Maths MCQ key is its stem's arithmetic
const { mcqKeyNote } = require('../fde-maths-slips');
const { mcqStemShortfall, mcqStemNote } = require('../fde-mcq-stem'); // bd-5jmnfj.33.5: one question per MCQ stem, key not printed in it
const { meaningKeyShortfall, meaningKeyNote } = require('../fde-meaning-key'); // bd-5jmnfj.33.5: a meaning question's key is the meaning
const { mendG5Urdu, g5UrduShortfall, g5UrduNote } = require('../fde-g5-urdu-mends'); // round 6 G5 Urdu (bd-5jmnfj.4.58.9.1)
const { normaliseScheme } = require('../marking-scheme');
const { paragraphLength, lengthNote } = require('../fde-sentence-count'); // bd-5jmnfj.4.58.2
const { placeholderShortfall, placeholderNote } = require('../fde-placeholder-check'); // bd-5jmnfj.4.58.3
const { punctuateShortfall, punctuateNote } = require('../fde-punctuate-check'); // bd-5jmnfj.4.58.4
const { repeatedPoints, repeatedPointsNote } = require('../fde-science-key-points'); // G5 Science: one idea paid as several marks (v37 round 8)
const { resolveModelForJob } = require('../../../config/model-registry');
const { schemeShortfall, schemeNote } = require('../fde-scheme-checks'); // bd-5jmnfj.4.58.7 (shared file with the .4.58 PR)
const { scienceGiverFlags } = require('../fde-science-giveaway-drop'); // G5 Science: a give-away item never ships (v37 round 8)
const { steerNote } = require('../fde-mid-steer'); // bd-5jmnfj.33.2: Grade 3–4 Sections B/C are told Section A's facts
const { wordBoxShortfall, wordBoxNote } = require('../fde-word-box'); // bd-5jmnfj.33.5.2: a fill word box holds a distractor and is shuffled
const { normaliseAnswers } = require('./answers-generate');
const { countQuestions, stripImageKeys } = require('./marks-answers');
const { URDU_MEDIUM, buildSystemPrompt, canonical, fail, patternModel } = require('./models-prompts');
const { buildPatternUserPrompt } = require('./pattern-prompt');
const { _dropProseVerses, _emptyQuestionParts, _mergeSections, _reviewItemList, _sectionText, _shortWhy, _topUp } = require('./poem-sections');
const { READER_MAX_TOKENS, READER_REASONING, READER_TIMEOUT_MS, _loadPatternContent } = require('./religious-reader');
const { _sectionMessages, _warmSharedPrefixes } = require('./section-calls');
const { _keptBookText, _sumUsage, _writeSection } = require('./section-write');

/**
 * A board-pattern paper: one call per section, in parallel, merged and laid out
 * in the pattern's shape. A slot left short after the checks fails the paper
 * (PATTERN_SHORT_SLOT): a board rehearsal missing a question is not one.
 *
 * The job's totalMarks is not read: a pattern fixes its own marks, and the
 * budget trim generateExam applies would cut a slot short.
 */
// `onSection` is called (and awaited, never thrown from) as each section comes back, so the caller
// can mark the paper row as alive: a run of several long calls must not look silent.
/**
 * A board-pattern paper, written once more when it misses FDE's split by level (bd-5jmnfj.18): the
 * second run is told the first paper's split and the target, the nearer paper is returned, and both
 * runs are billed. A second run that fails leaves the first paper. Only when the caller asks
 * (`splitRetry`): the orchestrator does; a direct call writes one paper, as it always has.
 */
// One read of the finished English-medium paper; a failed read keeps the paper as it was.
async function _stemCheck({ examJson, P, model, ownModel, job, usages, requestId, pattern }) {
  const refused = _reviewItemList();
  const ask = async (prompt) => {
    const response = await getClient().chat.completions.create({
      model,
      job,
      ...(model !== ownModel ? { fallbackModel: ownModel } : {}),
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      response_format: { type: 'json_object' },
      max_tokens: READER_MAX_TOKENS,
      reasoning: READER_REASONING,
    }, { timeout: READER_TIMEOUT_MS });
    usages.push(response?.usage || {});
    const content = response?.choices?.[0]?.message?.content;
    return content && typeof content === 'object' ? content : extractJsonFromResponse(content || '');
  };
  try {
    const out = await StemCheck.runStemCheck({ examJson, P, ask, refuses: (t) => refused.some((re) => re.test(t)), grade: (Patterns.get(pattern) || {}).grade });
    out.examJson._layout.stem_check = { flags: out.record };
    logToFile('[assessment] stem check', { requestId, pattern, flags: out.record });
    return out.examJson;
  } catch (err) {
    examJson._layout.stem_check = { failed: err.message };
    logToFile('[assessment] stem check', { requestId, pattern, failed: err.message });
    return examJson;
  }
}

/** The helpers a Grade 1-2 paper is written with (fde-early-writer): this file's own, passed in. */
function _earlyDeps(subject) {
  return {
    family: URDU_MEDIUM.has(canonical(subject) || 'eng') ? 'urdu' : 'eng',
    loadPatternContent: _loadPatternContent,
    ensureCurrent: typeof ensureCurrent === 'function' ? ensureCurrent : null,
    patternModel,
    resolveModelForJob,
    buildSystemPrompt,
    sectionText: _sectionText,
    buildPatternUserPrompt,
    sectionMessages: _sectionMessages,
    warmSharedPrefixes: _warmSharedPrefixes,
    writeSection: _writeSection,
    mergeSections: _mergeSections,
    stripImageKeys,
    normaliseAnswers,
    emptyQuestionParts: _emptyQuestionParts,
    topUp: _topUp,
    sumUsage: _sumUsage,
    countQuestions,
    fail,
    logToFile,
  };
}

/** The helpers a Grade 9-12 board paper is written with (board-writer): the early set plus the G6-12 modules. */
function _boardDeps(subject) {
  const SubjectConfig = require('../subject-config');
  const VariantResolver = require('../patterns/board/variant-resolver');
  const Slo = require('../slo-map');
  return {
    ..._earlyDeps(subject),
    resolveSubject: SubjectConfig.resolve,
    variantFor: (P, { grade }) => VariantResolver.resolve(P, { grade }),
    assemble: require('../prompts-6-12').assemble,
    checks: require('../board-checks'),
    reviewMcqs: true, // round 9: one review call per section, MCQs only (board-6-12/mcq-review)
    sloList: Slo.listFor,
    // Code, never the model, writes the official SLO (slo-map README §4).
    stampSlo: (grade, code, item) => {
      if (item && item.tag && typeof item.tag === 'object') item.tag.official_slo = Slo.officialSloFor(grade, code, item.tag);
      return item;
    },
  };
}

// The sections written in the order the subject needs: Grade 3–4 one after another, each told the ones
// before it; Social Studies D after C's first reply; any other paper all at once.
async function _writeSections({ built, writeOne, P, iD, iC, system, model, requestId, pattern }) {
  let results;
  if (P.g5_rules === false && built.length > 1 && iD < 0) {
    // Grade 3–4 end-of-chapter papers (bd-5jmnfj.33.2): Section A is written first and the other
    // sections are handed its items and answers, so Q4/Q5 do not re-ask Q1's facts. The note is
    // written into `built`, so a re-ask of B or C carries it too.
    // bd-5jmnfj.33.7.2 (v36): B and C written beside each other tested one fact twice (G4 Science Q3/Q5),
    // so each later section is written in turn and told every section before it.
    results = [await writeOne(built[0])];
    for (let i = 1; i < built.length; i += 1) {
      const names = built.slice(0, i).map((b) => b.section.id);
      const label = names.length === 1 ? `Section ${names[0]}` : `Sections ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
      const note = steerNote(_mergeSections(results.map((r) => JSON.parse(JSON.stringify(r.tree)))), label);
      const b = built[i];
      if (note) {
        b.user = `${b.user}\n\n${note}`;
        b.messages = _sectionMessages({ system, user: b.user, pageContent: b.pageContent, model });
      }
      logToFile('[assessment] section steered', { requestId, pattern, section: b.section.id, after: names, steered: Boolean(note), lines: note ? note.split('\n').length : 0 });
      results.push(await writeOne(b));
    }
  } else if (iD < 0) {
    results = await Promise.all(built.map(writeOne));
  } else {
    const writes = built.map((b, i) => (i === iD ? null : writeOne(b)));
    const d = built[iD];
    writes[iD] = writes[iC].then((c) => {
      const note = firstAskNote(P, c.tree);
      return writeOne(note
        ? { ...d, messages: _sectionMessages({ system, user: `${d.user}\n\n${note}`, pageContent: d.pageContent, model }) }
        : d);
    });
    results = await Promise.all(writes);
  }
  return results;
}

// Every reason a section of the first layout is asked again, in the order the re-ask note reads them.
function _firstShortfall(firstLaid, P, key, content, mcqShort) {
  return firstLaid.shortfall
    .concat(normaliseScheme(JSON.parse(JSON.stringify(firstLaid.examJson))).shortfall)
    .concat(_emptyQuestionParts(firstLaid.examJson))
    .concat(answerRepeats(firstLaid.examJson)) // an answer printed in another question (bd-5jmnfj.4.51.3)
    .concat(mcqShort)
    .concat(P.g5_rules === false ? keyTruthFlags(firstLaid.examJson) : [])
    .concat(P.g5_rules === false ? meaningKeyShortfall(firstLaid.examJson, P, _keptBookText(content)) : [])
    .concat(P.g5_rules === false ? mcqStemShortfall(firstLaid.examJson, P) : [])
    .concat(P.g5_rules === false ? wordBoxShortfall(firstLaid.examJson, P) : [])
    .concat(P.g5_rules === false ? matchRowsShortfall(firstLaid.examJson, P) : [])
    .concat(alternativeShortfall(firstLaid.examJson, P)) // a second listed choice that also fits (v35 round 6, bd-5jmnfj.4.58.9.1)
    .concat(paragraphLength(firstLaid.examJson)) // a paragraph model answer off its asked length (bd-5jmnfj.4.58.2)
    .concat(punctuateShortfall(firstLaid.examJson)) // a Punctuation model answer that is not the printed words (v28 G5 English Q3, bd-5jmnfj.4.58.4)
    .concat(key === 'science' ? scienceGiverFlags(firstLaid.examJson) : []) // a giver is asked again with the give-away note
    .concat(key === 'science' ? repeatedPoints(normaliseScheme(JSON.parse(JSON.stringify(firstLaid.examJson))).examJson) : [])
    .concat(schemeShortfall(normaliseScheme(JSON.parse(JSON.stringify(firstLaid.examJson))).examJson, P)) // an open answer without an accept line, a cut-off common_error (v34 G5, bd-5jmnfj.4.58.7)
    .concat(placeholderShortfall(firstLaid.examJson)) // a stem or key left with a template hole (v27 G5 English Q2, bd-5jmnfj.4.58.3)
    .concat(key === 'urdu' ? g5UrduShortfall(firstLaid.examJson) : []) // a «سب سے پہلے» stem keyed with two actions (v37r4 G5 Urdu Q2)
    .concat(glyphShortfall(firstLaid.examJson)); // a U+FFFD or control character in a printed string (v35 G5 Urdu Q4, bd-5jmnfj.4.58.7.7)
}

// One re-ask of a section, for `_writePatternPaper`: `reask(b, laid, shortList, layoutShortSet)` writes
// `b` again and puts the new reply (or the first one topped up from it) into `results`.
function _reasker({ results, extraUsages, writeOne, system, model, key, P, requestId, pattern, reviewHits, religiousHits, versesRef }) {
  return async (b, laid, shortList, layoutShortSet) => {
    const shortfall = shortList.filter((f) => b.section.slots.some((s) => s.slot === f.slot));
    const reviewText = reviewHits.get(b.section.id) || null;
    const religious = religiousHits.get(b.section.id) || null;
    const i = results.findIndex((r) => r.id === b.section.id);
    const first = results[i];
    // Social Studies: why each slot is short, so a re-ask can be read from the log alone: how many
    // items the reply wrote for it, and how many the layout held, by rule.
    const why = key === 'social_studies' ? { why: _shortWhy(shortfall, first.tree, [...(laid.held || []), ...(laid.repeated || [])]) } : {};
    logToFile('[assessment] section re-asked', {
      requestId, pattern, section: b.section.id, shortfall, ...why, ...(reviewText ? { reviewText } : {}), ...(religious ? { religious } : {}),
    });
    extraUsages.push(...first.usages);
    // The re-ask is told what the first replies already test (Section A's facts, Q4's words), so
    // it writes something new instead of the item the layout set aside, again.
    // A slot short only because the layout set items aside (two options of equal value, an item
    // tagged to a full slot) keeps the first reply and takes the missing items from the second:
    // the layout fills a slot in reply order, so the first reply's items land first. Any other
    // re-ask (a part with no marking points, a review mark, a religious maxim) takes the second reply whole.
    const topUp = !reviewText && !religious && shortfall.length && shortfall.every((f) => layoutShortSet.has(f.slot));
    // On a top-up the note also names what the slot keeps, and asks for spares.
    const note = [takenNote(P, b.section, laid.examJson, { topUp: Boolean(topUp), shortfall, held: laid.held }), giveawayNote(shortfall), mcqNote(shortfall, P), keyTruthNote(shortfall), mcqKeyNote(shortfall), meaningKeyNote(shortfall), mcqStemNote(shortfall), wordBoxNote(shortfall), matchRowsNote(shortfall), schemeNote(shortfall), lengthNote(shortfall), placeholderNote(shortfall), punctuateNote(shortfall), repeatedPointsNote(shortfall), glyphNote(shortfall), g5UrduNote(shortfall)]
      .filter(Boolean).join('\n\n');
    const second = await writeOne(note
      ? { ...b, messages: _sectionMessages({ system, user: `${b.user}\n\n${note}`, pageContent: b.pageContent, model }) }
      : b);
    results[i] = topUp ? { ...second, tree: _topUp(first.tree, second.tree, new Set(shortfall.map((f) => f.slot))) } : second;
    _dropProseVerses(results[i].tree, versesRef, requestId);
  };
}

// Social Studies: every item the layout set aside, by slot and rule, and how many were put back.
function _logHeldRows(laid, key, requestId, pattern) {
  if (key === 'social_studies' && ((laid.held && laid.held.length) || (laid.repeated && laid.repeated.length))) {
    const rows = new Map();
    for (const h of [...(laid.held || []), ...(laid.repeated || [])]) {
      const row = rows.get(`${h.slot}|${h.rule}`) || { slot: h.slot, rule: h.rule, held: 0, printed: 0 };
      row.held += 1;
      if (h.printed) row.printed += 1;
      rows.set(`${h.slot}|${h.rule}`, row);
    }
    logToFile('[assessment] held items', { requestId, pattern, held: [...rows.values()], ...(laid.shortChoice && laid.shortChoice.length ? { shortChoice: laid.shortChoice } : {}) });
  }
}

// A paper still short of a slot, a part or a printable stem fails, keeping what the model wrote.
function _failIfShort(laid, examJson, model) {
  if (laid.shortfall.length) {
    throw fail('PATTERN_SHORT_SLOT', 'A question slot came back short.', { shortfall: laid.shortfall, examJson, model });
  }
  const emptyParts = _emptyQuestionParts(examJson);
  if (emptyParts.length) {
    throw fail('PATTERN_SHORT_SLOT', 'A question slot came back short.', { shortfall: emptyParts, examJson, model });
  }
  // A template hole still printed after the re-ask fails the paper: no child reads "[Insert word]" (bd-5jmnfj.4.58.3).
  const placeholders = placeholderShortfall(examJson).concat(punctuateShortfall(examJson), glyphShortfall(examJson));
  if (placeholders.length) {
    throw fail('PATTERN_SHORT_SLOT', 'A question slot came back short.', { shortfall: placeholders, examJson, model });
  }
}

module.exports = {
  _boardDeps, _earlyDeps, _failIfShort, _firstShortfall, _logHeldRows, _reasker, _stemCheck, _writeSections,
};
