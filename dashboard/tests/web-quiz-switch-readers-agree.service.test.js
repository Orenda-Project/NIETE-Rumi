'use strict';
/**
 * The portal's readers of the stories switches give the bot's answer for one stored value: ON only for the JSON
 * boolean `true`. A string ('true', '"true"', ' TRUE '), 1, 'yes', an object or an absent row is OFF, and a failed
 * read is OFF. Before, the portal read web_quiz_stories through isFlagEnabled (a string "true" was ON), so it served
 * story files while the bot kept the stories pages off.
 *
 * The portal's own switches keep isFlagEnabled, unchanged (last block). Supabase is the faked boundary.
 */
const BOT_SUPABASE = '../../bot/shared/config/supabase';
jest.mock('../../bot/shared/config/supabase', () => ({ from: (...a) => mockFrom(...a) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn() }));

let mockFrom = () => { throw new Error('no settings set'); };

/** app_settings where `key` holds `value` (null = no row) and every other asked-for key holds true. */
function settings(key, value, { fail = false } = {}) {
  return (table) => {
    const st = { keys: [], one: false };
    const b = {
      select() { return b; },
      eq(col, v) { if (col === 'key') { st.keys = [v]; if (fail && v === key) throw new Error('settings down'); } return b; },
      in(col, vs) { if (col === 'key') { st.keys = [].concat(vs); if (fail && st.keys.includes(key)) throw new Error('settings down'); } return b; },
      maybeSingle() { st.one = true; return b; },
      then(res, rej) {
        const rows = table !== 'app_settings' ? [] : st.keys
          .filter((k) => !(k === key && value === null))
          .map((k) => ({ key: k, value: k === key ? value : true }));
        return Promise.resolve({ data: st.one ? rows[0] || null : rows, error: null }).then(res, rej);
      },
    };
    return b;
  };
}

const client = { from: (...a) => mockFrom(...a) };

const READERS = {
  'portal story files (web-quiz-story-assets flagReader)': async () => {
    let on;
    jest.isolateModules(() => {
      jest.doMock('../config/supabase', () => client);
      on = require('../routes/web-quiz-story-assets').flagReader({ now: () => 0 });
    });
    return on();
  },
  'portal isFlagTrue': async (key) => require('../lib/feature-flags').isFlagTrue(client, key),
  'bot stories shelf (storiesOn)': async () => {
    let S;
    jest.isolateModules(() => { S = require('../../bot/shared/services/quiz/web-quiz-stories'); });
    return S.storiesOn();
  },
  'bot story send (story-teacher flagOn)': async () => {
    let S;
    jest.isolateModules(() => { S = require('../../bot/shared/services/quiz/story-teacher.service'); });
    return S.flagOn();
  },
};

const KEYS = {
  web_quiz_stories: ['portal story files (web-quiz-story-assets flagReader)', 'portal isFlagTrue', 'bot stories shelf (storiesOn)', 'bot story send (story-teacher flagOn)'],
  web_quiz_stories_teacher: ['portal isFlagTrue', 'bot story send (story-teacher flagOn)'],
};

const ROWS = [
  ['true', true],
  ['false', false],
  ['absent', null],
  ['"yes"', 'yes'],
  ['1', 1],
  ['{}', {}],
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
    out[name] = Boolean(await READERS[name](key));
  }
  return out;
}

afterAll(() => { jest.dontMock('../config/supabase'); });

describe.each(Object.keys(KEYS))('%s: the portal and the bot give one answer', (key) => {
  test.each(ROWS)('stored %s', async (label, value) => {
    const got = await answers(key, settings(key, value));
    expect(got).toEqual(Object.fromEntries(KEYS[key].map((n) => [n, value === true])));
  });

  test('a failed read → off everywhere', async () => {
    const got = await answers(key, settings(key, true, { fail: true }));
    expect(got).toEqual(Object.fromEntries(KEYS[key].map((n) => [n, false])));
  });
});

// A known reader that is not converged here: the portal's teacher-stories edge (routes/teacher-stories.routes.js
// teacherFlagReader) reads web_quiz_stories_teacher through isFlagEnabled. It is being removed, so the bot alone gates
// the teacher's stories; until then a stored string "true" opens the portal's edge and the bot answers stories_off.
test.todo('web_quiz_stories_teacher: the portal teacher-stories edge reader (teacher-stories.routes.js teacherFlagReader) is removed, the bot is the gate');

describe('the portal\'s own switches keep their reading (isFlagEnabled)', () => {
  const { isFlagEnabled } = require('../lib/feature-flags');
  test.each([[true, true], ['true', true], [' TRUE ', true], ['"true"', true], [false, false], [null, false], ['yes', false], [1, false], [{ enabled: true }, false]])(
    'assessment_generator_enabled stored %p → %p', async (value, want) => {
      mockFrom = settings('assessment_generator_enabled', value);
      expect(await isFlagEnabled(client, 'assessment_generator_enabled')).toBe(want);
    });
});

test('the bot readers here read the faked boundary', () => {
  expect(typeof require(BOT_SUPABASE).from).toBe('function');
});
