'use strict';
/**
 * The hub's Jugnu corner (web-quiz-hub-play.js) through the real hub payload (web-quiz-hub.js): the "next thing"
 * resolver (BADGES §6, table-driven), Jugnu first when the last quiz is finished, NEW iff the child has no run row on
 * the passage, the fail-closed reads, and the golden: every new switch off -> no `play` key, the payload unchanged.
 * Supabase and Redis are the boundaries and are faked; every first-party module on the path runs for real.
 */
jest.mock('../../../shared/config/supabase', () => ({}));
jest.mock('../../../shared/services/cache/railway-redis.service', () => {
  const store = new Map();
  return {
    _store: store, _up: true,
    isAvailable() { return this._up; },
    get: jest.fn(async function get(k) { return this._up && store.has(k) ? store.get(k) : null; }),
    set: jest.fn().mockResolvedValue(true), delete: jest.fn().mockResolvedValue(true),
    setNX: jest.fn(async function setNX(k, v) { if (!this._up) return true; if (store.has(k)) return false; store.set(k, v); return true; }),
  };
});
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn(), getCurrentCorrelationId: () => null }));

const { makeFake } = require('./fake-supabase');
const supabase = require('../../../shared/config/supabase');
const T = require('../../../shared/services/quiz/web-quiz-token');
const Hub = require('../../../shared/services/quiz/web-quiz-hub');
const Play = require('../../../shared/services/quiz/web-quiz-hub-play');
const redis = require('../../../shared/services/cache/railway-redis.service');
const CASES = require('./fixtures/next-thing-cases.json');

const KID = '44444444-4444-4444-8444-000000000001';
const TEACHER = '11111111-1111-4111-8111-000000000001';
const LIST = '55555555-5555-4555-8555-000000000001';
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const ahead = (h) => new Date(Date.now() + h * 3600000).toISOString();
const A = { device: 'AAAAAAAAAAAAAAAAAAAAAA' };
const ON = (k) => ({ key: k, value: 'true' });
const BASE_ON = [ON('web_quiz_hub'), ON('web_quiz_challenge'), ON('web_quiz_child_quiz_home')];

// The registry's columns, read from the migration that creates challenge_passages (never a hand-kept list).
const REGISTRY_COLS = (() => {
  const sql = require('fs').readFileSync(require('path').join(__dirname, '../../../database/migrations/web_quiz_challenge_registry.sql'), 'utf8');
  const body = sql.split('CREATE TABLE IF NOT EXISTS public.challenge_passages (')[1].split('\n);')[0];
  return new Set(body.split('\n').map((l) => (/^\s{2}([a-z_0-9]+)\s/.exec(l) || [])[1]).filter((c) => c && c !== 'constraint'));
})();

// One title home: the lantern names a story by its passage FILE's title. A fixture registry row whose id
// has no shipped file gets a file here carrying that row's titles; the shipped files are loaded as they are.
const Bank = require('../../../shared/services/child-test/item-bank');
const SHIPPED = require('path').join(__dirname, '../../../shared/data/child-test/passages');
const PDIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'wqplay-'));
function filesFor(rows) {
  const fs = require('fs');
  const at = (id) => require('path').join(PDIR, `${id}.json`);
  fs.readdirSync(PDIR).forEach((f) => fs.rmSync(require('path').join(PDIR, f)));
  fs.readdirSync(SHIPPED).filter((f) => f.endsWith('.json')).forEach((f) => fs.copyFileSync(require('path').join(SHIPPED, f), require('path').join(PDIR, f)));
  rows.filter((r) => !fs.existsSync(at(r.passage_id))).forEach((r) => fs.writeFileSync(at(r.passage_id), JSON.stringify({
    passage_id: r.passage_id, lang: r.lang, kind: r.kind, band: r.band, pool: r.pool, title_en: r.title_en == null ? null : r.title_en, title_ur: r.title_ur == null ? null : r.title_ur,
  })));
  Bank._loadPassagesFrom(PDIR);
}
afterAll(() => { Bank._loadPassagesFrom(); require('fs').rmSync(PDIR, { recursive: true, force: true }); });

