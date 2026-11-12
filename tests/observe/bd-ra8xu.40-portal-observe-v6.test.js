'use strict';
/**
 * bd-ra8xu.40 — a FICO17 v6 visit reviewed on the PORTAL: everything the WhatsApp v6 review Flow
 * (observe-fico17_v6-flow.json + observe-mewaka-endpoint) lets the coach do —
 *   - edit Rumi's evidence (and "to improve") on the 11 Rumi scores;
 *   - set the six combined levels from the room, each with a written reason (≥ 20 characters);
 *   - D2's two counts (a level off the counts needs a number in the reason);
 *   - change one of Rumi's 11 levels, with the section's "why you changed" reason —
 * with the Flow's own rules (observe-fico17-v6.validateScreen) and the Flow's own save (applyObserverEdits), and the
 * tiny rubric label (framework + version only). Before this, the portal served a v6 visit V3's screens and its save
 * dropped why_/chg_/d2_ (operator 12 Nov: "We need these on the portal as well").
 */

const SVC = '../../bot/shared/services/observe/portal-observe.service';
const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');

const COACH = 'c0ac0000-0000-4000-8000-000000000001';
const TEACHER_UID = '7eac0000-0000-4000-8000-000000000003';
const SID = 'cs-v6-1';
const WHY = 'Called Ali and Sana by name before asking, twice.';

function fakeSupabase(answer = {}) {
  const writes = { updates: [] };
  const from = (table) => {
    const q = { filters: {} };
    const self = new Proxy(q, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === 'update') return (patch) => { target.patch = patch; return self; };
        if (prop === 'eq') return (c, v) => { target.filters[c] = v; return self; };
        if (prop === 'single' || prop === 'maybeSingle') {
          return async () => {
            if (target.patch) writes.updates.push({ table, patch: target.patch });
            const fn = answer[table];
            return { data: typeof fn === 'function' ? fn(target.filters) : (fn ?? null), error: null };
          };
        }
        return () => self;
      },
    });
    return self;
  };
  return { from, writes };
}

/** A v6 analysis as the v6 DC scorer leaves it: Rumi's 11 levels, the six with evidence only. */
function v6Analysis(over = {}) {
  const levels = {};
  const domains = { v6_teacher: { indicators: [] }, v6_children: { indicators: [] }, v6_subject: { indicators: [] } };
  for (const code of v6.CODES) {
    const row = { id: code, name: v6.indicator(code).name };
    if (v6.isDc(code)) {
      levels[code] = { result: 3, because: `Rumi saw ${code} twice.`, evidence: [{ time: '03:10', quote: `Quote for ${code}` }] };
      Object.assign(row, { result: 3, score: 3, evidence: `Rumi saw ${code} twice.`, improvement: `Next for ${code}` });
    }
    domains[v6.DOMAIN_OF[code]].indicators.push(row);
  }
  return {
    framework: 'fico17_v6', rubric: 'fico17_v6', levels, domains,
    combined_evidence: { C3: { result: 'OK', items: [{ time: '05:00', quote: 'Ali, what do you think?' }] }, D2: { student_turns_first_half: 4, student_turns_second_half: 7 } },
    lp_fidelity: null,
    ...over,
  };
}

function obsRow(over = {}) {
  return {
    id: SID, user_id: TEACHER_UID, observer_user_id: COACH, observation_type: 'leader_observation',
    audio_url: 'https://r2.example/bucket/classroom_audio/x/wa.ogg', status: 'awaiting_observer_review', debrief_status: 'pending',
    framework: 'fico17_v6', created_at: '2026-11-12T04:30:00Z', analysis_data: v6Analysis(), ...over,
  };
}

