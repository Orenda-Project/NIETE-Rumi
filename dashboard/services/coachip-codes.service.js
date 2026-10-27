'use strict';
/**
 * bd-sex15q.13 — COACHIP's anonymisation codec (SPEC v2 §8, API.md §4 + A13, INSIGHTS_SCHEMA §2 change 21).
 *
 *   teacherKey(users.id) = hex(HMAC-SHA256(COACHIP_TEACHER_KEY_SECRET, 'coachip-teacher|' + users.id))[0:16]
 *
 * SERVER ONLY. The key is the one teacher reference the insight tables hold (coachip_session_facts.teacher_key,
 * written by the nightly job with THIS function: m-insights imports teacherKeyFor from here, so the job and the
 * routes can never mint different keys). Its own secret, not fln-keys' INTERNAL_API_KEY derivation: rotating that key
 * would re-mint every teacher_key and silently renumber every code (A13). No secret, or one under 32 bytes → not
 * ready, and the coach routes answer 503 — never an unkeyed hash.
 *
 * The code a client sees is "T-07": the coach's ordinal for that key, assigned on first appearance in the coach's
 * scope, persisted in coachip_teacher_codes and never reassigned (the table's trigger refuses it). The client's handle
 * is code_id (the row's uuid), which travels only in POST bodies. A teacher held by two coaches has two codes that
 * nothing a client holds can join.
 */
const crypto = require('crypto');

const LABEL = 'coachip-teacher';
const KEY_RX = /^[0-9a-f]{16}$/;
const MIN_SECRET_BYTES = 32;
const AUDIT_ACTIONS = new Set(['decode', 'clip', 'full_audio', 'note_sent', 'circle_play']);

/** The pure key function (the job and the routes share it). null without a usable secret or id. */
function teacherKeyFor(secret, userId) {
  const id = userId == null ? '' : String(userId).trim();
  if (!id || typeof secret !== 'string' || Buffer.byteLength(secret) < MIN_SECRET_BYTES) return null;
  return crypto.createHmac('sha256', secret).update(`${LABEL}|${id}`).digest('hex').slice(0, 16);
}

/**
 * @param {{ query: Function, secret?: string }} deps  query: pg-shaped (sql, params) → {rows}
 */
function createCoachipCodes({ query, secret }) {
  const ready = () => typeof secret === 'string' && Buffer.byteLength(secret) >= MIN_SECRET_BYTES;
  const teacherKey = (userId) => (ready() ? teacherKeyFor(secret, userId) : null);
  const shape = (row) => ({ code_id: row.id, code: row.code });

  function assertKey(key) {
    if (typeof key !== 'string' || !KEY_RX.test(key)) throw new Error('coachip codes: not a teacher key');
  }

  /** One insert of the next ordinal, or the existing row. Retries when two inserts race for one ordinal. */
  async function codeFor(coachUserId, key, q = query) {
    assertKey(key);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const existing = await q('SELECT id, code FROM coachip_teacher_codes WHERE coach_user_id = $1 AND teacher_key = $2', [coachUserId, key]);
      if (existing.rows[0]) return shape(existing.rows[0]);
      try {
        const ins = await q(
          `INSERT INTO coachip_teacher_codes (coach_user_id, teacher_key, ordinal)
           SELECT $1, $2, COALESCE(MAX(ordinal), 0) + 1 FROM coachip_teacher_codes WHERE coach_user_id = $1
           ON CONFLICT (coach_user_id, teacher_key) DO NOTHING
           RETURNING id, code`,
          [coachUserId, key],
        );
        if (ins.rows[0]) return shape(ins.rows[0]);
      } catch (err) {
        // 23505 on (coach_user_id, ordinal): another request took that ordinal first; read again and retry.
        if (err.code !== '23505') throw err;
      }
    }
    throw new Error('coachip codes: could not assign an ordinal');
  }

  /**
   * Codes for many keys of one coach, in first-appearance order (the order given): existing rows are read in one
   * query, the missing ones assigned one by one in that order. → Map(key → Code).
   */
  async function codesFor(coachUserId, keys, q = query) {
    const unique = [...new Set(keys)];
    unique.forEach(assertKey);
    const out = new Map();
    if (!unique.length) return out;
    const { rows } = await q('SELECT id, code, teacher_key FROM coachip_teacher_codes WHERE coach_user_id = $1 AND teacher_key = ANY($2::text[])', [coachUserId, unique]);
    for (const r of rows) out.set(r.teacher_key, shape(r));
    for (const k of unique) {
      if (!out.has(k)) out.set(k, await codeFor(coachUserId, k, q));   // eslint-disable-line no-await-in-loop
    }
    return out;
  }

  /** The key behind the caller's own code_id; null for another coach's row or an unknown id. Server only. */
  async function keyFor(coachUserId, codeId, q = query) {
    const { rows } = await q('SELECT teacher_key FROM coachip_teacher_codes WHERE id = $1 AND coach_user_id = $2', [codeId, coachUserId]);
    return rows[0] ? rows[0].teacher_key : null;
  }

  /** One append-only coachip_audit_log row. Throws on failure; the caller decides (decode fails closed, a play proceeds). */
  async function audit(actorUserId, action, subjectId, q = query) {
    if (!AUDIT_ACTIONS.has(action)) throw new Error(`coachip audit: unknown action ${action}`);
    await q('INSERT INTO coachip_audit_log (actor_user_id, action, subject_id) VALUES ($1, $2, $3)', [actorUserId, action, subjectId]);
  }

  return { ready, teacherKey, codeFor, codesFor, keyFor, audit };
}

module.exports = { createCoachipCodes, teacherKeyFor, KEY_RX, LABEL };
