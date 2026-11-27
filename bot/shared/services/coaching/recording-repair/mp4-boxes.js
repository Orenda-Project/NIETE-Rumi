'use strict';
/**
 * bd-8sr958 — read the top-level boxes of an MP4/M4A the way a damaged one needs: tolerant. A box whose size is 0 runs
 * to the end of the file; a size that runs past the end (or is junk like '????') is clamped, and `overrun` says so.
 * Only the first 16 bytes of a box are read, so the same walk works on a Blob.slice in the portal (see the portal's
 * inspectRecording, which mirrors this).
 */

const KNOWN_BRANDS = /^(M4A |M4B |mp42|isom|iso2|mp41|3gp\d|MSNV|avc1|qt  )/;

function walkTopLevel(buf) {
  const boxes = [];
  let o = 0;
  while (o + 8 <= buf.length) {
    let size = buf.readUInt32BE(o);
    const type = buf.toString('latin1', o + 4, o + 8);
    if (!/^[\x20-\x7e]{4}$/.test(type)) break;
    let hdr = 8;
    if (size === 1) {
      if (o + 16 > buf.length) break;
      size = Number(buf.readBigUInt64BE(o + 8));
      hdr = 16;
    }
    let overrun = false;
    if (size === 0 || size < hdr) { size = buf.length - o; overrun = true; }
    if (o + size > buf.length) { size = buf.length - o; overrun = true; }
    boxes.push({ type, start: o, hdr, size, end: o + size, overrun });
    o += size;
  }
  return boxes;
}

function isMp4Family(buf) {
  return buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp';
}

/** The recorder's signature: ftyp brand + the size of the `free` box + (when present) the Android version tag. */
function signatureOf(buf, boxes) {
  const ftyp = boxes.find((b) => b.type === 'ftyp');
  const brand = ftyp ? buf.toString('latin1', ftyp.start + 8, ftyp.start + 12) : '????';
  const free = boxes.find((b) => b.type === 'free');
  const head = buf.toString('latin1', 0, Math.min(buf.length, 4096));
  const android = head.match(/com\.android\.version[^0-9]{0,8}(\d+)/);
  return `M4A ${brand.trim()} free=${free ? free.size : 0}${android ? ` android=${android[1]}` : ''}`.replace(/^M4A /, 'M4A ');
}

module.exports = { walkTopLevel, isMp4Family, signatureOf, KNOWN_BRANDS };
