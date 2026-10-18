'use strict';
/**
 * The first opens a wordless first paint (web_quiz_plain_paint) changes, shared by its test and the recorder of its
 * OFF golden (plain-paint-off-golden.json, recorded on the code before the switch). Each scenario is a fresh portal
 * process and a fresh profile phone: no cookie, no device ref; the bot is a fake fetch (the network boundary).
 *
 * `plain`: whether the bot's answers say `plain_paint: true` (beside `fast: true`). Off, they are today's answers.
 */
const http = require('http');
const express = require('express');
const { createWebQuizRouter } = require('../../routes/web-quiz.routes');

function jsonRes(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

const QUIZ = (extra = {}) => ({
  quiz: {
    id: 'q-1', code: 'AB12CD', topic: 'Parts of a plant', lang: 'en', dir: 'ltr', grade: '3', subject: 'Science', n: 1,
    questions: [{ qid: 'x1', i: 1, text: 'Which part drinks water?', options: [{ slot: 'A', text: 'Roots' }, { slot: 'B', text: 'Leaves' }], correct_slot: 'A' }],
  },
  cls: { label: 'Class 3', teacher: 'Teacher', chips: [] },
  live: { class_today: 0, ict_today_floor: 40 },
  video: null,
  preview: false,
  brand: 'niete',
  rt: false,
  ...extra,
});
const URDU = (extra = {}) => {
  const q = QUIZ(extra);
  return { ...q, quiz: { ...q.quiz, code: 'UR12CD', topic: 'پودے کے حصے', lang: 'ur', dir: 'rtl' }, ui: { ur2: true } };
};
const TOKEN = 'eyJrIjoiaCIsImlkcyI6WyJhIl0sImV4cCI6OTk5OTk5OTk5OX0.AbCdEfGhIjKlMnOpQrStUv';
const HUB = (extra = {}) => ({
  lang: 'en', kids: [{ chip: '0123456789abcdef', first: 'Star Testwala', animal: 'owl', grade: '3' }], kid: '0123456789abcdef',
  teacher: null, again: [], recs: [], challenge: null, brand: 'niete', rt: false, ...extra,
});

const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });

function get(srv, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path, headers: { host: 'portal.example', ...headers } }, (res) => {
      const chunks = [];
      res.setEncoding('utf8');
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: chunks.join('') }));
    });
    r.on('error', reject);
    r.end();
  });
}

/** A portal process whose bot answers each call in turn from `answers`. */
async function edge(answers) {
  const fetchImpl = () => Promise.resolve(answers.shift());
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'test-internal-key', fetchImpl }));
  return start(app);
}

const on = (plain) => (plain ? { fast: true, plain_paint: true } : { fast: true });

/**
 * name → (plain) => the page the second open gets (the first open teaches the process the fast page, as on a phone
 * after any other child's open). Every scenario's second open is one of the guessed-head cases.
 */
const SCENARIOS = {
  // an Urdu class quiz this process has not seen (its link-preview facts are not cached here)
  q_miss_ur: (plain) => [[jsonRes(200, QUIZ(on(plain))), jsonRes(200, URDU(on(plain)))], ['/q/AB12CD', '/q/UR12CD']],
  // the same, opened from a link that names its language
  q_miss_ur_lang: (plain) => [[jsonRes(200, QUIZ(on(plain))), jsonRes(200, URDU(on(plain)))], ['/q/AB12CD', '/q/UR12CD?lang=ur']],
  // an Urdu class quiz this process has seen: its head is known from the first byte
  q_hit_ur: (plain) => [[jsonRes(200, URDU(on(plain))), jsonRes(200, URDU(on(plain)))], ['/q/UR12CD', '/q/UR12CD']],
  // an English class quiz this process has not seen
  q_miss_en: (plain) => [[jsonRes(200, URDU(on(plain))), jsonRes(200, QUIZ(on(plain)))], ['/q/UR12CD', '/q/AB12CD']],
  // an Urdu child's home on a phone set to English, from a link with no ?lang=
  h_ur_en_phone: (plain) => [[jsonRes(200, HUB(on(plain))), jsonRes(200, HUB({ ...on(plain), lang: 'ur' }))], [`/h/${TOKEN}`, `/h/${TOKEN}`], { 'accept-language': 'en-US,en;q=0.9' }],
  // an Urdu child's home from a link that names its language
  h_ur_lang: (plain) => [[jsonRes(200, HUB(on(plain))), jsonRes(200, HUB({ ...on(plain), lang: 'ur' }))], [`/h/${TOKEN}`, `/h/${TOKEN}?lang=ur`], { 'accept-language': 'en-US,en;q=0.9' }],
  // an English child's home on a phone set to Urdu, from a link with no ?lang=
  h_en_ur_phone: (plain) => [[jsonRes(200, HUB(on(plain))), jsonRes(200, HUB(on(plain)))], [`/h/${TOKEN}`, `/h/${TOKEN}`], { 'accept-language': 'ur-PK' }],
};

/** The second open's page, with the asset version written as V (it changes with any asset, not with this switch). */
async function run(name, plain) {
  const [answers, paths, headers = {}] = SCENARIOS[name](plain);
  const srv = await edge(answers);
  try {
    await get(srv, paths[0], headers);
    const res = await get(srv, paths[1], headers);
    return { status: res.status, body: res.body.replace(/\?v=[0-9a-f]+/g, '?v=V') };
  } finally {
    await new Promise((r) => srv.close(r));
  }
}

module.exports = { SCENARIOS, run, TOKEN };
