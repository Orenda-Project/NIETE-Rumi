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
 * keys do not change; the router moves the base. --extra <file.json>: rows ({ key, lang, text, role }) the bank does
 * not carry yet (the engine's own lines, a content car not landed); a key already in the bank is voiced once.
 *
 *   node scripts/child-test/record-sa-voice.js --lang en|ur [--only item|instruction|…] [--set v1|v2] [--extra <file>]
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
const SETS = Object.freeze({ v1: Object.freeze({ en: VOICE, ur: VOICE }), v2: Object.freeze({ en: 'Priya', ur: 'Ishita' }) });
const LUFS = -21;
const KBPS = 32;

function parseArgs(argv) {
  const args = { lang: null, only: null, set: 'v1', extra: null, apply: false, maxUsd: 1, spendLog: null, spendExtra: {} };
  for (let i = 0; i < (argv || []).length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--lang') args.lang = String(next() || '').trim();
    else if (a === '--only') args.only = String(next() || '').trim();
    else if (a === '--set') args.set = String(next() || '').trim();
    else if (a === '--extra') args.extra = next();
    else if (a === '--apply') args.apply = true;
    else if (a === '--max-usd') args.maxUsd = Math.max(0, Number(next()) || 0);
    else if (a === '--spend-log') args.spendLog = next();
    else if (a === '--spend-extra') { try { args.spendExtra = JSON.parse(next()) || {}; } catch (_) { args.spendExtra = {}; } }
  }
  return args;
}

function loadBank(dataDir = DATA) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, 'item-bank.sa.v1.json'), 'utf8'));
}

async function run(argv, { tts = null, level = null, out = console.log, outDir = path.join(REPO, 'dashboard'), dataDir = DATA, env = process.env } = {}) {
  const args = parseArgs(argv);
  if (!['en', 'ur'].includes(args.lang)) throw new Error('--lang en|ur is required');
  if (!SETS[args.set]) throw new Error('--set v1|v2');
  const voice = SETS[args.set][args.lang];
  const { voiceManifest } = require('../../shared/services/child-test/sa/voice-manifest');
  const Voice = require('../../shared/services/quiz/web-quiz-voice');
  const rows = voiceManifest(loadBank(dataDir));
  if (args.extra) {
    const seen = new Set(rows.map((r) => r.key));
    for (const r of JSON.parse(fs.readFileSync(args.extra, 'utf8'))) if (r && r.key && r.text && !seen.has(r.key)) { seen.add(r.key); rows.push(r); }
  }
  const jobs = rows
    .filter((r) => r.lang === args.lang && (!args.only || r.role === args.only))
    .map((r) => ({ ...r, key: r.key.replace(/^sa\/v1\//, `sa/${args.set}/`), say: Voice.sayAs(r.text, args.lang, { voice }) }));
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

if (require.main === module) {
  run(process.argv.slice(2)).catch((e) => { console.error(String((e && e.message) || e)); process.exit(1); });
}

module.exports = { run, parseArgs, loadBank, SETS };
