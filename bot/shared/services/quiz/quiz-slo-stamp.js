'use strict';
/**
 * Stamps a quiz's meta with its curriculum SLO codes (bd-v0toag.9), behind app_settings
 * `quiz_slo_retest_enabled` (off → meta returned untouched). Called by the generate step once the
 * digest and the lesson's slide script are both known; the stamp rides the next meta write.
 * A missing code is logged as `quiz.slo_code_missing` with its reason, never invented — the
 * report then keeps the old S1/S2 label.
 */
const { logEvent } = require('../../utils/structured-logger');
const { v21On } = require('./quiz-v21-flag');
const { codesFor, splitCodes, codeOf } = require('./quiz-slo-code');

async function stamp(meta, { slideScript, quizId, quizSource } = {}) {
  if (!meta || meta.slo_code_status) return meta;
  if (!(await v21On())) return meta;
  const got = slideScript
    ? codesFor({ sloCode: slideScript.sloCode, digest: meta.digest })
    : { status: 'transcript_quiz', codes: {} };
  if (got.status !== 'one_code') {
    logEvent('quiz.slo_code_missing', {
      quizId, quiz_source: quizSource || null, reason: got.status,
      codes_seen: slideScript ? splitCodes(slideScript.sloCode).length : 0,
    });
  }
  return { ...meta, slo_codes: got.codes, slo_code_status: got.status };
}

/** A reader for the stored codes, or null when none are stored or the switch is off. */
async function codeReader(meta) {
  if (!meta || !meta.slo_codes || !Object.keys(meta.slo_codes).length) return null;
  if (!(await v21On())) return null;
  return (externalId) => codeOf(meta, externalId);
}

module.exports = { stamp, codeReader };
