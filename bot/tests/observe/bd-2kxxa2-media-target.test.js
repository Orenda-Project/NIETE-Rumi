'use strict';
/**
 * bd-2kxxa.2 (R165) — a classroom photo / lesson-plan document must bind to the
 * observation the coach TAPPED for, and when nothing was tapped and more than
 * one observation is waiting, Rumi asks "which teacher?" instead of guessing.
 *
 * Live defect (origin/develop, 2026-09-03): a coach runs 2-3 observations
 * back-to-back. Tapping "Yes" on the photo prompt (`photo_yes_<sid>`) or
 * "Upload" on the LP list (`lp_upload_<sid>`) carried the exact session id, but
 * the code only flipped that row's status and threw the id away. When the
 * media then arrived, FOUR sites picked "this sender's NEWEST session at the
 * gate" (`.order('created_at', desc).limit(1)`):
 *   image-message.handler.js  Phase-3 photo gate, LP-as-photo gate, race-hold gate
 *   whatsapp-bot.js           LP DOCUMENT gate (+ the document-as-photo gate)
 * so every file landed on the newest observation regardless of teacher (31 Aug:
 * 3 photos in 5 min from one coach, all newest-first; 656/712 observations since
 * 28 Aug had another by the same coach within 3 h).
 *
 * These tests drive the REAL handler / attach / resolver / capture code with
 * the network + DB boundary mocked (Supabase client, Redis, WhatsApp Graph,
 * R2). Two first-party modules are mocked and declared here (pre-merge class P):
 *   - coaching-orchestrator.service  (R4 asserts the call INTO it)
 *   - language-cache                 (a Redis/DB cache util — returns 'en')
 */

const fs = require('fs');
const path = require('path');

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const ROOT = path.join(__dirname, '../..');
const COACH = { id: 'coach-1', role: 'coach', preferred_language: 'en' };
const FROM = '923260000001';
const OLDER = '11111111-1111-4111-8111-111111111111';
const NEWER = '22222222-2222-4222-8222-222222222222';

// ─── boundary mocks ──────────────────────────────────────────────────────────
// Supabase: a chainable builder over an in-memory row set. Filters honoured:
// eq / in / or(user_id.eq.X,observer_user_id.eq.X) / order / limit. Awaiting
// the builder itself (no .maybeSingle()) resolves { data: rows } — that is the
// no-limit candidate query the fix introduces.
const mockDb = { sessions: [], users: [], updates: [], queries: [] };
function mockSupabaseFrom(table) {
  const ops = [];
  const b = {};
  for (const n of ['select', 'eq', 'neq', 'or', 'in', 'order', 'limit', 'is', 'not']) {
    b[n] = (...args) => { ops.push([n, ...args]); return b; };
  }
  b.update = (payload) => { ops.push(['update', payload]); return b; };
  b.insert = (payload) => { ops.push(['insert', payload]); return b; };
  const run = () => {
    mockDb.queries.push({ table, ops: ops.slice() });
    const upd = ops.find((o) => o[0] === 'update');
    if (upd) {
      const eq = ops.find((o) => o[0] === 'eq' && o[1] === 'id');
      mockDb.updates.push({ table, payload: upd[1], id: eq ? eq[2] : null });
      return { data: null, error: null };
    }
    let rows = (table === 'coaching_sessions' ? mockDb.sessions : table === 'users' ? mockDb.users : []).slice();
    for (const [op, a, v] of ops) {
      if (op === 'eq') rows = rows.filter((r) => r[a] === v);
      if (op === 'in') rows = rows.filter((r) => (v || []).includes(r[a]));
      if (op === 'or') {
        const m = /user_id\.eq\.([^,]+),observer_user_id\.eq\.(.+)/.exec(a);
        if (m) rows = rows.filter((r) => r.user_id === m[1] || r.observer_user_id === m[2]);
      }
      if (op === 'order') {
        const asc = v && v.ascending ? 1 : -1;
        rows.sort((x, y) => (String(x[a]) < String(y[a]) ? -1 : 1) * asc);
      }
      if (op === 'limit') rows = rows.slice(0, a);
    }
    return { data: rows, error: null };
  };
  b.maybeSingle = async () => { const r = run(); return { data: (r.data && r.data[0]) || null, error: null }; };
  b.single = b.maybeSingle;
  b.then = (res, rej) => Promise.resolve(run()).then(res, rej);
  return b;
}
jest.mock('../../shared/config/supabase', () => ({ from: (t) => mockSupabaseFrom(t) }));

