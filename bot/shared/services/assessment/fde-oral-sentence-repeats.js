'use strict';
/**
 * A heard oral sentence the written paper prints (bd-5jmnfj.4.58.4). v28 G2 Urdu's oral poem line 9 and its
 * answer «بلبل گانا گائے گی» were the written Q4 i sentence «بلبل گانا گائے گی۔». A listening task's script lines and
 * answers must not be a sentence a written stem (or sub-question stem) prints, as a whole sentence after
 * punctuation is stripped. The flag lands on the written item, which the writer re-asks: the poem is quoted
 * from the book and is not rewritten.
 *
 * Pure: reads the exam JSON; same flag shape as fde-answer-repeats, `with: ['oral-poem']`.
 */

const WORD = /[\p{L}\p{M}\p{N}]+/gu;
const norm = (s) => (String(s == null ? '' : s).normalize('NFC').toLowerCase().match(WORD) || []).join(' ');
// A stem may hold several sentences; each is matched on its own as well as the stem whole.
const sentencesOf = (s) => [String(s == null ? '' : s)].concat(String(s == null ? '' : s).split(/[۔.؟?!\n]+/)).map(norm).filter((n) => n.split(' ').length >= 3);

function heardSentences(oral) {
  const ids = new Set(((oral && oral.tasks) || []).filter((t) => t.kind === 'listening').map((t) => t.id));
  return ((oral && oral.content) || []).filter((c) => ids.has(c.id)).flatMap((c) => String(c.script || '').split('\n')
    .concat((c.items || []).map((it) => it && it.answer))).map((s) => ({ raw: String(s || '').replace(/[۔.\s]+$/, '').trim(), key: norm(s) })).filter((s) => s.key.split(' ').length >= 3);
}

function writtenItems(examJson) {
  const list = [];
  ['seen', 'unseen'].forEach((b) => Object.values(examJson[b] || {}).forEach((types) => Object.values(types || {}).forEach((l) => {
    if (Array.isArray(l)) list.push(...l.filter(Boolean));
  })));
  return list;
}

/** `{slot, reason:'giveaway', words, with:['oral-poem'], text, printed:true}` for each written item printing a heard oral sentence. */
function oralSentenceRepeats(examJson) {
  const heard = examJson && examJson._layout ? heardSentences(examJson._layout.oral) : [];
  if (!heard.length) return [];
  const out = new Map();
  writtenItems(examJson).forEach((q) => {
    const stems = [q.question].concat(Array.isArray(q.questions) ? q.questions.map((s) => s && s.question) : []).flatMap(sentencesOf);
    heard.filter((h) => stems.includes(h.key)).forEach((h) => {
      const r = out.get(q.slot) || { slot: q.slot, reason: 'giveaway', words: [], with: ['oral-poem'], text: ['the oral poem'], printed: true };
      if (!r.words.includes(h.raw)) r.words.push(h.raw);
      out.set(q.slot, r);
    });
  });
  return [...out.values()];
}

module.exports = { oralSentenceRepeats };
