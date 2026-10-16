/**
 * bd-x7aprz.2 (+ bd-3goqc0) — the registration Flow v5 and the endpoint fixes under it.
 *
 * What these pin, each one a thing production got wrong or the operator decided on 2026-10-16:
 *   - the form may give a person ONE of two roles, teacher or principal, and never touches a
 *     coach or AEO an admin set (bd-3goqc0);
 *   - the state saved between screens is read back. Redis' get() already JSON-parses, so the old
 *     JSON.parse(object) threw and every read came back {} (403 times in 30 days in niete-logs):
 *     the SUCCESS card greeted "Teacher" and BACK lost the region screen;
 *   - v5 is name + language -> role + school search -> pick a REAL school (or none) -> grades +
 *     subjects -> done, while the v4 screens production still serves keep working;
 *   - one apology when a submission fails, not two;
 *   - the completion message opens the portal through the signed /go link.
 *
 * The redis mock below keeps the REAL contract (set serialises, get parses) — the old suite's
 * mock handed back the raw string, which is how the bug passed it.
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
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => ({ ok: true })),
  sendCtaUrl: jest.fn(async () => true),
}));
jest.mock('../../bot/shared/services/conversation-state.service', () => ({}));
jest.mock('../../bot/shared/services/reading/passage-generation.service', () => ({}));
jest.mock('../../bot/shared/services/reading/auto-level-orchestrator.service', () => ({}));
jest.mock('../../bot/shared/services/student-ingress-cache', () => ({ forget: jest.fn(async () => {}) }));

const mockUsers = new Map();
const mockUpdates = [];
const mockSchools = [];
let mockFailUserUpdate = false;
jest.mock('../../bot/shared/config/supabase', () => {
  const usersQuery = () => {
    const q = {
      _id: null,
      select: () => q,
      eq: (col, val) => { if (col === 'id') q._id = val; return q; },
      single: async () => ({ data: mockUsers.get(q._id) || null, error: mockUsers.has(q._id) ? null : { message: 'not found' } }),
      maybeSingle: async () => ({ data: mockUsers.get(q._id) || null, error: null }),
    };
    return q;
  };
  const schoolsQuery = () => {
    const filters = [];
    const run = async () => {
      let rows = mockSchools.slice();
      for (const [col, val] of filters) rows = rows.filter((r) => String(r[col]) === String(val));
      return rows;
    };
    const q = {
      select: () => q,
      eq: (col, val) => { filters.push([col, val]); return q; },
      maybeSingle: async () => ({ data: (await run())[0] || null, error: null }),
      then: (resolve, reject) => run().then((data) => resolve({ data, error: null }), reject),
    };
    return q;
  };
  return {
    from: jest.fn((table) => {
      if (table === 'schools') return schoolsQuery();
      const q = usersQuery();
      q.update = (cols) => ({
        eq: async (col, val) => {
          if (mockFailUserUpdate) return { data: null, error: { message: 'value too long for type character varying(100)' } };
          mockUpdates.push({ table, cols, id: val });
          if (table === 'users') mockUsers.set(val, { ...(mockUsers.get(val) || {}), ...cols });
          return { data: null, error: null };
        },
      });
      return q;
    }),
  };
});

const { resolveUx } = require('../../bot/shared/config/ux-strings');
const { setUserLanguage } = require('../../bot/shared/utils/language-cache');
const WhatsAppService = require('../../bot/shared/services/whatsapp.service');

const UID = '11111111-1111-4111-8111-111111111111';
const TOKEN = `${UID}:registration:1760000000000`;
const SCHOOL_G72 = { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'IMSG (VI-X) G-7/2', region: 'Urban-I', emis: '423', is_probable_test: false };
const SCHOOL_TARNOL = { id: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'IMSB (I-V) Tarnol', region: 'Tarnol', emis: '901', is_probable_test: false };
const SCHOOL_G91 = { id: 'aaaaaaaa-0000-4000-8000-000000000003', name: 'IMSG(I-X) G-9/1', region: 'Urban-II', emis: '424', is_probable_test: false };
const SCHOOL_TEST = { id: 'aaaaaaaa-0000-4000-8000-000000000009', name: 'IMSG G-7/2 TEST SCHOOL', region: 'Urban-I', emis: '999', is_probable_test: true };

const writesTo = (id) => Object.assign({}, ...mockUpdates.filter((u) => u.table === 'users' && u.id === id).map((u) => u.cols));
const wroteKey = (id, key) => mockUpdates.some((u) => u.table === 'users' && u.id === id && Object.prototype.hasOwnProperty.call(u.cols, key));

function loadEndpoint() {
  return require('../../bot/shared/routes/registration-endpoint');
}

beforeEach(() => {
  mockRedisStore.clear();
  mockUsers.clear();
  mockUpdates.length = 0;
  mockSchools.length = 0;
  mockSchools.push(SCHOOL_G72, SCHOOL_TARNOL, SCHOOL_G91, SCHOOL_TEST);
  mockFailUserUpdate = false;
  mockUsers.set(UID, { id: UID, name: null, role: 'teacher', preferred_language: 'en', language_locked: false, school_id: null, organization: null });
  jest.clearAllMocks();
  try { require('../../bot/shared/services/schools/school-search.service')._resetCache(); } catch (_) { /* red: module absent */ }
});

