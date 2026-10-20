'use strict';
/**
 * bd-tbprit.2 — GET /coach/disagreements/:id/clip?at=<s>: the disputed step as mp3, for the assigned coach
 * only, streamed inline and never cached; no download disposition. The clip failing never breaks the card.
 */
const http = require('http');
const express = require('express');
const { PassThrough } = require('stream');
const { createCoachDisagreementsRouter } = require('../../dashboard/routes/coach-disagreements.routes');

const ID = '7e0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
const OTHER = '8e0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });

async function app(over = {}) {
  const calls = { opened: [] };
  const a = express();
  a.use((req, _res, next) => { req.session = { portalUserId: 'me' }; next(); });
  a.use(createCoachDisagreementsRouter({
    guards: [],
    isOn: over.isOn || (async () => true),
    list: async () => ({ todo: [], done: [] }),
    card: async () => null,
    ownerOf: async () => null,
    markVisited: async () => true,
    recordingFor: over.recordingFor || (async (uid, id) => (uid === 'me' && id === ID ? 'https://r2/rec.ogg?sig' : null)),
    openClip: over.openClip || (async (url, at) => {
      calls.opened.push([url, at]);
      const stream = new PassThrough();
      setImmediate(() => stream.end(Buffer.from('-rest')));
      return { stream, first: Buffer.from('ID3'), proc: { kill: () => {} } };
    }),
  }));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return { srv, calls };
}
const get = (srv, path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: srv.address().port, path }, (res) => {
    const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
  }).on('error', reject);
});

describe('GET /coach/disagreements/:id/clip', () => {
  it('her request: mp3 inline, private, never cached, cut at the asked second', async () => {
    const { srv, calls } = await app();
    const r = await get(srv, `/coach/disagreements/${ID}/clip?at=190`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('audio/mpeg');
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(r.headers['content-disposition']).toBe('inline');
    expect(r.body).toBe('ID3-rest');
    expect(calls.opened).toEqual([['https://r2/rec.ogg?sig', 190]]);
  });

  it('someone else\'s request, or no recording: 404 and ffmpeg never starts', async () => {
    const { srv, calls } = await app();
    expect((await get(srv, `/coach/disagreements/${OTHER}/clip?at=190`)).status).toBe(404);
    expect(calls.opened).toEqual([]);
  });

  it('a malformed second is a 400; a malformed id a 404', async () => {
    const { srv, calls } = await app();
    expect((await get(srv, `/coach/disagreements/${ID}/clip?at=abc`)).status).toBe(400);
    expect((await get(srv, `/coach/disagreements/${ID}/clip`)).status).toBe(400);
    expect((await get(srv, '/coach/disagreements/bad/clip?at=1')).status).toBe(404);
    expect(calls.opened).toEqual([]);
  });

  it('flag off: 404', async () => {
    const { srv } = await app({ isOn: async () => false });
    expect((await get(srv, `/coach/disagreements/${ID}/clip?at=190`)).status).toBe(404);
  });

  it('ffmpeg failing before any audio: 503, nothing streamed', async () => {
    const { srv } = await app({ openClip: async () => { throw new Error('ENOENT ffmpeg'); } });
    const r = await get(srv, `/coach/disagreements/${ID}/clip?at=190`);
    expect(r.status).toBe(503);
    expect(r.body).not.toContain('ENOENT');
  });
});
