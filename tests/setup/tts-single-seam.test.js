/**
 * Every voice note goes through the voice gateway — the seam cannot be bypassed.
 *
 * Swapping the voice vendor is one environment variable only while no feature
 * calls a vendor itself. Video narration used to be exactly that exception: a raw
 * fetch to one vendor, with its own voice table and none of the fallback, timeout
 * or retry the rest had. This guard fails when bot code outside
 * bot/shared/services/tts calls a speech vendor or a pre-gateway speech function.
 *
 * Allowed on purpose:
 *   - bot/shared/services/tts/**            the gateway and its providers
 *   - bot/shared/services/elevenlabs.service.js   the ElevenLabs provider's transport
 *   - bot/shared/services/audio.service.js  its pre-gateway generateSpeechForLanguage
 *     definition (no callers; kept until the gateway is live everywhere)
 *   - bot/shared/calls/**                   live phone calls stream PCM over WebRTC,
 *     a different product from voice notes
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BOT_SHARED = path.join(ROOT, 'bot', 'shared');

const ALLOWED = [
  /^bot\/shared\/services\/tts\//,
  /^bot\/shared\/services\/elevenlabs\.service\.js$/,
  /^bot\/shared\/services\/audio\.service\.js$/,
  /^bot\/shared\/calls\//,
];

const BYPASS = [
  /\.generateSpeechForLanguage\s*\(/,
  /\.generateSpeechWithVoice\s*\(/,
  /\.generateSpeechOpenAI\s*\(/,
  /\bElevenLabsService\.generateSpeech\s*\(/,
  /api\.elevenlabs\.io\/v1\/text-to-speech/,
  /tts-rt\.soniox\.com/,
  /\.audio\.speech\.create\s*\(/,
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('no bot code outside the voice gateway calls a speech vendor or a pre-gateway speech function', () => {
  const offenders = [];
  for (const file of walk(BOT_SHARED).concat(walk(path.join(ROOT, 'bot', 'workers')))) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (ALLOWED.some((re) => re.test(rel))) continue;
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return; // comments may name the old functions
      if (BYPASS.some((re) => re.test(line))) offenders.push(`${rel}:${i + 1}`);
    });
  }
  expect(offenders).toEqual([]);
});

test('the gateway is what the voice features require', () => {
  const requiresGateway = (rel) => /require\(['"][./]+(services\/)?tts['"]\)/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  for (const rel of [
    'bot/shared/handlers/voice-message.handler.js',
    'bot/shared/services/coaching/reflective-conversation.service.js',
    'bot/shared/services/coaching/report-generator.service.js',
    'bot/shared/services/reading/voice-feedback.service.js',
    'bot/shared/services/feature-registration.service.js',
    'bot/shared/services/video/video-script.service.js',
  ]) {
    expect({ rel, requiresGateway: requiresGateway(rel) }).toEqual({ rel, requiresGateway: true });
  }
});
