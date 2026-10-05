'use strict';

/**
 * The feedback a child sees and hears on the web page after a WRONG pick.
 *
 * Video-bank rows store feedback shaped for WhatsApp, where options carry fixed letters:
 *
 *   "C) Good try! You mixed up X. The correct answer is B) Y, because Z. Keep going!"
 *   «A) اچھی کوشش! آپ نے … ۔ درست جواب B) … ہے، کیونکہ … ۔ چلیں آگے!»
 *
 * On the page the options are shuffled and badged differently, the page already names the right
 * answer ("Not yet. The answer is …"), and a wrong answer is never praised. So the page keeps only
 * the mix-up and the reason: the leading letter, the "correct answer is X)" clause (its "because"
 * reason is kept), praise and cheering, and any Urdu sentence that addresses the child with a
 * gendered verb are taken out. Pure: no I/O. An empty result means "nothing left to say" — the page
 * then says the question's why instead.
 */

// Whole sentences (or leading clauses) that only praise, console or cheer.
const CHEER = new RegExp('^(?:' + [
  '(?:good|nice|great) (?:try|effort|job|thinking|work)(?: (?:for )?trying)?', 'well done(?: (?:for )?trying)?', 'well tried',
  'keep (?:going|trying|practicing|practising|it up|learning)(?: to the end)?', "don'?t worry", 'no problem', 'oops', 'almost', 'try again', 'you can do it',
  'اچھی کوشش', 'اچھا کام', 'اچھا(?=\\s*[،,!])', 'کوئی بات نہیں', 'شاباش(?: کوشش(?: پر| کے لیے)?)?', 'جاری رکھیں', 'ہمت رکھیں', 'آگے بڑھیں', 'چلیں آگے', 'ہمت جاری(?: رکھیں)?', 'بہت خوب', 'کوشش جاری رکھیں', 'پیارے(?: بچے)?', 'پیاری(?: بچی)?',
  'کوئی مسئلہ نہیں', 'فکر نہ کریں', 'دوبارہ کوشش کریں', 'دھیان سے آگے بڑھیں', 'خوب',
].join('|') + ')(?:\\s*[!.،,۔:—–-]+\\s*|\\s*$)', 'i'); // a cheer word ends in punctuation or the sentence: «خوبصورتی» is kept

// "the correct answer is B) …" in either language.
const NAMES_ANSWER = /(?:the\s+)?(?:correct|right)\s+answer|درست جواب|صحیح جواب/i;
const BECAUSE = /\b(?:because|since)\b\s*|کیونکہ\s*|اس لیے کہ\s*/i;
// An Urdu sentence that speaks to the child with a gendered verb ("تم … سمجھ رہے ہو").
const GENDERED = /رہے ہو|رہی ہو|سکتے ہو|سکتی ہو|گئے ہو|گئی ہو|آئے ہو|آئی ہو|کرتے ہو|کرتی ہو|(^|\s)تم(\s|$)/;
// «آپ … رہے ہیں» is the masculine honorific: dropped when the sentence is about «آپ».
const GENDERED_AAP = /رہے ہیں|رہی ہیں|سکتے ہیں|سکتی ہیں|گئے ہیں|گئی ہیں|چکے ہیں|چکی ہیں/;
// Stored option letters: "A)", "(B)", "C:" at the start, and "A)" / "B ہے" references inside.
const LEAD_LETTER = /^\s*(?:\(?[A-D]\)|[A-D][.:])\s+/;
const LETTER_REF = /\(?\b[A-D]\)\s*/g;

function sentencesOf(text) {
  const out = [];
  let buf = '';
  // A sentence ends at . ! ? ۔ ؟ followed by a space or the end, so "Rs.8" and "2.5" stay whole.
  for (let i = 0; i < text.length; i += 1) {
    buf += text[i];
    if (!/[.!?۔؟]/.test(text[i])) continue;
    let j = i + 1;
    while (j < text.length && /["'”’»)\]]/.test(text[j])) { buf += text[j]; j += 1; } // a stop inside closing quotes
    if (j >= text.length || /\s/.test(text[j])) { out.push(buf.trim()); buf = ''; i = j - 1; }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function capitalise(s) {
  return s.replace(/^[a-z]/, (c) => c.toUpperCase());
}

function cleanSentence(s) {
  let t = s.replace(LEAD_LETTER, '');
  // A leading cheer clause ("Good try!", «کوئی بات نہیں،») in front of real content.
  for (let k = 0; k < 3; k += 1) {
    const m = t.match(CHEER);
    if (!m) break;
    t = t.slice(m[0].length);
  }
  if (!/[\p{L}\p{N}]/u.test(t)) return '';
  t = capitalise(t);
  if (NAMES_ANSWER.test(t)) {
    // Keep the reason after "because" / «کیونکہ»; else what follows a colon; else drop it.
    const b = t.search(BECAUSE);
    if (b >= 0) t = t.slice(b).replace(BECAUSE, '');
    else if (t.includes(':')) t = t.slice(t.indexOf(':') + 1);
    else return '';
    t = capitalise(t.trim());
  }
  if (GENDERED.test(t) || (/(^|\s)آپ(\s|$)/.test(t) && GENDERED_AAP.test(t))) return '';
  t = t.replace(LETTER_REF, '').replace(/\s+/g, ' ').trim();
  return /[\p{L}\p{N}]/u.test(t) ? t : '';
}

/**
 * @param {string} text  stored wrong-option feedback
 * @returns {string} the mix-up and the reason, or '' when nothing is left
 */
function cleanWrongFeedback(text) {
  if (text == null) return '';
  const raw = String(text).replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const kept = sentencesOf(raw).map(cleanSentence).filter(Boolean);
  return kept.join(' ').trim();
}

module.exports = { cleanWrongFeedback };
