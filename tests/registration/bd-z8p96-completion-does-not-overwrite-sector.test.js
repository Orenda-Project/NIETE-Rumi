/**
 * bd-z8p96 — the terminal registration write copied the Flow payload's `region` (the
 * province dropdown value, e.g. 'federal') onto the user row, which would overwrite the
 * sector the REGION_INFO screen had just derived from the school's EMIS. The per-screen
 * write is the source of truth for region, as it already is for role; the completion
 * write must leave region alone.
 */
jest.mock('../../bot/shared/services/whatsapp.service', () => ({ sendMessage: jest.fn(async () => ({ ok: true })) }));
jest.mock('../../bot/shared/services/conversation-state.service', () => ({}));
jest.mock('../../bot/shared/services/reading/passage-generation.service', () => ({}));
jest.mock('../../bot/shared/services/reading/auto-level-orchestrator.service', () => ({}));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/language-cache', () => ({ setUserLanguage: jest.fn(async () => true) }));
jest.mock('../../bot/shared/config/branding', () => ({ portalUrl: () => 'https://portal.example.com' }));

const mockUpdates = [];
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((table) => ({
    update: jest.fn((cols) => ({
      eq: jest.fn(async (col, val) => { mockUpdates.push({ table, cols, by: { [col]: val } }); return { data: null, error: null }; }),
    })),
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        single: jest.fn(async () => ({ data: { name: 'Ayesha Bano', country: 'PK' }, error: null })),
        maybeSingle: jest.fn(async () => ({ data: null, error: null })),
        limit: jest.fn(async () => ({ data: [], error: null })),
      })),
    })),
  })),
}));

const { handleRegistrationFlow } = require('../../bot/shared/handlers/flow-response.handler');

const usersWrite = () => Object.assign({}, ...mockUpdates.filter((u) => u.table === 'users').map((u) => u.cols));
const payload = (fields) => ({ interactive: { nfm_reply: { response_json: JSON.stringify(fields) } } });

beforeEach(() => { mockUpdates.length = 0; });

describe('bd-z8p96 — registration completion leaves users.region to the REGION_INFO write', () => {
  it('a PK payload carrying the province does not write region on completion', async () => {
    const ok = await handleRegistrationFlow(payload({
      full_name: 'Ayesha Bano', country: 'PK', region: 'federal', organization: 'niete',
      school_name: 'IMS(I-V) G-7/1', grade: 'grade_5', subjects: ['maths'], role: 'teacher', language: 'ur',
    }), '923001234567', 'user-1');
    expect(ok).toBe(true);
    const w = usersWrite();
    expect(w.registration_completed).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(w, 'region')).toBe(false);
  });
});
