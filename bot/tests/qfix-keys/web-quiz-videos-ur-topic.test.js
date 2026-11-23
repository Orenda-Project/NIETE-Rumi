'use strict';
/**
 * A NEW "more videos" or watch code's `topic` (the name a teacher report, a class picture and a page header print) for
 * an Urdu lesson: its Urdu-script name (web_quiz_videos_ur_titles on, and the catalog has one: urTitleOf), else the
 * lesson's title as today. An English lesson's code is byte-identical to today and the Urdu names are never read.
 *
 * Through the real entry: Videos.start mints the code (codeFor from a quiz page and from the hub, watchCodeFor for a
 * child with no class), and the inserted row is read back from the fake table. Supabase, the S3 SDK's send (R2), SQS,
 * Redis and the hub's token check are the boundaries and are faked; every other first-party module runs for real.
 * Invented lessons, titles and children only.
 */
process.env.R2_ENDPOINT = 'https://acct.r2.example.com';
process.env.R2_ACCESS_KEY_ID = 'test-only';
process.env.R2_SECRET_ACCESS_KEY = 'test-only';
process.env.R2_BUCKET_NAME = 'test-bucket';

jest.mock('../../shared/config/supabase', () => ({}));
const mockKidFromHub = jest.fn();
jest.mock('../../shared/services/quiz/web-quiz-hub', () => ({ kidFromHub: (...a) => mockKidFromHub(...a) }));
jest.mock('../../shared/services/queue/sqs-queue.service', () => ({ queueJob: jest.fn().mockResolvedValue({ MessageId: 'm1' }) }));
jest.mock('../../shared/services/cache/railway-redis.service', () => {
  const keys = new Map();
  return {
    __keys: keys,
    setNX: jest.fn(async (k, v) => { if (keys.has(k)) return false; keys.set(k, v); return true; }),
    get: jest.fn(async (k) => keys.get(k) || null),
    set: jest.fn(async (k, v) => { keys.set(k, v); return true; }),
    delete: jest.fn(async (k) => keys.delete(k)),
  };
});
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(), sendImageFromBuffer: jest.fn(), sendDocument: jest.fn(), sendInteractiveButtons: jest.fn(),
}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));
jest.mock('openchemlib', () => require('../../../tests/__mocks__/openchemlib.js'));
const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation((cfg) => {
      const real = new actual.S3Client(cfg);
      real.send = (...a) => mockS3Send(...a);
      return real;
    }),
  };
});

const { makeFake } = require('../quiz/web-quiz/fake-supabase');
const supabase = require('../../shared/config/supabase');
const redis = require('../../shared/services/cache/railway-redis.service');
const T = require('../../shared/services/quiz/web-quiz-token');
const Videos = require('../../shared/services/quiz/web-quiz-videos');
const Flag = require('../../shared/services/quiz/web-quiz-library-flag');
const Bank = require('../../shared/services/quiz/web-quiz-bank');
const HomeFlags = require('../../shared/services/quiz/web-quiz-home-flags');
const Snap = require('../../shared/services/settings/settings-snapshot');

const TEACHER = '11111111-1111-4111-8111-111111111111';
const QUIZ = '22222222-2222-4222-8222-222222222222';
const SC = '33333333-3333-4333-8333-333333333333';
const ROOT = '33333333-3333-4333-8333-777777777777';
const KID_A = '44444444-4444-4444-8444-444444444444';
const V = (n) => `aaaaaaa${n}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const VQ = (n) => `bbbbbbb${n}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;
const future = new Date(Date.now() + 86400000 * 10).toISOString();
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();

// Invented lessons. V(1): an Urdu lesson with an Urdu-script name. V(2): an English lesson that (oddly) also has one,
// so the English case proves the name is not taken. V(3): an Urdu lesson with no Urdu-script name.
const UR_ROMAN = 'Gintee Ka Khel';
const UR_NASTALIQ = 'گنتی کا کھیل';
const EN_TITLE = 'Shapes Around Us';
const UR3_ROMAN = 'Phool Aur Patte';

const UR_ON = { key: 'web_quiz_videos_ur_titles', value: true };
const UR_OFF = { key: 'web_quiz_videos_ur_titles', value: false };
const HOME_ON = { key: 'web_quiz_home_v3', value: true };
const WATCH_ROOT = { key: 'web_quiz_watch_root', value: JSON.stringify(ROOT) };

