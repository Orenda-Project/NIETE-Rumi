'use strict';
/**
 * The reminder push: one table (web_quiz_push_subscriptions), one sender, for the child's "remind me tomorrow" on a
 * family phone (kind quiz_reminder, via family_phone) and the teacher's evening reminder (kind evening_plan, via
 * teacher_portal). Switches (app_settings, JSON true only, 30 s cache, fail closed; all OFF by default):
 *
 *   remind = web_quiz_push_remind && every env below set      the routes, the card, the due tick's sends
 *   test   = web_quiz_push_test   && remind                   "Send one now" on /remind/:code (sandbox QA only)
 *   portal = portal_push_remind   && remind                   the teacher card (car C)
 *   names  = web_quiz_push_name_children && remind            the child reminder names the children on the phone
 *                                                             (first names; policy-gated, default off: class-named)
 *
 * Env (sandbox only; never shared with staging or prod): WQ_PUSH_VAPID_PUBLIC, WQ_PUSH_VAPID_PRIVATE,
 * WQ_PUSH_VAPID_SUBJECT (VAPID), WQ_PUSH_ENC_KEY (32 bytes base64, AES-256-GCM of the endpoint and keys),
 * WQ_PUSH_HASH_SALT (HMAC-SHA256 of the endpoint, the lookup key).
 *
 *   switches(now)                          → {remind, test, portal}
 *   subscribe(input, {now})                → {ok:1} | {status:409, err:'class_phone'} | {status:400, err:'bad_sub'}
 *   unsubscribe({endpoint, by}) / markOpened({endpoint}, {now})   → {ok:1}
 *   payloadFor(row, {test, rounds, names}) → {t, b, url, tag, lang, test}: class-named when the phone's classes have
 *                                            a round ready; children's first names only with `names` on; no score, ever
 *   sendOne(row, payload, {webpush})       → {sent, status}; 404/410 revokes the row as `gone`
 *   sendTest({endpoint}, {webpush})        → {ok:1, sent, status} | {status:404, err:'off'}
 *   dueTick(now, {webpush})                → {sent, revoked, deduped}: due rows, ONE per phone (device_ref) a school
 *                                            day at 17:30–17:59 PKT, revoked after 3 unopened
 *   expireTick(now)                        → {expired, deleted}: runs whatever the switches say (retention)
 *   delivered({tag})                       → the funnel's delivered step (the worker showed it); the landed step
 *                                            (web_quiz.push_landed) is the portal's; funnelTick(now) logs the day's
 *                                            counts once after 21:00 PKT
 *
 * Logs carry kinds and counts only — never the endpoint or the keys.
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const HubDevice = require('../quiz/web-quiz-hub-device');

const TABLE = 'web_quiz_push_subscriptions';
const KEYS = Object.freeze({ remind: 'web_quiz_push_remind', test: 'web_quiz_push_test', portal: 'portal_push_remind', names: 'web_quiz_push_name_children' });
const ENV = Object.freeze(['WQ_PUSH_VAPID_PUBLIC', 'WQ_PUSH_VAPID_PRIVATE', 'WQ_PUSH_VAPID_SUBJECT', 'WQ_PUSH_ENC_KEY', 'WQ_PUSH_HASH_SALT']);
const OFF = Object.freeze({ remind: false, test: false, portal: false, names: false });
const TTL_MS = 30 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const PKT_MS = 5 * 60 * 60 * 1000;
const KEEP_DAYS = 90;
const KEEP_ERASED_MONTHS = 13;
// Three ignored reminders in a row and the phone hears no more (the result screen may ask again): Chrome quietens and
// then revokes notifications for sites people keep ignoring, which would cost every later reminder on that phone.
const UNOPENED_MAX = 3;
const DUE_BATCH = 200;
// A slot missed by more than this (the worker was down) is moved to the next school day, never sent late at night.
const LATE_MS = 4 * 60 * 60 * 1000;
// The slot, minutes after midnight PKT. Children play most at 18:00–19:00 PKT, so the child reminder lands just before:
// 17:30 plus a per-phone spread of up to 29 minutes (the same minute every day for one phone), never after 18:00.
const MIN_PKT = Object.freeze({ quiz_reminder: 17 * 60 + 30, evening_plan: 18 * 60 });
const SPREAD_MIN = Object.freeze({ quiz_reminder: 30, evening_plan: 0 });
const FUNNEL_MIN_PKT = 21 * 60;
const CLASS_PHONE = 4;
const CODE_RX = /^[A-Za-z0-9_-]{3,32}$/;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEVICE_RX = /^[A-Za-z0-9_-]{22}$/;

// The words (jg.remind.push_* in the copy deck): a reminder never names a child.
// {c} = the class label(s) or the children's first names, joined with `and`.
const COPY = Object.freeze({
  quiz_reminder: {
    en: {
      t: 'Jugnu', b: "Today's quiz is ready. Tap to play.", test: 'Reminders are on.',
      round: "{c}: tonight's round is ready. Tap to play.", rounds: "{c}: tonight's rounds are ready. Tap to play.", and: ', ',
    },
    ur: {
      t: 'جگنو', b: 'آج کا کوئز تیار ہے۔ کھیلنے کے لیے دبائیں۔', test: 'یاد دہانی آن ہے۔',
      round: '{c}: آج کا راؤنڈ تیار ہے۔ کھیلنے کے لیے دبائیں۔', rounds: '{c}: آج کے راؤنڈ تیار ہیں۔ کھیلنے کے لیے دبائیں۔', and: '، ',
    },
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
    s = { remind, test: remind && on(KEYS.test), portal: remind && on(KEYS.portal), names: remind && on(KEYS.names) };
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

/** A phone's own minute inside its kind's spread (0 without a device): stable, so one phone hears it at one time. */
function spreadMin(kind, deviceRef) {
  const n = SPREAD_MIN[kind] || 0;
  if (!n || !deviceRef) return 0;
  return Number.parseInt(crypto.createHash('sha256').update(`wqpush|${deviceRef}`).digest('hex').slice(0, 8), 16) % n;
}
/** The next school day (Mon–Fri, PKT) after `now`'s PKT date, at the kind's slot PKT (+ the phone's minute) → ms. */
function nextAt(now, kind, deviceRef = null) {
  const k = MIN_PKT[kind] != null ? kind : 'quiz_reminder';
  const pkt = new Date(now + PKT_MS);
  let day = Date.UTC(pkt.getUTCFullYear(), pkt.getUTCMonth(), pkt.getUTCDate()) + DAY_MS;
  while ([0, 6].includes(new Date(day).getUTCDay())) day += DAY_MS;
  return day + (MIN_PKT[k] + spreadMin(k, deviceRef)) * 60 * 1000 - PKT_MS;
}
/** The PKT calendar day of `now`, 'YYYY-MM-DD'. */
const pktDay = (now) => new Date(now + PKT_MS).toISOString().slice(0, 10);
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
  const rowDevice = via === 'family_phone' ? (deviceRef || crypto.randomBytes(16).toString('base64url')) : deviceRef;
  const row = {
    kind,
    via,
    device_ref: rowDevice,
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
    next_at: iso(nextAt(now, kind, rowDevice)),
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

const LABEL_MAX = 24;
const NAMES_MAX = 3;
const clip = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, LABEL_MAX);
/**
 * rounds: roundsReadyForPhone's answer for this phone (class-link), [] when none; names: the children's first names
 * (only ever passed with `names` on). Names win over class labels; either way one notification for the phone.
 */
