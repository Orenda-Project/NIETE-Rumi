'use strict';
/**
 * The three voices a reviewed set (record-sa-voice.js --set v4) can be recorded in, called exactly as the voice samples
 * the reviewers chose from were made, so the battery sounds like the sample that was picked:
 *
 *   soniox      tts-rt-v2, mp3 44.1 kHz 128 kb/s, `speed` (0.7–1.3)
 *   elevenlabs  eleven_v3, stability 0.5, similarity 0.85, style 0, speaker boost; `speed` only when it is not 1
 *   uplift      MP3_22050_128; the API has no speed or emotion field, so the voice keeps its own pace
 *
 * A Soniox or ElevenLabs line that is an instruction (battery and task lines, not items, answers or passages) starts
 * with the samples' mood tag ([warm] / [warmly]); a single word or item never carries a tag. Keys come from the
 * environment and are never printed. synthesize() → { audio: Buffer, chars }.
 */

const PROVIDERS = Object.freeze(['soniox', 'elevenlabs', 'uplift']);
const SETTINGS = Object.freeze({
  soniox: Object.freeze({ model: 'tts-rt-v2' }),
  elevenlabs: Object.freeze({ model: 'eleven_v3', stability: 0.5, similarity_boost: 0.85 }),
  uplift: Object.freeze({ outputFormat: 'MP3_22050_128' }),
});
const TAG = Object.freeze({ soniox: '[warm]', elevenlabs: '[warmly]' });
const TAGGED_ROLES = new Set(['battery', 'instruction']);
// Price per unit, for the spend log: Soniox bills audio seconds; ElevenLabs and Uplift bill characters (list prices,
// rounded up so the cap stops early rather than late).
const USD = Object.freeze({ soniox_per_sec: 0.722 / 3600, elevenlabs_per_char: 0.30 / 1000, uplift_per_char: 0.10 / 1000 });

// Numbers are always SPOKEN in English, in the Urdu battery too (the content owner, 28 Oct, round 8 item 29): every digit
// in a voiced line goes to the voice as English words. (Left as digits, ElevenLabs reads Urdu's «۶», «۳» as Persian
// "shash", "se", and a bare «4» can come out in any language.) Number WORDS a reviewer wrote stay as written.
const urduDigitsToAscii = (t) => String(t).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06F0));

