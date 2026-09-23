/**
 * bd-z8p96 — the REGION_INFO screen has always carried the school's EMIS code
 * (form.emis_code), but the endpoint persisted only the province dropdown value, so the
 * one identifier the code links on (users.school_id → schools) was dropped for every
 * self-registered teacher, and users.region filled with province strings ('federal').
 *
 * Now: a typed EMIS resolves to schools.id; the stored region becomes the school's sector;
 * an unknown EMIS keeps the old behaviour (province stored, no link) and is logged so the
 * miss rate is measurable; no EMIS typed means no lookup at all.
 *
 * Supabase is mocked at the client boundary; the real handler chain runs.
 */
let mockRegStore = {};
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  set: jest.fn(async (key, val) => { mockRegStore[key] = val; }),
  get: jest.fn(async (key) => mockRegStore[key] || null),
}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const mockUpdates = [];
let mockSchoolsByEmis = {};
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((table) => ({
    update: jest.fn((cols) => ({
      eq: jest.fn(async (col, val) => { mockUpdates.push({ table, cols, by: { [col]: val } }); return { data: null, error: null }; }),
    })),
    select: jest.fn(() => ({
      eq: jest.fn((col, val) => ({
        maybeSingle: jest.fn(async () => ({
          data: table === 'schools' && col === 'emis' ? (mockSchoolsByEmis[val] || null) : null, error: null,
        })),
        limit: jest.fn(async () => ({ data: [], error: null })),
      })),
    })),
  })),
}));

const { handleRegistrationDataExchange } = require('../../bot/shared/routes/registration-endpoint');
const { logToFile } = require('../../bot/shared/utils/logger');
const FLOW_TOKEN = 'user-1:registration:1700000000';

const usersWrite = () => Object.assign({}, ...mockUpdates.filter((u) => u.table === 'users').map((u) => u.cols));
const startPk = () => handleRegistrationDataExchange('user-1', 'PERSONAL_INFO', { full_name: 'Ayesha Bano', country: 'PK' }, FLOW_TOKEN);

beforeEach(() => { mockRegStore = {}; mockUpdates.length = 0; mockSchoolsByEmis = {}; logToFile.mockClear(); });

describe('bd-z8p96 — REGION_INFO links the school by its EMIS code', () => {
  it('a known EMIS writes users.school_id and the sector, and still moves on to PROFESSIONAL_INFO', async () => {
    mockSchoolsByEmis['216'] = { id: 'school-216', name: 'IMS(I-V) G-7/1', emis: '216', region: 'Urban-I', is_probable_test: false };
    await startPk();
    const res = await handleRegistrationDataExchange('user-1', 'REGION_INFO', { region: 'federal', emis_code: ' 216 ' }, FLOW_TOKEN);
    expect(res.screen).toBe('PROFESSIONAL_INFO');
    const w = usersWrite();
    expect(w.school_id).toBe('school-216');
    expect(w.region).toBe('Urban-I');
  });

  it('an unknown EMIS keeps the old behaviour — province stored, no school_id — and logs the miss', async () => {
    await startPk();
    const res = await handleRegistrationDataExchange('user-1', 'REGION_INFO', { region: 'federal', emis_code: '999999' }, FLOW_TOKEN);
    expect(res.screen).toBe('PROFESSIONAL_INFO');
    const w = usersWrite();
    expect(w.school_id).toBeUndefined();
    expect(w.region).toBe('federal');
    expect(logToFile).toHaveBeenCalledWith(expect.stringContaining('emis_not_found'), expect.objectContaining({ emis_code: '999999' }));
  });

  it('no EMIS typed: province stored, no lookup, no school_id', async () => {
    await startPk();
    const res = await handleRegistrationDataExchange('user-1', 'REGION_INFO', { region: 'punjab' }, FLOW_TOKEN);
    expect(res.screen).toBe('PROFESSIONAL_INFO');
    const w = usersWrite();
    expect(w.school_id).toBeUndefined();
    expect(w.region).toBe('punjab');
  });
});
