'use strict';
/**
 * Child test (bd-s1oo0.5) — fetch block media from R2 and cut audio clips.
 * ffmpeg is the same binary the rest of the bot uses (@ffmpeg-installer).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

function ffmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try { return require('@ffmpeg-installer/ffmpeg').path; } catch (_) { return 'ffmpeg'; }
}

function run(args) {
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath(), args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { err.stderr = String(stderr || '').slice(-400); reject(err); } else resolve({ stdout, stderr: String(stderr || '') });
    });
  });
}

function tmpFile(ext) {
  return path.join(os.tmpdir(), `child-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
}

async function downloadToTemp(key, ext) {
  const { downloadFromR2 } = require('../../../storage/r2');
  const buf = await downloadFromR2(key);
  const p = tmpFile(ext);
  fs.writeFileSync(p, buf);
  return p;
}

/** Duration in seconds from ffmpeg's own header read. */
async function probeDuration(file) {
  let stderr = '';
  try { await run(['-hide_banner', '-i', file]); } catch (e) { stderr = e.stderr || ''; }
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : null;
}

/** Cut [start, end] seconds to a 16 kHz mono clip; returns { path, base64 }. */
async function cutClip(file, start, end, format = 'mp3') {
  const out = tmpFile(format);
  const s = Math.max(0, start);
  const args = ['-y', '-loglevel', 'error', '-ss', s.toFixed(2), '-to', Math.max(s + 0.5, end).toFixed(2), '-i', file, '-ar', '16000', '-ac', '1'];
  if (format === 'mp3') args.push('-b:a', '48k');
  args.push(out);
  await run(args);
  const buf = fs.readFileSync(out);
  return { path: out, base64: buf.toString('base64') };
}

function cleanup(...files) {
  for (const f of files.flat()) { try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch (_) { /* best effort */ } }
}

module.exports = { downloadToTemp, probeDuration, cutClip, cleanup, tmpFile };
