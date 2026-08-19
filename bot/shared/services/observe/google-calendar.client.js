'use strict';
/**
 * Google Calendar transport — the thin, dependency-free layer.
 *
 * WHY NO SDK
 * ----------
 * `googleapis` is ~50MB of surface for three calls (insert, patch, delete) on
 * one API. This is a public repo that people clone and deploy; a dependency that
 * large, added for a feature that ships DEFAULT-OFF, is a cost every cloner pays
 * whether or not they ever turn it on. The whole protocol used here is: sign a
 * JWT with the service-account key, exchange it for an access token, and make
 * three REST calls. Node's own crypto signs RS256.
 *
 * DOMAIN-WIDE DELEGATION
 * ----------------------
 * A service account has no calendar of its own that a human can see. It has to
 * IMPERSONATE a real Workspace user, and that is what the `sub` claim in the
 * assertion does — this is the load-bearing line, the direct equivalent of
 * `.with_subject()` in the Python client. Without it the token is valid, every
 * call succeeds, and the events land in a calendar nobody opens.
 *
 * CONFIGURATION (all three required; missing any one leaves this dormant)
 *   GOOGLE_SERVICE_ACCOUNT_PATH   path to the service-account JSON key
 *   GOOGLE_CALENDAR_SUBJECT       the Workspace user to impersonate
 *   GOOGLE_CALENDAR_ID            target calendar (usually the subject's own)
 *
 * Nothing here is deployment-specific: no address, no domain, no calendar id is
 * hardcoded. `isConfigured()` is what every caller checks first.
 */

const crypto = require('crypto');
const fs = require('fs');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://www.googleapis.com/calendar/v3/calendars';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

/** Read at CALL time — a worker outlives any one env snapshot. */
function config() {
  return {
    keyPath: process.env.GOOGLE_SERVICE_ACCOUNT_PATH || '',
    subject: process.env.GOOGLE_CALENDAR_SUBJECT || '',
    calendarId: process.env.GOOGLE_CALENDAR_ID || '',
  };
}

function isConfigured() {
  const c = config();
  return Boolean(c.keyPath && c.subject && c.calendarId);
}

const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// One token per (subject, scope) until shortly before it expires. Re-minting on
// every call would triple the request count for no benefit.
let cached = null;

async function accessToken() {
  const { keyPath, subject } = config();
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.subject === subject && cached.expiresAt > now + 60) return cached.token;

  const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: key.client_email,
    sub: subject,               // domain-wide delegation — load-bearing
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const signature = b64url(
    crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(key.private_key)
  );

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`google-calendar: token exchange failed (${res.status}) ${body.error_description || ''}`);
  }
  cached = { subject, token: body.access_token, expiresAt: now + (body.expires_in || 3600) };
  return cached.token;
}

async function call(method, pathSuffix, payload) {
  const { calendarId } = config();
  const token = await accessToken();
  const url = `${API_BASE}/${encodeURIComponent(calendarId)}/events${pathSuffix}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  if (res.status === 204) return true;                 // DELETE
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`google-calendar: ${method} ${res.status} ${(body.error && body.error.message) || ''}`);
  }
  return body;
}

/**
 * `sendUpdates=all` so the coach actually receives the mail. Without it Google
 * creates the event and notifies nobody, which looks identical in the API
 * response and completely different to the person who was supposed to be told.
 */
const insertEvent = (event) => call('POST', '?sendUpdates=all', event);
const patchEvent = (eventId, patch) =>
  call('PATCH', `/${encodeURIComponent(eventId)}?sendUpdates=all`, patch);
const deleteEvent = (eventId) =>
  call('DELETE', `/${encodeURIComponent(eventId)}?sendUpdates=all`);

module.exports = { isConfigured, insertEvent, patchEvent, deleteEvent, _resetTokenCache: () => { cached = null; } };
