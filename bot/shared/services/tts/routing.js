'use strict';
/**
 * Which voice provider speaks for a use case.
 *
 * The provider is configuration, never code: a feature says WHAT it is saying
 * (its use case, and optionally the site inside it) and this module answers
 * WHO says it, as an ordered chain — the first provider that succeeds speaks,
 * the rest are the fallback.
 *
 *   TTS_PROVIDER_<USE_CASE>_<SITE>   one site           e.g. TTS_PROVIDER_COACHING_REPORT_VOICENOTE
 *   TTS_PROVIDER_<USE_CASE>          one use case       e.g. TTS_PROVIDER_CONVERSATION
 *   TTS_PROVIDER                     every voice note
 *   (nothing set)                    elevenlabs          — exactly the behaviour before the gateway
 *   TTS_FALLBACK                     the order behind the primary (default "elevenlabs,openai"; "none" = no fallback)
 *
 * The first non-empty setting wins. Every value is read per call, so changing a
 * variable and restarting is the whole rollout — and unsetting it the whole
 * rollback.
 */

// The use cases a caller may name, and the sites inside each. The use cases are
// the unit the provider is switched by; the site only narrows it further and
// labels the telemetry.
const USE_CASES = Object.freeze({
  conversation: { sites: ['voice_reply', 'language_switch', 'name_retry', 'name_question'] },
  coaching: { sites: ['question', 'closer', 'report_voicenote'] },
  reading: { sites: ['feedback'] },
  video: { sites: ['narration'] },
});

const PROVIDERS = Object.freeze(['soniox', 'elevenlabs', 'openai']);
const DEFAULT_PRIMARY = 'elevenlabs';
const DEFAULT_FALLBACK = ['elevenlabs', 'openai'];

function envName(...parts) {
  return ['TTS_PROVIDER', ...parts].filter(Boolean).join('_').toUpperCase();
}

/**
 * @param {object} args
 * @param {string} args.useCase  one of USE_CASES
 * @param {string} [args.site]   a site inside the use case (free-form, upper-cased into the variable name)
 * @param {object} [args.env]    defaults to process.env
 * @returns {{ chain: string[], source: string, ignored: string[] }}
 *   chain   — providers to try in order (never empty)
 *   source  — the variable that chose the primary, or 'default'
 *   ignored — "NAME=value" for every value that named no known provider
 */
function resolveChain({ useCase, site, env = process.env } = {}) {
  if (!useCase || !Object.prototype.hasOwnProperty.call(USE_CASES, useCase)) {
    throw new Error(`TTS: unknown use case "${useCase}" — expected one of ${Object.keys(USE_CASES).join(', ')}`);
  }
  const ignored = [];
  const clean = (value) => String(value || '').trim().toLowerCase();

  let primary = null;
  let source = 'default';
  const candidates = [site ? envName(useCase, site) : null, envName(useCase), envName()].filter(Boolean);
  for (const name of candidates) {
    const value = clean(env[name]);
    if (!value) continue;
    if (PROVIDERS.includes(value)) { primary = value; source = name; break; }
    // A typo must not quietly route voice notes somewhere unexpected: report it
    // and keep looking, so the next setting (or the default) decides.
    ignored.push(`${name}=${value}`);
  }
  if (!primary) { primary = DEFAULT_PRIMARY; source = 'default'; }

  let fallback = DEFAULT_FALLBACK;
  const rawFallback = clean(env.TTS_FALLBACK);
  if (rawFallback === 'none') {
    fallback = [];
  } else if (rawFallback) {
    fallback = [];
    for (const name of rawFallback.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (PROVIDERS.includes(name)) fallback.push(name);
      else ignored.push(`TTS_FALLBACK=${name}`);
    }
  }

  const chain = [primary, ...fallback.filter((p) => p !== primary)]
    .filter((p, i, all) => all.indexOf(p) === i);
  return { chain, source, ignored };
}

module.exports = { resolveChain, USE_CASES, PROVIDERS };
