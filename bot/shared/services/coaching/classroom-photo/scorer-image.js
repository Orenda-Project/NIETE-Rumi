/**
 * bd-8s2xb — encode a classroom photo for the SCORING call.
 *
 * The scorer receives the photo as a low-detail image part, so a phone-camera JPEG
 * (2–5 MB, 3000+ px) is downscaled first: EXIF-rotated, 768 px on the long edge,
 * never enlarged, JPEG q80 → ~60–150 KB. `sharp` is a bot-only dependency and is
 * required lazily (root test suites run before `bot/ npm ci`); tests inject a fake
 * via `sharpLib`. Throws on failure — the caller degrades (skips the photo), it does
 * not fall back to sending the original bytes.
 *
 * @param {Buffer} buf - original image bytes
 * @param {{ sharpLib?: Function, maxEdge?: number, quality?: number }} [opts]
 * @returns {Promise<{ mime: string, base64: string, bytes: number }>}
 */
async function encodeForScorer(buf, opts = {}) {
  const sharp = opts.sharpLib || require('sharp');
  const maxEdge = opts.maxEdge || 768;
  const small = await sharp(buf)
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: opts.quality || 80 })
    .toBuffer();
  return { mime: 'image/jpeg', base64: small.toString('base64'), bytes: small.length };
}

module.exports = { encodeForScorer };
