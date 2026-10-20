'use strict';
/**
 * The order of routes/edge-mounts.js never decides who answers: the list mounted forwards and reversed (every pair
 * swapped) on two bare apps, one representative page per router, answers the same — the same status, the same body,
 * the same bot call (the handler's marker) — with the switch on, and with it off every request falls through to what
 * is mounted after the list. The bot is the network boundary (a fake fetch).
 */
const express = require('express');
const EDGE_MOUNTS = require('../routes/edge-mounts');

const BOT = 'http://bot.test';
const KEY = 'test-internal-key';
const TOK = 'eyJrIjoibSJ9eyJrIjoibSJ9.AAAAAAAAAAAAAAAAAAAAAA';   // fits every router's token shape
const PAGES = {
  'first-touch': `/m/${TOK}`,
  'quiz-go': `/quiz/go/${TOK}`,
  'quiz-join': `/quiz/join/${TOK}`,
  'quiz-teacher': `/quiz/teacher/${TOK}`,
  'sa-game': `/sa-game/${TOK}?kid=0123456789abcdef`,
};

function botRes(status, body, type) {
  return {
    status, ok: status >= 200 && status < 300,
    headers: { get: (h) => ({ 'content-type': type }[h.toLowerCase()] || null) },
    text: async () => body,
    json: async () => JSON.parse(body),
    arrayBuffer: async () => { const b = Buffer.from(body); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); },
  };
}

async function serve(entries, on) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url).replace(BOT, ''));
    if (on && String(url).includes('/join/')) return botRes(200, JSON.stringify({ ok: true, lang: 'en' }), 'application/json; charset=utf-8');
    return on ? botRes(200, `bot page ${String(url).replace(BOT, '')}`, 'text/html; charset=utf-8')
      : botRes(404, JSON.stringify({ off: true }), 'application/json; charset=utf-8');
  };
  const app = express();
  for (const [, file, make] of entries) {
    app.use(require(`../routes/${file}`)[make]({ botUrl: BOT, apiKey: KEY, fetchImpl, logEvent: () => {} }));
  }
  app.use((req, res) => res.status(299).send('after the list'));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { calls, srv, base: `http://127.0.0.1:${srv.address().port}` };
}

async function answers(entries, on) {
  const { calls, srv, base } = await serve(entries, on);
  try {
    const out = {};
    for (const [name] of entries) {
      const before = calls.length;
      const res = await fetch(`${base}${PAGES[name]}`, { redirect: 'manual' });
      out[name] = { status: res.status, body: await res.text(), bot: calls.slice(before) };
    }
    const other = await fetch(`${base}/not-an-edge-path`);
    out.other = { status: other.status, body: await other.text() };
    return out;
  } finally { srv.close(); }
}

test('every listed router has a representative page here', () => {
  expect(EDGE_MOUNTS.map(([n]) => n).filter((n) => !PAGES[n])).toEqual([]);
});

test('switch on: forwards and reversed answer the same, each page by its own router', async () => {
  const fwd = await answers(EDGE_MOUNTS, true);
  const rev = await answers([...EDGE_MOUNTS].reverse(), true);
  expect(rev).toEqual(fwd);
  for (const [name] of EDGE_MOUNTS) {
    expect(fwd[name].status).not.toBe(299);
    expect(fwd[name].bot).toHaveLength(1);
  }
  expect(new Set(EDGE_MOUNTS.map(([n]) => fwd[n].bot[0])).size).toBe(EDGE_MOUNTS.length);
  expect(fwd.other).toEqual({ status: 299, body: 'after the list' });
});

test('switch off: forwards and reversed both fall through to what follows the list', async () => {
  const fwd = await answers(EDGE_MOUNTS, false);
  const rev = await answers([...EDGE_MOUNTS].reverse(), false);
  expect(rev).toEqual(fwd);
  for (const [name] of EDGE_MOUNTS) expect(fwd[name]).toMatchObject({ status: 299, body: 'after the list' });
});
