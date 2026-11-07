'use strict';
// Part of assessment-generation.service.js (see its header); split for the 300-line limit, bd-5jmnfj.37.
const Patterns = require('../patterns');
const { extractJsonFromResponse } = require('../assessment-json.util');
const { getClient, getClientForModel } = require('../../llm-client');
const { logToFile } = require('../../../utils/logger');
const { HELD_TERMS_URDU_AUTHORED } = require('./held-terms');
const { _walkQuestions } = require('./marks-answers');
const { _isEmptyReply, fail } = require('./models-prompts');
const { _splitPages } = require('./pattern-prompt');
const { HELD_PAGES, HELD_SHINGLE, HELD_TERMS_SST } = require('./pattern-rules');
const { _flat, _heldNorm, _reviewItemList, _textsOf } = require('./poem-sections');
const { SECTION_REASONING, SECTION_TIMEOUT_MS, sectionMaxTokens } = require('./section-calls');

/** Section id → the first refused marker one of its items carries. */
function _reviewTextHits(results) {
  const list = _reviewItemList();
  const hits = new Map();
  for (const r of results) {
    _walkQuestions(r.tree, (q) => {
      if (hits.has(r.id)) return;
      // The marking scheme prints too, so its text is read with the item's.
      const texts = _textsOf(q);
      const walk = (v) => {
        if (typeof v === 'string') texts.push(v);
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') Object.values(v).forEach(walk);
      };
      walk(q.scheme);
      for (const t of texts) {
        const re = list.find((x) => x.test(t));
        if (re) { hits.set(r.id, { slot: q.slot || null, marker: String(re) }); return; }
      }
    });
  }
  return hits;
}

/**
 * One section's call: one retry on an empty reply or unreadable JSON, none on a
 * cut-off reply (the same reply again) or a failed call (an outage). Returns the
 * section's tree and every call's usage, so the tokens add up to what was billed.
 */
async function _writeSection({ messages, model, ownModel, job = 'assessment.generate', pattern, section }) {
  const ask = () => getClient().chat.completions.create({
    model,
    job,
    ...(model !== ownModel ? { fallbackModel: ownModel } : {}),
    messages,
    temperature: 0.7,
    response_format: { type: 'json_object' },
    max_tokens: sectionMaxTokens(section),
    reasoning: SECTION_REASONING,
  }, { timeout: SECTION_TIMEOUT_MS });

  const usages = [];
  for (let attempt = 1; ; attempt += 1) {
    let response;
    try {
      response = await ask();
    } catch (err) {
      logToFile('[assessment] model call failed', { model, pattern, section: section.id, error: err.message });
      throw fail('MODEL_UNAVAILABLE', 'The question writer is unavailable right now.', { cause: err.message });
    }
    usages.push(response?.usage || {});
    const choice = response?.choices?.[0] || {};
    const raw = choice.message?.content || '';

    if (_isEmptyReply(response)) {
      if (attempt < 2) {
        logToFile('[assessment] empty reply, retrying once', { model, pattern, section: section.id });
        continue;
      }
      throw fail('BAD_JSON', 'The question writer returned something we could not read.', { section: section.id });
    }
    if (!raw && choice.finish_reason === 'length') {
      logToFile('[assessment] model ran out of room', { model, pattern, section: section.id, usage: response.usage });
      throw fail('TRUNCATED', 'That was too much to write in one go — try fewer questions.', { usage: response.usage, section: section.id });
    }
    try {
      return { tree: extractJsonFromResponse(raw), usages };
    } catch (err) {
      if (choice.finish_reason === 'length') {
        logToFile('[assessment] model ran out of room', { model, pattern, section: section.id, usage: response.usage, partial: true });
        throw fail('TRUNCATED', 'That was too much to write in one go — try fewer questions.', { usage: response.usage, section: section.id });
      }
      logToFile('[assessment] model returned unusable JSON', {
        model, pattern, section: section.id, attempt, error: err.message, preview: raw.slice(0, 300),
      });
      if (attempt >= 2) {
        throw fail('BAD_JSON', 'The question writer returned something we could not read.', { cause: err.message, section: section.id });
      }
    }
  }
}

function _sumUsage(usages) {
  const sum = (k, of = (u) => u && u[k]) => {
    const vals = usages.map(of).filter((v) => v != null);
    return vals.length ? vals.reduce((s, v) => s + Number(v), 0) : null;
  };
  // Prompt tokens served from a cache, where the lane reports them (already inside prompt_tokens).
  const cached = sum('cached_tokens', (u) => u && u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens);
  return {
    prompt_tokens: sum('prompt_tokens'), completion_tokens: sum('completion_tokens'), total_tokens: sum('total_tokens'), cost: sum('cost'),
    cached_tokens: cached,
  };
}

function _inRanges(page, ranges) {
  return Patterns.parseRanges(ranges).some(([a, b]) => page >= a && page <= b);
}

/** Every Urdu-script string the subject's pattern data carries, whitespace collapsed. */
function _urduStringsOf(P) {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') { if (/[\u0600-\u06FF]/.test(v)) out.push(_flat(v)); } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(P);
  return out;
}

