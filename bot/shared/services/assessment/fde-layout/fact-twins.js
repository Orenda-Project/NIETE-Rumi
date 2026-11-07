'use strict';
// Part of fde-layout.js (see its header); split for the 300-line limit, bd-5jmnfj.4.52.
const { ONE_LINE, OPTION_HEAD, PHRASE_ENDS, SAME_SHARE, SAME_WORDS, STEM_PHRASE, answeredWhole, folded, keyText, plain, textsOf, tokensOf } = require('./stem-tags');

function stemPhrase(stem) {
  const words = [];
  for (const w of plain(stem).split(' ')) {
    if (PHRASE_ENDS.has(w)) break;
    words.push(w);
  }
  return folded(words.join(' '));
}
const within = (a, b) => [...a].every((w) => b.has(w));
const share = (a, b) => [...a].filter((w) => b.has(w)).length;
// (1) Same thing asked, same key: the item asks about what the MCQ's stem names, and its one-line
//     answer is the MCQ's key («پاکستان میں سینٹ کے ارکان کی تعداد کتنی ہے؟ → 104» beside «سینیٹ کے ارکان کی
//     تعداد کتنی ہے؟ → 104»). The key is the item's answer, not a word of its question.
// (2) Both facts of the answer printed in Section A: the answer is what the MCQ's stem names, beside
//     half the MCQ's key, and neither is in the item's own question («عبدالستار ایدھی نے کون سی فلاحی تنظیم
//     قائم کی؟ → ایدھی فاؤنڈیشن …, accepting پناہ گاہیں» beside «ایدھی فاؤنڈیشن نے … کیا قائم کیا؟ → یتیموں اور
//     لاوارثوں کے لیے پناہ گاہیں»).
// Both are one-line answers (a Q7, a short Q5): in a longer answer the two facts are one point among
// others, a partial FDE's own paper has (its Q5 «Define lines of latitude. How many are these?»).
function stemTwin(m, item) {
  if (!item.oneLine || m.phrase.size < STEM_PHRASE || !m.keyF.size) return false;
  const ownKey = [...m.keyF].filter((w) => !item.asked.has(w));
  if (ownKey.length * 2 < m.keyF.size) return false;
  if (within(m.phrase, item.asked)) return within(m.keyF, item.answered);
  return within(m.phrase, item.answer) && share(m.keyF, item.answered) * 2 >= m.keyF.size;
}

// A Q7 keyed on a Q1 key: its answer, or an answer its scheme accepts, is a Q1 MCQ's key read as
// words (option letter aside): Q7 «… اجلاس کہاں منعقد ہوا؟ → لاہور کے منٹو پارک», accepting «لاہور»,
// beside Q1 «قرارداد پاکستان کس شہر کے منٹو پارک میں منظور ہوئی؟ → د) لاہور». A one-fact Q7 has one
// answer, so a child who read the MCQ has it.
const asWords = (text) => tokensOf(text).join(' ');
function keyedOnQ1(q1s) {
  const keys = new Set(q1s.map((m) => asWords(keyText(m))).filter(Boolean));
  return (q) => [q.answer, ...textsOf(q.scheme && Array.isArray(q.scheme.accept) ? q.scheme.accept : [])]
    .some((t) => typeof t === 'string' && keys.has(asWords(t.replace(OPTION_HEAD, ''))));
}

// A Q5 two Q1 MCQs answer together: at least PAIR_COVER of its model answer's words are in the
// stems and keys of two Q1 items (Q5 «جمہوریت اور شہنشاہیت میں کیا فرق ہے؟» beside Q1 «جمہوری حکومت
// میں حکمرانوں کو کون منتخب کرتا ہے؟ → عوام اپنے ووٹوں سے» and «… بادشاہ یا ملکہ پورا نظام سنبھالتے
// ہیں … → شہنشاہیت»). Below 0.65 the pairs are partials FDE's own paper has (one half of a
// comparison, a rule the Q5 still asks the child to use).
const PAIR_COVER = 0.65;
function pairAnswered(q1s) {
  const texts = q1s.map((m) => new Set([...tokensOf(m.question), ...tokensOf(keyText(m))]));
  return (q) => {
    const answer = [...new Set(tokensOf(q.answer))];
    if (!answer.length) return false;
    for (let a = 0; a < texts.length; a += 1) {
      for (let b = a + 1; b < texts.length; b += 1) {
        if (answer.filter((w) => texts[a].has(w) || texts[b].has(w)).length >= PAIR_COVER * answer.length) return true;
      }
    }
    return false;
  };
}

