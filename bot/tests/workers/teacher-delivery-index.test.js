'use strict';
/**
 * The two report sweeps read from an index, not a scan of every observation's report (bd-tfya0m.2).
 *
 * The untapped and undelivered sweeps filter leader observations on analysis_data->teacher_delivery->>status
 * (and the no-record lane on analysis_data->teacher_delivery IS NULL). With no index on those paths Postgres
 * unpacks the ~62 KB analysis_data of every finished leader observation (6,701 on prod, 27 Nov) for every page
 * of every lane: ~1.8 s each warm, and on prod the reads hit the API statement time limit ('canceling statement
 * due to statement timeout', 45-117 a day since 15 Nov), so reports stuck at awaiting_confirm / previewing were
 * never reminded or closed. An expression index is only used when the query's expression is the same one, and a
 * partial index only when the query implies its WHERE, so this test ties the sweeps' filters to the migration.
 */

const fs = require('fs');
const path = require('path');

const MIGRATION = path.join(
  __dirname, '../../database/migrations/coaching_sessions_teacher_delivery_index_concurrently.sql',
);

jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

// Records the filters of every query; each read returns an empty page so each lane stops after one.
const mockQueries = [];
jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn((table) => {
    const q = { table, filters: [] };
    mockQueries.push(q);
    const chain = {
      select: () => chain,
      eq: (c, v) => { q.filters.push(['eq', c, v]); return chain; },
      in: (c, v) => { q.filters.push(['in', c, v]); return chain; },
      is: (c, v) => { q.filters.push(['is', c, v]); return chain; },
      not: (c, op, v) => { q.filters.push(['not', c, op, v]); return chain; },
      order: () => chain,
      range: async () => ({ data: [], error: null }),
    };
    return chain;
  }),
}));

const worker = require('../../workers/stale-session.worker');

// PostgREST turns analysis_data->teacher_delivery->>status into ((analysis_data -> 'teacher_delivery') ->> 'status')
// and analysis_data->teacher_delivery into (analysis_data -> 'teacher_delivery').
function sqlOf(restPath) {
  const m = /^(\w+)((?:->\w+)*?)(?:->>(\w+))?$/.exec(restPath);
  if (!m) throw new Error(`not a json path: ${restPath}`);
  const inner = m[2].split('->').filter(Boolean).reduce((acc, k) => `(${acc} -> '${k}')`, m[1]);
  return m[3] ? `(${inner} ->> '${m[3]}')` : inner;
}
// Whitespace and ::text casts dropped, and every pair of parens wrapping the WHOLE expression peeled off.
function norm(s) {
  let out = s.replace(/::text/g, '').replace(/\s+/g, '');
  while (out.startsWith('(') && closesAt(out, 0) === out.length - 1) out = out.slice(1, -1);
  return out;
}
function closesAt(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i += 1) {
    if (s[i] === '(') depth += 1;
    if (s[i] === ')') { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

// Live statements only (a commented-out line starts with --): { columns: [norm'd], where: norm'd }.
function indexes(sql) {
  const re = /^CREATE\s+INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS\s+\w+\s+ON\s+public\.coaching_sessions\s*\((.+)\)\s+WHERE\s+([^;]+);/gim;
  return [...sql.matchAll(re)].map((m) => ({
    columns: splitTop(m[1]).map(norm),
    where: m[2].replace(/::text/g, '').replace(/\s+/g, ''),
  }));
}
function splitTop(list) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of list) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

async function sweepQueries() {
  mockQueries.length = 0;
  await worker.readUndeliveredCandidates({});
  await worker.readUntappedCandidates({});
  return mockQueries.filter((q) => q.table === 'coaching_sessions');
}

describe('every report-sweep lane has an index it can use', () => {
  test('the migration builds the indexes concurrently, outside a transaction', () => {
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    expect(indexes(sql).length).toBeGreaterThanOrEqual(2);
    expect(sql).not.toMatch(/^\s*BEGIN\b/im);
  });

  test('both sweeps read leader observations only — the indexes are partial on that', async () => {
    const queries = await sweepQueries();
    expect(queries.length).toBe(4); // awaiting_confirm, previewing, no_record, untapped
    for (const idx of indexes(fs.readFileSync(MIGRATION, 'utf8'))) {
      expect(idx.where).toContain("observation_type='leader_observation'");
    }
    for (const q of queries) expect(q.filters).toContainEqual(['eq', 'observation_type', 'leader_observation']);
  });

  test('each status lane leads with an indexed status expression', async () => {
    const idx = indexes(fs.readFileSync(MIGRATION, 'utf8'));
    const statusLanes = (await sweepQueries())
      .map((q) => q.filters.find((f) => f[0] === 'eq' && /->>status$/.test(f[1])))
      .filter(Boolean);
    expect(statusLanes.map((f) => f[2]).sort()).toEqual(['awaiting_confirm', 'awaiting_teacher_tap', 'previewing']);
    for (const [, col] of statusLanes) {
      const want = norm(sqlOf(col));
      // Leading column, and the partial WHERE is implied by an equality on it (IS NOT NULL).
      const hit = idx.find((i) => i.columns[0] === want && i.where.includes(`(${want})ISNOTNULL`));
      expect(hit).toBeTruthy();
    }
  });

  test('the no-record lane has a partial index on exactly its IS NULL', async () => {
    const idx = indexes(fs.readFileSync(MIGRATION, 'utf8'));
    const noRecord = (await sweepQueries())
      .map((q) => q.filters.find((f) => f[0] === 'is' && f[2] === null && !/->>/.test(f[1])))
      .filter(Boolean);
    expect(noRecord.length).toBe(1);
    const want = `(${norm(sqlOf(noRecord[0][1]))})ISNULL`;
    expect(idx.some((i) => i.where.includes(want))).toBe(true);
  });
});
