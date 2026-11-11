/**
 * bd-ra8xu.38 — /observe on FICO17 v6 behind the coach switch (fico_coach_rubric).
 *
 * Switch OFF ('current'): today's FICO V3 pack and Flow JSON, byte-identical.
 * A visit whose rubric was decided v6 at creation (coaching_sessions.framework = 'fico17_v6', stamped once) gets the
 * v6 pack, the v6 Flow, coach-set combined levels with a reason, and Rumi's 11 DC levels pre-filled (a change needs
 * a reason). Every stored level carries rubric + prompt_version + set_by.
 */

process.env.OBSERVE_FRAMEWORK = 'fico';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

jest.mock('../../bot/shared/services/coaching/fico-rubric-switch', () => ({
  coachRubric: jest.fn(async () => 'current'),
}));

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const v6 = require('../../bot/shared/services/coaching/frameworks/fico17-v6');
const switchMod = require('../../bot/shared/services/coaching/fico-rubric-switch');
const { getObservePack } = require('../../bot/shared/services/observe/observe-framework');
const O6 = require('../../bot/shared/services/observe/observe-fico17-v6');

const BOT = path.join(__dirname, '../../bot');
const V3_FLOW = path.join(BOT, 'docs/flows/observe-fico-flow.json');
const V6_FLOW = path.join(BOT, 'docs/flows/observe-fico17_v6-flow.json');
const cp = (s) => Array.from(String(s || '')).length;

describe('switch OFF — /observe stays FICO V3, byte-identical', () => {
  test('getObservePack() with no visit, a V3 visit or an unknown stamp is today\'s V3 pack', () => {
    const today = getObservePack();
    expect(today.key).toBe('fico');
    expect(getObservePack({ framework: 'fico' })).toEqual(today);
    expect(getObservePack({ framework: null })).toEqual(today);
    expect(getObservePack({ framework: 'something-else' })).toEqual(today);
    expect(today.screenIds).toEqual(['DOMAIN_B', 'DOMAIN_C', 'DOMAIN_D', 'DOMAIN_F']);
  });

  test('regenerating the V3 Flow JSON leaves it byte-identical', () => {
    const before = fs.readFileSync(V3_FLOW, 'utf8');
    execFileSync('node', ['scripts/generate-observe-flow-json.js'], { cwd: BOT, env: { ...process.env, OBSERVE_FRAMEWORK: 'fico', OBSERVE_RUBRIC: '' }, stdio: 'pipe' });
    expect(fs.readFileSync(V3_FLOW, 'utf8')).toBe(before);
  });

  test('/observe stays V3 while OBSERVE_FICO17_V6_READY is unset, even with the coach switch on v6 (it moves /observe2 only)', async () => {
    delete process.env.OBSERVE_FICO17_V6_READY;
    switchMod.coachRubric.mockClear();
    switchMod.coachRubric.mockResolvedValue('v6');
    expect(await O6.decideVisitFramework({ userId: 'u1', region: 'Sihala' })).toBeNull();
    process.env.OBSERVE_FICO17_V6_READY = 'yes';
    expect(await O6.decideVisitFramework({ userId: 'u1', region: 'Sihala' })).toBeNull();
    switchMod.coachRubric.mockReset();
    delete process.env.OBSERVE_FICO17_V6_READY;
  });

  test('a visit is stamped only when the coach switch says v6 on a FICO deployment (readiness flag set)', async () => {
    process.env.OBSERVE_FICO17_V6_READY = 'true';
    switchMod.coachRubric.mockResolvedValueOnce('current');
    expect(await O6.decideVisitFramework({ userId: 'u1', region: 'Sihala' })).toBeNull();
    switchMod.coachRubric.mockResolvedValueOnce('v6');
    expect(await O6.decideVisitFramework({ userId: 'u1', region: 'Sihala' })).toBe('fico17_v6');
    expect(switchMod.coachRubric).toHaveBeenLastCalledWith({ userId: 'u1', region: 'Sihala' });
    const was = process.env.OBSERVE_FRAMEWORK;
    process.env.OBSERVE_FRAMEWORK = 'mewaka';
    switchMod.coachRubric.mockClear();
    expect(await O6.decideVisitFramework({ userId: 'u1', region: 'x' })).toBeNull();
    expect(switchMod.coachRubric).not.toHaveBeenCalled();
    process.env.OBSERVE_FRAMEWORK = was;
    switchMod.coachRubric.mockRejectedValueOnce(new Error('boom'));
    expect(await O6.decideVisitFramework({ userId: 'u1' })).toBeNull();
    delete process.env.OBSERVE_FICO17_V6_READY;
  });
});

