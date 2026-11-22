'use strict';
// Part of fde-layout.js (see its header); split for the 300-line limit, bd-5jmnfj.4.52.
const { Q4_KINDS } = require('../fde-task-line');
const { GIVEN_WORDS, QUOTES_EXAMPLE, QUOTE_SPAN } = require('./given-back');
const { bare, positionalPair } = require('./key-order');
const { keyOption, termClass } = require('./points-cross');
const { OPTION_HEAD, STOP, keyText, plain, tokensOf } = require('./stem-tags');

function stemGivesKey(a, b) {
  const key = (q) => new Set(tokensOf(keyText(q)));
  const prints = (stemOf, keyOf) => {
    const k = key(keyOf);
    const stem = new Set(tokensOf(stemOf.question));
    return k.size > 0 && [...k].every((w) => stem.has(w));
  };
  // A one-word key is given away too when the stem that prints it is on the same topic: the two
  // stems share a content word besides the key («… کانفرنس کس شہر میں ہوئی؟ → ٹوکیو» beside «…
  // ٹوکیو کی کانفرنس میں آنے کا بلاوا …»).
  const topic = (q, by) => {
    const k = key(q);
    const other = new Set(tokensOf(by.question).filter((w) => w.length >= 3 && !k.has(w)));
    return tokensOf(q.question).some((w) => w.length >= 3 && !k.has(w) && other.has(w));
  };
  // A quoted word list is no example: a stem that lists another item's key among its words
  // («کمبل، آتش دان، مونگ پھلی، ریوڑیاں» … → سردی beside «… کون سا لفظ شامل نہیں ہو سکتا؟ → آتش
  // دان») prints that key, whatever the item asking it quotes.
  const listed = (q, by) => {
    const k = plain(keyText(q));
    return Boolean(k) && (String(by.question || '').match(QUOTE_SPAN) || [])
      .some((quote) => { const words = quote.split(/[،,]/).map(plain).filter(Boolean); return words.length >= 2 && words.includes(k); });
  };
  // A stem that names a one-word key gives it away only when it names no other option of that item
  // («ببلو نے اسلم اور کیک کے بارے میں …» names two of «کھیر / حلوہ / کیک / اسلم»: no cue).
  const namesOnlyKey = (q, by) => {
    const stem = new Set(tokensOf(by.question));
    return Array.isArray(q.options) && q.options.filter((o) => {
      const words = tokensOf(String(o).replace(OPTION_HEAD, ''));
      return words.length > 0 && words.every((w) => stem.has(w));
    }).length === 1;
  };
  const given = (q, by) => listed(q, by) || (!QUOTES_EXAMPLE.test(String(q.question || ''))
    && (key(q).size >= GIVEN_WORDS || (key(q).size === 1 && topic(q, by) && namesOnlyKey(q, by))));
  // Another item's OPTION that prints a key of two words or more, in order, inside something it says
  // about it, states that key as a fact, even as a wrong option («سدرہ نے … کیا بنایا؟ → تھیڑ کمپنی»
  // beside «ب) سدرہ کی تھیڑ کمپنی بند کرنے کی»). An option that is only the key, or a one-word key
  // («کراچی», «امینہ» among four names), tells nothing. Nor does a sample sentence that uses a grammar
  // item's key when that item quotes its own example («'___ ہم سب کو کامیابی ملے۔' → اللہ کرے» beside
  // the option «ج) اللہ کرے امتحان آسان ہو۔»): its question is the example.
  const optionStates = (q, by) => {
    const k = plain(keyText(q));
    if (key(q).size < GIVEN_WORDS || !Array.isArray(by.options) || QUOTES_EXAMPLE.test(String(q.question || ''))) return false;
    return by.options.some((o) => { const t = plain(String(o).replace(OPTION_HEAD, '')); return t !== k && ` ${t} `.includes(` ${k} `); });
  };
  const [ab, ba] = [prints(a, b), prints(b, a)];
  return (ab && ba) || (ab && given(b, a)) || (ba && given(a, b)) || optionStates(a, b) || optionStates(b, a);
}
// Urdu Q4: an item with four options (in `options`, or on the stem's lines below it) keyed on one
// option and accepting another («ج) بارش», accepting «د) فلکیات») has two answers. It is held and
// never comes back: the key a teacher marks from would be a guess. An accepted answer that is no
// option («جب، تو» beside «اگر، تو») is another way of writing the key, and stays.
const OPTION_LETTER = /^\s*\(?([a-dA-D]|الف|ب|ج|د)\s*[).:۔-]/;
function keyAcceptSplit(q) {
  const options = Array.isArray(q.options) && q.options.length
    ? q.options.map(String)
    : String(q.question || '').split('\n').slice(1).filter((l) => OPTION_HEAD.test(l));
  if (options.length !== 4) return false;
  const letterOf = (t) => { const m = String(t).match(OPTION_LETTER); return m ? m[1].toLowerCase() : null; };
  const texts = options.map((o) => plain(String(o).replace(OPTION_HEAD, '')));
  const which = (t) => {
    const letter = letterOf(t);
    const byLetter = letter ? options.findIndex((o) => letterOf(o) === letter) : -1;
    return byLetter >= 0 ? byLetter : texts.indexOf(plain(String(t).replace(OPTION_HEAD, '')));
  };
  const keyAt = typeof q.answer === 'string' ? which(q.answer) : -1;
  if (keyAt < 0) return false;
  const accept = q.scheme && Array.isArray(q.scheme.accept) ? q.scheme.accept.filter((a) => typeof a === 'string') : [];
  return accept.some((a) => { const at = which(a); return at >= 0 && at !== keyAt; });
}
// Urdu Q4 ارکان: a key that splits a word one way («تواضع: تو + اضع») beside an accepted answer that
// splits it another («تَ وا ضُع») gives the teacher two answers, one of them wrong. Each word the key
// splits is compared with every accepted answer that spells the same word, by where the cuts fall.
// A key cuts its parts with «+», or, in an item that asks for ارکان, with a dash («کہا – نی» beside
// «کَ – ہا – نی»; «ب - گو - لا» beside «بگ - و - لا»).
const SYLLABLE_CUT = /[+\-–—ـ]/;
const SYLLABLE_ASK = /ارکان/;
const syllableCuts = (parts) => { let at = 0; return parts.slice(0, -1).map((p) => { at += p.length; return at; }).join(','); };
// One word to an entry: a line, or a part of one cut at «؛» or «،». A word's parts are cut at «+»
// (or a dash), or, with neither, at its spaces; a part's own letters are read without marks.
const syllableEntries = (text) => text.split(/[\n؛;،,]/).map((t) => t.split(/[:：]/).pop()).filter((t) => t.trim());
const syllableParts = (text) => (SYLLABLE_CUT.test(text) ? text.split(SYLLABLE_CUT) : text.split(/\s+/))
  .map((part) => plain(part).replace(/ /g, '')).filter(Boolean);
