'use strict';
/**
 * After a teacher's number moves, the accounts retired into hers follow it.
 *
 * The governed analytics (ict_account_merges) credit a retired account's activity to whoever is live on its LATEST
 * edit_phone row's to_phone: they follow the number, not the account. A move that leaves those rows on her old number
 * credits her retired accounts to nobody, or to whoever takes the old number next. So every flow that moves a number
 * (the coach edit, WhatsApp's own number change, an "Is this you?" claim, /observe's edit) calls repointRetired right
 * after its own edit_phone row, with its own audit writer: for each retired account whose latest row names her and is
 * not on her new number, a newer edit_phone row (case 'repoint') on her new number, in that flow's own words.
 * scripts/merge-duplicate-accounts.py writes the same row when it re-merges a teacher, and its --repoint mode repairs
 * any that are left behind.
 *
 * Behind repoint_retired_on_number_move_enabled (fail closed: off unless written true). Best effort: it runs after the
 * move and its audit row, reads at most READ_LIMIT rows per query (and writes nothing when a read reaches it), logs
 * counts only (never an id or a number), and never throws, so it can never undo or fail a move.
 */
const { logToFile } = require('../../utils/logger');

const READ_LIMIT = 200;
const CHAIN_DEPTH = 5;
const NOT_LIVE = ['merged:', 'retired:', 'analytics:'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The analytics' join key for a number: its last ten ASCII digits; null for none or a freed one (merged:<id>). */
function numberKey(phone) {
  if (phone == null) return null;
  const s = String(phone);
  if (NOT_LIVE.some((p) => s.startsWith(p))) return null;
  const digits = s.replace(/[^0-9]/g, '');
  return digits ? digits.slice(-10) : null;
}

const when = (r) => {
  const t = Date.parse(r && r.created_at);
  return Number.isFinite(t) ? t : -Infinity;
};

/**
 * Where a retired account's history is now: the survivor its latest row names, followed through every account that
 * was itself retired (each one's own latest row), to the first account that is not a known retired one. null when
 * the chain breaks (a retired account with no row of its own) or loops. Ids never come back; numbers do.
 */
function chainEnd(rid, latest, deleted) {
  const seen = new Set([rid]);
  let acct = latest.get(rid) && latest.get(rid).teacher_ext_id;
  while (acct && !seen.has(acct)) {
    if (deleted[acct] !== true) return acct;
    seen.add(acct);
    const next = latest.get(acct);
    if (!next) return null;
    acct = next.teacher_ext_id;
  }
  return null;
}

/**
 * The re-point details for a move of `userId` to `toPhone`, in account-id order: one for each retired account
 * (deleted[id] === true) whose history is hers (its chain of survivors, through retired accounts, ends at her) and whose
 * latest edit_phone row is not on her new number. rows: the edit_phone rows of the candidate accounts, whoever they
 * name; deleted: { account id: true if soft-deleted }. The latest row is chosen here by created_at, then the smaller id
 * (as the merge tool orders them), so the order the rows arrive in does not matter.
 */
function planRepoints({ userId, toPhone, rows, deleted }) {
  const latest = new Map();
  for (const r of rows || []) {
    const rid = r && r.detail && r.detail.retired_user_id;
    if (typeof rid !== 'string' || !rid) continue;
    const cur = latest.get(rid);
    if (!cur || when(r) > when(cur) || (when(r) === when(cur) && String(r.id) < String(cur.id))) latest.set(rid, r);
  }
  const known = deleted || {};
  const to = numberKey(toPhone);
  const out = [];
  for (const rid of [...latest.keys()].sort()) {
    const r = latest.get(rid);
    if (rid === userId || known[rid] !== true || chainEnd(rid, latest, known) !== userId) continue;
    const from = r.detail.to_phone == null ? null : r.detail.to_phone;
    if (to !== null && numberKey(from) === to) continue;
    out.push({ case: 'repoint', retired_user_id: rid, from_phone: from, to_phone: toPhone, supersedes: r.id });
  }
  return out;
}

function log(msg, data, level) {
  try { logToFile(msg, data, level); } catch (_) { /* a broken logger never reaches the move */ }
}

async function read(query, what) {
  const { data, error } = await query;
  if (error) throw new Error(`${what} read refused: ${error.message || 'error'}`);
  const rows = data || [];
  if (rows.length >= READ_LIMIT) throw new Error(`${what}: ${rows.length} rows reach the read limit`);
  return rows;
}

/**
 * Re-point the accounts retired into `userId` after her number moved to `toPhone`. write(detail) is the caller's own
 * edit_phone writer (its via, actor and anything else its rows carry); it answers true when the row was written.
 * Resolves { planned, repointed } (with skipped: 'flag_off' when the switch is off, failed: true when a read or a
 * write failed). Never throws.
 */
async function repointRetired({ userId, toPhone }, write) {
  const none = { planned: 0, repointed: 0 };
  try {
    if (!(await require('../../config/feature-flags').isRepointOnNumberMoveEnabled())) return { ...none, skipped: 'flag_off' };
  } catch (_) {
    return { ...none, skipped: 'flag_off' };
  }
  let planned;
  try {
    const db = require('../../config/supabase');
    // The accounts retired into hers, then those retired into them, level by level (a shell folded into her may have
    // had its own): every account whose chain might end at her. Bounded in depth and by the read limit.
    const found = new Set();
    let frontier = [userId];
    for (let depth = 0; depth < CHAIN_DEPTH && frontier.length; depth += 1) {
      const named = await read(db.from('leader_roster_audit').select('detail')
        .eq('action', 'edit_phone').in('teacher_ext_id', frontier).limit(READ_LIMIT), 'rows naming her accounts');
      frontier = [...new Set(named.map((r) => r && r.detail && r.detail.retired_user_id)
        .filter((id) => typeof id === 'string' && UUID.test(id) && id !== userId && !found.has(id)))];
      frontier.forEach((id) => found.add(id));
      if (found.size >= READ_LIMIT) throw new Error(`${found.size} retired accounts reach the read limit`);
    }
    const ids = [...found];
    if (!ids.length) return none;
    const rows = await read(db.from('leader_roster_audit').select('id, teacher_ext_id, detail, created_at')
      .eq('action', 'edit_phone').in('detail->>retired_user_id', ids).limit(READ_LIMIT), 'their rows');
    const users = await read(db.from('users').select('id, deleted_at').in('id', ids).limit(READ_LIMIT), 'their accounts');
    const deleted = {};
    for (const u of users) deleted[u.id] = u.deleted_at != null;
    planned = planRepoints({ userId, toPhone, rows, deleted });
  } catch (err) {
    log('⚠️ number move: the retired accounts were not re-pointed - the move stands; '
      + 'scripts/merge-duplicate-accounts.py --repoint repairs it', { error: err && err.message }, 'error');
    return { ...none, failed: true };
  }
  let repointed = 0;
  let failed = false;
  for (const detail of planned) {
    try {
      if (await write(detail)) repointed += 1;
    } catch (err) {
      failed = true;
      log('⚠️ number move: a re-point row was not written - the move stands', { error: err && err.message }, 'error');
    }
  }
  if (planned.length) log('number move: retired accounts re-pointed', { planned: planned.length, repointed });
  return failed ? { planned: planned.length, repointed, failed: true } : { planned: planned.length, repointed };
}

module.exports = { repointRetired, planRepoints, numberKey, READ_LIMIT, CHAIN_DEPTH };
