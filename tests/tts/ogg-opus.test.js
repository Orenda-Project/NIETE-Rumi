'use strict';

/**
 * The Ogg Opus toolkit behind the text-to-speech gateway.
 *
 * A synthesised voice note reaches us as an Ogg Opus stream over HTTP. Before it goes out as a
 * WhatsApp voice message, the gateway needs three answers that only the audio bytes can give:
 *   1. Is the stream whole? A vendor stream can be cut mid-body and still arrive with a 200, and
 *      the vendor ends audio at two minutes without an error. Only the Ogg framing (every page
 *      intact, the last one flagged end-of-stream) tells a whole stream from a cut one.
 *   2. How long is it? The two-minute ceiling and the too-short-for-this-text check both use it.
 *   3. Can several clips become ONE logical stream? Long notes are synthesised as parallel parts,
 *      and the recipient must get a single voice message with the right duration.
 *
 * The fixtures are real vendor output plus one clip muxed by ffmpeg/libopus, so the parser is
 * checked against page layouts it did not write. The cut fixture is the first two thirds of a real
 * clip's bytes: a stream that stopped in the middle of a page.
 *
 * Durations: ffprobe reports finalGranule / 48000, which counts the 312 pre-skip samples that the
 * decoder discards. The playable length is (finalGranule - preSkip) / 48000, which is exactly what
 * ffmpeg decodes (the 1 s sine decodes to 48000 samples, not 48312). So every duration expected
 * below is the ffprobe figure minus 312 / 48000 (6.5 ms).
 */

const fs = require('fs');
const path = require('path');

const {
  OggOpusError,
  parseOggOpus,
  checkComplete,
  durationSec,
  concatOggOpus,
  createEndWatcher,
  _internals,
} = require('../../bot/shared/services/tts/ogg-opus');

const fixture = (name) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'tts', name));

const UR_A = fixture('soniox-ishita-ur-a.ogg');
const UR_B = fixture('soniox-ishita-ur-b.ogg');
const EN_A = fixture('soniox-grace-en-a.ogg');
const SINE = fixture('libopus-sine-1s.ogg');
const UR_A_CUT = fixture('soniox-ishita-ur-a.cut.ogg');

const RATE = 48000;
const PRE_SKIP = 312;
const CONTINUED = 0x01;
const BOS = 0x02;
const EOS = 0x04;

// name, bytes, ffprobe duration (s), audio packets, granule of the last page
const FIXTURES = [
  ['soniox-ishita-ur-a.ogg', UR_A, 1.7265, 87, 82872],
  ['soniox-ishita-ur-b.ogg', UR_B, 1.5465, 78, 74232],
  ['soniox-grace-en-a.ogg', EN_A, 1.6465, 83, 79032],
  ['libopus-sine-1s.ogg', SINE, 1.0065, 51, 48312],
];

const RANDOM = Buffer.from(Array.from({ length: 512 }, (_, i) => (i * 131 + 7) % 251));
const MP3 = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([4, 0, 0, 0, 0, 0x0a]), Buffer.alloc(64, 0xff)]);

const playable = (ffprobeSec) => ffprobeSec - PRE_SKIP / RATE;
const sumSamples = (packets) => packets.reduce((sum, p) => sum + p.samples, 0);

// Page headers read straight from the bytes, with no CRC check, so that the structural assertions
// below do not depend on the parser they are testing.
function listPages(buf) {
  const pages = [];
  let offset = 0;
  while (offset + 27 <= buf.length && buf.toString('latin1', offset, offset + 4) === 'OggS') {
    const segments = buf[offset + 26];
    const lacing = [...buf.subarray(offset + 27, offset + 27 + segments)];
    const length = 27 + segments + lacing.reduce((a, b) => a + b, 0);
    if (offset + length > buf.length) break;
    pages.push({
      offset,
      length,
      flags: buf[offset + 5],
      granule: Number(buf.readBigInt64LE(offset + 6)),
      serial: buf.readUInt32LE(offset + 14),
      seq: buf.readUInt32LE(offset + 18),
      lacing,
      bodyOffset: offset + 27 + segments,
    });
    offset += length;
  }
  return pages;
}

