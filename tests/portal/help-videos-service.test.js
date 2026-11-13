'use strict';
/**
 * bd-ik5e8j.4 (queue #85) — dashboard/services/help-videos.service.js: the help manifest on the content bucket, by
 * app_settings help_videos_version. No version, no base, a bad version or a failed read → NO videos; never throws.
 */
const { createHelpVideos, cleanVideo } = require('../../dashboard/services/help-videos.service');

const ENV = { CONTENT_R2_PUBLIC_URL: 'https://cdn.example/' };
const V = (o) => ({ feature: 'lessons', roles: ['teacher'], lang: 'ur', title: 'Lesson plans', url: 'https://cdn.example/help/v1/lessons-ur.mp4', ...o });

test('no version row: no videos, nothing fetched', async () => {
  const fetched = [];
  const h = createHelpVideos({ env: ENV, readVersion: async () => null, fetchJson: async (u) => { fetched.push(u); return {}; } });
  expect(await h.videosFor({ role: 'teacher', lang: 'ur' })).toEqual([]);
  expect(fetched).toEqual([]);
});

test('no base URL: no videos', async () => {
  const h = createHelpVideos({ env: {}, readVersion: async () => 'v1', fetchJson: async () => ({ videos: [V()] }) });
  expect(await h.videosFor({ role: 'teacher', lang: 'ur' })).toEqual([]);
});

test('a version that is not a plain name is refused (no path tricks)', async () => {
  const fetched = [];
  const h = createHelpVideos({ env: ENV, readVersion: async () => '../x', fetchJson: async (u) => { fetched.push(u); return {}; } });
  expect(await h.videosFor({ role: 'teacher', lang: 'ur' })).toEqual([]);
  expect(fetched).toEqual([]);
});

test('a failed manifest read: no videos, no throw', async () => {
  const h = createHelpVideos({ env: ENV, readVersion: async () => 'v1', fetchJson: async () => { throw new Error('404'); } });
  await expect(h.videosFor({ role: 'teacher', lang: 'ur' })).resolves.toEqual([]);
});

test('reads ${base}/help/${ver}/manifest.json and filters by role and language, in order', async () => {
  const fetched = [];
  const manifest = { videos: [
    V({ feature: 'start' }), V({ feature: 'lessons', lang: 'en' }), V({ feature: 'coaching', roles: ['coach'] }),
    V({ feature: 'training', url: 'http://insecure/x.mp4' }), V({ feature: 'nope' }), V({ feature: 'lessons', seconds: 89.4, bytes: 2100000 }),
  ] };
  const h = createHelpVideos({ env: ENV, readVersion: async () => 'v1-20261112', fetchJson: async (u) => { fetched.push(u); return manifest; } });
  const got = await h.videosFor({ role: 'teacher', lang: 'ur' });
  expect(fetched).toEqual(['https://cdn.example/help/v1-20261112/manifest.json']);
  expect(got.map((v) => v.feature)).toEqual(['start', 'lessons']);
  expect(got[1]).toMatchObject({ seconds: 89, bytes: 2100000, urlSmall: null, poster: null });
  expect(got[0].roles).toBeUndefined();
});

test('the version is re-read at most every 5 minutes', async () => {
  let t = 0;
  let reads = 0;
  const h = createHelpVideos({ env: ENV, now: () => t, readVersion: async () => { reads += 1; return 'v1'; }, fetchJson: async () => ({ videos: [] }) });
  t = 10 * 60 * 1000;
  await h.videosFor({ role: 'teacher', lang: 'ur' });
  t += 60 * 1000;
  await h.videosFor({ role: 'teacher', lang: 'ur' });
  expect(reads).toBe(1);
  t += 5 * 60 * 1000;
  await h.videosFor({ role: 'teacher', lang: 'ur' });
  expect(reads).toBe(2);
});

test('cleanVideo drops anything without a feature, a language, a role or an https url', () => {
  expect(cleanVideo(V())).not.toBeNull();
  expect(cleanVideo(V({ roles: [] }))).toBeNull();
  expect(cleanVideo(V({ lang: 'sw' }))).toBeNull();
  expect(cleanVideo(V({ url: 'javascript:alert(1)' }))).toBeNull();
  expect(cleanVideo(null)).toBeNull();
});
