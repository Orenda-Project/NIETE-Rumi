/**
 * Where to coach — Rifat's DC pattern engine (dashboard/services/where-to-coach.engine.js), bd-17v39c.4.14.1.
 *
 * Her School Card Spec (28 Oct 2026, rev 18, section "DC pattern engine",
 * https://claude.ai/artifact/EdtxjjD313c3XVKWDAuvmr): "The engine is a pure function of the stored scores and the
 * settings table, so it can be unit-tested with fixed inputs. For example, the worked example above must always return
 * D2 as the focus and F1 as the strength."
 *
 * The inputs are what the database stores on a report: analysis_data.domains (each section's domain_score, domain_max,
 * indicators_applicable and its indicators) and analysis_data.lp_fidelity (the plan steps the grader judged). Each
 * fixture below builds those shapes; nothing is mocked.
 */
const Engine = require('../../dashboard/services/where-to-coach.engine');
const SETTINGS = require('../../dashboard/data/where-to-coach/settings.json');

const KEY = { B: 'lesson_plan_fidelity', C: 'high_leverage_practices', D: 'student_engagement', F: 'teacher_subject_knowledge' };

/**
 * One report's domains. `sections` maps a section code to { pct, size, items: { id: score|null } }: pct is the
 * section's stored % (domain_score ÷ domain_max), size its number of applicable practices; a null score is a practice
 * marked not applicable.
 */
function domainsOf(scaleMax, sections) {
  const out = {};
  for (const [code, s] of Object.entries(sections)) {
    const max = s.size * scaleMax;
    out[KEY[code]] = {
      domain_score: s.pct == null ? null : (s.pct / 100) * max,
      domain_max: max,
      indicators_applicable: s.size,
      indicators: Object.entries(s.items || {}).map(([id, score]) => (score == null
        ? { id, name: `${id} name`, score: null, applicable: false }
        : { id, name: `${id} name`, score })),
    };
  }
  return out;
}

/** lp_fidelity as the grader stores it: one move per [phase, verdict]. */
function planOf(pct, moves) {
  return { status: 'ok', fidelity_pct: pct, moves: moves.map(([phase, verdict], i) => ({ move_id: `m${i}`, phase, verdict, text: `step ${i}` })) };
}

const report = (id, date, domains, lp = null) => ({ id, date, domains, lp_fidelity: lp });

// ── Her worked example: Ayesha, 3 DC sessions and 3 HITL observations this week (v3 scale, 1–4) ───────────────
// Her table: D2 1,2,1 (1.3, 3 of 3) · C4 2,2,1 (1.7, 3 of 3) · D1 2,2,3 (2.3, 2 of 3) · F1 3,4,4 (3.7, 0 of 3);
// sections DC / HITL: D 48% / 50% (agree low), C 61% / 70%, F 84% / 58% (differ).
function ayesha() {
  const dcScores = [
    { D2: 1, C4: 2, D1: 2, F1: 3 },
    { D2: 2, C4: 2, D1: 2, F1: 4 },
    { D2: 1, C4: 1, D1: 3, F1: 4 },
  ];
  const dc = dcScores.map((s, i) => report(`dc${i}`, `2026-10-2${i + 6}`, domainsOf(4, {
    C: { pct: 61, size: 12, items: { C4: s.C4 } },
    D: { pct: 48, size: 7, items: { D2: s.D2, D1: s.D1 } },
    F: { pct: 84, size: 8, items: { F1: s.F1 } },
  })));
  const coach = [0, 1, 2].map((i) => report(`hitl${i}`, `2026-10-2${i + 6}`, domainsOf(4, {
    C: { pct: 70, size: 12, items: { C4: 3 } },
    D: { pct: 50, size: 7, items: { D2: 2, D1: 2 } },
    F: { pct: 58, size: 8, items: { F1: 2 } },
  })));
  return { dc, coach };
}

