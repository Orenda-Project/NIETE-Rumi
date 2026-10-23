'use strict';
/**
 * The recommended training clip on the portal's coaching report — bd-gzfdu9 (VIDREC, SPEC §4.7).
 *
 * GET /api/portal/coaching-session/:id carries `video_recommendation` ONLY while VIDEO_RECO_ENABLED is on:
 *   - fieldFor() → undefined when the flag is off or the engine's flags.js is not deployed: the route adds no key,
 *     reads nothing, and the payload is today's byte for byte;
 *   - otherwise the session's 'shown' row for THIS teacher, shaped for the React VideoRecoCard, or null — on no row,
 *     on any failed read (the table exists on sandbox only), or when the player link cannot be signed.
 * Never throws. The link is the /v player's (dashboard/routes/video-reco.routes.js), same origin as the portal, minted
 * for surface 'portal' so its events say where the teacher came from. Ids only in the URL; no level is shown
 * (SPEC v1.2.1: `levelLabel` is null everywhere).
 *
 * flags.js / catalog.js (eng-engine) and link-token.js (eng-surfaces) are required lazily and guarded: they are
 * pure (no dotenv, no queue driver), so requiring them from the portal is safe once they land.
 */
const VR = '../../bot/shared/services/coaching/video-reco';

function optional(name) {
  try {
    return require(`${VR}/${name}`); // eslint-disable-line global-require, import/no-dynamic-require
  } catch (_) {
    return null;
  }
}

function enabled() {
  const flags = optional('flags');
  try {
    return !!flags && flags.videoRecoEnabled() === true;
  } catch (_) {
    return false;
  }
}

async function cardFor(supabase, sessionId, userId, language) {
  const { data: row, error } = await supabase.from('video_recommendations')
    .select('id, module_id, seg_id, start_s, end_s, reason_en, reason_ur')
    .eq('coaching_session_id', sessionId).eq('user_id', userId).eq('status', 'shown')
    .maybeSingle();
  if (error || !row) return null;
  const links = optional('link-token');
  const token = links ? links.signVideoLink({ recommendationId: row.id, userId, surface: 'portal' }) : null;
  if (!token) return null;
  const path = links.VIDEO_PATH || '/v';
  let hit = null;
  try {
    const catalog = optional('catalog');
    hit = catalog ? catalog.segment(row.seg_id) : null;
  } catch (_) { hit = null; }
  const mod = (hit && hit.module) || {};
  const seg = (hit && hit.segment) || {};
  const ur = language === 'ur';
  let title = (ur && seg.title_ur) || seg.title_en || mod.title || null;
  if (!title) {
    const { data: m } = await supabase.from('training_modules').select('title').eq('id', row.module_id).maybeSingle();
    title = (m && m.title) || null;
  }
  const start = Number(row.start_s ?? seg.start_s) || 0;
  const end = Number(row.end_s ?? seg.end_s) || 0;
  return {
    title,
    levelLabel: null,
    durationS: end > start ? end - start : (Number(mod.duration_s) || null),
    language: seg.language || mod.language || null, // the chapter's own language first (catalogue v1)
    reason: (ur && row.reason_ur) || row.reason_en || null,
    thumbUrl: row.module_id != null ? `${path}/thumb/${encodeURIComponent(row.module_id)}.jpg` : null,
    href: `${path}/${token}?s=portal`,
  };
}

/** undefined = flag off (no key); null = no card; else the card. */
async function fieldFor(supabase, sessionId, userId, language) {
  if (!enabled()) return undefined;
  try {
    return await cardFor(supabase, sessionId, userId, language);
  } catch (_) {
    return null;
  }
}

module.exports = { fieldFor };