// Every packet, rebuilt from the lacing values and joined across pages. Also independent of the
// parser: it is how the concat output is compared with its inputs.
function packetsOf(buf) {
  const packets = [];
  let pending = [];
  for (const page of listPages(buf)) {
    let at = page.bodyOffset;
    for (const lace of page.lacing) {
      pending.push(buf.subarray(at, at + lace));
      at += lace;
      if (lace < 255) {
        packets.push(Buffer.concat(pending));
        pending = [];
      }
    }
  }
  return packets;
}

// Index of the first packet that differs between two lists of Buffers, or -1 when they match.
// (A boolean-ish answer on purpose: a failing toEqual on 70 kB buffers prints the whole buffer.)
function firstDifference(actual, expected) {
  const n = Math.max(actual.length, expected.length);
  for (let i = 0; i < n; i += 1) {
    if (!actual[i] || !expected[i] || !actual[i].equals(expected[i])) return i;
  }
  return -1;
}

// Re-seals a page after a test has edited its bytes. The module's CRC is trusted here because the
// 'Ogg CRC-32' tests below prove it reproduces the CRCs two independent muxers wrote.
function reseal(buf, page) {
  buf.writeUInt32LE(0, page.offset + 22);
  buf.writeUInt32LE(_internals.crc32(buf.subarray(page.offset, page.offset + page.length)), page.offset + 22);
}

// A copy of a clip whose OpusHead claims a different channel count (byte 9 of the head packet).
function withChannels(buf, channels) {
  const copy = Buffer.from(buf);
  const first = listPages(copy)[0];
  copy[first.bodyOffset + 9] = channels;
  reseal(copy, first);
  return copy;
}

// The OggOpusError code a call throws, or a label saying what happened instead.
function errorCode(fn) {
  try {
    fn();
  } catch (err) {
    return err instanceof OggOpusError ? err.code : `${err.name}: ${err.message}`;
  }
  return 'did not throw';
}

const UR_A_PAGES = listPages(UR_A);
const HEAD = UR_A.subarray(UR_A_PAGES[0].bodyOffset, UR_A_PAGES[0].offset + UR_A_PAGES[0].length);
const TAGS = UR_A.subarray(UR_A_PAGES[1].bodyOffset, UR_A_PAGES[1].offset + UR_A_PAGES[1].length);

function buildPage({ flags, granule, serial, seq, lacing, body }) {
  const header = Buffer.alloc(27 + lacing.length);
  header.write('OggS', 0, 'latin1');
  header[5] = flags;
  header.writeBigInt64LE(BigInt(granule), 6);
  header.writeUInt32LE(serial, 14);
  header.writeUInt32LE(seq, 18);
  header[26] = lacing.length;
  lacing.forEach((value, i) => { header[27 + i] = value; });
  const page = Buffer.concat([header, ...body]);
  page.writeUInt32LE(_internals.crc32(page), 22);
  return page;
}

// A minimal Ogg Opus muxer for layouts no fixture has: packets split across pages, 2.5 ms packets,
// a packet longer than a whole page. It laces every audio packet into one run of segments and cuts
// the run into pages of at most `perPage` segments, as libogg does. `finalGranule` overrides the
// last page's granule (to model an end trim).
function muxOpus({ packets, perPage = 255, finalGranule, serial = 0x0badcafe }) {
  const pages = [
    buildPage({ flags: BOS, granule: 0, serial, seq: 0, lacing: [HEAD.length], body: [HEAD] }),
    buildPage({ flags: 0, granule: 0, serial, seq: 1, lacing: [TAGS.length], body: [TAGS] }),
  ];
  const segments = [];
  let decoded = 0;
  for (const { data, samples } of packets) {
    decoded += samples;
    for (let at = 0; ; at += 255) {
      const piece = data.subarray(at, at + 255);
      const ends = piece.length < 255;
      segments.push({ piece, granule: ends ? decoded : null });
      if (ends) break;
    }
  }
  for (let i = 0; i < segments.length; i += perPage) {
    const run = segments.slice(i, i + perPage);
    const last = i + perPage >= segments.length;
    const ended = run.filter((s) => s.granule !== null);
    const granule = last && finalGranule !== undefined
      ? finalGranule
      : (ended.length ? ended[ended.length - 1].granule : -1);
    pages.push(buildPage({
      flags: (i > 0 && segments[i - 1].granule === null ? CONTINUED : 0) | (last ? EOS : 0),
      granule,
      serial,
      seq: pages.length,
      lacing: run.map((s) => s.piece.length),
      body: run.map((s) => s.piece),
    }));
  }
  return Buffer.concat(pages);
}

