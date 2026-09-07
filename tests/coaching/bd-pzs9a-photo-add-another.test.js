/**
 * bd-pzs9a — "Add another" must actually keep the session on the photo step.
 *
 * Reported by a coach: a teacher uploaded classroom pictures, one was not
 * accepted, and after uploading twice the flow still would not advance.
 *
 * The `photo_more_` tap DID have a handler (whatsapp-bot.js), but all it did was
 * send "Please send the next photo." It never looked at the session. So the tap
 * is a promise the session does not keep:
 *
 *   - a tap that arrives AFTER the session left the photo step (she tapped Done,
 *     or a 3rd photo auto-advanced, and only then taps the older "Add another"
 *     bubble) tells her to send a photo while the session sits at
 *     awaiting_lesson_plan — so the photo is consumed by the lesson-plan branch,
 *     OCR'd as a lesson plan, and rejected as "not a lesson plan";
 *   - at the photo cap it still says "send the next photo", which loops;
 *   - a session that is finished still gets "send the next photo";
 *   - WhatsApp delivers webhooks at-least-once, so a redelivered tap prompts twice.
 *
 * These tests execute the real tap handler with only the network boundaries
 * (WhatsApp, Supabase, Redis) faked.
 */

const mockSupabase = { from: jest.fn() };
jest.mock('../../bot/shared/config/supabase', () => mockSupabase);
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const mockWa = { messages: [], buttons: [], lists: [] };
jest.mock('../../bot/shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async (to, text) => { mockWa.messages.push({ to, text }); return true; }),
  sendInteractiveButtons: jest.fn(async (to, payload) => { mockWa.buttons.push({ to, payload }); return true; }),
  sendInteractiveMessage: jest.fn(async (to, payload) => { mockWa.lists.push({ to, payload }); return true; }),
}));

const mockRedisStore = new Map();
jest.mock('../../bot/shared/services/cache/railway-redis.service', () => ({
  isAvailable: () => true,
  setNX: jest.fn(async (key) => {
    if (mockRedisStore.has(key)) return false;
    mockRedisStore.set(key, '1');
    return true;
  }),
  setexWithCeiling: jest.fn(async (key, _ttl, value) => { mockRedisStore.set(key, value); return true; }),
  get: jest.fn(async (key) => mockRedisStore.get(key) ?? null),
  delete: jest.fn(async (key) => { mockRedisStore.delete(key); return true; }),
}));

const { handleAddAnotherPhotoTap } = require('../../bot/shared/services/coaching/classroom-photo/add-another.service');
const { MAX_COACHING_PHOTOS } = require('../../bot/shared/services/coaching/photo-capture-routing');

const SESSION_ID = '11111111-2222-3333-4444-555555555555';
const COACH = { id: 'coach-1', preferred_language: 'en' };
const FROM = '923001234567';

let sessionRow;
let userRow;
let updates;

function selectChain(row) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: row(), error: null }),
    single: async () => ({ data: row(), error: null }),
  };
  return chain;
}

function db() {
  updates = [];
  mockSupabase.from.mockImplementation((table) => {
    if (table === 'users') return selectChain(() => userRow);
    if (table === 'coaching_sessions') {
      const chain = selectChain(() => sessionRow);
      chain.update = (payload) => {
        updates.push(payload);
        // the write the service makes is what the next read must see
        sessionRow = { ...sessionRow, ...payload };
        return { eq: async () => ({ data: null, error: null }) };
      };
      return chain;
    }
    return selectChain(() => null);
  });
}

const PHOTOS = (n) => Array.from({ length: n }, (_, i) => ({ url: `r2://p${i}`, uploaded_at: '2026-09-07T00:00:00.000Z' }));

function session(overrides = {}) {
  return {
    id: SESSION_ID,
    status: 'awaiting_classroom_photo',
    user_id: COACH.id,
    observer_user_id: null,
    observation_type: null,
    created_at: '2026-09-07T00:00:00.000Z',
    conversation_state: { current_state: 'AWAITING_CLASSROOM_PHOTO', classroom_photos: PHOTOS(1) },
    classroom_photos: PHOTOS(1),
    ...overrides,
  };
}

