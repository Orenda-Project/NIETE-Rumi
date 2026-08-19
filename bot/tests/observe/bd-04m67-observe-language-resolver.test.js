/**
 * bd-04m67 — one owner for language: the resolver. TDD, red-first.
 *
 * THE DEFECT THIS EXISTS TO KILL
 * ------------------------------
 * Language was decided at the point of use from whatever user object was
 * nearest. `session.users` is the FK join on `coaching_sessions.user_id`, and
 * that column holds the TEACHER on a bound observation and the COACH on a bare
 * one. So `observeLang(session.users)` returned a different person's language
 * depending on how the session was created — a difference no call site could
 * see, and none of them handled.
 *
 * The resolver names the audience instead. `languageFor('teacher', session)`
 * always resolves from the observed teacher; `languageFor('coach', session)`
 * always resolves from the observer. Neither ever reads `session.users`.
 *
 * This slice ships the resolver ALONE, wired to nothing (spec §2.2.a).
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OBSERVE_FRAMEWORK = 'fico';   // NIETE market: ur/en, default en

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));

const supabase = require('../../shared/config/supabase');
const {
  languageFor, clampToMarket, marketDefault,
} = require('../../shared/services/observe/observe-language');

/**
 * A users table that answers exactly one `.eq()` — by id or by phone_number —
 * so a test can prove WHICH person the resolver looked up, not merely which
 * language came back.
 */
function mockUsers({ byId = {}, byPhone = {}, throwOn = null } = {}) {
  const lookups = [];
  supabase.from.mockImplementation((table) => ({
    select: () => ({
      eq: (col, val) => {
        lookups.push({ table, col, val });
        return {
          maybeSingle: async () => {
            if (throwOn && throwOn === col) throw new Error('db down');
            const row = col === 'id' ? byId[val] : byPhone[val];
            return { data: row ? { preferred_language: row } : null, error: null };
          },
        };
      },
    }),
  }));
  return lookups;
}

const COACH = 'coach-uuid';
const TEACHER = 'teacher-uuid';

/** A BOUND observation: user_id is the teacher, observer_user_id is the coach. */
function boundSession(extra = {}) {
  return {
    id: 'sess-bound',
    user_id: TEACHER,
    observer_user_id: COACH,
    // The trap: the FK join on user_id. Nothing may read it.
    users: { preferred_language: 'ur', first_name: 'Teacher' },
    analysis_data: {},
    ...extra,
  };
}

/** A BARE capture: user_id AND observer_user_id are both the coach. */
function bareSession(extra = {}) {
  return {
    id: 'sess-bare',
    user_id: COACH,
    observer_user_id: COACH,
    users: { preferred_language: 'en', first_name: 'Coach' },
    analysis_data: {},
    ...extra,
  };
}

beforeEach(() => { jest.clearAllMocks(); });

