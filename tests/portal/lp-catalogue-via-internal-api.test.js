/**
 * bd-60063 — the portal's lesson-plan catalogue must be the BOT's catalogue.
 *
 * Before: dashboard/routes/portal.routes.js answered /curriculum/grades,
 * /subjects, /chapters and /lps with its own Supabase reads against
 * curriculum_lp_ast and pre_generated_lps. The bot's K-5 Flow answers the same
 * question from data/lp_catalog.json intersected with niete_lp_assets
 * (is_current). Those are unrelated corpora, not a superset and a subset.
 *
 * Measured on production 2026-09-08:
 *   curriculum_lp_ast  is_enabled   2485
 *   pre_generated_lps  is_current    317
 *   niete_lp_assets    lesson/current 1284
 * and PORTAL_INCLUDE_CORE_LPS is UNSET on the prod portal service, so
 * CORE_LPS_ENABLED=false hid the 2485 and the portal served only the 317.
 * Grade 5 maths: portal 0 chapters, bot 8 chapters / 87 lessons. That is the
 * "I only see chapter 3/4" report.
 *
 * After: the bot owns the answer behind /api/internal/lp/v8/*, and the portal
 * is a thin HTTP client — the certificates / training-rules pattern.
 *
 * Contract:
 *   1. The portal route file contains NO lesson-plan table reads.
 *   2. The portal client contains no catalogue logic — it asks and returns.
 *   3. The bot's browse service intersects catalogue with availability, so a
 *      lesson with no current asset is never offered.
 *   4. It returns FULL text, not the Flow's 30-code-point clipped rows.
 *   5. The per-teacher downloaded tick uses the same rule as the Flow.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ROUTES = path.join(REPO_ROOT, 'dashboard', 'routes', 'portal.routes.js');
const CLIENT = path.join(REPO_ROOT, 'dashboard', 'services', 'lp-catalogue.service.js');
const BROWSE = path.join(REPO_ROOT, 'bot', 'shared', 'services', 'lp-v8-browse.service.js');
const INTERNAL = path.join(REPO_ROOT, 'bot', 'shared', 'routes', 'internal-api.routes.js');

const read = (p) => fs.readFileSync(p, 'utf8');

/**
 * Source with comments stripped.
 *
 * These assertions are about what the code DOES, not what it says. Both files
 * document the corpora they no longer touch (that history is the point of the
 * docblocks), so a raw-text match would fail on the explanation itself.
 */
const code = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n');

