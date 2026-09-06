/**
 * Loading the segmentation corpus into the menu table.
 *
 * The importer runs many times, not once: books finish over hours and the fleet
 * can be re-run on any of them. So the two properties that matter are that a
 * second run changes nothing, and that a re-run which MOVED a boundary retires
 * the segment it replaced instead of leaving both in the menu.
 *
 * The third thing tested here is the operator's hold. `is_religious` is computed
 * once, here, and stored — serving never re-derives it from a title — so this is
 * the only place the rule exists and the only place it can be got wrong.
 */

const Import = require('../../bot/scripts/import-lp612-segments');

const { isReligiousSegment, validateSegment, toRow, reconcilePlan } = Import;

const seg = (over = {}) => ({
  segment_id: 'grade_9_chemistry.c01.p007-008',
  book_stem: 'grade_9_chemistry',
  grade: 9,
  subject: 'Chemistry',
  medium: 'English',
  language: 'en',
  chapter_number: 1,
  chapter_title: 'Nature of Chemistry in Science',
  chapter_key: 'c01',
  subtopic_title: 'Definition of chemistry and its branches',
  menu_title: 'Branches of chemistry',
  printed_page_start: 7,
  printed_page_end: 8,
  pages_covered: [7, 8],
  order_index: 1,
  lp_type: 'content',
  ...over,
});

// ── the operator's hold ─────────────────────────────────────────────────────

describe('is_religious is computed at import and stored', () => {
  test('an Islamiat book is held whole', () => {
    expect(isReligiousSegment(seg({
      book_stem: 'grade_7_islamiat', subject: 'Islamiat',
    }))).toBe(true);
  });

  test.each([
    ['Islamiyat spelling', { subject: 'Islamiyat' }],
    ['Urdu subject name', { subject: 'اسلامیات' }],
    ['book stem only', { book_stem: 'grade_10_islamiat', subject: 'Religious Studies' }],
  ])('%s is held', (_label, over) => {
    expect(isReligiousSegment(seg(over))).toBe(true);
  });

  test('seerah content inside a NON-Islamiat book is held too', () => {
    // The hold is on content, not on a subject label. A seerah chapter in an
    // Urdu reader is exactly the case a subject-name check would miss.
    expect(isReligiousSegment(seg({
      book_stem: 'grade_8_urdu',
      subject: 'Urdu',
      chapter_title: 'سیرتِ نبوی ﷺ',
    }))).toBe(true);
    expect(isReligiousSegment(seg({
      book_stem: 'grade_8_english', subject: 'English',
      subtopic_title: 'The Seerah of the Prophet',
    }))).toBe(true);
  });

  test.each(['حدیث', 'قرآن', 'نعت', 'Hadith', 'Quran', 'Sunnah'])(
    'the marker %p holds a segment wherever it appears',
    (marker) => {
      expect(isReligiousSegment(seg({ subtopic_title: `Lesson on ${marker}` }))).toBe(true);
    },
  );

  test('ordinary science is NOT held — the hold must not swallow the corpus', () => {
    expect(isReligiousSegment(seg())).toBe(false);
    expect(isReligiousSegment(seg({ subject: 'Physics', chapter_title: 'Motion and Force' }))).toBe(false);
  });

  test('Pakistan Studies history is not held by an incidental word', () => {
    // Deliberate boundary: "Islamic civilisation" as history is not seerah, and
    // holding all of Pak Studies would silently remove a whole subject from the
    // menu rather than holding a lesson.
    expect(isReligiousSegment(seg({
      book_stem: 'grade_10_pak_studies_english',
      subject: 'Pakistan Studies',
      chapter_title: 'The Islamic civilisation in South Asia',
    }))).toBe(false);
  });
});

// ── validation ──────────────────────────────────────────────────────────────

