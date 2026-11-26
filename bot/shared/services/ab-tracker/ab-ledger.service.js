'use strict';
/**
 * The A/B ledger's status step (bd-9nb6s0.2, migration V1.10.12). The tracker cron calls advance() after a rollup
 * that ran, so it inherits every rollup guard (replica check, the ab_tracker_rollup_enabled switch, one caller per
 * slot). One call to ab_ledger_advance on the primary counts each test's units and moves it planned -> running (first
 * unit assigned) -> concluded (decide.py wrote a call). It never throws: a database without V1.10.12 answers
 * not_installed, any other error failed; the cron's exit code stays the rollup's.
 */
const { logToFile } = require('../../utils/logger');

const MISSING = new Set(['PGRST202', '42883']);

async function advance({ writer = () => require('../../config/supabase') } = {}) {
  try {
    const { data, error } = await writer().rpc('ab_ledger_advance');
    if (error && MISSING.has(error.code)) {
      logToFile('A/B ledger: ab_ledger_advance is not installed on this database yet', { code: error.code }, 'warn');
      return { outcome: 'not_installed' };
    }
    if (error) {
      logToFile('❌ A/B ledger: advance failed', { code: error.code, error: error.message }, 'error');
      return { outcome: 'failed', error: error.message };
    }
    return { outcome: 'advanced', ...data };
  } catch (e) {
    logToFile('❌ A/B ledger: advance threw', { error: e && e.message }, 'error');
    return { outcome: 'failed', error: e && e.message };
  }
}

module.exports = { advance };