describe('bd-04m67 — the audience decides, not the nearest user object', () => {
  it('resolves the TEACHER from the named teacher_delivery phone', async () => {
    const lookups = mockUsers({ byPhone: { '923001112222': 'ur' } });
    const session = boundSession({
      analysis_data: { teacher_delivery: { teacher_phone: '923001112222' } },
    });
    await expect(languageFor('teacher', session)).resolves.toBe('ur');
    expect(lookups.some((l) => l.col === 'phone_number' && l.val === '923001112222')).toBe(true);
  });

  it('resolves the TEACHER from user_id when no phone has been named yet', async () => {
    const lookups = mockUsers({ byId: { [TEACHER]: 'ur', [COACH]: 'en' } });
    await expect(languageFor('teacher', boundSession())).resolves.toBe('ur');
    expect(lookups.some((l) => l.col === 'id' && l.val === TEACHER)).toBe(true);
    expect(lookups.some((l) => l.val === COACH)).toBe(false);
  });

  it('resolves the COACH from observer_user_id — never from session.users', async () => {
    // The trap made concrete: on a bound session `session.users` is the TEACHER
    // and she speaks Urdu, while the coach speaks English. Reading the join
    // would return 'ur' here; reading the observer returns 'en'.
    const lookups = mockUsers({ byId: { [TEACHER]: 'ur', [COACH]: 'en' } });
    await expect(languageFor('coach', boundSession())).resolves.toBe('en');
    expect(lookups.some((l) => l.col === 'id' && l.val === COACH)).toBe(true);
    expect(lookups.some((l) => l.val === TEACHER)).toBe(false);
  });

  it('gives the coach her own language on a bare capture too', async () => {
    mockUsers({ byId: { [COACH]: 'ur' } });
    await expect(languageFor('coach', bareSession())).resolves.toBe('ur');
  });

  it('never returns the coach\'s language for a teacher who has no account', async () => {
    // The coach is Urdu. A teacher with no row must fall to the MARKET default
    // (en on fico), not inherit the person standing next to her.
    mockUsers({ byId: { [COACH]: 'ur' } });
    const session = boundSession({
      analysis_data: { teacher_delivery: { teacher_phone: '923009998888' } },
    });
    await expect(languageFor('teacher', session)).resolves.toBe(marketDefault());
    await expect(languageFor('teacher', session)).resolves.not.toBe('ur');
  });

  it('never returns the teacher\'s language for a coach with no row', async () => {
    mockUsers({ byId: { [TEACHER]: 'ur' } });
    await expect(languageFor('coach', boundSession())).resolves.toBe(marketDefault());
  });

  it('falls to the market default on a blank or junk preference', async () => {
    mockUsers({ byId: { [TEACHER]: '', [COACH]: '   ' } });
    await expect(languageFor('teacher', boundSession())).resolves.toBe(marketDefault());
    await expect(languageFor('coach', boundSession())).resolves.toBe(marketDefault());
  });

  it('clamps a stale Kiswahili preference away on NIETE', async () => {
    // A Tanzania-era row that survived the fork must never render Kiswahili to
    // an ICT teacher.
    mockUsers({ byId: { [TEACHER]: 'sw', [COACH]: 'sw' } });
    await expect(languageFor('teacher', boundSession())).resolves.toBe('en');
    await expect(languageFor('coach', boundSession())).resolves.toBe('en');
  });

  it('survives a database failure with the market default, never a throw', async () => {
    mockUsers({ byId: {}, throwOn: 'id' });
    await expect(languageFor('coach', boundSession())).resolves.toBe(marketDefault());
  });

  it('refuses an audience it does not know rather than guessing', async () => {
    mockUsers({ byId: { [COACH]: 'ur' } });
    await expect(languageFor('nobody', boundSession())).rejects.toThrow(/audience/i);
  });

  it('is total: a null session still yields a renderable language', async () => {
    mockUsers({});
    await expect(languageFor('teacher', null)).resolves.toBe(marketDefault());
    await expect(languageFor('coach', undefined)).resolves.toBe(marketDefault());
  });
});

describe('bd-04m67 — the market clamp is applied exactly once, here', () => {
  it('accepts only what this deployment serves', () => {
    expect(clampToMarket('ur')).toBe('ur');
    expect(clampToMarket('en')).toBe('en');
    expect(clampToMarket('sw')).toBe(null);
    expect(clampToMarket('fr')).toBe(null);
    expect(clampToMarket(null)).toBe(null);
    expect(clampToMarket(undefined)).toBe(null);
  });

  it('reads the market at CALL time, not at import time', () => {
    // The framework pack is env-driven and the worker outlives any one market
    // assumption; a cached table is how Kiswahili reached an ICT teacher before.
    const prev = process.env.OBSERVE_FRAMEWORK;
    process.env.OBSERVE_FRAMEWORK = 'mewaka';
    try {
      expect(clampToMarket('sw')).toBe('sw');
      expect(marketDefault()).toBe('sw');
    } finally {
      process.env.OBSERVE_FRAMEWORK = prev;
    }
    expect(clampToMarket('sw')).toBe(null);
    expect(marketDefault()).toBe('en');
  });
});
