// Intrinsic pixel dimensions of a JPEG / PNG / GIF / WebP buffer, and the MIME
// type — enough to compute an aspect ratio without pulling in a dependency.
// Returns null when the format is not recognised (the caller then needs an
// explicit `aspect` in the spec).

function pngSize(b) {
  if (b.length < 24) return null;
  if (b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), mime: "image/png" };
}

function gifSize(b) {
  if (b.length < 10 || b.toString("latin1", 0, 3) !== "GIF") return null;
  return { w: b.readUInt16LE(6), h: b.readUInt16LE(8), mime: "image/gif" };
}

function jpegSize(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i < b.length - 9) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    // SOF0..SOF15, excluding DHT(c4) DAC(c8) and the RSTn/DNL markers
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7), mime: "image/jpeg" };
    }
    const len = b.readUInt16BE(i + 2);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

function webpSize(b) {
  if (b.length < 30) return null;
  if (b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WEBP") return null;
  const fmt = b.toString("latin1", 12, 16);
  if (fmt === "VP8X") return { w: (b.readUIntLE(24, 3) & 0xffffff) + 1, h: (b.readUIntLE(27, 3) & 0xffffff) + 1, mime: "image/webp" };
  if (fmt === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff, mime: "image/webp" };
  if (fmt === "VP8L") {
    const bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1, mime: "image/webp" };
  }
  return null;
}

function imageSize(buf) {
  return pngSize(buf) || jpegSize(buf) || gifSize(buf) || webpSize(buf) || null;
}

module.exports = { imageSize };
