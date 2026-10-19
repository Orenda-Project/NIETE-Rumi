#!/usr/bin/env node
'use strict';
/**
 * Records Jugnu's welcome lines (dashboard/public/wq/voice/welcome/lines.json, one language: the child's first open of
 * the home) in the one-voice plan's voice, into dashboard/public/wq/voice/welcome/<set>-<lang>/welcome-<key>.mp3
 * (<set> = web-quiz-voice.js setIdOf, as the shared lines name it). Their own folder, so the shared-line sets and their
 * hashes do not change. A line's `say` (a respelling) is what the voice is given; the manifest keeps `text`, the words
 * the page shows.
 *
 *   node scripts/quiz/record-welcome-lines.js --lang en|ur (--plan <plan.json> | --plan-json '<plan>')
 *        [--apply] [--max-usd 0.2] [--spend-log <file.jsonl> --spend-extra '<json merged into each line>']
 *
 * Soniox voices only (the plan's). Levelled as the shared lines are (record-one-voice-shared-lines.js levelMp3, the
 * plan's loudness_lufs / kbps). Without --apply: prints the folder, the line count and the price, and calls nothing.
 * With --apply: one call a line, a line already on disk is kept. The key is read from SONIOX_API_KEY, never printed.
 */
const fs = require('fs');
const path = require('path');
const Shared = require('./record-one-voice-shared-lines');

const WELCOME_DIR = path.join(__dirname, '..', '..', '..', 'dashboard', 'public', 'wq', 'voice', 'welcome');
const SONIOX_USD_PER_SEC = 0.722 / 3600;
const SONIOX_CHARS_PER_SEC = 12;

function parseArgs(argv) {
  const args = { lang: null, plan: null, apply: false, maxUsd: 0.2, spendLog: null, spendExtra: {} };
  for (let i = 0; i < (argv || []).length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    const json = (s) => { try { return JSON.parse(s); } catch (_) { return null; } };
    if (a === '--lang') args.lang = String(next() || '').trim();
    else if (a === '--plan') args.plan = json(fs.readFileSync(next(), 'utf8'));
    else if (a === '--plan-json') args.plan = json(next());
    else if (a === '--apply') args.apply = true;
    else if (a === '--max-usd') args.maxUsd = Math.max(0, Number(next()) || 0);
    else if (a === '--spend-log') args.spendLog = next();
    else if (a === '--spend-extra') args.spendExtra = json(next()) || {};
  }
  return args;
}

async function run(argv, { tts = null, level = Shared.levelMp3, out = console.log, welcomeDir = WELCOME_DIR, env = process.env } = {}) {
  const args = parseArgs(argv);
  if (!['en', 'ur'].includes(args.lang)) throw new Error('--lang en|ur is required');
  const voice = Shared.planVoice(((args.plan || {}).voices || {})[args.lang] || null, args.lang);
  if (!voice || voice.provider !== 'soniox') throw new Error('--plan must name a Soniox voice for --lang');
  const lufs = typeof args.plan.loudness_lufs === 'number' ? args.plan.loudness_lufs : undefined;
  const kbps = Number(args.plan.kbps) || 64;
  const setPath = `${require('../../shared/services/quiz/web-quiz-voice').setIdOf(voice)}-${args.lang}`;
  const lines = JSON.parse(fs.readFileSync(path.join(welcomeDir, 'lines.json'), 'utf8'))[args.lang] || {};
  const jobs = Object.entries(lines).map(([key, l]) => ({ key, file: `welcome-${key}.mp3`, text: l.text, say: l.say || l.text }));
  const chars = jobs.reduce((n, j) => n + j.say.length, 0);
  const dir = path.join(welcomeDir, setPath);
  out(`set=welcome/${setPath} lang=${args.lang} lines=${jobs.length} chars=${chars} usd≈${((chars / SONIOX_CHARS_PER_SEC) * SONIOX_USD_PER_SEC).toFixed(4)}`
    + ` level=${lufs}LUFS/${kbps}k${args.apply ? '' : ' (dry run)'}`);
  if (!args.apply) return { path: setPath, lines: jobs.length, chars, recorded: 0 };
  if (!(env.SONIOX_TTS_API_KEY || env.SONIOX_API_KEY)) throw new Error('SONIOX_API_KEY is not set');
  const speaker = tts || require('../../shared/services/tts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify({ lang: args.lang, voice, lines: Object.fromEntries(jobs.map((j) => [j.key, j.text])) }, null, 1)}\n`);
  let usd = 0; let recorded = 0;
  for (const { file, say } of jobs) {
    const target = path.join(dir, file);
    if (fs.existsSync(target) && fs.statSync(target).size > 1000) continue;
    if (usd >= args.maxUsd) { out(`stopped: max_usd ${args.maxUsd}`); return { path: setPath, recorded, usd, stopped: 'max_usd' }; }
    const res = await speaker.synthesize({ text: say, language: args.lang, provider: 'soniox', voice: voice.voice, useCase: 'reading', site: 'web_quiz_welcome_lines' });
    const cost = (res.durationSec || 0) * SONIOX_USD_PER_SEC;
    fs.writeFileSync(target, await level(res.audio, { lufs, kbps }));
    usd += cost; recorded += 1;
    if (args.spendLog) {
      fs.appendFileSync(args.spendLog, `${JSON.stringify({ at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), ...args.spendExtra,
        provider: 'soniox', what: `welcome line ${setPath} ${file}`, units: Math.round((res.durationSec || 0) * 10) / 10, usd: Math.round(cost * 1e6) / 1e6 })}\n`);
    }
  }
  out(`SPEND usd=${usd.toFixed(4)} recorded=${recorded}`);
  return { path: setPath, recorded, usd };
}

if (require.main === module) {
  run(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { run, parseArgs };
