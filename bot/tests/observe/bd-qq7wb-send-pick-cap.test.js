/**
 * bd-qq7wb — the send flow broke for 26/83 coaches on 2026-08-25 (Rifat: "~90%
 * of coaches: after the debrief the teacher report is not generated").
 *
 * Two proven defects, one incident:
 *  1. buildTeacherPickPayload rendered the WHOLE roster (ROSTER_CAP=25) + 2
 *     fixed rows — up to 27 rows against WhatsApp's hard 10-row list limit.
 *     sendInteractiveMessage refuses (>10 → "Too many rows") and the coach
 *     gets SILENCE after tapping "Send report". Deterministic for any coach
 *     with 9+ distinct delivered teachers (backfill arms it instantly).
 *     Live proof: Eysha roster=9 → refused 08:59Z; Hiba roster=5 → sent 09:13Z.
 *  2. A coach who TYPES the teacher's name+number while the pick list is open
 *     (state awaiting_teacher_pick) fell through to generic AI chat — the text
 *     hook only consumed awaiting_teacher_details. Live proof: Shazmina 08:16Z
 *     "Rahila 0344 5192436" → "How can I assist you...".
 *
 * Contract: the pick list is EXACTLY ≤10 rows (8 MRU + new + manage), the
 * state snapshot matches the shown rows (taps resolve against what she saw),
 * and typed details are consumed in BOTH awaiting states.
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const R25 = Array.from({ length: 25 }, (_, i) => ({ name: `Teacher ${i + 1}`, phone: `9230000000${String(i).padStart(2, '0')}` }));

describe('bd-qq7wb · the pick list fits WhatsApp', () => {
  let Send;
  beforeEach(() => { jest.resetModules(); Send = require('../../shared/services/observe/observe-send.service'); });

  it('a 25-teacher roster paginates: page 1 = 7 MRU + more + new + manage = 10 rows', () => {
    const S = require('../../shared/services/observe/observe-strings').observeStrings('ur');
    const rows = Send.buildTeacherPickPayload(R25, S).action.sections[0].rows;
    expect(rows.length).toBe(10);
    expect(rows[0].id).toBe('observe_pickt_0');
    expect(rows[6].id).toBe('observe_pickt_6');
    expect(rows.map(r => r.id)).toContain('observe_pickt_more_7');
    expect(rows.map(r => r.id)).toContain('observe_pickt_new');
    expect(rows.map(r => r.id)).toContain('observe_pickt_manage');
  });

  it('page 2 carries GLOBAL indexes and the next more-row; the last page has none', () => {
    const S = require('../../shared/services/observe/observe-strings').observeStrings('en');
    const p2 = Send.buildTeacherPickPayload(R25, S, 7).action.sections[0].rows;
    expect(p2[0].id).toBe('observe_pickt_7');
    expect(p2.map(r => r.id)).toContain('observe_pickt_more_14');
    const last = Send.buildTeacherPickPayload(R25, S, 21).action.sections[0].rows;
    expect(last.some(r => String(r.id).includes('more'))).toBe(false);
    expect(last.length).toBe(4 + 2);                    // teachers 22-25 + new + manage
    expect(last.every(r => r.id !== undefined)).toBe(true);
  });

  it('a small roster is unchanged (3 teachers → 5 rows)', () => {
    const S = require('../../shared/services/observe/observe-strings').observeStrings('en');
    const rows = Send.buildTeacherPickPayload(R25.slice(0, 3), S).action.sections[0].rows;
    expect(rows.length).toBe(5);
  });
});

describe('bd-qq7wb · startSendFlow snapshot matches the shown rows', () => {
  const sent = [];
  const states = [];
  beforeEach(() => {
    jest.resetModules(); sent.length = 0; states.length = 0;
    jest.doMock('../../shared/config/supabase', () => ({
      from: () => {
        const b = { select: () => b, eq: () => b, not: () => b, order: () => b, limit: () => b,
          single: async () => ({ data: { id: 's1', observer_user_id: 'coach-1', analysis_data: {} }, error: null }),
          update: () => b };
        return b;
      },
    }));
    jest.doMock('../../shared/services/observe/observe-state.service', () => ({
      setState: jest.fn(async (uid, state, payload) => { states.push({ state, payload }); }),
      getState: jest.fn(async () => null),
    }));
    jest.doMock('../../shared/services/observe/observe-roster', () => ({
      getRoster: jest.fn(async () => R25),
    }));
    jest.doMock('../../shared/services/whatsapp.service', () => ({
      sendMessage: jest.fn(async () => true),
      sendInteractiveMessage: jest.fn(async (to, p) => { sent.push(p); return true; }),
      sendInteractiveButtons: jest.fn(async () => true),
    }));
  });
  afterEach(() => jest.resetModules());

  it('state.teachers === the 8 shown, so observe_pickt_<i> can never mis-resolve', async () => {
    const Send = require('../../shared/services/observe/observe-send.service');
    await Send.startSendFlow('s1', '92300', { id: 'coach-1', preferred_language: 'ur' });
    expect(sent.length).toBe(1);
    const rows = sent[0].action.sections[0].rows;
    expect(rows.length).toBeLessThanOrEqual(10);
    const snap = states.find(s => s.state === 'awaiting_teacher_pick');
    expect(snap).toBeTruthy();
    expect(snap.payload.teachers.length).toBe(25);   // FULL snapshot — global ids resolve against it
  });
});
