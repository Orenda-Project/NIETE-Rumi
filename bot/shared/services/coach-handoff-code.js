'use strict';
/**
 * bd-9652yj (queue #166) — the app→WhatsApp handoff code: the ONE definition both sides read.
 *
 * The portal (dashboard/routes/coach-handoff.routes.js) mints a code when a coach taps "Continue on WhatsApp" and stores
 * what she was doing under handoffKey(code) for 24 h in the Redis the bot and the portal share (same REDIS_URL, no key
 * prefix: dashboard/lib/edge-redis.js). The bot (coach-app-nudge.service) reads it when the typed line comes back.
 *
 * Payload (JSON): { u: users.id (the coach), v: observation_schedules.id or absent, s: the screen, j: journey id or null,
 * at: ISO time }. Ids only: no name, no phone. The code alone opens nothing: the bot resumes only for the same coach.
 *
 * Pure: no I/O, so the portal can require it without the bot's services.
 */
const crypto = require('crypto');

/** No 0/O, 1/I/L: a code read off a phone screen is never ambiguous. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;
const CODE_RX = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
const HANDOFF_TTL_S = 24 * 60 * 60;
/** The screens a code may name (portal/src/portal/coach/observe/ContinueOnWhatsApp.tsx). */
const HANDOFF_SCREENS = Object.freeze(['observe', 'pick', 'visit', 'record', 'attach', 'check', 'sending']);

const handoffKey = (code) => `coach_handoff:${code}`;
const isCode = (code) => typeof code === 'string' && CODE_RX.test(code);

/** A fresh random code (crypto, not Math.random). */
function newCode(randomInt = crypto.randomInt) {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

module.exports = { CODE_ALPHABET, CODE_LENGTH, HANDOFF_TTL_S, HANDOFF_SCREENS, handoffKey, isCode, newCode };
