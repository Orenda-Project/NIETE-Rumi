/**
 * bd-q261rec (queue #261) — a recording goes up in PIECES, so a slow or broken line resumes instead of starting over.
 *
 * Production, 25 Nov: a 40-minute recording failed four times on a weak line, and every try started again from byte 0
 * (one whole-file PUT, no resume). Now the phone PUTs the file as byte pieces under upload_pieces/<uid>/<id>/, asks which
 * pieces the server already holds before sending (begin with the same key), and asks the bot to JOIN them into the one
 * key the analysis has always read. The joined file is byte-identical to the phone's: pieces are byte ranges, not audio
 * segments, so any format (webm, m4a, wav) joins by plain concatenation.
 */

const crypto = require('crypto');

const SVC = '../../bot/shared/services/coaching/portal-upload-pieces.service';
const UID = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-2222-3333-4444-555555555555';
const KEY = `classroom_audio/${UID}/2026-11/portal_abc-123.webm`;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** An in-memory R2: objects by key. */
function fakeR2(initial = {}) {
  const objects = new Map(Object.entries(initial));
  return {
    objects,
    getPresignedUploadUrl: jest.fn(async (key, type, ttl) => `https://r2.test/${key}?type=${encodeURIComponent(type)}&ttl=${ttl}`),
    headObject: jest.fn(async (key) => (objects.has(key) ? { exists: true, sizeBytes: objects.get(key).length } : { exists: false })),
    listObjects: jest.fn(async (prefix) => [...objects.keys()].filter((k) => k.startsWith(prefix))
      .map((key) => ({ key, size: objects.get(key).length, lastModified: null }))),
    downloadFromR2: jest.fn(async (key) => {
      if (!objects.has(key)) { const e = new Error('NoSuchKey'); e.name = 'NoSuchKey'; throw e; }
      return Buffer.from(objects.get(key));
    }),
    uploadBuffer: jest.fn(async (buf, key) => { objects.set(key, Buffer.from(buf)); return `https://r2.test/${key}`; }),
    deleteKey: jest.fn(async (key) => { objects.delete(key); return true; }),
  };
}

function deps(r2, extra = {}) {
  return { r2, now: () => new Date('2026-11-26T00:00:00Z'), newId: () => 'abc-123', log: jest.fn(), ...extra };
}

/** Put `bytes` up as pieces of `size`, the way the phone does, under the key's piece prefix. */
function putPieces(r2, svc, uid, key, bytes, size, only = null) {
  const id = svc.uploadIdOf(uid, key);
  for (let n = 0, at = 0; at < bytes.length; n += 1, at += size) {
    if (only && !only.includes(n)) continue;
    r2.objects.set(svc.pieceKey(uid, id, n), bytes.subarray(at, Math.min(at + size, bytes.length)));
  }
}

