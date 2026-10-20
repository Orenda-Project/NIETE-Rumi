'use strict';
/**
 * The page switches in one read (app_settings web_quiz_page_keep, with web_quiz_page_warm; default off, fail off).
 *
 * Each page switch reader keeps its own 30 s cache and makes its own read when it goes stale, so a page on a process
 * that was quiet for half a minute made ~16 settings reads. A reader that asks through rows()/row() names its keys
 * here; with the switch on, page_warm's own touch (web-quiz-page-warm.js) reads every named key in one read every
 * KEEP_MS and hands the rows to take(). A reader whose keys were all in a read younger than FRESH_MS gets those rows
 * (the same `{ data, error }` its query answers) and makes no read; any other reader reads as today.
 *
 * Off, no snapshot is ever taken, and every reader makes today's own read. A switch flipped in the table reaches a
 * reader within FRESH_MS plus that reader's own cache life (~45 s for a 30 s cache).
 */
const FRESH_MS = 15 * 1000; // the 10 s read, plus room for the next one still on its way
const KEEP_MS = 10 * 1000;

const asked = new Set(); // every key a reader named
let snap = null;         // { at, keys: Set, rows: Map key → value }

const copy = (v) => (v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v);

function served(keys, now) {
  for (const k of keys) asked.add(k);
  if (!snap || now - snap.at >= FRESH_MS || now < snap.at) return null;
  if (!keys.every((k) => snap.keys.has(k))) return null;
  return keys.filter((k) => snap.rows.has(k)).map((k) => ({ key: k, value: copy(snap.rows.get(k)) }));
}

/** A reader's `.in('key', keys)` (or `.eq('key', k)`) query: the snapshot's rows when it holds them all, else read(). */
function rows(keys, read, now = Date.now()) {
  const got = served(keys, now);
  return got ? Promise.resolve({ data: got, error: null }) : read();
}

/** A reader's `.eq('key', key).maybeSingle()` query: the snapshot's row (or null) when it holds the key, else read(). */
function row(key, read, now = Date.now()) {
  const got = served([key], now);
  return got ? Promise.resolve({ data: got[0] || null, error: null }) : read();
}

/** Every key a reader has named so far. */
const keys = () => [...asked];

/** One read's rows for `readKeys`, taken at `at`. */
function take(data, readKeys, at = Date.now()) {
  snap = { at, keys: new Set(readKeys), rows: new Map((data || []).filter((r) => r && readKeys.includes(r.key)).map((r) => [r.key, r.value])) };
}

function clear() { snap = null; }

module.exports = { rows, row, keys, take, clear, FRESH_MS, KEEP_MS, _reset: () => { snap = null; asked.clear(); } };
