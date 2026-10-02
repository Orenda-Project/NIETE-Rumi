'use strict';
/**
 * Outbound echo — log the payload of a WhatsApp send, for SYNTHETIC test phones only.
 *
 * WHY. A simulated coach on the deployed sandbox bot (bot/scripts/e2e/child-test-sim, sandbox mode)
 * sends real webhooks, but the bot's answers go through Meta to a synthetic phone that no device
 * reads. The bot's own logs said only "✅ WhatsApp message sent" { messageId } — no text, no button
 * or list-row ids, no Flow token — so nothing could tell the driver what the bot asked it to tap.
 * This line is that record; the driver's Axiom reader (child-test-sim/replies-axiom.js) reads it.
 *
 * WHEN. Only when the recipient is on WA_OUTBOUND_ECHO_TO (comma list of phone numbers, digits
 * compared), and never in production (RAILWAY_ENVIRONMENT_NAME / ENVIRONMENT = production), whatever
 * the list says. Unset — every deployment today — it does nothing. List synthetic test-user phones
 * only: the payload is logged as sent.
 *
 * It never throws into a send: any failure here is swallowed.
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

const EVENT = 'whatsapp.outbound_echo';
const digitsOf = (v) => String(v == null ? '' : v).replace(/\D+/g, '');
let seq = 0;

function isProduction() {
  const env = String(process.env.RAILWAY_ENVIRONMENT_NAME || process.env.ENVIRONMENT || '').trim().toLowerCase();
  return env === 'production' || env === 'prod';
}

function allowList() {
  return String(process.env.WA_OUTBOUND_ECHO_TO || '').split(',').map(digitsOf).filter(Boolean);
}

/** Whether a send to this recipient is echoed. */
function shouldEcho(to) {
  const list = allowList();
  if (!list.length || isProduction()) return false;
  const d = digitsOf(to);
  return !!d && list.includes(d);
}

/**
 * @param {object} payload the /messages body as sent
 * @param {{ok: boolean, status?: number, messageId?: string}} outcome
 */
function note(payload, outcome = {}) {
  try {
    if (!payload || typeof payload !== 'object' || !shouldEcho(payload.to)) return;
    seq += 1;
    logger.logToFile(EVENT, {
      event: EVENT,
      echo_id: crypto.randomBytes(8).toString('hex'),
      echo_seq: seq,
      sent_at: new Date().toISOString(),
      to: digitsOf(payload.to),
      phone: digitsOf(payload.to),   // an Axiom core column: the reader filters on it server-side
      ok: !!outcome.ok,
      status: outcome.status == null ? null : outcome.status,
      message_id: outcome.messageId || null,
      payload,
    });
  } catch (_) { /* never break a send */ }
}

module.exports = { note, shouldEcho, EVENT };
