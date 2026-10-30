/**
 * bd-97daxo.6 — a teacher who registers at a Gilgit-Baltistan school belongs to Moawin, not to FDE.
 *
 * The v5 form never asks for an organization: until now it wrote the deployment's own ('niete') on the
 * first screen, for everyone. With Gilgit-Baltistan on the same number, that put every GB teacher in
 * FDE's organization, which is exactly the population FDE's analytics must never see. The owner of a
 * region is in the region registry (region_features.organization, bd-97daxo.2), so the school she picks
 * decides it:
 *   - no organization before the form + a school in a registry region → that region's owner;
 *   - an organization she already had (a roster import, a migrated account) is kept;
 *   - a region the registry does not know, or a registry that cannot be read → 'niete', as before,
 *     and registration carries on (it must never break over the registry).
 *
 * Runs the real endpoint, the real school search and the real region registry over a fake supabase.
 */

const mockRedisStore = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(async (key) => {
    if (!mockRedisStore.has(key)) return null;
    const raw = mockRedisStore.get(key);
    try { return JSON.parse(raw); } catch { return raw; }
  }),
  set: jest.fn(async (key, value) => {
    mockRedisStore.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    return true;
  }),
}));

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../bot/shared/utils/language-cache', () => ({ setUserLanguage: jest.fn(async () => true) }));
jest.mock('../../bot/shared/config/branding', () => ({ portalUrl: () => 'https://portal.example.com' }));

const mockUsers = new Map();
const mockUpdates = [];
const mockSchools = [];
const mockRegistry = { rows: [], fail: false, reads: 0 };
jest.mock('../../bot/shared/config/supabase', () => {
  const usersQuery = () => {
    const q = {
      _id: null,
      select: () => q,
      eq: (col, val) => { if (col === 'id') q._id = val; return q; },
      maybeSingle: async () => ({ data: mockUsers.get(q._id) || null, error: null }),
    };
    q.update = (cols) => ({
      eq: async (col, val) => {
        mockUpdates.push({ cols, id: val });
        mockUsers.set(val, { ...(mockUsers.get(val) || {}), ...cols });
        return { data: null, error: null };
      },
    });
    return q;
  };
  const schoolsQuery = () => {
    const q = {
      select: () => q,
      then: (resolve, reject) => Promise.resolve({ data: mockSchools.slice(), error: null }).then(resolve, reject),
    };
    return q;
  };
  const registryQuery = () => ({
    select: () => {
      mockRegistry.reads += 1;
      return Promise.resolve(mockRegistry.fail
        ? { data: null, error: { message: 'relation "region_features" is unreachable' } }
        : { data: mockRegistry.rows.slice(), error: null });
    },
  });
  return {
    from: jest.fn((table) => {
      if (table === 'schools') return schoolsQuery();
      if (table === 'region_features') return registryQuery();
      return usersQuery();
    }),
  };
});

const { logToFile } = require('../../bot/shared/utils/logger');

const UID = '22222222-2222-4222-8222-222222222222';
const TOKEN = `${UID}:registration:1761700000000`;
const GB_SCHOOL = { id: 'bbbbbbbb-0000-4000-8000-000000000001', name: 'MF Community School Harpandas', region: 'Gilgit-Baltistan', emis: '91516', is_probable_test: false };
const GB_SCHOOL_2 = { id: 'bbbbbbbb-0000-4000-8000-000000000002', name: 'Sun Valley Middle Kanday - MF community', region: 'Gilgit-Baltistan', emis: '63027', is_probable_test: false };
const TARNOL = { id: 'bbbbbbbb-0000-4000-8000-000000000003', name: 'IMSB (I-V) Tarnol', region: 'Tarnol', emis: '901', is_probable_test: false };
const JUNK_REGION = { id: 'bbbbbbbb-0000-4000-8000-000000000004', name: 'IMSG Barakahu', region: 'Barakahu', emis: '777', is_probable_test: false };

const REGISTRY = [
  { region: 'niete', organization: null, display_name: null, sort_order: null, is_active: true },
  { region: 'tarnol', organization: 'niete', display_name: 'Tarnol', sort_order: 6, is_active: true },
  { region: 'gilgit-baltistan', organization: 'moawin', display_name: 'Gilgit-Baltistan', sort_order: 1, is_active: true },
];

const ep = () => require('../../bot/shared/routes/registration-endpoint');
const row = () => mockUsers.get(UID);

async function registerAt(school, { startOrg = null } = {}) {
  mockUsers.set(UID, { ...row(), organization: startOrg });
  await ep().handleRegistrationDataExchange(UID, 'PERSONAL_INFO', { full_name: 'Zainab Ali', language: 'ur' }, TOKEN);
  await ep().handleRegistrationDataExchange(UID, 'ROLE_SCHOOL', { role: 'teacher', school_query: school.name }, TOKEN);
  return ep().handleRegistrationDataExchange(UID, 'SCHOOL_PICK', { school_id: school.id }, TOKEN);
}

