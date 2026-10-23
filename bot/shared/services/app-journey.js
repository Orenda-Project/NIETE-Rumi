'use strict';
/**
 * APP JOURNEY (pure) — bd-4r3rei.
 *
 * One teacher, one journey: she sends a command on WhatsApp, the bot decides about the app link, she opens it, she
 * uses pages, and she leaves. A JOURNEY ID is the one key that joins those rows in Axiom.
 *
 *   minted    by the bot, the moment it decides about the app link for a command (app-redirect.service.js)
 *   carried   INSIDE the encrypted /go token (app-login-link.js) — never in the URL in the clear
 *   stored    in the portal session when /go signs her in (dashboard/routes/app-login.routes.js), for 24 hours
 *   read      by the portal's funnel endpoint and action logger from the SESSION, never from anything the browser says
 *
 * It is random, so it says nothing about her: no phone, no user id, no feature.
 *
 * This file is required by BOTH deploy units (the bot, and the portal service, which cannot load the bot's logger),
 * so it depends on Node built-ins only.
 */
const crypto = require('crypto');

const JOURNEY_RE = /^j_[0-9a-f]{16}$/;
/** A journey is attributed to page views and actions for as long as the link that started it works. */
const JOURNEY_TTL_MS = 24 * 60 * 60 * 1000;

function newJourneyId() {
  return `j_${crypto.randomBytes(8).toString('hex')}`;
}

function isJourneyId(v) {
  return typeof v === 'string' && JOURNEY_RE.test(v);
}

const MAX_RAW = 200;
const MAX_SEGMENTS = 8;
/** A segment we keep as written: a plain lower-case word. Everything else (digits, dots, %, :, long) is an id or text. */
const WORD = /^[a-z]+(?:-[a-z]+)*$/;

/**
 * An app page address with no ids and nothing a person typed: '/portal/teacher/assessment/request/:id'.
 * Query and fragment are dropped; a segment that is not a plain lower-case word becomes ':id'. Null when it is not a
 * portal page at all (another host, '/api/…', the marketing site) — the caller drops those.
 */
function normaliseRoute(raw) {
  if (typeof raw !== 'string' || !raw || raw.length > MAX_RAW) return null;
  if (raw[0] !== '/' || raw.startsWith('//')) return null;
  const path = raw.split('#')[0].split('?')[0];
  const segs = path.toLowerCase().split('/').filter(Boolean);
  if (segs[0] !== 'portal' || segs.length > MAX_SEGMENTS) return null;
  const out = segs.map((s, i) => (i === 0 || (s.length <= 24 && WORD.test(s)) ? s : ':id'));
  return `/${out.join('/')}`;
}

/** Longest prefix first. Both the teacher app (v2) and today's pages count for the feature they serve. */
const FEATURE_PREFIXES = [
  ['/portal/teacher/lessons', 'lesson_plan'], ['/portal/curriculum', 'lesson_plan'],
  // bd-zcgpkx — FLN plans and Send a lesson plan are lesson plans. bd-a73p5m: a leader's link lands on
  // /portal/teacher/lessons, the teacher's own address; the journey's command row (audience leader) is what keeps a
  // leader's arrival lesson_plan@leader in scripts/app-funnel/funnel.py, never the route.
  ['/portal/fln', 'lesson_plan'],
  ['/portal/teacher/assessment', 'assessment_generator'], ['/portal/assessment', 'assessment_generator'],
  ['/portal/teacher/training', 'teacher_training'], ['/portal/training', 'teacher_training'],
  ['/portal/teacher/attendance', 'attendance'], ['/portal/attendance', 'attendance'],
  ['/portal/teacher/classes', 'classes'], ['/portal/classes', 'classes'],
  ['/portal/teacher/coaching', 'ai_coaching'], ['/portal/coaching', 'ai_coaching'],
  ['/portal/teacher/observations', 'observations'],
  ['/portal/teacher/analytics', 'analytics'],
  ['/portal/coach', 'coach'], ['/portal/leader', 'coach'],
  ['/portal/dashboard', 'dashboard'],
].sort((a, b) => b[0].length - a[0].length);

/** The feature a (normalised) route belongs to; 'menu' is the teacher app's home; 'other' for the rest (account, more…). */
function featureOfRoute(route) {
  if (typeof route !== 'string') return 'other';
  if (route === '/portal/teacher') return 'menu';
  for (const [prefix, feature] of FEATURE_PREFIXES) {
    if (route === prefix || route.startsWith(`${prefix}/`)) return feature;
  }
  return 'other';
}

module.exports = { newJourneyId, isJourneyId, normaliseRoute, featureOfRoute, JOURNEY_TTL_MS };