function syllableSplit(q) {
  if (typeof q.answer !== 'string') return false;
  const cut = (line) => line.includes('+') || (SYLLABLE_ASK.test(String(q.question || '')) && SYLLABLE_CUT.test(line));
  if (!cut(q.answer)) return false;
  const accept = q.scheme && Array.isArray(q.scheme.accept) ? q.scheme.accept.filter((a) => typeof a === 'string') : [];
  const [cuts, entries, partsOf] = [syllableCuts, syllableEntries, syllableParts];
  const accepted = accept.flatMap(entries).map(partsOf).filter((parts) => parts.length > 1);
  return entries(q.answer).some((line) => {
    if (!cut(line)) return false;
    const parts = partsOf(line);
    if (parts.length < 2) return false;
    return accepted.some((a) => a.join('') === parts.join('') && cuts(a) !== cuts(parts));
  });
}
// Urdu Q4 ارکان: a key that splits a word the book itself splits (`P.syllables`: «دامن» دا – من, «غلاظت»
// غ – لا – ظت) another way gives the teacher a wrong answer to mark from, whatever its accepted answer
// says. A word the book never splits is not read.
function bookSplit(q, P) {
  const book = (P && Array.isArray(P.syllables) ? P.syllables : []).map((b) => ({ word: plain(b.word).replace(/ /g, ''), cuts: syllableCuts(b.parts.map((x) => plain(x))) }));
  if (!book.length || typeof q.answer !== 'string' || !SYLLABLE_ASK.test(String(q.question || ''))) return false;
  return syllableEntries(q.answer).some((line) => {
    const parts = syllableParts(line);
    const own = parts.length > 1 && book.find((b) => b.word === parts.join(''));
    return Boolean(own) && own.cuts !== syllableCuts(parts);
  });
}
// Urdu Q4: the group word names what the listed words belong to («تھرمامیٹر، نبض، دوا، ڈاکٹر» →
// اسپتال). A stem whose list prints the key as the only one of its options in the list («… جس سے یہ
// سب الفاظ متعلق ہیں: سورج، کرنیں، دھوپ، روشنی» with options سورج، برف، سایہ، رات → سورج) is
// answered by matching, and is held. A stem whose list is its own four options (choose the group
// word among them: «بھیڑ، بکری، گائے، ریوڑ» → ریوڑ) is not: there every option is listed by design.
// The list is the stem's first line after its last colon, up to its first «۔» or «؟», cut at «،».
// Urdu Q4: four kinds, one item each, in FDE's order. An item's kind is read from its heading or stem;
// a second item of a kind never takes another kind's place.
const q4Kind = (q) => Q4_KINDS.findIndex(([re]) => re.test(`${q.main_question || ''} ${q.question || ''}`));
const sameQ4Kind = (a, b) => q4Kind(a) >= 0 && q4Kind(a) === q4Kind(b);
const GROUP_ASK = /گروہی/;
function groupWordListed(q) {
  const stem = String(q.question || '').split('\n')[0];
  if (!GROUP_ASK.test(stem) || !/[:：]/.test(stem)) return false;
  const key = plain(keyText(q));
  if (!key) return false;
  const listed = stem.slice(stem.search(/[:：][^:：]*$/) + 1).split(/[۔؟?]/)[0].split(/[،,]/).map(plain).filter(Boolean);
  const options = (Array.isArray(q.options) ? q.options : []).map((o) => plain(String(o).replace(OPTION_HEAD, ''))).filter(Boolean);
  const inList = options.filter((o) => listed.includes(o));
  return listed.length > 1 && inList.length === 1 && inList[0] === key;
}
// Urdu: the page text's numeral dates are not reliable (a year loses a digit, «۱۹۱۳ء» reads
// «۱۹۳ ء»), so an item keyed on a year, a date or a day of the month is held: its key, or any entry
// of its scheme's accept list, carries digits with «ء», «سن» and a year, a four-digit year alone, or
// a month beside a number. The written pieces (picture, essay or dialogue, story, letter) are
// models, not keys: a letter is dated by its form, so they are not read.
const DATE_KEY_SLOTS = new Set(['urdu.A.Q1', 'urdu.B.Q2', 'urdu.C.Q3', 'urdu.C.Q4', 'urdu.C.Q5', 'urdu.C.Q6']);
// Month names are matched as `plain` writes them (one letter form, no hamza seat).
const DATE_MONTHS = `(?:${['جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون', 'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر',
  'محرم', 'صفر', 'ربیع الاول', 'ربیع الثانی', 'ربیع الآخر', 'جمادی الاول', 'جمادی الاولیٰ', 'جمادی الثانی', 'جمادی الآخر', 'رجب',
  'شعبان', 'رمضان', 'شوال', 'ذوالقعدہ', 'ذی قعدہ', 'ذوالحجہ', 'ذی الحجہ', 'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'].map(plain).join('|')})`;