// Redis: Map store; get() auto-parses JSON exactly like railway-redis does.
const mockStore = new Map();
jest.mock('../../shared/services/cache/railway-redis.service', () => ({
  get: jest.fn(async (k) => {
    if (!mockStore.has(k)) return null;
    const v = mockStore.get(k);
    try { return JSON.parse(v); } catch (_) { return v; }
  }),
  set: jest.fn(async (k, v) => { mockStore.set(k, typeof v === 'string' ? v : JSON.stringify(v)); return true; }),
  setexWithCeiling: jest.fn(async (k, ttl, v) => { mockStore.set(k, typeof v === 'string' ? v : JSON.stringify(v)); return true; }),
  setex: jest.fn(async (k, ttl, v) => { mockStore.set(k, typeof v === 'string' ? v : JSON.stringify(v)); return true; }),
  setNX: jest.fn(async (k, v) => { if (mockStore.has(k)) return false; mockStore.set(k, typeof v === 'string' ? v : JSON.stringify(v)); return true; }),
  delete: jest.fn(async (k) => mockStore.delete(k)),
  exists: jest.fn(async (k) => mockStore.has(k)),
}));

// WhatsApp Graph API
const mockWa = { msgs: [], lists: [], buttons: [] };
jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async (to, m) => { mockWa.msgs.push(m); return true; }),
  sendInteractiveMessage: jest.fn(async (to, p) => { mockWa.lists.push(p); return true; }),
  sendInteractiveButtons: jest.fn(async (to, p) => { mockWa.buttons.push(p); return true; }),
  downloadMedia: jest.fn(async () => Buffer.alloc(8, 1)),
  startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })),
}));

// R2
jest.mock('../../shared/storage/r2', () => ({
  uploadImageWithRetry: jest.fn(async () => 'https://r2.example/photo.jpg'),
}));

// First-party (declared): the LP processor entry the document path calls into,
// and the language cache (Redis+DB wrapper).
jest.mock('../../shared/services/coaching-orchestrator.service', () => ({
  handleLessonPlanResponse: jest.fn(async () => true),
}));
jest.mock('../../shared/utils/language-cache', () => ({
  getUserLanguage: jest.fn(async () => 'en'),
  setUserLanguage: jest.fn(async () => true),
}));
jest.mock('../../shared/database/bot-helpers', () => ({
  storeConversation: jest.fn(async () => true),
  getOrCreateSession: jest.fn(async () => 'chat-1'),
}));
jest.mock('../../shared/services/vision.service', () => ({}));
jest.mock('../../shared/handlers/exam-checker.handler', () => ({
  handleExamImage: jest.fn(async () => ({ handled: false })),
}));

const WA = require('../../shared/services/whatsapp.service');
const CoachingService = require('../../shared/services/coaching-orchestrator.service');

function photoSession(id, createdAt, extra = {}) {
  return {
    id, user_id: `teacher-${id.slice(0, 1)}`, observer_user_id: COACH.id,
    status: 'awaiting_classroom_photo', created_at: createdAt,
    conversation_state: { current_state: 'AWAITING_CLASSROOM_PHOTO' }, classroom_photos: [],
    ...extra,
  };
}
function lpSession(id, createdAt) {
  return {
    id, user_id: `teacher-${id.slice(0, 1)}`, observer_user_id: COACH.id,
    status: 'awaiting_lesson_plan', created_at: createdAt,
    conversation_state: { current_state: 'AWAITING_LESSON_PLAN' }, classroom_photos: [],
  };
}
const imageMessage = (id) => ({ id: `wamid-${id}`, image: { id, mime_type: 'image/jpeg' } });

