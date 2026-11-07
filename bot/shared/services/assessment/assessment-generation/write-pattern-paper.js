'use strict';
// Part of assessment-generation.service.js (see its header); split for the 300-line limit, bd-5jmnfj.37.
const BoardPatterns = require('../patterns/board');
const Patterns = require('../patterns');
const Reader = require('../fde-reader');
const StemCheck = require('../fde-stem-check');
const { answerRepeats, giveawayNote, stillGivenAway } = require('../fde-answer-repeats');
const { applyLayout, takenNote, firstAskNote, verseLines, scopeLessons, oneStory, STORY_ITEMS } = require('../fde-layout');
const { configForRequest, ensureCurrent } = require('../../../config/model-settings');
const { logToFile } = require('../../../utils/logger');
const { mcqArithmetic, mcqNote } = require('../fde-mcq-arithmetic'); // bd-5jmnfj.33.2: a Maths MCQ key is its stem's arithmetic
const { resolveModelForJob } = require('../../../config/model-registry');
const { scienceGiverFlags } = require('../fde-science-giveaway-drop'); // G5 Science: a give-away item never ships (v37 round 8)
const { settleScienceGivers } = require('../fde-science-mcq-reask'); // a kept Section A giver is re-asked alone (v37r4)
const { writeBoardPaper } = require('../board-writer');
const { writeEarlyPaper } = require('../fde-early-writer');
const { normaliseAnswers } = require('./answers-generate');
const { countQuestions, stripImageKeys } = require('./marks-answers');
const { URDU_MEDIUM, buildSystemPrompt, canonical, fail, patternModel } = require('./models-prompts');
const { _mendPaper, _topUpSectionA } = require('./paper-mends');
const { _boardDeps, _earlyDeps, _failIfShort, _firstShortfall, _logHeldRows, _reasker, _stemCheck, _writeSections } = require('./paper-phases');
const { buildPatternUserPrompt } = require('./pattern-prompt');
const { _dropProseVerses, _emptyQuestionParts, _heldNorm, _loadPatternPoem, _mergeSections, _sectionText, _versesReference } = require('./poem-sections');
const { _readerPass } = require('./reader-pass');
const { _readerPassSst, _reaskQuoted, _topUpGrammarUsedUp } = require('./reader-sst-reasks');
const { READ_SLOT, _grammarUsedUp, _loadPatternContent, religiousFilter } = require('./religious-reader');
const { _sectionMessages, _warmSharedPrefixes } = require('./section-calls');
const { _blankWordsStems, _keptBookText, _religiousHits, _reviewTextHits, _sumUsage, _writeSection } = require('./section-write');