let db;
function seed(settings, over = {}) {
  db = {
    app_settings: settings,
    students: [{ id: KID, student_name: 'Zara Testwala', student_name_urdu: null, self_reported_class: '3', list_id: LIST, is_active: true, phone: '+92300FIXTURE1', created_at: ago(500) }],
    student_lists: [{ id: LIST, user_id: TEACHER, class_name: '3', section: 'A', is_active: true }],
    quizzes: [{ id: 'q-1', topic: 'Fractions quiz', subject: 'Maths', language: 'en', grade: '3', video_id: null }],
    quiz_share_codes: [{ id: 'sc-1', code: 'MATH01', quiz_id: 'q-1', active: true, expires_at: ahead(240), topic: 'Fractions quiz', language: 'en', teacher_user_id: TEACHER, parent_share_code_id: null, invited_by_student_id: null, created_at: ago(30) }],
    quiz_sessions: [{ id: 's1', share_code_id: 'sc-1', quiz_id: 'q-1', student_id: KID, status: 'completed', correct_answers: 8, total_questions_answered: 10, mastery_percentage: 80, completed_at: ago(20), created_at: ago(20), student_class: '3' }],
    ...over,
  };
  filesFor(db.challenge_passages || []);
  const fake = makeFake(db);
  // challenge_passages answers like PostgREST: a select naming a column the registry migration does not create is 42703.
  const from = (t) => {
    const b = fake.from(t);
    if (t !== 'challenge_passages') return b;
    const sel = b.select.bind(b);
    b.select = (cols, ...rest) => {
      const bad = String(cols || '').split(',').map((c) => c.trim()).filter((c) => c && c !== '*' && !REGISTRY_COLS.has(c));
      if (!bad.length) return sel(cols, ...rest);
      const err = { data: null, error: { code: '42703', message: `column challenge_passages.${bad[0]} does not exist` } };
      const chain = new Proxy({}, { get: (_, k) => (k === 'then' ? (res) => res(err) : () => chain) });
      return chain;
    };
    return b;
  };
  Object.assign(supabase, { from, rpc: fake.rpc });
  Hub._resetCache();
  Play._resetCache();
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEB_QUIZ_TOKEN_SECRET = 'hub-test-secret';
  process.env.PORTAL_URL = 'https://portal.example.test';
  redis._store.clear();
  seed(BASE_ON);
});

describe('nextThing: the resolver (BADGES §6), every fixture case', () => {
  test.each(CASES.cases.map((c) => [c.case, c]))('%s', (_name, c) => {
    expect(Play.nextThing(c.in)).toEqual(c.out);
  });

  test('a title is never returned for released_at > now (even when the input forgot to filter it)', () => {
    const out = Play.nextThing({ trail_waiting: [], unseen_stories: [{ title: 'Not Yet Live', released_at: '2026-11-09T00:00:00+05:00', band: 1 }],
      numbers_fresh: false, next_release: null, now: '2026-11-08T23:59:00+05:00' });
    expect(out).toEqual({ kind: 'day', day: null });
    expect(JSON.stringify(out)).not.toContain('Not Yet Live');
  });
});

describe('hub order: the Jugnu card first when the last quiz is finished (web_quiz_hub_challenge_first)', () => {
  test('last quiz finished + switch on -> play.first true', async () => {
    seed([...BASE_ON, ON('web_quiz_hub_challenge_first')]);
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.last).toMatchObject({ state: 'done' });
    expect(out.challenge).toMatchObject({ on: true });
    expect(out.play).toMatchObject({ first: true, lantern: null, shelf: null, install: false, doors: [] });
  });

  test('last quiz still open -> Continue stays first (play.first false)', async () => {
    seed([...BASE_ON, ON('web_quiz_hub_challenge_first')]);
    db.quiz_sessions.push({ id: 's2', share_code_id: 'sc-1', quiz_id: 'q-1', student_id: KID, status: 'in_progress', correct_answers: 1, total_questions_answered: 2, mastery_percentage: 50, completed_at: null, created_at: ago(1), student_class: '3' });
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.last).toMatchObject({ state: 'open' });
    expect(out.play.first).toBe(false);
  });

  test('switch on but its parent web_quiz_challenge off -> no play key at all', async () => {
    seed([ON('web_quiz_hub'), ON('web_quiz_child_quiz_home'), ON('web_quiz_hub_challenge_first')]);
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out).not.toHaveProperty('play');
  });

  test('GOLDEN: every new switch off (absent or false) -> no play key, payload deep-equal to the base', async () => {
    const base = await Hub.hub(T.signHub([KID]), A);
    expect(base).not.toHaveProperty('play');
    seed([...BASE_ON, ...Object.values(Play.KEYS).filter((k) => !['web_quiz_hub', 'web_quiz_challenge'].includes(k)).map((key) => ({ key, value: 'false' }))]);
    const off = await Hub.hub(T.signHub([KID]), A);
    expect(off).toEqual(base);
    expect(Object.keys(off).sort()).toEqual(['again', 'brand', 'challenge', 'home_v', 'kid', 'kids', 'lang', 'last', 'lib', 'recs', 'rt', 'teacher'].sort());
  });

  test('a settings read that fails -> fail closed: no play key', async () => {
    seed([...BASE_ON, ON('web_quiz_hub_challenge_first')]);
    const from = supabase.from;
    supabase.from = (t) => {
      const b = from(t);
      if (t !== 'app_settings') return b;
      const inner = b.in.bind(b);
      b.in = (c, vs) => (vs.includes('web_quiz_hub_challenge_first') ? Promise.resolve({ data: null, error: { message: 'down' } }) : inner(c, vs));
      return b;
    };
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out).not.toHaveProperty('play');
  });
});