function deps(row) {
  return {
    supabase: fakeSupabase({ users: () => ({ id: COACH, role: 'coach', phone_number: '923000000000', preferred_language: 'en' }), coaching_sessions: () => row }),
    draft: {
      buildScreenPrefill: jest.fn((a, key) => (key === 'lesson_plan_fidelity'
        ? { has_fidelity: false, no_fidelity: true, fid_header: '', fid_fallback: 'No lesson plan was provided.', mv_1: '', mv_1_v: false, fr_1: 'not_adjudicable', fe_1: '', mv_2: '', mv_2_v: false, fr_2: 'not_adjudicable', fe_2: '' }
        : {})),
      applyObserverEdits: jest.fn().mockResolvedValue({ indicators_rescored: 2, text_fields_changed: 1 }),
      FIDELITY_VERDICT_OPTIONS: [{ id: 'executed', title: '✓ Executed' }],
      MAX_MOVE_SLOTS: 2,
      fid: (id) => String(id).replace(/\./g, '_'),
    },
    pack: () => ({
      domainOrder: ['lesson_plan_fidelity', 'high_leverage_practices'],
      domains: {
        lesson_plan_fidelity: { key: 'B', title: 'Lesson Plan Fidelity', indicators: [] },
        high_leverage_practices: { key: 'C', title: 'High-Leverage Practices', indicators: [{ id: 'C1', name: 'V3 C1' }] },
      },
      scaleOptions: [{ id: '1', title: '1 · Developing' }],
    }),
    languageFor: jest.fn().mockResolvedValue('en'),
    state: { getState: jest.fn().mockResolvedValue(null), clearState: jest.fn() },
    log: jest.fn(),
    now: () => new Date('2026-11-12T05:00:00Z'),
  };
}

/** Every field the v6 form sends, valid: the six set with reasons, D2 counts, Rumi's 11 kept. */
function validEdits(over = {}) {
  const e = {};
  for (const code of v6.CODES) {
    if (v6.isCombined(code)) { e[`r_${code}`] = '3'; e[`why_${code}`] = WHY; } else { e[`r_${code}`] = '3'; e[`ev_${code}`] = `Rumi saw ${code} twice.`; e[`imp_${code}`] = `Next for ${code}`; }
  }
  e.d2_children = '4';
  e.d2_quiet_later = '1';
  e.chg_C = ''; e.chg_D = ''; e.chg_F = '';
  return { ...e, ...over };
}

let Svc;
beforeEach(() => { jest.resetModules(); Svc = require(SVC); });

const section = (out, key) => out.sections.find((s) => s.key === key);
const ind = (out, code) => out.sections.flatMap((s) => s.indicators || []).find((i) => i.id === code);

describe('getDraft — a v6 visit gets the v6 review, not V3\'s screens', () => {
  test('B, then C/D/F with the 17, the rubric label, and kind fico17_v6', async () => {
    const out = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, deps(obsRow()));
    expect(out).toMatchObject({ status: 'ok', kind: 'fico17_v6', editable: true, saved: false, rubric: { id: 'fico17_v6', label: 'FICO17 v6' }, minReason: 20 });
    expect(out.sections.map((s) => [s.key, s.letter, s.kind])).toEqual([
      ['lesson_plan_fidelity', 'B', 'moves'],
      ['v6_teacher', 'C', 'v6'], ['v6_children', 'D', 'v6'], ['v6_subject', 'F', 'v6'],
    ]);
    expect(section(out, 'v6_teacher').indicators.map((i) => i.id)).toEqual(v6.SECTIONS.C.codes);
    expect(section(out, 'v6_teacher').title).toBe('What the teacher does');
  });

  test('one of Rumi\'s 11: Rumi\'s level pre-filled and ringed, Rumi\'s evidence editable, N/A and Couldn\'t tell offered', async () => {
    const out = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, deps(obsRow()));
    const c1 = ind(out, 'C1');
    expect(c1).toMatchObject({ kind: 'dc', field: 'C1', rumi: '3', rating: '3', improvement: 'Next for C1' });
    expect(c1.evidence).toContain('Rumi saw C1 twice.');
    expect(c1.options.map((o) => o.id)).toEqual(['1', '2', '3', '4', 'NA', 'IE']);
  });

  test('one of the six: blank, with the definition and Rumi\'s evidence above it, and its own options', async () => {
    const out = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, deps(obsRow()));
    const c3 = ind(out, 'C3');
    expect(c3).toMatchObject({ kind: 'combined', field: 'C3', rating: '', why: '' });
    expect(c3.body).toContain(v6.indicator('C3').definition);
    expect(c3.body).toContain('Ali, what do you think?');
    expect(c3.options.map((o) => o.id)).toEqual(['1', '2', '3', '4']);
    expect(ind(out, 'D2')).toMatchObject({ d2: { children: '', quietLater: '' } });
    expect(ind(out, 'D2').body).toContain('4 student turns in the first half');
    expect(section(out, 'v6_teacher').changeReason).toBe('');
  });

  test('once saved, the coach\'s own answers come back: her levels, reasons, counts and change reason', async () => {
    const a = v6Analysis();
    const O = require('../../bot/shared/services/observe/observe-fico17-v6');
    const edits = validEdits({ r_C1: '2', chg_C: 'Only one open question was asked, not two.', ev_C1: 'One open question at 03:10.', d2_children: '4', d2_quiet_later: '1' });
    O.applyReview(a, O.buildReview(a, edits), edits, v6Analysis());
    const out = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, deps(obsRow({ status: 'observer_review_complete', analysis_data: a })));
    expect(out.saved).toBe(true);
    expect(ind(out, 'C1')).toMatchObject({ rating: '2', rumi: '3', evidence: 'One open question at 03:10.' });
    expect(ind(out, 'C3')).toMatchObject({ rating: '3', why: WHY });
    expect(ind(out, 'D2')).toMatchObject({ d2: { children: '4', quietLater: '1' } });
    expect(section(out, 'v6_teacher').changeReason).toBe('Only one open question was asked, not two.');
  });

  test('a V3 visit is served as before, with its own label', async () => {
    const out = await Svc.getDraft({ userId: COACH, coachingSessionId: SID }, deps(obsRow({ framework: null, analysis_data: { framework: 'fico', domains: {} } })));
    expect(out.kind).toBeUndefined();
    expect(out.rubric).toEqual({ id: 'fico_v3', label: 'FICO V3' });
    expect(out.sections.map((s) => s.key)).toEqual(['lesson_plan_fidelity', 'high_leverage_practices']);
  });
});

