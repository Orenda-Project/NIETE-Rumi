'use strict';
/**
 * v10 coaching test (bd-v0toag.38.9): the teacher's voice note for her coach is stored with the portal's own
 * R2 SDK (dashboard/package.json), never the bot's, which the portal does not install.
 */
const { createNoteStore } = require('../../dashboard/services/coach-note-store');

function fakeSdk() {
  const sent = [];
  const cmd = (kind) => function Cmd(input) { this.kind = kind; this.input = input; };
  return {
    sent,
    sdk: {
      client: { send: async (c) => { sent.push(c); return {}; } },
      PutObjectCommand: cmd('put'),
      GetObjectCommand: cmd('get'),
      DeleteObjectCommand: cmd('delete'),
      getSignedUrl: async (client, c, opts) => `https://signed/${c.input.Key}?e=${opts.expiresIn}`,
    },
  };
}

describe('coach note store', () => {
  test('put sends the buffer under the key with its type, to the bucket', async () => {
    const f = fakeSdk();
    const store = createNoteStore({ sdk: f.sdk, bucket: 'b1' });
    await store.put(Buffer.from('x'), 'coach-visit-notes/r.webm', 'audio/webm');
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0].kind).toBe('put');
    expect(f.sent[0].input).toEqual({ Bucket: 'b1', Key: 'coach-visit-notes/r.webm', Body: Buffer.from('x'), ContentType: 'audio/webm' });
  });

  test('presign signs a get for the key with the given seconds', async () => {
    const store = createNoteStore({ sdk: fakeSdk().sdk, bucket: 'b1' });
    await expect(store.presign('coach-visit-notes/r.webm', 3600)).resolves.toBe('https://signed/coach-visit-notes/r.webm?e=3600');
  });

  test('del sends a delete for the key', async () => {
    const f = fakeSdk();
    await createNoteStore({ sdk: f.sdk, bucket: 'b1' }).del('coach-visit-notes/r.webm');
    expect(f.sent[0].kind).toBe('delete');
    expect(f.sent[0].input).toEqual({ Bucket: 'b1', Key: 'coach-visit-notes/r.webm' });
  });

  test('no bucket: every call fails, so no note is ever half-stored', async () => {
    const store = createNoteStore({ sdk: fakeSdk().sdk, bucket: '' });
    await expect(store.put(Buffer.from('x'), 'k', 'audio/webm')).rejects.toThrow(/bucket/i);
    await expect(store.presign('k', 60)).rejects.toThrow(/bucket/i);
    await expect(store.del('k')).rejects.toThrow(/bucket/i);
  });

  test('the service stores notes here, not through the bot', () => {
    const src = require('fs').readFileSync(require.resolve('../../dashboard/services/coach-visit-request'), 'utf8');
    expect(src).not.toMatch(/bot\/shared\/storage/);
    expect(src).toMatch(/coach-note-store/);
  });
});