describe('lantern + shelf (web_quiz_challenge_v2 / web_quiz_challenge_story)', () => {
  const STORY_ON = [...BASE_ON, ON('web_quiz_challenge_v2'), ON('web_quiz_challenge_story'), ON('web_quiz_events_v2')];
  const period = (() => { const d = new Date(Date.now() + 5 * 3600000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();
  const passage = (id, kind, releasedH, extra = {}) => ({ passage_id: id, lang: 'en', band: 1, kind, pool: 'practice', status: 'reviewed', released_at: releasedH === null ? null : ago(releasedH), title_en: `Title ${id}`, title_ur: null, ...extra });

  test('trail waiting -> {kind:trail, stops} (no count shown on the page, the stops are the resolver\'s)', async () => {
    seed(STORY_ON, { web_quiz_challenge_runs: [{ student_id: KID, exercise: 'read', mode: 'check', record: true, status: 'scored', period_id: period, passage_id: null }] });
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.play.lantern).toEqual({ kind: 'trail', stops: 1 });
    expect(out.play.doors).toEqual(['hub_first', 'tomorrow', 'shelf']);
  });

  test('NEW iff no run row (any mode) and no sticker for the passage or its twin; the newest live story is named', async () => {
    seed(STORY_ON, {
      web_quiz_challenge_runs: [
        { student_id: KID, exercise: 'read', mode: 'check', record: true, status: 'scored', period_id: period, passage_id: 'p-check' },
        { student_id: KID, exercise: 'bigger', mode: 'check', record: true, status: 'scored', period_id: period, passage_id: null },
        // A story run (its sticker) on an older story's twin: that story is seen too.
        { student_id: KID, exercise: 'listen', mode: 'practice', record: false, period_id: period, passage_id: 'p-twin' },
      ],
      challenge_passages: [
        passage('p-new', 'read', 2),
        passage('p-old', 'listen', 200, { twin_of: 'p-twin' }),
        passage('p-future', 'read', -20),
        passage('p-draft', 'read', 1, { status: 'draft' }),
      ],
    });
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.play.lantern).toEqual({ kind: 'story', title: 'Title p-new', pid: 'p-new' });
    expect(out.play.shelf).toEqual([
      { id: 'week_story', pid: 'p-new', nx: 'new', title: 'Title p-new' },
      { id: 'listen', pid: 'p-old', nx: 'seen' },
      { id: 'numbers', nx: 'seen' },
      { id: 'older', nx: 'seen' },
    ]);
    const text = JSON.stringify(out.play);
    expect(text).not.toContain('p-future');
    expect(text).not.toContain('p-draft');
  });

  test('a served or abandoned record row never closes a Trail stop; only scored/failed do', async () => {
    seed(STORY_ON, { web_quiz_challenge_runs: [
      { student_id: KID, exercise: 'read', mode: 'check', record: true, status: 'served', period_id: period, passage_id: null },
      { student_id: KID, exercise: 'bigger', mode: 'check', record: true, status: 'abandoned', period_id: period, passage_id: null },
    ] });
    expect((await Hub.hub(T.signHub([KID]), A)).play.lantern).toEqual({ kind: 'trail', stops: 2 });
    seed(STORY_ON, { web_quiz_challenge_runs: [
      { student_id: KID, exercise: 'read', mode: 'check', record: true, status: 'failed', period_id: period, passage_id: null },
      { student_id: KID, exercise: 'bigger', mode: 'check', record: true, status: 'served', period_id: period, passage_id: null },
    ] });
    expect((await Hub.hub(T.signHub([KID]), A)).play.lantern).toEqual({ kind: 'trail', stops: 1 });
  });

  test('a served row (any mode) on a story makes it seen: not NEW, not the lantern title', async () => {
    seed(STORY_ON, {
      web_quiz_challenge_runs: [
        { student_id: KID, exercise: 'read', mode: 'check', record: true, status: 'scored', period_id: period, passage_id: null },
        { student_id: KID, exercise: 'bigger', mode: 'check', record: true, status: 'scored', period_id: period, passage_id: null },
        { student_id: KID, exercise: 'read', mode: 'practice', record: false, status: 'served', period_id: period, passage_id: 'p-served' },
      ],
      challenge_passages: [passage('p-served', 'read', 2)],
    });
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.play.shelf[0]).toEqual({ id: 'week_story', pid: 'p-served', nx: 'seen', title: 'Title p-served' });
    expect(out.play.lantern.kind).toBe('numbers');
  });

  test('one unseen set: a story with no title in the child\'s language is never NEW on the shelf while the lantern says the day', async () => {
    const done = [
      { student_id: KID, exercise: 'read', mode: 'check', record: true, status: 'scored', period_id: period, passage_id: null },
      { student_id: KID, exercise: 'bigger', mode: 'check', record: true, status: 'scored', period_id: period, passage_id: null },
    ];
    seed(STORY_ON, { web_quiz_challenge_runs: done, challenge_passages: [passage('p-untitled', 'read', 2, { title_en: null })] });
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.play.lantern.kind).toBe('numbers');
    expect(out.play.shelf[0]).toEqual({ id: 'week_story', pid: 'p-untitled', nx: 'seen' });
    // A NEW tag on the shelf and a story on the lantern always come together.
    seed(STORY_ON, { web_quiz_challenge_runs: done, challenge_passages: [passage('p-untitled', 'read', 2, { title_en: null }), passage('p-titled', 'listen', 3)] });
    const both = await Hub.hub(T.signHub([KID]), A);
    expect(both.play.lantern).toEqual({ kind: 'story', title: 'Title p-titled', pid: 'p-titled' });
    expect(both.play.shelf.filter((t) => t.nx === 'new').map((t) => t.pid)).toEqual(['p-titled']);
  });

  test('a reserve story (a registry reserve id, even released) is never on the shelf, never NEW, never the lantern title', async () => {
    seed(STORY_ON, {
      web_quiz_challenge_runs: [
        { student_id: KID, exercise: 'read', mode: 'check', record: true, status: 'scored', period_id: period, passage_id: null },
        { student_id: KID, exercise: 'bigger', mode: 'check', record: true, status: 'scored', period_id: period, passage_id: null },
      ],
      challenge_passages: [passage('en.read.1.reserve01', 'read', 1), passage('p-live', 'read', 50)],
    });
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.play.lantern).toEqual({ kind: 'story', title: 'Title p-live', pid: 'p-live' });
    expect(out.play.shelf[0]).toEqual({ id: 'week_story', pid: 'p-live', nx: 'new', title: 'Title p-live' });
    expect(JSON.stringify(out.play)).not.toContain('reserve01');
  });

  test('nothing unseen, a buffered release tomorrow -> numbers + day; never the future title', async () => {
    seed(STORY_ON, {
      web_quiz_challenge_runs: [
        { student_id: KID, exercise: 'read', mode: 'check', record: true, status: 'scored', period_id: period, passage_id: 'p-a' },
        { student_id: KID, exercise: 'bigger', mode: 'check', record: true, status: 'scored', period_id: period, passage_id: null },
      ],
      challenge_passages: [passage('p-a', 'read', 30), passage('p-next', 'read', -20)],
    });
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.play.lantern.kind).toBe('numbers');
    expect(['tomorrow', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']).toContain(out.play.lantern.day);
    expect(JSON.stringify(out.play)).not.toContain('Title p-next');
  });

  test('the runs columns cannot be read (sandbox before the migration) -> trail from the tile, no shelf, nothing new; never throws', async () => {
    seed(STORY_ON, { challenge_passages: [passage('p-new', 'read', 2)] });
    const from = supabase.from;
    supabase.from = (t) => (t === 'web_quiz_challenge_runs'
      ? { select: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: null, error: { code: '42703', message: 'column "mode" does not exist' } }) }) }) }
      : from(t));
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.play.lantern).toEqual({ kind: 'trail', stops: 2 });
    expect(out.play.shelf).toBeNull();
  });

  test('the passages table is missing -> no stories, never throws', async () => {
    seed(STORY_ON, { web_quiz_challenge_runs: [{ student_id: KID, exercise: 'read', mode: 'check', record: true, status: 'scored', period_id: period }, { student_id: KID, exercise: 'bigger', mode: 'check', record: true, status: 'scored', period_id: period }] });
    const from = supabase.from;
    supabase.from = (t) => (t === 'challenge_passages' ? { select: () => { throw new Error('relation "challenge_passages" does not exist'); } } : from(t));
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.play.lantern).toEqual({ kind: 'numbers', day: null });
    expect(out.play.shelf).toEqual([{ id: 'numbers', nx: 'seen' }]);
  });

  test('story off: only the trail line; numbers/day lines never show', async () => {
    seed([...BASE_ON, ON('web_quiz_challenge_v2')], { web_quiz_challenge_runs: [{ student_id: KID, exercise: 'read', mode: 'check', record: true, status: 'scored', period_id: period }, { student_id: KID, exercise: 'bigger', mode: 'check', record: true, status: 'scored', period_id: period }] });
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.play.lantern).toBeNull();
    expect(out.play.shelf).toBeNull();
  });
});

