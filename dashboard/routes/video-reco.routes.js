'use strict';
/**
 * The recommended training clip's player — bd-gzfdu9 (VIDREC), SPEC §4.6, r-ab ab/EVENTS_SCHEMA.md §2.
 *
 *   GET  /v/thumb/:id.jpg  the module's thumbnail (bot/assets/video-thumbs), cached 7 days.
 *   GET  /v/:token         genuine → the clip page (video-reco-page.js), opening at the chapter start, for the teacher the
 *                          token names (bot/shared/services/coaching/video-reco/link-token.js; 120 days, signs nobody in).
 *                          A `click` row is written server side with ua_class, the token's surface and a device id.
 *                          Link-preview crawlers get the page without a presigned URL. Expired → sign-in; bad → 404 page.
 *   POST /v/:token/e       the player's beacons (allow-listed, ≤ 50 per post) → video_reco_events; 204.
 *
 * The media is the module's own R2 object, presigned for 1 hour (lib/media-url.js) — never the portal's module
 * endpoint, which refuses locked modules. Nothing here writes a training table. Private, no-store, rate limited
 * like /cr. A failed event write never changes the page.
 */
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { verifyVideoLink, VIDEO_PATH } = require('../../bot/shared/services/coaching/video-reco/link-token');
const { signReportLink, REPORT_PATH } = require('../../bot/shared/services/coaching/report-link-token');
const copy = require('../../bot/shared/services/coaching/video-reco/copy');
const { renderPlayer } = require('../services/video-reco-page');
const { renderMessagePage } = require('../services/coaching-report-page');
const events = require('../services/video-reco-events');
const telemetry = require('../services/telemetry.service');

const SIGN_IN = '/portal/login';
const THUMBS = path.join(__dirname, '..', '..', 'bot', 'assets', 'video-thumbs');
const COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60;

/**
 * An R2 path-style url re-addressed to R2_BUCKET_NAME, same key. The catalogue's urls name the prod bucket; sandbox
 * serves copies at the same keys in its own bucket, and the presigner only finds keys in R2_BUCKET_NAME (qa-e2e FAIL
 * 20261020T200126). Where the buckets already match (prod), or none is configured, the url is returned unchanged.
 */
function inServingBucket(url, bucket = process.env.R2_BUCKET_NAME) {
  const m = /^(https:\/\/[^/]+\.r2\.cloudflarestorage\.com\/)([^/?]+)(\/.*)$/i.exec(String(url || ''));
  if (!bucket || !m || m[2] === bucket) return url;
  return `${m[1]}${bucket}${m[3]}`;
}

function log(props, event = 'video_reco.page.open') {
  try { telemetry.logEvent(event, props); } catch (_) { /* logging never decides the response */ }
}

function createVideoRecoRouter(opts = {}) {
  const db = () => require('../config/supabase');
  const loadClip = opts.loadClip || ((r, u) => events.loadClip(db(), r, u, events.catalogOrNull()));
  const presign = opts.presign || ((url) => require('../lib/media-url').resolveMediaUrl(url, 3600));
  const insert = opts.insertEvent || ((row) => events.insertEvent(db(), row));
  const thumbs = opts.thumbsDir || THUMBS;
  const router = express.Router();
  const limiter = rateLimit({
    windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, validate: false,
    handler: (req, res) => res.status(429).type('html').send(renderMessagePage('error')),
  });
  const privateHeaders = (req, res, next) => {
    res.set({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' });
    next();
  };

  const write = async (row) => {
    try {
      const out = await insert(row);
      const err = out && out.error;
      if (err && err.code !== '23505') log({ event: row.event, error: err.message || String(err) }, 'video_reco.event.failed');
    } catch (e) {
      log({ event: row.event, error: e.message }, 'video_reco.event.failed');
    }
  };

  /** The link's ids, or null once the bad/expired answer has been sent. */
  const verified = (token, res) => {
    const v = verifyVideoLink(token);
    if (!v.ok && v.reason === 'expired') {
      log({ outcome: 'expired' });
      res.redirect(302, SIGN_IN);
      return null;
    }
    if (!v.ok) {
      log({ outcome: 'bad' });
      res.status(404).type('html').send(renderMessagePage('not_found'));
      return null;
    }
    return v;
  };

  const device = (req, res) => {
    const d = events.deviceOf(req.headers.cookie);
    if (d.fresh) {
      res.append('Set-Cookie', `${events.COOKIE}=${d.value}; Max-Age=${COOKIE_MAX_AGE_S}; Path=${VIDEO_PATH}; Secure; HttpOnly; SameSite=Lax`);
    }
    return d.id;
  };

  router.get(`${VIDEO_PATH}/thumb/:file`, (req, res) => {
    const m = /^(\d{1,6})\.jpg$/.exec(String(req.params.file || ''));
    if (!m) return res.status(404).end();
    return res.sendFile(`${m[1]}.jpg`, { root: thumbs, maxAge: '7d', dotfiles: 'deny' }, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });

  router.get(`${VIDEO_PATH}/:token`, privateHeaders, limiter, async (req, res) => {
    const token = String(req.params.token || '');
    const v = verified(token, res);
    if (!v) return undefined;
    const { recommendationId, userId, surface } = v;
    let clip;
    try {
      clip = await loadClip(recommendationId, userId);
    } catch (_) {
      log({ outcome: 'error', recommendationId });
      return res.status(503).type('html').send(renderMessagePage('error'));
    }
    if (!clip || !clip.row) {
      log({ outcome: 'not_found', recommendationId });
      return res.status(404).type('html').send(renderMessagePage('not_found'));
    }
    const ua = events.uaClass(req.headers['user-agent']);
    await write({ recommendation_id: recommendationId, event: 'click', ua_class: ua, surface, device: device(req, res) });

    const { row } = clip;
    const mod = clip.module || {};
    const seg = clip.segment || {};
    const l = copy.lang(clip.language);
    let src = null;
    if (ua !== 'crawler' && mod.video_url) {
      try { src = await presign(inServingBucket(mod.video_url)); } catch (_) { src = null; }
    }
    const reportToken = signReportLink({ sessionId: row.coaching_session_id, userId });
    log({ outcome: 'ok', recommendationId, userId, ua_class: ua, surface, language: l });
    return res.status(200).type('html').send(renderPlayer({
      language: l,
      title: copy.localized(seg, 'title', l) || mod.title || '',
      reason: copy.localized(row, 'reason', l),
      src,
      poster: row.module_id != null ? `${VIDEO_PATH}/thumb/${encodeURIComponent(row.module_id)}.jpg` : null,
      startS: row.start_s ?? seg.start_s,
      endS: row.end_s ?? seg.end_s,
      eventsUrl: `${VIDEO_PATH}/${token}/e`,
      backHref: reportToken ? `${REPORT_PATH}/${reportToken}` : null,
    }));
  });

  router.post(`${VIDEO_PATH}/:token/e`, privateHeaders, limiter, express.text({ type: () => true, limit: '16kb' }), async (req, res) => {
    const v = verifyVideoLink(String(req.params.token || ''));
    if (!v.ok) return res.status(404).end();
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch (_) {
      return res.status(400).end();
    }
    const list = events.cleanEvents(body && body.events);
    const ua = events.uaClass(req.headers['user-agent']);
    const dev = device(req, res);
    for (const e of list) {
      // eslint-disable-next-line no-await-in-loop -- ≤ 50, in order, so first-only events keep their order
      await write({ recommendation_id: v.recommendationId, ...e, ua_class: ua, surface: v.surface, device: dev });
    }
    return res.status(204).end();
  });

  return router;
}

module.exports = { createVideoRecoRouter };
