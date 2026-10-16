#!/usr/bin/env node
/**
 * Read-along build: a passage's text → Jugnu's voice at a child's pace + the time of every word.
 *
 *   node scripts/web-quiz/readalong-build.js --out <dir> [--ids en.read.1.story01,ur.read.2.story01 | --all]
 *        [--provider soniox|elevenlabs] [--wpm <n>] [--tempo-floor 0.85] [--word-max-ms 120] [--spend-log <file.jsonl> --spend-lane <label>] [--max-usd 2.00] [--force]
 *   node scripts/web-quiz/readalong-build.js --out <dir> --text-file page.txt --id <book>/p3 --lang ur --band 1
 *        (the page's printed line breaks as newlines in the file: each becomes a pause)
 *
 * For each passage (the item bank's files, bot/shared/data/child-test/passages):
 *   1. speech in the quiz voice (Soniox Grace / Ishita at speed 0.7 with a [pause] after each sentence; or ElevenLabs)
 *   2. speech recognition on it (Soniox async, word timestamps) — to find the gaps between sentences
 *   3. pacing with ffmpeg, exact: silence at clause commas (250 ms; ElevenLabs also 700 ms at sentence ends) and, when
 *      short of the pace, an even gap between words (≤ 120 ms); then a pitch-kept
 *      slow-down (never below 0.85× EN / 0.90× UR) toward the band's words a minute (90 / 100 / 110), Opus 32 kb/s mono
 *   4. speech recognition on the FINAL clip → every printed word timed (missed words spread between neighbours)
 * and writes <out>/<lang>/<id>/current.json + <voice>-<hash8>.ogg + report.json. Uploading is a separate step (the
 * environment's bucket at readalong/<env>/passage/<lang>/<id>/…); nothing here touches a database.
 * A file whose words were > 15 % interpolated is written with report.ok = false and must not be uploaded.
 *
 * Money: every paid call is checked against a running total BEFORE it is made (--max-usd, default US$2.00) and logged
 * after; past the cap the build stops with the total in the message and writes one `web_quiz.readalong_spend_cap` event
 * line to stderr. A server that voices a page on its first open uses the per-page-per-hour cap in the timing module.
 *
 * Keys: SONIOX_TTS_API_KEY (or SONIOX_API_KEY) for speech and recognition; ELEVENLABS_API_KEY for --provider elevenlabs.
 * Read from the environment only; never printed. Needs ffmpeg and ffprobe on PATH. No npm dependencies.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const BOT = path.join(__dirname, '..', '..', 'bot');
const Tm = require(path.join(BOT, 'shared/services/quiz/web-quiz-readalong-timing'));
const PASSAGES = path.join(BOT, 'shared/data/child-test/passages');

const VOICES = { soniox: { en: 'Grace', ur: 'Ishita' }, elevenlabs: { en: 'cgSgspJ2msm6clMCkdW9', ur: '9cI5mhBtM4WtQ9Fo6jWQ' } };
const SONIOX_TTS_USD_PER_S = 0.722 / 3600;
const SONIOX_STT_USD_PER_S = 0.10 / 3600;
const ELEVEN_USD_PER_CHAR = 0.30 / 1000;   // list-price estimate, logged as such
const MAX_INTERP = 0.15;
const DEFAULT_MAX_USD = 2;

function args(argv) {
  const a = { provider: 'soniox' };
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i].replace(/^--/, '');
    if (['all', 'force'].includes(k)) a[k] = true; else { a[k] = argv[i + 1]; i += 1; }
  }
  return a;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sonioxKey = () => process.env.SONIOX_TTS_API_KEY || process.env.SONIOX_API_KEY || '';

/** The build's purse: guard(usd) before a paid call (throws past the cap), spend(...) after it (logs the line, then
 *  throws if that call passed the cap). One spend-cap event, however often the cap is hit. */
