'use strict';
/**
 * bd-8sr958 (queue #320) — recover a damaged recording before it is transcribed.
 *
 *   inspectRecording(buffer)          -> { kind, container, signature }       no decoding, boxes only
 *   repairRecording(buffer, {reference}) -> { outcome: 'intact'|'repaired'|'unrecoverable', buffer?, method, ... }
 *
 * Ladder (first rung that verifies wins):
 *   1 remux        ffmpeg -c copy: a torn tail on a file that still has its index (webm/ogg/mp4-with-moov)
 *   2 reference    her latest good file from the same recorder: only its AAC config is used
 *   3 template     the AAC configs Android recorders write, in the order the survey gave (survey_order.js)
 * The found frames are written as ADTS and remuxed to m4a with the bundled ffmpeg; no moov is built by hand.
 * Verify: a full decode with 0 errors, some sound in each minute, duration > 0. Anything else is 'unrecoverable' and
 * the caller (transcription-processor) fails the job permanently with ONE message. This module never throws.
 *
 * Teacher audio never reaches a test or the repo: tests use synthetic files only.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { walkTopLevel, isMp4Family, signatureOf } = require('./mp4-boxes');
const { parseAsc, toAdts } = require('./adts');
const { remux, verify } = require('./ffmpeg-tools');
const { TEMPLATE_ORDER } = require('./survey-order');

const FINDER = path.join(__dirname, 'frame-finder.mjs');
const MIN_FRAMES = 100; // ~2 s: below this a "recovery" is not a lesson
const FINDER_TIMEOUT_MS = 240000;

function containerOf(buf) {
  if (isMp4Family(buf)) return 'mp4';
  if (buf.length >= 4 && buf.toString('latin1', 0, 4) === 'OggS') return 'ogg';
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0x1a45dfa3) return 'webm';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF') return 'wav';
  if (buf.length >= 3 && (buf.toString('latin1', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0))) return 'mp3';
  return 'unknown';
}

function inspectRecording(buffer) {
  if (!buffer || buffer.length === 0) return { kind: 'empty', container: 'unknown', signature: null };
  const container = containerOf(buffer);
  if (container !== 'mp4') return { kind: container === 'unknown' ? 'unknown' : 'unchecked', container, signature: null };
  const boxes = walkTopLevel(buffer);
  const signature = signatureOf(buffer, boxes);
  const mdat = boxes.find((b) => b.type === 'mdat');
  const moov = boxes.find((b) => b.type === 'moov' && !b.overrun);
  if (!mdat) return { kind: 'no_mdat', container, signature };
  if (!moov) return { kind: 'no_moov', container, signature, mdat: { start: mdat.start + mdat.hdr, end: mdat.end } };
  if (mdat.overrun) return { kind: 'torn_tail', container, signature, mdat: { start: mdat.start + mdat.hdr, end: mdat.end } };
  return { kind: 'ok', container, signature };
}

/** AudioSpecificConfig of a finished m4a: the esds DecoderSpecificInfo (tag 0x05). Hex string, or null. */
function ascOfReference(ref) {
  try {
    if (!ref || !isMp4Family(ref)) return null;
    const i = ref.indexOf('esds');
    if (i < 0) return null;
    // ES_Descriptor (0x03) > DecoderConfigDescriptor (0x04) > DecoderSpecificInfo (0x05) = the AudioSpecificConfig
    let o = i + 8; // 'esds' + version/flags
    const readLen = () => { let n = 0; for (let k = 0; k < 4; k++) { const b = ref[o++]; n = (n << 7) | (b & 0x7f); if (!(b & 0x80)) break; } return n; };
    if (ref[o++] !== 0x03) return null;
    readLen(); o += 3;
    if (ref[o++] !== 0x04) return null;
    readLen(); o += 13;
    if (ref[o++] !== 0x05) return null;
    const n = readLen();
    if (n < 2) return null;
    const asc = ref.subarray(o, o + 2); // the two bytes that fix object type, rate and channels
    return parseAsc(asc) ? asc.toString('hex') : null;
  } catch (e) { return null; }
}

