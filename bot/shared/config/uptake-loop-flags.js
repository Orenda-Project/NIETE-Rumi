/**
 * The feedback-uptake loop's single switch.
 *
 * Read at CALL time, never cached at import: a worker outlives any one env
 * snapshot, and constants.js-style caching is exactly what made late-set
 * Railway variables invisible before. Unset = off, and every loop caller must
 * be a no-op when this is false — the loop ships inert and is switched on
 * per environment.
 */
function isUptakeLoopEnabled() {
  const raw = String(process.env.UPTAKE_LOOP_ENABLED || '').trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

module.exports = { isUptakeLoopEnabled };
