/**
 * bd-5ioto.11 — repair the families the first backfill already wrote.
 *
 * That backfill gave each v1 the SAME created_at as its child P. The repair
 * finds exactly those v1 rows — a root whose id is UUIDv5(child.id) and whose
 * child points at it — and moves v1.created_at to 1 second before the child's.
 * Dry run by default; --yes needs the matching --expect-ref; idempotent; the
 * manifest records every row's before/after so it can be undone.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const { makeFakeDb } = require('./helpers/fake-postgrest');
const Backfill = require('../../bot/scripts/assessment/backfill-paper-versions');
const Repair = require('../../bot/scripts/assessment/repair-backfilled-v1-created-at');

const REF = 'olvritwoqujtjvwfulbh';
const ENV = { SUPABASE_URL: `https://${REF}.supabase.co` };
const P1 = '1b341c40-be15-4cd2-bd78-e9cf5370b68a';
const P2 = '0963052a-0532-4dad-ada8-f8be4190a60c';
const TIE = '2026-09-01T10:00:00.123456+00:00';

const row = (id, over = {}) => ({ id, request_id: `r-${id}`, attempt: 1, status: 'ready', edited_from: null, created_at: TIE, ...over });

function seed() {
  const v1a = Backfill.v1IdFor(P1);
  const v1b = Backfill.v1IdFor(P2);
  return makeFakeDb({
    assessment_papers: [
      row(v1a, { request_id: 'rA' }),
      row(P1, { request_id: 'rA', edited_from: v1a }),
      row(v1b, { request_id: 'rB', created_at: '2026-09-02T00:00:00+00:00' }),
      row(P2, { request_id: 'rB', edited_from: v1b, created_at: '2026-09-02T00:00:05+00:00' }), // already ordered
      // a real WhatsApp version: parent id is NOT uuidv5(child) — never touched
      row('g1', { request_id: 'rC' }),
      row('g2', { request_id: 'rC', edited_from: 'g1' }),
    ],
  });
}

const run = (db, argv) => Repair.run(argv, { supabase: db.client, env: ENV, log: () => {} });

describe('repair-backfilled-v1-created-at', () => {
  test('a dry run finds only the tied backfilled v1 and writes nothing', async () => {
    const db = seed();
    const out = await run(db, []);
    expect(out.dryRun).toBe(true);
    expect(db.writes).toEqual([]);
    expect(out.counts).toMatchObject({ backfilled: 2, needs_repair: 1, already_ordered: 1, repaired: 0 });
    expect(out.manifest.rows).toEqual([{ id: Backfill.v1IdFor(P1), child: P1, before: TIE, after: '2026-09-01T09:59:59.123Z' }]);
  });

  test('--yes needs the matching --expect-ref', async () => {
    const db = seed();
    await expect(run(db, ['--yes'])).rejects.toThrow(/--expect-ref/);
    await expect(run(db, ['--yes', '--expect-ref', 'rpqkekcfvumypldbejhp'])).rejects.toThrow(/ref/);
    expect(db.writes).toEqual([]);
  });

  test('--yes moves v1 to 1s before its child, touches nothing else, and a re-run is a no-op', async () => {
    const db = seed();
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ag-rep-')), 'm.json');
    const out = await run(db, ['--yes', '--expect-ref', REF, '--manifest', file]);
    expect(out.counts.repaired).toBe(1);
    const t = db.tables.assessment_papers;
    const v1a = t.find((r) => r.id === Backfill.v1IdFor(P1));
    expect(v1a.created_at).toBe('2026-09-01T09:59:59.123Z');
    expect(Date.parse(v1a.created_at)).toBeLessThan(Date.parse(t.find((r) => r.id === P1).created_at));
    expect(db.writes.filter((w) => w.op === 'update').map((w) => w.ids)).toEqual([[Backfill.v1IdFor(P1)]]);
    expect(t.find((r) => r.id === 'g1').created_at).toBe(TIE);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ ref: REF, rows: [{ child: P1, before: TIE }] });

    db.writes.length = 0;
    const again = await run(db, ['--yes', '--expect-ref', REF]);
    expect(again.counts).toMatchObject({ needs_repair: 0, repaired: 0 });
    expect(db.writes).toEqual([]);
  });
});
