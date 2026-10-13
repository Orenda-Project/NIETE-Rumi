'use strict';
/**
 * bd-4r3rei — the page normalises a route before it sends it, and the server normalises it AGAIN (the browser is not
 * trusted). The two must be the same rule, or one side's ':id' is the other's raw segment.
 */
const server = require('../../bot/shared/services/app-journey');
const client = require('../../portal/src/lib/funnel-route.cjs');

const SAMPLES = [
  '/portal/teacher', '/portal/teacher/', '/portal/teacher//classes', '/portal/Teacher/Classes',
  '/portal/teacher/lessons/open?plan=g612:abc&lang=ur', '/portal/teacher/lessons#frag',
  '/portal/teacher/assessment/request/8c1f0e3a-1111-4222-8333-944455556666',
  '/portal/coach/visit/12345/record', '/portal/coaching/session/3f2a9c1d77', '/portal/training/level/level-1',
  '/portal/coach/teacher/NIETE-00123/edit', '/portal/leader/teacher/ayesha.bibi', '/portal/teacher/lessons/search/Ayesha%20Bibi',
  '/portal', '/portal/', '/portal/login', '/portal/a/b/c/d/e/f/g/h/i', '/portal/' + 'a'.repeat(30), '/portal/' + 'a'.repeat(300),
  '', '/', '//evil.example/x', 'https://evil.example/portal/teacher', '/api/portal/me', '/how-it-works', 'portal/teacher', null, undefined, 42, {},
];

test.each(SAMPLES.map((s) => [String(s), s]))('%s', (_n, raw) => {
  expect(client.normaliseRoute(raw)).toBe(server.normaliseRoute(raw));
});

test('what the page never reports (signed-out and public pages) is still a valid route to the server', () => {
  for (const p of ['/portal/login', '/portal/setup/abc', '/portal/reset-password/verify', '/portal/delete-account', '/portal/privacy', '/', '/how-it-works']) {
    expect(client.shouldTrack(p)).toBe(false);
  }
  expect(client.shouldTrack('/portal/teacher')).toBe(true);
});
