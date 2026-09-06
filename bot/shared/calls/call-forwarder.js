'use strict';
/**
 * The bot→calls-service bridge (bd-1hae7.2).
 *
 * The message bot owns the one public webhook Meta posts to. Live calls run in
 * a SEPARATE Railway service so media work can never destabilise messaging and
 * the bot stays free to scale replicas. So the bot recognises a `value.calls`
 * payload, hands it over Railway private networking, and returns — a calls
 * payload never enters message handling.
 *
 * The forward is authenticated with a shared secret and **fails closed**: with
 * no secret (or no service URL) configured, nothing is forwarded. The calls
 * service is on the private network, but anything that can reach the public
 * webhook could otherwise make us dial Graph and burn concurrency slots.
 */

const crypto = require('crypto');
const { logToFile } = require('../utils/logger');

/** How long we wait on the calls service before abandoning a forward. */
const FORWARD_TIMEOUT_MS = Number(process.env.CALLS_FORWARD_TIMEOUT_MS) || 3000;

/**
 * Pull call events out of a webhook body.
 * @returns {{calls: Array, contacts: Array, metadata: object}|null} null when
 *          this is not a calls payload — the common case, so it stays cheap.
 */
function extractCallEvents(body) {
  const value = body
    && body.entry
    && body.entry[0]
    && body.entry[0].changes
    && body.entry[0].changes[0]
    && body.entry[0].changes[0].value;

  if (!value || !Array.isArray(value.calls) || value.calls.length === 0) return null;

  return {
    calls: value.calls,
    contacts: value.contacts || [],
    metadata: value.metadata || {},
  };
}

/**
 * Hand the events to the calls service. Fire-and-forget by contract: the bot's
 * webhook must answer Meta with 200 regardless of whether the calls service is
 * healthy, so this never throws and never blocks.
 */
async function forwardCallEvents(payload) {
  const baseUrl = (process.env.CALLS_SERVICE_URL || '').replace(/\/$/, '');
  const secret = process.env.CALLS_FORWARD_SECRET || '';

  if (!baseUrl || !secret) {
    logToFile('[calls] forward skipped — CALLS_SERVICE_URL/CALLS_FORWARD_SECRET not configured', {
      hasUrl: !!baseUrl, hasSecret: !!secret, callCount: payload.calls.length,
    });
    return undefined;
  }

  try {
    const res = await fetch(`${baseUrl}/internal/call-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-calls-secret': secret },
      body: JSON.stringify(payload),
      // A hung calls service — socket accepted, no response — cannot cost us the
      // webhook 200 (this is a void call), but without a deadline it leaves one
      // pending promise and one open socket per call event for as long as it
      // stays hung. Meta's own call-event window is far shorter than this, so a
      // forward still in flight at 3s has already missed the call it was for.
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
    if (!res.ok) {
      logToFile('[calls] forward returned non-2xx', { status: res.status, callCount: payload.calls.length });
    }
  } catch (err) {
    // The calls service being down must not cost us the webhook 200 — Meta
    // retries webhooks, and a retry storm on messages would be far worse.
    // A timeout is logged distinctly: "the service is unreachable" and "the
    // service accepted my socket and went quiet" are different outages.
    const timedOut = err.name === 'TimeoutError' || err.name === 'AbortError';
    logToFile(timedOut ? '[calls] forward timed out' : '[calls] forward failed', {
      error: err.message,
      timeoutMs: timedOut ? FORWARD_TIMEOUT_MS : undefined,
      callCount: payload.calls.length,
    });
  }
  return undefined;
}

/**
 * Constant-time secret check for the receiving side. Rejects when either value
 * is missing so an unconfigured service can never be opened by an empty header.
 */
function verifyForwardSecret(expected, provided) {
  if (!expected || !provided) return false;
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(provided));
  if (a.length !== b.length) return false; // timingSafeEqual throws on length mismatch
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  extractCallEvents, forwardCallEvents, verifyForwardSecret, FORWARD_TIMEOUT_MS,
};
