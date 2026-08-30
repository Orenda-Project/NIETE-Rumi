/**
 * The register photos are kept.
 *
 * Until 2026-08-30 they were not: each page was decrypted into memory, handed to
 * the model, and garbage-collected. Every photo a coach had taken was gone, and no
 * extraction could ever be audited — for a feature whose output is a school's
 * student roster, and whose known failure mode is a confidently wrong name, that is
 * the wrong default. They now go to their own bucket and are retained.
 *
 * TWO RULES THIS FILE PINS.
 *
 * 1. STORING IS BEST-EFFORT; SAVING IS NOT. A bucket outage must never cost a coach
 *    the class she just photographed and corrected. Every function here resolves to
 *    {ok:false} and logs; none of them throws into the flow.
 * 2. THE KEY CARRIES THE JOIN. School, run and page are in the object key and the
 *    run's manifest holds the class, the model, the raw model output and the list
 *    that was actually saved — so an audit needs the bucket and nothing else. That
 *    is what buys us zero new tables for this (root CLAUDE.md rule 15).
 */

const storage = require('../../bot/shared/services/roster/roster-storage');

/** A stand-in for PutObjectCommand — the SDK itself is a bot dependency. */
class FakePut {
  constructor(input) { this.input = input; }
}

/** A stand-in for the S3 client: records what it was asked to write. */
function fakeClient(fail = false) {
  const sent = [];
  return {
    sent,
    async send(cmd) {
      if (fail) throw new Error('bucket unreachable');
      sent.push(cmd.input);
      return {};
    },
  };
}

describe('object keys', () => {
  it('puts school, run and page in the key, zero-padded so pages sort', () => {
    expect(storage.pageKey('school-1', 'run-9', 0)).toBe('registers/school-1/run-9/page-01.jpg');
    expect(storage.pageKey('school-1', 'run-9', 11)).toBe('registers/school-1/run-9/page-12.jpg');
  });

  it('puts the manifest beside the pages it describes', () => {
    expect(storage.manifestKey('school-1', 'run-9')).toBe('registers/school-1/run-9/manifest.json');
  });

  it('refuses a school or run id that would escape the prefix', () => {
    expect(() => storage.pageKey('../other', 'run', 0)).toThrow();
    expect(() => storage.pageKey('school', 'a/b', 0)).toThrow();
  });
});

describe('putPage', () => {
  it('writes the photo to the roster bucket with an image content type', async () => {
    const client = fakeClient();
    const res = await storage.putPage(
      { schoolId: 's1', runId: 'r1', index: 0, buffer: Buffer.from('jpegbytes') },
      { client, bucket: 'studentrosters-ict', PutObjectCommand: FakePut },
    );
    expect(res.ok).toBe(true);
    expect(client.sent[0]).toMatchObject({
      Bucket: 'studentrosters-ict',
      Key: 'registers/s1/r1/page-01.jpg',
      ContentType: 'image/jpeg',
    });
  });

  it('reports a failure instead of throwing — a bucket outage must not cost the roster', async () => {
    const res = await storage.putPage(
      { schoolId: 's1', runId: 'r1', index: 0, buffer: Buffer.from('x') },
      { client: fakeClient(true), bucket: 'b', PutObjectCommand: FakePut },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unreachable/);
  });

  it('is a no-op, not an error, when no bucket is configured', async () => {
    const res = await storage.putPage(
      { schoolId: 's1', runId: 'r1', index: 0, buffer: Buffer.from('x') },
      { client: fakeClient(), bucket: '', PutObjectCommand: FakePut },
    );
    expect(res).toEqual({ ok: false, skipped: true });
  });
});

describe('putManifest', () => {
  it('writes the audit record as JSON beside the pages', async () => {
    const client = fakeClient();
    const res = await storage.putManifest(
      { schoolId: 's1', runId: 'r1', manifest: { classId: 'c1', model: 'm' } },
      { client, bucket: 'b', PutObjectCommand: FakePut },
    );
    expect(res.ok).toBe(true);
    expect(client.sent[0].Key).toBe('registers/s1/r1/manifest.json');
    expect(client.sent[0].ContentType).toBe('application/json');
    expect(JSON.parse(client.sent[0].Body)).toMatchObject({ classId: 'c1', model: 'm' });
  });

  it('never throws, whatever the manifest contains', async () => {
    const circular = {};
    circular.self = circular;
    const res = await storage.putManifest(
      { schoolId: 's1', runId: 'r1', manifest: circular },
      { client: fakeClient(), bucket: 'b', PutObjectCommand: FakePut },
    );
    expect(res.ok).toBe(false);
  });
});
