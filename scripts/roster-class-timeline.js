#!/usr/bin/env node
'use strict';
/**
 * roster-class-timeline — one class's history from the ledger: who, when, what, from what.
 *
 *   node scripts/roster-class-timeline.js <class uuid>            # oldest first
 *   node scripts/roster-class-timeline.js <class uuid> --json     # raw rows
 *
 * Reads `roster_class_timeline(uuid)` (bot/database/migrations/row_history_actor.sql)
 * through the bot's own Supabase client, so it runs against whatever SUPABASE_URL the
 * .env names. READ-ONLY. The project ref is printed first so a wrong .env is visible
 * before the first row is (the worktree tooling seeds .env from the MAIN bot).
 *
 * What a row means:
 *   actor      a users.id when the write was made for a coach (name + role resolved);
 *              'authenticator' for a bot write made before bd-a21ks; 'postgres' for SQL.
 *   txid       rows sharing one txid were ONE transaction — a merge is the class going
 *              is_active false and N enrolments changing class_id under one txid.
 *   subject    the child / teacher / list owner the row is about, resolved live.
 */
const KNOWN = {
  ihzciabopbttygxxgrkm: 'NIETE prod',
  olvritwoqujtjvwfulbh: 'NIETE sandbox',
};

function fmt(v) {
  if (v === null || v === undefined) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

async function main() {
  const [classId, ...flags] = process.argv.slice(2);
  if (!classId || !/^[0-9a-f-]{36}$/i.test(classId)) {
    console.error('usage: node scripts/roster-class-timeline.js <class uuid> [--json]');
    process.exit(2);
  }
  const ref = (/https:\/\/([a-z0-9]+)\.supabase\.co/.exec(process.env.SUPABASE_URL || '') || [])[1];
  console.error(`project: ${ref || 'unknown'} (${KNOWN[ref] || 'NOT a NIETE project — check .env'})`);

  const supabase = require('../bot/shared/config/supabase');
  const { data, error } = await supabase.rpc('roster_class_timeline', { p_class_id: classId });
  if (error) {
    console.error('roster_class_timeline failed:', error.message);
    process.exit(1);
  }
  if (flags.includes('--json')) {
    process.stdout.write(JSON.stringify(data, null, 1) + '\n');
    return;
  }
  if (!data || !data.length) {
    console.log('no ledger rows for that class');
    return;
  }
  for (const r of data) {
    const who = r.actor_name ? `${r.actor_name} (${r.actor_role || '?'})` : r.actor;
    const change = r.op === 'UPDATE'
      ? `${fmt(r.old_vals)} -> ${fmt(r.new_vals)}`
      : (r.op === 'INSERT' ? fmt(r.new_vals) : `deleted ${fmt(r.old_vals)}`);
    console.log([
      String(r.changed_at).slice(0, 19).replace('T', ' '),
      `txid=${r.txid}`,
      r.table_name.padEnd(18),
      r.op.padEnd(6),
      who,
      r.subject ? `· ${r.subject}` : '',
      `· ${r.changed_cols.join(',')}`,
      change,
    ].filter(Boolean).join('  '));
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
