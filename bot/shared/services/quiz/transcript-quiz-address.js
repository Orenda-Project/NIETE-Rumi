'use strict';
/**
 * Transcript quiz — HOW A QUESTION ADDRESSES THE CHILD, in Urdu.
 *
 * The child on the other end of a quiz may be a boy or a girl, and nothing in
 * the system says which; the classes are mixed. Urdu marks the gender of the
 * SUBJECT on most verb forms, so a question that asks the child what they will
 * do — «کون سی علامت لگائیں گے؟», «آپ اسے حوصلہ کیسے دیں گے؟» — has already
 * guessed that the child is a boy. The feminine guess («لگائیں گی») is the same
 * mistake. Roughly one production Urdu item in ten was written that way.
 *
 * The neutral forms carry no gender at all and ask exactly the same thing:
 *   - the آپ-imperative / subjunctive:  «بتائیں»، «چنیں»، «آپ کون سی علامت لگائیں؟»
 *   - the impersonal / obligative:      «کون سی علامت لگانی چاہیے؟»، «کون سی علامت لگے گی؟»
 *   - آپ نے + a verb that agrees with its OBJECT: «آپ نے کون سی علامت لگائی؟»
 *
 * WHAT COUNTS. A gendered verb form whose SUBJECT is the child being asked:
 *   1. an explicit آپ as the subject (not آپ نے/کو/کا/کے/سے…, which hand the
 *      agreement to something else) whose own verb — the first one after it,
 *      before the next conjunction — is a gendered present, future,
 *      progressive or perfect form: «آپ … جاتے ہیں», «آپ … دیں گے»,
 *      «آپ … کر سکتی ہیں», «آپ … سوچ رہے ہیں» — or a perfective that closes
 *      its clause with no auxiliary, «آپ … بھول گئے» (not in a field that names
 *      the Prophet ﷺ or a companion: there it is the narrative past);
 *   2. a FUTURE form with no subject at all, when it is the child's: in a
 *      question stem («کیسے پڑھیں گے؟»), in an option — the child's own answer
 *      («آخر میں 'یں' لگائیں گے») unless the stem asked "we" or a third person —
 *      or in an explanation or feedback line that already speaks to the child
 *      as آپ («اگر آپ کو … ہو تو کون سی علامت لگائیں گے؟»).
 *
 * The teacher's lesson_summary, written TO the teacher as آپ, is read by the
 * same function from the teacher-gender check (transcript-quiz-pedagogy.js).
 *
 * WHAT DOES NOT COUNT, and why each is excluded rather than tolerated:
 *   - third-person description: «بچے کھیل رہے ہیں»، «پودے دھوپ سے خوراک بناتے
 *     ہیں»، «ہر قطار میں 9 کرسیاں آئیں گی» — the verb agrees with a noun that is
 *     not the child;
 *   - the generic habitual with no subject: «'ہ' کو ہٹا کر 'ے' لگاتے ہیں» (one
 *     does X) — it describes a rule, it does not address anybody;
 *   - first person plural, «ہم … کریں گے» — "we", the class, not a guess about
 *     the child; out of this rule's scope;
 *   - an honorific third person: «آپ ﷺ …»، «آپ رضی اللہ عنہ …» — on an Islamiyat
 *     item that آپ is the Prophet ﷺ or a companion, and the masculine is simply
 *     correct; and PAST forms with آپ («آپ … کرتے تھے»), which in a quiz are
 *     almost always that same narrative honorific;
 *   - anything inside quotation marks — an example sentence the lesson is ABOUT
 *     («جملہ "چنٹو اور رانی چاٹ کھائیں گے" کس زمانے کا ہے؟»). Rewriting it would
 *     change the grammar the question tests.
 *
 * Measured before it was wired on 2,113 real authored Urdu questions (15,933
 * child-facing lines, nine models plus production): the labelled set and the
 * numbers are in the pull request that added this file.
 *
 * Pure: strings in, strings out. No network, no DB, no logging.
 */

