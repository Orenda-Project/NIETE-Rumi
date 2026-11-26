'use strict';
/**
 * bd-dsu5mq (queue #291) — a coach makes a teacher a Principal (the co-observation pilot's "focal person"), and the
 * new Principal gets the hand-scored FDE form instead of the Digital Coach's pre-fill.
 *
 * Prod, 26 Nov 09:22 PKT: coach Misbah made teacher Muhammad Ayyaz Nawaz a Principal at IMCB I-8/3 in the WhatsApp
 * observe-visit Flow (Teacher > Edit > Role). The write set users.role only; his users.region stayed blank. The FICO-S
 * switches reach principals through "role:principal@ict", which needs users.region, so at 10:04 his grade 6 lesson fell
 * to obs612 (FDE's form, scored by hand, no Digital Coach) while Misbah and another principal observing the SAME lesson
 * got the pre-fill. Operator, 26 Nov ~11:00: coaches making a focal person a Principal is supported ("Let them do
 * their thing"), so it has to work by itself:
 *
 *   (a) the role edit fills users.region and users.organization from the person's school when they are blank, and
 *       logs who changed whom (the leader_roster_audit row already did; the log line named only the coach);
 *   (b) superseded by bd-dsu5mq.2: every observe switch decides from the VISIT's school, never the profile region
 *       (tests/coaching/visit-school-decides.test.js), so (a) is data hygiene only.
 *
 * Real: teacher-edit-commit.service (the portal's Edit teacher), patch-resolver, the switch modules, region-registry.
 * Faked: the Supabase client (in memory) and the logger.
 */

const fs = require('fs');
const path = require('path');

let tables;
let failSelect; // table names whose SELECT answers an error
let logs;

function fakeSupabase() {
  return {
    from(name) {
      const t = tables[name] || (tables[name] = []);
      const filters = [];
      let op = 'select';
      let patch = null;
      let inserted = null;
      let single = false;
      let returning = false;
      let lim = null;
      const match = (row) => filters.every(([kind, c, v]) => {
        if (kind === 'eq') return row[c] === v;
        if (kind === 'is') return (row[c] === undefined ? null : row[c]) === v;
        return v.includes(row[c]);
      });
      const run = () => {
        if (op === 'insert') { t.push(...inserted); return { data: null, error: null }; }
        const hits = t.filter(match);
        if (op === 'update') {
          hits.forEach((r) => Object.assign(r, patch));
          return { data: returning ? hits.map((r) => ({ ...r })) : null, error: null };
        }
        if (failSelect.has(name)) return { data: null, error: { message: `select ${name} refused` } };
        const rows = (lim == null ? hits : hits.slice(0, lim)).map((r) => ({ ...r }));
        if (single) return { data: rows[0] || null, error: null };
        return { data: rows, error: null };
      };
      const chain = {
        select() { if (op === 'update') returning = true; return chain; },
        eq(c, v) { filters.push(['eq', c, v]); return chain; },
        in(c, v) { filters.push(['in', c, v]); return chain; },
        is(c, v) { filters.push(['is', c, v]); return chain; },
        order() { return chain; },
        limit(n) { lim = n; return chain; },
        maybeSingle() { single = true; return chain; },
        update(p) { op = 'update'; patch = p; return chain; },
        insert(rows) { op = 'insert'; inserted = Array.isArray(rows) ? rows : [rows]; return chain; },
        then(resolve, reject) { try { resolve(run()); } catch (e) { reject(e); } },
      };
      return chain;
    },
  };
}

const ME = 'coach-misbah';
const SCHOOL = 'niete:910';

beforeEach(() => {
  jest.resetModules();
  tables = {
    leader_schools: [{ leader_user_id: ME, school_ext_id: SCHOOL, school_id: 'sch-910' }],
    schools: [
      { id: 'sch-910', name: 'IMCB, I-8/3', emis: '910', region: 'Urban-II' },
      { id: 'sch-gb', name: 'Moawin School Chilas', emis: 'gb-1', region: 'Gilgit-Baltistan' },
    ],
    region_features: [
      { region: 'urban-ii', organization: 'niete', display_name: 'Urban-II', sort_order: 5, is_active: true },
      { region: 'gilgit-baltistan', organization: 'moawin', display_name: 'Gilgit-Baltistan', sort_order: 8, is_active: true },
    ],
    users: [
      // Ayyaz, as prod held him on 26 Nov: a teacher at I-8/3, region and organization blank.
      { id: 'u-ayyaz', phone_number: '+92300FIXTURE1', name: 'Muhammad Ayyaz Nawaz', role: 'teacher', school_id: 'sch-910',
        region: null, organization: null, teacher_level: ['HIGH'], teacher_level_updated_at: null },
    ],
    app_settings: [],
    leader_roster_audit: [],
  };
  failSelect = new Set();
  logs = [];
  jest.doMock('../../bot/shared/utils/logger', () => ({
    logToFile: jest.fn((msg, data) => logs.push({ msg, data })),
    logError: jest.fn(),
  }));
  jest.doMock('../../bot/shared/config/supabase', () => fakeSupabase());
});

afterEach(() => jest.resetModules());

