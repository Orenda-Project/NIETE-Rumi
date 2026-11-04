/**
 * The portal's Redis for small edge answers that every portal copy shares (today: a shared link's page facts,
 * web_quiz_card_fast). index.js hands it the session store's client once connected and takes it back on close.
 * No client, or a client that is not ready: get answers null and set answers false, at once. Never throws.
 *
 *   setClient(client | null)    get(key) -> Promise<string | null>    set(key, value, ttlSeconds) -> Promise<boolean>
 *   del(key) -> Promise<boolean | null>   true deleted, false was not there, null no client or the call failed
 *   hit(key, windowMs) -> Promise<{ n, ttlMs } | null>    unhit(key) -> Promise<boolean>    forget(key) -> Promise<boolean>
 *
 * The bot shares this Redis (same REDIS_URL on the portal and bot services, no key prefix; checked on sandbox and
 * staging 2026-11-03), so del() can clear a bot key the portal knows the name of (bd-tacnwy, the role switch).
 *
 * hit/unhit are a fixed-window counter (bd-e0dqwz: the sign-in rate limits, lib/auth-rate-limits.js): the first hit
 * starts the window, the key expires with it. One script, so the count and its expiry are set together.
 */
let client = null;

function setClient(c) {
  client = c || null;
}

const ready = () => Boolean(client && client.isReady !== false);

async function get(key) {
  if (!ready()) return null;
  try { return await client.get(key); } catch (_) { return null; }
}

async function set(key, value, ttlSeconds) {
  if (!ready()) return false;
  try { await client.set(key, value, { EX: ttlSeconds }); return true; } catch (_) { return false; }
}

async function del(key) {
  if (!ready()) return null;
  try { return (await client.del(key)) > 0; } catch (_) { return null; }
}

const HIT_SCRIPT = "local n = redis.call('INCR', KEYS[1]) if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end "
  + "return { n, redis.call('PTTL', KEYS[1]) }";
// A window that has already expired is left alone: a DECR would recreate the key with no expiry.
const UNHIT_SCRIPT = "if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end local n = redis.call('DECR', KEYS[1]) "
  + "if n < 0 then redis.call('SET', KEYS[1], 0, 'KEEPTTL') n = 0 end return n";

async function hit(key, windowMs) {
  if (!ready()) return null;
  try {
    const [n, ttlMs] = await client.sendCommand(['EVAL', HIT_SCRIPT, '1', key, String(windowMs)]);
    return { n: Number(n), ttlMs: Number(ttlMs) };
  } catch (_) { return null; }
}

async function unhit(key) {
  if (!ready()) return false;
  try { await client.sendCommand(['EVAL', UNHIT_SCRIPT, '1', key, '0']); return true; } catch (_) { return false; }
}

async function forget(key) {
  if (!ready()) return false;
  try { await client.sendCommand(['DEL', key]); return true; } catch (_) { return false; }
}

module.exports = { setClient, get, set, del, hit, unhit, forget, HIT_SCRIPT, UNHIT_SCRIPT };
