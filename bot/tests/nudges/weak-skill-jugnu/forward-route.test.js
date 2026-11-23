'use strict';
/**
 * bd-ptl6x9.7 — GET /sfwd/:token?class=&ex=&lang=: the nudge's button. 302 → wa.me with one fixed line and the
 * class's standing link carrying ?ex=<game>; 404 when the nudge is off, the class link is off, the game is not one of
 * the three, or the list is not this teacher's. No digit and no name in the line; nothing is sent by us.
 */

const mockSettings = jest.fn();
jest.mock('../../../shared/services/nudges/weak-skill-jugnu/switch', () => ({ nudgeSettings: (...a) => mockSettings(...a) }));
const mockLinkOn = jest.fn();
jest.mock('../../../shared/services/quiz/teacher-jugnu-flags', () => ({ classLinkOn: (...a) => mockLinkOn(...a) }));
const mockMint = jest.fn();
jest.mock('../../../shared/services/quiz/web-quiz-class-link', () => ({
  mint: (...a) => mockMint(...a), linkUrl: (code) => `https://kids.example/j/${code}`,
}));
const mockLists = jest.fn();
jest.mock('../../../shared/services/nudges/weak-skill-jugnu/reader', () => ({ listsOf: (...a) => mockLists(...a) }));
const mockEvent = jest.fn();
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: (...a) => mockEvent(...a) }));
jest.mock('../../../shared/services/quiz/web-quiz-kid', () => ({ tk: (id) => `tk:${id}` }));

const Route = require('../../../shared/routes/weak-skill-forward.routes');

const LIST = '11111111-2222-3333-4444-555555555555';
/** The route's handler, called the way express would, against a recording response. */
function go(q = `class=${LIST}&ex=missing&lang=en`, tok = 'good') {
  let handler;
  const router = { get: (path, fn) => { if (path === '/sfwd/:token') handler = fn; } };
  const authorise = (req, res) => (req.params.token === 'good' ? { teacherId: 'u1' } : (res.status(401), null));
  const notFound = (req, res) => res.status(404);
  Route.attach(router, { authorise, handle: (fn) => fn, notFound, noStore: () => {} });
  const res = { status: 200, headers: {} };
  res.status = (code) => { res.statusCode = code; return res; };
  res.redirect = (code, loc) => { res.statusCode = code; res.headers.location = loc; return res; };
  const query = Object.fromEntries(new URLSearchParams(q));
  return handler({ params: { token: tok }, query }, res).then(() => ({ status: res.statusCode, headers: res.headers }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSettings.mockResolvedValue({ enabled: true });
  mockLinkOn.mockResolvedValue(true);
  mockMint.mockResolvedValue({ ok: true, code: 'ABCDEFGH' });
  mockLists.mockResolvedValue([{ listId: LIST, classId: 'c3', grade: 3 }]);
});

test('302 to wa.me: the fixed line and the class link opening that game', async () => {
  const r = await go();
  expect(r.status).toBe(302);
  const text = decodeURIComponent(r.headers.location.replace('https://wa.me/?text=', ''));
  expect(text).toMatch(/https:\/\/kids\.example\/j\/ABCDEFGH\?ex=missing$/);
  expect(text.replace(/https:\S+/, '')).not.toMatch(/[0-9۰-۹]/);
  expect(mockMint).toHaveBeenCalledWith({ teacherId: 'u1', classId: 'c3' });
  expect(mockEvent).toHaveBeenCalledWith('weak_skill_jugnu.forwarded', { tk: 'tk:u1', game: 'missing', grade: 3 });
});

test('Urdu line on lang=ur', async () => {
  const r = await go(`class=${LIST}&ex=bigger&lang=ur`);
  expect(decodeURIComponent(r.headers.location)).toMatch(/[؀-ۿ]/);
});

test.each([
  ['the nudge is off', () => mockSettings.mockResolvedValue({ enabled: false })],
  ['the class link is off', () => mockLinkOn.mockResolvedValue(false)],
  ['the list is not hers', () => mockLists.mockResolvedValue([{ listId: 'other', classId: 'c9', grade: 3 }])],
  ['the link cannot be made', () => mockMint.mockResolvedValue({ ok: false, reason: 'not_teacher' })],
])('404 when %s', async (_, arrange) => {
  arrange();
  expect((await go()).status).toBe(404);
});

test.each(['read', 'x', ''])('404 for a game outside the three (%p)', async (ex) => {
  expect((await go(`class=${LIST}&ex=${ex}`)).status).toBe(404);
});

test('a bad token never reaches the data', async () => {
  expect((await go(undefined, 'bad')).status).toBe(401);
  expect(mockLists).not.toHaveBeenCalled();
});
