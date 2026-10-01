'use strict';
/**
 * Meta bill cut FX3 (bd-w2daa.24) item 2 — "typing…" on a turn where the bot sends nothing.
 *
 * The typing fix (bd-0wrn4) defers "typing…" 2 s and cancels it if a reply or the dispatch's end
 * comes first. E2E run 1 found 2 of 46 sandbox turns with lingered=true. Their logs (rumi-sandbox,
 * emitter `time`):
 *
 *  A. 15:53:08.81Z a second "lp" inside the app-redirect quiet hour. The text handler's preamble
 *     (quiz intercepts, user, session, language) ran to 10.55, typing fired at 10.81 (2.0 s), and
 *     only at 11.51 (2.7 s) did redirectIfFlagged decide "quiet hour — no reply". Nothing followed:
 *     a real ~25 s "typing…" over silence. The handler cannot know earlier than its door, so the
 *     quiet hour is remembered instead: once a teacher has had the notice (or been silenced), her
 *     turns hold "typing…" at the deadline until a door decides — silence → never shown; not
 *     redirected → shown at once; nobody decides within the bound → shown, as before.
 *
 *  B. 16:17:50.66Z a photo absorbed into a burst. Typing fired at 52.66 (2.0 s), the upload
 *     finished at 54.11, the burst wait ended at 59.33 with "folded into the burst prompt" — and the
 *     sibling photo's ONE prompt landed at 16:18:00.82, which clears "typing…" in the chat. So the
 *     teacher saw typing → the burst prompt; the scope just could not see a reply sent by another
 *     request. An absorbed photo now settles "nothing more from me — the burst prompt answers":
 *     no typing at all when it knows before its deadline, and not counted as lingering when the
 *     burst prompt covers it.
 *
 * Network faked only: Graph API (fetch + axios), Supabase in memory, Redis in memory.
 */
const http = require('http');
const { createMemorySupabase, createMemoryRedis } = require('../fixtures/memory-supabase');

