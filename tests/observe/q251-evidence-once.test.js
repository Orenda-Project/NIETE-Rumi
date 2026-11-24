'use strict';
/**
 * Queue #251 (the operator 24 Nov ~10:25: "the evidence is being repeated ... If we are looking at the digital coach's
 * evidence, then we only need to see that field. And then if we want to edit it ... you can have the digital coach's
 * evidence and then a free field for you to type in.") — what the bot sends so the portal's Feedback Form can show the
 * Digital Coach's evidence ONCE and tell "kept" from "the observer typed her own". Additive: every saved key, the
 * WhatsApp Flows and the report are unchanged.
 *
 *   FICO-S v1.2   on a Digital Coach visit the Evidence field (ev_<code>) carries `dcText`: exactly the text the Digital
 *                 Coach pre-filled into that box (fico-s-framework prefillEvidence of the row kept on the form). The
 *                 portal hides the box while it still holds that text. None (a starred indicator, nothing pre-filled,
 *                 a visit without the Digital Coach): no key, so the box shows as today.
 *   FICO17 v6.1   each of the eleven carries `rumiText`: the Digital Coach's own Evidence text (the same text the Flow
 *                 and the draft pre-fill, rumiEvidenceText), so a saved form whose ev_ differs from it is the coach's.
 */

const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const FF = require('../../bot/shared/services/observe/obs612/fico-s-flow');
const FW = require('../../bot/shared/services/coaching/frameworks/fico-s-framework');

const SVC = '../../bot/shared/services/observe/portal-observe.service';
const COACH = 'c0ac0000-0000-4000-8000-000000000001';
const SID = 'cs-v6-251';

// ── FICO-S v1.2: the Evidence field says what the Digital Coach pre-filled into it ─────────────────────────────────

const fieldOf = (secs, name) => secs.flatMap((s) => s.parts).find((p) => p.type === 'field' && p.name === name);
const DC = {
  levels: {
    C1: { result: 3, because: 'Two open questions.', evidence: [{ time: '04:30', quote: 'Why seven?' }, { time: '09:12', quote: 'How do you know?' }] },
    C2: { result: 'IE', because: 'Too noisy to hear.', evidence: [] },
    C4: { result: 'IE', because: 'Hard to hear.', evidence: [{ time: '11:00', quote: 'Tell me more.' }] },
    E3: { result: 2, because: 'Starred.', evidence: [{ time: '01:00', quote: 'Starred quote' }] },
  },
};

describe('FICO-S v1.2 portal sections — the Evidence field carries `dcText`', () => {
  test('a level with quotes: the pre-fill text, word for word ("because [MM:SS] \\"quote\\" …")', () => {
    const secs = FF.portalSections({}, 'en', { dc: DC, rubric: 'fico_s_v1_2' });
    const ev = fieldOf(secs, 'ev_C1');
    expect(ev.dcText).toBe('Two open questions. [04:30] "Why seven?" [09:12] "How do you know?"');
    expect(ev.dcText).toBe(FW.prefillEvidence(DC.levels.C1));
  });

  test('could not tell but quoted: the pre-fill text; could not tell and nothing quoted (nothing pre-filled): no key', () => {
    const secs = FF.portalSections({}, 'en', { dc: DC, rubric: 'fico_s_v1_2' });
    expect(fieldOf(secs, 'ev_C4').dcText).toBe(FW.prefillEvidence(DC.levels.C4));
    expect(fieldOf(secs, 'ev_C2')).not.toHaveProperty('dcText');
    expect(fieldOf(secs, 'ev_C6')).not.toHaveProperty('dcText');
  });

  test('a starred indicator, or a visit without the Digital Coach: no key', () => {
    expect(fieldOf(FF.portalSections({}, 'en', { dc: DC, rubric: 'fico_s_v1_2' }), 'ev_E3')).not.toHaveProperty('dcText');
    const plain = FF.portalSections({}, 'en', { rubric: 'fico_s_v1_2' }).flatMap((s) => s.parts).filter((p) => p.type === 'field');
    for (const p of plain) expect(p).not.toHaveProperty('dcText');
  });

  test('the field is otherwise unchanged (name, input, required, text)', () => {
    const withDc = fieldOf(FF.portalSections({}, 'en', { dc: DC, rubric: 'fico_s_v1_2' }), 'ev_C1');
    const plain = fieldOf(FF.portalSections({}, 'en', { rubric: 'fico_s_v1_2' }), 'ev_C1');
    const { dcText: _drop, ...rest } = withDc;
    expect(rest).toEqual(plain);
  });

  test('the pre-fill on the form row is that same text (fico-s-dc prefillDraft)', () => {
    const { draft } = require('../../bot/shared/services/observe/obs612/fico-s-dc').prefillDraft({}, DC, { rubric: 'fico_s_v1_2' });
    expect(draft.ev_C1).toBe(fieldOf(FF.portalSections(draft, 'en', { dc: DC, rubric: 'fico_s_v1_2' }), 'ev_C1').dcText);
  });
});

// ── FICO17 v6.1: each of the eleven says the Digital Coach's own Evidence text ────────────────────────────────────

