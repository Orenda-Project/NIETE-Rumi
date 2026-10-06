'use strict';
/**
 * The voice gateway — the one place a feature asks for a voice note.
 *
 *   const { audio, durationSec } = await tts.synthesize({
 *     text, language: 'ur', useCase: 'coaching', site: 'report_voicenote',
 *   });
 *
 * A feature says what it is saying (use case + site); configuration decides who
 * says it (routing.js). The first provider in the chain that returns a whole
 * Ogg Opus stream speaks; each earlier failure is logged at error, so a vendor
 * outage shows up as a fallback rate instead of passing quietly as a different
 * voice. The result is always Ogg Opus: WhatsApp shows it as a voice message
 * with a speed control.
 *
 * Nothing here reads or writes stored audio. Pre-recorded voice notes (the
 * lesson-plan voicenotes) are served from storage by their own path and never
 * pass through this module.
 */

const { resolveChain, USE_CASES } = require('./routing');
const { checkComplete } = require('./ogg-opus');
const { sonioxProvider } = require('./providers/soniox.provider');
const { elevenLabsProvider } = require('./providers/elevenlabs.provider');
const { openAiProvider } = require('./providers/openai.provider');
const { logError, logWarn } = require('../../utils/logger');
const { logEvent, getCurrentCorrelationId } = require('../../utils/structured-logger');
const { DEFAULT_LANGUAGE } = require('../../config/languages');

// Soniox bills about $0.722 per hour of audio; the other two by character and
// are left to their own dashboards. A cost column that is summable in Axiom is
// worth more than a perfect one that is not.
const SONIOX_USD_PER_AUDIO_SECOND = 0.722 / 3600;

class TtsUnavailableError extends Error {
  constructor(message, failures) {
    super(message);
    this.name = 'TtsUnavailableError';
    this.failures = failures;
  }
}

function describeFailure(provider, error) {
  return {
    provider,
    reason: error.code || 'error',
    status: error.status || error.response?.status || undefined,
    error: String(error.message || error).slice(0, 300),
  };
}

