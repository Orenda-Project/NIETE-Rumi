#!/usr/bin/env node
/**
 * create-analytics-user — make (or reuse) an analytics-only portal account: someone who
 * signs in to the portal and sees the schools analytics page and nothing else.
 *
 *   node scripts/create-analytics-user.js --env prod --name fde-islamabad --display "FDE Islamabad"
 *   node scripts/create-analytics-user.js --env sandbox --phone 03001234567 --display "Analytics Test"
 *   … --commit                                                         # actually write
 *   … --env-file <path>                                                # credentials elsewhere
 *   … --name fde-islamabad --reset-password [--commit]                 # a new setup link (see below)
 *
 * TWO WAYS TO SIGN IN (bd-s6qbts.5)
 * ---------------------------------
 *   --name <account>  the account signs in with that NAME instead of a phone. users.phone_number holds the
 *                     reserved, non-numeric 'analytics:<account>' (dashboard/lib/analytics-account-name.js):
 *                     no teacher can hold it and WhatsApp cannot reach it. The name is lower-cased and must
 *                     match ^[a-z][a-z0-9_-]{2,39}$ with at most 6 digits — exactly what the login accepts.
 *   --phone <number>  as before: a real Pakistani mobile number.
 *   --display <label> the name the portal greets the account by (users.name). With --phone, --name is still
 *                     read as the label when --display is absent (the old usage).
 *
 * WHAT IT DOES (with --commit)
 * ----------------------------
 *   1. users row: 'analytics:<account>' or the phone (the canonical 92XXXXXXXXXX form portal login
 *      looks up), name, role 'unregistered', no school. An existing role-less / unregistered row
 *      with no school is REUSED, not duplicated (its name is filled in only if it has none).
 *   2. Appends that users.id to app_settings.portal_analytics_only (creating the row if it
 *      is absent). Every id already there stays.
 *   3. Mints a setup link with PortalInviteService.generatePortalToken — the no-message
 *      path, so nothing is sent on WhatsApp — and prints <PORTAL_URL>/portal/setup/<token>.
 *
 * --reset-password (account names only)
 * -------------------------------------
 *   An account name has no WhatsApp, so "Forgot password" cannot reach it, and the setup link never overwrites a
 *   password that exists. This clears the account's password and activation (it cannot sign in until the new link
 *   is used) and mints a fresh setup link. Refused unless the account exists AND is on portal_analytics_only. A
 *   teacher resets her own password on WhatsApp, so a phone is refused here.
 *
 * WHAT IT REFUSES
 * ---------------
 *   - a phone that belongs to a teacher, principal or coach, or to anyone attached to a
 *     school: on the list, that person would be locked out of her own portal;
 *   - a portal_analytics_only value that is not a list of ids (true, "teachers", …): that
 *     is somebody's deliberate broadcast, and appending to it would silently rewrite it;
 *   - any write before the target project is confirmed: --env is required, and the
 *     SUPABASE_URL it loads must name that environment's project, checked before a client
 *     exists.
 *
 * The account is written with registration_completed left NULL. The admin broadcast's
 * "all users" cohort is registration_completed = true, and it is the only automatic send
 * that selects users with no activity of their own — so this keeps the account out of it.
 */
const fs = require('fs');
const path = require('path');
// The same rules the login applies, so the script cannot make an account the login would refuse.
const { normaliseAccountName, storedPhoneFor } = require('../dashboard/lib/analytics-account-name');

const ANALYTICS_FLAG_KEY = 'portal_analytics_only';
const ANALYTICS_FLAG_DESCRIPTION =
  'Accounts that see ONLY the portal schools analytics page. JSON array of users.id; any other value means nobody.';

/** Columns the account is written with beyond phone, name, role and school. */
const ANALYTICS_ACCOUNT_DEFAULTS = Object.freeze({
  registration_completed: null,
  preferred_language: 'en',
});

const ENVS = Object.freeze({
  sandbox: { file: '.env.sandbox', ref: 'olvritwoqujtjvwfulbh' },
  staging: { file: '.env.stage', ref: 'rpqkekcfvumypldbejhp' },
  prod: { file: '.env.prod', ref: 'ihzciabopbttygxxgrkm' },
});

// ── pure logic (unit-tested; no I/O) ─────────────────────────────────────────

