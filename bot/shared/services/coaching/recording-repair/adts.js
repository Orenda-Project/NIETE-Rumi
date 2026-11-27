'use strict';
/** bd-8sr958 — raw AAC frames to an ADTS stream, which the bundled ffmpeg remuxes to m4a with `-c copy`. */

const RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** AudioSpecificConfig (2 bytes, AAC-LC style) -> { objectType, rateIndex, channels, sampleRate } */
function parseAsc(asc) {
  if (!asc || asc.length < 2) return null;
  const b = (asc[0] << 8) | asc[1];
  const objectType = b >> 11;
  const rateIndex = (b >> 7) & 0xf;
  const channels = (b >> 3) & 0xf;
  if (!RATES[rateIndex] || !channels || channels > 7) return null;
  return { objectType, rateIndex, channels, sampleRate: RATES[rateIndex] };
}

function adtsHeader({ objectType, rateIndex, channels }, frameLen) {
  const len = frameLen + 7;
  const h = Buffer.alloc(7);
  h[0] = 0xff;
  h[1] = 0xf1; // MPEG-4, layer 0, no CRC
  h[2] = ((objectType - 1) << 6) | (rateIndex << 2) | (channels >> 2);
  h[3] = ((channels & 3) << 6) | (len >> 11);
  h[4] = (len >> 3) & 0xff;
  h[5] = ((len & 7) << 5) | 0x1f;
  h[6] = 0xfc;
  return h;
}

function toAdts(data, sizes, asc) {
  const cfg = parseAsc(asc);
  if (!cfg) throw new Error('unusable AudioSpecificConfig');
  const parts = [];
  let p = 0;
  for (const n of sizes) {
    parts.push(adtsHeader(cfg, n), data.subarray(p, p + n));
    p += n;
  }
  return Buffer.concat(parts);
}

module.exports = { parseAsc, toAdts, RATES };