const EN_1_19 = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function englishNumber(n) {
  if (n < 20) return EN_1_19[n];
  if (n < 100) return EN_TENS[Math.floor(n / 10)] + (n % 10 ? `-${EN_1_19[n % 10]}` : '');
  if (n < 1000) return `${EN_1_19[Math.floor(n / 100)]} hundred${n % 100 ? ` ${englishNumber(n % 100)}` : ''}`;
  return `${englishNumber(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${englishNumber(n % 1000)}` : ''}`;
}

/**
 * A line's numbers (Urdu or ASCII digits) as English words. A bare «4» from a voice that speaks several languages can come out in any
 * of them, and «4 010» (a space between thousands) as nonsense; «four» and «four thousand ten» cannot. Up to 999 999.
 */
function spellEnglishNumbers(text) {
  return urduDigitsToAscii(text).replace(/\b\d+\.\d+\b|\b\d{1,3}(?:[ ,]\d{3})+\b|\b\d+\b/g, (m) => {
    if (m.includes('.')) {
      const [i, f] = m.split('.');
      return `${englishNumber(Number(i))} point ${f.split('').map((c) => EN_1_19[Number(c)]).join(' ')}`;
    }
    const n = Number(m.replace(/[ ,]/g, ''));
    return n < 1000000 ? englishNumber(n) : m;
  });
}

// A bare sum ("18 plus 7", «۱۵ منفی ۷») is read as a sentence to finish, so the child answers it rather than repeating it.
const SUM = /^\s*[\d۰-۹][\d۰-۹,]*\s+(?:plus|minus|times|جمع|منفی|ضرب|تقسیم)\s+[\d۰-۹][\d۰-۹,]*\s*$/;
const EQUALS = Object.freeze({ en: 'equals', ur: 'برابر' });

function withEquals(text, lang) {
  return EQUALS[lang] && SUM.test(text) ? `${text.trim()} ${EQUALS[lang]}` : text;
}

// A letter SOUND is voiced as a sound, never a letter name (the content owner, round 8 items 8, 10, 22; the voicenote
// phonics grammar): a held sound is stretched (Urdu «لَ» "lllll", «نَ» "nnnnn"), a stop stays short ("tuh"), and each
// sound gets its own [slowly]. The screen keeps its text; only what the voice is given changes.
const EN_SOUND = Object.freeze({ mmm: 'mmmmm', sss: 'sssss', ss: 'sssss', fff: 'fffff', nnn: 'nnnnn', puh: 'puh', tuh: 'tuh', duh: 'duh' });
const UR_SOUND = Object.freeze({ 'لَ': 'lllll', 'نَ': 'nnnnn', 'ل': 'lllll', 'ن': 'nnnnn', 'م': 'mmmmm', 'ج': 'جَ', 'ا': 'اَ' });
const SND = Object.keys(EN_SOUND).join('|');
const EN_SOUNDS = new RegExp(`\\b(?:(${SND}), (ih|ah|aw), (${SND})|(${SND}))\\b`, 'g');
const slow = (t) => `[slowly] ${t}`;
function withSounds(text, lang) {
  if (lang === 'en') {
    return String(text).replace(EN_SOUNDS, (m, a, v, b, one) => (one ? slow(EN_SOUND[one])
      : `${slow(EN_SOUND[a])}, ${slow(v)}, ${slow(EN_SOUND[b])}`));
  }
  if (lang === 'ur') {
    const t = String(text).trim();
    if (UR_SOUND[t]) return slow(UR_SOUND[t]);
    return String(text).replace(/آواز (\S) ہے/g, (m, x) => (UR_SOUND[x] ? `آواز ${slow(UR_SOUND[x])} ہے` : m));
  }
  return text;
}
// The samples' "cartoon" voices carried a livelier instruction tag than the adult ones.
const CARTOON_TAG = Object.freeze({ CNKl99QEbWm8RQ4D8GfC: '[cheerfully]' });

/** What the voice is given for a line: the instruction mood tag in front, for the providers whose samples had one. */
function withTag(provider, role, text, voice) {
  const tag = (provider === 'elevenlabs' && CARTOON_TAG[voice]) || TAG[provider];
  return tag && TAGGED_ROLES.has(role) ? `${tag} ${text}` : text;
}

function keyOf(provider, env) {
  const k = provider === 'soniox' ? (env.SONIOX_TTS_API_KEY || env.SONIOX_API_KEY)
    : provider === 'elevenlabs' ? env.ELEVENLABS_API_KEY : env.UPLIFT_API_KEY;
  if (!k) throw new Error(`no API key for ${provider} in the environment`);
  return k;
}

/** The request for one line: { url, headers, body }. Pure, so a test can read what each provider is sent. */
function requestFor({ provider, voice, speed, lang, text }, key) {
  if (provider === 'soniox') {
    return { url: 'https://tts-rt.soniox.com/tts', headers: { Authorization: `Bearer ${key}`, 'User-Agent': 'voice-gateway/1.0' },
      body: { model: SETTINGS.soniox.model, text, language: lang, voice, audio_format: 'mp3', sample_rate: 44100, bitrate: 128000,
        ...(speed ? { speed } : {}) } };
  }
  if (provider === 'elevenlabs') {
    const s = SETTINGS.elevenlabs;
    return { url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,
      headers: { 'xi-api-key': key },
      body: { text, model_id: s.model, voice_settings: { stability: s.stability, similarity_boost: s.similarity_boost, style: 0,
        use_speaker_boost: true, ...(speed && speed !== 1 ? { speed } : {}) } } };
  }
  if (provider === 'uplift') {
    return { url: 'https://api.upliftai.org/v1/synthesis/text-to-speech', headers: { Authorization: `Bearer ${key}` },
      body: { voiceId: voice, text, outputFormat: SETTINGS.uplift.outputFormat } };
  }
  throw new Error(`--provider ${PROVIDERS.join('|')}`);
}

/** One line as mp3 bytes. Retries a dropped connection, 429 and 5xx; a 4xx fails at once. */
async function synthesize(job, { env = process.env, fetchImpl = fetch, attempts = 4, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const req = requestFor(job, keyOf(job.provider, env));
  let err = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetchImpl(req.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...req.headers }, body: JSON.stringify(req.body) });
      const type = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
      const buf = Buffer.from(await res.arrayBuffer());
      if (res.status === 200 && buf.length > 800 && !type.startsWith('application/json')) return { audio: buf, chars: job.text.length };
      err = new Error(`${job.provider} ${res.status} ${buf.toString('utf8', 0, 200)}`);
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) throw err;
    } catch (e) {
      err = e;
      if (/ (400|401|402|403|404|422) /.test(String(e.message))) throw e;
    }
    await sleep(1500 * (i + 1));
  }
  throw err;
}

module.exports = { PROVIDERS, SETTINGS, TAG, CARTOON_TAG, USD, englishNumber, spellEnglishNumbers, withEquals, withSounds, withTag, requestFor, synthesize };
