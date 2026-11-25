/**
 * bd-ma9jiy — one recording out of several MediaRecorder sessions (a recording cut by a kill, then resumed).
 *
 * Every MediaRecorder start writes a whole WebM file: its own EBML header, Segment, Info and Tracks, then Clusters whose
 * Timecodes start again at 0. Bytes simply put one after the other are NOT one recording (a player stops at the second
 * header, or its clock jumps back to 0). So the parts are joined the way a muxer would have written them in one go:
 *
 *   the first part as it is (cut back to its last whole element: a kill can leave half a block)
 *   + each later part from its first Cluster on, every Cluster's Timecode moved on by where the joined audio ends
 *
 * The Clusters' sizes are rewritten too when a browser writes known sizes (Chrome writes "unknown"). Block times inside
 * a Cluster are relative to it, so they never change. The gap between the parts is not audio: it is told separately (the
 * recording's resumes), so the file plays straight through.
 *
 * Pure functions on bytes: no Blob, no DOM, so the tests run them on real Chrome recordings. A part that is not a WebM
 * this code can read is reported (null), and the caller keeps its own fallback.
 */

const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const CLUSTER = 0x1f43b675;
const TRACKS = 0x1654ae6b;
const TIMECODE = 0xe7;
const SIMPLE_BLOCK = 0xa3;
const BLOCK_GROUP = 0xa0;
const BLOCK = 0xa1;
const CODEC_PRIVATE = 0x63a2;
const CODEC_ID = 0x86;
const AUDIO = 0xe1;
const TRACK_ENTRY = 0xae;

type Vint = { value: number; length: number; unknown: boolean };

function readId(b: Uint8Array, p: number): Vint | null {
  if (p >= b.length) return null;
  const first = b[p];
  let length = 1;
  let mask = 0x80;
  while (length <= 4 && !(first & mask)) { length += 1; mask >>= 1; }
  if (length > 4 || p + length > b.length) return null;
  let value = 0;
  for (let i = 0; i < length; i += 1) value = value * 256 + b[p + i];
  return { value, length, unknown: false };
}

function readSize(b: Uint8Array, p: number): Vint | null {
  if (p >= b.length) return null;
  const first = b[p];
  let length = 1;
  let mask = 0x80;
  while (length <= 8 && !(first & mask)) { length += 1; mask >>= 1; }
  if (length > 8 || p + length > b.length) return null;
  let value = first & (mask - 1);
  let allOnes = value === mask - 1;
  for (let i = 1; i < length; i += 1) {
    value = value * 256 + b[p + i];
    if (b[p + i] !== 0xff) allOnes = false;
  }
  return { value, length, unknown: allOnes };
}

type El = { id: number; start: number; dataStart: number; end: number; unknown: boolean };

/** The element at p; an unknown size runs to `limit` (the caller narrows it). Null when it does not fit in the bytes. */
function readEl(b: Uint8Array, p: number, limit: number): El | null {
  const id = readId(b, p);
  if (!id) return null;
  const size = readSize(b, p + id.length);
  if (!size) return null;
  const dataStart = p + id.length + size.length;
  const end = size.unknown ? limit : dataStart + size.value;
  if (end > limit || dataStart > limit) return null;
  return { id: id.value, start: p, dataStart, end, unknown: size.unknown };
}

function readUint(b: Uint8Array, p: number, n: number): number {
  let v = 0;
  for (let i = 0; i < n; i += 1) v = v * 256 + b[p + i];
  return v;
}

/** True when these bytes start a WebM file (a new MediaRecorder session's first chunk). */
export function startsWebm(b: Uint8Array): boolean {
  return b.length >= 4 && readUint(b, 0, 4) === EBML;
}

type Cluster = { start: number; end: number; timecode: number; tcStart: number; tcEnd: number; lastBlockEnd: number; lastRel: number | null; frameMs: number | null };

type Parsed = {
  /** Where the first Cluster starts (everything before it is the header: EBML, Segment, Info, Tracks). */
  firstCluster: number;
  clusters: Cluster[];
  /** CodecID + CodecPrivate + Audio settings: two parts join only when these match. */
  trackKey: string;
};

function hex(b: Uint8Array, from: number, to: number): string {
  let s = "";
  for (let i = from; i < to; i += 1) s += b[i].toString(16).padStart(2, "0");
  return s;
}

function trackKeyOf(b: Uint8Array, tracks: El): string {
  const keys: string[] = [];
  let p = tracks.dataStart;
  while (p < tracks.end) {
    const entry = readEl(b, p, tracks.end);
    if (!entry) break;
    if (entry.id === TRACK_ENTRY) {
      let q = entry.dataStart;
      while (q < entry.end) {
        const el = readEl(b, q, entry.end);
        if (!el) break;
        if (el.id === CODEC_ID || el.id === CODEC_PRIVATE || el.id === AUDIO) keys.push(`${el.id.toString(16)}:${hex(b, el.dataStart, el.end)}`);
        q = el.end;
      }
    }
    p = entry.end;
  }
  return keys.join("|");
}

