'use strict';
/**
 * The big flight's audio purge (scripts/child-test/purge-sa-game-audio.js): a game recording kept under
 * child-test/<env>/game/<run>/ leaves R2 once it is older than the window (24 h by default). Dry run by default;
 * counts only; never a key outside this env's game prefix; each deleted recording's run stops pointing at it.
 */
const { purgeGameAudio, parseArgs } = require('../../scripts/child-test/purge-sa-game-audio');

const RUN = '0a1b2c3d-4e5f-5a6b-8c7d-0e1f2a3b4c5d';
const NOW = Date.parse('2026-10-21T00:00:00Z');
const hAgo = (h) => new Date(NOW - h * 3600 * 1000);

function fakeR2(objects) {
  const gone = [];
  return {
    gone,
    listObjects: jest.fn(async (prefix) => objects.filter((o) => o.key.startsWith(prefix))),
    deleteKey: jest.fn(async (k) => { gone.push(k); return true; }),
  };
}
const objects = () => [
  { key: `child-test/sandbox/game/${RUN}/en.story.webm`, lastModified: hAgo(30) },
  { key: `child-test/sandbox/game/${RUN}/en.listening/q1.webm`, lastModified: hAgo(25) },
  { key: `child-test/sandbox/game/${RUN}/ur.story.webm`, lastModified: hAgo(2) },
  { key: `child-test/sandbox/game/${RUN}/notes.txt`, lastModified: hAgo(48) }, // not a recording's shape
  { key: `child-test/sandbox/visit/${RUN}/en.story.webm`, lastModified: hAgo(48) }, // the coach's, never listed here
];

describe('purge-sa-game-audio', () => {
  test('dry run by default: counts what is past 24 h, deletes nothing, clears no row', async () => {
    const r2 = fakeR2(objects());
    const forget = jest.fn();
    const out = await purgeGameAudio({ env: 'sandbox', r2, forget, ownEnv: 'sandbox', now: NOW });
    expect(r2.listObjects).toHaveBeenCalledWith('child-test/sandbox/game/');
    expect(out).toEqual({ env: 'sandbox', hours: 24, apply: false, listed: 4, matched: 2, deleted: 0, failed: 0, rows_cleared: 0 });
    expect(r2.deleteKey).not.toHaveBeenCalled();
    expect(forget).not.toHaveBeenCalled();
  });

  test('--apply deletes exactly the old recordings, and each run stops pointing at its key', async () => {
    const r2 = fakeR2(objects());
    const forget = jest.fn(async () => true);
    const out = await purgeGameAudio({ env: 'sandbox', apply: true, r2, forget, ownEnv: 'sandbox', now: NOW });
    expect(r2.gone.sort()).toEqual([`child-test/sandbox/game/${RUN}/en.listening/q1.webm`, `child-test/sandbox/game/${RUN}/en.story.webm`]);
    expect(forget).toHaveBeenCalledWith(RUN, `child-test/sandbox/game/${RUN}/en.story.webm`);
    expect(out).toMatchObject({ apply: true, matched: 2, deleted: 2, failed: 0, rows_cleared: 2 });
  });

  test('--hours narrows the window; a failed delete is counted and its row kept', async () => {
    const r2 = fakeR2(objects());
    r2.deleteKey = jest.fn(async () => false);
    const forget = jest.fn(async () => true);
    const out = await purgeGameAudio({ env: 'sandbox', hours: 1, apply: true, r2, forget, ownEnv: 'sandbox', now: NOW });
    expect(out).toMatchObject({ hours: 1, matched: 3, deleted: 0, failed: 3, rows_cleared: 0 });
    expect(forget).not.toHaveBeenCalled();
  });

  test('refuses a missing or foreign env and a bad window; the output names no key or run', async () => {
    const r2 = fakeR2(objects());
    await expect(purgeGameAudio({ r2, ownEnv: 'sandbox', now: NOW })).rejects.toThrow(/--env is required/);
    await expect(purgeGameAudio({ env: 'production', r2, ownEnv: 'sandbox', now: NOW })).rejects.toThrow(/not this deployment/);
    await expect(purgeGameAudio({ env: 'sandbox', hours: 0, r2, ownEnv: 'sandbox', now: NOW })).rejects.toThrow(/--hours/);
    const out = await purgeGameAudio({ env: 'sandbox', r2, ownEnv: 'sandbox', now: NOW });
    expect(JSON.stringify(out)).not.toMatch(new RegExp(`${RUN}|webm`));
  });

  test('parseArgs', () => {
    expect(parseArgs(['--env', 'sandbox', '--hours', '48', '--apply'])).toEqual({ env: 'sandbox', hours: 48, apply: true });
    expect(parseArgs(['--env', 'sandbox'])).toEqual({ env: 'sandbox', hours: 24, apply: false });
    expect(() => parseArgs(['--nope'])).toThrow(/unknown argument/);
  });
});

describe('r2.listObjects: every object under a prefix with its upload time', () => {
  test('pages through the listing; an empty prefix is refused', async () => {
    jest.resetModules();
    const send = jest.fn()
      .mockResolvedValueOnce({ Contents: [{ Key: 'p/a', LastModified: hAgo(3), Size: 10 }], IsTruncated: true, NextContinuationToken: 't1' })
      .mockResolvedValueOnce({ Contents: [{ Key: 'p/b', LastModified: hAgo(1), Size: 20 }], IsTruncated: false });
    jest.doMock('../../shared/utils/lazy-client', () => ({ lazyClient: () => () => ({ send }) }));
    const r2 = require('../../shared/storage/r2');
    await expect(r2.listObjects('', {})).rejects.toThrow(/prefix/);
    const out = await r2.listObjects('p/', { bucket: 'b' });
    expect(out).toEqual([{ key: 'p/a', lastModified: hAgo(3), size: 10 }, { key: 'p/b', lastModified: hAgo(1), size: 20 }]);
    expect(send.mock.calls[1][0].input).toEqual({ Bucket: 'b', Prefix: 'p/', ContinuationToken: 't1' });
    jest.dontMock('../../shared/utils/lazy-client');
  });
});
