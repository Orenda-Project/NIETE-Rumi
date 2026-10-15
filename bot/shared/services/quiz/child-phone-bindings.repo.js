'use strict';
/**
 * The family phones a child is bound to (table child_phone_bindings).
 *
 * The child is the key, never the phone and never a device: one row = one
 * canonical child id on one normalised phone, confirmed by the family. Undo,
 * STOP and expiry ERASE the phone (phone_norm = NULL); the row keeps only
 * phone_tomb, a salted HMAC of the phone, so a re-bind is recognised as one.
 *
 * Supabase only. Nothing here throws: every read fails towards "no binding",
 * every write towards "nothing written" (null / []).
 *
 * Also the academic-year clock the binding uses (1 April 00:00 PKT → 31 March
 * 23:59:59 PKT): expiresAtFor() and yearCode().
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { normalisePhone } = require('./student-identity.service');
const IdFlags = require('./web-quiz-identity-flags');

const TABLE = 'child_phone_bindings';
const COLS = 'id, canonical_id, phone_norm, phone_tomb, via, confirmed_at, bound_at, last_played_at, expires_at, revoked_at, revoked_by, rebind_of';
const VIA = Object.freeze(['save', 'learned', 'guest', 'teacher']);
const REVOKED_BY = Object.freeze(['page_undo', 'stop', 'expiry', 'teacher', 'teacher_claim']);
const DAY_MS = 24 * 60 * 60 * 1000;
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const RENEW_WINDOW_MS = 31 * DAY_MS;

const iso = (d) => new Date(d).toISOString();

// ─── the academic year ─────────────────────────────────────────────────────

/** The start year of the academic year `date` falls in (the year runs 1 April 00:00 PKT → 31 March 23:59:59 PKT). */
function yearStartOf(date) {
  const pkt = new Date(new Date(date).getTime() + PKT_OFFSET_MS);
  return pkt.getUTCMonth() >= 3 ? pkt.getUTCFullYear() : pkt.getUTCFullYear() - 1;
}

/** 31 March 23:59:59 PKT (18:59:59Z) ending the academic year that starts in `startYear`. */
const yearEnd = (startYear) => new Date(Date.UTC(startYear + 1, 2, 31, 18, 59, 59));

/**
 * When a binding made or renewed by a play at `playedAt` expires: the 31 March ending that academic year;
 * a play within the last 31 days before it → the 31 March a year later (a child active at year end is not cut off).
 */
function expiresAtFor(playedAt = new Date()) {
  const t = new Date(playedAt).getTime();
  const start = yearStartOf(t);
  const end = yearEnd(start);
  return end.getTime() - t < RENEW_WINDOW_MS ? yearEnd(start + 1) : end;
}

