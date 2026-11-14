'use strict';
/**
 * bd-ra8xu.55 — `scripts/backfill-lp-fidelity-moves.js` for the GB lessons.
 *
 * The script was written for one ICT run against production. To load the GB move lists safely it must:
 *   - be pointed at staging/sandbox ON PURPOSE (--expect-ref), and still refuse any other database;
 *   - load one family only (--prefix gb_);
 *   - refuse a move list made from a different PDF than the one served (its content_hash);
 *   - in a dry run, say how many rows it would insert vs update, reading only;
 *   - never write without a backup of every row of the lessons it touches, and undo from that backup exactly.
 * The Supabase client and the file system are stubbed; the script's own logic runs.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const B = require('../../../scripts/backfill-lp-fidelity-moves');

const PROD = 'ihzciabopbttygxxgrkm';
const STAGING = 'rpqkekcfvumypldbejhp';
const url = (ref) => `https://${ref}.supabase.co`;

const asset = (lesson_id, content_hash, extra = {}) => ({
  lesson_id, catalog_version: 'v8', version_stamp: 'gb_v9_gbfix_5Nov', content_hash, ...extra,
});
const movesFile = (lesson_id, extra = {}) => ({
  schema_version: 'fidelity-moves-v1', lesson_id, brief_sha: '834af32cf0ac', template: 'STANDARD',
  total_minutes: 40, model: 'claude-haiku-4-5-20251001',
  moves: [{ move_id: 'm1', phase: 'explain', text: 'Model it on the board' }], ...extra,
});

/** A tiny in-memory PostgREST: from(t).select().eq().like().in().range() / upsert / delete().in() / insert. */
function fakeDb({ assets = [], moves = [] } = {}) {
  const tables = { niete_lp_assets: assets.map((a) => ({ asset_kind: 'lesson', is_current: true, ...a })), niete_lp_fidelity_moves: moves.slice() };
  const calls = [];
  const client = {
    from(t) {
      const filters = [];
      let op = 'select';
      let payload = null;
      let range = null;
      const apply = () => tables[t].filter((r) => filters.every((f) => f(r)));
      const chain = {
        select() { return chain; },
        eq(c, v) { filters.push((r) => r[c] === v); return chain; },
        in(c, vs) { filters.push((r) => vs.includes(r[c])); return chain; },
        like(c, p) { const re = new RegExp(`^${p.replace(/\\_/g, '_').replace(/%/g, '.*')}$`); filters.push((r) => re.test(r[c])); return chain; },
        order() { return chain; },
        range(a, b) { range = [a, b]; return chain; },
        upsert(rows) { op = 'upsert'; payload = rows; return chain; },
        insert(rows) { op = 'insert'; payload = rows; return chain; },
        delete() { op = 'delete'; return chain; },
        then(resolve, reject) {
          try {
            calls.push({ t, op, n: payload ? payload.length : undefined });
            if (op === 'select') {
              const rows = apply();
              return resolve({ data: range ? rows.slice(range[0], range[1] + 1) : rows, error: null });
            }
            if (op === 'upsert') {
              for (const row of payload) {
                const i = tables[t].findIndex((r) => r.lesson_id === row.lesson_id && r.version_stamp === row.version_stamp && r.content_hash === row.content_hash);
                if (i >= 0) tables[t][i] = { ...tables[t][i], ...row }; else tables[t].push({ id: `new-${tables[t].length}`, ...row });
              }
              return resolve({ data: null, error: null });
            }
            if (op === 'insert') { tables[t].push(...payload); return resolve({ data: null, error: null }); }
            if (op === 'delete') {
              const gone = new Set(apply());
              tables[t] = tables[t].filter((r) => !gone.has(r));
              return resolve({ data: null, error: null });
            }
            return resolve({ data: null, error: null });
          } catch (e) { return reject(e); }
        },
      };
      return chain;
    },
  };
  return { client, tables, calls };
}

function tmpMovesDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moves-'));
  for (const f of files) fs.writeFileSync(path.join(dir, `${f.lesson_id}.moves.json`), JSON.stringify(f));
  return dir;
}

const quiet = { log: () => {} };

describe('backfill-lp-fidelity-moves: which database', () => {
  test('refuses a database that is not the one expected, prod by default', () => {
    expect(() => B.assertRef(url(STAGING))).toThrow(/REFUSING/);
    expect(() => B.assertRef(url(PROD))).not.toThrow();
  });
  test('staging is accepted only when named with --expect-ref', () => {
    expect(() => B.assertRef(url(STAGING), STAGING)).not.toThrow();
    expect(() => B.assertRef(url(PROD), STAGING)).toThrow(/REFUSING/);
  });
});

