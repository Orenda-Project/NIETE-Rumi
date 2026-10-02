/**
 * check-play — the simulated coach does the check Flow for one child, the way Meta's client would.
 *
 *   INIT                       → URDU, pre-filled by L6's endpoint from the block's ai_marks
 *   data_exchange per screen   → URDU, ENGLISH, MATHS; each posts the screen's own init values back,
 *                                changed only where the coach model acts
 *   DONE                       → the caller sends the nfm_reply completion to the webhook (response_json)
 *
 * The coach model (seeded) decides every visible field against the fixture's key:
 *   an EMPTY required field                 → the coach enters the key's value              (fill_empty)
 *   a PRE-FILLED field that disagrees with  → corrected with probability catchP (correct), else left
 *     the key beyond L5's tolerance           (missed — logged, costs nothing)
 *   a pre-filled field that agrees          → confirmed: nothing beyond the screen's confirm
 *   a field the key has no value for        → an empty one gets a neutral answer (no_key); a filled one is left
 * "Disagrees" is eval-compare.js (L5's bands: story ±5, quick sums ±3, fallback ±3, items exact after
 * none → wrong). Every action is priced from coach-actions.json, so a child's check time is the sum of
 * the actions plus the measured round trips.
 *
 * Transport: flow-emulator's FlowTransport (RSA-OAEP + AES-GCM, the client's contract) with the PUBLIC
 * half of the bot's Flow key. Mock mode posts to the local bot; sandbox mode only to the sandbox host.
 * Children are fixture ids here; nothing reads or logs a name.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { withinTolerance, verdictAgrees } = require('../../../../scripts/child-test/eval-compare');
const { assertSafeTarget } = require('./transports');

const SCREEN_BLOCK = { URDU: 'urdu', ENGLISH: 'english', MATHS: 'maths' };
const PREFIX = { urdu: 'u_', english: 'e_', maths: 'm_' };
// how many item slots each screen has (check-flow/slots.js)
const SLOTS = require('../../../shared/services/child-test/check-flow/slots');
const SANDBOX_ENDPOINT = 'https://bot-sandbox.up.railway.app/api/flows/child-test-check';
const SANDBOX_HOSTS = ['bot-sandbox.up.railway.app'];
const ENDPOINT_PATH = '/api/flows/child-test-check';

const ACTIONS_FILE = path.join(__dirname, 'coach-actions.json');
const ACTIONS_JSON = JSON.parse(fs.readFileSync(ACTIONS_FILE, 'utf8'));
const ACTION_SOURCES = Object.fromEntries(Object.entries(ACTIONS_JSON.actions).map(([k, v]) => [k, v.source]));

function loadActionCosts(file = ACTIONS_FILE) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Object.fromEntries(Object.entries(j.actions).map(([k, v]) => [k, Number(v.seconds)]));
}

/** mulberry32: a small seeded PRNG, so one seed replays the same coach. */
function makeRng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const has = (v) => v !== undefined && v !== null && v !== '';
const byId = (list, id) => (Array.isArray(list) ? list.find((x) => x && x.id === id) : null) || null;
// the answer sets a radio accepts (check-flow/prefill.js VERDICTS / WRITTEN)
const toVerdict = (v) => (v === 'correct' || v === 'wrong' || v === 'none' ? v : (v == null ? null : 'none'));

/** What the screen arrived with, posted back as-is (L6's endpoint.test.js#posted does the same). */
function postedFrom(screen, data) {
  const p = PREFIX[SCREEN_BLOCK[screen]];
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    const m = k.match(/^(wc|wa|fl|fw|sw|qc|qa|wp|q\d|fs\d|nw\d|n\d|w\d)_i$/);
    if (m) out[`${p}${m[1]}`] = v;
  }
  for (const [k, f] of [['flag_on', 'flag'], ['nwc_on', 'nwc'], ['numc_on', 'numc']]) if (Array.isArray(data[k])) out[`${p}${f}`] = data[k].map(String);
  return out;
}

