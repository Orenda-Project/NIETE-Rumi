'use strict';
/**
 * Every reader of a child or stories switch gives one answer for one stored value: ON only for the JSON boolean
 * `true`. A string ('true', '"true"', ' TRUE '), 1, 'yes', an object ({enabled:true}) or an absent row is OFF in
 * every module that reads the key, and a failed read is OFF.
 *
 * Each key (listed in tests/helpers/child-switch-keys.js) is read by more than one module (the kid hub, the Challenge,
 * the book, the card, the class round, the stories shelf, the live read, the teacher's story send, the identity store, ...). A module that read the string
 * 'true' as ON while another read it as OFF drew a door to a page that was off, or served behind a front that was off.
 *
 * For a key under test every other app_settings key the module asks for reads `true`, so the module's answer is the
 * tested key's. Supabase is the faked boundary.
 *
 * The first-touch door and teacher switches (quiz_maker_page, quiz_first_door, quiz_student_join, quiz_one_door,
 * quiz_teacher_home) are not child-page switches: they keep their reading, where the string "true" is on (last block).
 */
jest.mock('../../../shared/config/supabase', () => ({ from: (...a) => mockFrom(...a) }));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('../../../shared/storage/r2', () => ({}));
jest.mock('../../../shared/services/audio.service', () => ({ transcribe: jest.fn() }));
jest.mock('../../../shared/services/tts', () => ({ synthesize: jest.fn() }));
jest.mock('../../../shared/services/llm-client', () => ({ getClient: () => ({}) }));
jest.mock('../../../shared/services/cache/railway-redis.service', () => ({ isAvailable: () => false, get: async () => null, setNX: async () => false }));
jest.mock('openchemlib', () => require('../../../../tests/__mocks__/openchemlib.js'));

const { OFF_VALUES, throwOn } = require('../../helpers/switch-off-matrix');

let mockFrom = () => { throw new Error('no settings set'); };

/** app_settings where `key` holds `value` (null = no row) and every other asked-for key holds true. */
function settings(key, value) {
  return (table) => {
    const st = { keys: [], one: false };
    const b = {
      select() { return b; },
      eq(col, v) { if (col === 'key') st.keys = [v]; return b; },
      in(col, vs) { if (col === 'key') st.keys = [].concat(vs); return b; },
      maybeSingle() { st.one = true; return b; },
      single() { st.one = true; return b; },
      gte() { return b; },
      then(res, rej) {
        const rows = table !== 'app_settings' ? [] : st.keys
          .filter((k) => !(k === key && value === null))
          .map((k) => ({ key: k, value: k === key ? value : true }));
        return Promise.resolve({ data: st.one ? rows[0] || null : rows, error: null, count: 0 }).then(res, rej);
      },
    };
    return b;
  };
}

const Q = '../../../shared/services/quiz/';
const M = {
  hubFlags: () => require(`${Q}web-quiz-hub-flags`),
  identity: () => require(`${Q}web-quiz-identity-flags`),
  join: () => require(`${Q}web-quiz-student-join`),
  book: () => require(`${Q}web-quiz-book`),
  card: () => require(`${Q}web-quiz-card`),
  calibration: () => require(`${Q}web-quiz-challenge-calibration`),
  sweeper: () => require(`${Q}web-quiz-challenge-sweeper`),
  ch: () => require(`${Q}web-quiz-challenge`),
  clipWarm: () => require(`${Q}web-quiz-challenge-clip-warm`),
  classLink: () => require(`${Q}web-quiz-class-link-flags`),
  classRound: () => require(`${Q}web-quiz-class-round-flags`),
  classWeek: () => require(`${Q}web-quiz-class-week-flags`),
  hubPlay: () => require(`${Q}web-quiz-hub-play`),
  sample: () => require(`${Q}web-quiz-sample-window`),
  trail: () => require(`${Q}web-quiz-trail-page`),
  jugnu: () => require(`${Q}teacher-jugnu-flags`),
  library: () => require(`${Q}web-quiz-library-flag`),
  lr: () => require(`${Q}web-quiz-live-read-v3`),
  stories: () => require(`${Q}web-quiz-stories`),
  home: () => require(`${Q}web-quiz-home-flags`),
  storyTeacher: () => require(`${Q}story-teacher.service`),
  oneDoor: () => require('../../../shared/services/first-touch/one-door.flags'),
};

function resetAll() {
  M.hubFlags()._resetCache(); M.identity()._resetCache(); M.join()._resetCache(); M.book()._resetCache(); M.card()._resetCache();
  M.ch().__reset(); M.classLink()._resetCache(); M.classRound()._resetCache(); M.classWeek()._resetCache(); M.hubPlay()._resetCache();
  M.trail()._reset(); M.jugnu()._resetCache(); M.library()._reset(); M.lr()._reset(); M.stories()._reset(); M.home()._resetCache();
  M.storyTeacher()._reset(); M.oneDoor()._resetCache();
}

