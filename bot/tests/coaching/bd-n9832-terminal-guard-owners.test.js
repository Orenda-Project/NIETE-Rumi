/**
 * bd-n9832 — the two shared owners that hold "this session is over", and the
 * ONE shared status writer that every coaching job moves a session through.
 *
 * #1008 gave the observe analysis-arming write a terminal predicate but left
 * `CoachingSessionService.updateStatus` unguarded — and that is the funnel the
 * transcription ('transcribing', 'awaiting_photo'), analysis ('analyzing'),
 * reflective ('conducting_conversation', 'generating_report') and report
 * ('analysis_started') jobs all write through. Each of those jobs is queued
 * before a cancel can land and completes after it, so an unpredicated write
 * there reopened a cancelled session from a worker.
 *
 * These cases execute the real owners against a recording database double.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';

const { resolveUx } = require('../../shared/config/ux-strings');

const SID = 'sess-n9832-owners';
const FROM = '923000000001';
const refusal = resolveUx('coachingSessionCancelled', { language: 'en' });

function row(status) {
  return {
    id: SID,
    status,
    user_id: 'teacher-1',
    conversation_state: { current_state: 'AWAITING_PHOTO' },
    users: { phone_number: '923000000009', name: null, preferred_language: 'en' },
  };
}

/** Records every update and whether it carried the terminal predicate. */
function db(session, { updateError = null } = {}) {
  const calls = { updates: [] };
  return {
    calls,
    from(table) {
      const b = { filters: {}, _update: null, _notTerminal: false };
      ['select', 'order', 'limit', 'in', 'or', 'is', 'gte', 'lte', 'range', 'neq'].forEach((m) => {
        b[m] = () => b;
      });
      b.eq = (c, v) => { b.filters[c] = v; return b; };
      b.not = (c, op, v) => { if (c === 'status') b._notTerminal = true; return b; };
      b.update = (fields) => { b._update = fields; return b; };
      const settle = () => {
        if (b._update) {
          if (updateError) return { data: null, error: { message: updateError } };
          const terminal = ['cancelled', 'abandoned'].includes(session.status);
          if (b._notTerminal && terminal) return { data: [], error: null };
          calls.updates.push({ table, fields: b._update, predicated: b._notTerminal });
          return { data: [{ id: SID }], error: null };
        }
        if (table === 'users') return { data: { preferred_language: 'en' }, error: null };
        return { data: session, error: null };
      };
      b.single = async () => settle();
      b.maybeSingle = async () => settle();
      b.then = (ok, ko) => Promise.resolve(settle()).then(ok, ko);
      return b;
    },
  };
}

function load(session, opts) {
  jest.resetModules();
  const sent = [];
  const store = db(session, opts);
  jest.doMock('../../shared/config/supabase', () => store);
  jest.doMock('../../shared/services/whatsapp.service', () => ({
    sendMessage: jest.fn(async (to, text) => { sent.push({ to, text }); return true; }),
  }));
  return {
    store, sent,
    terminal: require('../../shared/services/coaching/session-terminal'),
    CoachingSessionService: require('../../shared/services/coaching/coaching-session.service'),
  };
}

describe('refuseTapIfTerminal — one owner for a tap that arrives after the end', () => {
  test('a cancelled session is refused, in the tapper\'s language, with no write', async () => {
    const { terminal, store, sent } = load(row('cancelled'));
    const refused = await terminal.refuseTapIfTerminal({ sessionId: SID, from: FROM, language: 'en', tap: 'photo step' });
    expect(refused).toBe(true);
    expect(store.calls.updates).toHaveLength(0);
    expect(sent[0].text).toBe(refusal);
  });

  test('an abandoned session is refused too', async () => {
    const { terminal } = load(row('abandoned'));
    expect(await terminal.refuseTapIfTerminal({ sessionId: SID, from: FROM, tap: 'Finish' })).toBe(true);
  });

  test('a live session is NOT refused and is not messaged (the fence)', async () => {
    const { terminal, sent } = load(row('awaiting_photo'));
    expect(await terminal.refuseTapIfTerminal({ sessionId: SID, from: FROM, tap: 'photo step' })).toBe(false);
    expect(sent).toHaveLength(0);
  });
});

describe('updateIfNotTerminal — the write and its predicate cannot drift apart', () => {
  test('a cancelled session is not written, and the predicate was actually sent', async () => {
    const { terminal, store } = load(row('cancelled'));
    const res = await terminal.updateIfNotTerminal(SID, { status: 'awaiting_classroom_photo' });
    expect(res.applied).toBe(false);
    expect(store.calls.updates).toHaveLength(0);
  });

  test('a live session is written, carrying the predicate', async () => {
    const { terminal, store } = load(row('awaiting_photo'));
    const res = await terminal.updateIfNotTerminal(SID, { status: 'awaiting_classroom_photo' });
    expect(res.applied).toBe(true);
    expect(store.calls.updates[0].predicated).toBe(true);
  });

  test('an ambiguous write result counts as applied, never as a refusal (#1008 rule)', async () => {
    const { terminal } = load(row('awaiting_photo'), { updateError: 'connection reset' });
    const res = await terminal.updateIfNotTerminal(SID, { status: 'analyzing' });
    expect(res.applied).toBe(true);
    expect(res.ambiguous).toBe(true);
  });
});

describe('CoachingSessionService.updateStatus — the funnel every coaching job writes through', () => {
  test.each(['transcribing', 'analyzing', 'conducting_conversation', 'generating_report', 'analysis_started'])(
    'a cancelled session is not reopened at %s by a job that finished late',
    async (status) => {
      const { CoachingSessionService, store } = load(row('cancelled'));
      const out = await CoachingSessionService.updateStatus(SID, status);
      expect(out).toBeNull();
      expect(store.calls.updates).toHaveLength(0);
    },
  );

  test('a live session still moves forward (the fence)', async () => {
    const { CoachingSessionService, store } = load(row('confirmed'));
    await CoachingSessionService.updateStatus(SID, 'transcribing', { transcription_started_at: 'now' });
    expect(store.calls.updates).toHaveLength(1);
    expect(store.calls.updates[0].fields.status).toBe('transcribing');
    expect(store.calls.updates[0].fields.transcription_started_at).toBe('now');
  });

  test('a job may still record a terminal outcome on a cancelled session (deliberate exemption)', async () => {
    const { CoachingSessionService, store } = load(row('cancelled'));
    await CoachingSessionService.updateStatus(SID, 'abandoned');
    expect(store.calls.updates).toHaveLength(1);
    expect(store.calls.updates[0].fields.status).toBe('abandoned');
  });
});