let fake;
function seed(settings) {
  const vrow = (n, subject, title, extra = {}) => ({
    id: V(n), grade: '3', subject, clean_chapter: `Chapter ${n}`, clean_title: title, migration_status: 'done', superseded_by: null,
    r2_url: `https://acct.r2.example.com/test-bucket/student-videos/v${n}.mp4`, ...extra,
  });
  // Bank video quizzes carry no language of their own: an Urdu lesson is known by its Urdu questions.
  const vquiz = (n, subject) => ({ id: VQ(n), video_id: V(n), quiz_source: 'video', status: 'ready', topic: `Video quiz ${n}`, grade: '3', subject, language: null, meta: null });
  const qrow = (n, i, text, opts) => ({
    id: `9999999${n}-9999-4999-8999-99999999999${i}`, quiz_id: VQ(n), external_id: `leg:${i}`, sort_order: i,
    question_text: text, option_a: opts[0], option_b: opts[1], option_c: opts[2], option_d: null,
    correct_option: 'A', explanation: null, option_feedback: null, media: {}, render_pattern: null,
  });
  fake = makeFake({
    quiz_share_codes: [
      { id: SC, code: 'AB12CD', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Ms Example Teacher',
        topic: 'Parts of a plant', language: 'en', active: true, expires_at: future, invited_by_student_id: null,
        parent_share_code_id: null, uses_count: 0, created_at: ago(30) },
      { id: ROOT, code: 'ROOT01', quiz_id: QUIZ, video_id: null, teacher_user_id: TEACHER, teacher_name: 'Example Root',
        topic: 'Videos', language: 'en', active: false, expires_at: null, invited_by_student_id: null,
        parent_share_code_id: null, uses_count: 0, created_at: ago(300) },
    ],
    quizzes: [
      { id: QUIZ, topic: 'Parts of a plant', grade: '3', subject: 'science', language: 'en', meta: null, quiz_source: 'transcript', video_id: null },
      vquiz(1, 'Maths'), vquiz(2, 'Maths'), vquiz(3, 'Science'),
    ],
    student_videos: [
      vrow(1, 'Maths', UR_ROMAN, { title_ur: UR_NASTALIQ }),
      vrow(2, 'Maths', EN_TITLE, { title_ur: 'شکلیں' }),
      vrow(3, 'Science', UR3_ROMAN, { title_ur: null }),
    ],
    quiz_questions: [
      qrow(1, 1, 'کتنے سیب ہیں؟', ['تین', 'چار', 'پانچ']),
      qrow(2, 2, 'Which shape has three sides?', ['Triangle', 'Square', 'Circle']),
      qrow(3, 3, 'پتے کا رنگ کیا ہے؟', ['سبز', 'نیلا', 'کالا']),
    ],
    quiz_sessions: [
      { id: 's-a1', quiz_id: QUIZ, share_code_id: SC, student_id: KID_A, student_name: 'Zara Testwala', user_id: null,
        status: 'completed', correct_answers: 3, total_questions_answered: 4, mastery_percentage: 75, completed_at: ago(1), created_at: ago(1),
        invited_by_student_id: null, device_ref: 'd1', source: 'share_link', student_class: '3' },
    ],
    students: [{ id: KID_A, student_name: 'Zara Testwala', self_reported_class: '3', phone: null }],
    quiz_answers: [],
    app_settings: settings,
  });
  Object.assign(supabase, { from: fake.from, rpc: fake.rpc });
}

/** Every select's table and columns, from here on (the fake does not keep the columns). */
function spySelects() {
  const seen = [];
  const from = supabase.from;
  supabase.from = (t) => { const q = from(t); const sel = q.select; q.select = (cols, ...r) => { seen.push([t, String(cols)]); return sel.call(q, cols, ...r); }; return q; };
  return seen;
}
const urNameReads = (seen) => seen.filter(([t, cols]) => t === 'student_videos' && /title_ur/.test(cols));

const st = () => T.signSession({ sessionId: 's-a1', deviceRef: 'd1', shareCodeId: SC });
const rowOf = (code) => fake.db.quiz_share_codes.find((r) => r.code === code);

// The three ways a new code is minted, each through Videos.start.
const MINTS = {
  'a quiz page (codeFor)': async (vid) => (await Videos.start({ code: 'AB12CD', st: st(), vid })).code,
  'the hub, a child with a class (codeFor)': async (vid) => {
    mockKidFromHub.mockResolvedValue({ studentId: KID_A, grade: '3', rootId: SC });
    return (await Videos.start({ hub: 'hubtoken', kid: 'chip-1', vid })).code;
  },
  'the hub, a child with no class, the quiz after a watch (watchCodeFor)': async (vid) => {
    mockKidFromHub.mockResolvedValue({ studentId: KID_A, grade: '3', rootId: null });
    return (await Videos.start({ hub: 'hubtoken', kid: 'chip-1', vid, after: 1 })).code;
  },
};
const PATHS = Object.keys(MINTS);

const SAVED = { ...process.env };
beforeEach(() => {
  process.env = { ...SAVED, INTERNAL_API_KEY: 'test-key' };
  delete process.env.WEB_QUIZ_TOKEN_SECRET;
  redis.__keys.clear();
  jest.clearAllMocks();
  Videos._metaCache.clear();
  Flag._reset();
  Bank._reset();
  HomeFlags._resetCache();
  Snap._reset();
  require('../../shared/services/quiz/web-quiz-roster')._resetCache();
  mockS3Send.mockImplementation(async () => ({}));
});
afterAll(() => { process.env = SAVED; });