const DATE_TEXT = [
  /(?:^| )\d{3,4} ?ء(?: |$)/,
  /(?:^| )سنہ? \d{3,4}(?: |$)/,
  /^[12]\d{3}$/,
  new RegExp(`(?:^| )\\d{1,2} ${DATE_MONTHS}(?: |$)`),
  new RegExp(`(?:^| )${DATE_MONTHS} \\d{1,4}(?: |$)`),
  /(?:^| )\d{1,2} تاریخ(?: |$)/,
];
function keyedOnDate(q) {
  const accept = q.scheme && Array.isArray(q.scheme.accept) ? q.scheme.accept.filter((a) => typeof a === 'string') : [];
  return [keyText(q), ...accept.map((a) => a.replace(OPTION_HEAD, ''))]
    .map(plain).some((t) => t && DATE_TEXT.some((re) => re.test(t)));
}
// As written, marks kept (they are what an اعراب item tests), with only the Arabic letter forms of
// ی / ک / ہ read as Urdu («ہندي» is «ہندی»).
const SAME_LETTER = [[/[يى]/g, 'ی'], [/ك/g, 'ک'], [/ه/g, 'ہ']];
const asWritten = (t) => SAME_LETTER.reduce((x, [re, to]) => x.replace(re, to), String(t).normalize('NFC')).replace(OPTION_HEAD, '').replace(/^[\s«»’‘“”"'(]+|[\s«»’‘“”"').,،۔؟?!]+$/gu, '');
// A spelling item prints its key wherever its stem holds it, inside a longer quote too («جس چیز سے
// … یعنی گرم مصالحہ» کا درست املا → مصالحہ): the word it tests, as written, among the stem's words.
// Beside another option too («عمارت» اور «اِمارت» میں سے درست املا …): the right spelling is printed,
// and the other-option exemption below is for items that ask something else (a meaning). A key of
// function words only («میں») is the stem's own frame, and stays.
const SPELLING_ASK = /املا|ہجے/;
const wordsAsWritten = (t) => asWritten(t).split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
function spellingPrints(stem, key) {
  const [s, k] = [wordsAsWritten(stem), wordsAsWritten(key)];
  return k.length > 0 && s.some((_, i) => k.every((w, j) => s[i + j] === w));
}
function printsOwnKey(q) {
  if (!Array.isArray(q.options) || !q.options.length) return false;
  const key = asWritten(keyText(q));
  const options = q.options.map(asWritten);
  if (!plain(key) || !options.includes(key)) return false;
  const stem = String(q.question || '');
  if (SPELLING_ASK.test(stem) && tokensOf(key).length > 0 && spellingPrints(stem, key)) return true;
  const quotes = (stem.match(QUOTE_SPAN) || []).map(asWritten);
  const outside = stem.split(QUOTE_SPAN).map((part) => ` ${plain(part)} `);
  // Outside the quotes only a key with a content word counts: a function word («میں») is in most
  // stems' own frame («درج ذیل میں سے …»).
  const printed = (o) => quotes.includes(o) || (tokensOf(o).length > 0 && outside.some((part) => part.includes(` ${plain(o)} `)));
  const others = options.filter((o) => o !== key && plain(o));
  return printed(key) && !others.some(printed);
}
function asksTwo(q) {
  if (!Array.isArray(q.options) || !q.options.length) return false;
  return (String(q.question || '').replace(QUOTE_SPAN, ' ').match(/[؟?]/g) || []).length >= 2;
}
// Urdu Q1: an MCQ whose key's letters are printed in its own stem, and no other option's are, is
// answered by matching letters, whatever the shape: a homograph sense given as the key's own
// infinitive («… «جنگل» اور دوسرا «بننا»» → بن; «… «شاخ» اور … «ڈالنا»» → ڈالی), a quoted word the
// key is cut from («ان پڑھ» … → ان), a grammar term's own word («… «گاڑی» کی صفت بیان کرنے والے
// لفظ …» → اسم صفت). The key is one content word once its grammar label (اسم، حرف…، فعل، لفظ) is
// set aside, and has a letter; a key of more words is a meaning or a fact (a meaning that repeats
// the asked word is the book's own gloss). A true/false pair (درست / غلط) is the item's frame. A stem word carries the key when it is the key, or begins with the key's
// stem (its last ی / ا / ے / ہ off) and runs at most three letters on; a word of two letters is
// read that way only inside a quote («ان» begins half of all words). A spelling item quotes a gloss
// and is read by its own rule (a homograph item says «ایک ہی املا» and is no spelling item); a stem that prints another option too («سبز پتا» → پتا beside
// سبز) leaves the child a choice, and stays.
const INFLECTION = 3;
const HOMOGRAPH = /متشابہ|ایک ہی املا|املا ایک/;
// A homograph pair is keyed as the word twice («ان اور ان»): one word.
const PAIR_WORDS = new Set(['اور', 'و']);
const keyWord = (text) => {
  const words = plain(text).split(' ').filter(Boolean);
  const content = [...new Set(words.filter((w) => !termClass(w) && !PAIR_WORDS.has(w)))];
  return content.length === 1 && [...content[0]].length >= 2 && /\p{L}/u.test(content[0]) ? content[0] : null;
};
// A sentence the item quotes as its example («"اگر بارش ہوئی تو …" میں حرفِ شرط …؟» → اگر) is what
// the item asks a part of, and is not read; a homograph item's quoted word is (its pair is cut from
// it: «ان پڑھ» → «ان اور ان»).
function carries(stem, word, homograph) {
  const root = [...word].length >= 3 ? word.replace(/[یاےہ]$/, '') : word;
  const quotes = (stem.match(QUOTE_SPAN) || []).map((x) => plain(x).split(' ').filter(Boolean));
  const quoted = new Set(quotes.filter((q) => q.length === 1 || homograph).flat());
  // A function word («میں», «ان») is in most stems' own frame: only a quote prints it.
  const outside = STOP.has(word) ? [] : plain(stem.replace(QUOTE_SPAN, ' ')).split(' ');
  const read = outside.concat([...quoted]).filter(Boolean);
  return read.some((w) => w === word || ((quoted.has(w) || [...root].length >= 3)
    && [...root].length >= 2 && w.startsWith(root) && [...w].length - [...root].length <= INFLECTION));
}
function lettersOfKey(q) {
  if (!Array.isArray(q.options) || !q.options.length) return false;
  const stem = String(q.question || '');
  const homograph = HOMOGRAPH.test(plain(stem));
  if ((SPELLING_ASK.test(stem) && !homograph) || positionalPair(q.options.map(bare))) return false;
  const key = plain(keyOption(q));
  const word = keyWord(key);
  if (!word || !carries(stem, word, homograph)) return false;
  // Another option is another written form («سَحَر» beside «سِحر»): one that differs only by its
  // marks is printed wherever the key is.
  const written = asWritten(keyOption(q));
  const others = q.options.filter((o) => asWritten(o) !== written).map((o) => plain(String(o).replace(OPTION_HEAD, ''))).filter(Boolean);
  return !others.some((o) => o.split(' ').filter((w) => !termClass(w) && !PAIR_WORDS.has(w) && [...w].length >= 2).some((w) => carries(stem, w, homograph)));
}
// Urdu Q1: a stem, or a correct option, that names a person or thing of the same story as another
// item (« … باغ میں کیا کیا؟ → فاختائیں فضا میں اڑائیں»), where that name is the other item's key and
// none of its other options («سدرہ کی فاختہ آزاد کرنے کے بعد …» beside
// «سدرہ کی سالگرہ کی صبح … تکیے کے پاس کیا رکھا تھا؟ → کاغذ کی دو فاختائیں»), points the child to
// that key. The key is a short name or thing (four words at most; a longer key is a reason or an
// event, read by the reader). The name is an option's last word of three letters or more, singular
// or plural (فاختہ / فاختائیں), never a verb (… پھیلانا) or a word the item's own stem prints (the
// lesson's hero, «فاطمہ جناح», is in half the stems); the story is a word of three letters or more
// both stems share besides it, never the frame of a question («لفظ», «مطلب», «جملہ»). A stem that
// names two of the item's options («جنگل میں شیر کے شکار کا بچا ہوا حصہ …» beside «… کیا بننے کو
// کہا؟» among لومڑی / شیر) leaves the child a choice, and stays.
const NOUN_ENDINGS = /(?:اییں|ایں|یاں|وں|یں|ے|ہ|ی|ا)$/;
const nounFold = (w) => { const cut = w.replace(NOUN_ENDINGS, ''); return [...cut].length >= 3 ? cut : w; };
const NAME_KEY_WORDS = 4;

module.exports = {
  DATE_KEY_SLOTS, HOMOGRAPH, NAME_KEY_WORDS, asksTwo, bookSplit, groupWordListed, keyAcceptSplit,
  keyedOnDate, lettersOfKey, nounFold, printsOwnKey, q4Kind, sameQ4Kind, stemGivesKey, syllableSplit,
};
