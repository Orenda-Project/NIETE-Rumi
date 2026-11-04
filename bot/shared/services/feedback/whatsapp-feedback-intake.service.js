'use strict';
/**
 * /feedback and /bug on WhatsApp — a teacher or a coach tells the team about a problem or an idea without leaving
 * the chat. Ported from the main bot's one-message report intake, adapted for this deployment: the report is kept
 * in a table of its own (whatsapp_feedback, bot/database/migrations/whatsapp_feedback.sql), not a sheet, and
 * nothing is posted anywhere. A watcher outside the bot reads new rows and tells the operator.
 *
 * THE FLOW
 * --------
 *   /feedback   three reply buttons: Not working / An idea / Something else (ids nfb_topic_<topic>), then "type it
 *               or send a voice note". Typing instead of tapping is fine: the words are the report, topic "other".
 *   /bug        no buttons: straight to "what isn't working?", topic "broken".
 *   words after either command ("/bug the PDF does not open") are the report, filed at once.
 *   The NEXT message, typed or a voice note, is the report. A voice note is transcribed here, before the row is
 *   written, and the recording is kept in R2 (feedback_audio/<users.id>/<YYYY-MM>/wa_<message id>.ogg).
 *   She is thanked with a reference, NF-XXXXX, that is unique on the table.
 *
 * WHO: registered adults, teachers and coaches alike; users.role is copied onto the row so triage can tell them
 * apart. Anyone not registered is told to register first. A failed account lookup is NOT "not registered".
 *
 * STATE (Redis):
 *   niete_feedback:awaiting:<users.id>  30 minutes. { stage: 'topic'|'message', command, topic, pending? }.
 *                                       pending = { message, wa_message_id } after a failed save, so "retry" files
 *                                       the same words under the same message id.
 *   niete_feedback:msg:<message id>     10 minutes. The inbound message was taken for filing: a duplicate webhook
 *                                       is claimed and dropped. The table's UNIQUE wa_message_id is the backstop.
 *   Any slash command while waiting ends the wait and goes on to its own door.
 *
 * LIMITS: 2000 characters of text; a voice note longer than five minutes is not feedback (a lesson recording goes
 * on to its own route and the wait ends); 20 reports per person per rolling day.
 *
 * SWITCH: WHATSAPP_FEEDBACK, read at call time. on/true/1/yes → on; off/false/0/no → off. Unset → on everywhere
 * EXCEPT staging and production (RAILWAY_ENVIRONMENT_NAME), where the table must exist before it is switched on.
 * Off, nothing here claims a message: /feedback reaches the chat exactly as before.
 *
 * PRIVACY: logs carry the teacher's keyed reference (tk), the row's ref and lengths — never her words, her phone
 * or a raw users.id.
 */

const crypto = require('crypto');

const TABLE = 'whatsapp_feedback';
const TOPICS = Object.freeze(['broken', 'idea', 'other']);
const BUTTON_PREFIX = 'nfb_topic_';
const AWAIT_TTL_SECONDS = 30 * 60;
const MSG_TTL_SECONDS = 10 * 60;
const MAX_TEXT = 2000;
const DAILY_CAP = 20;
const MAX_VOICE_SECONDS = 5 * 60;
const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1: read aloud or typed back without doubt
const REF_LENGTH = 5;
const REF_ATTEMPTS = 3;

const ON = new Set(['on', 'true', '1', 'yes']);
const OFF = new Set(['off', 'false', '0', 'no']);
const NEVER_BY_DEFAULT = new Set(['production', 'prod', 'staging']);

// Zero-width and bidi marks a keyboard, or a copied isolated command, brings along.
const INVISIBLE = /[​-‏؜‪-‮⁦-⁩﻿]/g;
const TRIGGER_RX = /^[/\\]\s*(feedback|bug)(?:[.!?,]*$|\s+([\s\S]*)$)/i;
const RETRY_WORDS = new Set(['retry', 'try again', 'دوبارہ']);

