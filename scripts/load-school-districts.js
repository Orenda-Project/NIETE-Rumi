#!/usr/bin/env node
/**
 * load-school-districts — write schools.district (V1.10.2) for one region's schools from a CSV, and nothing else
 * (bd-97daxo.33). The Moawin dashboard splits Gilgit-Baltistan into Gilgit and Baltistan by district
 * (dashboard/config/gb-areas.json); this puts the districts on the schools.
 *
 *   node scripts/load-school-districts.js --env sandbox                                  # dry run: the plan, no write
 *   node scripts/load-school-districts.js --env prod --commit --undo-file <path.json>     # write
 *   node scripts/load-school-districts.js --env prod --undo <path.json> [--commit]        # put the districts back
 *   … --csv <path>       default scripts/data/gb-school-districts.csv (school_name, emis, area, district; no contacts)
 *   … --region <name>    default Gilgit-Baltistan (schools.region, as the region registry spells it)
 *   … --env-file <path>  credentials elsewhere
 *
 * THE PLAN (pure, planDistrictLoad; tests/scripts/load-school-districts.test.js)
 *   Each CSV row is matched to ONE school of the region (schools.region = --region, any activity): by EMIS, else by
 *   name (trimmed, spaces collapsed, any case). The WHOLE load is refused — no write at all — when any row has no
 *   district, names a district the area file does not know or an area that does not hold it, matches no school,
 *   matches a name two schools share, or claims a school another row already claimed; or when a counted school of the
 *   region (active, not a probable test) is in no row. A school whose district is already the CSV's is not written.
 *
 * WHAT IT WRITES (--commit): first the undo file (each school to be written, with its district before), then one
 * UPDATE schools SET district = … WHERE id = … per school. Never schools.region (access and the bot's GB settings read
 * it), never another column, never another region's school. Without --commit nothing is written, not even the undo
 * file. --env is required and the env file's SUPABASE_URL must name that environment's project.
 */
const fs = require('fs');
const path = require('path');

const AREAS = require('../dashboard/config/gb-areas.json');

const ENVS = Object.freeze({
  sandbox: { file: '.env.sandbox', ref: 'olvritwoqujtjvwfulbh' },
  staging: { file: '.env.stage', ref: 'rpqkekcfvumypldbejhp' },
  prod: { file: '.env.prod', ref: 'ihzciabopbttygxxgrkm' },
});
const DEFAULT_CSV = path.resolve(__dirname, 'data', 'gb-school-districts.csv');
const DEFAULT_REGION = 'Gilgit-Baltistan';

const norm = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').toLowerCase() : '');
const clean = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

// ── pure ─────────────────────────────────────────────────────────────────────