const lastStatusUpdate = () => [...updates].reverse().find((u) => u.status);

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisStore.clear();
  mockWa.messages = [];
  mockWa.buttons = [];
  mockWa.lists = [];
  userRow = { id: COACH.id, preferred_language: 'en', region: 'ict' };
  sessionRow = session();
  db();
});

describe('bd-pzs9a — "Add another" keeps the session on the classroom-photo step', () => {
  it('re-anchors a session that has already moved on to the lesson-plan step', async () => {
    sessionRow = session({
      status: 'awaiting_lesson_plan',
      conversation_state: { current_state: 'AWAITING_LESSON_PLAN', classroom_photos: PHOTOS(1) },
    });

    await handleAddAnotherPhotoTap({ sessionId: SESSION_ID, from: FROM, user: COACH });

    const u = lastStatusUpdate();
    expect(u).toBeDefined();
    expect(u.status).toBe('awaiting_classroom_photo');
    expect(u.conversation_state.current_state).toBe('AWAITING_CLASSROOM_PHOTO');
    // the photos already uploaded must survive the merge
    expect(u.conversation_state.classroom_photos).toHaveLength(1);
    expect(mockWa.messages).toHaveLength(1);
  });

  it('binds the next photo to THIS observation (media target), so a coach running two does not cross-wire', async () => {
    const MediaTarget = require('../../bot/shared/services/coaching/media-target.service');
    await handleAddAnotherPhotoTap({ sessionId: SESSION_ID, from: FROM, user: COACH });
    expect(await MediaTarget.getTarget(COACH.id)).toMatchObject({ sessionId: SESSION_ID, kind: 'photo' });
  });

  it('re-affirms the photo step even when the session is already on it', async () => {
    await handleAddAnotherPhotoTap({ sessionId: SESSION_ID, from: FROM, user: COACH });
    const u = lastStatusUpdate();
    expect(u).toBeDefined();
    expect(u.status).toBe('awaiting_classroom_photo');
    expect(mockWa.messages[0].text).toMatch(/next/i);
  });

  it('at the photo cap it says so and moves to the lesson plan instead of looping', async () => {
    sessionRow = session({
      conversation_state: { current_state: 'AWAITING_CLASSROOM_PHOTO', classroom_photos: PHOTOS(MAX_COACHING_PHOTOS) },
      classroom_photos: PHOTOS(MAX_COACHING_PHOTOS),
    });

    await handleAddAnotherPhotoTap({ sessionId: SESSION_ID, from: FROM, user: COACH });

    expect(mockWa.messages.map((m) => m.text).join(' ')).not.toMatch(/next photo/i);
    expect(mockWa.messages.map((m) => m.text).join(' ')).toMatch(new RegExp(String(MAX_COACHING_PHOTOS)));
    // lands on the lesson-plan step (the bd-5azz0 rule: photo-max never skips the LP ask)
    expect(mockWa.buttons.length + mockWa.lists.length).toBeGreaterThan(0);
    expect(lastStatusUpdate().status).toBe('awaiting_lesson_plan');
  });

  it('does not re-open a session that is past the photo window', async () => {
    sessionRow = session({ status: 'completed', conversation_state: { current_state: 'COMPLETED' } });

    await handleAddAnotherPhotoTap({ sessionId: SESSION_ID, from: FROM, user: COACH });

    expect(updates).toHaveLength(0);
    expect(mockWa.messages.map((m) => m.text).join(' ')).not.toMatch(/next photo/i);
    expect(mockWa.messages).toHaveLength(1);
  });

  it('ignores a tap from someone who does not drive the session (bd-wwcgf)', async () => {
    sessionRow = session({
      user_id: 'teacher-9',
      observer_user_id: 'other-coach',
      observation_type: 'leader_observation',
    });

    await handleAddAnotherPhotoTap({ sessionId: SESSION_ID, from: FROM, user: COACH });

    expect(updates).toHaveLength(0);
    expect(mockWa.messages).toHaveLength(0);
  });

  it('a missing session is a no-op, not a crash', async () => {
    sessionRow = null;
    await expect(handleAddAnotherPhotoTap({ sessionId: SESSION_ID, from: FROM, user: COACH })).resolves.not.toThrow();
    expect(updates).toHaveLength(0);
  });
});

