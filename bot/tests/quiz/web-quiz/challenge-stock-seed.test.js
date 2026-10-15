'use strict';
/**
 * The registry rows for the passage stock: one draft challenge_passages row per passage file, printed by
 * scripts/challenge-stock-seed.js. The committed SQL must be exactly what the script prints today (a passage file
 * added or changed without re-running the script fails here). Pure: reads the files on disk, no database.
 */
const fs = require('fs');
const path = require('path');
const { buildSql, rows } = require('../../../scripts/challenge-stock-seed');

const SQL = path.join(__dirname, '../../../database/migrations/web_quiz_challenge_stock_seed.sql');
const PASSAGES = path.join(__dirname, '../../../shared/data/child-test/passages');

describe('passage stock seed', () => {
  test('the committed SQL is the script output', () => {
    expect(fs.readFileSync(SQL, 'utf8')).toBe(buildSql());
  });

  test('one draft row per passage file: not released, no reviewer, idempotent', () => {
    const files = fs.readdirSync(PASSAGES).filter((f) => f.endsWith('.json'));
    const r = rows();
    expect(r.map((x) => `${x.passage_id}.json`).sort()).toEqual(files.sort());
    for (const x of r) {
      expect([x.passage_id, x.status, x.released_at, x.reviewer, x.reviewed_at]).toEqual([x.passage_id, 'draft', null, null, null]);
      expect(x.text_hash).toMatch(/^[0-9a-f]{32}$/);
    }
    const sql = buildSql();
    expect((sql.match(/INSERT INTO public\.challenge_passages/g) || []).length).toBe(r.length);
    expect((sql.match(/ON CONFLICT \(passage_id\) DO NOTHING;/g) || []).length).toBe(r.length);
    expect(sql).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bDROP\b/);
  });

  test('a row carries the computed numbers of its file', () => {
    const r = rows().find((x) => x.passage_id === 'en.read.1.ref01');
    const p = JSON.parse(fs.readFileSync(path.join(PASSAGES, 'en.read.1.ref01.json'), 'utf8'));
    expect(r).toMatchObject({
      lang: 'en', kind: 'read', band: 1, pool: 'check', is_reference: true, tokens: p.tokens, sentences: p.sentences,
      mean_sent_len: p.mean_sent_len, max_word_len: p.max_word_len, readability: p.readability,
      readability_list: 'fed-cum-g2-2026', q_reach_1: p.q_reach_1, q_reach_2: p.q_reach_2, q_n: p.q_n,
      text_hash: p.text_hash, twin_of: null, bank_version: 'child-test-items-v4',
    });
    const setA = rows().find((x) => x.passage_id === 'en.read.2.setA');
    expect(setA).toMatchObject({ band: 2, is_reference: true, bank_version: 'child-test-items-v3', readability_list: 'fed-cum-g3-2026' });
    expect(setA.tokens).toBe(60);
  });
});