describe('a v6 visit — the stamp decides, never the live switch', () => {
  test('the stamp on the session (or its analysis) selects the v6 pack', () => {
    expect(O6.visitFramework({ framework: 'fico17_v6' })).toBe('fico17_v6');
    expect(O6.visitFramework({ framework: 'fico', analysis_data: { framework: 'fico17_v6' } })).toBe('fico17_v6');
    expect(O6.visitFramework({ framework: 'fico' })).toBeNull();
    expect(O6.visitFramework(null)).toBeNull();
    expect(O6.frameworkKeyForSession({ observation_type: 'leader_observation', framework: 'fico17_v6' })).toBe('fico17_v6');
    expect(O6.frameworkKeyForSession({ observation_type: 'teacher_recording', framework: 'fico17_v6' })).toBeNull();
  });

  test('v6 pack: B (measured fidelity, as V3) then C/D/F with the 17 v6 codes', () => {
    const p = getObservePack({ framework: 'fico17_v6' });
    expect(p.key).toBe('fico17_v6');
    expect(p.screenIds).toEqual(['DOMAIN_B', 'DOMAIN_C', 'DOMAIN_D', 'DOMAIN_F']);
    expect(p.domainOrder).toEqual(['lesson_plan_fidelity', 'v6_teacher', 'v6_children', 'v6_subject']);
    const codes = p.domainOrder.slice(1).flatMap((k) => p.domains[k].indicators.map((i) => i.id));
    expect(codes.sort()).toEqual(v6.CODES.slice().sort());
    expect(p.domains.lesson_plan_fidelity).toEqual(getObservePack().domains.lesson_plan_fidelity);
    expect(p.flowIdEnv).toBe('OBSERVE_FICO17_V6_FLOW_ID');
  });
});

