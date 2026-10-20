'use strict';
/**
 * bd-tbprit.9 — Rifat: "Play only the problem part … The player starts at the start time and stops at the end
 * time." With `to`, the clip runs from `at` to `to` exactly (no lead-in), at most ten minutes; without it, the
 * old 60 seconds around the grader's second. The route passes a valid `to` through and refuses a bad one.
 */
const http = require('http');
const express = require('express');
const { PassThrough } = require('stream');
const { windowOf } = require('../../dashboard/services/coach-disagreement-clip');
const { createCoachDisagreementsRouter } = require('../../dashboard/routes/coach-disagreements.routes');

describe('windowOf with an end', () => {
  it('from the start to the end, exactly', () => {
    expect(windowOf(845, 1170)).toEqual({ start: 845, length: 325 });
  });
  it('at most ten minutes', () => {
    expect(windowOf(0, 2000)).toEqual({ start: 0, length: 600 });
  });
  it('no end, or an end not after the start: the old minute around the second', () => {
    expect(windowOf(190)).toEqual({ start: 175, length: 60 });
    expect(windowOf(190, 190)).toEqual({ start: 175, length: 60 });
  });
});

const ID = '7e0c1a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
let servers = [];
afterEach(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(r)))); servers = []; });
async function app() {
  const opened = [];
  const a = express();
  a.use((req, _res, next) => { req.session = { portalUserId: 'me' }; next(); });
  a.use(createCoachDisagreementsRouter({
    guards: [], isOn: async () => true, list: async () => ({ todo: [], done: [] }), card: async () => null,
    ownerOf: async () => null, markVisited: async () => true,
    recordingFor: async () => 'https://r2/rec.ogg?sig',
    openClip: async (...args) => {
      opened.push(args.slice(1));
      const stream = new PassThrough();
      setImmediate(() => stream.end());
      return { stream, first: Buffer.from('ID3'), proc: { kill: () => {} } };
    },
  }));
  const srv = await new Promise((r) => { const s = a.listen(0, () => r(s)); });
  servers.push(srv);
  return { srv, opened };
}
const status = (srv, path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: srv.address().port, path }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
});

describe('GET /clip?at=&to=', () => {
  it('passes the end through', async () => {
    const { srv, opened } = await app();
    expect(await status(srv, `/coach/disagreements/${ID}/clip?at=845&to=1170`)).toBe(200);
    expect(opened).toEqual([[845, 1170]]);
  });
  it('no end: as before', async () => {
    const { srv, opened } = await app();
    expect(await status(srv, `/coach/disagreements/${ID}/clip?at=190`)).toBe(200);
    expect(opened).toEqual([[190, null]]);
  });
  it('a malformed end is a 400', async () => {
    const { srv, opened } = await app();
    expect(await status(srv, `/coach/disagreements/${ID}/clip?at=190&to=x`)).toBe(400);
    expect(opened).toEqual([]);
  });
});
