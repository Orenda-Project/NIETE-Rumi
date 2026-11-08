/**
 * bd-snkn32 — a "Make my own" fork is answered by the SAME 6-12 status read (lp612-browse renderStatus), so the
 * portal's waiting page, viewer and PDF relay need no second path.
 *
 * The fallback runs only on a MISS: a real render id never reaches the own table, so a shared lesson's poll costs
 * exactly what it cost before. And the own read is by id AND her user id (lp612-own.service ownStatus).
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/lp612-deliveries.store', () => ({ claimsRender: jest.fn(async () => false) }));

let mockRenderRow = null;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => {
    const api = {
      select: () => api,
      eq: () => api,
      maybeSingle: () => Promise.resolve({ data: mockRenderRow, error: null }),
    };
    return api;
  },
}));

const mockOwnStatus = jest.fn();
jest.mock('../../bot/shared/services/lp612-own.service', () => ({ ownStatus: (...a) => mockOwnStatus(...a) }));

const Browse = require('../../bot/shared/services/lp612-browse.service');

const OWN = {
  id: 'own-1', segment_id: 'seg', status: 'ready', r2_key: 'lp612/v/en/edits/seg/h.pdf', one_screen: null,
  error_code: null, lang: 'en', started_at: 't0', completed_at: 't1',
};

beforeEach(() => {
  mockRenderRow = null;
  mockOwnStatus.mockReset();
});

test('an id that is no render is asked of her own plans, by id and her user id', async () => {
  mockOwnStatus.mockResolvedValue(OWN);
  expect(await Browse.renderStatus('own-1', 'u1')).toEqual(OWN);
  expect(mockOwnStatus).toHaveBeenCalledWith('own-1', 'u1');
});

test('nobody\'s fork and no render is still nothing', async () => {
  mockOwnStatus.mockResolvedValue(null);
  expect(await Browse.renderStatus('own-1', 'u2')).toBeNull();
});

test('a real render never reaches the own table', async () => {
  mockRenderRow = {
    id: 'r1', segment_id: 'seg', status: 'ready', r2_key: 'lp612/x.pdf', one_screen: null, error_code: null,
    lang: 'en', started_at: 't', completed_at: 't', requested_by: 'u1', waiters: [],
  };
  const out = await Browse.renderStatus('r1', 'u1');
  expect(out.id).toBe('r1');
  expect(mockOwnStatus).not.toHaveBeenCalled();
});

test('a render that is someone else\'s is refused and does not fall through to the own table', async () => {
  mockRenderRow = {
    id: 'r1', segment_id: 'seg', status: 'ready', r2_key: 'lp612/x.pdf', requested_by: 'u9', waiters: [],
  };
  expect(await Browse.renderStatus('r1', 'u1')).toBeNull();
  expect(mockOwnStatus).not.toHaveBeenCalled();
});
