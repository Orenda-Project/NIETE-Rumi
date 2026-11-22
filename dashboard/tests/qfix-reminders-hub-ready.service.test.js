'use strict';
/**
 * The hub a two-class reminder opens (/h/…?from=push) now marks the children the reminder was for (the bot's answer:
 * kids[].round, class-link's own field). Two things on the page side:
 *  - the landed step counts them: web_quiz.push_landed{page:'hub'} gains `ready_n` (how many chips the bot marked),
 *    inside data_json (never a new top-level log field), once per landing, only when the bot answered with children;
 *    /q/ and /j/ landings are logged as before;
 *  - hub.js's "Who is playing?" draws /j/'s badge on a marked chip ("Quiz ready" / «کوئز تیار», class-link.js's words
 *    and markup), and an unmarked chip exactly as before.
 * The router runs whole with a fake bot (the network boundary); hub.js runs whole in a vm with a small fake DOM.
 * Invented children only.
 */
jest.mock('../../bot/shared/config/supabase', () => ({}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const express = require('express');
const R = require('../routes/web-quiz.routes');

const TOKEN = `${'A'.repeat(20)}.${'B'.repeat(22)}`;
const KID = (n, round) => ({ chip: `000000000000000${n}`, first: ['', 'Sara', 'Fatima', 'Ali'][n], animal: 'owl', grade: 3, ...(round ? { round: true } : {}) });
const HUB = (kids) => ({ lang: 'en', kids, kid: null, teacher: null, again: [], recs: [], challenge: null, lib: null, brand: 'jugnu' });
const jsonRes = (body, status = 200) => ({ status, ok: status < 300, headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) }, text: async () => JSON.stringify(body) });

async function open(p, botBody, headers = {}) {
  const events = [];
  const app = express();
  app.set('trust proxy', 1);
  const fetchImpl = (url) => Promise.resolve(String(url).includes('/api/internal/wq/hub/') ? jsonRes(botBody) : jsonRes({ off: true }));
  app.use(R.createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'k', fetchImpl, logEvent: (e, d) => events.push([e, d]) }));
  const srv = await new Promise((r) => { const x = app.listen(0, () => r(x)); });
  let html = '';
  try {
    await new Promise((resolve, reject) => {
      const rq = http.request({ host: '127.0.0.1', port: srv.address().port, path: p, headers: { host: 'portal.example', ...headers } }, (res) => { res.setEncoding('utf8'); res.on('data', (c) => { html += c; }); res.on('end', resolve); });
      rq.on('error', reject); rq.end();
    });
    await new Promise((r) => setImmediate(r));
  } finally { await new Promise((r) => srv.close(r)); }
  return { landed: events.filter(([e]) => e === 'web_quiz.push_landed').map(([, d]) => d), html };
}
const inner = (d) => (d.data_json ? JSON.parse(d.data_json) : {});

describe('push_landed{page:"hub"} counts the marked chips (ready_n, inside data_json)', () => {
  test('two of three chips marked: one landing, ready_n 2, no new top-level field', async () => {
    const { landed } = await open(`/h/${TOKEN}?from=push`, HUB([KID(1, true), KID(2, true), KID(3)]));
    expect(landed).toHaveLength(1);
    expect(landed[0]).toMatchObject({ page: 'hub', kind: 'quiz_reminder', reason: 'quiz_reminder' });
    expect(landed[0].ready_n).toBeUndefined();
    expect(inner(landed[0])).toEqual({ ready_n: 2 });
  });
  test('with the phone\'s cookie: dh and ready_n side by side in data_json', async () => {
    const { landed } = await open(`/h/${TOKEN}?from=push`, HUB([KID(1, true), KID(2)]), { cookie: 'wq_dv=Zq3Lx9TbW0vK7pR2sN5mYe' });
    expect(Object.keys(inner(landed[0])).sort()).toEqual(['dh', 'ready_n']);
    expect(inner(landed[0]).ready_n).toBe(1);
  });
  test('children, none marked: ready_n 0', async () => {
    const { landed } = await open(`/h/${TOKEN}?from=push`, HUB([KID(1), KID(2)]));
    expect(inner(landed[0])).toEqual({ ready_n: 0 });
  });
  test('the bot answered no children (off, closed): still one landing, no ready_n', async () => {
    const { landed } = await open(`/h/${TOKEN}?from=push`, { off: true });
    expect(landed).toEqual([{ page: 'hub', kind: 'quiz_reminder', reason: 'quiz_reminder' }]);
  });
  test('no from=push: nothing logged; /j/ and /q/ landings as before (no ready_n)', async () => {
    expect((await open(`/h/${TOKEN}`, HUB([KID(1, true)]))).landed).toEqual([]);
    expect((await open('/j/ABCD1234?from=push', HUB([KID(1, true)]))).landed).toEqual([{ page: 'class_link', kind: 'quiz_reminder', reason: 'quiz_reminder' }]);
    expect((await open('/q/ABC123?from=push', HUB([KID(1, true)]))).landed).toEqual([{ page: 'quiz', kind: 'quiz_reminder', reason: 'quiz_reminder' }]);
  });
});

