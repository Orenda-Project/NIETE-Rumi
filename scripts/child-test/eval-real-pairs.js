#!/usr/bin/env node
'use strict';
/**
 * Child test L23 (bd-s1oo0.40) — score EVERY May 2026 study composite with the go-live pipeline,
 * all grades, so the AI can be compared with the enumerator's tablet marks (the real pairs).
 *
 * Same code path as eval-scoring.js (L5) and the bot: scoreBlock, live models, every reply cached per
 * (fixture, block). What differs, all on the evaluation side:
 *   - all grades. The May battery was one instrument for every grade; the bank has only Grades 3 and 5.
 *     Grades 1–4 are scored against the Grade 3 Form A spec (the May passage verbatim), Grade 5
 *     against its own form (the May passage + a continuation the child never saw);
 *   - suspect cuts are scored too (the comparison reports them apart);
 *   - --shard i/n to run several processes side by side, and a spend cap (--cap, US$).
 *
 *   node scripts/child-test/eval-real-pairs.js --fixtures <real_all dir> --out <dir> --item-bank <json>
 *        --env <root .env> --soniox-env <file with SONIOX_API_KEY> [--shard 0/3] [--concurrency 8] [--cap 24]
 *
 * Nothing is written to any database; fixtures and output live outside git (they hold child audio and
 * transcripts). The comparison itself is golive/lanes/L23/scripts/compare.py.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const MAY_PW_ENG = ['maz', 'zaj', 'ver', 'lut', 'eaf', 'sno', 'mov', 'vod'];

/** The bank grade whose Form A holds the text a May child of this grade actually read. */
const bankGrade = (grade) => (Number(grade) === 5 ? 5 : 3);

/** The block spec for one real composite: the bank form of its bank grade, with the May items the bank lacks. */
function realSpec(bank, key, block) {
  const base = JSON.parse(JSON.stringify(bank.grades[String(bankGrade(key.grade))].forms[key.form || 'A'][block]));
  const k = (key.blocks && key.blocks[block]) || {};
  if (block === 'maths') {
    const qs = (k.maths && k.maths.quick_sums && k.maths.quick_sums.items) || [];
    base.quick_sums = qs.map((lab, i) => {
      const m = /(\d+)\s*([+-])\s*(\d+)\s*=\s*(\d+)/.exec(lab) || [];
      return { id: `may-blfl1-${i + 1}`, prompt: `${m[1]} ${m[2]} ${m[3]}`, answer: Number(m[4]) };
    });
    base.written = []; base.word_problem = null;     // from the strip photo, not in the May recordings
    return base;
  }
  if (block === 'english') base.nonwords = MAY_PW_ENG.map((t, i) => ({ id: `may-pw_eng-${i + 1}`, text: t, sounds: t.split('') }));
  if (block === 'urdu') { base.first_sounds = []; base.nonwords = []; }   // not in the May battery
  return base;
}

/** Children i, i+n, i+2n, … for --shard i/n; everything when no shard. */
const shardOf = (kids, shard) => (shard ? kids.filter((_, i) => i % shard[1] === shard[0]) : kids);

module.exports = { realSpec, bankGrade, shardOf, MAY_PW_ENG };