describe('her worked example (Ayesha)', () => {
  const r = Engine.whereToCoach(ayesha());

  test('focus D2, by test 1, with her why line', () => {
    expect(r.focus.id).toBe('D2');
    expect(r.focus.why).toEqual({ test: 1, reason: 'both' });
  });

  test('weakest practices D2, C4, D1 (the focus, then the two next-lowest averages)', () => {
    expect(r.weakest.map((p) => p.id)).toEqual(['D2', 'C4', 'D1']);
    expect(r.weakest[0].focus).toBe(true);
    expect(r.weakest.slice(1).every((p) => p.focus === false)).toBe(true);
  });

  test('her table: average, low in k of n, latest and change', () => {
    const d2 = r.weakest[0];
    expect(d2).toMatchObject({ id: 'D2', section: 'D', avg: 1.3, scaleMax: 4, k: 3, n: 3, latest: 1, change: 0 });
    expect(r.weakest[1]).toMatchObject({ id: 'C4', avg: 1.7, k: 3, n: 3, latest: 1, change: -1 });
    expect(r.weakest[2]).toMatchObject({ id: 'D1', avg: 2.3, k: 2, n: 3, latest: 3, change: 1 });
  });

  test('strength F1 (highest average of 3 or more, in a different section)', () => {
    expect(r.strength).toMatchObject({ id: 'F1', section: 'F', avg: 3.7, k: 0, n: 3 });
  });

  test('sections: D agree low, F "AI and coach differ", weakest first, focus here on D', () => {
    const by = Object.fromEntries(r.sections.map((s) => [s.code, s]));
    expect(by.D).toMatchObject({ dc: 48, coach: 50, agreeLow: true, differ: false, focusHere: true });
    expect(by.C).toMatchObject({ dc: 61, coach: 70, agreeLow: false, differ: false, focusHere: false });
    expect(by.F).toMatchObject({ dc: 84, coach: 58, agreeLow: false, differ: true });
    expect(r.sections.map((s) => s.code)).toEqual(['D', 'C', 'F']);
  });

  test('3 DC and 3 coach observations: patterns as normal, on the v3 scale', () => {
    expect(r.sessions).toEqual({ dc: 3, coach: 3 });
    expect(r.signal).toBe('patterns');
    expect(r.framework).toBe('fico_v3');
  });

  test('the same inputs always give the same answer', () => {
    expect(Engine.whereToCoach(ayesha())).toEqual(r);
  });
});

// ── Live FICO v3 ids (prod): the mockup's Sana Demo — 6 DC, 2 coach observations, a skipped You Do step ──────────
function sanaV3() {
  const d3 = [1, 2, 1, 2, 2, 1];
  const c1 = [2, 2, 1, 2, 2, 2];
  const d1 = [2, 3, 2, 2, 3, 1];
  const f1 = [4, 4, 3, 4, 4, 3];
  const c8 = [3, 3, 3, 3, 3, 3];
  const dc = d3.map((_, i) => report(`s${i}`, `2026-10-${String(10 + i * 3).padStart(2, '0')}`, domainsOf(4, {
    B: { pct: null, size: 10, items: {} },
    C: { pct: 61, size: 12, items: { C1: c1[i], C8: c8[i], C10: null } },
    D: { pct: 52, size: 7, items: { D3: d3[i], D1: d1[i] } },
    F: { pct: 84, size: 8, items: { F1: f1[i] } },
  }), i < 4 ? planOf(64, [['warm_up', 'executed'], ['explain', 'executed'], ['guided', 'partial'], ['independent', i < 3 ? 'not_done' : 'executed'], ['exit', i < 2 ? 'not_done' : 'executed']]) : null));
  const coach = [0, 1].map((i) => report(`v${i}`, `2026-10-${20 + i}`, domainsOf(4, {
    C: { pct: 70, size: 12, items: { C1: 3, C8: 3 } },
    D: { pct: 50, size: 7, items: { D3: 2, D1: 2 } },
    F: { pct: 58, size: 8, items: { F1: 2 } },
  }), planOf(70, [['independent', 'not_done']])));
  return { dc, coach };
}