function makeSpender({ file = null, lane = 'readalong-build', maxUsd, onCap } = {}) {
  const max = maxUsd == null || maxUsd === '' || !isFinite(Number(maxUsd)) ? DEFAULT_MAX_USD : Number(maxUsd);
  const cap = Tm.spendCap({ maxUsd: max, onCap: onCap || ((e) => process.stderr.write(`${JSON.stringify(e)}\n`)) });
  return {
    max,
    total: cap.total,
    guard: (usd) => cap.check(usd),
    spend(provider, what, units, usd) {
      if (file) fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), lane, provider, what, units, usd: Math.round(usd * 1e5) / 1e5 })}\n`);
      cap.add(usd);
    },
  };
}
// a generous guess of a Soniox voice's length before it is made (speed 0.7 ≈ 2 words a second; a [pause] ≈ 1 s)
const ttsGuessS = (text) => String(text).trim().split(/\s+/).length / 1.5 + (String(text).match(/[.!?۔؟\n]/g) || []).length + 2;

function durationMs(file) {
  const out = execFileSync('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim();
  return Math.round(Number(out) * 1000);
}

async function http(url, init, what) {
  for (let attempt = 1; ; attempt += 1) {
    const r = await fetch(url, init);
    if (r.ok) return r;
    const body = (await r.text()).slice(0, 200);
    if (attempt >= 3 || ![408, 429, 500, 502, 503, 504].includes(r.status)) throw new Error(`${what}: HTTP ${r.status} ${body}`);
    await sleep(1500 * attempt);
  }
}

/** A Soniox [pause] after every sentence end and every printed line break (the tag is spoken as silence, never read). */
function withPauses(text) {
  const lines = String(text).trim().split(/\n+/).map((l) => l.trim()).filter(Boolean);
  return lines.map((line) => line.split(/\s+/).map((w) => (Tm.SENTENCE_END.test(w) ? `${w} [pause]` : w)).join(' ').replace(/ \[pause\]$/, ''))
    .join(' [pause] ');
}

async function speak({ provider, lang, text, file, purse }) {
  if (provider === 'elevenlabs') {
    purse.guard(text.length * ELEVEN_USD_PER_CHAR);
    const r = await http(`https://api.elevenlabs.io/v1/text-to-speech/${VOICES.elevenlabs[lang]}?output_format=mp3_44100_64`, {
      method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY || '', 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `[slowly] ${text}`, model_id: 'eleven_v3', voice_settings: { stability: 0.5, similarity_boost: 0.8 } }),
    }, 'elevenlabs tts');
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    purse.spend('elevenlabs', 'readalong tts', text.length, text.length * ELEVEN_USD_PER_CHAR);
    return { provider, voice: VOICES.elevenlabs[lang], model: 'eleven_v3' };
  }
  purse.guard(ttsGuessS(text) * SONIOX_TTS_USD_PER_S);
  const r = await http('https://tts-rt.soniox.com/tts', {
    method: 'POST', headers: { Authorization: `Bearer ${sonioxKey()}`, 'Content-Type': 'application/json', 'User-Agent': 'voice-gateway/1.0' },
    // measured best for a child: speed 0.7 (the API's slowest) and a [pause] after every sentence end
    body: JSON.stringify({ model: 'tts-rt-v2', text: withPauses(text), speed: 0.7, language: lang, voice: VOICES.soniox[lang], audio_format: 'opus', sample_rate: 48000, bitrate: 64000, client_reference_id: 'tts-readalong-build' }),
  }, 'soniox tts');
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  const ms = durationMs(file);
  if (ms < 500) throw new Error('soniox tts: clip too short');
  purse.spend('soniox', 'readalong tts', Math.round(ms / 100) / 10, (ms / 1000) * SONIOX_TTS_USD_PER_S);
  return { provider, voice: VOICES.soniox[lang], model: 'tts-rt-v2' };
}

