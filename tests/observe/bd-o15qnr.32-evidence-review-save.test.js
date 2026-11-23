'use strict';
/**
 * bd-o15qnr.32 — the evidence review through the REAL save: portal saveDraft → observe-draft applyObserverEdits →
 * observe-fico17-v6 buildReview/applyReview → the one coaching_sessions.analysis_data write (the existing JSON column;
 * no schema change, no other write), then the draft view of the written row. Supabase is mocked at the network
 * boundary; everything else runs for real.
 */

process.env.OBSERVE_FRAMEWORK = 'fico';

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn(), logEvent: jest.fn() }));

let mockRow = null;
const mockUpdates = [];
jest.mock('../../bot/shared/config/supabase', () => ({
  from: jest.fn((table) => {
    let cols = '';
    let patch = null;
    const chain = {
      select: jest.fn((c) => { cols = String(c || ''); return chain; }),
      eq: jest.fn(() => chain),
      is: jest.fn(() => chain),
      in: jest.fn(() => chain),
      not: jest.fn(() => chain),
      update: jest.fn((p) => { patch = p; mockUpdates.push({ table, patch: p }); return chain; }),
      then: (res, rej) => {
        if (patch && patch.analysis_data) mockRow = { ...mockRow, ...patch };
        return Promise.resolve({ data: [{ id: mockRow.id }], error: null }).then(res, rej);
      },
      maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
      single: jest.fn(() => Promise.resolve({
        data: cols === 'analysis_data' ? { analysis_data: mockRow.analysis_data } : { ...mockRow, users: { name: 'C', phone_number: '1' } },
        error: null,
      })),
    };
    return chain;
  }),
}));

const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const O = require('../../bot/shared/services/observe/observe-fico17-v6');
const ObserveDraft = require('../../bot/shared/services/observe/observe-draft.service');
const Svc = require('../../bot/shared/services/observe/portal-observe.service');

const COACH = 'c0ac0000-0000-4000-8000-000000000001';
const SID = 'cs-v6-ev-save';
const WHY = 'Called Ali and Sana by name before asking, twice.';

function v6Analysis() {
  const levels = {};
  const domains = { v6_teacher: { indicators: [] }, v6_children: { indicators: [] }, v6_subject: { indicators: [] } };
  for (const code of v6.CODES) {
    const row = { id: code, name: v6.indicator(code).name };
    if (v6.isDc(code)) {
      const evidence = [{ time: '03:10', quote: `First quote for ${code}` }, { time: '06:20', quote: `Second quote for ${code}` }];
      levels[code] = { result: 3, because: `Rumi saw ${code} twice.`, evidence };
      Object.assign(row, {
        kind: 'dc', set_by: 'dc', result: 3, score: 3, applicable: true, because: `Rumi saw ${code} twice.`,
        evidence: evidence.map((i) => `[${i.time}] "${i.quote}"`).join(' '), evidence_items: evidence,
        evidence_summary: `Rumi saw ${code} twice.`, improvement: `Next for ${code}`,
      });
    }
    domains[v6.DOMAIN_OF[code]].indicators.push(row);
  }
  return { framework: 'fico17_v6', rubric: 'fico17_v6', levels, domains, combined_evidence: {}, lp_fidelity: null };
}

function validEdits(over = {}) {
  const e = {};
  for (const code of v6.CODES) {
    if (v6.isCombined(code)) { e[`r_${code}`] = '3'; e[`why_${code}`] = WHY; } else { e[`r_${code}`] = '3'; e[`ev_${code}`] = `Rumi saw ${code} twice.`; e[`imp_${code}`] = `Next for ${code}`; }
  }
  e.chg_C = ''; e.chg_D = ''; e.chg_F = '';
  return { ...e, ...over };
}

const REVIEW = {
  summary: { rumi: 'Rumi saw C1 twice.', coach: 'Rumi saw C1 twice.' },
  items: [
    { source: 'rumi', time: '03:10', quote: 'First quote for C1', status: 'kept' },
    { source: 'rumi', time: '06:20', quote: 'Second quote for C1', status: 'removed' },
    { source: 'coach', time: '11:05', text: 'She praised the effort, not the answer.' },
  ],
};

