'use strict';
/**
 * bd-o15qnr.39.1 (queue #204, the operator 22 Nov) — the Feedback Form's "Digital Coach's evidence" box and the six's
 * how-to-fill hint, what the bot sends for them (additive; the WhatsApp Flows and every saved key are unchanged):
 *
 *   FICO17 v6.1   each of the six (C3 C5 C7 D2 D3 D4) gets `hint`: the how-to-fill line the portal puts after the
 *                 indicator's one line (`about`), so there is no separate "You add: …" text. Where #217's guide line has
 *                 a second sentence (C7, D2, D4) it is that sentence; C3, C5 and D3 take theirs from the rubric's
 *                 coach_adds. English and Urdu (Urdu: draft, NATIVE-CHECK). The eleven get none.
 *   FICO-S v1.2   on a Digital Coach visit each indicator's item field gets `dcEvidence`: { because, items: [{ time,
 *                 quote }] }, the Digital Coach's own findings, shown as evidence rows; `because` only where it set a
 *                 level (a "could not set a level" reason is already the line above). None: no field (no box).
 */

const Lines = require('../../bot/shared/services/coaching/frameworks/indicator-lines');
const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const FF = require('../../bot/shared/services/observe/obs612/fico-s-flow');

const SVC = '../../bot/shared/services/observe/portal-observe.service';
const COACH = 'c0ac0000-0000-4000-8000-000000000001';
const SID = 'cs-v6-391';
const URDU = /[؀-ۿ]/;

describe('hintFor — the six\'s how-to-fill line', () => {
  test('D2, C7, D4: the second sentence of #217\'s guide line', () => {
    expect(Lines.hintFor('fico17_v6', 'D2', 'en')).toBe("Chorus answers don't count.");
    expect(Lines.hintFor('fico17_v6', 'D2', 'ur')).toBe('سب کا مل کر ایک ساتھ جواب دینا شمار نہیں ہوتا۔');
    expect(Lines.hintFor('fico17_v6', 'C7', 'en')).toBe('Sitting together but working alone is not group work.');
    expect(Lines.hintFor('fico17_v6', 'D4', 'en')).toBe('Only the trying counts, not whether the answer is right.');
  });

  test('every one of the six has a short hint in each language; the eleven have none', () => {
    for (const code of v6.CODES) {
      const en = Lines.hintFor('fico17_v6', code, 'en');
      const ur = Lines.hintFor('fico17_v6', code, 'ur');
      if (v6.isCombined(code)) {
        expect(en.length).toBeGreaterThan(15);
        expect(en.length).toBeLessThanOrEqual(90);
        expect(en).not.toMatch(URDU);
        expect(ur).toMatch(URDU);
        expect(en).not.toMatch(/You add|Coach adds|written justification/);
      } else {
        expect(en).toBe('');
        expect(ur).toBe('');
      }
    }
  });

  test('a FICO-S rubric, an unknown code or rubric: no hint', () => {
    expect(Lines.hintFor('fico_s_v1_2', 'C3', 'en')).toBe('');
    expect(Lines.hintFor('fico17_v6', 'Z9', 'en')).toBe('');
    expect(Lines.hintFor('nope', 'D2', 'en')).toBe('');
  });

  test('the one line is unchanged (lineFor still reads the first sentence)', () => {
    expect(Lines.lineFor('fico17_v6', 'D2', 'en')).toBe('How much of the class speaks on their own.');
  });
});

// ── FICO17 v6.1: the draft view ─────────────────────────────────────────────

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

function deps(lang = 'en') {
  const row = {
    id: SID, user_id: '7eac0000-0000-4000-8000-000000000003', observer_user_id: COACH, observation_type: 'leader_observation',
    audio_url: 'https://r2.example/bucket/classroom_audio/x/wa.ogg', status: 'awaiting_observer_review', debrief_status: 'pending',
    framework: 'fico17_v6', created_at: '2026-11-22T04:30:00Z', analysis_data: v6Analysis(),
  };
  return {
    supabase: fakeSupabase({ users: () => ({ id: COACH, role: 'coach', phone_number: '923000000000', preferred_language: lang }), coaching_sessions: () => row }),
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
    languageFor: jest.fn().mockResolvedValue(lang),
    state: { getState: jest.fn().mockResolvedValue(null), clearState: jest.fn() },
    observationNotes: { notesOf: () => [], REVIEW_KEY: 'observation_notes_review_opened_at', markReviewOpened: jest.fn() },
    notesOn: jest.fn().mockResolvedValue(false),
    debrief: { buildDebriefGuide: jest.fn(), mergeObserverDebrief: jest.fn() },
    log: jest.fn(),
    now: () => new Date('2026-11-22T05:00:00Z'),
  };
}

