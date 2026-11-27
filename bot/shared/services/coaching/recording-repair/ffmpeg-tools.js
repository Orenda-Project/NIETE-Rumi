'use strict';
/** bd-8sr958 — the bundled ffmpeg, used only as a remuxer and a checker. */
const { spawn } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

const SR = 8000; // verification decode: mono 8 kHz, enough to hear whether a minute holds sound

function run(args, { input, timeoutMs = 120000, collectStdout = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', collectStdout ? 'pipe' : 'ignore', 'pipe'] });
    const out = [];
    let err = '';
    let killed = false;
    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, timeoutMs);
    if (collectStdout) child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => { err += d.toString(); if (err.length > 20000) err = err.slice(-20000); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, stderr: String(e.message), stdout: Buffer.alloc(0), killed }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stderr: err, stdout: Buffer.concat(out), killed }); });
  });
}

/** ffmpeg -i in -c copy out  (for a torn tail: ffmpeg stops at the last whole packet) */
async function remux(inPath, outPath, extraIn = []) {
  const r = await run(['-v', 'error', '-y', ...extraIn, '-i', inPath, '-vn', '-c:a', 'copy', outPath]);
  return r.code === 0;
}

/**
 * Full decode: { ok, errors, seconds, minutes: [rms dBFS per minute], silentMinutes }
 * ok needs a clean exit, no decode errors on stderr and a duration above 0.
 */
async function verify(path) {
  const r = await run(['-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', String(SR), '-f', 's16le', 'pipe:1'], { collectStdout: true });
  const pcm = r.stdout;
  const samples = Math.floor(pcm.length / 2);
  const seconds = samples / SR;
  const minutes = [];
  for (let m = 0; m * 60 * SR < samples; m++) {
    const from = m * 60 * SR;
    const to = Math.min(samples, from + 60 * SR);
    let sum = 0;
    for (let i = from; i < to; i++) { const v = pcm.readInt16LE(i * 2) / 32768; sum += v * v; }
    const rms = Math.sqrt(sum / Math.max(1, to - from));
    minutes.push(rms > 0 ? Math.round(20 * Math.log10(rms) * 10) / 10 : -120);
  }
  // the s16le muxer's rounding warnings on the resampled timestamps are not decode errors
  const errors = r.stderr.split('\n').filter((l) => l.trim() && !/non monotonically increasing dts/.test(l)).join('\n').trim();
  // a trailing partial minute shorter than 5 s is not judged for sound
  const judged = minutes.filter((_, i) => (i + 1) * 60 <= seconds || seconds - i * 60 >= 5);
  const silentMinutes = judged.filter((d) => d < -70).length;
  return { ok: r.code === 0 && !errors && seconds > 0 && silentMinutes < Math.max(1, judged.length), errors, seconds, minutes, silentMinutes };
}

module.exports = { run, remux, verify, ffmpegPath };
