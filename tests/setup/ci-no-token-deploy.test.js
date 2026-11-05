/**
 * Railway's own GitHub trigger is the ONE deploy path for every NIETE environment (sandbox, staging, production
 * each build their branch). A workflow that also runs `railway up` is a second path to the same service, racing the
 * first.
 *
 * deploy.yml was exactly that: on every push to main it ran `railway up --service bot`, and from at least 2 Nov 2026
 * every run failed with "Invalid RAILWAY_TOKEN". It never deployed anything, and it left a permanent red X on main,
 * which taught everyone to ignore main's CI. Repairing the token would have made it worse: two deploys per push.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', '.github', 'workflows');

describe('CI workflows: no second deploy path', () => {
  it('no workflow deploys with `railway up` (Railway deploys from its own GitHub trigger)', () => {
    const offenders = fs.readdirSync(DIR)
      .filter((f) => /\.ya?ml$/.test(f))
      .filter((f) => fs.readFileSync(path.join(DIR, f), 'utf8').split('\n')
        .some((line) => !/^\s*#/.test(line) && /\brailway\s+up\b/.test(line)));
    expect(offenders).toEqual([]);
  });
});
