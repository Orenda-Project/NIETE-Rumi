'use strict';
/**
 * The direct ping: one WhatsApp template message to a sampled family phone, at most once a term, built OFF.
 * Nothing calls send(); there is no schedule. Four locks, any one closed → zero sends:
 *
 *   1. the switch   web_quiz_sample_ping (OFF on every tier), effective only with web_quiz_challenge_v2,
 *                   web_quiz_challenge and the identity store's phoneBind (web-quiz-identity-flags.js). 30 s cache,
 *                   a failed read is off. Off → one app_settings read, no event, no log line, {sent:0, skipped:'off'}.
 *   2. the go token app_settings web_quiz_sample_ping_go, the operator's dated JSON
 *                   {by:'operator', date, term, template, category, max_sends, consent_v}; missing → no_go, any field
 *                   wrong → go_bad, another term (or dated outside this term) → go_term, dated after today → go_future.
 *   3. the copy     UX_STRINGS.samplePingInvite (bot.ping.invite) must exist; absent → no_copy. Never inlined here.
 *   4. the ledger   message-ledger record({trigger:'sample_ping', initiated:'bot', recipient:'family'}) must accept
 *                   the send; false → the reservation is marked failed and the run stops (ledger).
 *
 * A run refuses quiet_hours (22:00–07:00 PKT, at the start and before each send), class_window (any class-round or
 * class-week window open, any term) and read_failed (any read fails, the ping tables missing included).
 * The frame: active bindings grouped by phone (one bound set = one unit), each set out for the first of loose,
 * drawn_class, teacher_phone, stop, no_consent, done. Caps: one child per set (crypto RNG), PER_CLASS_CAP per class a
 * term, go.max_sends less what this term already used, TERM_CAP_SENDS, then the per-phone daily cap (capAllows).
 * Per send: cap → reserve sample_pings (reserved) → ledger → transport (template `${template}_${lang}`, no parameters,
 * so no name, class or count rides the message) → row sent → web_quiz.sample_ping_sent{term, cls, usd}.
 * Events are written only with web_quiz_events_v2 && web_quiz_hub on, else one log line each; none carries a phone,
 * a raw id, a kid, a ukey or a tombstone. dryRun() reads only and returns counts only. Never throws.
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile, logError } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');

const SWITCH_KEY = 'web_quiz_sample_ping';
const GO_KEY = 'web_quiz_sample_ping_go';
const TERM_CAP_SENDS = 3200;
const PER_CLASS_CAP = 10;
const QUIET_START_H = 22;
const QUIET_END_H = 7;
const RATE = Object.freeze({ utility: 0.015, marketing: 0.0473 });
const TRIGGER = 'sample_ping';
const TTL_MS = 30 * 1000;
const PKT_MS = 5 * 3600 * 1000;
const PAGE = 1000;
const CHUNK = 200;
const TEMPLATE_RX = /^[a-z0-9_]{3,64}$/;
const DATE_RX = /^(\d{4})-(\d{2})-(\d{2})$/;
const OFF = Object.freeze({ on: false, events: false });

let cache = null; // { at, on, events }

class ReadFailed extends Error {}

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

const ms = (t) => (t instanceof Date ? t.getTime() : Number(t));
const pktDay = (t) => new Date(ms(t) + PKT_MS).toISOString().slice(0, 10);
const round6 = (x) => Math.round(x * 1e6) / 1e6;

/** → { on, events }. The own switch is read first: off → that single read and nothing else. Fails closed. */
async function flags(now = Date.now()) {
  const t = ms(now);
  if (cache && t - cache.at < TTL_MS) return cache;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [SWITCH_KEY]);
    if (error) return { ...OFF };
    const row = (data || []).find((r) => r.key === SWITCH_KEY);
    if (!row || !isTrue(row.value)) { cache = { at: t, ...OFF }; return cache; }
    const hub = await require('./web-quiz-hub-flags').flags(t);
    const events = Boolean(hub.hub && hub.eventsV2);
    if (!(hub.challenge && hub.challengeV2)) { cache = { at: t, on: false, events }; return cache; }
    const id = await require('./web-quiz-identity-flags').flags(t);
    cache = { at: t, on: Boolean(id.phoneBind), events };
    return cache;
  } catch (_) {
    return { ...OFF };
  }
}

