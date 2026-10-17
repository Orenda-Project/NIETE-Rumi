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
 *   owns({ device, chosenId, binds? })                 does THIS phone hold a live link it made for this child? (the
 *                                                      grown-ups corner's "Forget this phone" row, the link's whole life)
 *   forget({ device, kid })                            that row's tap (POST /bind/undo {from:'home', kid}): the same
 *                                                      erase as undo, for the child whose home chip is `kid` → {ok:true}
 *
 * Undo erases the phone from that binding only: the child's row, runs and other bindings stay (IDENTITY §9.3). The
 * device decides nothing about WHO the child is; it only proves the Undo comes from the phone that joined (a forwarded
 * home link opens on another phone and finds nothing). No phone in a key or a log line; 0 WhatsApp messages.
 * Never throws.
 *
 * With `web_quiz_remember_column` on, the join also keeps the device's hash on the binding row (device_hash, the same
 * hash as the keys here) and the row is read first, the cache second: "Forget this phone" survives a cache flush or
 * outage, and a line the cache lost is still drawn once (the cache keeps only that it was shown). Off: cache only.
 */
const crypto = require('crypto');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const T = require('./web-quiz-token');
const K = require('./web-quiz-kid');

const PREFIX = 'wq:home:rem:';
const OWN = 'wq:home:own:';      // { list: [{ b, c, u }] }: the links this phone made, ≤ 4 children
const OWN_S = 400 * 86400;       // past the school year's end (31 March) and a renewal; the live link decides anyway
const KEEP_S = 30 * 60;          // the join's redirect lands within seconds; a slow phone still finds it
const UNDO_S = 10 * 60;          // after the line is shown, Undo stays possible this long (the page shows it 20 s)
const SHOW_S = 20;
const SRCS = Object.freeze(['join', 'bind']);

const hashOf = (d) => crypto.createHash('sha256').update(String(d)).digest('hex').slice(0, 32);
const keyOf = (d) => PREFIX + hashOf(d);
const ownKey = (d) => OWN + hashOf(d);

function store() {
  try {
    const redis = require('../cache/railway-redis.service');
    return redis && typeof redis.isAvailable === 'function' && redis.isAvailable() ? redis : null;
  } catch (_) {
    return null;
  }
}

const colOn = () => require('./web-quiz-remember-column-flag').on();
const Bindings = () => require('./child-phone-bindings.repo');
/** The live links this phone made, from the binding rows (web_quiz_remember_column on) → [{id, canonical_id, bound_at}]. */
const rowsOf = async (d) => ((await colOn()) ? Bindings().activeForDevice(hashOf(d)) : []);

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

async function ownList(redis, d) {
  try {
    const v = await redis.get(ownKey(d));
    const o = typeof v === 'string' ? JSON.parse(v) : v;
    return o && Array.isArray(o.list) ? o.list.filter((e) => e && e.b && e.c) : [];
  } catch (_) {
    return [];
  }
}
async function ownSet(redis, d, list) {
  if (list.length) await redis.set(ownKey(d), JSON.stringify({ list: list.slice(-4) }), OWN_S);
  else await redis.delete(ownKey(d));
}

/** Erase ONE live link this phone made: forget the door's verdict for the phone, bind_undo{via:'page'}. → the phone or null. */
async function erase(bindingId, canonicalId) {
  const Bindings = require('./child-phone-bindings.repo');
  const live = ((await Bindings.activeForChild(canonicalId)) || []).find((b) => String(b.id) === String(bindingId));
  if (!live) return { erased: false, phone: null };
  const erased = (await Bindings.eraseOne(bindingId, 'page_undo')) || [];
  const Sid = require('./student-identity.service');
  let phone = null;
  for (const e of erased) {
    if (e && e.phone_norm) {
      phone = phone || e.phone_norm;
      if (typeof Sid.forgetDoorVerdict === 'function') await Sid.forgetDoorVerdict(e.phone_norm, e.phone_norm);
    }
  }
  await K.emit('web_quiz.bind_undo', { w: 's', via: 'page', n: erased.length }, { canonicalId });
  return { erased: true, phone };
}

