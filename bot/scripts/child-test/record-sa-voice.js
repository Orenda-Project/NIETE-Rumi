#!/usr/bin/env node
'use strict';
/**
 * Records every line Jugnu speaks in the SA batteries (sa/voice-manifest.js) in the one voice, Soniox Reyna, levelled
 * as the one-voice sets are (-21 LUFS, 32 kb/s mp3), into dashboard/<key> (keys are sa/v1/<lang>/<hash>.mp3, served at
 * /sa/v1/… behind the SA engine's switch). An Urdu line goes to the voice through the shared Urdu spelling list
 * (web-quiz-voice.js sayAs); the battery keeps the text.
 *
 * --set v2: the second set (switch sa_voice_v2), one voice per language, both South Asian: English in Priya, Urdu in
 * Ishita (Reyna's accent is South-East Asian in Soniox's own catalogue). Same keys with sa/v2/ for sa/v1/, so the form's
 * keys do not change; the router moves the base. --set v3 (switch sa_voice_tashdeed, Urdu only): the v2 Urdu voice
 * given each narration with its tashdeed (sa/ur-tashdeed.js), only the lines it changes, into sa/v3/ur/ with the same
 * keys; the router serves those keys from v3. --extra <file.json>: rows ({ key, lang, text, role }) the bank does
 * not carry yet (the engine's own lines, a content car not landed); a key already in the bank is voiced once.
 *
 * --set v4 (switch sa_voice_v4): every line again, in the content reviewers' wording (the bank carries it), into
 * sa/v4/<lang>/ with the same keys. --provider soniox|elevenlabs|uplift --voice <id> --speed <x> pick the voice the way
 * the reviewers' samples were made (sa-voice-providers.js). The default is the reviewers' pick, ElevenLabs Chutki (kids
 * storyteller) for both languages at its own pace; --provider soniox defaults to Ishita (Urdu) / Priya (English) at 0.85. Urdu narration is given its tashdeed (sa/ur-tashdeed.js)
 * for every provider, and Soniox alone gets the Urdu respellings (sayAs), as in the samples. --concurrency <n> lines at
 * once (default 1). In v4 a bare sum ends on "equals" (Urdu: «ایکولز», its operation said in English too, «پلس», «مائنس», «ٹائمز»), so the child hears a blank to fill; --sums re-records
 * just the sums, over the clips already on disk. A letter sound is voiced as a sound (withSounds); --sounds re-records
 * just those lines. A praise line is said with [excited] (isPraise); --praise re-records just those. v4 is levelled to
 * -16 LUFS (round 9: quiet on some phones); --relevel re-levels the v4 clips already on disk to it, no voice call.
 *
 *   node scripts/child-test/record-sa-voice.js --lang en|ur [--only item|instruction|…] [--set v1|v2|v3|v4] [--extra <file>]
 *        [--provider soniox|elevenlabs|uplift --voice <id> --speed <x> --concurrency <n> --sums --sounds --praise]   (v4 only)
 *        [--apply] [--max-usd 1] [--spend-log <file.jsonl> --spend-extra '<json merged into each line>']
 *
 * Without --apply: prints the line count, the characters and the price, and calls nothing. With --apply: one call a
 * line, a clip already on disk is kept, stops before the next line once the spend reaches --max-usd, and appends one
 * line per call to --spend-log. The key is read from SONIOX_API_KEY, never printed.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..');
const DATA = path.join(REPO, 'bot', 'shared', 'data', 'child-test');
const SONIOX_USD_PER_SEC = 0.722 / 3600;
const SONIOX_CHARS_PER_SEC = 12;
const VOICE = 'Reyna';
const SETS = Object.freeze({ v1: Object.freeze({ en: VOICE, ur: VOICE }), v2: Object.freeze({ en: 'Priya', ur: 'Ishita' }),
  v3: Object.freeze({ ur: 'Ishita' }), v4: Object.freeze({ en: 'Priya', ur: 'Ishita' }) });
// The reviewers' pick (28 Oct): ElevenLabs "Chutki (kids storyteller)"; eleven_v3 speaks both languages.
const V4_DEFAULT = Object.freeze({ provider: 'elevenlabs', voice: 'CNKl99QEbWm8RQ4D8GfC' });
const V4_SPEED = 0.85;
const LUFS = -21;
const KBPS = 32;
// Round 9 item 2 (low volume on some phones): the v4 set is levelled louder, true peak still at most -1.5 dBTP.
const V4_LUFS = -16;
const V4_TP = -1.5;
const V4_CEIL = -3;

function parseArgs(argv) {
  const args = { lang: null, only: null, set: 'v1', extra: null, apply: false, maxUsd: 1, spendLog: null, spendExtra: {},
    provider: null, voice: null, speed: null, concurrency: 1, sums: false, sounds: false, praise: false, relevel: false };
  for (let i = 0; i < (argv || []).length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--lang') args.lang = String(next() || '').trim();
    else if (a === '--only') args.only = String(next() || '').trim();
    else if (a === '--set') args.set = String(next() || '').trim();
    else if (a === '--extra') args.extra = next();
    else if (a === '--apply') args.apply = true;
    else if (a === '--sums') args.sums = true;
    else if (a === '--sounds') args.sounds = true;
    else if (a === '--praise') args.praise = true;
    else if (a === '--relevel') args.relevel = true;
    else if (a === '--provider') args.provider = String(next() || '').trim();
    else if (a === '--voice') args.voice = String(next() || '').trim();
    else if (a === '--speed') args.speed = Number(next()) || null;
    else if (a === '--concurrency') args.concurrency = Math.max(1, Math.min(8, Number(next()) || 1));
    else if (a === '--max-usd') args.maxUsd = Math.max(0, Number(next()) || 0);
    else if (a === '--spend-log') args.spendLog = next();
    else if (a === '--spend-extra') { try { args.spendExtra = JSON.parse(next()) || {}; } catch (_) { args.spendExtra = {}; } }
  }
  return args;
}

function loadBank(dataDir = DATA) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, 'item-bank.sa.v1.json'), 'utf8'));
}

async function run(argv, { tts = null, synth = null, level = null, measure = null, out = console.log, outDir = path.join(REPO, 'dashboard'), dataDir = DATA, env = process.env } = {}) {
  const args = parseArgs(argv);
  if (!['en', 'ur'].includes(args.lang)) throw new Error('--lang en|ur is required');
  if (!SETS[args.set]) throw new Error('--set v1|v2|v3|v4');
  if (args.set === 'v4' && args.relevel) return relevelV4(args, { level, measure, out, outDir, dataDir });
  if (args.set === 'v4') return runV4(args, { synth, level, out, outDir, dataDir, env });
  const voice = SETS[args.set][args.lang];
  if (!voice) throw new Error(`--set ${args.set} has no ${args.lang} voice`);
  const { voiceManifest } = require('../../shared/services/child-test/sa/voice-manifest');
  const Voice = require('../../shared/services/quiz/web-quiz-voice');
  const rows = voiceManifest(loadBank(dataDir));
  if (args.extra) {
    const seen = new Set(rows.map((r) => r.key));
    for (const r of JSON.parse(fs.readFileSync(args.extra, 'utf8'))) if (r && r.key && r.text && !seen.has(r.key)) { seen.add(r.key); rows.push(r); }
  }
  const { voicedWithTashdeed } = require('../../shared/services/child-test/sa/ur-tashdeed');
  const lines = args.set === 'v3' ? voicedWithTashdeed(rows) : rows.map((r) => ({ ...r, say: r.text }));
  const jobs = lines
    .filter((r) => r.lang === args.lang && (!args.only || r.role === args.only))
    .map((r) => ({ ...r, key: r.key.replace(/^sa\/v1\//, `sa/${args.set}/`), say: Voice.sayAs(r.say, args.lang, { voice }) }));
  const chars = jobs.reduce((n, j) => n + j.say.length, 0);
  const estUsd = (chars / SONIOX_CHARS_PER_SEC) * SONIOX_USD_PER_SEC;
  out(`sa voice set=${args.set} voice=${voice} lang=${args.lang} lines=${jobs.length} chars=${chars} usd≈${estUsd.toFixed(3)}${args.apply ? '' : ' (dry run)'}`);
  if (!args.apply) return { lines: jobs.length, chars, recorded: 0, usd: 0 };
  if (!(env.SONIOX_TTS_API_KEY || env.SONIOX_API_KEY)) throw new Error('SONIOX_API_KEY is not set');
  const speaker = tts || require('../../shared/services/tts');
  const levelMp3 = level || require('../quiz/record-one-voice-shared-lines').levelMp3;
  let usd = 0; let recorded = 0;
  for (const job of jobs) {
    const target = path.join(outDir, job.key);
    if (fs.existsSync(target) && fs.statSync(target).size > 500) continue;
    if (usd >= args.maxUsd) { out(`stopped: max_usd ${args.maxUsd}`); return { lines: jobs.length, recorded, usd, stopped: 'max_usd' }; }
    const res = await speaker.synthesize({ text: job.say, language: args.lang, provider: 'soniox', voice, useCase: 'reading', site: 'child_test_sa_lines' });
    const cost = (res.durationSec || 0) * SONIOX_USD_PER_SEC;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, await levelMp3(res.audio, { lufs: LUFS, kbps: KBPS }));
    usd += cost; recorded += 1;
    if (args.spendLog) {
      fs.appendFileSync(args.spendLog, `${JSON.stringify({ at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), ...args.spendExtra,
        provider: 'soniox', what: `sa line ${job.key} (${job.role})`, units: Math.round((res.durationSec || 0) * 10) / 10, usd: Math.round(cost * 1e6) / 1e6 })}\n`);
    }
  }
  out(`SPEND usd=${usd.toFixed(4)} recorded=${recorded}`);
  return { lines: jobs.length, recorded, usd };
}

/** The whole bank again in one picked voice (sa/v4/<lang>/<key>), as the reviewers' samples were made. */
async function runV4(args, { synth, level, out, outDir, dataDir, env }) {
  const P = require('./sa-voice-providers');
  if (!args.provider) { args.provider = V4_DEFAULT.provider; args.voice = args.voice || V4_DEFAULT.voice; }
  if (!P.PROVIDERS.includes(args.provider)) throw new Error(`--provider ${P.PROVIDERS.join('|')}`);
  const voice = args.voice || (args.provider === 'soniox' ? SETS.v4[args.lang] : null);
  if (!voice) throw new Error(`--voice is required for ${args.provider}`);
  const speed = args.provider === 'uplift' ? null : (args.speed || (args.provider === 'soniox' ? V4_SPEED : null));
  const { voiceManifest } = require('../../shared/services/child-test/sa/voice-manifest');
  const { voicedWithTashdeed } = require('../../shared/services/child-test/sa/ur-tashdeed');
  const Voice = require('../../shared/services/quiz/web-quiz-voice');
  const rows = voiceManifest(loadBank(dataDir));
  if (args.extra) {
    const seen = new Set(rows.map((r) => r.key));
    for (const r of JSON.parse(fs.readFileSync(args.extra, 'utf8'))) if (r && r.key && r.text && !seen.has(r.key)) { seen.add(r.key); rows.push(r); }
  }
  const tashdeed = new Map(voicedWithTashdeed(rows).map((r) => [r.key, r.say]));
  const sum = (r) => r.role === 'item' && P.withEquals(r.text, r.lang) !== r.text;
  const ops = (r) => r.role === 'item' && !sum(r) && P.withEnglishOps(r.text, r.lang) !== r.text;
  // [slowly] is an eleven_v3 tag: the sound respelling goes to ElevenLabs only.
  const sound = (r) => args.provider === 'elevenlabs' && P.withSounds(r.text, r.lang) !== r.text;
  const praise = (r) => args.provider === 'elevenlabs' && P.isPraise(r.text);
  const jobs = rows
    .filter((r) => r.lang === args.lang && (!args.only || r.role === args.only) && (!args.sums || sum(r) || ops(r)) && (!args.sounds || sound(r))
      && (!args.praise || praise(r)))
    .map((r) => {
      const said = sum(r) ? P.withEquals(r.text, r.lang) : ops(r) ? P.withEnglishOps(r.text, r.lang) : sound(r) ? P.withSounds(r.text, r.lang) : (tashdeed.get(r.key) || r.text);
      const spoken = args.provider === 'soniox' ? Voice.sayAs(said, args.lang, { voice })
        : P.spellEnglishNumbers(P.withEnglishWords(args.provider === 'elevenlabs' ? P.withHeldWords(said, args.lang) : said, args.lang));
      const text = praise(r) ? `[excited] ${spoken}` : P.withTag(args.provider, r.role, spoken, voice);
      return { ...r, key: r.key.replace(/^sa\/v1\//, 'sa/v4/'), job: { provider: args.provider, voice, speed, lang: args.lang, text } };
    });
  const chars = jobs.reduce((n, j) => n + j.job.text.length, 0);
  const estUsd = args.provider === 'soniox' ? (chars / SONIOX_CHARS_PER_SEC / (speed || 1)) * P.USD.soniox_per_sec
    : chars * P.USD[`${args.provider}_per_char`];
  out(`sa voice set=v4 provider=${args.provider} voice=${voice} speed=${speed || 'native'} lang=${args.lang} lines=${jobs.length} chars=${chars} usd≈${estUsd.toFixed(3)}${args.apply ? '' : ' (dry run)'}`);
  if (!args.apply) return { lines: jobs.length, chars, recorded: 0, usd: 0 };
  const say = synth || ((job) => P.synthesize(job, { env }));
  const levelMp3 = level || levelV4;
  let usd = 0; let recorded = 0; let stopped = null; let next = 0;
  const failed = [];
  const worker = async () => {
    while (next < jobs.length && !stopped) {
      const j = jobs[next]; next += 1;
      const target = path.join(outDir, j.key);
      if (!args.sums && !args.sounds && !args.praise && fs.existsSync(target) && fs.statSync(target).size > 500) continue;
      if (usd >= args.maxUsd) { stopped = 'max_usd'; break; }
      try {
        const res = await say(j.job);
        const mp3 = await levelMp3(res.audio, { lufs: V4_LUFS, kbps: KBPS });
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, mp3);
        const sec = mp3.length / (KBPS * 125);
        const cost = args.provider === 'soniox' ? sec * P.USD.soniox_per_sec : j.job.text.length * P.USD[`${args.provider}_per_char`];
        usd += cost; recorded += 1;
        if (args.spendLog) {
          fs.appendFileSync(args.spendLog, `${JSON.stringify({ at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), ...args.spendExtra,
            provider: args.provider, what: `sa v4 line ${j.key} (${j.role}, ${voice})`, units: args.provider === 'soniox' ? Math.round(sec * 10) / 10 : j.job.text.length,
            usd: Math.round(cost * 1e6) / 1e6 })}\n`);
        }
      } catch (e) { failed.push({ key: j.key, error: String((e && e.message) || e).slice(0, 200) }); }
    }
  };
  await Promise.all(Array.from({ length: args.concurrency }, worker));
  if (stopped) out(`stopped: max_usd ${args.maxUsd}`);
  for (const f of failed) out(`FAILED ${f.key} ${f.error}`);
  out(`SPEND usd=${usd.toFixed(4)} recorded=${recorded} failed=${failed.length}`);
  return { lines: jobs.length, recorded, usd, failed, ...(stopped ? { stopped } : {}) };
}

const ffmpegBin = () => {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { return require('@ffmpeg-installer/ffmpeg').path; } catch (_) { return 'ffmpeg'; }
};

async function withTmp(fn) {
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-lv-'));
  try { return await fn(tmp); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

const ff = (args) => new Promise((resolve, reject) => require('child_process').execFile(ffmpegBin(), args,
  { timeout: 60000, maxBuffer: 4 * 1024 * 1024 }, (err, _o, stderr) => (err ? reject(err) : resolve(String(stderr || '')))));

/** A clip's integrated loudness and true peak (ffmpeg loudnorm, measure pass only). */
async function measureMp3(audio) {
  return withTmp(async (tmp) => {
    const src = path.join(tmp, 'in');
    fs.writeFileSync(src, audio);
    const said = await ff(['-hide_banner', '-nostats', '-i', src, '-af', `loudnorm=I=${V4_LUFS}:TP=${V4_TP}:LRA=11:print_format=json`, '-f', 'null', '-']);
    const m = JSON.parse((said.match(/\{[^{}]*\}/g) || []).pop());
    return { i: Number(m.input_i), tp: Number(m.input_tp) };
  });
}

/**
 * The v4 clip as the set keeps it: mp3 44.1 kHz mono at `kbps`, at `lufs` integrated with the true peak at most V4_TP.
 * One gain to the target, then a limiter (sample ceiling V4_CEIL dBFS) so the low-bitrate encode's overshoot stays under
 * the peak limit; the written clip is measured and, if it misses, made again from the same source with the gain and
 * the ceiling corrected (at most 5 tries).
 */
async function levelV4(audio, { lufs = V4_LUFS, kbps = KBPS } = {}) {
  const first = await measureMp3(audio);
  let gain = Number.isFinite(first.i) ? lufs - first.i : 0;
  let ceil = V4_CEIL;
  let best = null;
  for (let n = 0; n < 5; n += 1) {
    const mp3 = await withTmp(async (tmp) => {
      const src = path.join(tmp, 'in');
      const out = path.join(tmp, 'out.mp3');
      fs.writeFileSync(src, audio);
      await ff(['-y', '-loglevel', 'error', '-i', src, '-af',
        `volume=${gain.toFixed(2)}dB,alimiter=limit=${(10 ** (ceil / 20)).toFixed(4)}:attack=1:release=50:level=disabled`,
        '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', `${kbps}k`, '-map_metadata', '-1', '-id3v2_version', '0', out]);
      return fs.readFileSync(out);
    });
    const m = await measureMp3(mp3);
    const miss = Math.max(0, m.tp - V4_TP) + Math.max(0, Math.abs(m.i - lufs) - 0.5);
    if (!best || miss < best.miss) best = { mp3, miss };
    if (miss === 0) break;
    if (m.tp > V4_TP) ceil -= m.tp - V4_TP + 0.3;
    if (Math.abs(m.i - lufs) > 0.5) gain += lufs - m.i;
  }
  return best.mp3;
}

/**
 * --relevel (v4): every v4 clip on disk for the language, levelled again to V4_LUFS in place (gain only; same key, same
 * format; no voice call, no spend). A clip already within 0.5 LU of the target, true peak at most -1.5 dBTP, is left as it is.
 */
async function relevelV4(args, { level, measure, out, outDir, dataDir }) {
  const { voiceManifest } = require('../../shared/services/child-test/sa/voice-manifest');
  const rows = voiceManifest(loadBank(dataDir));
  if (args.extra) {
    const seen = new Set(rows.map((r) => r.key));
    for (const r of JSON.parse(fs.readFileSync(args.extra, 'utf8'))) if (r && r.key && r.text && !seen.has(r.key)) { seen.add(r.key); rows.push(r); }
  }
  const keys = [...new Set(rows.filter((r) => r.lang === args.lang).map((r) => r.key.replace(/^sa\/v1\//, 'sa/v4/')))]
    .filter((k) => fs.existsSync(path.join(outDir, k)));
  const levelMp3 = level || levelV4;
  const loud = measure || measureMp3;
  out(`sa voice set=v4 relevel lang=${args.lang} clips=${keys.length} target=${V4_LUFS} LUFS${args.apply ? '' : ' (dry run)'}`);
  if (!args.apply) return { clips: keys.length, relevelled: 0, skipped: 0, usd: 0 };
  let relevelled = 0; let skipped = 0; let next = 0;
  const failed = [];
  const worker = async () => {
    while (next < keys.length) {
      const k = keys[next]; next += 1;
      const f = path.join(outDir, k);
      try {
        const buf = fs.readFileSync(f);
        const m = await loud(buf, k);
        if (Math.abs(m.i - V4_LUFS) <= 0.5 && m.tp <= V4_TP) { skipped += 1; continue; }
        fs.writeFileSync(f, await levelMp3(buf, { lufs: V4_LUFS, kbps: KBPS }));
        relevelled += 1;
      } catch (e) { failed.push({ key: k, error: String((e && e.message) || e).slice(0, 200) }); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, args.concurrency) }, worker));
  for (const x of failed) out(`FAILED ${x.key} ${x.error}`);
  out(`RELEVEL relevelled=${relevelled} skipped=${skipped} failed=${failed.length}`);
  return { clips: keys.length, relevelled, skipped, failed, usd: 0 };
}

if (require.main === module) {
  run(process.argv.slice(2)).catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });
}

module.exports = { V4_DEFAULT, V4_LUFS, run, parseArgs, loadBank, SETS, levelV4, measureMp3, ffmpegBin };
