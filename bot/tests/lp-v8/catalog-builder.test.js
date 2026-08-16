/**
 * FEAT-059 / bd-82qs3 — LP catalog builder (TDD, red first).
 *
 * Two halves:
 *   1. Pure normalisation functions, tested on the real strings that blow the
 *      Meta NavigationList caps (measured 2026-08-16: 470 of 637 distinct
 *      sections exceed 30 code points, 320 of 2,038 topic+pages strings exceed
 *      80). Fixtures are verbatim from the segmentation corpus.
 *   2. The committed catalog artifact (bot/data/lp_catalog.json) — every row of
 *      all 2,038 lessons asserted against the caps, so a future book that blows
 *      a cap fails the build and not the teacher's screen.
 *
 * Caps (verified against production NavigationList code — see
 * DELIVERY_WIRING_PLAN.md §2): 20 items/screen, title 30, description 20,
 * metadata 80 — all measured in CODE POINTS (Rule 20).
 */

const fs = require('fs');
const path = require('path');

const B = require('../../scripts/build-lp-catalog');

const CATALOG_PATH = path.join(__dirname, '..', '..', 'data', 'lp_catalog.json');

// Meta NavigationList caps
const TITLE_CAP = 30;
const TICK_HEADROOM = 2;              // "✓ " prefixed at serve time
const SECTION_CAP = TITLE_CAP - TICK_HEADROOM;
const DESC_CAP = 20;
const META_CAP = 80;
const ITEMS_PER_SCREEN = 20;
const PAGINATION_CAPACITY = (ITEMS_PER_SCREEN - 1) + ITEMS_PER_SCREEN; // 19 + 20

const cps = (s) => [...String(s)].length;