/** A real calendar date 'YYYY-MM-DD' → its 00:00 PKT in ms; anything else → null. */
function dateMs(s) {
  const m = DATE_RX.exec(String(s || ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const utc = Date.UTC(y, mo - 1, d);
  const back = new Date(utc);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return utc - PKT_MS;
}

/** The operator's go token → { ok:true, go } | { ok:false, reason }. Never throws. */
async function readGo(now = Date.now()) {
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [GO_KEY]);
    if (error) return { ok: false, reason: 'read_failed' };
    const row = (data || []).find((r) => r.key === GO_KEY);
    if (!row || row.value === null || row.value === undefined || row.value === '') return { ok: false, reason: 'no_go' };
    let g = row.value;
    if (typeof g === 'string') { try { g = JSON.parse(g); } catch (_) { return { ok: false, reason: 'go_bad' }; } }
    if (!g || typeof g !== 'object' || Array.isArray(g)) return { ok: false, reason: 'go_bad' };
    const day = dateMs(g.date);
    const fieldsOk = g.by === 'operator' && day !== null && typeof g.term === 'string' && TEMPLATE_RX.test(String(g.template || ''))
      && Object.prototype.hasOwnProperty.call(RATE, g.category)
      && Number.isInteger(g.max_sends) && g.max_sends >= 1 && g.max_sends <= TERM_CAP_SENDS
      && Number.isInteger(g.consent_v) && g.consent_v >= 1;
    if (!fieldsOk) return { ok: false, reason: 'go_bad' };
    const { termCode, termBounds } = require('./web-quiz-class-round-sampler');
    const term = termCode(ms(now));
    if (g.term !== term) return { ok: false, reason: 'go_term' };
    if (g.date > pktDay(now)) return { ok: false, reason: 'go_future' };
    const b = termBounds(term);
    if (!b || day < b.start || day >= b.end) return { ok: false, reason: 'go_term' };
    return { ok: true, go: { by: g.by, date: g.date, term: g.term, template: g.template, category: g.category, max_sends: g.max_sends, consent_v: g.consent_v } };
  } catch (_) {
    return { ok: false, reason: 'read_failed' };
  }
}

/** 22:00–07:00 PKT. */
function quietHours(now = Date.now()) {
  const h = new Date(ms(now) + PKT_MS).getUTCHours();
  return h >= QUIET_START_H || h < QUIET_END_H;
}

/** Any class-round or class-week window open now (any term) → true; none → false; a failed read → null. */
async function classWindowOpen(now = Date.now()) {
  try {
    const t = ms(now);
    const at = new Date(t).toISOString();
    for (const [s, e] of [['window_start', 'window_end'], ['week_start', 'week_end']]) {
      const { data, error } = await supabase.from('class_round_draws').select(`id, ${s}, ${e}`).gt(e, at);
      if (error) return null;
      if ((data || []).some((r) => r[s] && Date.parse(r[s]) <= t && Date.parse(r[e]) > t)) return true;
    }
    return false;
  } catch (_) {
    return null;
  }
}

// ── reads (a failed read throws ReadFailed: the run refuses read_failed) ──

function check(table, { data, error }) {
  if (error) throw new ReadFailed(`${table}: ${error.code || ''} ${error.message || 'read failed'}`);
  return data || [];
}

async function readPaged(table, cols, filter, key = 'id') {
  const out = [];
  let last = null;
  for (;;) {
    let q = filter(supabase.from(table).select(cols)).order(key, { ascending: true }).limit(PAGE);
    if (last) q = q.gt(key, last);
    const data = check(table, await q);
    out.push(...data);
    if (data.length < PAGE) return out;
    last = data[data.length - 1][key];
  }
}

async function readIn(table, cols, col, values, filter = (q) => q) {
  const out = [];
  const list = [...new Set(values)];
  for (let i = 0; i < list.length; i += CHUNK) {
    out.push(...check(table, await filter(supabase.from(table).select(cols).in(col, list.slice(i, i + CHUNK)))));
  }
  return out;
}

