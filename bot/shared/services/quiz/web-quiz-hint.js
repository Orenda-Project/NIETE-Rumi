'use strict';
/**
 * The mascot's hint: one short sentence a stuck child can ask Jugnu for BEFORE
 * answering. It points at the moment of the lesson the question tests, or at
 * what to think about. It never gives the answer.
 *
 * The web item call writes it (one more field in the same reply, only with
 * quiz_author_gates_v2 on); this module decides in CODE whether a hint gives
 * the answer away. A hint that does is dropped and the item is kept: a missing
 * hint costs a child nothing (Jugnu re-reads the question instead), a leaking
 * one teaches nothing.
 *
 *   names_option  the hint says an option's whole text (naming a WRONG option
 *                 rules it out, so that is a leak too), or a word only the KEY
 *                 has, the key's number, or the picture the key shows. A word
 *                 only a wrong option has is not (measured on a real run: "number"
 *                 and "away" dropped good hints).
 *   figure_word   the word a missing-letter picture spells ("S _ Y" → "sky")
 *   says_answer   "the answer is …" / «صحیح جواب …», whatever follows
 *   form_clue     a clue to the answer's FORM, not its meaning: what it sounds
 *                 like, rhymes with, starts or ends with, or a name it resembles
 *                 («… سے ملتی جلتی») — on a real Urdu quiz the model wrote "the
 *                 language whose name is like Balochistan's" for the key بلوچی
 *   too_long      more than one short sentence
 *
 * Pure: no DB, no network.
 */

const MAX_CHARS = 140;
const MAX_WORDS = 24;

