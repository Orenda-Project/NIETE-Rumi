'use strict';
/**
 * VIDREC H8 — strip people's names from transcript text before it reaches a prompt, a quote or a page.
 *
 * Pure: (text, ctx) → text. No I/O, no clock, no randomness. Port of r-corpus build.py `redact`, plus:
 *   - Urdu punctuation (، ۔ ؟) is no longer glued to the word, so «علی۔» matches «علی» (the Python missed these);
 *   - names said while addressing a child are caught even when not in the lexicon:
 *     turn start «X، …», «X، آپ/تم بتائیں», «شاباش X۔», «X بیٹا», "X, tum batao", "beta X", "Good, X.";
 *   - historical/religious names are kept (حضرت محمد صلی…, محترمہ فاطمہ جناح, Allama Iqbal);
 *   - strict (the default): any Urdu/Devanagari word outside the lessons' own vocabulary, any capitalised latin word
 *     outside it, any word right after a masked name (a surname), a name that is also a word when it does something
 *     («نور نے بتایا») or ends the turn, and split compound names («عبد اللہ», «عطا اللہ») are masked too. A lexicon can never list every
 *     child's name; on 110 held-out lessons the lexicon + address rules alone let 39% of names through.
 * ctx: { teacher, coach, school: name strings of this session's people (from the DB); roster: [student names];
 *        placeholders: { teacher, coach, school, child }; strict: false turns the vocabulary rule off;
 *        vocab: [the lesson's subject terms] (bd-8hhqhf) — they shield only the unknown-word rules (an unknown word
 *        in an address slot, the vocabulary rule), never a lexicon name (red7 070504, COS 070543);
 *        oovVocab: [the lesson's topic words] — they shield the vocabulary rule only;
 *        counts: Map(normalised word → its occurrences in the whole lesson), for the position rule's guard;
 *        carry: Set of name keys (nameKey) masked elsewhere in this lesson or in the stored quote — masked here wherever they
 *        stand (R7i, COS 022306: a name masked once never comes back in output);
 *        trace: an array that receives {word, rep, why} for every masked word, why = the rule that masked it }. Over-redaction is the safe direction: a word wrongly
 * replaced costs quote fidelity; a name let through puts a child's name in a forwardable WhatsApp message.
 */

const LEX = require('./name-lexicon');

const DEFAULT_PH = { teacher: '[TEACHER]', coach: '[COACH]', school: '[SCHOOL]', child: '[CHILD]' };
const WORD = /[ء-غف-يً-ٰٟ-ۓە‌]+|[ऀ-ॣ०-ॿ]+|[A-Za-z]+/g;
const IS_UR = /[؀-ۿ]/;
const IS_DEV = /[ऀ-ॿ]/;
// Role words and honorifics: never a person's name, in users.name or anywhere (bd-8hhqhf adds test/mrs/ٹیچر/استاد/استانی:
// the walk user "VIDREC Test Teacher" failed every reason that said "test").
const ROLE_STOP = new Set('teacher madam miss sir mam maam sahib sahiba bibi govt government school girls boys model primary middle high higher secondary college islamabad sector class federal fde imsg imsb imcg imcb academy public institute village number مس میڈم سر صاحب صاحبہ سکول اسکول گورنمنٹ ماڈل test mrs ms mr ٹیچر استاد استانی'.split(' '));
const HONOR_BEFORE = new Set(['حضرت', 'محترمہ', 'قائد', 'علامہ', 'سیدنا', 'سیدہ', 'نبی', 'رسول', 'امام', 'hazrat', 'quaid', 'allama', 'prophet', 'imam']);
const HONOR_AFTER = new Set(['صلی', 'رضی', 'علیہ', 'جناح', 'اقبال', 'صدیق', 'فاروق', 'غنی', 'بن', 'jinnah', 'iqbal', 'pbuh', 'saw', 'bin']);
const PRAISE = new Set(['شاباش', 'گڈ', 'اچھا', 'ایکسیلنٹ', 'زبردست', 'بیٹا', 'بیٹے', 'بیٹی', 'good', 'shabash', 'excellent', 'done', 'beta', 'yes']);
const NAMED_BY = new Set(['نے', 'کو', 'بولو', 'بولیں', 'بتاؤ', 'بتائیں', 'بیٹھو', 'بیٹھیں', 'بیٹھ']);
const GOD_NAME = new Set(['اللہ', 'الرحمن', 'الرحمان', 'الرحیم', 'الدین']);
const KIN = new Set(['بیٹا', 'بیٹے', 'بیٹی', 'beta', 'bete', 'beti']);
const ADDRESS_AFTER = /^\s*[،,]\s*(آپ|تم|بتاؤ|بتائیں|پڑھو|پڑھیں|سناؤ|سنائیں|کھڑے|کھڑی|آؤ|آئیں|you|tum|aap|ap|batao|bataen|parho|come|stand|read|please)(?![\p{L}])/iu;
const TURN_START = /(^|\n)\s*(\[[\d:]+\]\s*)?([A-Za-z]+\s*(\([A-Z]{2}\))?\s*:\s*)?$/;

