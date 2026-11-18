'use strict';
/**
 * The coach app nudge's WhatsApp side (bd-9652yj, queue #166, option B): the way back from the app to WhatsApp.
 *
 * app-redirect.service decides WHO gets the nudge (`coach_app_nudge` + the portal's full-app rule) and sends it: ONE
 * cta_url message, "Take your observation in the app. If the app gives trouble, reply 1 and I'll carry on here on
 * WhatsApp." [Open in the app]. A normal bot message carries one link button OR reply buttons, never both (only an
 * approved template mixes them), so the way back is something she types. This file holds the rest:
 *
 *   THE OFFER     armReply(userId, kind): after the nudge ('observe' | 'menu') or the report-ready line ('report'),
 *                 `coach_app:reply1:<id>` holds { kind, journeyId, sessionId? } for 2 h. Her NEXT message ends it
 *                 either way, so "1" counts only while the offer was the bot's last word to her (a later "1" is a menu
 *                 choice again).
 *   REPLY 1       "1", "۱", "whatsapp", "واٹس ایپ" (FALLBACK_WORDS) while the offer is armed: today's WhatsApp entry
 *                 for what was offered (/observe → handleObserveCommand, /menu → the WhatsApp menu, report → the
 *                 WhatsApp report card), never the app link again.
 *   TODAY         markWhatsappToday: her choice holds until PKT midnight (`coach_app:whatsapp_today:<id>`), so a second
 *                 /observe that day goes straight to WhatsApp with no second nudge (app-redirect asks choseWhatsappToday).
 *   THE CODE      the app's "Continue on WhatsApp" opens the chat with "Continue my visit on WhatsApp (code V4KQ7)"
 *                 typed. The portal minted the code (dashboard/routes/coach-handoff.routes.js: `coach_handoff:<CODE>`,
 *                 24 h: { u, v, o, s, j }); the bot and the portal share one Redis. Only the SAME coach's code resumes:
 *                 a visit with no recording → the teacher is bound and the recording prompt goes (the visit Flow's own
 *                 bindAndStart); a recorded visit or an observation → observe-resume at its own step. Wrong, expired,
 *                 someone else's or no code → plain /observe. Never an error.
 *
 * Only a coach's message is looked at (users.role coach): nobody else pays a Redis read. Every path is logged as an
 * app_funnel event with the journey id (app_funnel.fallback_reply, app_funnel.resume), ids only. NOTHING HERE THROWS
 * into the text handler: a failure is "not handled", and the message goes on to today's path.
 */

const WhatsAppService = require('./whatsapp.service');
const { logToFile } = require('../utils/logger');
const { isCoachRole } = require('./teacher-audience');
const { clampLanguage } = require('../config/ux-strings');
const { isCode, CODE_ALPHABET } = require('./coach-handoff-code');
// The offer, the day's choice and the code live in a leaf module (no require cycle with app-redirect).
const Offer = require('./coach-app-offer');
const { replyKey, todayKey, handoffKey, secondsToPktMidnight, REPLY_TTL_S, armReply, takeOffer, choseWhatsappToday,
  markWhatsappToday, readHandoff, tkOf } = Offer;
const redis = require('./cache/railway-redis.service');

function funnelEvent(name, props) {
  try { logToFile(name, { event: name, ...props }); } catch (_) { /* logging never decides the answer */ }
}

/**
 * Is this the reply that means "carry on here on WhatsApp"? The whole message, trimmed, with a trailing full stop or
 * exclamation and the keycap form allowed: "1", "۱" (Urdu), "١" (Arabic), "1️⃣", "whatsapp", "whats app", "واٹس ایپ".
 */
function isFallbackWord(text) {
  const t = String(text || '').normalize('NFC').trim().toLowerCase()
    .replace(/\u20e3|\ufe0f/g, '')
    .replace(/[.!\u06d4\u060c,\s]+$/u, '')
    .replace(/\s+/g, ' ');
  if (t === '1' || t === '\u06f1' || t === '\u0661') return true;
  if (t === 'whatsapp' || t === 'whats app' || t === 'whatsap') return true;
  return /^(?:واٹس\s*ایپ|واٹس\s*اپ|واٹساپ|وٹس\s*ایپ)$/.test(t);
}