/** Block times inside one Cluster: where its last whole block ends, its relative time, and the frame length seen. */
function readCluster(b: Uint8Array, start: number, dataStart: number, limit: number): Cluster | null {
  let p = dataStart;
  let timecode: number | null = null;
  let tcStart = -1;
  let tcEnd = -1;
  let lastBlockEnd = dataStart;
  let lastRel: number | null = null;
  let prevRel: number | null = null;
  while (p < limit) {
    const id = readId(b, p);
    if (!id) break;
    // An unknown-size Cluster ends where the next Cluster (or a new file) begins.
    if (id.value === CLUSTER || id.value === EBML || id.value === SEGMENT) break;
    const el = readEl(b, p, limit);
    if (!el || el.unknown) break; // half an element at the end (a kill): stop at the last whole one
    if (el.id === TIMECODE) { timecode = readUint(b, el.dataStart, el.end - el.dataStart); tcStart = el.start; tcEnd = el.end; }
    if (el.id === SIMPLE_BLOCK || el.id === BLOCK_GROUP) {
      let blockAt = el.dataStart;
      if (el.id === BLOCK_GROUP) {
        const inner = readEl(b, el.dataStart, el.end);
        blockAt = inner && inner.id === BLOCK ? inner.dataStart : -1;
      }
      if (blockAt >= 0) {
        const track = readSize(b, blockAt);
        if (track && blockAt + track.length + 2 <= el.end) {
          const raw = (b[blockAt + track.length] << 8) | b[blockAt + track.length + 1];
          const rel = raw > 0x7fff ? raw - 0x10000 : raw;
          prevRel = lastRel;
          lastRel = rel;
        }
      }
      lastBlockEnd = el.end;
    }
    p = el.end;
  }
  if (timecode == null) return null;
  const frameMs = lastRel != null && prevRel != null && lastRel > prevRel ? lastRel - prevRel : null;
  return { start, end: Math.max(lastBlockEnd, tcEnd), timecode, tcStart, tcEnd, lastBlockEnd, lastRel, frameMs };
}

function parse(b: Uint8Array): Parsed | null {
  if (!startsWebm(b)) return null;
  const header = readEl(b, 0, b.length);
  if (!header) return null;
  const segment = readEl(b, header.end, b.length);
  if (!segment || segment.id !== SEGMENT) return null;
  const limit = segment.unknown ? b.length : Math.min(segment.end, b.length);
  let p = segment.dataStart;
  let firstCluster = -1;
  let trackKey = "";
  const clusters: Cluster[] = [];
  while (p < limit) {
    const id = readId(b, p);
    if (!id) break;
    if (id.value === CLUSTER) {
      const size = readSize(b, p + id.length);
      if (!size) break;
      const dataStart = p + id.length + size.length;
      const known = size.unknown ? limit : Math.min(dataStart + size.value, limit);
      const c = readCluster(b, p, dataStart, known);
      if (!c) break;
      if (firstCluster < 0) firstCluster = p;
      clusters.push(c);
      // Known size: jump to its end. Unknown: the next Cluster starts where this one's blocks stopped.
      const next = size.unknown ? c.end : known;
      if (next <= p) break;
      p = next;
      if (size.unknown && c.end < limit) {
        const after = readId(b, c.end);
        if (!after || after.value !== CLUSTER) break; // half a block, or a stray header: the recording ends here
      }
      continue;
    }
    const el = readEl(b, p, limit);
    if (!el || el.unknown) break;
    if (el.id === TRACKS) trackKey = trackKeyOf(b, el);
    p = el.end;
  }
  if (firstCluster < 0 || !clusters.length) return null;
  return { firstCluster, clusters, trackKey };
}

/** The 8-byte EBML size for n (always 8 bytes, so a rewritten header's length is known in advance). */
function size8(n: number): Uint8Array {
  const out = new Uint8Array(8);
  out[0] = 0x01;
  let v = n;
  for (let i = 7; i >= 1; i -= 1) { out[i] = v % 256; v = Math.floor(v / 256); }
  return out;
}

function uintBytes(n: number): Uint8Array {
  const bytes: number[] = [];
  let v = Math.max(0, Math.floor(n));
  do { bytes.unshift(v % 256); v = Math.floor(v / 256); } while (v > 0);
  return Uint8Array.from(bytes);
}