const norm = (t) => (IS_UR.test(t)
  ? t.replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[ةه]/g, 'ہ').replace(/[ً-ٰٟـ‌‍]/g, '')
  : t.toLowerCase());
const SETS = Object.fromEntries(Object.entries(LEX).map(([k, v]) => [k, new Set(v)]));
const LEXICON_NAME = (n) => SETS.urStrong.has(n) || SETS.urAmbig.has(n) || SETS.latStrong.has(n) || SETS.latAmbig.has(n);

// bd-8hhqhf r7 (COS 07:01Z): words the vocabulary rule must not take for a child's name. It masked whole Devanagari
// transcripts and Urdu-script English loanwords (ڈویژبلٹی, رولنگ, میڈین), and the model then quoted "[a student]".
// Only the vocabulary rule is narrowed: the lexicon, address, named, surname and compound rules still apply.
// English-loan endings (-ing, -tion, -ment, -ity, plural -s after those): no lexicon name ends in one. A letter
// class alone is not used: retroflex loan-NAMES exist (ڈینا, کرسٹینا; red7 073035); retroflex loanwords come in as a
// curated word list through the subject vocabulary instead (content-terms.js).
const LOAN_END = /(?:نگ|نگز|شن|شنز|منٹ|منٹس|ٹی|ٹیز|جز|گز|ٹس|ڈز)$/;
// The most frequent words of the Devanagari corpus transcripts (2 of 1,500), all function words.
const DEV_COMMON = new Set('जाए कोई देखा से क्यों वाला है मिलके आगे दो दिए देख बताएँगे जैसे कहाँ आना अंदर ओके आपको आपका बैठ समझ नजर लिखें अच्छा उधर ये हूँ लिया गए पहले इसको बैठे आ करो टाइम गया आओ हमने के देखें और मैं लिखा आता लो चलो इस उसका करना सा इसकी आएगी कि हुआ ही कह तो हुए हर इनके बना का मेरा बताया आएगा बहुत नंबर उसे बनाया जी कुछ हमारा कहा जब लोगे बता ले कौन आपके हैं रहे उसमें मैम साथ करेंगे चाह क्या की आज खड़े दोस्त मेरे नाम लिखोगे ज़रा बनाए लगेगा सामने हाँ रही बनाने पे किया अपना देखो बात जो आपस दिया पता जाओ उसी होगा अपने हम नहीं बनाओ उसको होंगे अगर रहा अब अभी ऐसा जल्दी में करें ठीक था वो मैंने बाद कैसे थोड़ा आपने इसका दे मतलब आपकी भी वापस लिख को दी कर लोगों सही जाएँ मेरी लगा इन लिखेंगे हो कितने ने आप लिए यही बच्चों थे करूँ यहाँ उसके इसके फिर ना अपनी पर पीछे मुझे एक करते यानी बार करने करके इसमें क्योंकि दोनों इधर लेकिन उसने आया'.split(' '));
// Given names and nicknames that end like a loanword (بنٹی, سویٹی, منٹی: the -ٹی nickname class, red7 074312) or that a
// list could catch: they stay maskable.
const LOAN_NAMES = new Set('پیٹر رابرٹ ڈیوڈ ڈیوڈز ڈینیئل ڈینیل ڈینی ٹونی ٹینا ڈمپل گڈو گڈی مٹھو البرٹ گلبرٹ ٹیپو ڈولی ریٹا ڈیانا ڈیزی وکٹر ٹام ٹمی ٹیری ڈین بنٹی ٹوبی ایڈورڈ ایڈون اسٹیفن سٹیفن ٹموتھی پیٹرک برٹ ہربرٹ رابرٹس ویلیئم سویٹی سوئیٹی سوئٹی منٹی چنٹی پنٹی شنٹی کیوٹی بیوٹی لکی'.split(' '));
const contentWord = (n, w) => (IS_DEV.test(w) ? DEV_COMMON.has(n)
  : IS_UR.test(w) && [...n].length >= 3 && !LOAN_NAMES.has(n) && LOAN_END.test(n));
