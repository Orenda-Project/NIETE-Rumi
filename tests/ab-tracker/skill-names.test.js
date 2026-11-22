// A session started inside this repo loads ITS skills first. A local skill named
// `ab-testing` shadows the workspace skill of the same name, so a session here
// never sees the card, registry and gates that launch an A/B test. The bandit
// notes live under their own name and point at the launch skill instead.
const fs = require('fs');
const path = require('path');

const SKILLS = path.resolve(__dirname, '..', '..', '.claude', 'skills');
const nameOf = (dir) => {
  const md = path.join(SKILLS, dir, 'SKILL.md');
  if (!fs.existsSync(md)) return null;
  const m = fs.readFileSync(md, 'utf8').match(/^name:\s*(.+)$/m);
  return m ? m[1].trim() : null;
};

describe('A/B skill names', () => {
  const dirs = fs.readdirSync(SKILLS).filter((d) => fs.statSync(path.join(SKILLS, d)).isDirectory());

  test('no local skill is named ab-testing (it would shadow the launch skill)', () => {
    expect(dirs).not.toContain('ab-testing');
    expect(dirs.map(nameOf)).not.toContain('ab-testing');
  });

  test('the bandit skill is ab-bandit and points launches at the ab-testing skill', () => {
    expect(nameOf('ab-bandit')).toBe('ab-bandit');
    const body = fs.readFileSync(path.join(SKILLS, 'ab-bandit', 'SKILL.md'), 'utf8');
    expect(body).toMatch(/launch/i);
    expect(body).toMatch(/`ab-testing` skill/);
  });
});
