'use strict';
/**
 * Soniox text-to-speech — the voice provider behind TTS_PROVIDER=soniox.
 *
 * One call = one voice note: the text is cleaned for Soniox (prepareForSoniox),
 * split at sentence ends into parts, the parts are spoken at the same time,
 * every part is checked to be a whole Ogg Opus stream, and the parts are joined
 * into ONE Ogg Opus stream — which WhatsApp shows as a voice message with a
 * speed control.
 *
 * Why each safeguard exists (measured on Soniox, not assumed):
 *   - Opus at 48 kHz: at Soniox's default rate the Ogg header states half the
 *     real length.
 *   - Parts: Soniox silently ends any single request at 2 minutes of audio and
 *     speaks at roughly real time, so a long note is split and the parts run in
 *     parallel — a 60-second reply arrives in about the time of its longest part.
 *   - Whole-stream check: a response can be cut mid-body and still arrive as
 *     "200 OK" bytes. A part without its end-of-stream page, at the 2-minute
 *     ceiling, or far too short for its text is retried, never delivered.
 *   - Retries only where another try can help: a dropped connection, 408, 429
 *     and 5xx. A 400/401/402/403 fails at once so the next provider speaks.
 */

const realAxios = require('axios');
const { prepareForSoniox, splitForSoniox } = require('../text/soniox-text');
const { checkComplete, concatOggOpus } = require('../ogg-opus');

const ENDPOINT = 'https://tts-rt.soniox.com/tts';
const DEFAULT_MODEL = 'tts-rt-v2';
const DEFAULT_VOICES = Object.freeze({ ur: 'Ishita', en: 'Grace' });
const USER_AGENT = 'voice-gateway/1.0';

const DEFAULT_LIMITS = Object.freeze({
  targetChars: 300,        // a part this long takes ~20-25 s to speak; parts run together
  maxChars: 900,           // hard ceiling: ~80 s of audio for the slowest voice, safely under 2 minutes
  maxPartSec: 118,         // audio this long means Soniox's 2-minute cut ended it, not the text
  minSecPerChar: 1 / 40,   // 40 characters a second is faster than any voice speaks: the audio was cut
  minCharsForRateCheck: 80,
  attempts: 3,
  // A stream can stall: on 30 Sep a one-line clip sent headers and then nothing
  // until a 90-second read timeout. Two clocks stop that: `idleTimeoutMs` is
  // axios' socket-inactivity timeout (it fires when no byte arrives for that
  // long — Soniox streams audio as it speaks, so a quarter-minute of silence is
  // a dead stream), and `totalCapMs` bounds one request by the length of its
  // text (about 10 characters a second for the slowest voice, spoken at roughly
  // real time, with room to spare).
  idleTimeoutMs: 15000,
  totalCapMs: (chars) => Math.max(30000, Math.ceil(chars / 10) * 1500 + 10000),
  concurrency: 4,          // parts in flight per process (the Soniox org allows 15 across everything)
});

class SonioxTtsError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'SonioxTtsError';
    this.code = code;
    Object.assign(this, extra);
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function baseLanguage(language) {
  return String(language || '').toLowerCase().split('-')[0];
}

// The reference id lands in Soniox's usage logs. It carries what a cost query
// needs (use case, site, request) and never a phone number: any long digit run
// — which is how a WhatsApp id looks — is removed.
function referenceId({ useCase, site, correlationId, part }) {
  const req = String(correlationId || '').replace(/\d{7,}/g, '').replace(/[^A-Za-z0-9_-]/g, '').slice(-24);
  return ['tts', useCase, site, req || undefined, `p${part}`].filter(Boolean).join('-').slice(0, 250);
}

function decodeErrorBody(data) {
  try {
    const text = Buffer.isBuffer(data) ? data.toString('utf8') : (data instanceof ArrayBuffer ? Buffer.from(data).toString('utf8') : String(data || ''));
    return text.slice(0, 300);
  } catch (_) {
    return '';
  }
}