const pick = (list) => list[crypto.randomInt(0, list.length)];
function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A phone's users rows: teacher (identity, or activity true/null) and the family's language. */
async function phoneUsers(phones) {
  const Ingress = require('../student-ingress');
  const { normalisePhone } = require('./student-identity.service');
  // users.phone_number is stored as WhatsApp sends it, with a +, or in local form (0…): ask for all three
  const variants = phones.flatMap((p) => [p, `+${p}`, ...(p.startsWith('92') ? [`0${p.slice(2)}`] : [])]);
  const rows = await readIn('users', 'id, phone_number, preferred_language, registration_completed, registration_state, name, teacher_uuid, school_id, portal_activated, role',
    'phone_number', variants);
  const by = new Map();
  for (const u of rows) {
    const p = normalisePhone(u.phone_number);
    if (!by.has(p)) by.set(p, { teacher: false, lang: null });
    const e = by.get(p);
    if (e.teacher) continue;
    if (Ingress.identity(u)) { e.teacher = true; continue; }
    const act = await Ingress.activity(u.id);
    if (act !== false) { e.teacher = true; continue; }   // a failed read counts as a teacher
    if (!e.lang && u.preferred_language) e.lang = u.preferred_language;
  }
  return by;
}

/**
 * The frame, its exclusions and the capped picks for `term`. `consentV` null (a dry run without a go token) counts a
 * consent row of any version. `maxSends` defaults to the term ceiling. Internal: the picks carry the phone (never logged,
 * never returned by dryRun). Throws ReadFailed on a failed read.
 */
async function plan({ now = Date.now(), term, consentV = null, maxSends = TERM_CAP_SENDS } = {}) {
  const t = ms(now);
  const at = new Date(t).toISOString();
  const theTerm = term || require('./web-quiz-class-round-sampler').termCode(t);
  const Repo = require('./child-phone-bindings.repo');

  const bindings = await readPaged('child_phone_bindings', 'id, canonical_id, phone_norm, phone_tomb',
    (q) => q.not('phone_norm', 'is', null).is('revoked_at', null).gt('expires_at', at));
  const sets = new Map();
  for (const b of bindings) {
    if (!sets.has(b.phone_norm)) sets.set(b.phone_norm, { phone: b.phone_norm, tomb: Repo.tombOf(b.phone_norm) || b.phone_tomb || null, bindings: [] });
    sets.get(b.phone_norm).bindings.push(b);
  }
  const childIds = bindings.map((b) => String(b.canonical_id));
  const enr = await readIn('class_enrollments', 'id, student_id, class_id', 'student_id', childIds, (q) => q.eq('is_active', true));
  const classOf = new Map();
  [...enr].sort((a, b) => String(a.class_id).localeCompare(String(b.class_id))).forEach((e) => {
    if (e.class_id && !classOf.has(String(e.student_id))) classOf.set(String(e.student_id), String(e.class_id));
  });
  const drawn = new Set(check('class_round_draws', await supabase.from('class_round_draws').select('id, class_id').eq('term_code', theTerm))
    .map((d) => String(d.class_id)));
  const pings = await readPaged('sample_pings', 'id, phone_tomb, class_id, state', (q) => q.eq('term_code', theTerm));
  const consents = await readIn('sample_ping_consents', 'binding_id, consent_v', 'binding_id', bindings.map((b) => b.id));

  const excl = { loose: 0, drawn: 0, teacher: 0, stop: 0, consent: 0, done: 0 };
  // loose, drawn_class first: they need no further read
  let alive = [];
  for (const s of sets.values()) {
    s.children = [...new Set(s.bindings.map((b) => String(b.canonical_id)))].filter((c) => classOf.has(c)).map((c) => ({ id: c, classId: classOf.get(c) }));
    if (!s.children.length) excl.loose += 1;
    else if (s.children.some((c) => drawn.has(c.classId))) excl.drawn += 1;
    else alive.push(s);
  }
  const users = await phoneUsers(alive.map((s) => s.phone));
  alive = alive.filter((s) => {
    const u = users.get(s.phone);
    s.lang = (u && u.lang) || null;
    if (u && u.teacher) { excl.teacher += 1; return false; }
    return true;
  });
  const stopped = new Set(alive.some((s) => s.tomb)
    ? (await readIn('child_phone_bindings', 'id, phone_tomb', 'phone_tomb', alive.filter((s) => s.tomb).map((s) => s.tomb), (q) => q.eq('revoked_by', 'stop')))
      .map((r) => r.phone_tomb)
    : []);
  const consentBy = new Map();
  consents.forEach((c) => { if (!consentBy.has(c.binding_id)) consentBy.set(c.binding_id, []); consentBy.get(c.binding_id).push(Number(c.consent_v)); });
  const usedTombs = new Set(pings.map((p) => p.phone_tomb));
  const eligible = alive.filter((s) => {
    if (!s.tomb || stopped.has(s.tomb)) { excl.stop += 1; return false; }   // no tombstone: STOP cannot be ruled out
    const consented = s.bindings.some((b) => (consentBy.get(b.id) || []).some((v) => (consentV == null ? v >= 1 : v === consentV)));
    if (!consented) { excl.consent += 1; return false; }
    if (usedTombs.has(s.tomb)) { excl.done += 1; return false; }
    return true;
  });

  // caps: one child per set; PER_CLASS_CAP per class a term; the run budget (a reservation that was not marked failed counts)
  const used = pings.filter((p) => p.state !== 'failed');
  const perClass = new Map();
  used.forEach((p) => { if (p.class_id) perClass.set(String(p.class_id), (perClass.get(String(p.class_id)) || 0) + 1); });
  const budget = Math.max(0, Math.min(Number.isInteger(maxSends) ? maxSends : TERM_CAP_SENDS, TERM_CAP_SENDS) - used.length);
  const picks = [];
  for (const s of shuffle(eligible)) {
    if (picks.length >= budget) break;
    const open = s.children.filter((c) => (perClass.get(c.classId) || 0) < PER_CLASS_CAP);
    if (!open.length) continue;
    const child = pick(open);
    perClass.set(child.classId, (perClass.get(child.classId) || 0) + 1);
    picks.push({ phone: s.phone, tomb: s.tomb, classId: child.classId, lang: s.lang });
  }
  const byClass = new Map();
  picks.forEach((p) => byClass.set(p.classId, (byClass.get(p.classId) || 0) + 1));
  return {
    term: theTerm, picks, budget,
    counts: {
      frame_n: sets.size, eligible_n: eligible.length, would_send_n: picks.length, classes_n: byClass.size,
      max_per_class: byClass.size ? Math.max(...byClass.values()) : 0,
      excl_loose: excl.loose, excl_drawn: excl.drawn, excl_teacher: excl.teacher, excl_stop: excl.stop, excl_consent: excl.consent, excl_done: excl.done,
    },
  };
}

