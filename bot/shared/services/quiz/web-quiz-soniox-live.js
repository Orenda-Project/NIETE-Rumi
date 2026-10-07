'use strict';
/**
 * Soniox real-time for the read-aloud, from the child's phone: the bot mints a TEMPORARY key per run with its own
 * key (which never leaves the server), and the page opens the WebSocket with it (the key goes in the first config
 * message, as Soniox's own browser SDK does). Soniox keeps no audio or transcript from a real-time stream.
 *
 *   single_use                    the key opens exactly one stream
 *   expires_in_seconds 30         time to connect after the mint
 *   max_session_duration_s 90     60 s of reading + finalising
 *   client_reference_id           the run id (a UUID; nothing about the child)
 *
 * Docs: soniox.com/docs/guides/temporary-api-keys, /docs/stt/api-reference/auth/create_temporary_api_key,
 * /docs/stt/api-reference/websocket-api. A failure here is never the child's: the page reads with today's upload path.
 */
const MINT_URL = 'https://api.soniox.com/v1/auth/temporary-api-key';
const WS_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';
const MODEL = process.env.SONIOX_RT_MODEL || 'stt-rt-v5';
const CONNECT_S = 30;
const SESSION_S = 90;
const TIMEOUT_MS = 3000;

const configured = (env = process.env) => !!String(env.SONIOX_API_KEY || '').trim();

/** → { ok:true, api_key, expires_at } | { ok:false, status, reason } — never throws, never logs a key. */
async function mintTempKey(runId, { env = process.env, timeoutMs = TIMEOUT_MS } = {}) {
  const key = String(env.SONIOX_API_KEY || '').trim();
  if (!key) return { ok: false, status: 0, reason: 'no_key' };
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const res = await globalThis.fetch(MINT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ usage_type: 'transcribe_websocket', expires_in_seconds: CONNECT_S, single_use: true, max_session_duration_seconds: SESSION_S, client_reference_id: String(runId) }),
      ...(ctl ? { signal: ctl.signal } : {}),
    });
    if (!res || !res.ok) return { ok: false, status: (res && res.status) || 0, reason: 'refused' };
    const j = await res.json();
    if (!j || typeof j.api_key !== 'string' || !j.api_key) return { ok: false, status: res.status, reason: 'no_key_in_answer' };
    return { ok: true, api_key: j.api_key, expires_at: j.expires_at || null };
  } catch (e) {
    return { ok: false, status: 0, reason: e && e.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = { mintTempKey, configured, WS_URL, MODEL, CONNECT_S, SESSION_S };