/** Where a part's audio ends, in its own clock (ms): its last block's time plus one frame. */
function endMs(p: Parsed): number {
  const last = p.clusters[p.clusters.length - 1];
  const frames = p.clusters.map((c) => c.frameMs).filter((f): f is number => f != null);
  const frame = frames.length ? frames[frames.length - 1] : 20;
  return last.timecode + (last.lastRel ?? 0) + frame;
}

export type JoinResult = {
  bytes: Uint8Array;
  /** Where each part starts in the joined audio (ms), the first at 0. */
  partStartsMs: number[];
  /** Length of the joined audio as the blocks say (ms). */
  durationMs: number;
};

export type JoinRefusal = { error: "not_webm" | "tracks_differ"; part: number };

/**
 * Join parts recorded one after the other into one WebM. Clusters whose element ends past the bytes (a kill mid-write)
 * are cut. A part with no audio is skipped. Refused (not joined) when a part is not a readable WebM or its codec
 * settings differ from the first part's: the caller then keeps the parts as they are.
 */
export function joinWebmParts(parts: Uint8Array[]): JoinResult | JoinRefusal {
  const parsed: Parsed[] = [];
  const kept: Uint8Array[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const p = parse(parts[i]);
    if (!p) {
      if (parts[i].length < 200 && i > 0) continue; // a part that stopped before its first audio
      return { error: "not_webm", part: i };
    }
    if (parsed.length && p.trackKey !== parsed[0].trackKey) return { error: "tracks_differ", part: i };
    parsed.push(p);
    kept.push(parts[i]);
  }
  if (!parsed.length) return { error: "not_webm", part: 0 };

  const out: Uint8Array[] = [];
  const first = parsed[0];
  const firstLast = first.clusters[first.clusters.length - 1];
  out.push(kept[0].subarray(0, firstLast.end));
  const partStartsMs = [0];
  let offset = endMs(first);

  for (let i = 1; i < parsed.length; i += 1) {
    const p = parsed[i];
    const b = kept[i];
    partStartsMs.push(offset);
    for (const c of p.clusters) {
      const tcData = uintBytes(c.timecode + offset);
      const tc = new Uint8Array(2 + tcData.length);
      tc[0] = TIMECODE;
      tc[1] = 0x80 | tcData.length;
      tc.set(tcData, 2);
      // Cluster ID (4 bytes), its size, then the body: [anything before the Timecode] Timecode [the blocks].
      const clusterSize = readSize(b, c.start + 4);
      const bodyStart = c.start + 4 + (clusterSize ? clusterSize.length : 1);
      const before = b.subarray(bodyStart, c.tcStart);
      const after = b.subarray(c.tcEnd, c.end);
      const bodyLength = before.length + tc.length + after.length;
      // An 8-byte size: unknown stays unknown (Chrome), a known one becomes the new body's length.
      const sizeField = new Uint8Array(8);
      if (!clusterSize || clusterSize.unknown) { sizeField[0] = 0x01; sizeField.fill(0xff, 1); } else sizeField.set(size8(bodyLength));
      out.push(b.subarray(c.start, c.start + 4), sizeField, before, tc, after);
    }
    offset += endMs(p);
  }

  let total = 0;
  for (const o of out) total += o.length;
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const o of out) { bytes.set(o, at); at += o.length; }
  return { bytes, partStartsMs, durationMs: offset };
}

/** Split a recording's chunks (in order) into the MediaRecorder sessions they came from: each session's first chunk is a new file. */
export function splitParts(chunks: Uint8Array[]): Uint8Array[][] {
  const parts: Uint8Array[][] = [];
  for (const c of chunks) {
    if (!parts.length || startsWebm(c)) parts.push([c]);
    else parts[parts.length - 1].push(c);
  }
  return parts;
}

export function concatBytes(list: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of list) total += c.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of list) { out.set(c, at); at += c.length; }
  return out;
}

/** A Blob's bytes: Blob.arrayBuffer where the browser has it, else FileReader (older WebViews, jsdom). */
export async function bytesOf(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === "function") {
    try { return new Uint8Array(await blob.arrayBuffer()); } catch { /* FileReader below */ }
  }
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });
}

/**
 * The Blob of a recording kept so far (`prior`, itself perhaps already joined) followed by a new session's chunks, as ONE
 * WebM. Not a WebM, or a join the code cannot make: the bytes in order (as before Resume existed).
 */
export async function joinBlobs(prior: Blob, next: Blob[], type: string): Promise<Blob> {
  if (!next.length) return prior;
  try {
    const a = await bytesOf(prior);
    const b = concatBytes(await Promise.all(next.map(bytesOf)));
    const r = joinWebmParts([a, b]);
    if (!("error" in r)) return new Blob([r.bytes], { type });
  } catch { /* in order, below */ }
  return new Blob([prior, ...next], { type });
}
