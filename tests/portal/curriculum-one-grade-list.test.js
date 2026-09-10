/**
 * bd-60083 — ONE Lesson Plans tab, grades 1 through 12.
 *
 * The first cut of the 6-12 lane shipped as a separate "Grades 6-12" tab, on the reasoning that
 * the two corpora behave differently: K-5 lessons are pre-rendered PDFs you open, 6-12 lessons
 * may still have to be WRITTEN. The operator's call was that this is an implementation detail
 * and a teacher should see one lesson-plan picker. She is right — the split was the portal
 * showing its seams.
 *
 * WHAT MAKES THIS RISKY, AND SO WHAT THIS FILE PINS. Merging the lanes means one grade dropdown
 * where the SAME control reaches two different services with two different addressing schemes:
 *
 *   |            | grades 1-5                  | grades 6-12                  |
 *   |------------|-----------------------------|------------------------------|
 *   | subject    | subject_key ('math')        | display name ('Mathematics') |
 *   | chapter    | chapter_number (7)          | chapter_key ('c07')          |
 *   | lesson     | lesson_id                   | segment_id                   |
 *   | the action | open a PDF                  | maybe author it, ~3 min      |
 *
 * A grade that routes to the wrong lane does not throw — it sends 'Mathematics' where 'math'
 * was expected and renders an empty dropdown, which reads as "there are no lesson plans for
 * grade 9". That is the failure this guards.
 */

const fs = require('fs');
const path = require('path');

const PAGE = path.join(
  __dirname, '..', '..', 'portal', 'src', 'portal', 'pages', 'PortalCurriculum.tsx',
);
const src = fs.readFileSync(PAGE, 'utf8');

/** Source with comments stripped — these assertions are about behaviour, not prose. */
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n');

describe('there is one Lesson Plans tab, not two', () => {
  test('the separate 6-12 tab is gone', () => {
    expect(code).not.toContain('library612');
    expect(code).not.toContain('Grades 6-12<');
    // And the panel it used to hold is deleted rather than orphaned — a second, unreachable
    // implementation of the same feature is how the two drift apart later.
    expect(code).not.toContain('Lp612Panel');
    expect(fs.existsSync(path.join(
      __dirname, '..', '..', 'portal', 'src', 'portal', 'components', 'Lp612Panel.tsx',
    ))).toBe(false);
  });

  test('exactly two tabs remain: lesson plans and the assessment generator', () => {
    const triggers = code.match(/<TabsTrigger value="([a-z0-9]+)"/g) || [];
    expect(triggers).toHaveLength(2);
    expect(triggers.join(' ')).toContain('"library"');
    expect(triggers.join(' ')).toContain('"assessment"');
  });
});

describe('one grade list, built from both corpora', () => {
  test('both grade endpoints are asked, and neither can sink the other', () => {
    expect(code).toContain("api.get('/curriculum/grades')");
    expect(code).toContain("api.get('/lp612/grades')");
    // allSettled, not all: one corpus being down must degrade the list, not empty it. A teacher
    // whose grade 5 lessons exist should still get them when the 6-12 service is unwell.
    expect(code).toContain('Promise.allSettled');
    expect(code).not.toMatch(/Promise\.all\(\s*\[\s*\n?\s*api\.get\('\/curriculum\/grades'\)/);
  });

  test('the merged list is ordered, so grade 9 does not appear after grade 12', () => {
    expect(code).toMatch(/sort\(\(a, b\) => a\.grade - b\.grade\)/);
  });
});

describe('the lane is read off the grade, never inferred from the number', () => {
  test('each grade row carries the lane that produced it', () => {
    expect(code).toContain("lane: 'k5'");
    expect(code).toContain("lane: 'g612'");
  });

  test('the selected lane is looked up, not computed from a boundary', () => {
    // THE POINT. A `grade <= 5` test would be a second, silent copy of a boundary the two
    // services already own — and it would answer confidently for a grade neither of them
    // offers, sending her to a lane with nothing in it.
    expect(code).toMatch(/grades\.find\(\(g\) => String\(g\.grade\) === selectedGrade\)\?\.lane/);
    expect(code).not.toMatch(/Number\(selectedGrade\)\s*[<>]=?\s*[56]/);
    expect(code).not.toMatch(/selectedGrade\s*[<>]=?\s*[56]\b/);
  });

  test('every downstream fetch re-runs when the lane changes', () => {
    // `lane` is derived from `grades` + `selectedGrade`, so React will not re-run these on its
    // own unless it is in the dependency list. Leaving it out means the first grade picked
    // decides the lane for every later one.
    const deps = code.match(/\}, \[selectedGrade[^\]]*\]\);/g) || [];
    expect(deps.length).toBeGreaterThanOrEqual(3);
    for (const d of deps) expect(d).toContain('lane');
  });
});

describe('each lane is addressed the way its own service expects', () => {
  test('6-12 chapters are addressed by chapter_key, K-5 by chapter_number', () => {
    // One grade+subject can span two books in the 6-12 corpus, and both can hold a chapter 1 —
    // so a number is not an identifier there.
    expect(code).toContain('chapter_key: selectedChapter');
    expect(code).toContain('chapter_number: selectedChapter');
  });

  test('the picker rows are normalised, so the JSX speaks one dialect', () => {
    // The mapping happens in the loaders. If the raw keys leaked into the markup, every row
    // would need a lane branch — four more places to get it wrong.
    const jsx = code.slice(code.indexOf('<TabsContent value="library">'));
    expect(jsx).not.toContain('subject_key');
    expect(jsx).not.toContain('lesson_id');
    expect(jsx).not.toContain('lp.topic');
  });
});

describe('the action tells the truth about what it will do', () => {
  test('K-5 opens a PDF; 6-12 may have to write one first', () => {
    expect(code).toContain("lane === 'k5'");
    expect(code).toContain("lane === 'g612'");
    expect(code).toContain('Write this lesson plan');
    // The cost is stated BEFORE she commits, not discovered after.
    expect(code).toContain('takes about 3 minutes');
    expect(code).toContain('takes ~3 min');
  });

  test('the answer-key button stays on the K-5 side only', () => {
    // 6-12 renders have no separate answer-key asset. Offering the button there would be a
    // button that always says "not ready".
    const g612 = code.slice(code.indexOf("lane === 'g612' && ("));
    expect(g612).not.toContain('answer_key');
  });

  test('a three-minute wait has somewhere to land', () => {
    // The render finishes on a worker whether or not she stays on the page. Without this list
    // a lesson we already paid for is lost to her.
    expect(code).toContain('MyLesson612Panel');
    expect(code).toContain('lessons612RefreshKey');
  });
});
