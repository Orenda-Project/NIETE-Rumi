'use strict';
/**
 * The hub's lantern names only the story of the tile directly under it: the shelf's first tile, this week's story
 * (the newest live read story). Unseen -> the lantern names it with its pid; seen (or no title) -> no other story is
 * named and the lantern says its numbers/day line. A listen story keeps its NEW mark on its own tile.
 * playFor runs for real through the hub payload (web-quiz-hub.js); Supabase and Redis are the boundaries and are faked.
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

describe('the lantern names the story of the tile under it (shelf[0], this week\'s story)', () => {
  const STORY_ON = [...BASE_ON, ON('web_quiz_challenge_v2'), ON('web_quiz_challenge_story'), ON('web_quiz_events_v2')];
  const period = (() => { const d = new Date(Date.now() + 5 * 3600000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();
  const done = [
    { student_id: KID, exercise: 'read', mode: 'check', record: true, status: 'scored', period_id: period, passage_id: null },
    { student_id: KID, exercise: 'bigger', mode: 'check', record: true, status: 'scored', period_id: period, passage_id: null },
  ];
  const passage = (id, kind, releasedH) => ({ passage_id: id, lang: 'en', band: 1, kind, pool: 'practice', status: 'reviewed', released_at: ago(releasedH), title_en: `Title ${id}`, title_ur: null });

  test('newest unseen story is a listen one, this week\'s read story is unseen too -> the lantern names the read story and its pid', async () => {
    seed(STORY_ON, { web_quiz_challenge_runs: done, challenge_passages: [passage('p-read', 'read', 30), passage('p-listen', 'listen', 2)] });
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.play.shelf[0]).toEqual({ id: 'week_story', pid: 'p-read', nx: 'new', title: 'Title p-read' });
    expect(out.play.lantern).toEqual({ kind: 'story', title: 'Title p-read', pid: 'p-read' });
    expect(out.play.shelf.find((t) => t.id === 'listen')).toEqual({ id: 'listen', pid: 'p-listen', nx: 'new' });
  });

  test('this week\'s read story is seen, a listen story is unseen -> no story line: the numbers/day line; the listen tile keeps NEW', async () => {
    seed(STORY_ON, {
      web_quiz_challenge_runs: [...done, { student_id: KID, exercise: 'read', mode: 'practice', record: false, status: 'scored', period_id: period, passage_id: 'p-read' }],
      challenge_passages: [passage('p-read', 'read', 30), passage('p-listen', 'listen', 2)],
    });
    const out = await Hub.hub(T.signHub([KID]), A);
    expect(out.play.shelf[0]).toEqual({ id: 'week_story', pid: 'p-read', nx: 'seen', title: 'Title p-read' });
    expect(out.play.lantern.kind).toBe('numbers');
    expect(out.play.lantern).not.toHaveProperty('title');
    expect(out.play.shelf.find((t) => t.id === 'listen')).toEqual({ id: 'listen', pid: 'p-listen', nx: 'new' });
  });

  test('a waiting Trail stop keeps priority over this week\'s unseen story', async () => {
    seed(STORY_ON, { web_quiz_challenge_runs: [done[0]], challenge_passages: [passage('p-read', 'read', 30), passage('p-listen', 'listen', 2)] });
    expect((await Hub.hub(T.signHub([KID]), A)).play.lantern).toEqual({ kind: 'trail', stops: 1 });
  });
});
