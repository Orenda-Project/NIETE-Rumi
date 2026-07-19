/**
 * FEAT-093 bd-46/bd-48 — the leader ROLE FAMILY and the global gate.
 *
 * Design decisions (operator, 2026-07-15):
 *  - Store the granular role (school_leader/supervisor/coach/principal/aeo);
 *    gate capability on the FAMILY via ONE list in ONE file.
 *  - /observe is available wherever the service is CONFIGURED for it
 *    (OBSERVE_MEWAKA_FLOW_ID present) — geography stops being a code check.
 *  - Framework: everyone defaults to MEWAKA for now (frameworks per market
 *    come later with their ports).
 */
const fs = require('fs');
const path = require('path');
const {
  LEADER_ROLES,
  isSchoolLeader,
  evaluateObserveTrigger,
} = require('../../shared/services/observe/observe-gate');

describe('bd-46 — LEADER_ROLES is the single source of truth', () => {
  test('the family is exactly the five agreed roles', () => {
    expect([...LEADER_ROLES].sort()).toEqual(
      ['aeo', 'coach', 'principal', 'school_leader', 'supervisor']);
  });

  test('isSchoolLeader accepts every family member and nothing else', () => {
    for (const r of LEADER_ROLES) expect(isSchoolLeader({ role: r })).toBe(true);
    for (const r of ['teacher', 'parent', 'parent_paused', '', null, undefined]) {
      expect(isSchoolLeader({ role: r })).toBe(false);
    }
    expect(isSchoolLeader(null)).toBe(false);
  });

  test('SOURCE GUARD: no raw role===school_leader comparison outside observe-gate.js', () => {
    // A second hand-rolled comparison is exactly how the next backfill is born.
    const roots = ['shared', 'workers'];
    const offenders = [];
    const scan = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === 'node_modules' || e.name === '__tests__') continue;
          scan(p);
        } else if (e.name.endsWith('.js') && !p.endsWith('observe-gate.js')) {
          const src = fs.readFileSync(p, 'utf8');
          if (/role\s*[!=]==?\s*['"]school_leader['"]/.test(src)) offenders.push(p);
        }
      }
    };
    const base = path.join(__dirname, '../../');
    for (const r of roots) scan(path.join(base, r));
    const bot = fs.readFileSync(path.join(base, 'whatsapp-bot.js'), 'utf8');
    if (/role\s*[!=]==?\s*['"]school_leader['"]/.test(bot)) offenders.push('whatsapp-bot.js');
    expect(offenders).toEqual([]);
  });
});

describe('bd-48 — capability replaces geography', () => {
  const supervisor = { id: 'u1', role: 'supervisor', preferences: { observe_onboarded: true } };
  afterEach(() => { delete process.env.OBSERVE_MEWAKA_FLOW_ID; });

  test('configured service → /observe matches for a supervisor in ANY region', () => {
    process.env.OBSERVE_MEWAKA_FLOW_ID = '123';
    for (const region of ['PK', 'TZ', 'PS', 'YE', undefined]) {
      const r = evaluateObserveTrigger({ messageBody: '/observe', user: supervisor, region });
      expect(r).toEqual({ match: true, action: 'capture' });
    }
  });

  test('unconfigured service → no match even in TZ (config is the ONLY gate)', () => {
    delete process.env.OBSERVE_MEWAKA_FLOW_ID;
    const r = evaluateObserveTrigger({ messageBody: '/observe', user: supervisor, region: 'TZ' });
    expect(r).toEqual({ match: false });
  });

  test('a coach who has not onboarded gets the onboard action with their arm', () => {
    process.env.OBSERVE_MEWAKA_FLOW_ID = '123';
    const coach = { id: 'u2', role: 'coach', preferences: { observe_onboarding_arm: 'why_coaching' } };
    const r = evaluateObserveTrigger({ messageBody: '/observe', user: coach, region: 'PK' });
    expect(r).toEqual({ match: true, action: 'onboard', arm: 'why_coaching' });
  });

  test('teachers are still denied with the explanation action, never silently', () => {
    process.env.OBSERVE_MEWAKA_FLOW_ID = '123';
    const r = evaluateObserveTrigger({ messageBody: '/observe', user: { role: 'teacher' }, region: 'TZ' });
    expect(r).toEqual({ match: true, action: 'deny_role' });
  });
});

describe('bd-46 — the audio router honours the whole family', () => {
  test('audio-router gates on the family, not the single role string', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../shared/services/observe/observe-audio-router.js'), 'utf8');
    expect(src).toMatch(/isSchoolLeader/);
    expect(src).not.toMatch(/role\s*!==\s*SCHOOL_LEADER_ROLE/);
  });
});
