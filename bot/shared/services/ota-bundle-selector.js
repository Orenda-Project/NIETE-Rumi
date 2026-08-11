/**
 * bd-2542 — which OTA bundle (if any) a given device is allowed to install.
 *
 * This is the whole compatibility contract between the two release trains:
 *
 *     NATIVE (Play, slow)          OTA (ours, fast)
 *       AAB -> internal -> prod      bundle -> internal ch. -> production ch.
 *             |                              |
 *             +--------- versionCode --------+
 *                     min_native_version
 *
 * A web bundle can only call native code that exists in the installed binary.
 * So every bundle declares the minimum `versionCode` it can run on, and a
 * device is never offered a bundle above its own. Skip that and you ship a JS
 * bundle that calls a plugin which is not there — it installs cleanly and then
 * crashes on a path nobody tested.
 *
 * WHY THIS DECIDES SERVER-SIDE. The implementation being replaced picked the
 * winner in the client with `data.reduce((a,b) => a.version > b.version ? a : b)`.
 * That trusts the device to decline a bundle it should not have been shown, and
 * it cannot express a staged rollout at all. Deciding here means an ineligible
 * device never learns the bundle exists.
 *
 * Pure and dependency-free on purpose: no DB, no network, no config reads. The
 * route hands it rows; it returns a row or null. That is what lets the
 * eligibility rules be tested exhaustively without credentials.
 */
const crypto = require('crypto');

/**
 * Is this device inside the rollout cohort for this bundle?
 *
 * Two properties matter and both are load-bearing:
 *
 *   DETERMINISTIC — the bucket is a pure hash of (device, bundle). Re-rolling
 *   per request would let a device take a bundle, drop out of the cohort, and
 *   take it again.
 *
 *   MONOTONIC — a device inside 10% is inside 50% and 100%. Ramping a rollout
 *   must only ever ADD devices; a device that already installed the bundle
 *   must not fall out on the way up.
 *
 * The bundle version is part of the hash so the same unlucky ~10% are not the
 * guinea pigs for every release forever.
 */
function isInRollout(deviceId, bundleVersion, rolloutPercent) {
  const pct = Number(rolloutPercent);
  if (!Number.isFinite(pct) || pct <= 0) return false;
  if (pct >= 100) return true;

  const digest = crypto
    .createHash('sha256')
    .update(`${deviceId}:${bundleVersion}`)
    .digest();
  // First 4 bytes as an unsigned int, mapped to 0..99. Using the raw digest
  // (not parseInt on the hex) keeps this cheap and uniform enough.
  const bucket = digest.readUInt32BE(0) % 100;
  return bucket < pct;
}

/**
 * The highest-versioned bundle this device may install, or null.
 *
 * A null return is a first-class answer meaning "nothing for you" — it is the
 * correct response for an up-to-date device, a device held out of a rollout,
 * and a device whose binary is too old. The caller must not treat it as an
 * error.
 *
 * @param {Array<object>} rows      candidate bundle rows
 * @param {object}        opts
 * @param {number}        opts.nativeVersion  the device's installed versionCode
 * @param {string}        opts.deviceId       stable per-install id (rollout bucket)
 * @param {string}        [opts.channel]      'production' (default) | 'internal'
 * @returns {object|null}
 */
function selectBundle(rows, opts = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const { deviceId, channel = 'production' } = opts;

  // An unknown native version is NOT a reason to guess. Guessing here is
  // precisely what hands a bundle to a binary that cannot run it.
  const nativeVersion = Number(opts.nativeVersion);
  if (!Number.isInteger(nativeVersion)) return null;

  const eligible = rows.filter((row) => {
    if ((row.channel || 'production') !== channel) return false;

    // Without a checksum the client cannot verify what it downloaded, so the
    // bundle is not shippable regardless of how new it is.
    if (!row.checksum_sha256) return false;

    // Numeric compare, deliberately. `"9" > "10"` is true for strings, which
    // is how the previous client could pick an older bundle over a newer one.
    const minNative = Number(row.min_native_version);
    if (!Number.isInteger(minNative)) return false;
    if (minNative > nativeVersion) return false;

    return isInRollout(deviceId, Number(row.bundle_version), row.rollout_percent);
  });

  if (eligible.length === 0) return null;

  return eligible.reduce((best, row) =>
    Number(row.bundle_version) > Number(best.bundle_version) ? row : best,
  );
}

module.exports = { selectBundle, isInRollout };