function findFrames(file, start, end, ascs) {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [FINDER, file, String(start), String(end), ascs.join(',')],
      { maxBuffer: 64 * 1024 * 1024, timeout: FINDER_TIMEOUT_MS, env: { ...process.env, NODE_OPTIONS: '' } },
      (err, stdout) => {
        if (err && !stdout) return resolve({ ok: false, reason: `finder_${err.killed ? 'timeout' : 'failed'}` });
        try { resolve(JSON.parse(String(stdout).trim().split('\n').pop())); } catch (e) { resolve({ ok: false, reason: 'finder_output' }); }
      });
    child.on('error', () => resolve({ ok: false, reason: 'finder_spawn' }));
  });
}

async function repairRecording(buffer, { reference = null } = {}) {
  const t0 = Date.now();
  const info = inspectRecording(buffer);
  const base = { kind: info.kind, container: info.container, signature: info.signature };
  const done = (o) => ({ ...base, seconds_taken: Math.round((Date.now() - t0) / 100) / 10, ...o });
  if (info.kind === 'empty') return done({ outcome: 'unrecoverable', reason: 'empty' });
  if (info.kind === 'ok') return done({ outcome: 'intact', buffer });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-'));
  try {
    const ext = info.container === 'unknown' ? 'bin' : info.container === 'mp4' ? 'm4a' : info.container;
    const inFile = path.join(dir, `in.${ext}`);
    fs.writeFileSync(inFile, buffer);

    // 1 — remux. Skipped when there is no index to keep and nothing we recognise to copy.
    if (info.container !== 'unknown' && !(info.container === 'mp4' && info.kind === 'no_moov')) {
      const out = path.join(dir, `remux.${info.container === 'mp4' ? 'm4a' : ext}`);
      if (await remux(inFile, out)) {
        const v = await verify(out);
        if (v.ok) return done({ outcome: 'repaired', method: 'remux', buffer: fs.readFileSync(out), seconds: v.seconds, minutes: v.minutes });
      }
    }
    if (info.container !== 'mp4' || !info.mdat) return done({ outcome: 'unrecoverable', reason: info.kind === 'unchecked' ? 'remux_failed' : info.kind });

    // 2 and 3 — find the frames. 'reference' first, then the templates in survey order.
    const refAsc = ascOfReference(reference);
    const ladder = [];
    if (refAsc) ladder.push({ method: 'reference', ascs: [refAsc] });
    ladder.push({ method: 'template', ascs: TEMPLATE_ORDER.map((t) => t.asc) });
    for (const rung of ladder) {
      const found = await findFrames(inFile, info.mdat.start, info.mdat.end, rung.ascs);
      if (!found.ok || found.sizes.length < MIN_FRAMES) continue;
      const asc = Buffer.from(found.asc, 'hex');
      const adts = path.join(dir, 'frames.aac');
      const used = found.sizes.reduce((a, b) => a + b, 0);
      fs.writeFileSync(adts, toAdts(buffer.subarray(info.mdat.start, info.mdat.start + used), found.sizes, asc));
      const out = path.join(dir, 'repaired.m4a');
      if (!(await remux(adts, out, ['-f', 'aac']))) continue;
      const v = await verify(out);
      if (!v.ok) continue;
      const tpl = TEMPLATE_ORDER.find((t) => t.asc === found.asc);
      return done({
        outcome: 'repaired', method: rung.method, buffer: fs.readFileSync(out), frames: found.sizes.length,
        seconds: v.seconds, minutes: v.minutes, coverage: Math.round((used / Math.max(1, info.mdat.end - info.mdat.start)) * 1000) / 1000,
        template_guess: rung.method === 'template' && tpl ? tpl.name : (parseAsc(asc) ? `${parseAsc(asc).sampleRate}/${parseAsc(asc).channels}ch (reference)` : null),
      });
    }
    return done({ outcome: 'unrecoverable', reason: 'no_frames_found' });
  } catch (e) {
    return done({ outcome: 'unrecoverable', reason: 'exception', error: String(e && e.message).slice(0, 200) });
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* tmp */ }
  }
}

module.exports = { inspectRecording, repairRecording, ascOfReference, containerOf };