function createTtsGateway({
  providers = { soniox: sonioxProvider, elevenlabs: elevenLabsProvider, openai: openAiProvider },
  env = process.env,
  cassette = () => require('../e2e-cassette'),
} = {}) {
  async function runChain({ chain, text, language, useCase, site, correlationId, voice }) {
    const failures = [];
    for (const name of chain) {
      const provider = providers[name];
      if (!provider.supports(language)) continue;          // e.g. no Soniox voice for Pashto: not a failure
      if (!provider.isConfigured()) {                      // chosen but not set up: a failure, loudly
        failures.push({ provider: name, reason: 'not_configured' });
        continue;
      }
      try {
        const out = await provider.synthesize({ text, language, useCase, site, correlationId, ...(voice ? { voice } : {}) });
        const check = checkComplete(out.audio);
        if (!check.ok) {
          const err = new Error(`${name} returned audio that is not a whole Ogg Opus stream (${check.reason})`);
          err.code = 'bad_audio';
          throw err;
        }
        return { ...out, provider: name, durationSec: check.durationSec, failures };
      } catch (error) {
        failures.push(describeFailure(name, error));
      }
    }
    const error = new TtsUnavailableError(`No voice provider could speak this ${useCase} voice note`, failures);
    throw error;
  }

  // The E2E cassette (staging only) records and replays the audio at this seam.
  // While ElevenLabs is the primary, the key is the one the pre-gateway seam used,
  // so the recordings made before this module keep replaying. Any other primary
  // puts its provider and voice in the key: a recording of one voice can never
  // stand in for another.
  function cassetteKey({ primary, text, language, voice }) {
    if (primary === 'elevenlabs' && !voice) return { fn: 'generateSpeechForLanguage', text, languageCode: language };
    return { fn: 'tts.synthesize', provider: primary, voice: voice || providers[primary].voiceFor(language), text, language };
  }

  // A caller whose teacher is waiting can bound the whole attempt: past the
  // deadline the gateway gives up (the caller sends the words as text). The
  // provider's own request keeps running until its own caps stop it; its answer
  // is simply not used.
  function withDeadline(promise, deadlineMs) {
    if (!(deadlineMs > 0)) return promise;
    let timer;
    const expired = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new TtsUnavailableError(`No voice within ${deadlineMs} ms`,
        [{ provider: 'gateway', reason: 'deadline', error: `deadline ${deadlineMs} ms` }])), deadlineMs);
    });
    return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
  }

  // `provider` (+ `voice`) pins ONE voice for this call: no configured primary, no fallback. For a
  // feature whose lines must all sound alike (the web quiz) a clip in another voice is worse than
  // none: the call fails and the caller retries later. Every other caller is unchanged.
  async function synthesize({ text, language, useCase, site, correlationId, deadlineMs, provider: pin, voice } = {}) {
    const resolved = resolveChain({ useCase, site, env });
    if (pin && !Object.prototype.hasOwnProperty.call(providers, pin)) throw new TypeError(`tts.synthesize: unknown provider "${pin}"`);
    const chain = pin ? [pin] : resolved.chain;
    const source = pin ? 'pinned' : resolved.source;
    const ignored = pin ? [] : resolved.ignored;
    if (typeof text !== 'string' || !text.trim()) throw new TypeError('tts.synthesize: text is empty');
    // A caller always resolves the teacher's language; a missing one falls to the
    // deployment's emergency floor, never to a hard-coded language.
    const lang = String(language || DEFAULT_LANGUAGE);
    const corr = correlationId || getCurrentCorrelationId() || undefined;
    const job = ['tts', useCase, site].filter(Boolean).join('.');
    if (ignored.length) logError('tts.config.ignored', { event: 'tts.config.ignored', ignored, useCase, site });

    const started = Date.now();
    const primary = chain.find((name) => providers[name].supports(lang)) || chain[0];
    let result;
    try {
      const tape = cassette();
      if (tape.mode() !== 'off') {
        let live = null;
        const audio = await tape.wrapBuffer('tts', cassetteKey({ primary, text, language: lang, voice }), async () => {
          live = await runChain({ chain, text, language: lang, useCase, site, correlationId: corr, voice });
          return live.audio;
        });
        result = live || {
          audio, provider: primary, voice: voice || providers[primary].voiceFor(lang), parts: 1, attempts: 0,
          durationSec: checkComplete(audio).durationSec || 0, failures: [], dropped: [], cassette: 'replay',
        };
      } else {
        result = await withDeadline(runChain({ chain, text, language: lang, useCase, site, correlationId: corr, voice }), deadlineMs);
      }
    } catch (error) {
      logError('tts.synthesize.failed', {
        event: 'tts.synthesize.failed', job, useCase, site, language: lang, chain, source,
        chars: text.length, failures: error.failures, error: error.failures ? undefined : error.message,
        durationMs: Date.now() - started,
      });
      throw error;
    }

    const latencyMs = Date.now() - started;
    const failed = result.failures.filter((f) => f.provider !== result.provider);
    const fallbackFrom = failed.length ? failed[0].provider : null;
    logEvent('tts.synthesize.ok', {
      job, useCase, site, language: lang, provider: result.provider, voice: result.voice,
      model: `${result.provider}:${result.model || 'unknown'}`, source, chars: text.length,
      parts: result.parts, attempts: result.attempts, durationMs: latencyMs,
      audioSec: Math.round(result.durationSec * 10) / 10, bytes: result.audio.length, fallbackFrom,
      estimatedCostUsd: result.provider === 'soniox' ? Math.round(result.durationSec * SONIOX_USD_PER_AUDIO_SECOND * 1e6) / 1e6 : undefined,
      unclosed: result.unclosed, // Soniox only: parts whose response never closed (taken at their end page)
      cassette: result.cassette,
    });
    if (fallbackFrom) {
      logError('tts.synthesize.fallback', {
        event: 'tts.synthesize.fallback', job, useCase, site, language: lang, spokeWith: result.provider,
        failures: failed, source,
      });
    }
    if (result.dropped && result.dropped.length) {
      // Bracketed text that was not a voice direction. It was not spoken either
      // way. A template placeholder ("[Greeting]", a slot written in Urdu) means
      // something the teacher should have heard is missing — an error, fixed at
      // its source. An unknown lower-case stage direction only loses a tone.
      const placeholders = result.dropped.filter((d) => /[^\x20-\x7E]|\[\s*[A-Z]/.test(d));
      const data = { event: 'tts.text.dropped', job, useCase, site, dropped: (placeholders.length ? placeholders : result.dropped).slice(0, 5) };
      if (placeholders.length) logError('tts.text.dropped', data);
      else logWarn('tts.text.dropped', data);
    }

    return {
      audio: result.audio,
      mimeType: 'audio/ogg',
      extension: 'ogg',
      durationSec: result.durationSec,
      provider: result.provider,
      voice: result.voice,
      parts: result.parts,
      attempts: result.attempts,
      latencyMs,
      fallbackFrom,
      cassette: result.cassette,
    };
  }

  return { synthesize };
}

const gateway = createTtsGateway();

module.exports = {
  synthesize: (args) => gateway.synthesize(args),
  createTtsGateway,
  TtsUnavailableError,
  USE_CASES,
};