describe('backfill-lp-fidelity-moves: which rows', () => {
  const assets = new Map([
    ['gb_g4_urdu_ch2_seg3', asset('gb_g4_urdu_ch2_seg3', '7d391225b42e')],
    ['gb_g1_english_ch1_seg1', asset('gb_g1_english_ch1_seg1', 'aaaaaaaaaaaa')],
    ['grade_4_urdu_ch1_seg1', asset('grade_4_urdu_ch1_seg1', 'bbbbbbbbbbbb', { version_stamp: 'v8-x' })],
  ]);
  test('keys each list to the current asset, filters by prefix, skips no-asset and stale-PDF lists', () => {
    const files = [
      movesFile('gb_g4_urdu_ch2_seg3', { content_hash: '7d391225b42e' }),
      movesFile('gb_g1_english_ch1_seg1', { content_hash: 'ffffffffffff' }), // made from another PDF
      movesFile('gb_g9_nothing_ch1_seg1'), // no current asset
      movesFile('grade_4_urdu_ch1_seg1'), // not gb_
    ];
    const { rows, skipped } = B.buildRows(files, assets, { prefix: 'gb_' });
    expect(rows.map((r) => r.lesson_id)).toEqual(['gb_g4_urdu_ch2_seg3']);
    expect(rows[0]).toMatchObject({ version_stamp: 'gb_v9_gbfix_5Nov', content_hash: '7d391225b42e', catalog_version: 'v8', n_moves: 1, brief_sha: '834af32cf0ac', template: 'STANDARD', total_minutes: 40 });
    expect(skipped).toEqual({ no_asset: 1, stale_version: 1, other_prefix: 1 });
  });
  test('a list with no content_hash (the ICT files) is keyed as before', () => {
    const { rows } = B.buildRows([movesFile('grade_4_urdu_ch1_seg1')], assets, {});
    expect(rows).toHaveLength(1);
  });
});

describe('backfill-lp-fidelity-moves: dry run, backup, write, undo', () => {
  const env = { SUPABASE_URL: url(STAGING) };
  const assets = [asset('gb_g4_urdu_ch2_seg3', '7d391225b42e'), asset('gb_g1_english_ch1_seg1', 'aaaaaaaaaaaa')];
  const old = { id: 'old-1', lesson_id: 'gb_g1_english_ch1_seg1', version_stamp: 'gb_v9_gbsvg_3Nov', content_hash: 'cccccccccccc', moves: [{ move_id: 'm1' }], n_moves: 1 };
  const atKey = { id: 'old-2', lesson_id: 'gb_g1_english_ch1_seg1', version_stamp: 'gb_v9_gbfix_5Nov', content_hash: 'aaaaaaaaaaaa', moves: [{ move_id: 'zz' }], n_moves: 1 };
  const files = [movesFile('gb_g4_urdu_ch2_seg3', { content_hash: '7d391225b42e' }), movesFile('gb_g1_english_ch1_seg1', { content_hash: 'aaaaaaaaaaaa' })];

  test('dry run reads only and counts inserts vs updates', async () => {
    const db = fakeDb({ assets, moves: [old, atKey] });
    const out = await B.run(['--dry-run', '--expect-ref', STAGING, '--prefix', 'gb_'], { client: db.client, env: { ...env, MOVES_DIR: tmpMovesDir(files) }, ...quiet });
    expect(out).toMatchObject({ mode: 'dry-run', keyed: 2, would_insert: 1, would_update: 1 });
    expect(db.calls.filter((c) => c.op !== 'select')).toEqual([]);
  });

  test('a write without --backup is refused before anything is read or written', async () => {
    const db = fakeDb({ assets });
    await expect(B.run(['--expect-ref', STAGING], { client: db.client, env: { ...env, MOVES_DIR: tmpMovesDir(files) }, ...quiet })).rejects.toThrow(/--backup/);
    expect(db.calls).toEqual([]);
  });

  test('write saves every row of the touched lessons first; undo puts them back exactly', async () => {
    const db = fakeDb({ assets, moves: [old, atKey] });
    const backup = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bk-')), 'backup.json');
    const w = await B.run(['--expect-ref', STAGING, '--prefix', 'gb_', '--backup', backup], { client: db.client, env: { ...env, MOVES_DIR: tmpMovesDir(files) }, ...quiet });
    expect(w).toMatchObject({ mode: 'write', written: 2 });
    const saved = JSON.parse(fs.readFileSync(backup, 'utf8'));
    expect(saved.ref).toBe(STAGING);
    expect(saved.lesson_ids.sort()).toEqual(['gb_g1_english_ch1_seg1', 'gb_g4_urdu_ch2_seg3']);
    expect(saved.rows.map((r) => r.id).sort()).toEqual(['old-1', 'old-2']); // both versions of the touched lesson
    expect(db.tables.niete_lp_fidelity_moves).toHaveLength(3);

    const u = await B.run(['--undo', backup, '--expect-ref', STAGING], { client: db.client, env, ...quiet });
    expect(u).toMatchObject({ mode: 'undo', deleted_lessons: 2, restored: 2 });
    const after = db.tables.niete_lp_fidelity_moves.slice().sort((a, b) => a.id.localeCompare(b.id));
    expect(after).toEqual([old, atKey]);
  });

  test('undo refuses a backup taken on another database', async () => {
    const db = fakeDb({ assets });
    const backup = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bk-')), 'backup.json');
    fs.writeFileSync(backup, JSON.stringify({ ref: PROD, lesson_ids: ['x'], rows: [] }));
    await expect(B.run(['--undo', backup, '--expect-ref', STAGING], { client: db.client, env, ...quiet })).rejects.toThrow(/backup was taken on/);
  });
});
