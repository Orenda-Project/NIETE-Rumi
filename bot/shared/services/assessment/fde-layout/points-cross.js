'use strict';
// Part of fde-layout.js (see its header); split for the 300-line limit, bd-5jmnfj.4.52.
const { q4Twin, sameFact, share, stemPhrase, within } = require('./fact-twins');
const { keyAt } = require('./key-order');
const { MEANING_ASK, idiomOf, idiomsIn, statesFact, stemFold, verseTwin } = require('./sst-recall');
const { ONE_LINE, OPTION_HEAD, STOP, foldUr, folded, keyText, plain, q4Words, tokensOf } = require('./stem-tags');

function foldsIn(text) {
  const w = plain(text).split(' ').filter(Boolean);
  const out = new Set();
  for (let i = 0; i < w.length; i += 1) {
    for (let n = 2; n <= 6 && i + n <= w.length; n += 1) {
      const run = w.slice(i, i + n).join(' ');
      out.add(stemFold(run) || run);
    }
  }
  return out;
}
// An item that asks an entry's use, not its meaning: «… کسے کہتے ہیں؟», «… کے لیے کون سا جملہ درست
// ہے؟», «… کس موقعے پر …», «… کس کے لیے بولا جاتا ہے؟».
const USE_ASK = /کسے کہتے|کون سا جملہ (?:درست|صحیح)|کس موقع|کس کے لیے بولا|بولا جاتا/;
const PHRASE_WORDS = 3;
function meaningTwin(lists) {
  const words = [...new Set(lists.flatMap((q) => (Array.isArray(q.words) ? q.words : [])).map(plain).filter(Boolean))];
  if (!words.length) return null;
  const phrases = words.filter((w) => w.split(' ').length >= 2);
  const keyedOn = (q) => {
    const k = plain(keyText(q));
    return k.split(' ').length >= 2 && phrases.some((w) => ` ${k} `.includes(` ${w} `) || ` ${w} `.includes(` ${k} `)
      || (Boolean(idiomOf(k)) && idiomOf(k) === idiomOf(w)));
  };
  const meanings = new Map();
  for (const q of lists.filter((x) => x.slot === 'urdu.C.Q3' && typeof x.answer === 'string')) {
    for (const line of q.answer.split('\n')) {
      const [w, ...rest] = line.split(/[:：]/);
      if (rest.length && plain(w)) meanings.set(plain(w), new Set(tokensOf(rest.join(' '))));
    }
  }
  return (q) => {
    if (keyedOn(q)) return true;
    const stem = ` ${plain(q.question)} `;
    const printed = idiomsIn(q.question);
    // A phrase of three words or more is named when the stem prints every one of its words, a word
    // put in between or not («قطرہ قطرہ ہی سمندر بنتا ہے» names «قطرہ قطرہ سمندر بنتا ہے»).
    const said = new Set(stem.trim().split(' '));
    const folds = foldsIn(q.question);
    const named = words.filter((w) => stem.includes(` ${w} `) || (Boolean(idiomOf(w)) && printed.has(idiomOf(w)))
      || (Boolean(stemFold(w)) && folds.has(stemFold(w)))
      || (w.split(' ').length >= PHRASE_WORDS && w.split(' ').every((t) => said.has(t))));
    if (!named.length) return false;
    if (MEANING_ASK.test(String(q.question)) || USE_ASK.test(plain(q.question))) return true;
    const key = tokensOf(keyText(q));
    return named.some((w) => meanings.has(w) && key.some((t) => meanings.get(w).has(t)));
  };
}