const HANDOFF_PHRASES = [/continue my visit on whatsapp/i, /دورہ\s*واٹس\s*ایپ\s*پر\s*جاری/];
const HANDOFF_CODE = /(?:code|کوڈ)\s*[:#-]?\s*([a-z0-9]{5})(?![a-z0-9])/i;

/**
 * The app's typed line → { code } (the code, upper-cased, or null when it has none or it is not one of ours), or null
 * when the message is not that line at all.
 */
function parseHandoffLine(text) {
  const t = String(text || '').normalize('NFC');
  if (!HANDOFF_PHRASES.some((rx) => rx.test(t))) return null;
  const m = t.match(HANDOFF_CODE);
  const code = m ? m[1].toUpperCase() : null;
  return { code: isCode(code) ? code : null };
}

/** Her language for these lines: the text handler's resolved language, else her stored one, clamped to the offer. */
const langOf = (user, ctx) => clampLanguage((ctx && ctx.language) || (user && user.preferred_language));

async function plainObserve(user, from) {
  const { handleObserveCommand } = require('../handlers/observe-command.handler');
  await handleObserveCommand(user, from, '/observe');
}

/** Reply 1: today's WhatsApp entry for what was offered. */
async function runFallback(offer, user, from, ctx) {
  funnelEvent('app_funnel.fallback_reply', {
    journeyId: offer.journeyId || null, userId: user.id, feature: offer.kind === 'report' ? 'coach_report' : offer.kind,
    kind: offer.kind, audience: 'coach', ...(offer.sessionId ? { sessionId: offer.sessionId } : {}),
  });
  await markWhatsappToday(user.id, ctx && ctx.now);
  if (offer.kind === 'menu') {
    const MenuService = require('./menu.service');
    await MenuService.sendMenu(from, user.id, ctx && ctx.sessionId, langOf(user, ctx), user);
    return;
  }
  if (offer.kind === 'report') {
    const { sendReportCardHere } = require('./observe/coach-report-whatsapp.service');
    const sent = await sendReportCardHere({ sessionId: offer.sessionId, user, from, lang: langOf(user, ctx) });
    if (!sent) {
      const { observeStrings } = require('./observe/observe-strings');
      await WhatsAppService.sendMessage(from, observeStrings(langOf(user, ctx)).coach_report_here_failed);
    }
    return;
  }
  await plainObserve(user, from);
}

/** A visit she booked: its row, only when it is hers. Null on anything else. */
async function loadVisit(userId, visitId) {
  if (!visitId) return null;
  try {
    const supabase = require('../config/supabase');
    const { data, error } = await supabase
      .from('observation_schedules')
      .select('id, leader_user_id, status, session_id, teacher_ext_id, school_ext_id, teacher_name')
      .eq('id', visitId)
      .eq('leader_user_id', userId)
      .maybeSingle();
    if (error || !data || data.leader_user_id !== userId) return null;
    return data;
  } catch (_) { return null; }
}

/** A visit with no recording yet: bind the teacher exactly as the visit Flow's Start does, then the recording prompt. */
async function resumeVisit(user, from, visit, lang) {
  const VisitFlow = require('../handlers/observe-visit-flow.handler');
  const result = await VisitFlow.bindAndStart(user.id, {
    teacher_ext_id: visit.teacher_ext_id, school_ext_id: visit.school_ext_id,
  }, user);
  const bound = (result && result.boundTeacher) || {};
  const teacherName = bound.teacher_name || visit.teacher_name || null;
  // The grade 6-12 class question, when the visit Flow would ask it (flow-response.handler, bd-pni007).
  try {
    const Obs612 = require('./observe/obs612/visit');
    const v = { teacherUserId: bound.user_id || null, schoolExtId: bound.school_ext_id || visit.school_ext_id || null };
    if (await Obs612.asksClass(user, v) && await Obs612.askForObserve(user, from, { teacherName })) return 'class_question';
  } catch (_) { /* today's capture prompt */ }
  const { observeStrings, buildVisitCapturePrompt } = require('./observe/observe-strings');
  let framework = 'FICO';
  try { framework = ((require('./observe/observe-framework').getObservePack().key) || 'fico').toUpperCase(); } catch (_) { /* FICO */ }
  const S = observeStrings(lang);
  await WhatsAppService.sendMessage(from, `${S.handoff_resume_intro}\n\n${buildVisitCapturePrompt(lang, { teacherName, framework })}`);
  return 'recording_prompt';
}

/**
 * The app's "Continue on WhatsApp" line. Always handled (true): the worst case is plain /observe.
 */
async function resumeFromHandoff(user, from, code, ctx) {
  const lang = langOf(user, ctx);
  const payload = code ? await readHandoff(code) : null;
  let match = 'none';
  if (code) match = !payload ? 'unknown' : (payload.u === user.id ? 'own' : 'other');
  await markWhatsappToday(user.id, ctx && ctx.now);

  let outcome = 'observe';
  let ok = true;
  try {
    if (match === 'own') {
      try { await redis.delete(handoffKey(code)); } catch (_) { /* expires in 24 h */ }
      const visit = await loadVisit(user.id, payload.v);
      const ObserveResume = require('./observe/observe-resume.service');
      if (visit && visit.status === 'upcoming') {
        outcome = await resumeVisit(user, from, visit, lang);
      } else if (visit && visit.session_id) {
        await ObserveResume.resume(visit.session_id, from, user);
        outcome = 'observation';
      } else if (!payload.v && typeof payload.o === 'string' && payload.o) {
        await ObserveResume.resume(payload.o, from, user);
        outcome = 'observation';
      }
    }
    if (outcome === 'observe') await plainObserve(user, from);
  } catch (err) {
    ok = false;
    logToFile('❌ coach app handoff: the resume failed — plain /observe instead', { tk: tkOf(user.id), error: err?.message }, 'error');
    try { await plainObserve(user, from); outcome = 'observe'; } catch (_) { /* the text handler's own error path */ }
  }
  funnelEvent('app_funnel.resume', {
    journeyId: (match === 'own' && payload.j) || null, userId: user.id, feature: 'observe', audience: 'coach',
    step: (match === 'own' && typeof payload.s === 'string') ? payload.s.slice(0, 24) : null,
    ok, outcome, code: Boolean(code), match,
  });
  return true;
}

/**
 * The text handler asks this first, for every message. true = handled (the handler returns). Only a coach's message
 * is looked at; for anyone else, and on any failure, false.
 *
 * @param {object} user  users row (id, role, preferred_language)
 * @param {string} from  WhatsApp number
 * @param {string} text  the message as typed
 * @param {{ language?: string, sessionId?: string, now?: number }} [ctx]
 */
async function handleInbound(user, from, text, ctx = {}) {
  if (!user || !user.id || !from || !isCoachRole(user.role)) return false;
  try {
    const handoff = parseHandoffLine(text);
    const offer = await takeOffer(user.id);
    if (handoff) return await resumeFromHandoff(user, from, handoff.code, ctx);
    if (!offer || !isFallbackWord(text)) return false;
    await runFallback(offer, user, from, ctx);
    return true;
  } catch (err) {
    logToFile('❌ coach app nudge: the reply could not be handled — today\'s path', { tk: tkOf(user.id), error: err?.message }, 'error');
    return false;
  }
}

module.exports = {
  // re-exported from coach-app-offer, so one require gives a caller (and the tests) the whole picture
  REPLY_TTL_S, CODE_ALPHABET,
  replyKey, todayKey, handoffKey,
  secondsToPktMidnight, armReply, choseWhatsappToday, markWhatsappToday, readHandoff,
  isFallbackWord, parseHandoffLine,
  handleInbound,
};
