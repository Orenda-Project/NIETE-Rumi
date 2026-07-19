/**
 * FEAT-053 bd-12 — /observe capture-state machine (Redis).
 *
 * One key per user: observe:state:<userId> → JSON { state, ...extra, updatedAt }.
 * States: awaiting_audio → awaiting_photos → analyzing → awaiting_form →
 * awaiting_debrief_choice (later phases consume these; P0 sets awaiting_audio).
 * TTL 2h — an abandoned observation quietly expires.
 */

const redisService = require('../cache/railway-redis.service');
const { logToFile } = require('../../utils/logger');

const TTL_SECONDS = 7200;
const key = (userId) => `observe:state:${userId}`;

async function setState(userId, state, extra = {}) {
  const payload = JSON.stringify({ state, ...extra, updatedAt: new Date().toISOString() });
  return redisService.setexWithCeiling(key(userId), TTL_SECONDS, payload);
}

async function getState(userId) {
  try {
    // railway-redis get() AUTO-PARSES JSON (returns an object; falls back to
    // the raw string only when parsing fails). Handle both shapes — calling
    // JSON.parse on the already-parsed object was the bug that silently
    // dropped observe capture state on staging (caught live 2026-07-12).
    const raw = await redisService.get(key(userId));
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    return JSON.parse(raw);
  } catch (err) {
    logToFile('⚠️ observe-state: unreadable state, treating as none', {
      userId, error: err.message,
    });
    return null;
  }
}

async function clearState(userId) {
  return redisService.delete(key(userId));
}

module.exports = { setState, getState, clearState, TTL_SECONDS };
