'use strict';
// Part of fde-layout.js (see its header); split for the 300-line limit, bd-5jmnfj.4.52.
const { BACK_CONCEPT, BACK_TERM, DATE_KEY, LISTS_OPTIONS, SAME_ASK_SHARE, SAME_ASK_WORDS, STATES_WORDS, TERM_KEY, asksOf, glossed, holdsWord, notAName } = require('./points-cross');
const { BODY, PASSAGE_WORDS, PLACEHOLDER_WORDS, backGeneric, flatUr, tiersIn } = require('./sst-recall');
const { OPTION_HEAD, keyText, plain, tokensOf } = require('./stem-tags');

// (3) Its key is a name (a person, a place, an organisation) that sits in one of its options and no other, and a
//     C/D stem names that option («… → عبدالستار ایدھی» beside «ایدھی فاؤنڈیشن نے …»; «… → چودھری رحمت علی» beside
//     «چودھری رحمت علی نے 28 جنوری 1933ء کو …»). No shared topic is needed: a child who reads that stem knows which
//     option to pick. This is a precaution beyond the gate, which counts only a stem that states the Q1 fact; a
//     name printed alone is reported there, and holding it here costs one Section A re-ask. A term the chapter
//     teaches is never read here (TERM_KEY). A stem names an option when it prints all of its words, or all the
//     words no other option has (two or more: «علی گڑھ» for «تحریک علی گڑھ» beside «تحریک خلافت»), or at least
//     half of those words of four letters or more, the parts many names share («محمد», «علی», «خان») aside
//     («ایدھی» for «عبدالستار ایدھی»; «گڑھ» is not «مہر گڑھ»), or the one such word of four letters or more
//     («کراچی» for «کراچی پورٹ» beside «پورٹ قاسم»). A key that sits in two options («لیاقت علی خان» inside «بیگم
//     رعنا لیاقت علی خان») names no one, and neither does a stem that prints it only inside a wife's name («بیگم
//     رعنا لیاقت علی خان» carries «لیاقت علی خان»). A key that is no name is not read here: a phrase of three words
//     or more with a function word («ٹیلی وژن میں آواز کے ساتھ تصویر …», «کم ہوتا ہے»; «کے ٹو» is a name), an act
//     («بات کرنا»), a number word, a word marking points use for any fact («نقصان», «فائدہ»), or a key with a digit
//     (that is (1)). A tier («مقامی حکومت») is the three-tier chapter's own word: the which-government items are
//     read by their book line (`sameLine`) and the tier slip, not here.
const NAME_PARTS = new Set(tokensOf('محمد علی خان احمد سید شاہ بیگم حضرت سر قائد اعظم'));
const NAME_LETTERS = 4;
const WIFE = 'بیگم';
// Where the words `t` stand in a row in `line` (a stem's tokens in order), none inside a wife's name.
const printsRun = (t, line) => line.some((_, i) => t.every((w, j) => line[i + j] === w) && !line.slice(Math.max(0, i - 2), i).includes(WIFE));
// `seen`: the Q1 stem's own words. Part of a name the Q1 stem prints itself («ایدھی» in «عبدالستار ایدھی نے کون
// سی تنظیم قائم کی؟ → ایدھی فاؤنڈیشن») tells the child nothing new when a C/D stem prints it too.
function namesOption(t, others, words, line, seen) {
  if (t.length && t.every((w) => words.has(w))) return printsRun(t, line);
  const own = t.filter((w) => !others.has(w) && !backGeneric.has(w));
  const fresh = (w) => words.has(w) && !seen.has(w);
  if (own.length >= 2 && own.every((w) => words.has(w)) && own.some(fresh)) return true;
  const strong = own.filter((w) => !NAME_PARTS.has(w));
  const long = strong.filter((w) => w.length >= NAME_LETTERS);
  if (strong.length >= 2) { const printed = long.filter(fresh).length; return printed > 0 && printed * 2 >= strong.length; }
  return strong.length === 1 && long.length === 1 && fresh(long[0]);
}
function keyNamedIn(m, stems, own = false) {
  if (!Array.isArray(m.options) || m.options.length < 3 || /\d/.test(keyText(m)) || notAName(keyText(m)) || TERM_KEY.test(keyText(m))) return false;
  const key = tokensOf(keyText(m));
  if (!key.length || key.every((w) => backGeneric.has(w) || PLACEHOLDER_WORDS.has(w)) || tiersIn(flatUr(keyText(m))).size) return false;
  const opts = m.options.map((o) => tokensOf(String(o).replace(OPTION_HEAD, '')));
  const at = m.options.findIndex((o) => plain(String(o).replace(OPTION_HEAD, '')) === plain(keyText(m)));
  if (at < 0 || opts.filter((t) => key.every((w) => t.includes(w))).length !== 1) return false;
  const others = (i) => new Set(opts.filter((_, j) => j !== i).flat());
  const seen = own ? new Set() : new Set(tokensOf(m.question));
  return stems.some((x) => namesOption(opts[at], others(at), x.words, x.tokens, seen)
    && opts.filter((t, i) => namesOption(t, others(i), x.words, x.tokens, seen)).length < LISTS_OPTIONS);
}
let backFrame = null;
function givenBack(placed) {
  const stems = placed.filter((q) => typeof q.question === 'string' && q.question.trim())
    .map((q) => ({ slot: q.slot, text: q.question, line: ` ${tokensOf(q.question).join(' ')} `, tokens: tokensOf(q.question), words: new Set(tokensOf(q.question)), asks: asksOf(q.question) }));
  backFrame = backFrame || new Set(tokensOf('مراد وضاحت بیان کریں کیجیے جاتا جاتی جاتے سمجھا کہا دو تین کوئی وجہ وجوہات بات طور آپ چاہیے کرنا مختصر جواب'));
  const contentOf = (text) => [...new Set(tokensOf(text).filter((w) => !backFrame.has(w)))];
  if (!stems.length) return null;
  const q5s = stems.filter((x) => x.slot === 'social_studies.C.Q5');
  return (m) => {
    const key = tokensOf(keyText(m));
    if (key.length && !BACK_CONCEPT.test(keyText(m)) && (key.some((w) => /\d/.test(w)) || key.join('').length >= 3)) {
      const printedKey = ` ${key.join(' ')} `;
      const dated = DATE_KEY.test(keyText(m));
      const topic = tokensOf(m.question).filter((w) => !key.includes(w) && w.length >= 3 && !backGeneric.has(w));
      if (stems.some((x) => x.line.includes(printedKey) && (dated || topic.some((w) => x.words.has(w))))) return 'key_in_stem';
    }
    if (key.length && TERM_KEY.test(keyText(m))) {
      const stemWords = tokensOf(m.question).filter((w) => !key.includes(w));
      if (stems.some((x) => glossed(keyText(m), stemWords, x.text))) return 'key_in_stem';
      // A term a stem prints beside two words of the Q1 stem's own question states the fact the Q1 asks
      // («قانون بنانے کا اختیار کس ادارے کے پاس ہے؟ → مقننہ» beside «مقننہ قانون بناتی ہے، اس کے دو ایوانوں …»).
      const printedKey = ` ${key.join(' ')} `;
      const topic = [...new Set(tokensOf(m.question))].filter((w) => !key.includes(w) && w.length >= 3 && !backGeneric.has(w));
      if (stems.some((x) => x.line.includes(printedKey) && topic.filter((w) => x.words.has(w)).length >= STATES_WORDS)) return 'key_in_stem';
    }
    if (keyNamedIn(m, stems)) return 'key_named_in_stem';
    const own = contentOf(m.question);
    const asks = asksOf(m.question);
    const same = q5s.some((x) => {
      if (![...asks].some((w) => x.asks.has(w))) return false;
      const other = contentOf(x.text);
      const terms = (list) => list.filter((w) => BACK_TERM.test(w));
      if (!terms(own).every((w) => holdsWord(other, w)) || !terms(other).every((w) => holdsWord(own, w))) return false;
      const shared = own.filter((w) => holdsWord(other, w));
      return shared.some((w) => !BACK_TERM.test(w))
        && shared.length >= SAME_ASK_WORDS && shared.length >= SAME_ASK_SHARE * Math.min(own.length, other.length);
    });
    return same ? 'asked_in_c' : null;
  };
}
// Social Studies Q1 against itself: a stem that names its own key («ایدھی فاؤنڈیشن کس شخصیت نے قائم کی؟ →
// عبدالستار ایدھی»), or the key of another Q1 item on the paper, prints that answer for the child to pick (read as
// a C/D stem is, above). The item whose key is named is the one held: a key many stems name («سوشل میڈیا») costs
// one item, not every stem that names it.
const stemOf = (q) => ({ words: new Set(tokensOf(q.question)), tokens: tokensOf(q.question) });
const namesOwnKey = (q) => keyNamedIn(q, [stemOf(q)], true);
const stemNamesKey = (stemQ, keyQ) => keyNamedIn(keyQ, [stemOf(stemQ)]);
const FRAME_WORDS = new Set(('which what choose pick select find correct right following given below one option answer '
  + 'word words noun verb adjective adverb pronoun preposition is are the a an of from').split(' '));
