'use strict';
/**
 * bd-ik5e8j.4 (queue #85) — the teacher app's how-to videos. Mounted at /api/portal by dashboard/index.js beside the
 * other teacher modules (portal-lp612-own.routes.js's pattern).
 *
 *   GET  /api/portal/help?lang=en|ur  → { success, seen, videos: [{ feature, lang, title, url, urlSmall, poster,
 *                                        seconds, bytes }] }   her role's videos in that language (default: her
 *                                        stored language); [] when there are none yet (help-videos.service.js)
 *   POST /api/portal/help/seen        → { success, seen: true }   she has opened a help video once: the "?" stops
 *                                        pulsing on every phone. One row in the EXISTING user_feature_first_use
 *                                        (feature 'portal_help', unique (user_id, feature)): no new table or column.
 *
 * Dark unless portal_teacher_v2 AND portal_help_videos are on for her: 404. The user is ALWAYS the session's.
 */
const express = require('express');
const supabase = require('../config/supabase');
const { PORTAL_TEACHER_V2_KEY, PORTAL_HELP_VIDEOS_KEY, isFlagEnabledForUser } = require('../lib/feature-flags');
const { teacherAppOnFor } = require('../lib/teacher-app');
const { requirePortalAuth } = require('../lib/portal-auth');
const { createHelpVideos } = require('../services/help-videos.service');

const SEEN_FEATURE = 'portal_help';

function buildRouter({ helpVideos = createHelpVideos() } = {}) {
  const router = express.Router();

  async function requireHelp(req, res, next) {
    const userId = req.session.portalUserId;
    let on = false;
    try {
      on = (await teacherAppOnFor(supabase, PORTAL_TEACHER_V2_KEY, userId))
        && (await isFlagEnabledForUser(supabase, PORTAL_HELP_VIDEOS_KEY, userId));
    } catch (_) { on = false; }
    if (!on) return res.status(404).json({ success: false, error: 'Not found' });
    return next();
  }

  router.get('/help', requirePortalAuth, requireHelp, async (req, res) => {
    const userId = req.session.portalUserId;
    try {
      const [{ data: user }, { data: seenRows }] = await Promise.all([
        supabase.from('users').select('role, preferred_language').eq('id', userId).maybeSingle(),
        supabase.from('user_feature_first_use').select('id').eq('user_id', userId).eq('feature', SEEN_FEATURE).limit(1),
      ]);
      const asked = req.query && typeof req.query.lang === 'string' ? req.query.lang : '';
      const lang = asked === 'en' || asked === 'ur' ? asked : (user && user.preferred_language === 'en' ? 'en' : 'ur');
      const role = (user && typeof user.role === 'string' && user.role) || 'teacher';
      const videos = await helpVideos.videosFor({ role, lang });
      return res.json({ success: true, seen: Array.isArray(seenRows) && seenRows.length > 0, videos });
    } catch (error) {
      console.error('❌ Portal help read failed', { error: error && error.message });
      return res.status(500).json({ success: false, error: 'Could not load' });
    }
  });

  router.post('/help/seen', requirePortalAuth, requireHelp, async (req, res) => {
    try {
      const { error } = await supabase.from('user_feature_first_use')
        .upsert({ user_id: req.session.portalUserId, feature: SEEN_FEATURE }, { onConflict: 'user_id,feature', ignoreDuplicates: true });
      if (error) throw new Error(error.message || 'upsert failed');
      return res.json({ success: true, seen: true });
    } catch (error) {
      console.error('❌ Portal help seen failed', { error: error && error.message });
      return res.status(500).json({ success: false, error: 'Not saved' });
    }
  });

  return router;
}

module.exports = buildRouter();
module.exports.buildRouter = buildRouter;
module.exports.SEEN_FEATURE = SEEN_FEATURE;
