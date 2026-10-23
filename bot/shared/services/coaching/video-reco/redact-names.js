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

function redactNames(text, ctx = {}) {
  if (typeof text !== 'string' || !text) return text;
  const ph = { ...DEFAULT_PH, ...(ctx.placeholders || {}) };
  const strict = ctx.strict !== false;
  const lexSet = (list) => new Set([].concat(list || []).map((v) => norm(String(v))).filter((v) => !LEXICON_NAME(v))); // never a lexicon name
  const vocab = lexSet(ctx.vocab);
  const oovVocab = lexSet(ctx.oovVocab); // the lesson's topic words: the vocabulary rule only, never an address slot (red7 070505)
  const trace = Array.isArray(ctx.trace) ? ctx.trace : null;
  const roles = new Map();
  [].concat(ctx.roster || []).forEach((n) => nameTokens(n).forEach((t) => roles.set(t, ph.child)));
  ['school', 'coach', 'teacher'].forEach((r) => nameTokens(ctx[r]).forEach((t) => roles.set(t, ph[r])));
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
  return out + s.slice(at);
}

module.exports = { redactNames, ROLE_STOP };
