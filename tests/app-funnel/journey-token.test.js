'use strict';
/**
 * bd-4r3rei — the journey id: minted when the bot handles a command, carried INSIDE the encrypted /go token
 * (never in the clear), read back by the portal. Pure modules, no mocks.
 */
const ENV = { ...process.env };
let journey; let link;
beforeEach(() => {
  jest.resetModules();
  process.env = { ...ENV, INTERNAL_API_KEY: 'test-internal-key', SUPABASE_URL: 'https://abcdefgh.supabase.co' };
  journey = require('../../bot/shared/services/app-journey');
  link = require('../../bot/shared/services/app-login-link');
});
afterAll(() => { process.env = ENV; });

const USER = '60530046-7ac3-4ea3-a976-b43c37c23213';

describe('newJourneyId', () => {
  test('is opaque, URL-safe, validated by isJourneyId, and never repeats', () => {
    const ids = new Set(Array.from({ length: 200 }, () => journey.newJourneyId()));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(journey.isJourneyId(id)).toBe(true);
      expect(id).toMatch(/^j_[0-9a-f]{16}$/);
    }
  });
  test.each([[null], [undefined], [''], ['j_'], ['j_zz'], ['hello'], [42], [{}], ['j_' + 'a'.repeat(40)], ['j_0123456789abcdef\n']])(
    'isJourneyId rejects %p', (v) => expect(journey.isJourneyId(v)).toBe(false));
});

describe('the token carries the journey', () => {
  test('sign with a journey id → verify returns it, plus the old fields', () => {
    const j = journey.newJourneyId();
    const t = link.signAppLink(USER, 'lesson_plan', j);
    expect(link.verifyAppLink(t)).toEqual(expect.objectContaining({ u: USER, f: 'lesson_plan', j }));
  });
  test('the id is not readable in the URL token (encrypted, not merely encoded)', () => {
    const j = journey.newJourneyId();
    const t = link.signAppLink(USER, 'menu', j);
    expect(t).not.toContain(j);
    expect(Buffer.from(t, 'base64url').toString('latin1')).not.toContain(j);
    expect(Buffer.from(t, 'base64url').toString('latin1')).not.toContain(USER);
  });
  test('a token signed WITHOUT a journey still verifies, with j null (links already sent keep working)', () => {
    const t = link.signAppLink(USER, 'menu');
    const p = link.verifyAppLink(t);
    expect(p).toEqual(expect.objectContaining({ u: USER, f: 'menu' }));
    expect(p.j).toBeNull();
  });
  test('a malformed journey id is dropped at signing, not carried', () => {
    const t = link.signAppLink(USER, 'menu', 'not a journey id; drop table');
    expect(link.verifyAppLink(t).j).toBeNull();
  });
  test('tampering with a byte still fails the tag', () => {
    const t = link.signAppLink(USER, 'menu', journey.newJourneyId());
    const raw = Buffer.from(t, 'base64url'); raw[20] ^= 1;
    expect(link.verifyAppLink(raw.toString('base64url'))).toBeNull();
  });
  test('the token stays well under the length cap', () => {
    expect(link.signAppLink(USER, 'teacher_training', journey.newJourneyId()).length).toBeLessThan(300);
  });
});

describe('normaliseRoute — a page address with no ids and nothing a person typed', () => {
  test.each([
    ['/portal/teacher', '/portal/teacher'],
    ['/portal/teacher/lessons', '/portal/teacher/lessons'],
    ['/portal/teacher/lessons/open?plan=g612:abc&lang=ur', '/portal/teacher/lessons/open'],
    ['/portal/teacher/assessment/request/8c1f0e3a-1111-4222-8333-944455556666', '/portal/teacher/assessment/request/:id'],
    ['/portal/coach/visit/12345/record', '/portal/coach/visit/:id/record'],
    ['/portal/coaching/session/3f2a9c1d77', '/portal/coaching/session/:id'],
    ['/portal/training/level/level-1', '/portal/training/level/:id'],
    ['/portal/teacher/classes/', '/portal/teacher/classes'],
    ['/portal/teacher//classes', '/portal/teacher/classes'],
    ['/portal/Teacher/Classes', '/portal/teacher/classes'],
    ['/portal/coach/teacher/NIETE-00123/edit', '/portal/coach/teacher/:id/edit'],
    ['/portal/leader/teacher/ayesha.bibi', '/portal/leader/teacher/:id'],
    ['/portal/teacher/lessons#frag', '/portal/teacher/lessons'],
  ])('%s → %s', (raw, want) => expect(journey.normaliseRoute(raw)).toBe(want));

  test.each([[''], [null], [undefined], [42], ['https://evil.example/portal/teacher'], ['//evil.example/x'], ['/api/portal/me'],
    ['/portal/' + 'a'.repeat(300)], ['javascript:alert(1)'], ['/how-it-works'], ['/']])(
    'refuses %p (not a portal page)', (raw) => expect(journey.normaliseRoute(raw)).toBeNull());

  test('a segment that is not a plain lower-case word (a phone, a name with a space or dot, an id) becomes :id', () => {
    expect(journey.normaliseRoute('/portal/teacher/lessons/search/Ayesha%20Bibi')).toBe('/portal/teacher/lessons/search/:id');
    expect(journey.normaliseRoute('/portal/teacher/lessons/923001234567')).toBe('/portal/teacher/lessons/:id');
  });
});

describe('featureOfRoute', () => {
  test.each([
    ['/portal/teacher', 'menu'], ['/portal/teacher/lessons', 'lesson_plan'], ['/portal/teacher/lessons/open', 'lesson_plan'],
    ['/portal/curriculum', 'lesson_plan'], ['/portal/teacher/assessment/request/:id', 'assessment_generator'],
    ['/portal/teacher/training', 'teacher_training'], ['/portal/training/level/:id', 'teacher_training'],
    ['/portal/teacher/attendance', 'attendance'], ['/portal/teacher/classes', 'classes'], ['/portal/teacher/coaching', 'ai_coaching'],
    ['/portal/coach/observe', 'coach'], ['/portal/dashboard', 'dashboard'], ['/portal/account', 'other'],
  ])('%s → %s', (route, f) => expect(journey.featureOfRoute(route)).toBe(f));
});
