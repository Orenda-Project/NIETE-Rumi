/**
 * bd-nr8mrm.7 — FEAT-209 (Ramisha Riaz): the WhatsApp Assessment Flow asks for the page count too.
 *
 * Same rule as the portal (bd-nr8mrm.4): 1–5 pages or no limit, only while assessment_page_fit is
 * on. The choice rides the job payload as `pages` (no column). Off, a missing or nonsense value
 * leaves the job exactly as it was.
 */

const mockRedis = { get: jest.fn(), set: jest.fn(), delete: jest.fn() };
const mockSupabase = { from: jest.fn() };
const mockQueueJob = jest.fn().mockResolvedValue({ MessageId: 'm1' });
const mockFlag = jest.fn();

jest.mock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/queue', () => ({ queueJob: mockQueueJob }));
jest.mock('../../bot/shared/config/feature-flags', () => ({
  ...jest.requireActual('../../bot/shared/config/feature-flags'),
  isFlagEnabled: (...a) => mockFlag(...a),
}));
jest.mock('../../bot/shared/services/assessment/book-content.service', () => ({
  listChapters: jest.fn(async () => [{ chapterNumber: 1, title: 'Hello World!', pageStart: 4, pageEnd: 14 }]),
  parsePageRanges: jest.requireActual(
    '../../bot/shared/services/assessment/book-content.service').parsePageRanges,
}));
jest.mock('../../bot/shared/services/assessment/assessment-format', () => ({
  ...jest.requireActual('../../bot/shared/services/assessment/assessment-format'),
  resolveFormat: jest.fn(async () => 'pdf'),
  formatsOnOffer: jest.fn(async () => [{ id: 'pdf', title: 'PDF' }]),
}));

const FLOW = require('../../docs/flows/assessment-gen-flow.json');
const Endpoint = require('../../bot/shared/routes/assessment-gen-endpoint');

let inserted;
const SESSION = {
  userId: 'u1', grade: 1, subject: 'english', chapterNumber: 1, chapterTitle: 'Hello World!',
  pageRanges: null, questionCount: 10, contentSource: 'unseen',
};

beforeEach(() => {
  jest.clearAllMocks();
  inserted = null;
  mockSupabase.from.mockImplementation((table) => {
    if (table === 'textbooks') {
      return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({
        maybeSingle: () => Promise.resolve({ data: { id: 'book-uuid', total_pages: 166 }, error: null }),
      }) }) }) }) };
    }
    if (table === 'assessment_requests') {
      return { insert: (row) => { inserted = row; return { select: () => ({ single: () =>
        Promise.resolve({ data: { id: 'req-1' }, error: null }) }) }; } };
    }
    throw new Error(`unexpected table ${table}`);
  });
  mockRedis.get.mockResolvedValue({ ...SESSION });
  mockRedis.set.mockResolvedValue(true);
  mockRedis.delete.mockResolvedValue(true);
  mockFlag.mockImplementation(async (key) => key === 'assessment_page_fit');
});

const job = () => mockQueueJob.mock.calls[0][2];
const confirm = () => FLOW.screens.find((s) => s.id === 'CONFIRM');
const walk = (node, visit) => {
  if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
  else if (node && typeof node === 'object') { visit(node); Object.values(node).forEach((v) => walk(v, visit)); }
};
const cp = (s) => [...s].length;

describe('the CONFIRM screen asks for pages, optional, hidden while the switch is off', () => {
  it('has a page_limit Dropdown fed and shown by the endpoint, sent by the footer', () => {
    let form; let dd; let payload;
    walk(confirm(), (n) => {
      if (n.type === 'Form') form = n;
      if (n.type === 'Dropdown' && n.name === 'page_limit') dd = n;
      if (n.type === 'Footer') payload = n['on-click-action'].payload;
    });
    expect(dd).toBeTruthy();
    expect(dd.required).not.toBe(true);
    expect(dd['data-source']).toBe('${data.page_choices}');
    expect(dd.visible).toBe('${data.show_pages}');
    expect(cp(dd.label)).toBeLessThanOrEqual(20);
    expect(form['init-values']).toMatchObject({ page_limit: 'none' });
    expect(payload).toHaveProperty('page_limit', '${form.page_limit}');
    expect(confirm().data).toHaveProperty('page_choices');
    expect(confirm().data).toHaveProperty('show_pages');
  });

  it('flag on: show_pages true, No limit then 1-5, titles within the cap', async () => {
    const s = await Endpoint._internal.confirmScreen({ ...SESSION });
    expect(s.data.show_pages).toBe(true);
    expect(s.data.page_choices.map((c) => c.id)).toEqual(['none', '1', '2', '3', '4', '5']);
    s.data.page_choices.forEach((c) => expect(cp(c.title)).toBeLessThanOrEqual(30));
  });

  it('flag off: show_pages false', async () => {
    mockFlag.mockResolvedValue(false);
    const s = await Endpoint._internal.confirmScreen({ ...SESSION });
    expect(s.data.show_pages).toBe(false);
  });
});

describe('the choice reaches the job only when it is a real 1-5 and the switch is on', () => {
  it.each([['2', 2], [3, 3]])('page_limit %p → job.pages %p, no new column', async (v, want) => {
    await Endpoint.submitFromCompletion({ flowToken: 'u1:assessment', userId: 'u1', outputFormat: 'pdf', pageLimit: v });
    expect(job().pages).toBe(want);
    expect(Object.keys(inserted).some((k) => /page_?(count|limit)|^pages$/.test(k))).toBe(false);
  });

  it.each([['none'], [undefined], ['7'], ['0'], ['two']])('page_limit %p → no pages key', async (v) => {
    await Endpoint.submitFromCompletion({ flowToken: 'u1:assessment', userId: 'u1', outputFormat: 'pdf', pageLimit: v });
    expect(job()).not.toHaveProperty('pages');
  });

  it('switch off: a stale client posting "2" still gets no pages', async () => {
    mockFlag.mockResolvedValue(false);
    await Endpoint.submitFromCompletion({ flowToken: 'u1:assessment', userId: 'u1', outputFormat: 'pdf', pageLimit: '2' });
    expect(job()).not.toHaveProperty('pages');
  });

  it('the data-exchange CONFIRM path honours the same rule', async () => {
    await Endpoint.handleAssessmentGenDataExchange('u1', 'CONFIRM', { output_format: 'pdf', page_limit: '4' }, 'u1:assessment');
    expect(job().pages).toBe(4);
  });

  it('the completion handler passes page_limit through', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../../bot/shared/handlers/flow-response.handler.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(src).toMatch(/pageLimit:\s*responseJson\?\.page_limit/);
  });
});
