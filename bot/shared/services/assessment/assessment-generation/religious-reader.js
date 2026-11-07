'use strict';
// Part of assessment-generation.service.js (see its header); split for the 300-line limit, bd-5jmnfj.37.
const Patterns = require('../patterns');
const Reader = require('../fde-reader');
const { applyLayout, takenNote, firstAskNote, verseLines, scopeLessons, oneStory, STORY_ITEMS } = require('../fde-layout');
const { correctMisreads } = require('../fde-urdu-nonword'); // a stored-text misread in Urdu book text (bd-5jmnfj.4.58.9.3)
const { extractJsonFromResponse } = require('../assessment-json.util');
const { getClient, getClientForModel } = require('../../llm-client');
const { logToFile } = require('../../../utils/logger');
const { BookContent } = require('./answers-generate');
const { fail } = require('./models-prompts');
const { HELD_PAGES, HELD_SHINGLE, RULE } = require('./pattern-rules');
const { _flat, _heldNorm, _textsOf } = require('./poem-sections');
const { _authoredReligiousOf, _heldTermOf, _keptBookText, _urduStringsOf } = require('./section-write');

/** Drop every item `held(q)` names, logging each; returns [{ slot, reason, ... }]. */
function _dropHeld(examJson, held, requestId = null) {
  const dropped = [];
  for (const branch of ['seen', 'unseen']) {
    const tree = examJson && examJson[branch];
    if (!tree || typeof tree !== 'object') continue;
    for (const types of Object.values(tree)) {
      if (!types || typeof types !== 'object') continue;
      for (const [type, list] of Object.entries(types)) {
        if (!Array.isArray(list)) continue;
        types[type] = list.filter((q) => {
          if (!q || typeof q !== 'object') return true;
          const why = held(q);
          if (!why) return true;
          // The kind (the reply's own type key) and, for a quote, the run that matched: one log line
          // then says whether a drop was a real quote or a phrase the held lessons share with others.
          const { match, ...reason } = why;
          const hit = { slot: q.slot || null, ...reason };
          dropped.push(hit);
          const line = { ...hit, kind: type, ...(match ? { match } : {}) };
          logToFile('[assessment] held item dropped', requestId ? { requestId, ...line } : line);
          return false;
        });
      }
    }
  }
  return dropped;
}

/**
 * Urdu: drop every item that quotes lessons 1–3 (book pp 1–27: the Hamd,
 * the Naat and the third lesson). The prompt already says so; this makes it
 * true when the model forgets. A quote is any run of 24 characters or more
 * from those pages, whitespace collapsed. The pages are loaded each time the filter runs.
 * Social Studies: drop every item that names a religious text (HELD_TERMS_SST).
 * The emptied place is a shortfall. Urdu: a place a quote emptied is asked again once by the caller
 * (`quotes` collects each matched run for that re-ask's note); a second quote fails the paper.
 * Mutates the tree; returns what was dropped, [{ slot, reason }] (plus `term` for Social Studies).
 */
async function religiousFilter(examJson, P, { grade, subject, allowedText = '', requestId = null, quotes = null } = {}) {
  const key = (P && P.key) || Patterns.normalise(subject);
  if (key === 'social_studies') {
    return _dropHeld(examJson, (q) => {
      const term = _heldTermOf(q);
      return term ? { reason: 'religious_text', term } : null;
    }, requestId);
  }
  if (key !== 'urdu') return [];
  const held = await BookContent().loadPageRangeContent({ grade, subject, pageRanges: HELD_PAGES });
  const text = _flat(String(held.content || '').replace(/=== Page \d+ ===/g, ' '));
  const shingles = new Set();
  for (let i = 0; i + HELD_SHINGLE <= text.length; i += 1) shingles.add(text.slice(i, i + HELD_SHINGLE));
  // A short run of Urdu is two or three words, so stock exercise wording ("answer the
  // questions below") sits on the held pages AND in the lessons the paper is set from. Only
  // what the held lessons alone contain marks an item as quoting them; a shared phrase never
  // drops a good item and fails the paper as a short slot.
  const kept = _keptBookText(allowedText);
  // The pattern's own Urdu (instructions, closed lists, rules) is what the model is told to
  // copy, and a held lesson's exercise can print the same instruction: never a quote.
  const allowedTexts = [kept, ..._urduStringsOf(P)];
  for (const allowed of allowedTexts) {
    for (let i = 0; i + HELD_SHINGLE <= allowed.length; i += 1) shingles.delete(allowed.slice(i, i + HELD_SHINGLE));
  }

  // The first run of the held pages an item carries, or null.
  const quoteOf = (q) => {
    for (const t of _textsOf(q)) {
      const s = _flat(t);
      for (let i = 0; i + HELD_SHINGLE <= s.length; i += 1) {
        const run = s.slice(i, i + HELD_SHINGLE);
        if (shingles.has(run)) return run;
      }
    }
    return null;
  };

  // A religious maxim, hadith or act of worship the model wrote into an answer, passage or scheme.
  const book = _heldNorm(kept);
  return _dropHeld(examJson, (q) => {
    const match = quoteOf(q);
    if (match) {
      // The caller's re-ask is told the run, so it writes the place again without it.
      if (Array.isArray(quotes)) quotes.push({ slot: q.slot || null, match });
      return { reason: 'lesson_1_3', match };
    }
    const term = _authoredReligiousOf(q, book);
    return term ? { reason: 'authored_religious', term } : null;
  }, requestId);
}

