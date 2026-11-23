'use strict';
/**
 * bd-o15qnr.36 — the six combined indicators (C3 C5 C7 D2 D3 D4) on the v7 Feedback Form (#204, the operator
 * 21 Nov ~14:20-14:30), the server side.
 *
 * The draft view (getDraft) of a FICO17 v6 visit sends, on each of the six (kind 'combined'), beside today's `body`:
 *   recording   { lookFor, state, found: [{ time, quote }], naText, turns, youAdd }
 *                 lookFor  the indicator's definition, in the person's language
 *                 state    'found' | 'none' | 'ie' | 'na' | 'starred' | 'd2'
 *                 found    every snippet the recording did find (quotes clipped as in the body)
 *                 naText   the indicator's own N/A words (state 'na'), else null
 *                 turns    D2's { first, second } student turns (state 'd2'), else null
 *                 youAdd   what the person adds, WITHOUT the rubric's "The coach sets the final level with a written
 *                          justification." (Urdu: «کوچ تحریری وجہ کے ساتھ آخری لیول طے کرتا ہے۔»)
 * Every field the view sent before stays exactly as it was (`body` included: older portals read it).
 *
 * The note under one of the six is optional on the portal: a portal save with a level and no reason is no longer
 * refused. The WhatsApp Flow's own check (validateScreen) is unchanged.
 */

const SVC = '../../bot/shared/services/observe/portal-observe.service';
const O = require('../../bot/shared/services/observe/observe-fico17-v6');
const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');

const COACH = 'c0ac0000-0000-4000-8000-000000000001';
const TEACHER_UID = '7eac0000-0000-4000-8000-000000000003';
const SID = 'cs-v6-36';
const RUBRIC_EN = 'The coach sets the final level with a written justification.';
const RUBRIC_UR = 'کوچ تحریری وجہ کے ساتھ آخری لیول طے کرتا ہے۔';

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

function v6Analysis(over = {}) {
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
  return {
    framework: 'fico17_v6', rubric: 'fico17_v6', levels, domains,
    combined_evidence: {
      C3: { result: null, items: [{ time: '05:00', quote: 'Ali, what do you think?' }, { time: '09:12', quote: 'Sana, you tell us.' }] },
      C5: { result: null, items: [] },
      C7: { result: 'IE', items: [] },
      D2: { student_turns_first_half: 4, student_turns_second_half: 7 },
      D3: { result: 'NA', items: [] },
    },
    lp_fidelity: null,
    ...over,
  };
}

function obsRow(over = {}) {
  return {
    id: SID, user_id: TEACHER_UID, observer_user_id: COACH, observation_type: 'leader_observation',
    audio_url: 'https://r2.example/bucket/classroom_audio/x/wa.ogg', status: 'awaiting_observer_review', debrief_status: 'pending',
    framework: 'fico17_v6', created_at: '2026-11-21T04:30:00Z', analysis_data: v6Analysis(), ...over,
  };
}

function deps(row, lang = 'en') {
  return {
    supabase: fakeSupabase({ users: () => ({ id: COACH, role: 'coach', phone_number: '923000000000', preferred_language: lang }), coaching_sessions: () => row }),
    draft: {
      buildScreenPrefill: jest.fn((a, key) => (key === 'lesson_plan_fidelity'
        ? { has_fidelity: false, no_fidelity: true, fid_header: '', fid_fallback: 'No lesson plan was provided.', mv_1: '', mv_1_v: false, fr_1: 'not_adjudicable', fe_1: '' }
        : {})),
      applyObserverEdits: jest.fn().mockResolvedValue({ indicators_rescored: 0, text_fields_changed: 0 }),
      FIDELITY_VERDICT_OPTIONS: [{ id: 'executed', title: '✓ Executed' }],
      MAX_MOVE_SLOTS: 1,
      fid: (id) => String(id).replace(/\./g, '_'),
    },
    pack: () => ({ domainOrder: ['lesson_plan_fidelity'], domains: { lesson_plan_fidelity: { key: 'B', title: 'Lesson Plan Fidelity', indicators: [] } }, scaleOptions: [] }),
    languageFor: jest.fn().mockResolvedValue(lang),
    state: { getState: jest.fn().mockResolvedValue(null), clearState: jest.fn() },
    observationNotes: { notesOf: () => [], REVIEW_KEY: 'observation_notes_review_opened_at', markReviewOpened: jest.fn() },
    notesOn: jest.fn().mockResolvedValue(false),
    debrief: { buildDebriefGuide: jest.fn().mockResolvedValue({}), mergeObserverDebrief: jest.fn() },
    log: jest.fn(),
    now: () => new Date('2026-11-21T05:00:00Z'),
  };
}

/** Every field the v6 form sends: the six set WITHOUT a reason, Rumi's 11 kept. */
function editsNoReasons() {
  const e = {};
  for (const code of v6.CODES) {
    if (v6.isCombined(code)) { e[`r_${code}`] = '3'; e[`why_${code}`] = ''; } else { e[`r_${code}`] = '3'; e[`ev_${code}`] = `Rumi saw ${code}.`; e[`imp_${code}`] = ''; }
  }
  e.chg_C = ''; e.chg_D = ''; e.chg_F = '';
  return e;
}

const ind = (out, code) => out.sections.flatMap((s) => s.indicators || []).find((i) => i.id === code);

