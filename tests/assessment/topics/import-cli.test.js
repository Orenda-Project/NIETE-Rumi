'use strict';
/** Task 4 — the topic importer CLI, driven with a fake Supabase client and a tmp dir of small CSVs. No live DB. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, parseCsv, toCsv } = require('../../../bot/scripts/import-assessment-topics');
const { toRow } = require('../../../bot/shared/services/assessment/topics/reconcile');
const { parseMatrixTab } = require('../../../bot/shared/services/assessment/topics/matrix-rows');
const { groupAll } = require('../../../bot/shared/services/assessment/topics/group');
const sample = require('./fixtures/matrix-sample.json');

const NOW = '2026-10-20T00:00:00.000Z';
const topicsOf = (subject) => groupAll(subject, parseMatrixTab(sample[subject], subject));

function fakeClient(rows = []) {
  const calls = { select: [], upsert: [], update: [] };
  return {
    calls,
    from(table) {
      return {
        select(cols) {
          return {
            in(col, vals) {
              return {
                // range() is only reachable through order(): paging an unordered select can skip or repeat rows.
                order(orderBy) {
                  return {
                    range(a, b) {
                      calls.select.push({ table, cols, col, vals, orderBy, a, b });
                      const hit = rows.filter((r) => vals.includes(r[col]))
                        .sort((x, y) => (x[orderBy] < y[orderBy] ? -1 : x[orderBy] > y[orderBy] ? 1 : 0));
                      return Promise.resolve({ data: hit.slice(a, b + 1), error: null });
                    },
                  };
                },
              };
            },
          };
        },
        upsert(chunk, opts) { calls.upsert.push({ table, chunk, opts }); return Promise.resolve({ error: null }); },
        update(patch) {
          return { in(col, ids) { calls.update.push({ table, patch, col, ids }); return Promise.resolve({ error: null }); } };
        },
      };
    },
  };
}

let dir;
let lines;
const log = (s) => lines.push(s);
const writeTab = (name, subject) => fs.writeFileSync(path.join(dir, `${name}.csv`), toCsv(sample[subject]));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topics-cli-'));
  lines = [];
  writeTab('English', 'english');
  writeTab('Maths', 'maths');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const opts = (extra = {}) => ({ log, env: {}, now: NOW, ...extra });

describe('parseCsv / toCsv', () => {
  test('handles quoted commas, doubled quotes, newlines inside quotes and CRLF', () => {
    expect(parseCsv('a,"b,c","say ""hi""","x\ny"\r\n1,,3\r\n')).toEqual([['a', 'b,c', 'say "hi"', 'x\ny'], ['1', '', '3']]);
  });
  test('a last line without a newline is kept; a blank trailing line is not a row', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseCsv('a\n\n')).toEqual([['a'], ['']]);
  });
  test('toCsv quotes only cells that need it and round-trips', () => {
    const rows = [['plain', 'a,b', 'q"x', 'l\nm', ''], ['1', null, undefined, 'z', ' ']];
    expect(toCsv(rows)).toBe('plain,"a,b","q""x","l\nm",\n1,,,z, \n');
    expect(parseCsv(toCsv(rows))).toEqual([['plain', 'a,b', 'q"x', 'l\nm', ''], ['1', '', '', 'z', ' ']]);
  });
});

describe('--dry-run', () => {
  test('writes nothing and prints counts per grade × subject', async () => {
    const client = fakeClient();
    const report = await run([dir, '--matrix-version', 'v1', '--dry-run'], opts({ client }));
    expect(client.calls.upsert).toEqual([]);
    expect(client.calls.update).toEqual([]);
    const english = topicsOf('english');
    const maths = topicsOf('maths');
    expect(report.counts).toEqual({ '1 english': english.length, '1 maths': maths.length });
    expect(lines.join('\n')).toContain(`G1 english  ${english.length}`);
    expect(lines.join('\n')).toContain(`G1 maths  ${maths.length}`);
    expect(lines.join('\n')).toMatch(/DRY RUN/);
    expect(report.upsert).toBe(english.length + maths.length);
  });

  test('with no client and no SUPABASE env, treats existing as empty and still reports', async () => {
    const report = await run([dir, '--matrix-version', 'v1', '--dry-run'], opts());
    expect(report.upsert).toBe(topicsOf('english').length + topicsOf('maths').length);
    expect(report.retire).toBe(0);
  });

  test('with a client, reads existing rows for the imported subjects to show the diff', async () => {
    const english = topicsOf('english');
    const stored = english.map((t) => toRow(t, 'v0', NOW));
    stored.push(toRow({ ...english[0], topicId: '1-english-1-gone' }, 'v0', NOW));
    stored.push(toRow({ ...topicsOf('maths')[0], topicId: '1-maths-1-other' }, 'v0', NOW));
    fs.rmSync(path.join(dir, 'Maths.csv'));
    const client = fakeClient(stored);
    const report = await run([dir, '--matrix-version', 'v1', '--dry-run'], opts({ client }));
    expect(client.calls.select[0]).toMatchObject({ table: 'assessment_topics', col: 'subject', vals: ['english'], orderBy: 'topic_id' });
    expect(report).toMatchObject({ upsert: 0, retire: 1 });
    expect(client.calls.upsert).toEqual([]);
  });
});

describe('--review', () => {
  test('writes one row per topic: grade, subject, chapter, heading, name, days, pages, SLO codes', async () => {
    const out = path.join(dir, 'review.csv');
    await run([dir, '--matrix-version', 'v1', '--dry-run', '--review', out], opts());
    const rows = parseCsv(fs.readFileSync(out, 'utf8'));
    expect(rows[0]).toEqual(['grade', 'subject', 'chapter', 'heading', 'name', 'days', 'pages', 'slo_codes']);
    const topics = [...topicsOf('english'), ...topicsOf('maths')];
    expect(rows).toHaveLength(topics.length + 1);
    const t = topics[0];
    expect(rows[1]).toEqual([
      String(t.grade), t.subject, String(t.chapterNumber), t.heading || '', t.name,
      t.days.join(', '), t.pages.join(', '), t.sloCodes.join(', '),
    ]);
  });
});

describe('load (no --dry-run)', () => {
  test('upserts on topic_id in chunks of 250 and retires missing ids', async () => {
    const english = topicsOf('english');
    const stored = [toRow({ ...english[0], topicId: '1-english-1-gone' }, 'v0', NOW)];
    const client = fakeClient(stored);
    const report = await run([dir, '--matrix-version', 'v2'], opts({ client }));
    const all = client.calls.upsert.flatMap((c) => c.chunk);
    expect(all).toHaveLength(english.length + topicsOf('maths').length);
    for (const c of client.calls.upsert) {
      expect(c.table).toBe('assessment_topics');
      expect(c.opts).toEqual({ onConflict: 'topic_id' });
      expect(c.chunk.length).toBeLessThanOrEqual(250);
    }
    expect(all[0]).toMatchObject({ topic_id: english[0].topicId, matrix_version: 'v2', is_current: true, updated_at: NOW });
    expect(client.calls.update).toEqual([{
      table: 'assessment_topics', patch: { is_current: false, updated_at: NOW }, col: 'topic_id', ids: ['1-english-1-gone'],
    }]);
    expect(report).toMatchObject({ upsert: all.length, retire: 1 });
  });

  test('more than 250 topics are split into chunks', async () => {
    const big = Array.from({ length: 300 }, (_, i) => ({ topic_id: `x${i}`, subject: 'english', grade: 9, is_current: true }));
    const client = fakeClient(big);
    await run([dir, '--matrix-version', 'v2'], opts({ client, pageSize: 100 }));
    expect(client.calls.select.length).toBe(4); // 100, 100, 100, then an empty page
    const retired = client.calls.update.map((u) => u.ids.length);
    expect(retired).toEqual([]); // grade 9 is outside the imported (grade, subject) pairs
  });

  test('retire ids are chunked at 250', async () => {
    const gone = Array.from({ length: 260 }, (_, i) => ({ topic_id: `1-english-1-gone-${i}`, subject: 'english', grade: 1, is_current: true }));
    const client = fakeClient(gone);
    await run([dir, '--matrix-version', 'v2'], opts({ client }));
    expect(client.calls.update.map((u) => u.ids.length)).toEqual([250, 10]);
  });

  test('a load without a client or SUPABASE env refuses', async () => {
    await expect(run([dir, '--matrix-version', 'v1'], opts())).rejects.toThrow(/SUPABASE_URL/);
  });

  test('a DB error stops the load', async () => {
    const client = fakeClient();
    client.from = () => ({
      select: () => ({ in: () => ({ order: () => ({ range: () => Promise.resolve({ data: [], error: null }) }) }) }),
      upsert: () => Promise.resolve({ error: { message: 'boom' } }),
    });
    await expect(run([dir, '--matrix-version', 'v1'], opts({ client }))).rejects.toThrow(/upsert failed: boom/);
  });

  test('a read error stops the run', async () => {
    const client = fakeClient();
    client.from = () => ({ select: () => ({ in: () => ({ order: () => ({ range: () => Promise.resolve({ data: null, error: { message: 'nope' } }) }) }) }) });
    await expect(run([dir, '--matrix-version', 'v1', '--dry-run'], opts({ client }))).rejects.toThrow(/read failed: nope/);
  });
});

describe('arguments', () => {
  test('needs a directory and --matrix-version', async () => {
    await expect(run(['--dry-run'], opts())).rejects.toThrow(/usage/);
    await expect(run([dir, '--dry-run'], opts())).rejects.toThrow(/--matrix-version/);
  });
  test('a directory with none of the four tabs is an error', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'topics-empty-'));
    await expect(run([empty, '--matrix-version', 'v1', '--dry-run'], opts())).rejects.toThrow(/English\.csv/);
    fs.rmSync(empty, { recursive: true, force: true });
  });
  test('only the tabs present are imported, and the skipped ones are named', async () => {
    fs.rmSync(path.join(dir, 'Maths.csv'));
    const report = await run([dir, '--matrix-version', 'v1', '--dry-run'], opts());
    expect(Object.keys(report.counts)).toEqual(['1 english']);
    expect(lines.join('\n')).toMatch(/skipped.*Urdu\.csv.*Maths\.csv.*Science\.csv/);
  });
});
