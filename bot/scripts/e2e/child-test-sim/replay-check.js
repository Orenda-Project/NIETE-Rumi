#!/usr/bin/env node
/**
 * replay-check — replay the coach's check on a finished run's AI marks, offline, in either pre-fill mode
 * and under any coach model (bd-s1oo0.21).
 *
 *   node bot/scripts/e2e/child-test-sim/replay-check.js --run <runDir> --fixtures <dir> --strips <dir>
 *        --mode strict|assist [--catch-prefilled 0.8,0.4 | --catch 0.9] [--blind-accuracy 1]
 *        [--seeds 1-50] [--rtt-s 0.8] [--look-s 2] [--out <file.json>]
 *
 * A mock-lane run (driver.js + score_run.py) leaves <runDir>/db_rows.json: every session's ai_marks as the
 * live scorers wrote them. The check itself is deterministic given those marks, the mode and the coach: the
 * same L6 code renders each screen (renderScreen), the same coach model fills it (check-play.coachFill),
 * the same read-back saves it (readScreen), and score-run-compare scores AI and coach against the key.
 * So one run's marks can be checked in both modes — the model's own run-to-run noise drops out of the
 * comparison — and a coach model can be swept across seeds for a sensitivity row. No network, no DB.
 *
 * Check time per child = open + the coach's priced actions + submit + 4 round trips (--rtt-s each; L14
 * measured ~0.8 s on the mock lane).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const CP = require('./check-play');
const P = require('../../../shared/services/child-test/check-flow/prefill');
const { formItems } = require('../../../shared/services/child-test/check-flow/items');
const { compareSession, summarise, mergeStripKey } = require('../../../../scripts/child-test/score-run-compare');

const SCREENS = [['urdu', 'URDU'], ['english', 'ENGLISH'], ['maths', 'MATHS']];

function args(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    a[k.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return a;
}

function seedsOf(spec) {
  if (!spec) return [1];
  const m = String(spec).match(/^(\d+)-(\d+)$/);
  if (m) { const out = []; for (let s = Number(m[1]); s <= Number(m[2]); s += 1) out.push(s); return out; }
  return String(spec).split(',').map(Number);
}

/** The fixture key for one session, with its strip photo's key merged into maths (as driver.js does). */
function keyFor(fixturesDir, stripsDir, fid, stripName) {
  const key = JSON.parse(fs.readFileSync(path.join(fixturesDir, fid, 'key.json'), 'utf8'));
  if (stripName) {
    const sk = path.join(stripsDir, stripName.replace(/\.jpg$/, '.key.json'));
    if (fs.existsSync(sk)) {
      const strip = JSON.parse(fs.readFileSync(sk, 'utf8'));
      key.blocks.maths = key.blocks.maths || { maths: {} };
      key.blocks.maths.maths = { ...(key.blocks.maths.maths || {}), written: strip.written, word_problem: strip.word_problem };
      return { key, strip };
    }
  }
  return { key, strip: null };
}

