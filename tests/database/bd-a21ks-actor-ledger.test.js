'use strict';
/**
 * bd-a21ks — the ledger names a REAL actor.
 *
 * Measured on NIETE prod 2026-09-15 (read-only): record_history had 189,013 rows,
 * actor NULL on 0 of them — and a uuid on 0 of them. 188,963 said actor
 * 'authenticator' with actor_source 'postgrest': the bot's service-role JWT has
 * role=service_role and no `sub`, so the trigger fell through to session_user
 * while still labelling the row as if PostgREST had identified a person. The
 * column was 100% populated and 0% identifying.
 *
 * The fix has two halves and this file pins both:
 *   1. The bot puts the acting user on every request it makes on that user's
 *      behalf — an AsyncLocalStorage context set at the Flow endpoint, read by
 *      the Supabase client's fetch, sent as the `x-rumi-actor` header. PostgREST
 *      forwards request headers into the transaction (verified on the sandbox
 *      project), so the trigger can read it for a direct .insert/.update AND for
 *      an RPC, on the transaction pooler, with no signature changes anywhere.
 *   2. The trigger reads it (only when the JWT role is service_role — a key that
 *      can already do anything, so the header is attribution, not authority), and
 *      the RPCs additionally set app.actor from the uuid they were handed, so a
 *      caller that bypasses the bot still lands a person.
 *
 * Only the network boundary is mocked. The real config, context, endpoint and
 * handler code run.
 */
const path = require('path');
const fs = require('fs');

const {
  WATCHED, KEY_COLUMN, attributeActor,
} = require('../../scripts/row-history-audit');

const COACH = 'a1b2c3d4-0000-4000-8000-00000000c0ac';
const eq = (a, b) => expect(a).toEqual(b);

// ── 1. the allowlist mirror: classes is audited, identity columns included ──

describe('classes joins the audited set', () => {
  it('watches the identity columns the section-edit bead will mutate', () => {
    expect(KEY_COLUMN.classes).toBe('id');
    for (const col of ['school_id', 'grade_code', 'section', 'shift_code', 'session_code', 'is_active']) {
      expect(WATCHED.classes).toContain(col);
    }
  });

  it('a class rename records grade/section from -> to', () => {
    const { diffWatched } = require('../../scripts/row-history-audit');
    const d = diffWatched('classes',
      { id: 'c1', grade_code: 'grade_3', section: 'A', shift_code: 'morning', is_active: true },
      { id: 'c1', grade_code: 'grade_3', section: 'B', shift_code: 'morning', is_active: true });
    eq(d.changed_cols, ['section']);
    eq(d.old_vals.section, 'A');
    eq(d.new_vals.section, 'B');
  });

  it('a class_teachers row says WHICH teacher and WHICH class, not just a flag', () => {
    // Without these an INSERT only records {is_active, is_class_teacher} and the
    // hand-over cannot be read back from the ledger alone.
    expect(WATCHED.class_teachers).toContain('teacher_user_id');
    expect(WATCHED.class_teachers).toContain('class_id');
  });

  it('a merge records what the child merged into', () => {
    expect(WATCHED.students).toContain('merged_into');
  });
});

// ── 2. actor attribution reads the header, gated on the service-role key ───

describe('attributeActor with the x-rumi-actor header', () => {
  it('a service-role request carrying the header is attributed to that user', () => {
    eq(attributeActor({
      jwtClaims: '{"role":"service_role"}', headerActor: COACH, sessionUser: 'authenticator',
    }), { actor: COACH, actor_source: 'service_role' });
  });

  it('a real jwt subject still wins over the header', () => {
    eq(attributeActor({
      jwtClaims: '{"role":"authenticated","sub":"user-123"}', headerActor: COACH, sessionUser: 'authenticator',
    }), { actor: 'user-123', actor_source: 'postgrest' });
  });

  it('an explicitly set app.actor wins over the header (the RPC belt-and-braces)', () => {
    eq(attributeActor({
      jwtClaims: '{"role":"service_role"}', appActor: 'worker:sqs', headerActor: COACH, sessionUser: 'authenticator',
    }), { actor: 'worker:sqs', actor_source: 'service_role' });
  });

  it('the header is ignored unless the key is service_role', () => {
    eq(attributeActor({
      jwtClaims: '{"role":"anon"}', headerActor: COACH, sessionUser: 'authenticator',
    }), { actor: 'authenticator', actor_source: 'postgrest' });
  });

  it('a non-uuid header value is ignored — the header carries a users.id or nothing', () => {
    eq(attributeActor({
      jwtClaims: '{"role":"service_role"}', headerActor: 'robert; drop table', sessionUser: 'authenticator',
    }), { actor: 'authenticator', actor_source: 'postgrest' });
  });
});

