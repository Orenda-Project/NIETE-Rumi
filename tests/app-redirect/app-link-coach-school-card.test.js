'use strict';
/**
 * The School card's WhatsApp door: a coach types `/school card` (or `school card`), optionally followed by an EMIS or
 * a school name, and gets ONE message with an Open button that opens the coach app signed in.
 *
 *   Who:   portal_coach_school_card is on for them (true, or a JSON list of users.id holding them) AND the existing
 *          coach-link checks hold: users.role is coach and they are on the coach app (portal_coach_v2: true or a list
 *          holding them). Anyone else is not handled (false), so the text handler goes on to today's handling.
 *   Where: an exact EMIS among HER schools (leader_schools) → that school's page, /portal/coach/school/<EMIS>.
 *          Otherwise the school search (school-search.service), kept to her schools: exactly one → that school.
 *          No query, no match, several matches, or her schools unreadable → My schools, /portal/coach/people.
 *   What:  always exactly one message (cta_url; plain text only if Meta refuses the button). Never a list, a menu or
 *          a Flow. The funnel rows (app_funnel.command / link_sent / link_failed) carry audience: coach.
 *
 * Driven through the real openSchoolCard → coach-link → school pick → sendAppLink path. Only the edges are mocked:
 * WhatsApp, the logger, and Supabase (an in-memory database).
 */
const { makeDb } = require('../quiz/helpers/memory-db');

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn() }));
const mockCta = jest.fn();
const mockSend = jest.fn();
const mockOther = { sendInteractiveMessage: jest.fn(), sendInteractiveButtons: jest.fn(), sendFlow: jest.fn(), sendListMessage: jest.fn() };
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: (...a) => mockSend(...a),
  sendCtaUrl: (...a) => mockCta(...a),
  sendInteractiveMessage: (...a) => mockOther.sendInteractiveMessage(...a),
  sendInteractiveButtons: (...a) => mockOther.sendInteractiveButtons(...a),
  sendFlow: (...a) => mockOther.sendFlow(...a),
  sendListMessage: (...a) => mockOther.sendListMessage(...a),
}));
let mockDb;
jest.mock('../../bot/shared/config/supabase', () => ({
  from: (...a) => mockDb.from(...a),
  rpc: (...a) => mockDb.rpc(...a),
}));

const ENV = { ...process.env };
const ME = '60530046-7ac3-4ea3-a976-b43c37c23213';
const OTHER = '11111111-1111-4111-8111-111111111111';
const FROM = '923000000099';
const PORTAL = 'https://portal.example.test';
const SUPA = 'https://abcdefgh.supabase.co';

const coachRow = (role = 'coach') => ({ id: ME, role, name: 'Nadia', registration_completed: true, registration_state: 'completed' });
// Her three schools (one EMIS only in school_ext_id, as some rows are), and another coach's school.
const LEADER_SCHOOLS = [
  { leader_user_id: ME, source: 'niete_ict', school_ext_id: 'niete:947', school_name: 'IMSG (I-X) Dhok Sabz', emis: '947' },
  { leader_user_id: ME, source: 'niete_ict', school_ext_id: 'niete:512', school_name: 'IMSB (I-V) Dhok Kala Khan', emis: '512' },
  { leader_user_id: ME, source: 'niete_ict', school_ext_id: 'niete:310', school_name: 'IMCB G-10/4', emis: null },
  { leader_user_id: OTHER, source: 'niete_ict', school_ext_id: 'niete:777', school_name: 'IMSG (VI-X) Tarnol', emis: '777' },
];
const SCHOOLS = [
  { id: 's-947', name: 'IMSG (I-X) Dhok Sabz', region: 'Urban-I', emis: '947', is_probable_test: false },
  { id: 's-512', name: 'IMSB (I-V) Dhok Kala Khan', region: 'Urban-II', emis: '512', is_probable_test: false },
  { id: 's-310', name: 'IMCB G-10/4', region: 'Urban-I', emis: '310', is_probable_test: false },
  { id: 's-777', name: 'IMSG (VI-X) Tarnol', region: 'Tarnol', emis: '777', is_probable_test: false },
];