/**
 * The portal login's own canonical form (sanitizePhoneNumber in portal.routes.js),
 * then held to a Pakistani mobile number: 92 + 10 digits. Anything else is null.
 */
function normalisePkPhone(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length === 11) digits = `92${digits.slice(1)}`;
  else if (digits.startsWith('3') && digits.length === 10) digits = `92${digits}`;
  return /^923\d{9}$/.test(digits) ? digits : null;
}

/** Abort before any client exists if SUPABASE_URL names a different project. */
function assertProjectRef(supabaseUrl, expectedRef) {
  const m = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(String(supabaseUrl || ''));
  if (!m) throw new Error('ABORT: could not read a project ref out of SUPABASE_URL');
  if (m[1] !== expectedRef) {
    throw new Error(
      `ABORT: SUPABASE_URL points at project '${m[1]}', not the expected '${expectedRef}'. ` +
      'Refusing to write to an unintended database.'
    );
  }
  return m[1];
}

/**
 * Append `id` to the flag's value. Absent → [id]. A list → the list plus id (unchanged if
 * already there). Anything else throws: it is not ours to rewrite.
 * @returns {{ids: string[], changed: boolean}}
 */
function appendUserId(value, id) {
  let v = value;
  if (v === undefined || v === null) return { ids: [id], changed: true };
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { /* falls to the refusal below */ }
  }
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    throw new Error(
      `REFUSED: app_settings.${ANALYTICS_FLAG_KEY} is not a list of user ids (${JSON.stringify(value)}). ` +
      'Fix it by hand; this script will not overwrite it.'
    );
  }
  if (v.includes(id)) return { ids: v, changed: false };
  return { ids: [...v, id], changed: true };
}

const WORKING_ROLES = new Set(['teacher', 'principal', 'coach']);

/**
 * What to do with the users row (if any) that already holds this phone.
 * @returns {{action: 'create'|'reuse'|'refuse', reason: string}}
 */
function planAccount(existing) {
  if (!existing) return { action: 'create', reason: 'no account holds this phone' };
  const role = typeof existing.role === 'string' ? existing.role.trim().toLowerCase() : null;
  if (role && WORKING_ROLES.has(role)) {
    return { action: 'refuse', reason: `this phone belongs to a ${role}; making it analytics-only would lock them out of their portal` };
  }
  if (existing.school_id) {
    return { action: 'refuse', reason: 'this phone belongs to an account attached to a school' };
  }
  return { action: 'reuse', reason: `existing ${role || 'role-less'} account with no school` };
}

/**
 * Which users.phone_number this run is about: 'analytics:<name>' for an account name, the canonical 92… form for a
 * phone. Exactly one of the two. Throws REFUSED otherwise.
 * @returns {{stored: string, signInAs: string}}
 */
function resolveIdentity({ phone, account }) {
  const hasPhone = phone !== undefined && phone !== null && phone !== '';
  const hasAccount = account !== undefined && account !== null;
  if (hasPhone && hasAccount) throw new Error('REFUSED: give an account name (--name) OR a phone (--phone), not both');
  if (hasAccount) {
    const name = normaliseAccountName(account);
    if (!name) {
      throw new Error(`REFUSED: "${account}" is not an account name — lower-case letters, digits and hyphens, ` +
        'starting with a letter, 3 to 40 characters, at most 6 digits (e.g. fde-islamabad)');
    }
    return { stored: storedPhoneFor(name), signInAs: name };
  }
  if (!hasPhone) throw new Error('REFUSED: --name <account> or --phone <number> is required');
  const e164 = normalisePkPhone(phone);
  if (!e164) throw new Error(`REFUSED: "${phone}" is not a Pakistani mobile phone number`);
  return { stored: e164, signInAs: e164 };
}

/**
 * The whole flow, with its dependencies passed in.
 * @param {{supabase: object, invite: {generatePortalToken: Function}, phone?: string, account?: string,
 *          name?: string, resetPassword?: boolean, commit: boolean, portalUrl: string, log?: Function}} args
 *   `account` is the sign-in name (--name); `name` is the label the portal greets it by (users.name, --display).
 */