/**
 * One screen: what the coach posts, and every action it took.
 * @param {{screen:string, data:object, key:object, items:object|null, rng:Function, catchP:number, costs:object}} o
 */
function coachFill({ screen, data, key, items, rng, catchP = 0.9, costs }) {
  const block = SCREEN_BLOCK[screen];
  if (!block) throw new Error(`coachFill: unknown screen ${screen}`);
  const p = PREFIX[block];
  const posted = postedFrom(screen, data);
  const actions = [{ action: 'confirm_screen', screen, cost_s: costs.confirm_screen }];
  const kb = block === 'maths' ? (((key.blocks || {}).maths || {}).maths || {}) : ((key.blocks || {})[block] || {});
  const it = (items && items[block]) || {};
  const act = (action, field, reason, extra = {}) => actions.push({ action, screen, field, reason, cost_s: reason === 'missed' ? 0 : costs[action], ...extra });
  const caught = () => rng() < catchP;

  function count(field, keyVal, tolField) {
    const f = `${p}${field}`; const init = data[`${field}_i`];
    if (keyVal == null || !Number.isFinite(Number(keyVal))) {
      if (!has(init)) { posted[f] = '0'; act('type_count', f, 'no_key'); }
      return;
    }
    if (!has(init)) { posted[f] = String(keyVal); act('type_count', f, 'fill_empty', { key: keyVal }); return; }
    if (withinTolerance(tolField, init, keyVal)) return;
    if (caught()) { posted[f] = String(keyVal); act('type_count', f, 'correct', { ai: init, key: keyVal }); } else act('type_count', f, 'missed', { ai: init, key: keyVal });
  }

  function radio(field, keyVal, cmpField) {
    const f = `${p}${field}`; const init = data[`${field}_i`];
    if (keyVal == null) {
      if (!has(init)) { posted[f] = cmpField === 'maths.written' ? 'unreadable' : 'none'; act('choose_radio', f, 'no_key'); }
      return;
    }
    if (!has(init)) { posted[f] = keyVal; act('choose_radio', f, 'fill_empty', { key: keyVal }); return; }
    if (verdictAgrees(cmpField, init, keyVal)) return;
    if (caught()) { posted[f] = keyVal; act('choose_radio', f, 'correct', { ai: init, key: keyVal }); } else act('choose_radio', f, 'missed', { ai: init, key: keyVal });
  }

  /** wrongOf(id) → true (key: read wrong) | false (read right) | null (no key: leave the chip alone). */
  function chips(field, wrongOf) {
    const f = `${p}${field}`;
    const on = new Set((posted[f] || []).map(String));
    for (const opt of data[`${field}_opts`] || []) {
      const want = wrongOf(opt.id);
      if (want == null || want === on.has(opt.id)) continue;
      if (caught()) { if (want) on.add(opt.id); else on.delete(opt.id); act('tick_chip', `${f}:${opt.id}`, 'correct', { key: want ? 'wrong' : 'correct' }); } else act('tick_chip', `${f}:${opt.id}`, 'missed', { key: want ? 'wrong' : 'correct' });
    }
    posted[f] = [...on];
  }

  const items3 = (list, field, n, cmpField, keyList, map = toVerdict) => {
    for (let i = 1; i <= n; i += 1) {
      if (!data[`${field}${i}_v`]) continue;
      const item = (list || [])[i - 1];
      const k = item ? byId(keyList, item.id) : null;
      radio(`${field}${i}`, k && k.verdict != null ? map(k.verdict) : null, cmpField);
    }
  };
  const itemWrong = (keyList) => (id) => { const k = byId(keyList, id); return k && k.verdict != null ? k.verdict !== 'correct' : null; };

  if (block === 'maths') {
    if (data.numc_v) chips('numc', itemWrong(kb.numbers));
    items3(it.numbers, 'n', SLOTS.maths.n, 'numbers', kb.numbers);
    const qs = kb.quick_sums || null;
    count('qc', qs && qs.correct, 'maths.quick_sums.correct');
    count('qa', qs && qs.attempted, 'maths.quick_sums.attempted');
    items3(it.written, 'w', SLOTS.maths.w, 'maths.written', kb.written, (v) => v);
    if (data.wp_v) {
      const wp = kb.word_problem;
      radio('wp', wp && wp.verdict != null ? (wp.verdict === 'correct' ? 'correct' : wp.verdict === 'wrong' ? 'wrong' : 'none') : null, 'word_problem');
    }
  } else {
    const story = kb.story || null;
    if (data.story_v) {
      count('wc', story && story.words_correct, 'story.words_correct');
      count('wa', story && story.words_attempted, 'story.words_attempted');
    }
    if (data.fb_v) {
      const fb = kb.fallback || null;
      count('fl', fb && fb.letters && fb.letters.correct, 'fallback.letters');
      count('fw', fb && fb.words && fb.words.correct, 'fallback.words');
    }
    const keyWrongIdx = story ? new Set((story.flagged || []).map((f) => `w${f.idx}`)) : null;
    if (data.flag_v) chips('flag', (id) => (keyWrongIdx ? keyWrongIdx.has(id) : null));
    if (data.sw_v) {
      // one flagged word, shown as a radio: its index is not on the screen, its word is (in the label)
      const hit = story ? (story.flagged || []).some((f) => f.word && String(data.sw_t || '').includes(f.word)) : null;
      radio('sw', hit == null ? null : (hit ? 'wrong' : 'correct'), 'story.flagged');
    }
    items3(it.questions, 'q', SLOTS[block].q, 'questions', kb.questions);
    if (SLOTS[block].fs && data.fs_sec_v) items3(it.first_sounds, 'fs', SLOTS[block].fs, 'first_sounds', kb.first_sounds);
    if (data.nwc_v) chips('nwc', itemWrong(kb.nonwords));
    items3(it.nonwords, 'nw', SLOTS[block].nw, 'nonwords', kb.nonwords);
  }
  return { posted, actions };
}