describe('bd-q261rec — recording pieces: begin, sign, join', () => {
  let svc;
  beforeEach(() => {
    jest.resetModules();
    svc = require(SVC);
  });

  describe('begin', () => {
    test('a new upload gets its final key in the audio tree, the piece count and nothing held yet', async () => {
      const r2 = fakeR2();
      const out = await svc.beginPieces({ userId: UID, filename: 'lesson.webm', sizeBytes: 1000, pieceBytes: 65536 }, deps(r2));
      expect(out).toMatchObject({ status: 'ok', key: KEY, contentType: 'audio/webm', pieceBytes: 65536, pieces: 1, have: [], joined: false });
    });

    test('the piece count is the size over the piece size, rounded up', async () => {
      const out = await svc.beginPieces({ userId: UID, filename: 'a.m4a', sizeBytes: 3 * 65536 + 1, pieceBytes: 65536 }, deps(fakeR2()));
      expect(out.pieces).toBe(4);
      expect(out.contentType).toBe('audio/mp4');
    });

    test('begin again with the same key says which pieces are already there (only whole ones)', async () => {
      const r2 = fakeR2();
      const bytes = crypto.randomBytes(3 * 65536 + 10);
      putPieces(r2, svc, UID, KEY, bytes, 65536, [0, 2]);
      // piece 1 arrived cut short: not held
      r2.objects.set(svc.pieceKey(UID, svc.uploadIdOf(UID, KEY), 1), bytes.subarray(65536, 65536 + 100));
      const out = await svc.beginPieces({ userId: UID, filename: 'lesson.webm', sizeBytes: bytes.length, pieceBytes: 65536, key: KEY }, deps(r2));
      expect(out).toMatchObject({ status: 'ok', key: KEY, pieces: 4, joined: false });
      expect(out.have).toEqual([0, 2]);
    });

    test('begin again after the join already happened says joined, nothing to send', async () => {
      const r2 = fakeR2({ [KEY]: Buffer.alloc(500) });
      const out = await svc.beginPieces({ userId: UID, filename: 'lesson.webm', sizeBytes: 500, pieceBytes: 65536, key: KEY }, deps(r2));
      expect(out).toMatchObject({ status: 'ok', joined: true, key: KEY });
    });

    test('a key already joined at ANOTHER size is never reused (a session may point at it): key_taken', async () => {
      const r2 = fakeR2({ [KEY]: Buffer.alloc(500) });
      const out = await svc.beginPieces({ userId: UID, filename: 'lesson.webm', sizeBytes: 900, pieceBytes: 65536, key: KEY }, deps(r2));
      expect(out).toEqual(expect.objectContaining({ status: 'invalid', reason: 'key_taken' }));
    });

    test.each([
      [{ userId: null }, 'no_user'],
      [{ filename: 'lesson.exe' }, 'not_audio'],
      [{ sizeBytes: 0 }, 'bad_size'],
      [{ sizeBytes: 301 * 1024 * 1024 }, 'too_large'],
      [{ pieceBytes: 1000 }, 'bad_piece_size'],
      [{ pieceBytes: 64 * 1024 * 1024 }, 'bad_piece_size'],
      [{ sizeBytes: 200 * 1024 * 1024, pieceBytes: 65536 }, 'too_many_pieces'],
      [{ key: `classroom_audio/${OTHER}/2026-11/portal_abc-123.webm` }, 'not_yours'],
      [{ key: `lesson_plans/${UID}/portal_abc-123.pdf` }, 'not_yours'],
    ])('refuses %j (%s)', async (patch, reason) => {
      const args = { userId: UID, filename: 'lesson.webm', sizeBytes: 1000, pieceBytes: 65536, ...patch };
      const out = await svc.beginPieces(args, deps(fakeR2()));
      expect(out).toEqual(expect.objectContaining({ status: 'invalid', reason }));
    });
  });

  describe('sign', () => {
    test('signs a PUT per piece asked for, under the piece prefix, as octet-stream', async () => {
      const r2 = fakeR2();
      const out = await svc.signPieces({ userId: UID, key: KEY, pieces: [0, 3], attempt: 2 }, deps(r2));
      expect(out.status).toBe('ok');
      expect(out.contentType).toBe('application/octet-stream');
      expect(out.urls.map((u) => u.n)).toEqual([0, 3]);
      expect(out.urls[1].url).toContain(`upload_pieces/${UID}/abc-123/0003`);
      expect(r2.getPresignedUploadUrl).toHaveBeenCalledWith(`upload_pieces/${UID}/abc-123/0000`, 'application/octet-stream', expect.any(Number));
    });

    test('a retry is logged with its attempt, so the logs show the line was weak', async () => {
      const d = deps(fakeR2());
      await svc.signPieces({ userId: UID, key: KEY, pieces: [5], attempt: 3 }, d);
      expect(d.log).toHaveBeenCalledWith(expect.stringContaining('pieces.sign'), expect.objectContaining({ attempt: 3, first: 5, count: 1 }), 'info');
    });

    test.each([
      [{ key: `classroom_audio/${OTHER}/2026-11/portal_abc-123.webm` }, 'not_yours'],
      [{ pieces: [] }, 'bad_pieces'],
      [{ pieces: [-1] }, 'bad_pieces'],
      [{ pieces: [1.5] }, 'bad_pieces'],
      [{ pieces: Array.from({ length: 51 }, (_, i) => i) }, 'bad_pieces'],
    ])('refuses %j (%s)', async (patch, reason) => {
      const out = await svc.signPieces({ userId: UID, key: KEY, pieces: [0], ...patch }, deps(fakeR2()));
      expect(out).toEqual(expect.objectContaining({ status: 'invalid', reason }));
    });
  });

  describe('join', () => {
    const SIZE = 65536;

    test('joins every piece, in order, into the one key: byte-identical to the phone copy; pieces deleted', async () => {
      const r2 = fakeR2();
      const bytes = crypto.randomBytes(5 * SIZE + 777);
      putPieces(r2, svc, UID, KEY, bytes, SIZE);
      const out = await svc.joinPieces({ userId: UID, key: KEY, sizeBytes: bytes.length, pieceBytes: SIZE }, deps(r2));
      expect(out).toMatchObject({ status: 'ok', key: KEY, sizeBytes: bytes.length, sha256: sha(bytes) });
      expect(sha(r2.objects.get(KEY))).toBe(sha(bytes));
      expect(r2.uploadBuffer).toHaveBeenCalledWith(expect.any(Buffer), KEY, 'audio/webm', expect.objectContaining({ metadata: expect.objectContaining({ sha256: sha(bytes) }) }));
      expect([...r2.objects.keys()].filter((k) => k.startsWith('upload_pieces/'))).toEqual([]);
    });

    test('a missing or short piece is named, and nothing is joined', async () => {
      const r2 = fakeR2();
      const bytes = crypto.randomBytes(4 * SIZE);
      putPieces(r2, svc, UID, KEY, bytes, SIZE, [0, 1, 3]);
      const out = await svc.joinPieces({ userId: UID, key: KEY, sizeBytes: bytes.length, pieceBytes: SIZE }, deps(r2));
      expect(out).toEqual(expect.objectContaining({ status: 'invalid', reason: 'pieces_missing', missing: [2] }));
      expect(r2.objects.has(KEY)).toBe(false);
    });

    test('a piece whose bytes differ from the phone\'s (its digest) is deleted and named, to be sent again', async () => {
      const r2 = fakeR2();
      const bytes = crypto.randomBytes(3 * SIZE);
      putPieces(r2, svc, UID, KEY, bytes, SIZE);
      const digests = [0, 1, 2].map((n) => sha(bytes.subarray(n * SIZE, (n + 1) * SIZE)));
      digests[1] = sha(Buffer.from('something else'));
      const out = await svc.joinPieces({ userId: UID, key: KEY, sizeBytes: bytes.length, pieceBytes: SIZE, digests }, deps(r2));
      expect(out).toEqual(expect.objectContaining({ status: 'invalid', reason: 'pieces_mismatch', bad: [1] }));
      expect(r2.objects.has(svc.pieceKey(UID, 'abc-123', 1))).toBe(false);
      expect(r2.objects.has(svc.pieceKey(UID, 'abc-123', 0))).toBe(true);
      expect(r2.objects.has(KEY)).toBe(false);
    });

    test('matching digests join', async () => {
      const r2 = fakeR2();
      const bytes = crypto.randomBytes(2 * SIZE + 3);
      putPieces(r2, svc, UID, KEY, bytes, SIZE);
      const digests = [0, 1, 2].map((n) => sha(bytes.subarray(n * SIZE, Math.min((n + 1) * SIZE, bytes.length))));
      const out = await svc.joinPieces({ userId: UID, key: KEY, sizeBytes: bytes.length, pieceBytes: SIZE, digests }, deps(r2));
      expect(out.status).toBe('ok');
      expect(sha(r2.objects.get(KEY))).toBe(sha(bytes));
    });

    test('a second join of the same upload (a retry after the answer was lost) answers ok again', async () => {
      const r2 = fakeR2();
      const bytes = crypto.randomBytes(SIZE + 1);
      putPieces(r2, svc, UID, KEY, bytes, SIZE);
      await svc.joinPieces({ userId: UID, key: KEY, sizeBytes: bytes.length, pieceBytes: SIZE }, deps(r2));
      const again = await svc.joinPieces({ userId: UID, key: KEY, sizeBytes: bytes.length, pieceBytes: SIZE }, deps(r2));
      expect(again).toMatchObject({ status: 'ok', key: KEY, sizeBytes: bytes.length, already: true });
      expect(r2.uploadBuffer).toHaveBeenCalledTimes(1);
    });

    test('the join is logged with the pieces and size', async () => {
      const r2 = fakeR2();
      const bytes = crypto.randomBytes(SIZE);
      putPieces(r2, svc, UID, KEY, bytes, SIZE);
      const d = deps(r2);
      await svc.joinPieces({ userId: UID, key: KEY, sizeBytes: bytes.length, pieceBytes: SIZE }, d);
      expect(d.log).toHaveBeenCalledWith(expect.stringContaining('pieces.joined'), expect.objectContaining({ key: KEY, pieces: 1, sizeBytes: SIZE }), 'info');
    });

    test('someone else\'s key is refused', async () => {
      const out = await svc.joinPieces({ userId: OTHER, key: KEY, sizeBytes: 10, pieceBytes: SIZE }, deps(fakeR2()));
      expect(out).toEqual(expect.objectContaining({ status: 'invalid', reason: 'not_yours' }));
    });
  });

  test('a piece key never looks like a portal recording (PORTAL_KEY_RX), so no session can point at one', () => {
    const { PORTAL_KEY_RX } = require('../../bot/shared/services/coaching/portal-coaching.service');
    expect(PORTAL_KEY_RX.test(`https://x/${svc.pieceKey(UID, 'abc-123', 0)}`)).toBe(false);
  });
});