function withDefaults(deps = {}) {
  const lazy = {
    supabase: () => require('../../config/supabase'),
    redis: () => require('../cache/railway-redis.service'),
    sender: () => require('../whatsapp.service'),
    uploadBuffer: () => require('../../storage/r2').uploadBuffer,
    transcribe: () => transcribeBuffer,
    getUserLanguage: () => require('../../utils/language-cache').getUserLanguage,
    env: () => process.env,
    now: () => () => new Date(),
    log: () => (event, props) => require('../../utils/logger').logToFile(event, props),
  };
  const d = {};
  for (const [name, load] of Object.entries(lazy)) {
    Object.defineProperty(d, name, { enumerable: true, get: () => (deps[name] !== undefined ? deps[name] : load()) });
  }
  return d;
}

/** The teacher's keyed reference for a log line, never the raw id. */
function tk(userId) {
  try { return userId ? require('../quiz/web-quiz-kid').tk(userId) : null; } catch (_) { return null; }
}

function isEnabled(env = process.env) {
  const v = String(env.WHATSAPP_FEEDBACK == null ? '' : env.WHATSAPP_FEEDBACK).trim().toLowerCase();
  if (ON.has(v)) return true;
  if (OFF.has(v)) return false;
  return ![env.RAILWAY_ENVIRONMENT_NAME, env.RAILWAY_ENVIRONMENT, env.ENVIRONMENT]
    .some((t) => NEVER_BY_DEFAULT.has(String(t || '').trim().toLowerCase()));
}

const clean = (text) => (typeof text === 'string' ? text.replace(INVISIBLE, '').trim() : '');

/** { command: 'feedback'|'bug', inline } when the message is the command (with or without words after it), else null. */
function parseTrigger(text) {
  const m = TRIGGER_RX.exec(clean(text));
  if (!m) return null;
  return { command: m[1].toLowerCase(), inline: (m[2] || '').trim() };
}

function newRef(rand = crypto.randomInt) {
  let s = '';
  for (let i = 0; i < REF_LENGTH; i += 1) s += REF_ALPHABET[rand(REF_ALPHABET.length)];
  return `NF-${s}`;
}

const awaitingKey = (userId) => `niete_feedback:awaiting:${userId}`;
const msgKey = (messageId) => `niete_feedback:msg:${messageId}`;

async function getAwaiting(d, userId) {
  try {
    const v = await d.redis.get(awaitingKey(userId));
    return v && typeof v === 'object' && v.stage ? v : null;
  } catch (_) {
    return null;
  }
}

async function setAwaiting(d, userId, state) {
  try { return (await d.redis.set(awaitingKey(userId), state, AWAIT_TTL_SECONDS)) === true; } catch (_) { return false; }
}

async function clearAwaiting(d, userId) {
  try { await d.redis.delete(awaitingKey(userId)); } catch (_) { /* expires by itself */ }
}

async function alreadyTaken(d, messageId) {
  if (!messageId) return false;
  try { return Boolean(await d.redis.get(msgKey(messageId))); } catch (_) { return false; }
}

/** true = this caller took the message; false = a duplicate already did. A Redis error is not a duplicate. */
async function claimMessage(d, messageId) {
  if (!messageId) return true;
  try { return (await d.redis.setNX(msgKey(messageId), { taken: true }, MSG_TTL_SECONDS)) !== false; } catch (_) { return true; }
}

async function releaseMessage(d, messageId) {
  if (!messageId) return;
  try { await d.redis.delete(msgKey(messageId)); } catch (_) { /* best effort */ }
}

async function languageOf(d, user) {
  const { clampLanguage } = require('../../config/ux-strings');
  try {
    return clampLanguage((await d.getUserLanguage(user.id)) || user.preferred_language);
  } catch (_) {
    return clampLanguage(user && user.preferred_language);
  }
}

async function say(d, from, key, language, params) {
  const { resolveUx } = require('../../config/ux-strings');
  try {
    return await d.sender.sendMessage(from, resolveUx(key, { language, params }));
  } catch (err) {
    d.log('whatsapp_feedback.send_failed', { key, error: err && err.message });
    return false;
  }
}

