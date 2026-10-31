#!/usr/bin/env node
/**
 * load-analytics-lists — write the three lists the schools analytics counts against (PLAN v8, FDE feedback
 * 2026-10-19) into app_settings, where dashboard/lib/analytics-lists.js reads them:
 *
 *   analytics_fde_schools   FDE's programme list: every EMIS on the primary OR the middle/high list.
 *                           Source: a snapshot of BigQuery taleemabad_governance.school_programme
 *                           (is_programme_school), exported through the governed taleemabad-data MCP.
 *   analytics_rdf_teachers  the RDF's two teacher populations, users.id → sector, exactly as the RDF defines them:
 *                             Primary (rdf_niete/render.py primary_scope, n_primary_sectored): role 'teacher',
 *                               teacher_level holds PRIMARY, phone on the allocation file (tphone2sect) in one of
 *                               the six sectors. No test or deleted filter (the RDF has none).
 *                             6-12 (rdf_niete612/metrics.py cohort): role 'teacher', not deleted, phone not on the
 *                               coach roster, teacher_level holds MIDDLE or HIGH, phone on the allocation file in
 *                               one of the six sectors.
 *                           The sector is the allocation file's. A phone is normalised as the RDF's norm() does.
 *                           Also sectorByUser: EVERY user whose phone is on the allocation file in the six sectors,
 *                           any role (the RDF's uid2sect) — so a number over principals too can be placed in a sector.
 *   analytics_rdf_coaches   the RDF's declared coach roster (alloc coachph2name + coachph2sector): one entry per
 *                           name, its sector, and the users.id on its phones.
 *
 * NO PHONE IS WRITTEN. Phones are matched in memory, here, and only ids, sectors and roster names leave.
 *
 *   node scripts/load-analytics-lists.js --env sandbox --schools <fde_snapshot.json> --alloc <alloc_real.json> [--env-file <path>]
 *   … --as-of YYYY-MM-DD  the teachers' snapshot date (default today); --roster-as-of YYYY-MM-DD the coach roster's
 *   … --commit        actually write (dry run by default: counts only)
 *   … --force         write even when a list SHRANK by more than 20% against the stored row (never an empty one)
 *
 * IT REFUSES, BEFORE ANY WRITE (exit 1), dry run included:
 *   - an EMPTY list: 0 EMIS, no Primary or no 6-12 teacher, no sectorByUser entry, or no coach on the roster —
 *     a malformed source (a snapshot without by_sector, an allocation file without tphone2sect or coachph2name,
 *     a users read that came back empty) builds empty lists, and writing them would blank every tab. --force
 *     does not override this.
 *   - with --commit, a list whose count DROPPED by more than 20% against the row stored now, unless --force:
 *     the lists move slowly (a snapshot, a vetted allocation file), so a large drop is a broken input first.
 *   --env is required (sandbox | staging | prod); the SUPABASE_URL it loads must name that environment's project,
 *   checked before a client exists (the create-analytics-user.js pattern).
 */
const fs = require('fs');
const path = require('path');

// FDE's six sectors — THE copy in dashboard/lib/analytics-lists (bd-97daxo.3); the lists name these only.
const { SECTORS } = require('../dashboard/lib/analytics-lists');

const KEYS = Object.freeze({
  schools: 'analytics_fde_schools',
  teachers: 'analytics_rdf_teachers',
  coaches: 'analytics_rdf_coaches',
});

const DESCRIPTIONS = Object.freeze({
  schools: "Schools analytics v8: FDE's programme list (EMIS, primary OR middle/high list) — the school base of every tab. {asOf, source, emis[]}. Written by scripts/load-analytics-lists.js.",
  teachers: "Schools analytics v8: the RDF's teacher populations, users.id by RDF sector — Primary (n_primary_sectored) and 6-12 (the ict-6to12 cohort). {asOf, source, primary{sector:[id]}, midHigh{sector:[id]}}. No phones. Written by scripts/load-analytics-lists.js.",
  coaches: "Schools analytics v8: the RDF's declared ICT coach roster. {asOf, source, coaches[{name, sector, userIds}]}. No phones. Written by scripts/load-analytics-lists.js.",
});

const ENVS = Object.freeze({
  sandbox: { file: '.env.sandbox', ref: 'olvritwoqujtjvwfulbh' },
  staging: { file: '.env.stage', ref: 'rpqkekcfvumypldbejhp' },
  prod: { file: '.env.prod', ref: 'ihzciabopbttygxxgrkm' },
});

// ── pure logic (unit-tested; no I/O) ─────────────────────────────────────────

