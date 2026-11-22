/**
 * One label for one action: on the standing class link (/j/<code>, public/wq/class-link.js) the
 * "Whose turn?" way out for a child who is not listed and the name screen's "my name isn't here" do the same thing
 * (this child is not in the list shown), so they read the same, in both languages: «میرا نام یہاں نہیں ہے» in Urdu
 * (copy.v2.json jg.who.not_listed), "My name isn't here" in English.
 * The real page from the real edge router; its own script runs in a vm and its taps go through the real edge
 * routes to a bot faked at the network boundary.
 */
const http = require('http');
const vm = require('vm');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { createWebQuizRouter } = require('../../routes/web-quiz.routes');

const CLIENT = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'wq', 'class-link.js'), 'utf8');
const DECK = require('../../../bot/shared/config/copy.v2.json');
const BOT = 'http://bot.test';
const CODE = 'KZ7QW3MNPX';

const TEACHER = { step: 'teacher', s: 'st-t', teachers: [{ tk: 'tk-a', name: 'Rabia Testwala' }] };
const WHO = { step: 'who', s: 'st-who', kids: [{ chip: 'c1', first: 'Hina', animal: 'owl' }], other: TEACHER };
const LETTER = { step: 'letter', script: 'latin', letters: ['A', 'Z'], s: 'st-l' };
const CHIPS = { step: 'chips', s: 'st-c', kids: [{ chip: 'c2', first: 'Zara' }] };

function jsonRes(status, body) {
  return { status, ok: status >= 200 && status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) };
}
function req(srv, method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method, path: p,
      headers: { host: 'quiz.example.org', ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: out }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

/** Opens /j/<code> in `lang`, taps "someone else", the teacher, a letter; returns the text of both way-out buttons. */
async function walk(lang) {
  const fetchImpl = async (url) => {
    if (url.startsWith(`${BOT}/api/internal/wq/cl/${CODE}`)) return jsonRes(200, { lang });
    if (url === `${BOT}/api/internal/wq/cl/arrive`) return jsonRes(200, WHO);
    if (url === `${BOT}/api/internal/wq/cl/teacher`) return jsonRes(200, LETTER);
    if (url === `${BOT}/api/internal/wq/cl/letter`) return jsonRes(200, CHIPS);
    return jsonRes(404, { error: 'not_found' });
  };
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl: BOT, apiKey: 'k', fetchImpl, canonicalBase: '' }));
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  try {
    const page = await req(srv, 'GET', `/j/${CODE}`);
    const boot = JSON.parse(page.body.match(/<script id="boot" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    let buttons = [];
    const root = {
      _h: '',
      get innerHTML() { return this._h; },
      set innerHTML(v) {
        this._h = v;
        buttons = [...v.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => {
          const attrs = {};
          m[1].replace(/([a-zA-Z_:][-a-zA-Z0-9_:]*)(?:="([^"]*)")?/g, (x, k, val) => { attrs[k] = val === undefined ? '' : val; return x; });
          return { attrs, text: m[2], fns: [], getAttribute: (k) => (k in attrs ? attrs[k] : null), addEventListener(t, fn) { if (t === 'click') this.fns.push(fn); } };
        });
      },
      querySelectorAll: (sel) => buttons.filter((b) => (sel[0] === '#' ? b.attrs.id === sel.slice(1) : sel[0] === '[' ? sel.slice(1, -1) in b.attrs : false)),
    };
    let pending = 0;
    const settle = () => new Promise((r) => { const tick = () => (pending ? setTimeout(tick, 5) : setTimeout(r, 20)); tick(); });
    const ctx = {
      document: { getElementById: (id) => (id === 'wq' ? root : id === 'boot' ? { textContent: JSON.stringify(boot) } : null) },
      localStorage: { getItem: () => null, setItem: () => {} },
      location: { href: `https://quiz.example.org/j/${CODE}` },
      fetch: async (url, opts) => {
        pending += 1;
        try {
          const r = await req(srv, opts.method, url, JSON.parse(opts.body));
          return { ok: r.status >= 200 && r.status < 300, json: async () => JSON.parse(r.body) };
        } finally { pending -= 1; }
      },
      window: { crypto: crypto.webcrypto },
    };
    vm.createContext(ctx);
    vm.runInContext(CLIENT, ctx);
    await settle();
    const tap = async (sel) => { const b = root.querySelectorAll(sel)[0]; expect(b).toBeTruthy(); b.fns.forEach((fn) => fn()); await settle(); };
    const whoWayOut = (buttons.find((b) => b.attrs.id === 'wq-cl-other') || {}).text;
    await tap('#wq-cl-other');
    await tap('[data-tk]');
    await tap('[data-l]');
    const nameWayOut = (buttons.find((b) => b.attrs.id === 'wq-cl-back') || {}).text;
    return { whoWayOut, nameWayOut };
  } finally {
    await new Promise((r) => srv.close(r));
  }
}

const esc = (s) => s.replace(/'/g, '&#39;');

test('UR: the "Whose turn?" way out reads exactly as the name screen\'s, «میرا نام یہاں نہیں ہے»', async () => {
  const { whoWayOut, nameWayOut } = await walk('ur');
  expect(nameWayOut).toBe(DECK['jg.who.not_listed'].ur);
  expect(whoWayOut).toBe(nameWayOut);
  expect(whoWayOut).toBe('میرا نام یہاں نہیں ہے');
});

test('EN: both read "My name isn\'t here" (unchanged)', async () => {
  const { whoWayOut, nameWayOut } = await walk('en');
  expect(whoWayOut).toBe(esc("My name isn't here"));
  expect(nameWayOut).toBe(whoWayOut);
});