// Social Studies Q1 read by its stem, beside the model's own level tags (which a reader agreed with on two
// items in three): a case put to the child, then a question asking what to do or whom to turn to, is Apply;
// a stem that asks why, the difference, the use or the importance is Understand; any other is Remember.
// A definition told as a case («… اس نظام کو کیا کہتے ہیں؟») asks for a name, so it is Remember. A steer for
// the log, never a gate.
// An instruction to the child («وضاحت کریں», «بیان کریں») decides nothing.
const STEM_DECIDES = /چاہیے|چاہئے|(?<!(?:وضاحت|بیان|تحریر|واضح)\s*)(?:کرے|کریں)|رابطہ|فیصلہ|منتخب|کیا کرنا|کس سے|مدد/;
const STEM_EXPLAINS = /کیوں|وجہ|فرق|اہمیت|فائدہ|فوائد|مقصد|ضروری|کیسے|کس لیے|وضاحت|بیان کریں/;
function sstStemLevel(q) {
  const stem = String((q && q.question) || '');
  const sentences = stem.split(/[۔؟?!:\n]+/).map((x) => x.trim()).filter(Boolean);
  const asked = sentences[sentences.length - 1] || '';
  if ((sentences.length >= 2 || /^\s*(?:اگر|فرض کریں)\s/.test(stem)) && STEM_DECIDES.test(asked)) return 'apply';
  if (STEM_EXPLAINS.test(stem)) return 'understand';
  return 'remember';
}

/** The first held term a Social Studies item names (its marking scheme included), or null. */
function _heldTermOf(q) {
  const texts = [..._textsOf(q)];
  if (q.scheme && typeof q.scheme === 'object') texts.push(..._textsOf({ parts: q.scheme }));
  for (const t of texts) {
    const s = _heldNorm(t);
    const hit = HELD_TERMS_SST.find(({ re }) => re.test(s));
    if (hit) return hit.term;
  }
  return null;
}

/**
 * The text an item carries that the model wrote as its own: answers, passages, `accept`, the scheme.
 * An MCQ's answer is one of its options, which are read with the stem, so it is not model prose.
 */
function _modelTextsOf(q) {
  const out = [];
  const add = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === 'object') Object.values(v).forEach(add);
  };
  const visit = (o) => {
    if (!o || typeof o !== 'object') return;
    const mcq = Array.isArray(o.options) && o.options.length > 0;
    ['answer', 'passage', 'accept', 'scheme'].forEach((k) => { if (!(mcq && k === 'answer')) add(o[k]); });
    ['parts', 'questions'].forEach((k) => { if (Array.isArray(o[k])) o[k].forEach(visit); });
  };
  visit(q);
  return out;
}

/** Whether the match at `at` (length `len`) in `s` sits in a run of HELD_SHINGLE characters `book` prints. */
function _quotesBook(s, at, len, book) {
  if (!book) return false;
  if (s.length <= HELD_SHINGLE || len >= HELD_SHINGLE) return book.includes(s.length <= HELD_SHINGLE ? s : s.slice(at, at + len));
  for (let i = Math.max(0, at + len - HELD_SHINGLE); i <= Math.min(at, s.length - HELD_SHINGLE); i += 1) {
    if (book.includes(s.slice(i, i + HELD_SHINGLE))) return true;
  }
  return false;
}

/**
 * Urdu: the first held term (HELD_TERMS_URDU_AUTHORED) an item's own model text carries, or null.
 * `book` is the paper's book text, _heldNorm'd: a term inside a run the book prints is the book's.
 */
function _authoredReligiousOf(q, book) {
  for (const t of _modelTextsOf(q)) {
    const s = _heldNorm(t);
    for (const { term, re } of HELD_TERMS_URDU_AUTHORED) {
      for (const m of s.matchAll(new RegExp(re.source, 'gu'))) {
        if (!_quotesBook(s, m.index, m[0].length, book)) return term;
      }
    }
  }
  return null;
}

/** The book text a paper is set from, the held pages (lessons 1–3) left out, whitespace collapsed. */
function _keptBookText(allowedText) {
  // The held pages themselves never count as allowed, even when the teacher's chapters reach into them.
  const pages = _splitPages(allowedText);
  const kept = pages ? pages.filter((pg) => !_inRanges(pg.page, HELD_PAGES)).map((pg) => pg.text).join(' ') : allowedText;
  return _flat(String(kept || '').replace(/=== Page \d+ ===/g, ' '));
}

/** Section id → the first authored religious term one of its Urdu items carries ({ slot, term }). */
function _religiousHits(results, book) {
  const hits = new Map();
  for (const r of results) {
    _walkQuestions(r.tree, (q) => {
      if (hits.has(r.id)) return;
      const term = _authoredReligiousOf(q, book);
      if (term) hits.set(r.id, { slot: q.slot || null, term });
    });
  }
  return hits;
}

/**
 * Urdu: an item of a printed-word-list slot (`shape: 'words'`, `print_words`) whose FDE instruction
 * takes no {q} prints FDE's instruction and the list; a `question` the model wrote for it only says
 * the instruction again. That restatement is stock exercise wording the held lessons also print, so
 * the held-lessons filter would read it as a quote and drop the item: it is emptied first.
 * Every other slot, and every other subject, keeps its question. Mutates the tree.
 */
function _blankWordsStems(examJson, P, key) {
  if (key !== 'urdu' || !P || !Array.isArray(P.sections)) return;
  const blank = new Set();
  for (const sec of P.sections) {
    for (const s of sec.slots || []) {
      if (s.shape === 'words' && s.print_words && !/\{q\}/.test(s.instruction_ur || '')) blank.add(s.slot);
    }
  }
  _walkQuestions(examJson, (q) => {
    if (blank.has(q.slot) && typeof q.question === 'string' && q.question) q.question = '';
  });
}

module.exports = {
  _authoredReligiousOf, _blankWordsStems, _heldTermOf, _keptBookText, _religiousHits, _reviewTextHits,
  _sumUsage, _urduStringsOf, _writeSection, sstStemLevel,
};
