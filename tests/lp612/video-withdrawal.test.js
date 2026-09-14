/**
 * bd-a8veu.12 — a withdrawn video pick must STAY withdrawn.
 *
 * THE OPERATOR'S DECISION (2026-09-12), on item 4 of the v9.3 PDF review — *"videos should have
 * enhancement mateiral for the SLo not just reading the same passage as on the textbook or solving
 * the same exercises"*: **option 2.** Keep the every-LP ambition, but let the slot be EMPTY rather
 * than filled with a re-read. The swarm gets an enhancement test it must pass — the video has to
 * show something the printed page cannot — and returns NO pick when nothing passes.
 *
 * THE CHAIN THAT PRODUCED THE RE-READS, for whoever reads this next:
 *   `inputs/02_enrichment/lp_format_requirements_6_12.md:174` — "No video link unless the topic is
 *   one teachers flag as difficult … Most LPs carry none" — was overridden at
 *   `schema/lp_doc.schema.json`: "every LP, all subjects, best available link, validated live".
 *   Once every LP must carry one, the BEST AVAILABLE link for a Grade 6 geography passage on
 *   Pakistan's forest types is a read-through of that passage. There is nothing else.
 *
 * THE RENDERER ALREADY HANDLES AN EMPTY SLOT. Two green tests say so — `'NO pick means NO line and
 * no empty label'` (video-resources-slot.test.js) and `'no pick, no line'` (video-enhancement.test.js).
 * Nothing in `lint_lp.js` gates on video either. So the decision costs the renderer nothing.
 *
 * WHAT IT DOES COST IS THE IMPORTER, and that is what this suite is about.
 *
 * `mergeExistingYt` (import-lp612-segments.js) carries a stored pick forward over an incoming null.
 * It exists for a real reason, stated in its own header: the corpora land in the wrong order on
 * purpose, and a morning top-up re-imported from `out/` carries `yt: null` for every row, so without
 * the carry-forward that top-up is also the deletion of ~4,700 video links.
 *
 * But the function is handed only rows, so it cannot tell that top-up apart from a DELIBERATE
 * WITHDRAWAL by a re-run swarm — and under option 2 a withdrawal is the normal outcome for every
 * descriptive topic in the corpus. Its comment claims "an INCOMING pick still wins", which holds
 * only for a re-run that supplies a REPLACEMENT. A re-run that supplies nothing is silently undone,
 * and — in the words of that same header — "nothing would report it". The operator could never
 * clear a re-read.
 *
 * THE SIGNAL, and why it is not `hasPick`: the swarm writes a `yt` slot for every segment it
 * CONSIDERED; only the ones it resolved carry a url (`hasPick`, :246). A considered-and-rejected row
 * — present in the filled corpus, no url — IS the withdrawal. So coverage is "the filled corpus
 * named this segment_id", deliberately WITHOUT a hasPick filter, and it is scoped per BOOK by the
 * file that named it: a book the swarm has not reached has no file, withdraws nothing, and keeps
 * every pick it has.
 *
 * DRIVEN THROUGH `main()` ON PURPOSE. The bug is not in any one helper — each of `overlayYt`,
 * `importFile` and `mergeExistingYt` is individually correct. It is in what `main()` knows and does
 * not pass on. Only the DB client is stubbed, which is the network boundary; every other line here
 * is the real one.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// ── the network boundary, and nothing above it ──────────────────────────────
// `main()` lazily requires the client singleton. Swapping THAT is the one seam a
// test is allowed: the importer, the overlay and the merge all run for real.
let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockDb.from(...a),
}));

const {
  main, TABLE,
} = require('../../bot/scripts/import-lp612-segments');

// ── fixtures ────────────────────────────────────────────────────────────────

const REREAD = {
  url: 'https://www.youtube.com/watch?v=RRRRRRRRRRR',
  video_id: 'RRRRRRRRRRR',
  title: 'Forest Types of Pakistan — full chapter read aloud',
  channel: 'Textbook Reader',
};

const ENHANCEMENT = {
  url: 'https://www.youtube.com/watch?v=EEEEEEEEEEE',
  video_id: 'EEEEEEEEEEE',
  title: 'Timelapse: an alpine forest through four seasons',
  channel: 'Nature Pakistan',
};

const seg = (over = {}) => ({
  segment_id: 'grade_6_geography.c04.p063-064',
  book_stem: 'grade_6_geography',
  grade: 6,
  subject: 'Geography',
  medium: 'English',
  language: 'en',
  chapter_number: 4,
  chapter_title: 'Natural Vegetation',
  chapter_key: 'c04',
  subtopic_title: 'Forest types of Pakistan',
  menu_title: 'Forest types',
  printed_page_start: 63,
  printed_page_end: 64,
  pages_covered: [63, 64],
  order_index: 1,
  lp_type: 'content',
  yt: null,
  ...over,
});

/** A second book, so per-book coverage can be told apart from a per-run flag. */
const otherSeg = (over = {}) => seg({
  segment_id: 'grade_9_chemistry.c01.p007-008',
  book_stem: 'grade_9_chemistry',
  grade: 9,
  subject: 'Chemistry',
  chapter_number: 1,
  chapter_title: 'Nature of Chemistry in Science',
  chapter_key: 'c01',
  subtopic_title: 'Definition of chemistry and its branches',
  menu_title: 'Branches of chemistry',
  printed_page_start: 7,
  printed_page_end: 8,
  pages_covered: [7, 8],
  ...over,
});