async function run({
  supabase, invite, phone, account, name, resetPassword = false, commit, portalUrl, log = console.log,
}) {
  const { stored, signInAs } = resolveIdentity({ phone, account });
  if (resetPassword) {
    if (!stored.startsWith('analytics:')) {
      throw new Error('REFUSED: --reset-password is for account names only; a phone resets its password on WhatsApp');
    }
    return resetAccountPassword({ supabase, invite, stored, signInAs, commit, portalUrl, log });
  }
  const displayName = String(name || '').trim();
  if (!displayName) throw new Error('REFUSED: --display (the name the portal greets the account by) is required');

  const { data: existing, error: userErr } = await supabase
    .from('users')
    .select('id, role, name, school_id, phone_number')
    .eq('phone_number', stored)
    .maybeSingle();
  if (userErr) throw new Error(`user lookup failed: ${userErr.message}`);

  const plan = planAccount(existing);
  log(`  ${stored} → ${plan.action}: ${plan.reason}`);
  if (plan.action === 'refuse') throw new Error(`REFUSED: ${plan.reason}`);

  const { data: flagRow, error: flagErr } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', ANALYTICS_FLAG_KEY)
    .maybeSingle();
  if (flagErr) throw new Error(`app_settings read failed: ${flagErr.message}`);
  const current = flagRow ? flagRow.value : undefined;
  // Validate the flag BEFORE any write, so a refusal leaves nothing half-done.
  appendUserId(current, existing ? existing.id : '__pending__');

  if (!commit) {
    log('  DRY RUN — nothing written, no link minted. Re-run with --commit.');
    return { plan, committed: false, userId: existing ? existing.id : null, setupUrl: null, signInAs };
  }

  let userId = existing && existing.id;
  if (plan.action === 'create') {
    const { data: created, error: insErr } = await supabase
      .from('users')
      .insert({
        phone_number: stored,
        name: displayName,
        role: 'unregistered',
        school_id: null,
        ...ANALYTICS_ACCOUNT_DEFAULTS,
      })
      .select('id')
      .single();
    if (insErr || !created) throw new Error(`user insert failed: ${insErr ? insErr.message : 'no row'}`);
    userId = created.id;
    log(`  created users row ${userId}`);
  } else {
    log(`  reusing users row ${userId}`);
    // A nameless row would greet the official with a blank; a named one is not ours to rename.
    if (!String(existing.name || '').trim()) {
      const { error: nameErr } = await supabase.from('users').update({ name: displayName }).eq('id', userId);
      if (nameErr) throw new Error(`name update failed: ${nameErr.message}`);
      log(`  set its name to "${displayName}"`);
    }
  }

  const { ids, changed } = appendUserId(current, userId);
  if (changed) {
    const { error: upErr } = await supabase
      .from('app_settings')
      .upsert({
        key: ANALYTICS_FLAG_KEY,
        value: ids,
        description: ANALYTICS_FLAG_DESCRIPTION,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    if (upErr) throw new Error(`app_settings write failed: ${upErr.message}`);
    log(`  ${ANALYTICS_FLAG_KEY} now lists ${ids.length} account(s)`);
  } else {
    log(`  already on ${ANALYTICS_FLAG_KEY} (${ids.length} account(s)) — unchanged`);
  }

  const setupUrl = await mintSetupUrl(invite, userId, portalUrl);
  return { plan, committed: true, userId, setupUrl, signInAs };
}

async function mintSetupUrl(invite, userId, portalUrl) {
  const minted = await invite.generatePortalToken(userId);
  if (!minted || !minted.success || !minted.token) {
    throw new Error(`setup token was not minted: ${(minted && minted.error) || 'unknown error'}`);
  }
  return `${String(portalUrl || '').replace(/\/+$/, '')}/portal/setup/${minted.token}`;
}

/**
 * --reset-password: the account must exist and be on the list. Clears its password and activation — the setup link
 * refuses an account that already has both, by design — then mints a fresh link. Nothing else about the row moves.
 */
async function resetAccountPassword({ supabase, invite, stored, signInAs, commit, portalUrl, log }) {
  const { data: existing, error: userErr } = await supabase
    .from('users')
    .select('id, role, name, school_id, phone_number')
    .eq('phone_number', stored)
    .maybeSingle();
  if (userErr) throw new Error(`user lookup failed: ${userErr.message}`);
  if (!existing) throw new Error(`REFUSED: no account signs in as "${signInAs}"`);

  const { data: flagRow, error: flagErr } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', ANALYTICS_FLAG_KEY)
    .maybeSingle();
  if (flagErr) throw new Error(`app_settings read failed: ${flagErr.message}`);
  const { changed } = appendUserId(flagRow ? flagRow.value : undefined, existing.id);
  if (changed) throw new Error(`REFUSED: "${signInAs}" is not on ${ANALYTICS_FLAG_KEY}; this resets analytics accounts only`);

  const plan = { action: 'reset-password', reason: `clear the password of ${existing.id} and mint a new setup link` };
  log(`  ${stored} → ${plan.action}: ${plan.reason}`);
  if (!commit) {
    log('  DRY RUN — nothing written, no link minted. Re-run with --commit.');
    return { plan, committed: false, userId: existing.id, setupUrl: null, signInAs };
  }

  const { error: upErr } = await supabase
    .from('users')
    .update({ portal_password_hash: null, portal_activated: false })
    .eq('id', existing.id);
  if (upErr) throw new Error(`password reset failed: ${upErr.message}`);
  log('  password cleared — the account cannot sign in until the new link is used');

  const setupUrl = await mintSetupUrl(invite, existing.id, portalUrl);
  return { plan, committed: true, userId: existing.id, setupUrl, signInAs };
}

/**
 * The command line, read. --name is the account name unless --phone is given, when (the old usage) it is the label
 * and --display is absent. Throws REFUSED on the one ambiguous mix: --phone, --name AND --display.
 */
function parseArgs(argv) {
  const flag = (n) => argv.includes(`--${n}`);
  const val = (n) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  };
  const phone = val('phone');
  const nameArg = val('name');
  const display = val('display');
  if (phone && nameArg && display) {
    throw new Error('REFUSED: with --phone, give the label as --display; --name is the sign-in name of an account without a phone');
  }
  return {
    env: val('env'),
    envFile: val('env-file'),
    phone,
    account: phone ? null : nameArg,
    name: phone ? (display || nameArg) : display,
    commit: flag('commit'),
    resetPassword: flag('reset-password'),
  };
}

module.exports = {
  ANALYTICS_ACCOUNT_DEFAULTS,
  normalisePkPhone,
  assertProjectRef,
  appendUserId,
  planAccount,
  resolveIdentity,
  parseArgs,
  run,
};

// ── CLI ───────────────────────────────────────────────────────────────────────
// Inside a function, not behind a top-level return (Babel, which jest uses to load this
// file for the unit tests, rejects a top-level return).
function main() {
  const die = (msg) => { console.error(`\n  ${msg}\n`); process.exit(2); };
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) { die(e.message); }

  const envName = args.env;
  if (!envName || !ENVS[envName]) {
    die(`--env is REQUIRED and must be one of: ${Object.keys(ENVS).join(', ')} ` +
        '(no default: an implicit target is how the wrong database gets written)');
  }
  const target = ENVS[envName];
  const envPath = path.resolve(args.envFile || path.resolve(__dirname, '..', target.file));
  if (!fs.existsSync(envPath)) die(`missing ${envPath} — cannot resolve credentials for '${envName}'`);
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#') || !s.includes('=')) continue;
    const i = s.indexOf('=');
    process.env[s.slice(0, i)] = s.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }

  // Guard the target BEFORE any client is constructed.
  let ref;
  try { ref = assertProjectRef(process.env.SUPABASE_URL, target.ref); } catch (e) { die(e.message); }

  const supabase = require('../bot/shared/config/supabase');
  const invite = require('../bot/shared/services/portal-invite.service');
  const { portalUrl } = require('../bot/shared/config/branding');

  const { commit } = args;
  console.log(`\n  env=${envName} ref=${ref} commit=${commit}${args.resetPassword ? ' reset-password' : ''}`);
  run({
    supabase, invite, phone: args.phone, account: args.account, name: args.name,
    resetPassword: args.resetPassword, commit, portalUrl: portalUrl(),
  }).then((out) => {
    if (out.committed) {
      console.log(`\n  user id:   ${out.userId}`);
      console.log(`  signs in as: ${out.signInAs}`);
      console.log(`  setup URL: ${out.setupUrl}   (single use, expires in 7 days)\n`);
    }
  }).catch((e) => { console.error(`\n  ${e.message}\n`); process.exit(1); });
}

if (require.main === module) main();
