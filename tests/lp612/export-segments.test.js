/**
 * bd-a8veu.24 — THE EXPORT THAT MAKES A VIDEO REFRESH NON-DESTRUCTIVE.
 *
 * `import-lp612-segments.js --yt-dir <dir>` is the only way a video pick reaches a teacher's page.
 * It needs TWO corpora: a BASE (`out/<book>_segments.json`, one file per book) and the swarm's
 * overlay. The base is not optional and it is not inert — `reconcilePlan` retires (`is_current =
 * false`) every id currently live for a book that the base does NOT name. A base drawn from a
 * re-segmentation run that moved a boundary therefore mints a new id, retires the old one, and
 * rebuilds the live menu underneath every render that already points at it.
 *
 * And the original base files are not on this machine. There is no `out/`, no `corpus_filled/`,
 * and no `*_segments.json` anywhere in the LP build tree.
 *
 * So the base is generated FROM THE TABLE. Then `incomingIds === existingIds` by construction: the
 * retire list is empty, every column except `yt` upserts to the value it already holds, and no
 * boundary can move because nothing re-reads a book.
 *
 * The three properties that make that true are what this file pins:
 *
 *   1. THE ROUND TRIP IS A FIXED POINT. `toRow(exported(toRow(s)))` === `toRow(s)`. Two fields
 *      make that non-trivial: `grade` and `also_grades` are BOTH derived from the single `grade`
 *      field via `parseGradeSpan`, so a row taught in two years must export as the span `"9-10"`
 *      or the second grade is silently lost; and `is_religious` is recomputed at import, so the
 *      text fields it reads have to survive.
 *
 *   2. `yt` IS EXPORTED NULL — always, even for a segment that holds a pick. This looks like data
 *      loss and is the opposite. `overlayYt` only ever SETS a pick, so a swarm rejection (named,
 *      `yt: null`) cannot clear anything by itself; the clearing is done by `mergeExistingYt`
 *      declining to carry the stored pick for a covered id. If the base carried the stored pick
 *      instead, that row arrives already filled, `hasPick` is true, nothing is withdrawn and the
 *      re-read the swarm just rejected is written straight back. The ~4,700 links from the
 *      2026-09-01 "best available link" rule are exactly the rows this protects.
 *
 *   3. A SHORT READ IS AN ERROR, NEVER A FILE. PostgREST truncates at `db-max-rows` and returns no
 *      error. Here a silently short read is the worst possible failure: every row it dropped is a
 *      row the next import retires. So the export is checked against an exact count and throws.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  toRow, validateSegment, reconcilePlan, readSegmentFiles, parseFile, overlayYt,
  mergeExistingYt, countWithdrawn, hasPick, TABLE,
} = require('../../bot/scripts/import-lp612-segments');

const { exportSegments } = require('../../bot/scripts/export-lp612-segments');

// ── a corpus ────────────────────────────────────────────────────────────────

/** A segment as the segmentation fleet writes one. */
const seg = (over = {}) => ({
  segment_id: 'grade_6_geography.c04.p063-064',
  book_stem: 'grade_6_geography',
  grade: 6,
  subject: 'Geography',
  medium: 'english',
  language: 'en',
  chapter_number: 4,
  chapter_title: 'Forests of Pakistan',
  chapter_key: 'grade_6_geography.c04',
  part: null,
  part_index: null,
  subtopic_title: 'Types of forest and where each one grows',
  menu_title: 'Types of forest',
  section_ref: '4.2',
  printed_page_start: 63,
  printed_page_end: 64,
  pages_covered: [63, 64],
  order_index: 12,
  day_number: 3,
  segment_index: 2,
  lp_type: 'content',
  skill_type: null,
  slo_text: 'Describe the main forest types of Pakistan.',
  slo_codes: ['GEO-6-4.2'],
  slo_descriptions: ['Describe the main forest types of Pakistan.'],
  slo_source: 'benchmark-csv',
  section: 'Forest types',
  revision_source_segments: [],
  prev_segment_id: 'grade_6_geography.c04.p061-062',
  next_segment_id: 'grade_6_geography.c04.p065-066',
  yt: null,
  notes: null,
  ...over,
});

/** The book taught to two years — one row, two grades, `grade: "9-10"`. */
const spanSeg = (over = {}) => seg({
  segment_id: 'grade_9_10_chemistry_experiment.c01.p003-005',
  book_stem: 'grade_9_10_chemistry_experiment',
  grade: '9-10',
  subject: 'Chemistry',
  chapter_number: 1,
  chapter_title: 'Working safely in the laboratory',
  chapter_key: 'grade_9_10_chemistry_experiment.c01',
  subtopic_title: 'Handling acids and bases safely',
  menu_title: 'Acids and bases',
  printed_page_start: 3,
  printed_page_end: 5,
  pages_covered: [3, 4, 5],
  order_index: 1,
  lp_type: 'practical',
  prev_segment_id: null,
  next_segment_id: null,
  slo_codes: ['CHEM-9-1.1', 'CHEM-10-1.1'],
  slo_descriptions: ['Handle laboratory acids safely.'],
  ...over,
});