const allInd = (out) => out.sections.flatMap((s) => s.indicators || []);

describe('FICO17 v6.1 draft view — the six carry `hint`', () => {
  let Svc;
  beforeEach(() => { jest.resetModules(); Svc = require(SVC); });

  test('in English: the six get their hint beside `about`; the eleven get none', async () => {
    const out = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, deps('en'));
    const inds = allInd(out);
    expect(inds).toHaveLength(17);
    for (const i of inds) {
      if (i.kind === 'combined') expect(i.hint).toBe(Lines.hintFor('fico17_v6', i.id, 'en'));
      else expect(i).not.toHaveProperty('hint');
    }
    expect(inds.find((i) => i.id === 'D2').hint).toBe("Chorus answers don't count.");
    // additive: `recording` (youAdd included, for an older portal) and `about` are unchanged
    expect(inds.find((i) => i.id === 'D2').about).toBe('How much of the class speaks on their own.');
    expect(typeof inds.find((i) => i.id === 'D2').recording.youAdd).toBe('string');
  });

  test('in Urdu for an Urdu coach', async () => {
    const out = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, deps('ur'));
    for (const i of allInd(out).filter((x) => x.kind === 'combined')) {
      expect(i.hint).toBe(Lines.hintFor('fico17_v6', i.id, 'ur'));
      expect(i.hint).toMatch(URDU);
    }
  });
});

// ── FICO-S v1.2: the Digital Coach's findings on its item field ─────────────

const itemOf = (secs, code) => secs.flatMap((s) => s.parts).find((p) => p.type === 'field' && p.name === code);
const DC = {
  levels: {
    C1: { result: 3, because: 'Two open questions.', evidence: [{ time: '04:30', quote: 'Why seven?' }, { time: '09:12', quote: 'How do you know?' }, { quote: '  ' }] },
    C2: { result: 'IE', because: 'Too noisy to hear.', evidence: [] },
    C4: { result: 'IE', because: 'Hard to hear.', evidence: [{ time: '11:00', quote: 'Tell me more.' }] },
    C5: { result: 2, because: '', evidence: [] },
    E3: { result: 2, because: 'Starred.', evidence: [{ time: '01:00', quote: 'Starred quote' }] },
  },
};

describe('FICO-S v1.2 portal sections — `dcEvidence` on a Digital Coach visit', () => {
  test('a level with its reason and quotes: because and every quote with a time, in order; blank quotes dropped', () => {
    const c1 = itemOf(FF.portalSections({}, 'en', { dc: DC, rubric: 'fico_s_v1_2' }), 'C1');
    expect(c1.dcEvidence).toEqual({ because: 'Two open questions.', items: [{ time: '04:30', quote: 'Why seven?' }, { time: '09:12', quote: 'How do you know?' }] });
  });

  test('no level (could not tell): the quotes only, its reason is already the line above; nothing at all: no field', () => {
    const secs = FF.portalSections({}, 'en', { dc: DC, rubric: 'fico_s_v1_2' });
    expect(itemOf(secs, 'C4').dcEvidence).toEqual({ because: '', items: [{ time: '11:00', quote: 'Tell me more.' }] });
    expect(itemOf(secs, 'C2')).not.toHaveProperty('dcEvidence');
    expect(itemOf(secs, 'C5')).not.toHaveProperty('dcEvidence');
    expect(itemOf(secs, 'C6')).not.toHaveProperty('dcEvidence');
  });

  test('a starred indicator, or a visit without the Digital Coach: no field', () => {
    expect(itemOf(FF.portalSections({}, 'en', { dc: DC, rubric: 'fico_s_v1_2' }), 'E3')).not.toHaveProperty('dcEvidence');
    const plain = FF.portalSections({}, 'en', { rubric: 'fico_s_v1_2' }).flatMap((s) => s.parts).filter((p) => p.type === 'field');
    for (const p of plain) expect(p).not.toHaveProperty('dcEvidence');
  });

  test('the item field is otherwise unchanged (options with N/A last, text, about)', () => {
    const withDc = itemOf(FF.portalSections({}, 'en', { dc: DC, rubric: 'fico_s_v1_2' }), 'C2');
    const plain = itemOf(FF.portalSections({}, 'en', { rubric: 'fico_s_v1_2' }), 'C2');
    expect(withDc.options).toEqual(plain.options);
    expect(withDc.options.map((o) => o.id)).toEqual(['1', '2', '3', '4', 'NA']);
    expect(withDc.text).toBe(plain.text);
  });
});
