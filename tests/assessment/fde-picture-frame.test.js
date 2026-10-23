/**
 * A picture with a grey frame never prints (bd-5jmnfj.4.36), and a plain object
 * carries no face (bd-5jmnfj.4.37).
 *
 * v17: the cached sock on G1 English Q4 iv came back inside a light grey square
 * (a third of its outer 3px ring grey, darkest 160); the 47 other pictures have a
 * white ring. The cached egg on G1 English Q7 ix and G2 Urdu Q5 iv has a curve
 * that reads like a smile.
 */

const Pictures = require('../../bot/shared/services/assessment/fde-pictures');
const Kie = require('../../bot/shared/services/assessment/fde-picture-kie');

/** A w x w grey image, white inside, with an optional grey ring `ring` px wide and a black line touching one edge. */
function image({ w = 40, ring = 0, ringValue = 160, edgeLine = 0 } = {}) {
  const data = new Uint8Array(w * w).fill(255);
  for (let y = 0; y < w; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const edge = Math.min(x, y, w - 1 - x, w - 1 - y);
      if (edge < ring) data[y * w + x] = ringValue;
    }
  }
  for (let x = 0; x < edgeLine; x += 1) data[(w - 1) * w + x] = 0;
  return { data, width: w, height: w };
}

describe('framed', () => {
  test('a grey ring round the picture is a frame', () => {
    expect(Pictures.framed(image({ ring: 3 }))).toBe(true);
  });

  test('a white ring is not', () => {
    expect(Pictures.framed(image())).toBe(false);
  });

  test('a ground line in a scene that touches the edge is not a frame', () => {
    expect(Pictures.framed(image({ edgeLine: 3 }))).toBe(false);
  });
});

function deps({ cached = {}, frames = [] } = {}) {
  const store = { ...cached };
  const queue = [...frames]; // one entry per drawing: true = it comes back framed
  const calls = { generate: [], upload: [] };
  return {
    calls,
    d: {
      headObject: async (key) => ({ exists: key in store }),
      downloadFromR2: async (key) => store[key],
      uploadBuffer: async (buf, key) => { calls.upload.push(key); store[key] = buf; },
      generateImage: async (prompt) => { calls.generate.push(prompt); return Buffer.from(queue.shift() ? 'framed' : 'clean'); },
      shrink: async (buf) => buf,
      gray: async (buf) => image({ ring: buf.toString() === 'framed' ? 3 : 0 }),
      sleep: async () => {},
    },
  };
}

const paper = (picture) => ({ unseen: { subjective: { Q: [{ slot: 's0', question: 'q', picture }] } } });
const sock = { kind: 'object', name: 'sock' };

describe('resolvePictures', () => {
  test('a framed picture from the cache is drawn again and the cache replaced', async () => {
    const key = Pictures.cacheKey(sock);
    const x = deps({ cached: { [key]: Buffer.from('framed') } });
    const out = await Pictures.resolvePictures(paper(sock), x.d);
    expect(x.calls.generate).toHaveLength(1);
    expect(x.calls.upload).toEqual([key]);
    expect(out.unseen.subjective.Q[0].picture.src).toContain(Buffer.from('clean').toString('base64'));
  });

  test('a fresh drawing with a frame is drawn once more, never cached framed', async () => {
    const x = deps({ frames: [true, false] });
    await Pictures.resolvePictures(paper(sock), x.d);
    expect(x.calls.generate).toHaveLength(2);
    expect(x.calls.upload).toHaveLength(1);
  });

  test('two framed drawings fail the paper rather than print a frame', async () => {
    const x = deps({ frames: [true, true] });
    await expect(Pictures.resolvePictures(paper(sock), x.d)).rejects.toMatchObject({ code: 'PICTURE_FAILED' });
    expect(x.calls.upload).toHaveLength(0);
  });
});

describe('the egg', () => {
  test('every object prompt rules out a face and shine lines', () => {
    const p = Kie.promptFor({ kind: 'object', name: 'egg' });
    expect(p).toMatch(/no face/i);
    expect(p).toMatch(/no smile/i);
    expect(p).toMatch(/no shine/i);
    ['face', 'smile'].forEach((term) => expect(Kie.NEGATIVE).toContain(term));
  });

  test('the egg cached with a smile is never reused', () => {
    expect(Pictures.cacheKey({ kind: 'object', name: 'egg' })).not.toBe(`${Pictures.PREFIX}/object/egg.jpg`);
    expect(Pictures.cacheKey({ kind: 'object', name: 'sock' })).toBe(`${Pictures.PREFIX}/object/sock.jpg`);
  });
});
