#!/usr/bin/env node
'use strict';
/**
 * Prints the Challenge content registry seed (bot/database/migrations/web_quiz_challenge_registry_seed.sql)
 * from the banks: the two launch periods, the Set A passage rows (band 2 references) and the maths item rows
 * (anchor block A1, the A2 draft, bigger.G3.A / bigger.G5.A, missing.G3.A.07-10, the grade-1 block G1A and
 * numid.G1.A.05).
 *
 *   node bot/scripts/challenge-registry-seed.js > bot/database/migrations/web_quiz_challenge_registry_seed.sql
 *
 * Pure: reads the bank files through item-bank.js, writes stdout only. No database, no network, no environment.
 * A test checks that the committed SQL equals this script's output.
 */
const crypto = require('crypto');
const Bank = require('../shared/services/child-test/item-bank');

const V4 = Bank.versionV4;
const V3 = Bank.versionV3;
const LAUNCH = '2026-10-31T19:00:00Z';
const SET_A_REVIEWER = 'rwp2026 instrument (May 2026)';
const SET_A_REVIEWED_AT = '2026-05-01T00:00:00Z';
// v3 titles are task names, not story titles: a task name never goes into a child-facing title field.
const V3_TASK_TITLES = new Set(['Story reading', 'Listening']);

const SET_A_PASSAGES = [
  { passage_id: 'en.read.2.setA', lang: 'en', kind: 'read', v3: 'story', field: 'orf_reading_eng' },
  { passage_id: 'ur.read.2.setA', lang: 'ur', kind: 'read', v3: 'story', field: 'orf_reading_urd' },
  { passage_id: 'en.listen.2.setA', lang: 'en', kind: 'listen', v3: 'listening', field: 'listcomp_passage_eng' },
  { passage_id: 'ur.listen.2.setA', lang: 'ur', kind: 'listen', v3: 'listening', field: 'listcomp_passage_urd' },
];

// Set A is the May 2026 RWP/ICT instrument's text, verbatim: a published, calibrated partner instrument (ITEMS §1.1).
// The source key must resolve in the v3 bank's `sources` map; its difficulty data per grade (grades 1-5, the
// instrument's export, counts and means only) is copied below. A listen row carries the listening score as comp.
const SET_A_SOURCE = 'rwp2026';
const SET_A_LEVEL = { read: 'RWP/ICT May 2026 EGRA ORF', listen: 'RWP/ICT May 2026 EGRA listening comprehension' };
const SET_A_CALIB_RETRIEVED = '2026-10-16';
// [grade, n, mean_wcpm, sd, median, zero_share, firstline_stop_share, comp_mean, comp_n, listen_mean, listen_n]
const SET_A_STATS = {
  en: [
    [1, 446, 4.3, 16.1, 0, 0.61, 0.884, 0.34, 38, 0.3, 446],
    [2, 459, 9.8, 20, 0.3, 0.492, 0.705, 1.03, 117, 0.61, 459],
    [3, 443, 22.4, 30.7, 5, 0.349, 0.535, 1.34, 198, 0.73, 443],
    [4, 454, 38.8, 41.5, 29, 0.249, 0.362, 1.42, 279, 0.85, 454],
    [5, 431, 53.8, 44, 53, 0.158, 0.248, 1.96, 320, 1.31, 431],
  ],
  ur: [
    [1, 446, 4.7, 15, 0, 0.563, 0.833, 1.07, 59, 1.89, 446],
    [2, 459, 18.6, 30.1, 3.8, 0.338, 0.49, 2.29, 221, 2.63, 459],
    [3, 443, 38.7, 38.6, 29, 0.195, 0.265, 2.99, 314, 3.34, 443],
    [4, 454, 62.3, 44.8, 58.9, 0.082, 0.129, 3.77, 385, 3.85, 454],
    [5, 431, 85.7, 45.9, 90, 0.046, 0.063, 4.25, 403, 4.08, 431],
  ],
};

