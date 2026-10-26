'use strict';
/**
 * Stage 11, pre-cut clips (NIGHTLY_JOB §4 stage 11, §10): the R2 key, the cut through one temp file and the upload.
 * ffmpeg runs with coach-disagreement-clip.js's own arguments (-ss -t -vn -ac 1 -b:a 64k -f mp3), writing a file
 * instead of a pipe. The temp file is deleted in `finally`, on success and failure. Never logs the URL or the key.
 */
const fs = require('fs');
const path = require('path');
const { spawn: nodeSpawn } = require('child_process');
const { ffmpegArgs, ffmpegBinary } = require('../../services/coach-disagreement-clip');

const ENVS = ['sandbox', 'staging', 'production'];
const SESSION = /^[0-9a-f-]{36}$/;
const CUT_TIMEOUT_MS = 120000;

const wholeSecond = (n) => Number.isInteger(n) && n >= 0;

/** coachip/clips/<env>/<session_id>/<from_s>-<to_s>.mp3, the coachip_moments CHECK; throws on anything it would refuse. */
function clipKey(env, sessionId, fromS, toS) {
  if (!ENVS.includes(env)) throw new Error('clipKey: unknown environment');
  if (typeof sessionId !== 'string' || !SESSION.test(sessionId)) throw new Error('clipKey: session id is not a uuid');
  if (!wholeSecond(fromS) || !wholeSecond(toS) || toS <= fromS) throw new Error('clipKey: bad seconds');
  return `coachip/clips/${env}/${sessionId}/${fromS}-${toS}.mp3`;
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
  const spawn = d.spawn || nodeSpawn;
  const log = typeof d.log === 'function' ? d.log : () => {};
  let dir = null;
  try {
    if (!wholeSecond(fromS) || !wholeSecond(toS) || toS <= fromS || !d.tmpDir || !d.bucket || typeof d.putObject !== 'function') {
      log('clip_failed', { stage: 'input' });
      return 'failed';
    }
    dir = fs.mkdtempSync(path.join(d.tmpDir, 'coachip-clip-'));
    const out = path.join(dir, 'clip.mp3');
    const args = ffmpegArgs(srcUrl, { start: fromS, length: toS - fromS });
    args[args.length - 1] = out;
    const ok = await runFfmpeg(spawn, d.bin || ffmpegBinary(), args, d.timeoutMs || CUT_TIMEOUT_MS);
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

module.exports = { clipKey, cutAndUpload, planClips };
