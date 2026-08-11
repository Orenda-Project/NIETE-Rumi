/**
 * OTA live-update bundle API.
 *
 * Mounted at /api/v1/frontend-bundle. Three routes:
 *
 *   POST /            publish a bundle          (CI only, upload key)
 *   GET  /            "what should I run?"      (devices, read key)
 *   POST /telemetry   "how did applying it go?" (devices, read key)
 *
 * This replaces an endpoint that still lives in a RETIRED repo's Django
 * service. That service is the single point of failure for every installed
 * app's ability to receive an update, and when it stops, the failure is
 * SILENT — the client swallows every error.
 *
 * ── TWO KEYS, NOT ONE ──────────────────────────────────────────────────────
 *
 * The implementation being replaced used ONE api_key for both reading and
 * publishing, hardcoded in four CI workflow files, with the SAME value for
 * staging and production. That key is in a public git history now.
 *
 * Publishing a bundle is remote code delivery to every device in the field —
 * strictly more dangerous than any database credential here. So:
 *
 *   OTA_UPLOAD_API_KEY  only CI holds it. Publishes bundles.
 *   OTA_READ_API_KEY    every device holds it. Read-only.
 *
 * A device compromise must not become a publish capability. Both keys come
 * from the environment; neither may ever appear in this repo.
 *
 * ── WHY ELIGIBILITY IS DECIDED HERE ────────────────────────────────────────
 *
 * The old client fetched the list and picked `max(version)` itself. That
 * trusts the device to decline a bundle it should never have been shown, and
 * cannot express a staged rollout at all. Here the server decides and returns
 * at most one bundle: an ineligible device never learns it exists.
 */
const express = require('express');

const { logToFile } = require('../utils/logger');
const supabase = require('../config/supabase');
const bundleStorage = require('../services/bundle-storage.service');
const { selectBundle } = require('../services/ota-bundle-selector');

const router = express.Router();

const TABLE = 'frontend_bundles';
const EVENTS_TABLE = 'frontend_bundle_events';

/** How many recent rows to consider when picking a winner. */
const CANDIDATE_LIMIT = 20;

const VALID_OUTCOMES = ['applied', 'failed', 'reverted'];

/**
 * Build a fixed-key auth middleware.
 *
 * Refuses when the expected key is UNSET. Without that check, a deployment
 * missing the variable would compare `undefined === undefined` for a caller
 * that sent no header at all — and the endpoint would be open to anyone who
 * found the URL. Same reasoning as requireInternalKey in internal-api.routes.
 */
function requireKey(envVar, label) {
  return function keyGuard(req, res, next) {
    const expected = process.env[envVar];
    if (!expected) {
      logToFile(`❌ OTA ${label} called but ${envVar} is not set — refusing`, {
        path: req.path,
      }, 'error');
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    if (req.headers['x-api-key'] !== expected) {
      logToFile(`❌ Unauthorized OTA ${label} call`, { path: req.path, ip: req.ip }, 'error');
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    return next();
  };
}

const requireUploadKey = requireKey('OTA_UPLOAD_API_KEY', 'upload');
const requireReadKey = requireKey('OTA_READ_API_KEY', 'read');

/** Strict integer parse — no coercion of 'latest', '', or '12abc'. */
function asInt(value) {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value, 10);
  }
  return null;
}

/**
 * POST /api/v1/frontend-bundle
 *
 * Publish a bundle. Lands on the INTERNAL channel at 0% rollout by default:
 * a fresh upload is inert until someone deliberately opens it up. Reaching
 * teachers is a separate, gated action.
 *
 * Body   { bundleVersion, minNativeVersion, environment, fileBase64,
 *          channel?, releaseNotes? }
 * Auth   x-api-key: OTA_UPLOAD_API_KEY
 * Errors 400 (bad/missing field), 401, 502 (storage or DB failed)
 * Ok     201 { success, bundle }
 */
router.post('/', requireUploadKey, async (req, res) => {
  const body = req.body || {};

  const bundleVersion = asInt(body.bundleVersion);
  const minNativeVersion = asInt(body.minNativeVersion);
  const environment = body.environment;
  const channel = body.channel || 'internal';

  if (bundleVersion === null) {
    return res.status(400).json({ success: false, error: 'bundleVersion must be an integer' });
  }
  // No default. A wrong compatibility floor is a crash on a device we cannot
  // reach, so a missing one is a refusal rather than a guess.
  if (minNativeVersion === null) {
    return res.status(400).json({
      success: false,
      error: 'minNativeVersion is required — it is the contract with the native build',
    });
  }
  if (!environment) {
    return res.status(400).json({ success: false, error: 'environment is required' });
  }
  if (!['internal', 'production'].includes(channel)) {
    return res.status(400).json({ success: false, error: 'channel must be internal or production' });
  }
  if (!body.fileBase64) {
    return res.status(400).json({ success: false, error: 'fileBase64 is required' });
  }

  let bytes;
  try {
    bytes = Buffer.from(body.fileBase64, 'base64');
  } catch (_) {
    bytes = null;
  }
  if (!bytes || bytes.length === 0) {
    return res.status(400).json({ success: false, error: 'fileBase64 did not decode to any bytes' });
  }

  try {
    // Storage first: a DB row pointing at an object that failed to upload is
    // worse than no row, because the selector would happily serve it.
    const { bundleUrl, checksumSha256 } = await bundleStorage.uploadBundle(bytes, {
      bundleVersion,
      environment,
    });

    const row = {
      bundle_version: bundleVersion,
      min_native_version: minNativeVersion,
      channel,
      environment,
      rollout_percent: 0,
      bundle_url: bundleUrl,
      checksum_sha256: checksumSha256,
      release_notes: body.releaseNotes || null,
    };

    const { data, error } = await supabase.from(TABLE).insert(row).select().single();
    if (error) throw new Error(error.message || 'insert failed');

    logToFile('📦 OTA bundle published', {
      bundleVersion, minNativeVersion, channel, environment,
    });

    return res.status(201).json({
      success: true,
      bundle: {
        id: data && data.id,
        bundleVersion,
        minNativeVersion,
        channel,
        environment,
        rolloutPercent: 0,
        checksumSha256,
      },
    });
  } catch (error) {
    logToFile('❌ OTA bundle publish failed', {
      bundleVersion, environment, error: error && error.message,
    }, 'error');
    return res.status(502).json({ success: false, error: 'Failed to publish bundle' });
  }
});

