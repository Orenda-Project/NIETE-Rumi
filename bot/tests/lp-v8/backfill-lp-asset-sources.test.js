'use strict';
/**
 * PLAN R8 §2.2 (lane S) — `backfill-lp-asset-sources.js`.
 *
 * The corpus was uploaded long before anything wanted the slide script, so the
 * scripts for ~1,300 already-served lessons have to be recovered from the ICT K-5
 * curriculum matrix. The matrix is a spreadsheet people edit, so the only safe
 * import is one that PROVES the row is about the object we serve:
 *
 *   basename(lp_url) === "<the asset's own content_hash>.pdf"
 *
 * That check passed on 1,211 / 1,211 lessons taken in the week to 22 Sep 2026, so a
 * mismatch is not noise to be tolerated — it is a row about some other version, and
 * the whole point of the store is to refuse those. Everything else that can go wrong
 * gets its own named skip reason instead of a silent pass.
 *
 * fetch, supabase and fs are stubbed; the script's own logic runs.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const backfill = require('../../scripts/backfill-lp-asset-sources');

const LESSON = 'grade_2_math_ch3_seg4';
const HASH = 'abc123def456';
const STAMP = 'v8';
const R2_KEY = `lp-cache/v8/${LESSON}/${HASH}.pdf`;
const LP_URL = `https://pub-example.r2.dev/${R2_KEY}`;
const SS_URL = `https://pub-example.r2.dev/ict-k5-traces/${LESSON}/slide_script.json`;

const SCRIPT = {
  meta: { topic: 'Halves and quarters', isUrdu: false },
  iDo: { steps: [{ say: 'Two equal parts make halves.' }] },
  wrap: { exitOptions: ['a', 'b'] },
};

function asset(extra = {}) {
  return {
    id: 'asset-1', lesson_id: LESSON, version_stamp: STAMP, content_hash: HASH,
    r2_key: R2_KEY, asset_kind: 'lesson', is_current: true, ...extra,
  };
}

function inputRow(extra = {}) {
  return { lesson_id: LESSON, lp_url: LP_URL, slide_script_url: SS_URL, ...extra };
}

/** Supabase stub that pages like PostgREST does — `.range(from, to)` over a fixture list. */
function supabaseStub(rows, { pageSize = 500 } = {}) {
  const ranges = [];
  return {
    ranges,
    client: {
      from: () => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          range: (from, to) => {
            ranges.push([from, to]);
            chain._data = rows.slice(from, Math.min(to + 1, from + pageSize));
            return chain;
          },
          then: (resolve) => resolve({ data: chain._data || rows, error: null }),
        };
        return chain;
      },
    },
  };
}

function fetchStub(map) {
  const seen = [];
  const fn = async (url) => {
    seen.push(url);
    const hit = map[url];
    if (hit === undefined) return { ok: false, status: 404, text: async () => '' };
    if (hit instanceof Error) throw hit;
    if (typeof hit === 'object' && hit.status) return { ok: false, status: hit.status, text: async () => '' };
    return { ok: true, status: 200, text: async () => hit };
  };
  fn.seen = seen;
  return fn;
}

function store() {
  const calls = [];
  return { calls, upsertSource: async (row) => { calls.push(row); return { asset_id: row.asset_id }; } };
}

function writeInput(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-backfill-'));
  const p = path.join(dir, 'backfill_input.json');
  fs.writeFileSync(p, JSON.stringify(rows));
  return { dir, path: p };
}

const dirs = [];
afterAll(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* best effort */ } } });

function input(rows) { const w = writeInput(rows); dirs.push(w.dir); return w.path; }

const quiet = { log: () => {} };

