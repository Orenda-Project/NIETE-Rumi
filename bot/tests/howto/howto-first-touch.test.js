'use strict';
/**
 * bd-ik5e8j.5 (queue #85) — the first-touch how-to film: Film 1 "How to use NIETE", once per teacher, on her first
 * message after the switch covers her; then her message is handled exactly as today.
 *
 * The service takes its reads and sends injected, so these tests need no database, no network and no Meta.
 */
const { createHowtoFirstTouch, FEATURE, SWITCH_KEY, VIDEO_KEY } = require('../../shared/services/howto-first-touch.service');

const TEACHER = { id: 'u-teacher-1', role: 'teacher', registration_completed: true, registration_state: 'completed' };
const URLS = { ur: 'https://pub.example.r2.dev/niete-help/v1/film1-ur.mp4', en: 'https://pub.example.r2.dev/niete-help/v1/film1-en.mp4' };

/** A fake world: app_settings rows, the first-use table, a WhatsApp that records sends. */
function world({ settings = {}, language = 'ur', sendImpl = null } = {}) {
  const rows = new Set();                       // `${user_id}|${feature}` — the table's unique key
  const sends = [];
  const errors = [];
  const settingRows = { portal_teacher_v2: 'teachers', ...settings };
  const deps = {
    readSettings: jest.fn(async (keys) => new Map(keys.filter((k) => k in settingRows).map((k) => [k, settingRows[k]]))),
    readFirstUse: jest.fn(async (userId) => rows.has(`${userId}|${FEATURE}`)),
    claim: jest.fn(async (userId) => {
      const k = `${userId}|${FEATURE}`;
      if (rows.has(k)) return false;            // ON CONFLICT DO NOTHING: no row returned
      rows.add(k);
      return true;
    }),
    sendVideo: jest.fn(sendImpl || (async (to, url, caption) => { sends.push({ to, url, caption }); return true; })),
    getLanguage: jest.fn(async () => language),
    caption: (lang) => (lang === 'en' ? 'Watch this video: how to use NIETE.' : 'یہ ویڈیو دیکھیں: NIETE استعمال کرنے کا طریقہ۔'),
    logError: jest.fn((msg, meta) => errors.push({ msg, meta })),
    log: jest.fn(),
    ttlMs: 0,
    sendTimeoutMs: 50,
  };
  return { svc: createHowtoFirstTouch(deps), deps, rows, sends, errors };
}