// Urdu LETTERS (and the harakat inside a word) — not the whole Arabic block,
// which also holds the punctuation «،», «؛», «؟» and «۔». A word boundary drawn
// on the block would say «ہیں،» has no end, and a sentence's last verb is
// exactly where the comma and the full stop sit.
const UR = '\\u0610-\\u061A\\u0620-\\u065F\\u066E-\\u06D3\\u06D5-\\u06FF';
const NOT_UR_BEFORE = `(?<![${UR}])`;
const NOT_UR_AFTER = `(?![${UR}])`;

// ── text preparation ─────────────────────────────────────────────────────────
// Bidi marks the validator adds (RLM) and the joiners some models emit must not
// split or glue words, and «کریںگے» is written joined about as often as not.
function normalise(text) {
  return String(text ?? '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/ں(گے|گی)(?![\u0620-\u065F\u066E-\u06D3\u06D5-\u06FF])/g, 'ں $1')
    .replace(/\s+/g, ' ');
}

// Quoted material is data, not address: an example sentence, a word the lesson
// is about, a line a child said. Each balanced pair is blanked out; a stray
// apostrophe with no partner is left alone.
const QUOTE_PAIRS = [["'", "'"], ['"', '"'], ['‘', '’'], ['“', '”'], ['«', '»']];
function blankQuotes(text) {
  let s = text;
  QUOTE_PAIRS.forEach(([open, close]) => {
    const re = new RegExp(`${escape(open)}[^${escape(open)}${escape(close)}\\n]{0,240}${escape(close)}`, 'g');
    s = s.replace(re, ' ◊ ');
  });
  return s;
}
function escape(c) { return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const SENTENCE_END = /[۔؟?!؛;\n]+|\.(?!\d)/;
// A new clause with (possibly) its own subject begins at these conjunctions:
// «… کہ پودے بڑھتے ہیں», «… تو آپ کیا کریں گے». A comma does NOT end the scan
// for آپ's verb («جیسے آپ اپنی چیزوں — کتاب، کاپی، بیگ — کو … رکھتے ہیں»), and
// neither does the relative «جو» («آپ جو فورس لگاتے ہیں وہ پش ہے»).
const CONJUNCTION = new RegExp(`${NOT_UR_BEFORE}(?:کہ|تو|اگر|جب|تاکہ|کیونکہ|لیکن|مگر|بلکہ|یعنی|جبکہ|ورنہ|چونکہ)${NOT_UR_AFTER}`);
const CLAUSE_SPLIT = new RegExp(`[،,:]|${CONJUNCTION.source}`);
/** How far past آپ its verb is looked for, in characters. */
const AAP_WINDOW = 90;

// ── the gendered forms ───────────────────────────────────────────────────────
// Present, future, progressive and perfect. PAST forms (تھے/تھیں/تھا/تھی) are
// deliberately absent: with آپ they are the narrative honorific.
const GENDERED_AFTER_AAP = new RegExp([
  `[^\\s]*(?:یں|ئیں) (?:گے|گی)${NOT_UR_AFTER}`,                         // کریں گے، دیں گی
  `${NOT_UR_BEFORE}ہوں (?:گے|گی)${NOT_UR_AFTER}`,                        // کھڑے ہوں گے
  `[^\\s]*[وؤ] (?:گے|گی)${NOT_UR_AFTER}`,                                // کرو گے، جاؤ گی
  `[^\\s]+(?:تے|تی|تیں) (?:ہیں|ہو|ہوں)${NOT_UR_AFTER}`,                 // جاتے ہیں، سکتی ہیں
  `${NOT_UR_BEFORE}نہیں (?:[^\\s]+ )?[^\\s]+(?:تے|تی|تیں)${NOT_UR_AFTER}`, // نہیں کر سکتے (the auxiliary drops)
  `[^\\s]+(?:تے|تیں)(?=\\s*(?:[،,؛;:۔؟?!]|$))`,                          // … لکھتے۔  (clause-final, no auxiliary)
  `${NOT_UR_BEFORE}(?:رہے|رہی|رہیں) (?:ہیں|ہو|ہوں)${NOT_UR_AFTER}`,     // کر رہے ہیں، سوچ رہے ہوں گے
  `${NOT_UR_BEFORE}(?:چکے|چکی|چکیں) (?:ہیں|ہو|ہوں)${NOT_UR_AFTER}`,     // کر چکے ہیں
  `${NOT_UR_BEFORE}(?:گئے|گئی|گئیں|آئے|ہوئے|ہوئی|ہوئیں|بیٹھے|بیٹھی) (?:ہیں|ہو|ہوں)${NOT_UR_AFTER}`,
].join('|'));
// A PERFECTIVE with no auxiliary, closing its clause: «آپ 0 کو گننا بھول گئے۔»,
// «آپ سمجھ گئیں»، «آپ … کر چکے۔». Measured on 2,400 production Urdu items (R11):
// the one address class the forms above missed — they know گئے / چکے / بیٹھے only
// WITH ہیں / ہو / ہوں. A simple past, so it is read only where no honorific is in
// the FIELD (addressForms): the narrative «… ﷺ … ۔ آپ مدینہ تشریف لے گئے» names
// the Prophet ﷺ a sentence earlier, and that آپ is him.
const PERFECTIVE_AFTER_AAP = new RegExp(
  `[^\\s]+\\s+(?:گئے|گئی|گئیں|چکے|چکی|چکیں|بیٹھے|بیٹھی|بیٹھیں)(?=\\s*(?:[،,؛;:۔؟?!]|$))`,
);
// Words that end like a habitual participle but are a noun or an invariant
// adjective: «آپ بہت محنتی ہیں» says nothing about gender.
const NOT_A_PARTICIPLE = new RegExp(`${NOT_UR_BEFORE}(?:محنتی|قیمتی|گنتی|کشتی|بستی|ہستی|سستی|مستی|دوستی|جنتی|پتی|چھتی|ذاتی|وقتی|قسمتی)${NOT_UR_AFTER}`);
// آپ's own verb is neutral, so the scan stops there: a copula («آپ خوش ہیں»)
// or a subjunctive / imperative that ends its phrase («اگر آپ غور کریں، …»).
const NEUTRAL_STOP = new RegExp(
  `${NOT_UR_BEFORE}(?:ہے|ہیں|تھا|تھی|تھے|تھیں)${NOT_UR_AFTER}`
  + `|[^\\s]*(?:یں|ئیں|وں)(?=\\s*(?:[،,؛;:۔؟?!]|$))`,
);

// آپ is the subject unless a case marker or postposition follows it, or an
// honorific that makes it the Prophet ﷺ or a companion.
const AAP = new RegExp(`${NOT_UR_BEFORE}آپ${NOT_UR_AFTER}`, 'g');
const AAP_NOT_SUBJECT = new RegExp(
  `^\\s*(?:(?:نے|کو|کا|کی|کے|سے|پر|میں|تک|جیسا|جیسی|جیسے|والا|والی|والے|سمیت|کیلئے|کیلیے)${NOT_UR_AFTER}|ﷺ|\\(ﷺ|صلی|صلّی|رضی|علیہ|علیہا|رحمۃ|رحمت|رحمہ)`,
);
const AAP_HONORIFIC_AFTER = /^\s*(?:ﷺ|\(ﷺ|صلی|صلّی|رضی|علیہ|علیہا|رحمۃ|رحمت|رحمہ)/;
// A sentence that has already named the Prophet ﷺ, a companion or a prophet
// uses آپ for THEM from then on: «حضرت خدیجہ نے یقین دلایا کہ … آپ … کرتے ہیں».
const HONORIFIC = /ﷺ|صلی اللہ|صلّی اللہ|رضی اللہ|علیہ السلام|علیہا السلام|رحمۃ اللہ|رحمت اللہ|حضرت/;

// A future form with no subject at all: «… لگائیں گے», «… پڑھیں گی». (A
// 1st-person «کروں گی» or a «ہوں گے» never has this shape.)
const FUTURE = new RegExp(`(?:^|\\s)([^\\s]+)\\s+([^\\s]*(?:یں|ئیں))\\s+(گے|گی)${NOT_UR_AFTER}`, 'g');
// Verbs whose subject is a THING or a quantity, never the child: «بنیں گے»,
// «ملیں گی» (the experiencer takes کو), «آئیں گی», «بچیں گے».
const UNACCUSATIVE = new Set([
  'رہیں', 'بنیں', 'ملیں', 'بچیں', 'آئیں', 'لگیں', 'چلیں', 'گریں', 'اگیں', 'اُگیں',
  'بڑھیں', 'گھٹیں', 'پہنچیں', 'نکلیں', 'ٹوٹیں', 'پگھلیں', 'اڑیں', 'اُڑیں', 'ڈوبیں', 'سوکھیں',
  'مریں', 'بدلیں', 'گزریں', 'کھلیں', 'سمائیں', 'پھیلیں', 'جلیں', 'بجیں', 'چمکیں',
  'رکیں', 'ٹھہریں', 'بہیں', 'پکیں', 'سڑیں', 'بکھریں', 'ابلیں', 'جمیں', 'پھٹیں', 'چھائیں',
]);
// «جائیں» is a motion verb («پارک کیسے جائیں گے؟» — the child goes) unless it
// is the light verb after an intransitive stem («بچ جائیں گی», «ہو جائیں گے»).
const LIGHT_JAANA_STEM = new Set([
  'ہو', 'رہ', 'بن', 'مل', 'بچ', 'لگ', 'گر', 'اگ', 'بڑھ', 'نکل', 'ٹوٹ', 'پگھل', 'اڑ', 'ڈوب', 'بدل',
  'گزر', 'پہنچ', 'چپک', 'بجھ', 'تھک', 'پھنس', 'ڈر', 'کھو', 'بھر', 'سوکھ', 'مر', 'جل', 'سمٹ',
  'پھیل', 'بکھر', 'رک', 'پھٹ', 'سڑ', 'پک', 'جم', 'گھل', 'کٹ', 'بٹ', 'چھپ', 'مٹ', 'ختم',
]);
// «ہو سکیں گے», «بچ پائیں گے»: the ability verbs inherit their main verb's subject.
const MODAL = new Set(['سکیں', 'پائیں']);
// A subject other than the child, named before the verb: «وہ … دیں گے»,
// «بچے … کھیلیں گے», «مکہ والے … دیں گے». Followed by a postposition it is not
// a subject at all: «سب سے پہلے», «ٹیچر کے بتائے طریقے سے», «دونوں کی قیمت».
const POSTPOSITION_AHEAD = `(?!\\s*(?:نے|کو|کا|کی|کے|سے|پر|میں|تک)${NOT_UR_AFTER})`;
const OTHER_SUBJECT = new RegExp(
  `${NOT_UR_BEFORE}(?:وہ|تم|سب|دونوں|لوگ|بچے|بچیاں|طلبہ|طالبات|لڑکے|لڑکیاں|انسان|جانور|پرندے|دوست|استاد|ٹیچر|کسان|مزدور|ڈاکٹر|والے|کفار|مسلمان|صحابہ|انصار|مہاجرین)${NOT_UR_AFTER}${POSTPOSITION_AHEAD}`,
);
// "We" — the class, not a guess about the child. A field that speaks as ہم
// («اگر ہمیں … ہو تو کیا کریں گے؟») carries that subject into its futures.
// «ہم» as a SUBJECT (not «ہمیں», «ہمارے»…, not «ہم نے/کو…»).
const WE_SUBJECT = new RegExp(`${NOT_UR_BEFORE}ہم${NOT_UR_AFTER}${POSTPOSITION_AHEAD}`);
// «آئیں / آئیے … حل کریں» opening a stem is "let us" — we, too.
const COORDINATED = new RegExp(`^\\s*اور${NOT_UR_AFTER}`);
const WE = new RegExp(`${NOT_UR_BEFORE}(?:ہم|ہمیں|ہمارا|ہماری|ہمارے)${NOT_UR_AFTER}|^\\s*(?:آئیں|آئیے)\\s`);

/** آپ as the SUBJECT of this position — not آپ نے/کو/کا…, not آپ ﷺ, not after a named honorific. */
function aapIsSubject(sentence, index, len) {
  const after = sentence.slice(index + len);
  if (AAP_NOT_SUBJECT.test(after)) return false;
  return !HONORIFIC.test(sentence.slice(0, index));
}

/** آپ in any case form, that is the child and not an honorific third person. */
function hasChildAap(text) {
  const s = String(text || '');
  AAP.lastIndex = 0;
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = AAP.exec(s))) {
    const after = s.slice(m.index + m[0].length);
    if (AAP_HONORIFIC_AFTER.test(after)) continue;
    if (HONORIFIC.test(s.slice(0, m.index))) continue;
    return true;
  }
  return false;
}

/** The first gendered verb form for an آپ at `index`, or null. */
function aapVerb(sentence, index, len, { perfective = true } = {}) {
  let scope = sentence.slice(index + len);
  const cut = CONJUNCTION.exec(scope);
  if (cut) scope = scope.slice(0, cut.index);
  scope = scope.slice(0, AAP_WINDOW);
  const gendered = GENDERED_AFTER_AAP.exec(scope);
  const hit = gendered || (perfective ? PERFECTIVE_AFTER_AAP.exec(scope) : null);
  if (!hit) return null;
  // A perfective after a subject of its own belongs to that subject: «آپ … آئس
  // کریم لائے اور وہ پگھل گئی» — the ice cream melted (production, R11).
  if (!gendered && OTHER_SUBJECT.test(scope.slice(0, hit.index))) return null;
  if (NOT_A_PARTICIPLE.test(hit[0])) return null;
  const stop = NEUTRAL_STOP.exec(scope);
  if (stop && stop.index < hit.index) return null;
  // «ہم» as a subject before the verb makes it "we"'s verb, not آپ's:
  // «آپ … شامل کریں اور … کل ہم کیا کر سکتے ہیں؟». (Only ہم: a noun after آپ is
  // nearly always its object — «آپ وہ غلطی کر رہے ہیں», «آپ نئے دوست بنا سکیں گے».)
  if (WE_SUBJECT.test(scope.slice(0, hit.index))) return null;
  return hit[0].trim();
}

/** A subjectless future in this clause whose subject can only be the child, or null. */
function subjectlessFuture(clause) {
  FUTURE.lastIndex = 0;
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = FUTURE.exec(clause))) {
    const [, prev, verb, aux] = m;
    const agentive = prev === 'لے'                                      // لے آئیں / لے جائیں: bring, take
      || (verb === 'جائیں' ? !LIGHT_JAANA_STEM.has(prev)
        : !UNACCUSATIVE.has(verb) && !(MODAL.has(verb) && LIGHT_JAANA_STEM.has(prev)));
    if (!agentive) continue;
    const before = clause.slice(0, m.index + m[0].lastIndexOf(verb));
    if (OTHER_SUBJECT.test(before)) continue;
    return `${verb} ${aux}`;
  }
  return null;
}

