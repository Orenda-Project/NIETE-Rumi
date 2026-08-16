'use strict';
/**
 * Does this message ask for a lesson plan?
 *
 * Replaces an exact-match-only intercept
 *   /^(lp|lesson\s*plan|لیسن\s*پلان|lesson-plan|\/lp)$/i
 * which meant "can you send me the lesson plan for tomorrow" fell through to
 * the LLM intent path and, often enough, to a generated LP instead of the
 * ready-made corpus.
 *
 * Three tiers, because opening the menu on a false positive is cheap but not
 * free — it interrupts whatever the teacher was actually doing:
 *
 *   BLOCK   phrases that contain a trigger word but are plainly not a request
 *           ("lesson learned", "data plan"). Checked FIRST; wins over strong.
 *   STRONG  unambiguous — fires on a mention anywhere in the message.
 *   WEAK    a bare "plan" / "lesson" / "سبق" / "sabaq", which only counts when a
 *           teaching companion word is also present (a grade, a class, a
 *           subject, a chapter, or a day word).
 *
 * Deliberately NOT an LLM call: this runs on every inbound text, and a
 * deterministic matcher is testable, instant, and free.
 */

// ── BLOCK: checked first, wins over everything ──────────────────────────────
const BLOCK = [
  /\blessons?\s+learn(ed|t)\b/i,
  /\blife\s+lessons?\b/i,
  /\bvideo\s+lessons?\b/i,
  /\bbusiness\s+plan\b/i,
  /\bdata\s+plan\b/i,
  /\bpayment\s+plan\b/i,
  /\btravel\s+plan\b/i,
  /\bmeeting\s+plan\b/i,
  /\bplan\s+a\s+meeting\b/i,
  /\bplan\s+b\b/i,
];

// ── STRONG: a mention anywhere is enough ────────────────────────────────────
const STRONG = [
  /\/lp\b/i,
  /\blessons?[\s-]*plans?\b/i,
  /\blps?\b/i,
  /\bteaching\s+plans?\b/i,
  /\blesson\s+ka\s+plan\b/i,
  /\bplan\s+for\s+(the\s+)?class\b/i,
  /\bplan\s+for\s+(tomorrow|today)\b/i,
  // Urdu script
  /سبق\s*ک[اے]\s*منصوبہ/,
  /سبق\s*کی\s*منصوبہ\s*بندی/,
  /لیسن\s*پلان/,
  /سبق\s*کی\s*تیاری/,
  /منصوبہ\s*بندی/,
  /(^|[^\p{L}])منصوبہ([^\p{L}]|$)/u,
  // Roman Urdu — mansooba/mansuba/mansoba and sabaq/sabak variants
  /\bman[sz](oo?|u)ba\b/i,
  /\bsab[aá]?[qk]\s+ka\s+man[sz]/i,
  /\b(aaj|kal)\s+parhana\b/i,
  /\bparhana\s+hai\b/i,
  /\bkal\s+ki\s+class\b/i,
];

// ── WEAK: needs a companion ─────────────────────────────────────────────────
const WEAK = [
  /\bplan\b/i,
  /\blessons?\b/i,
  // JS \b is ASCII-only, so it never matches around Arabic script — a
  // Unicode-aware boundary is required or "سبق grade 3" silently never fires.
  /(^|[^\p{L}])سبق([^\p{L}]|$)/u,
  /\bsab[aá]?[qk]\b/i,
];

const COMPANION = [
  /\bgrade\s*\d/i,
  /\bclass\s*\d/i,
  /\bch(apter)?\.?\s*\d/i,
  /\bباب\b/,
  /\b(english|math|maths|urdu|science|general\s+science)\b/i,
  /\b(tomorrow|today|kal|aaj)\b/i,
  /\b(parh|padh|teach)/i,
  /\bsubject\b/i,
  /\bgrade\b/i,
  /\bclass\b/i,
];

// Slash commands belong to their own routers. /lp is ours.
const OTHER_COMMAND = /^\/(?!lp\b)[a-z]+/i;

const firstMatch = (patterns, text) => patterns.find((rx) => rx.test(text)) || null;

/**
 * @returns {{matched: boolean, tier: 'blocked'|'strong'|'weak'|'none', token: string|null}}
 */
function matchDetail(text) {
  if (typeof text !== 'string') return { matched: false, tier: 'none', token: null };
  const t = text.trim();
  if (!t) return { matched: false, tier: 'none', token: null };

  const blocked = firstMatch(BLOCK, t);
  if (blocked) return { matched: false, tier: 'blocked', token: String(blocked) };

  if (OTHER_COMMAND.test(t)) return { matched: false, tier: 'none', token: null };

  const strong = firstMatch(STRONG, t);
  if (strong) return { matched: true, tier: 'strong', token: String(strong) };

  const weak = firstMatch(WEAK, t);
  if (weak && firstMatch(COMPANION, t)) return { matched: true, tier: 'weak', token: String(weak) };

  return { matched: false, tier: 'none', token: null };
}

/** Does this message ask for a lesson plan? */
function isLessonPlanRequest(text) {
  return matchDetail(text).matched;
}

module.exports = { isLessonPlanRequest, matchDetail, BLOCK, STRONG, WEAK, COMPANION };