function payloadFor(row, { test = false, rounds = [], names = [] } = {}) {
  const kind = row && row.kind === 'evening_plan' ? 'evening_plan' : 'quiz_reminder';
  const lang = row && row.lang === 'en' ? 'en' : 'ur';
  const c = COPY[kind][lang];
  const code = kind === 'quiz_reminder' && CODE_RX.test(String(row.quiz_code || '')) ? row.quiz_code : null;
  const tag = kind === 'quiz_reminder' ? 'jugnu-remind' : 'niete-plan';
  const base = { t: c.t, b: test ? c.test : c.b, url: code ? `/q/${code}?from=push` : '/', tag, lang, test: Boolean(test) };
  if (test || kind !== 'quiz_reminder') return base;
  const ready = (Array.isArray(rounds) ? rounds : []).filter((r) => r && CODE_RX.test(String(r.class_link_code || '')));
  const who = (Array.isArray(names) ? names : []).map(clip).filter(Boolean).slice(0, NAMES_MAX);
  const labels = [...new Set(ready.map((r) => clip(lang === 'ur' ? r.class_label_ur || r.class_label_en : r.class_label_en || r.class_label_ur)).filter(Boolean))];
  const list = who.length ? who : labels;
  if (!list.length) return { ...base, ...(ready.length ? { url: `/j/${ready[0].class_link_code}?from=push` } : {}) };
  const b = (list.length > 1 && !who.length ? c.rounds : c.round).replace('{c}', list.join(c.and));
  return { ...base, b, url: ready.length ? `/j/${ready[0].class_link_code}?from=push` : base.url };
}