/** Soniox async recognition with word timestamps; the uploaded file and the transcription are deleted after. */
async function recognise({ file, lang, purse }) {
  purse.guard((durationMs(file) / 1000) * SONIOX_STT_USD_PER_S);
  const H = { Authorization: `Bearer ${sonioxKey()}` };
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file)]), path.basename(file));
  const f = await (await http('https://api.soniox.com/v1/files', { method: 'POST', headers: H, body: form }, 'soniox upload')).json();
  let t = null;
  try {
    t = await (await http('https://api.soniox.com/v1/transcriptions', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'stt-async-v4', file_id: f.id, language_hints: [lang] }) }, 'soniox stt')).json();
    let s = null;
    for (let k = 0; k < 180; k += 1) {
      s = await (await http(`https://api.soniox.com/v1/transcriptions/${t.id}`, { headers: H }, 'soniox poll')).json();
      if (s.status === 'completed' || s.status === 'error') break;
      await sleep(1000);
    }
    if (!s || s.status !== 'completed') throw new Error(`soniox stt: ${s && s.status}`);
    const tr = await (await http(`https://api.soniox.com/v1/transcriptions/${t.id}/transcript`, { headers: H }, 'soniox transcript')).json();
    const ms = durationMs(file);
    purse.spend('soniox', 'readalong align', Math.round(ms / 100) / 10, (ms / 1000) * SONIOX_STT_USD_PER_S);
    return Tm.sttWords(tr.tokens);
  } finally {
    if (t) await fetch(`https://api.soniox.com/v1/transcriptions/${t.id}`, { method: 'DELETE', headers: H }).catch(() => {});
    await fetch(`https://api.soniox.com/v1/files/${f.id}`, { method: 'DELETE', headers: H }).catch(() => {});
  }
}

/** Silence at the cuts, then the tempo, in one ffmpeg graph per segment; returns nothing (writes `dst`). */
function pace({ src, dst, cuts, tempo, tmp, leadInMs = 0 }) {
  const parts = [];
  if (leadInMs > 0) {
    const z = path.join(tmp, 'lead.wav');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', ((leadInMs * tempo) / 1000).toFixed(3), z]);
    parts.push(z);
  }
  const points = [0, ...cuts.map((c) => c.at_ms)];
  points.forEach((start, k) => {
    const seg = path.join(tmp, `s${k}.wav`);
    const end = points[k + 1];
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-ss', (start / 1000).toFixed(3), ...(end != null ? ['-to', (end / 1000).toFixed(3)] : []), '-ar', '48000', '-ac', '1', seg]);
    parts.push(seg);
    if (k < cuts.length) {
      const z = path.join(tmp, `z${k}.wav`);
      // silence × tempo now = exactly add_ms after the slow-down
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', ((cuts[k].add_ms * tempo) / 1000).toFixed(3), z]);
      parts.push(z);
    }
  });
  const list = path.join(tmp, 'list.txt');
  fs.writeFileSync(list, parts.map((p) => `file '${p}'\n`).join(''));
  const joined = path.join(tmp, 'joined.wav');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', joined, '-filter:a', `atempo=${tempo.toFixed(4)}`, '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', dst]);
}