let Svc;
beforeEach(() => { jest.resetModules(); Svc = require(SVC); });

describe('combinedParts — one of the six as parts', () => {
  test('found: the definition, every snippet with its time, You add without the rubric sentence', () => {
    const p = O.combinedParts(v6Analysis(), 'C3', 'en');
    expect(p.lookFor).toBe(v6.indicatorText('C3', 'en').definition);
    expect(p.state).toBe('found');
    expect(p.found).toEqual([{ time: '05:00', quote: 'Ali, what do you think?' }, { time: '09:12', quote: 'Sana, you tell us.' }]);
    expect(p.naText).toBeNull();
    expect(p.turns).toBeNull();
    expect(p.youAdd).not.toContain(RUBRIC_EN);
    expect(p.youAdd).not.toMatch(/justification/);
    expect(p.youAdd.startsWith('choosing that cannot be heard')).toBe(true);
    expect(p.youAdd).toBe(p.youAdd.trim());
  });

  test('none, couldn\'t tell, N/A and D2\'s counts each say which', () => {
    const a = v6Analysis();
    expect(O.combinedParts(a, 'C5', 'en')).toMatchObject({ state: 'none', found: [], naText: null, turns: null });
    expect(O.combinedParts(a, 'C7', 'en')).toMatchObject({ state: 'ie', found: [] });
    expect(O.combinedParts(a, 'D2', 'en')).toMatchObject({ state: 'd2', found: [], turns: { first: 4, second: 7 } });
    // N/A: the indicator's own N/A words where the table has them (C5), else none (D3: the portal says it)
    expect(O.combinedParts(a, 'D3', 'en')).toMatchObject({ state: 'na', naText: null });
    const c5 = O.combinedParts(v6Analysis({ combined_evidence: { C5: { result: 'NA', items: [] } } }), 'C5', 'en');
    expect(c5.state).toBe('na');
    expect(c5.naText).toBe(v6.naSentence('C5', 'en', { by: 'dc' }));
    expect(c5.naText.length).toBeGreaterThan(0);
    // nothing at all for D4 (no entry): none
    expect(O.combinedParts(a, 'D4', 'en')).toMatchObject({ state: 'none', found: [] });
  });

  test('D2 without counts is none, never "showed nothing" words', () => {
    const a = v6Analysis({ combined_evidence: { D2: {} } });
    const p = O.combinedParts(a, 'D2', 'en');
    expect(p).toMatchObject({ state: 'none', turns: null, found: [] });
    expect(JSON.stringify(p)).not.toMatch(/showed nothing/);
  });

  test('Urdu: the definition and You add in Urdu, the rubric sentence gone', () => {
    for (const code of v6.COMBINED_CODES) {
      const p = O.combinedParts(v6Analysis(), code, 'ur');
      expect(p.lookFor).toBe(v6.indicatorText(code, 'ur').definition);
      expect(p.youAdd).not.toContain(RUBRIC_UR);
      expect(p.youAdd).not.toContain('تحریری وجہ');
      expect(p.youAdd.length).toBeGreaterThan(10);
      const en = O.combinedParts(v6Analysis(), code, 'en');
      expect(en.youAdd).not.toContain(RUBRIC_EN);
      expect(en.youAdd.length).toBeGreaterThan(10);
    }
  });
});

describe('getDraft — each of the six carries `recording`, additively', () => {
  test('the six get recording; body, rating and why stay', async () => {
    const out = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, deps(obsRow()));
    for (const code of v6.COMBINED_CODES) {
      const i = ind(out, code);
      expect(i.kind).toBe('combined');
      expect(typeof i.body).toBe('string');
      expect(i.body.length).toBeGreaterThan(0);
      expect(i.recording).toEqual(O.combinedParts(v6Analysis(), code, 'en'));
    }
    // bd-o15qnr.37 adds `about` (the line under the name), additively too
    expect(Object.keys(ind(out, 'C3'))).toEqual(['id', 'field', 'name', 'options', 'kind', 'body', 'rating', 'why', 'recording', 'about']);
    // Rumi's 11 do not get it
    expect(ind(out, 'C1')).not.toHaveProperty('recording');
  });

  test('in Urdu for an Urdu coach', async () => {
    const out = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, deps(obsRow(), 'ur'));
    expect(ind(out, 'C3').recording.lookFor).toBe(v6.indicatorText('C3', 'ur').definition);
  });
});

describe('the note is optional on the portal save', () => {
  test('a portal save with the six set and no reasons is saved', async () => {
    const d = deps(obsRow());
    const out = await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits: editsNoReasons() }, d);
    expect(out.status).toBe('ok');
    expect(d.draft.applyObserverEdits).toHaveBeenCalled();
  });

  test('a level is still needed', async () => {
    const d = deps(obsRow());
    const out = await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits: { ...editsNoReasons(), r_C3: '' } }, d);
    expect(out.status).toBe('invalid');
    expect(Object.keys(out.errors)).toEqual(['r_C3']);
  });

  test('the WhatsApp Flow\'s own check still asks for the reason', () => {
    const errors = O.validateScreen('DOMAIN_C', editsNoReasons(), v6Analysis());
    expect(Object.keys(errors)).toEqual(expect.arrayContaining(['why_C3', 'why_C5', 'why_C7']));
  });
});