/** Reports she has sent in the last 24 hours, or 0 when it cannot be read (the cap never blocks on an outage). */
async function sentToday(d, userId) {
  const since = new Date(d.now().getTime() - 24 * 60 * 60 * 1000).toISOString();
  try {
    const { count, error } = await d.supabase.from(TABLE).select('id', { count: 'exact', head: true })
      .eq('user_id', userId).gte('created_at', since);
    if (error) throw new Error(error.message);
    return count || 0;
  } catch (err) {
    d.log('whatsapp_feedback.count_failed', { error: err && err.message });
    return 0;
  }
}

async function refOfMessage(d, messageId) {
  if (!messageId) return null;
  const { data } = await d.supabase.from(TABLE).select('ref').eq('wa_message_id', messageId).maybeSingle();
  return data ? data.ref : null;
}

/**
 * Write the row. @returns {Promise<string>} its ref. A duplicate message id resolves to the existing row's ref; a
 * ref collision draws a new ref. Throws when the row cannot be written.
 */
async function insertRow(d, row) {
  let lastError = null;
  for (let attempt = 0; attempt < REF_ATTEMPTS; attempt += 1) {
    const ref = newRef();
    const { data, error } = await d.supabase.from(TABLE).insert({ ref, ...row }).select('ref').single();
    if (!error && data) return data.ref || ref;
    lastError = error || new Error('no row');
    if (!error || error.code !== '23505') break;
    const existing = await refOfMessage(d, row.wa_message_id);
    if (existing) return existing;
  }
  const err = new Error(`${TABLE} insert failed: ${lastError && lastError.message}`);
  err.code = lastError && lastError.code;
  throw err;
}

/**
 * File one report and answer her. Clears the wait only once the row exists; on a failure keeps her words for
 * "retry" (typed reports) and lets a redelivery of the same message try again.
 */
async function file(d, { user, from, state, message = null, audioKey = null, transcript = null, waMessageId, viaVoice = false }) {
  const language = await languageOf(d, user);
  const row = {
    user_id: user.id,
    role: user.role ? String(user.role).slice(0, 40) : null,
    command: state.command === 'bug' ? 'bug' : 'feedback',
    topic: TOPICS.includes(state.topic) ? state.topic : 'other',
    message: message ? message.slice(0, MAX_TEXT) : null,
    audio_key: audioKey,
    transcript: transcript ? transcript.slice(0, 8000) : null,
    language,
    wa_message_id: waMessageId || null,
  };
  try {
    const ref = await insertRow(d, row);
    await clearAwaiting(d, user.id);
    await say(d, from, 'waFeedbackThanks', language, { ref });
    d.log('whatsapp_feedback.saved', {
      tk: tk(user.id), ref, command: row.command, topic: row.topic, chars: row.message ? row.message.length : 0, viaVoice,
    });
    return true;
  } catch (err) {
    d.log('whatsapp_feedback.save_failed', { tk: tk(user.id), error: err.message, code: err.code || null, viaVoice });
    await releaseMessage(d, waMessageId);
    if (!viaVoice && row.message) {
      await setAwaiting(d, user.id, { ...state, stage: 'message', pending: { message: row.message, wa_message_id: row.wa_message_id } });
    }
    await say(d, from, viaVoice ? 'waFeedbackFailedVoice' : 'waFeedbackFailed', language);
    return true;
  }
}

/**
 * Text handler, early: /feedback or /bug starts the intake (or files the words after it).
 * @returns {Promise<boolean>} true when the message was taken.
 */