beforeEach(() => {
  mockDb.sessions = []; mockDb.users = []; mockDb.updates.length = 0; mockDb.queries.length = 0;
  mockStore.clear(); mockWa.msgs.length = 0; mockWa.lists.length = 0; mockWa.buttons.length = 0;
  jest.clearAllMocks();
  WA.sendMessage.mockImplementation(async (to, m) => { mockWa.msgs.push(m); return true; });
  WA.sendInteractiveMessage.mockImplementation(async (to, p) => { mockWa.lists.push(p); return true; });
  WA.sendInteractiveButtons.mockImplementation(async (to, p) => { mockWa.buttons.push(p); return true; });
  WA.downloadMedia.mockImplementation(async () => Buffer.alloc(8, 1));
  WA.startContinuousTypingIndicator.mockImplementation(() => ({ stop: jest.fn() }));
});

const photoUpdates = () => mockDb.updates.filter((u) => u.table === 'coaching_sessions' && u.payload && u.payload.classroom_photos);

// ─── media-target.service ────────────────────────────────────────────────────
describe('media-target.service — the tapped observation is remembered per coach', () => {
  const MediaTarget = () => require('../../shared/services/coaching/media-target.service');

  test('setTarget/getTarget round-trips {sessionId, kind, setAt} under media:target:<userId>', async () => {
    await MediaTarget().setTarget(COACH.id, OLDER, 'photo');
    expect(mockStore.has(`media:target:${COACH.id}`)).toBe(true);
    const t = await MediaTarget().getTarget(COACH.id);
    expect(t.sessionId).toBe(OLDER);
    expect(t.kind).toBe('photo');
    expect(typeof t.setAt).toBe('string');
  });

  test('getTarget tolerates railway-redis auto-parsed objects AND raw strings', async () => {
    mockStore.set(`media:target:${COACH.id}`, JSON.stringify({ sessionId: NEWER, kind: 'lp' }));
    expect((await MediaTarget().getTarget(COACH.id)).sessionId).toBe(NEWER);
    require('../../shared/services/cache/railway-redis.service').get.mockImplementationOnce(async () => ({ sessionId: OLDER, kind: 'lp' }));
    expect((await MediaTarget().getTarget(COACH.id)).sessionId).toBe(OLDER);
  });

  test('clearTarget removes the key; parkMedia/getParked/clearParked use media:parked:<userId>', async () => {
    await MediaTarget().setTarget(COACH.id, OLDER, 'photo');
    await MediaTarget().clearTarget(COACH.id);
    expect(await MediaTarget().getTarget(COACH.id)).toBeNull();
    await MediaTarget().parkMedia(COACH.id, { mediaId: 'm-1', mimeType: 'image/jpeg', kind: 'photo' });
    expect(mockStore.has(`media:parked:${COACH.id}`)).toBe(true);
    const p = await MediaTarget().getParked(COACH.id);
    expect(p.mediaId).toBe('m-1');
    expect(typeof p.parkedAt).toBe('string');
    await MediaTarget().clearParked(COACH.id);
    expect(await MediaTarget().getParked(COACH.id)).toBeNull();
  });
});

