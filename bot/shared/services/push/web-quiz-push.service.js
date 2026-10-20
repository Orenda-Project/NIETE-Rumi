'use strict';
/**
 * The reminder push: one table (web_quiz_push_subscriptions), one sender, for the child's "remind me tomorrow" on a
 * family phone (kind quiz_reminder, via family_phone) and the teacher's evening reminder (kind evening_plan, via
 * teacher_portal). Switches (app_settings, JSON true only, 30 s cache, fail closed; all OFF by default):
 *
 *   remind = web_quiz_push_remind && every env below set      the routes, the card, the due tick's sends
 *   test   = web_quiz_push_test   && remind                   "Send one now" on /remind/:code (sandbox QA only)
 *   portal = portal_push_remind   && remind                   the teacher card (car C)
 *
 * Env (sandbox only; never shared with staging or prod): WQ_PUSH_VAPID_PUBLIC, WQ_PUSH_VAPID_PRIVATE,
 * WQ_PUSH_VAPID_SUBJECT (VAPID), WQ_PUSH_ENC_KEY (32 bytes base64, AES-256-GCM of the endpoint and keys),
 * WQ_PUSH_HASH_SALT (HMAC-SHA256 of the endpoint, the lookup key).
 *
 *   switches(now)                          → {remind, test, portal}
 *   subscribe(input, {now})                → {ok:1} | {status:409, err:'class_phone'} | {status:400, err:'bad_sub'}
 *   unsubscribe({endpoint, by}) / markOpened({endpoint}, {now})   → {ok:1}
 *   payloadFor(row, {test})                → {t, b, url, tag, lang, test}: no name, no score, ever
 *   sendOne(row, payload, {webpush})       → {sent, status}; 404/410 revokes the row as `gone`
 *   sendTest({endpoint}, {webpush})        → {ok:1, sent, status} | {status:404, err:'off'}
 *   dueTick(now, {webpush})                → {sent, revoked}: due rows, one a school day, revoked after 5 unopened
 *   expireTick(now)                        → {expired, deleted}: runs whatever the switches say (retention)
 *
 * Logs carry kinds and counts only — never the endpoint or the keys.
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const HubDevice = require('../quiz/web-quiz-hub-device');

const TABLE = 'web_quiz_push_subscriptions';
const KEYS = Object.freeze({ remind: 'web_quiz_push_remind', test: 'web_quiz_push_test', portal: 'portal_push_remind' });
const ENV = Object.freeze(['WQ_PUSH_VAPID_PUBLIC', 'WQ_PUSH_VAPID_PRIVATE', 'WQ_PUSH_VAPID_SUBJECT', 'WQ_PUSH_ENC_KEY', 'WQ_PUSH_HASH_SALT']);
const OFF = Object.freeze({ remind: false, test: false, portal: false });
const TTL_MS = 30 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const PKT_MS = 5 * 60 * 60 * 1000;
const KEEP_DAYS = 90;
const KEEP_ERASED_MONTHS = 13;
const UNOPENED_MAX = 5;
const DUE_BATCH = 200;
// A slot missed by more than this (the worker was down) is moved to the next school day, never sent late at night.
const LATE_MS = 4 * 60 * 60 * 1000;
const HOUR_PKT = Object.freeze({ quiz_reminder: 16, evening_plan: 18 });
const CLASS_PHONE = 4;
const CODE_RX = /^[A-Za-z0-9_-]{3,32}$/;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEVICE_RX = /^[A-Za-z0-9_-]{22}$/;

// The words (jg.remind.push_* in the copy deck): a reminder never names a child.
const COPY = Object.freeze({
  quiz_reminder: {
    en: { t: 'Jugnu', b: "Today's quiz is ready. Tap to play.", test: 'Reminders are on.' },
    ur: { t: 'جگنو', b: 'آج کا کوئز تیار ہے۔ کھیلنے کے لیے دبائیں۔', test: 'یاد دہانی آن ہے۔' },
  },
  evening_plan: {
    en: { t: 'NIETE', b: 'Your plan for tomorrow is ready.', test: 'Reminders are on.' },
    ur: { t: 'NIETE', b: 'کل کا منصوبہ تیار ہے۔', test: 'یاد دہانی آن ہے۔' },
  },
});

// ─── switches ───────────────────────────────────────────────────────────────

let cache = null;
const envReady = () => ENV.every((k) => String(process.env[k] || '').trim() !== '');

async function switches(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.s;
  let s = OFF;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', Object.values(KEYS));
    if (error) throw new Error(error.message || 'app_settings read failed');
    const on = (k) => ((data || []).find((r) => r && r.key === k) || {}).value === true;
    const remind = on(KEYS.remind) && envReady();
    s = { remind, test: remind && on(KEYS.test), portal: remind && on(KEYS.portal) };
  } catch (err) {
    logToFile('⚠️ web quiz push: settings lookup failed — off', { error: err.message });
  }
  cache = { at: now, s };
  return s;
}

// ─── crypto ─────────────────────────────────────────────────────────────────

const hashEndpoint = (endpoint) => crypto.createHmac('sha256', String(process.env.WQ_PUSH_HASH_SALT || '')).update(String(endpoint)).digest('hex');
const encKey = () => {
  const k = Buffer.from(String(process.env.WQ_PUSH_ENC_KEY || ''), 'base64');
  if (k.length !== 32) throw new Error('WQ_PUSH_ENC_KEY must be 32 bytes');
  return k;
};
/** AES-256-GCM, a random 12-byte IV, stored as base64(iv | tag | ciphertext). */
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function decrypt(stored) {
  const buf = Buffer.from(String(stored), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', encKey(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

// ─── time ───────────────────────────────────────────────────────────────────

/** The next school day (Mon–Fri, PKT) after `now`'s PKT date, at the kind's hour PKT → ms. Never the same day. */
function nextAt(now, kind) {
  const pkt = new Date(now + PKT_MS);
  let day = Date.UTC(pkt.getUTCFullYear(), pkt.getUTCMonth(), pkt.getUTCDate()) + DAY_MS;
  while ([0, 6].includes(new Date(day).getUTCDay())) day += DAY_MS;
  return day + (HOUR_PKT[kind] || HOUR_PKT.quiz_reminder) * 60 * 60 * 1000 - PKT_MS;
}
const iso = (ms) => new Date(ms).toISOString();

function uaClass(ua) {
  const s = String(ua || '');
  if (/SamsungBrowser/i.test(s)) return 'samsung';
  if (/Android/i.test(s) && /Chrome\//.test(s)) return 'chrome_android';
  if (/Chrome\//.test(s) && !/Mobile|Android/i.test(s)) return 'chrome_desktop';
  return 'other';
}

// ─── the rows ───────────────────────────────────────────────────────────────

async function rowByEndpoint(endpoint) {
  const { data, error } = await supabase.from(TABLE).select('*').eq('endpoint_hash', hashEndpoint(endpoint)).maybeSingle();
  if (error) throw new Error(error.message || 'push row read failed');
  return data || null;
}

async function revoke(id, by, now = Date.now()) {
  const { error } = await supabase.from(TABLE)
    .update({ revoked_at: iso(now), revoked_by: by, endpoint_enc: null, keys_enc: null, next_at: null, updated_at: iso(now) })
    .eq('id', id);
  if (error) throw new Error(error.message || 'push revoke failed');
  logEvent('web_quiz.push_revoked', { by });
}

function validSub(sub) {
  const ep = sub && typeof sub.endpoint === 'string' ? sub.endpoint : '';
  const k = sub && sub.keys;
  return /^https:\/\/[^\s]+$/.test(ep) && ep.length <= 2048 && k && typeof k.p256dh === 'string' && typeof k.auth === 'string'
    && k.p256dh.length > 0 && k.p256dh.length <= 256 && k.auth.length > 0 && k.auth.length <= 64;
}

/**
 * Store one consent. A class phone (≥4 chips on the page or on the device) never subscribes. The same endpoint again
 * updates its live row; after a revoke it is a new row (rebind_of the old one, whose hash is retired).
 */
async function subscribe(input = {}, { now = Date.now() } = {}) {
  const { sub, user_id: userId = null, rotate_from: rotateFrom = null } = input;
  const via = input.via === 'teacher_portal' ? 'teacher_portal' : 'family_phone';
  const kind = via === 'teacher_portal' ? 'evening_plan' : 'quiz_reminder';
  if (!validSub(sub) || (via === 'teacher_portal' && !UUID_RX.test(String(userId || '')))) return { status: 400, err: 'bad_sub' };
  const deviceRef = DEVICE_RX.test(String(input.device_ref || '')) ? input.device_ref : null;
  const chipsN = Math.max(0, Math.min(99, Number.parseInt(input.chips_n, 10) || 0));
  if (via === 'family_phone') {
    const kids = deviceRef ? await HubDevice.deviceKids(deviceRef) : [];
    if (chipsN >= CLASS_PHONE || kids.length >= CLASS_PHONE) return { status: 409, err: 'class_phone' };
    input = { ...input, kids };
  }
  const kids = input.kids || [];
  const row = {
    kind,
    via,
    device_ref: via === 'family_phone' ? (deviceRef || crypto.randomBytes(16).toString('base64url')) : deviceRef,
    user_id: via === 'teacher_portal' ? userId : null,
    student_id: via === 'family_phone' && kids.length === 1 && input.chip && String(input.chip) === String(kids[0]) && UUID_RX.test(String(input.chip)) ? input.chip : null,
    quiz_code: CODE_RX.test(String(input.code || '')) ? input.code : null,
    lang: input.lang === 'en' ? 'en' : 'ur',
    ua_class: uaClass(input.ua),
    endpoint_hash: hashEndpoint(sub.endpoint),
    endpoint_enc: encrypt(sub.endpoint),
    keys_enc: encrypt(JSON.stringify({ p256dh: sub.keys.p256dh, auth: sub.keys.auth })),
    consented_at: iso(now),
    chips_n: chipsN,
    next_at: iso(nextAt(now, kind)),
    expires_at: iso(now + KEEP_DAYS * DAY_MS),
    revoked_at: null,
    revoked_by: null,
    updated_at: iso(now),
  };
  const same = await rowByEndpoint(sub.endpoint);
  if (same && !same.revoked_at) {
    const { error } = await supabase.from(TABLE).update(row).eq('id', same.id);
    if (error) throw new Error(error.message || 'push row update failed');
  } else {
    let rebindOf = null;
    if (same) {
      // the old consent stays as the record; its hash steps aside so this one can hold it
      const { error } = await supabase.from(TABLE).update({ endpoint_hash: `retired:${same.id}`, updated_at: iso(now) }).eq('id', same.id);
      if (error) throw new Error(error.message || 'push row retire failed');
      rebindOf = same.id;
    }
    if (rotateFrom) {
      const old = await rowByEndpoint(rotateFrom);
      if (old && !old.revoked_at) {
        await revoke(old.id, 'rotated', now);
        rebindOf = old.id;
      }
    }
    const { error } = await supabase.from(TABLE).insert({ ...row, rebind_of: rebindOf, sent_count: 0, unopened_count: 0, last_sent_at: null, last_opened_at: null });
    if (error) throw new Error(error.message || 'push row insert failed');
  }
  logEvent('web_quiz.push_subscribed', { kind, via, ua_class: row.ua_class, chips_n: chipsN });
  return { ok: 1 };
}

async function unsubscribe({ endpoint, by } = {}, { now = Date.now() } = {}) {
  if (typeof endpoint !== 'string' || !endpoint) return { status: 400, err: 'bad_sub' };
  const row = await rowByEndpoint(endpoint);
  if (row && !row.revoked_at) await revoke(row.id, ['page', 'notification', 'teacher', 'browser'].includes(by) ? by : 'page', now);
  return { ok: 1 };
}

async function markOpened({ endpoint } = {}, { now = Date.now() } = {}) {
  if (typeof endpoint !== 'string' || !endpoint) return { status: 400, err: 'bad_sub' };
  const row = await rowByEndpoint(endpoint);
  if (row && !row.revoked_at) {
    const { error } = await supabase.from(TABLE)
      .update({ last_opened_at: iso(now), unopened_count: 0, expires_at: iso(now + KEEP_DAYS * DAY_MS), updated_at: iso(now) })
      .eq('id', row.id);
    if (error) throw new Error(error.message || 'push opened failed');
    logEvent('web_quiz.push_opened', { kind: row.kind });
  }
  return { ok: 1 };
}

// ─── sending ────────────────────────────────────────────────────────────────

function payloadFor(row, { test = false } = {}) {
  const kind = row && row.kind === 'evening_plan' ? 'evening_plan' : 'quiz_reminder';
  const lang = row && row.lang === 'en' ? 'en' : 'ur';
  const c = COPY[kind][lang];
  const code = kind === 'quiz_reminder' && CODE_RX.test(String(row.quiz_code || '')) ? row.quiz_code : null;
  return { t: c.t, b: test ? c.test : c.b, url: code ? `/q/${code}?from=push` : '/', tag: kind === 'quiz_reminder' ? 'jugnu-remind' : 'niete-plan', lang, test: Boolean(test) };
}

const loadWebpush = () => require('web-push');

async function sendOne(row, payload, { webpush = loadWebpush(), now = Date.now() } = {}) {
  let target;
  try {
    target = { endpoint: decrypt(row.endpoint_enc), keys: JSON.parse(decrypt(row.keys_enc)) };
  } catch (_) {
    logToFile('⚠️ web quiz push: a row could not be read — skipped', { id: row && row.id });
    return { sent: 0, status: 0 };
  }
  try {
    const res = await webpush.sendNotification(target, JSON.stringify(payload), {
      TTL: 86400,
      urgency: 'normal',
      vapidDetails: { subject: process.env.WQ_PUSH_VAPID_SUBJECT, publicKey: process.env.WQ_PUSH_VAPID_PUBLIC, privateKey: process.env.WQ_PUSH_VAPID_PRIVATE },
    });
    return { sent: 1, status: (res && res.statusCode) || 201 };
  } catch (err) {
    const status = (err && err.statusCode) || 0;
    if (status === 404 || status === 410) await revoke(row.id, 'gone', now);
    else logEvent('web_quiz.push_send_error', { status });
    return { sent: 0, status };
  }
}

async function sendTest({ endpoint } = {}, opts = {}) {
  if (!(await switches()).test) return { status: 404, err: 'off' };
  if (typeof endpoint !== 'string' || !endpoint) return { status: 400, err: 'bad_sub' };
  const row = await rowByEndpoint(endpoint);
  if (!row || row.revoked_at) return { ok: 1, sent: 0, status: 0 };
  const out = await sendOne(row, payloadFor(row, { test: true }), opts);
  if (out.sent) logEvent('web_quiz.push_sent', { n: 1, kind: row.kind, test: true });
  return { ok: 1, ...out };
}

/** One worker tick: every due, live, unexpired row gets one reminder and its next school day. */
async function dueTick(now = Date.now(), opts = {}) {
  if (!(await switches(now)).remind) return { sent: 0, revoked: 0, off: true };
  const { data, error } = await supabase.from(TABLE).select('*')
    .is('revoked_at', null).lte('next_at', iso(now)).gt('expires_at', iso(now)).order('next_at', { ascending: true }).limit(DUE_BATCH);
  if (error) throw new Error(error.message || 'push due read failed');
  const sentBy = {};
  let revoked = 0;
  for (const row of data || []) {
    if ((row.unopened_count || 0) >= UNOPENED_MAX) { await revoke(row.id, 'unopened', now); revoked += 1; continue; }
    const next = iso(nextAt(now, row.kind));
    // the claim: only the tick that moves next_at from the value it read sends (two worker replicas never both send)
    const claim = await supabase.from(TABLE).update({ next_at: next, updated_at: iso(now) }).eq('id', row.id).eq('next_at', row.next_at).select('id');
    if (claim.error || !(claim.data || []).length) continue;
    if (now - Date.parse(row.next_at) > LATE_MS) continue;
    const out = await sendOne(row, payloadFor(row), { ...opts, now });
    if (out.sent) {
      sentBy[row.kind] = (sentBy[row.kind] || 0) + 1;
      await supabase.from(TABLE).update({
        sent_count: (row.sent_count || 0) + 1, unopened_count: (row.unopened_count || 0) + 1, last_sent_at: iso(now), updated_at: iso(now),
      }).eq('id', row.id);
    } else if (out.status === 404 || out.status === 410) revoked += 1;
  }
  for (const [kind, n] of Object.entries(sentBy)) logEvent('web_quiz.push_sent', { n, kind });
  return { sent: Object.values(sentBy).reduce((a, b) => a + b, 0), revoked };
}

/** Retention, whatever the switches say: expire live rows past expires_at; delete revoked rows after 13 months. */
async function expireTick(now = Date.now()) {
  let expired = 0;
  let deleted = 0;
  try {
    const { data, error } = await supabase.from(TABLE).select('id').is('revoked_at', null).lt('expires_at', iso(now)).limit(1000);
    if (error) throw new Error(error.message);
    for (const r of data || []) { await revoke(r.id, 'expiry', now); expired += 1; }
  } catch (err) {
    logToFile('⚠️ web quiz push: expiry failed', { error: err.message });
  }
  try {
    const cut = new Date(now);
    cut.setUTCMonth(cut.getUTCMonth() - KEEP_ERASED_MONTHS);
    const { data, error } = await supabase.from(TABLE).select('id').not('revoked_at', 'is', null).lt('revoked_at', cut.toISOString()).limit(1000);
    if (error) throw new Error(error.message);
    const ids = (data || []).map((r) => r.id);
    if (ids.length) {
      await supabase.from(TABLE).update({ rebind_of: null }).in('rebind_of', ids);
      const del = await supabase.from(TABLE).delete().in('id', ids);
      if (del.error) throw new Error(del.error.message);
      deleted = ids.length;
    }
  } catch (err) {
    logToFile('⚠️ web quiz push: erased-row delete failed', { error: err.message });
  }
  if (expired || deleted) logEvent('web_quiz.push_expired', { expired, deleted });
  return { expired, deleted };
}

const STEPS = new Set(['shown', 'yes', 'later', 'granted', 'denied', 'subscribed', 'failed', 'escape', 'copy', 'ios', 'nopush', 'stop', 'test']);
const HOWS = new Set(['intent', 'menu', 'copy']);
/** A page step event, allow-listed enums only. */
function stepEvent(body = {}) {
  if (!STEPS.has(body.step)) return { status: 400, err: 'bad_step' };
  logEvent('web_quiz.remind_step', {
    step: body.step,
    ...(HOWS.has(body.how) ? { how: body.how } : {}),
    ...(typeof body.iab === 'boolean' ? { iab: body.iab } : {}),
    ...(body.lang === 'en' || body.lang === 'ur' ? { lang: body.lang } : {}),
    ...(typeof body.ok === 'boolean' ? { ok: body.ok } : {}),
  });
  return { ok: 1 };
}

const vapidPublic = () => String(process.env.WQ_PUSH_VAPID_PUBLIC || '');

module.exports = {
  switches, envReady, subscribe, unsubscribe, markOpened, payloadFor, sendOne, sendTest, dueTick, expireTick, stepEvent, vapidPublic,
  nextAt, uaClass, hashEndpoint, encrypt, decrypt, COPY, KEYS, ENV, TABLE,
  __reset: () => { cache = null; },
};