describe('lp-catalog: pure normalisation', () => {
  describe('dedupeTopic — the section must not appear twice on one row', () => {
    test('strips a trailing parenthetical section', () => {
      expect(B.dedupeTopic('All About Me: Key Words (Memory Lane)', 'Memory Lane'))
        .toBe('All About Me: Key Words');
    });

    test('strips a trailing parenthetical for a COMPOUND section', () => {
      expect(B.dedupeTopic(
        "Name It, Sort It & Make My 'This Is Me!' Poster (Imagination Canvas + Connect and Create)",
        'Imagination Canvas + Connect and Create',
      )).toBe("Name It, Sort It & Make My 'This Is Me!' Poster");
    });

    test('strips a leading "Section: " form', () => {
      expect(B.dedupeTopic(
        'Chapter Review: Hello World! — spiral the key words',
        'Chapter Review',
      )).toBe('Hello World! — spiral the key words');
    });

    test('leaves a topic alone when the section is not embedded', () => {
      expect(B.dedupeTopic('Introducing Myself', 'Diving Deeper')).toBe('Introducing Myself');
    });

    test('never returns empty — falls back to the raw topic', () => {
      expect(B.dedupeTopic('Memory Lane', 'Memory Lane')).toBe('Memory Lane');
    });
  });

  describe('shortSection — a <=28 cp row title', () => {
    test('keeps a short section verbatim', () => {
      expect(B.shortSection('Memory Lane')).toBe('Memory Lane');
    });

    test('collapses a compound section to its first part with a "+" marker', () => {
      expect(B.shortSection('Discovery Playground + Skill Sharpener')).toBe('Discovery Playground +');
    });

    test('collapses a slash-compound section too', () => {
      expect(B.shortSection('Imagination Canvas / Connect and Create')).toBe('Imagination Canvas +');
    });

    test('strips an English gloss from an Urdu section', () => {
      expect(B.shortSection('پورا سبق (whole chapter)')).toBe('پورا سبق');
      expect(B.shortSection('جائزہ (student-facing worksheet)')).toBe('جائزہ');
      expect(B.shortSection('تشخیصی ورقہ (student-facing assessment worksheet)')).toBe('تشخیصی ورقہ');
    });

    test('strips a "Topic N ·" prefix', () => {
      expect(B.shortSection("Topic 1 · What's the Science + Skill Sharpener"))
        .toBe("What's the Science +");
      expect(B.shortSection('Topic 1 - Adventure Begins')).toBe('Adventure Begins');
    });

    test('the worst real section in the corpus fits the cap', () => {
      const worst = 'Practice Questions + Discovery Playground + Skill Sharpener'; // 59 cp raw
      expect(cps(B.shortSection(worst))).toBeLessThanOrEqual(SECTION_CAP);
    });

    test('clips with an ellipsis only as a last resort', () => {
      const long = 'A'.repeat(50);
      const out = B.shortSection(long);
      expect(cps(out)).toBe(SECTION_CAP);
      expect(out.endsWith('…')).toBe(true);
    });
  });

  describe('pagesLabel', () => {
    test('single page', () => expect(B.pagesLabel([2])).toBe('p.2'));
    test('contiguous range', () => expect(B.pagesLabel([4, 5, 6])).toBe('p.4-6'));
    test('non-contiguous collapses to first-last', () => expect(B.pagesLabel([1, 2, 9])).toBe('p.1-9'));
    test('empty', () => expect(B.pagesLabel([])).toBe(''));
  });

  describe('lpTypeFor — derived from segment_index, never read from the source', () => {
    // lp_type is null in 12 of the 17 books, so reading it is not an option.
    test('990 is the chapter review', () => expect(B.lpTypeFor(990)).toBe('revision'));
    test('995 is the assessment worksheet', () => expect(B.lpTypeFor(995)).toBe('assessment'));
    test('everything else is content', () => {
      expect(B.lpTypeFor(1)).toBe('content');
      expect(B.lpTypeFor(24)).toBe('content');
    });
  });

  describe('dayLabelFor — the <=20 cp description', () => {
    test('content lessons are Day N', () => expect(B.dayLabelFor(3, 'content')).toBe('Day 3'));
    test('990 reads as Revision', () => expect(B.dayLabelFor(990, 'revision')).toBe('Revision'));
    test('995 reads as Worksheet', () => expect(B.dayLabelFor(995, 'assessment')).toBe('Worksheet'));
  });

  describe('subjectKey — grade_1_maths and grade_3_math are the same subject', () => {
    test('maths collapses to math', () => expect(B.subjectKey('Maths')).toBe('math'));
    test('math stays math', () => expect(B.subjectKey('Math')).toBe('math'));
    test('general science slugs', () => expect(B.subjectKey('General Science')).toBe('general_science'));
    test('english / urdu', () => {
      expect(B.subjectKey('English')).toBe('english');
      expect(B.subjectKey('Urdu')).toBe('urdu');
    });
  });

  describe('buildRow — the assembled NavigationList row', () => {
    const lesson = {
      segment_index: 3,
      section: 'Diving Deeper',
      topic: 'Introducing Myself (Diving Deeper)',
      pages: [4, 5, 6],
    };

    test('title is the short section, description the day label, metadata topic + pages', () => {
      const row = B.buildRow(lesson, { rtl: false });
      expect(row.title).toBe('Diving Deeper');
      expect(row.description).toBe('Day 3');
      expect(row.metadata).toBe('Introducing Myself · p.4-6');
    });

    test('metadata is clipped to 80 cp on the worst real lesson in the corpus', () => {
      // grade_1_urdu ch6 seg6 — 221 cp raw
      const row = B.buildRow({
        segment_index: 6,
        section: 'جانیں اور تخلیق کریں',
        topic: 'لفظی اور ہندسی گنتی لکھنا — اعداد اور ان کے الفاظ کی لکھائی  ⟢  تصویری جملے — تصاویر کو عنوان دینا اور جملے لکھنا (ذاتی صفائی و کلاس روم) / جانیں اور تخلیق کریں — منصوبہ: گنتی',
        pages: [52, 53, 54, 55, 56, 57],
      }, { rtl: true });
      expect(cps(row.metadata)).toBeLessThanOrEqual(META_CAP);
      expect(cps(row.title)).toBeLessThanOrEqual(SECTION_CAP);
    });

    test('a multi-clause topic is cut at the first separator, not mid-word', () => {
      const row = B.buildRow({
        segment_index: 4,
        section: 'Discovery Playground',
        topic: 'Transport of Water in Plants: how does water reach the leaves? (hook) → Coloured-Water Investigation',
        pages: [10, 11, 12, 13],
      }, { rtl: false });
      expect(row.metadata).not.toContain('→');
      expect(cps(row.metadata)).toBeLessThanOrEqual(META_CAP);
    });

    test('a slash INSIDE a parenthetical is not a clause separator', () => {
      // Real defect found on grade_2_urdu ch1 seg5: the Urdu grammar list
      // "(ے / یں / وں)" was cut at the first " / ", leaving "واحد جمع (ے" —
      // a dangling bracket and a mangled word in a teacher-facing row.
      const row = B.buildRow({
        segment_index: 5,
        section: 'قواعد کا میدان',
        topic: 'قواعد — واحد جمع (ے / یں / وں کے ساتھ)',
        pages: [6, 7],
      }, { rtl: true });
      expect(row.metadata).toContain('وں');
      expect(row.metadata).not.toMatch(/\([^)]*$/);
    });

    test('clipping never leaves a dangling open bracket', () => {
      const row = B.buildRow({
        segment_index: 3,
        section: 'Grammar Playground',
        topic: 'Sentence Features: Gap Attack (Capital Letters, Full Stops & Missing Words in a Long Trailing Clause)',
        pages: [29, 30],
      }, { rtl: false });
      const opens = (row.metadata.match(/\(/g) || []).length;
      const closes = (row.metadata.match(/\)/g) || []).length;
      expect(opens).toBe(closes);
      expect(cps(row.metadata)).toBeLessThanOrEqual(META_CAP);
    });

    test('assessment boilerplate "(student, fillable)" is dropped, not clipped into', () => {
      const row = B.buildRow({
        segment_index: 995,
        section: 'Assessment',
        topic: "Chapter 9 Assessment Worksheet — 'Festive Fun in Taleemabad!' (student, fillable)",
        pages: [110, 122],
      }, { rtl: false });
      expect(row.metadata).not.toContain('student');
      expect(row.metadata).toContain('Festive Fun in Taleemabad!');
      expect(cps(row.metadata)).toBeLessThanOrEqual(META_CAP);
    });

    test('the Urdu assessment boilerplate is dropped too', () => {
      const row = B.buildRow({
        segment_index: 995,
        section: 'Assessment',
        topic: 'سبق 1 کا جائزہ ورک شیٹ (طالبِ علم، پُر کرنے والا)',
        pages: [1, 9],
      }, { rtl: true });
      expect(row.metadata).not.toContain('طالبِ علم');
      expect(row.metadata).toContain('جائزہ ورک شیٹ');
    });

    test('RTL rows carry an LTR mark before the page reference', () => {
      const row = B.buildRow({ segment_index: 2, section: 'متن کا سفر', topic: 'نظم کی بلند خوانی', pages: [5, 6, 7, 8] }, { rtl: true });
      expect(row.metadata).toContain('‎ · p.');
    });

    test('LTR rows carry no LTR mark', () => {
      const row = B.buildRow(lesson, { rtl: false });
      expect(row.metadata).not.toContain('‎');
    });
  });
});