describe('the lantern counts the stops this child\'s own Trail has (the menu\'s stop rule)', () => {
  const Challenge = require('../../../shared/services/quiz/web-quiz-challenge');
  const STORY_ON = [...BASE_ON, ON('web_quiz_challenge_v2'), ON('web_quiz_challenge_story')];
  const period = (() => { const d = new Date(Date.now() + 5 * 3600000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();
  const run = (exercise) => ({ student_id: KID, exercise, mode: 'check', record: true, status: 'scored', period_id: period, passage_id: null });
  // The challenge's switches are cached for 30 s: every seed here starts them fresh.
  const fresh = (settings, over, grade) => {
    seed(settings, over);
    if (grade) {
      db.student_lists[0].class_name = grade;
      db.students[0].self_reported_class = grade;
      db.quizzes[0].grade = grade;
      db.quiz_sessions.forEach((x) => { x.student_class = grade; });
    }
    Challenge.__reset();
  };
  afterEach(() => Challenge.__reset());

  test('grade 1, numbers done -> no trail lantern', async () => {
    fresh([...STORY_ON, ON('web_quiz_challenge_g1')], { web_quiz_challenge_runs: [run('numbers')] }, '1');
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.play.lantern).toEqual({ kind: 'numbers', day: null });
    expect(out.challenge).toEqual({ on: true });
  });

  test('grade 1, not done -> stops:1', async () => {
    fresh([...STORY_ON, ON('web_quiz_challenge_g1')], { web_quiz_challenge_runs: [run('bigger'), run('read')] }, '1');
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.play.lantern).toEqual({ kind: 'trail', stops: 1 });
  });

  test('grade 3, warm-up and listen waiting, bigger and read done -> stops:2 (the warm-up and listen count)', async () => {
    const on = [...STORY_ON, ON('web_quiz_challenge_record'), ON('web_quiz_challenge_missing'), ON('web_quiz_challenge_listen')];
    fresh(on, { web_quiz_challenge_runs: [run('bigger'), run('read')] });
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.play.lantern).toEqual({ kind: 'trail', stops: 2 });
    expect(out.challenge).toEqual({ on: true });
    fresh(on, { web_quiz_challenge_runs: ['bigger', 'read', 'missing', 'listen'].map(run) });
    expect((await Hub.hub(T.signHub([KID]), A)).play.lantern).toEqual({ kind: 'numbers', day: null });
  });

  test('GOLDEN: grade 3, nothing played -> today\'s trail lantern for the stops the Trail has', async () => {
    // the warm-up and listen switches off: the Trail is bigger and read, the lantern exactly today's
    fresh(STORY_ON, { web_quiz_challenge_runs: [] });
    expect((await Hub.hub(T.signHub([KID]), A)).play.lantern).toEqual({ kind: 'trail', stops: 2 });
    fresh([...STORY_ON, ON('web_quiz_challenge_record'), ON('web_quiz_challenge_missing'), ON('web_quiz_challenge_listen')], { web_quiz_challenge_runs: [] });
    expect((await Hub.hub(T.signHub([KID]), A)).play.lantern).toEqual({ kind: 'trail', stops: 4 });
  });
});