describe('bd-pzs9a — a redelivered tap is not a second tap (at-least-once webhooks)', () => {
  it('double delivery prompts once and writes once', async () => {
    await handleAddAnotherPhotoTap({ sessionId: SESSION_ID, from: FROM, user: COACH });
    const afterFirst = updates.length;
    await handleAddAnotherPhotoTap({ sessionId: SESSION_ID, from: FROM, user: COACH });

    expect(mockWa.messages).toHaveLength(1);
    expect(updates).toHaveLength(afterFirst);
  });

  it('but a genuine tap after the next photo landed does prompt again', async () => {
    await handleAddAnotherPhotoTap({ sessionId: SESSION_ID, from: FROM, user: COACH });
    // the photo she was asked for arrives
    sessionRow = session({
      conversation_state: { current_state: 'AWAITING_CLASSROOM_PHOTO', classroom_photos: PHOTOS(2) },
      classroom_photos: PHOTOS(2),
    });
    await handleAddAnotherPhotoTap({ sessionId: SESSION_ID, from: FROM, user: COACH });

    expect(mockWa.messages).toHaveLength(2);
  });
});

describe('bd-pzs9a — language (NIETE is flat en/ur)', () => {
  it('an Urdu coach is prompted in Urdu, read from preferred_language', async () => {
    userRow = { id: COACH.id, preferred_language: 'ur', region: 'ict' };

    await handleAddAnotherPhotoTap({ sessionId: SESSION_ID, from: FROM, user: { id: COACH.id } });

    const text = mockWa.messages[0].text;
    expect(text).toMatch(/[؀-ۿ]/);
    // gender-neutral: no gendered second-person verb stems
    expect(text).not.toMatch(/رہی ہوں گی|رہے ہوں گے|بھیجی ہیں آپ نے/);
    // Urdu prose digits are the U+06Fx set, never ASCII or the Arabic-Indic set
    expect(text).not.toMatch(/[0-9]/);
    expect(text).not.toMatch(/[٠-٩]/);
  });

  it('every prompt fits the WhatsApp body cap, measured in code points', async () => {
    for (const lang of ['en', 'ur']) {
      userRow = { id: COACH.id, preferred_language: lang, region: 'ict' };
      mockRedisStore.clear();
      mockWa.messages = [];
      sessionRow = session();
      await handleAddAnotherPhotoTap({ sessionId: SESSION_ID, from: FROM, user: { id: COACH.id } });
      expect([...mockWa.messages[0].text].length).toBeLessThanOrEqual(1024);
    }
  });
});

/**
 * The dispatch line itself. whatsapp-bot.js cannot be loaded under jest (a
 * 2,800-line express entry with bot-only deps at module scope), so this reads
 * the branch, pulls the require path and the exported name OUT of the source,
 * and then actually RESOLVES them. A grep would pass on a path that does not
 * exist or an export that was renamed — the guaranteed-ReferenceError class.
 */
describe('bd-pzs9a — the photo_more_ branch dispatches to a module that really exists', () => {
  const fs = require('fs');
  const path = require('path');
  const BOT = path.join(__dirname, '../../bot/whatsapp-bot.js');
  const src = fs.readFileSync(BOT, 'utf8');
  const branch = src.slice(src.indexOf("buttonId.startsWith('photo_more_')"));

  it('requires a resolvable module and calls an exported function on it', () => {
    const m = branch.match(/const\s*\{\s*(\w+)\s*\}\s*=\s*require\('(\.[^']+)'\)/);
    expect(m).not.toBeNull();
    const [, exportName, relPath] = m;
    // resolve exactly as whatsapp-bot.js would, from bot/
    const resolved = require.resolve(path.join(path.dirname(BOT), relPath));
    const mod = require(resolved);
    expect(typeof mod[exportName]).toBe('function');
    expect(branch).toMatch(new RegExp(`await\\s+${exportName}\\(`));
  });

  it('passes the session id, the sender and the user through', () => {
    const call = branch.match(/await\s+\w+\(\{([^}]*)\}\)/);
    expect(call).not.toBeNull();
    for (const arg of ['sessionId', 'from', 'user']) expect(call[1]).toContain(arg);
  });
});
