/**
 * bd-n9832 — a cancelled observation is STILL revived by the photo question's "Yes".
 *
 * Staging, 16 Sep 2026, observation d628d9e3 (pass-3 E2E, scenario B6):
 *   01:30:11Z  the observation is bound; the photo gate goes out
 *   01:31:46Z  the coach cancels                      → status 'cancelled'
 *   01:32:42Z  she taps that gate's "No"  → REFUSED   ✅ (#1008 guards this arm)
 *   01:36:33Z  she taps that gate's "Yes" → status 'awaiting_classroom_photo',
 *              log '📸 User will send classroom photo', no refusal, and the
 *              worklist grows a "Complete the form — 1 to finish" row.
 *
 * #1008 routed the photo gate's No/Done through the guarded
 * advanceToLessonPlanStep and guarded the LP Yes/No, the LP list, Continue, the
 * retry tap and the debrief entry — but the branches that write `status`
 * INLINE in whatsapp-bot.js were never touched. Two of them revive a
 * cancelled observation from a button that is still live in the chat:
 * `photo_yes_` (the incident) and `coaching_finish_` — the twin of the
 * `coaching_continue_` button #1008 DID guard, on the very same reminder
 * message. A third, `coaching_confirm_`, writes 'confirmed' without ever
 * reading status.
 *
 * These cases drive the REAL branches through a real POST /webhook, so the
 * changed lines actually execute (bd-s192t: a helper test plus a source-grep
 * "wiring" test satisfies red-first while shipping a dead path). Only the
 * database, WhatsApp and the queue are mocked.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OBSERVE_FRAMEWORK = 'fico';

const { resolveUx } = require('../../shared/config/ux-strings');

const SID = 'obs-cancelled-n9832';
const COACH = { id: 'coach-1', phone_number: '923000000001', preferred_language: 'en', role: 'coach' };
const FROM = COACH.phone_number;
const refusal = resolveUx('coachingSessionCancelled', { language: 'en' });

/** A session row, cancelled unless told otherwise. */
function row(status = 'cancelled', extra = {}) {
  return {
    id: SID,
    status,
    user_id: 'teacher-1',
    observer_user_id: COACH.id,
    observation_type: 'leader_observation',
    debrief_status: 'pending',
    transcript_text: 'a transcript',
    audio_id: 'media-1',
    analysis_data: {},
    conversation_state: { current_state: 'AWAITING_PHOTO', questions_answered: 1 },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    users: { name: null, phone_number: '923000000009', preferred_language: 'en' },
    ...extra,
  };
}

/** Chainable supabase double that records every update and every predicate. */
function db(session) {
  const calls = { updates: [], nots: [], ins: [] };
  return {
    calls,
    from(table) {
      const b = { filters: {}, _update: null };
      ['select', 'order', 'limit', 'or', 'is', 'gte', 'lte', 'range', 'neq'].forEach((m) => {
        b[m] = () => { if (m === 'range' || m === 'limit') b._many = true; return b; };
      });
      b.eq = (c, v) => { b.filters[c] = v; if (c === 'status') { calls.ins.push({ table, col: c, val: v }); b._statusPred = v; } return b; };
      b.in = (c, v) => { if (c === 'status') { calls.ins.push({ table, col: c, val: v }); b._statusIn = v; } return b; };
      b.not = (c, op, v) => { calls.nots.push({ table, col: c, op, val: v }); if (c === 'status') b._notTerminal = true; return b; };
      b.update = (fields) => { b._update = fields; return b; };
      const settle = () => {
        if (table === 'coaching_sessions') {
          if (b._update) {
            // A write predicated away from the terminal statuses matches nothing here.
            if (b._notTerminal && ['cancelled', 'abandoned'].includes(session.status)) return { data: [], error: null };
            if (b._statusIn && !b._statusIn.includes(session.status)) return { data: [], error: null };
            if (b._statusPred && b._statusPred !== session.status) return { data: [], error: null };
            calls.updates.push({ table, fields: b._update });
            return { data: [{ id: session.id }], error: null };
          }
          return { data: b._many ? [session] : session, error: null };
        }
        if (table === 'users') {
          const id = b.filters.id || b.filters.phone_number;
          if (id === COACH.id || id === COACH.phone_number) return { data: COACH, error: null };
          return { data: { id: 'teacher-1', preferred_language: 'en', phone_number: '923000000009' }, error: null };
        }
        if (b._update) { calls.updates.push({ table, fields: b._update }); return { data: [{}], error: null }; }
        return { data: b._many ? [] : null, error: null };
      };
      b.single = async () => settle();
      b.maybeSingle = async () => settle();
      b.then = (ok, ko) => Promise.resolve(settle()).then(ok, ko);
      return b;
    },
  };
}