// Urdu Section C: one word in one place. A Q5 whose words take a word or idiom Q3 asks the meaning of
// (the same entry, or the same idiom in another verb form: «دھوم مچ جانا» / «دھوم مچانا») narrows the
// paper by that word. An idiom built on a Q3 word («شانہ بشانہ» beside «شانہ بشانہ کام کرنا») is
// another entry. `q3`: Q3's words.
function wordTwice(q5, q3) {
  const entry = (w) => { const t = plain(w); return [t, idiomOf(t)].filter(Boolean); };
  const asked = new Set(q3.flatMap(entry));
  return (Array.isArray(q5.words) ? q5.words : []).some((w) => typeof w === 'string' && entry(w).some((e) => asked.has(e)));
}
// The grammar labels a key carries before its term (اسم، حرف…، فعل، جملہ): a stem's own frame says
// them («… لفظ کو کیا کہتے ہیں؟»), so they are never the key's letters.
const TERM_CLASS = new Set(['اسم', 'حرف', 'فعل', 'لفظ', 'جملہ', 'الفاظ']);
const termClass = (w) => TERM_CLASS.has(w) || w.startsWith('حرف');
// The key as its option prints it: a reply keyed by letter alone («الف») names the option at that letter.
const keyOption = (q) => {
  const at = Array.isArray(q.options) ? keyAt(q) : -1;
  return at >= 0 && at < q.options.length ? String(q.options[at]).replace(OPTION_HEAD, '') : keyText(q);
};
// Urdu Q1: an item that asks a name or a place (a person, a city, a country: «سدرہ کی بہن کا نام کیا
// تھا؟», «… جاپان کے کس شہر پر …؟»), keyed on one word that only its key option carries, is given away
// by another Q1 item's stem or correct option that prints that word («سالگرہ کی صبح امینہ گلی میں …» →
// امینہ; «ہیروشیما پر نظر آنے والے …» → ہیروشیما), with no other word shared. A wrong option that names it
// tells nothing (one name among four). An item that asks about a word (its meaning, its opposite, its
// kind: «امن» کا متضاد → جنگ) asks no name, whatever stem prints its key.
const NAME_ASK = /(?:^| )(?:نام|شہر|ملک|کہاں|جگہ|مقام)(?: |$)|(?:^| )کس نے(?: |$)|(?:^| )کون (?:تھا|تھی|تھے|ہے|ہیں)(?: |$)/;
const WORD_ASK = /لفظ|الفاظ|متضاد|مترادف|ہم معنی|مطلب|معنی|مفہوم|جملہ|جملے|(?:^| )اسم(?: |$)|(?:^| )حرف|املا/;
// Urdu Section C against Q1: an item that asks a name or a place, keyed on one word only its key
// option carries, whose word a Section C word list prints (Q3's or Q5's words, Q4's ارکان words:
// «ارادہ، کراچی» beside «… کس شہر میں پیدا ہوئیں؟ → کراچی»).
function nameListed(lists) {
  const said = ` ${plain(lists.map((q) => [].concat(Array.isArray(q.words) ? q.words : [], q.slot === 'urdu.C.Q4' ? [q.question] : [])
    .filter((w) => typeof w === 'string').join(' ')).join(' '))} `;
  if (!said.trim()) return null;
  return (q) => {
    if (!Array.isArray(q.options) || q.options.length < 2) return false;
    const stem = plain(q.question);
    if (!NAME_ASK.test(stem) || WORD_ASK.test(stem)) return false;
    const key = plain(keyOption(q));
    if (!key || key.includes(' ') || [...key].length < 3 || STOP.has(key) || termClass(key)) return false;
    if (q.options.filter((o) => ` ${plain(String(o).replace(OPTION_HEAD, ''))} `.includes(` ${key} `)).length !== 1) return false;
    return said.includes(` ${key} `);
  };
}

// Urdu Section C against Q1: Q4's twins, Q6's verse, Q3/Q5's words, each read from its own slot.
function urduTwin(placed) {
  const of = (...ids) => placed.filter((q) => ids.includes(q.slot));
  const rules = [q4Twin(of('urdu.C.Q4')), verseTwin(of('urdu.C.Q6')), meaningTwin(of('urdu.C.Q3', 'urdu.C.Q5')),
    nameListed(of('urdu.C.Q3', 'urdu.C.Q4', 'urdu.C.Q5'))].filter(Boolean);
  return rules.length ? (q) => rules.some((r) => r(q)) : null;
}

