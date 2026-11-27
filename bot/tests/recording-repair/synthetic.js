'use strict';
// bd-8sr958 — synthetic audio only (no teacher audio in the repo). The bundled ffmpeg makes AAC m4a files; the
// damage helpers then do to them what an Android recorder that never finished does.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

function make({ seconds = 20, rate = 48000, channels = 2, ext = 'm4a', codec = 'aac' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-syn-'));
  const out = path.join(dir, `a.${ext}`);
  const layout = channels === 1 ? 'mono' : 'stereo';
  const args = ['-v', 'error', '-y',
    '-f', 'lavfi', '-i', `sine=f=300:d=${seconds}`,
    '-f', 'lavfi', '-i', `anoisesrc=d=${seconds}:c=pink:a=0.1`,
    '-filter_complex', `[0][1]amix=inputs=2,aformat=channel_layouts=${layout},aresample=${rate}`,
    '-c:a', codec, '-b:a', '64k', '-ac', String(channels), '-ar', String(rate), out];
  execFileSync(ffmpegPath, args);
  const buf = fs.readFileSync(out);
  fs.rmSync(dir, { recursive: true, force: true });
  return buf;
}

function boxes(buf) {
  const out = []; let o = 0;
  while (o + 8 <= buf.length) {
    let size = buf.readUInt32BE(o); const type = buf.toString('latin1', o + 4, o + 8); let hdr = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(o + 8)); hdr = 16; }
    out.push({ type, start: o, hdr, size });
    if (!size) break;
    o += size;
  }
  return out;
}

// What an unfinished Android m4a is: ftyp, free, mdat (size never written back), and no moov.
function noMoov(buf, { mdatSize = 'zero' } = {}) {
  const b = boxes(buf);
  const mdat = b.find((x) => x.type === 'mdat');
  const moov = b.find((x) => x.type === 'moov');
  const cut = Buffer.from(buf.subarray(0, moov ? moov.start : buf.length));
  if (mdatSize === 'zero') cut.writeUInt32BE(0, mdat.start);
  else if (mdatSize === 'marks') cut.write('????', mdat.start, 'latin1');
  return cut;
}

function tornTail(buf, keep = 0.6) { return Buffer.from(buf.subarray(0, Math.floor(buf.length * keep))); }

module.exports = { make, boxes, noMoov, tornTail, ffmpegPath };