describe('live FICO v3 (37 practices, 1–4)', () => {
  const r = Engine.whereToCoach(sanaV3());

  test('focus D3, by test 1 (section D agree low), low in 6 of 6', () => {
    expect(r.focus).toMatchObject({ id: 'D3', section: 'D', k: 6, n: 6, why: { test: 1, reason: 'both' } });
  });

  test('weakest D3, C1, D1; strength F1', () => {
    expect(r.weakest.map((p) => p.id)).toEqual(['D3', 'C1', 'D1']);
    expect(r.weakest.map((p) => p.avg)).toEqual([1.5, 1.8, 2.2]);
    expect(r.strength.id).toBe('F1');
    expect(r.strength.avg).toBe(3.7);
  });

  test('a practice marked not applicable is never counted', () => {
    expect(r.practices.find((p) => p.id === 'C10')).toBeUndefined();
  });

  test('the plan: the mean share of steps followed over the DC sessions that measured a plan, steps skipped most often', () => {
    expect(r.plan).toEqual({
      pct: 64,
      measured: 4,
      of: 6,
      skipped: [
        { step: 'You Do', index: 4, skipped: 3, of: 4 },
        { step: 'Check', index: 5, skipped: 2, of: 4 },
      ],
    });
  });

  test('section B is the plan steps (DC 64%, coach 70%), never B1–B10', () => {
    const b = r.sections.find((s) => s.code === 'B');
    expect(b).toMatchObject({ dc: 64, coach: 70 });
    expect(r.practices.some((p) => p.section === 'B')).toBe(false);
  });

  test('F "AI and coach differ" (84% vs 58%)', () => {
    expect(r.sections.find((s) => s.code === 'F').differ).toBe(true);
  });
});

// ── Sandbox FICO v4 (26 practices, 0–2): the cuts are shares of the scale ─────────────────────────────────────────
function v4Teacher() {
  // No coach observation, so test 1 cannot fire. C1 low (≤1 of 2) in 3 of 3; D2 low in 2 of 3; F1 1.7; C2 the "We Do"
  // link with an average of 1 (lowest), low in 3 of 3 too.
  const dc = [
    { C1: 1, C2: 1, D2: 1, F1: 2, F3: 2 },
    { C1: 0, C2: 1, D2: 1, F1: 2, F3: 1 },
    { C1: 1, C2: 1, D2: 2, F1: 1, F3: 2 },
  ].map((s, i) => report(`v4-${i}`, `2026-11-0${i + 2}`, domainsOf(2, {
    B: { pct: null, size: 7, items: { B1: 2 } },
    C: { pct: 40, size: 4, items: { C1: s.C1, C2: s.C2 } },
    D: { pct: 55, size: 5, items: { D2: s.D2 } },
    F: { pct: 75, size: 10, items: { F1: s.F1, F3: s.F3 } },
  }), planOf(50, [['guided', 'not_done'], ['independent', 'executed']])));
  return { dc, coach: [] };
}

describe('FICO v4 (sandbox, 0–2)', () => {
  const r = Engine.whereToCoach(v4Teacher());

  test('read as v4 from the stored scale', () => {
    expect(r.framework).toBe('fico_v4');
    expect(r.scaleMax).toBe(2);
  });

  test('low is 1 or less of 2: C1 and C2 low in 3 of 3, D2 in 2 of 3', () => {
    const by = Object.fromEntries(r.practices.map((p) => [p.id, p]));
    expect(by.C1).toMatchObject({ k: 3, n: 3, avg: 0.7 });
    expect(by.C2).toMatchObject({ k: 3, n: 3, avg: 1 });
    expect(by.D2).toMatchObject({ k: 2, n: 3 });
  });

  test('test 3 breaks the tie at test 2: C2 is linked to the skipped We Do step; why names it', () => {
    // C1 and C2 tie on test 2 (3 of 3); C2 is linked to "We Do" (skipped in 3 of 3 plans), so it wins before test 4.
    expect(r.focus.id).toBe('C2');
    expect(r.focus.why).toEqual({ test: 2, reason: 'low', k: 3, n: 3, source: 'dc' });
    expect(r.focus.linkedStep).toBe('We Do');
  });

  test('strength needs 1.5 of 2 in another section: F1 (1.7)', () => {
    expect(r.strength).toMatchObject({ id: 'F1', avg: 1.7, scaleMax: 2 });
  });

  test('a B practice on v4 is never ranked (B is the plan steps)', () => {
    expect(r.practices.find((p) => p.id === 'B1')).toBeUndefined();
  });
});

