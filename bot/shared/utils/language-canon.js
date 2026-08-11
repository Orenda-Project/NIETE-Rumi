/**
 * Canonicalise a language value at the boundary where it is stored or compared.
 *
 * Why this exists: the parent bot's worst language incident began with the
 * literal string 'swahili' reaching a database column. Everything downstream
 * compared against 'sw', so every check silently failed and teachers were
 * answered in the wrong language for days. Nothing normalised the value on the
 * way in.
 *
 * Two deliberate design choices:
 *
 * 1. This canonicalises; it does NOT clamp to what the deployment offers. An
 *    off-market code that is nonetheless a real language (say 'pa-PK') resolves
 *    to itself rather than being folded into 'en'. That distinction matters for
 *    telemetry: production output_language currently contains 19 Punjabi and 2
 *    Arabic rows for teachers whose stored preference is only ever en or ur,
 *    and that is exactly how the leak was found. Clamping on write would have
 *    hidden it. Restricting to the offer is the job of clampLanguage(), applied
 *    where a language is USED, not where it is RECORDED.
 *
 * 2. Unrecognisable input returns null, never a guess. A caller can then decide
 *    to omit the field rather than store something false.
 */

// Canonical codes we may legitimately see. Region-suffixed entries are kept
// distinct where the suffix carries meaning (Shahmukhi Punjabi vs Gurmukhi);
// bare regional variants of en/ur collapse to the base language.
const CANONICAL = new Set([
  'en', 'ur', 'ar', 'es', 'sw', 'hi',
  'pa-PK', 'sd-PK', 'ps-PK', 'bal-PK', 'ta-LK',
]);

// Spelled-out names and native-script labels seen in production data.
const ALIASES = {
  english: 'en',
  urdu: 'ur',
  'اردو': 'ur',
  arabic: 'ar',
  'العربية': 'ar',
  spanish: 'es',
  'español': 'es',
  swahili: 'sw',
  kiswahili: 'sw',
  hindi: 'hi',
  punjabi: 'pa-PK',
  shahmukhi: 'pa-PK',
  sindhi: 'sd-PK',
  pashto: 'ps-PK',
  pushto: 'ps-PK',
  balochi: 'bal-PK',
  tamil: 'ta-LK',
  // Bare regional codes that appear in older rows and vendor payloads.
  pa: 'pa-PK',
  sd: 'sd-PK',
  ps: 'ps-PK',
  bal: 'bal-PK',
  ta: 'ta-LK',
};

/**
 * @param {unknown} value - a language code, a spelled-out name, or junk
 * @returns {string|null} a canonical code, or null when unrecognisable
 */
function canonicalizeLanguageCode(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;

  // Exact canonical match first (preserves region-suffixed codes).
  if (CANONICAL.has(raw)) return raw;

  const lower = raw.toLowerCase();
  if (CANONICAL.has(lower)) return lower;
  if (ALIASES[lower]) return ALIASES[lower];

  // Region-suffixed input: 'ur-PK' -> 'ur', 'en_US' -> 'en'. Only collapse when
  // the base is itself canonical, so 'xx-YY' stays unrecognised.
  const base = lower.split(/[-_]/)[0];
  if (CANONICAL.has(base)) return base;
  if (ALIASES[base]) return ALIASES[base];

  return null;
}

module.exports = { canonicalizeLanguageCode, CANONICAL };