describe('bd-q261rec — /api/internal/coaching/pieces-*', () => {
  const PIECES = '../../bot/shared/services/coaching/portal-upload-pieces.service';
  function invoke(router, path, body) {
    const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods.post);
    if (!layer) throw new Error(`no POST ${path}`);
    const handlers = layer.route.stack.map((s) => s.handle);
    const req = { body, headers: { 'x-api-key': 'secret' }, path, ip: '127.0.0.1' };
    return new Promise((resolve) => {
      const res = {
        statusCode: 200,
        status(c) { this.statusCode = c; return this; },
        json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
      };
      const run = (i) => (i >= handlers.length ? resolve({ status: 404 }) : handlers[i](req, res, () => run(i + 1)));
      run(0);
    });
  }
  const OLD = process.env.INTERNAL_API_KEY;
  afterAll(() => { process.env.INTERNAL_API_KEY = OLD; });

  test.each([
    ['/coaching/pieces-begin', 'beginPieces', { userId: 'u', filename: 'a.webm', sizeBytes: 9, pieceBytes: 65536, key: 'k' }],
    ['/coaching/pieces-sign', 'signPieces', { userId: 'u', key: 'k', pieces: [0], attempt: 1 }],
    ['/coaching/pieces-join', 'joinPieces', { userId: 'u', key: 'k', sizeBytes: 9, pieceBytes: 65536, digests: ['x'] }],
  ])('%s passes the named fields to %s and maps invalid to 400', async (path, fn, body) => {
    jest.resetModules();
    process.env.INTERNAL_API_KEY = 'secret';
    const svc = { beginPieces: jest.fn(), signPieces: jest.fn(), joinPieces: jest.fn() };
    svc[fn].mockResolvedValue({ status: 'invalid', reason: 'pieces_missing', missing: [2] });
    jest.doMock(PIECES, () => svc);
    const router = require('../../bot/shared/routes/internal-api.routes');
    const out = await invoke(router, path, { ...body, extra: 'dropped' });
    expect(out.status).toBe(400);
    expect(out.body).toMatchObject({ reason: 'pieces_missing', missing: [2] });
    expect(svc[fn]).toHaveBeenCalledWith(body);
  });
});
