/**
 * The portal's read of app_settings `web_quiz_link_known_child` (default OFF; the same row the bot reads in
 * bot/shared/services/quiz/web-quiz-link-known.js): ON → a closed class link asks the bot for this phone's way home.
 * STRICT and fail closed, as lib/closed-way-back-switch.js: only a JSON boolean `true` is on; a string, a number, no row,
 * no client, a failed or slow read — all OFF.
 *
 *   peek(supabase)  → boolean, NOW: the cached answer (30 s); a cold or old cache answers what it last knew (OFF when it
 *                     knows nothing yet) and starts one read in the background. The closed page never waits on it.
 */
const KEY = 'web_quiz_link_known_child';
const TTL_MS = 30 * 1000;

function createLinkKnownSwitch({ now = Date.now, ttlMs = TTL_MS } = {}) {
  let cache = null; // { at, on }
  let inflight = null;
  let gen = 0; // a reset forgets a read still in flight

  function refresh(supabase) {
    if (inflight) return inflight;
    const mine = gen;
    const p = (async () => {
      let on = false;
      try {
        const { data, error } = await supabase.from('app_settings').select('value').eq('key', KEY).maybeSingle();
        on = !error && Boolean(data) && data.value === true;
      } catch (_) { on = false; }
      if (mine === gen) cache = { at: now(), on };
      return on;
    })().finally(() => { if (inflight === p) inflight = null; });
    inflight = p;
    return p;
  }

  function peek(supabase) {
    if (!supabase) return false;
    try {
      if (!cache || now() - cache.at >= ttlMs) refresh(supabase).catch(() => {});
      return Boolean(cache && cache.on);
    } catch (_) {
      return false;
    }
  }

  return { peek, _reset: () => { cache = null; inflight = null; gen += 1; } };
}

// One cache for the whole portal.
const shared = createLinkKnownSwitch();

module.exports = { createLinkKnownSwitch, peek: (supabase) => shared.peek(supabase), _reset: () => shared._reset(), KEY };
