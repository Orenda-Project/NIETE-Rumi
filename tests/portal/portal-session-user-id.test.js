/**
 * A route guarded by requirePortalAuth must read the session, not req.portalUser.
 *
 * THE BUG THIS ENCODES
 * --------------------
 * Every assessment route shipped reading `req.portalUser && req.portalUser.id`.
 * That is `undefined` under requirePortalAuth, so the internal API's own
 * validation fired and the teacher saw "userId is required" on pressing
 * Generate. Reported from the live portal.
 *
 * The two middlewares are not interchangeable:
 *
 *   requirePortalAuth   (portal.routes.js) checks req.session.portalUserId and
 *                       calls next(). It attaches NOTHING to req.
 *   requireLeaderRole   (lib/leader-role.js:81) loads the user row and sets
 *                       req.portalUser — but it is a SCHOOL-LEADER gate that
 *                       403s everyone else, so it cannot be added to a teacher
 *                       route to make req.portalUser appear.
 *
 * So on any requirePortalAuth route the id lives at `req.session.portalUserId`
 * and nowhere else.
 *
 * WHY A GREP TEST RATHER THAN A REQUEST TEST
 * -------------------------------------------
 * The failure is a silent undefined, not a throw. A request-level test needs a
 * full express + session + supabase harness to reach the same line, and would
 * still only cover the routes someone remembered to exercise. This reads the
 * route file and fails on the SHAPE, so a route added next month cannot
 * reintroduce it without turning this red.
 *
 * It also catches the pre-existing instance: /curriculum/lps has been passing
 * an undefined userId for its per-teacher "downloaded" tick since the LP
 * catalogue landed. Nobody noticed because userId is optional there — the list
 * renders, the ticks are just always absent.
 */

const fs = require('fs');
const path = require('path');

const ROUTES = path.join(__dirname, '..', '..', 'dashboard', 'routes', 'portal.routes.js');
const src = fs.readFileSync(ROUTES, 'utf8');
const lines = src.split('\n');

/** Line numbers (1-indexed) of every route registration, with its guards. */
function routeRegistrations() {
  const out = [];
  lines.forEach((line, i) => {
    const m = line.match(/^router\.(get|post|put|patch|delete)\((['"`])([^'"`]+)\2\s*,\s*(.*)$/);
    if (!m) return;
    out.push({ line: i + 1, method: m[1], routePath: m[3], guards: m[4] });
  });
  return out;
}

/**
 * A handler's own body, ending at its closing `});` at column 0.
 *
 * Slicing to the NEXT route registration instead over-reads: everything between
 * two routes — the comment blocks and section banners that separate them —
 * lands on the earlier route. That misattributed the leader block's banner and
 * /leader/me's body to /dashboard, which reads req.portalUser correctly under
 * its own leader guard. A guard that reports a route that is fine teaches
 * everyone to skim its output.
 */
function handlerBody(startLine) {
  const body = [];
  for (let i = startLine - 1; i < lines.length; i += 1) {
    body.push(lines[i]);
    if (i > startLine - 1 && /^\}\);\s*$/.test(lines[i])) break;
  }
  return body.join('\n');
}

describe('req.portalUser is not available on requirePortalAuth routes', () => {
  test('the two middlewares differ, and only the leader gate attaches the user', () => {
    // requirePortalAuth's body, up to its closing brace.
    const start = src.indexOf('const requirePortalAuth = (req, res, next) => {');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\n};', start));

    // If this ever DOES attach the user, the rule below can be relaxed — but it
    // has to be a deliberate change, not an assumption.
    expect(body).not.toMatch(/req\.portalUser\s*=/);

    const leaderRole = fs.readFileSync(
      path.join(__dirname, '..', '..', 'dashboard', 'lib', 'leader-role.js'), 'utf8');
    expect(leaderRole).toMatch(/req\.portalUser\s*=/);
    // ...and it 403s anyone who is not a school leader, which is why a teacher
    // route cannot simply add it.
    expect(leaderRole).toMatch(/This area is for school leaders only/);
  });

  test('no route reads req.portalUser unless requireLeaderRole guards it', () => {
    const offenders = [];

    routeRegistrations().forEach((route) => {
      const handler = handlerBody(route.line);

      if (!/req\.portalUser/.test(handler)) return;
      // The guard list is on the registration line for every route in this file.
      if (/requireLeaderRole/.test(route.guards)) return;

      offenders.push(`${route.method.toUpperCase()} ${route.routePath} (line ${route.line})`);
    });

    expect(offenders).toEqual([]);
  });

  test('every assessment route passes the session id', () => {
    const block = src.slice(
      src.indexOf('ASSESSMENT GENERATOR'),
      src.indexOf('TEACHER TRAINING BROWSER'));

    // The four routes that need to know who she is, by their real paths.
    // /options and /chapters are catalogue reads and deliberately do not.
    [
      "'/assessment/generate'",
      "'/assessment/status/:request_id'",
      "'/assessment/paper/:paper_id/download'",
      "'/assessment/papers'",
    ].forEach((registered) => {
      expect(block).toContain(registered);
    });

    // One session read per route that needs it — not just "at least one
    // somewhere in the block", which would pass with three of them broken.
    // Comments are stripped first: the banner above these routes explains the
    // req.portalUser trap by naming the correct accessor, and counting that
    // prose as a read would let one broken route hide behind the explanation.
    const codeOnly = block
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    const reads = codeOnly.match(/req\.session\.portalUserId/g) || [];
    expect(reads.length).toBe(4);
    // Against CODE, not the banner: the comment above these routes names
    // req.portalUser on purpose, to warn the next person off it.
    expect(codeOnly).not.toMatch(/req\.portalUser/);
  });
});