function fakeSupabase(answer = {}) {
  const from = (table) => {
    const q = { filters: {} };
    const self = new Proxy(q, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === 'eq') return (c, v) => { target.filters[c] = v; return self; };
        if (prop === 'single' || prop === 'maybeSingle') {
          return async () => {
            const fn = answer[table];
            return { data: typeof fn === 'function' ? fn(target.filters) : (fn ?? null), error: null };
          };
        }
        return () => self;
      },
    });
    return self;
  };
  return { from };
}

function v6Analysis() {
  const levels = {};
  const domains = { v6_teacher: { indicators: [] }, v6_children: { indicators: [] }, v6_subject: { indicators: [] } };
  for (const code of v6.CODES) {
    const row = { id: code, name: v6.indicator(code).name };
    if (v6.isDc(code)) {
      const evidence = [{ time: '03:10', quote: `Quote for ${code}` }];
      levels[code] = { result: 3, because: `Rumi saw ${code}.`, evidence };
      Object.assign(row, { kind: 'dc', set_by: 'dc', result: 3, score: 3, because: `Rumi saw ${code}.`, evidence_items: evidence, improvement: '' });
    }
    domains[v6.DOMAIN_OF[code]].indicators.push(row);
  }
  return { framework: 'fico17_v6', rubric: 'fico17_v6', levels, domains, combined_evidence: {}, lp_fidelity: null };
}

function deps(analysis = v6Analysis(), edits = null) {
  const row = {
    id: SID, user_id: '7eac0000-0000-4000-8000-000000000003', observer_user_id: COACH, observation_type: 'leader_observation',
    audio_url: 'https://r2.example/bucket/classroom_audio/x/wa.ogg', status: 'awaiting_observer_review', debrief_status: 'pending',
    framework: 'fico17_v6', created_at: '2026-11-24T04:30:00Z', analysis_data: analysis,
  };
  return {
    supabase: fakeSupabase({ users: () => ({ id: COACH, role: 'coach', phone_number: '923000000000', preferred_language: 'en' }), coaching_sessions: () => row }),
    draft: {
      buildScreenPrefill: jest.fn((a, key) => (key === 'lesson_plan_fidelity'
        ? { has_fidelity: false, no_fidelity: true, fid_header: '', fid_fallback: 'No lesson plan was provided.', mv_1: '', mv_1_v: false, fr_1: 'not_adjudicable', fe_1: '' }
        : {})),
      applyObserverEdits: jest.fn(),
      FIDELITY_VERDICT_OPTIONS: [{ id: 'executed', title: '✓ Executed' }],
      MAX_MOVE_SLOTS: 1,
      fid: (id) => String(id).replace(/\./g, '_'),
    },
    pack: () => ({ domainOrder: ['lesson_plan_fidelity'], domains: { lesson_plan_fidelity: { key: 'B', title: 'Lesson Plan Fidelity', indicators: [] } }, scaleOptions: [] }),
    languageFor: jest.fn().mockResolvedValue('en'),
    state: { getState: jest.fn().mockResolvedValue(edits ? { edits } : null), clearState: jest.fn() },
    observationNotes: { notesOf: () => [], REVIEW_KEY: 'observation_notes_review_opened_at', markReviewOpened: jest.fn() },
    notesOn: jest.fn().mockResolvedValue(false),
    debrief: { buildDebriefGuide: jest.fn(), mergeObserverDebrief: jest.fn() },
    log: jest.fn(),
    now: () => new Date('2026-11-24T05:00:00Z'),
  };
}

const allInd = (out) => out.sections.flatMap((s) => s.indicators || []);

describe('FICO17 v6.1 draft view — the eleven carry `rumiText`', () => {
  let Svc;
  let O;
  beforeEach(() => {
    jest.resetModules();
    Svc = require(SVC);
    O = require('../../bot/shared/services/observe/observe-fico17-v6');
  });

  test('each of the eleven: the Digital Coach\'s own Evidence text; the six: none', async () => {
    const analysis = v6Analysis();
    const out = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, deps(analysis));
    const inds = allInd(out);
    expect(inds).toHaveLength(17);
    for (const i of inds) {
      if (i.kind === 'dc') expect(i.rumiText).toBe(O.rumiEvidenceText(analysis, i.id));
      else expect(i).not.toHaveProperty('rumiText');
    }
    expect(inds.find((i) => i.id === 'C1').rumiText).toBe('Rumi saw C1. · 03:10 "Quote for C1"');
  });

  test('a fresh draft: its Evidence (the box\'s text) is that same text', async () => {
    const out = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, deps());
    const c1 = allInd(out).find((i) => i.id === 'C1');
    expect(c1.evidence).toBe(c1.rumiText);
  });

  test('after the coach saved her own words: Evidence is hers, rumiText is still the Digital Coach\'s', async () => {
    // the row as applyReview leaves it (bd-ra8xu.46): her text on evidence, the Digital Coach's moved to rumi_evidence
    const analysis = v6Analysis();
    const row =analysis.domains.v6_teacher.indicators.find((r) => r.id === 'C1');
    Object.assign(row, { rumi_evidence: row.because, evidence: 'Mine: she asked why twice.', evidence_summary: 'Mine: she asked why twice.' });
    const out = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, deps(analysis));
    const c1 = allInd(out).find((i) => i.id === 'C1');
    expect(c1.rumiText).toBe('Rumi saw C1. · 03:10 "Quote for C1"');
  });
});