const nameTokens = (s) => (String(s || '').match(WORD) || []).map(norm).filter((t) => t.length >= 3 && !ROLE_STOP.has(t));

// bd-8hhqhf R7v (COS 20261027T050735, eng-fix r7v/MEASURE.md): maskedKeys calls redactNames once per transcript line with
// the same vocab lists and roster, and rebuilt both every time (~75% of the redactor's CPU in the card-mode pick). Both are
// read-only here, so they are built once per list object and reused; the answer is the same.
const LEX_SETS = new WeakMap();
const lexSetOf = (list) => new Set([].concat(list || []).map((v) => norm(String(v))).filter((v) => !LEXICON_NAME(v))); // never a lexicon name
function lexSet(list) {
  if (!list || typeof list !== 'object') return lexSetOf(list);
  let set = LEX_SETS.get(list);
  if (!set) { set = lexSetOf(list); LEX_SETS.set(list, set); }
  return set;
}
const ROLE_MAPS = new WeakMap();
function rolesOf(ctx, ph) {
  const build = () => {
    const roles = new Map();
    [].concat(ctx.roster || []).forEach((n) => nameTokens(n).forEach((t) => roles.set(t, ph.child)));
    ['school', 'coach', 'teacher'].forEach((r) => nameTokens(ctx[r]).forEach((t) => roles.set(t, ph[r])));
    return roles;
  };
  if (!ctx.roster || typeof ctx.roster !== 'object') return build();
  const key = JSON.stringify([ctx.school, ctx.coach, ctx.teacher, ph.child, ph.school, ph.coach, ph.teacher].map((v) => (v === undefined ? null : String(v))));
  let byKey = ROLE_MAPS.get(ctx.roster);
  if (!byKey) { byKey = new Map(); ROLE_MAPS.set(ctx.roster, byKey); }
  let roles = byKey.get(key);
  if (!roles) { roles = build(); byKey.set(key, roles); }
  return roles;
}

function redactNames(text, ctx = {}) {
  if (typeof text !== 'string' || !text) return text;
  const ph = { ...DEFAULT_PH, ...(ctx.placeholders || {}) };
  const strict = ctx.strict !== false;
  const vocab = lexSet(ctx.vocab);
  const oovVocab = lexSet(ctx.oovVocab); // the lesson's topic words: the vocabulary rule only, never an address slot (red7 070505)
  const trace = Array.isArray(ctx.trace) ? ctx.trace : null;
  const carry = ctx.carry instanceof Set && ctx.carry.size ? ctx.carry : null;
  const roles = rolesOf(ctx, ph);
  const s = text.replace(/https?:\/\/\S+/g, '[URL]').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[EMAIL]').replace(/\+?\d[\d\s-]{8,}\d/g, '[NUMBER]');
  const words = [...s.matchAll(WORD)];
  let out = '';
  let at = 0;
  let lastChild = -2;
  let forceNext = -1;
  words.forEach((m, i) => {
    const w = m[0];
    const n = norm(w);
    const ur = IS_UR.test(w) || IS_DEV.test(w);
    const prev = i > 0 ? norm(words[i - 1][0]) : '';
    const next = i + 1 < words.length ? norm(words[i + 1][0]) : '';
    const after = s.slice(m.index + w.length, m.index + w.length + 24);
    const honorific = HONOR_BEFORE.has(prev) || HONOR_AFTER.has(next);
    const address = (TURN_START.test(s.slice(Math.max(0, m.index - 40), m.index)) && /^[،,!]/.test(after))
      || ADDRESS_AFTER.test(after) || KIN.has(next)
      || (PRAISE.has(prev) && /^\s*[،,]?\s*$/.test(s.slice(words[i - 1].index + words[i - 1][0].length, m.index)) && /^[۔!،؟.,?]/.test(after));
    const common = ur ? SETS.urCommon.has(n) : SETS.latCommon.has(n);
    const placeholder = s[m.index - 1] === '[' && after[0] === ']';
    let rep = placeholder ? null : roles.get(n);
    let why = rep ? 'role' : null;
    if (!rep && !placeholder && carry && carry.has(n)) { rep = ph.child; why = 'carry'; }
    if (!rep && !honorific && !placeholder) {
      const strong = ur ? SETS.urStrong.has(n) : SETS.latStrong.has(n) && (address || /^[A-Z]/.test(w));
      const amb = ur ? SETS.urAmbig.has(n) : SETS.latAmbig.has(n);
      const unknownAddressed = address && !common && !vocab.has(n) && n.length >= 3 && (ur || /^[A-Z]/.test(w));
      const oov = strict && !common && !amb && !ROLE_STOP.has(n) && !SETS.vocab.has(n) && !vocab.has(n) && !oovVocab.has(n) && !contentWord(n, w) && (ur || /^[A-Z]/.test(w));
      const turnEnd = /^\s*[۔!؟.?]?\s*(\n|$)/.test(after);
      const named = amb && (NAMED_BY.has(next) || turnEnd || SETS.urStrong.has(next));
      const compound = ur && GOD_NAME.has(next) && (n === 'عبد' || (!common && !SETS.vocab.has(n)) || amb || SETS.urStrong.has(n));
      if (compound) forceNext = i + 1;
      const surname = lastChild === i - 1 && !common && (ur || /^[A-Z]/.test(w)) && /^\s*$/.test(s.slice(words[i - 1].index + words[i - 1][0].length, m.index));
      why = (strong && 'strong') || (address && amb && 'address') || (named && 'named') || (unknownAddressed && 'address')
        || (surname && 'surname') || ((compound || forceNext === i) && 'compound') || (oov && 'oov') || null;
      if (why) rep = ph.child;
    }
    if (rep === ph.child) lastChild = i;
    if (rep && trace) trace.push({ word: w, rep, why });
    out += s.slice(at, m.index) + (rep || w);
    at = m.index + w.length;
  });
  return coordinated(out + s.slice(at), ph.child, { vocab, oovVocab, counts: ctx.counts, trace, call: ctx.secondGuard === true });
}

