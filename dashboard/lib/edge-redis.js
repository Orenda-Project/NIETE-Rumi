/**
 * The portal's Redis for small edge answers that every portal copy shares (today: a shared link's page facts,
 * web_quiz_card_fast). index.js hands it the session store's client once connected and takes it back on close.
 * No client, or a client that is not ready: get answers null and set answers false, at once. Never throws.
 *
 *   setClient(client | null)    get(key) -> Promise<string | null>    set(key, value, ttlSeconds) -> Promise<boolean>
 *   del(key) -> Promise<boolean | null>   true deleted, false was not there, null no client or the call failed
 *
 * The bot shares this Redis (same REDIS_URL on the portal and bot services, no key prefix; checked on sandbox and
 * staging 2026-11-03), so del() can clear a bot key the portal knows the name of (bd-tacnwy, the role switch).
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

module.exports = { setClient, get, set, del };
