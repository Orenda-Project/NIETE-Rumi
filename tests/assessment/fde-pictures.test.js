/**
 * Every picture on a Grade 1-2 paper gets its image before the paper is saved
 * (bd-5jmnfj.4.3). SVG kinds are drawn in place; object, count and scene come from
 * the R2 cache or, on a miss, the image model, shrunk and cached. One retry, then
 * the paper fails PICTURE_FAILED: it never prints an empty box.
 */

const Pictures = require('../../bot/shared/services/assessment/fde-pictures');

const paper = (pictures) => ({
  unseen: { subjective: { Count: pictures.map((picture, i) => ({ slot: `s${i}`, question: 'q', picture })) } },
});
const items = (examJson) => examJson.unseen.subjective.Count;

function deps({ cached = {}, fail = 0 } = {}) {
  const store = { ...cached };
  let failures = fail;
  const calls = { generate: [], upload: [], download: [] };
  return {
    calls,
    store,
    d: {
      headObject: async (key) => ({ exists: key in store }),
      downloadFromR2: async (key) => { calls.download.push(key); return store[key]; },
      uploadBuffer: async (buf, key) => { calls.upload.push(key); store[key] = buf; return `https://r2/${key}`; },
      generateImage: async (prompt) => {
        calls.generate.push(prompt);
        if (failures > 0) { failures -= 1; throw new Error('kie down'); }
        return Buffer.from('png');
      },
      shrink: async (buf) => Buffer.from(`jpg:${buf.toString()}`),
    },
  };
}

test('svg kinds are drawn in place, with no cache and no model', async () => {
  const x = deps();
  const out = await Pictures.resolvePictures(paper([{ kind: 'dots', n: 3 }, { kind: 'shapes', shapes: [{ shape: 'circle' }] }]), x.d);
  items(out).forEach((q) => expect(q.picture.src).toMatch(/^data:image\/svg\+xml;base64,/));
  expect(x.calls.generate).toHaveLength(0);
});

test('a cache miss is drawn once, shrunk, stored and embedded', async () => {
  const x = deps();
  const out = await Pictures.resolvePictures(paper([{ kind: 'object', name: 'Red Apple' }]), x.d);
  expect(x.calls.generate).toHaveLength(1);
  expect(x.calls.upload).toEqual(['fde-pictures/v3/object/red-apple.jpg']);
  expect(items(out)[0].picture.src).toBe(`data:image/jpeg;base64,${Buffer.from('jpg:png').toString('base64')}`);
});

test('a cache hit is read from R2, never drawn again', async () => {
  const x = deps({ cached: { 'fde-pictures/v3/object/apple.jpg': Buffer.from('old') } });
  const out = await Pictures.resolvePictures(paper([{ kind: 'count', name: 'apple', n: 4 }]), x.d);
  expect(x.calls.generate).toHaveLength(0);
  expect(items(out)[0].picture.src).toBe(`data:image/jpeg;base64,${Buffer.from('old').toString('base64')}`);
  expect(items(out)[0].picture.n).toBe(4);
});

test('the same picture twice on one paper is drawn once', async () => {
  const x = deps();
  await Pictures.resolvePictures(paper([{ kind: 'object', name: 'cat' }, { kind: 'count', name: 'cat', n: 2 }]), x.d);
  expect(x.calls.generate).toHaveLength(1);
});

test('a scene key is its slug plus a hash of the whole description', () => {
  const a = Pictures.cacheKey({ kind: 'scene', describe: 'a long pencil and a short pencil' });
  // scene-no-text: scenes cached before bd-5jmnfj.4.11 carry words (ROOT, SCHOOL) and are never reused
  expect(a).toMatch(/^fde-pictures\/v3\/scene-no-text\/a-long-pencil-and-a-short-pencil-[0-9a-f]{8}\.jpg$/);
  expect(Pictures.cacheKey({ kind: 'scene', describe: 'A long pencil and a short pencil.' })).toBe(a);
});