// red7 20261024T013349 (S3 S5, COS 003908; scale-run name_neighbours.js): a name that is also a dictionary or vocabulary word
// survives every rule above when it is coordinated with, or listed beside, a name already masked: «X اور ‹p›»,
// «‹p›، ‹p› اور X», «‹p›، X، …». By its POSITION it is a name too, strict or not. A word of the lesson said more than
// COORD_MAX_REPEAT times is lesson content; function words, role words and the lesson's own terms are never taken.
const COORD_MAX_REPEAT = 3;
const COORD_STOP = new Set(('اور یا کو کے کی کا نے سے میں پر بھی تو جی ہاں نہیں آپ ہم یہ وہ اب پھر سب بچے بچو بچوں بیٹا بیٹی شاباش '
  + 'چلیں اچھا ٹھیک بالکل جلدی آئیں بیٹھیں کھڑے کھڑی ہو گا گی گے ہیں ہے تھا تھی جو کیا کون کہاں کیسے ایک دو تین تینوں دونوں '
  + 'باقی سارے ساری the and good very yes no you ok okay all both others everyone').split(' '));
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function coordinated(text, child, { vocab, oovVocab, counts, trace, call = false }) {
  // each placeholder once: a repeated alternative ('[a student]' is also the child placeholder) made «(?:[\s،,]+P)*» backtrack
  // exponentially on a long run of masked names (v6 3456b11c hung)
  const P = `(?:${[...new Set([child, '[a student]', '[CHILD]', '‹name›'])].map(esc).join('|')})`;
  const W = '((?:(?=\\p{Script=Arabic})[\\p{L}\\p{M}]){2,}|[A-Z][a-z]{2,})';
  const rules = [
    new RegExp(`${P}(?:[\\s،,]+${P})*\\s+(?:اور|and)\\s+${W}(?=[\\s،,۔.!؟?]|$)`, 'gu'), // ‹p› اور X
    new RegExp(`${P}\\s*[،,]\\s*${W}(?=\\s*(?:[،,]|اور\\s|and\\s))`, 'gu'), // ‹p›، X، (a list)
    new RegExp(`(?:^|[\\s“"«:])${W}\\s+(?:اور|and)\\s+${P}`, 'gu'), // X اور ‹p›
    // R7i second guard (red7 S11, Z049): a one-word call just before a masked name, «…چاہے؟ X؟ ‹p› ‹p›؟». R7j (red7 H2): only
    // for the lesson's name set and the stored text (ctx.secondGuard), never the model's input, so no pick moves
    ...(call ? [new RegExp(`(?:^|[؟?!۔.،,:]\\s*)${W}\\s*[؟?!،,]\\s*${P}`, 'gu')] : []),
  ];
  let out = text;
  for (let pass = 0; pass < 3; pass++) { // a list gives up one name per pass
    let changed = false;
    for (const rx of rules) {
      out = out.replace(rx, (m, w) => {
        const n = norm(w);
        if (!w || COORD_STOP.has(n) || ROLE_STOP.has(n) || SETS.urCommon.has(n) || SETS.latCommon.has(n) || vocab.has(n) || oovVocab.has(n)
          || GOD_NAME.has(n) || HONOR_AFTER.has(n) || (counts && (counts.get(n) || 0) > COORD_MAX_REPEAT)) return m;
        changed = true;
        if (trace) trace.push({ word: w, rep: child, why: 'coord' });
        return m.replace(new RegExp(`(?<![\\p{L}])${esc(w)}(?![\\p{L}])`, 'u'), child);
      });
    }
    if (!changed) break;
  }
  return out;
}

