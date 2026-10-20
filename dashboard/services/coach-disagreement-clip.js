'use strict';
/**
 * bd-tbprit.2 — the disputed step of a C/D teacher's recording, cut on the server for her assigned coach:
 * 60 seconds as mp3, from 15 seconds before the grader's timestamp; with an end (bd-tbprit.9, Rifat: "starts at
 * the start time and stops at the end time") exactly from `at` to `to`, at most ten minutes. Recordings are mostly ogg/webm, so a
 * byte range cannot cut them; ffmpeg reads the five-minute presigned link, which never reaches the browser.
 *
 * ffmpeg: FFMPEG_PATH, else the binary @ffmpeg-installer/ffmpeg bundles (a portal dependency, so the bot and
 * worker images are untouched), else ffmpeg on PATH. Missing or failing before the first bytes, openClip
 * rejects and the route answers 503 — the card itself never depends on the clip.
 */
const { spawn: nodeSpawn } = require('child_process');

const LEAD_S = 15;
const LENGTH_S = 60;
const MAX_LENGTH_S = 600;
const MAX_AT_S = 6 * 3600;
const FIRST_BYTE_MS = 20000;

function windowOf(at, to = null) {
  if (to != null && to > at) return { start: at, length: Math.min(to - at, MAX_LENGTH_S) };
  return { start: Math.max(0, at - LEAD_S), length: LENGTH_S };
}

/** Whole seconds 0..6h from a query string; null for anything else. */
function parseAt(value) {
  if (typeof value !== 'string' || !/^\d{1,5}$/.test(value)) return null;
  const n = Number(value);
  return n <= MAX_AT_S ? n : null;
}

function ffmpegArgs(url, { start, length }) {
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-ss', String(start), '-i', url, '-t', String(length),
    '-vn', '-ac', '1', '-b:a', '64k', '-f', 'mp3', 'pipe:1',
  ];
}

function ffmpegBinary(env = process.env, bundled = () => require('@ffmpeg-installer/ffmpeg').path) {
  if (env.FFMPEG_PATH) return env.FFMPEG_PATH;
  try { return bundled() || 'ffmpeg'; } catch (_) { return 'ffmpeg'; }
}

/**
 * Starts ffmpeg (opts.to: the end, see windowOf); resolves { stream, first, proc } once the first audio bytes arrive (the route then sets its
 * headers, writes `first` and pipes the rest). Rejects on spawn error, an early exit or no audio in time.
 */
function openClip(url, at, deps = {}) {
  const to = deps.to == null ? null : deps.to;
  const spawn = deps.spawn || nodeSpawn;
  const bin = deps.bin || ffmpegBinary();
  const firstByteMs = deps.firstByteMs || FIRST_BYTE_MS;
  return new Promise((resolve, reject) => {
    let settled = false;
    const proc = spawn(bin, ffmpegArgs(url, windowOf(at, to)), { stdio: ['ignore', 'pipe', 'pipe'] });
    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { proc.kill('SIGKILL'); } catch (_) { /* already gone */ }
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error('clip timed out before any audio')), firstByteMs);
    proc.on('error', fail);
    proc.on('close', (code) => fail(new Error(`ffmpeg exited ${code} before any audio`)));
    if (proc.stderr) proc.stderr.resume();
    proc.stdout.once('data', (first) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.stdout.pause();
      resolve({ stream: proc.stdout, first, proc });
    });
  });
}

module.exports = { windowOf, parseAt, ffmpegArgs, ffmpegBinary, openClip };
