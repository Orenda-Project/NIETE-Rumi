/**
 * bd-v04lsh (queue #257) — Principal Training. The operator, 24 Nov 2026: "Coach Trainings needs to go live for Principal
 * as well. Showing as Principal Training. Same feature, same trainings."
 *
 * A principal reads and marks the same ten modules through the same two routes as a coach (GET/PUT
 * /coach/coach-training/progress), kept in her own users.preferences.coach_training_done. Who may call them:
 *   a principal      by her role alone (whatever the coach app switch says: 68 prod principals are on no app switch)
 *   anyone else      exactly as before: the coach app (portal_coach_v2) on for them, else 404
 * The leader-role gate still runs first, so a teacher never reaches either.
 */
const fs = require('fs');
const path = require('path');
const { makeRequireTrainingReader } = require('../../dashboard/routes/coach-training-progress.routes');

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

const isPrincipalRole = (r) => typeof r === 'string' && r.trim().toLowerCase() === 'principal';

async function run(guard, role, uid = 'u-1') {
  const req = { session: { portalUserId: uid }, portalUser: { role } };
  const res = fakeRes();
  let passed = false;
  await guard(req, res, () => { passed = true; });
  return { passed, res };
}

describe('who may read and mark the modules', () => {
  it('a principal passes by her role, and the coach app switch is not even read', async () => {
    const coachAppOn = jest.fn(async () => false);
    const guard = makeRequireTrainingReader({ isPrincipalRole, coachAppOn });
    for (const role of ['principal', ' Principal ']) {
      const { passed, res } = await run(guard, role);
      expect(passed).toBe(true);
      expect(res.statusCode).toBe(200);
    }
    expect(coachAppOn).not.toHaveBeenCalled();
  });

  it('a coach passes only with the coach app on for her (unchanged): off is a 404', async () => {
    const on = makeRequireTrainingReader({ isPrincipalRole, coachAppOn: async (uid) => uid === 'c-on' });
    expect((await run(on, 'coach', 'c-on')).passed).toBe(true);
    const off = await run(on, 'coach', 'c-off');
    expect(off.passed).toBe(false);
    expect(off.res.statusCode).toBe(404);
  });

  it('another leader (AEO) is read the coach way, never the principal way', async () => {
    const coachAppOn = jest.fn(async () => false);
    const r = await run(makeRequireTrainingReader({ isPrincipalRole, coachAppOn }), 'aeo');
    expect(r.passed).toBe(false);
    expect(r.res.statusCode).toBe(404);
    expect(coachAppOn).toHaveBeenCalledWith('u-1');
  });

  it('portal.routes mounts the progress router behind signed in, leader role, then this guard', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../dashboard/routes/portal.routes.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const at = src.indexOf("require('./coach-training-progress.routes').createCoachTrainingProgressRouter(");
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf('}));', at));
    expect(block).toMatch(/guards:\s*trainingReaders\b/);
    const def = src.match(/const trainingReaders = \[([^\]]+)\]/);
    expect(def).not.toBeNull();
    expect(def[1].split(',').map((s) => s.trim())).toEqual(['requirePortalAuth', 'requireLeaderRole', 'requireTrainingReader']);
    expect(src).toMatch(/const requireTrainingReader = makeRequireTrainingReader\(\{[\s\S]*?isPrincipalRole[\s\S]*?PORTAL_COACH_V2_KEY[\s\S]*?\}\)/);
  });
});
