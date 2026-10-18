#!/usr/bin/env node
'use strict';
/**
 * Records Jugnu's shared lines (dashboard/public/wq/voice/manifest.json, one language) in ONE voice, as a plan of
 * app_settings `web_quiz_one_voice` renders it, into dashboard/public/wq/voice/one/<set>-<lang>/ (<set> =
 * web-quiz-voice.js setIdOf: the voice's tag plus its rendering; one folder per language, so one voice can speak
 * both). The switch refuses a plan whose voice has no such set, so this runs before the flip, for any ElevenLabs
 * voice id, model and settings, or a Soniox voice.
 *
 *   node scripts/quiz/record-one-voice-shared-lines.js --lang en|ur \
 *        ( --voice '{"provider":"elevenlabs","voice":"<id>","name":"<Name>","model":"<model>","settings":{...}}'
 *        | --plan <plan.json> )
 *        [--apply] [--max-usd 1] [--spend-log <file.jsonl> --spend-extra '<json merged into each line>']
 *
 * --plan: a plan as the switch takes it; the voice is its voice for --lang, and its loudness_lufs / kbps level every
 * line (ffmpeg loudnorm, one gain; a line under 3 s one plain gain) into mp3 44.1 kHz mono at kbps.
 * An Urdu line goes to the voice through the shared Urdu spelling list (web-quiz-ur-say.js, for the voice's id); the
 * manifest keeps the line as the page shows it.
 *
 * Without --apply: prints the set's name, the line count and the price, and calls nothing. With --apply: one call a
 * line (ElevenLabs: mp3 44.1 kHz 64 kb/s, as the other sets; Soniox: its Ogg Opus as mp3), a line already on disk is
 * kept, stops before the next line once the spend reaches --max-usd. Writes the set's manifest.json
 * ({ lang, voice, lines }) and prints the hash to add to web-quiz-voice.js SHARED_SETS (the portal's test holds it).
 * The key is read from ELEVENLABS_API_KEY / SONIOX_API_KEY, never printed.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..', '..', '..');
const VOICE_DIR = path.join(REPO, 'dashboard', 'public', 'wq', 'voice');
const USD_PER_CHAR = 0.30 / 1000;
const SONIOX_USD_PER_SEC = 0.722 / 3600;
const SONIOX_CHARS_PER_SEC = 12;   // the dry run's estimate of a line's length, on the slow side
const SHORT_CLIP_S = 3;
const TRUE_PEAK_DB = -1.5;

function parseArgs(argv) {
  const args = { lang: null, voice: null, plan: null, apply: false, maxUsd: 1, spendLog: null, spendExtra: {} };
  for (let i = 0; i < (argv || []).length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--lang') args.lang = String(next() || '').trim();
    else if (a === '--voice') { try { args.voice = JSON.parse(next()); } catch (_) { args.voice = null; } }
    else if (a === '--plan') { try { args.plan = JSON.parse(fs.readFileSync(next(), 'utf8')); } catch (_) { args.plan = null; } }
    else if (a === '--apply') args.apply = true;
    else if (a === '--max-usd') args.maxUsd = Math.max(0, Number(next()) || 0);
    else if (a === '--spend-log') args.spendLog = next();
    else if (a === '--spend-extra') { try { args.spendExtra = JSON.parse(next()) || {}; } catch (_) { args.spendExtra = {}; } }
  }
  return args;
}

// The voice as the switch's plan reads it (web-quiz-one-voice-flag.js normalize), so the set's name is the plan's.
function planVoice(raw, lang) {
  const OneVoice = require('../../shared/services/quiz/web-quiz-one-voice-flag');
  const p = OneVoice.normalize({ voices: { [lang]: raw } });
  const v = p && p.voices[lang];
  if (!v || !['elevenlabs', 'soniox'].includes(v.provider) || !raw || v.voice !== String(raw.voice || '').trim()) return null;
  return v;
}

function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { return require('@ffmpeg-installer/ffmpeg').path; } catch (_) { return 'ffmpeg'; }
}

/**
 * The voice's clip as the set keeps it: mp3 44.1 kHz mono at `kbps`, levelled to `lufs` when given (ffmpeg loudnorm,
 * two passes, one gain, true peak at most -1.5 dB; a clip under 3 s one plain gain, as the quiz clips are levelled).
 */
