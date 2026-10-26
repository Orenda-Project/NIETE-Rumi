'use strict';
/**
 * Stage 11, pre-cut clips (NIGHTLY_JOB §4 stage 11, §10): the R2 key, the cut through one temp file and the upload.
 * ffmpeg runs with coach-disagreement-clip.js's own arguments (-ss -t -vn -ac 1 -b:a 64k -f mp3), writing a file
 * instead of a pipe. The temp file is deleted in `finally`, on success and failure. Never logs the URL or the key.
 * Also the whole lesson as one seekable MP3 (API.md §10 R8): a cue-less WebM never seeks in the browser, so the full
 * recording is re-encoded once per session with a shown moment, 32 kbps mono (speech; half the data of 64 k).
 */
const fs = require('fs');
const path = require('path');
const { spawn: nodeSpawn } = require('child_process');
const { ffmpegArgs, ffmpegBinary } = require('../../services/coach-disagreement-clip');

const ENVS = ['sandbox', 'staging', 'production'];
const SESSION = /^[0-9a-f-]{36}$/;
const CUT_TIMEOUT_MS = 120000;
const FULL_TIMEOUT_MS = 900000;
const FULL_BITRATE = '32k';

const wholeSecond = (n) => Number.isInteger(n) && n >= 0;

/** coachip/clips/<env>/<session_id>/<from_s>-<to_s>.mp3, the coachip_moments CHECK; throws on anything it would refuse. */
function clipKey(env, sessionId, fromS, toS) {
  if (!ENVS.includes(env)) throw new Error('clipKey: unknown environment');
  if (typeof sessionId !== 'string' || !SESSION.test(sessionId)) throw new Error('clipKey: session id is not a uuid');
  if (!wholeSecond(fromS) || !wholeSecond(toS) || toS <= fromS) throw new Error('clipKey: bad seconds');
  return `coachip/clips/${env}/${sessionId}/${fromS}-${toS}.mp3`;
}

/** coachip/full/<env>/<session_id>.mp3, the key m-player's R8 serves first. */
function fullKey(env, sessionId) {
  if (!ENVS.includes(env)) throw new Error('fullKey: unknown environment');
  if (typeof sessionId !== 'string' || !SESSION.test(sessionId)) throw new Error('fullKey: session id is not a uuid');
  return `coachip/full/${env}/${sessionId}.mp3`;
}

/** The disagreements arguments without the seek and the length, at FULL_BITRATE. */
function fullArgs(url, out) {
  const args = ffmpegArgs(url, { start: 0, length: 1 });
  const ss = args.indexOf('-ss');
  args.splice(ss, 2);
  const t = args.indexOf('-t');
  args.splice(t, 2);
  args[args.indexOf('-b:a') + 1] = FULL_BITRATE;
  args[args.length - 1] = out;
  return args;
}

function runFfmpeg(spawn, bin, args, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let proc;
    const finish = (ok) => { if (!settled) { settled = true; clearTimeout(timer); resolve(ok); } };
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch (_) { /* gone */ } finish(false); }, timeoutMs);
    try {
      proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (_) { finish(false); return; }
    if (proc.stderr && proc.stderr.resume) proc.stderr.resume();
    proc.on('error', () => finish(false));
    proc.on('close', (code) => finish(code === 0));
  });
}

/**
 * Cuts [fromS, toS) of the recording at srcUrl into a temp file under deps.tmpDir, uploads it with
 * deps.putObject({Bucket, Key, Body, ContentType}) and removes the file. Returns 'ready' or 'failed'.
 * deps: { tmpDir, putObject, bucket, spawn?, bin?, timeoutMs?, log? }.
 */
async function cutAndUpload({ srcUrl, fromS, toS, key, deps }) {
  const d = deps || {};
  if (!wholeSecond(fromS) || !wholeSecond(toS) || toS <= fromS) {
    if (typeof d.log === 'function') d.log('clip_failed', { stage: 'input' });
    return 'failed';
  }
  return encodeAndUpload({ key, deps: d, timeoutMs: d.timeoutMs || CUT_TIMEOUT_MS, argsFor: (out) => {
    const args = ffmpegArgs(srcUrl, { start: fromS, length: toS - fromS });
    args[args.length - 1] = out;
    return args;
  } });
}

/** The whole recording at srcUrl as one MP3 under `key`. Returns 'ready' or 'failed'; same deps as cutAndUpload. */
async function cutFullAndUpload({ srcUrl, key, deps }) {
  const d = deps || {};
  return encodeAndUpload({ key, deps: d, timeoutMs: d.timeoutMs || FULL_TIMEOUT_MS, argsFor: (out) => fullArgs(srcUrl, out) });
}

async function encodeAndUpload({ key, deps: d, timeoutMs, argsFor }) {
  const spawn = d.spawn || nodeSpawn;
  const log = typeof d.log === 'function' ? d.log : () => {};
  let dir = null;
  try {
    if (!d.tmpDir || !d.bucket || typeof d.putObject !== 'function') {
      log('clip_failed', { stage: 'input' });
      return 'failed';
    }
    dir = fs.mkdtempSync(path.join(d.tmpDir, 'coachip-clip-'));
    const out = path.join(dir, 'clip.mp3');
    const ok = await runFfmpeg(spawn, d.bin || ffmpegBinary(), argsFor(out), timeoutMs);
    if (!ok || !fs.existsSync(out) || fs.statSync(out).size === 0) {
      log('clip_failed', { stage: 'ffmpeg' });
      return 'failed';
    }
    const body = fs.readFileSync(out);
    await d.putObject({ Bucket: d.bucket, Key: key, Body: body, ContentType: 'audio/mpeg' });
    return 'ready';
  } catch (_) {
    log('clip_failed', { stage: 'upload' });
    return 'failed';
  } finally {
    if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best effort */ } }
  }
}

/** The moments that need a cut tonight: shown, with a second to cut on, not yet ready or expired. */
function planClips(moments, shownIds) {
  const shown = shownIds instanceof Set ? shownIds : new Set(shownIds || []);
  return (moments || []).filter((m) => m && shown.has(m.id) && m.confidence !== 'none'
    && (m.clip_status === 'pending' || m.clip_status === 'failed'));
}

module.exports = { clipKey, cutAndUpload, planClips, fullKey, fullArgs, cutFullAndUpload, FULL_BITRATE };
