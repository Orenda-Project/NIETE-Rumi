'use strict';
/**
 * A CLASS LINK ON A PHONE THAT ALREADY HOLDS A CHILD ASKS "IS IT <FIRST>?" FIRST.
 *
 * A child who joined on their own is kept by their phone: opening their home (`/quiz` → the hub) trusts that browser
 * for them (web-quiz-hub-device deviceTrusted). The teacher's class link, opened later in the same browser, used to
 * ask "What is your name?" as for a stranger: the child typed their first name, the server could not tell it from a
 * new child, and the finish went to a second child the home never shows. With app_settings `web_quiz_link_known_child`
 * on (JSON `true` only; 30 s cache; off on any read error) the page asks the server which children this browser holds
 * and asks "Is it <First>?" (two or more: "Who is playing?") before the name box; "Yes" starts the session as that
 * child — the one id the child is known by — and "Someone else" is today's name box.
 *
 *   field(ctx, {preview})        true when the quiz payload may name `link_known` (the page then asks), else false
 *   known({code, device_ref}, resolveCode)  {kids: [{chip, first, animal}]}: the children THIS browser holds, as
 *                                cards for this code (first names only, ≤ KIDS_MAX, newest first); {kids: []} otherwise
 *   kidFor(ctx, chip, device)    the session's child for a `via: 'known'` start: one of those children, or null
 *
 * Who a browser holds: the children a hub (or a bot-sent link) trusted it with (deviceKids), each mapped to the one id
 * it is known by (a merged record → its survivor), still active, and passed by the same read-only gate the next offer
 * uses (deviceMayName). Never a classmate, never a child this browser was not trusted with: a link forwarded to a fresh
 * phone is answered nobody, and the page shows today's screen. Never on a friend's challenge code or the teacher's
 * preview. Telemetry: counts and reasons only (`web_quiz.link_known`), never an id or a name.
 */
const supabase = require('../../config/supabase');
const { read: dbRead } = require('./web-quiz-db-deadline');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const T = require('./web-quiz-token');
const Device = require('./web-quiz-hub-device');

const KEY = 'web_quiz_link_known_child';
const TTL_MS = 30 * 1000;
// "Who is playing?" never grows past the one-door chips' size: a phone passed around a class shows its newest four.
const KIDS_MAX = 4;
let cache = null; // { at, on }

// JSON `true` only: a string 'true' row is off.
const isTrue = (value) => value === true;
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';

/** The switch. Off on any read error (never cached then). */
async function isOn(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const row = (data || []).find((r) => r.key === KEY);
    cache = { at: now, on: Boolean(row) && isTrue(row.value) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ web quiz link known child: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** May the quiz payload carry `link_known`? Never on a friend's challenge or the teacher's preview. Never throws. */
async function field(ctx, { preview = false } = {}) {
  try {
    if (!ctx || ctx.invitedByStudentId || preview) return false;
    return await isOn();
  } catch (_) {
    return false;
  }
}

/** The one id each held child is known by (the identity store's survivor), when that store is on; else the ids. */
async function canonical(ids) {
  try {
    if (!(await require('./web-quiz-identity-flags').flags()).canon) return new Map(ids.map((id) => [id, id]));
    return await require('./web-quiz-identity-roster').canonicalStudentIds(ids);
  } catch (_) {
    return new Map(ids.map((id) => [id, id]));
  }
}

/**
 * The children this browser holds, newest first: [{id, student_name, student_name_urdu, self_reported_class}] (≤ KIDS_MAX).
 * [] with no device, nobody trusted, Redis down, or any read error.
 */
async function heldBy(device) {
  const d = T.cleanDeviceRef(device);
  if (!d) return [];
  const held = await Device.deviceKids(d);
  if (!held.length) return [];
  const map = await canonical(held);
  const out = [];
  const seen = new Set();
  for (const id of held) {
    const c = String(map.get(String(id)) || id);
    if (seen.has(c)) continue;
    seen.add(c);
    // read-only: the child (or the record the phone was trusted with) on THIS browser, as the next offer checks it
    if (await Device.deviceMayName([...new Set([String(id), c])], d)) out.push({ c, rank: out.length });
  }
  if (!out.length) return [];
  const { data, error } = await dbRead('linkKnown:students:1', (db) => db.from('students')
    .select('id, student_name, student_name_urdu, self_reported_class, is_active, status').in('id', out.map((x) => x.c)));
  if (error) return [];
  const by = new Map((data || []).filter((r) => r.is_active !== false && r.status !== 'merged').map((r) => [String(r.id), r]));
  return out.map((x) => by.get(x.c)).filter(Boolean).slice(0, KIDS_MAX);
}

function shownFirst(lang, k) {
  return firstName(lang === 'ur' && k.student_name_urdu && String(k.student_name_urdu).trim() ? k.student_name_urdu : k.student_name);
}

async function known(body = {}, resolveCode = null) {
  const none = (reason) => { logEvent('web_quiz.link_known', { ok: false, reason }); return { kids: [] }; };
  try {
    if (!(await isOn())) return { kids: [] };
    if (!T.cleanDeviceRef(body.device_ref)) return none('no_device');
    // The quiz service's resolveCode, handed in by the caller (this module never requires the service: no require loop).
    if (typeof resolveCode !== 'function') return none('no_code');
    let ctx;
    try { ctx = await resolveCode(body.code); } catch (_) { return none('no_code'); }
    if (ctx.invitedByStudentId) return none('challenge');
    const kids = await heldBy(body.device_ref);
    if (!kids.length) return none('nobody');
    logEvent('web_quiz.link_known', { ok: true, kids: kids.length });
    return { kids: kids.map((k) => ({ chip: T.chipId(ctx.shareCodeId, k.id), first: shownFirst(ctx.lang, k), animal: T.animalFor(k.id) })) };
  } catch (err) {
    logToFile('⚠️ web quiz link known child: nobody answered', { error: err.message });
    return { kids: [] };
  }
}

/** A `via: 'known'` start: the held child whose chip on this code it is → {id, student_name, self_reported_class}, or null. */
async function kidFor(ctx, chip, device) {
  try {
    if (!ctx || ctx.invitedByStudentId || !(await isOn())) return null;
    const k = (await heldBy(device)).find((x) => T.chipId(ctx.shareCodeId, x.id) === String(chip));
    return k ? { id: k.id, student_name: k.student_name, self_reported_class: k.self_reported_class || null } : null;
  } catch (_) {
    return null;
  }
}

module.exports = { field, known, kidFor, isOn, KEY, KIDS_MAX, _resetCache: () => { cache = null; } };