function emit(f, name, fields) {
  const body = { ...fields, w: 's' };
  if (f.events) logEvent(`web_quiz.${name}`, body);
  else logToFile(`sample ping: ${name}`, body);
}

const plannedFields = (p, dry) => ({
  term: p.term, dry, frame_n: p.counts.frame_n, eligible_n: p.counts.eligible_n, would_send_n: p.counts.would_send_n, classes_n: p.counts.classes_n,
  excl_loose: p.counts.excl_loose, excl_drawn: p.counts.excl_drawn, excl_teacher: p.counts.excl_teacher, excl_stop: p.counts.excl_stop,
  excl_consent: p.counts.excl_consent, excl_done: p.counts.excl_done,
});

/** Read-only counts (works with the switch off); planned{dry:true} only with the switch on. Never an id or a phone. */
async function dryRun({ now = Date.now() } = {}) {
  const t = ms(now);
  try {
    const f = await flags(t);
    const g = await readGo(t);
    const term = require('./web-quiz-class-round-sampler').termCode(t);
    const p = await plan({ now: t, term, consentV: g.ok ? g.go.consent_v : null, maxSends: g.ok ? g.go.max_sends : TERM_CAP_SENDS });
    if (f.on) emit(f, 'sample_ping_planned', plannedFields(p, true));
    const n = p.counts.would_send_n;
    return {
      term, switch_on: Boolean(f.on), go_present: g.reason !== 'no_go', go_ok: Boolean(g.ok), go_reason: g.ok ? null : g.reason,
      ...p.counts, usd_utility: round6(n * RATE.utility), usd_marketing: round6(n * RATE.marketing),
    };
  } catch (e) {
    if (!(e instanceof ReadFailed)) logError('web_quiz.sample_ping_dry_run_failed', { error: String(e && e.message || e).slice(0, 120) });
    return { error: 'read_failed' };
  }
}

