/**
 * bd-4joiqz (second commit) — what the portal tells the bot about a LEADER reading a lesson plan.
 *
 * A leader's k5 PDF and 6-12 ask go to the bot with their own id AND `reader: 'leader'`: the bot then serves the plan
 * their school's teachers get (the A/B arms, the v10 card) and writes no lifecycle row for it. A teacher's call is
 * byte-for-byte today's: no `reader` key at all.
 *
 * Mocked: axios only (the bot's HTTP API). The two clients are the real ones.
 */

const LEADER = '1a2b3c4d-0b8d-4c55-9a51-2d7f0e3b9c11';
const TEACHER = '6f1c2a7e-0b8d-4c55-9a51-2d7f0e3b9c10';
const ENV = { ...process.env };

let post;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ENV, MAIN_BOT_URL: 'https://bot.example', INTERNAL_API_KEY: 'k-internal' };
  post = jest.fn(async (url) => ({
    data: /lp612\/request$/.test(url)
      ? { success: true, state: 'ready', renderId: 'r-1' }
      : { success: true, available: true, url: 'https://signed.example/x.pdf', asset_kind: 'lesson', version_stamp: 'v8' },
  }));
  jest.doMock('axios', () => ({ post }));
});
afterEach(() => { process.env = { ...ENV }; jest.resetModules(); });

const bodyOf = (re) => post.mock.calls.find(([url]) => re.test(url))[1];

describe('the k5 PDF lookup (lp-catalogue.service)', () => {
  test('a leader: their own id and reader "leader"', async () => {
    await require('../../dashboard/services/lp-catalogue.service').lessonPdf('L1', 'lesson', LEADER, { reader: 'leader' });
    expect(bodyOf(/\/api\/internal\/lp\/v8\/pdf$/)).toEqual({ lessonId: 'L1', assetKind: 'lesson', userId: LEADER, reader: 'leader' });
  });

  test('a teacher: exactly today\'s body, no reader key', async () => {
    await require('../../dashboard/services/lp-catalogue.service').lessonPdf('L1', 'lesson', TEACHER);
    expect(bodyOf(/\/api\/internal\/lp\/v8\/pdf$/)).toEqual({ lessonId: 'L1', assetKind: 'lesson', userId: TEACHER });
  });
});

describe('the 6-12 ask (lp612.service)', () => {
  test('a leader: their own id (their claim on the render) and reader "leader"', async () => {
    await require('../../dashboard/services/lp612.service').requestLesson('S1', LEADER, 'en', { reader: 'leader' });
    expect(bodyOf(/\/api\/internal\/lp612\/request$/)).toEqual({ segmentId: 'S1', userId: LEADER, lang: 'en', reader: 'leader' });
  });

  test('a teacher: exactly today\'s body, no reader key', async () => {
    await require('../../dashboard/services/lp612.service').requestLesson('S1', TEACHER, 'en');
    expect(bodyOf(/\/api\/internal\/lp612\/request$/)).toEqual({ segmentId: 'S1', userId: TEACHER, lang: 'en' });
  });
});
