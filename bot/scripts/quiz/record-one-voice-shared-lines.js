#!/usr/bin/env node
'use strict';
/**
 * Records Jugnu's shared lines (dashboard/public/wq/voice/manifest.json, one language) in ONE voice, as a plan of
 * app_settings `web_quiz_one_voice` renders it, into dashboard/public/wq/voice/one/<set>/ (<set> = web-quiz-voice.js
 * setIdOf: the voice's tag plus its rendering). The switch refuses a plan whose voice has no such set, so this runs
 * before the flip, for any ElevenLabs voice id, model and settings.
 *
 *   node scripts/quiz/record-one-voice-shared-lines.js --lang en|ur \
 *        --voice '{"provider":"elevenlabs","voice":"<id>","name":"<Name>","model":"<model>","settings":{...}}' \
 *        [--apply] [--max-usd 1] [--spend-log <file.jsonl> --spend-extra '<json merged into each line>']
 *
 * Without --apply: prints the set's name, the line count and the price, and calls nothing. With --apply: one call a
 * line (mp3 44.1 kHz 64 kb/s, as the other sets), a line already on disk is kept, stops before the next line once the
 * spend reaches --max-usd. Writes the set's manifest.json ({ lang, voice, lines }) and prints the hash to add to
 * web-quiz-voice.js SHARED_SETS (the portal's test holds it). The key is read from ELEVENLABS_API_KEY, never printed.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..', '..', '..');
const VOICE_DIR = path.join(REPO, 'dashboard', 'public', 'wq', 'voice');
const USD_PER_CHAR = 0.30 / 1000;

function parseArgs(argv) {
  const args = { lang: null, voice: null, apply: false, maxUsd: 1, spendLog: null, spendExtra: {} };
  for (let i = 0; i < (argv || []).length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--lang') args.lang = String(next() || '').trim();
    else if (a === '--voice') { try { args.voice = JSON.parse(next()); } catch (_) { args.voice = null; } }
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
  if (!v || v.provider !== 'elevenlabs' || !raw || v.voice !== String(raw.voice || '').trim()) return null;
  return v;
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

async function run(argv, { fetchImpl = globalThis.fetch, out = console.log, voiceDir = VOICE_DIR, env = process.env } = {}) {
  const args = parseArgs(argv);
  if (!['en', 'ur'].includes(args.lang)) throw new Error('--lang en|ur is required');
  const voice = planVoice(args.voice, args.lang);
  if (!voice) throw new Error('--voice must name an ElevenLabs voice: {"provider":"elevenlabs","voice":"<id>",...}');
  const Voice = require('../../shared/services/quiz/web-quiz-voice');
  const set = Voice.setIdOf(voice);
  const lines = JSON.parse(fs.readFileSync(path.join(voiceDir, 'manifest.json'), 'utf8'))[args.lang];
  const jobs = Object.entries(lines).flatMap(([name, arr]) => arr.map((text, i) => ({ file: `${name}-${i}.mp3`, text })));
  const chars = jobs.reduce((n, j) => n + j.text.length, 0);
  const dir = path.join(voiceDir, 'one', set);
  guardSetDir(dir, voice, args.lang);
  out(`set=${set} lang=${args.lang} lines=${jobs.length} chars=${chars} usd≈${(chars * USD_PER_CHAR).toFixed(3)}${args.apply ? '' : ' (dry run)'}`);
  if (!args.apply) return { set, lines: jobs.length, chars, recorded: 0 };
  const key = env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set');
  fs.mkdirSync(dir, { recursive: true });
  // The manifest first, so a run stopped part way leaves a folder that still names its voice and language.
  const writeManifest = () => fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify({ lang: args.lang, voice, lines }, null, 1)}\n`);
  writeManifest();
  let usd = 0; let recorded = 0;
  for (const { file, text } of jobs) {
    const target = path.join(dir, file);
    if (fs.existsSync(target) && fs.statSync(target).size > 1000) continue;
    if (usd >= args.maxUsd) { out(`stopped: max_usd ${args.maxUsd}`); return { set, recorded, usd, stopped: 'max_usd' }; }
    const body = JSON.stringify({ text, model_id: voice.model, ...(takesLanguageCode(voice.model) ? { language_code: args.lang } : {}),
      voice_settings: voice.settings });
    let audio = null;
    for (let a = 0; a < 3 && !audio; a += 1) {
      const r = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice.voice)}?output_format=mp3_44100_64`,
        { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, body });
      if (r.ok) audio = Buffer.from(await r.arrayBuffer());
      else if (a === 2) throw new Error(`${file}: HTTP ${r.status}`);
    }
    fs.writeFileSync(target, audio);
    const cost = text.length * USD_PER_CHAR;
    usd += cost; recorded += 1;
    if (args.spendLog) {
      fs.appendFileSync(args.spendLog, `${JSON.stringify({ at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), ...args.spendExtra,
        provider: 'elevenlabs', what: `shared line ${set} ${file}`, units: text.length, usd: Math.round(cost * 1e6) / 1e6 })}\n`);
    }
  }
  writeManifest();
  const hash = setHash(dir);
  out(`SPEND usd=${usd.toFixed(4)} recorded=${recorded}`);
  out(`add to web-quiz-voice.js SHARED_SETS: '${set}': '${hash}'`);
  return { set, recorded, usd, hash };
}

if (require.main === module) {
  run(process.argv.slice(2)).catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });
}

module.exports = { run, parseArgs, setHash, planVoice, guardSetDir, takesLanguageCode };
