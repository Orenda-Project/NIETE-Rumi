'use strict';
/**
 * Round 28 (sa_r28_letter_gate): an energy voice-activity check for the letter-sound clips, in place of "speech-to-text
 * heard no word" (a child saying bare sounds, /b/ /m/ /s/, says no word). No vendor call: the clip the model hears is
 * decoded to 16 kHz mono PCM with ffmpeg and measured here.
 *
 * Like ffmpeg's silencedetect (a stretch quieter than the floor for at least minSilenceMs is silence; the rest is voiced),
 * but the floor is RELATIVE to the clip's own noise floor, never a fixed dBFS: phones level differently (AGC). The
 * floor is the floorRule.percentile-th percentile of the clip's frame loudness plus floorRule.plusDb, and never below
 * floorRule.minDb (digital silence has no noise floor to measure).
 *   pass = voiced >= minVoicedMs AND (voiced share < maxVoicedShare OR margin_db >= minMarginDb)
 * Speech pauses and steady noise, of any level, does not; a child sounding letters with no 150 ms pause has a voiced
 * share near 1 but stands far above the floor, which steady noise does not: margin_db is the 90th-percentile frame
 * loudness minus the (clamped) floor.
 * VAD holds the shipped numbers in one place; the study lane sets them from its measurements.
 */
const fs = require('fs');
const { execFile } = require('child_process');

const VAD = Object.freeze({
  frameMs: 10,                 // loudness is measured per 10 ms frame
  minSilenceMs: 150,           // silencedetect's d=0.15
  floorRule: Object.freeze({ percentile: 10, plusDb: 10, minDb: -70 }),
  minVoicedMs: 500,
  maxVoicedShare: 0.9,
  minMarginDb: 20,             // or: the loud frames stand this far above the floor (a child with no pause)
});
const DB_MIN = -100;
const RATE = 16000;

const params = (over = {}) => ({ ...VAD, ...over, floorRule: { ...VAD.floorRule, ...(over.floorRule || {}) } });

/**
 * samples: PCM (an Int16Array, or numbers in -1..1), rate in Hz.
 * → { voiced_ms, share, floor_db, margin_db, pass, total_ms } (share 0-1, two decimals; dB one decimal).
 */
function voiceActivity(samples, rate = RATE, over = {}) {
  const p = params(over);
  const scale = samples instanceof Int16Array ? 1 / 32768 : 1;
  const len = samples.length;
  const n = Math.max(1, Math.round((rate * p.frameMs) / 1000));
  const db = [];
  for (let at = 0; at < len; at += n) {
    const end = Math.min(len, at + n);
    let sum = 0;
    for (let i = at; i < end; i += 1) { const x = samples[i] * scale; sum += x * x; }
    const rms = Math.sqrt(sum / (end - at));
    db.push({ size: end - at, db: rms > 0 ? Math.max(DB_MIN, 20 * Math.log10(rms)) : DB_MIN });
  }
  const totalMs = (len / rate) * 1000;
  if (!db.length) return { voiced_ms: 0, share: 0, floor_db: null, margin_db: null, pass: false, total_ms: 0 };
  const sorted = db.map((f) => f.db).sort((a, b) => a - b);
  const pct = sorted[Math.floor(((sorted.length - 1) * p.floorRule.percentile) / 100)];
  const floor = Math.max(pct + p.floorRule.plusDb, p.floorRule.minDb);
  const margin = sorted[Math.floor((sorted.length - 1) * 0.9)] - floor;
  let silentSamples = 0;
  let run = 0;
  const close = () => { if ((run / rate) * 1000 >= p.minSilenceMs) silentSamples += run; run = 0; };
  for (const f of db) {
    if (f.db < floor) run += f.size; else close();
  }
  close();
  const voicedMs = Math.max(0, totalMs - (silentSamples / rate) * 1000);
  const share = totalMs > 0 ? voicedMs / totalMs : 0;
  return {
    voiced_ms: Math.round(voicedMs),
    share: Math.round(share * 100) / 100,
    floor_db: Math.round(floor * 10) / 10,
    margin_db: Math.round(margin * 10) / 10,
    pass: voicedMs >= p.minVoicedMs && (share < p.maxVoicedShare || margin >= p.minMarginDb),
    total_ms: Math.round(totalMs),
  };
}

function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { return require('@ffmpeg-installer/ffmpeg').path; } catch (_) { return 'ffmpeg'; } // eslint-disable-line global-require
}

/** The clip the model hears ({ base64 }), decoded to 16 kHz mono PCM: { samples: Int16Array, rate }. */
async function pcmOf(clip, signal) {
  const media = require('../scoring/media'); // eslint-disable-line global-require
  const file = media.tmpFile('audio');
  fs.writeFileSync(file, Buffer.from(String((clip && clip.base64) || ''), 'base64'));
  try {
    const buf = await new Promise((resolve, reject) => {
      execFile(ffmpegPath(), ['-nostdin', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 's16le', '-'],
        { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, ...(signal ? { signal } : {}) },
        (err, stdout) => (err ? reject(err) : resolve(stdout)));
    });
    const samples = new Int16Array(buf.length >> 1);
    for (let i = 0; i < samples.length; i += 1) samples[i] = buf.readInt16LE(i * 2);
    return { samples, rate: RATE };
  } finally { media.cleanup(file); }
}

module.exports = { VAD, voiceActivity, pcmOf, RATE };
