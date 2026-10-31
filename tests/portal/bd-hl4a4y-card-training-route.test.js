/**
 * bd-hl4a4y — her Training page on the School card shows each of her trainings with "Level N of M", which comes from
 * the bot's level states (the source her own Training page reads, GET /training/levels). The items route hands the
 * service the reader it was given; the School card router is wired with TrainingRules.getLevelStates.
 */
const fs = require('fs');
const path = require('path');
const Card = require('../../dashboard/services/coach-school-card.service');
const { createCoachSchoolCardRouter } = require('../../dashboard/routes/coach-school-card.routes');

function handlersOf(router, method, routePath) {
  const layer = router.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  if (!layer) throw new Error(`no ${method} ${routePath}`);
  return layer.route.stack.map((s) => s.handle);
}

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  return res;
}

afterEach(() => jest.restoreAllMocks());

test('GET /coach/teacher/:ext/items/training hands the service the level-state reader', async () => {
  const levelStates = jest.fn();
  const spy = jest.spyOn(Card, 'getTeacherItems').mockResolvedValue({ feature: 'training', vendors: [], levels: [] });
  const router = createCoachSchoolCardRouter({ query: jest.fn(), levelStates });
  const [handler] = handlersOf(router, 'get', '/coach/teacher/:ext/items/:feature');
  const res = fakeRes();
  await handler({ params: { ext: '923000000001', feature: 'training' }, query: {}, session: { portalUserId: 'coach-1' } }, res);
  expect(res.statusCode).toBe(200);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy.mock.calls[0][4].levelStates).toBe(levelStates);
});

test('portal.routes wires the School card with the bot\'s level states', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../dashboard/routes/portal.routes.js'), 'utf8');
  const wiring = src.slice(src.indexOf("require('./coach-school-card.routes').createCoachSchoolCardRouter("));
  const block = wiring.slice(0, wiring.indexOf('}));'));
  expect(block).toMatch(/levelStates:\s*\(userId\)\s*=>\s*TrainingRules\.getLevelStates\(userId\)/);
});