describe('bd-60063 — the portal no longer owns LP catalogue logic', () => {
  test('the route file makes no lesson-plan table reads', () => {
    const src = code(ROUTES);
    // The two corpora the portal used to query directly.
    expect(src).not.toMatch(/from\(['"]curriculum_lp_ast['"]\)/);
    expect(src).not.toMatch(/from\(['"]pre_generated_lps['"]\)/);
  });

  test('the CORE_LPS_ENABLED flag is gone — the bot decides what exists', () => {
    const src = code(ROUTES);
    expect(src).not.toMatch(/CORE_LPS_ENABLED/);
    expect(src).not.toMatch(/PORTAL_INCLUDE_CORE_LPS/);
  });

  test('the curriculum routes delegate to the catalogue client', () => {
    const src = read(ROUTES);
    expect(src).toMatch(/require\(['"]\.\.\/services\/lp-catalogue\.service['"]\)/);
  });

  test('the client holds no catalogue rules — it asks the bot', () => {
    const src = code(CLIENT);
    expect(src).toMatch(/api\/internal\/lp\/v8/);
    // No direct DB access, and no re-implementation of availability.
    expect(src).not.toMatch(/supabase/i);
    expect(src).not.toMatch(/niete_lp_assets/);
    expect(src).toMatch(/MAIN_BOT_URL/);
    expect(src).toMatch(/INTERNAL_API_KEY/);
  });

  test('the bot exposes the four browse endpoints behind the shared key', () => {
    const src = read(INTERNAL);
    for (const p of ['lp/v8/grades', 'lp/v8/subjects', 'lp/v8/chapters', 'lp/v8/lessons']) {
      expect(src).toContain(p);
    }
    // Every one of them is key-gated, like the rest of this file.
    const block = src.slice(src.indexOf('lp/v8/grades'));
    expect(block).toMatch(/requireInternalKey/);
  });
});

describe('bd-60063 — the browse service intersects catalogue with availability', () => {
  const CATALOG = {
    catalog_version: 'v8',
    books: [
      {
        stem: 'grade_5_math',
        grade: 5,
        subject: 'Math',
        subject_key: 'math',
        rtl: false,
        chapters: [
          {
            number: 7,
            title: 'A chapter title far longer than thirty code points, truly',
            pages_label: 'p.90-104',
            lessons: [
              { lesson_id: 'g5m_ch7_s1', segment_index: 1, lp_type: 'content', day_label: 'Day 1', section: 'Sec A', topic: 'Topic A', pages_label: 'p.90' },
              { lesson_id: 'g5m_ch7_s2', segment_index: 2, lp_type: 'content', day_label: 'Day 2', section: 'Sec B', topic: 'Topic B', pages_label: 'p.92' },
            ],
          },
          {
            // Nothing servable here — must not be listed.
            number: 8,
            title: 'Unrendered chapter',
            pages_label: 'p.105-110',
            lessons: [{ lesson_id: 'g5m_ch8_s1', segment_index: 1, lp_type: 'content', topic: 'T', pages_label: 'p.105' }],
          },
        ],
      },
    ],
  };

  let Browse;
  let Catalog;
  let Delivery;

  beforeEach(() => {
    jest.resetModules();
    jest.doMock(path.join(REPO_ROOT, 'bot', 'shared', 'services', 'lp-v8-delivery.service.js'), () => ({
      availableLessonIds: jest.fn(async () => new Set(['g5m_ch7_s1', 'g5m_ch7_s2'])),
      downloadedLessonIds: jest.fn(async () => new Set(['g5m_ch7_s1'])),
    }), { virtual: false });

    Catalog = require(path.join(REPO_ROOT, 'bot', 'shared', 'services', 'lp-v8-catalog.service.js'));
    Catalog.__setCatalogForTests(CATALOG);
    Delivery = require(path.join(REPO_ROOT, 'bot', 'shared', 'services', 'lp-v8-delivery.service.js'));
    Browse = require(BROWSE);
  });

  afterEach(() => {
    if (Catalog && Catalog.__setCatalogForTests) Catalog.__setCatalogForTests(null);
  });

  test('a chapter with no servable lesson is not listed', async () => {
    const chapters = await Browse.listChapters(5, 'math');
    expect(chapters.map((c) => c.chapter_number)).toEqual([7]);
  });

  test('chapter titles come back in FULL, not clipped to the Flow cap', async () => {
    const [ch] = await Browse.listChapters(5, 'math');
    expect(ch.chapter_title).toBe('A chapter title far longer than thirty code points, truly');
    expect([...ch.chapter_title].length).toBeGreaterThan(30);
    expect(ch.chapter_title).not.toMatch(/…$/);
    expect(ch.lesson_count).toBe(2);
  });

  test('lessons carry the per-teacher downloaded tick', async () => {
    const lessons = await Browse.listLessons(5, 'math', 7, 'user-1');
    expect(lessons.map((l) => [l.lesson_id, l.downloaded])).toEqual([
      ['g5m_ch7_s1', true],
      ['g5m_ch7_s2', false],
    ]);
  });

  test('an unavailable lesson is never offered', async () => {
    const lessons = await Browse.listLessons(5, 'math', 8, 'user-1');
    expect(lessons).toEqual([]);
  });

  test('no userId means no tick, not a crash', async () => {
    const lessons = await Browse.listLessons(5, 'math', 7, null);
    expect(lessons.every((l) => l.downloaded === false)).toBe(true);
    expect(Delivery.downloadedLessonIds).not.toHaveBeenCalled();
  });

  test('subjects report only what is servable', async () => {
    const subjects = await Browse.listSubjects(5);
    expect(subjects).toEqual([
      { subject_key: 'math', subject: 'Math', rtl: false, lesson_count: 2 },
    ]);
  });
});