async function tryHandleTrigger({ user, from, messageBody, messageId, lookupFailed = false }, deps) {
  const trigger = parseTrigger(messageBody);
  if (!trigger) return false;
  const d = withDefaults(deps);
  if (!isEnabled(d.env)) return false;

  if (!user || !user.id) {
    if (lookupFailed) {
      await d.sender.sendMessage(from, require('../../handlers/account-state-reply').lookupUnavailableText());
      return true;
    }
    await say(d, from, 'waFeedbackRegisterFirst', 'en');
    return true;
  }
  const language = await languageOf(d, user);
  const { isRegistered } = require('../../utils/registration-status');
  if (!isRegistered(user)) {
    await say(d, from, 'waFeedbackRegisterFirst', language);
    return true;
  }
  // A new command replaces whatever she was in the middle of reporting.
  await clearAwaiting(d, user.id);
  if ((await sentToday(d, user.id)) >= DAILY_CAP) {
    d.log('whatsapp_feedback.daily_cap', { tk: tk(user.id) });
    await say(d, from, 'waFeedbackDailyCap', language);
    return true;
  }

  const state = trigger.command === 'bug'
    ? { stage: 'message', command: 'bug', topic: 'broken' }
    : { stage: 'topic', command: 'feedback', topic: 'other' };

  if (trigger.inline) {
    if (!(await claimMessage(d, messageId))) return true;
    return file(d, { user, from, state, message: trigger.inline, waMessageId: messageId });
  }

  if (!(await setAwaiting(d, user.id, state))) {
    d.log('whatsapp_feedback.start_failed', { tk: tk(user.id) });
    await say(d, from, 'waFeedbackStartFailed', language);
    return true;
  }
  d.log('whatsapp_feedback.started', { tk: tk(user.id), command: trigger.command });

  if (state.stage === 'topic') {
    const { resolveUx } = require('../../config/ux-strings');
    const ux = (key) => resolveUx(key, { language });
    const sent = await d.sender.sendInteractiveButtons(from, {
      body: ux('waFeedbackPickTopic'),
      buttons: [
        { id: `${BUTTON_PREFIX}broken`, title: ux('waFeedbackTopicBroken') },
        { id: `${BUTTON_PREFIX}idea`, title: ux('waFeedbackTopicIdea') },
        { id: `${BUTTON_PREFIX}other`, title: ux('waFeedbackTopicOther') },
      ],
    });
    if (sent !== false) return true;
    // No buttons reached her: ask in words; whatever she sends is filed as "other".
    await setAwaiting(d, user.id, { ...state, stage: 'message' });
  }
  await say(d, from, state.command === 'bug' ? 'waFeedbackBugAsk' : 'waFeedbackAsk', language);
  return true;
}

/**
 * Button router: a topic tap. @returns {Promise<boolean>} true when the tap was ours and answered.
 */
async function tryHandleButton({ user, from, buttonId }, deps) {
  if (typeof buttonId !== 'string' || !buttonId.startsWith(BUTTON_PREFIX)) return false;
  const d = withDefaults(deps);
  if (!isEnabled(d.env) || !user || !user.id) return false;
  const topic = TOPICS.includes(buttonId.slice(BUTTON_PREFIX.length)) ? buttonId.slice(BUTTON_PREFIX.length) : 'other';
  const language = await languageOf(d, user);
  const ok = await setAwaiting(d, user.id, { stage: 'message', command: 'feedback', topic });
  if (!ok) {
    await say(d, from, 'waFeedbackStartFailed', language);
    return true;
  }
  await say(d, from, 'waFeedbackAsk', language);
  return true;
}

/**
 * Text handler, early: while she is waiting, her message is the report.
 * @returns {Promise<boolean>} true when the message was taken.
 */
async function tryHandleText({ user, from, messageBody, messageId }, deps) {
  if (!user || !user.id) return false;
  const d = withDefaults(deps);
  if (!isEnabled(d.env)) return false;
  const state = await getAwaiting(d, user.id);
  if (!state) return false;

  const text = clean(messageBody);
  if (text.startsWith('/') || text.startsWith('\\')) {
    await clearAwaiting(d, user.id);
    d.log('whatsapp_feedback.cancelled', { tk: tk(user.id) });
    return false;
  }
  if (await alreadyTaken(d, messageId)) return true;

  const language = await languageOf(d, user);
  if (!text) {
    await say(d, from, state.command === 'bug' ? 'waFeedbackBugAsk' : 'waFeedbackAsk', language);
    return true;
  }

  const isRetry = RETRY_WORDS.has(text.toLowerCase().replace(/[.!?,]+$/, ''));
  if (isRetry && !state.pending) {
    await say(d, from, state.command === 'bug' ? 'waFeedbackBugAsk' : 'waFeedbackAsk', language);
    return true;
  }
  if (!(await claimMessage(d, messageId))) return true;

  if (isRetry) {
    return file(d, { user, from, state, message: state.pending.message, waMessageId: state.pending.wa_message_id || messageId });
  }
  // Her words as she typed them (an Urdu ZWNJ is part of the text); `text` above is only for deciding.
  return file(d, { user, from, state, message: String(messageBody).trim() || text, waMessageId: messageId });
}

