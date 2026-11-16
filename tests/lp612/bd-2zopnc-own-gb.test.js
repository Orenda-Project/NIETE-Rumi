'use strict';
/**
 * bd-2zopnc — Make my own and the own-plan shelf stay off for GB teachers (Amena, 16 Nov: "we dont want this live
 * for GB"). isGbTeacher(client, userId) answers with the region rule (region.service regionForUser): users.source,
 * users.region, then her school's region. Only 'gb' is GB; 'ict' and 'unknown' are not. A failed read throws, so
 * every caller turns the feature off.
 */

let mockRegion;
let mockSeen;
jest.mock('../../bot/shared/services/region.service', () => ({
  regionForUser: jest.fn(async (_c, user) => { mockSeen.push(user); return mockRegion; }),
}));

function client({ user, school, fail } = {}) {
  const reads = [];
  return {
    reads,
    from: (table) => {
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => {
          reads.push(table);
          if (fail === table) return { data: null, error: { message: 'boom' } };
          return { data: table === 'users' ? user : school, error: null };
        },
      };
      return b;
    },
  };
}

const { isGbTeacher } = require('../../bot/shared/services/lp-own-gb');

beforeEach(() => { mockRegion = 'ict'; mockSeen = []; });

test('a GB teacher is GB', async () => {
  mockRegion = 'gb';
  const c = client({ user: { id: 'u', source: 'main_rumi_gb', region: null, school_id: null } });
  expect(await isGbTeacher(c, 'u')).toBe(true);
});

test('an ICT teacher and an unknown-region teacher are not GB', async () => {
  const c = client({ user: { id: 'u', source: null, region: 'Tarnol', school_id: null } });
  expect(await isGbTeacher(c, 'u')).toBe(false);
  mockRegion = 'unknown';
  expect(await isGbTeacher(c, 'u')).toBe(false);
});

test('her school region is passed to the rule when she has a school', async () => {
  mockRegion = 'gb';
  const c = client({ user: { id: 'u', source: null, region: null, school_id: 's1' }, school: { region: 'Gilgit-Baltistan' } });
  expect(await isGbTeacher(c, 'u')).toBe(true);
  expect(mockSeen[0]).toEqual({ id: 'u', source: null, region: null, school_id: 's1', school_region: 'Gilgit-Baltistan' });
});

test('no user id or no user row is not GB', async () => {
  mockRegion = 'gb';
  expect(await isGbTeacher(client(), null)).toBe(false);
  expect(await isGbTeacher(client({ user: null }), 'u')).toBe(false);
});

test('a failed users or schools read throws (callers turn the feature off)', async () => {
  await expect(isGbTeacher(client({ fail: 'users' }), 'u')).rejects.toThrow('boom');
  const c = client({ user: { id: 'u', school_id: 's1' }, fail: 'schools' });
  await expect(isGbTeacher(c, 'u')).rejects.toThrow('boom');
});
