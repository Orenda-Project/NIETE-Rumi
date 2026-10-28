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
 * once (default 1).
 *
 *   node scripts/child-test/record-sa-voice.js --lang en|ur [--only item|instruction|…] [--set v1|v2|v3|v4] [--extra <file>]
 *        [--provider soniox|elevenlabs|uplift --voice <id> --speed <x> --concurrency <n>]   (v4 only)
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

function parseArgs(argv) {
  const args = { lang: null, only: null, set: 'v1', extra: null, apply: false, maxUsd: 1, spendLog: null, spendExtra: {},
    provider: null, voice: null, speed: null, concurrency: 1 };
  for (let i = 0; i < (argv || []).length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--lang') args.lang = String(next() || '').trim();
    else if (a === '--only') args.only = String(next() || '').trim();
    else if (a === '--set') args.set = String(next() || '').trim();
    else if (a === '--extra') args.extra = next();
    else if (a === '--apply') args.apply = true;
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

async function run(argv, { tts = null, synth = null, level = null, out = console.log, outDir = path.join(REPO, 'dashboard'), dataDir = DATA, env = process.env } = {}) {
  const args = parseArgs(argv);
  if (!['en', 'ur'].includes(args.lang)) throw new Error('--lang en|ur is required');
  if (!SETS[args.set]) throw new Error('--set v1|v2|v3|v4');
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
  const jobs = rows
    .filter((r) => r.lang === args.lang && (!args.only || r.role === args.only))
    .map((r) => {
      const said = tashdeed.get(r.key) || r.text;
      const spoken = args.provider === 'soniox' ? Voice.sayAs(said, args.lang, { voice })
        : P.spellEnglishNumbers(said);
      const text = P.withTag(args.provider, r.role, spoken, voice);
      return { ...r, key: r.key.replace(/^sa\/v1\//, 'sa/v4/'), job: { provider: args.provider, voice, speed, lang: args.lang, text } };
    });
  const chars = jobs.reduce((n, j) => n + j.job.text.length, 0);
  const estUsd = args.provider === 'soniox' ? (chars / SONIOX_CHARS_PER_SEC / (speed || 1)) * P.USD.soniox_per_sec
    : chars * P.USD[`${args.provider}_per_char`];
  out(`sa voice set=v4 provider=${args.provider} voice=${voice} speed=${speed || 'native'} lang=${args.lang} lines=${jobs.length} chars=${chars} usd≈${estUsd.toFixed(3)}${args.apply ? '' : ' (dry run)'}`);
  if (!args.apply) return { lines: jobs.length, chars, recorded: 0, usd: 0 };
  const say = synth || ((job) => P.synthesize(job, { env }));
  const levelMp3 = level || require('../quiz/record-one-voice-shared-lines').levelMp3;
  let usd = 0; let recorded = 0; let stopped = null; let next = 0;
  const failed = [];
  const worker = async () => {
    while (next < jobs.length && !stopped) {
      const j = jobs[next]; next += 1;
      const target = path.join(outDir, j.key);
      if (fs.existsSync(target) && fs.statSync(target).size > 500) continue;
      if (usd >= args.maxUsd) { stopped = 'max_usd'; break; }
      try {
        const res = await say(j.job);
        const mp3 = await levelMp3(res.audio, { lufs: LUFS, kbps: KBPS });
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

if (require.main === module) {
  run(process.argv.slice(2)).catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });
}

module.exports = { V4_DEFAULT, run, parseArgs, loadBank, SETS };
