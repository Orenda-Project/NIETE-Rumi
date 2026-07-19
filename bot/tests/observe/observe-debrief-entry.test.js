/**
 * FEAT-053 bd-21 — debrief entry points: now/later buttons after form submit,
 * pending-debrief interactive list on /observe re-trigger, dispatch helpers.
 *
 * The whatsapp-bot.js branches stay thin — everything they call is tested here.
 */

jest.mock('../../shared/services/whatsapp.service', () => ({
  sendMessage: jest.fn().mockResolvedValue(true),
  sendInteractiveButtons: jest.fn().mockResolvedValue(true),
  sendInteractiveMessage: jest.fn().mockResolvedValue(true),
}));

// Chainable supabase mock: from().select().eq()...order().limit() resolves
// with mockRows; .single() (staleness read in handleDebriefLater) resolves
// with mockSingleRow; update() is tracked. Shapes the REAL PostgREST chain.
const mockRows = { data: [], error: null };
const mockSingleRow = { data: { debrief_status: 'pending' }, error: null };
const mockLimit = jest.fn().mockImplementation(() => Promise.resolve(mockRows));
const mockOrder = jest.fn(() => ({ limit: mockLimit }));
const mockSingle = jest.fn().mockImplementation(() => Promise.resolve(mockSingleRow));
const mockUpdate = jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ error: null }) }));
const chainEq = { order: mockOrder, single: mockSingle };
chainEq.eq = jest.fn(() => chainEq);
const mockSelect = jest.fn(() => chainEq);
jest.mock('../../shared/config/supabase', () => ({
  from: jest.fn(() => ({ select: mockSelect, update: mockUpdate })),
}));

const WhatsAppService = require('../../shared/services/whatsapp.service');
const supabase = require('../../shared/config/supabase');
const {
  listPendingDebriefs,
  buildPendingListPayload,
  buildDebriefChoiceButtons,
  parseDebriefButtonId,
  parseDebriefListReplyId,
  handleDebriefLater,
} = require('../../shared/services/observe/observe-debrief.service');
const { observeStrings } = require('../../shared/services/observe/observe-strings');

const S = observeStrings('sw');
const SID = '3f0a2f66-9a1b-4c58-8f8e-1234567890ab';

const pending = (n) => ({
  id: `sess-${n}`,
  created_at: `2026-07-1${n}T06:4${n}:00Z`,
  analysis_data: {
    focus_area_sw: { indicator: 'C3.7', title_sw: `Kiashiria cha ${n}` },
  },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRows.data = [];
  mockRows.error = null;
  mockSingleRow.data = { debrief_status: 'pending' };
  mockSingleRow.error = null;
});

describe('parseDebriefButtonId', () => {
  test('now button → {action:"now", sessionId}', () => {
    expect(parseDebriefButtonId(`observe_debrief_now_${SID}`))
      .toEqual({ action: 'now', sessionId: SID });
  });
  test('later button → {action:"later", sessionId}', () => {
    expect(parseDebriefButtonId(`observe_debrief_later_${SID}`))
      .toEqual({ action: 'later', sessionId: SID });
  });
  test('foreign ids → null (never swallow other features)', () => {
    expect(parseDebriefButtonId('coaching_confirm_xyz')).toBeNull();
    expect(parseDebriefButtonId('quiz_abc_A')).toBeNull();
    expect(parseDebriefButtonId('')).toBeNull();
    expect(parseDebriefButtonId(null)).toBeNull();
  });
});

describe('parseDebriefListReplyId', () => {
  test('pending row → sessionId', () => {
    expect(parseDebriefListReplyId(`observe_debrief_${SID}`))
      .toEqual({ action: 'debrief', sessionId: SID });
  });
  test('new-observation sentinel row → {action:"new"}', () => {
    expect(parseDebriefListReplyId('observe_new')).toEqual({ action: 'new' });
  });
  test('button ids are NOT list ids (prefix overlap guard)', () => {
    // observe_debrief_now_<id> must not parse as a list row for session "now_<id>"
    expect(parseDebriefListReplyId(`observe_debrief_now_${SID}`)).toBeNull();
    expect(parseDebriefListReplyId(`observe_debrief_later_${SID}`)).toBeNull();
  });
  test('foreign ids → null', () => {
    expect(parseDebriefListReplyId('quiz_lp_123')).toBeNull();
    expect(parseDebriefListReplyId(null)).toBeNull();
  });
});