describe('validation', () => {
  test('a well-formed segment passes clean', () => {
    expect(validateSegment(seg())).toEqual({ errors: [], warnings: [] });
  });

  test.each(['segment_id', 'book_stem', 'grade', 'subject', 'chapter_key',
    'subtopic_title', 'menu_title', 'printed_page_start', 'order_index'])(
    'a missing %s is an ERROR — the row cannot be imported',
    (field) => {
      const s = seg();
      delete s[field];
      expect(validateSegment(s).errors.length).toBeGreaterThan(0);
    },
  );

  test('a grade outside 6-12 is an error', () => {
    expect(validateSegment(seg({ grade: 5 })).errors.length).toBeGreaterThan(0);
    expect(validateSegment(seg({ grade: 13 })).errors.length).toBeGreaterThan(0);
  });

  test('an over-cap menu_title is a WARNING, not an error', () => {
    // The catalogue clips defensively at render time, so an over-cap title costs
    // a slightly clipped row, not a missing lesson. Reported so the corpus can
    // be fixed at source.
    const r = validateSegment(seg({ menu_title: 'x'.repeat(45) }));
    expect(r.errors).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/menu_title/);
  });

  test('caps are measured in code points, not bytes', () => {
    // 25 Urdu characters: well under the 30 cap, well over 30 bytes.
    const urdu = 'ا'.repeat(25);
    expect(validateSegment(seg({ menu_title: urdu })).warnings).toEqual([]);
    expect(Buffer.byteLength(urdu, 'utf8')).toBeGreaterThan(30);
  });

  test('an unknown lp_type is an error rather than a row the CHECK will reject', () => {
    expect(validateSegment(seg({ lp_type: 'lecture' })).errors.length).toBeGreaterThan(0);
  });
});

// ── the row ─────────────────────────────────────────────────────────────────

describe('the row that reaches the table', () => {
  test('carries the corpus fields through unchanged', () => {
    const row = toRow(seg(), { corpusVersion: 'v2' });
    expect(row).toMatchObject({
      segment_id: 'grade_9_chemistry.c01.p007-008',
      grade: 9,
      subject: 'Chemistry',
      chapter_key: 'c01',
      printed_page_start: 7,
      printed_page_end: 8,
      order_index: 1,
      corpus_version: 'v2',
      is_current: true,
      is_religious: false,
    });
  });

  test('a null yt is stored as null, not as an empty object', () => {
    // Serving reads `yt && yt.url`. An empty object would pass a truthiness
    // check and render an empty video line.
    expect(toRow(seg({ yt: null })).yt).toBeNull();
    expect(toRow(seg()).yt).toBeNull();
  });

  test('a filled yt is carried through whole', () => {
    const yt = { url: 'https://youtu.be/x', title: 'T', video_id: 'x' };
    expect(toRow(seg({ yt })).yt).toEqual(yt);
  });

  // ── the deterministic SLO/section enrichment pass ────────────────────────
  //
  // A pass over the finished corpus fills slo_codes, slo_descriptions, slo_source,
  // section and skill_type for every one of the 5,482 segments. These are the
  // curriculum spine the authoring brief quotes from, so a row that reaches the
  // table without them produces a lesson with no learning outcome to teach to.

  test('the SLO enrichment fields reach the row', () => {
    const row = toRow(seg({
      slo_codes: ['B-10-C01-01', 'B-10-C01-02'],
      slo_descriptions: ['Ingestion and digestion', 'The alimentary canal'],
      slo_source: 'house_minted',
      section: 'Nature of Chemistry',
    }));
    expect(row.slo_codes).toEqual(['B-10-C01-01', 'B-10-C01-02']);
    expect(row.slo_descriptions).toEqual(['Ingestion and digestion', 'The alimentary canal']);
    expect(row.slo_source).toBe('house_minted');
    expect(row.section).toBe('Nature of Chemistry');
  });

  test('the list fields default to [] and never to null', () => {
    // They are NOT NULL DEFAULT '{}' columns, matching pages_covered and
    // revision_source_segments. A null here fails the insert for the whole chunk.
    const row = toRow(seg());
    expect(row.slo_codes).toEqual([]);
    expect(row.slo_descriptions).toEqual([]);
  });

  test('a non-array slo_codes is coerced rather than passed to Postgres', () => {
    // The enrichment pass is deterministic, but the importer is the last gate
    // before a TEXT[] column, and a bare string there fails the entire batch.
    expect(toRow(seg({ slo_codes: 'B-10-C01-01' })).slo_codes).toEqual(['B-10-C01-01']);
    expect(toRow(seg({ slo_codes: null })).slo_codes).toEqual([]);
  });

  test('section_ref stays nullable — it is null for most of the corpus', () => {
    // 3,708 of 5,482 segments have no printed section number. `section` carries
    // the human label instead, and that one IS always present.
    expect(toRow(seg({ section_ref: null })).section_ref).toBeNull();
  });

  test('page numbers are taken verbatim — never recomputed from an offset', () => {
    // Three books in this corpus shift offset mid-book and one prints duplicate
    // page numbers. Recomputation is how a lesson opens the wrong pages.
    const row = toRow(seg({ printed_page_start: 140, printed_page_end: 144, pages_covered: [140, 141, 144] }));
    expect(row.printed_page_start).toBe(140);
    expect(row.pages_covered).toEqual([140, 141, 144]);
  });
});