function sameFact(q1s) {
  const q7Keyed = keyedOnQ1(q1s);
  const q5Pair = pairAnswered(q1s);
  const mcqs = q1s.map((m) => ({
    key: new Set(tokensOf(keyText(m))),
    stem: new Set(tokensOf(m.question)),
    options: new Set(tokensOf(textsOf(Array.isArray(m.options) ? m.options : []).map((o) => o.replace(OPTION_HEAD, '')).join(' '))),
    phrase: stemPhrase(m.question),
    keyF: folded(keyText(m)),
  })).filter((m) => m.key.size && m.stem.size);
  if (!mcqs.length) return null;
  return (q, slotId) => {
    if (slotId === 'social_studies.D.Q7' && q7Keyed(q)) return true;
    if (slotId === 'social_studies.C.Q5' && q5Pair(q)) return true;
    const scheme = q.scheme && typeof q.scheme === 'object' ? q.scheme : {};
    const points = Array.isArray(scheme.points) ? scheme.points.filter((p) => p && typeof p.text === 'string') : [];
    const accept = textsOf(Array.isArray(scheme.accept) ? scheme.accept : []);
    const said = new Set(tokensOf(textsOf(q.question, q.answer, points.map((p) => p.text), accept).join(' ')));
    // What the MCQ asks (its stem, the shared key taken out) is what the item says too.
    const asksSame = (asks) => {
      const both = asks.filter((w) => said.has(w)).length;
      return both >= SAME_WORDS && both / asks.length >= SAME_SHARE;
    };
    // A key an MCQ gives away: it holds the MCQ's key, or it is printed in the MCQ's stem (a name
    // both carry is not by itself the same question), and the two ask the same thing.
    const given = (text) => {
      const k = new Set(tokensOf(text));
      if (!k.size) return false;
      return mcqs.some((m) => {
        const stem = [...m.stem].filter((w) => !m.key.has(w));
        if ([...m.key].every((w) => k.has(w)) && asksSame(stem)) return true;
        return [...k].every((w) => m.stem.has(w)) && asksSame(stem.filter((w) => !k.has(w)));
      });
    };
    const answerF = folded(q.answer);
    const item = {
      asked: folded(q.question), answer: answerF, answered: new Set([...answerF, ...folded(accept.join(' '))]),
      oneLine: tokensOf(q.answer).length <= ONE_LINE,
    };
    if (mcqs.some((m) => stemTwin(m, item))) return true;
    // A one-line answer (or an item with no marking points) is given whole, with its accepted answers.
    if (!points.length || tokensOf(q.answer).length <= ONE_LINE) {
      if (textsOf(q.answer, accept).some(given)) return true;
      // A one-line answer that is only an MCQ's options («مقننہ، انتظامیہ اور عدلیہ»).
      const ans = new Set(tokensOf(q.answer));
      if (ans.size >= 2 && mcqs.some((m) => [...ans].every((w) => m.options.has(w)))) return true;
    }
    const answer = new Set(tokensOf(q.answer));
    const answered = new Set([...answer, ...tokensOf(accept.join(' '))]);
    if (answer.size && mcqs.some((m) => answeredWhole(m, answered, answer))) return true;
    // Otherwise the points the MCQs give must carry at least half the item's marks: one point of
    // three cued is a hint, not the answer.
    const marks = points.map((p) => (Number(p.marks) > 0 ? Number(p.marks) : 1));
    const total = marks.reduce((a, b) => a + b, 0);
    const got = points.reduce((sum, p, i) => sum + (given(p.text) ? marks[i] : 0), 0);
    return total > 0 && got * 2 >= total;
  };
}

