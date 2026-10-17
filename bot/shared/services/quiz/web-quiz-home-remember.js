'use strict';
/**
 * "Jugnu will remember you on this phone" — the first home after a child joins on their own (app_settings
 * `web_quiz_home_v3`, default OFF). A self-join binds the phone with no page-minted code, so the code-keyed Undo of
 * keep-my-place has nothing to find; this module keeps, for the phone that joined, which ONE binding the join made.
 *
 *   note({ device, bindingId, canonicalId, userId })   the join (or the "Is it you?" sheet) made a NEW binding: kept
 *                                                      under the device's hash for 30 min. Switch off: nothing kept.
 *   field({ device, chosenId, src })                   the hub's first open of that home (src join | bind, the same
 *                                                      phone, the same child) → { remember: { s: 20 } } ONCE; else {}
 *   undo({ device, lang })                             the line's Undo (POST /bind/undo {from:'join'}): erases THAT
 *                                                      binding (revoked_by page_undo), forgets the door's verdict,
 *                                                      bind_undo{via:'page'} → { ok:true, next } (next = the "who are
 *                                                      you?" page, or null) | { ok:false, error:'not_bound' }
 *
 * Undo erases the phone from that binding only: the child's row, runs and other bindings stay (IDENTITY §9.3). The
 * device decides nothing about WHO the child is; it only proves the Undo comes from the phone that joined (a forwarded
 * home link opens on another phone and finds nothing). No phone in a key or a log line; 0 WhatsApp messages.
 * Never throws.
 */
const crypto = require('crypto');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const T = require('./web-quiz-token');
const K = require('./web-quiz-kid');

const PREFIX = 'wq:home:rem:';
const KEEP_S = 30 * 60;          // the join's redirect lands within seconds; a slow phone still finds it
const UNDO_S = 10 * 60;          // after the line is shown, Undo stays possible this long (the page shows it 20 s)
const SHOW_S = 20;
const SRCS = Object.freeze(['join', 'bind']);

const keyOf = (d) => PREFIX + crypto.createHash('sha256').update(String(d)).digest('hex').slice(0, 32);

function store() {
  try {
    const redis = require('../cache/railway-redis.service');
    return redis && typeof redis.isAvailable === 'function' && redis.isAvailable() ? redis : null;
  } catch (_) {
    return null;
  }
}

async function homeOn() {
  try { return Boolean((await require('./web-quiz-home-flags').flags()).home); } catch (_) { return false; }
}

async function read(redis, key) {
  try {
    const v = await redis.get(key);
    const o = typeof v === 'string' ? JSON.parse(v) : v;
    return o && o.b && o.c ? o : null;
  } catch (_) {
    return null;
  }
}

async function note({ device, bindingId, canonicalId, userId = null } = {}) {
  try {
    const d = T.cleanDeviceRef(device);
    const redis = store();
    if (!d || !bindingId || !canonicalId || !redis || !(await homeOn())) return false;
    await redis.set(keyOf(d), JSON.stringify({ b: String(bindingId), c: String(canonicalId), u: userId ? String(userId) : null, s: 0 }), KEEP_S);
    return true;
  } catch (err) {
    logToFile('⚠️ home remember: not kept (the home draws no line)', { error: err.message });
    return false;
  }
}

async function field({ device, chosenId, src } = {}) {
  try {
    if (!SRCS.includes(src) || !chosenId) return {};
    const d = T.cleanDeviceRef(device);
    const redis = store();
    if (!d || !redis || !(await homeOn())) return {};
    const key = keyOf(d);
    const o = await read(redis, key);
    if (!o || o.s || o.c !== String(chosenId)) return {};
    // shown now: never again on this phone (a reload, Back, the next /quiz); Undo stays possible a while
    await redis.set(key, JSON.stringify({ ...o, s: 1 }), UNDO_S);
    await K.emit('web_quiz.home_remember', { shown: true, src }, { canonicalId: o.c, device: d });
    return { remember: { s: SHOW_S } };
  } catch (err) {
    logToFile('⚠️ home remember: field unavailable', { error: err.message });
    return {};
  }
}

async function undo({ device, lang = 'en' } = {}) {
  const none = { ok: false, error: 'not_bound' };
  try {
    const d = T.cleanDeviceRef(device);
    const redis = store();
    if (!d || !redis || !(await homeOn())) return none;
    const key = keyOf(d);
    const o = await read(redis, key);
    if (!o || !o.s) return none;
    await redis.delete(key);
    const Bindings = require('./child-phone-bindings.repo');
    const live = ((await Bindings.activeForChild(o.c)) || []).find((b) => String(b.id) === o.b);
    if (!live) return none;
    const erased = (await Bindings.eraseOne(o.b, 'page_undo')) || [];
    const Sid = require('./student-identity.service');
    let phone = null;
    for (const e of erased) {
      if (e && e.phone_norm) {
        phone = phone || e.phone_norm;
        if (typeof Sid.forgetDoorVerdict === 'function') await Sid.forgetDoorVerdict(e.phone_norm, e.phone_norm);
      }
    }
    await K.emit('web_quiz.bind_undo', { w: 's', via: 'page', n: erased.length }, { canonicalId: o.c });
    // the "who are you?" page, minted from the phone the binding held (never carried by the page)
    let next = null;
    try {
      const Door = require('../first-touch/one-door.service');
      next = phone ? await Door.mintLandingForPhone({ phoneNorm: phone, lang: lang === 'ur' ? 'ur' : 'bi', userId: o.u }) : null;
    } catch (_) {
      next = null;
    }
    return { ok: true, next: next || null };
  } catch (err) {
    logToFile('⚠️ home remember: undo failed', { error: err.message });
    logEvent('web_quiz.home_remember_failed', { at: 'undo' });
    return { ok: false, error: 'unavailable' };
  }
}

module.exports = { note, field, undo, SHOW_S, SRCS, _keyOf: keyOf };