let svc; let link; let logger; let target;
function load({ settings = {}, users = { [ME]: coachRow() }, leaderSchools = LEADER_SCHOOLS, schools = SCHOOLS, failTables = [] } = {}) {
  jest.resetModules();
  mockDb = makeDb({
    app_settings: Object.entries(settings).map(([key, value]) => ({ key, value })),
    users: Object.values(users),
    leader_schools: leaderSchools.map((r) => ({ ...r })),
    schools: schools.map((r) => ({ ...r })),
    user_feature_first_use: [],
  }, { failTables });
  svc = require('../../bot/shared/services/app-redirect.service');
  link = require('../../bot/shared/services/app-login-link');
  target = require('../../bot/shared/services/coach-school-target');
  logger = require('../../bot/shared/utils/logger');
}
const ON = { portal_coach_school_card: true, portal_coach_v2: [ME] };

beforeEach(() => {
  mockCta.mockReset().mockResolvedValue(true);
  mockSend.mockReset().mockResolvedValue(true);
  Object.values(mockOther).forEach((f) => f.mockReset().mockResolvedValue(true));
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key', PORTAL_URL: PORTAL, SUPABASE_URL: SUPA };
});
afterAll(() => { process.env = ENV; });

const open = (query = '', { userId = ME, language = 'en' } = {}) => svc.openSchoolCard({ userId, from: FROM, language, query });
const tokenOf = (opts) => link.verifyAppLink(opts.url.slice(`${PORTAL}/go/`.length));
const sentFeature = () => tokenOf(mockCta.mock.calls[0][1]).f;
const funnel = () => logger.logToFile.mock.calls.filter(([n]) => String(n).startsWith('app_funnel.'));
const messagesSent = () => mockCta.mock.calls.length + mockSend.mock.calls.length
  + Object.values(mockOther).reduce((n, f) => n + f.mock.calls.length, 0);
const cp = (s) => [...String(s)].length;

