/**
 * The portal's read of app_settings `web_quiz_closed_inline` (default OFF). ON -> a child link (/h/<token>, /q/<code>) that
 * turns out closed or expired AFTER the page's head was streamed answers the closed page in the same stream, not by asking
 * again (a second document load). Fail closed and STRICT, exactly like closed-way-back-switch.js: only a JSON boolean `true`
 * is on; a string, a number, no row, no client, a failed or slow read -> OFF.
 *
 *   on(supabase)    -> Promise<boolean>   peek(supabase) -> boolean, NOW (cached; a cold cache is OFF and starts one read).
 */
const INLINE_KEY = 'web_quiz_closed_inline';
const TTL_MS = 30 * 1000;
const TIMEOUT_MS = 800;

/** The row's value is the JSON boolean true → true; anything else (or an error) → false. */
async function readStrict(supabase) {
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', INLINE_KEY).maybeSingle();
  if (error || !data) return false;
  return data.value === true;
}

function createClosedInlineSwitch({ now = Date.now, ttlMs = TTL_MS, timeoutMs = TIMEOUT_MS } = {}) {
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

// One cache for the whole portal (the child pages share it).
const shared = createClosedInlineSwitch();

module.exports = {
  createClosedInlineSwitch,
  on: (supabase) => shared.on(supabase),
  peek: (supabase) => shared.peek(supabase),
  _reset: () => shared._reset(),
  INLINE_KEY,
};