describe('lp-catalog: the committed artifact (bot/data/lp_catalog.json)', () => {
  let catalog;

  beforeAll(() => {
    catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  });

  const eachLesson = (fn) => {
    for (const book of catalog.books) {
      for (const ch of book.chapters) {
        for (const lesson of ch.lessons) fn(lesson, ch, book);
      }
    }
  };

  test('covers the whole corpus — 17 books, 233 chapters, 2038 lessons', () => {
    expect(catalog.catalog_version).toBe('v8');
    expect(catalog.books).toHaveLength(17);
    expect(catalog.counts.chapters).toBe(233);
    expect(catalog.counts.lessons).toBe(2038);
    let chapters = 0; let lessons = 0;
    for (const b of catalog.books) { chapters += b.chapters.length; for (const c of b.chapters) lessons += c.lessons.length; }
    expect(chapters).toBe(catalog.counts.chapters);
    expect(lessons).toBe(catalog.counts.lessons);
  });

  test('every row.title fits 28 cp so the ✓/○ tick always fits', () => {
    const over = [];
    eachLesson((l) => { if (cps(l.row.title) > SECTION_CAP) over.push([l.lesson_id, cps(l.row.title), l.row.title]); });
    expect(over).toEqual([]);
  });

  test('every row.description fits 20 cp', () => {
    const over = [];
    eachLesson((l) => { if (cps(l.row.description) > DESC_CAP) over.push([l.lesson_id, cps(l.row.description)]); });
    expect(over).toEqual([]);
  });

  test('every row.metadata fits 80 cp', () => {
    const over = [];
    eachLesson((l) => { if (cps(l.row.metadata) > META_CAP) over.push([l.lesson_id, cps(l.row.metadata)]); });
    expect(over).toEqual([]);
  });

  test('every chapter title_short fits 30 cp', () => {
    const over = [];
    for (const b of catalog.books) for (const c of b.chapters) {
      if (cps(c.title_short) > TITLE_CAP) over.push([b.stem, c.number, cps(c.title_short)]);
    }
    expect(over).toEqual([]);
  });

  test('no book exceeds 20 chapters (one chapter screen, no pagination there)', () => {
    for (const b of catalog.books) expect(b.chapters.length).toBeLessThanOrEqual(ITEMS_PER_SCREEN);
  });

  test('no chapter exceeds the 39-lesson pagination capacity', () => {
    const over = [];
    for (const b of catalog.books) for (const c of b.chapters) {
      if (c.lessons.length > PAGINATION_CAPACITY) over.push([b.stem, c.number, c.lessons.length]);
    }
    expect(over).toEqual([]);
  });

  test('grade_1_maths ch3 is the single chapter over 20 lessons — the pagination case', () => {
    const book = catalog.books.find((b) => b.stem === 'grade_1_maths');
    const ch3 = book.chapters.find((c) => c.number === 3);
    expect(ch3.lessons.length).toBe(24);
    const big = [];
    for (const b of catalog.books) for (const c of b.chapters) {
      if (c.lessons.length > ITEMS_PER_SCREEN) big.push(`${b.stem}_ch${c.number}`);
    }
    expect(big).toEqual(['grade_1_maths_ch3']);
  });

  test('lesson_id is unique and matches {stem}_ch{N}_seg{M}', () => {
    const seen = new Set();
    eachLesson((l, c, b) => {
      expect(l.lesson_id).toBe(`${b.stem}_ch${c.number}_seg${l.segment_index}`);
      expect(seen.has(l.lesson_id)).toBe(false);
      seen.add(l.lesson_id);
    });
    expect(seen.size).toBe(catalog.counts.lessons);
  });

  test('every chapter carries a 990 revision and a 995 assessment', () => {
    const missing = [];
    for (const b of catalog.books) for (const c of b.chapters) {
      const idx = c.lessons.map((l) => l.segment_index);
      if (!idx.includes(990)) missing.push(`${b.stem}_ch${c.number}:990`);
      if (!idx.includes(995)) missing.push(`${b.stem}_ch${c.number}:995`);
    }
    expect(missing).toEqual([]);
  });

  test('lp_type is derived, so it is never null even in the 12 books that lack the source field', () => {
    eachLesson((l) => {
      expect(['content', 'revision', 'assessment']).toContain(l.lp_type);
      if (l.segment_index === 990) expect(l.lp_type).toBe('revision');
      if (l.segment_index === 995) expect(l.lp_type).toBe('assessment');
    });
  });

  test('subject_key collapses maths/math — g1 and g3 maths share one key', () => {
    const g1 = catalog.books.find((b) => b.stem === 'grade_1_maths');
    const g3 = catalog.books.find((b) => b.stem === 'grade_3_math');
    expect(g1.subject_key).toBe('math');
    expect(g3.subject_key).toBe('math');
  });

  test('no topic still carries its own section name (the dedupe actually ran)', () => {
    const dupes = [];
    eachLesson((l) => {
      if (!l.section) return;
      const first = String(l.section).split(/\s*[+/]\s*/)[0].trim();
      if (first && l.topic.toLowerCase().includes(`(${first.toLowerCase()})`)) {
        dupes.push([l.lesson_id, l.section, l.topic]);
      }
    });
    expect(dupes).toEqual([]);
  });

  test('lesson ids in the catalog match the rendered MANIFEST ids exactly', () => {
    // The v8 render manifest lives outside the repo; when present, cross-check.
    const manifest = process.env.LP_V8_MANIFEST;
    if (!manifest || !fs.existsSync(manifest)) {
      // eslint-disable-next-line no-console
      console.log('LP_V8_MANIFEST not set — cross-check skipped (offline/CI)');
      return;
    }
    const ids = new Set();
    eachLesson((l) => ids.add(l.lesson_id));
    const unknown = [];
    for (const line of fs.readFileSync(manifest, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const id = JSON.parse(line).id;
      if (id && !ids.has(id)) unknown.push(id);
    }
    expect(unknown).toEqual([]);
  });

  test('no row.metadata in the whole corpus has a dangling bracket', () => {
    const bad = [];
    eachLesson((l) => {
      const m = l.row.metadata;
      const opens = (m.match(/\(/g) || []).length;
      const closes = (m.match(/\)/g) || []).length;
      if (opens !== closes) bad.push([l.lesson_id, m]);
    });
    expect(bad).toEqual([]);
  });

  test('no row.metadata leaks the BRACKETED assessment boilerplate', () => {
    // Only the bracketed suffix "(student, fillable)" / "(طالبِ علم، پُر کرنے والا)"
    // is boilerplate. 17 Urdu 995 topics use "طالب علم ورک شیٹ" as ordinary
    // prose ("student worksheet") — that is real content and must survive.
    const bad = [];
    eachLesson((l) => {
      if (/\([^)]*(?:student|طالبِ?\s*علم)/u.test(l.row.metadata)) bad.push([l.lesson_id, l.row.metadata]);
    });
    expect(bad).toEqual([]);
  });

  test('the build is deterministic — same inputs, byte-identical output', () => {
    const seg = process.env.LP_SEGMENTATION_DIR;
    const toc = process.env.LP_TOC_DIR;
    if (!seg || !toc || !fs.existsSync(seg)) {
      // eslint-disable-next-line no-console
      console.log('LP_SEGMENTATION_DIR/LP_TOC_DIR not set — determinism check skipped (offline/CI)');
      return;
    }
    const a = B.serialise(B.buildCatalog({ segmentationDir: seg, tocDir: toc, builtAt: 'FIXED' }));
    const b = B.serialise(B.buildCatalog({ segmentationDir: seg, tocDir: toc, builtAt: 'FIXED' }));
    expect(a).toBe(b);
    // and it still matches what is committed, modulo built_at + absolute source paths
    const committed = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    const rebuilt = JSON.parse(a);
    expect(rebuilt.books).toEqual(committed.books);
  });

  test('Urdu books mark rtl so the page reference is not reordered', () => {
    const urdu = catalog.books.filter((b) => b.subject_key === 'urdu');
    expect(urdu.length).toBe(5);
    for (const b of urdu) expect(b.rtl).toBe(true);
    const eng = catalog.books.find((b) => b.subject_key === 'english');
    expect(eng.rtl).toBe(false);
  });
});

// ─── Staging feedback round 1 (bd-fel74) ────────────────────────────────────
describe('staging feedback: chapter page span + full section in metadata', () => {
  test('buildRow: a section past the title cap lands IN FULL in metadata, range terminal', () => {
    const longSection = 'ہم آہنگ آوازوں والے الفاظ کی شناخت اور استعمال';
    expect(cps(longSection)).toBeGreaterThan(SECTION_CAP);
    const row = B.buildRow(
      { segment_index: 2, section: longSection, topic: 'کہانی سنیں اور سمجھیں', pages: [7, 8] },
      { rtl: true },
    );
    expect(cps(row.title)).toBeLessThanOrEqual(SECTION_CAP);
    expect(row.metadata).toContain(longSection);
    expect(row.metadata).toMatch(/p\.7-8$/);
    expect(cps(row.metadata)).toBeLessThanOrEqual(META_CAP);
  });

  test('buildRow: a section that FITS the title stays out of metadata (no duplication)', () => {
    const row = B.buildRow(
      { segment_index: 1, section: 'Memory Lane', topic: 'Counting to five', pages: [3] },
      { rtl: false },
    );
    expect(row.title).toBe('Memory Lane');
    expect(row.metadata).not.toContain('Memory Lane');
  });

  test('committed catalog: every chapter carries pages_label spanning ALL its lessons', () => {
    const cat = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    let checked = 0;
    for (const book of cat.books) {
      for (const ch of book.chapters) {
        const pages = ch.lessons.flatMap((l) => l.pages || []).filter(Number.isFinite);
        if (!pages.length) continue;
        const lo = Math.min(...pages);
        const hi = Math.max(...pages);
        expect(ch.pages_label).toBe(lo === hi ? `p.${lo}` : `p.${lo}-${hi}`);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});
