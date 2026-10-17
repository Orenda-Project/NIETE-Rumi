/**
 * The portal's read of app_settings `web_quiz_closed_way_back` (default OFF; the same row the bot reads in
 * bot/shared/services/first-touch/closed-way-back.flags.js): ON → a closed page of kind 'hub' / 'closed' and the
 * edge's go.error page carry ONE tap back to WhatsApp. Fail closed, like lib/feature-flags.js, and STRICT: only a
 * JSON boolean `true` (value === true) is on. A string ("true" or anything else), a number, an object, no row, no
 * client, a failed or slow read — all OFF.
 *
 *   on(supabase)    → Promise<boolean>: the cached answer (30 s), else ONE read, never longer than `timeoutMs`.
 *   peek(supabase)  → boolean, NOW: the cached answer; a cold or old cache answers what it last knew (OFF when it
 *                     knows nothing yet) and starts one read in the background. For a page that must never wait on it
 *                     (the closed page): a slow or failed read is today's page.
 *
 * The client is passed per call (the app's own: app.locals.supabase), so a route with no client reads nothing.
 */
const WAY_BACK_KEY = 'web_quiz_closed_way_back';
const TTL_MS = 30 * 1000;
const TIMEOUT_MS = 800;

/** The row's value is the JSON boolean true → true; anything else (or an error) → false. */
async function readStrict(supabase) {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', WAY_BACK_KEY).maybeSingle();
  if (error || !data) return false;
  return data.value === true;
}

function createWayBackSwitch({ now = Date.now, ttlMs = TTL_MS, timeoutMs = TIMEOUT_MS } = {}) {
  let cache = null; // { at, on }
  let inflight = null;
  let gen = 0; // a reset forgets a read still in flight

  const fresh = () => Boolean(cache) && now() - cache.at < ttlMs;

  function refresh(supabase) {
    if (inflight) return inflight;
    const mine = gen;
    const p = (async () => {
      let on = false;
      try { on = await readStrict(supabase); } catch (_) { on = false; }
      if (mine === gen) cache = { at: now(), on };
      return on;
    })().finally(() => { if (inflight === p) inflight = null; });
    inflight = p;
    return p;
  }

  async function on(supabase) {
    if (!supabase) return false;
    if (fresh()) return cache.on;
    let timer = null;
    try {
      const late = new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
      return (await Promise.race([refresh(supabase), late])) === true;
    } catch (_) {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function peek(supabase) {
    if (!supabase) return false;
    try {
      if (!fresh()) refresh(supabase).catch(() => {});
      return Boolean(cache && cache.on);
    } catch (_) {
      return false;
    }
  }

  return { on, peek, _reset: () => { cache = null; inflight = null; gen += 1; } };
}

// One cache for the whole portal (the closed pages and the one door's edge share it).
const shared = createWayBackSwitch();

module.exports = {
  createWayBackSwitch,
  on: (supabase) => shared.on(supabase),
  peek: (supabase) => shared.peek(supabase),
  _reset: () => shared._reset(),
  WAY_BACK_KEY,
};
