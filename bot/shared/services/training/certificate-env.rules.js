/**
 * bd-60133 — is this certificate a real one, or a test artefact?
 *
 * Sandbox and staging mint PDFs that are visually indistinguishable from a
 * production certificate: a real teacher's name, a real-looking code
 * (NIETESANDBOX-20260918-5BVD72), the government seals and both NIETE
 * signatories. One was issued by mistake today — passing a single MODULE minted
 * a LEVEL certificate (bd-60126) — and nothing on the page said it was a test.
 *
 * Operator, 2026-09-18: outside production, every certificate carries a banner
 * saying it is not real.
 *
 * THE GATE IS FAIL-SAFE, and that is the decision worth stating. Production is
 * the ONLY environment that sets NODE_ENV=production; `.env.sandbox` does not
 * set it at all. So the rule is "stamp UNLESS explicitly production" — unset,
 * empty or misspelled all stamp. Defaulting the other way would leave every
 * sandbox certificate clean and put the banner nowhere, which is the failure
 * this exists to prevent.
 *
 * Pure: reads the value it is handed, never process.env, so it is testable and
 * the caller decides where the environment comes from.
 */

/** Printed across the top of any certificate generated outside production. */
const TEST_BANNER_TEXT = 'TEST CERTIFICATE — NOT A REAL CERTIFICATE. For testing purposes only.';

/**
 * Is this the production environment?
 *
 * Exact match on 'production' after trimming and lowercasing. Deliberately
 * strict: 'prod' is NOT production, because a typo must fail towards the
 * banner rather than away from it.
 *
 * @param {string|null|undefined} nodeEnv
 * @returns {boolean}
 */
function isProductionEnv(nodeEnv) {
  return String(nodeEnv || '').trim().toLowerCase() === 'production';
}

/**
 * Should this certificate carry the test banner?
 *
 * @param {string|null|undefined} nodeEnv
 * @returns {boolean}
 */
function shouldStampTestBanner(nodeEnv) {
  return !isProductionEnv(nodeEnv);
}

module.exports = {
  TEST_BANNER_TEXT,
  isProductionEnv,
  shouldStampTestBanner,
};
