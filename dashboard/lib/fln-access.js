'use strict';
/**
 * The ONE access rule for Reading Hour + Numeracy (FLN) in the teacher app.
 *
 * Two switches in app_settings (missing = OFF, read through isFlagEnabledForUser):
 *   portal_fln_lessons — the band, the lists, the plan page
 *   portal_fln_share   — Share + the link builder, for the school-leader family only
 *
 *   share   = isLeaderRole(users.role) AND portal_fln_share on for the user
 *   lessons = portal_fln_lessons on for the user OR share
 *
 * Why `lessons` admits a leader with share on: the value "teachers" means users.role === 'teacher'
 * (bot/shared/services/teacher-audience.js), so a coach would otherwise be locked out of the plans
 * the coach is asked to send. The role is re-read from `users` on every request, never from the
 * session; a failed read is "not a leader". Every FLN route uses requireFln, and every FLN answer
 * is `Cache-Control: no-store` (shared phones in schools: a coach's Share must never be replayed
 * from the browser cache for the teacher who signs in next).
 */
const supabase = require('../config/supabase');
const { isFlagEnabledForUser } = require('./feature-flags');
const { isLeaderRole } = require('./leader-role');
// The portal's one sign-in check (a retired account's session is ended there too); re-exported for the FLN routers.
const { requirePortalAuth } = require('./portal-auth');

const FLN_LESSONS_KEY = 'portal_fln_lessons';
const FLN_SHARE_KEY = 'portal_fln_share';

async function readUser(userId) {
  try {
    const { data, error } = await supabase
      .from('users').select('id, role, preferred_language').eq('id', userId).maybeSingle();
    if (error || !data) return null;
    return data;
  } catch (_) {
    return null;
  }
}

/**
 * @param {string|null} userId the SESSION user
 * @returns {Promise<{lessons: boolean, share: boolean, role: string|null, ui_lang: 'en'|'ur'}>}
 */
async function flnAccess(userId) {
  if (!userId) return { lessons: false, share: false, role: null, ui_lang: 'en' };
  const [user, lessonsOn, shareOn] = await Promise.all([
    readUser(userId),
    isFlagEnabledForUser(supabase, FLN_LESSONS_KEY, userId),
    isFlagEnabledForUser(supabase, FLN_SHARE_KEY, userId),
  ]);
  const role = user && typeof user.role === 'string' ? user.role : null;
  const share = shareOn === true && isLeaderRole(role);
  return {
    lessons: lessonsOn === true || share,
    share,
    role,
    ui_lang: user && user.preferred_language === 'ur' ? 'ur' : 'en',
  };
}

function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store');
  return next();
}

/** 404 when the user may not have `what` — the client reads 404 as "no FLN here". Puts the answer on req.fln. */
function gate(what) {
  return async function requireFlnAccess(req, res, next) {
    let access;
    try {
      access = await flnAccess(req.session.portalUserId);
    } catch (_) {
      access = { lessons: false, share: false, role: null, ui_lang: 'en' };
    }
    if (!access[what]) return res.status(404).json({ error: 'not_found' });
    req.fln = access;
    return next();
  };
}

const requireFln = Object.freeze({
  lessons: [noStore, requirePortalAuth, gate('lessons')],
  share: [noStore, requirePortalAuth, gate('share')],
});

module.exports = {
  FLN_LESSONS_KEY,
  FLN_SHARE_KEY,
  flnAccess,
  requireFln,
  requirePortalAuth,
  noStore,
};