// Packets that are only real Opus in their first byte: the TOC byte, which fixes the sample count.
// The rest is a pattern unique to each packet, so a reordered or mangled packet cannot compare
// equal. Good for testing the Ogg layer; not decodable audio.
function fakePackets(count, { toc = 0xf8, samples = 960, bytes = 40 } = {}) {
  return Array.from({ length: count }, (_, n) => {
    const data = Buffer.alloc(bytes, n & 0xff);
    data[0] = toc;
    data.writeUInt16LE(n, 1);
    return { data, samples };
  });
}

describe('Ogg CRC-32', () => {
  it('matches the published check value for poly 0x04C11DB7, init 0, no reflection, no final xor', () => {
    // CRC-32/CKSUM is the same CRC plus a final xor with 0xFFFFFFFF; its check value for
    // "123456789" is 0x765E7680, so without the xor it is 0x89A1897F.
    expect(_internals.crc32(Buffer.from('123456789', 'latin1'))).toBe(0x89a1897f);
  });

  it.each(FIXTURES)('reproduces the CRC the muxer wrote on every page of %s', (name, bytes) => {
    for (const page of listPages(bytes)) {
      const copy = Buffer.from(bytes.subarray(page.offset, page.offset + page.length));
      const stored = copy.readUInt32LE(22);
      copy.writeUInt32LE(0, 22);
      expect(_internals.crc32(copy)).toBe(stored);
    }
  });
});

describe('parseOggOpus on real clips', () => {
  describe.each(FIXTURES)('%s', (name, bytes, ffprobeSec, packetCount, lastGranule) => {
    it('reads the OpusHead (mono, 312 samples of pre-skip) and both header packets', () => {
      const parsed = parseOggOpus(bytes);
      expect(parsed.serial).toBe(listPages(bytes)[0].serial);
      expect(parsed.channels).toBe(1);
      expect(parsed.preSkip).toBe(PRE_SKIP);
      expect(parsed.inputSampleRate).toBe(48000);
      expect(parsed.head.subarray(0, 8).toString('latin1')).toBe('OpusHead');
      expect(parsed.tags.subarray(0, 8).toString('latin1')).toBe('OpusTags');
    });

    it('reads every audio packet, byte for byte, with its length in samples from the TOC byte', () => {
      const parsed = parseOggOpus(bytes);
      expect(parsed.packets).toHaveLength(packetCount);
      expect(firstDifference(parsed.packets.map((p) => p.data), packetsOf(bytes).slice(2))).toBe(-1);
      // The muxer stamped the first audio page with the samples decoded through its 50th packet.
      // Our TOC arithmetic has to agree with a muxer we did not write.
      expect(sumSamples(parsed.packets.slice(0, 50))).toBe(listPages(bytes)[2].granule);
      // The final granule stops a little short of the last packet's end (the end trim), by less
      // than one 20 ms packet.
      const endTrim = sumSamples(parsed.packets) - parsed.finalGranule;
      expect(endTrim).toBeGreaterThanOrEqual(0);
      expect(endTrim).toBeLessThan(960);
    });

    it('sees a whole stream: EOS on the last page, no trailing bytes', () => {
      const parsed = parseOggOpus(bytes);
      expect(parsed.eos).toBe(true);
      expect(parsed.truncated).toBe(false);
      expect(parsed.finalGranule).toBe(lastGranule);
    });

    it('durationSec is the playable length (the ffprobe figure less the pre-skip), to 1.5 ms', () => {
      expect(Math.abs(durationSec(bytes) - playable(ffprobeSec))).toBeLessThanOrEqual(0.0015);
      expect(checkComplete(bytes)).toEqual({ ok: true, durationSec: durationSec(bytes) });
    });
  });
});

describe('parseOggOpus: packets that continue across pages', () => {
  it('joins a packet split over several pages back into one', () => {
    const packets = fakePackets(5, { bytes: 600 }); // three lacing values each
    const bytes = muxOpus({ packets, perPage: 2 }); // so every packet crosses a page boundary
    const pages = listPages(bytes);
    expect(pages.some((p) => p.flags & CONTINUED)).toBe(true);
    expect(pages.some((p) => p.granule === -1)).toBe(true); // pages on which no packet ends

    const parsed = parseOggOpus(bytes);
    expect(firstDifference(parsed.packets.map((p) => p.data), packets.map((p) => p.data))).toBe(-1);
    expect(parsed.finalGranule).toBe(5 * 960);
    expect(checkComplete(bytes)).toEqual({ ok: true, durationSec: (5 * 960 - PRE_SKIP) / RATE });
  });
});