/** A seerah segment in an Urdu reader — `is_religious` is recomputed, not carried. */
const religiousSeg = (over = {}) => seg({
  segment_id: 'grade_8_urdu.c07.p101-103',
  book_stem: 'grade_8_urdu',
  grade: 8,
  subject: 'Urdu',
  language: 'ur',
  medium: 'urdu',
  chapter_number: 7,
  chapter_title: 'سیرت النبی ﷺ',
  chapter_key: 'grade_8_urdu.c07',
  subtopic_title: 'مکہ سے مدینہ تک',
  menu_title: 'ہجرت',
  section_ref: null,
  printed_page_start: 101,
  printed_page_end: 103,
  pages_covered: [101, 102, 103],
  order_index: 22,
  slo_codes: [],
  slo_descriptions: [],
  slo_source: null,
  prev_segment_id: null,
  next_segment_id: null,
  ...over,
});

/** The table: what `toRow` would have written for each of those. */
function tableRows(segments) {
  return segments.map((s) => toRow(s, { corpusVersion: 'v1' }));
}

// ── a supabase stand-in ─────────────────────────────────────────────────────

/**
 * PostgREST's shape, including the two things that matter here: a builder is a THENABLE that also
 * chains, and `.range()` window-caps at the server's max rows WITHOUT reporting it.
 */
function fakeSupabase(rows, { maxRows = 1000, failOnPage = null } = {}) {
  const calls = { ranges: [], selects: [] };
  const client = {
    from(table) {
      expect(table).toBe(TABLE);
      return {
        select(cols, opts = {}) {
          calls.selects.push({ cols, opts });
          let set = rows.slice();
          const q = {
            eq(col, val) { set = set.filter((r) => r[col] === val); return q; },
            order(col) {
              set = set.slice().sort((a, b) => String(a[col]).localeCompare(String(b[col])));
              return q;
            },
            range(from, to) {
              calls.ranges.push([from, to]);
              const page = Math.floor(from / maxRows);
              if (failOnPage === page) {
                return Promise.resolve({ data: null, error: { message: 'connection reset' } });
              }
              const width = Math.min(to - from + 1, maxRows);
              return Promise.resolve({ data: set.slice(from, from + width), error: null });
            },
            // head:true — the count query
            then(resolve) { resolve({ data: null, count: set.length, error: null }); },
          };
          return q;
        },
      };
    },
  };
  return { client, calls };
}

function run(rows, opts) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-export-'));
  const { client, calls } = fakeSupabase(rows, opts);
  return { outDir, client, calls, done: exportSegments({ supabase: client, outDir }) };
}

// ── 1. the fixed point ──────────────────────────────────────────────────────

describe('the round trip is a fixed point', () => {
  const seeds = [seg(), spanSeg(), religiousSeg()];

  test('every column re-imports to the value it already held', async () => {
    const before = tableRows(seeds);
    const { outDir, done } = run(before);
    await done;

    const written = readSegmentFiles(outDir).flatMap((f) => parseFile(f).segments);
    const after = tableRows(written);

    const byId = (rs) => Object.fromEntries(rs.map((r) => {
      const { updated_at: _u, ...rest } = r;
      return [r.segment_id, rest];
    }));
    expect(byId(after)).toEqual(byId(before));
  });

  test('a row taught in two years exports as the SPAN, not as its primary grade', async () => {
    const { outDir, done } = run(tableRows([spanSeg()]));
    await done;

    const [written] = parseFile(readSegmentFiles(outDir)[0]).segments;
    expect(written.grade).toBe('9-10');

    const row = toRow(written);
    expect(row.grade).toBe(9);
    expect(row.also_grades).toEqual([10]);
  });

  test('every exported segment passes the importer\'s own validation', async () => {
    const { outDir, done } = run(tableRows(seeds));
    await done;

    for (const f of readSegmentFiles(outDir)) {
      for (const s of parseFile(f).segments) {
        expect(validateSegment(s)).toEqual({ errors: [], warnings: [] });
      }
    }
  });

  test('nothing is retired: the exported ids are exactly the live ids', async () => {
    const before = tableRows(seeds);
    const { outDir, done } = run(before);
    await done;

    for (const f of readSegmentFiles(outDir)) {
      const { segments } = parseFile(f);
      const bookStem = segments[0].book_stem;
      const plan = reconcilePlan({
        bookStem,
        incomingIds: segments.map((s) => s.segment_id),
        existingIds: before.filter((r) => r.book_stem === bookStem).map((r) => r.segment_id),
      });
      expect(plan.retire).toEqual([]);
    }
  });

  test('one file per book, named the way the importer looks for it', async () => {
    const { outDir, done } = run(tableRows(seeds));
    await done;

    expect(readSegmentFiles(outDir).map((f) => path.basename(f))).toEqual([
      'grade_6_geography_segments.json',
      'grade_8_urdu_segments.json',
      'grade_9_10_chemistry_experiment_segments.json',
    ]);
  });

  test('a retired row is not exported — the base names what is LIVE', async () => {
    const rows = tableRows(seeds);
    rows[0].is_current = false;
    const { outDir, done } = run(rows);
    await done;

    const ids = readSegmentFiles(outDir).flatMap((f) => parseFile(f).segments).map((s) => s.segment_id);
    expect(ids).not.toContain(seeds[0].segment_id);
    expect(ids).toHaveLength(2);
  });
});

