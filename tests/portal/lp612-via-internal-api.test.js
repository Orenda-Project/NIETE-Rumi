/**
 * bd-60082 — the portal's grade 6-12 lesson plans must be the BOT's lesson plans.
 *
 * The portal's catalogue stopped at grade 5. On WhatsApp a teacher reaches 5,466 segments across
 * grades 6-12 (measured on production 2026-09-10), and where no lesson has been written yet the
 * bot writes one on the spot.
 *
 * THE PRECEDENT THIS FOLLOWS, AND WHY IT IS NOT OPTIONAL. The K-5 catalogue drifted precisely
 * because the portal answered a curriculum question itself: the bot read one corpus, the portal
 * read two unrelated tables, and grade 5 maths showed 0 chapters in the portal against 8 on
 * WhatsApp. The fix was to make the portal a thin client. This lane is built that way from the
 * start, and this file is what stops it drifting back.
 *
 * Contract:
 *   1. The portal route file reads no lp612 table.
 *   2. The portal client holds no lp612 rules — no filters, no readiness logic, no template
 *      version, no religious hold. It asks and returns.
 *   3. Every rule that decides what a teacher may see lives in the BOT's query.
 *   4. userId comes from the session on every call, never from a body or query.
 *   5. `withheld` and `not found` are answers, not 5xx faults.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const ROUTES = path.join(REPO_ROOT, 'dashboard', 'routes', 'portal.routes.js');
const CLIENT = path.join(REPO_ROOT, 'dashboard', 'services', 'lp612.service.js');
const BROWSE = path.join(REPO_ROOT, 'bot', 'shared', 'services', 'lp612-browse.service.js');
const INTERNAL = path.join(REPO_ROOT, 'bot', 'shared', 'routes', 'internal-api.routes.js');

const read = (p) => fs.readFileSync(p, 'utf8');

/**
 * Source with comments stripped. These assertions are about what the code DOES, not what it
 * says: both files document at length the tables and rules they deliberately do not touch, and
 * that history is the point of the docblocks. A raw-text match would fail on the explanation.
 */
const code = (p) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n');

const LP612_TABLES = ['niete_lp612_segments', 'niete_lp612_renders'];

describe('the portal owns no 6-12 lesson-plan logic', () => {
  test('the client reads no lp612 table', () => {
    const src = code(CLIENT);
    for (const table of LP612_TABLES) expect(src).not.toContain(table);
    // Not even indirectly: no Supabase handle at all.
    expect(src).not.toMatch(/supabase/i);
  });

  test('the portal route block reads no lp612 table', () => {
    const src = code(ROUTES);
    const start = src.indexOf("require('../services/lp612.service')");
    expect(start).toBeGreaterThan(-1);
    // Bounded to this feature's own block: the file is thousands of lines and other features
    // legitimately read their own tables.
    const block = src.slice(start, src.indexOf('ASSESSMENT GENERATOR', start));
    for (const table of LP612_TABLES) expect(block).not.toContain(table);
  });

  test('the client hardcodes no template version', () => {
    // The template version is part of the render cache key. A copy of it in the portal is a
    // copy that goes stale the next time it is bumped — and readiness would then be answered
    // against a template nobody is serving.
    expect(code(CLIENT)).not.toMatch(/v9\.\d/);
    expect(code(CLIENT)).not.toContain('LP_612_TEMPLATE_VERSION');
  });

  test('the client makes no decision about withheld content', () => {
    // The religious hold is an operator decision affecting 528 segments. A portal that filters
    // is a portal that can be asked not to; the bot enforces it in the query.
    const src = code(CLIENT);
    expect(src).not.toContain('is_religious');
    expect(src).not.toContain('LP_612_RELIGIOUS_ENABLED');
  });

  test('the client sets no grade bounds of its own', () => {
    const src = code(CLIENT);
    expect(src).not.toContain('LP612_MIN_GRADE');
    // No hand-rolled 6..12 range either — that is the bot's `lp612ServesGrade`.
    expect(src).not.toMatch(/grade\s*[<>]=?\s*(6|12)\b/);
  });
});

describe('the rules live in the bot, where both surfaces meet them', () => {
  test('the browse service applies the hold, the corpus version and the grade bounds', () => {
    const src = code(BROWSE);
    expect(src).toContain('isReligiousEnabled');
    expect(src).toContain('is_current');
    expect(src).toContain('LP612_MIN_GRADE');
    expect(src).toContain('LP612_MAX_GRADE');
  });

  test('readiness is keyed on the template that would actually be served', () => {
    expect(code(BROWSE)).toContain('templateVersion()');
  });

  test('the internal API exposes the lane behind the shared key', () => {
    const src = code(INTERNAL);
    for (const route of ['grades', 'subjects', 'chapters', 'lessons', 'request', 'status', 'mine']) {
      expect(src).toContain(`'/lp612/${route}'`);
    }
    // Every one of them guarded. A curriculum endpoint open to the internet is a scraper's
    // shortcut to the whole corpus.
    // From the route REGISTRATION, not from the path literal — slicing at the path string cuts
    // the `router.post(` off the first match and silently undercounts by one.
    const block = src.slice(src.indexOf("router.post('/lp612/grades'"));
    const registrations = block.match(/router\.post\('\/lp612\/[a-z]+',\s*([A-Za-z]+)/g) || [];
    expect(registrations.length).toBe(7);
    for (const r of registrations) expect(r).toContain('requireInternalKey');
  });

  test('the surface is set by the route, never taken from the caller', () => {
    // A body-supplied surface is one forged request away from WhatsApping a lesson to a number
    // the caller chose. Same rule as the AG's deliveryFor(surface).
    const src = code(INTERNAL);
    const block = src.slice(src.indexOf("'/lp612/request'"), src.indexOf("'/lp612/status'"));
    expect(block).toContain("surface: 'portal'");
    expect(block).not.toMatch(/surface:\s*body\./);
    expect(block).not.toMatch(/surface:\s*req\.body/);
  });
});

describe('a real answer is not a fault', () => {
  test('withheld and not-found come back as 403/404, not 500', () => {
    const src = code(INTERNAL);
    const block = src.slice(src.indexOf("'/lp612/request'"), src.indexOf("'/lp612/status'"));
    expect(block).toMatch(/status\(404\)/);
    expect(block).toMatch(/status\(403\)/);
  });

  test('the portal route turns those into the same two answers, not a 502', () => {
    const src = code(ROUTES);
    const start = src.indexOf("router.post('/lp612/request'");
    const block = src.slice(start, src.indexOf("router.get('/lp612/status", start));
    expect(block).toContain('out.notFound');
    expect(block).toContain('out.withheld');
  });
});

describe('identity comes from the session', () => {
  test('every lp612 portal route that names a teacher reads the session', () => {
    const src = code(ROUTES);
    const start = src.indexOf("require('../services/lp612.service')");
    const block = src.slice(start, src.indexOf('ASSESSMENT GENERATOR', start));

    // The three routes that carry identity.
    for (const marker of ['/lp612/request', '/lp612/status/:render_id', '/lp612/mine']) {
      expect(block).toContain(marker);
    }
    expect(block).toContain('req.session.portalUserId');
    // Never req.portalUser: that is set only by the leader gate, which 403s teachers. Reading
    // it yields undefined — the exact shape that made every Generate answer "userId is required".
    expect(block).not.toContain('req.portalUser');
    // And never from the client.
    expect(block).not.toMatch(/user_?[Ii]d:\s*req\.(body|query)/);
  });
});
