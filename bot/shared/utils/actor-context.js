'use strict';
/**
 * actor-context — WHO the bot is acting for, carried to the database.
 *
 * The bot talks to Supabase with the service-role key, so every row it writes
 * reaches Postgres as `authenticator` with a JWT that has no subject. The
 * record_history trigger therefore attributed 188,963 of 189,013 production rows
 * (measured 2026-09-15) to the literal string 'authenticator' — populated, never
 * NULL, and useless: it could not say which coach renamed a class or struck a
 * child off a register.
 *
 * This module is the fix on the bot side. A Flow endpoint or handler that knows
 * the acting user wraps its work in `runAsActor(userId, fn)`; the Supabase client
 * (bot/shared/config/supabase.js) sends the actor on every request made inside
 * that context as the `x-rumi-actor` header. PostgREST forwards request headers
 * into the transaction as `request.headers`, so the trigger can read it — for a
 * direct .insert()/.update() AND for an .rpc(), on the transaction pooler, with
 * no change to any service signature. That is why this is an AsyncLocalStorage
 * (the same pattern as runWithCorrelation) and not a parameter threaded through
 * two dozen functions that three parallel agents are editing.
 *
 * ATTRIBUTION, NOT AUTHORITY. The header is trusted by the trigger only when the
 * JWT role is service_role — a key that can already write anything — and only
 * when the value is uuid-shaped. A phone number, a display name or a stray
 * string never becomes an actor; it becomes nothing, and the row records the
 * connection role as before.
 */
const { AsyncLocalStorage } = require('async_hooks');

const ACTOR_HEADER = 'x-rumi-actor';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const actorStorage = new AsyncLocalStorage();

/** True when the value is something the ledger may record as a person. */
function isActorId(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * Run `fn` with `actorUserId` (a users.id) as the acting user for every database
 * request made inside it, across awaits. A non-uuid id sets no context at all —
 * the write still happens, unattributed, exactly as today.
 */
function runAsActor(actorUserId, fn) {
  if (!isActorId(actorUserId)) return fn();
  // `async () => fn()` and not `fn` itself: a PostgREST builder is a LAZY thenable —
  // the request only fires when something calls .then() on it. If fn returns the
  // builder unawaited, a bare run() would hand it to the caller and the caller's
  // await would fire the fetch OUTSIDE the context (measured: header absent on the
  // wire). Adopting the thenable inside an async function keeps the resolution,
  // and therefore the fetch, inside the store.
  return actorStorage.run({ actorUserId: actorUserId.toLowerCase() }, async () => fn());
}

/** The acting user inside a runAsActor scope, else null. */
function currentActor() {
  const store = actorStorage.getStore();
  return (store && store.actorUserId) || null;
}

/**
 * A fetch that adds the actor header when there is an actor. Handed to
 * createClient as `global.fetch`; `base` is injectable for tests and defaults to
 * the platform fetch at CALL time (so a test may stub global.fetch).
 */
function actorFetch(input, init = {}, base = null) {
  const doFetch = base || globalThis.fetch;
  const actor = currentActor();
  if (!actor) return doFetch(input, init);
  const headers = new Headers(init && init.headers ? init.headers : undefined);
  headers.set(ACTOR_HEADER, actor);
  return doFetch(input, { ...init, headers });
}

module.exports = { ACTOR_HEADER, runAsActor, currentActor, actorFetch };