/** '2026-27' for any date in the academic year 1 Apr 2026 00:00 PKT → 31 Mar 2027 23:59:59 PKT. */
function yearCode(date = new Date()) {
  const y = yearStartOf(date);
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

// ─── the tombstone ─────────────────────────────────────────────────────────

/** hex(HMAC-SHA256(WQ_TOMB_SALT, phone_norm))[0:32]; null when the salt is unset (then nothing is written). */
function tombOf(phoneNorm) {
  const salt = process.env.WQ_TOMB_SALT;
  const phone = normalisePhone(phoneNorm);
  if (!salt || !phone) return null;
  return crypto.createHmac('sha256', salt).update(phone).digest('hex').slice(0, 32);
}

// ─── reads ─────────────────────────────────────────────────────────────────

async function rows(label, build) {
  try {
    const { data, error } = await build();
    if (error) throw new Error(error.message || 'read failed');
    return data || [];
  } catch (err) {
    logToFile(`⚠️ child bindings: ${label} failed — no binding`, { error: err.message });
    return [];
  }
}

/** The active bindings on this phone (not revoked, not expired), oldest first. */
async function activeForPhone(phoneNorm, now = new Date()) {
  const phone = normalisePhone(phoneNorm);
  if (!phone) return [];
  return rows('activeForPhone', () => supabase.from(TABLE).select(COLS)
    .eq('phone_norm', phone).is('revoked_at', null).gt('expires_at', iso(now)).order('bound_at', { ascending: true }));
}

/** The active bindings of one child (the per-child cap of 3 phones). */
async function activeForChild(canonicalId, now = new Date()) {
  if (!canonicalId) return [];
  return rows('activeForChild', () => supabase.from(TABLE).select(COLS)
    .eq('canonical_id', String(canonicalId)).not('phone_norm', 'is', null).is('revoked_at', null).gt('expires_at', iso(now))
    .order('bound_at', { ascending: true }));
}

/** The newest erased row with this tombstone (a re-bind's `rebind_of`), or null. */
async function findByTomb(tomb) {
  if (!tomb) return null;
  const found = await rows('findByTomb', () => supabase.from(TABLE).select(COLS)
    .eq('phone_tomb', String(tomb)).not('revoked_at', 'is', null).order('revoked_at', { ascending: false }).limit(1));
  return found[0] || null;
}

// ─── writes ────────────────────────────────────────────────────────────────

/** A new binding → the row, or null (bad input, no salt, a failed write). */
async function insert({ canonicalId, phoneNorm, via, confirmedAt = new Date(), expiresAt, rebindOf = null } = {}) {
  const phone = normalisePhone(phoneNorm);
  if (!canonicalId || !phone || !VIA.includes(via) || !expiresAt) return null;
  const tomb = tombOf(phone);
  if (!tomb) {
    logToFile('⚠️ child bindings: no tomb salt — binding not written');
    return null;
  }
  try {
    const { data, error } = await supabase.from(TABLE).insert({
      canonical_id: String(canonicalId), phone_norm: phone, phone_tomb: tomb, via,
      confirmed_at: iso(confirmedAt), expires_at: iso(expiresAt), rebind_of: rebindOf || null,
    }).select(COLS).single();
    if (error || !data) throw new Error((error && error.message) || 'no row');
    return data;
  } catch (err) {
    logToFile('⚠️ child bindings: insert failed', { error: err.message });
    return null;
  }
}

/** A play renews an active binding → the row, or null. */
async function renew(id, expiresAt, lastPlayedAt = new Date()) {
  if (!id || !expiresAt) return null;
  const done = await rows('renew', () => supabase.from(TABLE).update({ expires_at: iso(expiresAt), last_played_at: iso(lastPlayedAt) })
    .eq('id', String(id)).is('revoked_at', null).select(COLS));
  return done[0] || null;
}

async function erase(label, filter, revokedBy, now) {
  if (!REVOKED_BY.includes(revokedBy)) return [];
  // The phone each row held, read BEFORE the erase: the caller forgets the door cache for it afterwards.
  const before = await rows(`${label}:read`, () => filter(supabase.from(TABLE).select('id, canonical_id, phone_norm')).is('revoked_at', null));
  if (!before.length) return [];
  const phoneOf = new Map(before.map((r) => [String(r.id), r.phone_norm]));
  const done = await rows(label, () => filter(supabase.from(TABLE).update({ phone_norm: null, revoked_at: iso(now), revoked_by: revokedBy }))
    .in('id', before.map((r) => r.id)).is('revoked_at', null).select('id, canonical_id'));
  return done.map((r) => ({ id: r.id, canonical_id: r.canonical_id, phone_norm: phoneOf.get(String(r.id)) || null }));
}

/** Erase one binding (phone_norm → NULL; the tomb stays) → [{id, canonical_id, phone_norm (as it was)}] erased ([] when none). */
function eraseOne(id, revokedBy, now = new Date()) {
  if (!id) return Promise.resolve([]);
  return erase('eraseOne', (q) => q.eq('id', String(id)), revokedBy, now);
}

/** Erase every active binding on this phone → [{id, canonical_id, phone_norm (as it was)}] erased. */
function eraseAllForPhone(phoneNorm, revokedBy, now = new Date()) {
  const phone = normalisePhone(phoneNorm);
  if (!phone) return Promise.resolve([]);
  return erase('eraseAllForPhone', (q) => q.eq('phone_norm', phone), revokedBy, now);
}

// ─── the one helper for the door and /quiz open ────────────────────────────

/**
 * The children on this phone: bound children first, then chat children, folded to canonical ids and deduped
 * → [{id, student_name, self_reported_class, created_at, src: 'bound'|'chat'}].
 * With web_quiz_phone_bind off it is exactly quizStudentsForPhone(phone).
 */
async function childrenForPhone(phone) {
  const StudentMode = require('../student-mode.service');
  const chat = await StudentMode.quizStudentsForPhone(phone);
  if (!(await IdFlags.flags()).phoneBind) return chat;
  try {
    const bound = await activeForPhone(normalisePhone(phone));
    const picks = [...bound.map((b) => ({ id: String(b.canonical_id), src: 'bound' })), ...chat.map((c) => ({ id: String(c.id), src: 'chat' }))];
    if (!picks.length) return chat;
    const canon = await require('./web-quiz-identity-roster').canonicalStudentIds(picks.map((p) => p.id));
    const seen = new Set();
    const order = [];
    picks.forEach((p) => {
      const id = canon.get(p.id) || p.id;
      if (!seen.has(id)) { seen.add(id); order.push({ id, src: p.src }); }
    });
    const chatById = new Map(chat.map((c) => [String(c.id), c]));
    const need = order.filter((o) => !chatById.has(o.id)).map((o) => o.id);
    const named = need.length
      ? await rows('childrenForPhone', () => supabase.from('students').select('id, student_name, self_reported_class, created_at').in('id', need).eq('is_active', true))
      : [];
    const byId = new Map(named.map((r) => [String(r.id), r]));
    return order.map((o) => {
      const r = chatById.get(o.id) || byId.get(o.id);
      return r ? { id: r.id, student_name: r.student_name, self_reported_class: r.self_reported_class, created_at: r.created_at, src: o.src } : null;
    }).filter(Boolean);
  } catch (err) {
    logToFile('⚠️ child bindings: children read failed — chat children only', { error: err.message });
    return chat;
  }
}

module.exports = {
  normalisePhone, tombOf,
  activeForPhone, activeForChild, findByTomb,
  insert, renew, eraseOne, eraseAllForPhone,
  expiresAtFor, yearCode, childrenForPhone,
  VIA, REVOKED_BY, TABLE,
};
