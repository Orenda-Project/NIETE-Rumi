/**
 * bd-rw4so — an Urdu teacher is told her session was cancelled in ENGLISH.
 *
 * `handleConfirmation`'s terminal guard (bd-n9832) resolves the refusal
 * language from `session.users && session.users.preferred_language` — but the
 * read three lines above it is `.select('*')` on `coaching_sessions` with NO
 * `users` embed. PostgREST only returns an embedded object when the select
 * asks for one, so that property is always `undefined`, `clampLanguage` floors
 * it to the catalog's 'en', and every teacher gets the English sentence.
 *
 * Flagged as an unproven code-read by the DC/HITL sweep pass 4 (the live probe
 * could not be armed: a reply-button message stops being clickable after
 * repeated taps, so the refusal-language tap never landed). These cases prove
 * it against the real service instead.
 *
 * The fix is the embed, not an independent resolver: the existing line already
 * reads the right property through the right floor (`clampLanguage`, never an
 * inline `|| 'en'` — Rule 20), it was simply never given the data. The house
 * pattern for exactly this read is observe-debrief.service.js:831 and
 * observe-send.service.js:785, both `.select('*, users(...)')` on the same
 * table.
 *
 * The database double below is deliberately SELECT-AWARE — it hands back a
 * `users` object only when the select requested one. A double that always
 * attaches `users` would pass on the broken code and prove nothing.
 *
 * Every double-facing variable is `mock`-prefixed because babel-plugin-jest-hoist
 * refuses out-of-scope references inside a `jest.mock` factory otherwise.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';

const mockSent = [];
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn((to, text) => { mockSent.push({ to, text }); return Promise.resolve({}); }),
  sendButtonMessage: jest.fn(() => Promise.resolve({})),
  sendInteractiveButtons: jest.fn(() => Promise.resolve({})),
}));

jest.mock('../../shared/utils/logger', () => ({
  logToFile: jest.fn(),
  logError: jest.fn(),
  logWarn: jest.fn(),
}));

/** The teacher's own preference, as the users table would hold it. */
let mockTeacherLanguage = 'ur';
/** The coaching_sessions row — deliberately WITHOUT a `users` property. */
let mockSession = null;
/** Every update the service issued, so a refusal can be proven to write nothing. */
const mockUpdates = [];

jest.mock('../../shared/config/supabase', () => ({
  from: (table) => {
    const b = { _cols: '', _update: null, filters: {} };
    b.select = (cols) => { b._cols = String(cols || ''); return b; };
    ['order', 'limit', 'not', 'in', 'is', 'neq'].forEach((m) => { b[m] = () => b; });
    b.eq = (c, v) => { b.filters[c] = v; return b; };
    b.update = (fields) => { b._update = fields; return b; };
    const settle = () => {
      if (table === 'users') return { data: { preferred_language: mockTeacherLanguage }, error: null };
      if (b._update) {
        mockUpdates.push({ table, fields: b._update });
        return { data: { ...mockSession, ...b._update }, error: null };
      }
      // PostgREST returns an embedded `users` ONLY when the select names it.
      const embedded = /users\s*[:(]/.test(b._cols);
      return {
        data: embedded
          ? { ...mockSession, users: { preferred_language: mockTeacherLanguage } }
          : { ...mockSession },
        error: null,
      };
    };
    b.single = async () => settle();
    b.maybeSingle = async () => settle();
    b.then = (ok, ko) => Promise.resolve(settle()).then(ok, ko);
    return b;
  },
}));

const CoachingSessionService = require('../../shared/services/coaching/coaching-session.service');
const { resolveUx } = require('../../shared/config/ux-strings');

const SID = 'sess-rw4so-lang';
const FROM = '923000000009';
const UR = resolveUx('coachingSessionCancelled', { language: 'ur' });
const EN = resolveUx('coachingSessionCancelled', { language: 'en' });

function row(status = 'cancelled') {
  return {
    id: SID,
    status,
    user_id: 'teacher-1',
    observer_user_id: 'coach-1',
    conversation_state: { current_state: 'AWAITING_CONFIRMATION' },
  };
}

beforeEach(() => {
  mockSent.length = 0;
  mockUpdates.length = 0;
  mockTeacherLanguage = 'ur';
  mockSession = row('cancelled');
});

describe("bd-rw4so — the cancelled-session refusal speaks the teacher's language", () => {
  // If these two were equal the rest of this file would prove nothing, so the
  // offer itself is asserted first.
  test('the catalog really does carry a distinct Urdu string', () => {
    expect(UR).not.toBe(EN);
  });

  test('an Urdu teacher tapping confirm on a cancelled session reads URDU', async () => {
    const res = await CoachingSessionService.handleConfirmation(SID, FROM, true);

    expect(res.confirmed).toBe(false);
    expect(mockSent.map((s) => s.text)).toContain(UR);
    // and the guard still holds: a refusal writes nothing at all
    expect(mockUpdates).toHaveLength(0);
  });

  test('CONTROL — an English teacher still reads English', async () => {
    mockTeacherLanguage = 'en';
    const res = await CoachingSessionService.handleConfirmation(SID, FROM, true);

    expect(res.confirmed).toBe(false);
    expect(mockSent.map((s) => s.text)).toContain(EN);
    expect(mockUpdates).toHaveLength(0);
  });

  // A teacher with no stored preference must still get a renderable sentence
  // rather than `undefined` — that is what clampLanguage's floor is for.
  test('a teacher with no preference falls to the catalog floor, not a crash', async () => {
    mockTeacherLanguage = null;
    const res = await CoachingSessionService.handleConfirmation(SID, FROM, true);

    expect(res.confirmed).toBe(false);
    expect(mockSent.map((s) => s.text)).toContain(EN);
  });
});
