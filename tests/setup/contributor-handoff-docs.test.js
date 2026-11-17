/**
 * Contributors change the portal with their own coding agents and hand the change over through a PR into
 * `sandbox`. What those agents read must send them to the sandbox and nowhere else, and every PR must carry
 * what the reviewer needs. This pins both:
 *
 *   - .github/pull_request_template.md asks for what, why, how it was tested, screenshots at 360 and 1280 in
 *     English and Urdu, the switch it needs, and a "ready for review" tick;
 *   - .github/CONTRIBUTING.md has a "Contributing with your agent" section: branch from and PR into `sandbox`,
 *     the sandbox contributor env file only, never `.env`, `.env.prod` or `.env.stage`;
 *   - the root CLAUDE.md no longer points agents at a production `.env` or at a credentials document.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('PR template', () => {
  const rel = '.github/pull_request_template.md';

  it('exists', () => {
    expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
  });

  it('asks for what, why, how it was tested and the switch', () => {
    const t = read(rel);
    expect(t).toMatch(/^##+\s*What\b/im);
    expect(t).toMatch(/^##+\s*Why\b/im);
    expect(t).toMatch(/^##+\s*How (it was |I )?tested/im);
    expect(t).toMatch(/^##+\s*Switch/im);
  });

  it('asks for screenshots at 360 and 1280, in English and Urdu', () => {
    const t = read(rel);
    expect(t).toMatch(/^##+\s*Screenshots/im);
    expect(t).toMatch(/360/);
    expect(t).toMatch(/1280/);
    expect(t).toMatch(/English/);
    expect(t).toMatch(/Urdu/);
  });

  it('ends with a "ready for review" checkbox', () => {
    expect(read(rel)).toMatch(/^- \[ \] .*ready for review/im);
  });

  it('hands over by a direct message to the product owner, not a channel', () => {
    const t = read(rel);
    expect(t).toMatch(/direct message/i);
    expect(t).not.toMatch(/review channel/i);
  });
});

describe('Contributing with your agent', () => {
  const rel = '.github/CONTRIBUTING.md';
  const section = () => {
    const t = read(rel);
    const start = t.search(/^## Contributing with your agent/m);
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = t.slice(start + 3);
    const end = rest.search(/^## /m);
    return end === -1 ? rest : rest.slice(0, end);
  };

  it('sends work to sandbox: branch from it, PR into it', () => {
    const s = section();
    expect(s).toMatch(/origin\/sandbox/);
    expect(s).toMatch(/PR into `sandbox`/);
  });

  it('allows the sandbox contributor env file only, and names the three files never to use', () => {
    const s = section();
    expect(s).toMatch(/\.env\.sandbox/);
    for (const banned of ['`.env`', '`.env.prod`', '`.env.stage`']) expect(s).toContain(banned);
    expect(s).toMatch(/never/i);
  });

  it('names the review handoff: a direct message to the product owner, no channel', () => {
    const s = section();
    expect(s).toMatch(/ready for review/i);
    expect(s).toMatch(/direct message/i);
    expect(s).not.toMatch(/review channel/i);
  });

  it('asks to extend existing tables instead of adding a parallel one', () => {
    const s = section();
    expect(s).toMatch(/parallel/i);
    expect(s).toMatch(/lesson-plan-data-model-debt\.md/);
  });
});

describe('root CLAUDE.md', () => {
  const t = () => read('CLAUDE.md');

  it('does not point agents at a production .env', () => {
    expect(t()).not.toMatch(/NIETE-Rumi\/\.env`? for prod/);
    expect(t()).not.toMatch(/`\.env` for prod/);
  });

  it('does not point agents at a credentials document', () => {
    expect(t()).not.toMatch(/ACCESS_CREDENTIALS/);
  });

  it('sends contributors to the contributor setup', () => {
    expect(t()).toMatch(/\.github\/CONTRIBUTING\.md/);
  });
});
