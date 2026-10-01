/**
 * bd-vej4h — the portal shows unit locks and the score sheet, and computes
 * neither rule itself (bd-2480 / bd-60145: the rules client holds no decision
 * logic). Pinned at the source level, the way bd-60149 pins the module exam.
 */
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const ROUTES = read('dashboard/routes/portal.routes.js');
const RULES_CLIENT = read('dashboard/services/training-rules.service.js');
const INTERNAL_API = read('bot/shared/routes/internal-api.routes.js');

function routeBody(src, decl) {
  const start = src.indexOf(decl);
  if (start === -1) return '';
  const next = src.indexOf('\nrouter.', start + decl.length);
  return src.slice(start, next === -1 ? src.length : next);
}

describe('unit locks reach the portal list', () => {
  test('the bot exposes a unit-locks endpoint built on the shared lock rule', () => {
    const body = routeBody(INTERNAL_API, "router.post('/training/unit-locks'");
    expect(body).toMatch(/loadModulesWithProgress/);
    expect(body).toMatch(/unitLocksForCourse/);
  });

  test('the rules client asks for them over the internal API', () => {
    expect(RULES_CLIENT).toMatch(/async function unitLocks\(/);
    expect(RULES_CLIENT).toMatch(/ask\('unit-locks'/);
  });

  test('/training/modules attaches each unit\'s lock', () => {
    const body = routeBody(ROUTES, "router.get('/training/modules'");
    expect(body).toMatch(/TrainingRules\.unitLocks\(/);
    expect(body).toMatch(/lock:/);
  });
});

describe('the score sheet reaches the certificate card', () => {
  test('the certificate state builds it with the bot\'s pure score-sheet rules', () => {
    expect(ROUTES).toMatch(/require\('..\/..\/bot\/shared\/services\/training\/isaps-score-sheet.rules'\)/);
    const helperStart = ROUTES.indexOf('async function _isapsScoreSheet');
    const helper = ROUTES.slice(helperStart, ROUTES.indexOf('async function _levelCertificateState'));
    expect(helper).toMatch(/buildIsapsScoreSheet\(/);
    const start = ROUTES.indexOf('async function _levelCertificateState');
    const body = ROUTES.slice(start, ROUTES.indexOf('\nrouter.', start));
    // both the held and the not-yet-held answers carry the sheet
    expect((body.match(/scores: .*_isapsScoreSheet\(/g) || []).length).toBe(2);
  });
});
