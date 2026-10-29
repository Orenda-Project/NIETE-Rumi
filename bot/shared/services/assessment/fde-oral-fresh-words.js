'use strict';
/**
 * Oral reading words the written paper already prints (bd-5jmnfj.4.58.4). v28 G1 Urdu read «چاند», «چڑیا», «روٹی»
 * and «سچ» aloud from the card, and the same four are printed on the written paper (Q1 i, iv, ix and the Q5 word
 * box). fde-answer-repeats flags them and the writer asks the oral part again twice; a model that returns them a
 * third time shipped them. This is the last step: each Urdu read-aloud word still flagged is replaced in code by
 * the first word of BANK that the paper prints nowhere and the card does not already carry.
 *
 * Pure: {examJson, notes}; the input is not changed. A word with no bank word left stays, and the writer's
 * giveaway log names it.
 */

const { answerRepeats } = require('./fde-answer-repeats');

// Grade 1 book words of two to four letters, easy to read large; none rude or religious.
const BANK = ['آم', 'باغ', 'قلم', 'ناک', 'کان', 'ہاتھ', 'دودھ', 'جوتا', 'ٹوپی', 'تارا', 'پنکھا', 'مرچ', 'نمک', 'بادل',
  'پتنگ', 'چمچ', 'تالا', 'سورج', 'ہوا', 'دال', 'گھاس', 'مکھی', 'بکری', 'کیلا', 'انڈا', 'مور', 'بطخ', 'کتاب', 'بستہ', 'میز'];
const ARABIC = /[؀-ۿ]/;
const WORD = /[\p{L}\p{M}]+/gu;
const wordsOf = (s) => String(s == null ? '' : s).normalize('NFC').match(WORD) || [];

const readAloudItems = (ex) => {
  const oral = ex && ex._layout && ex._layout.oral;
  if (!oral || !Array.isArray(oral.content)) return [];
  const ids = new Set((oral.tasks || []).filter((t) => t.kind === 'read_aloud').map((t) => t.id));
  return oral.content.filter((c) => ids.has(c.id) && Array.isArray(c.items)).flatMap((c) => c.items.filter((it) => it && !String(it.answer || '').trim()));
};

/** `log` (optional) receives each note as it is made. */
function freshReadWords(examJson, log) {
  const out = JSON.parse(JSON.stringify(examJson));
  const notes = [];
  const flagged = () => new Set(answerRepeats(out).filter((f) => f.with.includes('oral')).flatMap((f) => f.words));
  const items = readAloudItems(out);
  const bad = flagged();
  items.filter((it) => ARABIC.test(it.ask) && wordsOf(it.ask).some((w) => bad.has(w))).forEach((it) => {
    const was = it.ask;
    const used = new Set(items.map((x) => x.ask));
    for (const cand of BANK.filter((w) => !used.has(w))) {
      it.ask = cand;
      if (!flagged().has(cand)) { notes.push({ was, now: cand }); return; }
    }
    it.ask = was;
  });
  notes.forEach((n) => log && log(n));
  return { examJson: out, notes };
}

module.exports = { freshReadWords, BANK };