/** Where a pattern paper's pages come from: the pattern's syllabus, the job's pages, or a chapter. */
async function _loadPatternContent({ grade, subject, P, scope, pageRanges, chapterNumber }) {
  const pages = scope && scope.kind === 'fde' ? P.scope.page_ranges : (pageRanges || (scope && scope.pages) || null);
  // A known stored-text misread (دیکے for the printed دمکے) is mended before any writer reads it (bd-5jmnfj.4.58.9.3).
  if (pages) return correctMisreads(await BookContent().loadPageRangeContent({ grade, subject, pageRanges: pages })).value;
  if (chapterNumber != null) return correctMisreads(await BookContent().loadChapterContent({ grade, subject, chapterNumber })).value;
  throw fail('NO_CONTENT', 'No pages were given for this paper.');
}

// ── The reader pass (Urdu) ─────────────────────────────────────────────
//
// After the final layout, one call reads the question paper as the child sees it, with Q1's keys
// beside it, and names the Q1 items a child could answer from text printed elsewhere on it. Those
// are held, Section A is asked for replacements, the paper is laid out again, and the reader
// checks the replacements against the whole paper. A caught item never prints: a place still empty
// after one more top-up fails the paper closed (PATTERN_SHORT_SLOT, the record on the paper).
// Runs only when the caller says so (the reader setting, read by the orchestrator) and only for
// READER_SUBJECTS. A failed READ (a timeout, a reply with no candidates) keeps the paper as it was:
// the reader erroring never fails a paper that prints without it.
const READER_TIMEOUT_MS = 120000;
// The longest recorded read wrote 3,768 tokens (reasoning included); a cut-off read skips the pass.
const READER_MAX_TOKENS = 8000;
// High. At low effort eight recorded papers read 8, 8, 7 and 6 of 8 give-aways. At medium the model
// may skip thinking altogether (0 reasoning tokens on 48 of 48 reads in one session), and it then
// misses the by-meaning shapes. High thought on 64 of 64 reads and found 12 of 12, twice.
const READER_REASONING = { effort: 'high' };
const READ_SLOT = 'urdu.A.Q1';
// The Section A top-ups a reader pass may run: the first, and one more for a place the first leaves.
const READER_TOP_UPS = 2;

const _readerId = (q) => `${_flat(q && q.question)}\u0001${Reader.keyOf(q || {})}`;

// A copy of the paper with the given items of one slot taken out.
function _dropItems(examJson, slotId, ids) {
  const out = JSON.parse(JSON.stringify(examJson));
  for (const branch of ['seen', 'unseen']) {
    for (const types of Object.values(out[branch] || {})) {
      for (const [type, list] of Object.entries(types || {})) {
        if (Array.isArray(list)) types[type] = list.filter((q) => !(q && q.slot === slotId && ids.has(_readerId(q))));
      }
    }
  }
  return out;
}

// A copy of the paper with one item added at the end of its slot's list.
function _addItem(examJson, slotId, q) {
  const out = JSON.parse(JSON.stringify(examJson));
  for (const types of Object.values(out.unseen || {})) {
    for (const list of Object.values(types || {})) {
      if (Array.isArray(list) && list.some((x) => x && x.slot === slotId)) { list.push(JSON.parse(JSON.stringify(q))); return out; }
    }
  }
  return out;
}

async function _askReader({ examJson, P, only = null, pages = null, model, ownModel, job, usages, reasoning = READER_REASONING }) {
  const { prompt, labels, only: onlyLabels, blocks, split } = Reader.buildReaderPrompt(examJson, P, { only, pages });
  const response = await getClient().chat.completions.create({
    model,
    job,
    ...(model !== ownModel ? { fallbackModel: ownModel } : {}),
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    response_format: { type: 'json_object' },
    max_tokens: READER_MAX_TOKENS,
    reasoning,
  }, { timeout: READER_TIMEOUT_MS });
  usages.push(response?.usage || {});
  // A client that already parsed the JSON hands back an object: read it, never skip the pass for it.
  const content = response?.choices?.[0]?.message?.content;
  const reply = content && typeof content === 'object' ? content : extractJsonFromResponse(content || '');
  return { flags: Reader.parseFlags(reply, labels, onlyLabels, blocks, { split }), labels };
}

/**
 * Urdu (chosen lessons; the full syllabus when a concept was asked again): a Q1 place the re-asks left empty is never filled with a grammar concept
 * asked again (applyLayout keeps it out). Section A is topped up once more, for what Q1 lacks plus
 * spares, told grammar is used up, and the paper is laid out again; a place still empty fails the
 * paper as a short slot. Runs only when Q1 is the one slot short.
 */
// On the full syllabus only when the layout held a concept asked again: a place left by anything else
// (a lessons 1–3 quote) fails the paper as it did.
const _conceptHeld = (laid) => Boolean(laid && laid.examJson && laid.examJson._layout
  && (laid.examJson._layout.holds || []).some((h) => h.slot === READ_SLOT && h.rule === 'concept_repeat'));
const _grammarUsedUp = (P, scope, laid) => Boolean(P && P.key === 'urdu' && (scopeLessons(P, scope) || _conceptHeld(laid)));
const _grammarUsedUpNote = (P, scope) => (scopeLessons(P, scope) ? RULE.urduGrammarUsedUp : RULE.urduGrammarUsedUpFull);

module.exports = {
  READER_MAX_TOKENS, READER_REASONING, READER_TIMEOUT_MS, READER_TOP_UPS, READ_SLOT, _askReader, _dropItems,
  _grammarUsedUp, _grammarUsedUpNote, _loadPatternContent, _readerId, religiousFilter,
};