/** Speech to text for a WhatsApp voice note: the same converter and engine routing the voice handler uses. */
async function transcribeBuffer(buffer, language) {
  const AudioService = require('../audio.service');
  const { privateTempPath, removePrivateTemp } = require('../../utils/private-temp');
  const { TEMP_DIR } = require('../../utils/constants');
  const wav = privateTempPath(TEMP_DIR, 'feedback.wav', 'voice-');
  try {
    await AudioService.convertToWav(buffer, wav.filePath);
    return await AudioService.transcribeWithLanguagePreference(wav.filePath, language);
  } finally {
    removePrivateTemp(wav);
  }
}

const safeId = (id) => String(id || 'none').replace(/[^A-Za-z0-9._=-]/g, '_').slice(0, 128);

/**
 * Voice handler, before any coaching or observe audio routing: while she is waiting, a voice note is the report.
 * @returns {Promise<boolean>} true when the voice note was taken.
 */
async function tryHandleVoice({ user, from, messageId, audioId, durationSeconds }, deps) {
  if (!user || !user.id || !audioId) return false;
  const d = withDefaults(deps);
  if (!isEnabled(d.env)) return false;
  const state = await getAwaiting(d, user.id);
  if (!state) return false;

  if (Number(durationSeconds) > MAX_VOICE_SECONDS) {
    await clearAwaiting(d, user.id);
    d.log('whatsapp_feedback.long_audio_passed_on', { tk: tk(user.id), seconds: Number(durationSeconds) });
    return false;
  }
  if (await alreadyTaken(d, messageId)) return true;
  if (!(await claimMessage(d, messageId))) return true;

  const language = await languageOf(d, user);
  let buffer;
  try {
    buffer = await d.sender.downloadMedia(audioId);
  } catch (err) {
    d.log('whatsapp_feedback.download_failed', { tk: tk(user.id), error: err.message });
    await releaseMessage(d, messageId);
    await say(d, from, 'waFeedbackFailedVoice', language);
    return true;
  }

  let transcript = null;
  try {
    const heard = await d.transcribe(buffer, language);
    transcript = String((heard && heard.text) || '').trim();
    if (!transcript) {
      // Heard nothing: she is still waiting; ask her to send it again.
      await releaseMessage(d, messageId);
      await say(d, from, 'waFeedbackUnclear', language);
      return true;
    }
  } catch (err) {
    // The recording is the report; it is kept and the transcript stays empty.
    d.log('whatsapp_feedback.transcribe_failed', { tk: tk(user.id), error: err.message });
    transcript = null;
  }

  const month = d.now().toISOString().slice(0, 7);
  const key = `feedback_audio/${user.id}/${month}/wa_${safeId(messageId)}.ogg`;
  try {
    await d.uploadBuffer(buffer, key, 'audio/ogg');
  } catch (err) {
    d.log('whatsapp_feedback.upload_failed', { tk: tk(user.id), error: err.message });
    await releaseMessage(d, messageId);
    await say(d, from, 'waFeedbackFailedVoice', language);
    return true;
  }
  return file(d, { user, from, state, audioKey: key, transcript, waMessageId: messageId, viaVoice: true });
}

module.exports = {
  TABLE,
  TOPICS,
  BUTTON_PREFIX,
  DAILY_CAP,
  MAX_TEXT,
  MAX_VOICE_SECONDS,
  isEnabled,
  parseTrigger,
  newRef,
  awaitingKey,
  tryHandleTrigger,
  tryHandleButton,
  tryHandleText,
  tryHandleVoice,
};
