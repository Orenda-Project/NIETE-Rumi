/**
 * bd-ma9jiy (queue #262; the operator 25 Nov ~19:50: "the button to save the recording ... on the component where there's
 * a seek bar, and 10-second plus minus, 2x 4x speed") — Save to phone on the portal's one recording player (portal
 * teacher/ui/AudioCard, lib/saveRecording.ts).
 *
 *   GET /api/portal/recording-file/link?src=<the player's signed R2 link>&name=NIETE_OBS_3Eng_25Nov_1040.webm
 *     → { url, filename }: the SAME object, signed again as an ATTACHMENT under that name (1 hour). Chrome then saves it
 *       in place; WhatsApp's browser hands the link to Chrome (public/open-file.html), which saves it; the app opens it in
 *       the system browser, which saves it.
 *
 * Who may: a signed-in portal user holding a link R2 accepts RIGHT NOW. Before signing, the link is tried (a 1-byte ranged
 * GET must answer 200/206), so a made-up or expired link to someone else's file gets a 403 and nothing is signed. The
 * name must be one the portal makes (NIETE_OBS_… / NIETE_DBRF_…, letters, digits and _ only, an audio extension); any
 * other name is replaced by the file's own. One row per link: recording.save_link (kind, extension, the user).
 */
const express = require('express');
const r2 = require('../services/r2.service');
const telemetry = require('../services/telemetry.service');

const NAME = /^NIETE_(OBS|DBRF)_[A-Za-z0-9_]{0,60}\.(webm|m4a|ogg|opus|mp3|wav|mp4|aac|amr|3gp)$/;
const PROBE_TIMEOUT_MS = 8000;

function emit(event, props) {
  try { telemetry.logEvent(event, props); } catch (_) { /* logging never decides the response */ }
}

/**
 * The object's path-style link in THIS service's bucket (R2_ENDPOINT + R2_BUCKET_NAME, the bucket the bot signs into), or
 * null for anything else. The bot's S3 client signs VIRTUAL-HOSTED links (https://<bucket>.<endpoint host>/<key>; prod:
 * digital-coach-audio.<account>.r2.cloudflarestorage.com) and the portal's signer reads path-style
 * (https://<endpoint host>/<bucket>/<key>), so both forms are mapped to the second. Another bucket, another account or a
 * look-alike host is null (lib/lesson-plan-file.js applies the same rule to lesson plans).
 */
function pathStyleInOurBucket(u) {
  const bucket = String(process.env.R2_BUCKET_NAME || '').trim();
  let endpoint;
  try { endpoint = new URL(process.env.R2_ENDPOINT).hostname.toLowerCase(); } catch (_) { return null; }
  if (!bucket || !endpoint) return null;
  const host = u.hostname.toLowerCase();
  if (host === `${bucket.toLowerCase()}.${endpoint}` && u.pathname.length > 1) return `https://${endpoint}/${bucket}${u.pathname}`;
  if (host === endpoint && u.pathname.startsWith(`/${bucket}/`)) return `https://${endpoint}${u.pathname}`;
  return null;
}

/** The status R2 answers for a 1-byte ranged GET of the signed link (0 when it did not answer). */
async function probeSignedLink(url) {
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), PROBE_TIMEOUT_MS) : null;
  try {
    const res = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: ac ? ac.signal : undefined });
    try { await res.arrayBuffer(); } catch (_) { /* the body is one byte or nothing */ }
    return res.status;
  } catch (_) {
    return 0;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function createRecordingFileRouter({ probe = probeSignedLink } = {}) {
  const router = express.Router();

  router.get('/recording-file/link', async (req, res) => {
    const s = req.session;
    if (!s || !s.portalUserId) return res.status(401).json({ error: 'not_signed_in' });
    const src = typeof req.query.src === 'string' ? req.query.src.slice(0, 4000) : '';
    let parsed;
    try { parsed = new URL(src); } catch (_) { return res.status(400).json({ error: 'bad_link' }); }
    const bare = parsed.protocol === 'https:' && parsed.searchParams.get('X-Amz-Signature') ? pathStyleInOurBucket(parsed) : null;
    if (!bare || !r2.isValidR2Url(bare)) return res.status(400).json({ error: 'bad_link' });
    const status = await probe(src);
    if (status !== 200 && status !== 206) return res.status(403).json({ error: 'link_not_accepted' });

    const own = decodeURIComponent(bare.split('/').pop() || 'recording.webm').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
    const asked = typeof req.query.name === 'string' ? req.query.name : '';
    const filename = NAME.test(asked) ? asked : own;
    const url = await r2.generatePresignedUrl(bare, 3600, { disposition: 'attachment', filename });
    if (!url) return res.status(502).json({ error: 'sign_failed' });
    emit('recording.save_link', {
      userId: s.portalUserId,
      kind: /^NIETE_DBRF_/.test(filename) ? 'dbrf' : /^NIETE_OBS_/.test(filename) ? 'obs' : 'other',
      ext: (filename.split('.').pop() || '').toLowerCase(),
    });
    return res.json({ url, filename });
  });

  return router;
}

module.exports = { createRecordingFileRouter, probeSignedLink, NAME };