/** One child's check, all three screens, through L6's renderer and read-back. */
function checkChild({ blocks, key, items, mode, rng, coach, costs, rttS }) {
  const actions = [{ action: 'open_check', cost_s: costs.open_check }];
  const out = {};
  for (const [block, screen] of SCREENS) {
    const row = blocks[block];
    if (!row) continue;
    const aiMarks = row.ai_marks || null;
    const o = { aiMarks, items, lang: 'ur', child: { label: '—' }, aiStatus: aiMarks ? 'scored' : 'failed', mode };
    const data = P.renderScreen(block, o).data;
    const fill = CP.coachFill({ screen, data, key, items, rng, costs, ...coach });
    actions.push(...fill.actions);
    let read = P.readScreen(block, fill.posted, { aiMarks, items, lang: 'ur', mode });
    for (let tries = 0; !read.ok && tries < 2; tries += 1) {
      actions.push(...CP.fixErrors({ screen, errors: read.errors, posted: fill.posted, key, costs }));
      read = P.readScreen(block, fill.posted, { aiMarks, items, lang: 'ur', mode });
    }
    out[block] = { ...row, coach_marks: read.ok ? read.coachMarks : null, coach_edits: read.ok ? read.edits : null, replay_errors: read.ok ? null : read.errors };
  }
  actions.push({ action: 'submit', cost_s: costs.submit });
  const check_s = Math.round((actions.reduce((a, x) => a + (x.cost_s || 0), 0) + 4 * rttS) * 10) / 10;
  const count = (fn) => actions.filter(fn).length;
  return {
    blocks: out, check_s,
    effort: {
      typed: count((x) => x.action === 'type_count' && x.reason !== 'missed'),
      ticked: count((x) => x.action === 'tick_chip' && x.reason !== 'missed'),
      chosen: count((x) => x.action === 'choose_radio' && x.reason !== 'missed'),
      looks: count((x) => x.action === 'check_unsure'),
      missed: count((x) => x.reason === 'missed'),
      caught: count((x) => x.reason === 'correct'),
      blind: count((x) => x.reason === 'fill_empty'),
      nokey: count((x) => x.reason === 'no_key'),
    },
  };
}

function replay({ runDir, fixturesDir, stripsDir, mode, coach, seeds, rttS, lookS = null }) {
  const rows = JSON.parse(fs.readFileSync(path.join(runDir, 'db_rows.json'), 'utf8'));
  const run = JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'), 'utf8'));
  const summary = JSON.parse(fs.readFileSync(path.join(runDir, 'summary.json'), 'utf8'));
  const byRoll = Object.fromEntries(((summary.result || {}).children || []).filter((c) => c.roll != null).map((c) => [String(c.roll), c.fixture]));
  const fx = Object.fromEntries((run.fixtures || []).map((f) => [f.id, f]));
  const costs = CP.loadActionCosts();
  if (lookS != null) costs.check_unsure = lookS;   // sensitivity: what one look at an unsure field costs
  const perSeed = seeds.map((seed) => {
    const rng = CP.makeRng(seed);
    const sessions = []; const children = [];
    for (const r of rows) {
      const fid = byRoll[String(r.session.roll)];
      if (!fid) continue;
      const { key, strip } = keyFor(fixturesDir, stripsDir, fid, (fx[fid] || {}).strip);
      const items = formItems(String(r.session.grade || key.grade), r.session.form || key.form || 'A');
      const c = checkChild({ blocks: r.blocks, key, items, mode, rng, coach, costs, rttS });
      sessions.push(compareSession({ session: r.session, blocks: c.blocks, key: strip ? mergeStripKey(key, strip) : key }));
      children.push({ fixture: fid, check_s: c.check_s, ...c.effort });
    }
    return { seed, summary: summarise(sessions), children };
  });
  return { mode, coach, seeds, rtt_s: rttS, look_s: costs.check_unsure, per_seed: perSeed };
}

function main() {
  const a = args(process.argv.slice(2));
  const mode = a.mode === 'assist' ? 'assist' : 'strict';
  const coach = {
    catchP: a.catch != null ? Number(a.catch) : 0.9,
    catchPrefilled: CP.parseCatchPrefilled(a['catch-prefilled']),
    blindAccuracy: a['blind-accuracy'] != null ? Number(a['blind-accuracy']) : 1,
  };
  const out = replay({
    runDir: path.resolve(a.run), fixturesDir: path.resolve(a.fixtures), stripsDir: path.resolve(a.strips),
    mode, coach, seeds: seedsOf(a.seeds), rttS: a['rtt-s'] != null ? Number(a['rtt-s']) : 0.8,
    lookS: a['look-s'] != null ? Number(a['look-s']) : null,
  });
  const json = JSON.stringify(out, null, 1);
  if (a.out) fs.writeFileSync(a.out, json); else process.stdout.write(json + '\n');
}

module.exports = { replay, checkChild, seedsOf };
if (require.main === module) main();