function createSemaphore(getLimit) {
  let active = 0;
  const waiting = [];
  // A freed slot is handed straight to the next waiter (the count does not
  // drop), so a newcomer cannot slip in between and push past the limit.
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };
  return async function withSlot(fn) {
    if (active >= Math.max(1, getLimit())) await new Promise((resolve) => waiting.push(resolve));
    else active += 1;
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

/**
 * @param {object} [deps]
 * @param {{ post: Function }} [deps.http]  axios-compatible client (the network boundary)
 * @param {object} [deps.env]               read on every call, so a restart is the whole config change
 * @param {Function} [deps.sleep]           backoff delay (tests pass an instant one)
 * @param {object} [deps.limits]            overrides of DEFAULT_LIMITS
 * @param {Function} [deps.warn]            (message, data) for each retried attempt; the repo logger by default
 */
function createSonioxProvider({ http = realAxios, env = process.env, sleep, limits = {}, warn } = {}) {
  const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  // A retry the teacher never notices is still a vendor misbehaving: each one is
  // logged at warn with its reason, so a rising rate shows before an outage does.
  const logRetry = warn || ((message, data) => require('../../../utils/logger').logWarn(message, data));
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const apiKey = () => env.SONIOX_TTS_API_KEY || env.SONIOX_API_KEY || '';
  const concurrency = () => {
    const n = parseInt(env.SONIOX_TTS_MAX_CONCURRENCY, 10);
    return Number.isFinite(n) && n > 0 ? n : lim.concurrency;
  };
  const withSlot = createSemaphore(concurrency);

  function voiceFor(language) {
    const lang = baseLanguage(language);
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_VOICES, lang)) return null;
    return env[`SONIOX_TTS_VOICE_${lang.toUpperCase()}`] || DEFAULT_VOICES[lang];
  }

  function checkPart(audio, text) {
    const check = checkComplete(audio);
    if (!check.ok) return `stream ${check.reason}`;
    if (check.durationSec >= lim.maxPartSec) return `stream stopped at the ${Math.round(check.durationSec)} s ceiling`;
    const chars = [...text].length;
    if (lim.minSecPerChar > 0 && chars >= lim.minCharsForRateCheck && check.durationSec < chars * lim.minSecPerChar) {
      return `${check.durationSec.toFixed(1)} s is too short for ${chars} characters`;
    }
    return null;
  }

  async function speakPart({ text, lang, voice, model, ref, part, useCase, site }) {
    let lastError = null;
    for (let attempt = 1; attempt <= lim.attempts; attempt += 1) {
      if (attempt > 1) {
        logRetry('tts.soniox.retry', {
          event: 'tts.soniox.retry', useCase, site, part, attempt: attempt - 1, reason: lastError.message, status: lastError.status,
        });
        await wait(400 * 2 ** (attempt - 2) + Math.floor(Math.random() * 250));
      }
      try {
        const response = await withSlot(async () => {
          const controller = new AbortController();
          const cap = setTimeout(() => controller.abort(), lim.totalCapMs([...text].length));
          try {
            return await http.post(ENDPOINT, {
              model,
              text,
              language: lang,
              voice,
              audio_format: 'opus',
              sample_rate: 48000,
              bitrate: 64000,
              client_reference_id: ref,
            }, {
              headers: {
                Authorization: `Bearer ${apiKey()}`,
                'Content-Type': 'application/json',
                'User-Agent': USER_AGENT,
              },
              responseType: 'arraybuffer',
              timeout: lim.idleTimeoutMs,
              signal: controller.signal,
            });
          } finally {
            clearTimeout(cap);
          }
        });
        const audio = Buffer.from(response.data || []);
        const problem = checkPart(audio, text);
        if (!problem) return { audio, attempts: attempt };
        lastError = new SonioxTtsError('incomplete_audio', `Soniox returned an incomplete voice note: ${problem}`);
      } catch (error) {
        // A 2xx status on an error means the stream broke AFTER its header — a
        // mid-body cut or the idle timeout (axios attaches the 200 response to
        // both). That is the stream failing, not Soniox refusing: retry it.
        const status = error.response?.status;
        const refused = status && (status < 200 || status >= 300);
        if (refused && !RETRYABLE_STATUS.has(status)) {
          throw new SonioxTtsError('http_error', `Soniox TTS ${status}: ${decodeErrorBody(error.response?.data)}`, { status });
        }
        lastError = refused
          ? new SonioxTtsError('http_error', `Soniox TTS ${status}: ${decodeErrorBody(error.response?.data)}`, { status })
          : new SonioxTtsError('network_error', `Soniox TTS stream failed (${error.code || 'network'}): ${error.message}`);
      }
    }
    lastError.attempts = lim.attempts;
    throw lastError;
  }

  async function synthesize({ text, language, useCase, site, correlationId } = {}) {
    if (!apiKey()) throw new SonioxTtsError('not_configured', 'SONIOX_API_KEY is not set');
    const lang = baseLanguage(language);
    const voice = voiceFor(lang);
    if (!voice) throw new SonioxTtsError('unsupported_language', `No Soniox voice configured for "${language}"`);

    const { text: prepared, dropped } = prepareForSoniox(text, lang);
    if (!prepared || !prepared.replace(/\[[^\]]*\]/g, '').trim()) {
      throw new SonioxTtsError('empty_text', 'Nothing left to say after cleaning the text');
    }
    const parts = splitForSoniox(prepared, { targetChars: lim.targetChars, maxChars: lim.maxChars });
    const model = env.SONIOX_TTS_MODEL || DEFAULT_MODEL;

    const results = await Promise.all(parts.map((partText, i) => speakPart({
      text: partText, lang, voice, model, ref: referenceId({ useCase, site, correlationId, part: i }), part: i, useCase, site,
    })));

    return {
      audio: concatOggOpus(results.map((r) => r.audio)),
      voice,
      model,
      parts: parts.length,
      attempts: results.reduce((sum, r) => sum + r.attempts, 0), // requests made, across all parts
      textSent: prepared,
      dropped,
    };
  }

  return {
    name: 'soniox',
    isConfigured: () => Boolean(apiKey()),
    supports: (language) => Boolean(voiceFor(language)),
    voiceFor,
    synthesize,
  };
}

module.exports = { createSonioxProvider, sonioxProvider: createSonioxProvider(), SonioxTtsError, DEFAULT_LIMITS };