async function _writePatternPaper({ grade, subject, pattern, scope = null, pageRanges = null, chapterNumber = null, onSection = null, requestId = null, readerPass = false, stemCheck = false, levelNote: splitNote = null }) {
  const startedAt = Date.now();
  if (BoardPatterns.isBoard(pattern)) {
    if (!BoardPatterns.isEligible(pattern, grade, subject)) {
      throw fail('PATTERN_INELIGIBLE', 'That board pattern is not available for this grade and subject.', { pattern, grade, subject });
    }
    const P = BoardPatterns.subjectOf(pattern, subject);
    return writeBoardPaper({ grade, subject, pattern, P, scope, pageRanges, chapterNumber, onSection, requestId }, _boardDeps(subject));
  }
  const def = Patterns.get(pattern);
  const key = Patterns.normalise(subject);
  const P = def && def.subjects[key];
  if (!P || !Patterns.isEligible(pattern, grade, subject)) {
    throw fail('PATTERN_INELIGIBLE', 'That board pattern is not available for this grade and subject.', { pattern, grade, subject });
  }
  // Grades 1-2 (bd-5jmnfj.4): whole-book papers with pictures and an oral part, written on their own path.
  if (def.profile === 'early') return writeEarlyPaper({ grade, subject, pattern, P, onSection, requestId }, _earlyDeps(subject));

  const loaded = await _loadPatternContent({ grade, subject, P, scope, pageRanges, chapterNumber });
  const layoutScope = scope || (chapterNumber != null && !pageRanges
    ? { kind: 'chapters', chapters: [Number(chapterNumber)], pages: null }
    : { kind: 'pages', chapters: null, pages: pageRanges });
  const sectionRanges = (Patterns.scopeFor(pattern, subject) || {}).section_ranges || {};
  const poem = await _loadPatternPoem({ grade, subject, P, scope: layoutScope, pageContent: loaded.content });

  const family = URDU_MEDIUM.has(canonical(subject) || 'eng') ? 'urdu' : 'eng';
  if (typeof ensureCurrent === 'function') await ensureCurrent();
  const { model, job } = patternModel(family);
  const ownModel = resolveModelForJob('assessment.generate', { family }).model;
  const system = buildSystemPrompt({ subject, includeAnswerKey: true });

  const built = P.sections.map((section) => {
    const text = _sectionText(section, loaded, layoutScope.kind, sectionRanges[section.id]);
    const prompt = buildPatternUserPrompt({
      grade, subject, pageContent: text.content, pageReference: text.pageReference,
      section, slots: section.slots, lang: P.medium, P, scope: layoutScope, poem,
    });
    // A per-section note (bd-5jmnfj.19) is keyed by section id; the paper-level one is a string.
    const note = splitNote && typeof splitNote === 'object' ? splitNote[section.id] : splitNote;
    const user = prompt + (note ? `\n\n${note}` : '');
    const messages = _sectionMessages({ system, user, pageContent: text.content, model });
    return { section, messages, user, pageContent: text.content };
  });
  // Awaited, so the sections that follow read what it wrote. Empty off the direct lane.
  const warmUsages = await _warmSharedPrefixes({ built, model, job, requestId, pattern });

  const writeOne = async ({ section, messages }) => {
    const began = Date.now();
    const { tree, usages } = await _writeSection({ messages, model, ownModel, job, pattern, section });
    const usage = _sumUsage(usages);
    const elapsedMs = Date.now() - began;
    const slots = section.slots.map((s) => s.slot);
    logToFile('[assessment] generating', {
      requestId, pattern, section: section.id, slots, model, usage, cost: usage.cost ?? null,
      cachedTokens: usage.cached_tokens ?? 0, elapsedMs,
    });
    if (onSection) {
      try { await onSection(section.id); } catch (err) { logToFile('[assessment] section progress not recorded', { section: section.id, error: err.message }); }
    }
    return { id: section.id, slots, usage, elapsedMs, tree, usages };
  };
  // Social Studies: Section D is written after Section C's first reply, told C's Q5 items and their
  // marking points, so its first Q6s are not C's cases again; A and B are still written beside C.
  const iC = key === 'social_studies' ? built.findIndex((b) => b.section.slots.some((s) => s.slot === 'social_studies.C.Q5')) : -1;
  const iD = iC >= 0 ? built.findIndex((b) => b.section.slots.some((s) => s.slot === 'social_studies.D.Q6')) : -1;
  const results = await _writeSections({ built, writeOne, P, iD, iC, system, model, requestId, pattern });
  // Urdu Q6: verses that are not the poem's are taken out before the layout, so Section C is asked again.
  const versesRef = key === 'urdu' ? _versesReference(P, poem, loaded.content) : '';
  results.forEach((r) => _dropProseVerses(r.tree, versesRef, requestId));
  const now = new Date().toISOString();
  // Social Studies' layout reads the pages the prompts were given (two Q1 items from one passage; a Q6 that is the book's list).
  const layOpts = (reasked) => ({ now, presetId: pattern, reasked, ...(key === 'social_studies' ? { book: loaded.content } : {}) });
  const merged = () => {
    const tree = _mergeSections(results.map((r) => r.tree));
    stripImageKeys(tree);
    normaliseAnswers(tree);
    return tree;
  };

  // A section that came back short is asked once more before the paper fails: the usual hole
  // is one whole block of a section (Maths C's Q4–8), and the same call usually comes back
  // whole. Decided on the reply as the model wrote it, BEFORE the held-content filter, so an
  // item the filter drops is still never refilled.
  const firstLaid = applyLayout(merged(), P, layoutScope, layOpts(false));
  // Social Studies always returns `held` (Section D reads it) and logs its own rows per rule after the last layout.
  if (firstLaid.held && key !== 'social_studies') logToFile('[assessment] held items', { requestId, pattern, held: firstLaid.held });
  const layoutShort = new Set(firstLaid.shortfall.map((f) => f.slot));
  // Grade 3–4 Maths (bd-5jmnfj.33.2): an MCQ whose stem's arithmetic matches no option sends its section back once.
  const mcqShort = P.g5_rules === false ? mcqArithmetic(firstLaid.examJson, { subject: key }).shortfall : [];
  if (mcqShort.length) logToFile('[assessment] mcq no correct option', { requestId, pattern, items: mcqShort });
  const short = _firstShortfall(firstLaid, P, key, loaded.content, mcqShort);
  const shortSlots = new Set(short.map((f) => f.slot));
  // An item carrying text the paper refuses to print (a review mark the model copied) fails the
  // paper at render; its section is asked once more instead, and a second hit fails it here.
  const reviewHits = _reviewTextHits(results);
  // Urdu: a section whose model text carries an authored religious maxim is asked once more; a
  // second hit is held by religiousFilter below and the slot is short.
  const religiousHits = key === 'urdu' ? _religiousHits(results, _heldNorm(_keptBookText(loaded.content))) : new Map();
  const again = built.filter(({ section }) => section.slots.some((s) => shortSlots.has(s.slot))
    || reviewHits.has(section.id) || religiousHits.has(section.id));
  const extraUsages = [];
  if (again.length) {
    // One re-ask of `b`: its note reads the layout `laid`; `shortList` names the short slots and
    // `layoutShortSet` the ones short only because the layout set items aside.
    const reask = _reasker({ results, extraUsages, writeOne, system, model, key, P, requestId, pattern, reviewHits, religiousHits, versesRef });
    // Social Studies: Section D's re-ask is told Q5's situations and its Q6 is held against Q5, so
    // when C is asked again too, D waits for C and reads the layout of C's second reply. A D that
    // was full but now restates a new Q5 is asked again as well.
    const inSection = (b, id) => b.section.slots.some((s) => s.slot.startsWith(`social_studies.${id}.`));
    const afterC = key === 'social_studies' && again.some((b) => inSection(b, 'C'));
    await Promise.all(again.filter((b) => !(afterC && inSection(b, 'D')))
      .map((b) => reask(b, firstLaid, short, layoutShort)));
    if (afterC) {
      const midLaid = applyLayout(merged(), P, layoutScope, layOpts(false));
      const midShort = new Set(midLaid.shortfall.map((f) => f.slot));
      const otherShort = short.filter((f) => !firstLaid.shortfall.includes(f));
      // A D that C's second reply left whole (the Q5 its Q6 restated is gone) keeps its first reply;
      // only a D still short, or with a review or religious hit, is asked again.
      const later = built.filter((b) => inSection(b, 'D')
        && (b.section.slots.some((s) => midShort.has(s.slot) || otherShort.some((f) => f.slot === s.slot))
          || reviewHits.has(b.section.id) || religiousHits.has(b.section.id)));
      await Promise.all(later.map((b) => reask(b, midLaid, otherShort.concat(midLaid.shortfall), midShort)));
    }
    // Social Studies: a D item the layout still sets aside never prints, so before the paper is laid
    // out D is asked once more, a top-up told what was held. A slot still short of a held item after it
    // prints fewer items when it is a choice (applyLayout).
    if (key === 'social_studies' && iD >= 0) {
      const preLaid = applyLayout(merged(), P, layoutScope, layOpts(false));
      const dShort = preLaid.shortfall.filter((f) => f.slot.startsWith('social_studies.D.') && preLaid.held.some((h) => h.slot === f.slot));
      if (dShort.length) {
        logToFile('[assessment] D asked once more', {
          requestId, pattern, shortfall: dShort, held: preLaid.held.filter((h) => dShort.some((f) => f.slot === h.slot)).map((h) => ({ slot: h.slot, rule: h.rule })),
        });
        await reask(built[iD], preLaid, dShort, new Set(dShort.map((f) => f.slot)));
      }
    }
    // Urdu Section A still short after its re-ask (the top-up's own items held as twins of kept
    // facts, or a new hold against the re-asked Section C) is topped up once more, for exactly what
    // it misses plus spares: a held Section C give-away is never put back to fill the place.
    // Social Studies likewise: a Q1 item a C or D stem gives away is held against the C and D stems
    // as they finally stand, and Q1 is compulsory, so the place is refilled rather than the paper failed.
    await _topUpSectionA({ key, built, merged, P, layoutScope, layOpts, results, extraUsages, writeOne, system, model, requestId, pattern, versesRef });
    // A re-asked reply is checked again: a give-away still there is asked once more, naming the words.
    // Only when the first check found one: a paper with none is not laid out again for this.
    const lateLaid = short.some((f) => f.reason === 'giveaway') ? applyLayout(merged(), P, layoutScope, { now, presetId: pattern, reasked: true }) : null;
    const late = lateLaid ? stillGivenAway(lateLaid.examJson).concat(key === 'science' ? scienceGiverFlags(lateLaid.examJson) : []) : [];
    const reaskGiveaways = async (flags, flagsLaid) => {
      const lateBuilt = built.filter(({ section }) => section.slots.some((s) => flags.some((f) => f.slot === s.slot)));
      for (const b of lateBuilt) {
        await reask(b, flagsLaid, flags, new Set());
      }
      // That reply is taken whole, after the Section A top-up above, so a section it left short is
      // topped up once for exactly what it misses (v24 G5 Urdu, bd-5jmnfj.4.54).
      const afterLate = lateBuilt.length ? applyLayout(merged(), P, layoutScope, { now, presetId: pattern, reasked: true }) : null;
      for (const b of lateBuilt) {
        const mine = afterLate.shortfall.filter((f) => b.section.slots.some((s) => s.slot === f.slot));
        if (!mine.length) continue;
        logToFile('[assessment] section topped up after give-away', { requestId, pattern, section: b.section.id, shortfall: mine });
        await reask(b, afterLate, mine, new Set(mine.map((f) => f.slot)));
      }
      return afterLate;
    };
    // A give-away a child can see, still there after that, is asked exactly once more. A repeat never costs the
    // teacher a paper: one still there after this ships and is logged below (bd-5jmnfj.4.55).
    const lastLaid = late.length ? await reaskGiveaways(late, lateLaid) : null;
    if (lastLaid) await reaskGiveaways(stillGivenAway(lastLaid.examJson).concat(key === 'science' ? scienceGiverFlags(lastLaid.examJson) : []).filter((f) => f.printed), lastLaid);
    const still = _reviewTextHits(results);
    if (still.size) {
      throw fail('REVIEW_TEXT', 'A question carries text that must never print.', { sections: [...still.keys()], examJson: merged(), model });
    }
  }

  // Layout first, so the filter sees every item under its pattern slot; a drop
  // then lays the paper out again, and the emptied place is a shortfall — the
  // extras the model wrote were already set aside and never fill it.
  let examJson = merged();
  let laid = applyLayout(examJson, P, layoutScope, layOpts(again.length > 0));
  const firstUnplaced = laid.unplaced;
  examJson = laid.examJson;
  _blankWordsStems(examJson, P, key);
  const quotes = [];
  const dropped = await religiousFilter(examJson, P, { grade, subject, allowedText: loaded.content, requestId, quotes });
  if (dropped.length) {
    laid = applyLayout(examJson, P, layoutScope, layOpts(again.length > 0));
    examJson = laid.examJson;
  }
  // Urdu: a place the lessons 1–3 filter emptied is asked again once, told the run it matched.
  if (quotes.length && laid.shortfall.length) {
    const re = await _reaskQuoted({
      examJson, laid, quotes, P, key, layoutScope, now, pattern, built, writeOne, system, model, loaded, grade, subject, requestId, versesRef,
    });
    examJson = re.examJson;
    laid = re.laid;
    extraUsages.push(...re.usages);
  }
  // Urdu: Q1 still short after the re-asks is topped up once more, told grammar is used up.
  if (_grammarUsedUp(P, layoutScope, laid) && laid.shortfall.length && laid.shortfall.every((f) => f.slot === READ_SLOT)) {
    const re = await _topUpGrammarUsedUp({
      examJson, laid, P, key, layoutScope, now, pattern, built, writeOne, system, model, loaded, grade, subject, requestId, versesRef,
    });
    examJson = re.examJson;
    laid = re.laid;
    extraUsages.push(...re.usages);
  }
  // Social Studies: every item the layout set aside, by slot and rule (a repeat of a placed item
  // among them), and how many were put back.
  _logHeldRows(laid, key, requestId, pattern);
  // The reader pass reads a whole paper only: a short one fails below as it always has.
  if (readerPass && Reader.READER_SUBJECTS.includes(key) && !laid.shortfall.length && !_emptyQuestionParts(examJson).length) {
    const read = await (key === 'social_studies' ? _readerPassSst : _readerPass)({
      examJson, source: key === 'social_studies' ? merged() : null, P, key, layoutScope, now, pattern, built, writeOne, system, model, ownModel, job, loaded, grade, subject, requestId,
    });
    examJson = read.examJson;
    if (read.laid) laid = read.laid;
    extraUsages.push(...read.usages);
  }
  const layout = { placed: laid.placed, unplaced: firstUnplaced };
  logToFile('[assessment] layout applied', {
    requestId, pattern, placed: layout.placed, unplaced: layout.unplaced, totalMarks: examJson._layout.total_marks,
    sections: P.sections.map((s) => s.id), dropped: dropped.length, shortfall: laid.shortfall,
    ...(laid.putBack && laid.putBack.length ? { putBack: laid.putBack } : {}),
    // The final layout's holds (Urdu Q1 on chosen lessons): the held-items line above is the first
    // layout's only, and a re-ask, a top-up or the reader pass lays the paper out again.
    ...(laid.held ? { held: laid.held } : {}),
  });
  // A failed paper keeps what the model wrote and which model wrote it (on the error, for the
  // row), so the failure can be read afterwards instead of guessed at.
  _failIfShort(laid, examJson, model);
  // The stem check (bd-5jmnfj.22): one read of the whole paper for a question that does not make sense.
  if (stemCheck && StemCheck.STEM_CHECK_SUBJECTS.includes(key)) {
    examJson = await _stemCheck({ examJson, P, model, ownModel, job, usages: extraUsages, requestId, pattern });
  }
  // An answer word still given away after the re-asks is logged, not failed: the teacher still gets a paper (bd-5jmnfj.4.55).
  if (key === 'science') { // after the re-asks, a giver is taken off only where the slot keeps its count; never a failed paper (v37 round 8)
    const bA = built.find((x) => x.section.slots.some((s) => s.slot === 'science.A.Q1a')); // a giver with no spare is re-asked alone
    const askA = async (note) => { const r = await writeOne({ ...bA, messages: _sectionMessages({ system, user: `${bA.user}\n\n${note}`, pageContent: bA.pageContent, model }) }); stripImageKeys(r.tree); normaliseAnswers(r.tree); return r.tree; };
    examJson = (await settleScienceGivers(examJson, { spares: ((firstLaid && firstLaid.held) || []).map((h) => h && h.q), ask: bA ? askA : null, log: (m, d) => logToFile(m, { requestId, pattern, ...d }) })).examJson;
  }
  examJson = _mendPaper({ examJson, P, key, model, loaded, poem, requestId, pattern });

  // G5 Urdu Q7 / English Q10: a drawn scene in the frame from the item's `describe_en` (v24 review).
  // A failed drawing never fails the paper: the item keeps today's empty frame.
  try {
    await require('../fde-pictures').resolveFramePictures(examJson);
  } catch (err) {
    logToFile('[assessment] frame pictures skipped', { requestId, pattern, error: err.message });
  }

  // The warm call is billed like any other, so it is in the paper's totals.
  const all = _sumUsage(warmUsages.concat(extraUsages, results.flatMap((r) => r.usages)));
  return {
    examJson,
    questionCount: countQuestions(examJson),
    tokenData: { inputTokens: all.prompt_tokens, outputTokens: all.completion_tokens, totalTokens: all.total_tokens, cost: all.cost, model },
    pageReference: loaded.pageReference,
    chapterTitle: null,
    sections: results.map(({ id, slots, usage, elapsedMs }) => ({ id, slots, usage, elapsedMs })),
    elapsedMs: Date.now() - startedAt,
    layout,
  };
}

module.exports = {
  _writePatternPaper,
};