// R7k (COS 044233 §1c; panel v8 Z377 ⛔9): a child's name that is also a dictionary word, as the closing vocative of a
// question («…آواز میں X؟») or right after a greeting, is masked by no rule above, so the one gate never held it. Fail
// closed: the word in that position is a name when the lesson says it COORD_MAX_REPEAT times or fewer, whatever the
// lexicon says, unless it is a word a clause is built from, a role word or the lesson's own term.
const GREETING = /(?:السلام علیکم|اسلام علیکم|وعلیکم السلام|شاباش|\b(?:good (?:morning|afternoon)|hello|hi|well done)\b)[\s،,]+$/iu;
// The words that stand in that position in 10 or more of the 3,000 r7 corpus lessons, lexicon names left out (a verb, an
// auxiliary, a classroom word: «ہوگا؟», «کلاس؟»); no given name is in it («ایلس», «دین» taken out so they fail closed).
const VOC_STOP = new Set(('ہوگا تھے ہوگی ہوا کلاس لوگ اوکے اسٹوڈنٹس سیکھا علاوہ کہا چلا پڑھا دیکھا بولا لگا لکھا سا بچہ بات لی سی بچا بنے '
  + 'کبھی انڈرسٹینڈ پاس مطلب کلیئر ہمارا ویری پتا آگے ملا کچھ پیارے والا کتنے تک سوچا دوسرا دی رہا ڈن ساتھ تیسرا '
  + 'لگی صحیح بعد ریڈی چیز کرے نمبر اوپر ورحمۃ اسے یو ہمم آج ڈیئر پہلے نو کتنی طرح نام رائٹ وقت والے بچی ملے ٹوٹل '
  + 'آتا اندر نیچے بنی پڑھے سوال والی کب سارا گزرا سنی اٹ مجھے کل ویسے کدھر ادھر دن ایسے کرو سمجھ ڈوئنگ دیکھے ہماری '
  + 'بس بھلا بوائز دیکھی چاہے پڑھی ایسا نکالا ملی ابھی نکلا ٹاپک پورا میری میرا آتی ٹائم سٹوڈنٹس اے می پہ لکھی ون '
  + 'سیکھے سامنے کام پیچھے بک کرتا ٹو پکا پرابلم سمجھا کلیر لگے پوچھا جواب سکتا پہلا دے بنتا وجہ دیتے مشکل ٹوز '
  + 'تھریز مسئلہ باہر بولے نیم جناب سکے لکھے مثلا بی آواز ونز لیسن معنی ہیو لیفٹ تمہارا بار دوسری وعلیکم لفظ ریڈنگ '
  + 'بہت خیریت رکھا ٹوڈے مثال رکھی غلط رہی پڑا چوتھا بکس ڈالا جیسے کرتے رہے دس جگہ فورز کاپی از زیادہ کم کلیپنگ '
  + 'نکالے سکتے کنفیوژن اسٹوڈنٹ ').trim().split(' '));
