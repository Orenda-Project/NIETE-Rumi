/**
 * A one-off script that can issue certificates against the PRODUCTION database must run with
 * NODE_ENV=production, or it refuses.
 *
 * certificate-pdf.service stamps 'NOT A REAL CERTIFICATE' across every PDF rendered outside
 * NODE_ENV=production (certificate-env.rules.js shouldStampTestBanner — fail-safe by design), and
 * the PDF is cached at training_certificates.pdf_r2_key, so a real teacher downloads the stamped
 * file from then on. On 2026-10-17 a production release run loaded NIETE-Rumi/.env (production
 * SUPABASE_URL, NODE_ENV=development): every one of the 34 certificates it issued carries the
 * banner (bd-r2uzg1.16). Its project-ref checks passed, because the DATABASE was right; only the
 * render environment was wrong. This is the check that was missing.
 *
 * Keyed on the database the script will write to (the project ref in SUPABASE_URL), not on a
 * --target flag, so it holds for a script that has no flag. Sandbox and staging are left alone:
 * their certificates SHOULD carry the banner (operator, 2026-11-13: "that is supposed to be
 * staging and sandbox environments").
 *
 * Call it AFTER the env file is loaded and BEFORE anything that connects or renders.
 *
 * Used by: scripts/release-isaps-held-attempts.js, scripts/settle-certificates.js,
 * scripts/smoke-test-training-flow.js. A new script that can reach the certificate renderer
 * (maybeIssueQuizScoreCertificate, loadVisibleLevelsWithProgress, generateAndStoreCertificatePdf,
 * fetchOrMintCertificatePdf) calls it too.
 */
const { isProductionEnv, TEST_BANNER_TEXT } = require('../../bot/shared/services/training/certificate-env.rules');

/** NIETE production Supabase project (same value as TARGET_REFS.prod in the scripts). */
const PRODUCTION_SUPABASE_REF = 'ihzciabopbttygxxgrkm';

function refOfUrl(url) {
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.(co|in)\b/i.exec(String(url || '').trim());
  return m ? m[1].toLowerCase() : null;
}

/**
 * Throws unless it is safe to issue certificates from this process.
 * @param {{supabaseUrl?: string, nodeEnv?: string, script?: string}} p
 */
function assertProductionCertificateEnv({ supabaseUrl, nodeEnv, script = 'this script' } = {}) {
  if (refOfUrl(supabaseUrl) !== PRODUCTION_SUPABASE_REF) return;
  if (isProductionEnv(nodeEnv)) return;
  const shown = nodeEnv === undefined ? '(unset)' : `'${nodeEnv}'`;
  throw new Error(
    `REFUSING: ${script} can issue certificates and SUPABASE_URL is the production project `
    + `(${PRODUCTION_SUPABASE_REF}), but NODE_ENV is ${shown}, not 'production'. Every certificate PDF `
    + `rendered now would carry '${TEST_BANNER_TEXT}' and be cached on a real teacher's certificate. `
    + 'Use the production env file (NIETE-Rumi/.env.prod sets NODE_ENV=production; '
    + 'NIETE-Rumi/.env points at production with NODE_ENV=development).',
  );
}

module.exports = { PRODUCTION_SUPABASE_REF, refOfUrl, assertProductionCertificateEnv };
