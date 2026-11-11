'use strict';
/**
 * bd-ik5e8j.4 (queue #85) — the teacher app's how-to videos: one versioned manifest on the public content bucket,
 * read by this server and held in memory, the Reading Hour corpus's pattern (fln-corpus.service.js).
 *
 *   ${base}/${ver}/manifest.json = { version, videos: [ { feature, roles[], lang, title, url, url_small?, poster?,
 *                                                        seconds?, bytes? } ] }
 *
 *   base  env HELP_VIDEOS_BASE, else `${CONTENT_R2_PUBLIC_URL}/help`
 *   ver   app_settings `help_videos_version` (a new or replaced film is a new version: data, never a deploy)
 *
 * No version row, no base, a bad version string, or a failed read → NO videos (the app then says "coming soon"). The
 * version row is re-read at most every 5 min; a failed fetch is retried after a backoff. Nothing here writes anywhere.
 * videosFor() never throws.
 */

const VERSION_KEY = 'help_videos_version';
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RECHECK_MS = 5 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 10 * 1000;
const FEATURES = new Set(['start', 'home', 'lessons', 'coaching', 'observations', 'training', 'assessment', 'attendance',
  'classes', 'analytics', 'feedback', 'quiz']);
const LANGS = new Set(['en', 'ur']);

function baseUrl(env = process.env) {
  const b = (env.HELP_VIDEOS_BASE || '').trim();
  if (b) return b.replace(/\/+$/, '');
  const pub = (env.CONTENT_R2_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  return pub ? `${pub}/help` : null;
}

const isHttps = (u) => typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/.test(u);
const posInt = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.round(Number(n)) : null);

/** One manifest entry, cleaned; null when it is not a usable video. Only https URLs pass. */
function cleanVideo(v) {
  if (!v || typeof v !== 'object') return null;
  const feature = typeof v.feature === 'string' ? v.feature.trim() : '';
  const lang = typeof v.lang === 'string' ? v.lang.trim() : '';
  const roles = Array.isArray(v.roles) ? v.roles.filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim()) : [];
  if (!FEATURES.has(feature) || !LANGS.has(lang) || !roles.length || !isHttps(v.url)) return null;
  return {
    feature,
    roles,
    lang,
    title: typeof v.title === 'string' ? v.title.slice(0, 120) : '',
    url: v.url,
    urlSmall: isHttps(v.url_small) ? v.url_small : null,
    poster: isHttps(v.poster) ? v.poster : null,
    seconds: posInt(v.seconds),
    bytes: posInt(v.bytes),
  };
}

/**
 * The service, with its reads injected (tests pass their own; the app uses the defaults).
 * @param {{ readVersion?: () => Promise<string|null>, fetchJson?: (url: string) => Promise<any>, env?: object,
 *           now?: () => number }} deps
 */
function createHelpVideos(deps = {}) {
  const env = deps.env || process.env;
  const now = deps.now || Date.now;
  const readVersion = deps.readVersion || (async () => {
    const supabase = require('../config/supabase');
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', VERSION_KEY).maybeSingle();
    if (error || !data) return null;
    let v = data.value;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* a bare string */ } }
    return typeof v === 'string' ? v.trim() : null;
  });
  const fetchJson = deps.fetchJson || (async (url) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally { clearTimeout(t); }
  });

  let state = { version: null, videos: [] };
  let checkedAt = 0;
  let retryAt = 0;
  let inflight = null;

  async function refresh() {
    const ver = await readVersion().catch(() => null);
    const base = baseUrl(env);
    if (!ver || !VERSION_RE.test(ver) || !base) { state = { version: null, videos: [] }; return; }
    if (ver === state.version) return;
    const manifest = await fetchJson(`${base}/${encodeURIComponent(ver)}/manifest.json`);
    const videos = (manifest && Array.isArray(manifest.videos) ? manifest.videos : []).map(cleanVideo).filter(Boolean);
    state = { version: ver, videos };
  }

  async function ensure() {
    const t = now();
    if (t - checkedAt < RECHECK_MS || t < retryAt) return;
    if (!inflight) {
      inflight = refresh()
        .then(() => { checkedAt = now(); retryAt = 0; })
        .catch((err) => {
          retryAt = now() + RETRY_MS;
          console.warn('help-videos: manifest unavailable', { error: err && err.message });
        })
        .finally(() => { inflight = null; });
    }
    await inflight;
  }

  /** Her videos: her role and her language, in the manifest's order. Never throws; [] when there are none. */
  async function videosFor({ role, lang }) {
    try {
      await ensure();
      const l = lang === 'en' ? 'en' : 'ur';
      return state.videos
        .filter((v) => v.lang === l && v.roles.includes(role))
        .map(({ roles: _roles, ...v }) => v);
    } catch (_) {
      return [];
    }
  }

  return { videosFor, _state: () => state };
}

module.exports = { createHelpVideos, cleanVideo, baseUrl, VERSION_KEY };
