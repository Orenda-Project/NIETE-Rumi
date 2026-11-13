'use strict';
/**
 * K-5 v8 lesson voice note + the LP Q&A voicenote-script lookup: OFF (product decision, 11 Nov 2026;
 * bd-xxejb, bd-juo829, bd-hz6ez.12). No audio is backfilled, so every send/lookup was failing.
 * A code switch, not an env flag (no new per-generation LP env flags — repo CLAUDE.md, fact 7).
 * Turning it back on is a code change with its own review.
 */
let enabled = false;

function isLpV8VoicenoteEnabled() {
  return enabled;
}

/** Tests only: the flag-on behaviour is still covered by the v8 suites. */
function __setForTests(value) {
  enabled = !!value;
}

module.exports = { isLpV8VoicenoteEnabled, __setForTests };