describe('checkComplete: telling a whole stream from a cut one', () => {
  it('a stream cut mid-page is truncated, and parsing it does not throw', () => {
    expect(checkComplete(UR_A_CUT)).toMatchObject({ ok: false, reason: 'truncated' });

    const parsed = parseOggOpus(UR_A_CUT);
    expect(parsed.truncated).toBe(true);
    expect(parsed.eos).toBe(false); // the last WHOLE page is the first audio page
    expect(parsed.packets).toHaveLength(50); // only packets from whole pages count
    expect(parsed.finalGranule).toBe(48000);
    // ffprobe measures the cut file at 1.0000 s; what arrived plays for 0.9935 s.
    expect(checkComplete(UR_A_CUT).durationSec).toBeCloseTo(playable(1.0), 6);
  });

  it.each(FIXTURES)('%s without its end-of-stream page (cut on a page boundary) is no_eos', (name, bytes) => {
    const cut = bytes.subarray(0, listPages(bytes).at(-1).offset);
    expect(checkComplete(cut)).toMatchObject({ ok: false, reason: 'no_eos' });
    expect(parseOggOpus(cut).truncated).toBe(false);
  });

  it('a stream cut inside its header pages is truncated', () => {
    expect(checkComplete(UR_A.subarray(0, 20))).toEqual({ ok: false, reason: 'truncated' }); // inside the first page header
    expect(checkComplete(UR_A.subarray(0, 60))).toEqual({ ok: false, reason: 'truncated' }); // OpusHead whole, OpusTags cut
    expect(errorCode(() => parseOggOpus(UR_A.subarray(0, 60)))).toBe('truncated');
  });

  it('a stream that stops on a page boundary in the middle of a packet is truncated', () => {
    const bytes = muxOpus({ packets: fakePackets(3, { bytes: 600 }), perPage: 2 });
    // Audio pages hold [255 255] [90 255] [255 90] ...: stop after the second one, whose last
    // packet was still waiting for the rest of its bytes.
    const cut = bytes.subarray(0, listPages(bytes)[4].offset);
    expect(checkComplete(cut)).toMatchObject({ ok: false, reason: 'truncated' });
    expect(parseOggOpus(cut).packets).toHaveLength(1);
  });

  it('a stream with its headers but no audio packets is no_audio, and its duration is 0, not negative', () => {
    const pages = listPages(UR_A);
    const headersOnly = Buffer.from(UR_A.subarray(0, pages[2].offset));
    headersOnly[pages[1].offset + 5] |= EOS;
    reseal(headersOnly, pages[1]);
    expect(checkComplete(headersOnly)).toMatchObject({ ok: false, reason: 'no_audio' });
    expect(durationSec(headersOnly)).toBe(0);
  });

  it('a flipped byte inside an audio page fails that page\'s CRC', () => {
    const tampered = Buffer.from(UR_A);
    tampered[listPages(tampered)[2].bodyOffset + 100] ^= 0x01;
    expect(errorCode(() => parseOggOpus(tampered))).toBe('bad_crc');
    expect(checkComplete(tampered)).toEqual({ ok: false, reason: 'bad_crc' });
  });

  it.each([
    ['random bytes', RANDOM],
    ['an MP3 with an ID3 tag', MP3],
    ['a JSON error body', Buffer.from('{"error":"rate limited"}', 'utf8')],
    ['an empty buffer', Buffer.alloc(0)],
  ])('%s is not_ogg', (label, bytes) => {
    expect(errorCode(() => parseOggOpus(bytes))).toBe('not_ogg');
    expect(errorCode(() => durationSec(bytes))).toBe('not_ogg');
    expect(checkComplete(bytes)).toEqual({ ok: false, reason: 'not_ogg' });
  });

  it('never throws, whatever it is handed', () => {
    for (const input of [undefined, null, 'OggS', 42, {}]) {
      expect(checkComplete(input)).toEqual({ ok: false, reason: 'not_ogg' });
    }
  });

  it('an Ogg stream that is not Opus (first packet is a Vorbis header) is no_opus_head', () => {
    const copy = Buffer.from(UR_A);
    const first = listPages(copy)[0];
    copy.write('\x01vorbis', first.bodyOffset, 'latin1');
    reseal(copy, first);
    expect(errorCode(() => parseOggOpus(copy))).toBe('no_opus_head');
    expect(checkComplete(copy)).toEqual({ ok: false, reason: 'no_opus_head' });
  });

  it('a second packet that is not OpusTags is no_opus_tags', () => {
    const copy = Buffer.from(UR_A);
    const second = listPages(copy)[1];
    copy.write('OpusTagz', second.bodyOffset, 'latin1');
    reseal(copy, second);
    expect(errorCode(() => parseOggOpus(copy))).toBe('no_opus_tags');
    expect(checkComplete(copy)).toEqual({ ok: false, reason: 'no_opus_tags' });
  });

  it('two clips glued byte for byte are two logical streams, not one clip: mismatch', () => {
    expect(errorCode(() => parseOggOpus(Buffer.concat([UR_A, UR_B])))).toBe('mismatch'); // second serial
    expect(checkComplete(Buffer.concat([UR_A, UR_A]))).toEqual({ ok: false, reason: 'mismatch' }); // same serial, second start
  });
});