// ── the corpus on disk ──────────────────────────────────────────────────────
// Two trees with the same basenames, exactly as the two fleets write them:
// `out/<book>_segments.json` and `yt/corpus_filled/<book>_segments.json`.

let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'lp612-yt-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

function corpus({ out, yt }) {
  const outDir = path.join(root, 'out');
  const ytDir = path.join(root, 'yt', 'corpus_filled');
  fs.mkdirSync(outDir, { recursive: true });
  const write = (dir, book, segments) =>
    fs.writeFileSync(path.join(dir, `${book}_segments.json`), JSON.stringify({ segments }));
  for (const [book, segments] of Object.entries(out)) write(outDir, book, segments);
  if (yt) {
    fs.mkdirSync(ytDir, { recursive: true });
    for (const [book, segments] of Object.entries(yt)) write(ytDir, book, segments);
  }
  return { outDir, ytDir: yt ? ytDir : null };
}

/**
 * The table, as a Map, with only the four call shapes the importer actually makes:
 *   select('segment_id, yt').in(…)            — the existing-pick read
 *   upsert(rows, {onConflict})                — the write
 *   select('segment_id').eq(…).eq(…)          — the reconcile read
 *   update({…}).in(…)                         — the retire
 */
function fakeDb(existingRows = []) {
  const table = new Map(existingRows.map((r) => [r.segment_id, { ...r }]));
  const upserts = [];
  const rowsWhere = (col, val) => [...table.values()].filter((r) => r[col] === val);

  const api = {
    from() { return api; },
    upsert(rows) {
      upserts.push(...rows);
      for (const r of rows) table.set(r.segment_id, { ...table.get(r.segment_id), ...r });
      return Promise.resolve({ error: null });
    },
    select() {
      return {
        in: (col, vals) => Promise.resolve({
          data: [...table.values()].filter((r) => vals.includes(r[col])), error: null,
        }),
        // `.eq(book_stem).eq(is_current)` — chainable, and thenable at either link.
        eq: (c1, v1) => ({
          eq: (c2, v2) => Promise.resolve({ data: rowsWhere(c1, v1).filter((r) => r[c2] === v2), error: null }),
          then: (res) => Promise.resolve({ data: rowsWhere(c1, v1), error: null }).then(res),
        }),
      };
    },
    update(patch) {
      return {
        in: (col, vals) => {
          for (const r of table.values()) if (vals.includes(r[col])) Object.assign(r, patch);
          return Promise.resolve({ error: null });
        },
      };
    },
    _upserts: upserts,
    _table: table,
  };
  return api;
}

/** The row the importer WROTE for an id — the artefact, not the fixture. */
const wrote = (id) => mockDb._upserts.find((r) => r.segment_id === id);

const run = (dirs, extra = []) =>
  main([dirs.outDir, ...(dirs.ytDir ? ['--yt-dir', dirs.ytDir] : []), ...extra]);