const VOC_END = /^\s*[؟?]/;
// an English question word or tag set off by itself («…this? Why?», «Okay?») is the question, not a person
const LAT_ASK = new Set('why what how who whom whose where when which right okay ok yes no really anyone everyone anybody sure please again'.split(' '));
const SET_OFF = /(?:^|[،,؟?!۔.:"“«⁨])\s*$/u;
const VERBISH = /(?:ں|یے|ئے|ؤ|ئی|یا|نا)$/u;

/** The name keys a line holds in vocative position (see above). ctx: { counts, vocab }. */
function vocativeKeys(text, { counts = null, vocab = [] } = {}) {
  const s = String(text || '');
  const terms = new Set([].concat(vocab || []).map((v) => norm(String(v))));
  const out = [];
  for (const m of s.matchAll(WORD)) {
    const w = m[0];
    const n = norm(w);
    const ur = IS_UR.test(w);
    // set off as its own clause («…، X؟», «X؟»), never the object of the question («کون سا پرندہ؟»)
    const end = VOC_END.test(s.slice(m.index + w.length)) && SET_OFF.test(s.slice(0, m.index));
    if (!end && !GREETING.test(s.slice(Math.max(0, m.index - 30), m.index))) continue;
    if ((ur ? [...n].length < 2 : !/^[A-Z][a-z]{2,}$/.test(w)) || (s[m.index - 1] === '[' && s[m.index + w.length] === ']')) continue;
    if (COORD_STOP.has(n) || ROLE_STOP.has(n) || GOD_NAME.has(n) || HONOR_AFTER.has(n) || PRAISE.has(n) || NAMED_BY.has(n) || VOC_STOP.has(n) || LAT_ASK.has(n) || terms.has(n)) continue;
    if (ur && VERBISH.test(n)) continue;
    if (!counts || (counts.get(n) || 0) > COORD_MAX_REPEAT) continue;
    out.push(n);
  }
  return out;
}

/** The lesson's word counts for the position rule's guard (normalised as the redactor reads words). */
function wordCounts(lines) {
  const c = new Map();
  for (const l of lines || []) for (const w of String(l).match(WORD) || []) { const n = norm(w); c.set(n, (c.get(n) || 0) + 1); }
  return c;
}

/** The key a carry set holds for a word (the redactor's own normalisation). */
const nameKey = (w) => norm(String(w || ''));
/** A key long enough to be a name: two letters in Urdu script («گل»), three in Latin (not «I»). */
const keyLong = (k) => [...k].length >= (IS_UR.test(k) ? 2 : 3);

/**
 * R7j (COS 022905 §1; red7 HOLD 023908 H1): the name keys the STRICT redactor masks as a child anywhere in these lines, by a
 * name rule ('oov', the vocabulary rule, masks lesson words too and is never carried), long enough (keyLong), and only
 * when the lesson does not use the word as a word: its masks outnumber its plain uses, or it occurs 3 times or fewer
 * (a subject word on 19 lines masked once after a name is a noun, red7 Z142 Z055 Z084). ctx as redactNames.
 */
function maskedKeys(lines, ctx = {}) {
  const trace = [];
  for (const l of lines || []) redactNames(String(l || ''), { ...ctx, strict: true, secondGuard: true, placeholders: { child: '[a student]' }, trace });
  const masks = new Map();
  for (const x of trace) {
    if (x.rep !== '[a student]' || x.why === 'oov' || x.why === 'carry') continue;
    const k = nameKey(x.word);
    if (keyLong(k)) masks.set(k, (masks.get(k) || 0) + 1);
  }
  return guarded(masks, ctx.counts);
}

/** The keys of `masks` (key → times masked) the lesson does not use as a word (see maskedKeys). */
function guarded(masks, counts) {
  const out = new Set();
  for (const [k, m] of masks) {
    const all = counts ? (counts.get(k) || 0) : 0;
    if (all <= COORD_MAX_REPEAT || m >= all - m) out.add(k);
  }
  return out;
}

/**
 * R7j (COS 022905 §1): the ONE output gate. Every whole word of a teacher-facing string whose key is in the lesson's name set
 * becomes [a student]: the roster as it is, the strict redactor's guarded masks, the stored quote's own masks. Forms of a
 * name ("X's", «X کا / کی / کے») are the word X here. Nothing upstream (the model's input, validation, routing) reads it.
 */
function scrubNames(text, names) {
  if (typeof text !== 'string' || !text || !names || !names.size) return text;
  // a bracketed placeholder ([a student], [TEACHER]) is left as it is; only the text between them is read
  return text.split(/(\[[^\][\n]{1,24}\])/).map((part, i) => (i % 2 ? part
    : part.replace(WORD, (w) => (names.has(nameKey(w)) ? '[a student]' : w)))).join('');
}

module.exports = { redactNames, wordCounts, nameKey, keyLong, maskedKeys, guarded, scrubNames, vocativeKeys, ROLE_STOP };