/** The RDF's norm() (rdf_niete/render.py): digits; a leading 0 → 92, a leading 3 → 923…; at most 12 digits. */
function norm(p) {
  const d = String(p == null ? '' : p).replace(/\D/g, '');
  if (!d) return null;
  return (d[0] === '0' ? `92${d.slice(1)}` : d[0] === '3' ? `92${d}` : d).slice(0, 12);
}

const levels = (u) => (Array.isArray(u.teacher_level) ? u.teacher_level.map((x) => String(x).toUpperCase()) : []);

function bySector(pairs) {
  const out = {};
  for (const [id, s] of pairs) (out[s] = out[s] || []).push(id);
  for (const s of Object.keys(out)) out[s].sort();
  return out;
}

/**
 * The RDF's two teacher populations from the users rows and the allocation file.
 * @returns {{primary: Object<string, string[]>, midHigh: Object<string, string[]>}}
 */
function buildTeacherLists(users, alloc) {
  const t2s = (alloc && alloc.tphone2sect) || {};
  const coachPhones = new Set(Object.keys((alloc && alloc.coachph2name) || {}).map(norm));
  const sectorOf = (u) => {
    const s = t2s[norm(u.phone_number)];
    return SECTORS.includes(s) ? s : null;
  };
  const primary = [];
  const midHigh = [];
  const all = [];
  for (const u of users || []) {
    if (!u) continue;
    const s = sectorOf(u);
    if (!s) continue;
    all.push([u.id, s]);
    if (u.role !== 'teacher') continue;
    const lv = levels(u);
    if (lv.includes('PRIMARY')) primary.push([u.id, s]);
    if (!u.deleted_at && !coachPhones.has(norm(u.phone_number)) && (lv.includes('MIDDLE') || lv.includes('HIGH'))) {
      midHigh.push([u.id, s]);
    }
  }
  return { primary: bySector(primary), midHigh: bySector(midHigh), sectorByUser: bySector(all) };
}