describe('band filter: never a passage above the bands open to this child', () => {
  const STORY_ON = [...BASE_ON, ON('web_quiz_challenge_v2'), ON('web_quiz_challenge_story')];
  const period = (() => { const d = new Date(Date.now() + 5 * 3600000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();
  const done = [
    { student_id: KID, exercise: 'read', mode: 'check', record: true, status: 'scored', period_id: period, passage_id: null },
    { student_id: KID, exercise: 'bigger', mode: 'check', record: true, status: 'scored', period_id: period, passage_id: null },
  ];
  const story = (id, band, h) => ({ passage_id: id, lang: 'en', band, kind: 'read', pool: 'practice', status: 'reviewed', released_at: ago(h), title_en: `Title ${id}`, title_ur: null });
  const grade2 = (over) => {
    seed(STORY_ON, { web_quiz_challenge_runs: done, challenge_passages: [story('b1', 1, 50), story('b2', 2, 5), story('b3', 3, 2)], ...over });
    db.student_lists[0].class_name = '2';
    db.students[0].self_reported_class = '2';
    db.quiz_sessions.forEach((x) => { x.student_class = '2'; });
  };

  test('a grade-2 child with no rungs: only band 1 — no band-2/3 title or tile', async () => {
    grade2();
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.challenge).toMatchObject({ on: true });
    expect(out.play.lantern).toEqual({ kind: 'story', title: 'Title b1', pid: 'b1' });
    expect(out.play.shelf[0]).toEqual({ id: 'week_story', pid: 'b1', nx: 'new', title: 'Title b1' });
    expect(JSON.stringify(out.play)).not.toMatch(/b2|b3/);
  });

  test('reading rung 3 opens band 2 (not 3); rung 5 opens band 3 for grades 2-3', async () => {
    grade2({ child_rungs: [{ canonical_id: KID, ladder: 'reading', rung: 3 }, { canonical_id: KID, ladder: 'numbers', rung: 5 }] });
    let out = await Hub.hub(T.signHub([KID]), A);
    expect(out.play.lantern).toEqual({ kind: 'story', title: 'Title b2', pid: 'b2' });
    expect(JSON.stringify(out.play)).not.toContain('b3');
    grade2({ child_rungs: [{ canonical_id: KID, ladder: 'reading', rung: 3 }, { canonical_id: KID, ladder: 'reading', rung: 5 }] });
    out = await Hub.hub(T.signHub([KID]), A);
    expect(out.play.lantern).toEqual({ kind: 'story', title: 'Title b3', pid: 'b3' });
  });

  test('child_rungs unreadable -> the entry band only (fail closed)', async () => {
    grade2({ child_rungs: [{ canonical_id: KID, ladder: 'reading', rung: 5 }] });
    const from = supabase.from;
    supabase.from = (t) => (t === 'child_rungs' ? { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: null, error: { code: '42P01', message: 'relation does not exist' } }) }) }) } : from(t));
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.play.lantern).toEqual({ kind: 'story', title: 'Title b1', pid: 'b1' });
  });

  test('openBands: {1, L, U?, 3?}', () => {
    expect([...Play.openBands(2, 0)].sort()).toEqual([1]);
    expect([...Play.openBands(4, 0)].sort()).toEqual([1, 2]);
    expect([...Play.openBands(5, 3)].sort()).toEqual([1, 2, 3]);
    expect([...Play.openBands(3, 3)].sort()).toEqual([1, 2]);
    expect([...Play.openBands(3, 5)].sort()).toEqual([1, 2, 3]);
    expect([...Play.openBands(null, 5)].sort()).toEqual([1]);
  });
});