// Urdu: the Q4 items' keys, read as written (option letter, dashes and commas aside), and the
// MCQs keyed on one of them. A Q4 key is its answer and every answer its scheme accepts («موسمِ
// برسات», accepting «برسات»). Q4 asks for words, so a key with no letter (a bare number) is no Q4 answer.
const acceptOf = (q) => (q.scheme && Array.isArray(q.scheme.accept) ? q.scheme.accept : [])
  .filter((a) => typeof a === 'string').map((a) => a.replace(OPTION_HEAD, ''));
function sameKey(q4s) {
  const keys = new Set(q4s.flatMap((q) => [keyText(q), ...acceptOf(q)]).map(plain).filter((k) => /\p{L}/u.test(k)));
  if (!keys.size) return null;
  return (q) => keys.has(plain(keyText(q)));
}

// Urdu: the sentence an item is about, as words: its quoted text («…», ’’…‘‘, “…”), else what
// follows its colon, on the stem's first line (a Q4 stem can carry its options below). Each comes
// twice when it has blanks: with them taken out, and with the key's words put in them (one word or
// pair per blank, «اگر - تو»). Fewer than four words is a word or a phrase, not a sentence.
const QUOTED = /«([^»]+)»|[’‘]{2}([^’‘]+)[’‘]{2}|“([^”]+)”|"([^"]+)"/gu;
const BLANK = /_{2,}|\.{3,}|…/g;
const SENTENCE_WORDS = 4;
function sentencesOf(q, filled) {
  const line = typeof q.question === 'string' ? q.question.trim().split('\n')[0] : '';
  const quoted = [...line.matchAll(QUOTED)].map((m) => m.slice(1).find(Boolean));
  const colon = line.split(/[:：]/);
  const said = quoted.length ? quoted : (colon.length > 1 ? [colon.slice(1).join(' ')] : []);
  const key = filled ? keyText(q) : '';
  const fills = plain(key) ? key.split(/\s*[-–—,،]\s*/).map((w) => w.trim()).filter(Boolean) : null;
  const out = [];
  for (const s of said) {
    out.push(plain(s.replace(BLANK, ' ')).split(' '));
    const blanks = s.match(BLANK) || [];
    if (fills && blanks.length && blanks.length === fills.length) {
      let i = 0;
      out.push(plain(s.replace(BLANK, () => ` ${fills[i++]} `)).split(' '));
    }
  }
  return out.filter((w) => w.length >= SENTENCE_WORDS);
}
// How many of `a`'s words `b` carries in a's order (the longest common subsequence).
function inOrder(a, b) {
  let row = new Array(b.length + 1).fill(0);
  for (const w of a) {
    const next = [0];
    for (let j = 1; j <= b.length; j += 1) next[j] = w === b[j - 1] ? row[j - 1] + 1 : Math.max(row[j], next[j - 1]);
    row = next;
  }
  return row[b.length];
}
// Urdu writes a compound split or joined («کام یاب» / «کامیاب», «کم زور» / «کمزور»): two words side
// by side that make one word of the other text are read as that word.
function joinSplits(words, other) {
  const one = new Set(other);
  const out = [];
  for (let i = 0; i < words.length; i += 1) {
    if (i + 1 < words.length && one.has(words[i] + words[i + 1])) { out.push(words[i] + words[i + 1]); i += 1; } else out.push(words[i]);
  }
  return out;
}
// A sentence is printed in a stem when the stem carries at least four in five of its words, in order.
const SENTENCE_SHARE = 0.8;
const printedIn = (sentence, stem) => {
  const said = joinSplits(sentence, stem);
  return inOrder(said, joinSplits(stem, said)) >= Math.ceil(said.length * SENTENCE_SHARE);
};

