'use strict';
/**
 * bd-sex15q.16 — COACHIP's two media streams (contracts/API.md §10 R7, R8; §11 audit; SPEC v2 §7), registered on m-api's
 * router through createCoachipRouter's mediaRoutes(router, guards) hook, behind the same guard chain as every route.
 *
 *   R7 GET /coachip/m/:momentId/clip          coach (inScope) or RM (this week's circle); the stored clip, else the
 *                                             live cut, else 503 clip_unavailable
 *   R8 GET /coachip/session/:sessionId/audio  coach only (A4); the whole-lesson MP3, else the recording, else 503
 *
 * "Not yours" and "does not exist" are one 404 body (B3); a 400 is decided from the path alone, before any read. A play
 * (no Range, or bytes=0-) that is served writes one audit row; a seek or a 503 writes none (A10); a failed audit is logged
 * and the play goes on.
 * Never a URL, a key or a file name in a header, a body or a log line (B4): the bytes are piped by coachip-clip.service.
 */
const S = require('../services/coachip-shapes');
const { createClipService } = require('../services/coachip-clip.service');

const send = (res, status, body) => res.status(status).json(body);
const CLIP_UNAVAILABLE = Object.freeze({ error: 'clip_unavailable' });
const AUDIO_UNAVAILABLE = Object.freeze({ error: 'audio_unavailable' });
const isPlay = (req) => req.headers.range === undefined || req.headers.range === 'bytes=0-';

/**
 * @param {object} deps
 * @param {Function} deps.query         pg-shaped query(sql, params) → {rows}
 * @param {Function} deps.inScope       (coachScope, sessionId) → boolean (coachip-scope.service)
 * @param {Function} deps.circleAllows  (rmScope, momentId) → boolean
 * @param {Function} deps.audit         (actorUserId, action, subjectId) → throws on failure (coachip-codes.service)
 * @param {object} [deps.clip]          createClipService(...) (tests inject the R2 and ffmpeg boundary)
 * @returns {(router, guards: {either: Function[], coach: Function[]}) => void}
 */
function createCoachipMediaRoutes({ query, inScope, circleAllows, audit, clip }) {
  let service = clip || null;
  const media = () => service || (service = createClipService());

  async function auditPlay(req, action, subjectId) {
    if (!isPlay(req)) return;
    try {
      await audit(req.session.portalUserId, action, subjectId);
    } catch (err) {
      console.error(`[coachip-media] ${action} audit failed:`, (err && (err.name || err.code)) || 'Error');
    }
  }

  return function mediaRoutes(router, guards) {
    // ── R7: one moment's clip ──
    router.get('/coachip/m/:momentId/clip', ...guards.either, async (req, res) => {
      const { momentId } = req.params;
      if (!S.isUuid(momentId)) return send(res, 400, S.BODIES[400]);
      const c = req.coachip || {};
      let row;
      let action = null;
      try {
        const { rows } = await query(
          `SELECT m.session_id, m.clip_status, m.clip_r2_key, m.from_s, m.to_s, cs.audio_url
             FROM coachip_moments m JOIN coaching_sessions cs ON cs.id = m.session_id
            WHERE m.id = $1`,
          [momentId],
        );
        row = rows[0];
        if (row && c.coach && await inScope(c.coach, row.session_id)) action = 'clip';
        else if (row && c.rm && await circleAllows(c.rm, momentId)) action = 'circle_play';
      } catch (err) {
        console.error('[coachip-media] clip lookup failed:', (err && (err.name || err.code)) || 'Error');
        return send(res, 500, S.BODIES[500]);
      }
      if (!action) return send(res, 404, S.BODIES[404]);
      res.set('Cache-Control', 'private, no-store');

      if (row.clip_status === 'ready' && row.clip_r2_key) {
        const out = await media().streamObject(req, res, { bucket: media().clipBucket(), key: row.clip_r2_key, contentType: 'audio/mpeg' });
        if (out === 'served') return auditPlay(req, action, momentId);
        // 'missing' (expired or never written) or an R2 error: the live cut is the fallback either way (API.md §1 503 row)
      }
      if (row.audio_url && Number.isInteger(row.from_s) && Number.isInteger(row.to_s)) {
        const out = await media().liveCut(req, res, { audioUrl: row.audio_url, fromS: row.from_s, toS: row.to_s });
        if (out === 'served') return auditPlay(req, action, momentId);
      }
      return send(res, 503, CLIP_UNAVAILABLE);
    });

    // ── R8: the whole recording, coach only ──
    router.get('/coachip/session/:sessionId/audio', ...guards.coach, async (req, res) => {
      const { sessionId } = req.params;
      if (!S.isUuid(sessionId)) return send(res, 400, S.BODIES[400]);
      const c = req.coachip || {};
      if (!c.coach) return send(res, 404, S.BODIES[404]);
      let audioUrl;
      try {
        if (!await inScope(c.coach, sessionId)) return send(res, 404, S.BODIES[404]);
        const { rows } = await query('SELECT audio_url FROM coaching_sessions WHERE id = $1', [sessionId]);
        audioUrl = rows[0] ? rows[0].audio_url : null;
      } catch (err) {
        console.error('[coachip-media] audio lookup failed:', (err && (err.name || err.code)) || 'Error');
        return send(res, 500, S.BODIES[500]);
      }
      res.set('Cache-Control', 'private, no-store');

      // The nightly whole-lesson MP3 first: it seeks where a cue-less recorder WebM may not (API.md §10 R8 caveat). Any
      // miss or R2 error on it falls back to the recording itself: the lesson still plays, only the seek may not land.
      const fullKey = media().fullAudioKey(sessionId);
      const bucket = media().clipBucket();
      if (fullKey && bucket) {
        const out = await media().streamObject(req, res, { bucket, key: fullKey, contentType: 'audio/mpeg' });
        if (out === 'served') return auditPlay(req, 'full_audio', sessionId);
      }
      const loc = media().recordingLocation(audioUrl);
      if (!loc) return send(res, 503, AUDIO_UNAVAILABLE);
      const out = await media().streamObject(req, res, {
        bucket: loc.bucket, key: loc.key, contentType: (stored) => media().audioTypeFor(loc.key, stored),
      });
      if (out === 'served') return auditPlay(req, 'full_audio', sessionId);
      return send(res, 503, AUDIO_UNAVAILABLE);
    });
  };
}

module.exports = { createCoachipMediaRoutes };