/** The portal service's deps: the row read from the mocked table, the real draft service. */
function deps() {
  const read = {
    from: () => {
      const c = { select: () => c, eq: () => c, maybeSingle: async () => ({ data: mockRow, error: null }), single: async () => ({ data: mockRow, error: null }) };
      return c;
    },
  };
  return {
    supabase: read,
    draft: ObserveDraft,
    pack: () => ({ domainOrder: ['lesson_plan_fidelity'], domains: { lesson_plan_fidelity: { key: 'B', title: 'Lesson Plan Fidelity', indicators: [] } }, scaleOptions: [] }),
    languageFor: jest.fn().mockResolvedValue('en'),
    state: { getState: jest.fn().mockResolvedValue(null), clearState: jest.fn() },
    observationNotes: { notesOf: () => [], REVIEW_KEY: 'observation_notes_review_opened_at', markReviewOpened: jest.fn() },
    notesOn: jest.fn().mockResolvedValue(false),
    debrief: { buildDebriefGuide: jest.fn().mockResolvedValue({}), mergeObserverDebrief: jest.fn().mockResolvedValue(null) },
    log: jest.fn(),
  };
}

const rowOf = (a, code) => a.domains[v6.DOMAIN_OF[code]].indicators.find((i) => i.id === code);

beforeEach(() => {
  mockUpdates.length = 0;
  const analysis = v6Analysis();
  mockRow = {
    id: SID, user_id: 't1', observer_user_id: COACH, observation_type: 'leader_observation', status: 'awaiting_observer_review',
    debrief_status: 'pending', framework: 'fico17_v6', analysis_data: analysis, autofill_analysis_data: JSON.parse(JSON.stringify(analysis)),
  };
});

test('a save with evidence_review writes row.evidence_review in the one analysis_data write; the view returns it', async () => {
  const edits = validEdits({ ev_C1: 'Rumi saw C1 twice. · 03:10 "First quote for C1" · She praised the effort, not the answer.' });
  const out = await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits, evidenceReview: { C1: REVIEW } }, deps());
  expect(out.status).toBe('ok');
  const writes = mockUpdates.filter((u) => u.table === 'coaching_sessions');
  expect(writes).toHaveLength(1);
  expect(Object.keys(writes[0].patch).sort()).toEqual(['analysis_data', 'status']);
  const written = writes[0].patch.analysis_data;
  const c1 = rowOf(written, 'C1');
  expect(c1.evidence_review).toEqual({ ...REVIEW, items: REVIEW.items.map((i) => (i.source === 'coach' ? { ...i, time: i.time || null } : i)) });
  // ev_ as today: the row's evidence is her text, Rumi's text and list kept beside it.
  expect(c1.evidence).toBe(edits.ev_C1);
  expect(c1.evidence_sw).toBe(edits.ev_C1);
  expect(c1.rumi_evidence_items).toEqual(v6Analysis().levels.C1.evidence);
  expect(c1.evidence_items).toBeUndefined();
  expect(rowOf(written, 'C2')).not.toHaveProperty('evidence_review');

  const view = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, deps());
  const ind = view.sections.flatMap((s) => s.indicators || []).find((i) => i.id === 'C1');
  expect(ind.evidenceReview).toEqual(c1.evidence_review);
  expect(ind.evidence).toBe(edits.ev_C1);
  expect(ind.rumiEvidence).toEqual({ because: 'Rumi saw C1 twice.', items: v6Analysis().levels.C1.evidence });
});

test('the same save without evidence_review writes exactly what it writes today (no evidence_review anywhere)', async () => {
  const edits = validEdits();
  await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits }, deps());
  const plain = mockUpdates.filter((u) => u.table === 'coaching_sessions')[0].patch.analysis_data;
  expect(JSON.stringify(plain)).not.toContain('evidence_review');

  // And a bad review writes the very same analysis (but for the timestamps).
  mockUpdates.length = 0;
  mockRow.analysis_data = v6Analysis();
  mockRow.status = 'awaiting_observer_review';
  await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits, evidenceReview: { C3: REVIEW, C1: 'all kept' } }, deps());
  const withBad = mockUpdates.filter((u) => u.table === 'coaching_sessions')[0].patch.analysis_data;
  const strip = (a) => {
    const c = JSON.parse(JSON.stringify(a));
    c.fico17_v6_review.reviewed_at = 'T';
    c.observer_edit_summary.edited_at = 'T';
    return c;
  };
  expect(strip(withBad)).toEqual(strip(plain));
});

test('the WhatsApp Flow\'s own save (applyObserverEdits with string edits only) never writes one', async () => {
  await ObserveDraft.applyObserverEdits(SID, validEdits({ evidence_review: '{"C1":{"summary":{"rumi":"x","coach":"y"},"items":[]}}' }));
  const written = mockUpdates.filter((u) => u.table === 'coaching_sessions')[0].patch.analysis_data;
  expect(JSON.stringify(written)).not.toContain('evidence_review');
  expect(O.sanitizeEvidenceReview('{"C1":{}}')).toBeNull();
});
