/**
 * bd-2215 — the /observe interactive-list rows must route.
 *
 * BUG (2026-07-20, Riffat/NIETE ICT prod): after completing one observation end
 * to end, sending /observe again showed the pending list (correct) but tapping
 * "🎙 New observation" did nothing. Logs: `⚠️ Unknown list item ID observe_new`.
 *
 * NIETE had the observe BUTTON handlers but none of the observe LIST branches,
 * so every row in that list dead-ended — observe_new, observe_debrief_<id> and
 * observe_send_<id> alike. A coach could therefore never start a second
 * observation once the first left a pending debrief or an unsent report.
 *
 * This guards the ID contract the router branches switch on. If a row id or the
 * parse contract drifts, the router silently falls through to "Unknown list
 * item ID" again — a dead tap with no error, which is exactly why the first
 * failure went unnoticed until a human hit it.
 */

jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/gpt5-mini.service', () => ({}));
jest.mock('../../shared/services/whatsapp.service', () => ({ sendMessage: jest.fn() }));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));

const ObserveDebrief = require('../../shared/services/observe/observe-debrief.service');

describe('bd-2215 — observe list-reply id contract', () => {
  test('the "new observation" sentinel parses as the new-capture action', () => {
    expect(ObserveDebrief.parseDebriefListReplyId('observe_new')).toEqual({ action: 'new' });
  });

  test('a pending-debrief row parses to its session id', () => {
    expect(ObserveDebrief.parseDebriefListReplyId('observe_debrief_52b77455-abc'))
      .toEqual({ action: 'debrief', sessionId: '52b77455-abc' });
  });

  test('unrelated ids do not parse (router must fall through to its other branches)', () => {
    expect(ObserveDebrief.parseDebriefListReplyId('quiz_lp_3')).toBeNull();
    expect(ObserveDebrief.parseDebriefListReplyId('')).toBeNull();
    expect(ObserveDebrief.parseDebriefListReplyId(null)).toBeNull();
  });

  test('the pending list ALWAYS offers a way to start a new observation', () => {
    // The regression that bit Riffat: a coach with pending work must never be
    // locked out of starting the next observation.
    const S = {
      list_body: 'b', list_button: 'btn', list_section_title: 's',
      list_new_observation: 'New observation', list_new_observation_desc: 'Start a new one',
      list_row_default_desc: 'd',
    };
    const pendings = [{ id: 'sess-1', created_at: '2026-07-20T14:39:29Z', analysis_data: {} }];
    const payload = ObserveDebrief.buildPendingListPayload(pendings, S, []);
    const rows = payload.action.sections[0].rows;
    expect(rows.some((r) => r.id === 'observe_new')).toBe(true);
    // and every row id must be one the router can parse or prefix-match
    for (const r of rows) {
      const routable = r.id === 'observe_new'
        || r.id.startsWith('observe_debrief_')
        || r.id.startsWith('observe_send_');
      expect(routable).toBe(true);
    }
  });
});