// ─── media-session-resolver ──────────────────────────────────────────────────
describe('media-session-resolver — ONE resolution rule for every arrival site', () => {
  const Resolver = () => require('../../shared/services/coaching/media-session-resolver');
  const MediaTarget = () => require('../../shared/services/coaching/media-target.service');

  test('a stored target that is still at the gate wins over a newer candidate', async () => {
    mockDb.sessions = [photoSession(OLDER, '2026-08-31T09:00:00Z'), photoSession(NEWER, '2026-08-31T09:30:00Z')];
    await MediaTarget().setTarget(COACH.id, OLDER, 'photo');
    const r = await Resolver().resolveMediaSession({ user: COACH, kind: 'photo' });
    expect(r.outcome).toBe('target');
    expect(r.session.id).toBe(OLDER);
  });

  test('a target whose session has moved on is dropped and the candidate rule runs', async () => {
    mockDb.sessions = [
      photoSession(OLDER, '2026-08-31T09:00:00Z', { status: 'completed', conversation_state: { current_state: 'COMPLETED' } }),
      photoSession(NEWER, '2026-08-31T09:30:00Z'),
    ];
    await MediaTarget().setTarget(COACH.id, OLDER, 'photo');
    const r = await Resolver().resolveMediaSession({ user: COACH, kind: 'photo' });
    expect(r.outcome).toBe('single');
    expect(r.session.id).toBe(NEWER);
    expect(await MediaTarget().getTarget(COACH.id)).toBeNull();
  });

  test('exactly one candidate → single (today\'s behaviour); none → none', async () => {
    mockDb.sessions = [photoSession(OLDER, '2026-08-31T09:00:00Z')];
    expect((await Resolver().resolveMediaSession({ user: COACH, kind: 'photo' })).outcome).toBe('single');
    mockDb.sessions = [];
    expect((await Resolver().resolveMediaSession({ user: COACH, kind: 'photo' })).outcome).toBe('none');
  });

  test('two candidates and no target → ambiguous, candidates newest-first, NO guess', async () => {
    mockDb.sessions = [photoSession(OLDER, '2026-08-31T09:00:00Z'), photoSession(NEWER, '2026-08-31T09:30:00Z')];
    const r = await Resolver().resolveMediaSession({ user: COACH, kind: 'photo' });
    expect(r.outcome).toBe('ambiguous');
    expect(r.session).toBeNull();
    expect(r.candidates.map((c) => c.id)).toEqual([NEWER, OLDER]);
    // the candidate query must not carry a limit(1)
    const q = mockDb.queries.find((x) => x.table === 'coaching_sessions' && x.ops.some((o) => o[0] === 'in'));
    expect(q.ops.some((o) => o[0] === 'limit')).toBe(false);
  });

  test('the lp kind gates on awaiting_lesson_plan; a photo-kind target does not hijack it', async () => {
    mockDb.sessions = [lpSession(OLDER, '2026-08-31T09:00:00Z'), photoSession(NEWER, '2026-08-31T09:30:00Z')];
    await MediaTarget().setTarget(COACH.id, NEWER, 'photo');
    const r = await Resolver().resolveMediaSession({ user: COACH, kind: 'lp' });
    expect(r.outcome).toBe('single');
    expect(r.session.id).toBe(OLDER);
  });
});

// ─── R1–R3: the image webhook, end to end ────────────────────────────────────
describe('image-message.handler — classroom photo arrival', () => {
  const handler = () => require('../../shared/handlers/image-message.handler');
  const MediaTarget = () => require('../../shared/services/coaching/media-target.service');

  test('R1: two sessions at the photo gate, target = OLDER → the photo attaches to the OLDER one', async () => {
    mockDb.sessions = [photoSession(OLDER, '2026-08-31T09:00:00Z'), photoSession(NEWER, '2026-08-31T09:30:00Z')];
    await MediaTarget().setTarget(COACH.id, OLDER, 'photo');

    await handler().handleImageMessage(imageMessage('img-1'), FROM, COACH);

    const ups = photoUpdates();
    expect(ups.length).toBe(1);
    expect(ups[0].id).toBe(OLDER);
    expect(ups[0].payload.classroom_photos.length).toBe(1);
    expect(mockWa.lists.length).toBe(0);            // nobody was asked
    // the add-another/done buttons name the OLDER session too
    expect(mockWa.buttons[0].buttons.map((b) => b.id)).toEqual([`photo_more_${OLDER}`, `photo_done_${OLDER}`]);
  });

  test('R2: no target, two candidates → nothing attached, media parked, coach asked with 2 rows', async () => {
    mockDb.sessions = [photoSession(OLDER, '2026-08-31T09:00:00Z'), photoSession(NEWER, '2026-08-31T09:30:00Z')];
    mockDb.users = [
      { id: `teacher-${OLDER.slice(0, 1)}`, name: 'Ayesha Khan', first_name: 'Ayesha' },
      { id: `teacher-${NEWER.slice(0, 1)}`, name: 'Bushra Malik', first_name: 'Bushra' },
    ];

    await handler().handleImageMessage(imageMessage('img-2'), FROM, COACH);

    expect(photoUpdates().length).toBe(0);
    expect(mockWa.lists.length).toBe(1);
    const rows = mockWa.lists[0].action.sections.flatMap((s) => s.rows);
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.id).sort()).toEqual([`mediatarget_${OLDER}`, `mediatarget_${NEWER}`].sort());
    expect(rows.map((r) => r.title)).toEqual(expect.arrayContaining(['Ayesha Khan', 'Bushra Malik']));
    const parked = await MediaTarget().getParked(COACH.id);
    expect(parked).toMatchObject({ mediaId: 'img-2', mimeType: 'image/jpeg', kind: 'photo' });
  });

  test('R3: no target, exactly one candidate → attaches as today', async () => {
    mockDb.sessions = [photoSession(OLDER, '2026-08-31T09:00:00Z')];
    await handler().handleImageMessage(imageMessage('img-3'), FROM, COACH);
    const ups = photoUpdates();
    expect(ups.length).toBe(1);
    expect(ups[0].id).toBe(OLDER);
    expect(mockWa.lists.length).toBe(0);
  });

  test('bd-2371 idempotency survives: a redelivered image id attaches once', async () => {
    mockDb.sessions = [photoSession(OLDER, '2026-08-31T09:00:00Z')];
    await handler().handleImageMessage(imageMessage('img-dup'), FROM, COACH);
    await handler().handleImageMessage(imageMessage('img-dup'), FROM, COACH);
    expect(photoUpdates().length).toBe(1);
  });
});