describe('backfill-lp-asset-sources — the link gate', () => {
  test('a matrix row whose LP link IS the served object is imported as backfill:link', async () => {
    const sb = supabaseStub([asset()]);
    const st = store();
    const out = await backfill.run({
      inputPath: input([inputRow()]),
      dryRun: false,
      deps: { client: sb.client, fetch: fetchStub({ [SS_URL]: JSON.stringify(SCRIPT) }), sourceStore: st, ...quiet },
    });

    expect(st.calls).toHaveLength(1);
    expect(st.calls[0]).toEqual({
      asset_id: 'asset-1',
      lesson_id: LESSON,
      version_stamp: STAMP,
      content_hash: HASH,
      slide_script: SCRIPT,
      source_url: SS_URL,
      verified: 'backfill:link',
    });
    expect(out.written).toBe(1);
    expect(out.skipped).toEqual({});
  });

  test('a link pointing at a DIFFERENT version is skipped as link_mismatch and never fetched', async () => {
    const sb = supabaseStub([asset()]);
    const st = store();
    const f = fetchStub({ [SS_URL]: JSON.stringify(SCRIPT) });
    const out = await backfill.run({
      inputPath: input([inputRow({ lp_url: `https://pub-example.r2.dev/lp-cache/v8/${LESSON}/999999999999.pdf` })]),
      dryRun: false,
      deps: { client: sb.client, fetch: f, sourceStore: st, ...quiet },
    });
    expect(st.calls).toEqual([]);
    expect(f.seen).toEqual([]);
    expect(out.skipped).toEqual({ link_mismatch: 1 });
    expect(out.written).toBe(0);
  });

  test('the link must name the asset\'s own content_hash — an r2_key that disagrees with the hash is link_mismatch', async () => {
    // A row whose r2_key basename is not <content_hash>.pdf is a corrupt asset row; the
    // link matching the key alone would prove nothing about the bytes.
    const odd = asset({ r2_key: `lp-cache/v8/${LESSON}/0000aaaa0000.pdf` });
    const sb = supabaseStub([odd]);
    const st = store();
    const f = fetchStub({ [SS_URL]: JSON.stringify(SCRIPT) });
    const out = await backfill.run({
      inputPath: input([inputRow({ lp_url: `https://pub-example.r2.dev/lp-cache/v8/${LESSON}/0000aaaa0000.pdf` })]),
      dryRun: false,
      deps: { client: sb.client, fetch: f, sourceStore: st, ...quiet },
    });
    expect(st.calls).toEqual([]);
    expect(f.seen).toEqual([]);
    expect(out.skipped).toEqual({ link_mismatch: 1 });
  });

  test('the link must sit under the lesson\'s own lp-cache folder — another lesson\'s path is link_mismatch', async () => {
    const sb = supabaseStub([asset()]);
    const st = store();
    const out = await backfill.run({
      inputPath: input([inputRow({ lp_url: `https://pub-example.r2.dev/lp-cache/v8/grade_9_other_ch1_seg1/${HASH}.pdf` })]),
      dryRun: false,
      deps: { client: sb.client, fetch: fetchStub({ [SS_URL]: JSON.stringify(SCRIPT) }), sourceStore: st, ...quiet },
    });
    expect(st.calls).toEqual([]);
    expect(out.skipped).toEqual({ link_mismatch: 1 });
  });

  test('a query string or an encoded name on the LP link does not defeat the gate', async () => {
    const sb = supabaseStub([asset()]);
    const st = store();
    const out = await backfill.run({
      inputPath: input([inputRow({ lp_url: `${LP_URL}?download=1#page=2` })]),
      dryRun: false,
      deps: { client: sb.client, fetch: fetchStub({ [SS_URL]: JSON.stringify(SCRIPT) }), sourceStore: st, ...quiet },
    });
    expect(out.written).toBe(1);
    expect(st.calls).toHaveLength(1);
  });

  test('never guesses a URL: an input row with no slide-script link is skipped, not constructed', async () => {
    const sb = supabaseStub([asset()]);
    const st = store();
    const f = fetchStub({});
    const out = await backfill.run({
      inputPath: input([inputRow({ slide_script_url: '' })]),
      dryRun: false,
      deps: { client: sb.client, fetch: f, sourceStore: st, ...quiet },
    });
    expect(f.seen).toEqual([]);
    expect(st.calls).toEqual([]);
    expect(out.skipped).toEqual({ no_input_row: 1 });
  });
});

describe('backfill-lp-asset-sources — the named skip reasons', () => {
  test('an asset with no matrix row at all: no_input_row', async () => {
    const sb = supabaseStub([asset()]);
    const st = store();
    const out = await backfill.run({
      inputPath: input([]),
      dryRun: false,
      deps: { client: sb.client, fetch: fetchStub({}), sourceStore: st, ...quiet },
    });
    expect(out.skipped).toEqual({ no_input_row: 1 });
  });

  test('a matrix row for a lesson with no current asset: no_current_asset', async () => {
    const sb = supabaseStub([]);
    const st = store();
    const out = await backfill.run({
      inputPath: input([inputRow()]),
      dryRun: false,
      deps: { client: sb.client, fetch: fetchStub({}), sourceStore: st, ...quiet },
    });
    expect(out.skipped).toEqual({ no_current_asset: 1 });
  });

  test('a non-200 and a thrown request are both fetch_failed', async () => {
    const sb = supabaseStub([asset(), asset({ id: 'asset-2', lesson_id: 'grade_3_urdu_ch8_seg4', content_hash: 'ffff00001111', r2_key: 'lp-cache/v8/grade_3_urdu_ch8_seg4/ffff00001111.pdf' })]);
    const st = store();
    const out = await backfill.run({
      inputPath: input([
        inputRow(),
        { lesson_id: 'grade_3_urdu_ch8_seg4', lp_url: 'https://pub-example.r2.dev/lp-cache/v8/grade_3_urdu_ch8_seg4/ffff00001111.pdf', slide_script_url: 'https://pub-example.r2.dev/b.json' },
      ]),
      dryRun: false,
      deps: {
        client: sb.client,
        fetch: fetchStub({ [SS_URL]: { status: 403 }, 'https://pub-example.r2.dev/b.json': new Error('socket hang up') }),
        sourceStore: st,
        ...quiet,
      },
    });
    expect(st.calls).toEqual([]);
    expect(out.skipped).toEqual({ fetch_failed: 2 });
  });

  test('unparseable JSON is bad_json', async () => {
    const sb = supabaseStub([asset()]);
    const st = store();
    const out = await backfill.run({
      inputPath: input([inputRow()]),
      dryRun: false,
      deps: { client: sb.client, fetch: fetchStub({ [SS_URL]: '<html>403 forbidden</html>' }), sourceStore: st, ...quiet },
    });
    expect(st.calls).toEqual([]);
    expect(out.skipped).toEqual({ bad_json: 1 });
  });

  test('valid JSON that is not a slide script (no iDo / no meta) is bad_json', async () => {
    for (const body of [JSON.stringify({ meta: { topic: 'x' } }), JSON.stringify({ iDo: { steps: [] } }), JSON.stringify([1, 2, 3])]) {
      const sb = supabaseStub([asset()]);
      const st = store();
      const out = await backfill.run({
        inputPath: input([inputRow()]),
        dryRun: false,
        deps: { client: sb.client, fetch: fetchStub({ [SS_URL]: body }), sourceStore: st, ...quiet },
      });
      expect(st.calls).toEqual([]);
      expect(out.skipped).toEqual({ bad_json: 1 });
    }
  });

  test('every reason it reports is one of the five named ones', async () => {
    expect(backfill.SKIP_REASONS.slice().sort()).toEqual(
      ['bad_json', 'fetch_failed', 'link_mismatch', 'no_current_asset', 'no_input_row'],
    );
  });
});