test('one failure is retried; two fail the paper PICTURE_FAILED with the picture named', async () => {
  const ok = deps({ fail: 1 });
  await Pictures.resolvePictures(paper([{ kind: 'object', name: 'cat' }]), ok.d);
  expect(ok.calls.generate).toHaveLength(2);
  const bad = deps({ fail: 2 });
  await expect(Pictures.resolvePictures(paper([{ kind: 'object', name: 'cat' }]), bad.d))
    .rejects.toMatchObject({ code: 'PICTURE_FAILED', slot: 's0', kind: 'object' });
});

test('a failed picture logs which one and the image model\'s own error (bd-5jmnfj.4.32)', async () => {
  const bad = deps({ fail: 2 });
  const logged = [];
  bad.d.log = (msg, data) => logged.push({ msg, data });
  await expect(Pictures.resolvePictures(paper([{ kind: 'object', name: 'cat' }]), bad.d)).rejects.toThrow();
  expect(logged).toEqual([{
    msg: '[assessment] picture failed',
    data: { slot: 's0', kind: 'object', name: 'cat', cause: 'kie down' },
  }]);
});

test('an item whose picture cannot be drawn fails the paper, never prints empty', async () => {
  await expect(Pictures.resolvePictures(paper([{ kind: 'shapes', shapes: [{ shape: 'hexagon' }] }]), deps().d))
    .rejects.toMatchObject({ code: 'PICTURE_FAILED' });
  await expect(Pictures.resolvePictures(paper([{ kind: 'video' }]), deps().d))
    .rejects.toMatchObject({ code: 'PICTURE_FAILED' });
});

test('a paper with no pictures is returned as it was', async () => {
  const x = deps();
  const p = { unseen: { objective: { MCQs: [{ slot: 'a', question: 'q' }] } } };
  expect(await Pictures.resolvePictures(p, x.d)).toEqual(p);
});

test('the cache moved to v3: no v2 arrowed or scan-look picture is reused (bd-5jmnfj.4.30)', () => {
  expect(Pictures.PREFIX).toBe('fde-pictures/v3');
});

// bd-5jmnfj.4.21: five papers drawing at once got "call frequency is too high" (429) and G1 English failed.
const tooFast = () => new Error('image model: no task ({"code":429,"msg":"Your call frequency is too high. Please try again later."})');

test('a 429 is retried after a growing pause until the image model draws it', async () => {
  const x = deps();
  let refusals = 3;
  const waits = [];
  x.d.sleep = async (ms) => { waits.push(ms); };
  x.d.generateImage = async () => { if (refusals-- > 0) throw tooFast(); return Buffer.from('png'); };
  const out = await Pictures.resolvePictures(paper([{ kind: 'object', name: 'pig' }]), x.d);
  expect(items(out)[0].picture.src).toMatch(/^data:image\/jpeg;base64,/);
  expect(waits).toHaveLength(3);
  expect(waits[1]).toBeGreaterThan(waits[0]);
  expect(waits[2]).toBeGreaterThan(waits[1]);
});

test('a 429 that never clears fails the paper PICTURE_FAILED after four tries', async () => {
  const x = deps();
  let tries = 0;
  x.d.sleep = async () => {};
  x.d.generateImage = async () => { tries += 1; throw tooFast(); };
  await expect(Pictures.resolvePictures(paper([{ kind: 'object', name: 'pig' }]), x.d))
    .rejects.toMatchObject({ code: 'PICTURE_FAILED' });
  expect(tries).toBe(4);
});

test('no more than two image-model draws run at once, across papers', async () => {
  const x = deps();
  let running = 0;
  let most = 0;
  x.d.generateImage = async () => {
    running += 1; most = Math.max(most, running);
    await new Promise((r) => setTimeout(r, 5));
    running -= 1;
    return Buffer.from('png');
  };
  const names = (p) => paper(['cat', 'dog', 'cow', 'hen'].map((n) => ({ kind: 'object', name: `${p}-${n}` })));
  await Promise.all([Pictures.resolvePictures(names('a'), x.d), Pictures.resolvePictures(names('b'), x.d)]);
  expect(most).toBe(2);
});