// Social Studies: a Q6 item answered with a Q5 item's points is that item again under another name
// (a purse found on the road in Q5, a wallet in Q6: return it to its owner, honesty, others' rights).
// A Q5 point is in the Q6 item when at least half of its words are in one Q6 point; the Q6 item
// restates the Q5 item when at least half of the Q5 points are in it. Points are compared, not
// stems, since the two name different things. The Q6 item is held, never the Q5 one.
// A point that only says how it is marked («پہلی وجہ درست بتانا», «مربوط وضاحت», «موسم کی درست
// وضاحت»: fewer than two words left once the marking words are set aside) states no fact. It is never
// found in another item, so two items that share only such points share nothing, and it still counts
// among its item's points. An item whose points all state no fact is read by its answer, a sentence to
// a point. Points that state a fact are read whole, as before.
const POINT_IN = 0.5;
const POINTS_IN = 0.5;
// Each point's words, or null for a point that states no fact.
function pointSets(q) {
  const points = (q && q.scheme && Array.isArray(q.scheme.points) ? q.scheme.points : [])
    .map((p) => (typeof p === 'string' ? p : p && p.text)).filter((t) => typeof t === 'string' && tokensOf(t).length);
  const sets = points.map((t) => (statesFact(t) ? new Set(tokensOf(t)) : null));
  if (sets.some(Boolean) || !points.length || typeof q.answer !== 'string') return sets;
  return q.answer.split(/[۔؟?!\n]+/).filter(statesFact).map((t) => new Set(tokensOf(t)));
}
function samePoints(q5s) {
  const sets = q5s.map(pointSets).filter((s) => s.some(Boolean));
  if (!sets.length) return null;
  return (q) => {
    const mine = pointSets(q).filter(Boolean);
    if (!mine.length) return false;
    return sets.some((five) => five.filter((a) => a && mine.some((b) => [...a].filter((w) => b.has(w)).length >= POINT_IN * a.size)).length
      >= POINTS_IN * five.length);
  };
}
// A one-fact Q7 whose answer is one point of a longer Q5 or Q6 item (Q7 «برقی توانائی» beside a Q5
// point «الیکٹرانک میڈیا … (برقی توانائی کا استعمال)», Q7 «سلام کرنا» beside a Q6 point «سلام کرنے کا
// ذکر») is answered by that item: a child who writes the long answer has written the Q7's. Read on the
// same words as `samePoints`, the other way round: every word of the Q7's answer is in one point, or
// in the answer, of the other item, and the other item is about what the Q7 asks of. That is what the
// Q7's stem names (`stemPhrase`, «بلوچستان کے شاہی جرگے», its answer and «پاکستان» aside): at least
// half of it is in the other item's question or in the text that holds the answer. A date or a name
// the other item gives for another thing («26 جون 1947ء» for Sindh's assembly; «لیاقت علی خان» inside
// «بیگم رعنا لیاقت علی خان») is not the same fact. A stem that names nothing is read on any word of it.
const QUIET_WORDS = new Set(tokensOf('درست جواب نام لکھا لکھنا پہلا پہلی دوسرا دوسری مثال ذکر بیان چاہیے چاہییں پاکستان'));
function keyInPoints(others) {
  const items = others.filter(Boolean).map((q) => ({
    texts: [...(q.scheme && Array.isArray(q.scheme.points) ? q.scheme.points : []).map((p) => (typeof p === 'string' ? p : p && p.text)), q.answer]
      .filter((t) => typeof t === 'string' && t.trim()).map((t) => ({ words: new Set(tokensOf(t)), folded: folded(t) })).filter((t) => t.words.size),
    question: folded(q.question),
  })).filter((o) => o.texts.length);
  if (!items.length) return null;
  const quiet = new Set([...QUIET_WORDS].map(foldUr));
  return (q) => {
    if (!q || tokensOf(q.answer).length > ONE_LINE) return false;
    const key = new Set(tokensOf(q.answer).filter((w) => !QUIET_WORDS.has(w)));
    if (!key.size) return false;
    const keyF = new Set([...key].map(foldUr));
    const names = [...stemPhrase(q.question)].filter((w) => !keyF.has(w) && !quiet.has(w));
    const asked = [...folded(q.question)].filter((w) => !keyF.has(w) && !quiet.has(w));
    return items.some((o) => o.texts.some((t) => {
      if (!within(key, t.words)) return false;
      const about = new Set([...o.question, ...t.folded]);
      return names.length ? share(new Set(names), about) * 2 >= names.length : asked.some((w) => about.has(w));
    }));
  };
}
// Social Studies Q7: an answer whose words are all in its own question («انٹرنیٹ کی مدد سے طلبہ کون سے مواد تک
// رسائی حاصل کر سکتے ہیں جو تحقیق میں کام آتا ہے؟ → تحقیقی مواد») is printed for the child to copy. A bracket
// in the answer (an English gloss) is set aside; an answer that adds a word of its own stays.
const Q7_SLOT = 'social_studies.D.Q7';
// Science Q1(b) prints its `question` as the frame title «Diagram: …»: it must be the diagram's
// name («Layers of the Earth»), never an instruction («Label any five parts…») (v24 review).
const DIAGRAM_SLOT = 'science.A.Q1b';
const notDiagramName = (q) => /^\s*(label|draw|name)\b/i.test(String((q && q.question) || ''));
// One word in two forms: equal, or one the other's start (داری / داریاں), three letters or more.
const nearWord = (a, b) => a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));
const holdsWord = (list, w) => list.some((x) => nearWord(x, w));
function keyInOwnStem(q) {
  const key = tokensOf(keyText(q).replace(/\([^()]*\)/g, ' '));
  const stem = tokensOf(q.question);
  return key.length > 0 && key.every((w) => holdsWord(stem, w));
}
// The point-set rows, laid in this order: a Q6 against the Q5s, a Q6 against the Q6s placed before
// it (one online disagreement told twice with the same four points), then a Q7 against the Q5s and
// the Q6s now placed. The held slot's item is held, never the other one.
const SAME_POINTS = [
  { held: 'social_studies.D.Q6', against: ['social_studies.C.Q5'], rule: samePoints, name: 'points' },
  { held: 'social_studies.D.Q6', against: ['social_studies.D.Q6'], rule: samePoints, name: 'points_in_slot' },
  { held: 'social_studies.D.Q7', against: ['social_studies.C.Q5', 'social_studies.D.Q6'], rule: keyInPoints, name: 'key_in_points' },
];