// ─── 1. one role policy ────────────────────────────────────────────────────
describe('the role the form may give (bd-3goqc0)', () => {
  const { roleToWrite, FORM_ROLES } = require('../../bot/shared/config/registration-roles');

  it('offers exactly teacher and principal', () => {
    expect(FORM_ROLES).toEqual(['teacher', 'principal']);
    const { ROLES_DROPDOWN } = require('../../bot/shared/config/registration-data');
    expect(ROLES_DROPDOWN.map((r) => r.id)).toEqual(['teacher', 'principal']);
  });

  it('grants teacher or principal, refuses coach and aeo', () => {
    expect(roleToWrite('teacher', 'teacher')).toBe('teacher');
    expect(roleToWrite('Principal', null)).toBe('principal');
    expect(roleToWrite('coach', 'teacher')).toBeNull();
    expect(roleToWrite('aeo', null)).toBeNull();
    expect(roleToWrite('', 'teacher')).toBeNull();
  });

  it('never changes a role an admin set', () => {
    expect(roleToWrite('teacher', 'coach')).toBeNull();
    expect(roleToWrite('principal', 'aeo')).toBeNull();
  });
});

// ─── 2. state between screens survives (the [object Object] bug) ───────────
describe('v4 screens with the real redis contract', () => {
  it('BACK from PROFESSIONAL_INFO returns REGION_INFO for a Pakistan teacher', async () => {
    const ep = loadEndpoint();
    await ep.handleRegistrationDataExchange(UID, 'PERSONAL_INFO', { full_name: 'Ayesha Bano', country: 'PK' }, TOKEN);
    await ep.handleRegistrationDataExchange(UID, 'REGION_INFO', { region: 'federal', emis_code: '' }, TOKEN);
    const back = await ep.handleRegistrationBack(UID, 'PROFESSIONAL_INFO', TOKEN);
    expect(back.screen).toBe('REGION_INFO');
  });

  it('the SUCCESS card greets her by the name she typed', async () => {
    const ep = loadEndpoint();
    await ep.handleRegistrationDataExchange(UID, 'PERSONAL_INFO', { full_name: 'Ayesha Bano', country: 'PK' }, TOKEN);
    await ep.handleRegistrationDataExchange(UID, 'REGION_INFO', { region: 'federal', emis_code: '' }, TOKEN);
    const done = await ep.handleRegistrationDataExchange(UID, 'PROFESSIONAL_INFO',
      { organization: 'fde', school_name: 'IMSG G-7/2', grade: ['grade_3'], subjects: ['maths'], role: 'teacher' }, TOKEN);
    expect(done.screen).toBe('SUCCESS');
    expect(done.data.welcome_message).toContain('Ayesha');
  });

  it('a forged coach role on the v4 professional screen is not written', async () => {
    const ep = loadEndpoint();
    await ep.handleRegistrationDataExchange(UID, 'PERSONAL_INFO', { full_name: 'Ayesha Bano', country: 'PK' }, TOKEN);
    await ep.handleRegistrationDataExchange(UID, 'PROFESSIONAL_INFO',
      { organization: 'fde', school_name: 'x', grade: [], subjects: [], role: 'coach' }, TOKEN);
    expect(writesTo(UID).role).toBeUndefined();
  });
});

