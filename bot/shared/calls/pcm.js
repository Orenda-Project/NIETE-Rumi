'use strict';
/**
 * PCM16 helpers for the live-call audio bridge (bd-1hae7.1).
 *
 * Two fixed formats meet here:
 *   WhatsApp WebRTC → PCM16 mono at whatever rate the sink DELIVERS. The SDP
 *                     advertises 48 kHz but the decoded frames arrive at 16 kHz
 *                     in practice, so we always resample from `data.sampleRate`,
 *                     never from a hardcoded constant. (A fixed 48→24 conversion
 *                     is how you ship a chipmunk.)
 *   OpenAI Realtime → PCM16 mono @ 24 kHz, base64.
 *
 * Pure functions only — no I/O, no state. Everything that can go wrong with a
 * sample rate is catchable in unit tests instead of on a teacher's call.
 */

const OPENAI_RATE = 24000;
const WHATSAPP_RATE = 48000;

/**
 * Linear-interpolation resampler, any rate → any rate.
 * @param {Int16Array} input
 * @param {number} fromRate
 * @param {number} toRate
 * @returns {Int16Array}
 */
function resampleLinear(input, fromRate, toRate) {
  if (fromRate === toRate || input.length === 0) return input;
  const ratio = toRate / fromRate;
  const outLen = Math.max(0, Math.floor(input.length * ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i += 1) {
    const srcPos = i / ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const a = input[idx] === undefined ? 0 : input[idx];
    const b = input[idx + 1] === undefined ? a : input[idx + 1];
    out[i] = (a + (b - a) * frac) | 0;
  }
  return out;
}

/**
 * Interleaved multi-channel → mono by averaging. Returns the input untouched
 * when it is already mono (the sink often omits channelCount entirely).
 * @param {Int16Array} samples
 * @param {number} [channelCount]
 * @returns {Int16Array}
 */
function downmixToMono(samples, channelCount) {
  const channels = channelCount || 1;
  if (channels <= 1) return samples;
  const out = new Int16Array(Math.floor(samples.length / channels));
  for (let i = 0, j = 0; j < out.length; i += channels, j += 1) {
    let sum = 0;
    for (let c = 0; c < channels; c += 1) sum += samples[i + c];
    out[j] = (sum / channels) | 0;
  }
  return out;
}

/** PCM16 → base64 (honours the view's byteOffset — subarrays are common here). */
function int16ToBase64(samples) {
  return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).toString('base64');
}

/**
 * base64 → PCM16. Copies into a fresh aligned buffer first: a base64 payload can
 * land on an odd byte boundary, and viewing that directly as Int16 throws.
 */
function base64ToInt16(b64) {
  const buf = Buffer.from(b64, 'base64');
  const aligned = new ArrayBuffer(buf.length);
  new Uint8Array(aligned).set(buf);
  return new Int16Array(aligned, 0, Math.floor(buf.length / 2));
}

/**
 * Root-mean-square amplitude — the diagnostic that tells silence from noise
 * after a caller drop (WhatsApp keeps relaying audio either way).
 */
function rms(samples) {
  if (!samples || samples.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i += 1) sumSq += samples[i] * samples[i];
  return Math.sqrt(sumSq / samples.length);
}

module.exports = {
  OPENAI_RATE,
  WHATSAPP_RATE,
  resampleLinear,
  downmixToMono,
  int16ToBase64,
  base64ToInt16,
  rms,
};