beforeEach(() => {
  mockRedisStore.clear();
  mockUsers.clear();
  mockUpdates.length = 0;
  mockSchools.length = 0;
  mockSchools.push(GB_SCHOOL, GB_SCHOOL_2, TARNOL, JUNK_REGION);
  mockRegistry.rows = REGISTRY.slice();
  mockRegistry.fail = false;
  mockRegistry.reads = 0;
  mockUsers.set(UID, { id: UID, name: null, role: 'teacher', preferred_language: 'en', language_locked: false, school_id: null, organization: null });
  jest.clearAllMocks();
  require('../../bot/shared/services/schools/school-search.service')._resetCache();
  require('../../bot/shared/services/region-registry')._clearCache();
});

describe('the organization a registering teacher gets comes from her school\'s region (bd-97daxo.6)', () => {
  it('a new teacher at a Gilgit-Baltistan school belongs to moawin, in region Gilgit-Baltistan', async () => {
    const r = await registerAt(GB_SCHOOL);
    expect(r.screen).toBe('TEACHING');
    expect(row().school_id).toBe(GB_SCHOOL.id);
    expect(row().region).toBe('Gilgit-Baltistan');
    expect(row().organization).toBe('moawin');
  });

  it('a new teacher at a sector school stays niete', async () => {
    await registerAt(TARNOL);
    expect(row().region).toBe('Tarnol');
    expect(row().organization).toBe('niete');
  });

  it('a region the registry does not know keeps niete', async () => {
    await registerAt(JUNK_REGION);
    expect(row().organization).toBe('niete');
  });

  it('picking a GB school, stepping back and picking a sector school ends niete', async () => {
    await registerAt(GB_SCHOOL);
    expect(row().organization).toBe('moawin');
    await ep().handleRegistrationDataExchange(UID, 'SCHOOL_PICK', { school_id: TARNOL.id }, TOKEN);
    expect(row().organization).toBe('niete');
  });

  it('an organization she had before the form is kept, whichever school she picks', async () => {
    await registerAt(GB_SCHOOL, { startOrg: 'niete' });
    expect(row().organization).toBe('niete');

    mockRedisStore.clear();
    await registerAt(TARNOL, { startOrg: 'moawin' });
    expect(row().organization).toBe('moawin');
  });

  it('a registry that cannot be read keeps niete, says so in the log, and the form goes on', async () => {
    mockRegistry.fail = true;
    const r = await registerAt(GB_SCHOOL);
    expect(r.screen).toBe('TEACHING');
    expect(row().school_id).toBe(GB_SCHOOL.id);
    expect(row().organization).toBe('niete');
    const logged = logToFile.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toMatch(/registry/i);
  });

  it('"none" (no school) leaves the default organization alone', async () => {
    await ep().handleRegistrationDataExchange(UID, 'PERSONAL_INFO', { full_name: 'Zainab Ali', language: 'ur' }, TOKEN);
    const r = await ep().handleRegistrationDataExchange(UID, 'SCHOOL_PICK', { school_id: 'none' }, TOKEN);
    expect(r.screen).toBe('TEACHING');
    expect(row().organization).toBe('niete');
    expect(mockRegistry.reads).toBe(0);
  });
});

describe('Gilgit-Baltistan schools can be picked once they are in the schools table (bd-97daxo.6)', () => {
  const search = (q) => require('../../bot/shared/services/schools/school-search.service').searchSchools(q);

  it('found by name', async () => {
    expect((await search('harpandas')).map((s) => s.id)).toEqual([GB_SCHOOL.id]);
    expect((await search('Sun Valley Kanday')).map((s) => s.id)[0]).toBe(GB_SCHOOL_2.id);
  });

  it('found by region, and by EMIS', async () => {
    const ids = (await search('gilgit')).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([GB_SCHOOL.id, GB_SCHOOL_2.id]));
    expect(ids).not.toContain(TARNOL.id);
    expect((await search('91516')).map((s) => s.id)[0]).toBe(GB_SCHOOL.id);
  });

  it('the picker shows a GB school with its region', async () => {
    await ep().handleRegistrationDataExchange(UID, 'PERSONAL_INFO', { full_name: 'Zainab Ali', language: 'en' }, TOKEN);
    const r = await ep().handleRegistrationDataExchange(UID, 'ROLE_SCHOOL', { role: 'teacher', school_query: 'harpandas' }, TOKEN);
    const opt = r.data.schools.find((s) => s.id === GB_SCHOOL.id);
    expect(opt).toBeDefined();
    expect(opt.description).toContain('Gilgit-Baltistan');
  });
});