describe('backfill-lp-asset-sources — the flags', () => {
  test('--dry-run fetches and gates but writes nothing', async () => {
    const sb = supabaseStub([asset()]);
    const st = store();
    const f = fetchStub({ [SS_URL]: JSON.stringify(SCRIPT) });
    const out = await backfill.run({
      inputPath: input([inputRow()]),
      dryRun: true,
      deps: { client: sb.client, fetch: f, sourceStore: st, ...quiet },
    });
    expect(f.seen).toEqual([SS_URL]);      // the link really was proven, not assumed
    expect(st.calls).toEqual([]);          // …and nothing was written
    expect(out).toMatchObject({ written: 0, wouldWrite: 1, dryRun: true });
  });

  test('--limit caps the lessons it touches', async () => {
    const assets = [];
    const rows = [];
    for (let i = 0; i < 5; i += 1) {
      const lid = `grade_1_english_ch1_seg${i}`;
      const h = `hash0000000${i}`;
      assets.push(asset({ id: `a-${i}`, lesson_id: lid, content_hash: h, r2_key: `lp-cache/v8/${lid}/${h}.pdf` }));
      rows.push({ lesson_id: lid, lp_url: `https://pub-example.r2.dev/lp-cache/v8/${lid}/${h}.pdf`, slide_script_url: `https://pub-example.r2.dev/${lid}.json` });
    }
    const sb = supabaseStub(assets);
    const st = store();
    const map = {};
    for (const r of rows) map[r.slide_script_url] = JSON.stringify(SCRIPT);
    const out = await backfill.run({
      inputPath: input(rows), dryRun: false, limit: 2,
      deps: { client: sb.client, fetch: fetchStub(map), sourceStore: st, ...quiet },
    });
    expect(st.calls).toHaveLength(2);
    expect(out.written).toBe(2);
  });

  test('parseArgs reads --input, --dry-run and --limit', () => {
    expect(backfill.parseArgs(['--input', '/tmp/in.json', '--dry-run', '--limit', '25']))
      .toEqual({ inputPath: '/tmp/in.json', dryRun: true, limit: 25 });
    expect(backfill.parseArgs(['--input', '/tmp/in.json'])).toEqual({ inputPath: '/tmp/in.json', dryRun: false, limit: null });
  });
});

describe('backfill-lp-asset-sources — reading every asset', () => {
  test('pages past the PostgREST 1000-row ceiling (the corpus is ~1,284 current lessons)', async () => {
    const assets = [];
    const rows = [];
    for (let i = 0; i < 1200; i += 1) {
      const lid = `grade_1_english_ch1_seg${i}`;
      const h = `h${String(i).padStart(11, '0')}`;
      assets.push(asset({ id: `a-${i}`, lesson_id: lid, content_hash: h, r2_key: `lp-cache/v8/${lid}/${h}.pdf` }));
      rows.push({ lesson_id: lid, lp_url: `https://pub-example.r2.dev/lp-cache/v8/${lid}/${h}.pdf`, slide_script_url: `https://pub-example.r2.dev/${lid}.json` });
    }
    const sb = supabaseStub(assets);
    const st = store();
    const map = {};
    for (const r of rows) map[r.slide_script_url] = JSON.stringify(SCRIPT);
    const out = await backfill.run({
      inputPath: input(rows), dryRun: false,
      deps: { client: sb.client, fetch: fetchStub(map), sourceStore: st, ...quiet },
    });
    expect(sb.ranges.length).toBeGreaterThan(1);
    expect(out.assets).toBe(1200);
    expect(out.written).toBe(1200);
  });
});
