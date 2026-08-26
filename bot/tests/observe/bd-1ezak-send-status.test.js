/**
 * bd-1ezak — a report waiting on the teacher's template tap was INVISIBLE to
 * the coach: listUnsentReports filed awaiting_teacher_tap under DONE, so the
 * Send-reports screen dropped the row and the coach had no way to see "she
 * hasn't tapped yet". From the teacher's chair the invite template reads as
 * "feedback in text, no report" (Hiba's teacher, HITL R114b, 47 sessions in
 * that state since the 25-Aug fix).
 *
 * Contract: the Send-reports Flow screen shows awaiting-tap rows with a live
 * status line from the DB (invite sent <date> — waiting for the teacher's
 * tap), send_failed rows say so, and tapping an awaiting-tap row explains the
 * state instead of restarting the pick flow (no double invites).
 */

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

const fs = require('fs');
const path = require('path');

const ROWS = [
  { id: 'a', created_at: '2026-08-25T09:00:00Z', analysis_data: { teacher_delivery: { status: 'awaiting_teacher_tap', teacher_name: 'Nusrat', template_sent_at: '2026-08-25T10:00:00Z' } } },
  { id: 'b', created_at: '2026-08-25T08:00:00Z', analysis_data: { teacher_delivery: { status: 'send_failed', teacher_name: 'Saima' } } },
  { id: 'c', created_at: '2026-08-25T07:00:00Z', analysis_data: { teacher_delivery: { status: 'previewing', teacher_name: 'Rehana' } } },
  { id: 'd', created_at: '2026-08-25T06:00:00Z', analysis_data: { teacher_delivery: { status: 'sent', teacher_name: 'Done' } } },
];

function mockSupabaseReturning(rows) {
  jest.doMock('../../shared/config/supabase', () => ({
    from: () => {
      const b = {
        select: () => b, eq: () => b, or: () => b, order: () => b,
        range: async () => ({ data: rows, error: null }),
      };
      return b;
    },
  }));
}

describe('bd-1ezak · listUnsentReports surfaces the tap state', () => {
  afterEach(() => jest.resetModules());

  it('default keeps historical semantics: awaiting_teacher_tap stays hidden', async () => {
    jest.resetModules(); mockSupabaseReturning(ROWS);
    const D = require('../../shared/services/observe/observe-debrief.service');
    const out = await D.listUnsentReports('coach-1');
    expect(out.map((r) => r.id).sort()).toEqual(['b', 'c']);
  });

  it('includeAwaitingTap:true adds the waiting rows, annotated with the live status', async () => {
    jest.resetModules(); mockSupabaseReturning(ROWS);
    const D = require('../../shared/services/observe/observe-debrief.service');
    const out = await D.listUnsentReports('coach-1', { includeAwaitingTap: true });
    expect(out.map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
    const a = out.find((r) => r.id === 'a');
    expect(a.delivery_status).toBe('awaiting_teacher_tap');
    expect(a.template_sent_at).toBe('2026-08-25T10:00:00Z');
  });
});

describe('bd-1ezak · the row status line', () => {
  afterEach(() => jest.resetModules());

  it('maps each delivery state to a human line, with the invite date', () => {
    jest.resetModules(); mockSupabaseReturning([]);
    const D = require('../../shared/services/observe/observe-debrief.service');
    expect(D.sendReportRowMeta({ delivery_status: 'awaiting_teacher_tap', template_sent_at: '2026-08-25T10:00:00Z' }))
      .toMatch(/25 Aug.*tap|tap.*25 Aug/i);
    expect(D.sendReportRowMeta({ delivery_status: 'send_failed' })).toMatch(/failed.*retry/i);
    expect(D.sendReportRowMeta({})).toMatch(/not sent/i);
  });

  it('the Send-reports Flow screen renders the live status (wiring)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../shared/handlers/observe-visit-flow.handler.js'), 'utf8');
    expect(src).toMatch(/sendReportRowMeta/);
    expect(src).toMatch(/includeAwaitingTap/);
  });
});

describe('bd-1ezak · tapping an awaiting-tap row explains, never re-invites', () => {
  const sent = [];
  beforeEach(() => {
    jest.resetModules(); sent.length = 0;
    jest.doMock('../../shared/config/supabase', () => ({
      from: () => {
        const b = {
          select: () => b, eq: () => b, not: () => b, order: () => b, limit: () => b,
          single: async () => ({
            data: {
              id: 's1', observer_user_id: 'coach-1',
              analysis_data: { teacher_delivery: { status: 'awaiting_teacher_tap', teacher_name: 'Nusrat', template_sent_at: '2026-08-25T10:00:00Z' } },
            },
            error: null,
          }),
          update: () => b,
        };
        return b;
      },
    }));
    jest.doMock('../../shared/services/whatsapp.service', () => ({
      sendMessage: jest.fn(async (to, msg) => { sent.push({ kind: 'text', msg }); return true; }),
      sendInteractiveMessage: jest.fn(async (to, p) => { sent.push({ kind: 'list', p }); return true; }),
      sendInteractiveButtons: jest.fn(async (to, p) => { sent.push({ kind: 'buttons', p }); return true; }),
    }));
  });
  afterEach(() => jest.resetModules());

  it('startSendFlow on an awaiting-tap session sends the status message, not the pick list', async () => {
    const Send = require('../../shared/services/observe/observe-send.service');
    await Send.startSendFlow('s1', '92300', { id: 'coach-1', preferred_language: 'en' });
    expect(sent.some((s) => s.kind === 'list')).toBe(false);
    expect(sent.length).toBe(1);
    expect(sent[0].kind).toBe('text');
    expect(sent[0].msg).toMatch(/Nusrat/);
  });
});