describe('events-only: web_quiz_events_v2 alone (with hub + challenge)', () => {
  test('play carries only the hub_first door: order unchanged, no lantern, no shelf, no install', async () => {
    seed([...BASE_ON, ON('web_quiz_events_v2')]);
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.play).toEqual({ first: false, lantern: null, shelf: null, install: false, doors: ['hub_first'] });
  });
});

describe('hub_open route value (opts.src)', () => {
  test('GET /hub/:token?src=class_link hands opts.src = class_link to the hub; an unknown value is dropped', async () => {
    const express = require('express');
    process.env.INTERNAL_API_KEY = 'route-key';
    const app = express();
    app.use('/api/internal/wq', require('../../../shared/routes/web-quiz-internal.routes'));
    const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    const spy = jest.spyOn(Hub, 'hub').mockResolvedValue({ kids: [] });
    try {
      const base = `http://127.0.0.1:${server.address().port}/api/internal/wq`;
      await fetch(`${base}/hub/abc.def?kid=0123456789abcdef&src=class_link`, { headers: { 'x-api-key': 'route-key' } });
      await fetch(`${base}/hub/abc.def?src=evil`, { headers: { 'x-api-key': 'route-key' } });
      expect(spy.mock.calls[0][1]).toMatchObject({ kid: '0123456789abcdef', src: 'class_link' });
      expect(spy.mock.calls[1][1].src).toBeUndefined();
    } finally { spy.mockRestore(); await new Promise((r) => server.close(r)); }
  });

  test('srcOf keeps only the known routes', () => {
    expect(Play.srcOf('door')).toBe('door');
    expect(Play.srcOf('hs')).toBe('hs');
    expect(Play.srcOf('evil<')).toBeUndefined();
    expect(Play.srcOf(undefined)).toBeUndefined();
  });
});