describe('who gets the door', () => {
  test.each([
    ['true', true],
    ['"true" (JSON text)', 'true'],
    ['a list holding them', [OTHER, ME]],
    ['a list written as JSON text', JSON.stringify([ME])],
  ])('portal_coach_school_card = %s, a coach on the coach app: ONE cta_url message, handled', async (_l, value) => {
    load({ settings: { portal_coach_school_card: value, portal_coach_v2: [ME] } });
    expect(await open('947')).toBe(true);
    expect(mockCta).toHaveBeenCalledTimes(1);
    expect(messagesSent()).toBe(1);
    const [to, opts] = mockCta.mock.calls[0];
    expect(to).toBe(FROM);
    expect(opts.url.startsWith(`${PORTAL}/go/`)).toBe(true);
    expect(tokenOf(opts)).toEqual(expect.objectContaining({ u: ME, f: 'coach_school:947' }));
    expect(opts.url).not.toContain('play.google.com');
    expect(mockDb.tables.user_feature_first_use).toHaveLength(0); // no quiet hour, no Play Store notice
  });

  test('portal_coach_v2 = true (every coach) counts as on the coach app', async () => {
    load({ settings: { portal_coach_school_card: true, portal_coach_v2: true } });
    expect(await open('947')).toBe(true);
    expect(sentFeature()).toBe('coach_school:947');
  });

  test.each([
    ['no portal_coach_school_card row', {}],
    ['false', { portal_coach_school_card: false }],
    ['"false"', { portal_coach_school_card: 'false' }],
    ['"coaches" (not a value this switch takes)', { portal_coach_school_card: 'coaches' }],
    ['"teachers" (never a coach)', { portal_coach_school_card: 'teachers' }],
    ['a list without them', { portal_coach_school_card: [OTHER] }],
    ['an empty list', { portal_coach_school_card: [] }],
    ['an object', { portal_coach_school_card: { [ME]: true } }],
    ['a number', { portal_coach_school_card: 1 }],
    ['null', { portal_coach_school_card: null }],
  ])('switch %s: not handled, nothing sent', async (_l, settings) => {
    load({ settings: { portal_coach_v2: [ME], ...settings } });
    expect(await open('947')).toBe(false);
    expect(messagesSent()).toBe(0);
    expect(funnel()).toHaveLength(0);
  });

  test.each([
    ['no portal_coach_v2 row', { portal_coach_school_card: true }],
    ['portal_coach_v2 a list without them', { portal_coach_school_card: true, portal_coach_v2: [OTHER] }],
    ['portal_coach_v2 = false', { portal_coach_school_card: true, portal_coach_v2: false }],
    ['portal_coach_v2 = "teachers"', { portal_coach_school_card: true, portal_coach_v2: 'teachers' }],
  ])('switch on but %s (not on the coach app): not handled, nothing sent', async (_l, settings) => {
    load({ settings });
    expect(await open('947')).toBe(false);
    expect(messagesSent()).toBe(0);
  });

  test.each([['a teacher', 'teacher'], ['a principal', 'principal'], ['an aeo', 'aeo'], ['unregistered', 'unregistered'], ['no role', null]])(
    '%s on a "true" switch and the coach app gets no door', async (_l, role) => {
      load({ settings: { portal_coach_school_card: true, portal_coach_v2: true }, users: { [ME]: coachRow(role) } });
      expect(await open('947')).toBe(false);
      expect(messagesSent()).toBe(0);
    });

  test('a coach role written loosely (" Coach ") is still a coach', async () => {
    load({ settings: ON, users: { [ME]: coachRow(' Coach ') } });
    expect(await open('947')).toBe(true);
  });

  test('the app_settings read fails: OFF, nothing sent', async () => {
    load({ settings: ON, failTables: ['app_settings'] });
    expect(await open('947')).toBe(false);
    expect(messagesSent()).toBe(0);
  });

  test('no users row, or the users read fails: OFF, nothing sent', async () => {
    load({ settings: ON, users: {} });
    expect(await open('947')).toBe(false);
    load({ settings: ON, failTables: ['users'] });
    expect(await open('947')).toBe(false);
    expect(messagesSent()).toBe(0);
  });

  test('a switch list without them costs no users read and no school read', async () => {
    load({ settings: { portal_coach_school_card: [OTHER], portal_coach_v2: [ME] } });
    await open('947');
    expect(mockDb.reads).not.toContain('users');
    expect(mockDb.reads).not.toContain('leader_schools');
    expect(mockDb.reads).not.toContain('schools');
  });

  test('no user id or no number: not handled', async () => {
    load({ settings: ON });
    expect(await svc.openSchoolCard({ userId: null, from: FROM, language: 'en', query: '947' })).toBe(false);
    expect(await svc.openSchoolCard({ userId: ME, from: '', language: 'en', query: '947' })).toBe(false);
    expect(messagesSent()).toBe(0);
  });
});

