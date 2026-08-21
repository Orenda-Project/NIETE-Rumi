'use strict';
/**
 * Voicenote script reader (bd-njn7u Phase 1.2).
 *
 * Every v8 voicenote .ogg on R2 has its script uploaded beside it as
 * <same key>.txt — the exact words Sara speaks. LP Q&A injects that text so
 * the model knows what the teacher actually heard (she may quote it back).
 *
 * The key is derived from the lesson asset's r2_key the same way the .ogg is
 * (lp-v8-delivery.service.js sendVoicenoteIfAny): swap .pdf for .txt. Deriving
 * rather than constructing from lesson_id+hash means one convention lives in
 * the DB row, not two copies of it in code.
 *
 * Failure is always null, never a throw — a missing script degrades the
 * context, it must never cost the teacher her reply. Scripts are immutable
 * per content_hash, so a small in-process TTL cache is safe.
 */

const { downloadFromR2 } = require('../storage/r2');
const { logToFile } = require('../utils/logger');

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 200;                 // ~200 scripts × ~2 KB — bounded and tiny

const cache = new Map();               // txtKey → { text, at }

function txtKeyFor(r2Key) {
  const key = String(r2Key || '');
  const derived = key.replace(/\.pdf$/i, '.txt');
  return derived !== key ? derived : null;
}

/**
 * @param {{r2_key: string}} entry - a shelf entry (or anything carrying the
 *   lesson asset's r2_key)
 * @returns {Promise<string|null>} the spoken script, or null when unavailable
 */
async function getVoicenoteScript(entry) {
  const txtKey = txtKeyFor(entry && entry.r2_key);
  if (!txtKey) return null;

  const hit = cache.get(txtKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.text;

  try {
    const buf = await downloadFromR2(txtKey);
    const text = buf ? buf.toString('utf8').trim() : null;
    if (!text) return null;
    if (cache.size >= CACHE_MAX) {
      cache.delete(cache.keys().next().value);   // drop the oldest insert
    }
    cache.set(txtKey, { text, at: Date.now() });
    return text;
  } catch (err) {
    // Missing .txt (older corpus versions) or an R2 hiccup — both degrade the
    // same way. Loud enough to count, quiet enough not to page anyone.
    logToFile('LP Q&A: voicenote script unavailable', { txtKey, error: err.message });
    return null;
  }
}

module.exports = { getVoicenoteScript };
