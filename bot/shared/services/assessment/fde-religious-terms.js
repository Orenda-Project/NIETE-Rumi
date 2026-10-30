'use strict';
/**
 * Prayers and supplications in Urdu text the model wrote itself (v34 blocker, bd-5jmnfj.4.58): a G2 Topic
 * Sentences model answer ended with a supplication the model composed. The term list is matched on text
 * normalised the way the service's _heldNorm does (diacritics out; ي/ى, ك, ہ forms and آ/أ/إ folded), so the
 * patterns below are written in that folded form. «اللہ» is held as a bare word: names that join or follow
 * it (عبداللہ, ثناء اللہ, اللہ دتہ) are not.
 *
 * Pure: exam JSON in, shortfalls `{slot, reason:'answer', items}` out. The note only asks for the sentence's removal.
 */

const NAME_BEFORE = '(?<!(?:عبد|ثناء|ثنا|حبیب|ولی|نور|فضل|رحمت|برکت) ?)';
const NAME_AFTER = '(?! ?(?:دتہ|بخش|رکھا|یار))';
const ALLAH = `${NAME_BEFORE}اللہ${NAME_AFTER}`;

const SUPPLICATION_TERMS = Object.freeze([
  { term: 'امین ثم امین', pattern: 'امین ثم امین' },
  { term: 'ان شاء اللہ', pattern: 'ان ?شا?ء? ?اللہ|انشاء ?اللہ|[Ii]nsha(?:llah|\'?[Aa]llah)' },
  { term: 'ماشاء اللہ', pattern: 'ما ?شا?ء? ?اللہ|[Mm]asha(?:llah|\'?[Aa]llah)' },
  { term: 'الحمد للہ', pattern: 'الحمد ?للہ|[Aa]lhamdulillah' },
  { term: 'سبحان اللہ', pattern: 'سبحان ?اللہ' },
  { term: 'اللہ حافظ', pattern: 'اللہ حافظ' },
  { term: 'خدا حافظ', pattern: 'خدا حافظ' },
  { term: 'یا اللہ', pattern: 'یا اللہ' },
  { term: 'یا رب', pattern: 'یا رب' },
  { term: 'امین', pattern: 'امین|[Aa]meen' },
  { term: 'دعا', pattern: 'دعا(?:ئیں|ئے|ؤں|یں)?' },
  { term: 'اللہ', pattern: ALLAH },
  { term: 'خدا', pattern: 'خدا(?! ?بخش)' },
  { term: 'may Allah', pattern: '[Mm]ay (?:Allah|God)' },
  { term: 'pray that', pattern: '[Pp]ray that' },
  { term: 'prayer', pattern: '[Pp]rayers?' },
]);

// Grade 3-5 hold (assessment-generation.service HELD_TERMS_URDU_AUTHORED): that path has always let a letter's
// «دعا», «اللہ تعالیٰ کرے» and «ان شاء اللہ» through (operator-allowed, pinned by its tests), so it takes the fixed
// phrases plus a bare «اللہ» followed by a wish verb in the same sentence, not the broad single words.
const BROAD = new Set(['دعا', 'خدا', 'امین', 'اللہ', 'ان شاء اللہ']);
const WISH = { term: 'اللہ (wish)', pattern: `${ALLAH}(?! تعالی)[^۔.!?؟]{0,40}?(?:رکھے|فرمائے|بنائے|بخشے|عطا فرما|کرے|دے)` };
const SUPPLICATION_HELD = Object.freeze(SUPPLICATION_TERMS.filter((e) => !BROAD.has(e.term)).concat(WISH));

const COMPILED = SUPPLICATION_TERMS.map((e) => ({
  entry: e, re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${e.pattern})(?![\\p{L}\\p{N}])`, 'u'),
}));

const fold = (t) => String(t == null ? '' : t).normalize('NFC')
  .replace(/[ً-ْٰؗ-ؚۖ-ۭـ​-‏⁠﻿]/g, '')
  .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[ةۃهۂۀ]/g, 'ہ').replace(/[آأإٱ]/g, 'ا')
  .replace(/\s+/g, ' ');

/** The first supplication term `text` carries, or null. */
function supplicationOf(text) {
  const s = fold(text);
  const hit = COMPILED.find(({ re }) => re.test(s));
  return hit ? hit.entry : null;
}

function modelTexts(q, withQuestion) {
  const out = [];
  const add = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === 'object') Object.values(v).forEach(add);
  };
  const mcq = Array.isArray(q.options) && q.options.length > 0;
  if (!mcq) add(q.answer);
  add(q.passage);
  add(q.accept);
  add(q.scheme);
  if (withQuestion) add(q.question);
  return out;
}

/** Urdu items whose model-written text carries a prayer or supplication, as `{slot, reason:'answer', items}`. */
function supplicationShortfall(examJson, P) {
  if (P && P.key === 'islamiat') return [];
  const types = new Map(((P && P.sections) || []).flatMap((s) => s.slots || []).map((sl) => [sl.slot, sl.type]));
  const bySlot = new Map();
  ['seen', 'unseen'].forEach((branch) => Object.values((examJson && examJson[branch]) || {}).forEach((cats) => {
    Object.values(cats || {}).forEach((list) => {
      if (!Array.isArray(list)) return;
      list.forEach((q) => {
        const slot = String((q && q.slot) || '');
        if (!/\.urdu\./.test(slot) || /\.islamiat\./.test(slot)) return;
        const ownPassage = /passage|comprehension/i.test(String(types.get(slot) || ''));
        if (!modelTexts(q, ownPassage).some(supplicationOf)) return;
        if (!bySlot.has(slot)) bySlot.set(slot, []);
        bySlot.get(slot).push(`${String(q.question).trim()} → ${String(q.answer).trim()} (the model-written text carries a prayer or supplication; remove that sentence)`);
      });
    });
  }));
  return [...bySlot].map(([slot, items]) => ({ slot, reason: 'answer', items }));
}

module.exports = { SUPPLICATION_TERMS, SUPPLICATION_HELD, supplicationOf, supplicationShortfall };