function setACalib(lang, kind) {
  const stats = SET_A_STATS[lang].map(([grade, n, mean_wcpm, sd, median, zero_share, firstline_stop_share, comp_mean, comp_n, listen_mean, listen_n]) => ({
    grade, n, mean_wcpm, sd, median, zero_share, firstline_stop_share,
    comp_mean: kind === 'listen' ? listen_mean : comp_mean,
    comp_n: kind === 'listen' ? listen_n : comp_n,
  }));
  return { instrument: SET_A_SOURCE, text_verbatim: true, grades_targeted: [2, 3], level_label: SET_A_LEVEL[kind], band_rule: 'A', retrieved_at: SET_A_CALIB_RETRIEVED, stats };
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function periodRows() {
  return Bank.periodsV4().map((p) => ({
    period_id: p.period_id,
    starts_at: p.starts_at,
    ends_at: p.ends_at,
    anchor_block_version: p.anchor_block_version,
    weights_v: p.weights_v,
    bank_version: V4,
    created_by: 'seed',
  }));
}

function passageRows() {
  const sources = Bank.bankV3().sources || {};
  if (!sources[SET_A_SOURCE]) throw new Error(`registry seed: the v3 bank has no sources.${SET_A_SOURCE}; Set A cannot cite its instrument`);
  return SET_A_PASSAGES.map(({ passage_id, lang, kind, v3, field }) => {
    const spec = Bank.bankV3().sets.A.reading[lang][v3];
    const text = spec.story.text;
    // the story carries its tokeniser output; the listening story is text only (60 words, whitespace split)
    const tokens = Array.isArray(spec.story.tokens) ? spec.story.tokens.length : text.trim().split(/\s+/).length;
    const titleEn = spec.title && spec.title.en && !V3_TASK_TITLES.has(spec.title.en) ? spec.title.en : null;
    return {
      passage_id,
      lang,
      kind,
      pool: 'check',
      band: 2,
      status: 'calibrated',
      is_reference: true,
      released_at: LAUNCH,
      tokens,
      title_en: lang === 'en' ? titleEn : null,
      title_ur: null,
      source_ref: `${SET_A_SOURCE}:${field}`,
      licence: 'partner_instrument',
      provenance: 'published_calibrated',
      adapted: false,
      calib: setACalib(lang, kind),
      reviewer: SET_A_REVIEWER,
      reviewed_at: SET_A_REVIEWED_AT,
      adjustment: 0,
      method: 'none',
      signed_by: null,
      text_hash: sha256(text).slice(0, 32),
      bank_version: V3,
    };
  });
}

function itemRows() {
  return Bank.listItemsV4().map((it) => ({
    item_id: it.item_id,
    task: it.task,
    form: it.form,
    band: it.band,
    pool: it.pool,
    template_id: null,
    params: it.params,
    params_hash: Bank.paramsHash(it.params),
    anchor: it.anchor,
    anchor_block: it.anchor_block,
    anchor_pos: it.anchor_pos,
    status: it.status,
    bank_version: V4,
  }));
}

function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`registry seed: not a finite number: ${v}`);
    return String(v);
  }
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

function insert(table, key, rows) {
  const cols = Object.keys(rows[0]);
  const values = rows.map((r) => `  (${cols.map((c) => lit(r[c])).join(', ')})`).join(',\n');
  return `INSERT INTO public.${table} (${cols.join(', ')}) VALUES\n${values}\nON CONFLICT (${key}) DO NOTHING;\n`;
}

function buildSeedSql() {
  return [
    '-- Seed: the Challenge content registry (web_quiz_challenge_registry.sql) for the November 2026 launch.',
    '-- GENERATED by bot/scripts/challenge-registry-seed.js from item-bank.v4.json and item-bank.v3.json; do not edit by',
    '-- hand (a test checks this file equals the script output). Idempotent: ON CONFLICT DO NOTHING on every insert, so a',
    '-- second run changes nothing and a row already moved on (status, sign-off) is never put back.',
    '-- Non-destructive; apply to sandbox first, after web_quiz_challenge_registry.sql. Text lives in the bank files.',
    '--',
    '-- Passages: the Set A references (band 2, en and ur, read and listen), calibrated by designation with adjustment 0.',
    '--   signed_by stays NULL here: a named human designates the references on sandbox (signed_by, signed_at).',
    '--   Set A is the May 2026 RWP/ICT instrument verbatim: provenance published_calibrated, licence partner_instrument,',
    '--   source_ref rwp2026:<field>, calib = its per-grade difficulty data (web_quiz_challenge_passages_licence_calib.sql',
    '--   adds those columns: apply it first).',
    '--   title_en is NULL where the v3 title is a task name; title_ur is NULL until the Urdu title is authored and',
    '--   read by a native reviewer (never an English placeholder in a child-facing field).',
    '-- Items: anchor block A1 (operational, both forms), the A2 draft (provisional; anchor=false and anchor_block NULL at',
    '--   launch because an anchor row must be operational; the bank marks them anchor_block_candidate A2), the bigger',
    '--   sets for G3 and G5, missing.G3.A.07-10, and the grade-1 numerals: block G1A (numid.G1.A.*, ten anchors, form G1)',
    '--   plus numid.G1.A.05 (operational, not in the block). The grade-1 practice layouts are Story Time stock, not seeded.',
    '--   params_hash = first 16 hex of sha256 over the sorted-key JSON.',
    '',
    'BEGIN;',
    '',
    insert('challenge_periods', 'period_id', periodRows()),
    insert('challenge_passages', 'passage_id', passageRows()),
    insert('challenge_items', 'item_id', itemRows()),
    'COMMIT;',
    '',
  ].join('\n');
}

module.exports = { periodRows, passageRows, itemRows, buildSeedSql };

if (require.main === module) process.stdout.write(buildSeedSql());