async function note({ device, bindingId, canonicalId, userId = null } = {}) {
  try {
    const d = T.cleanDeviceRef(device);
    if (!d || !bindingId || !canonicalId || !(await homeOn())) return false;
    // the row first: the device outlives a cache flush there (web_quiz_remember_column; off: nothing written)
    const marked = (await colOn()) && (await Bindings().markDevice(bindingId, hashOf(d)));
    const redis = store();
    if (!redis) return Boolean(marked);
    const entry = { b: String(bindingId), c: String(canonicalId), u: userId ? String(userId) : null };
    await redis.set(keyOf(d), JSON.stringify({ ...entry, s: 0 }), KEEP_S);
    await ownSet(redis, d, [...(await ownList(redis, d)).filter((e) => e.c !== entry.c), entry]);
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
    const rows = await rowsOf(d);
    const fresh = rows.find((r) => String(r.canonical_id) === String(chosenId) && Date.now() - new Date(r.bound_at).getTime() <= KEEP_S * 1000);
    // the cache lost the join's note: the row says which link this phone made in the last 30 min
    const o = (await read(redis, key)) || (fresh ? { b: String(fresh.id), c: String(fresh.canonical_id), u: null, s: 0 } : null);
    if (!o || o.s || o.c !== String(chosenId)) return {};
    // shown now: never again on this phone (a reload, Back, the next /quiz); Undo stays possible a while
    // (with the row read on, kept as long as the row stays "fresh", so the row never draws it a second time)
    await redis.set(key, JSON.stringify({ ...o, s: 1 }), fresh ? KEEP_S : UNDO_S);
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
    await ownSet(redis, d, (await ownList(redis, d)).filter((e) => e.b !== o.b));
    const { erased: done, phone } = await erase(o.b, o.c);
    if (!done) return none;
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

async function owns({ device, chosenId, binds = null } = {}) {
  try {
    const d = T.cleanDeviceRef(device);
    if (!d || !chosenId || !(await homeOn())) return false;
    if ((await rowsOf(d)).some((r) => String(r.canonical_id) === String(chosenId))) return true;
    const redis = store();
    if (!redis) return false;
    const mine = (await ownList(redis, d)).find((e) => e.c === String(chosenId));
    if (!mine) return false;
    const live = binds || (await require('./child-phone-bindings.repo').activeForChild(String(chosenId))) || [];
    return live.some((b) => b && String(b.id) === mine.b && !b.revoked_at);
  } catch (_) {
    return false;
  }
}

async function forget({ device, kid } = {}) {
  const none = { ok: false, error: 'not_bound' };
  try {
    const d = T.cleanDeviceRef(device);
    if (!d || typeof kid !== 'string' || !kid || !(await homeOn())) return none;
    const redis = store();
    const row = (await rowsOf(d)).find((r) => T.chipId('h', String(r.canonical_id)) === kid);
    if (row) {
      if (redis) {
        await ownSet(redis, d, (await ownList(redis, d)).filter((e) => e.c !== String(row.canonical_id)));
        const line = await read(redis, keyOf(d));
        if (line && line.b === String(row.id)) await redis.delete(keyOf(d));
      }
      return (await erase(row.id, String(row.canonical_id))).erased ? { ok: true } : none;
    }
    if (!redis) return none;
    const list = await ownList(redis, d);
    const mine = list.find((e) => T.chipId('h', e.c) === kid);
    if (!mine) return none;
    await ownSet(redis, d, list.filter((e) => e !== mine));
    const line = await read(redis, keyOf(d));
    if (line && line.b === mine.b) await redis.delete(keyOf(d));
    return (await erase(mine.b, mine.c)).erased ? { ok: true } : none;
  } catch (err) {
    logToFile('⚠️ home remember: forget failed', { error: err.message });
    return { ok: false, error: 'unavailable' };
  }
}

module.exports = { note, field, undo, owns, forget, SHOW_S, SRCS, _keyOf: keyOf };
