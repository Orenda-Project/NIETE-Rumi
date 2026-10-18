'use strict';
/**
 * What a Reading Hour / Numeracy (FLN) plan IS, for the bot's readers.
 *
 * The FLN corpus is a versioned, immutable bundle on the content bucket (`fln/corpus/<ver>/`), read by
 * the portal's corpus service. The bot only ever needs to NAME a plan (recent lists, "All lesson
 * plans"), so it reads the small sidecar `index.json` beside the corpus — never the 12 MB
 * `corpus.json`:
 *
 *   { version, plans: { "<id>": { title, subject, level, lang, minutes, labels, pos, count } } }
 *
 * WHERE: `${FLN_CORPUS_BASE}/${ver}/index.json`. The base is FLN_CORPUS_BASE, else
 * `${CONTENT_R2_PUBLIC_URL}/fln/corpus`. The version is the `fln_corpus_version` app_settings row
 * (so it can change without a redeploy), else FLN_CORPUS_VERSION. All read at call time.
 *
 * NEVER THROWS. No base, no version, a failed fetch, a body whose `version` is not the one asked
 * for: `index()` resolves null and the caller names the plan generically. A failure is not cached
 * for long (a retry follows soon); a loaded index is re-checked against the version every 5 minutes.
 */

const RECHECK_MS = 5 * 60 * 1000;
const RETRY_MS = 30 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const VERSION_KEY = 'fln_corpus_version';
const VERSION = /^[A-Za-z0-9._-]{1,80}$/;

let cache = null; // { at, version, index } — index null after a failure
let pending = null;

function corpusBase() {
  const explicit = String(process.env.FLN_CORPUS_BASE || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const content = String(process.env.CONTENT_R2_PUBLIC_URL || '').trim();
  return content ? `${content.replace(/\/+$/, '')}/fln/corpus` : null;
}

/** An app_settings value is stored as JSON text ("\"v1-…\"") or bare; either way, a version or null. */
function cleanVersion(raw) {
  let v = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { /* bare text */ }
  }
  return typeof v === 'string' && VERSION.test(v.trim()) ? v.trim() : null;
}

async function settingVersion(supabase) {
  try {
    const { data, error } = await supabase
      .from('app_settings').select('value').eq('key', VERSION_KEY).maybeSingle();
    if (error || !data) return null;
    return cleanVersion(data.value);
  } catch (_) {
    return null;
  }
}

async function resolveVersion(supabase) {
  return (await settingVersion(supabase)) || cleanVersion(process.env.FLN_CORPUS_VERSION || '');
}

async function fetchIndex(base, version, fetchImpl) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const res = await fetchImpl(`${base}/${encodeURIComponent(version)}/index.json`, ctrl ? { signal: ctrl.signal } : {});
    if (!res || !res.ok) return null;
    const body = await res.json();
    if (!body || body.version !== version || !body.plans || typeof body.plans !== 'object') return null;
    return body;
  } catch (_) {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function load(deps, now) {
  const supabase = deps.supabase || require('../config/supabase');
  const fetchImpl = deps.fetch || globalThis.fetch;
  const base = corpusBase();
  const version = await resolveVersion(supabase);
  if (!base || !version || typeof fetchImpl !== 'function') {
    cache = { at: now, version, index: null };
    return null;
  }
  if (cache && cache.index && cache.version === version) {
    cache = { ...cache, at: now };
    return cache.index;
  }
  const index = await fetchIndex(base, version, fetchImpl);
  if (!index) console.error('❌ FLN index not loaded', { version });
  cache = { at: now, version, index };
  return index;
}

/**
 * The loaded index, or null. One fetch at a time; a cached answer is served while it is fresh.
 * @param {{ supabase?, fetch?, now? }} [deps]
 */
async function index(deps = {}) {
  const now = deps.now || Date.now();
  if (cache && now - cache.at < (cache.index ? RECHECK_MS : RETRY_MS)) return cache.index;
  if (!pending) {
    pending = load(deps, now).catch(() => null).finally(() => { pending = null; });
  }
  return pending;
}

/** One plan's entry, or null (not in the index, or no index). */
function entryOf(idx, id) {
  if (!idx || !idx.plans) return null;
  const e = idx.plans[String(id)];
  return e && typeof e === 'object' ? e : null;
}

function _reset() {
  cache = null;
  pending = null;
}

module.exports = { index, entryOf, corpusBase, cleanVersion, VERSION_KEY, _reset };