const later = (ms) => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────────────────────
// A. The app-redirect quiet hour, through the REAL /webhook
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('FX3-2A — a turn silenced by the app-redirect quiet hour never shows "typing…"', () => {
  const DEFER_MS = 150;
  const PHONE = '923001112244';
  const TEACHER = '11111111-1111-4111-8111-111111111122';
  let mockDb;
  let mockRedis;
  let dbLatencyMs;
  let graph;
  let t0;
  let realFetch;
  let seq = 0;

  function slow(builder) {
    return new Proxy(builder, {
      get(target, prop) {
        const v = target[prop];
        if (prop === 'then') return (res, rej) => later(dbLatencyMs).then(() => target.then(res, rej));
        if (typeof v !== 'function') return v;
        return (...args) => {
          const out = v.apply(target, args);
          if (out === target) return slow(target);
          if (out && typeof out.then === 'function' && (prop === 'single' || prop === 'maybeSingle')) {
            return later(dbLatencyMs).then(() => out);
          }
          return out;
        };
      },
    });
  }

  /** The memory DB has no upsert; the notice clock needs one. */
  function withUpsert(table, builder) {
    builder.upsert = (row) => {
      const rows = mockDb.rows(table);
      const hit = rows.find((r) => r.user_id === row.user_id && r.feature === row.feature);
      if (hit) Object.assign(hit, row); else rows.push({ ...row });
      return Promise.resolve({ data: null, error: null });
    };
    return builder;
  }

  function seed({ quietSince = null } = {}) {
    mockDb = createMemorySupabase({
      users: [{
        id: TEACHER, phone_number: PHONE, first_name: 'Ayesha', preferred_language: 'en',
        registration_completed: true, role: 'teacher',
      }],
      app_settings: [{ key: 'app_redirect_lesson_plan', value: true }],
      user_feature_first_use: quietSince
        ? [{ user_id: TEACHER, feature: 'app_redirect_notice', video_shown_at: new Date(quietSince).toISOString(), intro_shown_count: 1 }]
        : [],
    });
  }

  const isTyping = (b) => Boolean(b && b.typing_indicator);
  const isMessage = (b) => Boolean(b && b.to && b.type && b.type !== 'reaction');
  const typings = () => graph.filter((g) => isTyping(g.body));
  const messages = () => graph.filter((g) => isMessage(g.body));
  const text = (body) => ({ id: `wamid.FX3_${++seq}`, type: 'text', text: { body } });

  function webhookBody(message) {
    return {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'waba-1',
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: 'pnid', display_phone_number: '923025502255' },
            contacts: [{ wa_id: PHONE, profile: { name: 'Ayesha' } }],
            messages: [{ from: PHONE, timestamp: String(Math.floor(Date.now() / 1000)), ...message }],
          },
        }],
      }],
    };
  }

  async function post(message, { tailMs = DEFER_MS + 400 } = {}) {
    const { app } = require('../../bot/whatsapp-bot');
    const drain = require('../../bot/shared/utils/web-drain');
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    t0 = Date.now();
    const before = graph.length;
    try {
      const res = await realFetch(`http://127.0.0.1:${server.address().port}/webhook`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(webhookBody(message)),
      });
      expect(res.status).toBe(200);
      await later(20);
      const deadline = Date.now() + 8000;
      while (drain.inFlightCount() !== 0 && Date.now() < deadline) await later(10);
      expect(drain.inFlightCount()).toBe(0);
      await later(tailMs);
    } finally {
      server.close();
    }
    return graph.slice(before);
  }

  /** The inbound_typing.done line for the last turn. */
  function lastTypingReport() {
    const { logToFile } = require('../../bot/shared/utils/logger');
    const calls = logToFile.mock.calls.filter((c) => c[0] === 'inbound_typing.done');
    return calls.length ? calls[calls.length - 1][1] : null;
  }

  beforeEach(() => {
    jest.resetModules();
    process.env.INBOUND_TYPING_DEFER_MS = String(DEFER_MS);
    process.env.INBOUND_TYPING_QUIET_HOLD_MS = '3000';
    dbLatencyMs = 0;
    graph = [];
    mockRedis = createMemoryRedis();
    seed();
    jest.doMock('../../bot/shared/config/supabase', () => ({
      from: (table) => slow(withUpsert(table, mockDb.from(table))),
      rpc: (...a) => mockDb.rpc(...a),
    }));
    jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => mockRedis);
    jest.doMock('../../bot/shared/utils/logger', () => ({
      logToFile: jest.fn(), logError: jest.fn(), logWarn: jest.fn(), logInfo: jest.fn(),
    }));
    realFetch = global.fetch;
    global.fetch = jest.fn(async (url, init) => {
      if (String(url).includes('graph.facebook.com')) {
        let body = null;
        try { body = JSON.parse((init && init.body) || 'null'); } catch (_) { body = null; }
        graph.push({ t: Date.now() - t0, body });
        return {
          ok: true, status: 200,
          json: async () => ({ success: true, messages: [{ id: `wamid.OUT_${graph.length}` }] }),
          text: async () => '',
        };
      }
      return realFetch(url, init);
    });
    const axios = require('axios');
    axios.post.mockImplementation(async (url, body) => {
      if (/\/messages(\?|$)/.test(String(url))) graph.push({ t: Date.now() - t0, body });
      return { status: 200, data: { messages: [{ id: `wamid.OUT_${graph.length}` }] } };
    });
  });

  afterEach(() => {
    global.fetch = realFetch;
    delete process.env.INBOUND_TYPING_DEFER_MS;
    delete process.env.INBOUND_TYPING_QUIET_HOLD_MS;
  });

  test('"lp" → the Play Store notice (unchanged); a second "lp" in the quiet hour, slower than the deferral → no message AND no "typing…"', async () => {
    const first = await post(text('lp'));
    const { resolveUx } = require('../../bot/shared/config/ux-strings');
    const { appStoreUrl } = require('../../bot/shared/config/branding');
    expect(first.filter((g) => isMessage(g.body)).map((g) => g.body.text && g.body.text.body))
      .toEqual([resolveUx('appRedirectNotice', { language: 'en', params: { url: appStoreUrl() } })]);

    dbLatencyMs = 40;   // the handler now reaches its door well after the 150 ms deferral (as on sandbox)
    const second = await post(text('lp'));

    expect(second.filter((g) => isMessage(g.body))).toEqual([]);
    expect(second.filter((g) => isTyping(g.body))).toEqual([]);
    const report = lastTypingReport();
    expect(report).toEqual(expect.objectContaining({ typing: 'skipped', lingered: false, firstReply: 'none' }));
    expect(report.settledAfterMs).toBeGreaterThan(DEFER_MS);   // proves the slow branch ran
  }, 20000);

  test('the quiet hour known only from the DB (e.g. after a deploy), fast door → no "typing…"', async () => {
    seed({ quietSince: Date.now() - 10 * 60 * 1000 });
    const turn = await post(text('lp'));
    expect(turn.filter((g) => isMessage(g.body))).toEqual([]);
    expect(turn.filter((g) => isTyping(g.body))).toEqual([]);
    expect(lastTypingReport()).toEqual(expect.objectContaining({ typing: 'skipped', lingered: false }));
  }, 20000);

  test('the quiet hour known only from the DB, slow door → typing could not be held; the late silence is logged as such', async () => {
    seed({ quietSince: Date.now() - 10 * 60 * 1000 });
    dbLatencyMs = 40;
    const turn = await post(text('lp'));
    expect(turn.filter((g) => isMessage(g.body))).toEqual([]);
    expect(turn.filter((g) => isTyping(g.body)).length).toBeGreaterThan(0);   // residual: nothing to remember yet
    expect(lastTypingReport()).toEqual(expect.objectContaining({
      typing: 'shown', lingered: true, silentAfterTyping: true, silentReason: 'app_redirect_quiet_hour',
    }));
    // …and the NEXT turn in the hour is remembered.
    const next = await post(text('lp'));
    expect(next.filter((g) => isTyping(g.body))).toEqual([]);
  }, 20000);

  test('CONTROL — the notice turn itself is unchanged: notice sent, quiet-hour clock written', async () => {
    const turn = await post(text('lp'));
    expect(turn.filter((g) => isMessage(g.body))).toHaveLength(1);
    expect(mockDb.rows('user_feature_first_use')).toEqual([expect.objectContaining({ user_id: TEACHER, feature: 'app_redirect_notice', intro_shown_count: 1 })]);
  }, 20000);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// B. The inbound-typing module: nothingComing / expectSilence / replyComing
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('FX3-2B — inbound-typing: a turn that knows it will end silent settles "nothing coming"', () => {
  const TO = '923001112255';
  let sender;
  let IT;
  let logger;

  function loadModule() {
    jest.resetModules();
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    logger = require('../../bot/shared/utils/logger');
    IT = require('../../bot/shared/services/inbound-typing');
    sender = { typing: [], showTypingIndicator: jest.fn(async () => { sender.typing.push(Date.now()); }), markAsRead: jest.fn(async () => true) };
  }
  const report = () => {
    const c = logger.logToFile.mock.calls.filter((x) => x[0] === 'inbound_typing.done');
    return c.length ? c[c.length - 1][1] : null;
  };
  /** Run one inbound turn: open the scope, run the handler, end the dispatch. */
  const turn = (handler) => IT.withRequest(async () => {
    IT.open(TO, 'wamid.IN', sender);
    await handler();
    IT.endDispatch();
  });

  beforeEach(() => {
    process.env.INBOUND_TYPING_DEFER_MS = '60';
    process.env.INBOUND_TYPING_QUIET_HOLD_MS = '200';
    loadModule();
  });
  afterEach(() => {
    delete process.env.INBOUND_TYPING_DEFER_MS;
    delete process.env.INBOUND_TYPING_QUIET_HOLD_MS;
  });

  test('nothingComing() before the deadline, then a slow silent handler → no typing, not lingering', async () => {
    await turn(async () => { IT.nothingComing({ reason: 'x' }); await later(120); });
    await later(40);
    expect(sender.typing).toEqual([]);
    expect(report()).toEqual(expect.objectContaining({ typing: 'skipped', answeredBy: 'nothing', lingered: false, silentReason: 'x' }));
  });

  test('nothingComing({ answeredElsewhere }) after typing showed → not counted as lingering', async () => {
    await turn(async () => { await later(100); IT.nothingComing({ reason: 'photo_burst_absorbed', answeredElsewhere: true }); });
    expect(sender.typing).toHaveLength(1);
    expect(report()).toEqual(expect.objectContaining({ typing: 'shown', lingered: false, answeredElsewhere: true }));
  });

  test('nothingComing() after typing showed, no one else answering → honest: lingered + silentAfterTyping', async () => {
    await turn(async () => { await later(100); IT.nothingComing({ reason: 'late' }); });
    expect(report()).toEqual(expect.objectContaining({ typing: 'shown', lingered: true, silentAfterTyping: true }));
  });

  test('expectSilence(): at the deadline typing is HELD; a door that then decides silence → never shown', async () => {
    IT.expectSilence(TO, Date.now() + 60000);
    await turn(async () => { await later(120); IT.nothingComing({ reason: 'app_redirect_quiet_hour' }); });
    await later(250);
    expect(sender.typing).toEqual([]);
  });

  test('expectSilence(): a door that is NOT redirected → replyComing() shows typing at once', async () => {
    IT.expectSilence(TO, Date.now() + 60000);
    let shownAt = null;
    const start = Date.now();
    await turn(async () => {
      await later(120);
      IT.replyComing();
      shownAt = sender.typing[0] ? sender.typing[0] - start : null;
      await later(30);
    });
    expect(sender.typing).toHaveLength(1);
    expect(shownAt).toBeGreaterThanOrEqual(110);
    expect(shownAt).toBeLessThan(180);
  });

  test('expectSilence(): nobody decides → typing shown after the bound (never held forever)', async () => {
    IT.expectSilence(TO, Date.now() + 60000);
    const start = Date.now();
    await turn(async () => { await later(400); });
    expect(sender.typing).toHaveLength(1);
    expect(sender.typing[0] - start).toBeGreaterThanOrEqual(60 + 200 - 15);
  });

  test('expectSilence(): a handler that just replies → its message, no typing first (held, then settled)', async () => {
    IT.expectSilence(TO, Date.now() + 60000);
    await turn(async () => { await later(120); IT.noteOutbound({ to: TO, type: 'text' }); });
    expect(sender.typing).toEqual([]);
    expect(report()).toEqual(expect.objectContaining({ firstReply: 'message', lingered: false }));
  });

  test('an expired quiet hour → normal deferred typing', async () => {
    IT.expectSilence(TO, Date.now() - 1);
    await turn(async () => { await later(120); });
    expect(sender.typing).toHaveLength(1);
  });

  test('another person\'s quiet hour does not hold this one\'s typing', async () => {
    IT.expectSilence('923009999999', Date.now() + 60000);
    await turn(async () => { await later(120); });
    expect(sender.typing).toHaveLength(1);
  });

  test('outside a webhook request (worker / portal) the new calls are no-ops and never throw', () => {
    expect(() => IT.nothingComing({ reason: 'x' })).not.toThrow();
    expect(() => IT.replyComing()).not.toThrow();
    expect(() => IT.expectSilence(null, NaN)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// C. A photo absorbed into a burst, through the capture service with the real typing module
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('FX3-2C — a photo absorbed into a burst', () => {
  const SID = '22222222-2222-4333-8444-555555555555';
  const FROM = '923001112266';
  const USER = { id: 'teacher-2', preferred_language: 'en' };
  let sessionRow;
  let store;
  let sends;
  let logger;
  let uploadMs = 0;

  function load() {
    jest.resetModules();
    store = new Map();
    sends = [];
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../bot/shared/services/cache/railway-redis.service', () => ({
      isAvailable: () => true,
      set: jest.fn(async (k, v) => { store.set(k, v); return true; }),
      get: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
      setNX: jest.fn(async (k, v) => { if (store.has(k)) return false; store.set(k, v); return true; }),
      acquireLock: jest.fn(async (r, id) => { const k = `lock:${r}`; if (store.has(k)) return false; store.set(k, id); return true; }),
      releaseLock: jest.fn(async (r, id) => { const k = `lock:${r}`; if (store.get(k) === id) store.delete(k); return true; }),
    }));
    jest.doMock('../../bot/shared/config/supabase', () => ({
      from: () => {
        const b = {};
        let patch = null;
        ['select', 'eq', 'order', 'limit', 'in'].forEach((m) => { b[m] = () => b; });
        b.update = (p) => { patch = p; return b; };
        b.maybeSingle = async () => ({ data: JSON.parse(JSON.stringify(sessionRow)), error: null });
        b.single = b.maybeSingle;
        b.then = (ok, ko) => { if (patch) sessionRow = { ...sessionRow, ...patch }; return Promise.resolve({ data: null, error: null }).then(ok, ko); };
        return b;
      },
    }));
    jest.doMock('../../bot/shared/storage/r2', () => ({ uploadImageWithRetry: jest.fn(async (_b, _u, n) => { await later(uploadMs); return `r2://${n}-${Math.random()}`; }) }));
    jest.doMock('../../bot/shared/utils/language-cache', () => ({ getUserLanguage: jest.fn(async () => 'en') }));
    const IT = require('../../bot/shared/services/inbound-typing');
    // The WhatsApp boundary: the send reports itself to the typing scope, as the real transport does.
    jest.doMock('../../bot/shared/services/whatsapp.service', () => ({
      sendInteractiveButtons: jest.fn(async (to, p) => { IT.noteOutbound({ to, type: 'interactive' }); sends.push(p.body); return true; }),
      sendInteractiveMessage: jest.fn(async (to, p) => { IT.noteOutbound({ to, type: 'interactive' }); sends.push(p.body && p.body.text); return true; }),
      sendMessage: jest.fn(async (to, t) => { IT.noteOutbound({ to, type: 'text' }); sends.push(t); return true; }),
    }));
    logger = require('../../bot/shared/utils/logger');
    return { IT, capture: require('../../bot/shared/services/coaching/classroom-photo/capture.service') };
  }
  const onStep = () => ({
    id: SID, user_id: USER.id, status: 'awaiting_classroom_photo',
    conversation_state: { current_state: 'AWAITING_CLASSROOM_PHOTO', classroom_photos: [] }, classroom_photos: [],
  });
  const reports = () => logger.logToFile.mock.calls.filter((c) => c[0] === 'inbound_typing.done').map((c) => c[1]);

  function photoTurn(m, sender, wamid) {
    return m.IT.withRequest(async () => {
      m.IT.open(FROM, wamid, sender);
      await m.capture.capturePhotoAndPrompt({ session: onStep(), imageBuffer: Buffer.from('x'), mimeType: 'image/jpeg', from: FROM, user: USER });
      m.IT.endDispatch();
    });
  }

  afterEach(() => {
    delete process.env.INBOUND_TYPING_DEFER_MS;
    delete process.env.COACHING_PHOTO_PROMPT_DEBOUNCE_MS;
    delete process.env.COACHING_PHOTO_BURST_EARLY_CHECK_MS;
  });

  test('typing already up when the photo learns it was absorbed → the burst prompt answers it: not lingering', async () => {
    process.env.INBOUND_TYPING_DEFER_MS = '30';
    process.env.COACHING_PHOTO_PROMPT_DEBOUNCE_MS = '150';
    uploadMs = 60;   // live: the upload finished 3.4 s in, after the 2 s deadline
    const m = load();
    sessionRow = onStep();
    const sender = { showTypingIndicator: jest.fn(async () => true), markAsRead: jest.fn(async () => true) };
    const a = photoTurn(m, sender, 'wamid.A');
    await later(10);
    const b = photoTurn(m, sender, 'wamid.B');
    await Promise.all([a, b]);

    expect(sends).toEqual([expect.stringContaining('2')]);   // ONE burst prompt
    const rs = reports();
    expect(rs).toHaveLength(2);
    expect(rs.every((r) => r.lingered === false)).toBe(true);
    expect(rs.filter((r) => r.answeredElsewhere === true)).toHaveLength(1);
    expect(sender.showTypingIndicator).toHaveBeenCalledTimes(2);   // both were up before the wait
    uploadMs = 0;
  });

  test('absorbed before its deadline → that photo never shows "typing…"; the last photo still does', async () => {
    process.env.INBOUND_TYPING_DEFER_MS = '120';
    process.env.COACHING_PHOTO_PROMPT_DEBOUNCE_MS = '400';
    process.env.COACHING_PHOTO_BURST_EARLY_CHECK_MS = '50';   // live: 1 s into the 5 s burst wait
    const m = load();
    sessionRow = onStep();
    const typingFor = [];
    const sender = { showTypingIndicator: jest.fn(async (_to, id) => { typingFor.push(id); }), markAsRead: jest.fn(async () => true) };
    const a = photoTurn(m, sender, 'wamid.A');
    await later(10);
    const b = photoTurn(m, sender, 'wamid.B');
    await Promise.all([a, b]);

    expect(sends).toHaveLength(1);
    expect(typingFor).toEqual(['wamid.B']);
  });

  test('the session left the photo step during the wait (Done tapped) → the last photo settles silent too', async () => {
    process.env.INBOUND_TYPING_DEFER_MS = '200';
    process.env.COACHING_PHOTO_PROMPT_DEBOUNCE_MS = '100';
    process.env.COACHING_PHOTO_BURST_EARLY_CHECK_MS = '30';
    const m = load();
    sessionRow = onStep();
    const sender = { showTypingIndicator: jest.fn(async () => true), markAsRead: jest.fn(async () => true) };
    const a = photoTurn(m, sender, 'wamid.A');
    await later(50);
    sessionRow = { ...sessionRow, status: 'awaiting_lesson_plan', conversation_state: { current_state: 'AWAITING_LESSON_PLAN' } };
    await a;
    await later(250);
    expect(sends).toEqual([]);
    expect(sender.showTypingIndicator).not.toHaveBeenCalled();
    expect(reports()[0]).toEqual(expect.objectContaining({ typing: 'skipped', lingered: false, silentReason: 'photo_step_left' }));
  });
});
