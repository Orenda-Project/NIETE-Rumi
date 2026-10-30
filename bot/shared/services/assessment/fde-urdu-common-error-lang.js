'use strict';
/**
 * v37r6 G1 Urdu key (bd-5jmnfj.4.58.9.3): common-error lines came back as English templates around an Urdu word
 * («choosing ریل», «writing بندرنی»). The teacher key is Urdu, so each known template is rewritten in Urdu. A line that
 * still holds Latin letters after the rules is kept and noted, never guessed at.
 * Pure: takes an exam and returns {examJson, notes}; never throws.
 */

const URDU_SLOT = /(^|\.)urdu\./i;
const LATIN = /[A-Za-z]/;
const W = '([^A-Za-z]+?)';
const RULES = [
  [new RegExp(`^writing ${W} instead of ${W}$`, 'i'), (m) => `«${m[2]}» کی جگہ «${m[1]}» لکھ دینا`],
  [new RegExp(`^writing ${W} without ${W}$`, 'i'), (m) => `«${m[2]}» کے بغیر «${m[1]}» لکھ دینا`],
  [new RegExp(`^writing a similar word such as ${W}$`, 'i'), (m) => `ملتا جلتا لفظ لکھ دینا، جیسے «${m[1]}»`],
  [new RegExp(`^choosing a masculine word such as ${W}$`, 'i'), (m) => `مذکر لفظ چن لینا، جیسے «${m[1]}»`],
  [new RegExp(`^choosing a feminine word such as ${W}$`, 'i'), (m) => `مؤنث لفظ چن لینا، جیسے «${m[1]}»`],
  [/^writing the same word again$/i, () => 'وہی لفظ دوبارہ لکھ دینا'],
  [new RegExp(`^leaving the word unchanged as ${W}$`, 'i'), (m) => `لفظ نہ بدلنا اور «${m[1]}» ہی لکھ دینا`],
  [/^writing the sentences without the speaker'?s name before each turn$/i, () => 'ہر بار بولنے والے کا نام لکھے بغیر جملے لکھ دینا'],
  [/^writing words about things not in the picture$/i, () => 'ان چیزوں کے بارے میں لکھ دینا جو تصویر میں نہیں ہیں'],
  [new RegExp(`^choosing ${W}$`, 'i'), (m) => `«${m[1]}» چن لینا`],
  [new RegExp(`^writing ${W}$`, 'i'), (m) => `«${m[1]}» لکھ دینا`],
];

function rewrite(line) {
  const text = String(line).trim().replace(/[.۔]$/, '');
  for (const [re, make] of RULES) {
    const m = text.match(re);
    if (m) return make(m.map((s) => (s || '').trim()));
  }
  return line;
}

function fixOne(q, notes, slot) {
  if (!q || typeof q !== 'object') return q;
  const own = String(q.slot || slot || '');
  let out = q;
  if (Array.isArray(q.questions)) out = { ...out, questions: q.questions.map((s) => fixOne(s, notes, own)) };
  const ce = q.scheme && q.scheme.common_error;
  if (!URDU_SLOT.test(own) || typeof ce !== 'string' || !LATIN.test(ce)) return out;
  const next = rewrite(ce);
  if (LATIN.test(next)) { notes.push(`${own}: English common-error line kept, no rule fits «${ce}»`); return out; }
  notes.push(`${own}: common error «${ce}» → «${next}»`);
  return { ...out, scheme: { ...q.scheme, common_error: next } };
}

function urduCommonErrors(examJson) {
  const notes = [];
  try {
    if (!examJson || typeof examJson !== 'object') return { examJson, notes };
    const out = { ...examJson };
    for (const branch of ['seen', 'unseen']) {
      const cats = examJson[branch];
      if (!cats || typeof cats !== 'object') continue;
      out[branch] = Object.fromEntries(Object.entries(cats).map(([cat, byType]) => [cat, !byType || typeof byType !== 'object' ? byType
        : Object.fromEntries(Object.entries(byType).map(([type, list]) => [type,
          Array.isArray(list) ? list.map((q) => fixOne(q, notes)) : list]))]));
    }
    return { examJson: out, notes };
  } catch (e) {
    return { examJson, notes };
  }
}

module.exports = { urduCommonErrors };