describe('a new code for an Urdu lesson, web_quiz_videos_ur_titles on, with an Urdu-script name', () => {
  test.each(PATHS)('%s: the inserted topic is the Urdu-script name', async (path) => {
    seed([UR_ON, HOME_ON, WATCH_ROOT]);
    const n = fake.db.quiz_share_codes.length;
    const code = await MINTS[path](V(1));
    expect(fake.db.quiz_share_codes.length).toBe(n + 1);
    const row = rowOf(code);
    expect(row).toMatchObject({ quiz_id: VQ(1), video_id: V(1), language: 'ur' });
    expect(row.topic).toBe(UR_NASTALIQ);
  });
});

describe('an English lesson: the code is today\'s, and no Urdu name is read', () => {
  test.each(PATHS)('%s: topic = clean_title, title_ur never selected', async (path) => {
    seed([UR_ON, HOME_ON, WATCH_ROOT]);
    const seen = spySelects();
    const code = await MINTS[path](V(2));
    const row = rowOf(code);
    expect(row).toMatchObject({ quiz_id: VQ(2), language: 'en' });
    expect(row.topic).toBe(EN_TITLE);
    expect(urNameReads(seen)).toEqual([]);
  });

  test('a lesson with no clean_title still falls back to its quiz\'s topic, then null (today\'s order)', async () => {
    seed([UR_ON, HOME_ON, WATCH_ROOT]);
    fake.db.student_videos.find((r) => r.id === V(2)).clean_title = null;
    expect(rowOf(await MINTS[PATHS[0]](V(2))).topic).toBe('Video quiz 2');
    seed([UR_ON, HOME_ON, WATCH_ROOT]);
    fake.db.student_videos.find((r) => r.id === V(2)).clean_title = '';
    fake.db.quizzes.find((q) => q.id === VQ(2)).topic = null;
    expect(rowOf(await MINTS[PATHS[2]](V(2))).topic).toBeNull();
  });
});

describe('an Urdu lesson, switch off: the code is today\'s', () => {
  test.each([['absent', [HOME_ON, WATCH_ROOT]], ['false', [UR_OFF, HOME_ON, WATCH_ROOT]], ['the string true', [{ ...UR_ON, value: 'true' }, HOME_ON, WATCH_ROOT]]])(
    'switch %s: every mint path writes clean_title and reads no Urdu name', async (_l, settings) => {
      for (const path of PATHS) {
        seed(settings);
        Flag._reset(); Bank._reset(); HomeFlags._resetCache();
        const seen = spySelects();
        const row = rowOf(await MINTS[path](V(1)));
        expect([path, row.language, row.topic]).toEqual([path, 'ur', UR_ROMAN]);
        expect(urNameReads(seen)).toEqual([]);
      }
    },
  );
});

describe('an Urdu lesson with no Urdu-script name, switch on: the code is today\'s', () => {
  test.each(PATHS)('%s: no name -> clean_title', async (path) => {
    seed([UR_ON, HOME_ON, WATCH_ROOT]);
    const row = rowOf(await MINTS[path](V(3)));
    expect(row).toMatchObject({ quiz_id: VQ(3), language: 'ur' });
    expect(row.topic).toBe(UR3_ROMAN);
  });

  test('a name that is only spaces is no name: clean_title, never an empty or blank topic', async () => {
    seed([UR_ON, HOME_ON, WATCH_ROOT]);
    fake.db.student_videos.find((r) => r.id === V(1)).title_ur = '   ';
    expect(rowOf(await MINTS[PATHS[0]](V(1))).topic).toBe(UR_ROMAN);
  });

  test('the Urdu names cannot be read (no column yet): clean_title, and the code is still minted', async () => {
    seed([UR_ON, HOME_ON, WATCH_ROOT]);
    const from = supabase.from;
    const down = new Proxy({}, { get: (_t, k) => (k === 'then' ? (res) => res({ data: null, error: { message: 'column student_videos.title_ur does not exist' } }) : () => down) });
    supabase.from = (t) => { const q = from(t); const sel = q.select; q.select = (cols, ...r) => (/title_ur/.test(String(cols)) ? down : sel.call(q, cols, ...r)); return q; };
    const code = await MINTS[PATHS[2]](V(1));
    supabase.from = from;
    expect(rowOf(code)).toMatchObject({ language: 'ur', topic: UR_ROMAN });
  });
});

describe('a live code is reused as it is (the mint is the only writer of topic here)', () => {
  test('an Urdu lesson\'s existing class code keeps its row: no new code, no topic rewrite', async () => {
    seed([UR_ON, HOME_ON, WATCH_ROOT]);
    fake.db.quiz_share_codes.push({ id: 'sc-old', code: 'OLD777', quiz_id: VQ(1), video_id: V(1), teacher_user_id: TEACHER,
      teacher_name: 'Ms Example Teacher', topic: UR_ROMAN, language: 'ur', active: true, expires_at: future,
      invited_by_student_id: null, parent_share_code_id: SC, uses_count: 0, created_at: ago(2) });
    const n = fake.db.quiz_share_codes.length;
    expect(await MINTS[PATHS[0]](V(1))).toBe('OLD777');
    expect(fake.db.quiz_share_codes.length).toBe(n);
    expect(rowOf('OLD777').topic).toBe(UR_ROMAN);
  });
});