/**
 * Every second-person gendered form in one field, as the words that matched.
 *
 * @param {string} text
 * @param {{kind?: 'stem'|'option'|'explanation'|'feedback', stemAddressesChild?: boolean, stemHonorific?: boolean}} opts
 *   `kind` decides whether a SUBJECTLESS future counts: in a stem always (a
 *   question is put to the child); in an option unless the stem it answers
 *   has put the question to "we" or a third person (see stemAddressesChild); in an explanation or a feedback line only when
 *   that field already speaks to the child as آپ. An option under a stem about
 *   the Prophet ﷺ or a companion reads its آپ as that honorific third person.
 * @returns {string[]}
 */
function addressForms(text, { kind = 'stem', stemAddressesChild: toChild = true, stemHonorific = false } = {}) {
  const src = blankQuotes(normalise(text));
  if (!/[\u0600-\u06FF]/.test(src)) return [];
  if (kind === 'option' && stemHonorific) return [];
  const out = [];
  const fieldHasWe = WE.test(src);
  // A field that names the Prophet ﷺ or a companion anywhere tells a narrative
  // about them: its perfectives are theirs, never the child's.
  const perfective = !HONORIFIC.test(src);
  const futuresToChild = kind === 'stem' ? !fieldHasWe
    : kind === 'option' ? toChild && !fieldHasWe
      : hasChildAap(src) && !fieldHasWe;
  src.split(SENTENCE_END).forEach((sentence) => {
    if (!sentence.trim()) return;
    // 1 — an explicit آپ as the subject, and the first verb that belongs to it
    const explicit = [];
    AAP.lastIndex = 0;
    let m;
    // eslint-disable-next-line no-cond-assign
    while ((m = AAP.exec(sentence))) {
      if (!aapIsSubject(sentence, m.index, m[0].length)) continue;
      explicit.push(m.index);
      const verb = aapVerb(sentence, m.index, m[0].length, { perfective });
      if (verb) out.push(`آپ … ${verb}`);
    }
    // 2 — a subjectless future, in a clause with no آپ of its own
    if (!futuresToChild) return;
    let offset = 0;
    let named = false;   // the previous clause named its own subject
    sentence.split(CLAUSE_SPLIT).forEach((clause) => {
      const at = sentence.indexOf(clause, offset);
      offset = at + clause.length;
      // «… وہ جواب دے سکیں گے، اور نظم پڑھ سکیں گے»: a clause joined by «اور»
      // keeps the subject of the clause before it.
      const inherits = named && COORDINATED.test(clause);
      named = OTHER_SUBJECT.test(clause) || inherits;
      if (inherits || explicit.some((i) => i >= at && i < at + clause.length)) return;
      const f = subjectlessFuture(clause);
      if (f) out.push(f);
    });
  });
  return out;
}