const DIGITS = { '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };

// Words that carry no content of their own: an option sharing one with the hint is not named by it.
const STOP = new Set(('the a an and or of in on to is are was were be this that these those which what who how why when where '
  + 'for with from by it its as at do does did your you we our they their them has have had can will not no yes one '
  + 'کے کی کا میں ہے ہیں سے کو اور یہ وہ ایک کون کیا کس نے پر بھی تو ہو گا گی گے تھا تھی تھے').split(/\s+/));

const FORM_CLUE = /\b(?:sounds?\s+like|rhymes?\s+with|(?:starts?|begins?|ends?)\s+with\s+(?:the\s+|a\s+)?(?:letter|sound|syllable)|similar\s+to|resembles?|first\s+letter|last\s+letter|(?:has|have|includes?|contains?|with)\s+the\s+word)\b|ملت[اےی]\s+جلت[اےی]|سے\s+شروع|پہلا\s+حرف|آخری\s+حرف|ہم\s+آواز|جیسا\s+نام/i;
const SAYS_ANSWER = /\b(?:right|correct)\s+answer\b|\banswer\s+is\b|(?:صحیح|درست)\s+جواب|جواب\s+(?:ہے|یہ)/i;

/** Lower-case, Western digits, no Arabic-script diacritics, no punctuation, single spaces. */
function norm(text) {
  return String(text == null ? '' : text)
    .replace(/[۰-۹٠-٩]/g, (d) => DIGITS[d])
    .replace(/[ً-ٰٟۖ-ۭ‌-‏‪-‮⁦-⁩]/g, '')
    .toLowerCase()
    .replace(/\$|\\[a-z]+|[{}]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
const stemOf = (w) => (/^[a-z]+$/.test(w) && w.length > 3 ? w.replace(/(es|s)$/, '') : w);
const words = (text) => norm(text).split(' ').filter(Boolean);

/** Does `hay` contain `needle` as whole words (both already normalised)? */
function hasPhrase(hay, needle) {
  if (!needle) return false;
  return ` ${hay} `.includes(` ${needle} `);
}

/**
 * What a hint gives away about this item. [] = a clean hint.
 * @param {string} hint
 * @param {{stem:string, options:Array<{text:string, pic?:{name?:string}}>, left?:Array<{text:string}>}} item
 * @returns {string[]}
 */
function leaks(hint, item) {
  const out = new Set();
  const h = norm(hint);
  if (!h) return [];
  if (SAYS_ANSWER.test(String(hint))) out.add('says_answer');
  if (FORM_CLUE.test(String(hint))) out.add('form_clue');
  const hw = new Set(words(hint).map(stemOf));
  const stemWords = new Set(words(item && item.stem).map(stemOf));
  const opts = Array.isArray(item && item.options) ? item.options : [];
  const optWords = opts.map((o) => words(o && o.text).map(stemOf));
  // The keyed options: every option of an order/match item (the key is their order), else the key's slots.
  const keySlots = String((item && item.key) || '').toUpperCase().split(',').map((x) => x.trim()).filter(Boolean);
  const ordered = item && (item.type === 'order' || item.type === 'match');
  const isKey = (o) => ordered || !keySlots.length || keySlots.includes(String((o && o.slot) || '').toUpperCase());

  opts.forEach((o, i) => {
    const text = norm(o && o.text);
    // The option said whole ("milk", "7", "the seed is planted").
    if (text && hasPhrase(h, text)) out.add('names_option');
    // A plural / other form of a one-word option.
    if (text && !text.includes(' ') && hw.has(stemOf(text))) out.add('names_option');
    // A content word only this option has (not in the stem, not in another option) — for the key.
    if (isKey(o)) optWords[i].forEach((w) => {
      if (w.length < 3 || STOP.has(w) || stemWords.has(w)) return;
      if (optWords.some((ow, j) => j !== i && ow.includes(w))) return;
      if (hw.has(w)) out.add('names_option');
    });
    // The thing a picture option shows.
    const pic = o && o.pic && o.pic.name;
    if (pic && isKey(o)) String(pic).toLowerCase().split('_').filter((p) => p.length >= 3 && !STOP.has(p)).forEach((p) => {
      if (hw.has(stemOf(p))) out.add('names_option');
    });
  });
  // A word the picture spells with a gap in it ("S _ Y"): saying the word says the missing letter.
  const spec = item && item.figure && item.figure.spec;
  const figWords = spec && typeof spec === 'object' ? [spec.word, ...(Array.isArray(spec.words) ? spec.words : [])] : [];
  figWords.filter((w) => typeof w === 'string' && w.trim()).forEach((w) => {
    if (hasPhrase(h, norm(w))) out.add('figure_word');
  });
  // A number the options carry and the stem does not.
  const stemNums = new Set((norm(item && item.stem).match(/\d+/g) || []));
  opts.forEach((o) => (norm(o && o.text).match(/\d+/g) || []).forEach((n) => {
    if (!stemNums.has(n) && hasPhrase(h, n)) out.add('names_option');
  }));
  return [...out];
}

/**
 * The hint the model wrote, as the item will carry it, or why there is none.
 * @param {string|{text?:string, read?:string}} raw
 * @param {object} item  the normalised web item (stem, options, key)
 * @param {(s:string)=>string} spoken  the item module's own "words a voice can say"
 * @returns {{hint?:{text:string, read:string}, reason?:string}}
 */
function hintFor(raw, item, spoken = (s) => String(s || '').trim()) {
  const text = String((raw && typeof raw === 'object' ? raw.text : raw) || '').replace(/\s+/g, ' ').trim();
  if (!text) return { reason: 'none' };
  if ([...text].length > MAX_CHARS || text.split(' ').length > MAX_WORDS) return { reason: 'too_long' };
  const found = leaks(text, item);
  if (found.length) return { reason: found.includes('names_option') ? 'names_option' : found[0] };
  const read = spoken(raw && typeof raw === 'object' && raw.read ? raw.read : text) || text;
  if (leaks(read, item).length) return { reason: 'names_option' };
  return { hint: { text, read } };
}

/** The prompt's rule for the field (asked for only with the gates on). */
const HINT_RULE = '- "hint": ONE short sentence (at most 18 words) the mascot says to a child who is STUCK, before they answer. It points to the moment of the lesson in your source_quote, or to what to think about ("Think about what happens when you pour water into a glass."). NEVER say, spell, number or describe ANY option — not the right one, not a wrong one — never its number, never the thing its picture shows, never "the answer is", never what the answer sounds like, starts with or resembles. After the hint at least TWO options must still seem possible. For "order" and "match": how to START thinking, never a step or a pair. A hint that names an option is thrown away.';

module.exports = { leaks, hintFor, norm, HINT_RULE, MAX_CHARS };