// ── The rest of her rules ───────────────────────────────────────────────────────────────────────────────────────
describe('her steps and edge cases', () => {
  const one = (scores, date = '2026-10-28', lp = null) => report(`r-${date}`, date, domainsOf(4, {
    C: { pct: 70, size: 12, items: { C1: scores.C1, C3: scores.C3 } },
    D: { pct: 70, size: 7, items: { D1: scores.D1 } },
    F: { pct: 80, size: 8, items: { F1: scores.F1, F4: scores.F4 } },
  }), lp);

  test('one DC session: an early signal; tests 1–2 need 2 sessions, so the focus is by test 3 or 4', () => {
    const r = Engine.whereToCoach({ dc: [one({ C1: 1, C3: 2, D1: 2, F1: 4, F4: 3 })], coach: [] });
    expect(r.signal).toBe('early');
    expect(r.focus).toMatchObject({ id: 'C1', why: { test: 4, reason: 'lowest' } });
  });

  test('test 3 on its own: a practice linked to a step she skipped beats a lower average', () => {
    // One session, so no test 1 or 2. F4 (Explanation link) at 2 vs C1 at 1: the skipped Explanation step decides.
    const lp = planOf(40, [['explain', 'not_done']]);
    const r = Engine.whereToCoach({ dc: [one({ C1: 1, C3: 3, D1: 3, F1: 3, F4: 2 }, '2026-10-28', lp)], coach: [] });
    expect(r.focus).toMatchObject({ id: 'F4', why: { test: 3, reason: 'step', step: 'Explanation' } });
  });

  test('test 2 beats test 3: share of low sessions first', () => {
    const lp = planOf(40, [['explain', 'not_done']]);
    const r = Engine.whereToCoach({ dc: [
      one({ C1: 2, C3: 3, D1: 3, F1: 3, F4: 2 }, '2026-10-27', lp),
      one({ C1: 1, C3: 3, D1: 3, F1: 3, F4: 3 }, '2026-10-28', lp),
    ], coach: [] });
    // C1 low in 2 of 2; F4 low in 1 of 2 but linked to the skipped Explanation step.
    expect(r.focus).toMatchObject({ id: 'C1', why: { test: 2, reason: 'low', k: 2, n: 2, source: 'dc' } });
  });

  test('tie: D, then C, then B, then F; then the lower code number', () => {
    const r = Engine.whereToCoach({ dc: [
      one({ C1: 2, C3: 2, D1: 2, F1: 2, F4: 2 }, '2026-10-27'),
      one({ C1: 2, C3: 2, D1: 2, F1: 2, F4: 2 }, '2026-10-28'),
    ], coach: [] });
    expect(r.focus.id).toBe('D1');
    expect(r.weakest.map((p) => p.id)).toEqual(['D1', 'C1', 'C3']);
  });

  test('no strength when nothing averages 3 or more outside the focus section', () => {
    const r = Engine.whereToCoach({ dc: [one({ C1: 2, C3: 2, D1: 1, F1: 2, F4: 2 })], coach: [] });
    expect(r.strength).toBeNull();
  });

  test('no DC: the coach observations alone (her "use HITL only"), why "low in her coach observations"', () => {
    const v = (d) => one({ C1: 3, C3: 3, D1: 1, F1: 3, F4: 3 }, d);
    const r = Engine.whereToCoach({ dc: [], coach: [v('2026-10-27'), v('2026-10-28')] });
    expect(r.signal).toBe('coach_only');
    expect(r.sessions).toEqual({ dc: 0, coach: 2 });
    expect(r.focus).toMatchObject({ id: 'D1', why: { test: 2, reason: 'low', k: 2, n: 2, source: 'coach' } });
  });

  test('nothing in the period: empty, no focus', () => {
    const r = Engine.whereToCoach({ dc: [], coach: [] });
    expect(r).toMatchObject({ signal: 'empty', focus: null, weakest: [], strength: null, sections: [], plan: null });
  });

  test('mixed scales in one period: only the reports on the newest scale count', () => {
    const v3 = one({ C1: 1, C3: 1, D1: 1, F1: 1, F4: 1 }, '2026-10-20');
    const v4 = report('new', '2026-10-28', domainsOf(2, {
      C: { pct: 75, size: 4, items: { C1: 2, C2: 1 } },
      D: { pct: 80, size: 5, items: { D2: 2 } },
    }));
    const r = Engine.whereToCoach({ dc: [v3, v4], coach: [] });
    expect(r.framework).toBe('fico_v4');
    expect(r.sessions.dc).toBe(1);
    expect(r.focus.id).toBe('C2');
  });

  test('the settings drive the cuts: a 30-point differ gap clears F, a 50% agree-low cut clears D', () => {
    const settings = { ...SETTINGS, differPoints: 30, agreeLowBelowPct: 50 };
    const r = Engine.whereToCoach(ayesha(), settings);
    expect(r.sections.find((s) => s.code === 'F').differ).toBe(false);
    expect(r.sections.find((s) => s.code === 'D').agreeLow).toBe(false);
    // Without test 1, D2 and C4 tie on test 2 (3 of 3); D2's lower average decides (test 4).
    expect(r.focus).toMatchObject({ id: 'D2', why: { test: 2, reason: 'low', k: 3, n: 3, source: 'dc' } });
  });
});

