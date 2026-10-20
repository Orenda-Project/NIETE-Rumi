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

function fakeClient(rows = [], tocRows = []) {
  const calls = { select: [], upsert: [], update: [] };
  return {
    calls,
    from(table) {
      const source = table === 'textbook_toc' ? tocRows : rows;
      const query = (filters) => ({
        eq(col, val) { return query([...filters, (r) => r[col] === val]); },
        in(col, vals) {
          const all = [...filters, (r) => vals.includes(r[col])];
          return {
            // range() is only reachable through order(): paging an unordered select can skip or repeat rows.
            order(orderBy) {
              return {
                range(a, b) {
                  calls.select.push({ table, col, vals, orderBy, a, b });
                  const hit = source.filter((r) => all.every((f) => f(r)))
                    .sort((x, y) => (x[orderBy] < y[orderBy] ? -1 : x[orderBy] > y[orderBy] ? 1 : 0));
                  return Promise.resolve({ data: hit.slice(a, b + 1), error: null });
                },
              };
            },
          };
        },
      });
      return {
        select() { return query([]); },
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
    expect(client.calls.select.find((c) => c.table === 'assessment_topics')).toMatchObject({ table: 'assessment_topics', col: 'subject', vals: ['english'], orderBy: 'topic_id' });
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
    expect(client.calls.select.filter((c) => c.table === 'assessment_topics').length).toBe(4); // 100, 100, 100, then an empty page
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
      select: () => ({ eq() { return this; }, in: () => ({ order: () => ({ range: () => Promise.resolve({ data: [], error: null }) }) }) }),
      upsert: () => Promise.resolve({ error: { message: 'boom' } }),
    });
    await expect(run([dir, '--matrix-version', 'v1'], opts({ client }))).rejects.toThrow(/upsert failed: boom/);
  });

  test('a read error stops the run', async () => {
    const client = fakeClient();
    client.from = () => ({ select: () => ({ eq() { return this; }, in: () => ({ order: () => ({ range: () => Promise.resolve({ data: null, error: { message: 'nope' } }) }) }) }) });
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

describe('page check against textbook_toc', () => {
  const sampleTopic = () => topicsOf('english').find((t) => t.pages && t.pages.length);
  const tocFor = (t, start, end) => ({
    id: 1, curriculum: 'ict', grade: t.grade, subject: t.subject, chapter_number: t.chapterNumber, page_start: start, page_end: end,
  });
  const farAway = (t) => tocFor(t, Math.max(...t.pages) + 100, Math.max(...t.pages) + 110);
  const spanning = (t) => tocFor(t, Math.min(...t.pages), Math.max(...t.pages));
  const spilling = (t) => tocFor(t, Math.max(...t.pages), Math.max(...t.pages) + 5);

  test('reads textbook_toc (ict, imported subjects, ordered by id) before any write', async () => {
    const client = fakeClient([], []);
    await run([dir, '--matrix-version', 'v1', '--dry-run'], opts({ client }));
    const toc = client.calls.select.find((c) => c.table === 'textbook_toc');
    expect(toc).toMatchObject({ col: 'subject', vals: ['english', 'maths'], orderBy: 'id', a: 0 });
  });

  test('toc is paged like the existing read', async () => {
    const t = sampleTopic();
    const rows = Array.from({ length: 5 }, (_, i) => ({ ...spanning(t), id: i + 1, chapter_number: 900 + i }));
    const client = fakeClient([], rows);
    await run([dir, '--matrix-version', 'v1', '--dry-run'], opts({ client, pageSize: 2 }));
    expect(client.calls.select.filter((c) => c.table === 'textbook_toc').map((c) => c.a)).toEqual([0, 2, 4]);
  });

  test('a topic wholly outside blocks a load: nothing written, message names the count and the flag', async () => {
    const t = sampleTopic();
    const client = fakeClient([], [farAway(t)]);
    await expect(run([dir, '--matrix-version', 'v1'], opts({ client })))
      .rejects.toThrow(/\d+ topic.*outside.*(fix the matrix|--allow-page-errors)/s);
    expect(client.calls.upsert).toEqual([]);
    expect(client.calls.update).toEqual([]);
  });

  test('--allow-page-errors lets the load through and the run reports the counts', async () => {
    const t = sampleTopic();
    const client = fakeClient([], [farAway(t)]);
    const report = await run([dir, '--matrix-version', 'v1', '--allow-page-errors'], opts({ client }));
    expect(client.calls.upsert.length).toBeGreaterThan(0);
    expect(report.pageCheck.outside).toBeGreaterThan(0);
    expect(report.pageCheck).toEqual(expect.objectContaining({ spill: expect.any(Number), noRange: expect.any(Number) }));
  });

  test('--dry-run logs the findings and continues', async () => {
    const t = sampleTopic();
    const client = fakeClient([], [farAway(t)]);
    const report = await run([dir, '--matrix-version', 'v1', '--dry-run'], opts({ client }));
    const text = lines.join('\n');
    expect(text).toContain(`outside: ${t.topicId}`);
    expect(text).toMatch(/page check: \d+ outside, \d+ spill, \d+ no range/);
    expect(report.pageCheck.outside).toBeGreaterThan(0);
  });

  test('spill and no-range never block a load, and are logged', async () => {
    // english ch1 runs 2..11 in the fixture; a 2..9 book range makes its writing topic [4,5,6,10,11] spill.
    const spill = tocFor({ grade: 1, subject: 'english', chapterNumber: 1 }, 2, 9);
    const client = fakeClient([], [spill]);
    const report = await run([dir, '--matrix-version', 'v1'], opts({ client }));
    expect(client.calls.upsert.length).toBeGreaterThan(0);
    expect(report.pageCheck).toMatchObject({ outside: 0, spill: 1 });
    expect(report.pageCheck.noRange).toBeGreaterThan(0);
    const text = lines.join('\n');
    expect(text).toMatch(/spill: 1-english-1-writing\S+ G1 english ch1 pages \[4,5,6,10,11\] book 2-9 stray \[10,11\]/);
    expect(text).toMatch(/no range: .*G1 maths ch1/);
  });

  test('a clean chapter produces zero findings', async () => {
    const all = [...topicsOf('english'), ...topicsOf('maths')].filter((t) => t.pages && t.pages.length);
    const rows = all.map((t, i) => ({ ...spanning(t), id: i + 1 }));
    // widen each range to the union of its chapter's topics
    for (const r of rows) {
      const same = all.filter((t) => t.grade === r.grade && t.subject === r.subject && t.chapterNumber === r.chapter_number);
      r.page_start = Math.min(...same.flatMap((t) => t.pages));
      r.page_end = Math.max(...same.flatMap((t) => t.pages));
    }
    const client = fakeClient([], rows);
    const report = await run([dir, '--matrix-version', 'v1'], opts({ client }));
    expect(report.pageCheck.outside).toBe(0);
    expect(report.pageCheck.spill).toBe(0);
  });

  test('no client (dry-run without env): the check is skipped and says so', async () => {
    const report = await run([dir, '--matrix-version', 'v1', '--dry-run'], opts());
    expect(lines.join('\n')).toMatch(/page check skipped/);
    expect(report.pageCheck).toEqual({ outside: 0, spill: 0, noRange: 0 });
  });

  test('a textbook_toc read error stops the run', async () => {
    const client = fakeClient();
    const real = client.from;
    client.from = (table) => (table === 'textbook_toc'
      ? { select: () => ({ eq() { return this; }, in: () => ({ order: () => ({ range: () => Promise.resolve({ data: null, error: { message: 'toc down' } }) }) }) }) }
      : real(table));
    await expect(run([dir, '--matrix-version', 'v1', '--dry-run'], opts({ client }))).rejects.toThrow(/textbook_toc read failed: toc down/);
  });

  test('--allow-page-errors is not mistaken for the directory', async () => {
    const report = await run(['--allow-page-errors', dir, '--matrix-version', 'v1', '--dry-run'], opts());
    expect(report.upsert).toBeGreaterThan(0);
  });
});