// Urdu: the word list a Q4 item asks about, quoted («کتاب، قلم، کاپی، بستہ») or after its colon up
// to the sentence's end («گروہی الفاظ …: بادل، بجلی، بارش، گھٹائیں۔»), as each entry's words. A
// list is three or more entries of one to three words each; anything else (a sentence, two words
// to break up) is none.
const LIST_ENTRIES = 3;
const ENTRY_WORDS = 3;
function listOf(q) {
  const line = typeof q.question === 'string' ? q.question.trim().split('\n')[0] : '';
  const colon = line.split(/[:：]/);
  const said = [...line.matchAll(QUOTED)].map((m) => m.slice(1).find(Boolean))
    .concat(colon.length > 1 ? [colon.slice(1).join(' ').split(/[۔؟?!]/)[0]] : []);
  for (const text of said) {
    const entries = text.split(/[،,]/).map(tokensOf);
    if (entries.length >= LIST_ENTRIES && entries.every((e) => e.length && e.length <= ENTRY_WORDS)) return entries;
  }
  return [];
}

// Urdu: a Q1 MCQ is a Q4 twin when it is keyed on a Q4 answer (sameKey), when it prints a Q4
// sentence (Q4's sentence is in the MCQ's stem, or the MCQ's quoted sentence, blanks empty or
// filled with its key, is in Q4's stem), or
// when its stem carries three of a Q4 list's entries, in any order.
function q4Twin(q4s) {
  const byKey = sameKey(q4s);
  const q4 = q4s.map((q) => ({ said: sentencesOf(q, true), stem: plain(String(q.question || '').split('\n')[0].replace(BLANK, ' ')).split(' ') }));
  const sentences = q4.some((s) => s.said.length);
  const lists = q4s.map(listOf).filter((l) => l.length);
  if (!byKey && !sentences && !lists.length) return null;
  return (q) => {
    if (byKey && byKey(q)) return true;
    const words = new Set(tokensOf(q.question));
    if (lists.some((l) => l.filter((e) => e.every((w) => words.has(w))).length >= LIST_ENTRIES)) return true;
    const stem = plain(q.question).split(' ');
    // The MCQ's own sentence, its blanks empty and filled with its key («___ تم محنت کرو گے ___ …» → اگر، تو).
    const own = sentencesOf(q, false).concat(sentencesOf(q, true));
    return q4.some((s) => s.said.some((t) => printedIn(t, stem)) || own.some((t) => printedIn(t, s.stem) || s.said.some((f) => printedIn(t, f))));
  };
}

// Social Studies, one fact once per slot by its key: two written items whose keys say the same
// thing (one key's words all inside the other's) and whose stems ask about the same thing (every
// word of the shorter-keyed stem, its key aside, in the other stem) are one question: «کے ٹو کی
// اونچائی کتنی ہے؟ → 8,611 میٹر» inside «کے ٹو کی اونچائی کتنی ہے اور … → 8,611 میٹر؛ …». Two facts
// about one place («اونچائی» / «پہاڑی سلسلہ») stay two.
function sameKeyFact(a, b) {
  // Two MCQs with one stem and one key are one question whatever distractor a rewrite changed
  // («قوانین بنانے کا اختیار حکومت کے کس حصے کے پاس ہے؟ → مقننہ», beside «فوج» or «سپریم کورٹ»).
  if (Array.isArray(a.options) && Array.isArray(b.options)) {
    const stem = plain(a.question);
    return Boolean(stem) && stem === plain(b.question) && Boolean(plain(keyText(a))) && plain(keyText(a)) === plain(keyText(b));
  }
  if (Array.isArray(a.options) || Array.isArray(b.options)) return false;
  const ka = new Set(tokensOf(keyText(a)));
  const kb = new Set(tokensOf(keyText(b)));
  if (!ka.size || !kb.size) return false;
  const [small, big, qs, qb] = ka.size <= kb.size ? [ka, kb, a, b] : [kb, ka, b, a];
  if (![...small].every((w) => big.has(w))) return false;
  const asks = tokensOf(qs.question).filter((w) => !small.has(w));
  const other = new Set(tokensOf(qb.question));
  return asks.length > 0 && asks.every((w) => other.has(w));
}

module.exports = {
  acceptOf, printedIn, q4Twin, sameFact, sameKeyFact, sentencesOf, share, stemPhrase, within,
};