// ─── R4: the LP document path ────────────────────────────────────────────────
describe('lesson-plan media arrival (document path)', () => {
  const Attach = () => require('../../shared/services/coaching/media-attach.service');
  const MediaTarget = () => require('../../shared/services/coaching/media-target.service');

  test('R4: two sessions at awaiting_lesson_plan, target = OLDER → handleLessonPlanResponse gets the OLDER id', async () => {
    mockDb.sessions = [lpSession(OLDER, '2026-08-31T09:00:00Z'), lpSession(NEWER, '2026-08-31T09:30:00Z')];
    await MediaTarget().setTarget(COACH.id, OLDER, 'lp');

    const handled = await Attach().handleLessonPlanMediaArrival({ user: COACH, from: FROM, mediaId: 'doc-1', mimeType: 'application/pdf' });

    expect(handled).toBe(true);
    expect(CoachingService.handleLessonPlanResponse).toHaveBeenCalledTimes(1);
    expect(CoachingService.handleLessonPlanResponse).toHaveBeenCalledWith(OLDER, FROM, true, 'doc-1');
    // a document is a one-shot: the lp target is consumed
    expect(await MediaTarget().getTarget(COACH.id)).toBeNull();
  });

  test('two LP candidates and no target → parked + asked, processor NOT called', async () => {
    mockDb.sessions = [lpSession(OLDER, '2026-08-31T09:00:00Z'), lpSession(NEWER, '2026-08-31T09:30:00Z')];
    const handled = await Attach().handleLessonPlanMediaArrival({ user: COACH, from: FROM, mediaId: 'doc-2', mimeType: 'application/pdf' });
    expect(handled).toBe(true);
    expect(CoachingService.handleLessonPlanResponse).not.toHaveBeenCalled();
    expect(mockWa.lists.length).toBe(1);
    expect((await MediaTarget().getParked(COACH.id))).toMatchObject({ mediaId: 'doc-2', kind: 'lp' });
  });

  test('no LP session waiting → not handled (caller keeps its generic reply)', async () => {
    mockDb.sessions = [];
    expect(await Attach().handleLessonPlanMediaArrival({ user: COACH, from: FROM, mediaId: 'doc-3', mimeType: 'application/pdf' })).toBe(false);
  });
});