// ── Who to coach first (ours: her spec has no teacher ranking) ──────────────────────────────────────────────────
describe('who to coach first: the group her rules put a teacher in', () => {
  test('agree low → group 1', () => {
    expect(Engine.coachFirstGroupOf(Engine.whereToCoach(ayesha()))).toBe('agree_low');
  });
  test('low in at least half of 2+ DC sessions → group 2', () => {
    expect(Engine.coachFirstGroupOf(Engine.whereToCoach(v4Teacher()))).toBe('low_most');
  });
  test('no DC in the period → group 3, even with coach observations', () => {
    const r = Engine.whereToCoach({ dc: [], coach: ayesha().coach });
    expect(Engine.coachFirstGroupOf(r)).toBe('no_dc');
    expect(Engine.coachFirstGroupOf(Engine.whereToCoach({ dc: [], coach: [] }))).toBe('no_dc');
  });
  test('one DC → group 4', () => {
    expect(Engine.coachFirstGroupOf(Engine.whereToCoach({ dc: [ayesha().dc[0]], coach: [] }))).toBe('one_dc');
  });
  test('2+ DC with no low pattern → group 5', () => {
    const good = (i) => report(`g${i}`, `2026-10-2${i}`, domainsOf(4, { C: { pct: 80, size: 12, items: { C1: 3, C3: 4 } }, D: { pct: 85, size: 7, items: { D1: i === 1 ? 2 : 3 } } }));
    expect(Engine.coachFirstGroupOf(Engine.whereToCoach({ dc: [good(1), good(2), good(3)], coach: [] }))).toBe('none');
  });
  test('the group order and the order inside a group', () => {
    expect(Engine.COACH_FIRST_GROUPS).toEqual(['agree_low', 'low_most', 'no_dc', 'one_dc', 'none']);
    const rows = [
      { name: 'b', group: 'low_most', share: 0.5, avgShare: 0.4 },
      { name: 'a', group: 'low_most', share: 1, avgShare: 0.5 },
      { name: 'c', group: 'low_most', share: 1, avgShare: 0.3 },
      { name: 'd', group: 'agree_low', share: 0.5, avgShare: 0.5 },
    ];
    expect(rows.sort(Engine.coachFirstOrder).map((r) => r.name)).toEqual(['d', 'c', 'a', 'b']);
  });
});
