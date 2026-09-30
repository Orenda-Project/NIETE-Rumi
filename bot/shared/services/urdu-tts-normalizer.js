/**
 * FEAT-106 #4b (bd-2375) — runtime discipline for the Urdu Sara TTS path.
 *
 * NIETE's Urdu coaching voice is the canonical Sara / eleven_v3. Sara's two
 * hard-won failure modes (lp-voicenotes V20, bd-1524):
 *   1. Inline bare digits ("3", "43") render as gibberish ("alaran") — Sara has
 *      no reliable mapping for a Latin digit inside an Urdu sentence. Spell them
 *      as English number words, which she reads cleanly.
 *   2. Markdown emphasis (**bold**, *italic*, _x_) is read literally
 *      ("asterisk asterisk"). Strip it.
 *
 * This is the defensive preprocessor applied immediately before the ElevenLabs
 * call on the Urdu path (mirrors the main-bot `synthesizeVoiceReply` guard).
 * Pure + dependency-free → unit-testable.
 */

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function numToWords(n) {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o === 0 ? TENS[t] : `${TENS[t]}-${ONES[o]}`;
}

/**
 * @param {string|null} text
 * @returns {string|null}
 */
function normalizeForUrduTTS(text) {
  if (!text || typeof text !== 'string') return text;
  let out = text;

  // 1. Strip Markdown emphasis markers (keep the inner text).
  out = out.replace(/(\*\*|__)(.+?)\1/g, '$2');
  out = out.replace(/(\*|_)(.+?)\1/g, '$2');

  // 2. A decimal is one number: "31.3" → "thirty-one point three", its fraction
  //    read digit by digit ("2.05" → "two point zero five"). Spelled as two
  //    separate numbers it reached the voice as "thirty-one.three" and was
  //    heard as "thirty-one three". A dotted run such as a date (30.09.2026)
  //    is not a decimal and is left to the integer rule below.
  out = out.replace(/(?<![\d.])(\d+)\.(\d+)(?![.\d])/g, (m, whole, fraction) => {
    const n = parseInt(whole, 10);
    const wholeWords = n <= 99 ? numToWords(n) : whole;
    const fractionWords = fraction.split('').map((d) => ONES[Number(d)]).join(' ');
    return `${wholeWords} point ${fractionWords}`;
  });

  // 3. Spell inline 0–99 as English number words; leave larger numbers alone
  //    (rare in coaching copy, and less prone to the gibberish failure).
  out = out.replace(/\d+/g, (m) => {
    const n = parseInt(m, 10);
    return n <= 99 ? numToWords(n) : m;
  });

  return out;
}

module.exports = { normalizeForUrduTTS, numToWords };