// ─── R5: the "which teacher?" tap ────────────────────────────────────────────
describe('mediatarget_<sid> list tap', () => {
  const Attach = () => require('../../shared/services/coaching/media-attach.service');
  const MediaTarget = () => require('../../shared/services/coaching/media-target.service');
  const handler = () => require('../../shared/handlers/image-message.handler');

  test('R5: the tap sets the target and attaches the PARKED photo to the tapped (older) session', async () => {
    mockDb.sessions = [photoSession(OLDER, '2026-08-31T09:00:00Z'), photoSession(NEWER, '2026-08-31T09:30:00Z')];
    await handler().handleImageMessage(imageMessage('img-5'), FROM, COACH);   // → parked + asked
    expect(photoUpdates().length).toBe(0);

    const handled = await Attach().handleMediaTargetTap(`mediatarget_${OLDER}`, FROM, COACH);

    expect(handled).toBe(true);
    const t = await MediaTarget().getTarget(COACH.id);
    expect(t).toMatchObject({ sessionId: OLDER, kind: 'photo' });
    const ups = photoUpdates();
    expect(ups.length).toBe(1);
    expect(ups[0].id).toBe(OLDER);
    expect(WA.downloadMedia).toHaveBeenCalledWith('img-5');
    expect(await MediaTarget().getParked(COACH.id)).toBeNull();
  });

  test('a parked LP document is handed to the LP processor for the tapped session', async () => {
    mockDb.sessions = [lpSession(OLDER, '2026-08-31T09:00:00Z'), lpSession(NEWER, '2026-08-31T09:30:00Z')];
    await Attach().handleLessonPlanMediaArrival({ user: COACH, from: FROM, mediaId: 'doc-5', mimeType: 'application/pdf' });
    await Attach().handleMediaTargetTap(`mediatarget_${NEWER}`, FROM, COACH);
    expect(CoachingService.handleLessonPlanResponse).toHaveBeenCalledWith(NEWER, FROM, true, 'doc-5');
  });

  test('a double tap attaches exactly once', async () => {
    mockDb.sessions = [photoSession(OLDER, '2026-08-31T09:00:00Z'), photoSession(NEWER, '2026-08-31T09:30:00Z')];
    await handler().handleImageMessage(imageMessage('img-6'), FROM, COACH);
    await Attach().handleMediaTargetTap(`mediatarget_${OLDER}`, FROM, COACH);
    await Attach().handleMediaTargetTap(`mediatarget_${OLDER}`, FROM, COACH);
    expect(photoUpdates().length).toBe(1);
  });

  test('a tap with nothing parked (expired) still sets the target and asks for a re-send', async () => {
    mockDb.sessions = [photoSession(OLDER, '2026-08-31T09:00:00Z')];
    const handled = await Attach().handleMediaTargetTap(`mediatarget_${OLDER}`, FROM, COACH);
    expect(handled).toBe(true);
    expect((await MediaTarget().getTarget(COACH.id)).sessionId).toBe(OLDER);
    expect(mockWa.msgs.length).toBe(1);
  });

  test('ignores ids that are not mediatarget_', async () => {
    expect(await Attach().handleMediaTargetTap('lp_none_x', FROM, COACH)).toBe(false);
  });
});

// ─── the taps SET the target ─────────────────────────────────────────────────
describe('the taps that carry the session id now remember it', () => {
  test('lp_upload_<sid> list tap records an lp target for the tapper', async () => {
    const { handleLpListSelection } = require('../../shared/services/coaching/lp-coaching/lp-list-selection.handler');
    const setMediaTarget = jest.fn(async () => true);
    const handled = await handleLpListSelection(`lp_upload_${OLDER}`, FROM, {
      userId: COACH.id,
      setMediaTarget,
      linker: { handleLPSelection: jest.fn(async () => ({ awaiting_upload: true })) },
      sendMessage: jest.fn(async () => true),
      resolveLanguage: async () => 'en',
      messages: { getCoachingMessage: () => 'send it' },
    });
    expect(handled).toBe(true);
    expect(setMediaTarget).toHaveBeenCalledWith(COACH.id, OLDER, 'lp');
  });

  test('the default setMediaTarget dep writes through media-target.service', async () => {
    const { handleLpListSelection } = require('../../shared/services/coaching/lp-coaching/lp-list-selection.handler');
    await handleLpListSelection(`lp_upload_${NEWER}`, FROM, {
      userId: COACH.id,
      linker: { handleLPSelection: jest.fn(async () => ({ awaiting_upload: true })) },
      sendMessage: jest.fn(async () => true),
      resolveLanguage: async () => 'en',
      messages: { getCoachingMessage: () => 'send it' },
    });
    const MediaTarget = require('../../shared/services/coaching/media-target.service');
    expect(await MediaTarget.getTarget(COACH.id)).toMatchObject({ sessionId: NEWER, kind: 'lp' });
  });
});