// One title home. The lantern names a story by its passage FILE's title (web-quiz-challenge.js
// passageTitle), never the registry row's; a file with no title (a Set A pointer) gives no title and no "null".
describe('the lantern\'s title is the passage file\'s (one title home)', () => {
  const STORY_ON = [...BASE_ON, ON('web_quiz_challenge_v2'), ON('web_quiz_challenge_story'), ON('web_quiz_events_v2')];
  const period = (() => { const d = new Date(Date.now() + 5 * 3600000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();
  const done = [
    { student_id: KID, exercise: 'read', mode: 'check', record: true, status: 'scored', period_id: period, passage_id: null },
    { student_id: KID, exercise: 'bigger', mode: 'check', record: true, status: 'scored', period_id: period, passage_id: null },
  ];
  const reg = (id, lang, over = {}) => ({ passage_id: id, lang, band: 1, kind: 'read', pool: 'practice', status: 'reviewed', released_at: ago(2), title_en: 'Registry Title', title_ur: 'رجسٹری عنوان', ...over });

  test('a passage whose file has a title and whose registry row has another: the child sees the file\'s', async () => {
    seed(STORY_ON, { web_quiz_challenge_runs: done, challenge_passages: [reg('en.read.1.ref01', 'en')] });
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.play.lantern).toEqual({ kind: 'story', title: 'The Pink Kite', pid: 'en.read.1.ref01' });
    expect(JSON.stringify(out.play)).not.toContain('Registry Title');
  });

  test('an Urdu child: the file\'s Urdu title', async () => {
    seed(STORY_ON, { web_quiz_challenge_runs: done, challenge_passages: [reg('ur.read.1.ref01', 'ur')] });
    const out = await Hub.hub(T.signHub([KID]), { ...A, lang: 'ur' });
    expect(out.play.lantern).toEqual({ kind: 'story', title: 'لال پتنگ', pid: 'ur.read.1.ref01' });
    expect(JSON.stringify(out.play)).not.toContain('رجسٹری عنوان');
  });

  test('a passage whose file has no title (a registry title only): no title, never "null"; the lantern takes its next branch', async () => {
    seed(STORY_ON, { web_quiz_challenge_runs: done, challenge_passages: [reg('en.read.1.plain01', 'en')] });
    // the file itself carries no title in either language (the registry row's "Registry Title" is never the child's)
    require('fs').writeFileSync(require('path').join(PDIR, 'en.read.1.plain01.json'), JSON.stringify({ passage_id: 'en.read.1.plain01', lang: 'en', kind: 'read', band: 1, pool: 'practice', title_en: null, title_ur: null }));
    Bank._loadPassagesFrom(PDIR);
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.play.lantern.kind).toBe('numbers');
    expect(out.play.shelf[0]).toEqual({ id: 'week_story', pid: 'en.read.1.plain01', nx: 'seen' });
    expect(JSON.stringify(out.play)).not.toMatch(/null"|"null|Registry Title|undefined/);
  });
});

// The story tile names its story from the same title home as the lantern (titleFor(passageId, lang)); a passage
// whose file has no title in the child's language keeps the tile exactly as it was: { id, pid, nx }, no title key.
describe('the story tile names the story (one title home)', () => {
  const STORY_ON = [...BASE_ON, ON('web_quiz_challenge_v2'), ON('web_quiz_challenge_story'), ON('web_quiz_events_v2')];
  const period = (() => { const d = new Date(Date.now() + 5 * 3600000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();
  const done = [
    { student_id: KID, exercise: 'read', mode: 'check', record: true, status: 'scored', period_id: period, passage_id: null },
    { student_id: KID, exercise: 'bigger', mode: 'check', record: true, status: 'scored', period_id: period, passage_id: null },
  ];
  const reg = (id, lang, over = {}) => ({ passage_id: id, lang, band: 1, kind: 'read', pool: 'practice', status: 'reviewed', released_at: ago(2), title_en: 'Registry Title', title_ur: 'رجسٹری عنوان', ...over });

  test('a released story with a title: the tile and the lantern name it (EN), the file\'s title, never the registry\'s', async () => {
    seed(STORY_ON, { web_quiz_challenge_runs: done, challenge_passages: [reg('en.read.1.ref01', 'en')] });
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.play.lantern).toEqual({ kind: 'story', title: 'The Pink Kite', pid: 'en.read.1.ref01' });
    expect(out.play.shelf[0]).toStrictEqual({ id: 'week_story', pid: 'en.read.1.ref01', nx: 'new', title: 'The Pink Kite' });
    expect(JSON.stringify(out.play)).not.toContain('Registry Title');
  });

  test('after the story is played: the tile still names it (seen), the lantern moves on', async () => {
    seed(STORY_ON, { web_quiz_challenge_runs: [...done, { student_id: KID, exercise: 'read', mode: 'practice', record: false, status: 'scored', period_id: period, passage_id: 'en.read.1.ref01' }],
      challenge_passages: [reg('en.read.1.ref01', 'en')] });
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.play.lantern.kind).toBe('numbers');
    expect(out.play.shelf[0]).toStrictEqual({ id: 'week_story', pid: 'en.read.1.ref01', nx: 'seen', title: 'The Pink Kite' });
  });

  test('UR: the file\'s Urdu title; a file with no Urdu title gives its English one (ur then en)', async () => {
    seed(STORY_ON, { web_quiz_challenge_runs: done, challenge_passages: [reg('ur.read.1.ref01', 'ur')] });
    const ur = await Hub.hub(T.signHub([KID]), { ...A, lang: 'ur' });
    expect(ur.play.shelf[0]).toStrictEqual({ id: 'week_story', pid: 'ur.read.1.ref01', nx: 'new', title: 'لال پتنگ' });
    expect(ur.play.lantern).toEqual({ kind: 'story', title: 'لال پتنگ', pid: 'ur.read.1.ref01' });
    seed(STORY_ON, { web_quiz_challenge_runs: done, challenge_passages: [reg('ur.read.1.enonly01', 'ur', { title_en: 'Only English', title_ur: null })] });
    const en = await Hub.hub(T.signHub([KID]), { ...A, lang: 'ur' });
    expect(en.play.shelf[0]).toStrictEqual({ id: 'week_story', pid: 'ur.read.1.enonly01', nx: 'new', title: 'Only English' });
    expect(en.play.lantern).toEqual({ kind: 'story', title: 'Only English', pid: 'ur.read.1.enonly01' });
  });

  test('GOLDEN: no title in the file -> the tile is today\'s, exactly { id, pid, nx } (no title key)', async () => {
    // a fixture passage that is never shipped, its file written with no title in either language, so the golden does
    // not move when real passage files gain titles
    seed(STORY_ON, { web_quiz_challenge_runs: done, challenge_passages: [reg('en.read.1.untitled01', 'en')] });
    require('fs').writeFileSync(require('path').join(PDIR, 'en.read.1.untitled01.json'), JSON.stringify({ passage_id: 'en.read.1.untitled01', lang: 'en', kind: 'read', band: 1, pool: 'practice', title_en: null, title_ur: null }));
    Bank._loadPassagesFrom(PDIR);
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.play.shelf[0]).toStrictEqual({ id: 'week_story', pid: 'en.read.1.untitled01', nx: 'seen' });
    expect(Object.keys(out.play.shelf[0])).toEqual(['id', 'pid', 'nx']);
  });

  test('GOLDEN: no story released -> the hub payload\'s key set and the play block are today\'s', async () => {
    seed(STORY_ON, { web_quiz_challenge_runs: done });
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(Object.keys(out).sort()).toEqual(['again', 'brand', 'challenge', 'home_v', 'kid', 'kids', 'lang', 'last', 'lib', 'play', 'recs', 'rt', 'teacher'].sort());
    expect(Object.keys(out.play)).toEqual(['first', 'lantern', 'shelf', 'install', 'doors']);
    expect(out.play.shelf).toStrictEqual([{ id: 'numbers', nx: 'seen' }]);
    expect(JSON.stringify(out.play)).not.toContain('title');
  });
});