/** class-link's rounds for this phone today (PLAN §3.2); [] until that module exports roundsReadyForPhone. */
async function roundsFor(row, now) {
  if (!row || row.kind !== 'quiz_reminder' || !row.device_ref) return [];
  try {
    const CL = require('../quiz/web-quiz-class-link');
    if (!CL || typeof CL.roundsReadyForPhone !== 'function') return [];
    const out = await CL.roundsReadyForPhone(row.device_ref, pktDay(now));
    return Array.isArray(out) ? out : [];
  } catch (err) {
    logToFile('⚠️ web quiz push: rounds lookup failed — generic reminder', { error: err && err.message });
    return [];
  }
}

/** The first names of the children this phone plays as (newest first), read only with `names` on. */
async function namesFor(row, lang) {
  if (!row || row.kind !== 'quiz_reminder' || !row.device_ref) return [];
  try {
    const ids = (await HubDevice.deviceKids(row.device_ref)).filter((id) => UUID_RX.test(String(id))).slice(0, NAMES_MAX);
    if (!ids.length) return [];
    const { data, error } = await supabase.from('students').select('id, student_name, student_name_urdu').in('id', ids);
    if (error) throw new Error(error.message || 'students read failed');
    const by = new Map((data || []).map((r) => [String(r.id), r]));
    const first = (v) => String(v || '').trim().split(/\s+/)[0] || '';
    return ids.map((id) => by.get(String(id))).filter(Boolean)
      .map((r) => first(lang === 'ur' && r.student_name_urdu ? r.student_name_urdu : r.student_name)).filter(Boolean);
  } catch (err) {
    logToFile('⚠️ web quiz push: names lookup failed — class-named reminder', { error: err && err.message });
    return [];
  }
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

/**
 * One worker tick: every due, live, unexpired row gets its next school day, and each PHONE (device_ref) one reminder:
 * a second row of a phone already reminded this tick is moved on without a send (`deduped`).
 */
async function dueTick(now = Date.now(), opts = {}) {
  const s = await switches(now);
  if (!s.remind) return { sent: 0, revoked: 0, deduped: 0, off: true };
  const { data, error } = await supabase.from(TABLE).select('*')
    .is('revoked_at', null).lte('next_at', iso(now)).gt('expires_at', iso(now)).order('next_at', { ascending: true }).limit(DUE_BATCH);
  if (error) throw new Error(error.message || 'push due read failed');
  const sentBy = {};
  const body = { round: 0, named: 0, generic: 0 };
  const phones = new Set();
  let revoked = 0;
  let deduped = 0;
  for (const row of data || []) {
    if ((row.unopened_count || 0) >= UNOPENED_MAX) { await revoke(row.id, 'unopened', now); revoked += 1; continue; }
    const next = iso(nextAt(now, row.kind, row.device_ref));
    // the claim: only the tick that moves next_at from the value it read sends (two worker replicas never both send)
    const claim = await supabase.from(TABLE).update({ next_at: next, updated_at: iso(now) }).eq('id', row.id).eq('next_at', row.next_at).select('id');
    if (claim.error || !(claim.data || []).length) continue;
    if (now - Date.parse(row.next_at) > LATE_MS) continue;
    const phone = row.kind === 'quiz_reminder' && row.device_ref ? `p|${row.device_ref}` : null;
    if (phone && phones.has(phone)) { deduped += 1; continue; }
    const lang = row.lang === 'en' ? 'en' : 'ur';
    const names = s.names ? await namesFor(row, lang) : [];
    const rounds = await roundsFor(row, now);
    const out = await sendOne(row, payloadFor(row, { rounds, names }), { ...opts, now });
    if (phone) phones.add(phone);
    if (out.sent) {
      sentBy[row.kind] = (sentBy[row.kind] || 0) + 1;
      if (row.kind === 'quiz_reminder') body[names.length ? 'named' : rounds.length ? 'round' : 'generic'] += 1;
      await supabase.from(TABLE).update({
        sent_count: (row.sent_count || 0) + 1, unopened_count: (row.unopened_count || 0) + 1, last_sent_at: iso(now), updated_at: iso(now),
      }).eq('id', row.id);
    } else if (out.status === 404 || out.status === 410) revoked += 1;
  }
  for (const [kind, n] of Object.entries(sentBy)) {
    logEvent('web_quiz.push_sent', { n, kind, reason: kind, ...(kind === 'quiz_reminder' ? { round_n: body.round, named_n: body.named, generic_n: body.generic, deduped } : {}) });
  }
  return { sent: Object.values(sentBy).reduce((a, b) => a + b, 0), revoked, deduped };
}

// ─── the funnel ─────────────────────────────────────────────────────────────

const TAGS = Object.freeze({ 'jugnu-remind': 'quiz_reminder', 'niete-plan': 'evening_plan' });
/** The worker showed a reminder (sw.js push handler). Counts only. */
function delivered({ tag } = {}) {
  const kind = TAGS[String(tag || '')];
  if (!kind) return { status: 400, err: 'bad_tag' };
  logEvent('web_quiz.push_delivered', { kind, reason: kind });
  return { ok: 1 };
}

let funnelDay = null;
/**
 * Once a PKT day, after 21:00 PKT: the table's side of the funnel for that day (live phones, new consents, sent,
 * opened, revoked by door). The page's side (remind_step shown/yes/granted/denied, push_delivered, push_landed) is
 * counted from the events. Two worker replicas may each log the day once: the rows carry `day`, read one per day.
 */
async function funnelTick(now = Date.now()) {
  const day = pktDay(now);
  const minPkt = Math.floor(((now + PKT_MS) % DAY_MS) / 60000);
  if (minPkt < FUNNEL_MIN_PKT || funnelDay === day) return null;
  try {
    const from = iso(Date.parse(`${day}T00:00:00Z`) - PKT_MS);
    const cols = 'kind, revoked_at, revoked_by, consented_at, last_sent_at, last_opened_at';
    const live = await supabase.from(TABLE).select(cols).eq('kind', 'quiz_reminder').is('revoked_at', null).limit(20000);
    if (live.error) throw new Error(live.error.message || 'push funnel read failed');
    const gone = await supabase.from(TABLE).select(cols).eq('kind', 'quiz_reminder').gte('revoked_at', from).limit(20000);
    if (gone.error) throw new Error(gone.error.message || 'push funnel read failed');
    const since = (v) => Boolean(v) && new Date(v).toISOString() >= from;
    const rowsN = [...(live.data || []), ...(gone.data || [])];
    const revokedBy = {};
    for (const r of rowsN) if (since(r.revoked_at)) revokedBy[r.revoked_by || 'other'] = (revokedBy[r.revoked_by || 'other'] || 0) + 1;
    const out = {
      day,
      live: rowsN.filter((r) => !r.revoked_at).length,
      subscribed: rowsN.filter((r) => since(r.consented_at)).length,
      sent: rowsN.filter((r) => since(r.last_sent_at)).length,
      opened: rowsN.filter((r) => since(r.last_opened_at)).length,
      revoked_unopened: revokedBy.unopened || 0,
      revoked_gone: revokedBy.gone || 0,
      revoked_stop: (revokedBy.notification || 0) + (revokedBy.page || 0),
    };
    funnelDay = day;
    logEvent('web_quiz.push_funnel_daily', out);
    return out;
  } catch (err) {
    logToFile('⚠️ web quiz push: funnel count failed', { error: err.message });
    return null;
  }
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
// Where the ask was answered: the quiz result screen, under the standing link's chips, or the /remind/:code landing.
const SRCS = new Set(['result', 'class_link', 'landing']);
/** A page step event, allow-listed enums only. */
function stepEvent(body = {}) {
  if (!STEPS.has(body.step)) return { status: 400, err: 'bad_step' };
  logEvent('web_quiz.remind_step', {
    step: body.step,
    ...(HOWS.has(body.how) ? { how: body.how } : {}),
    ...(typeof body.iab === 'boolean' ? { iab: body.iab } : {}),
    ...(body.lang === 'en' || body.lang === 'ur' ? { lang: body.lang } : {}),
    ...(typeof body.ok === 'boolean' ? { ok: body.ok } : {}),
    ...(SRCS.has(body.src) ? { src: body.src } : {}),
  });
  return { ok: 1 };
}

const vapidPublic = () => String(process.env.WQ_PUSH_VAPID_PUBLIC || '');

module.exports = {
  switches, envReady, subscribe, unsubscribe, markOpened, payloadFor, sendOne, sendTest, dueTick, expireTick, stepEvent, vapidPublic,
  delivered, funnelTick,
  nextAt, spreadMin, pktDay, uaClass, hashEndpoint, encrypt, decrypt, COPY, KEYS, ENV, TABLE, UNOPENED_MAX,
  __reset: () => { cache = null; funnelDay = null; },
};
