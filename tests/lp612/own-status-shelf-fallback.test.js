/**
 * bd-snkn32.42 — a plan from the "Made by a teacher" shelf opens through the SAME 6-12 status read as her own plans
 * (lp612-browse renderStatus), so the portal's waiting page, viewer and PDF relay need no new path. Her own plan
 * wins (it carries her Change controls); only when it is not hers is the shelf asked, and the shelf answers only an
 * approved plan, without the author's id.
 */
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/services/lp612-deliveries.store', () => ({ claimsRender: jest.fn(async () => false) }));
jest.mock('../../bot/shared/config/supabase', () => ({
  from: () => {
    const api = { select: () => api, eq: () => api, contains: () => api, maybeSingle: () => Promise.resolve({ data: null, error: null }) };
    return api;
  },
}));
jest.mock('../../bot/shared/services/gb-lp-serving.service', () => ({ renderStatus: jest.fn(async () => null) }));
const mockOwnStatus = jest.fn();
jest.mock('../../bot/shared/services/lp612-own.service', () => ({ ownStatus: (...a) => mockOwnStatus(...a) }));
const mockShelfStatus = jest.fn();
jest.mock('../../bot/shared/services/lp612-own-library', () => ({ shelfStatus: (...a) => mockShelfStatus(...a) }));

const Browse = require('../../bot/shared/services/lp612-browse.service');

const SHELF = { id: 'own-9', segment_id: 'L1', status: 'ready', r2_key: 'k.pdf', one_screen: null, error_code: null, lang: 'en', started_at: 'a', completed_at: 'b' };

beforeEach(() => { mockOwnStatus.mockReset(); mockShelfStatus.mockReset(); });

test('not hers: the shelf answers an approved plan by id', async () => {
  mockOwnStatus.mockResolvedValue(null);
  mockShelfStatus.mockResolvedValue(SHELF);
  expect(await Browse.renderStatus('own-9', 'u2')).toEqual(SHELF);
  expect(mockShelfStatus).toHaveBeenCalledWith('own-9');
});

test('hers: her own row (with her Change controls) wins and the shelf is not asked', async () => {
  mockOwnStatus.mockResolvedValue({ ...SHELF, own_band: 'k5', changes_left: 2 });
  expect((await Browse.renderStatus('own-9', 'u1')).own_band).toBe('k5');
  expect(mockShelfStatus).not.toHaveBeenCalled();
});

test('neither hers nor approved: nothing', async () => {
  mockOwnStatus.mockResolvedValue(null);
  mockShelfStatus.mockResolvedValue(null);
  expect(await Browse.renderStatus('own-9', 'u2')).toBeNull();
});
