// bd-8sr958 — find where each AAC frame of a damaged m4a ends, with no moov to say so.
//
// Android's MPEG4Writer stores the frames back to back in one mdat chunk; only the moov (written at stop()) says
// where each ends. FFmpeg's AAC decoder refuses a buffer that ends before the frame's END element, so at each offset
// the frame length is the SHORTEST span that decodes as one whole frame. The next frame starts with a CPE (0x20/0x21)
// for stereo or an SCE (0x00/0x01) for mono, which keeps the search to a few candidates per frame; when that
// shortcut finds nothing, the frame before is redone over every offset (a decoder also accepts a span that ends
// inside the NEXT frame).
//
// Runs as a child process (the lib is native, ES-module only, ~170 MB resident while it works): argv =
//   <file> <start> <end> <asc,asc,...> -> one JSON line on stdout.
// Ported from recover_moov.py (queue #315), checked against a file with a known answer.
import fs from 'node:fs';
import { CodecContext, Codec, Packet, Frame, Log } from 'node-av';
import { AV_CODEC_ID_AAC } from 'node-av/constants';

try { Log.setLevel(0); } catch (e) { /* older builds: the decoder's chatter goes to stderr, which the parent ignores */ }

const MAX_FRAME = 3072;
const [, , file, startS, endS, ascList, probeS] = process.argv;
const buf = fs.readFileSync(file);
const start = +startS;
const end = Math.min(+endS, buf.length);
const probeFrames = +probeS || 60;

function openDecoder(asc) {
  const codec = Codec.findDecoder(AV_CODEC_ID_AAC);
  const ctx = new CodecContext();
  ctx.allocContext3(codec);
  ctx.extraData = Buffer.from(asc, 'hex');
  if (ctx.open2Sync(codec) < 0) throw new Error('decoder would not open');
  return ctx;
}

function makeFinder(asc) {
  const ctx = openDecoder(asc);
  const frame = new Frame();
  frame.alloc();
  const channels = (parseInt(asc.slice(0, 4), 16) >> 3) & 0xf;
  const starts = channels === 1 ? [0x00, 0x01] : [0x20, 0x21];
  const oneFrame = (chunk) => {
    const pkt = new Packet();
    pkt.alloc();
    pkt.data = chunk;
    let ok = false;
    if (ctx.sendPacketSync(pkt) >= 0) {
      ok = ctx.receiveFrameSync(frame) >= 0;
      if (ok) frame.unref();
    }
    pkt.free();
    if (!ok) ctx.flushBuffers();
    return ok;
  };
  const scan = (p, strict, limit) => {
    const hi = Math.min(limit, p + MAX_FRAME);
    for (let q = p + 4; q <= hi; q++) {
      if (strict && q !== limit && !starts.includes(buf[q])) continue;
      if (oneFrame(buf.subarray(p, q))) return q - p;
    }
    return 0;
  };
  const run = (maxFrames) => {
    const sizes = [];
    let p = start;
    let backs = 0;
    while (p < end && sizes.length < maxFrames) {
      let f = scan(p, true, end);
      if (!f) {
        if (!sizes.length || backs >= 50) break;
        const prev = sizes.pop();
        p -= prev;
        ctx.flushBuffers();
        backs += 1;
        f = scan(p, false, end);
        if (!f) { sizes.push(prev); p += prev; break; }
      }
      sizes.push(f);
      p += f;
    }
    return { sizes, stop: p, backs };
  };
  return { run, free: () => { try { frame.free(); ctx.freeContext(); } catch (e) { /* closing anyway */ } } };
}

const candidates = ascList.split(',').filter(Boolean);
// A wrong config can still decode a few frames by luck (a mono file under a stereo config), but only by backing up
// again and again. So each candidate is scored on a probe: frames found, minus 10 per backtrack. The first that
// finds the whole probe without a single backtrack wins; otherwise the best score, if it is real (>= 10).
let chosen = null;
let best = { asc: null, score: 0 };
for (const asc of candidates) {
  let finder;
  try { finder = makeFinder(asc); } catch (e) { continue; }
  const probe = finder.run(probeFrames);
  finder.free();
  const score = probe.sizes.length - 10 * probe.backs;
  if (probe.sizes.length >= probeFrames && probe.backs === 0) { chosen = asc; break; }
  if (score > best.score) best = { asc, score };
}
if (!chosen && best.score >= 10) chosen = best.asc;
if (!chosen) {
  process.stdout.write(JSON.stringify({ ok: false, reason: 'no_template_decodes' }) + '\n');
  process.exit(0);
}
const finder = makeFinder(chosen);
const t0 = Date.now();
const { sizes, stop, backs } = finder.run(Infinity);
finder.free();
process.stdout.write(JSON.stringify({ ok: sizes.length > 0, asc: chosen, sizes, stop, backs, ms: Date.now() - t0 }) + '\n');