// ─── 3. v5 screens ─────────────────────────────────────────────────────────
describe('v5: name + language -> role + school -> pick -> teaching -> done', () => {
  it('INIT prefills what we already know and still serves the v4 first screen', async () => {
    mockUsers.set(UID, { ...mockUsers.get(UID), name: 'Ayesha Bano', preferred_language: 'ur', language_locked: true });
    const ep = loadEndpoint();
    const init = await ep.handleRegistrationInit(UID);
    expect(init.screen).toBe('PERSONAL_INFO');
    expect(init.data.init_full_name).toBe('Ayesha Bano');
    expect(init.data.init_language).toBe('ur');
    expect(Array.isArray(init.data.languages)).toBe(true);
    expect(Array.isArray(init.data.countries)).toBe(true); // v4 still served by prod until it is republished
  });

  it('PERSONAL_INFO (no country) -> ROLE_SCHOOL in her language, name + PK + language stored', async () => {
    const ep = loadEndpoint();
    const r = await ep.handleRegistrationDataExchange(UID, 'PERSONAL_INFO', { full_name: '  Ayesha Bano ', language: 'ur' }, TOKEN);
    expect(r.screen).toBe('ROLE_SCHOOL');
    expect(r.data.t_search_label).toBe(resolveUx('regFormSearchLabel', { language: 'ur' }));
    expect(r.data.roles.map((x) => x.id)).toEqual(['teacher', 'principal']);
    expect(r.data.show_role).toBe(true);
    const w = writesTo(UID);
    expect(w.name).toBe('Ayesha Bano');
    expect(w.country).toBe('PK');
    expect(setUserLanguage).toHaveBeenCalledWith(UID, 'ur', true);
  });

  it('ROLE_SCHOOL searches the real schools: "IMSG G7/2" finds IMSG (VI-X) G-7/2 first, test schools never', async () => {
    const ep = loadEndpoint();
    await ep.handleRegistrationDataExchange(UID, 'PERSONAL_INFO', { full_name: 'Ayesha Bano', language: 'en' }, TOKEN);
    const r = await ep.handleRegistrationDataExchange(UID, 'ROLE_SCHOOL', { role: 'principal', school_query: 'IMSG G7/2' }, TOKEN);
    expect(r.screen).toBe('SCHOOL_PICK');
    const ids = r.data.schools.map((s) => s.id);
    expect(ids[0]).toBe(SCHOOL_G72.id);
    expect(ids).not.toContain(SCHOOL_TEST.id);
    expect(ids[ids.length - 1]).toBe('none');
    expect(r.data.schools.length).toBeLessThanOrEqual(11);
    expect(writesTo(UID).role).toBe('principal');
  });

  it('a forged coach role is not written, and an existing coach keeps her role and is not asked', async () => {
    const ep = loadEndpoint();
    await ep.handleRegistrationDataExchange(UID, 'ROLE_SCHOOL', { role: 'coach', school_query: 'tarnol' }, TOKEN);
    expect(wroteKey(UID, 'role')).toBe(false);

    mockUsers.set(UID, { ...mockUsers.get(UID), role: 'coach' });
    const p = await ep.handleRegistrationDataExchange(UID, 'PERSONAL_INFO', { full_name: 'Rifat Ara', language: 'en' }, TOKEN);
    expect(p.data.show_role).toBe(false);
    await ep.handleRegistrationDataExchange(UID, 'ROLE_SCHOOL', { role: 'teacher', school_query: 'tarnol' }, TOKEN);
    expect(mockUsers.get(UID).role).toBe('coach');
  });

  it('SCHOOL_PICK stores a real school and its sector; "none" and a test or forged id store nothing', async () => {
    const ep = loadEndpoint();
    let r = await ep.handleRegistrationDataExchange(UID, 'SCHOOL_PICK', { school_id: 'none' }, TOKEN);
    expect(r.screen).toBe('TEACHING');
    expect(wroteKey(UID, 'school_id')).toBe(false);

    await ep.handleRegistrationDataExchange(UID, 'SCHOOL_PICK', { school_id: SCHOOL_TEST.id }, TOKEN);
    await ep.handleRegistrationDataExchange(UID, 'SCHOOL_PICK', { school_id: 'not-a-school' }, TOKEN);
    expect(wroteKey(UID, 'school_id')).toBe(false);

    r = await ep.handleRegistrationDataExchange(UID, 'SCHOOL_PICK', { school_id: SCHOOL_TARNOL.id }, TOKEN);
    expect(r.screen).toBe('TEACHING');
    expect(writesTo(UID).school_id).toBe(SCHOOL_TARNOL.id);
    expect(writesTo(UID).region).toBe('Tarnol');
  });

  it('TEACHING completes: grades + subjects stored, flag set, flat params for the chat ack', async () => {
    const ep = loadEndpoint();
    await ep.handleRegistrationDataExchange(UID, 'PERSONAL_INFO', { full_name: 'Ayesha Bano', language: 'en' }, TOKEN);
    const done = await ep.handleRegistrationDataExchange(UID, 'TEACHING',
      { grade: ['grade_1', 'grade_2'], subjects: ['maths', 'urdu'] }, TOKEN);
    expect(done.screen).toBe('SUCCESS');
    expect(done.data.registration_action).toBe('complete');
    expect(done.data.welcome_message).toContain('Ayesha');
    const w = writesTo(UID);
    expect(w.registration_completed).toBe(true);
    expect(w.grades_taught).toEqual(['grade_1', 'grade_2']);
    expect(w.subjects_taught).toEqual(['maths', 'urdu']);
  });
});