describe('saveDraft — the v6 Flow\'s rules and the v6 Flow\'s save', () => {
  test('a complete review is saved through applyObserverEdits with why_/chg_/d2_ kept', async () => {
    const d = deps(obsRow());
    const edits = validEdits({ r_C1: '2', chg_C: 'Only one open question was asked, not two.' });
    const out = await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits: { ...edits, junk: 'x' } }, d);
    expect(out).toEqual({ status: 'ok', summary: { indicators_rescored: 2, text_fields_changed: 1 } });
    const sent = d.draft.applyObserverEdits.mock.calls[0][1];
    expect(sent).toMatchObject({ why_C3: WHY, chg_C: 'Only one open question was asked, not two.', d2_children: '4', d2_quiet_later: '1', r_C1: '2' });
    expect(sent).not.toHaveProperty('junk');
  });

  test('refused, with every reason, when a room level or its reason is missing — nothing is saved', async () => {
    const d = deps(obsRow());
    const out = await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits: validEdits({ r_C3: '', why_D3: 'too short' }) }, d);
    expect(out.status).toBe('invalid');
    expect(out.reason).toBe('v6_review');
    expect(Object.keys(out.errors).sort()).toEqual(['r_C3', 'why_D3']);
    expect(out.errors.r_C3).toMatch(/Choose a level/);
    expect(d.draft.applyObserverEdits).not.toHaveBeenCalled();
  });

  test('changing one of Rumi\'s levels needs the section\'s reason', async () => {
    const d = deps(obsRow());
    const out = await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits: validEdits({ r_F1: '1' }) }, d);
    expect(out).toMatchObject({ status: 'invalid', reason: 'v6_review' });
    expect(Object.keys(out.errors)).toEqual(['chg_F']);
  });

  test('D2: the counts must add up, and a level off the counts needs a number in the reason', async () => {
    const bad = await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits: validEdits({ d2_children: '2', d2_quiet_later: '5' }) }, deps(obsRow()));
    expect(Object.keys(bad.errors)).toEqual(['d2_children']);
    const off = await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits: validEdits({ r_D2: '4', why_D2: 'Lots of children were talking in groups.' }) }, deps(obsRow()));
    expect(Object.keys(off.errors)).toEqual(['why_D2']);
  });

  test('a V3 visit still drops the v6-only keys (byte-identical save)', async () => {
    const d = deps(obsRow({ framework: null, analysis_data: { framework: 'fico', domains: {} } }));
    await Svc.saveDraft({ userId: COACH, coachingSessionId: SID, edits: { r_C1: '2', why_C3: WHY, chg_C: 'x', d2_children: '3' } }, d);
    expect(d.draft.applyObserverEdits).toHaveBeenCalledWith(SID, { r_C1: '2' });
  });
});

describe('observationView — the tiny rubric label', () => {
  test('framework + version only', async () => {
    const d = { ...deps(obsRow()), people: { teacherOf: jest.fn().mockResolvedValue(null) }, r2: { getPresignedUrl: jest.fn(), buildR2PublicUrl: (k) => k } };
    const out = await Svc.observationView({ userId: COACH, coachingSessionId: SID }, d);
    expect(out.rubric).toEqual({ id: 'fico17_v6', label: 'FICO17 v6' });
  });
});
