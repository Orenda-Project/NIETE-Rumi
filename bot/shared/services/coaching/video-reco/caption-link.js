'use strict';
/**
 * The clip's link in the report's own caption — bd-9dbhh0.1 (VIDREC), COS ruling 20261028T151950 §1.2.
 *
 * The operator (28 Oct): "in order to save on whatsapp costs, the clip should appear on an IAB (so we link the teacher to it)
 * -- also the report clip is not clickable (because its in an image form?)". So, with VIDEO_RECO_WA_MESSAGE off (the
 * default), no clip message follows the report: the report image's caption ends with
 *
 *   ▶ Watch next (3 min): {chapter title}
 *   https://<portal>/v/<token>
 *
 * The URL is alone on the last line: nothing after it, no isolate or full stop touching it (WhatsApp's linkifier would take
 * them into the URL). The token is the existing /v link (link-token.js) with surface 'wa': with the message off, 'wa' on an
 * event row means this caption link, and the app card stays 'portal' / 'cr'.
 *
 * linkBlock(): the two lines for the session's row, or null — the flag off or the message on, no row in time, a row that is
 * not 'shown' (control arm, shadow, none, a teacher who stopped the clips), or no link (PORTAL_URL or key missing).
 * withLink(): the caption with the block appended, or the caption unchanged when it would pass 1,024 code points.
 * Never throws.
 */
const { logToFile } = require('../../../utils/logger');
const copy = require('./copy');

const CAPTION_MAX = 1024; // WhatsApp's image caption cap, in code points
const SEP = '\n\n';
const cp = (s) => [...String(s || '')].length;

function flagsOn(deps) {
  if (typeof deps.enabled === 'function') return deps.enabled() === true;
  try {
    const flags = require('./flags'); // eslint-disable-line global-require
    return flags.videoRecoEnabled() === true && flags.videoRecoWaMessage() !== true;
  } catch (_) {
    return false;
  }
}

async function linkBlock({ row: given, language, capMs, coachingSessionId, deps = {} } = {}) {
  try {
    if (!flagsOn(deps)) return null;
    let wait = capMs;
    if (wait === undefined) wait = require('./strip').stripWaitMs(); // eslint-disable-line global-require
    let row;
    if (given !== undefined && given !== null && typeof given.then !== 'function') row = given;
    else {
      const pending = given ? Promise.resolve(given) : (coachingSessionId ? (deps.store || require('./store')).readForSession(coachingSessionId) : Promise.resolve(null)); // eslint-disable-line global-require
      let timer;
      row = await Promise.race([pending, new Promise((r) => { timer = setTimeout(() => r(null), Math.max(0, wait || 0)); })]);
      clearTimeout(timer);
    }
    if (!row || row.status !== 'shown' || !row.id || !row.user_id) return null;
    const url = (deps.linkUrl || require('./link-token').videoLinkUrl)({ recommendationId: row.id, userId: row.user_id, surface: 'wa' }); // eslint-disable-line global-require
    if (!url) return null;
    const catalog = deps.catalog || require('./catalog'); // eslint-disable-line global-require
    let hit = null;
    try { hit = catalog.segment(row.seg_id); } catch (_) { hit = null; }
    const mod = (hit && hit.module) || {};
    const seg = (hit && hit.segment) || {};
    const l = copy.lang(language);
    const start = Number(row.start_s ?? seg.start_s) || 0;
    const end = Number(row.end_s ?? seg.end_s) || 0;
    const n = copy.minutesOf(end > start ? end - start : Number(mod.duration_s) || 60);
    const title = String(copy.localized(seg, 'title', l) || mod.title || '').replace(/\s+/g, ' ').trim();
    const label = copy.word('videoRecoCaptionLink', l, { n: copy.num(n, l), title }).trim();
    return { text: `${label}\n${url}`, url, row };
  } catch (err) {
    logToFile('[video-reco] caption link skipped (non-fatal)', { coachingSessionId, error: err && err.message }, 'warn');
    return null;
  }
}

/** The caption plus the block (a blank line between), when the whole fits in `cap` code points; else the caption as it was. */
function withLink(caption, block, cap = CAPTION_MAX) {
  if (!block || !block.text) return caption;
  const base = String(caption || '');
  const out = base ? `${base}${SEP}${block.text}` : block.text;
  return cp(out) <= cap ? out : caption;
}

/** The code points the block takes at the end of a caption (the separator included): what the caption must leave free. */
const reserveFor = (block) => (block && block.text ? cp(SEP) + cp(block.text) : 0);

module.exports = { linkBlock, withLink, reserveFor, CAPTION_MAX };
