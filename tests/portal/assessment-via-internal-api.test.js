/**
 * bd-60067 — the portal's Assessment Generator must be the BOT's generator.
 *
 * Before: the tab rendered a real form against routes that had been deleted.
 * Measured on production 2026-09-08, both hosts:
 *
 *   GET  /api/portal/config              assessmentGenerator: true   ← tab ON
 *   POST /api/portal/assessment/generate 404                         ← no route
 *   GET  /api/portal/lesson-plans        401                         ← control
 *
 * 404 against 401 is what proves the routes were absent rather than merely
 * unauthenticated. And the dead panel behind that form had already drifted from
 * the bot in three measurable ways:
 *
 *   | Question          | Bot                        | Dead portal panel      |
 *   |-------------------|----------------------------|------------------------|
 *   | max questions     | MAX_QUESTIONS = 25         | MAX_COUNT = 20         |
 *   | subjects on offer | textbooks ∩ GRADE_BANDS    | two hardcoded arrays   |
 *   | subject ids       | 'english', 'general_...'   | 'Eng', 'GenK' (UG_EG)  |
 *
 * After: the bot owns every answer behind /api/internal/assessment/*, and the
 * portal is a thin HTTP client — the certificates / training-rules / LP
 * catalogue pattern.
 *
 * Contract:
 *   1. The portal route file reads NO assessment table.
 *   2. The portal client holds no assessment rules — it asks and returns.
 *   3. The portal hardcodes NO question cap; it arrives from the bot.
 *   4. The portal hardcodes no subject catalogue.
 *   5. userId comes from the session on every call, never from a body or query.
 *   6. "Not ready" and "not available" are 200s, so the UI can tell them from
 *      "we are broken".
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ROUTES = path.join(REPO_ROOT, 'dashboard', 'routes', 'portal.routes.js');
const CLIENT = path.join(REPO_ROOT, 'dashboard', 'services', 'assessment.service.js');
const BROWSE = path.join(REPO_ROOT, 'bot', 'shared', 'services', 'assessment', 'assessment-browse.service.js');
const INTERNAL = path.join(REPO_ROOT, 'bot', 'shared', 'routes', 'internal-api.routes.js');

const read = (p) => fs.readFileSync(p, 'utf8');

/**
 * Source with comments stripped. These assertions are about what the code DOES,
 * not what it says: both files document the tables and constants they no longer
 * touch (that history is the point of the docblocks), so a raw-text match would
 * fail on the explanation itself.
 */
const code = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n');