async function levelMp3(audio, { lufs, kbps = 64 } = {}) {
  const { execFile } = require('child_process');
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wq-set-'));
  const src = path.join(tmp, 'in');
  const out = path.join(tmp, 'out.mp3');
  const ff = (args) => new Promise((resolve, reject) => {
    execFile(ffmpegPath(), args, { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (err, _o, stderr) => (err ? reject(err) : resolve(String(stderr || ''))));
  });
  try {
    fs.writeFileSync(src, audio);
    let af = null;
    if (lufs !== undefined && lufs !== null) {
      const target = `I=${lufs}:TP=${TRUE_PEAK_DB}:LRA=11`;
      const said = await ff(['-hide_banner', '-nostats', '-i', src, '-af', `loudnorm=${target}:print_format=json`, '-f', 'null', '-']);
      const m = JSON.parse((said.match(/\{[^{}]*\}/g) || []).pop());
      const d = said.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
      const sec = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null;
      const inI = Number(m.input_i);
      const inTp = Number(m.input_tp);
      const gain = !Number.isFinite(inI) ? 0 : Math.min(lufs - inI, Number.isFinite(inTp) ? TRUE_PEAK_DB - inTp : Infinity);
      af = sec !== null && sec < SHORT_CLIP_S ? `volume=${gain.toFixed(2)}dB`
        : `loudnorm=${target}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:`
          + `measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
    }
    await ff(['-y', '-loglevel', 'error', '-i', src, ...(af ? ['-af', af] : []), '-ac', '1', '-ar', '44100',
      '-c:a', 'libmp3lame', '-b:a', `${kbps}k`, '-map_metadata', '-1', '-id3v2_version', '0', out]);
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// The models that take a language code (ElevenLabs refuses one on eleven_multilingual_v2 and older models).
const LANGUAGE_CODE_MODELS = /^eleven_(turbo_v2_5|flash_v2_5|v3|v4)/;
const takesLanguageCode = (model) => LANGUAGE_CODE_MODELS.test(String(model || ''));

/**
 * A set's folder is keyed by the voice id, its rendering (model, settings) and the language. A folder already there
 * must name exactly these in its manifest, or the run is refused before any call: one voice recorded for Urdu after
 * English never reuses the English lines. A folder with lines and no manifest is refused too (its origin is unknown).
 */
function guardSetDir(dir, voice, lang) {
  if (!fs.existsSync(dir)) return;
  const mp3s = fs.readdirSync(dir).filter((f) => f.endsWith('.mp3'));
  const file = path.join(dir, 'manifest.json');
  if (!fs.existsSync(file)) {
    if (mp3s.length) throw new Error(`set folder ${path.basename(dir)} has lines and no manifest: refused`);
    return;
  }
  let m = null;
  try { m = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { m = null; }
  const Voice = require('../../shared/services/quiz/web-quiz-voice');
  const mv = (m && m.voice) || {};
  const same = m && m.lang === lang && mv.voice === voice.voice && Voice.renderOf(mv) === Voice.renderOf(voice);
  if (!same) throw new Error(`set folder ${path.basename(dir)} names another voice id, rendering or language: refused`);
}

/** The hash a set is known by (web-quiz-voice.js SHARED_SETS): its mp3 files, by name, in order. */
function setHash(dir) {
  const h = crypto.createHash('sha1');
  fs.readdirSync(dir).filter((f) => f.endsWith('.mp3')).sort()
    .forEach((f) => { h.update(`${f}\n`); h.update(fs.readFileSync(path.join(dir, f))); });
  return h.digest('hex').slice(0, 8);
}

async function run(argv, { fetchImpl = globalThis.fetch, tts = null, level = levelMp3, out = console.log, voiceDir = VOICE_DIR, env = process.env } = {}) {
  const args = parseArgs(argv);
  if (!['en', 'ur'].includes(args.lang)) throw new Error('--lang en|ur is required');
  const raw = args.plan ? ((args.plan.voices || {})[args.lang] || null) : args.voice;
  const voice = planVoice(raw, args.lang);
  if (!voice) throw new Error('--voice (or --plan) must name an ElevenLabs or Soniox voice: {"provider":"elevenlabs","voice":"<id>",...}');
  const sonix = voice.provider === 'soniox';
  const lufs = args.plan && typeof args.plan.loudness_lufs === 'number' ? args.plan.loudness_lufs : null;
  const kbps = (args.plan && Number(args.plan.kbps)) || 64;
  const Voice = require('../../shared/services/quiz/web-quiz-voice');
  const set = Voice.setIdOf(voice);
  const setPath = `${set}-${args.lang}`;
  const lines = JSON.parse(fs.readFileSync(path.join(voiceDir, 'manifest.json'), 'utf8'))[args.lang];
  // The words the voice is given (an Urdu line through the shared spelling list); the manifest keeps `text`.
  const jobs = Object.entries(lines).flatMap(([name, arr]) => arr.map((text, i) => ({
    file: `${name}-${i}.mp3`, text, say: Voice.sayAs(text, args.lang, { voice: voice.voice }) })));
  const chars = jobs.reduce((n, j) => n + j.say.length, 0);
  const estUsd = sonix ? (chars / SONIOX_CHARS_PER_SEC) * SONIOX_USD_PER_SEC : chars * USD_PER_CHAR;
  const dir = path.join(voiceDir, 'one', setPath);
  guardSetDir(dir, voice, args.lang);
  out(`set=${setPath} lang=${args.lang} lines=${jobs.length} chars=${chars} usd≈${estUsd.toFixed(3)}`
    + `${lufs !== null ? ` level=${lufs}LUFS/${kbps}k` : ''}${args.apply ? '' : ' (dry run)'}`);
  if (!args.apply) return { set, path: setPath, lines: jobs.length, chars, recorded: 0 };
  const key = sonix ? (env.SONIOX_TTS_API_KEY || env.SONIOX_API_KEY) : env.ELEVENLABS_API_KEY;
  if (!key) throw new Error(`${sonix ? 'SONIOX_API_KEY' : 'ELEVENLABS_API_KEY'} is not set`);
  const speaker = sonix ? (tts || require('../../shared/services/tts')) : null;
  fs.mkdirSync(dir, { recursive: true });
  // The manifest first, so a run stopped part way leaves a folder that still names its voice and language.
  const writeManifest = () => fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify({ lang: args.lang, voice, lines }, null, 1)}\n`);
  writeManifest();
  let usd = 0; let recorded = 0;
  for (const { file, say } of jobs) {
    const target = path.join(dir, file);
    if (fs.existsSync(target) && fs.statSync(target).size > 1000) continue;
    if (usd >= args.maxUsd) { out(`stopped: max_usd ${args.maxUsd}`); return { set, path: setPath, recorded, usd, stopped: 'max_usd' }; }
    let audio = null;
    let cost = 0;
    let units = say.length;
    if (sonix) {
      const res = await speaker.synthesize({ text: say, language: args.lang, provider: 'soniox', voice: voice.voice,
        useCase: 'reading', site: 'web_quiz_shared_lines' });
      units = Math.round((res.durationSec || 0) * 10) / 10;
      cost = (res.durationSec || 0) * SONIOX_USD_PER_SEC;
      audio = await level(res.audio, { lufs: lufs === null ? undefined : lufs, kbps });
    } else {
      const body = JSON.stringify({ text: say, model_id: voice.model, ...(takesLanguageCode(voice.model) ? { language_code: args.lang } : {}),
        voice_settings: voice.settings });
      for (let a = 0; a < 3 && !audio; a += 1) {
        const r = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.voice)}?output_format=mp3_44100_64`,
          { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body });
        if (r.ok) audio = Buffer.from(await r.arrayBuffer());
        else if (a === 2) throw new Error(`${file}: HTTP ${r.status}`);
      }
      cost = say.length * USD_PER_CHAR;
      if (lufs !== null) audio = await level(audio, { lufs, kbps });
    }
    fs.writeFileSync(target, audio);
    usd += cost; recorded += 1;
    if (args.spendLog) {
      fs.appendFileSync(args.spendLog, `${JSON.stringify({ at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), ...args.spendExtra,
        provider: voice.provider, what: `shared line ${setPath} ${file}`, units, usd: Math.round(cost * 1e6) / 1e6 })}\n`);
    }
  }
  writeManifest();
  const hash = setHash(dir);
  out(`SPEND usd=${usd.toFixed(4)} recorded=${recorded}`);
  out(`add to web-quiz-voice.js SHARED_SETS: '${setPath}': '${hash}'`);
  return { set, path: setPath, recorded, usd, hash };
}

if (require.main === module) {
  run(process.argv.slice(2)).catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });
}

module.exports = { run, parseArgs, setHash, planVoice, guardSetDir, takesLanguageCode, levelMp3 };
