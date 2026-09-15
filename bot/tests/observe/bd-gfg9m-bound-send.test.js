/**
 * The send flow already knows who the report is for.
 *
 * `startSendFlow` loads the session with select('*') — `user_id` is right there
 * — and then never reads it. It offers the coach her ROSTER instead: her own
 * past-delivery memory, capped at 25 and lazily backfilled from her last 50
 * sends. That list has nothing to do with the observation being sent.
 *
 * Measured on prod, report sends since 7 Sep 2026: 665 sends, 665 of 665 on a
 * session bound to a teacher, and 665 of 665 already carrying that teacher's
 * phone number on her users row. 605 (91%) went to exactly the number we
 * already held — the coach re-supplied what the system had. 60 (9%) went to a
 * different number; 47 of those belong to another registered teacher and 13 to
 * no user row at all, and only 1 of the 60 is within two digits of the right
 * number, so these are wrong entries rather than typos. In 54 of the 60 the
 * correct number was not even in the roster she was shown.
 *
 * The other half of the same confusion: every coach-facing acknowledgement was
 * addressed to the TEACHER, because `_loadSession` joins users off `user_id`.
 * ~277 tap confirmations plus 238 nudge/give-up messages, and the report's
 * "From {coach}" line named the teacher to herself.
 *
 * The escape hatch stays: a third button on the confirm, so the 9% becomes a
 * deliberate act instead of the default.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const USERS = {
  'u-teacher': { id: 'u-teacher', name: 'Najma Kousar', phone_number: '923150583765' },
  'u-coach': { id: 'u-coach', name: 'Misbah Iqbal', phone_number: '923260000001' },
};

const DB = { session: null, updates: [] };

jest.mock('../../shared/config/supabase', () => ({
  from: (table) => {
    const st = { table, op: null, payload: null, filters: [] };
    const settle = () => {
      if (st.op === 'update') { DB.updates.push(st.payload); return Promise.resolve({ data: [DB.session], error: null }); }
      if (st.table === 'users') {
        const [, col, val] = st.filters[0] || [];
        return Promise.resolve({ data: Object.values(USERS).find((u) => u[col] === val) || null, error: null });
      }
      // coaching_sessions: the one row under test, users() join included so the
      // OLD behaviour is reproducible.
      const row = DB.session && { ...DB.session, users: USERS[DB.session.user_id] || null };
      return Promise.resolve({ data: row, error: null });
    };
    const api = {
      select: () => api,
      update: (p) => { st.op = 'update'; st.payload = p; return api; },
      eq: (c, v) => { st.filters.push(['eq', c, v]); return api; },
      in: () => api,
      not: () => api,
      order: () => api,
      limit: () => api,
      range: () => settle(),
      maybeSingle: settle,
      single: settle,
      then: (ok, bad) => settle().then(ok, bad),
    };
    return api;
  },
}));

jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn(async () => true),
  sendInteractiveMessage: jest.fn(async () => true),
  sendInteractiveButtons: jest.fn(async () => true),
  sendImage: jest.fn(async () => true),
  sendDocument: jest.fn(async () => true),
  sendTemplate: jest.fn(async () => true),
}));
jest.mock('../../shared/services/observe/observe-state.service', () => ({
  getState: jest.fn(async () => null),
  setState: jest.fn(async () => true),
  clearState: jest.fn(async () => true),
}));
jest.mock('../../shared/services/observe/observe-roster', () => ({
  // A roster the coach HAS — so the old behaviour (offer the list) is the
  // one under test, not an empty-roster shortcut.
  getRoster: jest.fn(async () => ([
    { name: 'Somebody Else', phone: '923009999999' },
  ])),
  upsertTeacher: jest.fn(async () => true),
}));
jest.mock('../../shared/services/coaching/coaching-job-queue.service', () => ({
  queueObserveTeacherReport: jest.fn(async () => true),
  queueTranscription: jest.fn(async () => true),
}));

const WA = require('../../shared/services/whatsapp.service');
const ObserveState = require('../../shared/services/observe/observe-state.service');
const Roster = require('../../shared/services/observe/observe-roster');
const Queue = require('../../shared/services/coaching/coaching-job-queue.service');
const Send = require('../../shared/services/observe/observe-send.service');
const { observeStrings } = require('../../shared/services/observe/observe-strings');

const COACH = { id: 'u-coach', role: 'coach', preferred_language: 'en' };
const COACH_PHONE = '923260000001';

const boundSession = (over = {}) => ({
  id: 'sess-1',
  user_id: 'u-teacher',
  observer_user_id: 'u-coach',
  observation_type: 'leader_observation',
  status: 'observer_review_complete',
  analysis_data: { framework: 'fico' },
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  DB.session = boundSession();
  DB.updates = [];
});

describe('a bound session goes straight to preview and confirm', () => {
  it('RED: the coach is never asked to pick or type the teacher', async () => {
    await Send.startSendFlow('sess-1', COACH_PHONE, COACH);
    const states = ObserveState.setState.mock.calls.map((c) => c[1]);
    expect(states).not.toContain('awaiting_teacher_pick');
    expect(states).not.toContain('awaiting_teacher_details');
    expect(states).toContain('awaiting_send_confirm');
  });

  it('RED: the recipient comes off the row, not out of the roster', async () => {
    await Send.startSendFlow('sess-1', COACH_PHONE, COACH);
    const merged = DB.updates.map((u) => JSON.stringify(u)).join(' ');
    expect(merged).toContain('923150583765');
    expect(merged).toContain('Najma Kousar');
    expect(merged).not.toContain('923009999999');
  });

  it('RED: the preview job is queued for this session', async () => {
    await Send.startSendFlow('sess-1', COACH_PHONE, COACH);
    expect(Queue.queueObserveTeacherReport).toHaveBeenCalledWith(
      'sess-1', expect.objectContaining({ phase: 'preview' }));
  });

  it('RED: the roster learns the correct pair instead of whatever was typed', async () => {
    await Send.startSendFlow('sess-1', COACH_PHONE, COACH);
    expect(Roster.upsertTeacher).toHaveBeenCalledWith(
      COACH, expect.objectContaining({ phone: '923150583765' }));
  });

  it('an UNBOUND capture still gets the roster pick — the escape path is untouched', async () => {
    DB.session = boundSession({ user_id: 'u-coach' });
    await Send.startSendFlow('sess-1', COACH_PHONE, COACH);
    const states = ObserveState.setState.mock.calls.map((c) => c[1]);
    expect(states).toContain('awaiting_teacher_pick');
    expect(Queue.queueObserveTeacherReport).not.toHaveBeenCalled();
  });

  it('a bound session with no phone on file falls back to the pick rather than dead-ending', async () => {
    DB.session = boundSession({ user_id: 'u-unknown' });
    await Send.startSendFlow('sess-1', COACH_PHONE, COACH);
    const states = ObserveState.setState.mock.calls.map((c) => c[1]);
    expect(states).toContain('awaiting_teacher_pick');
  });

  it('an already-sent report is still refused before anything is resolved', async () => {
    DB.session = boundSession({ analysis_data: { teacher_delivery: { status: 'sent' } } });
    await Send.startSendFlow('sess-1', COACH_PHONE, COACH);
    expect(Queue.queueObserveTeacherReport).not.toHaveBeenCalled();
  });
});

describe('the confirm keeps an escape hatch', () => {
  it('RED: three buttons — send, someone else, cancel', () => {
    const S = observeStrings('en');
    const payload = Send.buildSendConfirmButtons('sess-1', S);
    expect(payload.buttons).toHaveLength(3);
    const ids = payload.buttons.map((b) => b.id);
    expect(ids[0]).toBe('observe_send_confirm_sess-1');
    expect(ids).toContain('observe_send_other_sess-1');
    expect(ids).toContain('observe_send_cancel_sess-1');
  });

  it('RED: every title fits the 20-code-point button cap in both languages', () => {
    for (const lang of ['en', 'ur']) {
      const S = observeStrings(lang);
      expect([...S.btn_send_other].length).toBeGreaterThan(0);
      expect([...S.btn_send_other].length).toBeLessThanOrEqual(20);
      for (const b of Send.buildSendConfirmButtons('s', S).buttons) {
        expect([...b.title].length).toBeLessThanOrEqual(20);
      }
    }
    expect(/[؀-ۿ]/.test(observeStrings('ur').btn_send_other)).toBe(true);
  });

  it('RED: the new id parses to its own action, and never collides with confirm or cancel', () => {
    expect(Send.parseSendButtonId('observe_send_other_sess-1')).toEqual({ action: 'other', sessionId: 'sess-1' });
    expect(Send.parseSendButtonId('observe_send_confirm_sess-1').action).toBe('confirm');
    expect(Send.parseSendButtonId('observe_send_cancel_sess-1').action).toBe('cancel');
  });

  it('RED: tapping it hands the coach the roster pick for this same session', async () => {
    await Send.handleSendOther('sess-1', COACH_PHONE, COACH);
    expect(ObserveState.setState).toHaveBeenCalledWith(
      'u-coach', 'awaiting_teacher_pick', expect.objectContaining({ sessionId: 'sess-1' }));
    expect(WA.sendInteractiveMessage).toHaveBeenCalled();
  });
});

describe('the coach is the one who hears back', () => {
  it('RED: a teacher tap confirms to the COACH, on the coach phone', async () => {
    DB.session = boundSession({
      analysis_data: {
        framework: 'fico',
        teacher_delivery: {
          status: 'awaiting_teacher_tap',
          teacher_name: 'Najma Kousar',
          teacher_phone: '923150583765',
          report_key: 'observe-reports/sess-1.png',
        },
      },
    });
    jest.doMock('../../shared/storage/r2', () => ({
      downloadFromR2: jest.fn(async () => Buffer.alloc(8)),
      uploadImageBuffer: jest.fn(async () => 'k'),
      uploadClassroomAudio: jest.fn(async () => 'a'),
    }), { virtual: true });
    await Send.processTeacherReport('sess-1', { phase: 'teacher_tap', from: '923150583765' });
    const acks = WA.sendMessage.mock.calls.filter((c) => c[0] === COACH_PHONE);
    expect(acks.length).toBeGreaterThan(0);
    // and NOT to the teacher
    expect(WA.sendMessage.mock.calls.every((c) => c[0] !== '923150583765')).toBe(true);
  });
});