// Silence the import report; these tests assert on rows, not on stdout.
let log;
beforeEach(() => { log = jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { log.mockRestore(); });

describe('the swarm re-runs a book and withdraws a re-read', () => {
  test('the stored pick is CLEARED, not carried forward', async () => {
    // The morning after the operator's decision: the swarm re-scores grade 6 geography against the
    // enhancement test, the chapter read-aloud fails it, and the filled corpus names the segment
    // with no url. That is a withdrawal, and it has to reach the table.
    mockDb = fakeDb([{ segment_id: seg().segment_id, yt: REREAD }]);
    const dirs = corpus({
      out: { grade_6_geography: [seg()] },
      yt: { grade_6_geography: [{ segment_id: seg().segment_id, yt: null }] },
    });

    await run(dirs);

    expect(wrote(seg().segment_id).yt).toBeNull();
    expect(mockDb._table.get(seg().segment_id).yt).toBeNull();
  });

  test('a withdrawal is COUNTED, so the run does not clear links silently', async () => {
    mockDb = fakeDb([{ segment_id: seg().segment_id, yt: REREAD }]);
    const report = await run(corpus({
      out: { grade_6_geography: [seg()] },
      yt: { grade_6_geography: [{ segment_id: seg().segment_id, yt: null }] },
    }));

    expect(report.ytWithdrawn).toBe(1);
    expect(report.ytFilled).toBe(0);
  });

  test('a REPLACEMENT still wins — that is how a bad pick gets swapped, not just dropped', async () => {
    mockDb = fakeDb([{ segment_id: seg().segment_id, yt: REREAD }]);
    const report = await run(corpus({
      out: { grade_6_geography: [seg()] },
      yt: { grade_6_geography: [{ segment_id: seg().segment_id, yt: ENHANCEMENT }] },
    }));

    expect(wrote(seg().segment_id).yt).toEqual(ENHANCEMENT);
    expect(report.ytWithdrawn).toBe(0);
    expect(report.ytFilled).toBe(1);
  });
});

describe('the carry-forward that already existed is untouched', () => {
  test('a segments-only top-up with NO --yt-dir still keeps every stored pick', async () => {
    // The reason mergeExistingYt exists. Nothing about option 2 may put those ~4,700 links back at
    // risk: no filled corpus was read, so this run withdraws nothing.
    mockDb = fakeDb([{ segment_id: seg().segment_id, yt: REREAD }]);
    const report = await run(corpus({ out: { grade_6_geography: [seg()] } }));

    expect(wrote(seg().segment_id).yt).toEqual(REREAD);
    expect(report.ytWithdrawn).toBe(0);
    expect(report.ytFilled).toBe(1);
  });

  test('a book the swarm has not reached keeps its picks, even beside one it has', async () => {
    // Coverage is per BOOK, by the file that names the segment — not a per-run flag. Chemistry has
    // a filled corpus this morning and geography does not; geography's pick must survive.
    mockDb = fakeDb([
      { segment_id: seg().segment_id, yt: REREAD },
      { segment_id: otherSeg().segment_id, yt: REREAD },
    ]);
    const report = await run(corpus({
      out: { grade_6_geography: [seg()], grade_9_chemistry: [otherSeg()] },
      yt: { grade_9_chemistry: [{ segment_id: otherSeg().segment_id, yt: null }] },
    }));

    expect(wrote(seg().segment_id).yt).toEqual(REREAD);
    expect(wrote(otherSeg().segment_id).yt).toBeNull();
    expect(report.ytWithdrawn).toBe(1);
  });

  test('a segment the filled corpus does not mention keeps its pick', async () => {
    // The swarm re-ran the book but only re-scored one of its two lessons. Silence about a segment
    // is not a withdrawal of it.
    const second = seg({ segment_id: 'grade_6_geography.c04.p065-066', order_index: 2, printed_page_start: 65, printed_page_end: 66 });
    mockDb = fakeDb([
      { segment_id: seg().segment_id, yt: REREAD },
      { segment_id: second.segment_id, yt: REREAD },
    ]);
    await run(corpus({
      out: { grade_6_geography: [seg(), second] },
      yt: { grade_6_geography: [{ segment_id: seg().segment_id, yt: null }] },
    }));

    expect(wrote(seg().segment_id).yt).toBeNull();
    expect(wrote(second.segment_id).yt).toEqual(REREAD);
  });
});

describe('the table is the thing that was asserted', () => {
  test('the fake is wired to the importer — a plain run writes the row it read', async () => {
    // Guards the suite itself: every assertion above reads `_upserts`, so an importer that silently
    // upserted nothing would pass them all by returning `undefined.yt`.
    mockDb = fakeDb();
    const report = await run(corpus({ out: { grade_6_geography: [seg()] } }));
    expect(report.upserted).toBe(1);
    expect(mockDb._upserts.map((r) => r.segment_id)).toEqual([seg().segment_id]);
    expect(TABLE).toBe('niete_lp612_segments');
  });
});