function defaultTransport(phone, template, lang, params) {
  return require('../whatsapp.service').sendTemplate(phone, template, lang, params);
}

async function setState(id, patch) {
  try {
    const { error } = await supabase.from('sample_pings').update(patch).eq('id', id);
    return !error;
  } catch (_) {
    return false;
  }
}

/**
 * One run. `now` is a time or a clock function (called at the start and before each send). `transport(phone, template,
 * lang, params)` → truthy when sent. → {sent:0, skipped:'off'} | {sent, refused} | {sent, capped, raced, failed}.
 */
async function send({ now = Date.now, transport = defaultTransport } = {}) {
  const clock = typeof now === 'function' ? () => ms(now()) : () => ms(now);
  let sent = 0;
  try {
    const t0 = clock();
    const f = await flags(t0);
    if (!f.on) return { sent: 0, skipped: 'off' };
    const refuse = (reason) => { emit(f, 'sample_ping_refused', { reason }); return { sent, refused: reason }; };

    const g = await readGo(t0);
    if (!g.ok) return refuse(g.reason);
    const { go } = g;
    const { UX_STRINGS, clampLanguage } = require('../../config/ux-strings');
    const copy = UX_STRINGS && UX_STRINGS.samplePingInvite;
    if (!copy || typeof copy.en !== 'string' || typeof copy.ur !== 'string' || !copy.en || !copy.ur) return refuse('no_copy');
    if (quietHours(t0)) return refuse('quiet_hours');
    const open = await classWindowOpen(t0);
    if (open === null) return refuse('read_failed');
    if (open) return refuse('class_window');

    let p;
    try {
      p = await plan({ now: t0, term: go.term, consentV: go.consent_v, maxSends: go.max_sends });
    } catch (e) {
      if (e instanceof ReadFailed) return refuse('read_failed');
      throw e;
    }
    emit(f, 'sample_ping_planned', plannedFields(p, false));

    const Ledger = require('./message-ledger');
    const usd = RATE[go.category];
    let capped = 0; let raced = 0; let failed = 0;
    for (const target of p.picks) {
      const t = clock();
      if (quietHours(t)) return refuse('quiet_hours');
      let allowed = false;
      try { allowed = typeof Ledger.capAllows === 'function' && (await Ledger.capAllows(target.phone, TRIGGER, new Date(t))) === true; } catch (_) { allowed = false; }
      if (!allowed) { capped += 1; continue; }
      const res = await supabase.from('sample_pings')
        .insert({ term_code: go.term, phone_tomb: target.tomb, class_id: target.classId, state: 'reserved' }).select('id');
      if (res.error && res.error.code === '23505') { raced += 1; continue; }
      if (res.error || !res.data || !res.data[0]) return refuse('read_failed');
      const rowId = res.data[0].id;
      let ok = false;
      try {
        ok = (await Ledger.record({ trigger: TRIGGER, initiated: 'bot', recipient: 'family', classId: target.classId, usdEach: usd, now: new Date(t) })) === true;
      } catch (_) { ok = false; }
      if (!ok) { await setState(rowId, { state: 'failed' }); return refuse('ledger'); }
      const lang = clampLanguage(target.lang || 'ur');
      let delivered = false;
      try { delivered = Boolean(await transport(target.phone, `${go.template}_${lang}`, lang, [])); } catch (_) { delivered = false; }
      if (!delivered) { failed += 1; await setState(rowId, { state: 'failed' }); continue; }
      await setState(rowId, { state: 'sent', sent_at: new Date(clock()).toISOString() });
      sent += 1;
      let cls = null;
      try { cls = require('./web-quiz-kid').clsOf(target.classId) || null; } catch (_) { cls = null; }
      emit(f, 'sample_ping_sent', { term: go.term, cls, usd });
    }
    return { sent, capped, raced, failed };
  } catch (e) {
    logError('web_quiz.sample_ping_failed', { error: String(e && e.message || e).slice(0, 120) });
    return { sent, refused: 'read_failed' };
  }
}

module.exports = {
  flags, readGo, quietHours, classWindowOpen, plan, dryRun, send,
  SWITCH_KEY, GO_KEY, TERM_CAP_SENDS, PER_CLASS_CAP, QUIET_START_H, QUIET_END_H, RATE,
  _resetCache: () => { cache = null; },
};
