/**
 * Conformance: the language offer has ONE definition, and the clamp ONE
 * implementation.
 *
 * The audit found six competing definitions of "the supported languages" (a
 * seventh and eighth turned up later), and the same en/ur clamp written out
 * inline at 23 call sites. Every individual copy was correct. The defect was
 * structural: nothing stopped the 24th from being written differently, and
 * several had already drifted — some clamped a stored preference, some a
 * detected language, some a Flow field, and one silently mapped Sindhi to Urdu.
 *
 * These guards are what make the sweep permanent rather than a one-off tidy.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

/** Files that are ALLOWED to define the offer, because they are the definition. */
const SOURCE_OF_TRUTH = [
  'bot/shared/config/languages.js',   // the registry
  'bot/shared/config/ux-strings.js',  // the one clamp + the copy
  'bot/shared/utils/language-canon.js', // recognition, deliberately broader than the offer
];

/**
 * Deliberately NOT flagged. Each looks like the clamp and is a different
 * operation — the reason a regex-driven sweep would have introduced bugs:
 *
 *   script inference   hasUrduScript / hasArabicScript ? 'ur' : 'en'
 *   country inference  country === 'PK' ? 'ur' : 'en'
 *   label inference    reading a language back off rendered Urdu text
 *   Sindhi mapping     'ur' || 'sd' ? 'ur' : 'en'  — collapses sd to UR, not EN
 *   benchmark lookup   language === 'ur' && isSecondLanguage — picks a table
 *
 * The guard below is narrow on purpose: it matches only the exact clamp shape,
 * `=== 'ur' ? 'ur' : 'en'` with nothing in between, so none of the above trip it.
 */
const CLAMP_RE = /===\s*'ur'\s*\?\s*'ur'\s*:\s*'en'/;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', '.git', 'coverage'].includes(e.name)) continue;
      walk(p, out);
    } else if (e.name.endsWith('.js')) {
      out.push(p);
    }
  }
  return out;
}

/** Strip comments so a doc comment describing the old pattern is not an offender. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const BOT_FILES = walk(path.join(ROOT, 'bot'));

describe('language conformance — one clamp', () => {
  it('has no inline en/ur clamp left in bot/', () => {
    const offenders = [];
    for (const f of BOT_FILES) {
      const rel = path.relative(ROOT, f);
      if (SOURCE_OF_TRUTH.includes(rel)) continue;
      const code = stripComments(fs.readFileSync(f, 'utf8'));
      code.split('\n').forEach((line, i) => {
        if (CLAMP_RE.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('still allows the legitimate non-clamp inferences to exist', () => {
    // A sanity check on the guard itself: if someone tightens CLAMP_RE until it
    // also matches script/country inference, this fails and explains why.
    const samples = [
      "const l = hasUrduScript ? 'ur' : 'en';",
      "const userLang = country === 'PK' ? 'ur' : 'en';",
      "formData.language === 'ur' || formData.language === 'sd' ? 'ur' : 'en'",
      "const lookupLang = language === 'ur' && isSecondLanguage ? 'ur' : 'en';",
    ];
    for (const s of samples) {
      expect(CLAMP_RE.test(s)).toBe(false);
    }
  });

  it('would still catch a newly written clamp', () => {
    expect(CLAMP_RE.test("const l = lang === 'ur' ? 'ur' : 'en';")).toBe(true);
    expect(CLAMP_RE.test("return x.preferred_language === 'ur' ? 'ur' : 'en'")).toBe(true);
  });
});

/**
 * The distinction that makes this guard correct rather than merely strict.
 *
 * "How many languages exist?" has TWO right answers here, and conflating them is
 * why a naive sweep would be wrong:
 *
 *   OFFER      — what a teacher may be given or shown. Exactly en + ur. Any
 *                second definition of this is a bug, because two pickers that
 *                disagree is the original defect.
 *   RECOGNITION— what we can detect, transcribe or canonicalise. Deliberately
 *                BROADER than the offer, because telemetry has to be able to
 *                record that something off-market happened. That is how the
 *                Punjabi and Arabic leak was found in the first place. Clamping
 *                these would blind the instruments.
 *
 * Each entry below is one of: recognition-side (permanent), an upstream seam
 * (permanent), or a dated deferral with the reason it is not in this change.
 */
