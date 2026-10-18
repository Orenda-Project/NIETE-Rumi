'use strict';
/**
 * The closed and "not open" child pages the closed-pages-language switch (web_quiz_closed_lang) changes, shared by its
 * test and the recorder of its OFF golden (closed-lang-off-golden.json, recorded on the code before the switch). Each
 * scenario is a fresh portal process: a first open the bot answers (it teaches the process the switch, as any other
 * child's open would), then the open under test. The bot is a fake fetch (the network boundary).
 *
 * `on`: whether the bot's answers say `closed_lang: true` and its 401 for a genuine expired home link says the
 * children's `lang`. Off, they are today's answers.
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
const AWAY = { away: true }; // the bot cannot be reached

const QUIZ = (extra = {}) => ({
  quiz: { id: 'q-1', code: 'UR12CD', topic: 'پودے کے حصے', lang: 'ur', dir: 'rtl', grade: '3', subject: 'Science', n: 1,
    questions: [{ qid: 'x1', i: 1, text: 'سوال', options: [{ slot: 'A', text: 'جڑ' }, { slot: 'B', text: 'پتا' }], correct_slot: 'A' }] },
  cls: { label: 'Class 3', teacher: 'Teacher', chips: [] },
  live: { class_today: 0, ict_today_floor: 40 }, video: null, preview: false, brand: 'niete', rt: false, ...extra,
});
const HUB = (extra = {}) => ({
  lang: 'ur', kids: [{ chip: '0123456789abcdef', first: 'Star Testwala', animal: 'owl', grade: '3' }], kid: '0123456789abcdef',
  teacher: null, again: [], recs: [], challenge: null, brand: 'niete', rt: false, ...extra,
});
// home links shaped as the bot signs them (payload.signature); `l` is the language of the reply that sent it
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const LINK_UR = `${b64({ k: 'h', ids: ['a'], l: 'ur', exp: 9999999999 })}.AbCdEfGhIjKlMnOpQrStUv`;
const LINK_BARE = `${b64({ k: 'h', ids: ['a'], exp: 9999999999 })}.AbCdEfGhIjKlMnOpQrStUv`;
const EN_PHONE = { 'accept-language': 'en-US,en;q=0.9' };

const start = (app) => new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
function get(srv, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.address().port, method: 'GET', path, headers: { host: 'portal.example', ...headers } }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    r.on('error', reject);
    r.end();
  });
}
async function edge(answers) {
  const fetchImpl = () => { const a = answers.shift(); return a === AWAY ? Promise.reject(new Error('ECONNREFUSED')) : Promise.resolve(a); };
  const app = express();
  app.set('trust proxy', 1);
  app.use(createWebQuizRouter({ botUrl: 'http://bot.test', apiKey: 'test-internal-key', fetchImpl }));
  return start(app);
}

const learn = (on) => (on ? { closed_lang: true } : {});
const said = (on, lang) => (on ? { lang } : {});

/** name → (on) => [the bot's answers, [first path, path under test], headers] */
const SCENARIOS = {
  // an Urdu child's expired home link on a phone set to English: the bot knows the children (401 with their language)
  h_expired_en_phone: (on) => [[jsonRes(200, HUB(learn(on))), jsonRes(401, { error: 'bad_token', ...said(on, 'ur') })], [`/h/${LINK_BARE}`, `/h/${LINK_BARE}`], EN_PHONE],
  // the bot away: the link's own `l`
  h_away_link_l: (on) => [[jsonRes(200, HUB(learn(on))), AWAY], [`/h/${LINK_UR}`, `/h/${LINK_UR}`], EN_PHONE],
  // the bot answers 503: the link's own `l`
  h_503_link_l: (on) => [[jsonRes(200, HUB(learn(on))), jsonRes(503, { error: 'web_quiz_off' })], [`/h/${LINK_UR}`, `/h/${LINK_UR}`], EN_PHONE],
  // the bot away, a link with no `l` but ?lang=ur
  h_away_query: (on) => [[jsonRes(200, HUB(learn(on))), AWAY], [`/h/${LINK_BARE}`, `/h/${LINK_BARE}?lang=ur`], EN_PHONE],
  // the bot away, a link with no `l` and no ?lang=: the phone's language, as today
  h_away_phone: (on) => [[jsonRes(200, HUB(learn(on))), AWAY], [`/h/${LINK_BARE}`, `/h/${LINK_BARE}`], EN_PHONE],
  // a garbled home link: today's page, the phone's language
  h_garbled: (on) => [[jsonRes(200, HUB(learn(on)))], [`/h/${LINK_UR}`, '/h/not-a-token'], EN_PHONE],
  // an Urdu class code this process has opened, then the bot away
  q_away_known: (on) => [[jsonRes(200, QUIZ(learn(on))), AWAY], ['/q/UR12CD', '/q/UR12CD'], EN_PHONE],
  // an Urdu class code this process has opened, then the bot answers 500
  q_500_known: (on) => [[jsonRes(200, QUIZ(learn(on))), jsonRes(500, { error: 'server_error' })], ['/q/UR12CD', '/q/UR12CD'], EN_PHONE],
  // a class code this process has not opened, the bot away, the link names its language
  q_away_query: (on) => [[jsonRes(200, QUIZ(learn(on))), AWAY], ['/q/UR12CD', '/q/ZZ34EF?lang=ur'], EN_PHONE],
  // a class code this process has not opened, the bot away, nothing known: English, as today
  q_away_unknown: (on) => [[jsonRes(200, QUIZ(learn(on))), AWAY], ['/q/UR12CD', '/q/ZZ34EF'], EN_PHONE],
};

/** The page under test, with the asset version written as V. */
async function run(name, on) {
  const [answers, paths, headers = {}] = SCENARIOS[name](on);
  const srv = await edge(answers);
  try {
    await get(srv, paths[0], headers);
    const res = await get(srv, paths[1], headers);
    return { status: res.status, body: res.body.replace(/\?v=[0-9a-f]+/g, '?v=V') };
  } finally {
    await new Promise((r) => srv.close(r));
  }
}

module.exports = { SCENARIOS, run };