// A written item (no options) is also the same question when only its endings, its case markers
// or the number and gender of its copula differ («پاکستان کے پہلے وزیر اعظم کون تھے؟» / «پاکستان
// کا پہلا وزیر اعظم کون تھا؟»); the tense stays («ہے» ≠ «تھا») and so do the question words, so
// «کب» and «کہاں» are two questions.
const CASE_MARKERS = new Set(['کا', 'کی', 'کے']);
const COPULA = { تھا: 'تھا', تھی: 'تھا', تھے: 'تھا', ہے: 'ہے', ہیں: 'ہے' };
const writtenKey = (text) => plain(text).split(' ')
  .filter((w) => w && !CASE_MARKERS.has(w))
  .map((w) => COPULA[w] || (/^\p{Script=Arabic}{4,}$/u.test(w) ? w.replace(/(?:وں|یں|ے|ہ|ی|ا)$/, '') : w))
  .join(' ');
// Urdu: the same stem keyed the same is one question, whatever distractor a rewrite changed (a
// top-up told to write nothing it kept rewrote one with a single option swapped). So is a kept
// fact asked again under a new stem: the same key (one key's words all in the other's, the shorter
// more than half the longer: «مینا بازار» / «مینا بازاروں» / «مینا بازار لگانے», never «کاش» beside
// «کاش میں پرندہ ہوتا») and stems that, keys aside, share two words or one's words all in the other's
// («… کس شعبے کی ڈگری حاصل کی؟» / «… کس پیشے کی ڈگری حاصل کی تھی؟» → دندان سازی). One shared word
// («شہر»: where she was born / the biggest city, both «کراچی») is two questions.
const TWIN_WORDS = 2;
function sameStemKey(a, b) {
  const s = plain(a.question);
  if (Boolean(s) && s === plain(b.question) && Boolean(plain(keyText(a))) && plain(keyText(a)) === plain(keyText(b))) return true;
  const [ka, kb] = [new Set(tokensOf(keyText(a))), new Set(tokensOf(keyText(b)))];
  if (!ka.size || !kb.size) return false;
  const [small, big] = ka.size <= kb.size ? [ka, kb] : [kb, ka];
  if (small.size * 2 <= big.size || ![...small].every((w) => big.has(w))) return false;
  const sa = new Set(tokensOf(a.question).filter((w) => !ka.has(w)));
  const sb = new Set(tokensOf(b.question).filter((w) => !kb.has(w)));
  if (!sa.size || !sb.size) return false;
  const shared = [...sa].filter((w) => sb.has(w)).length;
  return shared >= TWIN_WORDS || shared === sa.size || shared === sb.size;
}
// Social Studies: two MCQs keyed the same that name the same job are one question asked twice
// («پینے کے پانی کا بندوبست اور نکاسی آب کا انتظام کون سی حکومت دیکھتی ہے؟» beside «… بارش کے بعد
// سڑکوں پر پانی جمع … نکاسی کا انتظام … کون سی حکومت کرے گی؟», both → مقامی حکومت). Urdu's same-key
// read, with the words every which-government stem shares («حکومت», «کام», «انتظام») set aside, so
// two jobs of one government («مویشی منڈی», «نکاسی آب») stay two questions. Only a key that names a
// government or body: two facts about one person («APWA کس نے قائم کی؟», «پہلی خاتون صوبائی گورنر کون
// تھیں؟», both → بیگم رعنا لیاقت علی خان) are two questions.
const TASK_FRAME = new Set(tokensOf('حکومت حکومتیں کام انتظام ذمہ داری سطح ادارہ ادارے دیکھتی دیکھے کرے گی کرتی کرنا'));
function sameTask(a, b) {
  if (!Array.isArray(a.options) || !Array.isArray(b.options) || !/حکومت/.test(keyText(a)) && !BODY.test(keyText(a))) return false;
  const bare = (q) => ({ ...q, question: tokensOf(q.question).filter((w) => !TASK_FRAME.has(w)).join(' ') });
  return sameStemKey(bare(a), bare(b));
}
// Social Studies: two MCQs keyed on the same government whose jobs come from one line of the book's
// table (p.29) are one fact asked twice, once directly and once as a case («پینے کے پانی کا بندوبست کون
// سی حکومت دیکھتی ہے؟» beside «… گلیوں کا گندا پانی نکالنے کا مسئلہ … کس حکومت سے رابطہ …؟», both →
// مقامی حکومت, from «پینے کے پانی کا بندوبست اور نکاسی آب کا انتظام دیکھتی ہے»). Jobs from two lines
// («مویشی منڈیاں» and «نکاسی آب») stay two questions. A stem that names jobs from two lines is no line's.
const BOOK_LINES = [
  ['ملکی دفاع', 'مسلح افواج'],
  ['ملکی معیشت'],
  ['خارجہ پالیسی', 'بیرونی ممالک'],
  ['نظم و نسق', 'نظم ونسق', 'قانون سازی', 'تجاوزات', 'امن و امان'],
  ['صوبائی محصولات'],
  ['داخلی پالیسی'],
  ['مویشی منڈی', 'عوامی میلے', 'میلے'],
  ['پینے کے پانی', 'پینے کا پانی', 'نکاسی', 'گندا پانی', 'گندے پانی', 'پانی نکال'],
  ['بیواؤں', 'یتیموں', 'معذوروں', 'قدرتی آفات'],
].map((line) => line.map(flatUr));
function bookLineOf(stem) {
  const flat = flatUr(stem);
  const lines = BOOK_LINES.map((line, i) => (line.some((w) => flat.includes(w)) ? i : -1)).filter((i) => i >= 0);
  return lines.length === 1 ? lines[0] : null;
}
function sameLine(a, b) {
  if (!Array.isArray(a.options) || !Array.isArray(b.options) || !tiersIn(flatUr(keyText(a))).size) return false;
  if (plain(keyText(a)) !== plain(keyText(b))) return false;
  const line = bookLineOf(a.question);
  return line !== null && line === bookLineOf(b.question);
}
// Social Studies: the book's page text (`opts.book`, the pages the section prompts were given) read as its
// sentences, in order, each as its words. A page's lines are joined first: the page store breaks a sentence
// across lines, so a line is no sentence; a sentence ends at «۔», «؟», «!» or «?», and at a page's end.
let bookCache = null;
function bookSentences(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  if (bookCache && bookCache.text === text) return bookCache.sentences;
  const sentences = text.split(/^=== Page [^\n]*===\s*$/m)
    .flatMap((page) => page.replace(/\s*\n\s*/g, ' ').split(/[۔؟?!]+/))
    .map((t) => new Set(tokensOf(t))).filter((w) => w.size >= 2);
  bookCache = { text, sentences };
  return sentences;
}
function sentencesHolding(words, sentences) {
  if (!sentences || words.length < PASSAGE_WORDS) return [];
  return sentences.flatMap((s, i) => { const n = words.filter((w) => s.has(w)).length; return n >= PASSAGE_WORDS && n * 2 >= words.length ? [i] : []; });
}
// Social Studies: two MCQs with the same key whose facts sit in one book sentence or two sentences side by side
// are one fact asked twice («پاکستان کی پہلی خاتون صوبائی گورنر کون تھیں؟» beside «1973ء میں سندھ کی گورنر کون
// بنیں؟», both → بیگم رعنا لیاقت علی خان, from «1973ء میں وہ صوبہ سندھ کی گورنر بن گئیں۔ وہ پاکستان کی پہلی خاتون
// صوبائی گورنر تھیں۔»). Each stem is placed by its own words, its key and the words every stem shares aside.
// Facts from sentences further apart stay two questions (APWA, founded four sentences before). A tier is read
// by its table line instead (`sameLine`): the table's lines stand side by side, and each is its own job.
function samePassage(a, b, sentences) {
  if (!sentences || !Array.isArray(a.options) || !Array.isArray(b.options)) return false;
  const key = plain(keyText(a));
  if (!key || key !== plain(keyText(b)) || tiersIn(flatUr(keyText(a))).size) return false;
  const at = (q) => { const k = new Set(tokensOf(keyText(q))); return sentencesHolding([...new Set(tokensOf(q.question))].filter((w) => !k.has(w) && !backGeneric.has(w)), sentences); };
  const [x, y] = [at(a), at(b)];
  return x.some((i) => y.some((j) => Math.abs(i - j) <= 1));
}
// Urdu: a Q1 stem that prints another Q1 item's key gives that item away («سدرہ نے اپنی تھیڑ کمپنی
// کس مقصد کے لیے بنائی؟» beside «… کیا بنایا؟ → تھیڑ کمپنی»): a key of two words or more, all in the
// stem. A one-word key a stem merely names («… کس چیز کی علامت ہیں؟ → امن» beside ««امن» کا متضاد …»)
// stays, unless each item's stem prints the other's key («ہیروشیما کس ملک کا شہر ہے؟ → جاپان» beside
// «جاپان کا کون سا شہر …؟ → ہیروشیما»). An item that names the kind of a quoted example («'میری دعا
// ہے کہ …' یہ کس قسم کا جملہ ہے؟ → تمنائی جملہ») is not given away by a stem that names the kind
// («کون سا لفظ تمنائی جملے میں استعمال ہوتا ہے؟»): its question is the example.
const GIVEN_WORDS = 2;
const QUOTES_EXAMPLE = /«[^»]+»|[’‘]{2}[^’‘]+[’‘]{2}|“[^”]+”|"[^"]+"|'[^']+'/u;
// Urdu Q1: an MCQ whose stem prints its own key gives itself away («لفظ «سانپ» کی درست املا کون سی
// ہے؟» → سانپ; «سَحَر» … درست اعراب والا لفظ → سَحَر), the key being one of its options: a quote that is the key as written, marks and
// all, or the key's words in order outside the stem's quotes. A quote that holds the key among other
// words («"اگر بارش ہوئی تو …" میں حرفِ شرط …؟» → اگر) is the example the item asks about, and stays;
// so does a stem that prints another option beside the key («عمارت» اور «اِمارت» میں سے …): the
// child still chooses. A stem that asks two questions («… پیش آیا؟ سدرہ کی بہن کا نام کیا تھا؟»)
// is two items in one place; a «؟» inside a quoted example does not count.
const QUOTE_SPAN = /«[^»]+»|[’‘]{2}[^’‘]+[’‘]{2}|“[^”]+”|"[^"]+"|[’‘][^’‘]+[’‘]|'[^']+'/gu;

module.exports = {
  FRAME_WORDS, GIVEN_WORDS, QUOTES_EXAMPLE, QUOTE_SPAN, bookSentences, givenBack, namesOwnKey, sameLine,
  samePassage, sameStemKey, sameTask, stemNamesKey, writtenKey,
};
