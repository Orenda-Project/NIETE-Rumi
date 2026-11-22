'use strict';
/**
 * bd-o15qnr.37 — one plain line on what each indicator looks at, under its name on the Feedback Form (#204, the operator
 * 22 Nov ~00:15: "On the page of a single indicator, isn't there a gap that there is no description of the indicator?").
 *
 * indicator-lines.lineFor(rubric, code, lang) is the first sentence of the "what it means" line of #217's indicator
 * guides (bd-3xf7vb, approved 21 Nov: "Yes, build as mocked"), English and Urdu, for FICO17 v6.1 (17) and FICO-S v1.2
 * (23; a v1.1 form reads the same lines). Unknown code: ''.
 *
 * The draft view sends it additively:
 *   FICO17 v6.1   every indicator (Rumi's 11 and the six) gets `about`, in the coach's language
 *   FICO-S v1.2   every indicator's item field gets `about`, and `notes`: its text without the look-for paragraph (the
 *                 scoring note, the N/A note when C3 follows C1, and "How: …"), so the portal does not say it twice.
 *                 `text` is unchanged (the form off the switch and the WhatsApp Flow keep it).
 */

const Lines = require('../../bot/shared/services/coaching/frameworks/indicator-lines');
const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const FicoS = require('../../bot/shared/services/coaching/frameworks/fico-s');
const FF = require('../../bot/shared/services/observe/obs612/fico-s-flow');

const SVC = '../../bot/shared/services/observe/portal-observe.service';
const COACH = 'c0ac0000-0000-4000-8000-000000000001';
const SID = 'cs-v6-37';
const URDU = /[؀-ۿ]/;

describe('lineFor — the guide\'s one line, English and Urdu', () => {
  test('FICO17 v6.1: the first sentence of the guide\'s line', () => {
    expect(Lines.lineFor('fico17_v6', 'C1', 'en')).toBe('The kinds of questions the teacher asks, and whether they make children think.');
    expect(Lines.lineFor('fico17_v6', 'C1', 'ur')).toBe('استاد کس طرح کے سوال پوچھتا ہے، اور کیا وہ بچوں کو سوچنے پر لگاتے ہیں۔');
    expect(Lines.lineFor('fico17_v6', 'C3', 'en')).toBe('How the teacher chooses who answers: only hands up and call-outs, or ways of bringing in other children.');
    expect(Lines.lineFor('fico17_v6', 'D4', 'ur')).toBe('کیا بچے یقین نہ ہونے پر بھی جواب دینے کی ہمت کرتے ہیں۔');
  });

  test('FICO-S v1.2 (and a v1.1 form): the same lines', () => {
    expect(Lines.lineFor('fico_s_v1_2', 'A1', 'en')).toBe('Whether students are told what they will learn today, the lesson matches this week\'s SOW, and the activities serve it.');
    expect(Lines.lineFor('fico_s_v1_1', 'A1', 'en')).toBe(Lines.lineFor('fico_s_v1_2', 'A1', 'en'));
    expect(Lines.lineFor('fico_s_v1_2', 'C3', 'ur')).toBe('استاد کیسے چنتا ہے کہ کون جواب دے: صرف ہاتھ اٹھانے یا خود بولنے والے، یا دوسروں کو شامل کرنے کے سوچے سمجھے طریقے۔');
    expect(Lines.lineFor('fico_s_v1_2', 'E3', 'en')).toBe('Look at 3 random notebooks: is recent work there and checked, does the feedback say what to improve, and do students act on it?');
  });

  test('every indicator of both rubrics has one short line in each language', () => {
    for (const [rubric, codes] of [['fico17_v6', v6.CODES], ['fico_s_v1_2', FicoS.CODES]]) {
      for (const code of codes) {
        const en = Lines.lineFor(rubric, code, 'en');
        const ur = Lines.lineFor(rubric, code, 'ur');
        expect(en.length).toBeGreaterThan(15);
        expect(en.length).toBeLessThanOrEqual(140);
        expect(en).not.toMatch(URDU);
        expect(ur).toMatch(URDU);
        expect(ur.length).toBeLessThanOrEqual(140);
      }
    }
    expect(v6.CODES).toHaveLength(17);
    expect(FicoS.CODES).toHaveLength(23);
  });

  test('an unknown indicator or rubric: no line', () => {
    expect(Lines.lineFor('fico17_v6', 'Z9', 'en')).toBe('');
    expect(Lines.lineFor('nope', 'C1', 'en')).toBe('');
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

describe('FICO17 v6.1 draft view — every indicator carries `about`', () => {
  let Svc;
  beforeEach(() => { jest.resetModules(); Svc = require(SVC); });

  test('Rumi\'s 11 and the six, in English', async () => {
    const out = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, deps('en'));
    const inds = allInd(out);
    expect(inds).toHaveLength(17);
    for (const i of inds) expect(i.about).toBe(Lines.lineFor('fico17_v6', i.id, 'en'));
    expect(inds.find((i) => i.id === 'C3').kind).toBe('combined');
    expect(inds.find((i) => i.id === 'C1').kind).toBe('dc');
  });

  test('in Urdu for an Urdu coach', async () => {
    const out = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, deps('ur'));
    for (const i of allInd(out)) expect(i.about).toBe(Lines.lineFor('fico17_v6', i.id, 'ur'));
  });
});

// ── FICO-S v1.2: the portal's sections ──────────────────────────────────────

const itemOf = (secs, code) => secs.flatMap((s) => s.parts).find((p) => p.type === 'field' && p.name === code);

describe('FICO-S v1.2 portal sections — `about` and `notes` on each indicator', () => {
  test('C5: about is the line; notes keep the scoring note and How, not the look-for; text unchanged', () => {
    const secs = FF.portalSections({}, 'en', {});
    const c5 = itemOf(secs, 'C5');
    const t = FicoS.indicatorText('C5', 'en');
    expect(c5.about).toBe(Lines.lineFor('fico_s_v1_2', 'C5', 'en'));
    expect(c5.notes).not.toContain(t.look_for);
    expect(c5.notes).toContain(t.note);
    expect(c5.notes).toMatch(/^If the class never changes activity[\s\S]*\nHow: In class/);
    expect(c5.text.startsWith(t.look_for)).toBe(true);
  });

  test('an indicator with no note: notes is just How', () => {
    const a1 = itemOf(FF.portalSections({}, 'en', {}), 'A1');
    expect(a1.notes).toBe(`How: ${FicoS.indicatorText('A1', 'en').how}`);
  });

  test('C3 after C1 = 1: the N/A note stays in notes', () => {
    const c3 = itemOf(FF.portalSections({ C1: '1' }, 'en', {}), 'C3');
    expect(c3.notes).toContain(FicoS.naFollowNote('C3', 'en').slice(0, 20));
    expect(c3.follows).toEqual({ code: 'C1', level: '1' });
  });

  test('Urdu: the Urdu line and Urdu notes', () => {
    const a1 = itemOf(FF.portalSections({}, 'ur', {}), 'A1');
    expect(a1.about).toBe(Lines.lineFor('fico_s_v1_2', 'A1', 'ur'));
    expect(a1.notes).toMatch(URDU);
    expect(a1.notes).not.toContain(FicoS.indicatorText('A1', 'ur').look_for);
  });

  test('checklist items and the other boxes get neither', () => {
    const parts = FF.portalSections({}, 'en', {}).flatMap((s) => s.parts).filter((p) => p.type === 'field');
    for (const p of parts) {
      if (FicoS.CODES.includes(p.name)) continue;
      expect(p).not.toHaveProperty('about');
      expect(p).not.toHaveProperty('notes');
    }
  });
});