// ── 3. the context + the client's fetch ────────────────────────────────────

describe('actor context', () => {
  const ctx = () => require('../../bot/shared/utils/actor-context');

  it('runAsActor makes the actor visible across awaits, and only inside', async () => {
    const { runAsActor, currentActor } = ctx();
    expect(currentActor()).toBeNull();
    const seen = await runAsActor(COACH, async () => {
      await new Promise((r) => setTimeout(r, 1));
      return currentActor();
    });
    expect(seen).toBe(COACH);
    expect(currentActor()).toBeNull();
  });

  it('a LAZY thenable returned unawaited still resolves inside the context', async () => {
    // A PostgREST builder only fires its fetch when .then() is called. If the
    // callback returns the builder without awaiting it, the caller's await must
    // not fire the request outside the store. Measured on the sandbox before this
    // was fixed: header absent on the wire, ledger said 'authenticator'.
    const { runAsActor, currentActor } = ctx();
    const lazy = { then(resolve) { resolve(currentActor()); } };
    const seen = await runAsActor(COACH, () => lazy);
    expect(seen).toBe(COACH);
  });

  it('a non-uuid actor id sets no context (a phone number is not an actor)', async () => {
    const { runAsActor, currentActor } = ctx();
    const seen = await runAsActor('923001234567', async () => currentActor());
    expect(seen).toBeNull();
  });

  it('actorFetch adds x-rumi-actor inside the context and nothing outside it', async () => {
    const { runAsActor, actorFetch, ACTOR_HEADER } = ctx();
    const calls = [];
    const base = jest.fn(async (url, init) => { calls.push({ url, init }); return { ok: true }; });
    await actorFetch('https://x.test/rest/v1/classes', { method: 'POST', headers: { apikey: 'k' } }, base);
    expect(new Headers(calls[0].init.headers).get(ACTOR_HEADER)).toBeNull();
    expect(new Headers(calls[0].init.headers).get('apikey')).toBe('k');

    await runAsActor(COACH, () => actorFetch('https://x.test/rest/v1/rpc/roster_apply_edits',
      { method: 'POST', headers: { apikey: 'k' } }, base));
    expect(new Headers(calls[1].init.headers).get(ACTOR_HEADER)).toBe(COACH);
    expect(new Headers(calls[1].init.headers).get('apikey')).toBe('k');
  });
});

describe('the Supabase client sends the actor', () => {
  it('config/supabase.js hands actorFetch to createClient, and it carries the header', async () => {
    jest.resetModules();
    let captured = null;
    jest.doMock('@supabase/supabase-js', () => ({
      createClient: jest.fn((url, key, opts) => { captured = opts; return { from: jest.fn(), rpc: jest.fn() }; }),
    }));
    process.env.SUPABASE_URL = 'https://olvritwoqujtjvwfulbh.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
    require('../../bot/shared/config/supabase');
    expect(captured && captured.global && typeof captured.global.fetch).toBe('function');

    const { runAsActor, ACTOR_HEADER } = require('../../bot/shared/utils/actor-context');
    const realFetch = global.fetch;
    const seen = [];
    global.fetch = jest.fn(async (url, init) => { seen.push(init); return { ok: true }; });
    try {
      await runAsActor(COACH, () => captured.global.fetch('https://x.test/rest/v1/classes', { headers: { apikey: 'k' } }));
    } finally {
      global.fetch = realFetch;
    }
    expect(new Headers(seen[0].headers).get(ACTOR_HEADER)).toBe(COACH);
    jest.dontMock('@supabase/supabase-js');
  });
});

// ── 4. the entry points run their writes inside the context ────────────────