/**
 * GET /api/v1/frontend-bundle
 *
 * What should this device be running? Returns at most one bundle.
 *
 * 204 is a first-class answer meaning "nothing for you" — up to date, held out
 * of a rollout, or on a binary too old for anything available. The client must
 * treat it as normal, not as an error.
 *
 * Query  environment, native (installed versionCode), deviceId, channel?, current?
 * Auth   x-api-key: OTA_READ_API_KEY
 */
router.get('/', requireReadKey, async (req, res) => {
  const q = req.query || {};
  const environment = q.environment;
  const channel = q.channel || 'production';
  const deviceId = q.deviceId;
  const nativeVersion = asInt(q.native);
  const current = asInt(q.current);

  if (!environment) {
    return res.status(400).json({ success: false, error: 'environment is required' });
  }
  // A device that will not say what it is running gets nothing. Guessing here
  // is what hands a bundle to a binary that cannot run it.
  if (nativeVersion === null) return res.status(204).end();
  if (!deviceId) return res.status(400).json({ success: false, error: 'deviceId is required' });

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('environment', environment)
      .eq('channel', channel)
      .order('bundle_version', { ascending: false })
      .limit(CANDIDATE_LIMIT);

    if (error) throw new Error(error.message || 'select failed');

    const picked = selectBundle(data, { nativeVersion, deviceId, channel });
    if (!picked) return res.status(204).end();

    // Already on it (or ahead of it) — nothing to do.
    if (current !== null && Number(picked.bundle_version) <= current) {
      return res.status(204).end();
    }

    const url = await bundleStorage.signBundleUrl(picked.bundle_url);

    return res.status(200).json({
      success: true,
      bundle: {
        bundleVersion: Number(picked.bundle_version),
        minNativeVersion: Number(picked.min_native_version),
        checksumSha256: picked.checksum_sha256,
        url,
      },
    });
  } catch (error) {
    logToFile('❌ OTA bundle lookup failed', {
      environment, channel, nativeVersion, error: error && error.message,
    }, 'error');
    return res.status(502).json({ success: false, error: 'Failed to look up bundle' });
  }
});

/**
 * POST /api/v1/frontend-bundle/telemetry
 *
 * How did applying a bundle go? This is the signal a staged rollout is read
 * from — without it, a rollout is blind and an auto-halt has nothing to act on.
 *
 * The implementation being replaced had two empty `catch (err) {}` blocks, so
 * every OTA failure in production was invisible: there was no way to know how
 * many devices took a bundle or how many broke.
 *
 * Body   { deviceId, bundleVersion, environment, outcome, detail?, nativeVersion? }
 * Auth   x-api-key: OTA_READ_API_KEY
 * Ok     202
 */
router.post('/telemetry', requireReadKey, async (req, res) => {
  const body = req.body || {};
  const bundleVersion = asInt(body.bundleVersion);
  const { deviceId, environment, outcome } = body;

  if (!deviceId || !environment || bundleVersion === null) {
    return res.status(400).json({
      success: false,
      error: 'deviceId, bundleVersion and environment are required',
    });
  }
  if (!VALID_OUTCOMES.includes(outcome)) {
    return res.status(400).json({
      success: false,
      error: `outcome must be one of ${VALID_OUTCOMES.join(', ')}`,
    });
  }

  try {
    const { error } = await supabase.from(EVENTS_TABLE).insert({
      device_id: deviceId,
      bundle_version: bundleVersion,
      environment,
      outcome,
      native_version: asInt(body.nativeVersion),
      detail: body.detail ? String(body.detail).slice(0, 500) : null,
    });
    if (error) throw new Error(error.message || 'insert failed');

    if (outcome !== 'applied') {
      // Surface these loudly — a cluster of these mid-rollout is the halt signal.
      logToFile('⚠️ OTA bundle did not apply cleanly', {
        bundleVersion, environment, outcome, detail: body.detail,
      });
    }
    return res.status(202).json({ success: true });
  } catch (error) {
    logToFile('❌ OTA telemetry write failed', {
      bundleVersion, environment, outcome, error: error && error.message,
    }, 'error');
    return res.status(502).json({ success: false, error: 'Failed to record telemetry' });
  }
});

module.exports = router;