// ------------------------------------------------------------------------------------------- CLI
if (require.main === module) {
  const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
  const FIX = arg('fixtures'); const OUT = arg('out'); const BANK_FILE = arg('item-bank');
  if (!FIX || !OUT || !BANK_FILE) { console.error('usage: --fixtures <dir> --out <dir> --item-bank <json> [--env <.env>] [--soniox-env <.env>]'); process.exit(2); }
  const loadEnv = (file, map) => {
    if (!file || !fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!m) continue;
      for (const [from, to] of Object.entries(map)) if (m[1] === from && !process.env[to]) process.env[to] = m[2].replace(/^["']|["']$/g, '');
    }
  };
  loadEnv(arg('env'), { NIETE_STAGING_OPENROUTER_API_KEY: 'OPENROUTER_API_KEY', SPEECHACE_API_KEY: 'SPEECHACE_API_KEY', SPEECHACE_ENDPOINT: 'SPEECHACE_ENDPOINT' });
  loadEnv(arg('soniox-env'), { SONIOX_API_KEY: 'SONIOX_API_KEY' });
  process.env.LLM_PROVIDER = 'openrouter';
  process.env.SUPABASE_URL = 'http://127.0.0.1:9';             // nothing listens: no database is touched
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'offline-eval-no-db';
  for (const k of ['OPENROUTER_API_KEY', 'SONIOX_API_KEY']) if (!process.env[k]) { console.error(`${k} not set`); process.exit(2); }

  const { scoreBlock } = require(path.join(__dirname, '..', '..', 'bot', 'shared', 'services', 'child-test', 'scoring', 'index.js'));
  const BANK = JSON.parse(fs.readFileSync(BANK_FILE, 'utf8'));
  const CACHE = path.join(OUT, 'cache');
  const CAP = Number(arg('cap', '24')); const CONC = Number(arg('concurrency', '8'));
  const SHARD = arg('shard') ? arg('shard').split('/').map(Number) : null;
  fs.mkdirSync(CACHE, { recursive: true });
  const cost = (rec) => (rec && rec.aiMarks && rec.aiMarks.meta && rec.aiMarks.meta.cost_usd) || 0;
  const memStore = (row) => {
    const out = { saved: null, statuses: [] };
    return { out, getBlock: async () => ({ ok: true, block: row }), setAiStatus: async (r) => { out.statuses.push(r); return { ok: true }; },
      saveAiMarks: async (r) => { out.saved = r; return { ok: true, block: { ...row, ai_marks: r.aiMarks } }; } };
  };
  const copyToTemp = (file, ext) => {
    const p = path.join(os.tmpdir(), `ctrp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`);
    fs.copyFileSync(file, p);
    return Promise.resolve(p);
  };

  (async () => {
    let spent = 0;
    for (const f of fs.readdirSync(CACHE)) if (f.endsWith('.json')) spent += cost(JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8')));
    const kids = shardOf(fs.readdirSync(FIX).filter((d) => fs.existsSync(path.join(FIX, d, 'key.json'))).sort(), SHARD);
    const jobs = [];
    for (const id of kids) {
      const key = JSON.parse(fs.readFileSync(path.join(FIX, id, 'key.json'), 'utf8'));
      for (const block of ['urdu', 'english', 'maths']) {
        if (fs.existsSync(path.join(FIX, id, `${block}.ogg`))) jobs.push({ id, block, grade: key.grade, dir: path.join(FIX, id), spec: realSpec(BANK, key, block) });
      }
    }
    console.log(`${jobs.length} block notes; cached spend $${spent.toFixed(3)}; cap $${CAP}`);
    let i = 0;
    await Promise.all(Array.from({ length: CONC }, async () => {
      while (i < jobs.length) {
        const j = jobs[i]; i += 1;
        const cacheFile = path.join(CACHE, `${j.id}__${j.block}.json`);
        if (fs.existsSync(cacheFile) || spent >= CAP) continue;
        try {
          const row = { id: `${j.id}-${j.block}`, block: j.block, audio_r2_key: path.join(j.dir, `${j.block}.ogg`), photo_r2_key: null, ai_marks: null };
          const store = memStore(row);
          const t0 = Date.now();
          const res = await scoreBlock({ sessionId: j.id, block: j.block, grade: j.grade, form: 'A', force: true },
            { store, itemBank: { getForm: () => ({ [j.block]: j.spec }), cue: BANK.cue, version: BANK.version }, fetchMedia: copyToTemp });
          const rec = { id: j.id, block: j.block, grade: j.grade, bank_grade: bankGrade(j.grade), res, wall_s: (Date.now() - t0) / 1000,
            aiMarks: store.out.saved && store.out.saved.aiMarks, transcript: store.out.saved && store.out.saved.transcript, statuses: store.out.statuses };
          fs.writeFileSync(cacheFile, JSON.stringify(rec));
          spent += cost(rec);
          console.log(`  ${j.id.slice(0, 11)} G${j.grade} ${j.block.padEnd(7)} ${res && res.aiStatus} ${rec.wall_s.toFixed(0)}s total $${spent.toFixed(3)}`);
        } catch (e) { console.log(`  ERR ${j.id.slice(0, 11)} ${j.block} ${e.message}`); }
      }
    }));
    console.log(`done; spend $${spent.toFixed(3)}`);
  })().catch((e) => { console.error(e); process.exit(1); });
}