/**
 * Whose answer is an option? The child's — an option is what the child picks
 * and says — unless the stem has put the question to someone else: "we"
 * («ہم کیا کریں گے؟» → «پلس کریں گے» is we), a named third person («وہ … »,
 * «بچے … »), or the Prophet ﷺ or a companion. A stem that itself speaks to
 * the child as آپ, or carries a gendered form of its own, always passes it on.
 */
function stemAddressesChild(stem) {
  const s = blankQuotes(normalise(stem));
  if (addressForms(s, { kind: 'stem' }).length) return true;
  AAP.lastIndex = 0;
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = AAP.exec(s))) {
    if (aapIsSubject(s, m.index, m[0].length)) return true;
  }
  return !WE.test(s) && !HONORIFIC.test(s) && !OTHER_SUBJECT.test(s);
}

/** A stem about the Prophet ﷺ or a companion that is not itself put to the child. */
function stemIsHonorific(stem) {
  const s = normalise(stem);
  return HONORIFIC.test(s) && !stemAddressesChild(s);
}

/** The child-facing fields of one question, each with its kind. */
function childFields(q) {
  const fb = (q && q.option_feedback) || {};
  return [
    ['question', 'stem', q && q.question],
    ...(Array.isArray(q && q.options) ? q.options : []).map((o) => ['options', 'option', o]),
    ['explanation', 'explanation', q && q.explanation],
    ['option_feedback', 'feedback', fb.correct],
    ...Object.values(fb.wrong || {}).map((v) => ['option_feedback', 'feedback', v]),
  ];
}

/**
 * The second-person gendered forms in ONE question, with the fields they sit in.
 * `perField` lists every child-facing field that matched, with its own forms,
 * so a measurement can be read line by line.
 * @returns {{fields:string[], forms:string[], perField:{field:string, kind:string, text:string, forms:string[]}[]}}
 */
function questionAddressForms(q) {
  if (!q || typeof q !== 'object') return { fields: [], forms: [], perField: [] };
  const ctx = { stemAddressesChild: stemAddressesChild(q.question), stemHonorific: stemIsHonorific(q.question) };
  const fields = [];
  const forms = [];
  const perField = [];
  childFields(q).forEach(([field, kind, value]) => {
    if (typeof value !== 'string') return;
    const f = addressForms(value, { kind, ...ctx });
    if (f.length) {
      if (!fields.includes(field)) fields.push(field);
      forms.push(...f);
      perField.push({ field, kind, text: value, forms: f });
    }
  });
  return { fields, forms, perField };
}

module.exports = { questionAddressForms, addressForms };
