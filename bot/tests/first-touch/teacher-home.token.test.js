'use strict';
/**
 * The teacher home's token (kind 'th'): { k:'th', uid, lang, via, exp }, 24 hours, re-usable for landing; signed through
 * the hub's signer. A token signed inline with exactly that shape (the one-door landing mints it without importing
 * this module) verifies too. Expired → stale; forged, garbled or another kind → null.
 */
process.env.INTERNAL_API_KEY = 'unit-internal-key-not-a-secret';

const WebQuizToken = require('../../shared/services/quiz/web-quiz-token');
const HomeToken = require('../../shared/services/first-touch/teacher-home.token');

const UID = 'a0000000-0000-4000-8000-0000000000f1';

describe('teacher home token', () => {
  test('signs and verifies the five fields, 24 hours', () => {
    const now = Date.UTC(2026, 9, 16, 18, 0, 0);
    const t = HomeToken.signTeacherHome({ uid: UID, lang: 'ur', via: 'go' }, { now });
    expect(typeof t).toBe('string');
    const p = WebQuizToken.verify(t, 'th', { allowExpired: true });
    expect(p).toMatchObject({ k: 'th', uid: UID, lang: 'ur', via: 'go' });
    expect(p.exp - Math.floor(now / 1000)).toBe(HomeToken.HOME_TTL_S);
    expect(HomeToken.HOME_TTL_S).toBe(24 * 60 * 60);
    expect(HomeToken.verifyTeacherHome(HomeToken.signTeacherHome({ uid: UID, lang: 'en', via: 'menu' }))).toEqual({
      ok: expect.objectContaining({ uid: UID, lang: 'en', via: 'menu' }),
    });
  });

  test('a token signed inline with the published shape verifies', () => {
    const t = WebQuizToken.sign({ k: 'th', uid: UID, lang: 'bi', via: 'role', exp: Math.floor(Date.now() / 1000) + 3600 });
    expect(HomeToken.verifyTeacherHome(t)).toEqual({ ok: expect.objectContaining({ uid: UID, lang: 'bi', via: 'role' }) });
  });

  test('expired → stale; forged / another kind / bad field → null', () => {
    const old = HomeToken.signTeacherHome({ uid: UID, lang: 'en', via: 'go' }, { now: Date.now() - 25 * 3600 * 1000 });
    expect(HomeToken.verifyTeacherHome(old)).toEqual({ stale: expect.objectContaining({ uid: UID }) });
    const good = HomeToken.signTeacherHome({ uid: UID, lang: 'en', via: 'go' });
    expect(HomeToken.verifyTeacherHome(`${good.slice(0, -2)}xx`)).toBeNull();
    const maker = WebQuizToken.sign({ k: 'm', uid: UID, lang: 'en', tour: 0, via: 'menu', exp: Math.floor(Date.now() / 1000) + 3600 });
    expect(HomeToken.verifyTeacherHome(maker)).toBeNull();
    const badVia = WebQuizToken.sign({ k: 'th', uid: UID, lang: 'en', via: 'nowhere', exp: Math.floor(Date.now() / 1000) + 3600 });
    expect(HomeToken.verifyTeacherHome(badVia)).toBeNull();
    expect(HomeToken.signTeacherHome({ uid: '', lang: 'en', via: 'go' })).toBeNull();
    expect(HomeToken.signTeacherHome({ uid: UID, lang: 'fr', via: 'go' })).toBeNull();
    expect(HomeToken.verifyTeacherHome(null)).toBeNull();
  });

  test("via 'portal' (the teacher app's home card) round-trips; an unknown via is still refused", () => {
    const t = HomeToken.signTeacherHome({ uid: UID, lang: 'ur', via: 'portal' });
    expect(typeof t).toBe('string');
    expect(HomeToken.verifyTeacherHome(t)).toEqual({ ok: expect.objectContaining({ uid: UID, lang: 'ur', via: 'portal' }) });
    expect(HomeToken.signTeacherHome({ uid: UID, lang: 'en', via: 'nope' })).toBeNull();
  });

  test('the url is /quiz/teacher/<token> on the web base', () => {
    const t = HomeToken.signTeacherHome({ uid: UID, lang: 'en', via: 'go' });
    expect(HomeToken.teacherHomePath(t)).toBe(`/quiz/teacher/${t}`);
  });
});