describe('which page the link opens', () => {
  test.each([
    ['her EMIS', '947', 'coach_school:947'],
    ['her EMIS with the word EMIS', 'EMIS 947', 'coach_school:947'],
    ['her EMIS written in the school id only', '310', 'coach_school:310'],
    ['a name that matches exactly one of her schools', 'dhok sabz', 'coach_school:947'],
    ['the same name in another case', 'DHOK SABZ', 'coach_school:947'],
    ['a name spelt with a slash and hyphen', 'IMCB G-10/4', 'coach_school:310'],
    ['a name typed without them', 'imcb g104', 'coach_school:310'],
  ])('%s (%s) → that school\'s page', async (_l, q, f) => {
    load({ settings: ON });
    expect(await open(q)).toBe(true);
    expect(sentFeature()).toBe(f);
    expect(target.coachSchoolPathFor(f)).toBe(`/portal/coach/school/${f.split(':')[1]}`);
    expect(messagesSent()).toBe(1);
  });

  test.each([
    ['no query', ''],
    ['only spaces', '   '],
    ['a name matching two of her schools', 'dhok'],
    ['another coach\'s EMIS', '777'],
    ['another coach\'s school name', 'tarnol'],
    ['an EMIS nobody has', '123456'],
    ['words that match no school', 'zzqx wvut'],
  ])('%s → My schools, still exactly one message', async (_l, q) => {
    load({ settings: ON });
    expect(await open(q)).toBe(true);
    expect(sentFeature()).toBe('coach_schools');
    expect(target.coachSchoolPathFor('coach_schools')).toBe('/portal/coach/people');
    expect(messagesSent()).toBe(1);
  });

  test('she has no schools → My schools', async () => {
    load({ settings: ON, leaderSchools: [] });
    expect(await open('947')).toBe(true);
    expect(sentFeature()).toBe('coach_schools');
  });

  test('her schools cannot be read → My schools, still one message', async () => {
    load({ settings: ON, failTables: ['leader_schools'] });
    expect(await open('947')).toBe(true);
    expect(sentFeature()).toBe('coach_schools');
    expect(messagesSent()).toBe(1);
  });

  test('the school search cannot read schools → a name lands on My schools; her EMIS still wins', async () => {
    load({ settings: ON, failTables: ['schools'] });
    expect(await open('dhok sabz')).toBe(true);
    expect(sentFeature()).toBe('coach_schools');
    mockCta.mockClear();
    expect(await open('947')).toBe(true);
    expect(sentFeature()).toBe('coach_school:947');
  });

  test('a school of hers whose EMIS is not a safe page key is never linked', async () => {
    load({ settings: ON, leaderSchools: [{ leader_user_id: ME, source: 'niete_ict', school_ext_id: 'x', school_name: 'Odd', emis: '9/4?x' }] });
    expect(await open('9/4?x')).toBe(true);
    expect(sentFeature()).toBe('coach_schools');
  });

  test('never a list, a menu or a Flow — for any query', async () => {
    load({ settings: ON });
    for (const q of ['', '947', 'dhok', 'dhok sabz', 'tarnol']) await open(q);
    expect(mockCta).toHaveBeenCalledTimes(5);
    expect(mockSend).not.toHaveBeenCalled();
    Object.values(mockOther).forEach((f) => expect(f).not.toHaveBeenCalled());
  });
});

describe('the words', () => {
  test('one school, English: the line names her school; the button says Open', async () => {
    load({ settings: ON });
    await open('947');
    expect(mockCta.mock.calls[0][1]).toEqual(expect.objectContaining({
      body: 'School card for *IMSG (I-X) Dhok Sabz* is ready.', buttonText: 'Open',
    }));
  });

  test('My schools, English: one short line and Open', async () => {
    load({ settings: ON });
    await open('');
    expect(mockCta.mock.calls[0][1]).toEqual(expect.objectContaining({
      body: 'Pick a school in My schools to see its card.', buttonText: 'Open',
    }));
  });

  test('Urdu: the school name is isolated inside the bold, the button is کھولیں', async () => {
    load({ settings: ON });
    await open('947', { language: 'ur' });
    const { body, buttonText } = mockCta.mock.calls[0][1];
    expect(body).toContain('*⁨IMSG (I-X) Dhok Sabz⁩*');
    expect(body).toMatch(/سکول کارڈ/);
    expect(buttonText).toBe('کھولیں');
    mockCta.mockClear();
    await open('', { language: 'ur' });
    expect(mockCta.mock.calls[0][1].body).toMatch(/میرے سکول/);
    expect(mockCta.mock.calls[0][1].buttonText).toBe('کھولیں');
  });

  test('every button fits in 15 code points (Meta caps it at 20), in both languages', () => {
    const { resolveUx } = require('../../bot/shared/config/ux-strings');
    for (const key of ['appLinkButtonCoachSchoolCard', 'appLinkButtonCoachSchools']) {
      for (const language of ['en', 'ur']) expect(cp(resolveUx(key, { language }))).toBeLessThanOrEqual(15);
    }
  });

  test('the line never says "signed in"', async () => {
    load({ settings: ON });
    for (const language of ['en', 'ur']) { await open('947', { language }); await open('', { language }); }
    for (const [, o] of mockCta.mock.calls) expect(o.body).not.toMatch(/signed in|سائن ان/i);
  });

  test('a refused button sends the same line + link as plain text; if that fails too, not handled', async () => {
    load({ settings: ON });
    mockCta.mockResolvedValue(false);
    expect(await open('947')).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][1]).toContain('School card for *IMSG (I-X) Dhok Sabz* is ready.');
    expect(mockSend.mock.calls[0][1]).toContain(`${PORTAL}/go/`);
    mockSend.mockResolvedValue(false);
    expect(await open('947')).toBe(false);
  });
});