/** The coach roster: one entry per name (a coach with two SIMs is one), its declared sector, its users. */
function buildCoachList(users, alloc) {
  const c2n = (alloc && alloc.coachph2name) || {};
  const c2s = (alloc && alloc.coachph2sector) || {};
  const idsByPhone = new Map();
  for (const u of users || []) {
    const p = u && norm(u.phone_number);
    if (!p) continue;
    if (!idsByPhone.has(p)) idsByPhone.set(p, []);
    idsByPhone.get(p).push(u.id);
  }
  const byName = new Map();
  for (const [phone, rawName] of Object.entries(c2n)) {
    const name = String(rawName || '').trim().replace(/\s+/g, ' ');
    if (!name) continue;
    const key = name.toLowerCase();
    if (!byName.has(key)) byName.set(key, { name, sector: null, userIds: new Set() });
    const e = byName.get(key);
    const s = c2s[phone];
    if (!e.sector && SECTORS.includes(s)) e.sector = s;
    for (const id of idsByPhone.get(norm(phone)) || []) e.userIds.add(id);
  }
  return [...byName.values()]
    .filter((e) => e.sector)
    .map((e) => ({ name: e.name, sector: e.sector, userIds: [...e.userIds].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

/** The governed snapshot (workbench v8-lists/fde_programme_schools_*.json) → the EMIS list. */
function buildSchoolList(snapshot) {
  const by = (snapshot && snapshot.by_sector) || {};
  const seen = new Set();
  const emis = [];
  const counts = {};
  for (const [sector, list] of Object.entries(by)) {
    if (!SECTORS.includes(sector)) throw new Error(`snapshot names a sector outside the six: ${sector}`);
    for (const e of list) {
      const v = String(e).trim();
      if (seen.has(v)) throw new Error(`EMIS ${v} is on the snapshot twice`);
      seen.add(v);
      emis.push(v);
    }
    counts[sector] = list.length;
  }
  return { emis, bySector: counts, asOf: (snapshot && (snapshot._as_of || snapshot.asOf)) || null };
}

const SOURCES = Object.freeze({
  schools: "BigQuery taleemabad_governance.school_programme (is_programme_school), governed taleemabad-data MCP export",
  teachers: 'RDF allocation file alloc_real.json tphone2sect; Primary = rdf_niete render.py primary_scope (n_primary_sectored); 6-12 = rdf_niete612 metrics.py cohort',
  coaches: 'RDF allocation file alloc_real.json coachph2name + coachph2sector',
});

const schoolsValue = (s, asOf) => ({ asOf, source: SOURCES.schools, emis: s.emis });
const teachersValue = (t, asOf) => ({ asOf, source: SOURCES.teachers, primary: t.primary, midHigh: t.midHigh, sectorByUser: t.sectorByUser });
const coachesValue = (c, asOf) => ({ asOf, source: SOURCES.coaches, coaches: c });

/** Abort before any client exists if SUPABASE_URL names a different project. */
function assertProjectRef(supabaseUrl, expectedRef) {
  const m = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(String(supabaseUrl || ''));
  if (!m) throw new Error('ABORT: could not read a project ref out of SUPABASE_URL');
  if (m[1] !== expectedRef) {
    throw new Error(`ABORT: SUPABASE_URL points at project '${m[1]}', not the expected '${expectedRef}'. `
      + 'Refusing to touch an unintended database.');
  }
  return m[1];
}

function parseArgs(argv) {
  const flag = (n) => argv.includes(`--${n}`);
  const val = (n) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  };
  return {
    env: val('env'),
    envFile: val('env-file'),
    schools: val('schools'),
    alloc: val('alloc'),
    asOf: val('as-of'),
    rosterAsOf: val('roster-as-of'),
    commit: flag('commit'),
    force: flag('force'),
  };
}

const total = (o) => Object.values(o || {}).reduce((n, a) => n + (Array.isArray(a) ? a.length : 0), 0);

/** The size of each list in a set of app_settings values — what the empty and drop checks compare. */
function listCounts(values = {}) {
  const t = values.teachers || {};
  return {
    'FDE school list (EMIS)': Array.isArray(values.schools && values.schools.emis) ? values.schools.emis.length : 0,
    'RDF Primary teachers': total(t.primary),
    'RDF 6-12 teachers': total(t.midHigh),
    'RDF sectorByUser': total(t.sectorByUser),
    'RDF coach roster': Array.isArray(values.coaches && values.coaches.coaches) ? values.coaches.coaches.length : 0,
  };
}

/** Every list that came out EMPTY — never written, whatever the flags. PURE. */
function emptyLists(values) {
  return Object.entries(listCounts(values)).filter(([, n]) => n === 0)
    .map(([name]) => `${name} is empty (0) — the source is malformed or unreadable`);
}

/**
 * Every list that SHRANK by more than `maxDrop` against what is stored now (a list not stored yet, or stored
 * empty, has nothing to compare with). PURE.
 * @param {object} values the new values · @param {object} stored the stored values by the same keys
 */
function droppedLists(values, stored, maxDrop = 0.2) {
  const now = listCounts(values);
  const was = listCounts(stored);
  return Object.keys(now).filter((k) => was[k] > 0 && now[k] < was[k] * (1 - maxDrop))
    .map((k) => `${k} dropped from ${was[k]} to ${now[k]} (more than ${Math.round(maxDrop * 100)}%)`);
}
const perSector = (o) => SECTORS.map((s) => `${s} ${(o[s] || []).length}`).join(' · ');

// ── I/O ──────────────────────────────────────────────────────────────────────

async function readUsers(supabase) {
  const { fetchAllPaged } = require('../dashboard/lib/fetch-all-paged');
  return fetchAllPaged(() => supabase
    .from('users')
    .select('id, phone_number, role, teacher_level, deleted_at')
    .order('id', { ascending: true }));
}

async function run({ supabase, snapshot, alloc, asOf, rosterAsOf, commit, force = false, log = console.log }) {
  const schools = buildSchoolList(snapshot);
  const users = await readUsers(supabase);
  const teachers = buildTeacherLists(users, alloc);
  const coaches = buildCoachList(users, alloc);

  const day = asOf || new Date().toISOString().slice(0, 10);
  const values = {
    schools: schoolsValue(schools, schools.asOf || day),
    teachers: teachersValue(teachers, day),
    coaches: coachesValue(coaches, rosterAsOf || day),
  };

  // An empty list is never written, dry run or not, --force or not.
  const empty = emptyLists(values);
  if (empty.length) {
    throw new Error(`REFUSED (nothing written): ${empty.join('; ')}. Users read: ${users.length}. `
      + 'Check --schools (needs by_sector) and --alloc (needs tphone2sect, coachph2name, coachph2sector).');
  }

  // Against what is stored now: a list that shrank by more than 20% is a broken input until shown otherwise.
  const { data: storedRows, error: stErr } = await supabase.from('app_settings').select('key, value').in('key', Object.values(KEYS));
  if (stErr) throw new Error(`app_settings read failed: ${stErr.message}`);
  const byKey = new Map((storedRows || []).map((r) => [r.key, r.value]));
  const stored = { schools: byKey.get(KEYS.schools), teachers: byKey.get(KEYS.teachers), coaches: byKey.get(KEYS.coaches) };
  const dropped = droppedLists(values, stored);

  // Which listed EMIS this database has a school for (a list the DB cannot match is read as missing).
  const { data: schoolRows, error: sErr } = await supabase.from('schools').select('emis, region').in('emis', schools.emis);
  if (sErr) throw new Error(`schools read failed: ${sErr.message}`);
  const matched = new Set((schoolRows || []).map((r) => String(r.emis)));

  log(`  users read: ${users.length}`);
  log(`  ${KEYS.schools}: ${schools.emis.length} EMIS (${SECTORS.map((s) => `${s} ${schools.bySector[s] || 0}`).join(' · ')}); `
    + `${matched.size} match a school in this database`);
  log(`  ${KEYS.teachers}: Primary ${total(teachers.primary)} (${perSector(teachers.primary)})`);
  log(`  ${' '.repeat(KEYS.teachers.length)}  6-12   ${total(teachers.midHigh)} (${perSector(teachers.midHigh)})`);
  log(`  ${' '.repeat(KEYS.teachers.length)}  sectorByUser (any role) ${total(teachers.sectorByUser)} (${perSector(teachers.sectorByUser)})`);
  const withUser = coaches.filter((c) => c.userIds.length).length;
  log(`  ${KEYS.coaches}: ${coaches.length} names (${SECTORS.map((s) => `${s} ${coaches.filter((c) => c.sector === s).length}`).join(' · ')}); `
    + `${withUser} matched to a user, ${coaches.reduce((n, c) => n + c.userIds.length, 0)} user ids`);

  for (const d of dropped) log(`  ${force ? 'FORCED' : 'WARNING'}: ${d} against the stored row`);
  if (!commit) {
    log(`\n  DRY RUN — nothing written. Re-run with --commit to write the three app_settings rows${dropped.length && !force ? ' (refused unless --force: see the warnings)' : ''}.`);
    return { committed: false, values, matchedSchools: matched.size, dropped };
  }
  if (dropped.length && !force) {
    throw new Error(`REFUSED (nothing written): ${dropped.join('; ')}. Pass --force if that is right.`);
  }
  const now = new Date().toISOString();
  const rows = Object.keys(KEYS).map((k) => ({ key: KEYS[k], value: values[k], description: DESCRIPTIONS[k], updated_at: now }));
  const { error } = await supabase.from('app_settings').upsert(rows, { onConflict: 'key' });
  if (error) throw new Error(`app_settings write failed: ${error.message}`);
  log(`\n  WROTE ${rows.map((r) => r.key).join(', ')}`);
  return { committed: true, values, matchedSchools: matched.size };
}

function main() {
  const die = (msg) => { console.error(`\n  ${msg}\n`); process.exit(2); };
  const args = parseArgs(process.argv.slice(2));
  if (!args.env || !ENVS[args.env]) {
    die(`--env is REQUIRED and must be one of: ${Object.keys(ENVS).join(', ')} (no default)`);
  }
  if (!args.schools || !args.alloc) die('--schools <snapshot.json> and --alloc <alloc_real.json> are required');
  const target = ENVS[args.env];
  const envPath = path.resolve(args.envFile || path.resolve(__dirname, '..', target.file));
  if (!fs.existsSync(envPath)) die(`missing ${envPath} — cannot resolve credentials for '${args.env}'`);
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#') || !s.includes('=')) continue;
    const i = s.indexOf('=');
    process.env[s.slice(0, i)] = s.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  let ref;
  try { ref = assertProjectRef(process.env.SUPABASE_URL, target.ref); } catch (e) { die(e.message); }

  const snapshot = JSON.parse(fs.readFileSync(args.schools, 'utf8'));
  const alloc = JSON.parse(fs.readFileSync(args.alloc, 'utf8'));
  // A client of its own over the env just asserted (no dotenv, no bot install needed): the dashboard's supabase-js.
  const { createClient } = require('../dashboard/node_modules/@supabase/supabase-js');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) die('SUPABASE_SERVICE_ROLE_KEY is not set in the env file');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  console.log(`\n  env=${args.env} ref=${ref} commit=${args.commit}`);
  run({ supabase, snapshot, alloc, asOf: args.asOf, rosterAsOf: args.rosterAsOf, commit: args.commit, force: args.force })
    .catch((e) => { console.error(`\n  ${e.message}\n`); process.exit(1); });
}

if (require.main === module) main();

module.exports = {
  SECTORS,
  KEYS,
  norm,
  buildTeacherLists,
  buildCoachList,
  buildSchoolList,
  schoolsValue,
  teachersValue,
  coachesValue,
  assertProjectRef,
  parseArgs,
  listCounts,
  emptyLists,
  droppedLists,
  run,
};