// ── idempotency + reconcile ─────────────────────────────────────────────────

describe('re-running the importer', () => {
  test('a boundary that moved retires the segment it replaced', () => {
    // Ids are derived from the page range, so a re-segmented chapter produces
    // new ids. Leaving the old ones current would show a teacher two versions
    // of the same lesson.
    const plan = reconcilePlan({
      bookStem: 'grade_9_chemistry',
      incomingIds: ['grade_9_chemistry.c01.p007-009'],
      existingIds: ['grade_9_chemistry.c01.p007-008', 'grade_9_chemistry.c01.p010-011'],
    });
    expect(plan.retire.sort()).toEqual([
      'grade_9_chemistry.c01.p007-008',
      'grade_9_chemistry.c01.p010-011',
    ]);
  });

  test('an unchanged re-run retires nothing', () => {
    const ids = ['a', 'b', 'c'];
    expect(reconcilePlan({
      bookStem: 'x', incomingIds: ids, existingIds: ids,
    }).retire).toEqual([]);
  });

  test('a partial corpus does not retire the books it does not mention', () => {
    // Books finish over hours. Importing one must never touch another's rows.
    const plan = reconcilePlan({
      bookStem: 'grade_9_chemistry',
      incomingIds: ['grade_9_chemistry.c01.p007-008'],
      existingIds: ['grade_9_chemistry.c01.p007-008'],
    });
    expect(plan.retire).toEqual([]);
    expect(plan.bookStem).toBe('grade_9_chemistry');
  });
});

// ── the YouTube overlay ─────────────────────────────────────────────────────

/**
 * The picks land HOURS after the segments do.
 *
 * The segmentation fleet writes `out/<book>_segments.json` with `yt: null`; the
 * YouTube swarm writes `yt/corpus_filled/<book>_segments.json`, the same rows
 * with a pick attached, and it finishes book by book overnight. So the importer
 * has to be runnable in any order, any number of times, and the one thing it
 * must never do is run over a book from `out/` in the morning and wipe the
 * picks that landed at 3am.
 */

const { overlayYt, mergeExistingYt } = Import;

const withYt = (over = {}) => ({
  url: 'https://www.youtube.com/watch?v=pWLEUhu-60A',
  video_id: 'pWLEUhu-60A',
  title: 'Definition of Chemistry',
  channel: 'Chemistry Virus',
  ...over,
});

describe('overlaying YouTube picks onto a book', () => {
  test('a pick is attached to the segment with the same id', () => {
    const out = overlayYt(
      [seg({ segment_id: 'a', yt: null }), seg({ segment_id: 'b', yt: null })],
      [{ segment_id: 'a', yt: withYt() }],
    );
    expect(out[0].yt).toEqual(withYt());
    expect(out[1].yt).toBeNull();
  });

  test('a pick with no url is ignored rather than stored as furniture', () => {
    // The swarm writes a row for every segment it considered; only the ones it
    // actually resolved carry a url. An empty object would render an empty
    // video line on the page.
    const out = overlayYt([seg({ segment_id: 'a', yt: null })], [{ segment_id: 'a', yt: {} }]);
    expect(out[0].yt).toBeNull();
  });

  test('a segment the overlay does not mention keeps the yt it arrived with', () => {
    const out = overlayYt([seg({ segment_id: 'a', yt: withYt() })], [{ segment_id: 'z', yt: withYt() }]);
    expect(out[0].yt).toEqual(withYt());
  });
});

