'use strict';
/**
 * WhatsApp Business Calling API client (bd-1hae7.1).
 *
 * POST /{PHONE_NUMBER_ID}/calls with an action of pre_accept | accept | reject |
 * terminate. Same global-fetch + Bearer idiom as WhatsAppService, so there is
 * exactly one way this repo talks to Graph.
 *
 * The SDP always goes up as an ANSWER: WhatsApp sends us the offer in the
 * `connect` webhook, we answer it. Sending sdp_type 'offer' is accepted by the
 * API and produces a call with no media — a silent line, not an error.
 *
 * Docs: developers.facebook.com/docs/whatsapp/cloud-api/calling
 */

const { WHATSAPP_TOKEN, PHONE_NUMBER_ID } = require('../utils/constants');

const graphVersion = () => process.env.GRAPH_API_VERSION || 'v21.0';
const callsUrl = () => `https://graph.facebook.com/${graphVersion()}/${PHONE_NUMBER_ID}/calls`;

/**
 * Post a call-control action. Throws on a Graph failure so the engine can free
 * the line (close the session + terminate) rather than leaving a dead call
 * holding a concurrency slot.
 */
async function post(body) {
  const res = await fetch(callsUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
  });

  let json = null;
  try {
    json = await res.json();
  } catch (_) {
    json = null;
  }

  if (!res.ok) {
    const detail = (json && json.error && json.error.message) || `HTTP ${res.status}`;
    const err = new Error(`[calls-api] ${body.action} failed: ${detail}`);
    err.status = res.status;
    err.graph = json;
    throw err;
  }
  return json;
}

/** Warm the media path before accepting, so audio flows the instant we accept. */
const preAccept = (callId, sdpAnswer) =>
  post({ call_id: callId, action: 'pre_accept', session: { sdp_type: 'answer', sdp: sdpAnswer } });

/** Accept the call, handing WhatsApp our SDP answer so media can flow. */
const accept = (callId, sdpAnswer) =>
  post({ call_id: callId, action: 'accept', session: { sdp_type: 'answer', sdp: sdpAnswer } });

/** Decline before answering — busy line, budget cap, flag off. */
const reject = (callId) => post({ call_id: callId, action: 'reject' });

/** Hang up an accepted call from our side — max duration, watchdog, teardown. */
const terminate = (callId) => post({ call_id: callId, action: 'terminate' });

module.exports = { preAccept, accept, reject, terminate };
