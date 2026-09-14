/**
 * bd-8s2xb (T8) — `encodeForScorer` downscales before base64-encoding.
 *
 * `sharp` is a bot-only dependency (root tests run before `bot/ npm ci`), so the library
 * is injected and driven with a chain recorder. What is asserted is the exact resize
 * contract the scoring call relies on: EXIF rotate, 768px on the long edge, no upscale,
 * JPEG q80, and that the returned base64 is the RESIZED bytes, not the original.
 */
const { encodeForScorer } = require('../../bot/shared/services/coaching/classroom-photo/scorer-image');

function fakeSharp(outBytes = 'SMALL') {
  const calls = [];
  const lib = (input) => {
    calls.push(['input', input.length]);
    const chain = {
      rotate: () => { calls.push(['rotate']); return chain; },
      resize: (o) => { calls.push(['resize', o]); return chain; },
      jpeg: (o) => { calls.push(['jpeg', o]); return chain; },
      toBuffer: () => Promise.resolve(Buffer.from(outBytes)),
    };
    return chain;
  };
  return { lib, calls };
}

describe('bd-8s2xb — encodeForScorer', () => {
  test('T8: rotate → resize 768 inside, no enlargement → jpeg q80 → base64 of the resized bytes', async () => {
    const { lib, calls } = fakeSharp('SMALL');
    const out = await encodeForScorer(Buffer.alloc(3_000_000, 1), { sharpLib: lib });
    expect(calls.map((c) => c[0])).toEqual(['input', 'rotate', 'resize', 'jpeg']);
    expect(calls[2][1]).toEqual({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true });
    expect(calls[3][1]).toEqual({ quality: 80 });
    expect(out.mime).toBe('image/jpeg');
    expect(Buffer.from(out.base64, 'base64').toString()).toBe('SMALL');
    expect(out.bytes).toBe(5);
  });

  test('T8b: a broken library rejects (caller degrades) — never returns the original bytes as if resized', async () => {
    const lib = () => ({ rotate() { throw new Error('sharp boom'); } });
    await expect(encodeForScorer(Buffer.from('ORIG'), { sharpLib: lib })).rejects.toThrow('sharp boom');
  });
});