async function build({ id, lang, band, text, out, provider, wpm, purse, force, tempoFloor, wordMax }) {
  const dir = path.join(out, lang, id.replace(/[^A-Za-z0-9._-]+/g, '-'));
  if (!force && fs.existsSync(path.join(dir, 'report.json')) && JSON.parse(fs.readFileSync(path.join(dir, 'report.json'))).ok) return JSON.parse(fs.readFileSync(path.join(dir, 'report.json')));
  fs.mkdirSync(dir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'readalong-'));
  try {
    const printed = Tm.printedWords(text);
    const raw = path.join(tmp, provider === 'elevenlabs' ? 'raw.mp3' : 'raw.ogg');
    const voice = await speak({ provider, lang, text, file: raw, purse });
    const rawTimed = Tm.finalize(printed, Tm.match(printed, await recognise({ file: raw, lang, purse })), durationMs(raw));
    const target = Number(wpm) || Tm.PACE_WPM[band] || 100;
    // the voice already pauses at sentence ends ([pause]); the pace comes from a gentle tempo (EN ≥ 0.85, UR ≥ 0.90 —
    // more stretch is audible) and, only if still short, small even gaps between words
    const floor = Number(tempoFloor) || (lang === 'ur' ? 0.9 : 0.85);
    const sentenceMs = provider === 'elevenlabs' ? 700 : 0;
    // a short page with no line break to pause at (≤ 12 words) may take gaps up to 180 ms between words, and starts
    // after 400 ms of quiet; everything else keeps gaps ≤ 120 ms
    const short = printed.length <= 12 && !/\n/.test(text.trim());
    const wordMaxMs = Number(wordMax) || (short ? 180 : 120);
    const { cuts, tempo } = Tm.planPace(printed, rawTimed, target, { floor, sentenceMs, clauseMs: 250, wordMaxMs });
    const added = cuts.reduce((n, c) => n + c.add_ms, 0);
    const paced = path.join(tmp, 'paced.ogg');
    pace({ src: raw, dst: paced, cuts, tempo, tmp, leadInMs: short ? 400 : 0 });
    const audioMs = durationMs(paced);
    const pairs = Tm.match(printed, await recognise({ file: paced, lang, purse }));
    const words = Tm.finalize(printed, pairs, audioMs);
    const interp = words.filter((w) => w.src === 'interp').length;
    const tag = `${provider === 'elevenlabs' ? 'el' : 'sx'}-${String(voice.voice).toLowerCase().slice(0, 12)}`;
    const audioName = `${tag}-${crypto.createHash('sha256').update(fs.readFileSync(paced)).digest('hex').slice(0, 8)}.ogg`;
    fs.copyFileSync(paced, path.join(dir, audioName));
    const file = Tm.timingFile({ id, lang, text, audioName, audioMs, words, voice });
    fs.writeFileSync(path.join(dir, 'current.json'), JSON.stringify(file));
    const report = { id, lang, band, ok: interp / words.length <= MAX_INTERP, words: words.length, interpolated: interp, wpm: file.pace_wpm, target_wpm: target,
      tempo: Math.round(tempo * 1000) / 1000, pauses_added_ms: added, audio_ms: audioMs, audio_bytes: fs.statSync(path.join(dir, audioName)).size, audio: audioName, voice };
    fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 1));
    return report;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  const a = args(process.argv);
  if (!a.out) throw new Error('--out <dir> is required');
  const purse = makeSpender({ file: a['spend-log'] || null, lane: a['spend-lane'] ? String(a['spend-lane']) : undefined, maxUsd: a['max-usd'] });
  if (!sonioxKey()) throw new Error('SONIOX_TTS_API_KEY (or SONIOX_API_KEY) is not set');
  let items;
  if (a['text-file']) {
    items = [{ id: a.id, lang: a.lang === 'ur' ? 'ur' : 'en', band: Number(a.band) || 1, text: fs.readFileSync(a['text-file'], 'utf8').trim() }];
  } else {
    const want = a.all ? null : new Set(String(a.ids || '').split(',').filter(Boolean));
    items = fs.readdirSync(PASSAGES).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(PASSAGES, f), 'utf8')))
      .filter((p) => p.text && (!want || want.has(p.passage_id))).map((p) => ({ id: p.passage_id, lang: p.lang, band: p.band, text: p.text }));
  }
  const reports = [];
  for (const it of items) {
    try {
      const opts = { ...it, out: a.out, provider: a.provider, wpm: a.wpm, purse, force: a.force, tempoFloor: a['tempo-floor'], wordMax: a['word-max-ms'] };
      let r = await build(opts);
      if (!r.ok) r = await build({ ...opts, force: true });   // one more voice: recognition misses vary take to take
      reports.push(r);
      process.stdout.write(`${r.ok ? 'ok ' : 'BAD'} ${it.id} words=${r.words} interp=${r.interpolated} wpm=${r.wpm} audio=${(r.audio_ms / 1000).toFixed(1)}s ${Math.round(r.audio_bytes / 1024)}KB\n`);
    } catch (e) {
      reports.push({ id: it.id, ok: false, error: String(e.message || e).slice(0, 200) });
      if (/spend cap/.test(String(e.message))) { process.stdout.write(`STOP ${String(e.message)}\n`); break; }
      process.stdout.write(`ERR ${it.id} ${String(e.message || e).slice(0, 200)}\n`);
    }
  }
  fs.writeFileSync(path.join(a.out, 'build-report.json'), JSON.stringify(reports, null, 1));
}

if (require.main === module) main().catch((e) => { process.stderr.write(`${e.message}\n`); process.exit(1); });
module.exports = { build, pace, args, makeSpender, DEFAULT_MAX_USD };