describe('the portal owns no assessment logic', () => {
  test('the client reads no assessment table', () => {
    const src = code(CLIENT);
    expect(src).not.toMatch(/from\(['"]assessment_requests['"]\)/);
    expect(src).not.toMatch(/from\(['"]assessment_papers['"]\)/);
    expect(src).not.toMatch(/from\(['"]textbooks['"]\)/);
    expect(src).not.toMatch(/from\(['"]textbook_toc['"]\)/);
    expect(src).not.toMatch(/supabase/i);
  });

  test('the assessment ROUTES make no assessment-generator table reads', () => {
    // Scoped to the assessment handlers, not the whole file.
    //
    // The rule this protects is "the portal does not re-implement the
    // generator" — no catalogue, no question rules, no paper lookups. It was
    // written as a whole-file ban, which was too wide: bd-60079 added a plain
    // scoped COUNT of assessment_requests to the dashboard's stat row, beside
    // the counts of coaching_sessions and teacher_training_progress it already
    // did. Counting a teacher's own rows is not owning the domain, and routing
    // one integer through the internal API would be ceremony.
    const src = code(ROUTES);
    const block = src.slice(
      src.indexOf('ASSESSMENT GENERATOR'),
      src.indexOf('TEACHER TRAINING BROWSER'),
    );
    expect(block).not.toMatch(/from\(['"]assessment_requests['"]\)/);
    expect(block).not.toMatch(/from\(['"]assessment_papers['"]\)/);
    expect(block).not.toMatch(/from\(['"]textbook_toc['"]\)/);
  });

  test('nowhere in the portal reads assessment_papers or the textbook tables', () => {
    // These two stay banned file-wide: a paper lookup or a chapter read IS the
    // generator's job, and there is no counting use for either.
    const src = code(ROUTES);
    expect(src).not.toMatch(/from\(['"]assessment_papers['"]\)/);
    expect(src).not.toMatch(/from\(['"]textbook_toc['"]\)/);
    expect(src).not.toMatch(/from\(['"]textbooks['"]\)/);
  });

  test('the portal hardcodes no question cap — it comes from the bot', () => {
    // The specific drift: MAX_COUNT = 20 in the dead panel against the bot's 25.
    const src = code(CLIENT) + code(ROUTES);
    expect(src).not.toMatch(/MAX_COUNT/);
    expect(src).not.toMatch(/maxQuestions\s*=\s*\d+/);
  });

  test('the portal hardcodes no subject catalogue', () => {
    const src = code(CLIENT);
    expect(src).not.toMatch(/SUBJECTS_LOWER|SUBJECTS_UPPER|QUESTION_TYPE_CATALOGUE/);
    // The UG_EG-era ids that no longer resolve against the bot.
    expect(src).not.toMatch(/['"]GenK['"]|['"]Eng['"]/);
  });

  test('the client asks the internal API and returns the answer', () => {
    const src = read(CLIENT);
    expect(src).toMatch(/api\/internal\/assessment/);
    expect(src).toMatch(/x-api-key/);
  });

  test('there is no local fallback — a fallback is a second implementation', () => {
    const src = code(CLIENT);
    // The LP bug in one line: a catch that answers [] tells a teacher her work
    // does not exist when the truth is that we could not reach the bot.
    expect(src).not.toMatch(/catch[\s\S]{0,80}return\s*\[\s*\]/);
  });
});

describe('identity comes from the session', () => {
  test('every assessment route reads req.portalUser, never the body or query', () => {
    const src = read(ROUTES);
    const block = src.slice(src.indexOf('ASSESSMENT GENERATOR'), src.indexOf('TEACHER TRAINING BROWSER'));

    expect(block).toMatch(/req\.portalUser/);
    // The shapes that would let a browser name someone else.
    expect(block).not.toMatch(/userId:\s*(body|req\.body|req\.query)/);
    expect(block).not.toMatch(/body\.userId/);
    expect(block).not.toMatch(/query\.userId/);
  });

  test('the bot checks ownership inside the query, not after it', () => {
    const src = read(BROWSE);
    // Ownership on the row that came back, before anything is handed over.
    expect(src).toMatch(/assessment_requests\?\.user_id !== userId/);
  });
});

describe('the states a teacher can be in are distinguishable', () => {
  test('"not ready" and "not available" are 200s, not 404s', () => {
    const src = read(ROUTES);
    const block = src.slice(src.indexOf('ASSESSMENT GENERATOR'), src.indexOf('TEACHER TRAINING BROWSER'));
    expect(block).toMatch(/status\(200\)\.json\(\{ success: true, available: false \}\)/);
  });

  test('a failed paper carries its error code, so she is told the real reason', () => {
    expect(read(BROWSE)).toMatch(/errorCode/);
  });

  test('generate answers 202 — the paper does not exist yet', () => {
    const src = read(ROUTES);
    const block = src.slice(src.indexOf('ASSESSMENT GENERATOR'), src.indexOf('TEACHER TRAINING BROWSER'));
    expect(block).toMatch(/status\(202\)/);
  });
});

describe('the six endpoints exist on the bot', () => {
  test.each([
    'options', 'chapters', 'create', 'status', 'download', 'papers',
  ])('/api/internal/assessment/%s', (name) => {
    expect(read(INTERNAL)).toMatch(new RegExp(`'/assessment/${name}'`));
  });

  test('each one is behind the shared secret', () => {
    const src = read(INTERNAL);
    const block = src.slice(src.indexOf('assessment generator'));
    const routes = block.match(/router\.post\('\/assessment\/[a-z]+'/g) || [];
    expect(routes.length).toBe(6);
    // Every one of them names the guard on the same line.
    const guarded = block.match(/router\.post\('\/assessment\/[a-z]+', requireInternalKey/g) || [];
    expect(guarded.length).toBe(6);
  });
});
