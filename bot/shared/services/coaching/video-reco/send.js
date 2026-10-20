'use strict';
/**
 * The "watch this clip" WhatsApp message — bd-gzfdu9 (VIDREC), SPEC §4.3.
 *
 * ONE message after the report, for a recommendation the engine stored as 'shown' (the 'video' arm). It is an
 * interactive cta_url: the video card as its image header (card-image.js), the "why" grounded in the teacher's
 * own lesson, and one button that opens the tracked player /v/<token> (link-token.js). If Meta refuses it, the
 * same without the picture; then the body as text with the link written out.
 *
 *   - once per session: claimPiece(session, 'video'), given back when nothing went out (report-piece-once.js);
 *   - tracked as the report's part 'video' (report-tracking.js), and the row records how it went (markSent);
 *   - never throws: a failed clip never touches the report.
 *
 * sendAfterReport() is what the two call sites use (report-generator hook B, observe-send hook B2): it reads the
 * flag at call time and the session's row from the engine's store, so the report path holds no state of its own.
 * With the flag off (or the engine's modules absent) it reads nothing and sends nothing.
 */
const path = require('path');
const { logToFile } = require('../../../utils/logger');
const { videoLinkUrl } = require('./link-token');
const copy = require('./copy');

const PART = 'video';
const NOTHING = Object.freeze({ sent: false, via: null });
const THUMBS = path.join(__dirname, '..', '..', '..', '..', 'assets');

function defaults(deps = {}) {
  return {
    whatsapp: deps.whatsapp || require('../../whatsapp.service'),
    store: deps.store || require('./store'),
    catalog: deps.catalog || require('./catalog'),
    claimPiece: deps.claimPiece || require('../report-piece-once').claimPiece,
    releasePiece: deps.releasePiece || require('../report-piece-once').releasePiece,
    renderCard: deps.renderCard || require('./card-image').renderVideoCard,
  };
}

function enabledByDefault() {
  try {
    return require('./flags').videoRecoEnabled() === true;
  } catch (_) {
    return false; // the engine's flags.js is not deployed: nothing to send
  }
}

function clipOf(catalog, row) {
  try {
    return (catalog && catalog.segment && catalog.segment(row.seg_id)) || null;
  } catch (_) {
    return null;
  }
}

/**
 * Never throws; {sent, via: 'cta_header'|'cta'|'text'|null}. Only for status === 'shown' and a row not yet sent
 * (`sent_via` is written by markSent: a retry after Redis lost the claim must not send twice, red-team H9).
 */
async function sendVideoRecommendation({ row, phone, language, track, imageStrip = false, deps = {} } = {}) {
  if (!row || row.status !== 'shown' || row.sent_via || !phone) return NOTHING;
  const sessionId = row.coaching_session_id;
  let claimed = false;
  try {
    const d = defaults(deps);
    const url = videoLinkUrl({ recommendationId: row.id, userId: row.user_id, surface: 'wa' });
    if (!url) {
      logToFile('[video-reco] no player link (PORTAL_URL or key missing): nothing sent', { coachingSessionId: sessionId });
      return NOTHING;
    }
    if (!(await d.claimPiece(sessionId, PART))) return NOTHING;
    claimed = true;

    const l = copy.lang(language);
    const hit = clipOf(d.catalog, row);
    const mod = (hit && hit.module) || {};
    const seg = (hit && hit.segment) || {};
    const start = Number(row.start_s ?? seg.start_s) || 0;
    const end = Number(row.end_s ?? seg.end_s) || 0;
    const durationS = end > start ? end - start : Number(mod.duration_s) || 60;
    const minutes = copy.minutesOf(durationS);
    const reason = copy.localized(row, 'reason', l);
    const body = copy.messageBody({ minutes, reason, clipLanguage: mod.language || 'ur', language: l });
    const buttonText = copy.buttonText({ minutes, language: l });

    let wamid = null;
    const base = track ? track.opts(PART) : {};
    const opts = {
      ...base,
      onMessageId: (id) => {
        wamid = id || wamid;
        if (base && typeof base.onMessageId === 'function') base.onMessageId(id);
      },
    };

    let via = null;
    let error = null;
    const png = await d.renderCard({
      thumbPath: path.join(THUMBS, mod.thumb || `video-thumbs/${row.module_id}.jpg`),
      title: copy.localized(seg, 'title', l) || mod.title || '',
      durationS,
      levelLabel: copy.levelLabel(mod.cpd_level, l),
      language: l,
    });
    const attempts = [
      ...(png ? [['cta_header', () => d.whatsapp.sendCtaUrl(phone, { body, buttonText, url, headerImage: png }, opts)]] : []),
      ['cta', () => d.whatsapp.sendCtaUrl(phone, { body, buttonText, url }, opts)],
      ['text', async () => (await d.whatsapp.sendMessage(phone, `${body}\n${url}`)) !== false],
    ];
    for (const [name, attempt] of attempts) {
      try {
        if ((await attempt()) === true) { via = name; break; }
      } catch (err) {
        error = err;
      }
    }

    if (track) await track.record(PART, Boolean(via), via ? null : error || new Error('video recommendation send failed'));
    if (!via) {
      await d.releasePiece(sessionId, PART);
      logToFile('[video-reco] clip message not sent (the report itself went out)', { coachingSessionId: sessionId }, 'warn');
      return NOTHING;
    }
    await d.store.markSent(sessionId, { sent_via: via, wamid: via === 'text' ? null : wamid, image_strip: Boolean(imageStrip) });
    logToFile('[video-reco] clip message sent', { coachingSessionId: sessionId, recommendationId: row.id, via });
    return { sent: true, via };
  } catch (err) {
    if (claimed) {
      try { await (deps.releasePiece || require('../report-piece-once').releasePiece)(sessionId, PART); } catch (_) { /* best effort */ }
    }
    logToFile('[video-reco] send failed (non-fatal)', { coachingSessionId: sessionId, error: err.message }, 'warn');
    return NOTHING;
  }
}

/**
 * Hooks B / B2. `row` is what the engine's hook returned for this report — the row, or the promise of it (the
 * engine runs without being awaited); when the caller has none, the session's stored row is read. Nothing
 * unless the flag is on and the row is 'shown'. Never throws.
 */
async function sendAfterReport({ coachingSessionId, phone, language, track, row: given, imageStrip = false, deps = {} } = {}) {
  try {
    const on = typeof deps.enabled === 'function' ? deps.enabled() : enabledByDefault();
    if (!on || !coachingSessionId) return NOTHING;
    const store = deps.store || require('./store');
    const row = given !== undefined ? await given : await store.readForSession(coachingSessionId);
    if (!row || row.status !== 'shown') return NOTHING;
    return await sendVideoRecommendation({ row, phone, language, track, imageStrip, deps: { ...deps, store } });
  } catch (err) {
    logToFile('[video-reco] could not read the recommendation (non-fatal)', { coachingSessionId, error: err.message }, 'warn');
    return NOTHING;
  }
}

module.exports = { sendVideoRecommendation, sendAfterReport, PART };
