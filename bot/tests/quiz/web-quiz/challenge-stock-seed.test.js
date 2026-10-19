'use strict';
/**
 * The registry rows for the passage stock: one draft challenge_passages row per passage file (the Set A pointer
 * files excepted: the registry seed owns those reference rows), printed by
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
    const files = fs.readdirSync(PASSAGES).filter((f) => f.endsWith('.json'))
      .filter((f) => !JSON.parse(fs.readFileSync(path.join(PASSAGES, f), 'utf8')).v3_ref);
    const r = rows();
    expect(r.map((x) => `${x.passage_id}.json`).sort()).toEqual(files.sort());
    for (const x of r) {
      expect([x.passage_id, x.status, x.released_at, x.reviewer, x.reviewed_at]).toEqual([x.passage_id, 'draft', null, null, null]);
      expect(x.text_hash).toMatch(/^[0-9a-f]{32}$/);
    }
    const sql = buildSql();
    expect((sql.match(/INSERT INTO public\.challenge_passages/g) || []).length).toBe(r.length);
    expect((sql.match(/ON CONFLICT \(passage_id\) DO NOTHING;/g) || []).length).toBe(r.length);
    expect(sql).not.toMatch(/\bDELETE\b|\bDROP\b/);
    // the only UPDATEs are the pointer-title lines, each guarded so it never overwrites a title already set
    for (const u of sql.split('\n').filter((l) => /\bUPDATE\b/.test(l))) {
      expect(u).toMatch(/^UPDATE public\.challenge_passages SET title_(ur|en) = '(?:[^']|'')+', updated_at = now\(\) WHERE passage_id = '[a-z]{2}\.(read|listen)\.2\.setA' AND title_\1 IS NULL;$/);
    }
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
  });

  test('the Set A pointer files get no row here (the registry seed owns their reference rows)', () => {
    const pointers = fs.readdirSync(PASSAGES).filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(PASSAGES, f), 'utf8'))).filter((p) => p.v3_ref);
    expect(pointers.map((p) => p.passage_id).sort()).toEqual(['en.listen.2.setA', 'en.read.2.setA', 'ur.listen.2.setA', 'ur.read.2.setA']);
    const sql = fs.readFileSync(SQL, 'utf8');
    for (const p of pointers) {
      expect([p.passage_id, sql.includes(`VALUES ('${p.passage_id}'`)]).toEqual([p.passage_id, false]);
      expect(rows().some((x) => x.passage_id === p.passage_id)).toBe(false);
    }
  });

  test('a pointer file with a title gets one guarded UPDATE for it, and no INSERT (ruling 15)', () => {
    const p = JSON.parse(fs.readFileSync(path.join(PASSAGES, 'ur.listen.2.setA.json'), 'utf8'));
    expect(p.title_ur).toBe('عائشہ کا اسکول');
    expect([...p.title_ur].length).toBeLessThanOrEqual(24);
    const sql = fs.readFileSync(SQL, 'utf8');
    const lines = sql.split('\n').filter((l) => l.includes("'ur.listen.2.setA'"));
    const sqlLit = (v) => `'${String(v).replace(/'/g, "''")}'`;   // the file's title, quoted as the script quotes it
    expect(lines).toEqual([
      `UPDATE public.challenge_passages SET title_ur = ${sqlLit(p.title_ur)}, updated_at = now() WHERE passage_id = 'ur.listen.2.setA' AND title_ur IS NULL;`,
      `UPDATE public.challenge_passages SET title_en = ${sqlLit(p.title_en)}, updated_at = now() WHERE passage_id = 'ur.listen.2.setA' AND title_en IS NULL;`,
    ]);
    expect(sql).not.toMatch(/INSERT[^;]*'ur\.listen\.2\.setA'/);
  });
});