// ─── 4. the search itself ──────────────────────────────────────────────────
describe('school search', () => {
  const svc = () => require('../../bot/shared/services/schools/school-search.service');

  it('normalises case, spaces, brackets, hyphens and slashes', async () => {
    expect((await svc().searchSchools('g-7/2')).map((s) => s.id)[0]).toBe(SCHOOL_G72.id);
    expect((await svc().searchSchools('IMSG(VI-X)G72')).map((s) => s.id)[0]).toBe(SCHOOL_G72.id);
    expect((await svc().searchSchools('model school girls g 9/1')).map((s) => s.id)[0]).toBe(SCHOOL_G91.id);
  });

  it('an exact EMIS ranks first and a test school is never offered', async () => {
    expect((await svc().searchSchools('424')).map((s) => s.id)[0]).toBe(SCHOOL_G91.id);
    expect((await svc().searchSchools('test school')).map((s) => s.id)).not.toContain(SCHOOL_TEST.id);
  });

  it('nothing matched is an empty list, not a guess', async () => {
    expect(await svc().searchSchools('zzzz qqqq')).toEqual([]);
  });
});

// ─── 5–7. the terminal handler ─────────────────────────────────────────────
describe('completion (handleRegistrationFlow)', () => {
  const payload = (fields) => ({ interactive: { nfm_reply: { response_json: JSON.stringify(fields) } } });
  const handler = () => require('../../bot/shared/handlers/flow-response.handler');

  it('a coach role in the payload is not written, and an existing coach is not demoted', async () => {
    await handler().handleRegistrationFlow(payload({ full_name: 'A B', country: 'PK', role: 'coach' }), '923001234567', UID);
    expect(wroteKey(UID, 'role')).toBe(false);
    mockUpdates.length = 0;
    mockUsers.set(UID, { ...mockUsers.get(UID), role: 'aeo' });
    await handler().handleRegistrationFlow(payload({ full_name: 'A B', country: 'PK', role: 'teacher' }), '923001234567', UID);
    expect(wroteKey(UID, 'role')).toBe(false);
  });

  it('a failed submission sends exactly ONE apology', async () => {
    mockFailUserUpdate = true;
    const ok = await handler().routeRegistrationSubmission(payload({ full_name: 'A B', country: 'PK' }), '923001234567', UID);
    expect(ok).toBe(false);
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('whatsapp-bot.js hands the registration submission to that one function', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../bot/whatsapp-bot.js'), 'utf8');
    const start = src.indexOf("flowType === 'registration'");
    const branch = src.slice(start, src.indexOf('} else if (flowType', start + 10));
    expect(branch).toContain('routeRegistrationSubmission');
    expect(branch).not.toContain('sendMessage');
  });

  it('the welcome carries a /go portal button, signed for her', async () => {
    const prev = { k: process.env.INTERNAL_API_KEY, u: process.env.SUPABASE_URL };
    process.env.INTERNAL_API_KEY = 'test-internal-key';
    process.env.SUPABASE_URL = 'https://sandboxref.supabase.co';
    try {
      const v5 = { registration_action: 'complete', flow_token: TOKEN, full_name: 'Ayesha Bano', language: 'ur' };
      expect(await handler().handleRegistrationFlow(payload(v5), '923001234567', UID)).toBe(true);
      expect(WhatsAppService.sendCtaUrl).toHaveBeenCalledTimes(1);
      const [, opts] = WhatsAppService.sendCtaUrl.mock.calls[0];
      expect(opts.url).toMatch(/^https:\/\/portal\.example\.com\/go\/[A-Za-z0-9_-]+$/);
      expect(opts.buttonText).toBe(resolveUx('regDonePortalButton', { language: 'ur' }));
      const { verifyAppLink } = require('../../bot/shared/services/app-login-link');
      expect(verifyAppLink(opts.url.split('/go/')[1]).u).toBe(UID);
    } finally {
      process.env.INTERNAL_API_KEY = prev.k; process.env.SUPABASE_URL = prev.u;
      if (prev.k === undefined) delete process.env.INTERNAL_API_KEY;
      if (prev.u === undefined) delete process.env.SUPABASE_URL;
    }
  });

  it('with no signing key the welcome is a plain message, never a broken link', async () => {
    const prev = process.env.INTERNAL_API_KEY; delete process.env.INTERNAL_API_KEY;
    try {
      await handler().handleRegistrationFlow(payload({ registration_action: 'complete', flow_token: TOKEN, full_name: 'Ayesha Bano' }), '923001234567', UID);
      expect(WhatsAppService.sendCtaUrl).not.toHaveBeenCalled();
      expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
      expect(WhatsAppService.sendMessage.mock.calls[0][1]).not.toMatch(/undefined|null|\/go\//);
    } finally { if (prev !== undefined) process.env.INTERNAL_API_KEY = prev; }
  });
});