describe('Opus TOC byte -> samples at 48 kHz', () => {
  it.each([
    ['CELT 20 ms, one frame', [0xf8], 960],
    ['hybrid 20 ms (config 15), one frame', [0x78], 960],
    ['SILK 20 ms (config 1), code 3 with 3 frames', [0x0b, 0x03], 2880],
    ['code 3 counts frames with the VBR and padding bits masked off', [0xfb, 0xc3], 2880],
    ['code 1: two frames', [0xf9], 1920],
    ['code 2: two frames', [0xfa], 1920],
    ['SILK 10 ms', [0x00], 480],
    ['SILK 40 ms', [0x10], 1920],
    ['SILK 60 ms', [0x18], 2880],
    ['hybrid 10 ms', [0x60], 480],
    ['CELT 2.5 ms', [0x80], 120],
    ['CELT 5 ms', [0x88], 240],
    ['CELT 10 ms', [0x90], 480],
    ['an empty packet', [], 0],
  ])('%s', (label, bytes, samples) => {
    expect(_internals.packetSamples(Buffer.from(bytes))).toBe(samples);
  });
});

describe('concatOggOpus: parts become ONE logical Ogg Opus stream', () => {
  it('joins two clips into one whole stream with the right duration', () => {
    const joined = concatOggOpus([UR_A, UR_B]);
    const check = checkComplete(joined);
    expect(check.ok).toBe(true);

    // One logical stream has ONE pre-skip (the first part's) and ONE end trim (the last part's).
    // So part B's 312-sample encoder warm-up (6.5 ms) and part A's 648-sample end padding (13.5 ms)
    // are now played at the join: near-silence, 20 ms per join. In ffprobe's terms, which already
    // count each clip's pre-skip, that is 1.7265 + 1.5465 + 312/48000 s, within half a millisecond.
    expect(Math.abs(check.durationSec - (1.7265 + 1.5465 + PRE_SKIP / RATE))).toBeLessThanOrEqual(0.02);
    const a = parseOggOpus(UR_A);
    const b = parseOggOpus(UR_B);
    expect(check.durationSec).toBe((sumSamples(a.packets) + b.finalGranule - PRE_SKIP) / RATE);
  });

  it('is one logical stream: one serial, pages 0..n-1, BOS on the first page only, EOS on the last only', () => {
    const joined = concatOggOpus([UR_A, UR_B]);
    const pages = listPages(joined);
    expect(pages.reduce((n, p) => n + p.length, 0)).toBe(joined.length); // every byte is in a page
    expect(new Set(pages.map((p) => p.serial)).size).toBe(1);
    expect(pages.map((p) => p.seq)).toEqual(pages.map((_, i) => i));
    expect(pages.filter((p) => p.flags & BOS).map((p) => p.seq)).toEqual([0]);
    expect(pages.filter((p) => p.flags & EOS).map((p) => p.seq)).toEqual([pages.length - 1]);
    for (const page of pages) expect(page.lacing.length).toBeLessThanOrEqual(255);
    expect(parseOggOpus(joined).serial).toBe(pages[0].serial);
  });

  it('carries the first part\'s headers, alone on their pages, then every audio packet of every part in order', () => {
    const a = parseOggOpus(UR_A);
    const b = parseOggOpus(UR_B);
    const joined = concatOggOpus([UR_A, UR_B]);
    const pages = listPages(joined);
    // RFC 7845: the OpusHead is alone on page 0 and the OpusTags ends page 1, both at granule 0.
    expect(pages[0].lacing).toEqual([a.head.length]);
    expect(pages[1].lacing).toEqual([a.tags.length]);
    expect(pages[0].granule).toBe(0);
    expect(pages[1].granule).toBe(0);

    const packets = packetsOf(joined);
    expect(packets[0].equals(a.head)).toBe(true);
    expect(packets[1].equals(a.tags)).toBe(true);
    expect(packets.length - 2).toBe(87 + 78);
    expect(firstDifference(packets.slice(2), [...a.packets, ...b.packets].map((p) => p.data))).toBe(-1);
    expect(parseOggOpus(joined).packets).toHaveLength(87 + 78);
  });

  it('stamps each page with the samples decoded so far (about 1 s per page) and ends on the last part\'s end trim', () => {
    const a = parseOggOpus(UR_A);
    const b = parseOggOpus(UR_B);
    const all = [...a.packets, ...b.packets];
    const pages = listPages(concatOggOpus([UR_A, UR_B]));

    let ended = 0;
    let previous = 0;
    for (const page of pages.slice(2, -1)) {
      ended += page.lacing.filter((v) => v < 255).length; // packets that end on this page
      expect(page.granule).toBe(sumSamples(all.slice(0, ended)));
      expect(page.granule - previous).toBe(RATE); // 50 packets of 20 ms
      previous = page.granule;
    }
    const last = pages[pages.length - 1];
    expect(last.granule).toBe(sumSamples(a.packets) + b.finalGranule);
    expect(last.granule).toBeGreaterThanOrEqual(previous);
  });

  it('joins clips written by different muxers (the vendor and ffmpeg/libopus)', () => {
    const a = parseOggOpus(UR_A);
    const joined = concatOggOpus([UR_A, SINE]);
    expect(checkComplete(joined)).toEqual({ ok: true, durationSec: (sumSamples(a.packets) + 48312 - PRE_SKIP) / RATE });
    expect(parseOggOpus(joined).packets).toHaveLength(87 + 51);
  });

  it('joins three parts', () => {
    const [a, b, c] = [UR_A, UR_B, EN_A].map(parseOggOpus);
    const joined = concatOggOpus([UR_A, UR_B, EN_A]);
    const check = checkComplete(joined);
    expect(check.ok).toBe(true);
    expect(check.durationSec).toBe((sumSamples(a.packets) + sumSamples(b.packets) + c.finalGranule - PRE_SKIP) / RATE);
    expect(firstDifference(packetsOf(joined).slice(2), [...a.packets, ...b.packets, ...c.packets].map((p) => p.data))).toBe(-1);
  });

  it('returns a single part unchanged', () => {
    expect(concatOggOpus([UR_A])).toBe(UR_A);
  });

  it('refuses any part that is not whole, with the reason checkComplete gives', () => {
    expect(errorCode(() => concatOggOpus([UR_A, UR_A_CUT]))).toBe('truncated');
    expect(errorCode(() => concatOggOpus([UR_A_CUT]))).toBe('truncated'); // even on its own
    expect(errorCode(() => concatOggOpus([UR_A, MP3]))).toBe('not_ogg');
    expect(errorCode(() => concatOggOpus([UR_A, UR_B.subarray(0, listPages(UR_B).at(-1).offset)]))).toBe('no_eos');
  });

  it('refuses parts with different channel counts: mismatch', () => {
    const stereoB = withChannels(UR_B, 2);
    expect(parseOggOpus(stereoB).channels).toBe(2); // the patched copy is itself a valid stream
    expect(errorCode(() => concatOggOpus([UR_A, stereoB]))).toBe('mismatch');
  });

  it('refuses an empty list', () => {
    expect(errorCode(() => concatOggOpus([]))).toBe('no_audio');
  });

  it('starts a new page when the 255 lacing values run out before 1 s of audio', () => {
    // 2.5 ms packets: a second of them is 400 packets, more than one page can lace.
    const tiny = fakePackets(600, { toc: 0x80, samples: 120, bytes: 20 });
    const joined = concatOggOpus([muxOpus({ packets: tiny }), UR_A]);
    for (const page of listPages(joined)) expect(page.lacing.length).toBeLessThanOrEqual(255);
    expect(checkComplete(joined).ok).toBe(true);
    const expected = [...tiny.map((p) => p.data), ...parseOggOpus(UR_A).packets.map((p) => p.data)];
    expect(firstDifference(packetsOf(joined).slice(2), expected)).toBe(-1);
  });

  it('continues a packet longer than a whole page onto the next page', () => {
    // 70,000 bytes needs 275 lacing values; a page holds 255. Not a real Opus size (the codec tops
    // out near 61 kB), but the writer must not produce a broken page if it ever meets one.
    const packets = [...fakePackets(3), ...fakePackets(1, { bytes: 70000 }), ...fakePackets(2)];
    const joined = concatOggOpus([UR_A, muxOpus({ packets })]);
    const pages = listPages(joined);
    for (const page of pages) expect(page.lacing.length).toBeLessThanOrEqual(255);
    expect(pages.some((p) => p.flags & CONTINUED)).toBe(true);
    expect(pages.some((p) => p.granule === -1)).toBe(true); // the page the big packet fills ends none
    expect(checkComplete(joined).ok).toBe(true);
    const expected = [...parseOggOpus(UR_A).packets.map((p) => p.data), ...packets.map((p) => p.data)];
    expect(firstDifference(packetsOf(joined).slice(2), expected)).toBe(-1);
    expect(firstDifference(parseOggOpus(joined).packets.map((p) => p.data), expected)).toBe(-1);
  });

  it('never lets the final granule run backwards or past the audio: falls back to the plain sample count', () => {
    const one = muxOpus({ packets: fakePackets(1) }); // 960 samples
    // A last part whose final granule claims to trim almost all of its 60 packets: 960 + 100 would
    // put the last page behind the page before it (48000).
    const overTrimmed = concatOggOpus([one, muxOpus({ packets: fakePackets(60), finalGranule: 100 })]);
    let pages = listPages(overTrimmed);
    expect(pages.at(-2).granule).toBe(RATE);
    expect(pages.at(-1).granule).toBe(61 * 960);

    // And one that claims more samples than its packets hold.
    const overLong = concatOggOpus([one, muxOpus({ packets: fakePackets(60), finalGranule: 10 ** 7 })]);
    pages = listPages(overLong);
    expect(pages.at(-1).granule).toBe(61 * 960);
  });
});