describe('buildDebriefChoiceButtons', () => {
  test('two buttons, session-scoped ids, ≤20-char titles (WhatsApp cap)', () => {
    const payload = buildDebriefChoiceButtons(SID, S);
    expect(payload.body).toBeTruthy();
    expect(payload.buttons).toHaveLength(2);
    const [now, later] = payload.buttons;
    expect(now.id).toBe(`observe_debrief_now_${SID}`);
    expect(later.id).toBe(`observe_debrief_later_${SID}`);
    for (const b of payload.buttons) {
      expect(b.title.length).toBeLessThanOrEqual(20);
      expect(b.title.length).toBeGreaterThan(0);
    }
  });
});

describe('listPendingDebriefs', () => {
  test('queries coaching_sessions with the four observe predicates, newest first, ≤9', async () => {
    mockRows.data = [pending(1), pending(2)];
    const rows = await listPendingDebriefs('fo-uuid-1');
    expect(rows).toHaveLength(2);
    expect(supabase.from).toHaveBeenCalledWith('coaching_sessions');
    // all four predicates present (order-insensitive)
    const eqCalls = chainEq.eq.mock.calls;
    expect(eqCalls).toEqual(expect.arrayContaining([
      ['observer_user_id', 'fo-uuid-1'],
      ['observation_type', 'leader_observation'],
      ['debrief_status', 'pending'],
      ['status', 'observer_review_complete'],
    ]));
    expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(mockLimit).toHaveBeenCalledWith(9);
  });

  test('supabase error → throws (never silently returns empty — Rule: check error)', async () => {
    mockRows.data = null;
    mockRows.error = { message: 'boom' };
    await expect(listPendingDebriefs('fo-uuid-1')).rejects.toThrow(/boom/);
  });
});

describe('buildPendingListPayload', () => {
  test('3 pendings → 3 session rows + the new-observation sentinel, ids/titles within caps', () => {
    const payload = buildPendingListPayload([pending(1), pending(2), pending(3)], S);
    const rows = payload.action.sections[0].rows;
    expect(rows).toHaveLength(4);
    expect(rows[0].id).toBe('observe_debrief_sess-1');
    expect(rows[3].id).toBe('observe_new');
    for (const r of rows) {
      expect(r.title.length).toBeLessThanOrEqual(24);   // WhatsApp row-title cap
      expect(r.title.length).toBeGreaterThan(0);
    }
    expect(payload.body).toBeTruthy();
    expect(payload.action.button).toBeTruthy();
  });

  test('9 pendings → 10 rows total (WhatsApp max), sentinel still present', () => {
    const nine = Array.from({ length: 9 }, (_, i) => pending(i));
    const rows = buildPendingListPayload(nine, S).action.sections[0].rows;
    expect(rows).toHaveLength(10);
    expect(rows[9].id).toBe('observe_new');
  });

  test('row description carries the focus headline (title_sw), not the indicator ID', () => {
    const rows = buildPendingListPayload([pending(1)], S).action.sections[0].rows;
    expect(rows[0].description).toMatch(/Kiashiria cha 1/);
    expect(rows[0].description).not.toBe('C3.7');
    expect(rows[0].description.length).toBeLessThanOrEqual(72);
  });

  test('never a numeric score in titles or descriptions', () => {
    const withScores = {
      ...pending(1),
      analysis_data: {
        scores: { overall_marks: 40, overall_percentage: 53.3 },
        focus_area_sw: { indicator: 'C3.7', title_sw: 'Ushirikishwaji' },
      },
    };
    const rows = buildPendingListPayload([withScores], S).action.sections[0].rows;
    expect(rows[0].description).not.toMatch(/40|\d+\s*\/\s*\d+|%/);
  });
});

describe('handleDebriefLater', () => {
  test('pending session → later ack (mentions /observe), never WRITES (stays pending)', async () => {
    await handleDebriefLater(SID, '255700000001', { preferred_language: 'sw' });
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toMatch(/\/observe/);
    // it may READ debrief_status for staleness, but must never UPDATE
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('stale tap on an already-DONE debrief → already-done ack, not the list pointer (review fix)', async () => {
    mockSingleRow.data = { debrief_status: 'done' };
    await handleDebriefLater(SID, '255700000001', { preferred_language: 'sw' });
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    const msg = WhatsAppService.sendMessage.mock.calls[0][1];
    expect(msg).toMatch(/imeshafanyika|already/i);   // already-done ack
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('staleness read failure → still sends later ack (best-effort, never dead-ends)', async () => {
    mockSingle.mockRejectedValueOnce(new Error('db blip'));
    await handleDebriefLater(SID, '255700000001', { preferred_language: 'sw' });
    expect(WhatsAppService.sendMessage).toHaveBeenCalledTimes(1);
    expect(WhatsAppService.sendMessage.mock.calls[0][1]).toMatch(/\/observe/);
  });
});