const CROSS_HOLD = {
  english: { held: ['english.A.Q1a'], against: 'english.C.Q4', rule: q4Words },
  urdu: { held: ['urdu.A.Q1'], against: ['urdu.C.Q4', 'urdu.C.Q6', 'urdu.C.Q3', 'urdu.C.Q5'], rule: urduTwin },
  social_studies: { held: ['social_studies.C.Q5', 'social_studies.D.Q7'], against: 'social_studies.A.Q1', rule: sameFact },
};

// Social Studies, Section A read against the C and D stems placed: a Q1 item a later stem gives away
// is held, and Section A is asked again (A's re-ask is a top-up; C and D are never moved for A).
// (1) Its key, a name, a year or a number, is printed in a C/D stem on the same topic: the stems share a
//     word besides the key («قراردادِ پاکستان 23 مارچ 1940ء کو …» beside «قراردادِ پاکستان کس سال منظور
//     ہوئی؟ → 1940ء»). A concept term (a tier, a body, democracy, a citizen's duty) is the chapter's own
//     word and every stem may name it; the words every stem shares («حکومت», «پاکستان») are no topic.
// (2) It asks what a Q5 asks: the same question word; the same civics terms, every one of either stem's
//     in the other (legislature against executive is not executive against judiciary); a shared word
//     besides them; and at least three of the shorter stem's words, three fifths of them («جمہوریت کو
//     بہترین طرزِ حکومت کیوں سمجھا جاتا ہے؟» beside «جمہوریت کو بہترین نظام حکومت کیوں کہا جاتا ہے؟ دو
//     وجوہات لکھیں۔»). Words are read without the question's frame («کیا مراد ہے», «وضاحت کریں», «آپ»).
const SST_A_Q1 = 'social_studies.A.Q1';
const BACK_RULES = new Set(['key_in_stem', 'key_named_in_stem', 'asked_in_c']);
// Two words of a Q1 stem's question beside its key: a stem that states the fact.
const STATES_WORDS = 2;
const BACK_CONCEPT = /حکومت|جمہوری|شہنشاہ|آمری|مقننہ|انتظامیہ|عدلیہ|عدالت|کورٹ|اسمبلی|سینی?ٹ|ایوان|شہری|ذمہ دار|قانون|آئین/;
const BACK_ASKS = new Set(['کیوں', 'کیا', 'کون', 'کب', 'کہاں', 'کتنے', 'کتنی', 'کتنا', 'کیسے', 'کس']);
const asksOf = (text) => new Set(String(text || '').split(/[\s؟?،,۔:]+/).filter((w) => BACK_ASKS.has(w)));
const SAME_ASK_WORDS = 3;
const SAME_ASK_SHARE = 0.6;
// Civics terms as tokensOf leaves them (an ending cut: انتظامیہ → انتظامی, شہری → شہر).
const BACK_TERM = /^(?:حکوم|جمہور|شہنشاہ|آمر|مقنن|انتظامی|عدلی|عدالت|کورٹ|اسمبل|سینی?ٹ|ایوان|شہر|ذمہ|دار|قانون|آئین)/;
// A key that is a date («23 مارچ 1940ء», «1940ء») belongs to one event, so a stem that prints it gives it away
// whatever words the stems share. A concept term is given away when a stem prints it as the gloss of what the
// Q1 stem asks about, or the other way round: «ایوانِ زیریں (قومی اسمبلی)» beside «ایوانِ زیریں کا دوسرا نام
// کیا ہے؟ → قومی اسمبلی»; «شہنشاہیت (بادشاہت)» beside «بادشاہ یا ملکہ کے ملک چلانے کا نظام → شہنشاہیت».
const DATE_KEY = /^\s*(?:[\d۰-۹]{1,2}\s+\p{L}+\s+)?[\d۰-۹]{4}\s*ء?\s*(?:میں|کو)?\s*[۔.]?\s*$/u;
const GLOSS = /([^()\n]+?)\s*\(([^()\n]+)\)/g;
function glossed(key, stemWords, text) {
  const k = plain(key);
  if (!k) return false;
  const inStem = (words) => words.length > 0 && words.every((w) => holdsWord(stemWords, w));
  return [...String(text).matchAll(GLOSS)].some((m) => {
    const before = plain(m[1]);
    const inside = plain(m[2]);
    if (inside === k) return inStem(tokensOf(before.split(' ').slice(-2).join(' ')).filter((w) => w.length >= 3));
    return ` ${before} `.endsWith(` ${k} `) && inStem(tokensOf(m[2]));
  });
}
// `own`: the stems are the item's own (its stem names its own key), so none of its words is set aside as seen.
// A term the chapter teaches (a body, a tier, democracy, a citizen; the media) is the chapter's own word, which its
// stems name as they ask about it: a name hold on it would empty Section A, and FDE's own paper prints that shape
// (its Q1 «ثقافت» beside a Q6 on culture). It is held only when a stem states its fact (`givenBack`, (1)).
const TERM_KEY = new RegExp(`${BACK_CONCEPT.source}|میڈیا|ابلاغ`);
// A stem that names three of the item's options or more lists them («مقننہ، انتظامیہ اور عدلیہ») and picks none.
const LISTS_OPTIONS = 3;
const NUMBER_WORDS = new Set('ایک دو تین چار پانچ چھ چھے سات آٹھ نو دس'.split(' '));
const notAName = (key) => {
  const words = plain(key).split(' ').filter(Boolean);
  return words.some((w) => NUMBER_WORDS.has(w)) || (words.length >= 3 && words.some((w) => STOP.has(w)))
    || (words.length >= 2 && /نا$/.test(words[words.length - 1]));
};

module.exports = {
  BACK_CONCEPT, BACK_RULES, BACK_TERM, CROSS_HOLD, DATE_KEY, DIAGRAM_SLOT, LISTS_OPTIONS, NAME_ASK, Q7_SLOT,
  SAME_ASK_SHARE, SAME_ASK_WORDS, SAME_POINTS, SST_A_Q1, STATES_WORDS, TERM_KEY, WORD_ASK, asksOf, glossed,
  holdsWord, keyInOwnStem, keyOption, notAName, notDiagramName, samePoints, termClass, wordTwice,
};