describe('createEndWatcher: knowing a streamed clip is whole before the response closes', () => {
  // Soniox sometimes sends every byte of a clip and never closes the response (30 Sep, 6 of 100
  // Urdu requests), so the provider has to see the end-of-stream page arrive on its own.
  const feed = (bytes, sizes) => {
    const w = createEndWatcher();
    let at = 0; let endedAt = null; let i = 0;
    while (at < bytes.length) {
      const n = sizes[i % sizes.length]; i += 1;
      const ended = w.push(bytes.subarray(at, at + n));
      at += n;
      if (ended && endedAt === null) endedAt = Math.min(at, bytes.length);
    }
    return { w, endedAt };
  };

  it.each(FIXTURES.map(([name, bytes]) => [name, bytes]))('%s: ends exactly when its last byte arrives, whatever the chunking', (name, bytes) => {
    for (const sizes of [[1], [7, 13, 2], [4096], [bytes.length]]) {
      const { w, endedAt } = feed(bytes, sizes);
      expect(endedAt).toBe(bytes.length);
      expect(w.ended).toBe(true);
      expect(w.buffer().equals(bytes)).toBe(true);
    }
  });

  it('a cut clip never ends', () => {
    const { w, endedAt } = feed(UR_A_CUT, [512]);
    expect(endedAt).toBeNull();
    expect(w.ended).toBe(false);
    expect(w.buffer().equals(UR_A_CUT)).toBe(true);
  });

  it('bytes that are not Ogg pages never end (the full check then decides)', () => {
    for (const junk of [RANDOM, MP3, Buffer.from('{"error_type":"x"}')]) {
      expect(feed(junk, [5]).endedAt).toBeNull();
    }
  });

  it('what it saw end is also what checkComplete calls whole', () => {
    const { w } = feed(UR_A, [333]);
    expect(checkComplete(w.buffer()).ok).toBe(true);
  });
});