const ALLOWED_LISTS = {
  // ---- recognition-side: permanently broader than the offer, by design ----
  'bot/shared/services/language-detector.service.js':
    'RECOGNITION. Detects which language a teacher actually spoke, including ' +
    'ones we do not serve — Soniox writes Sindhi/Balochi/Pashto in Urdu script, ' +
    'so the detector must be able to name them to tell them apart. Narrowing it ' +
    'would make every regional speaker look like an Urdu speaker.',
  'bot/shared/services/audio.service.js':
    'RECOGNITION. Routes audio to the right ASR engine per language (Soniox vs ' +
    'MMS-ASR). The routing table is about what the vendors can transcribe, not ' +
    'about what we offer a teacher.',
  'bot/shared/services/pic-to-lp/pic-lp-wait-message.service.js':
    'RECOGNITION-adjacent. Keyed off a detected document language, not a stored ' +
    'preference.',

  // ---- upstream seam: not ours to narrow ----
  'bot/shared/config/system-messages.js':
    'UPSTREAM SEAM. The open platform\'s documented translation extension point ' +
    '(docs/agent-customization.md); nine languages on purpose, zero live callers, ' +
    'registered in tests/setup/orphan-modules.allowlist.json. Narrowing it would ' +
    'break the contract for downstream cloners.',

  // ---- dated deferrals: real offer-side lists, each with a reason ----
  'bot/shared/services/video/video-orchestrator.service.js':
    'DEFERRED (2026-08-06). A genuine R1 violation — a live teacher-facing picker ' +
    'offering 9 narration languages including Spanish and Tamil. Held out of the ' +
    'mechanical sweep on purpose: narrowing it changes behaviour for a whole ' +
    'feature and has its own tests under bot/tests/, so it belongs in a change ' +
    'that can be reviewed and reverted on its own. Verified NOT a profile writer — ' +
    'video language is per-artifact (classroom territory), never written to users.',
  'bot/whatsapp-bot.js':
    'DEFERRED (2026-08-06). The membership check that routes the video language ' +
    'reply. Moves with video-orchestrator above, in the same change.',
  'bot/shared/services/openai.service.js':
    'DEFERRED (2026-08-06). This is step 2.4 — the nine-language prompt ladder and ' +
    'the latent hardcoded-Urdu system seed. Touches the live AI path, so it is ' +
    'sequenced on its own rather than folded into a refactor.',
  'bot/shared/services/feature-intro.service.js':
    'DEFERRED (2026-08-06). Offer-side copy list (en/ur/ar/es). Low risk, but ' +
    'grouped with the 2.4 prompt work since both are copy-generation paths.',
  'bot/shared/services/feature-keyword-detector.service.js':
    'DEFERRED (2026-08-06). Same grouping as feature-intro.',
};

describe('language conformance — one offer', () => {
  /**
   * Any module holding an array literal of language codes is a competing offer.
   * Checked against the off-market codes that actually appeared in the audit,
   * rather than trying to detect "an array of languages" in the abstract.
   */
  const OFF_MARKET = ['sw', 'ar', 'es', 'pa-PK', 'sd-PK', 'ps-PK', 'bal-PK', 'ta-LK'];

  it('no unexplained module declares a multi-language offer array', () => {
    const offenders = [];
    for (const f of BOT_FILES) {
      const rel = path.relative(ROOT, f);
      if (SOURCE_OF_TRUTH.includes(rel)) continue;
      if (ALLOWED_LISTS[rel]) continue;
      // Tests may reference any language they like.
      if (rel.startsWith('bot/tests/')) continue;
      const code = stripComments(fs.readFileSync(f, 'utf8'));
      // An array literal containing 'ur' plus at least two off-market codes is an
      // offer list, not an incidental mention.
      for (const m of code.matchAll(/\[[^\]\n]{0,220}\]/g)) {
        const arr = m[0];
        if (!/'ur'/.test(arr)) continue;
        const hits = OFF_MARKET.filter((c) => arr.includes(`'${c}'`));
        if (hits.length >= 2) {
          offenders.push(`${rel} → ${hits.join(',')}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every allowlist entry carries a reason and still exists', () => {
    // Stops the allowlist rotting into a list of names nobody can justify, and
    // catches an entry left behind after its file was deleted or converged.
    for (const [rel, reason] of Object.entries(ALLOWED_LISTS)) {
      expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
      expect(reason.length).toBeGreaterThan(40);
      expect(reason).toMatch(/RECOGNITION|UPSTREAM SEAM|DEFERRED/);
    }
  });

  it('the coaching catalog derives its languages from the registry', () => {
    // It held the second-largest competing list (ten codes). Asserted directly
    // because it is the one this change converged.
    const { SUPPORTED_LANGUAGES } = require('../../bot/shared/config/coaching-messages');
    const { LANGUAGE_OFFER } = require('../../bot/shared/config/languages');
    expect(SUPPORTED_LANGUAGES).toEqual(LANGUAGE_OFFER);
  });
});