/**
 * Boot the real express app with only the edges mocked, and hand back a driver
 * that POSTs a button_reply webhook and waits for the work the route does
 * AFTER it acks Meta (the route answers first and works second).
 */
async function bootApp(status) {
  jest.resetModules();
  const sent = [];
  const queued = [];
  const targets = [];
  const works = [];
  const store = db(row(status));

  jest.doMock('../../shared/config/supabase', () => store);
  jest.doMock('../../shared/utils/web-drain', () => ({
    trackWebhookWork: (w) => { const p = Promise.resolve(w); works.push(p); return p; },
    installWebDrain: () => {},
    inFlightCount: () => 0,
    waitForIdle: async () => true,
  }));
  jest.doMock('../../shared/services/whatsapp.service', () => ({
    sendMessage: jest.fn(async (to, text) => { sent.push({ kind: 'text', to, text }); return true; }),
    sendInteractiveButtons: jest.fn(async (to, p) => { sent.push({ kind: 'buttons', to, p }); return true; }),
    sendInteractiveMessage: jest.fn(async (to, p) => { sent.push({ kind: 'list', to, p }); return true; }),
    sendFlow: jest.fn(async (to, f) => { sent.push({ kind: 'flow', to, f }); return true; }),
    sendImageFromBuffer: jest.fn(async () => true),
    sendTemplate: jest.fn(async () => true),
    sendReaction: jest.fn(async () => true),
    showTypingIndicator: jest.fn(async () => true),
    startContinuousTypingIndicator: jest.fn(() => ({ stop: jest.fn() })),
    downloadMedia: jest.fn(async () => Buffer.from('x')),
    markAsRead: jest.fn(async () => true),
  }));
  jest.doMock('../../shared/database/bot-helpers', () => ({
    getOrCreateUser: jest.fn(async () => COACH),
    trackChatStart: jest.fn(async () => true),
  }));
  jest.doMock('../../shared/services/session.service', () => ({
    isProcessed: jest.fn(async () => false),
    markAsProcessed: jest.fn(async () => true),
    getReactionEmoji: jest.fn(() => '👍'),
  }));
  jest.doMock('../../shared/services/student-ingress', () => ({
    attach: jest.fn(async () => false),
    route: jest.fn(async () => false),
  }));
  jest.doMock('../../shared/services/conversation-resume.service', () => ({
    handleResumeButton: jest.fn(async () => false),
  }));
  jest.doMock('../../shared/services/coaching/media-target.service', () => ({
    setTarget: jest.fn(async (userId, sessionId, kind) => { targets.push({ userId, sessionId, kind }); return true; }),
    resolveTarget: jest.fn(async () => null),
  }));
  jest.doMock('../../shared/services/coaching/coaching-job-queue.service', () => ({
    queueReport: jest.fn(async (sessionId, meta) => { queued.push({ job: 'report', sessionId, meta }); return true; }),
    queueAnalysis: jest.fn(async (sessionId, meta) => { queued.push({ job: 'analysis', sessionId, meta }); return true; }),
    queueTranscription: jest.fn(async (sessionId, meta) => { queued.push({ job: 'transcription', sessionId, meta }); return true; }),
  }));

  const { app } = require('../../whatsapp-bot');
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;

  return {
    store, sent, queued, targets,
    sessionUpdates: () => store.calls.updates.filter((u) => u.table === 'coaching_sessions'),
    async tap(buttonId) {
      const body = {
        object: 'whatsapp_business_account',
        entry: [{
          id: '1234567890',
          changes: [{
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550000000', phone_number_id: '111111111' },
              messages: [{
                from: FROM,
                id: `wamid.${Math.random().toString(36).slice(2)}`,
                timestamp: String(Math.floor(Date.now() / 1000)),
                type: 'interactive',
                interactive: { type: 'button_reply', button_reply: { id: buttonId, title: 'tap' } },
              }],
            },
          }],
        }],
      };
      const res = await fetch(`http://127.0.0.1:${port}/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(200);
      // The route acks before it works; wait for the work it registered.
      await Promise.allSettled(works);
      await new Promise((r) => setImmediate(r));
      await Promise.allSettled(works);
    },
    async close() { await new Promise((r) => server.close(r)); },
  };
}

describe('bd-n9832 · the photo question\'s "Yes" (photo_yes_) — the tap in the incident', () => {
  test('a cancelled observation is NOT revived, and says so', async () => {
    const app = await bootApp('cancelled');
    try {
      await app.tap(`photo_yes_${SID}`);
      expect(app.sessionUpdates()).toHaveLength(0);
      expect(app.sent.some((s) => s.kind === 'text' && s.text === refusal)).toBe(true);
    } finally { await app.close(); }
  });

  test('an abandoned observation is not revived either', async () => {
    const app = await bootApp('abandoned');
    try {
      await app.tap(`photo_yes_${SID}`);
      expect(app.sessionUpdates()).toHaveLength(0);
    } finally { await app.close(); }
  });

  test('a live observation still advances to the photo step (the fence)', async () => {
    const app = await bootApp('awaiting_photo');
    try {
      await app.tap(`photo_yes_${SID}`);
      const writes = app.sessionUpdates();
      expect(writes).toHaveLength(1);
      expect(writes[0].fields.status).toBe('awaiting_classroom_photo');
      expect(app.sent.some((s) => s.kind === 'text' && s.text === refusal)).toBe(false);
    } finally { await app.close(); }
  });

  // R165 — the behaviour the old source-grep in bd-2kxxa2 was standing in for.
  // The tap NAMES the observation, so the photo that follows must bind here and
  // not to the coach's newest session. Asserted by executing the real service.
  test('a live tap re-points the media target at THIS observation', async () => {
    const app = await bootApp('awaiting_photo');
    try {
      await app.tap(`photo_yes_${SID}`);
      expect(app.targets).toEqual([{ userId: 'coach-1', sessionId: SID, kind: 'photo' }]);
    } finally { await app.close(); }
  });

  test('a cancelled tap records no media target — nothing is re-pointed', async () => {
    const app = await bootApp('cancelled');
    try {
      await app.tap(`photo_yes_${SID}`);
      expect(app.targets).toHaveLength(0);
    } finally { await app.close(); }
  });
});

describe('bd-n9832 · "Get Report Now" (coaching_finish_) — the twin of the guarded Continue', () => {
  test('a cancelled session is not finished, not written and queues no report', async () => {
    const app = await bootApp('cancelled');
    try {
      await app.tap(`coaching_finish_${SID}`);
      expect(app.sessionUpdates()).toHaveLength(0);
      expect(app.queued).toHaveLength(0);
      expect(app.sent.some((s) => s.kind === 'text' && s.text === refusal)).toBe(true);
    } finally { await app.close(); }
  });

  test('a live session still finishes early and queues its report (the fence)', async () => {
    const app = await bootApp('conducting_conversation');
    try {
      await app.tap(`coaching_finish_${SID}`);
      const writes = app.sessionUpdates();
      expect(writes).toHaveLength(1);
      expect(writes[0].fields.status).toBe('generating_report');
      expect(app.queued.map((q) => q.job)).toContain('report');
    } finally { await app.close(); }
  });
});

describe('bd-n9832 · the confirm tap (coaching_confirm_)', () => {
  test('a cancelled session is not re-confirmed and not written', async () => {
    const app = await bootApp('cancelled');
    try {
      await app.tap(`coaching_confirm_${SID}`);
      expect(app.sessionUpdates()).toHaveLength(0);
    } finally { await app.close(); }
  });

  test('a live session still confirms (the fence)', async () => {
    const app = await bootApp('initiated');
    try {
      await app.tap(`coaching_confirm_${SID}`);
      const writes = app.sessionUpdates();
      expect(writes.length).toBeGreaterThanOrEqual(1);
      expect(writes[0].fields.status).toBe('confirmed');
    } finally { await app.close(); }
  });
});
