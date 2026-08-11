/**
 * setup-validator — Boot-time validator that checks environment variables
 * for flow configuration on startup.
 *
 * This is a SYNCHRONOUS function. It makes no API calls — it only reads
 * process.env. Designed to run at boot time as a non-blocking check.
 *
 * @module setup-validator
 */

const PREFIX = '[setup-validator]';

/**
 * Validate that required environment variables for flow-based features
 * are configured correctly.
 *
 * Checks:
 *  - READING_ASSESSMENT_FLOW_ID    → warn if missing
 *  - FLOW_PRIVATE_KEY              → error if missing AND any attendance flow ID is set
 *
 * @returns {{ ok: boolean, warnings: string[], errors: string[] }}
 */
function validateBootRequirements() {
  const warnings = [];
  const errors = [];

  // -----------------------------------------------------------------------
  // 1. Check individual flow IDs — warn if not set
  // -----------------------------------------------------------------------
  const readingFlowId = process.env.READING_ASSESSMENT_FLOW_ID;
  // flow-encryption.service.js accepts EITHER the raw PEM in FLOW_PRIVATE_KEY
  // or a base64 blob in FLOW_PRIVATE_KEY_B64 (which is what the deployments
  // actually set). Checking only the former made this error fire on every
  // boot while Flow decryption was working fine.
  const flowPrivateKey = process.env.FLOW_PRIVATE_KEY || process.env.FLOW_PRIVATE_KEY_B64;

  if (!readingFlowId) {
    const msg = `${PREFIX} READING_ASSESSMENT_FLOW_ID is not set. Reading assessment flows will not be available.`;
    warnings.push(msg);
    console.warn(msg);
  }

  // -----------------------------------------------------------------------
  // 2. Check FLOW_PRIVATE_KEY — error if endpoint flows are set without it
  // -----------------------------------------------------------------------
  // Any endpoint (data-exchange) Flow needs FLOW_PRIVATE_KEY to decrypt Meta's
  // payload. This used to key off the attendance flow IDs; attendance was torn
  // out on 2026-08-10, so it now keys off the endpoint flows that actually ship.
  const hasEndpointFlows = Boolean(
    process.env.SETTINGS_FLOW_ID
    || process.env.STATUS_FLOW_ID
    || process.env.HOMEWORK_FLOW_ID
    || process.env.STUDENT_VIDEOS_FLOW_ID
    || process.env.QUIZ_FLOW_ID
    || process.env.EXAM_CHECKER_STUDENTS_FLOW_ID,
  );

  if (hasEndpointFlows && !flowPrivateKey) {
    const msg = `${PREFIX} FLOW_PRIVATE_KEY is not set but endpoint flow IDs are configured. Flow decryption will fail.`;
    errors.push(msg);
    console.error(msg);
    console.error(
      `${PREFIX} Run \`node bot/scripts/setup/run-full-setup.js\` to register flows and configure encryption.`,
    );
  }

  // -----------------------------------------------------------------------
  // 3. Check INTERNAL_API_KEY — warn if not set
  // -----------------------------------------------------------------------
  if (!process.env.INTERNAL_API_KEY) {
    const msg = `${PREFIX} INTERNAL_API_KEY not set — internal admin API routes will be inaccessible. Set a random key in .env`;
    warnings.push(msg);
    console.warn(msg);
  }

  // -----------------------------------------------------------------------
  // 4. Check MMS_SERVICE_URL in production — warn if localhost
  // -----------------------------------------------------------------------
  if (process.env.NODE_ENV === 'production') {
    const mmsUrl = process.env.MMS_SERVICE_URL || '';
    if (!mmsUrl || mmsUrl.includes('localhost')) {
      const msg = `${PREFIX} MMS_SERVICE_URL is localhost — regional language transcription (Balochi, Sindhi, Pashto) will not work. Deploy Modal.com MMS service for full tier.`;
      warnings.push(msg);
      console.warn(msg);
    }
  }

  // -----------------------------------------------------------------------
  // 5. Return structured result
  // -----------------------------------------------------------------------
  return {
    ok: errors.length === 0,
    warnings,
    errors,
  };
}

module.exports = { validateBootRequirements };