/** A screen L6 sent back with field errors: the coach reads each and fixes it. */
function fixErrors({ screen, errors, posted, key, costs }) {
  const block = SCREEN_BLOCK[screen]; const p = PREFIX[block];
  const actions = [];
  for (const f of Object.keys(errors || {})) {
    const field = f.slice(p.length);
    // "more correct than tried": a coach raises "tried" to the count they are sure of
    if ((field === 'wc' || field === 'qc') && Number(posted[f]) > Number(posted[`${p}${field === 'wc' ? 'wa' : 'qa'}`])) {
      posted[`${p}${field === 'wc' ? 'wa' : 'qa'}`] = String(posted[f]);
    } else if (/^(wc|wa|fl|fw|qc|qa)$/.test(field)) {
      if (!/^\d+$/.test(String(posted[f] || ''))) posted[f] = '0';
    } else if (!has(posted[f])) {
      posted[f] = /^w\d$/.test(field) && block === 'maths' ? 'unreadable' : 'none';
    }
    actions.push({ action: 'fix_error', screen, field: f, reason: 'field_error', cost_s: costs.fix_error });
  }
  return actions;
}

function savedLine(line) {
  const { checkStrings } = require('../../../shared/services/child-test/check-flow/strings');
  return ['ur', 'en'].some((l) => checkStrings(l).done_saved === line);
}

/**
 * The whole check for one child.
 * @returns {Promise<{ok:boolean, reason?:string, screens:string[], actions:object[], rtts:object[], check_s:number,
 *   session_id?:string, response_json?:object}>}
 */
