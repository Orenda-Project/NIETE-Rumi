'use strict';
/**
 * The A/B ledger's two cron steps. The tracker cron calls both after a rollup that ran, so they inherit every rollup
 * guard (replica check, the ab_tracker_rollup_enabled switch, one caller per slot).
 *   advance() (bd-9nb6s0.2, V1.10.12): ab_ledger_advance counts each test's units and moves it planned -> running
 *     (first unit assigned) -> concluded (decide.py wrote a call).
 *   flip() (bd-9nb6s0.6, V1.10.13): ab_ledger_switch hands each concluded test's winner to everyone through its
 *     switch_key in app_settings, or, unless app_settings ab_switch_auto is JSON true, records a pending flip with its SQL.
 * Neither throws: a database without the migration answers not_installed, any other error failed; the cron's exit
 * code stays the rollup's.
 */
const { logToFile } = require('../../utils/logger');

const MISSING = new Set(['PGRST202', '42883']);
const defaultWriter = () => require('../../config/supabase');

async function callRpc(fn, done, writer) {
  try {
    const { data, error } = await writer().rpc(fn);
    if (error && MISSING.has(error.code)) {
      logToFile(`A/B ledger: ${fn} is not installed on this database yet`, { code: error.code }, 'warn');
      return { outcome: 'not_installed' };
    }
    if (error) {
      logToFile(`❌ A/B ledger: ${fn} failed`, { code: error.code, error: error.message }, 'error');
      return { outcome: 'failed', error: error.message };
    }
    return { outcome: done, ...data };
  } catch (e) {
    logToFile(`❌ A/B ledger: ${fn} threw`, { error: e && e.message }, 'error');
    return { outcome: 'failed', error: e && e.message };
  }
}

const advance = ({ writer = defaultWriter } = {}) => callRpc('ab_ledger_advance', 'advanced', writer);
const flip = ({ writer = defaultWriter } = {}) => callRpc('ab_ledger_switch', 'switched', writer);

module.exports = { advance, flip };
