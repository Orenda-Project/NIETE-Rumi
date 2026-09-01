/**
 * bd-2218 — an observer edit must never silently delete evidence the observer
 * never saw.
 *
 * The Flow prefills each Evidence box with only the first PREFILL_TEXT_CAP
 * characters of the AI draft. When the leader edits that box, the value coming
 * back is capped by construction. Writing it verbatim over the original throws
 * away everything past the cap — and nothing on screen ever showed the leader
 * that there was more, so the loss is invisible to the only person who could
 * catch it. That truncated text is what feeds the teacher's report.
 *
 * Measured on NIETE prod (2026-07-21): 9 evidence notes across 5 of the 13
 * recorded observations already run past 600 characters (longest 681), and 156
 * coach-edited fields sit at exactly 300 — the fingerprint of the earlier cap
 * landing in v2. Raising 300 -> 600 moved the threshold; it left the mechanism.
 */

const mockDb = { row: null };
const mockSingle = jest.fn(() => Promise.resolve(
  mockDb.row ? { data: mockDb.row, error: null } : { data: null, error: { message: 'not found' } }));
const mockUpdateEq = jest.fn().mockResolvedValue({ data: null, error: null });
const mockUpdate = jest.fn((patch) => {
  if (mockDb.row) mockDb.row = { ...mockDb.row, ...patch };
  return { eq: mockUpdateEq };
});
function mockMakeChain() {
  const chain = {};
  for (const m of ['select', 'eq', 'neq', 'order']) chain[m] = jest.fn(() => chain);
  chain.single = mockSingle;
  chain.limit = jest.fn().mockResolvedValue({ data: [], error: null });
  chain.update = mockUpdate;
  return chain;
}
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn(() => mockMakeChain()) }));

const { applyObserverEdits } = require('../../shared/services/observe/observe-draft.service');

const SID = 'sess-bd2218';
const CAP = 600;

// A draft evidence note longer than the cap, with a marker in the tail so we
// can assert on the exact part the leader never saw.
const TAIL = ' …and then she asked the class to justify the grouping [24:10].';
const LONG_EVIDENCE = 'E'.repeat(CAP + 40) + TAIL;
const SHORT_IMPROVEMENT = 'Ask one open question and wait three seconds.';

function seedSession() {
  const draft = () => ({
    framework: 'fico',
    domains: {
      lesson_plan_fidelity: {
        domain_max: 20,
        indicators: [
          { id: 'B1', name: 'Instructional Clarity', score: 2, evidence_sw: LONG_EVIDENCE, improvement_sw: SHORT_IMPROVEMENT },
        ],
      },
    },
  });
  mockDb.row = {
    id: SID,
    user_id: 'u-1',
    observer_user_id: 'o-1',
    autofill_analysis_data: draft(),
    analysis_data: draft(),
    users: { phone_number: '923001234567', first_name: 'Warda', preferred_language: 'en' },
  };
}

const b1 = () => mockDb.row.analysis_data.domains.lesson_plan_fidelity.indicators[0];

beforeEach(() => {
  jest.clearAllMocks();
  seedSession();
});

describe('bd-2218 — observer edits never delete unseen evidence', () => {
  test('editing a capped Evidence box keeps the text past the cap', async () => {
    // What the Flow actually showed the leader, with one word changed by them.
    const shown = LONG_EVIDENCE.slice(0, CAP);
    const edited = `${shown.slice(0, CAP - 20)}CHANGED BY OBSERVER`;

    await applyObserverEdits(SID, { ev_B1: edited });

    const saved = b1().evidence_sw;
    expect(saved).toContain('CHANGED BY OBSERVER'); // the edit is honoured
    expect(saved).toContain(TAIL);                  // and the unseen tail survives
    expect(saved.length).toBeGreaterThan(CAP);
  });

  test('leaving a capped Evidence box untouched keeps the full original', async () => {
    await applyObserverEdits(SID, { ev_B1: LONG_EVIDENCE.slice(0, CAP) });
    expect(b1().evidence_sw).toBe(LONG_EVIDENCE);
  });

  test('a field shorter than the cap is replaced exactly, with no tail bolted on', async () => {
    await applyObserverEdits(SID, { imp_B1: 'Wait five seconds instead of three.' });
    expect(b1().improvement_sw).toBe('Wait five seconds instead of three.');
  });
});