// ── 2. the withdrawal contract ──────────────────────────────────────────────

describe('yt is exported null, so the swarm can still withdraw', () => {
  const PICK = { url: 'https://youtu.be/7E3NQRBDNXY', title: 'Reading pages 63-64 aloud' };

  test('a stored pick does NOT come back in the base file', async () => {
    const { outDir, done } = run(tableRows([seg({ yt: PICK })]));
    await done;

    const [written] = parseFile(readSegmentFiles(outDir)[0]).segments;
    expect(written.yt).toBeNull();
  });

  test('end to end: the swarm rejects a segment and the stored re-read is cleared', async () => {
    const stored = tableRows([seg({ yt: PICK })]);
    const { outDir, done } = run(stored);
    await done;

    // The base, as the importer would read it.
    const base = parseFile(readSegmentFiles(outDir)[0]).segments;

    // The swarm's verdict: it looked, and nothing enhanced the lesson. Named, no url.
    const filled = [{ segment_id: base[0].segment_id, yt: null }];
    const ytCovered = new Set(filled.map((y) => y.segment_id));

    const merged = overlayYt(base, filled);
    const rows = merged.map((s) => toRow(s));
    const existing = stored.map((r) => ({ segment_id: r.segment_id, yt: r.yt }));

    expect(countWithdrawn(rows, existing, ytCovered)).toBe(1);
    const carried = mergeExistingYt(rows, existing, ytCovered);
    expect(hasPick(carried[0].yt)).toBe(false);
  });

  test('end to end: a book the swarm has not reached keeps every pick it has', async () => {
    const stored = tableRows([seg({ yt: PICK })]);
    const { outDir, done } = run(stored);
    await done;

    const base = parseFile(readSegmentFiles(outDir)[0]).segments;
    const rows = base.map((s) => toRow(s));
    const existing = stored.map((r) => ({ segment_id: r.segment_id, yt: r.yt }));

    // No file for this book in --yt-dir: ytCovered is null, nothing was judged.
    expect(countWithdrawn(rows, existing, null)).toBe(0);
    const carried = mergeExistingYt(rows, existing, null);
    expect(carried[0].yt).toEqual(PICK);
  });
});

// ── 3. a short read is an error ─────────────────────────────────────────────

describe('a short read is an error, never a file', () => {
  /** 1,400 live rows across one book — more than one PostgREST window. */
  const many = () => tableRows(
    Array.from({ length: 1400 }, (_, i) => seg({
      segment_id: `grade_6_geography.c04.p${String(i).padStart(4, '0')}`,
      order_index: i,
      printed_page_start: i + 1,
      printed_page_end: i + 1,
      pages_covered: [i + 1],
    })),
  );

  test('a set larger than one window is read whole', async () => {
    const rows = many();
    const { outDir, done } = run(rows);
    await done;

    const written = readSegmentFiles(outDir).flatMap((f) => parseFile(f).segments);
    expect(written).toHaveLength(1400);
  });

  test('a failed page throws instead of writing a base that would retire the rest', async () => {
    const rows = many();
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-export-'));
    const { client } = fakeSupabase(rows, { failOnPage: 1 });

    await expect(exportSegments({ supabase: client, outDir })).rejects.toThrow(/read failed/i);
    expect(fs.readdirSync(outDir)).toEqual([]);
  });

  test('a read shorter than the count throws and writes nothing', async () => {
    const rows = many();
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-export-'));
    // The server hands back 1,000 and stops — the exact PostgREST truncation, no error.
    const { client } = fakeSupabase(rows.slice(0, 1000), { maxRows: 1000 });
    // ...while the count still says 1,400.
    const overstated = { eq: () => overstated, then: (res) => res({ data: null, count: 1400, error: null }) };
    const counting = {
      from: (t) => {
        const inner = client.from(t);
        return {
          select: (cols, opts = {}) => (opts.head ? overstated : inner.select(cols, opts)),
        };
      },
    };

    await expect(exportSegments({ supabase: counting, outDir })).rejects.toThrow(/1000 of 1400/);
    expect(fs.readdirSync(outDir)).toEqual([]);
  });
});

// ── 4. provenance ───────────────────────────────────────────────────────────

test('_meta records where the base came from, so nobody mistakes it for the fleet\'s output', async () => {
  const { outDir, done } = run(tableRows([seg()]));
  await done;

  const { meta } = parseFile(readSegmentFiles(outDir)[0]);
  expect(meta.source).toMatch(/niete_lp612_segments/);
  expect(meta.book_stem).toBe('grade_6_geography');
  expect(meta.segments).toBe(1);
  expect(meta.corpus_version).toEqual(['v1']);
  expect(typeof meta.exported_at).toBe('string');
});