describe('a yt-less re-import must not wipe picks already in the table', () => {
  test('mergeExistingYt carries a stored pick forward over an incoming null', () => {
    const rows = [
      { segment_id: 'a', yt: null },
      { segment_id: 'b', yt: null },
    ];
    const merged = mergeExistingYt(rows, [{ segment_id: 'a', yt: withYt() }]);
    expect(merged.find((r) => r.segment_id === 'a').yt).toEqual(withYt());
    expect(merged.find((r) => r.segment_id === 'b').yt).toBeNull();
  });

  test('an incoming pick WINS over a stored one — a re-run is how a bad pick is replaced', () => {
    const fresh = withYt({ video_id: 'NEW', url: 'https://youtu.be/NEW' });
    const merged = mergeExistingYt(
      [{ segment_id: 'a', yt: fresh }],
      [{ segment_id: 'a', yt: withYt() }],
    );
    expect(merged[0].yt).toEqual(fresh);
  });
});

// ── the real thing: importFile against a fake table ─────────────────────────

/**
 * Executes importFile itself rather than its helpers, because the bug this
 * guards against lives in the ORDER of the calls: the read of existing picks
 * has to happen before the upsert, on the same ids, or the carry-forward is a
 * no-op that every unit test above still passes.
 */
function fakeSupabase(existingRows = []) {
  const table = new Map(existingRows.map((r) => [r.segment_id, { ...r }]));
  const calls = { upserts: [], selects: 0 };
  const api = {
    from() { return api; },
    upsert(rows) {
      calls.upserts.push(rows);
      for (const r of rows) table.set(r.segment_id, { ...table.get(r.segment_id), ...r });
      return Promise.resolve({ error: null });
    },
    select(cols) {
      calls.selects += 1;
      api._cols = cols;
      return api;
    },
    eq(col, val) {
      api._filter = { col, val };
      return Promise.resolve({
        data: [...table.values()].filter((r) => r[col] === val && r.is_current !== false),
        error: null,
      }).then((x) => x);
    },
    in(col, vals) {
      return Promise.resolve({
        data: [...table.values()].filter((r) => vals.includes(r[col])),
        error: null,
      });
    },
    update() { return api; },
    _table: table,
    _calls: calls,
  };
  // `.eq(...).eq(...)` in the reconcile read: make eq chainable AND thenable.
  api.eq = (col, val) => {
    const rows = () => [...table.values()].filter((r) => r[col] === val);
    const chain = {
      eq: (c2, v2) => Promise.resolve({
        data: rows().filter((r) => r[c2] === v2),
        error: null,
      }),
      then: (res) => Promise.resolve({ data: rows(), error: null }).then(res),
    };
    return chain;
  };
  return api;
}

const emptyReport = () => ({
  files: 0, upserted: 0, retired: 0, wouldUpsert: 0, ytFilled: 0,
  errors: [], warnings: [], flaggedByText: [],
});

describe('importFile keeps picks that are already in the table', () => {
  test('re-importing a book from the yt-less corpus does not null its picks', async () => {
    const supabase = fakeSupabase([
      { segment_id: 'grade_9_chemistry.c01.p007-008', book_stem: 'grade_9_chemistry', yt: withYt(), is_current: true },
    ]);
    const report = emptyReport();

    await Import.importFile({
      supabase,
      file: 'grade_9_chemistry_segments.json',
      segments: [seg({ segment_id: 'grade_9_chemistry.c01.p007-008', yt: null })],
      corpusVersion: 'v1',
      dryRun: false,
      report,
    });

    const upserted = supabase._calls.upserts.flat()
      .find((r) => r.segment_id === 'grade_9_chemistry.c01.p007-008');
    expect(upserted.yt).toEqual(withYt());
  });

  test('a first import of a book with no picks still writes null', async () => {
    const supabase = fakeSupabase([]);
    const report = emptyReport();
    await Import.importFile({
      supabase,
      file: 'x_segments.json',
      segments: [seg({ segment_id: 'new.c01.p001-002', yt: null })],
      corpusVersion: 'v1',
      dryRun: false,
      report,
    });
    expect(supabase._calls.upserts.flat()[0].yt).toBeNull();
  });
});