describe('/roster runs under the coach as actor', () => {
  let mockApply; let actorAtCall;
  beforeEach(() => {
    jest.resetModules();
    actorAtCall = 'unset';
    jest.doMock('../../bot/shared/services/classes/class.service', () => ({
      applyRosterEdits: (...a) => mockApply(...a),
    }));
    jest.doMock('../../bot/shared/services/roster/roster-storage', () => ({
      newRunId: () => 'edit-run-fixed', putPage: jest.fn(async () => ({})), putManifest: jest.fn(async () => ({})),
    }));
    jest.doMock('../../bot/shared/services/roster/roster-extraction.service', () => ({
      extractPages: jest.fn(async () => ({ students: [], problems: [] })),
    }));
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../bot/shared/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));
  });

  it('saveRosterEdits reached through handleRosterDataExchange sees the coach', async () => {
    const { currentActor } = require('../../bot/shared/utils/actor-context');
    mockApply = jest.fn(async () => { actorAtCall = currentActor(); return { updated: 1, moved: 0, added: 0, removed: 0 }; });
    const endpoint = require('../../bot/shared/routes/roster-flow-endpoint');
    const { toChunks } = require('../../bot/shared/services/roster/roster-lines');
    const roster = [
      { id: 's1', roll_number: 1, student_name: 'Ayesha Noor', father_name: 'Iqbal' },
      { id: 's2', roll_number: 2, student_name: 'Bilal Ahmed', father_name: 'Javed' },
    ];
    endpoint._pending.set(COACH, {
      user: { id: COACH }, schoolId: 'school-1', schoolName: 'GPS Test', editRunId: 'edit-run-1',
      viewClass: { id: 'class-1', label: 'Grade 3 A' }, viewRoster: roster, schools: [],
    });
    const lines = toChunks(roster).chunks.filter(Boolean).join('\n').split('\n');
    lines[0] = lines[0].replace('Ayesha Noor', 'Ayesha Bibi');
    const screenData = { chunk1: lines.join('\n'), chunk2: '', chunk3: '', chunk4: '', chunk5: '', chunk6: '' };

    const res = await endpoint.handleRosterDataExchange(COACH, 'ROSTER_EDIT', screenData);
    expect(res.screen).toBe('SAVED');
    expect(mockApply).toHaveBeenCalledTimes(1);
    expect(actorAtCall).toBe(COACH);
  });
});

describe('/observe-visit runs under the coach as actor', () => {
  it('handle() wraps the whole request in the actor context', async () => {
    jest.resetModules();
    jest.doMock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
    jest.doMock('../../bot/shared/config/supabase', () => ({ from: jest.fn(), rpc: jest.fn() }));
    let actorAtCall = 'unset';
    jest.doMock('../../bot/shared/services/observe/observe-state.service', () => ({
      getState: jest.fn(async () => {
        actorAtCall = require('../../bot/shared/utils/actor-context').currentActor();
        return null;
      }),
      setState: jest.fn(async () => {}),
    }));
    const handler = require('../../bot/shared/handlers/observe-visit-flow.handler');
    // BACK from BRIEF_SCHEDULE reads the remembered pick first (v1 and v2 alike),
    // so the state read is the first thing the handler awaits.
    await handler.handle(COACH, 'BACK', 'BRIEF_SCHEDULE', {}, COACH).catch(() => {});
    expect(actorAtCall).toBe(COACH);
  });
});

// ── 5. the migration exists and says what it must ──────────────────────────

describe('the migration', () => {
  const dir = path.join(__dirname, '..', '..', 'bot', 'database', 'migrations');
  const sql = (f) => fs.readFileSync(path.join(dir, f), 'utf8');

  it('row_history_actor.sql attaches the classes trigger and reads the header', () => {
    const s = sql('row_history_actor.sql');
    expect(s).toMatch(/CREATE TRIGGER classes_history_trigger/);
    expect(s).toMatch(/log_row_changes\('id'[^)]*'grade_code'[^)]*'section'[^)]*'shift_code'/s);
    expect(s).toMatch(/request\.headers/);
    expect(s).toMatch(/x-rumi-actor/);
    expect(s).toMatch(/service_role/);
  });

  it('roster_rpc_actor.sql sets app.actor inside both RPCs from the uuid they are handed', () => {
    const s = sql('roster_rpc_actor.sql');
    expect(s).toMatch(/set_config\('app\.actor', p_edited_by::text, true\)/);
    expect(s).toMatch(/set_config\('app\.actor', p_enrolled_by::text, true\)/);
  });

  it('both carry a DOWN', () => {
    expect(fs.existsSync(path.join(dir, 'row_history_actor_rollback.sql'))).toBe(true);
    expect(sql('roster_rpc_actor.sql')).toMatch(/DOWN/);
  });
});