async function playCheck({ token, url, transport, key, items, rng, catchP = 0.9, costs, clock = Date.now, maxRetries = 2 }) {
  const actions = [{ action: 'open_check', cost_s: costs.open_check }];
  const rtts = []; const screens = [];
  const result = (extra) => {
    const check_s = Math.round((actions.reduce((a, x) => a + (x.cost_s || 0), 0) + rtts.reduce((a, x) => a + x.ms, 0) / 1000) * 1000) / 1000;
    return { screens, actions, rtts, check_s, ...extra };
  };
  const call = async (payload) => {
    const t0 = clock();
    const res = await transport.exchange(url, payload);
    rtts.push({ action: payload.action, screen: payload.screen || null, ms: clock() - t0 });
    return res;
  };
  let res = await call({ version: '3.0', action: 'INIT', flow_token: token });
  if (!res || !res.screen) return result({ ok: false, reason: 'no_screen' });
  if (res.data && res.data.sec_v === false) return result({ ok: false, reason: 'unavailable (the endpoint knows no session for this token)' });
  while (res.screen !== 'DONE') {
    const screen = res.screen;
    if (!SCREEN_BLOCK[screen]) return result({ ok: false, reason: `unexpected screen ${screen}` });
    screens.push(screen);
    const fill = coachFill({ screen, data: res.data || {}, key, items, rng, catchP, costs });
    actions.push(...fill.actions);
    let next = await call({ version: '3.0', action: 'data_exchange', flow_token: token, screen, data: { screen, ...fill.posted } });
    for (let tries = 0; next.screen === screen && tries < maxRetries; tries += 1) {
      const errors = (next.data && next.data.error_messages) || {};
      if (!Object.keys(errors).length) break;
      actions.push(...fixErrors({ screen, errors, posted: fill.posted, key, costs }));
      next = await call({ version: '3.0', action: 'data_exchange', flow_token: token, screen, data: { screen, ...fill.posted } });
    }
    if (next.screen === screen) return result({ ok: false, reason: `screen ${screen} refused`, errors: next.data && next.data.error_messages });
    res = next;
  }
  screens.push('DONE');
  const sessionId = res.data && res.data.session_id;
  if (!sessionId || !savedLine(res.data.done_line)) return result({ ok: false, reason: 'DONE without a save (not saved / not available)' });
  actions.push({ action: 'submit', cost_s: costs.submit });
  return result({ ok: true, session_id: sessionId, response_json: { flow_token: token, child_test: 'checked', session_id: sessionId } });
}

function endpointFor({ mode, botUrl, flowEndpoint }) {
  if (mode === 'sandbox') {
    const url = flowEndpoint || SANDBOX_ENDPOINT;
    assertSafeTarget(url, SANDBOX_HOSTS);
    return url;
  }
  if (!botUrl) throw new Error('endpointFor: mock mode needs the local bot url');
  return flowEndpoint || String(botUrl).replace(/\/+$/, '') + ENDPOINT_PATH;
}

/** The PUBLIC half of the bot's Flow key, from FLOW_PRIVATE_KEY / FLOW_PRIVATE_KEY_B64 / FLOW_PUBLIC_KEY_B64. */
function publicKeyFrom(env = process.env) {
  if (env.FLOW_PUBLIC_KEY_B64) return Buffer.from(env.FLOW_PUBLIC_KEY_B64, 'base64').toString('utf8');
  const priv = env.FLOW_PRIVATE_KEY && env.FLOW_PRIVATE_KEY.includes('BEGIN') ? env.FLOW_PRIVATE_KEY
    : (env.FLOW_PRIVATE_KEY_B64 ? Buffer.from(env.FLOW_PRIVATE_KEY_B64, 'base64').toString('utf8') : null);
  if (!priv) throw new Error('publicKeyFrom: no FLOW_PUBLIC_KEY_B64 / FLOW_PRIVATE_KEY(_B64) in the env');
  return crypto.createPublicKey(priv).export({ type: 'spki', format: 'pem' }).toString();
}

module.exports = { coachFill, fixErrors, playCheck, endpointFor, publicKeyFrom, makeRng, loadActionCosts, postedFrom, ACTION_SOURCES, SANDBOX_ENDPOINT };