const svc = () => require('../../bot/shared/services/observe/teacher-edit-commit.service');
const user = (id) => tables.users.find((u) => u.id === id);
const makePrincipal = (extra = {}) => svc().editRole({ actorLeaderUserId: ME, schoolExtId: SCHOOL, userId: 'u-ayyaz', role: 'principal', ...extra });

describe('(a) a coach makes a teacher a Principal: the new Principal\'s region comes from the school', () => {
  test('a blank region and organization are filled from the school (Urban-II, niete)', async () => {
    const out = await makePrincipal();
    expect(out).toMatchObject({ ok: true, outcome: 'saved', role: 'principal' });
    expect(user('u-ayyaz')).toMatchObject({ role: 'principal', region: 'Urban-II', organization: 'niete' });
  });

  test('a region or organization already held is never overwritten', async () => {
    Object.assign(user('u-ayyaz'), { region: 'Sihala', organization: 'Taleemabad/niete' });
    await makePrincipal();
    expect(user('u-ayyaz')).toMatchObject({ role: 'principal', region: 'Sihala', organization: 'Taleemabad/niete' });
  });

  test('with no users.school_id, the school she picked him from decides (leader_schools)', async () => {
    user('u-ayyaz').school_id = null;
    // patch-resolver lists her roster from the school's teachers; keep Ayyaz on it through school_ext_id.
    jest.doMock('../../bot/shared/services/observe/patch-resolver.service', () => ({
      listPatchViaSupabase: jest.fn(async () => [{ userId: 'u-ayyaz', name: 'Muhammad Ayyaz Nawaz', phone: '+92300FIXTURE1' }]),
    }));
    await makePrincipal();
    expect(user('u-ayyaz')).toMatchObject({ role: 'principal', region: 'Urban-II', organization: 'niete' });
  });

  test('if the school cannot be read the role change still stands and nothing else is written', async () => {
    failSelect.add('schools');
    const out = await makePrincipal();
    expect(out).toMatchObject({ ok: true, outcome: 'saved', role: 'principal' });
    expect(user('u-ayyaz')).toMatchObject({ role: 'principal', region: null, organization: null });
  });

  test('the log line names the coach AND the person changed, the roles, and what was filled', async () => {
    process.env.WEB_QUIZ_KID_KEY = 'test-key-bd-dsu5mq-0123456789abcdef-0123';
    try {
    await makePrincipal();
    const line = logs.find((l) => l.data && l.data.event === 'observe.role_changed');
    expect(line).toBeTruthy();
    // Keyed references (quiz/web-quiz-kid tk), never the raw ids (tests/setup/log-raw-ids): the same id always keys the
    // same way, so the line still joins to the audit row below, which holds the raw ids.
    const { tk } = require('../../bot/shared/services/quiz/web-quiz-kid');
    expect(line.data).toMatchObject({
      actorTk: tk(ME), targetTk: tk('u-ayyaz'), fromRole: 'teacher', toRole: 'principal', filled: ['region', 'organization'],
    });
    expect(line.data.actorTk).toEqual(expect.any(String));
    expect(JSON.stringify(line.data)).not.toMatch(/coach-misbah|u-ayyaz/);
    // The audit row stays as it was: actor, the person, from/to.
    expect(tables.leader_roster_audit).toEqual([expect.objectContaining({
      action: 'edit_role', actor_user_id: ME, teacher_ext_id: 'u-ayyaz',
      detail: expect.objectContaining({ from: 'teacher', to: 'principal' }),
    })]);
    } finally { delete process.env.WEB_QUIZ_KID_KEY; }
  });

  test('the WhatsApp Flow commit (where Misbah did it) writes through the same function', () => {
    const HANDLER = fs.readFileSync(path.join(__dirname, '../../bot/shared/handlers/observe-visit-flow.handler.js'), 'utf8');
    const commit = HANDLER.slice(HANDLER.indexOf("step === 'teacher_edit_role_commit'"));
    const body = commit.slice(0, commit.indexOf('\n    if (step ==='));
    expect(body).toMatch(/writeRoleChange\(/);
    expect(body).not.toMatch(/from\('users'\)\.update\(plan\.patch\)/);
  });
});

// (b) moved, bd-dsu5mq.2 (operator 26 Nov ~21:40): the switches no longer fall back to the observer's school or
// organization; the VISIT'S school decides for every observer, whatever her profile says. Ayyaz's case and the rest:
// tests/coaching/visit-school-decides.test.js. The fill in (a) stays as data hygiene; nothing decides from it.
describe('(b) the profile region decides nothing (bd-dsu5mq.2)', () => {
  it("Ayyaz after the role edit: the visit at his ICT school gets the Digital Coach, his own row aside", async () => {
    user('u-ayyaz').role = 'principal';
    tables.app_settings.push(
      { key: 'fico_s_coach', value: { 'role:principal@ict': 'on' } },
      { key: 'fico_s_dc', value: { 'role:principal@ict': 'on' } },
    );
    const ficoS = require('../../bot/shared/services/coaching/fico-s-switch');
    expect(await ficoS.dcForVisit({ id: 'u-ayyaz', role: 'principal', region: null }, { schoolId: 'sch-910' })).toBe(true);
  });
});