/** Every boolean field of a flags object on (each field is effective only with its parents on). */
const allOn = (o) => Object.values(o).filter((v) => typeof v === 'boolean').every(Boolean);

// reader name → (key) → Promise<boolean>
const READERS = {
  'hub-flags': async () => allOn(await M.hubFlags().flags()),
  'identity-flags': async () => (await M.identity().flags()).guestHome,
  book: async () => allOn(await M.book().flags()),
  card: async () => allOn(await M.card().flags()),
  calibration: async () => M.calibration().enabled(),
  sweeper: async () => allOn(await M.sweeper().switches()),
  'challenge.challengeOn': async () => M.ch().challengeOn(),
  'challenge.liveOn': async () => M.ch().liveOn(),
  'challenge.questionsOn': async () => M.ch().questionsOn(),
  'challenge.listenOn': async () => M.ch().listenOn(),
  'challenge.settingOn': async (key) => M.ch().settingOn(key),
  'clip-warm': async () => M.clipWarm().switchOn(),
  'class-link-flags': async () => M.classLink().classLinkOn(),
  'class-round-flags': async () => allOn(await M.classRound().flags()),
  'class-week-flags': async () => M.classWeek().classWeekOn(),
  'hub-play': async () => allOn(await M.hubPlay().switches()),
  'sample-window': async () => M.sample().switchesOn(),
  'trail-page': async () => allOn(await M.trail().flags()),
  'teacher-jugnu-flags': async () => M.jugnu().jugnuOn(),
  'library-flag': async () => M.library().libraryOn(),
  'live-read-v3.on': async () => M.lr().on(),
  'live-read-v3.liveOn': async () => M.lr().liveOn(),
  'live-read-keys (stories gate)': async (key) => M.lr().settingOn(key),
  'stories.storiesOn': async () => M.stories().storiesOn(),
  'stories.lr3': async () => (await M.stories().flags()).lr3,
  'home-flags': async () => allOn(await M.home().flags()),
  'story-teacher.flagOn': async () => M.storyTeacher().flagOn(),
};

// key → the readers that turn it into a boolean (shared with the seed scan)
const { KEYS } = require('../../helpers/child-switch-keys');

/** The shared OFF matrix plus every string and object form of true. */
const ROWS = [
  ['true', true],
  ...OFF_VALUES,
  ["'true'", 'true'],
  ["'\"true\"'", '"true"'],
  ["' TRUE '", ' TRUE '],
  ["'True'", 'True'],
  ['{enabled:true}', { enabled: true }],
  ['{foo:1}', { foo: 1 }],
];

async function answers(key, from) {
  const out = {};
  for (const name of KEYS[key]) {
    mockFrom = from;
    resetAll();
    out[name] = Boolean(await READERS[name](key));
  }
  return out;
}

beforeAll(() => { process.env.WQ_TOMB_SALT = process.env.WQ_TOMB_SALT || 'salt-for-tests'; });

describe.each(Object.keys(KEYS))('%s: every reader gives one answer', (key) => {
  test.each(ROWS)('stored %s', async (label, value) => {
    const got = await answers(key, settings(key, value));
    const want = Object.fromEntries(KEYS[key].map((n) => [n, value === true]));
    expect(got).toEqual(want);
  });

  test('a failed read → off in every reader', async () => {
    const got = await answers(key, throwOn(settings(key, true), key));
    expect(got).toEqual(Object.fromEntries(KEYS[key].map((n) => [n, false])));
  });
});

describe('a first-touch door or teacher switch keeps its reading (the string "true" is still on)', () => {
  const CASES = [[true, true], ['true', true], [' TRUE ', true], ['"true"', true], [false, false], [null, false], ['yes', false], [{ enabled: true }, false]];
  const DOOR = [
    ['quiz_one_door', async () => (await M.oneDoor().flags()).on],
    ['quiz_teacher_home', async () => (await M.oneDoor().flags()).teacherHome],
    ['quiz_maker_page', async () => (await M.identity().flags()).makerPage],
    ['quiz_first_door', async () => (await M.identity().flags()).firstDoor],
    ['quiz_student_join', async () => (await M.join().flags()).on],
  ];
  test.each(DOOR)('%s', async (key, read) => {
    for (const [value, want] of CASES) {
      mockFrom = settings(key, value);
      resetAll();
      expect([value, await read()]).toEqual([value, want]);
    }
  });
});