/* ---------------- hub.js: the picker draws the mark ---------------- */
const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'hub.js'), 'utf8');
const TEL = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'wq-tel.js'), 'utf8');
const CLINK = fs.readFileSync(path.join(__dirname, '..', 'public', 'wq', 'class-link.js'), 'utf8');

function picker(boot) {
  const root = { _h: '', attrs: {}, set innerHTML(h) { this._h = h; }, get innerHTML() { return this._h; }, setAttribute(k, v) { this.attrs[k] = v; }, appendChild() {}, querySelector() { return null; }, querySelectorAll() { return []; } };
  const docEl = { attrs: { lang: boot.lang, dir: boot.lang === 'ur' ? 'rtl' : 'ltr' }, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; }, classList: { toggle() {}, contains: () => false, add() {}, remove() {} }, className: '' };
  const ctx = {
    document: { documentElement: docEl, getElementById: (id) => (id === 'wq' ? root : { textContent: JSON.stringify(boot) }), createElement: () => ({ setAttribute() {}, textContent: '' }), cookie: '' },
    window: { scrollTo() {}, addEventListener() {} },
    navigator: { sendBeacon: () => true },
    history: { replaceState() {} },
    location: { search: '?from=push', assign() {}, reload() {} },
    Blob: function Blob(parts) { this.parts = parts; },
    fetch: () => Promise.resolve({ status: 200, ok: true, text: () => Promise.resolve('{}') }),
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    setTimeout: () => 0, Date, JSON, Math, String, Number, Array, Object, Promise, isFinite, encodeURIComponent,
  };
  vm.createContext(ctx);
  vm.runInContext(TEL, ctx);
  vm.runInContext(SRC, ctx);
  return root._h;
}
const chipHtml = (html, n) => (new RegExp(`<button class="wq-kid" data-chip="000000000000000${n}">.*?</button>`).exec(html) || [''])[0];
const boot = (lang, kids) => ({ ...HUB(kids), lang, token: TOKEN, brand: null });

describe('hub.js "Who is playing?": the reminder\'s children carry /j/\'s badge', () => {
  test('a marked chip: the name and "Quiz ready" stacked inside the chip, class-link\'s markup', () => {
    const html = picker(boot('en', [KID(1, true), KID(2, true), KID(3)]));
    expect(chipHtml(html, 1)).toContain('<span class="wq-cl-nm"><bdi>Sara</bdi><span class="wq-chip wq-cl-ready">Quiz ready</span></span>');
    expect(chipHtml(html, 2)).toContain('wq-cl-ready');
    expect(chipHtml(html, 3)).not.toContain('wq-cl-');
  });
  test('Urdu: class-link\'s own Urdu words', () => {
    const html = picker(boot('ur', [KID(1, true)]));
    expect(chipHtml(html, 1)).toContain('<span class="wq-chip wq-cl-ready">کوئز تیار</span>');
  });
  test('the words are class-link\'s, not rewritten', () => {
    const cl = /quiz_ready: '([^']+)'/g;
    const words = [...CLINK.matchAll(cl)].map((m) => m[1]);
    expect(words).toEqual(['Quiz ready', 'کوئز تیار']);
    words.forEach((w) => expect(SRC).toContain(`'${w}'`));
  });
  test('no marks: every chip exactly as before (animal, then the name, nothing else)', () => {
    const html = picker(boot('en', [KID(1), KID(2)]));
    expect(chipHtml(html, 1)).toBe('<button class="wq-kid" data-chip="0000000000000001"><span class="wq-ani">🦉</span>Sara</button>');
    expect(html).not.toContain('wq-cl-');
  });
});