// ─── whatsapp-bot.js wiring (its router lives inside the webhook closure and
// cannot be imported in isolation — asserted against the source, like the
// other handler-dispatch tests in this suite) ───────────────────────────────
describe('whatsapp-bot.js wiring (source)', () => {
  const SRC = fs.readFileSync(path.join(ROOT, 'whatsapp-bot.js'), 'utf8');
  const IMG = fs.readFileSync(path.join(ROOT, 'shared/handlers/image-message.handler.js'), 'utf8');
  const slice = (src, startMarker, endMarker) => {
    const s = src.indexOf(startMarker); expect(s).toBeGreaterThan(-1);
    const e = src.indexOf(endMarker, s); expect(e).toBeGreaterThan(s);
    return src.slice(s, e);
  };

  test('photo_yes_<sid> records a photo target', () => {
    const block = slice(SRC, "buttonId.startsWith('photo_yes_')", "buttonId.startsWith('photo_done_')");
    expect(block).toMatch(/setTarget\(\s*user\.id\s*,\s*sessionId\s*,\s*'photo'\s*\)/);
  });

  test('lessonplan_yes_<sid> (buttons prompt) records an lp target', () => {
    const block = slice(SRC, "buttonId.startsWith('lessonplan_yes_')", "buttonId.startsWith('lessonplan_no_')");
    expect(block).toMatch(/setTarget\(\s*user\.id\s*,\s*sessionId\s*,\s*'lp'\s*\)/);
  });

  test('list_reply routes mediatarget_ taps to the shared handler, before the lp_ block', () => {
    const block = slice(SRC, "message.interactive?.type === 'list_reply'", 'Reading Assessment language selection');
    const tap = block.indexOf('handleMediaTargetTap');
    const lp = block.indexOf('handleLpListSelection');
    expect(tap).toBeGreaterThan(-1);
    expect(tap).toBeLessThan(lp);
    // the lp list handler is told WHO tapped so lp_upload_ can record the target
    expect(block).toMatch(/handleLpListSelection\(listId,\s*from,\s*\{[^}]*userId/);
  });

  test('the LP DOCUMENT gate goes through the shared resolver — no newest-first limit(1)', () => {
    const block = slice(SRC, 'LESSON PLAN DOCUMENT', "I received your document");
    expect(block).toMatch(/handleLessonPlanMediaArrival/);
    expect(block).not.toMatch(/\.limit\(1\)/);
    expect(block).not.toMatch(/select\('\*'\)/);
  });

  test('the document-as-photo gate goes through the shared photo arrival', () => {
    const block = slice(SRC, 'classroom photo sent AS A DOCUMENT', 'CLASSROOM COACHING DETECTION');
    expect(block).toMatch(/handlePhotoArrival/);
    expect(block).not.toMatch(/\.limit\(1\)/);
  });

  test('image-message.handler has no newest-first coaching_sessions pick left', () => {
    const active = IMG.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
    expect(active).not.toMatch(/\.order\('created_at',\s*\{\s*ascending:\s*false\s*\}\)\s*\.limit\(1\)/);
    expect(active).toMatch(/handlePhotoArrival/);
    expect(active).toMatch(/handleLessonPlanMediaArrival/);
  });
});

// ─── copy ────────────────────────────────────────────────────────────────────
describe('observe-strings — the ambiguity prompt is short and bilingual', () => {
  test('buildMediaTargetPrompt renders a list with one row per candidate, en and ur', () => {
    const { buildMediaTargetPrompt } = require('../../shared/services/observe/observe-strings');
    const candidates = [
      { id: OLDER, teacherName: 'Ayesha Khan', created_at: '2026-08-31T04:00:00Z' },
      { id: NEWER, teacherName: null, created_at: '2026-08-31T04:30:00Z' },
    ];
    for (const lang of ['en', 'ur']) {
      const p = buildMediaTargetPrompt(lang, { kind: 'photo', candidates });
      const rows = p.action.sections.flatMap((s) => s.rows);
      expect(rows.length).toBe(2);
      expect(rows[0].id).toBe(`mediatarget_${OLDER}`);
      expect(rows[0].title).toBe('Ayesha Khan');
      expect(rows[1].title.length).toBeGreaterThan(0);        // falls back to a time label
      for (const r of rows) {
        expect([...r.title].length).toBeLessThanOrEqual(24);   // WhatsApp row-title cap (code points)
        if (r.description) expect([...r.description].length).toBeLessThanOrEqual(72);
      }
      expect([...p.action.button].length).toBeLessThanOrEqual(20);
      expect(p.body.text.length).toBeLessThan(200);
    }
    expect(buildMediaTargetPrompt('ur', { kind: 'lp', candidates }).body.text).toMatch(/[؀-ۿ]/);
    expect(buildMediaTargetPrompt('en', { kind: 'lp', candidates }).body.text).toMatch(/lesson plan/i);
  });
});