describe('the funnel', () => {
  test('command + link_sent, audience coach, the request is school_card, the match says how it was found', async () => {
    load({ settings: ON });
    await open('947');
    const rows = funnel();
    expect(rows.map(([n]) => n)).toEqual(['app_funnel.command', 'app_funnel.link_sent']);
    expect(rows[0][1]).toEqual(expect.objectContaining({ audience: 'coach', feature: 'school_card', door: 'command', verdict: 'link', userId: ME, match: 'emis' }));
    expect(rows[1][1]).toEqual(expect.objectContaining({ audience: 'coach', feature: 'school_card', via: 'cta_url' }));
    expect(rows[1][1].journeyId).toBe(rows[0][1].journeyId);
    const token = mockCta.mock.calls[0][1].url.split('/go/')[1];
    expect(JSON.stringify(logger.logToFile.mock.calls)).not.toContain(token);
  });

  test.each([['dhok sabz', 'name'], ['dhok', 'several'], ['tarnol', 'no_match'], ['', 'no_query']])(
    'query "%s" → match %s', async (q, match) => {
      load({ settings: ON });
      await open(q);
      expect(funnel()[0][1].match).toBe(match);
    });

  test('no portal url on this deployment: link_failed (no_portal_or_key), audience coach, not handled', async () => {
    load({ settings: ON });
    delete process.env.PORTAL_URL;
    expect(await open('947')).toBe(false);
    const failed = funnel().find(([n]) => n === 'app_funnel.link_failed');
    expect(failed[1]).toEqual(expect.objectContaining({ audience: 'coach', feature: 'school_card', reason: 'no_portal_or_key' }));
    expect(messagesSent()).toBe(0);
  });

  test('both sends refused: link_failed (send_refused), audience coach', async () => {
    load({ settings: ON });
    mockCta.mockResolvedValue(false); mockSend.mockResolvedValue(false);
    expect(await open('947')).toBe(false);
    const failed = funnel().find(([n]) => n === 'app_funnel.link_failed');
    expect(failed[1]).toEqual(expect.objectContaining({ audience: 'coach', feature: 'school_card', reason: 'send_refused' }));
  });
});

describe('nothing else moves', () => {
  test('the School card switch does not open /training, /menu or /observe for a coach', async () => {
    load({ settings: ON });
    for (const f of ['teacher_training', 'menu', 'observe']) {
      expect(await svc.redirectIfFlagged(f, { userId: ME, from: FROM, language: 'en', reason: 'command' })).toBe(false);
    }
    expect(messagesSent()).toBe(0);
  });

  test('a coach\'s /training still lands the Training Library under its own switch', async () => {
    load({ settings: { ...ON, coach_app_training: true } });
    expect(await svc.redirectIfFlagged('teacher_training', { userId: ME, from: FROM, language: 'en', reason: 'command' })).toBe(true);
    expect(sentFeature()).toBe('coach_training');
  });
});

describe('reading the command', () => {
  const parse = (s) => require('../../bot/shared/services/schools/school-card-door').parseSchoolCardCommand(s);
  test.each([
    ['/school card', ''],
    ['school card', ''],
    ['/School Card 947', '947'],
    ['SCHOOL CARD Dhok Sabz', 'Dhok Sabz'],
    ['  /school card   IMSG (I-X) Dhok Sabz  ', 'IMSG (I-X) Dhok Sabz'],
    ['/schoolcard 947', '947'],
    ['/school  card: 947', '947'],
    ['⁦/school card⁩ 947', '947'],
  ])('"%s" is the command, query "%s" (as typed)', (text, query) => {
    expect(parse(text)).toEqual({ query });
  });

  test.each(['school', '/school', 'school cardiff', 'my school card', 'what is a school card?', '/schools card', 'schoolcards', '', null, undefined, 42])(
    '"%s" is not the command', (text) => {
      expect(parse(text)).toBeNull();
    });
});
