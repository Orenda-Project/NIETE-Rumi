const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const ROUTES = path.join(ROOT, 'dashboard', 'routes', 'portal.routes.js');
const CLIENT = path.join(ROOT, 'dashboard', 'services', 'assessment.service.js');
const read = (p) => fs.readFileSync(p, 'utf8');

jest.mock('axios', () => ({ post: jest.fn() }));
const axios = require('axios');

beforeEach(() => {
  jest.clearAllMocks();
  process.env.MAIN_BOT_URL = 'https://bot.test';
  process.env.INTERNAL_API_KEY = 'k';
});

describe('client', () => {
  const Client = () => require('../../dashboard/services/assessment.service');

  test('editSave posts to the bot edit route with a longer timeout and passes the body through', async () => {
    axios.post.mockResolvedValue({ status: 200, data: { success: true, status: 'ready', paperId: 'p2', version: 2 } });
    const out = await Client().editSave({ parentId: 'p1', userId: 'u1', changes: { removed: ['x'] } });
    const [url, body, opts] = axios.post.mock.calls[0];
    expect(url).toBe('https://bot.test/api/internal/assessment/edit/save');
    expect(body).toEqual({ parentId: 'p1', userId: 'u1', changes: { removed: ['x'] } });
    expect(opts.headers['x-api-key']).toBe('k');
    expect(opts.timeout).toBeGreaterThanOrEqual(45000);
    expect(out).toMatchObject({ status: 'ready', version: 2 });
  });

  test('a bot refusal throws with its status and body', async () => {
    axios.post.mockResolvedValue({ status: 400, data: { success: false, code: 'INVALID_CHANGES', errors: [{ id: 'x', message: 'm' }] } });
    await expect(Client().editSave({ parentId: 'p1', userId: 'u1', changes: {} }))
      .rejects.toMatchObject({ status: 400, body: { code: 'INVALID_CHANGES' } });
  });

  test.each([
    ['a bot 401 (bad key)', 401, { success: false, error: 'Unauthorized' }],
    ['a 500 without a code', 500, { success: false }],
    ['a 400 without a code', 400, { success: false }],
    ['a 403 whose body is not an object', 403, 'nope'],
  ])('%s never reaches the portal as itself: 502 UNREACHABLE', async (_n, status, data) => {
    axios.post.mockResolvedValue({ status, data });
    await expect(Client().editSave({ parentId: 'p1', userId: 'u1', changes: {} }))
      .rejects.toMatchObject({ status: 502, body: { success: false, code: 'UNREACHABLE', error: 'We could not reach the paper service.' } });
  });

  test.each([400, 403, 404, 409, 502])('a coded bot %i passes through', async (status) => {
    axios.post.mockResolvedValue({ status, data: { success: false, code: 'NOT_FOUND' } });
    await expect(Client().editVersions('p1', 'u1')).rejects.toMatchObject({ status, body: { code: 'NOT_FOUND' } });
  });

  test('the client still reads no table and holds no edit rule', () => {
    const src = read(CLIENT);
    expect(src).not.toMatch(/supabase/i);
    expect(src).not.toMatch(/SLOT_CAP|NEW_DEFAULTS|shapeOf|applyEdit/);
  });
});

describe('routes', () => {
  const block = () => { const s = read(ROUTES); return s.slice(s.indexOf('ASSESSMENT GENERATOR'), s.indexOf('TEACHER TRAINING BROWSER')); };

  test.each([
    "router.get('/assessment/edit/:paper_id/versions', requirePortalAuth",
    "router.get('/assessment/edit/:paper_id/questions', requirePortalAuth",
    "router.get('/assessment/edit/:paper_id/add-kinds', requirePortalAuth",
    "router.post('/assessment/edit/:paper_id/validate', requirePortalAuth",
    "router.post('/assessment/edit/:paper_id/save', requirePortalAuth",
  ])('%s', (sig) => expect(block()).toContain(sig));

  test('identity only from the session', () => {
    expect(block()).not.toMatch(/userId:\s*(req\.body|body|req\.query)/);
    expect(block()).not.toMatch(/body\.userId/);
  });

  test('/config exposes assessmentEditing', () => {
    expect(read(ROUTES)).toMatch(/assessmentEditing/);
  });
});

// bd-fmf24g.31 — reading a paper's own questions: NOT behind the editing switch, still hers only.
describe('paper view (bd-fmf24g.31)', () => {
  test('client posts userId + paperId to the bot view route and passes a coded refusal through', async () => {
    const Client = require('../../dashboard/services/assessment.service');
    axios.post.mockResolvedValue({ status: 200, data: { success: true, paper: { paperId: 'p1' }, sections: [] } });
    const out = await Client.viewPaper('p1', 'u1');
    expect(axios.post.mock.calls[0][0]).toBe('https://bot.test/api/internal/assessment/paper/view');
    expect(axios.post.mock.calls[0][1]).toEqual({ paperId: 'p1', userId: 'u1' });
    expect(out.sections).toEqual([]);
    axios.post.mockResolvedValue({ status: 404, data: { success: false, code: 'NOT_FOUND' } });
    await expect(Client.viewPaper('p1', 'u2')).rejects.toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } });
  });

  test('the portal route is auth-gated and takes identity only from the session', () => {
    const s = read(ROUTES);
    expect(s).toContain("router.get('/assessment/paper/:paper_id/view', requirePortalAuth");
    const at = s.indexOf("router.get('/assessment/paper/:paper_id/view'");
    const body = s.slice(at, at + 500);
    expect(body).toContain('req.session.portalUserId');
    expect(body).not.toMatch(/req\.(body|query)\.user/);
  });
});
