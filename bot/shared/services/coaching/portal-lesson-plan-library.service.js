'use strict';
/**
 * bd-5rz1v — the lookups behind a lesson plan picked from the LIBRARY in the portal.
 *
 * A portal teacher can attach the plan she taught from by picking it, instead of
 * uploading a file. Nothing here is new behaviour: each function is the code path a
 * WhatsApp teacher already goes through, reached from the portal.
 *
 *   resolveAsset({ lessonId })  grades 1-5. The asset her A/B group is served for that
 *                               lesson — LpAb.groupFor + LpAb.assetFor(current), the
 *                               exact pair lp-v8-browse.lessonPdfUrl uses to hand her
 *                               the Curriculum page's PDF. So the plan she is coached
 *                               against is the one she would download.
 *   resolveAsset({ assetId })   a recent plan: an asset she downloaded, as the WhatsApp
 *                               "Recent Lesson Plans" list offers it.
 *   link(sessionId, assetId)    lp-coaching-linker.handleLPSelection with that list's own
 *                               row id, lp_select_<assetId>_<sessionId>. The writes
 *                               (selected_recent + the fidelity ref) are the linker's,
 *                               never a copy of them.
 *   readyRender({ segmentId })  grades 6-12 have no asset to link — the WhatsApp list
 *                               cannot offer them either. A lesson that has been
 *                               WRITTEN has a PDF; the caller attaches it as an upload.
 *   recent(userId)              the WhatsApp list's source (getRecentFidelityLps).
 *
 * Every collaborator is required lazily: this module is loaded by
 * portal-coaching.service, which the portal service also requires (for
 * isPortalSession) and which must stay free of bot-only dependencies at load time.
 */

const LANGS = new Set(['en', 'ur']);

/**
 * The current asset for a lesson — the SAME select as
 * lp-v8-delivery.currentAssetFor (is_current, by lesson + kind). It is not
 * required from there because lp-v8-delivery sits inside an allowlisted require
 * cycle (tests/setup/circular-deps.allowlist.json) that leads back to
 * transcription-processor → portal-coaching.service; requiring it from here
 * would pull this module and portal-coaching into that cycle.
 */
function currentAssetFrom(supabase) {
  return async (lessonId, assetKind = 'lesson') => {
    const { data } = await supabase
      .from('niete_lp_assets')
      .select('id, lesson_id, asset_kind, r2_key, content_hash, version_stamp, is_current')
      .eq('lesson_id', lessonId)
      .eq('asset_kind', assetKind)
      .eq('is_current', true)
      .maybeSingle();
    return data || null;
  };
}

function withDefaults(deps = {}) {
  const lazy = {
    supabase: () => require('../../config/supabase'),
    catalog: () => require('../lp-v8-catalog.service'),
    ab: () => require('../lp-ab-ch310.service'),
    currentAssetFor: () => currentAssetFrom(require('../../config/supabase')),
    linker: () => require('./lp-coaching/lp-coaching-linker.service'),
    getRecentFidelityLps: () => require('./lp-coaching/recent-fidelity-lps.service').getRecentFidelityLps,
    templateVersion: () => require('../../config/lp612-flags').templateVersion,
  };
  const d = {};
  for (const [name, load] of Object.entries(lazy)) {
    Object.defineProperty(d, name, {
      enumerable: true,
      get: () => (deps[name] !== undefined ? deps[name] : load()),
    });
  }
  return d;
}

/**
 * @param {{userId: string, assetId?: string, lessonId?: string}} pick
 * @returns {Promise<{assetId: string}|null>}
 */
async function resolveAsset({ userId, assetId, lessonId }, deps) {
  const d = withDefaults(deps);

  if (assetId) {
    const { data } = await d.supabase
      .from('niete_lp_assets')
      .select('id')
      .eq('id', assetId)
      .eq('asset_kind', 'lesson')
      .maybeSingle();
    return data && data.id ? { assetId: data.id } : null;
  }

  if (!lessonId) return null;
  const hit = d.catalog.lessonById(lessonId);
  if (!hit || !hit.book || !hit.chapter) return null;
  const group = await d.ab.groupFor(userId, { grade: hit.book.grade, chapter: hit.chapter.number });
  const asset = await d.ab.assetFor({ group, lessonId, assetKind: 'lesson', current: d.currentAssetFor });
  return asset && asset.id ? { assetId: asset.id } : null;
}

/**
 * A 6-12 lesson's PDF, if it has been written on today's template in `lang` —
 * the same filters lp612-browse.readyFor applies to show it as ready.
 * @returns {Promise<{r2Key: string}|null>}
 */
async function readyRender({ segmentId, lang }, deps) {
  if (!segmentId || !LANGS.has(lang)) return null;
  const d = withDefaults(deps);
  const { data } = await d.supabase
    .from('niete_lp612_renders')
    .select('r2_key')
    .eq('segment_id', segmentId)
    .eq('lang', lang)
    .eq('template_version', d.templateVersion())
    .eq('status', 'ready')
    .maybeSingle();
  return data && data.r2_key ? { r2Key: data.r2_key } : null;
}

/** Link a resolved asset to the session exactly as a tap on the WhatsApp list does. */
async function link(sessionId, assetId, deps) {
  const d = withDefaults(deps);
  return d.linker.handleLPSelection(sessionId, `lp_select_${assetId}_${sessionId}`);
}

async function recent(userId, deps) {
  const d = withDefaults(deps);
  return d.getRecentFidelityLps(userId);
}

module.exports = { resolveAsset, readyRender, link, recent, currentAssetFrom };