/** A small CSV reader: a header row, double-quoted cells may hold commas ("" is a quote), cells trimmed. */
function parseCsv(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const cells = (line) => {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') q = false; else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const [head, ...rest] = lines;
  if (!head) return [];
  const keys = cells(head);
  return rest.map((l) => {
    const c = cells(l);
    return Object.fromEntries(keys.map((k, i) => [k, c[i] === undefined ? '' : c[i]]));
  });
}

/** The area file's districts for one region: district (normalised) → area. */
function areaOfDistrict(region, config = AREAS) {
  const key = Object.keys(config).find((k) => !k.startsWith('_') && norm(k) === norm(region));
  const map = new Map();
  for (const a of (key && config[key]) || []) for (const d of a.districts || []) map.set(norm(d), a.area);
  return map;
}

/**
 * @param {Array<{school_name, emis, area, district}>} rows the CSV
 * @param {Array<{id, name, emis, region, district, is_active, is_probable_test}>} schools every school read
 * @param {{region: string, config?: object}} opts
 * @returns {{updates: object[], unchanged: object[], refused: Array<{row: object, reason: string}>, missing: object[]}}
 */
function planDistrictLoad(rows, schools, { region, config = AREAS } = {}) {
  const ofRegion = (schools || []).filter((s) => s && norm(s.region) === norm(region));
  const byEmis = new Map();
  const byName = new Map();
  for (const s of ofRegion) {
    if (s.emis != null && String(s.emis).trim()) byEmis.set(String(s.emis).trim(), s);
    const k = norm(s.name);
    byName.set(k, [...(byName.get(k) || []), s]);
  }
  const areaOf = areaOfDistrict(region, config);
  const refused = [];
  const updates = [];
  const unchanged = [];
  const claimed = new Set();

  for (const row of rows || []) {
    const district = clean(row.district);
    const area = clean(row.area);
    if (!district) { refused.push({ row, reason: 'no district' }); continue; }
    const known = areaOf.get(norm(district));
    if (!known) { refused.push({ row, reason: `district '${district}' is in no area of dashboard/config/gb-areas.json` }); continue; }
    if (area && norm(area) !== norm(known)) {
      refused.push({ row, reason: `area '${area}' does not hold district '${district}' (gb-areas.json)` });
      continue;
    }
    const emis = clean(row.emis);
    let s = emis ? byEmis.get(emis) : null;
    let by = 'emis';
    if (!s) {
      const named = byName.get(norm(row.school_name)) || [];
      if (named.length > 1) { refused.push({ row, reason: 'more than one school of the region has this name' }); continue; }
      [s] = named;
      by = 'name';
    }
    if (!s) { refused.push({ row, reason: 'no school of the region matches it (EMIS or name)' }); continue; }
    if (claimed.has(s.id)) { refused.push({ row, reason: 'school already matched by another row' }); continue; }
    claimed.add(s.id);
    const from = typeof s.district === 'string' && s.district.trim() ? s.district.trim() : null;
    const entry = { id: s.id, name: s.name, emis: s.emis == null ? null : String(s.emis), from, to: district, area: known, by };
    if (from === district) unchanged.push(entry); else updates.push(entry);
  }

  const missing = ofRegion
    .filter((s) => s.is_active === true && s.is_probable_test !== true && !claimed.has(s.id))
    .map((s) => ({ id: s.id, name: s.name, emis: s.emis == null ? null : String(s.emis) }));
  for (const m of missing) refused.push({ row: null, reason: `a school of the region is in no row: ${m.name}` });

  return { updates: refused.length ? [] : updates, unchanged, refused, missing };
}

// ── the run (I/O through `db`, so it is testable) ───────────────────────────

/**
 * @param {{db: {readSchools: (region) => Promise<object[]>, writeDistrict: (id, district) => Promise<void>},
 *          rows: object[], region: string, commit: boolean, undoFile?: string, log?: Function}} o
 */
async function run({ db, rows, region, commit, undoFile, log = () => {} }) {
  if (commit && !undoFile) throw new Error('--commit needs --undo-file <path>: the districts before are written there first');
  const schools = await db.readSchools(region);
  const plan = planDistrictLoad(rows, schools, { region });
  log(plan);
  if (plan.refused.length) {
    throw new Error(`refused: ${plan.refused.length} row(s) — ${plan.refused.map((r) => r.reason).join('; ')}. Nothing written.`);
  }
  if (!commit) return { committed: false, plan };
  fs.writeFileSync(undoFile, JSON.stringify({
    region, writtenAt: new Date().toISOString(), before: plan.updates.map((u) => ({ id: u.id, district: u.from })),
  }, null, 1));
  for (const u of plan.updates) {
    // eslint-disable-next-line no-await-in-loop
    await db.writeDistrict(u.id, u.to);
  }
  return { committed: true, plan };
}

/** Put the districts back as an undo file has them. Dry run unless commit. */
async function undo({ db, undoFile, commit }) {
  const u = JSON.parse(fs.readFileSync(undoFile, 'utf8'));
  if (!u || !Array.isArray(u.before)) throw new Error('not an undo file: no "before" list');
  if (!commit) return { committed: false, before: u.before };
  for (const b of u.before) {
    // eslint-disable-next-line no-await-in-loop
    await db.writeDistrict(b.id, b.district);
  }
  return { committed: true, before: u.before };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { commit: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const val = () => { i += 1; return argv[i]; };
    if (a === '--commit') out.commit = true;
    else if (a === '--env') out.env = val();
    else if (a === '--env-file') out.envFile = val();
    else if (a === '--csv') out.csv = val();
    else if (a === '--region') out.region = val();
    else if (a === '--undo-file') out.undoFile = val();
    else if (a === '--undo') out.undoFrom = val();
    else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

function supabaseDb(supabase) {
  return {
    async readSchools(region) {
      const { data, error } = await supabase.from('schools')
        .select('id, name, emis, region, district, is_active, is_probable_test').eq('region', region);
      if (error) throw new Error(`schools read failed: ${error.message}`);
      return data || [];
    },
    async writeDistrict(id, district) {
      const { error } = await supabase.from('schools').update({ district }).eq('id', id);
      if (error) throw new Error(`write failed for ${id}: ${error.message}`);
    },
  };
}

function printPlan(plan) {
  for (const u of plan.updates) console.log(`  write   ${u.name} (EMIS ${u.emis || '—'}, by ${u.by}): ${u.from || '∅'} → ${u.to} [${u.area}]`);
  for (const u of plan.unchanged) console.log(`  same    ${u.name}: ${u.to}`);
  for (const r of plan.refused) console.log(`  REFUSED ${r.row ? r.row.school_name : ''} ${r.reason}`);
  console.log(`  ${plan.updates.length} to write, ${plan.unchanged.length} unchanged, ${plan.refused.length} refused`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = ENVS[args.env];
  if (!target) throw new Error(`--env is REQUIRED: one of ${Object.keys(ENVS).join(', ')}`);
  const envPath = path.resolve(args.envFile || path.resolve(__dirname, '..', target.file));
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#') || !s.includes('=')) continue;
    const i = s.indexOf('=');
    process.env[s.slice(0, i)] = s.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  const m = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(String(process.env.SUPABASE_URL || ''));
  if (!m || m[1] !== target.ref) throw new Error(`ABORT: SUPABASE_URL is not ${args.env}'s project (${target.ref}); nothing done`);
  const supabase = require('../bot/shared/config/supabase');
  const db = supabaseDb(supabase);
  console.log(`\n  env=${args.env} ref=${m[1]} commit=${args.commit}`);
  if (args.undoFrom) {
    const out = await undo({ db, undoFile: args.undoFrom, commit: args.commit });
    for (const b of out.before) console.log(`  ${out.committed ? 'restored' : 'would restore'} ${b.id}: ${b.district || '∅'}`);
    return;
  }
  const rows = parseCsv(fs.readFileSync(args.csv || DEFAULT_CSV, 'utf8'));
  const out = await run({ db, rows, region: args.region || DEFAULT_REGION, commit: args.commit, undoFile: args.undoFile, log: printPlan });
  console.log(out.committed ? `  written; undo file: ${args.undoFile}\n` : '  dry run: nothing written (add --commit --undo-file <path>)\n');
}

if (require.main === module) main().catch((e) => { console.error(`\n  ${e.message}\n`); process.exit(1); });

module.exports = { parseCsv, planDistrictLoad, run, undo, areaOfDistrict };