describe('the v6 /observe Flow JSON', () => {
  const flow = JSON.parse(fs.readFileSync(V6_FLOW, 'utf8'));
  const comps = (s) => {
    const out = [];
    const walk = (list) => (list || []).forEach((c) => { out.push(c); if (c.children) walk(c.children); });
    walk(s.layout.children);
    return out;
  };
  const form = (s) => s.layout.children[0];
  const screen = (id) => flow.screens.find((s) => s.id === id);

  test('B/C/D/F + SUCCESS, forward-only', () => {
    expect(flow.screens.map((s) => s.id)).toEqual(['DOMAIN_B', 'DOMAIN_C', 'DOMAIN_D', 'DOMAIN_F', 'SUCCESS']);
    expect(flow.routing_model.DOMAIN_F).toEqual(['SUCCESS']);
  });

  test('combined levels: required, no init-value; a required reason box', () => {
    for (const code of v6.COMBINED_CODES) {
      const s = screen(`DOMAIN_${code[0]}`);
      const radio = comps(s).find((c) => c.name === `r_${code}`);
      expect(radio).toBeTruthy();
      expect(radio.required).toBe(true);
      expect(form(s)['init-values'][`r_${code}`]).toBeUndefined();
      const why = comps(s).find((c) => c.name === `why_${code}`);
      expect(why.type).toBe('TextArea');
      expect(why.required).toBe(true);
    }
    const d = comps(screen('DOMAIN_D'));
    expect(d.find((c) => c.name === 'd2_children')).toMatchObject({ type: 'TextInput', 'input-type': 'number', required: true });
    expect(d.find((c) => c.name === 'd2_quiet_later')).toMatchObject({ type: 'TextInput', 'input-type': 'number', required: true });
  });

  test('C5 offers the timed options', () => {
    const radio = comps(screen('DOMAIN_C')).find((c) => c.name === 'r_C5');
    expect(radio['data-source'].map((o) => o.title)).toEqual([...v6.TITLES.C5, 'No switch']);
  });

  test('DC levels are pre-filled from Rumi; each screen has a "Why you changed" box', () => {
    for (const code of v6.DC_CODES) {
      const s = screen(`DOMAIN_${code[0]}`);
      expect(form(s)['init-values'][`r_${code}`]).toBe(`\${data.s_${code}}`);
    }
    for (const id of ['DOMAIN_C', 'DOMAIN_D', 'DOMAIN_F']) {
      const chg = comps(screen(id)).find((c) => c.name === `chg_${id.slice(-1)}`);
      expect(chg).toMatchObject({ type: 'TextArea', required: false });
    }
  });

  test('Meta limits: option title ≤30, description ≤300, TextArea/TextInput label ≤20, helper ≤80; ≤50 components', () => {
    for (const s of flow.screens) {
      const all = comps(s);
      expect(all.length).toBeLessThanOrEqual(50);
      for (const c of all) {
        if (Array.isArray(c['data-source'])) {
          c['data-source'].forEach((o) => { expect(cp(o.title)).toBeLessThanOrEqual(30); if (o.description) expect(cp(o.description)).toBeLessThanOrEqual(300); });
        }
        if (c.type === 'RadioButtonsGroup') expect(cp(c.label)).toBeLessThanOrEqual(30);
        if (c.type === 'TextArea' || c.type === 'TextInput') {
          expect(cp(c.label)).toBeLessThanOrEqual(20);
          if (c['helper-text']) expect(cp(c['helper-text'])).toBeLessThanOrEqual(80);
        }
      }
    }
  });

  test('every ${data.x} the screens bind is declared in that screen\'s data', () => {
    for (const s of flow.screens) {
      const text = JSON.stringify(s.layout);
      const used = new Set([...text.matchAll(/\$\{data\.([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]));
      used.forEach((k) => expect(Object.keys(s.data)).toContain(k));
    }
  });
});

describe('validation and storage (endpoint helpers)', () => {
  const analysis = {
    framework: 'fico17_v6',
    rubric: 'fico17_v6',
    prompt_version: 'fico17-v6-dc-1+abcd1234',
    levels: { C1: { result: 3, because: 'two open questions' }, C2: { result: 'NA', because: 'no wrong answers' }, C4: { result: 2 }, C6: { result: 2 }, C8: { result: 1 } },
    combined_evidence: { C3: { result: null, items: [{ time: '05:10', quote: 'Ali, what do you think?', kind: 'name_called' }] } },
  };

  test('a combined level is refused without a level or with a reason under 20 characters', () => {
    const base = { r_C1: '3', r_C2: 'NA', r_C4: '2', r_C6: '2', r_C8: '1', r_C5: '3', why_C5: 'Under two minutes by my watch.', r_C7: 'NA', why_C7: 'No group work in this lesson at all.' };
    expect(O6.validateScreen('DOMAIN_C', { ...base, why_C3: 'Long enough reason for C3 here.' }, analysis).r_C3).toBeTruthy();
    expect(O6.validateScreen('DOMAIN_C', { ...base, r_C3: '2', why_C3: 'too short' }, analysis).why_C3).toBeTruthy();
    expect(O6.validateScreen('DOMAIN_C', { ...base, r_C3: '2', why_C3: 'The teacher pointed at two children.' }, analysis)).toEqual({});
  });

  test('changing a pre-filled DC level without a reason is refused', () => {
    const ok = { r_C1: '3', r_C2: 'NA', r_C4: '2', r_C6: '2', r_C8: '1', r_C3: '2', why_C3: 'The teacher pointed at two children.', r_C5: '3', why_C5: 'Under two minutes by my watch.', r_C7: 'NA', why_C7: 'No group work in this lesson at all.' };
    expect(O6.validateScreen('DOMAIN_C', { ...ok, r_C1: '4' }, analysis).chg_C).toBeTruthy();
    expect(O6.validateScreen('DOMAIN_C', { ...ok, r_C1: '4', chg_C: 'She asked why and followed up with Ali.' }, analysis)).toEqual({});
  });

  test('D2: numbers checked, and a level that does not match the counts needs a number in the reason', () => {
    const ok = { r_D1: '1', r_D5: '1', r_D3: 'NA', why_D3: 'No child spoke to another child.', r_D4: '2', why_D4: 'They only answered when they were sure.' };
    expect(O6.validateScreen('DOMAIN_D', { ...ok, d2_children: '3', d2_quiet_later: '5', r_D2: '3', why_D2: 'Front rows only answered today.' }, {}).d2_children).toBeTruthy();
    expect(O6.validateScreen('DOMAIN_D', { ...ok, d2_children: '4', d2_quiet_later: '0', r_D2: '2', why_D2: 'Front rows only answered today.' }, {}).why_D2).toBeTruthy();
    expect(O6.validateScreen('DOMAIN_D', { ...ok, d2_children: '4', d2_quiet_later: '0', r_D2: '2', why_D2: 'Two of the 4 only read the answer out.' }, {})).toEqual({});
    expect(O6.validateScreen('DOMAIN_D', { ...ok, d2_children: '7', d2_quiet_later: '2', r_D2: '4', why_D2: 'Back rows joined in the group work.' }, {})).toEqual({});
  });

  test('stored levels carry rubric, prompt_version and who set them; totals are v6 only', () => {
    const edits = {
      r_C1: '4', chg_C: 'She asked why and followed up with Ali.', r_C2: 'NA', r_C4: '2', r_C6: '2', r_C8: '1',
      r_C3: '2', why_C3: 'The teacher pointed at two children.', r_C5: '3', why_C5: 'Under two minutes by my watch.',
      r_C7: 'NA', why_C7: 'No group work in this lesson at all.', d2_children: '4', d2_quiet_later: '1', r_D2: '3', why_D2: 'Four children spoke, front rows.',
    };
    const review = O6.buildReview(analysis, edits);
    expect(review.rubric).toBe('fico17_v6');
    expect(review.levels.C1).toMatchObject({ level: 4, set_by: 'coach', because: 'She asked why and followed up with Ali.', rumi_level: 3, rubric: 'fico17_v6', prompt_version: 'fico17-v6-dc-1+abcd1234' });
    expect(review.levels.C4).toMatchObject({ level: 2, set_by: 'rumi', rubric: 'fico17_v6', prompt_version: 'fico17-v6-dc-1+abcd1234' });
    expect(review.levels.C3).toMatchObject({ level: 2, set_by: 'coach', because: 'The teacher pointed at two children.', rubric: 'fico17_v6', prompt_version: v6.COACH_PROMPT_VERSION });
    expect(review.d2_counts).toEqual({ children: 4, quiet_later: 1 });
    expect(review.totals).toEqual(v6.totals(review.levels));
  });
});