describe('howto first touch — Film 1 once per teacher', () => {
  test('first message of a covered teacher: one video, claimed, in her language', async () => {
    const w = world({ settings: { [SWITCH_KEY]: 'teachers', [VIDEO_KEY]: URLS } });
    const r = await w.svc.maybeSend({ user: TEACHER, from: '923000000001', correlationId: 'c1' });
    expect(r.sent).toBe(true);
    expect(w.sends).toEqual([{ to: '923000000001', url: URLS.ur, caption: 'یہ ویڈیو دیکھیں: NIETE استعمال کرنے کا طریقہ۔' }]);
    expect(w.rows.has(`${TEACHER.id}|${FEATURE}`)).toBe(true);
  });

  test('English teacher gets the en film; a missing en falls back to ur', async () => {
    const w = world({ settings: { [SWITCH_KEY]: 'teachers', [VIDEO_KEY]: URLS }, language: 'en' });
    await w.svc.maybeSend({ user: TEACHER, from: '923000000001' });
    expect(w.sends[0].url).toBe(URLS.en);
    expect(w.sends[0].caption).toBe('Watch this video: how to use NIETE.');
    const w2 = world({ settings: { [SWITCH_KEY]: 'teachers', [VIDEO_KEY]: { ur: URLS.ur } }, language: 'en' });
    await w2.svc.maybeSend({ user: { ...TEACHER, id: 'u2' }, from: '923000000002' });
    expect(w2.sends[0].url).toBe(URLS.ur);
  });

  test('second message: no second video', async () => {
    const w = world({ settings: { [SWITCH_KEY]: 'teachers', [VIDEO_KEY]: URLS } });
    await w.svc.maybeSend({ user: TEACHER, from: '923000000001' });
    const r2 = await w.svc.maybeSend({ user: TEACHER, from: '923000000001' });
    expect(r2.sent).toBe(false);
    expect(w.sends).toHaveLength(1);
  });

  test('already claimed in the table (another replica, an earlier day): no video', async () => {
    const w = world({ settings: { [SWITCH_KEY]: 'teachers', [VIDEO_KEY]: URLS } });
    w.rows.add(`${TEACHER.id}|${FEATURE}`);
    const r = await w.svc.maybeSend({ user: TEACHER, from: '923000000001' });
    expect(r.sent).toBe(false);
    expect(w.sends).toHaveLength(0);
  });

  test('two messages at once: exactly one video (the claim decides)', async () => {
    const w = world({ settings: { [SWITCH_KEY]: 'teachers', [VIDEO_KEY]: URLS } });
    const a = w.svc.maybeSend({ user: TEACHER, from: '923000000001' });
    const b = w.svc.maybeSend({ user: TEACHER, from: '923000000001' });
    await Promise.all([a, b]);
    expect(w.sends).toHaveLength(1);
  });

  test.each([
    ['no row', {}],
    ['false', { [SWITCH_KEY]: false }],
    ['an object', { [SWITCH_KEY]: { on: true } }],
    ['"coaches"', { [SWITCH_KEY]: 'coaches' }],
    ['a list without her', { [SWITCH_KEY]: ['someone-else'] }],
  ])('switch off (%s): nothing sent, nothing claimed', async (_label, settings) => {
    const w = world({ settings: { ...settings, [VIDEO_KEY]: URLS } });
    const r = await w.svc.maybeSend({ user: TEACHER, from: '923000000001' });
    expect(r.sent).toBe(false);
    expect(w.sends).toHaveLength(0);
    expect(w.deps.claim).not.toHaveBeenCalled();
  });

  test('a pilot list holding her, or true, covers her', async () => {
    for (const value of [[TEACHER.id], true, 'true']) {
      const w = world({ settings: { [SWITCH_KEY]: value, [VIDEO_KEY]: URLS } });
      const r = await w.svc.maybeSend({ user: TEACHER, from: '923000000001' });
      expect(r.sent).toBe(true);
    }
  });

  test('no film URL: nothing sent and NOT claimed (she gets it once a URL is set)', async () => {
    for (const video of [undefined, {}, { ur: 'http://insecure.example/x.mp4' }, 'not-json']) {
      const settings = { [SWITCH_KEY]: 'teachers' };
      if (video !== undefined) settings[VIDEO_KEY] = video;
      const w = world({ settings });
      const r = await w.svc.maybeSend({ user: TEACHER, from: '923000000001' });
      expect(r.sent).toBe(false);
      expect(w.deps.claim).not.toHaveBeenCalled();
    }
  });

  test.each([
    ['a coach', { ...TEACHER, role: 'coach' }],
    ['a principal', { ...TEACHER, role: 'principal' }],
    ['an unregistered number', { id: 'u-x', role: 'unregistered', registration_completed: false, registration_state: null }],
    ['a teacher who never finished registering', { ...TEACHER, registration_completed: false, registration_state: 'pending_name' }],
    ['no account', null],
  ])('not a registered teacher (%s): nothing', async (_label, user) => {
    const w = world({ settings: { [SWITCH_KEY]: 'teachers', [VIDEO_KEY]: URLS } });
    const r = await w.svc.maybeSend({ user, from: '923000000001' });
    expect(r.sent).toBe(false);
    expect(w.sends).toHaveLength(0);
    expect(w.deps.claim).not.toHaveBeenCalled();
  });

  test('a teacher not on the teacher app: nothing (the film shows screens she cannot open)', async () => {
    const w = world({ settings: { [SWITCH_KEY]: 'teachers', [VIDEO_KEY]: URLS, portal_teacher_v2: ['someone-else'] } });
    const r = await w.svc.maybeSend({ user: TEACHER, from: '923000000001' });
    expect(r.sent).toBe(false);
    expect(w.deps.claim).not.toHaveBeenCalled();
  });

  test('the send fails or throws: no throw out, an error is logged with the correlation id', async () => {
    for (const impl of [async () => false, async () => { throw new Error('graph 500'); }]) {
      const w = world({ settings: { [SWITCH_KEY]: 'teachers', [VIDEO_KEY]: URLS }, sendImpl: impl });
      const r = await w.svc.maybeSend({ user: TEACHER, from: '923000000001', correlationId: 'corr-9' });
      expect(r.sent).toBe(false);
      expect(w.errors).toHaveLength(1);
      expect(w.errors[0].meta).toEqual(expect.objectContaining({ correlationId: 'corr-9', userId: TEACHER.id }));
    }
  });

  test('a send slower than the timeout does not hold her message up', async () => {
    const w = world({ settings: { [SWITCH_KEY]: 'teachers', [VIDEO_KEY]: URLS },
      sendImpl: () => new Promise((resolve) => setTimeout(() => resolve(true), 500)) });
    const t0 = Date.now();
    const r = await w.svc.maybeSend({ user: TEACHER, from: '923000000001', correlationId: 'c' });
    expect(Date.now() - t0).toBeLessThan(400);
    expect(r.sent).toBe(false);
    expect(r.why).toBe('send_timeout');
  });

  test('a failed settings read: off, never throws', async () => {
    const w = world();
    w.deps.readSettings.mockRejectedValueOnce(new Error('db down'));
    await expect(w.svc.maybeSend({ user: TEACHER, from: '923000000001' })).resolves.toEqual(expect.objectContaining({ sent: false }));
    expect(w.sends).toHaveLength(0);
  });
});

describe('howto first touch — the door never breaks a message', () => {
  test('a missing optional config module (main has no app-settings-ttl.js) does not throw at the door', async () => {
    let maybeSendHowtoFirstTouch;
    jest.isolateModules(() => {
      // virtual: the path need not exist (main has no such file), so the same test runs on every tier.
      jest.doMock('../../shared/config/app-settings-ttl', () => { throw new Error("Cannot find module '../config/app-settings-ttl'"); }, { virtual: true });
      jest.doMock('../../shared/config/supabase', () => ({
        from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }),
      }));
      ({ maybeSendHowtoFirstTouch } = require('../../shared/services/howto-first-touch.service'));
    });
    await expect(maybeSendHowtoFirstTouch({ user: { id: 'u1', role: 'teacher', name: 'T' }, from: '923000000009', correlationId: 'c' }))
      .resolves.toEqual(expect.objectContaining({ sent: false }));
  });
});
